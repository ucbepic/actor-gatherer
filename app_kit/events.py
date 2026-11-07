"""The events an app inserts for agents to see: ag's two outside types, in the payload shapes ag's policies read
(ag.ag_policies.proactive_context_manager.events; ag.ag_interface.Poller's doc: "Return environment_update or
context_stream events when they fit, so that existing policies already know how to show them").

    context_stream(stream, author, text)        a message from a stream: the policy shows it at its place in the
                                                conversation of the agent whose channel it is in (every agent's: none)
    environment_update(subject, what, source)   something the agent may have opened changed: the policy tells it
                                                only if a tool call of its own named the subject since
    checked(event)                              an inserted event of either type in that shape, its timestamp and text
                                                filled in as ag's builders fill them; ValueError if it is not

Each returns an event in ag's insert shape ({type, payload, id?, text}), for Host.insert. Standard library only."""

import time
from typing import Any, Optional

from .manifest import CONTEXT_TYPES

CONTEXT_STREAM, ENVIRONMENT_UPDATE = "context_stream", "environment_update"
_FIELDS = {CONTEXT_STREAM: ("stream", "author", "text"), ENVIRONMENT_UPDATE: ("subject", "what")}


def context_stream(stream: str, author: str, text: str, timestamp: Optional[float] = None,
                   id: Optional[str] = None) -> dict:
    """A message in `stream` from `author` -- "In Notes, the user pinned ..." -- as ag's `context_stream` makes one."""
    return checked({"type": CONTEXT_STREAM, "payload": {"stream": stream, "author": author, "text": text,
                                                         "timestamp": timestamp}, **({"id": id} if id else {})})


def environment_update(subject: str, what: str, source: str = "", timestamp: Optional[float] = None,
                       id: Optional[str] = None) -> dict:
    """`subject` (as the agent would name it: a path, a URL) changed: `what` says how. As ag's `environment_update`."""
    return checked({"type": ENVIRONMENT_UPDATE, "payload": {"subject": subject, "what": what, "source": source,
                                                             "timestamp": timestamp}, **({"id": id} if id else {})})


def checked(event: Any) -> dict:
    """`event`, one of the two context types, in ag's shape: its payload's fields strings, its `timestamp` now where
    none, its `text` (what the read log and the dashboard show of it) as ag's builders word it where none."""
    if not isinstance(event, dict) or event.get("type") not in CONTEXT_TYPES:
        raise ValueError(f"not one of {', '.join(CONTEXT_TYPES)}")
    t = event["type"]
    payload = event.get("payload")
    if not isinstance(payload, dict):
        raise ValueError(f"{t}: its payload is an object with {', '.join(_FIELDS[t])}")
    bad = [f for f in _FIELDS[t] if not isinstance(payload.get(f), str) or (f != "what" and not payload[f])]
    if bad:
        raise ValueError(f"{t}: its payload's {', '.join(bad)} must be text, as ag's policies read them")
    stamp = payload.get("timestamp")
    if not isinstance(stamp, (int, float)) or isinstance(stamp, bool):
        payload = {**payload, "timestamp": time.time()}
    if t == ENVIRONMENT_UPDATE:
        payload = {"source": "", **payload}
        text = f"{payload['subject']}: {payload['what']}" if payload["what"] else payload["subject"]
    else:
        text = f"{payload['author']} in {payload['stream']}: {payload['text']}"
    out = {**event, "payload": payload}
    if not isinstance(event.get("text"), str):
        out["text"] = text
    return out
