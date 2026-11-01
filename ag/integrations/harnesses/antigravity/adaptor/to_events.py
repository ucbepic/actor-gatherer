"""Antigravity's request contents as the context manager's events -- the policy-specific half of the antigravity
harness, with `to_messages.py` (the way back).

    events = to_events(contents)            # what the hook's routing sends in a `rewrite`

An event is `{"type", "id", "payload", "tokens"?, "text"?}` (ag/ag_harness/server): one per part, its payload the
part as a content of its own (`{"role", "parts": [part]}`, as agy sends them back); what it is, Antigravity's rules
say (harness_kit/antigravity.py: a Part of a Kind), and the event type each Kind becomes, the adaptor
(`HarnessAdaptor.event_types`); its id is the function call's own (a response's: `<id>:result`), else a hash of its
content; its text what the model reads of it (`text_of`).

Nothing of the context manager is imported here.
"""

import hashlib
import json
from typing import Dict, List

from harness_kit import Kind
from harness_kit.antigravity import Antigravity, part_of, text_of
from ag.integrations.tools.ag_orchestrator.adaptor import part_properties

USER_MESSAGE, AGENT_MESSAGE, TOOL_CALL, TOOL_OUTPUT, CONTEXT = (
    "user_message", "agent_message", "tool_call", "tool_output", "context")
AGENT_REASONING = "agent_reasoning"
#: Every event type to_events makes, and nothing else.
OUTPUTS = (USER_MESSAGE, AGENT_MESSAGE, TOOL_CALL, TOOL_OUTPUT, CONTEXT, AGENT_REASONING)
#: Which event type each Kind of a piece becomes (the adaptor's `event_types`), as codex's: any other Kind -- agy's
#: own system messages -- CONTEXT.
EVENT_TYPES = {Kind.USER: USER_MESSAGE, Kind.USER_COMMAND: USER_MESSAGE, Kind.MID_TURN: USER_MESSAGE,
               Kind.ASK_REPLY: USER_MESSAGE, Kind.AGENT: AGENT_MESSAGE, Kind.REASONING: AGENT_REASONING,
               Kind.TOOL_CALL: TOOL_CALL, Kind.TOOL_RESULT: TOOL_OUTPUT}

HARNESS = Antigravity()


def item_id(item) -> str:
    """A stable id for a content of one part: its function call's id (`<id>:result` for the response to it -- they
    share it), else `sha256:<hash of the content's JSON, keys sorted>`: two identical parts are then one."""
    p = part_of(item)
    for key, suffix in (("functionCall", ""), ("functionResponse", ":result")):
        found = p.get(key).get("id") if isinstance(p.get(key), dict) else None
        if isinstance(found, str) and found:
            return found + suffix
    raw = json.dumps(item, sort_keys=True, ensure_ascii=False)
    return "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def to_events(contents: list, event_types: Dict[str, str] = EVENT_TYPES) -> List[dict]:
    """The events agy's contents are, one per part, in order. `event_types`: which event type each Kind becomes
    (HarnessAdaptor's). The summary a compacted history opens with is left out, as codex's: it summarises the
    context the gatherer gave agy for its compaction, and the gatherer holds that history itself."""
    items = HARNESS.items(contents)
    out = []
    for item, part in zip(items, HARNESS.read(items)):
        if part.kind == Kind.COMPACTION_SUMMARY:
            continue
        event = {"type": event_types.get(part.kind, CONTEXT), "id": item_id(item), "payload": item}
        text = text_of(item)
        if text is not None:
            event["text"] = text
        found = part_properties(part)
        if found:
            event["properties"] = found
        out.append(event)
    return out
