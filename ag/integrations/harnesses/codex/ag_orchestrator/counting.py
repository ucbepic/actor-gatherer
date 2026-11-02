"""The provider's own count of what codex's calls hold, for the context manager to size contexts by --
as the Claude Code hook's counting.py does with Anthropic's count_tokens, here with OpenAI's
/v1/responses/input_tokens: OpenAI's half of the shared counter (ag/integrations/tools/ag_orchestrator/
counting.py, which does the counting described below for every proxied harness).

ag counts every event with its own tokenizer (o200k_base), and the model's count is not quite it:
codex's tool definitions come out higher by ag's count, the conversation lower (the framing of each
item), and a reasoning item -- encrypted -- is 0 to ag. The count endpoint counts a request as the
call itself is counted, and this asks it, after each call is sent (`Counter.start`: in the
background, never delaying it):

    a new step        each step of codex's items not counted yet (the items up to a cut that leaves
                      no tool call without its output), counted standalone -- after a one-word
                      placeholder, the placeholder subtracted -- then split into its items by
                      counting it again without each: a message (or other context item) taken out,
                      a tool output's content cut to one word; a tool call gets what is left. A step
                      the endpoint will not take alone is counted in the history, shared by size.
    the context       ag's own items (its sections, notices) standalone, once per text, as they are
    manager's items   sent (to_messages.ag_message).
    the preamble      the instructions and the tools, once per version, where the request has them
                      as fields: the placeholder with them, with the instructions alone, and with
                      neither. Codex 0.164 sends neither: its instructions and tool definitions are
                      input items (developer messages, `additional_tools`), events, counted as steps.

Where it asks: at the request's own upstream with its own credentials (an API-key login: the API's
/v1/responses/input_tokens) -- as for Claude Code. Under a ChatGPT login, codex's upstream (the
ChatGPT backend) has no such endpoint; the API's is asked instead, with the key in OPENAI_API_KEY as
the hook server has it (none: not asked). An endpoint that cannot count is not asked again; a model
it does not know, not again for that model.

Reasoning. The endpoint counts codex's encrypted reasoning as nothing -- counted with it or without,
a request comes to the same -- though the call's own count (its reported input tokens, `measured`)
holds it. So, once that count is back (`Counter.reported`): the request as sent, counted by the
endpoint, falls short of it by what the reasoning it sends costs; less the reasoning already
costed, that is what the reasoning new in it costs, shared evenly among those items (as Claude
Code's thinking's rise is). Reasoning stays where it is sent: codex's model reads an earlier turn's
reasoning while it stays beside what it produced, and the policy cuts and stubs whole steps, so it
always does.

Without the endpoint (no key, a model it does not know, an upstream that cannot count), the call's
own counts tell the rest (`Counter.reported`): two calls of a channel in a row, the later's context
the earlier's with items added (the same build, nothing taken out), differ by exactly what those
items cost -- shared among them as ag's own counts would share it (by the length of what ag counts of
each: nothing of a reasoning item, whose cost its neighbours then carry). A channel's first call is
so from nothing. After a build, the first call is not differenced; the ones after it
are again.

Codex's items are read through the adaptor class the hook is given (its `to_events` for an item's
event, its `to_messages` for how the context manager's own items are sent), as the hook reads them.

The counts go to the server (`counted`), which sets them in place of the tokenizer's.

What is known is ag's, not this process's: each stored event of a context comes with its size as
stored and whether that is the provider's count, and the answer names the call's events not counted
yet (`uncounted`). So a hook server started again counts what the last one would have, and costs
reasoning already costed at what it was found to cost (`learn`). A `Channel` keeps caches, and what
a call needs until its own count is back; differencing, which needs the last call's own count,
starts again at the next call after one whose events the store has counted.
"""

import os
from typing import Optional, Set, Tuple
from urllib.parse import urlsplit

from ag.integrations.tools.ag_orchestrator import counting
from ag.integrations.tools.ag_orchestrator.counting import (  # noqa: F401 - the names this module had
    CANNOT_COUNT, COUNT_SECONDS, KEPT_SENT, REPORT_SECONDS, STEPS_PER_CALL, Channel, Sent, ag_item, event_of, key_of,
    kind_of, weight_of)

COUNTED = ("model", "input", "instructions", "tools", "tool_choice", "parallel_tool_calls", "reasoning", "text",
           "truncation")                     # what the count endpoint takes
CREDENTIALS = ("authorization", "openai-organization", "openai-project")
API = "https://api.openai.com/v1/responses/input_tokens"   # where a ChatGPT login's calls are counted
KEY_ENV = "OPENAI_API_KEY"                   # the key it is asked with
CHATGPT = "/backend-api/"                    # a ChatGPT login's path (codex's chatgpt.com/backend-api/codex)
PLACEHOLDER = [{"type": "message", "role": "user", "content": [{"type": "input_text", "text": "x"}]}]
REASONING = "reasoning"


def countable(body: dict) -> dict:
    """What the count endpoint takes of a Responses request: its model, input, instructions, tools and
    the settings that change what the model is given (reasoning, text, tool choice)."""
    return {k: body[k] for k in COUNTED if k in body and body[k] is not None}


def is_reasoning(item) -> bool:
    return isinstance(item, dict) and item.get("type") == REASONING


class Counter(counting.Counter):
    """The provider's counts of codex's calls (the shared Counter, with OpenAI's Responses API)."""

    INPUT = "input"
    PLACEHOLDER = PLACEHOLDER
    PREAMBLE = ("instructions", "tools")
    COSTS_REASONING = True

    def where(self, request, body: dict) -> Optional[Tuple[str, dict]]:
        """Its upstream's endpoint with its credentials -- or, under a ChatGPT login, the API's with
        OPENAI_API_KEY (none: not counted)."""
        upstream, path = getattr(request, "upstream", None), getattr(request, "path", "") or ""
        if not upstream:
            return None
        if CHATGPT in path or (urlsplit(upstream).hostname or "").endswith("chatgpt.com"):
            key = os.environ.get(KEY_ENV)
            if not key:
                return None
            return API, {"authorization": f"Bearer {key}"}
        url = upstream.rstrip("/") + path.rstrip("/") + "/input_tokens"
        return url, {k: v for k, v in (request.headers or {}).items() if k.lower() in CREDENTIALS}

    def payload(self, request, body: dict) -> dict:
        return countable(body)

    def tokens_of(self, answer) -> Optional[int]:
        return answer.get("input_tokens") if isinstance(answer, dict) else None

    def unknown_model(self, status: int, error, message: str) -> bool:
        return isinstance(error, dict) and (error.get("code") == "model_not_found"
                                            or "model" in message.lower() and "exist" in message)

    def base_of(self, body: dict) -> dict:
        return {k: body[k] for k in COUNTED if k in body and k != "input"}

    def bare_of(self, base: dict) -> dict:
        return {"model": base.get("model")}

    def call_of(self, item) -> Optional[str]:
        return item.get("call_id") if isinstance(item, dict) else None

    def cut_output(self, item) -> dict:
        return dict(item, output="x")

    def ends_step(self, item, kind: str, waiting: Set[str]) -> bool:
        """After any item but a tool call or reasoning, once every tool call since the last cut has its output."""
        return kind not in (self.call_type, self.reasoning_type) and not waiting

    def is_reasoning(self, item) -> bool:
        return is_reasoning(item)

    def made_weight(self, item) -> int:
        content = item.get("content") if isinstance(item.get("content"), list) else []
        return sum(len(c.get("text") or "") for c in content if isinstance(c, dict))
