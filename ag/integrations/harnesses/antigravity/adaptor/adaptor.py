"""Antigravity's adaptor: its Gemini API contents as the context manager's events (to_events.py), and the context back
as contents (to_messages.py)."""

from ag.integrations.tools.ag_orchestrator.adaptor import CHANNEL, AG, CWD, HarnessAdaptor

from .to_events import CONTEXT, EVENT_TYPES, HARNESS, OUTPUTS, to_events
from .to_messages import to_messages


class AntigravityAdaptor(HarnessAdaptor):
    name = "antigravity"
    harness = HARNESS
    outputs = OUTPUTS
    event_types = EVENT_TYPES
    other = CONTEXT
    accepts = OUTPUTS + (AG,)
    properties = (CHANNEL, CWD)

    def to_events(self, messages: list):
        return to_events(messages, self.event_types)

    def to_messages(self, context: list, messages: list):
        return to_messages(context, messages)
