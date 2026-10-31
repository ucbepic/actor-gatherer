"""harness_kit: what each agent harness is, apart from ag -- how it shapes its model calls, which of the text
it sends is its own, what its tools do, what its own records of a session hold. Standard library only; it
imports nothing of ag (tests/test_harness_kit.py), so ag's integrations and the dashboard both read
harnesses through it.

    harness_kit.get("claude")        a harness's rules (ClaudeCode, Codex): `call`, `items`, `read`; a session's
                                     name given in the harness's own store (`rename`, `rename_command`)

    base.py      the Harness class, and what reading gives: Call, Part (of a Kind), ToolCall, ToolResult; and what
                 reading its own record of a session gives: a Follower's Facts (`follow`)
    claude.py    Claude Code (ClaudeCode); its record of a session (Record)
    codex.py     Codex (Codex); its rollout of a thread (Rollout)
    antigravity.py  Antigravity's CLI, agy (Antigravity), on its Gemini API route
    shell.py     what a shell command reads and writes, read from its words: shared by every harness
    screen.py    a terminal's screen read back from what was printed to it (Screen): what each harness's `box` reads
                 to tell whether its message box, empty, has the keys
"""

from typing import Dict, Optional

from .base import (MODELS, USERS, Action, AnswerError, Box, Call, CallKind, Fact, Facts, Follower,  # noqa: F401 - the
                   Harness, InstructionsError, Kind, Part, RenameError, ToolCall, ToolResult, follow)  # package's API
from . import codex  # noqa: F401 - harness_kit.codex, as before
from .antigravity import Antigravity
from .claude import ClaudeCode
from .codex import Codex

HARNESSES: Dict[str, Harness] = {h.name: h for h in (ClaudeCode(), Codex(), Antigravity())}


def get(name: Optional[str]) -> Optional[Harness]:
    """The harness named `name` ("claude", "codex", "antigravity"); None for one harness_kit has no rules for."""
    return HARNESSES.get(name or "")


def words(text: str, harness: Optional[str] = None) -> tuple:
    """(the Kind, the user's words as they typed them) of a message's text in the user's name, its harness's wrappers
    taken off (Harness.words): `harness`'s, else whichever harness's wrapper it is in (they do not overlap)."""
    h = get(harness)
    if h is not None:
        return h.words(text)
    for h in (HARNESSES["codex"], HARNESSES["claude"], HARNESSES["antigravity"]):
        got = h.words(text)
        if got != (Kind.USER, text):
            return got
    return Kind.USER, text
