"""The context manager's answer as Antigravity's contents -- the policy-specific half of the antigravity harness, with
`to_events.py` (the way in).

    contents = to_messages(answer["context"])     # what agy's model gets as `contents`

The context is the events the policy kept, as they were sent, and the context manager's own messages, `{"type":
"ag", "name", "text"}` (ag/ag_harness/server). An event comes back as its payload, a content of one part; an `ag`
message as a content in the user's role, in the wrapper agy puts its own system messages in -- the Gemini API has no
system message but the one at the top, and a note moved there would lose its place. Nothing of the context manager is
imported here.
"""

from typing import Optional

AG = "ag"
SYSTEM_MESSAGE = ("The following is a <SYSTEM_MESSAGE> not actually sent by the user. It is provided by the system "
                  "as important information to pay attention to.\n\n<SYSTEM_MESSAGE>\n{}\n</SYSTEM_MESSAGE>")


def ag_message(text: str) -> dict:
    """The context manager's text as a content: a user-role SYSTEM_MESSAGE, as agy sends its own."""
    return {"role": "user", "parts": [{"text": SYSTEM_MESSAGE.format(text)}]}


def to_messages(context: list, contents: Optional[list] = None) -> list:
    """The context as agy's contents: each event's payload as it was sent, each `ag` message as `ag_message` makes it.
    (`contents`, this call's, are not needed: each part comes back whole.)"""
    out = []
    for entry in context:
        if not isinstance(entry, dict):
            continue
        if entry.get("type") == AG:
            out.append(ag_message(str(entry.get("text") or "")))
        elif "payload" in entry:
            out.append(entry["payload"])
    return out
