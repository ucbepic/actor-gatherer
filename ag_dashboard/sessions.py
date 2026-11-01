"""Sessions started from the page: a headless agent per session, run through ag, that the page
sends messages to. Each is an ordinary ag session -- a channel of its gatherer, shown like any
other actor -- and the dashboard's own table, `sessions` in <home>/dashboard.db, keeps which
ones it started:

    session_id       the harness's session id, which ag makes the gatherer's channel: Claude Code's, chosen
                     here; codex's thread id, which codex chooses -- until its first call, the id it was
                     started under, then renamed to the thread's (`started_as` keeps the first)
    gatherer         the gatherer it joined (ag makes a new one on its first call)
    harness          the harness it runs on, as harness_kit names it (of `HARNESSES`: those it can start)
    cwd              where the agent runs
    permission_mode  Claude Code's --permission-mode: auto (the default), acceptEdits, plan, ...; for codex,
                     auto is --approve-for-me, bypassPermissions its bypass, any other none (codex asks)
    model            the model it runs (-m), NULL: the harness's own default
    started_as       the id it was started under, when that was not its harness's (codex's, renamed); else NULL
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
    role             what the session is for, besides its messages: "coordinator", its gatherer's gatherer agent
                     (coordination.py), run with that role's instructions added to its harness's own on every run
                     (`instructions`); or, as JSON, {"docwriter": key}: the agent of a DocWriter (docwriter.py), or
                     {"browser": key}: a Browser's (browser.py), started with its tools and instructions
                     (`extra_args`); NULL, an actor like any other

The agent is one long-running process, `ag --gatherer G claude -p --input-format stream-json
--output-format stream-json ...`: each message is a line on its stdin, a turn, and each turn
ends with a `result` line on its stdout. A message sent while a turn runs waits for it. Between
turns it gives way (`ag home hold ... --yields`): another process opening the session -- a terminal
resuming it -- stops it and takes the session over; before the next turn it stops giving way
(`--keeps`), and if it was taken meanwhile the message is refused. A process that is gone (taken
over, exited, the dashboard restarted) is started again on the next message, resuming the session
(`--resume`) once it has had a turn.

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
actor (ACTOR_TABLES), so it is listed nowhere, as if it had never been made.

CODEX runs the same ways, through `ag ... codex`: in a terminal, its own interactive UI (`codex
[resume <id>]`); headless, a process per turn, `codex exec --json
[resume <id>] -` with the message on its stdin, ending with the turn. Codex chooses its thread's id,
so a codex session starts under an id of the dashboard's and is renamed to its thread's once known:
from `codex exec`'s `thread.started`, or, in a terminal, the gatherer's first call from the terminal's
process that names a directory (codex's side calls -- a title for the thread -- name none).

ANTIGRAVITY (agy) runs in a terminal only, its own interactive UI, whatever `chat_mode` says (its headless
mode is not built): it chooses its conversation's id too, so it is started and renamed as a codex terminal is.

A new gatherer, with no session yet, is made by `ag new <name>` (`new_gatherer`).

A SHELL is opened from a gatherer's row too (`shell`): no session, the user's own login shell in a
terminal of its own, in the directory the page gives it (where a new session there would start), drawn
as a session's terminal is -- by its id, "shell:" and 12 hex digits, which no channel has, to `output`,
`type` and `resize` -- and listed under the gatherer (`shells`) until it exits or is closed
(`close_shell`). Not run through ag, and not kept: it lives as long as the dashboard does.

ag is run as a command (AG_COMMAND, else `ag` on the PATH), never imported."""

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
from typing import Callable, Dict, List, Optional
from urllib.parse import urlsplit

import harness_kit
from harness_kit.base import Box
from harness_kit.screen import Screen

from . import actions, answers, home

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
COORDINATOR = "coordinator"                    # the role of a gatherer's gatherer agent (coordination.py)
ROLES = (COORDINATOR,)
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
    role            TEXT
)"""
COLUMNS = ("session_id", "gatherer", "harness", "cwd", "permission_mode", "created_at", "turns", "status", "last_error",
           "kept", "model", "started_as", "ended", "role")
ADDED = (("kept", "REAL NOT NULL DEFAULT 0"), ("model", "TEXT"), ("started_as", "TEXT"),
         ("ended", "REAL NOT NULL DEFAULT 0"), ("role", "TEXT"))   # columns a table from before lacks
# The dashboard's other tables in dashboard.db with a row per actor, by (gatherer, channel): saved.py's, seen.py's,
# avatars.py's -- what a session discarded (`discard`) takes with it.
ACTOR_TABLES = ("saved", "seen", "avatars")


class SessionError(ValueError):
    """A request the sessions cannot take: the page shows its text."""


class NotAtBox(SessionError):
    """A message the session's terminal cannot take now: something other than its message box, empty, has the keys --
    `box`, what (harness_kit's Box: HOLDS, AWAY). The page points to the terminal."""

    def __init__(self, text: str, box: str):
        super().__init__(text)
        self.box = box


def db_path() -> str:
    return os.path.join(home.HOME, "dashboard.db")


def log_path(session_id: str) -> str:
    return os.path.join(home.HOME, "logs", "dashboard", f"{session_id}.log")


def stored() -> List[dict]:
    """The sessions the table has, newest first, read-only: [] when there is no table yet."""
    if not os.path.exists(db_path()):
        return []
    conn = sqlite3.connect(f"file:{db_path()}?mode=ro", uri=True, timeout=8)
    conn.row_factory = sqlite3.Row
    try:                                # a table from before `kept`, `model`, `started_as`, `ended`, `role`: none
        return [{"kept": 0, "model": None, "started_as": None, "ended": 0, "role": None, **dict(r)}
                for r in conn.execute("SELECT * FROM sessions ORDER BY created_at DESC")]
    except sqlite3.Error:
        return []
    finally:
        conn.close()


OUTER_TERMINAL = ("TMUX", "TMUX_PANE", "STY", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "TERM_SESSION_ID", "WINDOWID",
                  "VTE_VERSION", "KITTY_WINDOW_ID", "WEZTERM_PANE", "ITERM_SESSION_ID")   # the dashboard's own terminal: not the page's
TERM_KEEP = 512 * 1024             # how much of a terminal's output is kept, for a page that comes back
THREAD_POLL = 1.0                  # how often a new codex terminal's thread is looked for in the gatherer
PASTE_ENTER = 0.15                 # after a message is pasted into a terminal, how long before its Enter
CLEAR_GAP = 0.2                    # after Claude Code's input box is emptied (Ctrl+C), how long before a message is pasted
STOP_KEYS = ("\x1b", "\x03")       # keys that stop a turn: Esc, Ctrl+C
KEYS_GAP = 0.1                     # around the dashboard's own keys (a paste, an answer): a stop key typed is kept this far off
HOLD_MAX = 10.0                    # a stop key held while the dashboard's own keys go in, at most this long
ANSWER_GAP = 0.3                   # between the keys of an answer typed into a dialog: several at once are one input to it
CLEARED = b"\x1b[2J"               # a full screen clearing it, to draw it all again (Claude Code's, at its start and each resize)
REDRAW_WAIT = 1.0                  # a full screen made a row shorter (`redraw`): how long it is given to draw, before it is put back
BOX_SETTLE = 0.5                   # a terminal's message box not shown empty: how long its screen is watched for it to be (a
                                   # program hides its cursor while it draws), before a message for it is refused (`_at_box`)
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
    conn = _gatherer_db(gatherer)
    if conn is None:
        return False
    try:
        return conn.execute("SELECT 1 FROM _reads WHERE ifnull(p_channel, '') = ? LIMIT 1", (session_id,)).fetchone() is not None
    except sqlite3.Error:
        return False
    finally:
        conn.close()


SESSION_ID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def _gatherer_db(gatherer: str) -> Optional[sqlite3.Connection]:
    path = home.db_path(gatherer)
    if not os.path.exists(path):
        return None
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=8)
    conn.row_factory = sqlite3.Row
    return conn


def holder(gatherer: str, session_id: str) -> Optional[dict]:
    """The process that has the session open, as the gatherer says, and still runs: {pid, by} -- its
    `_open` row (ag's launcher's claim, or a call's), else the process its newest call named. None:
    none, or none that can be told."""
    conn = _gatherer_db(gatherer)
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
    conn = _gatherer_db(gatherer)
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
    """Whether `harness` picks its session's id itself (harness_kit's `picks_session_id`: codex's thread, agy's
    conversation): a session started here takes one of ours, `started_as` keeps it, and it is renamed to the
    harness's once its first call names that."""
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


def _thread_of(gatherer: str, pid: int, known) -> Optional[str]:
    """The codex thread a process (a terminal's) works in, as the gatherer's calls say: the channel of the
    first call that names a directory -- codex's side calls, a title for the thread, name none -- is not
    among `known` (the sessions the table has), and came from `pid`: its run is `pid` (codex's launcher
    names the run by the process ag runs in, which the terminal started and codex then is), or the process
    that made it is `pid` or runs under it (where that can be told: Linux's /proc)."""
    conn = _gatherer_db(gatherer)
    if conn is None:
        return None
    try:
        has_run = "run" in {r[1] for r in conn.execute("PRAGMA table_info(_reads)")}
        for channel, by, run in conn.execute(
                f"SELECT p_channel, pid, {'run' if has_run else 'NULL'} FROM _reads WHERE (pid IS NOT NULL"
                f"{' OR run IS NOT NULL' if has_run else ''}) AND p_cwd IS NOT NULL AND p_cwd != '' "
                "ORDER BY read_id DESC LIMIT 200"):
            if channel and channel not in known and (run == str(pid) or home.runs_under(by, pid)):
                return channel
    except sqlite3.Error:
        return None
    finally:
        conn.close()
    return None


def _why(session_id: str) -> Optional[str]:
    """What ag said last, in the session's log ("ag: ..."): why its process ended, if it said."""
    try:
        with open(log_path(session_id), encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()[-200:]
    except OSError:
        return None
    said = [l.strip()[4:] for l in lines if l.startswith("ag: ")]
    return said[-1] if said else None


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
    return coordination.instructions(s["gatherer"])


def extra_args(s: dict) -> List[str]:
    """What a session's harness is started with besides its own options, as its `role` says -- a DocWriter's agent, or
    a Browser's: its tools and instructions (docwriter.py's, browser.py's `launch_args`); [] for any other."""
    if not str(s.get("role") or "").startswith("{"):
        return []
    from . import browser, docwriter            # here: they use this module
    return docwriter.launch_args(s) or browser.launch_args(s)


def known_role(role: str) -> bool:
    """Whether `role` is one a session may have: one of ROLES, a DocWriter's ({"docwriter": key}, docwriter.py), or a
    Browser's ({"browser": key}, browser.py)."""
    if role in ROLES:
        return True
    try:
        got = json.loads(role)
    except (TypeError, ValueError):
        return False
    return isinstance(got, dict) and (isinstance(got.get("docwriter"), str) or isinstance(got.get("browser"), str))


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
        raise SessionError("a gatherer's name may hold letters, digits, '.', '_' and '-' only")
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
    conn = data._connect(gatherer)
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
        self.drafted = 0                # characters the reader typed into its input box and has not sent (`drafted`)
        self.kept = False               # put away (`put_away`): its end is kept
        self.drawn = -1                 # where in what it printed it last cleared its screen (CLEARED), to draw it all
        self.sizing = threading.Lock()  # its size set by one at a time: the page's (`resize`), or `redraw`'s
        self.redrawing = False          # `redraw` at it
        self.screen = Screen(cols, rows) if cols and rows else None   # its screen as what it printed draws it (`_box`):
        self.screen_lock = threading.Lock()                           # a harness's terminal's, fed by its reader


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
        self.unsent: Dict[str, List[tuple]] = {}  # a codex session's messages from Chat, (text, at), kept for its thread
        self.closing = False            # the dashboard stopping: what ends now is kept
        conn = self._db()               # a process from before is gone: what it was running stopped, and kept
        try:
            conn.execute("UPDATE sessions SET status = 'stopped', kept = ? "
                         "WHERE status IN ('starting', 'running', 'idle', 'terminal')", (time.time(),))
        finally:
            conn.close()

    def _db(self) -> sqlite3.Connection:
        os.makedirs(home.HOME, exist_ok=True)
        conn = sqlite3.connect(db_path(), timeout=8, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute(SCHEMA)
        have = {r[1] for r in conn.execute("PRAGMA table_info(sessions)")}
        for name, kind in ADDED:                 # a table from before them
            if name not in have:
                try:
                    conn.execute(f"ALTER TABLE sessions ADD COLUMN {name} {kind}")
                except sqlite3.OperationalError:     # another process added it meanwhile
                    continue
                if name == "ended":              # what had run and stopped, not kept: ended by now
                    conn.execute("UPDATE sessions SET ended = ? WHERE status IN ('stopped', 'failed') AND kept = 0 "
                                 "AND turns > 0", (time.time(),))
        return conn

    def _row(self, session_id: str) -> Optional[dict]:
        conn = self._db()
        try:
            r = conn.execute(f"SELECT {', '.join(COLUMNS)} FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
            return dict(r) if r else None
        finally:
            conn.close()

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

    def list(self) -> List[dict]:
        """Every session the table has, newest first, each with `queued` (its messages waiting), `pid` (the
        dashboard's process for it), `since` (when that started), `terminal` (whether that is a terminal) and
        `fullscreen` (whether it runs Claude Code's full screen), `answer` (the last answer typed from the page,
        `answer`), `typed` (when anything was last typed into its terminal) and `stopped_at` (when what was last typed
        there was a key that stops a turn alone; None: something else was -- after its call before, its message taken
        back is still in Claude Code's input box untouched: data.py's `taken_back`'s `since`, `took_back`)."""
        with self.lock:
            out = []
            for s in stored():
                a, t = self.agents.get(s["session_id"]), self.terms.get(s["session_id"])
                out.append({**s, "queued": list(a.queue) if a else [], "terminal": t is not None,
                            "answer": self.answered.get(s["session_id"]), "typed": t.typed if t else None,
                            "stopped_at": (t.stopped or None) if t else None,
                            "fullscreen": bool(t and t.fullscreen), "pid": t.pid if t else a.proc.pid if a else None,
                            "since": t.since if t else a.since if a else None})
            return out

    def create(self, gatherer: str, cwd: str, permission_mode: str = "auto", harness: str = harness_kit.DEFAULT,
               model: Optional[str] = None, role: Optional[str] = None) -> dict:
        """A new session of `harness` in `gatherer` (a new gatherer if none has the name), to run in `cwd`
        on `model` (None: the harness's default), for `role` (`known_role`; None: an actor like any other). Its agent starts
        with its first message."""
        gatherer = (gatherer or "").strip()
        if not GATHERER.fullmatch(gatherer):
            raise SessionError("a gatherer's name may hold letters, digits, '.', '_' and '-' only")
        cwd = os.path.abspath(os.path.expanduser((cwd or "").strip() or "."))
        if not os.path.isdir(cwd):
            raise SessionError(f"no directory {cwd}")
        if permission_mode not in PERMISSION_MODES:
            raise SessionError(f"permission mode {permission_mode!r}: one of {', '.join(PERMISSION_MODES)}")
        if harness not in HARNESSES:
            raise SessionError(f"harness {harness!r}: one of {', '.join(HARNESSES)}")
        model = (model or "").strip() or None
        if model and not re.fullmatch(r"[A-Za-z0-9._:/@-]+", model):
            raise SessionError(f"model {model!r}: not a model's name")
        if role is not None and not known_role(role):
            raise SessionError(f"role {role!r}: one of {', '.join(ROLES)}, or a DocWriter's or a Browser's")
        session_id = str(uuid.uuid4())
        conn = self._db()
        try:
            conn.execute(f"INSERT INTO sessions ({', '.join(COLUMNS)}) VALUES (?, ?, ?, ?, ?, ?, 0, 'stopped', NULL, 0, ?, ?, 0, ?)",
                         (session_id, gatherer, harness, cwd, permission_mode, _now(), model,
                          session_id if picks_id(harness) else None, role))
        finally:
            conn.close()
        self._changed(gatherer, session_id)
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
                raise SessionError(f"session {session_id} named no directory that is still there to resume it in"
                                   + (f" ({cwd})" if cwd else ""))
            conn = self._db()
            try:
                conn.execute(f"INSERT INTO sessions ({', '.join(COLUMNS)}) VALUES (?, ?, ?, ?, 'auto', ?, 1, 'stopped', NULL, 0, NULL, NULL, 0, NULL)",
                             (session_id, gatherer, _session_harness(gatherer, session_id), cwd, _now()))
            finally:
                conn.close()
            self._changed(gatherer, session_id)
            return self._row(session_id)

    def send(self, session_id: str, text: str, cols: int = 120, rows: int = 32, fullscreen: bool = False) -> dict:
        """The message to the session: typed into its terminal, if one is open -- only into its message box, empty: refused
        (NotAtBox) while a dialog, a menu, a question or a permission it asks has the keys, or while something typed
        there is not sent (`_at_box`); else, as `chat_mode` says, its
        terminal opened (`cols` x `rows`, `fullscreen` as `terminal` takes it) with the message its first
        prompt, or a turn of its agent -- now, or, while one runs, after it -- the agent started if it is not
        running. A turn of the agent's running or waiting takes it in either mode. The session as `list` has it;
        the message kept in its gatherer as sent from Chat (actions.py's `chat_sent`) -- a new codex session's once it
        has its thread (`_rename`), the id it is started under being no channel of the gatherer's."""
        got = self._send(session_id, text, cols, rows, fullscreen)
        text, sid = (text or "").strip(), got.get("session_id")
        with self.lock:                          # a codex session still under the id it was started under: no channel yet
            s = self._row(sid)
            if s is not None and picks_id(s["harness"]) and s["started_as"] == sid:
                self.unsent.setdefault(sid, []).append((text, time.time()))
                return got
        actions.chat_sent(got.get("gatherer"), sid, text)
        return got

    def _send(self, session_id: str, text: str, cols: int, rows: int, fullscreen: bool) -> dict:
        text = (text or "").strip()
        if not text:
            raise SessionError("an empty message")
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
                        raise SessionError(f"the session is open in another process ({held['pid']}): close it there first")
                    self._exec(s, text)
                return next(x for x in self.list() if x["session_id"] == s["session_id"] or x["session_id"] == session_id)
            if a is not None and a.kept and a.proc.poll() is None:   # being put away: the process after it takes it
                a.queue.append(text)
                self._changed(s["gatherer"], session_id)
                return next(x for x in self.list() if x["session_id"] == session_id)
            if a is not None and a.taken:
                raise SessionError("the session was taken over by another process: close it there first")
            if a is None or a.proc.poll() is not None:
                held = holder(s["gatherer"], session_id)
                if held is not None:
                    raise SessionError(f"the session is open in another process ({held['pid']}): close it there first")
                a = self._start(s)
            a.queue.append(text)
            if not a.busy:
                self._next(session_id, a)
            else:
                self._changed(s["gatherer"], session_id)        # it waits: shown as waiting
            return next(x for x in self.list() if x["session_id"] == session_id)

    def stop(self, session_id: str) -> dict:
        """The session's agent ended: its stdin closed, so it exits and the session shows Closed until
        the next message resumes it; a kept session with no process is closed so at once. In the middle
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
                    os.killpg(a.proc.pid, signal.SIGTERM)
                except OSError:
                    pass
            return next(x for x in self.list() if x["session_id"] == session_id)

    def discard(self, session_id: str) -> None:
        """A session that never started, forgotten (module doc): its row deleted, and the dashboard's rows of it as an
        actor (ACTOR_TABLES). Refused while a process of the dashboard's runs for it, or a message waits for one, and
        once a turn of it has ended; that its gatherer has nothing of it is the caller's to tell (data.py's)."""
        with self.lock:
            s = self._row(session_id)
            if s is None:
                raise SessionError(f"no session {session_id} started from the dashboard")
            a = self.agents.get(session_id)
            if session_id in self.terms or (a is not None and (a.proc.poll() is None or a.queue)) \
                    or s["status"] in ("starting", "running", "idle", "terminal"):
                raise SessionError("it is running: close it first")
            if s["turns"]:
                raise SessionError("it has had a turn: close it instead")
            conn = self._db()
            try:
                conn.execute("BEGIN IMMEDIATE")
                conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
                for table in ACTOR_TABLES:
                    try:
                        conn.execute(f"DELETE FROM {table} WHERE gatherer = ? AND channel = ?", (s["gatherer"], session_id))
                    except sqlite3.OperationalError:     # no such table yet: nothing of it there
                        pass
                conn.execute("COMMIT")
            finally:
                conn.close()                             # not committed: rolled back
            for kept in (self.agents, self.answered, self.renames, self.unsent):
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
            raise SessionError(f"{s['harness']} has no headless mode here: open it in a terminal")
        return [*ag_command(), "--gatherer", s["gatherer"], s["harness"],
                *h.headless_args(s["session_id"], resume=resume, model=s.get("model"), permission_mode=s["permission_mode"],
                                 instructions=instructions(s), extra=tuple(extra_args(s)))]

    def _start(self, s: dict) -> _Agent:
        """A session's agent run headless, one process for the session (its harness's `headless` "session"): each
        message a line on its stdin (`_next`), each turn's end an event on its stdout (`_read`)."""
        sid = s["session_id"]
        told = instructions(s)
        argv = self._headless(s, bool(s["turns"]))
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
        argv = self._headless(s, bool(s["turns"]))
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
        """A turn's output, until its process exits, as its harness reads it (`headless_event`): the session's own id
        (the session renamed to it: codex's thread), its end, an error; then the next waiting message, as a turn of its
        own."""
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
            if got.get("session"):
                with self.lock:
                    session_id = self._rename(session_id, got["session"])
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

    def _rename(self, old: str, new: str) -> str:
        """The session started as `old`, now known as its harness's `new` (codex's thread): its row, its
        process, its log moved over, `started_as` kept, the messages sent from Chat before kept in its channel now
        (`send`). The id it has now (the lock held)."""
        if old == new or not SESSION_ID.fullmatch(new):
            return old
        conn = self._db()
        try:
            if conn.execute("SELECT 1 FROM sessions WHERE session_id = ?", (new,)).fetchone():
                return old                       # another row has it already
            conn.execute("UPDATE sessions SET session_id = ?, started_as = coalesce(started_as, ?) WHERE session_id = ?",
                         (new, old, old))
            row = conn.execute("SELECT gatherer FROM sessions WHERE session_id = ?", (new,)).fetchone()
        finally:
            conn.close()
        for table in (self.agents, self.terms):
            if old in table:
                table[new] = table.pop(old)
        for text, at in self.unsent.pop(old, []) if row is not None else []:
            actions.chat_sent(row["gatherer"], new, text, at)
        try:
            os.replace(log_path(old), log_path(new))
        except OSError:
            pass
        if row is not None:
            self._changed(row["gatherer"], old)
            self._changed(row["gatherer"], new)
        return new

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
                          last_error="the session was taken over by another process: close it there first")
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
                        raise SessionError("a turn is running: wait for it to end")
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
                    raise SessionError(f"the session is open in another process ({held['pid']}): close it there first")
                t = self._start_terminal(self._row(session_id), cols, rows, fullscreen, prompt)
                if prompt:
                    t.typed = time.time()
            else:                                    # open already (opened meanwhile): the prompt typed into it
                self.resize(session_id, cols, rows)
                if prompt:
                    self._paste(self.terms[session_id], prompt)
            return next(x for x in self.list() if x["session_id"] == session_id)

    def _start_terminal(self, s: dict, cols: int, rows: int, fullscreen: bool = False,
                        prompt: Optional[str] = None) -> _Term:
        sid = s["session_id"]
        resume = bool(s["turns"]) or _has_calls(s["gatherer"], sid)
        h = harness_kit.get(s["harness"])               # its own options: the harness's (harness_kit's `command`)
        if h is None:
            raise SessionError(f"no rules for {s['harness']} to start it with")
        first = h.first_prompt(prompt) if prompt else []     # its first message, never read as an option
        told = instructions(s)
        argv = [*ag_command(), "--quiet", "--gatherer", s["gatherer"], s["harness"],     # quiet: ag's notes not on its screen
                *extra_args(s), *h.command(sid, resume=resume, model=s.get("model"), permission_mode=s["permission_mode"],
                           fullscreen=fullscreen, instructions=told), *first]
        screen = h.screen_env(fullscreen)            # its screen as asked, whatever the dashboard's own environment says
        env = {**{k: v for k, v in actor_env(s, agent_env()).items() if k not in OUTER_TERMINAL and k not in screen},
               "TERM": "xterm-256color", "COLORTERM": "truecolor", **{k: v for k, v in screen.items() if v is not None}}
        os.makedirs(os.path.dirname(log_path(sid)), exist_ok=True)
        log = open(log_path(sid), "a", encoding="utf-8", buffering=1)
        log.write(f"--- {_now()} terminal{' (full screen)' if fullscreen else ''} {shlex.join(_unsaid(argv[:len(argv) - len(first)], told))}"
                  f"{' -- <the message sent>' if first else ''}\n")       # the message not logged: a line of it is no line of ag's
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
        self.terms[sid] = t
        if resume and not s["turns"]:
            self._set(sid, turns=1)
        self._set(sid, status="terminal", last_error=None, kept=0)
        t.reader = threading.Thread(target=self._read_terminal, args=(sid, t), daemon=True)
        t.reader.start()
        if picks_id(s["harness"]) and not resume:  # its own id for the session, once its first call names it
            threading.Thread(target=self._find_thread, args=(sid, s["gatherer"], t), daemon=True).start()
        return t

    def shell(self, gatherer: str, cwd: str, cols: int = 120, rows: int = 32) -> dict:
        """A new shell (module doc), listed under `gatherer`: the user's login shell in `cwd`, in a terminal
        `cols` x `rows`, in the environment a session's terminal has. The shell as `shells` has it."""
        if not TERMINALS:
            raise SessionError("a terminal needs a Unix pseudo-terminal, which this system does not have")
        gatherer = (gatherer or "").strip()
        if not GATHERER.fullmatch(gatherer):
            raise SessionError("a gatherer's name may hold letters, digits, '.', '_' and '-' only")
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
            self._shells[shell_id] = {"id": shell_id, "gatherer": gatherer, "cwd": cwd, "since": t.since}
            t.reader = threading.Thread(target=self._read_terminal, args=(shell_id, t), daemon=True)
            t.reader.start()
            self._changed(gatherer, shell_id)
            return dict(self._shells[shell_id])

    def shells(self) -> List[dict]:
        """The shells open (`shell`), the oldest first: {id, gatherer, cwd, since}."""
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

    def _find_thread(self, session_id: str, gatherer: str, t: _Term) -> None:
        """A new codex terminal's thread, looked for in the gatherer's calls each second while it runs:
        the session renamed to it once found."""
        while t.exited is None:
            with self.lock:
                if self.terms.get(session_id) is not t:
                    session_id = next((k for k, v in self.terms.items() if v is t), None)
                    if session_id is None:
                        return
                found = _thread_of(gatherer, t.pid, {x["session_id"] for x in stored()})
                if found:
                    self._rename(session_id, found)
                    s = self._row(found)
                    if s is not None and not s["turns"]:
                        self._set(found, turns=1)
                    return
            time.sleep(THREAD_POLL)

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
        try:
            _, status = os.waitpid(t.pid, 0)
            code = os.waitstatus_to_exitcode(status)
        except ChildProcessError:
            code = -1
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
                rows, cols = struct.unpack("HHHH", fcntl.ioctl(t.fd, termios.TIOCGWINSZ, b"\0" * 8))[:2]
                short = struct.pack("HHHH", rows - 1 if rows > 5 else rows + 1, cols, 0, 0)
                drawn = t.drawn
                fcntl.ioctl(t.fd, termios.TIOCSWINSZ, short)
                self._sized(t, cols, rows - 1 if rows > 5 else rows + 1)
            with t.changed:
                t.changed.wait_for(lambda: t.drawn > drawn or t.exited is not None, REDRAW_WAIT)
            with t.sizing:                           # unless the page has sized it meanwhile
                if fcntl.ioctl(t.fd, termios.TIOCGWINSZ, b"\0" * 8) == short:
                    fcntl.ioctl(t.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
                    self._sized(t, cols, rows)
        except OSError:                              # its terminal gone meanwhile
            pass
        finally:
            t.redrawing = False

    def type(self, session_id: str, data: str) -> None:
        """What was typed in the page, to the session's terminal, as typed. A key that stops a turn, typed while the
        dashboard's own keys go in -- a message it pastes (`_paste`), an answer (`answer`) -- after them: in the middle,
        it would cut the message off from its Enter or dismiss the question half answered."""
        t = self.terms.get(session_id)
        if t is None:
            raise SessionError("the session has no terminal open")
        if data in STOP_KEYS and (t.answering or t.keying > time.time()):
            threading.Thread(target=self._type_after, args=(session_id, t, data), name="ag-stop-key", daemon=True).start()
            return
        self._type_now(session_id, t, data)

    def _type_after(self, session_id: str, t: _Term, data: str) -> None:
        end = time.time() + HOLD_MAX
        while (t.answering or t.keying > time.time()) and time.time() < end:
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
        """What the session's terminal asks (data.py's `asking`: a question, a plan to approve) answered with
        `choice` (answers.py): its keys typed into the terminal one at a time, ANSWER_GAP apart, as if picked
        there. Refused where the dashboard has no terminal for the session, or where something was typed into
        it since it asked -- its dialog may no longer be as it first showed -- or, codex's, where the terminal
        opened after it asked: codex does not ask again on resuming. -> the answer, as `list` then has it:
        {call, summary, expect (what the harness's result for the call will hold), at}."""
        with self.lock:
            t = self.terms.get(session_id)
            if t is None:
                raise SessionError("the dashboard does not run this session's terminal: answer it in the one that does")
            if t.answering:
                raise SessionError("an answer is being typed into it already")
            from . import data                       # data imports this module
            typed = max(t.typed or 0, data.typed_at((self._row(session_id) or {}).get("gatherer") or "", session_id) or 0)
            if typed and ask.get("at") and typed >= ask["at"]:      # here, or as the gatherer kept it (terminal_input)
                raise SessionError("something was typed into its terminal since it asked: finish answering there")
            rules = harness_kit.get(ask.get("harness") or harness_kit.DEFAULT)
            if rules is not None and not rules.asks_shown_again and ask.get("at") and t.since > ask["at"]:
                raise SessionError("its terminal opened after it asked, and does not ask it: answer in a message")
            keys = answers.keys(ask, choice)             # AnswerError, a ValueError: a choice that does not fit
            sent = {"call": ask.get("call"), "summary": answers.summary(ask, choice),
                    "expect": answers.expected(ask, choice), "at": time.time()}
            self.answered[session_id] = sent
            t.answering = True
            gatherer = (self._row(session_id) or {}).get("gatherer")
        actions.answer_given(gatherer, session_id, sent)        # kept in its gatherer
        threading.Thread(target=self._keys, args=(t, keys), daemon=True).start()
        self._changed(gatherer, session_id)
        return sent

    def _keys(self, t: _Term, keys: List[str]) -> None:
        try:
            for k in keys:
                self._write(t, k.encode("utf-8"))
                time.sleep(ANSWER_GAP)
        except SessionError:
            pass
        finally:
            t.answering = False

    def resize(self, session_id: str, cols: int, rows: int) -> None:
        """The terminal is `cols` x `rows` now: its process is told (SIGWINCH)."""
        t = self.terms.get(session_id)
        if t is None:
            raise SessionError("the session has no terminal open")
        cols, rows = max(20, min(int(cols), 500)), max(5, min(int(rows), 200))
        try:
            with t.sizing:
                fcntl.ioctl(t.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
                self._sized(t, cols, rows)
        except OSError:
            pass

    def _sized(self, t: _Term, cols: int, rows: int) -> None:
        """Its screen (`_box`) made `cols` x `rows`, as its terminal is: what it prints from now on is drawn at that size."""
        with t.screen_lock:
            if t.screen is not None:
                t.screen.resize(cols, rows)

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
            raise NotAtBox(f"Something is typed in {name}'s message box in its terminal and not sent: "
                           f"send or clear it there, then send this.", box)
        raise NotAtBox(f"{name}'s terminal shows a dialog, a menu or a question, not its message box: "
                       f"finish it or close it there (Esc), then send this.", box)

    def _write(self, t: _Term, data: bytes) -> None:
        try:
            while data:
                data = data[os.write(t.fd, data):]
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
        t.typed, t.stopped, t.drafted = now, 0.0, 0
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

