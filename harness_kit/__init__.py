"""harness_kit: what each agent harness is, apart from ag -- how it shapes its model calls, which of the text
it sends is its own, what its tools do, what its own records of a session hold. Standard library only; it
imports nothing of ag (tests/test_harness_kit.py), so ag's integrations and the dashboard both read
harnesses through it.

    harness_kit.get("claude")        a harness's rules (ClaudeCode, Codex): `call`, `items`, `read`; a session's
                                     name given in the harness's own store (`rename`, `rename_command`); how a
                                     person tells it apart and how its terminal behaves (`mark`, `fullscreen`, ...)
    harness_kit.HARNESSES            every harness known here, by name, in the order a reader is offered them
    harness_kit.runnable()           the names of those a session can be started on in a terminal (`command`)
    harness_kit.DEFAULT              the harness of a session that names none

A new harness is a module here with its Harness subclass, its mark in marks/<name>.svg, and its line in HARNESSES:
what reads harnesses (ag's integrations, the dashboard) reads it through this package, naming none of them.

    base.py      the Harness class, and what reading gives: Call, Part (of a Kind), ToolCall, ToolResult; and what
                 reading its own record of a session gives: a Follower's Facts (`follow`)
    claude.py    Claude Code (ClaudeCode); its record of a session (Record)
    codex.py     Codex (Codex); its rollout of a thread (Rollout)
    antigravity.py  Antigravity's CLI, agy (Antigravity), on its Gemini API route
    pi.py, opencode.py  Pi and OpenCode, by name and look alone (Named): their rules are in their TypeScript adaptors
    marks/       each harness's mark, an SVG: <name>.svg
    shell.py     what a shell command reads and writes, read from its words: shared by every harness
    screen.py    a terminal's screen read back from what was printed to it (Screen): what each harness's `box` reads
                 to tell whether its message box, empty, has the keys
"""

from typing import Dict, List, Optional

from .base import (MODELS, USERS, Action, AnswerError, Box, Call, CallKind, Fact, Facts, Follower,  # noqa: F401 - the
                   Harness, InstructionsError, Kind, Named, Part, RenameError, ToolCall, ToolResult,
                   follow)  # package's API
from . import codex  # noqa: F401 - harness_kit.codex, as before
from .antigravity import Antigravity
from .claude import ClaudeCode
from .codex import Codex
from .opencode import OpenCode
from .pi import Pi

HARNESSES: Dict[str, Harness] = {h.name: h for h in (ClaudeCode(), Codex(), Antigravity(), Pi(), OpenCode())}
#: The harness a session that names none ran on: Claude Code, the first ag ran (sessions and channels from before
#: the harness was recorded are its).
DEFAULT = "claude"


def runnable() -> List[str]:
    """The names of the harnesses a session can be started on in a terminal (`Harness.runs_in_terminal`), in order."""
    return [n for n, h in HARNESSES.items() if h.runs_in_terminal]


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
