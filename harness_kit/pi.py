"""Pi (pi.dev), known here by its name and its look alone: its rules are in its TypeScript adaptor
(ag/integrations/harnesses/pi), which ag runs inside it. Its sessions record `model_call`s as "pi"."""

from .base import Named


class Pi(Named):
    name = "pi"
    label = "Pi"
