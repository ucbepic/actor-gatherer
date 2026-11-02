"""The provider's own count of what Antigravity's calls hold, for the context manager to size contexts by: Gemini's
half of the shared counter (ag/integrations/tools/ag_orchestrator/counting.py, whose doc says what is counted when),
with Gemini's `models/<model>:countTokens`.

Why. ag counts with o200k_base, and Gemini's tokenizer gives ~20% more for the same text, prose and code alike
(measured 2026-11-01 on an actor's calls: 1.13-1.25x), so an Antigravity actor's context stays ~20% bigger than ag
thinks. Counted by the endpoint, a call rebuilt from its read came within 3% of the call's own count.

What Gemini counts. The endpoint takes the request as `generateContentRequest` (its model, contents, system
instruction, tools and tool config) and answers `totalTokens`. A thought signature (`thoughtSignature`, the base64
agy sends back on each function call) costs nothing: a call with a 9,792-character signature counts as one with 408.
Thought text sent back counts as text does, so reasoning is counted as a message is (`COSTS_REASONING` off). The
endpoint refuses a function response whose call is not right before it, and a function call without its signature:
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
CREDENTIALS = ("x-goog-api-key", "authorization", "x-goog-user-project")
GENERATE = re.compile(r"/models/([^/:]+):(?:stream)?[gG]enerateContent$")   # a model call's path
PLACEHOLDER = [{"role": "user", "parts": [{"text": "x"}]}]


def model_of(path: str) -> Optional[str]:
    found = GENERATE.search(path or "")
    return found.group(1) if found else None


class Counter(counting.Counter):
    """The provider's counts of Antigravity's calls (the shared Counter, with Gemini's countTokens)."""

    INPUT = "contents"
    PLACEHOLDER = PLACEHOLDER
    PREAMBLE = ("systemInstruction", "tools")
    COSTS_REASONING = False

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
