"""The provider's own count of what Antigravity's calls hold, for the context manager to size contexts by: Gemini's
half of the shared counter (ag/integrations/tools/ag_orchestrator/counting.py, whose doc says what is counted when),
with Gemini's `models/<model>:countTokens`.

Why. ag counts with o200k_base, and Gemini's tokenizer gives ~20% more for the same text, prose and code alike
(measured 2026-11-01 on an actor's calls: 1.13-1.25x), so an Antigravity actor's context stays ~20% bigger than ag
thinks. Counted by the endpoint, a call rebuilt from its read came within 3% of the call's own count.

What Gemini counts. The endpoint takes the request as `generateContentRequest` (its model, contents, system
instruction, tools and tool config) and answers `totalTokens`. Thought text sent back counts as text does, in the
endpoint and the call alike, so reasoning is counted as a message is. A thought signature (`thoughtSignature`, the
base64 agy sends back on a function call, or on the first part of an answer that has none) is the endpoint's blind
spot: it counts as nothing there (a call with a 9,792-character signature counts as one with 408), but the call is
charged for it. Measured 2026-11-01 on 74 calls of an actor (gemini-4-argon): the endpoint's count of each call
rebuilt from its read matched the call's own count to the token when the context held no signature, and fell short by
0.114 tokens a signature character with them (mean error 142 tokens, up to 2.7% of a context). So a signed event
costs the endpoint's count of it and its signature at a rate per character (`COSTS_HIDDEN`): once a call's own count
is back, the rate is the call's count over the endpoint's count of the request as sent, over every signature character
it sent (`hidden_counts`) -- all of them, not only the new, so a hook started again costs none of the old ones to the
new -- and each signed event first counted since is set again at it. Until a channel's first count is back, the rate
is the measured one (SIGNATURE_RATE). The endpoint refuses a function response whose call is not right before it, and a function call without its signature:
a step is cut only once every call has its response -- after the last response, or after a content not the model's
(agy sends a function response in the model's role) -- so a model's thought, words and calls stay together, with
their signatures, and with their responses (`ends_step`).

Where it asks: at the request's own upstream (Gemini's API, where agy's calls go: harness_kit's Antigravity), the
call's path with `:countTokens` for `:streamGenerateContent`, with the call's own key (agy sends `x-goog-api-key`).
A call with no key (agy on a Google login, which does not come through ag's proxy) is not counted: the call's own
counts are differenced instead.
"""

import re
from typing import Optional, Set, Tuple

from ag.integrations.tools.ag_orchestrator import counting

COUNTED = ("systemInstruction", "tools", "toolConfig", "cachedContent")   # what the endpoint takes besides contents
SIGNATURE_RATE = 0.114      # tokens a signature character costs a call, until a channel's own calls say (the doc)
MIN_SIGNED = 2000           # signature characters a call sends at least, to learn the rate from: fewer, too few to tell
CREDENTIALS = ("x-goog-api-key", "authorization", "x-goog-user-project")
GENERATE = re.compile(r"/models/([^/:]+):(?:stream)?[gG]enerateContent$")   # a model call's path
PLACEHOLDER = [{"role": "user", "parts": [{"text": "x"}]}]


def model_of(path: str) -> Optional[str]:
    found = GENERATE.search(path or "")
    return found.group(1) if found else None


def signature_chars(item) -> int:
    """The length of an item's thought signatures: what the endpoint counts as nothing of it."""
    parts = item.get("parts") if isinstance(item, dict) else None
    return sum(len(p.get("thoughtSignature") or "") for p in parts or () if isinstance(p, dict))


class Counter(counting.Counter):
    """The provider's counts of Antigravity's calls (the shared Counter, with Gemini's countTokens)."""

    INPUT = "contents"
    PLACEHOLDER = PLACEHOLDER
    PREAMBLE = ("systemInstruction", "tools")
    COSTS_HIDDEN = True               # thought signatures: nothing to the endpoint, the call is charged for them

    def where(self, request, body: dict) -> Optional[Tuple[str, dict]]:
        upstream, path = getattr(request, "upstream", None), getattr(request, "path", "") or ""
        found = GENERATE.search(path)
        headers = {k: v for k, v in (getattr(request, "headers", None) or {}).items() if k.lower() in CREDENTIALS}
        if not upstream or not found or not headers:
            return None
        return upstream.rstrip("/") + path[:found.start()] + f"/models/{found.group(1)}:countTokens", headers

    def model_of(self, request, body: dict) -> Optional[str]:
        return model_of(getattr(request, "path", "") or "")

    def payload(self, request, body: dict) -> dict:
        inner = {k: body[k] for k in COUNTED if body.get(k) is not None}
        return {"generateContentRequest": {"model": f"models/{self.model_of(request, body)}",
                                           "contents": body.get(self.INPUT) or [], **inner}}

    def tokens_of(self, answer) -> Optional[int]:
        return answer.get("totalTokens") if isinstance(answer, dict) else None

    def unknown_model(self, status: int, error, message: str) -> bool:
        return "model" in message.lower() and "not found" in message.lower()

    def base_of(self, body: dict) -> dict:
        return {k: body[k] for k in COUNTED if body.get(k) is not None}

    def call_of(self, item) -> Optional[str]:
        for part in (item.get("parts") if isinstance(item, dict) else None) or ():
            for key in ("functionCall", "functionResponse"):
                if isinstance(part, dict) and isinstance(part.get(key), dict) and part[key].get("id"):
                    return part[key]["id"]
        return None

    def cut_output(self, item) -> dict:
        parts = []
        for part in item.get("parts") or ():
            if isinstance(part, dict) and isinstance(part.get("functionResponse"), dict):
                part = dict(part, functionResponse=dict(part["functionResponse"], response={"output": "x"}))
            parts.append(part)
        return dict(item, parts=parts)

    def ends_step(self, item, kind: str, waiting: Set[str]) -> bool:
        if waiting:
            return False
        return kind == self.output_type or (item.get("role") if isinstance(item, dict) else None) != "model"

    def made_weight(self, item) -> int:
        return sum(len(p.get("text") or "") for p in item.get("parts") or () if isinstance(p, dict))

    @staticmethod
    def rate(ch: counting.Channel) -> float:
        return ch.rate if ch.rate is not None else SIGNATURE_RATE

    def extra(self, ch: counting.Channel, item) -> int:
        chars = signature_chars(item)
        return round(chars * self.rate(ch)) if chars else 0

    def hidden_estimate(self, ch: counting.Channel, items: list) -> int:
        return round(self.rate(ch) * sum(signature_chars(i) for i in items))

    def hidden_counts(self, ch: counting.Channel, sent: Optional[counting.Sent], tokens: int,
                      exact: Optional[int]) -> dict:
        """The rate a signature character costs, from the call's own count (`tokens`) over the endpoint's count of the
        request as sent (`exact`), over every signature character it sent; then each signed event this process
        counted the step of and has not costed by a call's own count: its endpoint count and its signature at it."""
        if sent is None or not isinstance(exact, int):
            return {}
        signed = [(at, signature_chars(item)) for kind, at, item in sent.parts if kind == "event"]
        chars = sum(c for _, c in signed)
        if chars < MIN_SIGNED or tokens < exact:
            return {}
        ch.rate = (tokens - exact) / chars
        counts = {}
        for at, c in signed:
            if c and at and at in ch.visible and at not in ch.reasoning:
                ch.reasoning[at] = round(c * ch.rate)
                counts[at] = ch.visible[at] + ch.reasoning[at]
        return {"counts": counts}
