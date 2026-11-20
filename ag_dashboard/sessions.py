"""Sessions started from the page: a headless agent per session, run through ag, that the page
sends messages to. Each is an ordinary ag session -- a channel of its gatherer, shown like any
other actor -- and the dashboard's own table, `sessions` in <home>/dashboard.db, keeps which
ones it started:

    session_id       the session's id, chosen here, which ag makes the gatherer's channel: Claude Code's own
                     (--session-id); for a harness that picks its session's id only at its first call (codex's
                     thread, agy's conversation), the channel ag keeps that session in (`ag --channel`), for good
    gatherer         the gatherer it joined (ag makes a new one on its first call)
    harness          the harness it runs on, as harness_kit names it (of `HARNESSES`: those it can start)
    cwd              where the agent runs
    permission_mode  Claude Code's --permission-mode: auto (the default), acceptEdits, plan, ...; for codex,
                     auto is --approve-for-me, bypassPermissions its bypass, any other none (codex asks)
    model            the model it runs (-m), NULL: the harness's own default
    harness_id       the harness's own id for it, where that is not `session_id` (codex's thread, agy's conversation),
                     once its first call named it (`own_id`); NULL: the same, or not known yet
    started_as       (sessions from before `ag --channel`) the id one was started under, before it was renamed to the
                     harness's once its first call named that; NULL for any other
    created_at       when it was started (ISO, UTC)
    turns            how many of its turns have ended: after the first, a restart resumes it
    status           starting / running / idle / terminal / stopped / failed, as last seen
    last_error       why its last turn or process failed, if one did
    kept             when (epoch seconds) its process was ended by the dashboard stopping -- a restart, a
                     crash -- or put away by it (`put_away`), not closed: it shows Idle, not Closed, until it
                     is opened again (here or elsewhere) or closed from the list; 0 when not kept
    ended            when (epoch seconds) the dashboard's last process for it ended -- closed from the list,
                     exited, hung up; not a codex turn's own end -- what tells it Closed where ag cannot tell
                     whether a process runs (no /proc: macOS); 0 when none has
    role             what the session is for, besides its messages: "coordinator", a coordinator agent
                     (coordination.py), run with that role's instructions added to its harness's own on every run
                     (`instructions`); or, as JSON, {"app": name, "key": instance}: the actor an app started with
                     it (app_agents.py), attached to it -- its tools and instructions given by the tool gateway
                     (`extra_args`) -- or {"<name>": key}, one from before the app was one (adopted: app_agents.py's
                     `adopt_all`); NULL, an actor like any other
    over             a coordinator agent's NODE, the part of the list it is over (coordinators.py): "all", "groups:<id>",
                     "group:<name>" or "folder:<id>"; NULL, its group's

The agent is one long-running process, `ag --gatherer G claude -p --input-format stream-json
--output-format stream-json ...`: each message is a line on its stdin, a turn, and each turn
ends with a `result` line on its stdout. A message sent while a turn runs waits for it. Between
turns it gives way (`ag home hold ... --yields`): another process opening the session -- a terminal
resuming it -- stops it and takes the session over; before the next turn it stops giving way
(`--keeps`), and if it was taken meanwhile the message is refused. A process that is gone (taken
over, exited, the dashboard restarted) is started again on the next message, resuming the session
(`--resume`) once it has had a turn, or its harness has saved it (`resumes`).

Any Claude Code session of a gatherer can be messaged so, not only one started here (`adopt`: it
joins the table, to be resumed in the directory its calls named) -- while no other process has it
open. ag records which process has each session open (`_open` in the gatherer's database: its
launcher's claim, and each call's), and refuses a second one; the dashboard asks the same before
it starts one (`holder`), and its own agent, run through ag, is refused like any other. The
dashboard never takes a session from another live process, idle or not: only once it has ended. What the agent said is not kept here:
the page reads it from the gatherer, like every actor's history. Its stderr, and every line it
printed, go to <home>/logs/dashboard/<session_id>.log.

A session can be opened in a TERMINAL instead (`terminal`): Claude Code's own interactive UI,
`ag --quiet --gatherer G claude ...` with no `-p`, in a pseudo-terminal the page draws (xterm.js) --
the same process a terminal outside would run, less ag's notes on what it set up, so it shows and
asks what it would there (the trust dialog, permission prompts) and its keys are its own. The page
gets what it prints (`output`, kept the last TERM_KEEP bytes so a page that comes back redraws it) and sends what is typed (`type`) and
the window's size (`resize`). A full screen draws only what changed, so once what is kept no longer holds the
last time it was drawn whole, a page replaying it would miss whatever has not changed since -- Claude Code's
input box, its status line: its process is made to draw it all again (`redraw`). Opening it ends the session's idle `-p` agent first; from then on the
terminal has the session, and a message sent from any view is typed into it -- pasted, then Enter --
until it is closed (`stop`) or exits. Unix only: it needs `pty` (TERMINALS).

Which a message OPENS, when the session has no terminal open, is the home's config.toml's to say
(`chat_mode`): `[dashboard] chat = "terminal"`, the default, opens its terminal, the message given as its
first prompt (after `--`, so it is never read as an option), so the session is always seen in its own UI;
`chat = "headless"` sends it to the `-p` agent above. Either way, a turn the agent is running takes
the message after it, in the agent.

A session whose process the dashboard's own end took (`close`, or a dashboard gone without one: what
it last recorded running) is KEPT: not closed by anyone, so shown Idle with no process, to be picked
up by its next message or terminal. So is one whose process the dashboard PUT AWAY (`put_away`): an
actor saved for later, left unused (saved.py's `Rest`). Closing it (`stop`), or its process ending any
other way, clears it.

A session that NEVER STARTED -- made (`create`), but no process of it ever had a turn, so its gatherer has
nothing of it -- can be DISCARDED (`discard`): its row deleted, with every row the dashboard keeps of it as an
actor (store.py's `discard_actor`), so it is listed nowhere, as if it had never been made.

CODEX runs the same ways, through `ag ... codex`: in a terminal, its own interactive UI (`codex
[resume <id>]`); headless, a process per turn, `codex exec --json
[resume <id>] -` with the message on its stdin, ending with the turn. Codex chooses its thread's id,
at its first call; a codex session started here is kept under the dashboard's id all the same, from that
call on: ag is told it (`ag --channel <id>`) and keeps the run's own thread in that channel. The id is the
session's for good. Codex's own (`harness_id`, `own_id`) is what the dashboard resumes it by and finds its
records by, and it comes with that first call: in the gatherer, its turns' `model_call` events name it,
and `codex exec`'s `thread.started` names it too.

ANTIGRAVITY (agy) runs in a terminal only, its own interactive UI, whatever `chat_mode` says (its headless
mode is not built): it chooses its conversation's id too, so it is kept under the dashboard's id as a codex
session is.

A new gatherer, with no session yet, is made by `ag new <name>` (`new_gatherer`).

A SHELL is opened from a gatherer's row too (`shell`): no session, the user's own login shell in a
terminal of its own, in the directory the page gives it (where a new session there would start), drawn
as a session's terminal is -- by its id, "shell:" and 12 hex digits, which no channel has, to `output`,
`type` and `resize` -- and listed under the gatherer (`shells`) until it exits or is closed
(`close_shell`). Not run through ag, and not kept: it lives as long as the dashboard does.

ag is run as a command (AG_COMMAND, else `ag` on the PATH), never imported."""

import errno
import json
import os
import re
import shlex
import shutil
import signal
import sqlite3
import struct
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import urlsplit

import harness_kit
from harness_kit.base import AT_DENY, AT_OPTION, Box
from harness_kit.processes import end_group
from harness_kit.screen import Screen

from . import actions, answers, home, store

try:                                    # a terminal needs a pseudo-terminal: Unix only
    import fcntl
    import pty
    import pwd
    import termios
    TERMINALS = True
except ImportError:
    TERMINALS = False

HARNESSES = tuple(harness_kit.runnable())     # the harnesses a session can be started on here (harness_kit's)
PERMISSION_MODES = ("auto", "acceptEdits", "plan", "bypassPermissions", "dontAsk", "manual")
CHAT_MODES = ("terminal", "headless")          # what a message opens for a session with no terminal (`chat_mode`)
COORDINATOR = "coordinator"                    # the role of a coordinator agent (coordination.py)
ROLES = (COORDINATOR,)
ALONE = "self:"                                 # an actor on its own's group of one, `self:<channel>` (groups.py)
SENT_KEPT = 20                                  # a session's latest messages from Chat kept in memory (`send`)
#: What tells a command an actor runs which actor runs it, and which dashboard delivers its messages (coordination.py,
#: `ag actors`): set in every session the dashboard starts (`actor_env`), as each harness also says (its own session's
#: variable: Claude Code's CLAUDE_CODE_SESSION_ID, codex's CODEX_THREAD_ID).
ACTOR_VAR, DASHBOARD_VAR = "AG_ACTOR", "AG_DASHBOARD"
DASHBOARD: Optional[str] = None                # this dashboard's address, as its server set it (server.py's `serve`)
SHELL_ID = re.compile(r"shell:[0-9a-f]{12}")   # a shell's id (`shell`): never a channel's
GATHERER = re.compile(r"[A-Za-z0-9._-]+")      # the names ag takes
# What says the dashboard itself runs inside a harness's session (harness_kit's `session_env`); its agents are sessions
# of their own.
PARENT_SESSION = tuple(sorted({v for h in harness_kit.HARNESSES.values() for v in h.session_env}))

SCHEMA = """CREATE TABLE IF NOT EXISTS sessions (
    session_id      TEXT PRIMARY KEY,
    gatherer        TEXT NOT NULL,
    harness         TEXT NOT NULL,
    cwd             TEXT NOT NULL,
    permission_mode TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    turns           INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL,
    last_error      TEXT,
    kept            REAL NOT NULL DEFAULT 0,
    model           TEXT,
    started_as      TEXT,
    ended           REAL NOT NULL DEFAULT 0,
    role            TEXT,
    over            TEXT,
    harness_id      TEXT
)"""
COLUMNS = ("session_id", "gatherer", "harness", "cwd", "permission_mode", "created_at", "turns", "status", "last_error",
           "kept", "model", "started_as", "ended", "role", "over", "harness_id")
ADDED = (("kept", "REAL NOT NULL DEFAULT 0"), ("model", "TEXT"), ("started_as", "TEXT"),
         ("ended", "REAL NOT NULL DEFAULT 0"), ("role", "TEXT"), ("over", "TEXT"),
         ("harness_id", "TEXT"))   # columns a table from before lacks


def _added(conn: sqlite3.Connection, column: str) -> None:
    if column == "ended":                # what had run and stopped, not kept: ended by now
        conn.execute("UPDATE sessions SET ended = ? WHERE status IN ('stopped', 'failed') AND kept = 0 AND turns > 0",
                     (time.time(),))


store.table("sessions", SCHEMA, added=ADDED, on_added=_added, actor="session_id", merged=store.MOVE)


class SessionError(ValueError):
    """A request the sessions cannot take: the page shows its text."""


class NotAtBox(SessionError):
    """A message the session's terminal cannot take now: something other than its message box, empty, has the keys --
    `box`, what (harness_kit's Box: HOLDS, AWAY). The page points to the terminal."""

    def __init__(self, text: str, box: str):
        super().__init__(text)
        self.box = box


def log_path(session_id: str) -> str:
    return os.path.join(home.HOME, "logs", "dashboard", f"{session_id}.log")


def _insert(conn: sqlite3.Connection, **row) -> None:
    """A row put in the table, by its columns' names (of COLUMNS): any not given takes its default (SCHEMA's)."""
    unknown = set(row) - set(COLUMNS)
    if unknown:
        raise ValueError(f"no such column: {', '.join(sorted(unknown))}")
    conn.execute(f"INSERT INTO sessions ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})", tuple(row.values()))


def stored() -> List[dict]:
    """The sessions the table has, newest first, read-only: [] when there is no table yet."""
    with store.reading(rows=True) as conn:
        if conn is None or not store.has(conn, "sessions"):
            return []
        # a table from before `kept`, `model`, `started_as`, `ended`, `role`, `over`, `harness_id` (read before any
        # write has added them): none
        return [{"kept": 0, "model": None, "started_as": None, "ended": 0, "role": None, "over": None, "harness_id": None,
                 **dict(r)}
                for r in conn.execute("SELECT * FROM sessions ORDER BY created_at DESC")]


OUTER_TERMINAL = ("TMUX", "TMUX_PANE", "STY", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "TERM_SESSION_ID", "WINDOWID",
                  "VTE_VERSION", "KITTY_WINDOW_ID", "WEZTERM_PANE", "ITERM_SESSION_ID")   # the dashboard's own terminal: not the page's
TERM_KEEP = 512 * 1024             # how much of a terminal's output is kept, for a page that comes back
PASTE_ENTER = 0.15                 # after a message is pasted into a terminal, how long before its Enter
CLEAR_GAP = 0.2                    # after Claude Code's input box is emptied (Ctrl+C), how long before a message is pasted
STOP_KEYS = ("\x1b", "\x03")       # keys that stop a turn: Esc, Ctrl+C
KEYS_GAP = 0.1                     # around the dashboard's own keys (a paste, an answer): a stop key typed is kept this far off
HOLD_MAX = 10.0                    # a stop key held while the dashboard's own keys go in, at most this long
ANSWER_GAP = 0.3                   # between the keys of an answer typed into a dialog: several at once are one input to it
CLOSE_SECONDS = 3.0                # a permission's keys typed in: how long its terminal is watched for its dialog to close
DENY_SECONDS = 1.5                 # a permission's No: how long its dialog is watched for the cursor to reach it (AT_DENY)
SHOWN_SECONDS = 1.0                # a permission dialog shown with none recorded this long: what its screen shows is what
#                                    it asks (data.py's `shown_ask`) -- its hook, where it calls one, records it sooner
READY_SECONDS = 1.0                # a terminal's message box with the keys this long: its harness has started, its menus
#                                    (an update, a folder to trust) behind it -- a menu after that is the reader's own
#                                    (`_watch_shown`); Codex draws its composer for a moment between two of them
DIALOG = "dialog"                  # what an ask is that only a terminal's screen shows (data.py's `shown_ask`): `_pick`
CLEARED = b"\x1b[2J"               # a full screen clearing it, to draw it all again (Claude Code's, at its start and each resize)
REDRAW_WAIT = 1.0                  # a full screen made a row shorter (`redraw`): how long it is given to draw, before it is put back
BOX_SETTLE = 0.5                   # a terminal's message box not shown empty: how long its screen is watched for it to be (a
                                   # program hides its cursor while it draws), before a message for it is refused (`_at_box`)
TOOLS_WAIT = 10.0                  # a terminal's first message waits for its MCP servers to list their tools at most this
                                   # long after its message box first shows (`_first_message`), then goes without them
TOOLS_TAKEN = 0.2                  # once they have: how long the harness is given to take the list in
BOX_POLL = 0.25                    # how often a first message looks again for its terminal's message box, while a dialog has it
#: What a page's terminal sends that no one typed: focus in and out, the terminal's answers to the program's
#: questions (device attributes, cursor position, OSC replies), mouse reports. Not typing: a dialog is as it was.
REPORTS = re.compile(r"\x1b\[[IO]|\x1b\[[?>]?[\d;]*[cRn]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[^\x1b]*\x1b\\|\x1b\[<[\d;]*[Mm]")
# A key that is no character in the input box: an escape sequence (an arrow, a function key, a paste's brackets) whole.
NOT_TYPED = re.compile(r"\x1b(?:\[[\d;?]*[ -/]*[@-~]|O.|.)?")


def drafted(n: int, keys: str) -> int:
    """How many characters the reader has typed into the terminal's input box and not sent, after `keys`, of `n`
    before: Enter sends them, Ctrl+C empties the box (Claude Code's, of any it holds), a Backspace takes one back,
    any other character adds one. A count, never sure -- a dialog's keys count too -- so a rename waits on it
    (`rename_due`) rather than add to what the reader wrote."""
    for ch in NOT_TYPED.sub("", keys):
        if ch in "\r\x03":
            n = 0
        elif ch in "\x7f\b":
            n = max(0, n - 1)
        elif ch >= " ":
            n += 1
    return n



def _has_calls(gatherer: str, session_id: str) -> bool:
    """Whether the session made a model call: Claude Code has saved it, so it can be resumed."""
    conn = store.gatherer(gatherer)
    if conn is None:
        return False
    try:
        return conn.execute("SELECT 1 FROM _reads WHERE ifnull(p_channel, '') = ? LIMIT 1", (session_id,)).fetchone() is not None
    except sqlite3.Error:
        return False
    finally:
        conn.close()


def resumes(s: dict) -> bool:
    """Whether the session `s` (a row of the table) is resumed when it starts, not started anew: it has had a turn, or
    made a call, or its harness keeps a record of it already (harness_kit's `record_path`). Claude Code writes its record
    once its first message is entered, before any call, and then refuses to start a session of that id again
    ("Session ID ... is already in use"): one closed before its first call was recorded is resumed so."""
    if s["turns"] or _has_calls(s["gatherer"], s["session_id"]):
        return True
    h = harness_kit.get(s["harness"])
    try:
        return bool(h and h.record_path(own_id(s), s.get("cwd")))
    except OSError:
        return False


SESSION_ID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def holder(gatherer: str, session_id: str) -> Optional[dict]:
    """The process that has the session open, as the gatherer says, and still runs: {pid, by} -- its
    `_open` row (ag's launcher's claim, or a call's), else the process its newest call named. None:
    none, or none that can be told."""
    conn = store.gatherer(gatherer)
    if conn is None:
        return None
    try:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        rows = []
        if "_open" in tables:
            rows += [(r["pid"], r["pid_started"], r["opened_by"]) for r in conn.execute(
                "SELECT pid, pid_started, opened_by FROM _open WHERE session = ?", (session_id,))]
        cols = {r[1] for r in conn.execute("PRAGMA table_info(_reads)")} if "_reads" in tables else set()
        if {"pid", "pid_started", "p_channel"} <= cols:
            rows += [(r["pid"], r["pid_started"], "call") for r in conn.execute(
                "SELECT pid, pid_started FROM _reads WHERE ifnull(p_channel, '') = ? AND pid IS NOT NULL ORDER BY read_id DESC LIMIT 1",
                (session_id,))]
    except sqlite3.Error:
        return None
    finally:
        conn.close()
    for pid, started, by in rows:
        if home.process_alive(pid, started):
            return {"pid": pid, "by": by}
    return None


def _session_cwd(gatherer: str, session_id: str) -> Optional[str]:
    """Where the session's calls said it works: the newest read's `cwd`."""
    conn = store.gatherer(gatherer)
    if conn is None:
        return None
    try:
        r = conn.execute("SELECT p_cwd FROM _reads WHERE ifnull(p_channel, '') = ? AND p_cwd IS NOT NULL ORDER BY read_id DESC LIMIT 1",
                         (session_id,)).fetchone()
    except sqlite3.Error:
        return None
    finally:
        conn.close()
    return r[0] if r else None


def picks_id(harness: Optional[str]) -> bool:
    """Whether `harness` picks its session's id itself, at its first call (harness_kit's `picks_session_id`: codex's
    thread, agy's conversation): a session started here is kept under one of ours all the same (`ag --channel`), its
    harness's own id named by that call (`own_id`)."""
    h = harness_kit.get(harness)
    return bool(h and h.picks_session_id)


def _headless_of(harness: Optional[str]) -> Optional[str]:
    """How `harness` runs headless (harness_kit's `headless`: "session", "turn"), None where it cannot: a message to a
    session of it then opens its terminal, whatever `chat_mode` says."""
    h = harness_kit.get(harness)
    return h.headless if h is not None else None


def takes_back(harness: Optional[str]) -> bool:
    """Whether `harness`, stopped (Esc) before any of its answer came, puts the message back in its message box
    (harness_kit's `esc_takes_back`): `took_back` then asks whether it has."""
    h = harness_kit.get(harness)
    return bool(h and h.esc_takes_back)


def _session_harness(gatherer: str, session_id: str) -> str:
    """The harness a session of the gatherer runs on, as its hook recorded it (data.py's `harness_of`): harness_kit's
    DEFAULT when none says."""
    from .data import harness_of        # data imports this module: asked here, once it is loaded
    got = harness_of(gatherer, session_id)
    return got if got in HARNESSES else harness_kit.DEFAULT


def _named_id(gatherer: str, channel: str) -> Optional[str]:
    """The harness's own id for the session kept in `channel` under another (`ag --channel`), as the newest of its
    turns' calls recorded it (its `model_call`'s `session`); None: none named (one kept under its own id, or no call
    yet)."""
    conn = store.gatherer(gatherer)
    if conn is None:
        return None
    try:
        row = conn.execute(
            "SELECT json_extract(e.payload_json, '$.session') FROM events e WHERE ifnull(e.p_channel, '') = ? "
            "AND e.event_type_id = (SELECT event_type_id FROM event_types WHERE name = 'model_call') "
            "AND json_extract(e.payload_json, '$.session') IS NOT NULL ORDER BY e.row_id DESC LIMIT 1", (channel,)).fetchone()
    except sqlite3.Error:                        # a gatherer from before events
        return None
    finally:
        conn.close()
    return row[0] if row else None


def channel_args(s: dict) -> List[str]:
    """ag's options naming the channel the session `s` (a row) is kept in (`ag --channel`): for a harness that picks its
    session's id only at its first call (codex's thread, agy's conversation), the session's id, from that call on; none
    for one that is given its id (Claude Code's --session-id), which is the channel already."""
    return ["--channel", s["session_id"]] if picks_id(s.get("harness")) else []


def own_id(s: dict) -> str:
    """The harness's own id for the session `s` (a row of the table) -- what it is resumed, renamed and found by in the
    harness's own records: `harness_id` where its first call named it (codex's thread, agy's conversation, kept under
    the session's id: `ag --channel`), as the gatherer has it where the row does not yet; else the session's id."""
    if s.get("harness_id"):
        return s["harness_id"]
    return (picks_id(s.get("harness")) and _named_id(s["gatherer"], s["session_id"])) or s["session_id"]


def _why(session_id: str) -> Optional[str]:
    """What ag said last, in the session's log ("ag: ..."): why its process ended, if it said."""
    try:
        with open(log_path(session_id), encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()[-200:]
    except OSError:
        return None
    said = [l.strip()[4:] for l in lines if l.startswith("ag: ")]
    return said[-1] if said else None


def _launch(s: dict) -> str:
    """The group the session's process starts under: its own, or, an actor on its own, the one it left (groups.py)."""
    from . import groups                              # here: groups.py imports this module
    return groups.launch_group(s["session_id"], s["gatherer"])


def ag_command() -> List[str]:
    """How ag is run: AG_COMMAND (split as a shell would), else `ag` on the PATH."""
    given = os.environ.get("AG_COMMAND")
    if given:
        return shlex.split(given)
    found = shutil.which("ag")
    if not found:
        raise SessionError("no `ag` on the PATH to run the agent with (set AG_COMMAND)")
    return [found]


def agent_env(environ: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """The environment an agent runs in: the dashboard's, less what says the dashboard runs inside
    a Claude Code session -- that session's own variables, and its API pointed at a hook server ag
    started, which ag refuses to hook again -- and with the dashboard's home as ag's."""
    env = {k: v for k, v in (os.environ if environ is None else environ).items() if k not in PARENT_SESSION}
    url = env.get("ANTHROPIC_BASE_URL")
    if url:
        parts = urlsplit(url)
        ports = {s.get("port") for s in home.hook_servers()}
        if parts.hostname in ("127.0.0.1", "localhost") and (parts.port in ports or "/h/" in parts.path):
            env.pop("ANTHROPIC_BASE_URL")
    env["AG_HOME"] = home.HOME
    return env


def actor_env(s: dict, env: Dict[str, str]) -> Dict[str, str]:
    """`env` for the session `s` (a row of the table) to run in: who it is (ACTOR_VAR: the id it was started under --
    a codex session's before its thread had one, which coordination.py knows it by) and the dashboard that runs it."""
    return {**env, ACTOR_VAR: s.get("started_as") or s["session_id"], **({DASHBOARD_VAR: DASHBOARD} if DASHBOARD else {})}


def instructions(s: dict) -> Optional[str]:
    """What the session `s` (a row of the table) is told besides its harness's own instructions, on every run: its
    role's (coordination.py); None for an actor like any other."""
    if s.get("role") != COORDINATOR:
        return None
    from . import coordination                  # it runs sessions: asked here, once both are loaded
    return coordination.instructions(s["gatherer"], s.get("over"), s["session_id"])


def extra_args(s: dict) -> List[str]:
    """What a session's harness is started with besides its own options: what the tool gateway gives it
    (tool_gateway.py's `launch_args`: its gatherer's apps' tools, those of the apps it is attached to, their
    instructions and guard)."""
    from . import tool_gateway                  # here: the gateway uses this module
    return tool_gateway.launch_args(s)


def known_role(role: str) -> bool:
    """Whether `role` is one a session may have: one of ROLES, or an app's actor's (app_agents.py's `role_of`): the
    actor an app started, {"app": name, "key": instance}, or one from before it was an app, {"<name>": key}."""
    if role in ROLES:
        return True
    from . import app_agents
    return app_agents.role_of({"role": role}) is not None


def login_shell() -> str:
    """The user's shell: $SHELL, else the one their account names, else /bin/sh -- the first that can be run."""
    try:
        theirs = pwd.getpwuid(os.getuid()).pw_shell
    except (KeyError, NameError):
        theirs = ""
    for program in (os.environ.get("SHELL"), theirs, "/bin/sh"):
        if program and os.path.isabs(program) and os.access(program, os.X_OK):
            return program
    raise SessionError("no shell to run: set SHELL")


def new_gatherer(name: str) -> dict:
    """A new gatherer named `name`, made by `ag new` with ag's default policy and pollers: {name}.
    Refused when one has the name already."""
    name = (name or "").strip()
    if not GATHERER.fullmatch(name):
        raise SessionError("a gatherer name can only contain letters, digits, '.', '_' and '-'")
    if os.path.isdir(home.gatherer_dir(name)):
        raise SessionError(f"there is a gatherer {name} already")
    try:
        done = subprocess.run([*ag_command(), "new", name], env=agent_env(), capture_output=True, text=True,
                              timeout=60, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError) as exc:
        raise SessionError(f"could not run ag: {exc}") from exc
    if done.returncode != 0:
        raise SessionError((done.stderr or done.stdout).strip() or f"ag new exited {done.returncode}")
    return {"name": name}


def available(environ: Optional[Dict[str, str]] = None) -> List[str]:
    """The harnesses a new session can run on here, of HARNESSES: those ag's config.toml has an entry for
    ([cli.harnesses.<name>]; every one, before ag first wrote its [cli]) whose command is on the PATH --
    the agent's, or the one the entry's own env sets."""
    try:
        import tomllib
        with open(os.path.join(home.HOME, "config.toml"), "rb") as fh:
            cli = tomllib.load(fh).get("cli")
    except FileNotFoundError:
        cli = None
    except (OSError, ValueError):                 # unreadable, or not TOML: ag runs none
        return []
    entries = {name: {} for name in HARNESSES} if not isinstance(cli, dict) else cli.get("harnesses")
    path = agent_env(environ).get("PATH")
    found = []
    for name in HARNESSES:
        entry = entries.get(name) if isinstance(entries, dict) else None
        if not isinstance(entry, dict):
            continue
        command = entry.get("command") or [name]
        command = [command] if isinstance(command, str) else command
        env = entry.get("env") if isinstance(entry.get("env"), dict) else {}
        where = env.get("PATH") or path
        if isinstance(command, list) and command and shutil.which(os.path.expanduser(str(command[0])),
                                                                   path=os.path.expanduser(str(where)) if where else None):
            found.append(name)
    return found


def chat_mode() -> str:
    """What a message opens for a session with no terminal open, of CHAT_MODES: the home's config.toml's
    `[dashboard] chat`; "terminal" when it says none (or none of them), or cannot be read -- and always
    "headless" where there are no terminals (TERMINALS)."""
    if not TERMINALS:
        return "headless"
    try:
        import tomllib
        with open(os.path.join(home.HOME, "config.toml"), "rb") as fh:
            dashboard = tomllib.load(fh).get("dashboard")
    except (OSError, ValueError):
        return "terminal"
    mode = dashboard.get("chat") if isinstance(dashboard, dict) else None
    return mode if mode in CHAT_MODES else "terminal"


def trusts_folders() -> bool:
    """Whether a session's terminal starts with its folder trusted, so its harness does not first ask there whether to
    trust it (harness_kit's `trust`): the home's config.toml's `[dashboard] trust_folders`, true unless it says false
    (or the file cannot be read)."""
    try:
        import tomllib
        with open(os.path.join(home.HOME, "config.toml"), "rb") as fh:
            dashboard = tomllib.load(fh).get("dashboard")
    except (OSError, ValueError):
        return True
    return not (isinstance(dashboard, dict) and dashboard.get("trust_folders") is False)


_models: Dict[str, dict] = {}           # harness -> {"at": when asked, "models": [...]}
MODELS_KEEP = 600                       # how long a harness's list of models is kept before it is asked again


def models(harness: str) -> dict:
    """The models a new session of `harness` can run on, as the harness says (harness_kit's `models`): {"models":
    [{slug, name, description}], "default": the one its config names, if any}. Codex's from its catalog; none for
    Claude Code, which runs its own default. Kept MODELS_KEEP once a harness has listed some."""
    h = harness_kit.get(harness)
    if h is None:
        return {"models": [], "default": None}
    kept = _models.get(harness)
    if kept and time.time() - kept["at"] < MODELS_KEEP:
        return kept["value"]
    value = h.models({**agent_env(), **entry_env(harness)})
    if value.get("models"):
        _models[harness] = {"at": time.time(), "value": value}
    return value


def entry_env(harness: str) -> Dict[str, str]:
    """The environment ag's config.toml sets for `harness` alone ([cli.harnesses.<name>] env: agy's GEMINI_API_KEY),
    {} where it sets none: what the harness lists its models with, as ag runs it."""
    try:
        import tomllib
        with open(os.path.join(home.HOME, "config.toml"), "rb") as fh:
            entry = ((tomllib.load(fh).get("cli") or {}).get("harnesses") or {}).get(harness)
    except (OSError, ValueError, AttributeError):
        return {}
    env = entry.get("env") if isinstance(entry, dict) else None
    return {str(k): os.path.expanduser(str(v)) for k, v in env.items()} if isinstance(env, dict) else {}


def _unsaid(argv: List[str], told: Optional[str]) -> List[str]:
    """`argv` as its log line has it: a role's instructions (`told`) named, not written out."""
    hidden = (told, json.dumps(told)) if told else ()                  # as given, or as codex's `-c` value has it
    return [a if not any(h in a for h in hidden) else "<the instructions of its role>" for a in argv]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _note(t: "_Term", line: str) -> None:
    """A line of the dashboard's own in a terminal's log (log_path), as its start and end are written; none once its
    reader has closed the log, at the terminal's end."""
    try:
        t.log.write(f"--- {_now()} {line}\n")
    except (OSError, ValueError):
        pass


class _Agent:
    """One session's running process and what waits for it."""

    def __init__(self, proc: subprocess.Popen, log):
        self.proc, self.log = proc, log
        self.since = time.time()        # when it started: what Claude Code started in the background before was not its
        self.busy = False               # a turn was sent and its result has not come back
        self.yielding = False           # between turns: gives way to another process opening the session
        self.taken = False              # another process took the session over: it is being stopped
        self.ended = False              # the page ended it (`stop`), whatever it was doing
        self.kept = False               # put away (`put_away`): its end is kept, and a message meanwhile waits for the next
        self.queue: List[str] = []      # messages waiting for the turn to end
        self.reader: Optional[threading.Thread] = None


def took_back(gatherer: str, channel: str, stopped: float) -> bool:
    """Whether Claude Code has put the message it was stopped on back in its input box, untouched: its newest call
    was hung up on before the answer came (the hook server's HUNG_UP), and the last thing typed into its terminal was
    the key that stopped it (`stopped`, its time; 0: something else was), after the call before that one -- in this
    turn. (Not after the stopped call's own read: ag may still have been reading for it.) Not where the call took no
    message back: one later in a turn, or one Claude Code's record says it kept, the turn interrupted once its answer had
    begun (data.py's `withdrawn_reads`)."""
    if not stopped:
        return False
    from . import data                                 # data imports this module
    conn = store.gatherer(gatherer)
    if conn is None:
        return False
    try:                                               # the hang-up as ag kept it on the read, or the hook's `call_failed`
        last = data._newest_reads(conn, channel, 2) or []
        if not last or last[0]["error_status"] != data.HUNG_UP:
            return False
        if len(last) > 1 and (data._seconds(last[1]["read_at"]) or 0) >= stopped:
            return False
        read = last[0]["read_id"]
        got = data.withdrawn_reads(conn, channel, data._tables(conn), data.interrupts(data.record_of(conn, channel)),
                                   read).get(read)
        return got is None or (bool(got["said"]) and not got["kept"])    # none withdrawn: not known, as before
    except sqlite3.Error:
        return False
    finally:
        conn.close()


class _Term:
    """One session's terminal: the process in its pseudo-terminal, and what it printed."""

    def __init__(self, pid: int, fd: int, log, fullscreen: bool = False, cols: int = 0, rows: int = 0):
        self.pid, self.fd, self.log, self.fullscreen = pid, fd, log, fullscreen
        self.since = time.time()        # when it started
        self.out = bytearray()          # the last TERM_KEEP bytes it printed
        self.end = 0                    # how many it printed in all: `out` ends there
        self.exited: Optional[int] = None
        self.changed = threading.Condition()
        self.reader: Optional[threading.Thread] = None
        self.typed = 0.0                # when anything was last typed into it (epoch seconds): keys, a message
        self.stopped = 0.0              # when the last thing typed was a key that stops a turn alone (STOP_KEYS); 0: it was not
        self.answering = False          # an answer's keys being typed into it (`answer`)
        self.keying = 0.0               # until when a message the dashboard pastes goes into it (`_paste`)
        self.pasted = 0.0               # when it last pasted one: a stop key waits until the harness has taken it (`type`)
        self.prompted = 0.0             # when it was started with its first message on its command line (`terminal`): a
        #                                 stop key waits until the harness has begun that turn (`_unsent`)
        self.harness: Optional[str] = None   # the session's harness and gatherer, as it was started
        self.gatherer: Optional[str] = None
        self.boxed: Optional[str] = None     # its message box as last seen after a stop key (`_read_terminal`)
        self.shown: Optional[dict] = None    # the permission dialog its screen shows (`_watch_shown`), and `since` --
        #                                      or, as it starts, a menu of its harness's (`menu`)
        self.ready = False              # its message box seen with the keys READY_SECONDS on end: started (`_watch_ready`)
        self.box_seen = 0.0             # since when its message box has had the keys, until then; 0: it has not now
        self.prompt: Optional[str] = None    # the message it was started with (`terminal`)
        self.restart = False            # started again once it ends, as its harness ends to update itself (`_pick`)
        self.drafted = 0                # characters the reader typed into its input box and has not sent (`drafted`)
        self.kept = False               # put away (`put_away`): its end is kept
        self.drawn = -1                 # where in what it printed it last cleared its screen (CLEARED), to draw it all
        self.sizing = threading.Lock()  # its size set by one at a time: the page's (`resize`), or `redraw`'s
        self.redrawing = False          # `redraw` at it
        self.screen = Screen(cols, rows) if cols and rows else None   # its screen as what it printed draws it (`_box`):
        self.screen_lock = threading.Lock()                           # a harness's terminal's, fed by its reader
        self.fd_lock = threading.Lock()  # its fd used (`use_fd`) or closed by one at a time
        self.closed = False              # its fd closed, by its reader once its process has ended

    def use_fd(self, act: Callable[[int], Any]) -> Any:
        """act(fd): what it returns -- while the terminal is open. Once its reader has closed it, an OSError, and act not
        called: the number is free then, and the next file or socket opened takes it, which a late write (a paste's
        Enter, typed a moment after) or a resize would reach instead. Under `fd_lock`, which the reader closes it under."""
        with self.fd_lock:
            if self.closed:
                raise OSError(errno.EBADF, "the terminal is gone")
            return act(self.fd)


class Sessions:
    """The sessions started from the page, and their agents. Thread-safe: the server's handlers
    share one. `on_change(gatherer, session_id)` is told each time a session's state changes (the
    server rings its streams with it)."""

    def __init__(self, on_change: Optional[Callable[[str, str], None]] = None):
        self.on_change = on_change
        self.lock = threading.RLock()
        self.agents: Dict[str, _Agent] = {}
        self.terms: Dict[str, _Term] = {}         # by session id; a shell's by its own (`shell`)
        self._shells: Dict[str, dict] = {}       # the shells open, by id: {id, gatherer, cwd, since}
        self.answered: Dict[str, dict] = {}      # each session's last answer typed from the page (`answer`)
        self.renames: Dict[str, str] = {}        # each session's command naming it, held for its turn's end (`rename`)
        self.sent: Dict[str, List[dict]] = {}    # each session's latest messages from Chat ({cid, text, at}), kept as each
        #                                          came, before it was typed: Chat's view (chat_view.py) knows them at once
        self.closing = False            # the dashboard stopping: what ends now is kept
        conn = self._db()               # a process from before is gone: what it was running stopped, and kept
        try:
            conn.execute("UPDATE sessions SET status = 'stopped', kept = ? "
                         "WHERE status IN ('starting', 'running', 'idle', 'terminal')", (time.time(),))
        finally:
            conn.close()

    def _db(self) -> sqlite3.Connection:
        return store.write("sessions", rows=True)

    def _row(self, session_id: str) -> Optional[dict]:
        conn = self._db()
        try:
            r = conn.execute(f"SELECT {', '.join(COLUMNS)} FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
            return dict(r) if r else None
        finally:
            conn.close()

    def set_role(self, session_id: str, role: Optional[str]) -> None:
        """An app's actor whose instance another app took over (app_agents.py's `adopt_all`): its role, that app's."""
        self._set(session_id, role=role)

    def _set(self, session_id: str, **values) -> None:
        conn = self._db()
        try:
            conn.execute(f"UPDATE sessions SET {', '.join(k + ' = ?' for k in values)} WHERE session_id = ?",
                         (*values.values(), session_id))
            row = conn.execute("SELECT gatherer FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
        finally:
            conn.close()
        if row is not None:
            self._changed(row["gatherer"], session_id)

    def _changed(self, gatherer: str, session_id: str) -> None:
        if self.on_change is not None:
            try:
                self.on_change(gatherer, session_id)
            except Exception:  # noqa: BLE001 - a listener's trouble is not the session's
                pass

    def own(self, session_id: str) -> str:
        """The harness's own id for the session (`own_id`): the session's id for one the table does not have."""
        s = self._row(session_id)
        return self._own(s) if s is not None else session_id

    def _own(self, s: dict) -> str:
        """The harness's own id for the session `s` (a row), `own_id` -- kept as its `harness_id` once the gatherer
        names it, where the row had none."""
        got = own_id(s)
        if got != s["session_id"] and not s.get("harness_id"):
            self._set(s["session_id"], harness_id=got)
        return got

    def chat_row(self, session_id: str) -> Optional[dict]:
        """What Chat's view (chat_view.py) takes of a session the table has: {ended, queued (its messages waiting), sent
        (its latest messages from Chat, as each came), stopped_at (when a key that stops a turn was the last typed into
        its terminal; None: something else was), box (since then, what its message box shows: a Box, or None), shown (the
        permission dialog its terminal shows: `_watch_shown`), harness} -- None for one it does not have."""
        s = self._row(session_id)
        if s is None:
            return None
        with self.lock:
            a, t = self.agents.get(session_id), self.terms.get(session_id)
        got = {"ended": s.get("ended") or 0, "queued": list(a.queue) if a else [], "sent": list(self.sent.get(session_id, ())),
               "stopped_at": (t.stopped or None) if t else None, "box": None, "shown": t.shown if t else None,
               "harness": s.get("harness")}
        if t is not None and t.stopped:                  # what its box shows since the stop key, as its screen has it
            got["box"] = self._box(t, s["harness"])
        return got

    def list(self) -> List[dict]:
        """Every session the table has, newest first, each with `queued` (its messages waiting), `pid` (the
        dashboard's process for it), `since` (when that started), `terminal` (whether that is a terminal) and
        `fullscreen` (whether it runs Claude Code's full screen), `answer` (the last answer typed from the page,
        `answer`), `typed` (when anything was last typed into its terminal) and `stopped_at` (when what was last typed
        there was a key that stops a turn alone; None: something else was -- after its call before, its message taken
        back is still in Claude Code's input box untouched: data.py's `taken_back`'s `since`, `took_back`) and `sent` (its
        latest messages from Chat, {cid, text, at}, as each came: `send`)."""
        with self.lock:
            out = []
            for s in stored():
                a, t = self.agents.get(s["session_id"]), self.terms.get(s["session_id"])
                out.append({**s, "queued": list(a.queue) if a else [], "terminal": t is not None,
                            "answer": self.answered.get(s["session_id"]), "typed": t.typed if t else None,
                            "stopped_at": (t.stopped or None) if t else None, "shown": t.shown if t else None,
                            "fullscreen": bool(t and t.fullscreen), "pid": t.pid if t else a.proc.pid if a else None,
                            "since": t.since if t else a.since if a else None,
                            "sent": list(self.sent.get(s["session_id"], ()))})
            return out

    def create(self, gatherer: str, cwd: str, permission_mode: str = "auto", harness: str = harness_kit.DEFAULT,
               model: Optional[str] = None, role: Optional[str] = None, alone: bool = False,
               over: Optional[str] = None) -> dict:
        """A new session of `harness` in `gatherer` (a new gatherer if none has the name), to run in `cwd`
        on `model` (None: the harness's default), for `role` (`known_role`; None: an actor like any other). Its agent starts
        with its first message. `alone`: listed on its own, its row's group its group of one (`self:<its id>`), run under
        `gatherer` -- its `group` record is the caller's to write (groups.py's `start_alone`). `over`: a coordinator
        agent's node (coordinators.py)."""
        gatherer = (gatherer or "").strip()
        if not GATHERER.fullmatch(gatherer):
            raise SessionError("a gatherer name can only contain letters, digits, '.', '_' and '-'")
        cwd = os.path.abspath(os.path.expanduser((cwd or "").strip() or "."))
        if not os.path.isdir(cwd):
            raise SessionError(f"no directory {cwd}")
        if permission_mode not in PERMISSION_MODES:
            raise SessionError(f"permission mode {permission_mode!r}: one of {', '.join(PERMISSION_MODES)}")
        if harness not in HARNESSES:
            raise SessionError(f"harness {harness!r}: one of {', '.join(HARNESSES)}")
        model = (model or "").strip() or None
        if model and not re.fullmatch(r"[A-Za-z0-9._:/@-]+", model):
            raise SessionError(f"{model!r} isn't a valid model name")
        if role is not None and not known_role(role):
            raise SessionError(f"role {role!r}: one of {', '.join(ROLES)}, or an app's actor's ({{\"app\": ..., \"key\": ...}})")
        session_id = str(uuid.uuid4())
        conn = self._db()
        try:
            _insert(conn, session_id=session_id, gatherer=ALONE + session_id if alone else gatherer, harness=harness,
                    cwd=cwd, permission_mode=permission_mode, created_at=_now(), status="stopped", model=model, role=role,
                    over=over)
        finally:
            conn.close()
        self._changed(ALONE + session_id if alone else gatherer, session_id)
        return self._row(session_id)

    def adopt(self, gatherer: str, session_id: str) -> dict:
        """A session of `gatherer` not started here, taken into the table so the page can message it:
        resumed in the directory its calls named, permissions auto. The one there already, if it is."""
        if not GATHERER.fullmatch(gatherer or "") or not SESSION_ID.fullmatch(session_id or ""):
            raise SessionError("not a session of a gatherer")
        with self.lock:
            s = self._row(session_id)
            if s is not None:
                return s
            cwd = _session_cwd(gatherer, session_id)
            if not cwd or not os.path.isdir(cwd):
                raise SessionError(f"can't resume session {session_id}: its directory is missing"
                                   + (f" ({cwd})" if cwd else ""))
            conn = self._db()
            try:
                _insert(conn, session_id=session_id, gatherer=gatherer, harness=_session_harness(gatherer, session_id),
                        cwd=cwd, permission_mode="auto", created_at=_now(), turns=1, status="stopped")
            finally:
                conn.close()
            self._changed(gatherer, session_id)
            return self._row(session_id)

    def send(self, session_id: str, text: str, cols: int = 120, rows: int = 32, fullscreen: bool = False,
             cid: Optional[str] = None) -> dict:
        """The message to the session: typed into its terminal, if one is open -- only into its message box, empty: refused
        (NotAtBox) while a dialog, a menu, a question or a permission it asks has the keys, or while something typed
        there is not sent (`_at_box`); else, as `chat_mode` says, its
        terminal opened (`cols` x `rows`, `fullscreen` as `terminal` takes it) with the message its first
        prompt, or a turn of its agent -- now, or, while one runs, after it -- the agent started if it is not
        running. A turn of the agent's running or waiting takes it in either mode. The session as `list` has it;
        the message kept in its gatherer as sent from Chat (actions.py's `chat_sent`). `cid`: the send's id,
        as the page that sent it knows it (one made here if none): kept with it, before it is typed (`sent`), and with
        `chat_sent` -- Chat's view tells the message it became by it."""
        sent = {"cid": str(cid or f"chat:{uuid.uuid4().hex}")[:80], "text": (text or "").strip(), "at": time.time()}
        if sent["text"] and not sent["text"].startswith("/"):
            with self.lock:
                kept = self.sent.setdefault(session_id, [])
                kept.append(sent)
                del kept[:-SENT_KEPT]
            row = self._row(session_id)
            if row is not None:                  # Chat's view has it at once
                self._changed(row["gatherer"], session_id)
        try:
            got = self._send(session_id, text, cols, rows, fullscreen)
        except Exception:
            with self.lock:                      # not sent: not kept
                kept = self.sent.get(session_id, [])
                if sent in kept:
                    kept.remove(sent)
            raise
        text, sid = sent["text"], got.get("session_id")
        if sid != session_id:
            with self.lock:
                for x in self.sent.pop(session_id, []):
                    self.sent.setdefault(sid, []).append(x)
        actions.chat_sent(got.get("gatherer"), sid, text, sent["at"], sent["cid"])
        return got

    def _send(self, session_id: str, text: str, cols: int, rows: int, fullscreen: bool) -> dict:
        text = (text or "").strip()
        if not text:
            raise SessionError("the message is empty")
        t = self.terms.get(session_id)
        if t is not None and t.kept:                 # its terminal being put away: once it has ended, a process of its own
            self._gone(t)
        with self.lock:
            a = self.agents.get(session_id)
            s = self._row(session_id)
            opens = session_id not in self.terms and s is not None and (chat_mode() == "terminal" or not _headless_of(s["harness"])) \
                and not (a is not None and a.proc.poll() is None and (a.busy or a.queue))
        if opens:                                    # outside the lock: an idle agent's end is recorded by its reader
            return self.terminal(session_id, cols, rows, fullscreen, prompt=text)
        t, s = self.terms.get(session_id), self._row(session_id)    # its terminal, open: typed only into its message box
        clear = self._at_box(s, t) if t is not None and t.exited is None and s is not None else None   # (outside the lock:
                                                                                                # it may wait on its screen)
        with self.lock:
            s = self._row(session_id)
            if s is None:
                raise SessionError(f"no session {session_id} started from the dashboard")
            if session_id in self.terms:             # its terminal has it: typed there
                t = self.terms[session_id]
                if clear is None:
                    clear = takes_back(s["harness"]) and took_back(s["gatherer"], session_id, t.stopped)
                self._paste(t, text, clear=clear)
                return next(x for x in self.list() if x["session_id"] == session_id)
            a = self.agents.get(session_id)
            if _headless_of(s["harness"]) == "turn":     # a process per turn: this one now, or after the one running
                if a is not None and a.proc.poll() is None:
                    a.queue.append(text)
                    self._changed(s["gatherer"], session_id)
                else:
                    held = holder(s["gatherer"], session_id) if s["turns"] else None
                    if held is not None:
                        raise SessionError(f"the session is open in another process ({held['pid']}). Close it there first.")
                    self._exec(s, text)
                return next(x for x in self.list() if x["session_id"] == s["session_id"] or x["session_id"] == session_id)
            if a is not None and a.kept and a.proc.poll() is None:   # being put away: the process after it takes it
                a.queue.append(text)
                self._changed(s["gatherer"], session_id)
                return next(x for x in self.list() if x["session_id"] == session_id)
            if a is not None and a.taken:
                raise SessionError("another process took over the session. Close it there first.")
            if a is None or a.proc.poll() is not None:
                held = holder(s["gatherer"], session_id)
                if held is not None:
                    raise SessionError(f"the session is open in another process ({held['pid']}). Close it there first.")
                a = self._start(s)
            a.queue.append(text)
            if not a.busy:
                self._next(session_id, a)
            else:
                self._changed(s["gatherer"], session_id)        # it waits: shown as waiting
            return next(x for x in self.list() if x["session_id"] == session_id)

    def stop(self, session_id: str) -> dict:
        """The session's agent ended: its stdin closed, so it exits and the session shows Closed until
        the next message resumes it; a kept session with no process is closed so at once, and so is one that ran
        and has no process now (its end recorded now: `ended`), unless a process outside has it open. In the middle
        of a turn, the turn is cut off (its process group terminated) and what waits is dropped. A terminal is closed as a terminal window is: hung up,
        whatever it was doing, and its end recorded before this returns, so the session can be opened
        again straight away. The session as `list` has it."""
        with self.lock:
            s = self._row(session_id)
            if s is None:
                raise SessionError(f"no session {session_id} started from the dashboard")
            t = self.terms.get(session_id)
            if t is not None:
                self._hang_up(t)
            a = self.agents.get(session_id)
            if t is None and s["kept"] and (a is None or a.proc.poll() is not None):
                self._set(session_id, kept=0, ended=s["kept"])   # kept, with no process: closed now, as asked
                return next(x for x in self.list() if x["session_id"] == session_id)
            if t is None and s["turns"] and (a is None or a.proc.poll() is not None):
                # one that ran, with no process of the dashboard's now -- listed Idle all the same, used since it
                # ended (an app's note to it, say): closed now, as asked, unless a process outside has it open
                held = holder(s["gatherer"], session_id)
                if held is not None:
                    raise SessionError(f"the session is open in another process ({held['pid']}). Close it there.")
                self._set(session_id, ended=time.time())
                return next(x for x in self.list() if x["session_id"] == session_id)
        if t is not None:                            # its end recorded by its reader, which takes the lock
            self._gone(t)
            with self.lock:
                return next(x for x in self.list() if x["session_id"] == session_id)
        with self.lock:
            a = self.agents.get(session_id)
            if a is None or a.proc.poll() is not None:
                raise SessionError("the dashboard has no process open for this session")
            a.ended = True
            a.queue.clear()
            try:
                a.proc.stdin.close()             # the reader records its end: stopped
            except (OSError, ValueError):
                pass
            if a.busy:                           # mid-turn: it would finish the turn first
                try:
                    end_group(a.proc.pid)
                except OSError:
                    pass
            return next(x for x in self.list() if x["session_id"] == session_id)

    def discard(self, session_id: str) -> None:
        """A session that never started, forgotten (module doc): its row deleted, and the dashboard's rows of it as an
        actor (store.discard_actor). Refused while a process of the dashboard's runs for it, or a message waits for one, and
        once a turn of it has ended; that its gatherer has no conversation of it is the caller's to tell (data.py's
        `has_conversation`)."""
        with self.lock:
            s = self._row(session_id)
            if s is None:
                raise SessionError(f"no session {session_id} started from the dashboard")
            a = self.agents.get(session_id)
            if session_id in self.terms or (a is not None and (a.proc.poll() is None or a.queue)) \
                    or s["status"] in ("starting", "running", "idle", "terminal"):
                raise SessionError("it's running. Close it first.")
            if s["turns"]:
                raise SessionError("it has already had a turn. Close it instead.")
            with store.transaction("sessions") as conn:  # its row and every one kept of it as an actor; a task it
                store.discard_actor(conn, s["gatherer"], session_id)   # was one of two in, gone
            for kept in (self.agents, self.answered, self.renames, self.sent):
                kept.pop(session_id, None)
        self._changed(s["gatherer"], session_id)

    def put_away(self, session_id: str, before: float) -> bool:
        """The session's process ended as the dashboard's own end ends it, its end KEPT (module doc) -- shown
        Idle, and resumed by its next message or terminal -- if nothing was done with it since `before`: not
        started since, nothing typed into its terminal, no answer being typed into it, no turn of its agent's
        running or waiting. Whether it was put away; a terminal's end is recorded before this returns. Which
        processes, and when, is saved.py's (`Rest`)."""
        with self.lock:
            t, a = self.terms.get(session_id), self.agents.get(session_id)
            if t is not None:
                if t.answering or t.since >= before or t.typed >= before:
                    return False
                t.kept = True
                t.log.write(f"--- {_now()} put away\n")
                self._hang_up(t)
            elif a is not None and a.proc.poll() is None and a.since < before \
                    and not (a.busy or a.queue or a.ended or a.taken or a.kept):
                a.kept = True
                a.log.write(f"--- {_now()} put away\n")
                try:
                    a.proc.stdin.close()             # idle: it exits, and its reader records the end
                except (OSError, ValueError):
                    pass
            else:
                return False
        if t is not None:                            # its end recorded by its reader, which takes the lock
            self._gone(t)
        return True

    def _headless(self, s: dict, resume: bool) -> List[str]:
        """ag's command line that runs the session headless, as its harness says (harness_kit's `headless_args`)."""
        h = harness_kit.get(s["harness"])
        if h is None or not h.headless:
            raise SessionError(f"{s['harness']} has no headless mode. Open it in a terminal.")
        return [*ag_command(), "--gatherer", _launch(s), *channel_args(s), s["harness"],
                *h.headless_args(self._own(s), resume=resume, model=s.get("model"), permission_mode=s["permission_mode"],
                                 instructions=instructions(s), extra=tuple(extra_args(s)))]

    def _start(self, s: dict) -> _Agent:
        """A session's agent run headless, one process for the session (its harness's `headless` "session"): each
        message a line on its stdin (`_next`), each turn's end an event on its stdout (`_read`)."""
        sid = s["session_id"]
        told = instructions(s)
        argv = self._headless(s, resumes(s))
        os.makedirs(os.path.dirname(log_path(sid)), exist_ok=True)
        log = open(log_path(sid), "a", encoding="utf-8", buffering=1)
        log.write(f"--- {_now()} {shlex.join(_unsaid(argv, told))}\n")
        try:
            proc = subprocess.Popen(argv, cwd=s["cwd"], env=actor_env(s, agent_env()), stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE, stderr=log, text=True, bufsize=1, start_new_session=True)
        except OSError as exc:
            log.close()
            self._set(sid, status="failed", last_error=f"could not run ag: {exc}")
            raise SessionError(f"could not run ag: {exc}") from exc
        a = _Agent(proc, log)
        self.agents[sid] = a
        self._set(sid, status="starting", last_error=None, kept=0)
        a.reader = threading.Thread(target=self._read, args=(sid, a), daemon=True)
        a.reader.start()
        return a

    def _exec(self, s: dict, text: str) -> _Agent:
        """A turn of a harness run headless a process per turn (its `headless` "turn": `codex exec`), the message on its
        stdin (the lock held)."""
        sid = s["session_id"]
        told = instructions(s)
        argv = self._headless(s, resumes(s))
        h = harness_kit.get(s["harness"])
        os.makedirs(os.path.dirname(log_path(sid)), exist_ok=True)
        log = open(log_path(sid), "a", encoding="utf-8", buffering=1)
        log.write(f"--- {_now()} {shlex.join(_unsaid(argv, told))}\n")
        try:
            proc = subprocess.Popen(argv, cwd=s["cwd"], env=actor_env(s, agent_env()), stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE, stderr=log, text=True, bufsize=1, start_new_session=True)
        except OSError as exc:
            log.close()
            self._set(sid, status="failed", last_error=f"could not run ag: {exc}")
            raise SessionError(f"could not run ag: {exc}") from exc
        a = _Agent(proc, log)
        a.busy = True
        self.agents[sid] = a
        try:
            proc.stdin.write(h.headless_message(text))
            proc.stdin.close()
        except OSError:
            pass
        self._set(sid, status="running", last_error=None, kept=0)
        a.reader = threading.Thread(target=self._read_exec, args=(sid, a), daemon=True)
        a.reader.start()
        return a

    def _read_exec(self, session_id: str, a: _Agent) -> None:
        """A turn's output, until its process exits, as its harness reads it (`headless_event`): the harness's own id for
        the session (codex's thread: kept as its `harness_id`), its end, an error; then the next waiting message, as a
        turn of its own."""
        h = harness_kit.get((self._row(session_id) or {}).get("harness"))
        error = None
        done = False
        for line in a.proc.stdout:
            a.log.write(line)
            try:
                event = json.loads(line)
            except ValueError:
                continue
            got = (h.headless_event(event) if h is not None else None) or {}
            if got.get("session") and got["session"] != session_id \
                    and (self._row(session_id) or {}).get("harness_id") != got["session"]:
                self._set(session_id, harness_id=got["session"])
            if got.get("ended"):
                done = True
            if got.get("error"):
                error = got["error"]
        code = a.proc.wait()
        try:
            a.proc.stdout.close()
        except OSError:
            pass
        with self.lock:
            a.log.write(f"--- {_now()} exited {code}\n")
            a.log.close()
            session_id = next((k for k, v in self.agents.items() if v is a), session_id)
            if self.agents.get(session_id) is a:
                del self.agents[session_id]
            s = self._row(session_id)
            if s is None:
                return
            if done or error:
                s["turns"] += 1 if done else 0
            ok = done and not error
            self._set(session_id, turns=s["turns"], status="stopped" if ok or a.ended else "failed",
                      **({"ended": time.time()} if a.ended else      # a turn's own end leaves it ready, not closed:
                         {"kept": time.time()} if ok else {}),       # Idle, though its process is gone
                      **({} if ok or a.ended else {"last_error": error or _why(session_id) or
                                                   f"{h.label if h else 'the agent'} exited ({code}); see {log_path(session_id)}"}))
            if a.queue and not a.ended and not self.closing:     # what was sent meanwhile: the next turn
                b = self._exec(self._row(session_id), a.queue.pop(0))
                b.queue = a.queue

    def _hold(self, session_id: str, a: _Agent, yields: bool) -> Optional[bool]:
        """The agent's process gives way to another opening the session (`yields`), or stops giving
        way: `ag home hold`. Whether it still has the session; None when ag could not be asked."""
        s = self._row(session_id)
        if s is None:
            return None
        try:
            done = subprocess.run([*ag_command(), "home", "hold", s["gatherer"], session_id, "--pid", str(a.proc.pid),
                                   "--yields" if yields else "--keeps"], env=agent_env(), capture_output=True,
                                  timeout=30, stdin=subprocess.DEVNULL)
        except (OSError, subprocess.SubprocessError, SessionError):
            return None
        return {0: True, 3: False}.get(done.returncode)

    def _next(self, session_id: str, a: _Agent) -> None:
        """The next waiting message to the agent, as a turn (the lock held). One that was giving way
        stops first; if another process took the session meanwhile, the message is refused."""
        if not a.queue:
            return
        if a.yielding:
            if self._hold(session_id, a, False) is False:
                a.taken = True
                a.queue.clear()
                self._set(session_id, status="failed",
                          last_error="another process took over the session. Close it there first.")
                return
            a.yielding = False
        text = a.queue.pop(0)
        try:
            a.proc.stdin.write(harness_kit.get((self._row(session_id) or {}).get("harness")).headless_message(text))
            a.proc.stdin.flush()
        except (OSError, ValueError) as exc:
            a.queue.insert(0, text)
            self._set(session_id, status="failed", last_error=f"the agent is gone: {exc}")
            return
        a.busy = True
        self._set(session_id, status="running")

    def _read(self, session_id: str, a: _Agent) -> None:
        """The agent's stdout, until it exits: each turn's end, and the next waiting message sent."""
        h = harness_kit.get((self._row(session_id) or {}).get("harness"))
        for line in a.proc.stdout:
            a.log.write(line)
            try:
                event = json.loads(line)
            except ValueError:
                continue
            got = (h.headless_event(event) if h is not None else None) or {}
            if not got.get("ended"):                 # a turn's end, as its harness says
                continue
            with self.lock:
                a.busy = False
                s = self._row(session_id) or {"turns": 0}
                error = got.get("error")
                self._set(session_id, turns=s["turns"] + 1, status="idle", last_error=error)
                if a.queue:
                    self._next(session_id, a)
                else:                                # nothing waits: idle, it gives way
                    a.yielding = self._hold(session_id, a, True) is True
        code = a.proc.wait()
        for pipe in (a.proc.stdin, a.proc.stdout):
            try:
                pipe.close()
            except OSError:
                pass
        with self.lock:
            a.log.write(f"--- {_now()} exited {code}\n")
            a.log.close()
            if self.agents.get(session_id) is a:
                del self.agents[session_id]
                waiting = bool(a.queue) and not a.taken
                ok = a.ended or self.closing or a.kept or ((code == 0 or a.yielding or a.taken) and not a.busy)   # as asked
                s = self._row(session_id)
                if a.ended and a.busy and s and not s["turns"] and _has_calls(s["gatherer"], session_id):
                    self._set(session_id, turns=1)   # cut off in its first turn, after a call: Claude Code kept it, resumed
                self._set(session_id, status="stopped" if ok else "failed", ended=time.time(),
                          kept=time.time() if (self.closing or a.kept) and not a.taken else 0,
                          **({} if ok else {"last_error": _why(session_id) or
                                            f"the agent exited ({code}); see {log_path(session_id)}"}))
                if waiting:                  # messages sent while it was ending: a new process takes them
                    s = self._row(session_id)
                    try:
                        b = self._start(s)
                        b.queue = a.queue
                        self._next(session_id, b)
                    except SessionError:
                        pass

    def terminal(self, session_id: str, cols: int = 120, rows: int = 32, fullscreen: bool = False,
                 prompt: Optional[str] = None) -> dict:
        """The session opened in a terminal, `cols` x `rows`: its interactive Claude Code, started unless
        it runs already -- in its classic screen, or with `fullscreen` the screen its settings choose --
        with `prompt` its first message (typed into it, if it runs already). Its idle `-p` agent is ended
        first; refused while that one's turn runs, or while another process has the session open. The
        session as `list` has it."""
        if not TERMINALS:
            raise SessionError("a terminal needs a Unix pseudo-terminal, which this system does not have")
        with self.lock:
            s = self._row(session_id)
            if s is None:
                raise SessionError(f"no session {session_id} started from the dashboard")
            if session_id not in self.terms:
                a = self.agents.get(session_id)
                if a is not None and a.proc.poll() is None:
                    if a.busy or a.queue:
                        raise SessionError("a turn is running. Wait for it to end.")
                    a.queue.clear()
                    try:
                        a.proc.stdin.close()
                    except OSError:
                        pass
            else:
                a = None
        if a is not None:                            # its end recorded outside the lock: the reader takes it
            try:
                a.proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                a.proc.terminate()
            if a.reader is not None:
                a.reader.join(timeout=5)
        with self.lock:
            if session_id not in self.terms:
                held = holder(s["gatherer"], session_id)
                if held is not None:
                    raise SessionError(f"the session is open in another process ({held['pid']}). Close it there first.")
                row = self._row(session_id)
                from . import tool_gateway           # here: the gateway uses this module
                tools = ([tool_gateway.endpoint(tool_gateway.actor_of(row))]
                         if prompt and tool_gateway.served(row) else [])
                t = self._start_terminal(row, cols, rows, fullscreen, prompt, typed_later=bool(tools))
                if tools:                            # typed in once its tools are there, not on its command line
                    threading.Thread(target=self._first_message, args=(session_id, t, prompt, tools), daemon=True).start()
            else:                                    # open already (opened meanwhile): the prompt typed into it
                self.resize(session_id, cols, rows)
                if prompt:
                    self._paste(self.terms[session_id], prompt)
            return next(x for x in self.list() if x["session_id"] == session_id)

    def _first_message(self, session_id: str, t: _Term, text: str, tools: List[str]) -> None:
        """`text`, the first message of the terminal `t` just started for the session, typed into it once the harness has
        its tools: into its message box (`_at_box`) -- waited for while a dialog has the keys (a new folder's trust
        prompt), as a harness keeps a message from its command line behind one -- once each of the dashboard's MCP
        servers it was given (`tools`: the apps' gateway, tool_gateway.py's `served`) has listed them (mcp.py's `listed`) since the terminal
        started, TOOLS_TAKEN before; or TOOLS_WAIT after its box first showed (Claude Code connects its servers only once
        its folder is trusted). Claude Code and codex start a turn without waiting for their MCP servers, and keep the
        tools a turn starts with to its end: a message on the command line goes before the dashboard's servers have
        listed theirs, and its turn runs without them (job_apps 2026-11-03: a Browser's actor restarted for a message
        from Chat had none of its browser tools)."""
        from . import mcp

        def late() -> List[str]:                     # its servers not listed since its start, or only just
            now = time.time()
            return [e for e in tools if not t.since <= (mcp.listed(e) or 0) <= now - TOOLS_TAKEN]
        shown = None                                 # when its box first showed
        while True:
            s = self._row(session_id)
            if s is None or t.exited is not None or self.terms.get(session_id) is not t:
                return                               # closed meanwhile, or another terminal has it
            try:
                clear = self._at_box(s, t)
            except NotAtBox:
                time.sleep(BOX_POLL)
                continue
            shown = shown or time.time()
            missing = late()
            if not missing or time.time() >= shown + TOOLS_WAIT:
                break
            time.sleep(0.05)
        with self.lock:
            if self.terms.get(session_id) is not t or t.exited is not None:
                return
            self._paste(t, text, clear=bool(clear))
        _note(t, f"its tools not listed {TOOLS_WAIT:g}s after its message box showed ({', '.join(missing)}): the "
                 f"message sent without them" if missing else
                 f"its tools listed {time.time() - t.since:.2f}s after its start: the message sent")

    def _start_terminal(self, s: dict, cols: int, rows: int, fullscreen: bool = False,
                        prompt: Optional[str] = None, typed_later: bool = False) -> _Term:
        """The session `s`'s terminal started, `cols` x `rows`, with `prompt` its first message: on its command line, or,
        with `typed_later`, typed into it later (`terminal`'s `_first_message`, once its tools are listed). Registered in
        `terms` with what it was started with already on it: a reader not holding the lock (`type`'s `_unsent`) never
        sees it without."""
        sid = s["session_id"]
        resume = resumes(s)
        h = harness_kit.get(s["harness"])               # its own options: the harness's (harness_kit's `command`)
        if h is None:
            raise SessionError(f"unknown harness {s['harness']!r}")
        first = h.first_prompt(prompt) if prompt and not typed_later else []   # its first message, never read as an option
        told = instructions(s)
        screen = h.screen_env(fullscreen)            # its screen as asked, whatever the dashboard's own environment says
        env = {**{k: v for k, v in actor_env(s, agent_env()).items() if k not in OUTER_TERMINAL and k not in screen},
               "TERM": "xterm-256color", "COLORTERM": "truecolor", **{k: v for k, v in screen.items() if v is not None}}
        trusted, untrusted = [], None                # its folder trusted: no question first, holding back its message
        if trusts_folders():
            try:
                trusted = h.trust(s["cwd"], env)
            except (harness_kit.TrustError, OSError) as exc:
                untrusted = str(exc)
        argv = [*ag_command(), "--quiet", "--gatherer", _launch(s), *channel_args(s),   # quiet: ag's notes not on its
                s["harness"], *trusted, *extra_args(s), *h.command(self._own(s), resume=resume, model=s.get("model"),  # screen
                                                     permission_mode=s["permission_mode"], fullscreen=fullscreen,
                                                     instructions=told, cwd=s["cwd"]), *first]
        os.makedirs(os.path.dirname(log_path(sid)), exist_ok=True)
        log = open(log_path(sid), "a", encoding="utf-8", buffering=1)
        log.write(f"--- {_now()} terminal{' (full screen)' if fullscreen else ''} {shlex.join(_unsaid(argv[:len(argv) - len(first)], told))}"
                  f"{' -- <the message sent>' if first else ''}\n")       # the message not logged: a line of it is no line of ag's
        if untrusted:
            log.write(f"--- its folder not trusted ahead ({untrusted}): it may ask in its terminal first\n")
        try:
            pid, fd = pty.fork()
        except OSError as exc:
            log.close()
            self._set(sid, status="failed", last_error=f"could not open a terminal: {exc}")
            raise SessionError(f"could not open a terminal: {exc}") from exc
        if pid == 0:                                 # the child: its terminal sized, then ag
            try:
                fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
                os.chdir(s["cwd"])
                os.execvpe(argv[0], argv, env)
            finally:
                os._exit(127)
        t = _Term(pid, fd, log, fullscreen, cols, rows)
        t.harness, t.gatherer = s["harness"], s["gatherer"]
        t.prompt = prompt
        if prompt:
            t.typed = time.time()
            if not typed_later:
                t.prompted = t.typed
        self.terms[sid] = t
        if resume and not s["turns"]:
            self._set(sid, turns=1)
        self._set(sid, status="terminal", last_error=None, kept=0)
        t.reader = threading.Thread(target=self._read_terminal, args=(sid, t), daemon=True)
        t.reader.start()
        return t

    def shell(self, gatherer: str, cwd: str, cols: int = 120, rows: int = 32, folder: Optional[int] = None) -> dict:
        """A new shell (module doc), listed under `gatherer` -- in its folder `folder` (folders.py), for as long as it
        runs, if given: the user's login shell in `cwd`, in a terminal `cols` x `rows`, in the environment a session's
        terminal has. The shell as `shells` has it."""
        if not TERMINALS:
            raise SessionError("a terminal needs a Unix pseudo-terminal, which this system does not have")
        gatherer = (gatherer or "").strip()
        if not GATHERER.fullmatch(gatherer):
            raise SessionError("a gatherer name can only contain letters, digits, '.', '_' and '-'")
        cwd = os.path.abspath(os.path.expanduser((cwd or "").strip() or "~"))
        if not os.path.isdir(cwd):
            raise SessionError(f"no directory {cwd}")
        program = login_shell()
        env = {**{k: v for k, v in agent_env().items() if k not in OUTER_TERMINAL and k != "OLDPWD"},
               "TERM": "xterm-256color", "COLORTERM": "truecolor", "PWD": cwd, "SHELL": program}
        cols, rows = max(20, min(int(cols), 500)), max(5, min(int(rows), 200))
        with self.lock:
            shell_id = "shell:" + uuid.uuid4().hex[:12]
            try:
                pid, fd = pty.fork()
            except OSError as exc:
                raise SessionError(f"could not open a terminal: {exc}") from exc
            if pid == 0:                             # the child: its terminal sized, then the shell, as a login one
                try:
                    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
                    os.chdir(cwd)
                    os.execve(program, ["-" + os.path.basename(program)], env)
                finally:
                    os._exit(127)
            t = _Term(pid, fd, open(os.devnull, "w", encoding="utf-8"))    # nothing of a shell's logged
            self.terms[shell_id] = t
            self._shells[shell_id] = {"id": shell_id, "gatherer": gatherer, "cwd": cwd, "since": t.since, "folder": folder}
            t.reader = threading.Thread(target=self._read_terminal, args=(shell_id, t), daemon=True)
            t.reader.start()
            self._changed(gatherer, shell_id)
            return dict(self._shells[shell_id])

    def shells(self) -> List[dict]:
        """The shells open (`shell`), the oldest first: {id, gatherer, cwd, since, folder}."""
        with self.lock:
            return sorted((dict(s) for s in self._shells.values()), key=lambda s: s["since"])

    def close_shell(self, shell_id: str) -> None:
        """The shell's terminal closed as a window is: hung up, and gone from `shells` before this returns."""
        with self.lock:
            t = self.terms.get(shell_id) if shell_id in self._shells else None
            if t is None:
                raise SessionError(f"no shell {shell_id} open")
            self._hang_up(t)
        self._gone(t)                                # its end recorded by its reader, which takes the lock

    def _read_terminal(self, session_id: str, t: _Term) -> None:
        """What the terminal prints, until it exits: kept, and the pages watching it woken."""
        while True:
            try:
                chunk = os.read(t.fd, 65536)
            except OSError:                          # EIO: the process and its terminal are gone
                chunk = b""
            if not chunk:
                break
            with t.changed:
                back = bytes(t.out[-(len(CLEARED) - 1):])         # one split across two reads found too
                at = (back + chunk).rfind(CLEARED)
                if at >= 0:
                    t.drawn = t.end - len(back) + at
                t.out += chunk
                t.end += len(chunk)
                if len(t.out) > TERM_KEEP:
                    del t.out[:len(t.out) - TERM_KEEP]
                t.changed.notify_all()
            with t.screen_lock:                      # its screen kept as it draws it (`_box`)
                if t.screen is not None:
                    try:
                        t.screen.feed(chunk)
                    except Exception:  # noqa: BLE001 - a screen that cannot be read is not looked at again
                        t.screen = None
            self._watch_shown(session_id, t)
            if t.stopped and time.time() - t.stopped < HOLD_MAX:    # a stop key typed lately: Chat's view of it
                box = self._box(t, t.harness or "")                 # (chat_view.py) told what its box now shows
                if box != t.boxed:
                    t.boxed = box
                    with self.lock:
                        now_id = next((k for k, v in self.terms.items() if v is t), session_id)
                    self._changed(t.gatherer or "", now_id)
        try:
            _, status = os.waitpid(t.pid, 0)
            code = os.waitstatus_to_exitcode(status)
        except ChildProcessError:
            code = -1
        with t.fd_lock:                              # nothing uses its number after (`use_fd`)
            t.closed = True
            try:
                os.close(t.fd)
            except OSError:
                pass
        with t.changed:
            t.exited = code
            t.changed.notify_all()
        with self.lock:
            t.log.write(f"--- {_now()} terminal exited {code}\n")
            t.log.close()
            session_id = next((k for k, v in self.terms.items() if v is t), session_id)   # renamed meanwhile (codex)
            if self.terms.get(session_id) is t:
                del self.terms[session_id]
                shell = self._shells.pop(session_id, None)
                if shell is not None:                # a shell: gone from the list
                    self._changed(shell["gatherer"], session_id)
                    return
                s = self._row(session_id)
                self._set(session_id, status="stopped", ended=time.time(), kept=time.time() if self.closing or t.kept else 0,
                          **({"turns": max(1, s["turns"])} if s and _has_calls(s["gatherer"], session_id) else {}))
                if t.restart and code == 0 and not self.closing and s is not None:     # it updated itself (`_pick`)
                    threading.Thread(target=self._restart, args=(session_id, t), daemon=True).start()

    def output(self, session_id: str, since: int, wait: float = 0.0):
        """What the session's terminal printed after byte `since`, waiting up to `wait` seconds for
        something: (bytes, where they end, whether they start further back than asked -- what was
        kept, all of it; exit code or None). None when it has no terminal."""
        t = self.terms.get(session_id)
        if t is None:
            return None
        with t.changed:
            if t.end <= since and t.exited is None and wait > 0:
                t.changed.wait(wait)
            start = t.end - len(t.out)
            reset = since < start or since > t.end
            data = bytes(t.out) if reset else bytes(t.out[since - start:])
            return data, t.end, reset, t.exited

    def redraw(self, session_id: str) -> None:
        """The session's full-screen terminal drawn all again by its process, where what is kept of what it
        printed (`output`) no longer holds the last time it was: a full screen draws only what changed, so a
        page starting over from what is kept would miss what has not changed since. Its height is made a row
        less and, once it has drawn at that (or after REDRAW_WAIT), put back: each a SIGWINCH it draws all of
        it at -- the same size twice would be no change to it. What the page is sent after what is kept. Not
        for one in the classic screen, printed into the page's own scrollback."""
        t = self.terms.get(session_id)
        if t is None or not t.fullscreen:
            return
        with t.changed:
            start = t.end - len(t.out)
            if t.exited is not None or t.redrawing or not start or t.drawn >= start:
                return
            t.redrawing = True
        threading.Thread(target=self._redraw, args=(t,), daemon=True).start()

    def _redraw(self, t: _Term) -> None:
        try:
            with t.sizing:
                rows, cols = struct.unpack("HHHH", t.use_fd(lambda fd: fcntl.ioctl(fd, termios.TIOCGWINSZ, b"\0" * 8)))[:2]
                short = struct.pack("HHHH", rows - 1 if rows > 5 else rows + 1, cols, 0, 0)
                drawn = t.drawn
                t.use_fd(lambda fd: fcntl.ioctl(fd, termios.TIOCSWINSZ, short))
                self._sized(t, cols, rows - 1 if rows > 5 else rows + 1)
            with t.changed:
                t.changed.wait_for(lambda: t.drawn > drawn or t.exited is not None, REDRAW_WAIT)
            with t.sizing:                           # unless the page has sized it meanwhile
                if t.use_fd(lambda fd: fcntl.ioctl(fd, termios.TIOCGWINSZ, b"\0" * 8)) == short:
                    t.use_fd(lambda fd: fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0)))
                    self._sized(t, cols, rows)
        except OSError:                              # its terminal gone meanwhile
            pass
        finally:
            t.redrawing = False

    def type(self, session_id: str, data: str) -> None:
        """What was typed in the page, to the session's terminal, as typed. A key that stops a turn, typed while the
        dashboard's own keys go in -- a message it pastes (`_paste`), an answer (`answer`) -- after them: in the middle,
        it would cut the message off from its Enter or dismiss the question half answered; and while the message it
        pasted is in the harness's message box still (`_unsent`), after the harness has taken it: before, the harness
        has no turn to stop and lets the key go by, and the message goes on to be answered."""
        t = self.terms.get(session_id)
        if t is None:
            raise SessionError("the session has no terminal open")
        if data in STOP_KEYS and (t.answering or t.keying > time.time() or self._unsent(t)):
            threading.Thread(target=self._type_after, args=(session_id, t, data), name="ag-stop-key", daemon=True).start()
            return
        self._type_now(session_id, t, data)

    def _unsent(self, t: _Term) -> bool:
        """Whether the harness has yet to start on the message the dashboard gave it, up to HOLD_MAX after: one it pasted,
        in the harness's message box still -- its Enter typed, the harness not on it yet -- as the screen shows (`_box`:
        it holds something); one it started the terminal with, on its command line, while the harness starts up and
        before the turn's first call (`_began`)."""
        now = time.time()
        if t.prompted and now - t.prompted < HOLD_MAX and not self._began(t):
            return True
        return bool(t.pasted) and now - t.pasted < HOLD_MAX and self._box(t, t.harness or "") == Box.HOLDS

    def _began(self, t: _Term) -> bool:
        """Whether the harness has begun the turn of the message the terminal `t` was started with, so a stop key stops
        it: the turn's first call has come in -- the hook's `model_call` of a turn in the session's channel since the
        terminal started, recorded as the call comes in, before ag reads for it (seconds, on a busy gatherer). True where
        that is not known (no session for it now)."""
        with self.lock:
            sid = next((k for k, v in self.terms.items() if v is t), None)
        s = self._row(sid) if sid else None
        if s is None:
            return True
        from . import data                               # here: data.py reads this module
        conn = store.gatherer(s["gatherer"])
        if conn is None:
            return False
        since = datetime.fromtimestamp(t.prompted, timezone.utc).isoformat()
        try:
            got = conn.execute(
                f"SELECT 1 FROM events e JOIN event_types y ON y.event_type_id = e.event_type_id WHERE y.name = 'model_call' "
                f"AND ifnull(e.{data.CHANNEL}, '') = ? AND e.inserted_at >= ? "
                f"AND json_extract(e.payload_json, '$.kind') = 'turn' LIMIT 1", (sid, since)).fetchone()
        except sqlite3.Error:
            return False
        finally:
            conn.close()
        return got is not None

    def _type_after(self, session_id: str, t: _Term, data: str) -> None:
        end = time.time() + HOLD_MAX
        while (t.answering or t.keying > time.time() or self._unsent(t)) and time.time() < end:
            time.sleep(0.05)
        time.sleep(KEYS_GAP)
        try:
            self._type_now(session_id, t, data)
        except SessionError:
            pass

    def _type_now(self, session_id: str, t: _Term, data: str) -> None:
        if REPORTS.sub("", data):
            t.typed = time.time()
            t.stopped = t.typed if data in STOP_KEYS else 0.0
            t.drafted = drafted(t.drafted, REPORTS.sub("", data))
            if not SHELL_ID.fullmatch(session_id):     # kept in its gatherer (actions.py's `terminal_input`)
                actions.terminal_input((self._row(session_id) or {}).get("gatherer"), session_id, t.typed)
        self._write(t, data.encode("utf-8"))

    def rename(self, session_id: str, command: str) -> bool:
        """The harness's command that names the session (harness_kit's `rename_command`: the harness's `/rename ...`),
        held to be typed into its terminal once its turn is over (`rename_due`), in place of one held before: True,
        or False when the dashboard runs no terminal for it (nothing is held)."""
        with self.lock:
            t = self.terms.get(session_id)
            if t is None or t.exited is not None:
                self.renames.pop(session_id, None)
                return False
            self.renames[session_id] = command
            return True

    def rename_due(self, idle) -> List[str]:
        """Each command held by `rename` typed into its session's terminal, where the session is in `idle` -- its turn
        over and nothing asked, so its terminal waits on a prompt, not in a dialog where Enter would pick an option --
        and its input box is the harness's alone: no answer being typed, nothing the reader typed and has not sent
        (`drafted`), no message Claude Code put back there (`took_back`), and its screen shows the box empty, with the
        keys (`_box`). The sessions it was typed for."""
        typed = []
        idle = set(idle)
        with self.lock:
            for sid in [x for x in self.renames if x in idle]:
                t = self.terms.get(sid)
                if t is None or t.exited is not None:
                    self.renames.pop(sid)
                    continue
                s = self._row(sid) or {}
                if t.answering or t.drafted or (s.get("gatherer") and took_back(s["gatherer"], sid, t.stopped)) \
                        or self._box(t, s.get("harness") or "") not in (None, Box.EMPTY):
                    continue
                self._paste(t, self.renames.pop(sid))
                typed.append(sid)
        return typed

    def answer(self, session_id: str, ask: dict, choice: dict) -> dict:
        """What the session's terminal asks (data.py's `asking`: a question, a plan to approve, a permission) answered
        with `choice` (answers.py): its keys typed into the terminal one at a time, ANSWER_GAP apart, as if picked
        there. Refused where the dashboard has no terminal for the session, or where something was typed into
        it since it asked -- its dialog may no longer be as it first showed -- or, codex's, where the terminal
        opened after it asked: codex does not ask again on resuming. A permission is refused too where the terminal
        opened after it asked (the process that asked is gone, and its dialog with it) or its screen shows no dialog
        (`_box` not AWAY: the keys would go into its message box); once its keys are in, its dialog closing is what
        settles it here (`_closed`). -> the answer, as `list` then has it: {call (what it answered: data.py's `id`),
        summary, expect (what the harness's result for the call will hold), at}. A dialog only its screen shows: `_pick`."""
        if ask.get("kind") == DIALOG:
            return self._pick(session_id, ask, choice)
        permission = ask.get("kind") == answers.PERMISSION
        with self.lock:
            t = self.terms.get(session_id)
            if t is None:
                # An actor the dashboard runs headless, with no terminal, is answered by its driver instead (its
                # session's own asks): not here, by keys.
                raise SessionError("the dashboard doesn't run this session's terminal. Answer it in the terminal that does.")
            if t.answering:
                raise SessionError("an answer is already being typed")
            from . import data                       # data imports this module
            typed = max(t.typed or 0, data.typed_at((self._row(session_id) or {}).get("gatherer") or "", session_id) or 0)
            if typed and ask.get("at") and typed >= ask["at"]:      # here, or as the gatherer kept it (terminal_input)
                raise SessionError("something was typed in the terminal since the question appeared. Answer it there.")
            rules = harness_kit.get(ask.get("harness") or harness_kit.DEFAULT)
            if (permission or rules is not None and not rules.asks_shown_again) and ask.get("at") and t.since > ask["at"]:
                raise SessionError("the terminal was reopened and no longer shows this question. Answer in a message.")
            harness = (self._row(session_id) or {}).get("harness") or t.harness or ""
            shown = self._shown(t, harness) if permission else None
            if permission and shown is None:
                raise SessionError("the terminal doesn't show the question. Answer it there.")
            keys = answers.keys(ask, choice, shown)      # AnswerError, a ValueError: a choice that does not fit
            sent = {"call": ask.get("id") or ask.get("call"), "summary": answers.summary(ask, choice),
                    "expect": answers.expected(ask, choice), "at": time.time()}
            self.answered[session_id] = sent
            t.answering = True
            gatherer = (self._row(session_id) or {}).get("gatherer")
        actions.answer_given(gatherer, session_id, sent)        # kept in its gatherer
        after = (lambda: self._closed(t, harness, gatherer, session_id, sent, shown)) if permission else None
        threading.Thread(target=self._keys, args=(t, keys, after, harness), daemon=True).start()
        self._changed(gatherer, session_id)
        return sent

    def _pick(self, session_id: str, ask: dict, choice: dict) -> dict:
        """A dialog the session's terminal shows that no hook reported (data.py's `shown_ask`: a menu its harness shows
        as it starts -- an update, a folder to trust -- or a permission only its screen says it asks) answered by
        picking one of its options (`choice`: {"pick": its place}): its cursor moved there, seen there, then Enter
        (harness_kit's `pick_keys`). Refused where the dashboard has no terminal for the session, something was typed
        into it since it showed, or its screen no longer shows it as it was asked. An option its harness ends after, to
        update itself (`restarts`), has its terminal started again once it ends well (`_restart`). Nothing is kept in
        its gatherer: no model has had any of it. -> the answer, as `answer`'s."""
        with self.lock:
            t = self.terms.get(session_id)
            if t is None:
                raise SessionError("the dashboard doesn't run this session's terminal. Answer it in the terminal that does.")
            if t.answering:
                raise SessionError("an answer is already being typed")
            if t.typed and ask.get("at") and t.typed >= ask["at"]:
                raise SessionError("something was typed in the terminal since this appeared. Answer it there.")
            harness = (self._row(session_id) or {}).get("harness") or t.harness or ""
            h = harness_kit.get(harness)
            shown = self._shown(t, harness, menus=True)
            if h is None or shown is None or (shown["title"], shown["question"], shown["options"]) != (
                    ask.get("title"), ask.get("said"), ask.get("options")):
                raise SessionError("the terminal no longer shows this. Answer it there.")
            place = choice.get("pick") if isinstance(choice, dict) else None
            keys = h.pick_keys(shown, place)         # AnswerError: no such option
            sent = {"call": ask.get("id"), "summary": shown["options"][place], "expect": [], "at": time.time()}
            self.answered[session_id] = sent
            t.answering = True
            t.restart = place in (shown.get("restarts") or [])
            gatherer = (self._row(session_id) or {}).get("gatherer")
        _note(t, f"picked {shown['options'][place]!r} in {shown['title'] or 'its menu'!r} from the page"
                 f"{': started again once it ends' if t.restart else ''}")
        threading.Thread(target=self._keys, args=(t, keys, None, harness), daemon=True).start()
        self._changed(gatherer, session_id)
        return sent

    def _restart(self, session_id: str, t: _Term) -> None:
        """The session's terminal `t` started again as it was -- its size, its screen, the message it was started with --
        once its harness ended it to update itself, at a pick of the reader's (`_pick`'s `restarts`): the message,
        not sent before it ended, goes this time."""
        size = (t.screen.cols, t.screen.rows) if t.screen is not None else (120, 32)
        try:
            self.terminal(session_id, *size, fullscreen=t.fullscreen, prompt=t.prompt)
        except SessionError as exc:
            log = open(log_path(session_id), "a", encoding="utf-8")
            with log:
                log.write(f"--- {_now()} not started again after its update: {exc}\n")

    def _keys(self, t: _Term, keys: List[str], after: Optional[Callable[[], None]] = None, harness: str = "") -> None:
        typed = False
        try:
            for k in keys:
                if k == AT_DENY:                     # not a key: the dialog's cursor on its No before going on
                    self._at_deny(t, harness)
                    continue
                if k.startswith(AT_OPTION):          # nor this: its cursor on the option picked
                    self._at_option(t, harness, int(k[len(AT_OPTION):]))
                    continue
                self._write(t, k.encode("utf-8"))
                time.sleep(ANSWER_GAP)
            typed = True
        except SessionError as exc:
            t.log.write(f"--- {_now()} answer not typed in full: {exc}\n")
        finally:
            t.answering = False
        if typed and after is not None:
            after()

    def _at_deny(self, t: _Term, harness: str) -> None:
        """Waits, up to DENY_SECONDS, for the permission dialog's cursor to be on its option that denies, as its screen
        shows; raises SessionError where it isn't -- the keys that would pick there not typed."""
        end = time.time() + DENY_SECONDS
        while True:
            got = self._shown(t, harness)
            if got is not None and got["cursor"] == got["deny"]:
                return
            if time.time() >= end:
                raise SessionError(f"its dialog's cursor is not on No ({got and got['options'][got['cursor']]!r})")
            time.sleep(0.1)

    def _at_option(self, t: _Term, harness: str, place: int) -> None:
        """Waits, up to DENY_SECONDS, for the cursor of the dialog or menu its screen shows to be on option `place`;
        raises SessionError where it isn't -- the Enter that would pick there not typed."""
        end = time.time() + DENY_SECONDS
        while True:
            got = self._shown(t, harness, menus=True)
            if got is not None and got["cursor"] == place:
                return
            if time.time() >= end:
                raise SessionError(f"its cursor is not on the option picked ({got and got['options'][got['cursor']]!r})")
            time.sleep(0.1)

    def _closed(self, t: _Term, harness: str, gatherer: Optional[str], session_id: str, sent: dict,
                shown: Optional[dict] = None) -> None:
        """Once a permission's keys are in: its dialog (`shown`) gone from the terminal's screen within CLOSE_SECONDS
        settles it -- recorded (actions.py's `ask_settled`), `sent` marked `closed`, the page told. The tool it allowed
        may run long before its harness calls its model again, which settles it too. Its dialog still shown (the keys
        not taken) leaves it to that."""
        same = lambda d: d is not None and shown is not None and (d["title"], d["question"]) == (shown["title"], shown["question"]) \
            and d["options"][:d["deny"]] == shown["options"][:shown["deny"]]      # noqa: E731 - its No may hold the words
        end = time.time() + CLOSE_SECONDS
        while time.time() < end:
            with t.screen_lock:
                drawn = t.screen is not None
            if not drawn:
                return
            if not same(self._shown(t, harness)):
                sent["closed"] = time.time()
                actions.ask_settled(gatherer, session_id, sent["call"], sent.get("summary"))
                self._changed(gatherer or "", session_id)
                return
            time.sleep(0.2)

    def resize(self, session_id: str, cols: int, rows: int) -> None:
        """The terminal is `cols` x `rows` now: its process is told (SIGWINCH)."""
        t = self.terms.get(session_id)
        if t is None:
            raise SessionError("the session has no terminal open")
        cols, rows = max(20, min(int(cols), 500)), max(5, min(int(rows), 200))
        try:
            with t.sizing:
                t.use_fd(lambda fd: fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0)))
                self._sized(t, cols, rows)
        except OSError:
            pass

    def _sized(self, t: _Term, cols: int, rows: int) -> None:
        """Its screen (`_box`) made `cols` x `rows`, as its terminal is: what it prints from now on is drawn at that size."""
        with t.screen_lock:
            if t.screen is not None:
                t.screen.resize(cols, rows)

    def _shown(self, t: _Term, harness: str, menus: bool = False) -> Optional[dict]:
        """The permission dialog the terminal's screen shows now (harness_kit's `permission_shown`) -- or, with `menus`, a
        menu its harness shows as it starts (`menu_shown`, marked `menu`); None: none, or not known."""
        h = harness_kit.get(harness)
        with t.screen_lock:
            if h is None or t.screen is None:
                return None
            try:
                got = h.permission_shown(t.screen)
                if got is None and menus:
                    got = h.menu_shown(t.screen)
                    got = dict(got, menu=True) if got is not None else None
                return got
            except Exception:  # noqa: BLE001 - a rule that fails on a screen says nothing of it
                return None

    def _watch_shown(self, session_id: str, t: _Term) -> None:
        """After the terminal drew: whether a permission dialog came or went on its screen (`shown`, with `since`) -- or,
        as it starts, a menu of its harness's (`_watch_ready`) -- read only while something else than its message box
        has the keys (the cursor hidden), or one was shown. A change wakes the page; one still shown SHOWN_SECONDS on,
        once more (data.py's `shown_ask`)."""
        if not t.ready:
            self._watch_ready(t)
        with t.screen_lock:
            look = t.screen is not None and (t.shown is not None or not t.screen.cursor_shown)
        if not look:
            return
        got = self._shown(t, t.harness or "", menus=not t.ready)
        sig = lambda d: (d["title"], d["question"], tuple(d["options"])) if d else None    # noqa: E731
        if sig(got) == sig(t.shown):
            return
        t.shown = {**got, "since": time.time()} if got else None
        with self.lock:
            now_id = next((k for k, v in self.terms.items() if v is t), session_id)
        self._changed(t.gatherer or "", now_id)
        if got:
            mark = t.shown

            def again() -> None:
                if t.shown is mark:
                    self._changed(t.gatherer or "", now_id)
            timer = threading.Timer(SHOWN_SECONDS + 0.1, again)
            timer.daemon = True
            timer.start()

    def _watch_ready(self, t: _Term) -> None:
        """Whether the terminal's harness has started (`ready`): its message box seen with the keys READY_SECONDS on end,
        as what it drew since shows -- its menus as it starts (an update it offers, a folder to trust) behind it."""
        now = time.time()
        if t.box_seen and now - t.box_seen >= READY_SECONDS:
            t.ready = True
            return
        box = self._box(t, t.harness or "")
        t.box_seen = (t.box_seen or now) if box in (Box.EMPTY, Box.HOLDS) else 0.0

    def _box(self, t: _Term, harness: str) -> Optional[str]:
        """What a message typed into the terminal now would go into, as its screen shows (harness_kit's `box`): a Box;
        None where that is not known -- a harness with no rule for it, a screen not drawn yet, or one not read."""
        h = harness_kit.get(harness)
        with t.screen_lock:
            if h is None or t.screen is None or not any(line.strip() for line in t.screen.lines()):
                return None
            try:
                return h.box(t.screen)
            except Exception:  # noqa: BLE001 - a rule that fails on a screen says nothing of it
                return None

    def _at_box(self, s: dict, t: _Term) -> Optional[bool]:
        """Whether a message typed into the session's terminal now goes into its message box, as `_paste` types it in --
        so not into a dialog, a menu, a question or a permission the harness asks, where its Enter would pick and the
        message be lost, nor onto what the reader typed in the box and has not sent. The box may hold a message Claude
        Code put back there (`took_back`): True, the box to be emptied first (`_paste`'s `clear`); False, it is empty; None,
        its screen does not say. Raises NotAtBox where it does not. The dashboard's own keys going in (a message, an answer) are waited for first; a screen caught
        mid-draw (a program hides its cursor while it draws) is watched for up to BOX_SETTLE."""
        end = time.time() + HOLD_MAX
        while (t.answering or t.keying > time.time()) and time.time() < end:
            time.sleep(0.05)
        end = time.time() + BOX_SETTLE
        while True:
            box = self._box(t, s["harness"])
            if box is None:
                return None
            if box == Box.EMPTY:
                return False
            if box == Box.HOLDS and takes_back(s["harness"]) and took_back(s["gatherer"], s["session_id"], t.stopped):
                return True
            if time.time() >= end:
                break
            time.sleep(0.05)
        h = harness_kit.get(s["harness"])
        name = h.label if h is not None and h.label else s["harness"]
        if box == Box.HOLDS:
            raise NotAtBox(f"{name}'s message box in the terminal has unsent text. "
                           f"Send or clear it there, then try again.", box)
        raise NotAtBox(f"{name}'s terminal is showing a dialog, menu or question. "
                       f"Finish it or press Esc there, then try again.", box)

    def _write(self, t: _Term, data: bytes) -> None:
        try:
            while data:
                data = data[t.use_fd(lambda fd: os.write(fd, data)):]
        except OSError as exc:
            raise SessionError(f"the terminal is gone: {exc}") from exc

    def _paste(self, t: _Term, text: str, clear: bool = False) -> None:
        """A message from a view's message box, typed into the terminal: pasted as one block (so its
        new lines stay in it), then Enter once the paste has landed. With `clear`, Claude Code's input box
        emptied first (Ctrl+C), of the message it put back there (`took_back`), so the two do not go as one. An Esc typed
        just before is given KEYS_GAP first, so it is not read as one key with the paste's opening (Alt+...); one typed
        while it goes in waits for its Enter (`keying`, `type`)."""
        now = time.time()
        wait = max(0.0, KEYS_GAP - (now - t.stopped)) if t.stopped else 0.0
        t.typed, t.stopped, t.drafted, t.pasted = now, 0.0, 0, now
        t.keying = now + wait + (CLEAR_GAP if clear else 0.0) + PASTE_ENTER + KEYS_GAP
        paste = b"\x1b[200~" + text.replace("\x1b", "").encode("utf-8") + b"\x1b[201~"
        if not clear and not wait:
            self._write(t, paste)
            threading.Timer(PASTE_ENTER, lambda: self._write_quietly(t, b"\r")).start()
            return
        if clear and not wait:
            self._write(t, b"\x03")                 # at once: a terminal gone says so to the sender

        def then() -> None:
            if wait:
                time.sleep(wait)
                if clear:
                    self._write_quietly(t, b"\x03")
            if clear:
                time.sleep(CLEAR_GAP)
            self._write_quietly(t, paste)
            time.sleep(PASTE_ENTER)
            self._write_quietly(t, b"\r")
        threading.Thread(target=then, name="ag-paste", daemon=True).start()

    def _write_quietly(self, t: _Term, data: bytes) -> None:
        try:
            self._write(t, data)
        except SessionError:
            pass

    def _gone(self, t: _Term) -> None:
        """Once a hung-up terminal's end is recorded: killed if it is still there after 5 s."""
        if t.reader is None:
            return
        t.reader.join(timeout=5)
        if t.reader.is_alive():
            try:
                os.killpg(t.pid, signal.SIGKILL)
            except OSError:
                pass
            t.reader.join(timeout=5)

    def _hang_up(self, t: _Term) -> None:
        """The terminal closed as a window is: its process group hung up."""
        for sig in (signal.SIGHUP, signal.SIGCONT):
            try:
                os.killpg(t.pid, sig)
            except OSError:
                pass

    def close(self) -> None:
        """Every agent's stdin closed, so each ends after its turn; any still running after 5 s is
        stopped; every terminal hung up, and killed if still there after 5 s. Returns once each one's
        end is recorded. Each is kept: the dashboard's end did not close it."""
        with self.lock:
            self.closing = True
            terms = list(self.terms.values())
            for t in terms:
                self._hang_up(t)
            agents = list(self.agents.values())
            for a in agents:
                a.queue.clear()          # nothing more to send: not started again
        for a in agents:
            try:
                a.proc.stdin.close()
            except OSError:
                pass
        for a in agents:
            try:
                a.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                a.proc.terminate()
        for a in agents:
            if a.reader is not None:
                a.reader.join(timeout=5)
        for t in terms:
            if t.reader is not None:
                t.reader.join(timeout=5)
                if t.reader.is_alive():
                    try:
                        os.killpg(t.pid, signal.SIGKILL)
                    except OSError:
                        pass
                    t.reader.join(timeout=2)

