"""The reader's name for an actor: kept in its gatherer, as an event of the dashboard's, and given to its harness.

    record(gatherer, channel, name)     a `name` event by "user" in the actor's channel, put in by ag (`ag home insert`):
                                        what the list shows ahead of any name the harness gave (data.py); "" takes
                                        the reader's name back
    in_store(harness, channel, name, cwd)   the name given in the harness's own store (harness_kit's `rename`): Claude
                                        Code's record of the session, codex's state -- where its list of sessions to
                                        resume, and its next run, read it

A session running in the dashboard's terminal is also told, by its own command (`rename_command`: Claude Code's and
codex's `/rename`), once its turn is over: sessions.py's `rename`.
"""

import json
import subprocess
from typing import Optional

import harness_kit

from . import sessions

NAME_CHARS = 120                # the longest name kept, as data.py shows names
BY = "user"                     # who gave it, as the `name` event says


class NamingError(ValueError):
    pass


def clean(name: Optional[str]) -> str:
    """A name as it is kept: one line, its spaces single, at most NAME_CHARS."""
    return " ".join((name or "").split())[:NAME_CHARS].strip()


def record(gatherer: str, channel: str, name: str) -> None:
    """The reader's name for the actor (or "": none), a `name` event in its channel, put in by ag."""
    if not gatherer or not channel:
        raise NamingError("which actor?")
    event = {"type": "name", "payload": {"text": clean(name), "by": BY}}
    try:
        done = subprocess.run([*sessions.ag_command(), "home", "insert", gatherer, "--properties",
                               json.dumps({"channel": channel}), "--events", json.dumps([event])],
                              env=sessions.agent_env(), capture_output=True, text=True, timeout=60,
                              stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError, sessions.SessionError) as exc:
        raise NamingError(f"could not run ag: {exc}") from None
    try:
        got = json.loads(done.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        got = {"error": (done.stderr or done.stdout).strip()[-300:] or f"ag home insert exited {done.returncode}"}
    if not isinstance(got, dict) or got.get("error") or done.returncode:
        raise NamingError(str(got.get("error") if isinstance(got, dict) else got))


def in_store(harness: Optional[str], channel: str, name: str, cwd: Optional[str] = None) -> str:
    """The name given in the harness's own store: what was done, in a few words. Raises harness_kit.RenameError where
    it was not (no rules for the harness, its record not found, it refused the name)."""
    h = harness_kit.get(harness)
    if h is None:
        raise harness_kit.RenameError(f"no rules for {harness or 'its harness'}: named here only")
    return h.rename(channel, clean(name), env=sessions.agent_env(), cwd=cwd)     # its own record, where it keeps one
