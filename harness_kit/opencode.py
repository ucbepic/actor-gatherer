"""OpenCode, known here by its name and its look alone: its rules are in its TypeScript adaptor
(ag/integrations/harnesses/opencode), which ag runs inside it. Its sessions record `model_call`s as "opencode"."""

from .base import Named


class OpenCode(Named):
    name = "opencode"
    label = "OpenCode"
