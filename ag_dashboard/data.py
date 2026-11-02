"""What the dashboard shows, read from the context manager's home -- every gatherer's
database, opened read-only, and ag's own logs -- as plain JSON-ready dicts.

    home()                        every gatherer and its agents (channels), with their
                                  status; the hook servers ag started
    agent(gatherer, channel)      one agent over time: each read's size (ag's own count,
                                  the provider's, the harness's limit), its rebuilds, its
                                  tasks and how many had begun by each read, its builds,
                                  and the Gatherer's model calls made for it; and
                                  every token it was sent across its calls, by kind; and
                                  what the user wrote to it as it worked (`typed`)
    read(gatherer, read_id)       what one read put in the agent's context, by kind
    context(gatherer, read_id)    every item of it, in order, with its text
    history(gatherer, channel, a, b)  the agent's own events from row a to b: a task's messages
    transcript(gatherer, channel, ...)  its conversation, each event as harness-free parts

An agent is a channel of a gatherer: one harness session (codex's thread, Claude Code's
session, ...), some of them started from the page (sessions.py); which harness, as its hook recorded it with each call
(`model_call`; a session from before, as its gatherer's old tables were copied: `harness`). Its STATUS (`status_of`):
CLOSED when the harness's process that made its last call no longer runs; else IDLE when its turn
is over -- its last answer ended without a tool call -- and RUNNING when it is not (waiting on a
tool, or on the model). Where the process is not known (a call from before ag recorded it, not
Linux), a turn left unfinished for more than STALE_SECONDS counts as over. A session the dashboard
started whose process its own end took, or it put away (saved.py's `Rest`) -- sessions.py's `kept` --
is IDLE, not CLOSED; one whose process the dashboard saw end otherwise (closed from the list, exited:
sessions.py's `ended`) is CLOSED where
the process cannot be told, unless something happened for it since. An IDLE agent whose BACKGROUND
tasks still run (`background`) is BACKGROUND: its turn is over, but Claude Code is not done. A RUNNING
agent whose turn waits on the user (`asking`) is ASKING: its hook recorded that an answer asks the user in its
terminal (`asked`: a question, a plan to approve; codex's, as its rollout says) -- and nothing comes until they
answer -- and nothing says the call has its result yet (`ask_settled`; `Record.settled`): answered there, the turn
goes on; dismissed there (Esc), no call comes -- IDLE, its turn over.
Answered from the page (sessions.py's `answer`), its `answer`
says whether Claude Code's result for the call holds what was picked (`recorded`; None: no result yet).
A RUNNING agent may also have stopped where ag does not see it. A model call that FAILED is recorded by ag's
hook server (`call_failed`, by its read): `failing` is the run of them at the newest event the agent's
calls answered -- the harness tries again, each try a read -- and whether a try is under way. Claude Code's
own record of the session says how its turn STOPPED, when that came after ag last heard of the session -- its
newest call, or a message ag stored since, as a new turn's read began (`began`; `Record.stopped`): Claude
Code's API error -- it gave up on the model call, its tries spent, or the error not one to try again -- is ERROR; the user's interruption (Esc), which makes no
call, IDLE. A failed call with no try since for GIVE_UP_SECONDS counts as given up too -- with no record
followed (a session of another machine; a hook server from before it followed them), or one that says nothing: Esc while Claude Code waits to try again
stops it without a word -- ERROR; GIVE_UP_LONG where the record could still say, the endpoint having answered
an error that may ask for a longer wait (Retry-After). `running` is RUNNING or BACKGROUND, or a build running for it. Its `last` is its latest activity: a call (its read), or an
answer to one, recorded as it came (`reply_part`, `reply_end`) -- the reply that ends a turn among them, which no
call stores until the user writes again -- what the page compares with when the reader last
looked at it, to show it FINISHED. Not the events stored: a side call of Claude Code's (a recap, a prompt
suggestion) stores the conversation's -- the reply that ended the turn among them, minutes after it came --
which is no activity of the agent's; only an agent with no reads (a history loaded whole) goes by its newest
event. A REBUILD is a
read whose context comes from another build than the agent's read before it: the condensed
history was replaced.

A BACKGROUND TASK is one the harness started and went on without (`background`): a command run in the
background, an agent, a monitor, a workflow. Its hook records that it started (`task_started`: its tool's result
said so, or a SendMessage resumed an agent; codex's, its rollout), its signs of life (`task_activity`: its output
growing, a monitor's event, an agent waiting on its own background work) and its end (`task_ended`: a notification
with a status, an agent's report handed back, TaskStop's result, a monitor that expired). One not ended still runs,
while its session's process does: none when that process is known gone, or started after the task (a process the
dashboard runs, `session.since`; else the reads that named it). Where the process is not known, one with no sign of
life for STALE_SECONDS counts as over.

Each read has these sizes: `sent_tokens`, ag's own count of everything it sent (what the
read returned, `_read_items`, added up, by the sizes stored now -- what read() breaks down);
`preamble_tokens`, its count of what the harness sent besides (None: not recorded);
`recorded_tokens`, ag's count of all the call sent, preamble included, as the read log kept it
at the call (`_reads.sent_tokens`, less what the harness left out; None: not kept) -- what ag
believed then, which a size set since (a provider's count, a thinking block no longer sent and
set to 0) does not change; `est_tokens`, the
policy's count of it against its budget (which leaves out the agent's preamble and the
sections' fixed overview); and `real_tokens`, the provider's count. A database written
before a column existed reads as None there. Nothing here writes anything.
"""

import copy
import glob
import json
import os
import re
import sqlite3
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from . import home as paths
from . import seen as looked                    # `seen` names a file's stat here
from . import answers, avatars, hiding, live, saved, sessions
import harness_kit
from harness_kit import USERS, Kind
from harness_kit.base import output_of as _output  # noqa: F401 - a tool result's words, as files.py reads them

RUNNING_SECONDS = 120          # (no longer decides anything; kept for the page's older copies)
STALE_SECONDS = 1800           # an unfinished turn with no process to ask: over, after this long
FULL_SECONDS = 30.0            # a gatherer's agents kept between reads of the home (`Kept`): all read again this often
RUNNING, IDLE, CLOSED, BACKGROUND, ASKING, ERROR = "running", "idle", "closed", "background", "asking", "error"
ASK_CHARS = 4000               # the most of a question's words `ask_view` returns
PLAN_CHARS = 20000             # the most of a plan it returns
GIVE_UP_SECONDS = 90           # a failed call with no try since: given up (Claude Code waits at most ~40 s
                               # between its tries)
GIVE_UP_LONG = 600             # the same for an error answered, where the record could still say (Retry-After)
FAILED_READS = 50              # how many of its newest reads `failing` looks at
#: A call the harness hung up on before its answer was through, as ag's hook server reports it (its HUNG_UP: nginx's
#: "client closed request"): the user stopped it (Esc) -- not a failure.
HUNG_UP = 499
ERROR_CHARS = 2000             # the most of an error's words it returns
#: An answer's stop reason, as the provider gives it: the turn goes on (a tool to run, a paused
#: turn, or ag's "streaming": the parts of an answer complete while the rest still streams), or is
#: over. Any other (Codex's `completed` on every answer, none) tells nothing: its last event does.
STREAMING = "streaming"
GOES_ON = {"tool_use", "pause_turn", STREAMING}
OVER = {"end_turn", "stop_sequence", "max_tokens", "refusal"}
CHANNEL = "p_channel"          # the channel property's column (ag.ag_policies.tools.channel)
# A channel's events and reads are found by ifnull(CHANNEL, '') = ?, as ag's indexes on them have it (schema.index):
# by the bare column, SQLite cannot use them and reads every event of the gatherer.


#: The events a harness's hook records of a session besides its conversation (ag's
#: integrations/tools/ag_orchestrator/records.py) and the dashboard of what it did: read for what they say, never shown
#: as the conversation.
RECORDS = ("model_call", "reply_part", "reply_end", "call_failed", "recap", "name", "harness", "session_file", "asked",
           "ask_settled", "turn_stopped", "task_started", "task_ended", "task_activity", "message_queued", "message_sent",
           "message_withdrawn", "file_touched", "chat_sent", "answer_given", "terminal_input", "actor_message", "role")
#: What the harness's own record of a session says (its file: Claude Code's under its projects folder, codex's
#: rollout), as the hook records it while it follows the record (ag's session_files.py; harness_kit's Facts): the
#: record followed (`session_file`), then a fact per thing the record says that no model call carries.
FACTS = ("session_file", "message_queued", "message_sent", "message_withdrawn", "asked", "ask_settled", "turn_stopped",
         "task_started", "task_ended", "task_activity")
FACTS_READ = 400               # the newest of an actor's facts read for its status
#: A background task's signs of life, recorded every few seconds while its output grows: read apart from its other facts
#: (the newest ACTIVITY_READ), so that a task left running never pushes its own start, or what is asked, out of FACTS_READ.
ACTIVITY, ACTIVITY_READ = "task_activity", 200
MESSAGES_READ = 200            # the newest of its messages' facts read for what the user wrote as it worked
SENT_SECONDS = 30.0            # a message sent from the queue: shown as written until ag stores it, at most this long
PROMPT_SECONDS = 120.0         # one sent between turns: the same
CHAT_SECONDS = 60.0            # one sent from Chat the harness has not had: shown as pending at most this long
COORDINATOR_NAME = "Gatherer agent"   # the name a gatherer agent (sessions.py's role) has, unless the reader gives one
#: SQL: an event (`e`) that is the conversation, not a record.
NOT_RECORD = ("e.event_type_id NOT IN (SELECT event_type_id FROM event_types WHERE name IN ("
              + ", ".join(f"'{t}'" for t in RECORDS) + "))")
#: SQL: an event (`e`) joined to its type (`t`) for one channel's records of a type, SQLite kept on the channel's index
#: (events_id) by the `+`. Joined on e.event_type_id itself it searches by type, through every channel's records newer
#: than the row asked for -- once per actor, so the list slowed with every record in the gatherer.
BY_CHANNEL = "t.event_type_id = +e.event_type_id"


def _connect(gatherer: str) -> Optional[sqlite3.Connection]:
    path = paths.db_path(gatherer)
    if not os.path.exists(path):
        return None
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=8)
    conn.row_factory = sqlite3.Row
    return conn


def _columns(conn, table: str) -> set:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


#: What an actor's views answer before its gatherer has stored anything: ag adds the channel's column
#: with the first event, so a gatherer made (`ag new`) whose first session has sent nothing has none.
NOTHING_YET = {"error": "Nothing stored yet: the session has sent no message through ag."}


def _channels_kept(conn) -> bool:
    return CHANNEL in _columns(conn, "events")


def _tables(conn) -> set:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def _seconds(value) -> Optional[float]:
    """Seconds since the epoch, from an ISO time or a number; None if neither."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        stamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.timestamp()


def gatherer_names() -> List[str]:
    root = paths.gatherers_dir()
    if not os.path.isdir(root):
        return []
    return sorted(n for n in os.listdir(root)                 # a database, or a config: made, no session yet
                  if any(os.path.exists(os.path.join(root, n, f)) for f in ("context.db", "gatherer.toml")))


def _made(gatherer: str) -> Optional[float]:
    """When the gatherer's config was written: when it was made, for one no session has run in yet."""
    try:
        return os.path.getmtime(os.path.join(paths.gatherer_dir(gatherer), "gatherer.toml"))
    except OSError:
        return None


def _policy(gatherer: str) -> Optional[str]:
    try:
        with open(os.path.join(paths.gatherer_dir(gatherer), "gatherer.toml"), encoding="utf-8") as fh:
            for line in fh:
                if line.strip().startswith("policy"):
                    return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    return None


def _running_builds(conn) -> set:
    if "_builds" not in _tables(conn):
        return set()
    return {r[0] for r in conn.execute("SELECT channel_key FROM _builds WHERE status = 'running'")}


def _hook_servers() -> List[dict]:
    try:
        return paths.hook_servers()
    except Exception:  # noqa: BLE001 - the dashboard shows what it can
        return []


def home(started: Optional[List[dict]] = None, kept: Optional["Kept"] = None) -> dict:
    """Every gatherer and its agents, each newest created first (`created`: its first event), and
    the hook servers ag started, which gatherers the reader hid or kept (`hiding`, hiding.py), which
    actors they saved for later (`saved`, saved.py), and when they last looked at each (`seen`, seen.py:
    None, never kept).
    `started` is the sessions started from the page (sessions.py's `list`; else its table, read):
    each one's agent carries it as `session`, and one with no events yet -- its gatherer perhaps
    not made yet -- is listed all the same. `kept`: the agents as read before, read again only as far as
    they changed (`Kept`); else every agent is read."""
    now = time.time()
    gatherers = []
    started = sessions.stored() if started is None else started
    named: Dict[str, Dict[str, dict]] = {}   # the names of sessions started here with no message yet, which `_agents` lists not
    for name in gatherer_names():
        conn = _connect(name)
        if conn is None:                 # made (`ag new`), no session has run in it yet
            gatherers.append({"name": name, "policy": _policy(name), "agents": [], "last": None})
            continue
        try:
            agents = kept.agents(conn, name, now) if kept is not None else _agents(conn, now)
            if {s["session_id"] for s in started if s["gatherer"] == name} - {a["channel"] for a in agents}:
                named[name] = _names(conn, _tables(conn))
        except sqlite3.Error as exc:
            gatherers.append({"name": name, "policy": _policy(name), "error": str(exc), "agents": [], "last": None})
            continue
        finally:
            conn.close()
        gatherers.append({"name": name, "policy": _policy(name), "agents": agents,
                          "last": max((a["last"] or 0 for a in agents), default=0) or None})
    _with_started(gatherers, started, now, named)
    wakes = {}                           # the actors whose status changes at a time of their own, with nothing written
    for g in gatherers:
        for a in g["agents"]:
            wake = a.pop("wake", None)
            if wake:
                wakes[(g["name"], a["channel"])] = wake
    live.wake_at(wakes)
    for g in gatherers:                  # when it was made: its first event, else its config's time
        g["created"] = min((a["created"] for a in g["agents"] if a.get("created")), default=None) or _made(g["name"])
    gatherers.sort(key=lambda g: g.get("created") or 0, reverse=True)
    return {"home": paths.HOME, "now": now, "running_seconds": RUNNING_SECONDS, "gatherers": gatherers,
            "hook_servers": _hook_servers(), "hiding": hiding.stored(), "saved": saved.stored(),
            "seen": looked.stored(), "harness_info": harness_info(), "harness_default": harness_kit.DEFAULT}


_HARNESS_INFO: Optional[Dict[str, dict]] = None


def harness_info() -> Dict[str, dict]:
    """What the page shows of each harness harness_kit knows, by its name -- the page names none itself:
        label       its name, for a person
        mark        its mark, an SVG (harness_kit/marks/<name>.svg); None: it has none
        runs        whether a session can be started on it from here (its `command`): Chat may message one
        fullscreen  the screen its terminal runs in: its full screen, else its classic one, scrolled by the page
        stopped     how its terminal says a turn stopped short (`stopped_says`)
        ask_says    how a reader answers what it asks: its words, the ways to take a plan (`ask_says`)
        reply_block a block its model writes in a reply that its terminal draws apart, as a card (`reply_block`)
        mcp         whether a run of it can be given an MCP server's tools (`mcp_args`): a DocWriter's, a Browser's
        memory_folder  where it keeps its memory of a directory, a pattern of the folder's path (`memory_folder`)
        saves       what History can save where it reads it, by kind (`saves`)
    Read once: what harness_kit says does not change while the dashboard runs."""
    global _HARNESS_INFO
    if _HARNESS_INFO is None:
        _HARNESS_INFO = {n: {"label": h.label or n, "mark": h.mark(), "runs": h.runs_in_terminal,
                             "fullscreen": h.fullscreen, "stopped": dict(h.stopped_says), "ask_says": dict(h.ask_says),
                             "reply_block": h.reply_block, "mcp": h.mcp_args("x", "http://x") is not None,
                             "memory_folder": h.memory_folder, "saves": dict(h.saves)}
                         for n, h in harness_kit.HARNESSES.items()}
    return _HARNESS_INFO


def actors(gatherer: str, channels: set, started: List[dict]) -> List[dict]:
    """The agents `channels` of `gatherer`, each as home() has it, with `started`'s sessions of them (sessions.py's
    `list`) -- read for them alone, so at a small part of its cost; nothing is watched from it from now on (home()'s
    wakes stay as they were). sqlite3.Error: the gatherer's database could not be read."""
    now = time.time()
    conn = _connect(gatherer)
    try:
        agents = _agents(conn, now, set(channels)) if conn is not None else []
    finally:
        if conn is not None:
            conn.close()
    g = [{"name": gatherer, "agents": agents, "last": None}]
    _with_started(g, [s for s in started if s["gatherer"] == gatherer and s["session_id"] in channels], now)
    for a in g[0]["agents"]:                     # what home() would watch: not from here
        a.pop("wake", None)
    return g[0]["agents"]


def gatherer_actors(gatherer: str, started: List[dict]) -> List[dict]:
    """Every agent of `gatherer`, each as home() has it, with `started`'s sessions of it (sessions.py's `list`) -- the
    gatherer read alone; nothing is watched from it from now on (home()'s wakes stay as they were). [] for a gatherer
    with no database yet but for its sessions started here. sqlite3.Error: its database could not be read."""
    now = time.time()
    conn = _connect(gatherer)
    named: Dict[str, Dict[str, dict]] = {}
    try:
        agents = _agents(conn, now) if conn is not None else []
        mine = [s for s in started if s["gatherer"] == gatherer]
        if conn is not None and {s["session_id"] for s in mine} - {a["channel"] for a in agents}:
            named[gatherer] = _names(conn, _tables(conn))
    finally:
        if conn is not None:
            conn.close()
    g = [{"name": gatherer, "agents": agents, "last": None}]
    _with_started(g, mine, now, named)
    for a in g[0]["agents"]:                     # what home() would watch: not from here
        a.pop("wake", None)
    return g[0]["agents"]


class Kept:
    """The home's agents, kept between its reads (home()'s `kept`): a gatherer's read again only for the channels it was
    told changed since (`changed`: the hub's `on_change`, rung by ag's notifications) -- a provider's count of a read
    (ag's "counts", which names the read, not its channel): the read's channel; a process opening a session ("open",
    named by neither): the sessions whose row in `_open` changed. The whole of it at first, and when told of nothing
    more (a write that named no channel; the fallback check of the files, where ag told of nothing lately) or of no
    gatherer. And every FULL_SECONDS, for what time alone changes (a process gone with no word, a turn gone stale) and a
    notification lost, read whole in the background (`refreshed`, told when it is done): a whole read of a big gatherer
    is most of a second -- seconds, its file out of the cache -- which no reader waits on then; the one that changed, a
    few ms. (What changes at a time of its own, a failed call given up, is rung then: live.py's `wake_at`.)"""

    def __init__(self, refreshed: Optional[Any] = None):
        self.lock = threading.Lock()
        self.reading = threading.Lock()              # one read at a time: none given what another is reading again
        self.refreshed = refreshed                   # (gatherer) once a background read of it is kept
        self.kept: Dict[str, Dict[str, dict]] = {}   # gatherer -> channel -> its agent, as `_agents` read it
        self.at: Dict[str, Dict[str, float]] = {}    # gatherer -> channel -> when that was read
        self.read: Dict[str, float] = {}             # gatherer -> when it was last read whole
        self.told: Dict[str, Optional[set]] = {}     # gatherer -> the channels changed since (None: all of it)
        self.reads: Dict[str, set] = {}              # gatherer -> the reads counted since, whose channels changed
        self.opened: set = set()                     # the gatherers some session was opened in since
        self.open: Dict[str, Dict[str, tuple]] = {}  # gatherer -> its `_open` rows by session, as last read
        self.stale = 0.0                             # a gatherer read whole before this: read whole again
        self.refreshing: Dict[str, threading.Thread] = {}   # gatherer -> its whole read in the background

    def changed(self, gatherer: Optional[str], channel: Optional[str], what: str = "", row: Optional[int] = None) -> None:
        """Something of `gatherer` (its directory's name; None: any) changed, for `channel` (None: not named) -- `what`
        ag wrote, `row` its row (ag/ag_tools/notify.py's)."""
        with self.lock:
            if gatherer is None:
                self.stale = time.time()
            elif channel is None and what == "counts" and row is not None:
                self.reads.setdefault(gatherer, set()).add(row)
            elif channel is None and what == "open":
                self.opened.add(gatherer)
            elif channel is None:
                self.told[gatherer] = None
            elif self.told.get(gatherer, set()) is not None:
                self.told.setdefault(gatherer, set()).add(channel)

    def agents(self, conn, gatherer: str, now: float) -> List[dict]:
        """The gatherer's agents as `_agents` reads them, newest created first -- copies, the caller's to change.
        sqlite3.Error: its database could not be read (read whole the next time). One caller at a time: another
        given the agents kept while this one reads a channel told of again would have that channel as it was, and
        be told of it no more."""
        with self.reading:
            return self._agents(conn, gatherer, now)

    def _agents(self, conn, gatherer: str, now: float) -> List[dict]:
        with self.lock:
            told, reads = self.told.pop(gatherer, set()), self.reads.pop(gatherer, set())
            opened = gatherer in self.opened
            self.opened.discard(gatherer)
            whole = told is None or gatherer not in self.kept or self.read[gatherer] < self.stale
            due = not whole and self.read[gatherer] < now - FULL_SECONDS and gatherer not in self.refreshing
            if due:
                self.refreshing[gatherer] = threading.Thread(target=self._refresh, args=(gatherer,),
                                                             name="ag-home-refresh", daemon=True)
        if due:
            self.refreshing[gatherer].start()
        try:
            if whole:
                got, opens = _agents(conn, now), self._open(conn)
                with self.lock:
                    self.kept[gatherer], self.open[gatherer], self.read[gatherer] = {a["channel"]: a for a in got}, opens, now
                    self.at[gatherer] = {a["channel"]: now for a in got}
            else:
                told = set(told)
                if reads:
                    told.update(ch for (ch,) in conn.execute(
                        f"SELECT DISTINCT ifnull({CHANNEL}, '') FROM _reads WHERE read_id IN ({', '.join('?' * len(reads))})",
                        tuple(reads)))
                if opened:
                    after = self._open(conn)
                    with self.lock:
                        before, self.open[gatherer] = self.open.get(gatherer, {}), after
                    told.update(ch for ch in set(before) | set(after) if before.get(ch) != after.get(ch))
                told.discard("")
                got = _agents(conn, now, told) if told else []
                with self.lock:
                    self.kept[gatherer] = {**self.kept[gatherer], **{a["channel"]: a for a in got}}
                    self.at[gatherer].update((a["channel"], now) for a in got)
        except sqlite3.Error:
            with self.lock:
                self.told[gatherer] = None
            raise
        with self.lock:
            agents = list(self.kept[gatherer].values())
        return copy.deepcopy(sorted(agents, key=lambda a: a["created"] or 0, reverse=True))

    def _refresh(self, gatherer: str) -> None:
        """The gatherer read whole, on a connection of its own, and kept -- but where a channel was read since it began,
        that read: it is newer."""
        began = time.time()
        conn = _connect(gatherer)
        try:
            got, opens = (_agents(conn, began), self._open(conn)) if conn is not None else (None, None)
        except sqlite3.Error:
            got = None
        finally:
            if conn is not None:
                conn.close()
            with self.lock:
                self.refreshing.pop(gatherer, None)
        if got is None:
            return
        with self.lock:
            at = self.at.setdefault(gatherer, {})
            kept = self.kept.setdefault(gatherer, {})
            for a in got:
                if at.get(a["channel"], 0.0) < began:
                    kept[a["channel"]], at[a["channel"]] = a, began
            self.open[gatherer], self.read[gatherer] = opens, max(self.read.get(gatherer, 0.0), began)
        if self.refreshed:
            self.refreshed(gatherer)

    @staticmethod
    def _open(conn) -> Dict[str, tuple]:
        if "_open" not in _tables(conn):
            return {}
        return {r[0]: tuple(r[1:]) for r in conn.execute("SELECT session, pid, pid_started, opened_at, opened_by FROM _open")}


def _with_started(gatherers: List[dict], started: List[dict], now: Optional[float] = None,
                  named: Optional[Dict[str, Dict[str, dict]]] = None) -> None:
    """Each session started here on its agent (`session`); one with no message yet listed all the same, as idle, with
    the name the reader gave it (`named`: {gatherer: _names}), if any."""
    by_name = {g["name"]: g for g in gatherers}
    for s in started:
        g = by_name.get(s["gatherer"])
        if g is None:                    # a new gatherer: ag makes it on the session's first call
            g = by_name[s["gatherer"]] = {"name": s["gatherer"], "policy": None, "agents": [], "last": None}
            gatherers.append(g)
        a = next((x for x in g["agents"] if x["channel"] == s["session_id"]), None)
        if a is None:
            a = {"channel": s["session_id"], "events": 0, "last_event": None, "reads": 0, "last_read": None,
                 "cwd": s["cwd"], "tasks": 0, "est_tokens": None, "real_tokens": None, "limit_tokens": None,
                 "sent_tokens": None, "harness": s["harness"], "last_user_message": None, "recap": None,
                 "name": ((named or {}).get(s["gatherer"]) or {}).get(s["session_id"]),
                 "created": None, "last": _seconds(s["created_at"]), "building": False, "running": False,
                 "turn_over": True, "status": IDLE}
            g["agents"].append(a)
        a["session"] = s
        if s.get("role"):                        # the gatherer agent: named so unless the reader named it otherwise
            a["role"] = s["role"]
            if s["role"] == sessions.COORDINATOR and (a.get("name") or {}).get("by") != "user":
                a["name"] = {"text": COORDINATOR_NAME, "by": "dashboard"}
        offer = a.pop("offer", None)             # a plan offered: asked about where its terminal is the dashboard's, not
        if offer and s.get("terminal") and a["status"] == IDLE and (s.get("since") or 0) <= offer["at"] \
                and not (s.get("typed") and s["typed"] >= offer["at"]):     # restarted since, nor anything typed there
            a["asking"], a["status"] = offer, ASKING
        given = s.get("answer") or _answer_given(s["gatherer"], a["channel"])   # kept, should the dashboard restart
        if given:                                # the last answer typed from the page: what the harness made of it
            result = answer_result(s["gatherer"], a["channel"], given["call"])
            a["answer"] = {**given, "result": _clip(result, ASK_CHARS) if result else None,
                           "recorded": answers.recorded(result, given.get("expect") or [])}
        if a.get("holder") and paths.runs_under(a["holder"]["pid"], s.get("pid")):
            a["holder"]["dashboard"] = True          # the dashboard's own agent or terminal (or a process under it)
        a["created"] = min((x for x in (a["created"], _seconds(s["created_at"])) if x), default=None)
        if s["status"] in ("starting", "running") or s.get("queued"):   # its agent works, or a message waits for it
            a["status"], a["running"] = RUNNING, True
        elif s.get("kept") and a["status"] == CLOSED and (a["last"] or 0) <= s["kept"]:
            a["status"] = IDLE                   # ended by the dashboard's own end, not closed, nor used since
        elif s.get("ended") and not s.get("kept") and not s.get("pid") and a.get("alive") is None and not a.get("holder") \
                and (a["last"] or 0) <= s["ended"]:
            a["status"], a["running"] = CLOSED, bool(a.get("building"))   # its process gone, seen ending here, not used since
        g["last"] = max(g["last"] or 0, a["last"] or 0) or None
    for g in gatherers:                  # newest created first, as `_agents` has them
        for a in g["agents"]:
            a.pop("offer", None)
            a["chattable"] = chattable(a)
            _settle_background(a, time.time() if now is None else now)
        g["agents"].sort(key=lambda a: a.get("created") or 0, reverse=True)


def chattable(a: dict) -> bool:
    """Whether the page may message the agent: a session of a harness the dashboard runs (sessions.py's
    HARNESSES), with a directory to resume it in, that no other process has open (its `holder`, else the
    process its last call named) -- the dashboard's own agent or terminal aside, and any process under it
    (codex's real codex, under its wrapper)."""
    if a.get("harness") not in (*sessions.HARNESSES, None) or not (a.get("cwd") or a.get("session")):
        return False
    held = a.get("holder")
    if held:
        return bool(held.get("dashboard"))
    return a.get("alive") is not True or bool(a.get("session") and paths.runs_under(a.get("pid"), a["session"].get("pid")))


def _agents(conn, now: float, only: Optional[set] = None) -> List[dict]:
    """The gatherer's agents (`only`: those channels of them alone)."""
    if CHANNEL not in _columns(conn, "events"):
        return []
    sizes = [c for c in ("est_tokens", "real_tokens", "limit_tokens") if c in _columns(conn, "_reads")]
    out: Dict[str, dict] = {}
    asked = tuple(only or ())                        # by ifnull(channel, ''), as ag's indexes have it: not every event read
    which = lambda e: "" if only is None else f" AND ifnull({e}{CHANNEL}, '') IN ({', '.join('?' * len(asked))})"  # noqa: E731
    for r in conn.execute(f"SELECT {CHANNEL} AS ch, count(*) AS n, min(inserted_at) AS first, max(inserted_at) AS last FROM events e "
                          f"WHERE {CHANNEL} IS NOT NULL AND {NOT_RECORD}{which('e.')} GROUP BY {CHANNEL}", asked):
        out[r["ch"]] = {"channel": r["ch"], "events": r["n"], "created": _seconds(r["first"]), "last_event": _seconds(r["last"]), "reads": 0,
                        "last_read": None, "cwd": None, "tasks": 0, "est_tokens": None, "real_tokens": None,
                        "limit_tokens": None, "sent_tokens": None, "pid": None, "alive": None}
    if CHANNEL in _columns(conn, "_reads"):
        cols = _columns(conn, "_reads")
        for r in conn.execute(f"SELECT {CHANNEL} AS ch, count(*) AS n, max(read_at) AS last FROM _reads WHERE 1{which('')} "
                              f"GROUP BY {CHANNEL}", asked):
            if r["ch"] in out:
                out[r["ch"]].update(reads=r["n"], last_read=_seconds(r["last"]))
        cwd = "p_cwd" in cols
        process = [c for c in ("pid", "pid_started") if c in cols]
        for ch, a in out.items():
            last = conn.execute(f"SELECT {', '.join(['read_id'] + sizes + (['p_cwd'] if cwd else []))} FROM _reads "
                                f"WHERE ifnull({CHANNEL}, '') = ? ORDER BY read_id DESC LIMIT 1", (ch,)).fetchone()
            if last is not None:
                a.update({k: last[k] for k in sizes}, cwd=last["p_cwd"] if cwd else None,
                         sent_tokens=_sent(conn, last["read_id"]))
            if len(process) == 2:                    # the newest call that named its process
                p = conn.execute(f"SELECT pid, pid_started FROM _reads WHERE ifnull({CHANNEL}, '') = ? AND pid IS NOT NULL "
                                 f"ORDER BY read_id DESC LIMIT 1", (ch,)).fetchone()
                if p is not None:
                    a["pid"], a["alive"] = p["pid"], paths.process_alive(p["pid"], p["pid_started"])
                    a["since"] = _seconds(conn.execute(f"SELECT min(read_at) FROM _reads WHERE ifnull({CHANNEL}, '') = ? AND pid = ? "
                                                       "AND pid_started = ?", (ch, p["pid"], p["pid_started"])).fetchone()[0])
    if "_open" in _tables(conn):                     # which process has each session open (ag's launcher, its calls)
        for ch, pid, started, by, opened in conn.execute("SELECT session, pid, pid_started, opened_by, opened_at FROM _open"):
            if ch in out and paths.process_alive(pid, started) is not False:
                out[ch]["holder"] = {"pid": pid, "by": by}
                out[ch]["pid"], out[ch]["alive"], out[ch]["since"] = pid, True, _seconds(opened)
    if "tasks" in _tables(conn):
        for r in conn.execute("SELECT channel_key AS ch, count(*) AS n FROM tasks GROUP BY channel_key"):
            if r["ch"] in out:
                out[r["ch"]]["tasks"] = r["n"]
    answered = {}                                    # each agent's newest answer, recorded as it came (`reply_*`)
    for ch, t in conn.execute(f"SELECT e.{CHANNEL}, max(e.inserted_at) FROM events e JOIN event_types t ON "
                              f"t.event_type_id = {'e' if only is None else '+e'}.event_type_id WHERE t.name IN ('reply_part', "
                              f"'reply_end') AND e.{CHANNEL} IS NOT NULL{which('e.')} GROUP BY e.{CHANNEL}", asked):
        answered[ch] = max(answered.get(ch) or 0, _seconds(t) or 0) or None
    building = _running_builds(conn)
    last_user, user_at = {}, {}                      # each agent's newest user message: what it was last asked --
    words = "e.p_words" if "p_words" in _columns(conn, "events") else "NULL"   # as the user typed it, where it was kept
    for ch, text, payload, said, stored in conn.execute(   # not a background agent's report, which comes as one (HANDBACK)
            f"SELECT e.{CHANNEL}, e.text, e.payload_json, {words}, e.inserted_at FROM events e JOIN event_types t ON t.event_type_id = e.event_type_id "
            f"WHERE t.name = 'user_message' AND e.row_id IN (SELECT max(e2.row_id) FROM events e2 "
            f"JOIN event_types t2 ON t2.event_type_id = e2.event_type_id WHERE t2.name = 'user_message' "
            f"AND ifnull(e2.text, '') NOT LIKE '%[Subagent hand-back]%'{kept(_tables(conn), 'e2')} GROUP BY e2.{CHANNEL})"):
        last_user[ch] = (said, None) if said is not None else (None, (text if text else readable(payload)) or "")
        user_at[ch] = _seconds(stored)               # and when ag stored it: as a read began, before its context is built
    tables = _tables(conn)
    recaps = {}                                      # each agent's newest recap (Claude Code's, while the user was away)
    found = [(ch, at, (_json(raw) or {}).get("text")) for ch, at, raw in conn.execute(
        f"SELECT e.{CHANNEL}, e.inserted_at, e.payload_json FROM events e WHERE e.row_id IN (SELECT max(x.row_id) FROM "
        f"events x JOIN event_types t ON t.event_type_id = x.event_type_id WHERE t.name = 'recap' GROUP BY x.{CHANNEL})")]
    for ch, made, text in found:
        if ch and (ch not in recaps or (_seconds(made) or 0) >= (recaps[ch]["at"] or 0)):
            recaps[ch] = {"text": " ".join((text or "").split())[:600], "at": _seconds(made)}
    names = _names(conn, tables)
    for ch, a in out.items():
        a["harness"] = _harness(conn, ch)
        typed, text = last_user.get(ch, (None, ""))
        said = typed if typed is not None else harness_kit.words(text, a["harness"])[1]   # as the user typed it
        a["last_user_message"] = " ".join(said.split())[:600] or None
        a["recap"] = recaps.get(ch)
        a["name"] = names.get(ch)
        a["last"] = max(a["last_read"] or 0, answered.get(ch) or 0,                             # its latest activity:
                        0 if a["reads"] else a["last_event"] or 0) or None                     # not a side call's events
        a["building"] = ch in building
        a["turn_over"] = turn_over(conn, ch, tables)[0]
        a["status"] = status_of(a.get("alive"), a["turn_over"], a["last"], now)
        a["said_at"] = user_at.get(ch)
        a["taken_back"] = None
        _status(conn, ch, a, tables, now)
        del a["said_at"]
        a["running"] = a["building"] or a["status"] == RUNNING
        a["background"] = a.pop("record_background", [])
    return sorted(out.values(), key=lambda a: a["created"] or 0, reverse=True)   # in place: newest created first


def _status(conn, ch: str, a: dict, tables: set, now: float) -> None:
    """The agent's status as its hook recorded what its harness's answers, calls and own record of the session say
    (module doc; `Record`): a call hung up on (Esc), or a turn its record says stopped -- interrupted, on an error, or
    over where its record ends turns (harness_kit's `record_ends_turns`: codex's) --, or a call failing until given
    up; the message the harness put back in its box, stopped before its answer came (`esc_takes_back`: Claude Code's);
    what it asks the user and has not had answered or dismissed (`_asking`) -- a plan it proposed, its turn over, kept
    as `offer`, for `_with_started` to show only where the dashboard's terminal shows it asking; and the background
    tasks it left running (`record_background`)."""
    h = harness_kit.get(a["harness"] or harness_kit.DEFAULT)
    rec = record_of(conn, ch) if a["status"] in (RUNNING, IDLE) else Record()
    a["record_background"] = rec.tasks()
    a["stopped"] = a["asking"] = None
    cut = since_said(a, hung_up(conn, ch)) if a["status"] == RUNNING else None
    if cut is not None:                              # stopped before its answer came, as ag's hook server saw: its
        a["status"], a["turn_over"] = IDLE, True     # record says nothing of it, or says so once it does
    a["failing"] = failing(conn, ch) if a["status"] == RUNNING else None
    got = rec.stopped(began(a)) if a["status"] == RUNNING or cut is not None else None
    if got and got["kind"] == "over" and not (h and h.record_ends_turns):
        got = None                                   # its calls say when a turn is over
    if got and got["kind"] == "error":
        a["stopped"], a["status"], a["turn_over"] = got, ERROR, True
    elif got:                                        # interrupted (Esc), or over: its turn ended, with no call ag saw
        a["stopped"] = got if got["kind"] == "interrupted" else None
        a["status"], a["turn_over"], a["failing"] = IDLE, True, None
    elif a["failing"] and given_up(a["failing"], rec.followed, now):
        a["status"], a["turn_over"] = ERROR, True
    elif a["failing"] and not a["failing"]["retrying"]:
        a["wake"] = a["failing"]["at"] + give_up_after(a["failing"], rec.followed) + 1   # when it would be given up
    if cut is not None:
        if not (a["stopped"] and a["stopped"]["kind"] == "interrupted"):   # its coming changes the actor, and the
            a["stopped"] = {"kind": "interrupted", "at": cut}               # page's Chat loads the turn it marks again
        if h and h.esc_takes_back:
            a["taken_back"], wake = taken_back(conn, ch, tables, rec, now)
            if wake:
                a["wake"] = min(wake, a.get("wake") or wake)
    ask = _asking(rec, a["status"], a["harness"]) if a["status"] in (RUNNING, IDLE) else None
    if ask and str(ask.get("call") or "").startswith("plan:"):       # its proposed plan, not a call
        a["offer"] = ask
    elif ask:
        a["asking"] = ask
        if not ask.get("async"):                     # its turn waits on the answer; an async one's goes on
            a["status"] = ASKING


def began(a: dict) -> Optional[float]:
    """When the agent's newest call began, as far as ag saw: its newest read (`last_read`; its newest event, if ag
    recorded none), or the newest message ag stored for it (`said_at`), whichever came later -- a message stored as a
    read begins, before its context is built and the read recorded, so a turn's stop older than it is the last
    turn's, not this one's. Not when its answer came: a stop during the call is this one's even where the record says
    it before ag stored the answer's end -- agy cancels the step its answer makes as the answer ends, Esc pressed as
    it came, while the hook server stores that end (ms apart, either first)."""
    read = a.get("last_read") if a.get("reads") else a.get("last_event")
    return max(read or 0, a.get("said_at") or 0) or None


def since_said(a: dict, cut: Optional[float]) -> Optional[float]:
    """`cut` (`hung_up`), unless ag has stored a message for the agent since: a new call's, its read under way --
    the harness hung up to send it (codex, as a question's reply comes), not the user (Claude Code's message taken back
    on Esc is withdrawn with its read)."""
    return None if cut is None or (a.get("said_at") or 0) > cut else cut


def _names(conn, tables: set) -> Dict[str, dict]:
    """Each channel's name, {text, by}: the reader's newest (`by` "user", given in the dashboard: naming.py), else the
    newest another gave (codex's title for its thread, Claude Code's for its session) -- from the `name` records. A
    reader's "" takes theirs back."""
    given = []
    for ch, at, raw in conn.execute(f"SELECT e.{CHANNEL}, e.inserted_at, e.payload_json FROM events e JOIN event_types t "
                                    f"ON t.event_type_id = e.event_type_id WHERE t.name = 'name' ORDER BY e.row_id"):
        got = _json(raw) or {}
        given.append((ch, got.get("by"), got.get("text"), at))
    users, others = {}, {}
    for ch, by, text, _named in sorted(given, key=lambda g: _seconds(g[3]) or 0):
        if ch:
            (users if by == "user" else others)[ch] = {"text": " ".join((text or "").split())[:120], "by": by}
    return {**others, **{ch: n for ch, n in users.items() if n["text"]}}


def turn_over(conn, channel: str, tables: set):
    """(whether the channel's turn is over, the time of what says so): from its pending answer (`replies`) --
    its stop reason (GOES_ON / OVER), else its last event: an assistant message ends a turn, a tool
    call does not -- else, with none pending, from its newest stored event of the conversation: an assistant message
    (a turn stored whole), or else not (a user message or a tool's output: the model is answering)."""
    pending = replies(conn, channel, tables)
    if pending:
        last = pending[-1]
        why = last["stop"]
        over = False if why in GOES_ON else True if why in OVER else last["type"] == "agent_message"
        return over, _seconds(last["received_at"])
    last = conn.execute(f"SELECT t.name, e.inserted_at FROM events e JOIN event_types t ON t.event_type_id = e.event_type_id "
                        f"WHERE ifnull(e.{CHANNEL}, '') = ? AND t.name NOT IN ('environment_update', 'context_stream') "
                        f"AND {NOT_RECORD} ORDER BY e.row_id DESC LIMIT 1", (channel,)).fetchone()
    if last is None:
        return True, None
    return last[0] == "agent_message", _seconds(last[1])


def _json(raw):
    try:
        got = json.loads(raw) if raw else None
    except ValueError:
        return None
    return got if isinstance(got, dict) else None


def replies(conn, channel: str, tables: Optional[set] = None) -> List[dict]:
    """What the model answered that no call of the channel has carried back yet, oldest first, each {answer,
    received_at, type, payload_json, text, stop}: the answers recorded as they came (`reply_part`, `reply_end`) after
    the channel's newest event of the conversation -- the call that carries an answer back stores it as conversation,
    after it. `stop`: why its answer stopped (its `reply_end`'s), "streaming" while it has none; an answer that broke
    off as it streamed -- no end, and a turn's call since -- is left out."""
    out = []
    if "p_answer_id" not in _columns(conn, "events"):
        return out
    since = conn.execute(f"SELECT max(e.row_id) FROM events e WHERE ifnull(e.{CHANNEL}, '') = ? AND {NOT_RECORD}",
                         (channel,)).fetchone()[0] or 0
    rows = conn.execute(f"SELECT e.row_id, t.name, e.inserted_at, e.payload_json, e.p_answer_id FROM events e JOIN event_types t "
                        f"ON {BY_CHANNEL} WHERE ifnull(e.{CHANNEL}, '') = ? AND e.row_id > ? AND "
                        f"t.name IN ('reply_part', 'reply_end', 'model_call') ORDER BY e.row_id", (channel, since)).fetchall()
    ends = {r[4]: (_json(r[3]) or {}).get("stop") for r in rows if r[1] == "reply_end"}
    turned = max((r[0] for r in rows if r[1] == "model_call" and (_json(r[3]) or {}).get("kind") == "turn"), default=0)
    last_part = {}
    for r in rows:
        if r[1] == "reply_part":
            last_part[r[4]] = r[0]
    for r in rows:
        if r[1] != "reply_part" or (r[4] not in ends and turned > last_part[r[4]]):
            continue                                 # a part of an answer that broke off: a turn's call came since
        part = _json(r[3]) or {}
        out.append({"answer": r[4], "received_at": r[2], "type": part.get("type"),
                    "payload_json": json.dumps(part.get("payload")), "text": part.get("text"),
                    "stop": ends[r[4]] if r[4] in ends else STREAMING})
    return out


def ask_view(f: Optional[dict], harness: Optional[str] = None) -> Optional[dict]:
    """What an `asked` fact asks, for the page: {kind, harness (whose dialog answers it: answers.py), async (the turn
    goes on while it asks), at, call, questions (clipped, each {id, header, question, multiSelect, options: [{label,
    description}]}: a question's title for its words, an option given as its label alone, as some harnesses record
    them) or plan}; None for None."""
    if not f:
        return None
    out = {"kind": f.get("kind") or "question", "harness": harness, "async": bool(f.get("async")), "at": f.get("at"),
           "call": f.get("call")}
    if out["kind"] == "plan":
        out["plan"] = _clip(f.get("plan"), PLAN_CHARS)
        return out
    out["questions"] = []
    for q in f.get("questions") or []:
        if not isinstance(q, dict):
            continue
        options = [o if isinstance(o, dict) else {"label": str(o)} for o in q.get("options") or [] if isinstance(o, (dict, str))]
        out["questions"].append({"id": q.get("id"), "header": q.get("header"),
                                 "question": _clip(q.get("question") or q.get("title"), ASK_CHARS),
                                 "multiSelect": bool(q.get("multiSelect")),
                                 "options": [{"label": o.get("label"), "description": _clip(o.get("description"), ASK_CHARS)}
                                             for o in options]})
    return out


def _asking(rec: "Record", status: str, harness: Optional[str]) -> Optional[dict]:
    """What the agent waits on the user for, as its record says (`ask_view`'s), None if nothing: RUNNING, what its turn
    waits on, not yet answered or dismissed -- else a question it asked as its turn goes on (async); its turn over
    (IDLE), the plan it proposed, which its terminal asks whether to take: {kind: "plan", call: "plan:<its turn>", at:
    when the turn ended, plan} (codex's)."""
    if status == RUNNING:
        got = rec.asking()
        if got is not None:
            return ask_view({**got, "async": False}, harness)
        got = rec.open_question()
        return ask_view({"kind": "question", **got, "async": True}, harness) if got else None
    got = rec.offer() if status == IDLE else None
    return ask_view({"kind": "plan", "call": got["call"], "at": got["at"], "plan": got["text"]}, harness) if got else None


def asking_of(gatherer: str, channel: str, cwd: Optional[str] = None) -> Optional[dict]:
    """What the agent waits on the user for now, as its hook recorded it (`_asking`), None if nothing; `cwd`, where the
    session runs (no longer needed: the record is read from events)."""
    conn = _connect(gatherer)
    if conn is None:
        return None
    try:
        if not _channels_kept(conn):
            return None
        tables = _tables(conn)
        over = turn_over(conn, channel, tables)[0]
        return _asking(record_of(conn, channel), IDLE if over else RUNNING, _harness(conn, channel))
    finally:
        conn.close()


def answer_result(gatherer: str, channel: str, call: Optional[str]) -> Optional[str]:
    """What the harness recorded as the answer to `call` -- as its own record says (`Record.result`), else the words of
    the tool's result once a call has carried it -- None before either has."""
    conn = _connect(gatherer) if call else None
    if conn is None:
        return None
    try:
        if not _channels_kept(conn):
            return None
        got = record_of(conn, channel).result(call)
        if got is not None:
            return got
    finally:
        conn.close()
    return _result(gatherer, channel, call)


def failing(conn, channel: str) -> Optional[dict]:
    """The agent's model calls failing now (module doc), None if they are not: the run of failed calls at its
    newest read -- or at the one before, the newest a try under way (no error, no count yet) at the same event
    -- that answered the same event. {at: when the newest began, first: the run's first, attempts: how many
    failed, status: the newest's HTTP status (None: no answer came), error: why, retrying: a try under way}."""
    rows = _newest_reads(conn, channel, FAILED_READS)
    if rows is None:
        return None
    retrying = bool(rows) and rows[0]["error"] is None
    if retrying:                                      # a try under way, after a failure at the same event
        if rows[0]["real_tokens"] is not None or len(rows) < 2 or rows[1]["error"] is None \
                or rows[1]["row_id"] != rows[0]["row_id"] or rows[1]["error_status"] == HUNG_UP:
            return None
        rows = rows[1:]
    run = []
    for r in rows:                                    # a call the user stopped (HUNG_UP) is not one that failed
        if r["error"] is None or r["error_status"] == HUNG_UP or r["row_id"] != rows[0]["row_id"]:
            break
        run.append(r)
    if not run:
        return None
    return {"at": _seconds(run[0]["read_at"]), "first": _seconds(run[-1]["read_at"]), "attempts": len(run),
            "status": run[0]["error_status"], "error": _clip(run[0]["error"], ERROR_CHARS), "retrying": retrying}


def kept(tables: set, alias: str = "e") -> str:
    """A condition on the events row `alias`: not one the harness took back (ag's `_withdrawn`: stored for a call it
    hung up on, and not sent again -- Claude Code put the user's message back in its input box). Nothing for a file
    from before ag kept them."""
    return f" AND {alias}.row_id NOT IN (SELECT row_id FROM _withdrawn)" if "_withdrawn" in tables else ""


def hung_up(conn, channel: str) -> Optional[float]:
    """When the agent's newest call was stopped by the user before its answer was through (HUNG_UP, as ag's hook server
    reports it), None if it was not. Before any of the answer came, Claude Code takes the message back into its prompt
    and records nothing of it, so that is all that tells the turn is over."""
    r = (_newest_reads(conn, channel, 1) or [None])[0]
    return _seconds(r["read_at"]) if r is not None and r["error_status"] == HUNG_UP else None


TAKEN_SECONDS = 2.0     # a call hung up on, nothing of it in Claude Code's record this long: its message taken back


def interrupts(rec: "Record") -> List[float]:
    """When Claude Code's record says the user interrupted a turn (Esc), of its newest facts."""
    return [f["at"] for t, f in rec.facts if t == "turn_stopped" and f.get("how") == "interrupted"
            and isinstance(f.get("at"), (int, float))]


def withdrawn_reads(conn, channel: str, tables: set, stops: List[float], read_id: Optional[int] = None) -> Dict[int, dict]:
    """The calls hung up on whose events ag withdrew (`_withdrawn`), by their read (only `read_id`'s, if given): {said:
    the user's words of the newest user message among them that opened a turn (else None), said_row: its row, reached:
    what of the answer had reached the harness in words, as the hook server saw it relayed (its `call_failed`'s: "text",
    "tool", "nothing"; None from a hook before it said), kept: its text had, or Claude Code's record says the turn was
    interrupted (`stops`: when) once the call had gone to the model (its read done) and before the next call's read}.
    The hook withdraws a call's events on any Esc, those it stored again (the turns before, sent with it) among them.
    Claude Code keeps them all -- and records the turn interrupted -- once some of the answer's words had come; before,
    it takes the user's message back into its input box (`said`; the events after it with it), recording nothing."""
    if "_withdrawn" not in tables:
        return {}
    harness = _harness(conn, channel)
    words = "e.p_kind, e.p_words" if {"p_kind", "p_words"} <= _columns(conn, "events") else "NULL, NULL"
    out: Dict[int, dict] = {}
    for read, row, typ, kind, said, text in conn.execute(
            f"SELECT w.read_id, e.row_id, t.name, {words}, e.text FROM _withdrawn w JOIN events e ON e.row_id = w.row_id "
            f"JOIN event_types t ON t.event_type_id = e.event_type_id WHERE ifnull(e.{CHANNEL}, '') = ? AND w.read_id "
            f"{'= ?' if read_id is not None else 'IS NOT NULL'} ORDER BY e.row_id",
            (channel, *([read_id] if read_id is not None else []))):
        r = out.setdefault(read, {"said": None, "said_row": None, "reached": None, "kept": False})
        if typ == "user_message":
            k, w = (kind, said) if kind and said is not None else harness_kit.words(text or "", harness)
            if k == Kind.USER and w.strip():                 # the newest: the turns before it come first
                r["said"], r["said_row"] = w.strip(), row
    if out and "p_read_id" in _columns(conn, "events"):
        for read, raw in conn.execute(
                f"SELECT e.p_read_id, e.payload_json FROM events e JOIN event_types t ON {BY_CHANNEL} WHERE "
                f"ifnull(e.{CHANNEL}, '') = ? AND t.name = 'call_failed' AND e.p_read_id >= ?", (channel, min(out))):
            got = _json(raw) or {}
            if read in out and got.get("status") == HUNG_UP and got.get("reached"):
                out[read]["reached"] = got["reached"]
                out[read]["kept"] = got["reached"] == "text"
    if out and stops and CHANNEL in _columns(conn, "_reads"):
        reads = [(rid, _seconds(at)) for rid, at in conn.execute(
            f"SELECT read_id, read_at FROM _reads WHERE ifnull({CHANNEL}, '') = ? AND read_id >= ? ORDER BY read_id",
            (channel, min(out)))]
        for read, r in out.items():
            began = next((at for rid, at in reads if rid == read), None)
            until = next((at for rid, at in reads if rid > read), None) or float("inf")
            r["kept"] = r["kept"] or (began is not None and any(began <= s < until for s in stops))
    return out


def taken_back(conn, channel: str, tables: set, rec: "Record", now: float) -> tuple:
    """The message Claude Code put back in its input box, stopped (Esc) before any of its answer came: ({text (the user's
    words), at (when ag kept the hang-up), since (when ag read the call before: a key that stopped the turn typed after
    it, and nothing since, left the message in the box untouched -- sessions.py's `took_back`)}, None) -- the user's
    message withdrawn with the agent's newest call, hung up on (`hung_up`), which opened the turn: at once where the hook
    server saw none of the answer's words reach Claude Code (`withdrawn_reads`' `reached`); else -- a tool call begun,
    no text; a hook from before it said -- with nothing in Claude Code's record of the turn being interrupted for
    TAKEN_SECONDS since (`kept`). Until then (None, when to look again). (None, None) for any other call hung up on, one
    whose text had come, or where its record is not followed (not known)."""
    last = _newest_reads(conn, channel, 2) or []
    r = last[0] if last else None
    if r is None or r["error_status"] != HUNG_UP:
        return None, None
    got = withdrawn_reads(conn, channel, tables, interrupts(rec), r["read_id"]).get(r["read_id"])
    if not got or not got["said"] or got["kept"]:
        return None, None
    since = _seconds(last[1]["read_at"]) if len(last) > 1 else None
    if got["reached"] == "nothing":                  # none of its answer's words came: taken back, as the hook saw
        return {"text": got["said"], "at": _seconds(r["read_at"]) or now, "since": since}, None
    if not rec.followed:
        return None, None
    at = conn.execute(f"SELECT max(e.inserted_at) FROM events e JOIN event_types t ON {BY_CHANNEL} WHERE "
                      f"ifnull(e.{CHANNEL}, '') = ? AND t.name = 'call_failed' AND e.p_read_id = ?",
                      (channel, r["read_id"])).fetchone()[0] if "p_read_id" in _columns(conn, "events") else None
    at = _seconds(at) or _seconds(r["read_at"]) or now
    if now - at < TAKEN_SECONDS:
        return None, at + TAKEN_SECONDS
    return {"text": got["said"], "at": at, "since": since}, None


def _newest_reads(conn, channel: str, n: int) -> Optional[List[dict]]:
    """The channel's `n` newest reads, newest first, each {read_id, read_at, row_id, real_tokens, error_status, error}:
    how its call failed, as the hook recorded it (`call_failed`, by its read). None in a file from before reads had
    channels."""
    cols = _columns(conn, "_reads")
    if CHANNEL not in cols:
        return None
    counted = "real_tokens" if "real_tokens" in cols else "NULL AS real_tokens"
    rows = [{**dict(r), "error_status": None, "error": None} for r in conn.execute(
        f"SELECT read_id, read_at, row_id, {counted} FROM _reads WHERE ifnull({CHANNEL}, '') = ? "
        f"ORDER BY read_id DESC LIMIT ?", (channel, n))]
    if rows and "p_read_id" in _columns(conn, "events"):
        for read, raw in conn.execute(f"SELECT e.p_read_id, e.payload_json FROM events e JOIN event_types t ON "
                                      f"{BY_CHANNEL} WHERE ifnull(e.{CHANNEL}, '') = ? AND "
                                      f"t.name = 'call_failed' AND e.p_read_id >= ?", (channel, rows[-1]["read_id"])):
            got = _json(raw) or {}
            for r in rows:
                if r["read_id"] == read and r["error"] is None:
                    r["error_status"], r["error"] = got.get("status"), got.get("error") or "failed"
    return rows


def give_up_after(failure: dict, record: bool) -> float:
    """How long after a failed call (`failing`) with no try since the harness counts as having given up:
    GIVE_UP_LONG where its endpoint answered an error (it may have asked for a long wait) and Claude Code's
    record could still say; else GIVE_UP_SECONDS."""
    return GIVE_UP_LONG if record and failure["status"] is not None else GIVE_UP_SECONDS


def given_up(failure: dict, record: bool, now: float) -> bool:
    """Whether the harness has given up on a failed call (`failing`), as far as time tells: no try under way, and
    none for `give_up_after`."""
    return not failure["retrying"] and now - (failure["at"] or now) > give_up_after(failure, record)


class Record:
    """What the harness's own record of a session says (FACTS: as the hook recorded it, following the record), from its
    newest facts (`record_of`).

        followed          whether the hook follows the session's record: what it says is known as it is written
        settled(call)     how an asking call ended there: "answered", "dismissed" (Esc; codex: its turn ended first),
                          or None -- not yet, or not known
        result(call)      what the harness recorded as its answer (a question's, a plan's), None before it has
        stopped(since)    how its newest turn ended, if it did at or after `since` (when ag last heard of it): {kind:
                          "over", "interrupted" (Esc) or "error" (it gave up on a model call), at, text: the error's
                          words, status: its HTTP status}; None: it goes on, or ended before, or not known
        open_question()   a question asked as the turn goes on (codex's async one), not yet replied to
        offer()           the plan its last turn proposed, its terminal asking whether to implement it (codex's)
        tasks()           the background tasks it started that have not ended, with their newest signs of life
    """

    def __init__(self, facts: List[tuple] = ()):
        self.facts = list(facts)                        # [(type, payload)], oldest first
        self.followed = any(t == "session_file" for t, _ in self.facts)
        self._settled: Dict[str, dict] = {}
        self._results: Dict[str, str] = {}
        for t, f in self.facts:                         # the first word of each: the record's Esc before the call
            if t == "ask_settled" and f.get("call"):    # that carries the rejected result back
                self._settled.setdefault(f["call"], f)
                if f.get("result") is not None:
                    self._results.setdefault(f["call"], f["result"])

    def settled(self, call: Optional[str]) -> Optional[str]:
        got = self._settled.get(call) if call else None
        return got.get("how") or "answered" if got else None

    def result(self, call: Optional[str]) -> Optional[str]:
        return self._results.get(call) if call else None

    def stopped(self, since: Optional[float]) -> Optional[dict]:
        last = next((f for t, f in reversed(self.facts) if t == "turn_stopped"), None)
        if last is None or last.get("at") is None or (since is not None and last["at"] < since):
            return None
        return {"kind": last.get("how") or "over", "at": last["at"], "text": _clip(last.get("error"), ERROR_CHARS) or None,
                "status": last.get("status") if isinstance(last.get("status"), int) else None}

    def _asked(self, kind: str, wait: Optional[bool] = None) -> Optional[dict]:
        for t, f in self.facts:
            if t == "asked" and f.get("kind") == kind and (wait is None or bool(f.get("async")) != wait) \
                    and f.get("call") not in self._settled:
                return f
        return None

    def asking(self) -> Optional[dict]:
        """What an answer asked that is not settled, the newest: {kind, at, call, questions or plan} (a question
        asked as the turn goes on, and a proposed plan's offer, are `open_question`'s and `offer`'s)."""
        for t, f in reversed(self.facts):
            if t == "asked" and f.get("call") and not f.get("async") and not str(f["call"]).startswith("plan:") \
                    and f["call"] not in self._settled:
                return f
        return None

    def open_question(self) -> Optional[dict]:
        got = self._asked("question", wait=False)
        return {"call": got["call"], "at": got.get("at"), "questions": got.get("questions") or []} if got else None

    def offer(self) -> Optional[dict]:
        got = self._asked("plan")
        return {"call": got["call"], "at": got.get("at"), "text": got.get("plan") or ""} if got else None

    def tasks(self) -> List[dict]:
        out: Dict[str, dict] = {}
        outputs: Dict[str, str] = {}                 # each task's output, as its first start said: a resumed agent's too
        for t, f in self.facts:
            if t == "task_started" and f.get("task"):
                output = outputs.setdefault(f["task"], f.get("output")) or f.get("output")
                out[f["task"]] = {"id": f["task"], "kind": f.get("kind"), "label": f.get("label"), "started": f.get("at"),
                                  "output": output, "event": None, "event_at": None, "written": None}
            elif t == "task_ended" and f.get("task") in out:           # an end from before it started (again): not
                started, ended = out[f["task"]]["started"], f.get("at")    # this run's -- stored late, by a follower
                if started is None or ended is None or ended >= started:   # that read the record from its start
                    del out[f["task"]]
            elif t == "task_activity" and f.get("task") in out:       # a sign of life: its output grew, or its event
                task = out[f["task"]]
                if f.get("event"):
                    task["event"], task["event_at"] = f["event"], f.get("at")
                else:
                    task["written"] = max(task["written"] or 0, f.get("at") or 0) or None
        return list(out.values())

    def reports(self) -> Dict[str, str]:
        """{an agent's path: what it answered, as its own record had it once it ended}, the newest of each."""
        return {f["path"]: f["report"] for t, f in self.facts
                if t == "task_ended" and f.get("path") and isinstance(f.get("report"), str) and f["report"].strip()}


def _facts(conn, channel: str, types=FACTS, n: int = FACTS_READ) -> List[tuple]:
    """The channel's newest `n` facts of `types`, oldest first: [(type, payload)] -- its tasks' activity apart, the newest
    ACTIVITY_READ of it, each in its place among the rest."""
    if CHANNEL not in _columns(conn, "events"):
        return []
    rows = _newest(conn, channel, [t for t in types if t != ACTIVITY], n)
    if ACTIVITY in types:
        rows += _newest(conn, channel, [ACTIVITY], ACTIVITY_READ)
    return [(t, _json(raw) or {}) for _, t, raw in sorted(rows, key=lambda r: r[0])]


def _newest(conn, channel: str, types: List[str], n: int) -> List[tuple]:
    """The channel's newest `n` facts of `types`: [(row_id, type, payload_json)]."""
    if not types:
        return []
    return conn.execute(f"SELECT e.row_id, t.name, e.payload_json FROM events e JOIN event_types t ON {BY_CHANNEL} "
                        f"WHERE ifnull(e.{CHANNEL}, '') = ? AND t.name IN ({', '.join('?' * len(types))}) "
                        f"ORDER BY e.row_id DESC LIMIT ?", (channel, *types, n)).fetchall()


def record_of(conn, channel: str) -> Record:
    """What the harness's own record of the channel's session says (`Record`), from its newest facts."""
    return Record(_facts(conn, channel))


def typed(conn, channel: str, now: Optional[float] = None) -> List[dict]:
    """What the user wrote to the session while it worked, and sent between turns, as its record says: [{text, at,
    sent, joins}], oldest first -- the messages queued and not sent yet (`sent` None), the ones sent from the queue in
    the last SENT_SECONDS (`sent`: when; ag may not have stored them yet), `joins` when sent as part of the turn it was
    written in (mid-turn, or held until it ended), not as the next turn's first; and the messages sent between turns
    in the last PROMPT_SECONDS, each the next turn's first (`sent` its `at`). Each in the user's words. And a message
    sent from Chat (the dashboard's `chat_sent`) that the harness has not had yet -- no message of its words queued,
    sent or stored since -- in the last CHAT_SECONDS (`chat`: True, `sent` None); not a "/" command of the harness's,
    which it runs itself and may never send on (the page shows none pending)."""
    now = time.time() if now is None else now
    queued: Dict[str, dict] = {}
    prompts, chats, heard = [], [], []
    for t, f in _facts(conn, channel, ("message_queued", "message_sent", "message_withdrawn", "chat_sent"), MESSAGES_READ):
        if t == "chat_sent":
            if f.get("text") and not f["text"].startswith("/") and f.get("at") is not None and now - f["at"] <= CHAT_SECONDS:
                chats.append(f)
            continue
        if t in ("message_queued", "message_sent"):
            heard.append((f.get("at") or 0, _said(f.get("words") or f.get("text"))))
        if t == "message_queued" and f.get("queued"):
            queued[f["queued"]] = {"text": f.get("words") or f.get("text") or "", "at": f.get("at"), "sent": None, "joins": False}
        elif t == "message_withdrawn":
            queued.pop(f.get("queued"), None)
        elif t == "message_sent" and f.get("queued") in queued:
            queued[f["queued"]].update(sent=f.get("at"), joins=bool(f.get("joins")))
        elif t == "message_sent" and f.get("how") == "prompt" and f.get("at") is not None:
            prompts.append({"text": f.get("words") or f.get("text") or "", "at": f["at"], "sent": f["at"], "joins": False})
    got = [q for q in queued.values() if q["sent"] is None or now - q["sent"] <= SENT_SECONDS]
    got += [p for p in prompts if now - p["at"] <= PROMPT_SECONDS]
    if chats:                                        # the user's messages ag stored since: had, if not by the record
        words = "e.p_words" if "p_words" in _columns(conn, "events") else "NULL"
        heard += [(_seconds(at) or 0, _said(said or text)) for at, said, text in conn.execute(
            f"SELECT e.inserted_at, {words}, e.text FROM events e JOIN event_types t ON {BY_CHANNEL} WHERE "
            f"ifnull(e.{CHANNEL}, '') = ? AND t.name = 'user_message' ORDER BY e.row_id DESC LIMIT 20", (channel,))]
    for c in chats:
        said = _said(c["text"])
        if not any(at >= c["at"] - 1 and (w == said or said in w) for at, w in heard):
            got.append({"text": c["text"], "at": c["at"], "sent": None, "joins": False, "chat": True})
    return sorted(got, key=lambda q: q["at"] or 0)


def _said(text: Optional[str]) -> str:
    """A message's words, to match what was sent with what the harness had: its spaces as one, and a command run with `!`
    as the harness gives it ("!ls" the same as "! ls", as the page's `typedAs`)."""
    return " ".join(re.sub(r"^!\s*", "! ", (text or "").strip()).split())


def answer_of(conn, channel: str) -> Optional[dict]:
    """The newest answer the dashboard gave what the harness asks (its `answer_given`): {call, summary, expect, at}."""
    got = _facts(conn, channel, ("answer_given",), 1)
    return {k: got[0][1].get(k) for k in ("call", "summary", "expect", "at")} if got else None


def _answer_given(gatherer: str, channel: str) -> Optional[dict]:
    conn = _connect(gatherer)
    if conn is None:
        return None
    try:
        return answer_of(conn, channel) if CHANNEL in _columns(conn, "events") else None
    except sqlite3.Error:
        return None
    finally:
        conn.close()


def typed_at(gatherer: str, channel: str) -> Optional[float]:
    """When keys were last typed into the session's terminal from a page, as the dashboard kept it (`terminal_input`)."""
    conn = _connect(gatherer)
    if conn is None:
        return None
    try:
        got = _facts(conn, channel, ("terminal_input",), 1)
        return got[0][1].get("at") if got else None
    except sqlite3.Error:
        return None
    finally:
        conn.close()


def meanwhile(conn, channel: str) -> List[dict]:
    """The messages written while a turn ran that the harness held until it ended, and sent then, unwrapped, as the next
    request's -- part of that turn too: [{text (as the harness sent it), sent}], in order."""
    return [{"text": f.get("text") or "", "sent": f.get("at")}
            for t, f in _facts(conn, channel, ("message_sent",), MESSAGES_READ)
            if f.get("how") == "next" and f.get("joins") and f.get("at") is not None]


def _result(gatherer: str, channel: str, call: Optional[str]) -> Optional[str]:
    """The words of the tool's result for `call` once a call has carried it, None before."""
    conn = _connect(gatherer) if call else None
    if conn is None:
        return None
    try:
        if not _channels_kept(conn):
            return None
        r = conn.execute(f"SELECT e.text, e.payload_json FROM events e JOIN event_types t ON t.event_type_id = e.event_type_id "
                         f"WHERE t.name = 'tool_output' AND ifnull(e.{CHANNEL}, '') = ? AND instr(e.payload_json, ?) > 0 "
                         "ORDER BY e.row_id DESC LIMIT 1", (channel, json.dumps(call))).fetchone()
        return (r["text"] or readable(r["payload_json"]) or "") if r else None
    finally:
        conn.close()


def status_of(alive: Optional[bool], over: bool, last: Optional[float], now: float) -> str:
    """CLOSED, IDLE or RUNNING (module doc): `alive`, whether the harness's process runs (None:
    not known); `over`, whether the turn is; `last`, when anything last happened for it."""
    if alive is False:
        return CLOSED
    if over:
        return IDLE
    if alive is None and (last is None or now - last > STALE_SECONDS):
        return IDLE
    return RUNNING


def _settle_background(a: dict, now: float) -> None:
    """The agent's background tasks that still run (module doc), each with `active`, its last sign of
    life; an IDLE agent with any is BACKGROUND, and running."""
    s = a.get("session") or {}
    tasks = a.get("background") or []
    if a.get("alive") is False or a.get("status") == CLOSED or (s.get("kept") and not s.get("pid")):
        tasks = []                                   # its process is gone (or seen ending: `ended`), and they with it
    since = s.get("since") if s.get("pid") else a.get("since")     # when the process that has it now started
    known = bool(s.get("pid")) or a.get("alive") is True
    out = []
    for t in tasks:
        if since and t["started"] and t["started"] < since:
            continue                                 # an earlier process's
        active = max((x for x in (t["started"], t.get("event_at"), t.get("written")) if x), default=None)
        if not known and (active is None or now - active > STALE_SECONDS):
            continue
        out.append({**t, "active": active})
    a["background"] = out
    if out and a.get("status") == IDLE:
        a["status"], a["running"] = BACKGROUND, True


def _harness(conn, channel: str) -> Optional[str]:
    """The harness the channel runs on: as its hook recorded it with its newest model call (`model_call`), or for a
    session from before, as its gatherer's old tables were copied into records (`harness`); None: neither says."""
    said = conn.execute(f"SELECT e.payload_json FROM events e JOIN event_types t ON {BY_CHANNEL} "
                        f"WHERE ifnull(e.{CHANNEL}, '') = ? AND t.name IN ('model_call', 'harness') ORDER BY e.row_id DESC "
                        "LIMIT 1", (channel,)).fetchone()
    return (_json(said[0]) or {}).get("harness") if said else None


def harness_of(gatherer: str, channel: str) -> Optional[str]:
    """The harness a channel of the gatherer runs on (`_harness`), its database opened for it; None: not known."""
    conn = _connect(gatherer)
    if conn is None:
        return None
    try:
        return _harness(conn, channel) if CHANNEL in _columns(conn, "events") else None
    except sqlite3.Error:
        return None
    finally:
        conn.close()


_USAGE: Dict[tuple, dict] = {}      # (database, channel) -> (its last read, its usage): reads only add up


def _channel_items(tables: set) -> str:
    """SQL, a subquery over `:channel`, for the items every read of a channel returned: (read_id, position, row_id,
    made_id). ag keeps them as stays (each item's run through its context's reads: those with the same properties),
    and the stays that span a read are its items; an older file's read log is one row per item, as an older ag left
    it (`_read_items` a table) or as ag keeps it aside until it is moved (`_read_items_old`)."""
    channel = f"ifnull(r.{CHANNEL}, '') = :channel"
    if "_read_items" in tables:                     # a table: not moved to stays (yet)
        return f"(SELECT i.read_id, i.position, i.row_id, i.made_id FROM _read_items i JOIN _reads r ON r.read_id = i.read_id AND {channel})"
    old = (" UNION ALL SELECT i.read_id, i.position, i.row_id, i.made_id FROM _read_items_old i "
           f"JOIN _reads r ON r.read_id = i.read_id AND {channel}") if "_read_items_old" in tables else ""
    return ("(SELECT r.read_id, s.position, s.row_id, s.made_id FROM _reads r JOIN _stays s ON s.context_id = r.context_id "
            f"AND s.from_read <= r.read_id AND (s.to_read IS NULL OR s.to_read >= r.read_id) WHERE {channel}{old})")


#: Each read's sum from the stays without listing any read's items: a stay adds its item's size at the read it
#: came in at and takes it off after the last read it was in; each read's sum is what has been added up to it, in
#: its context.
SENT_BY_STAYS = f"""
WITH r AS (SELECT read_id, context_id, lead(read_id) OVER (PARTITION BY context_id ORDER BY read_id) AS nxt
           FROM _reads WHERE ifnull({CHANNEL}, '') = :channel),
s AS (SELECT s.from_read, s.to_read, coalesce(e.tokens, m.tokens, 0) AS tok FROM _stays s
      LEFT JOIN events e ON e.row_id = s.row_id LEFT JOIN _made_items m ON m.made_id = s.made_id
      WHERE s.context_id IN (SELECT context_id FROM r)),
d AS (SELECT from_read AS at, tok FROM s UNION ALL SELECT r.nxt, -s.tok FROM s JOIN r ON r.read_id = s.to_read
      WHERE r.nxt IS NOT NULL),
g AS (SELECT at, sum(tok) AS t FROM d GROUP BY at)
SELECT r.read_id, sum(coalesce(g.t, 0)) OVER (PARTITION BY r.context_id ORDER BY r.read_id) FROM r LEFT JOIN g ON g.at = r.read_id"""


def _sent_by_read(conn, channel: str, tables: set) -> Dict[int, int]:
    """{read_id: ag's count of all it returned} for each read of the channel, by the sizes stored now."""
    if "_stays" in tables and not {"_read_items", "_read_items_old"} & tables:
        return dict(conn.execute(SENT_BY_STAYS, {"channel": channel}))
    return dict(conn.execute(
        f"SELECT i.read_id, coalesce(sum(e.tokens), 0) + coalesce(sum(m.tokens), 0) FROM {_channel_items(tables)} i "
        "LEFT JOIN events e ON e.row_id = i.row_id LEFT JOIN _made_items m ON m.made_id = i.made_id GROUP BY i.read_id",
        {"channel": channel}))


def _usage(conn, channel: str, tables: set) -> dict:
    """Every item every read of the channel sent, added up by kind and name -- each message
    counted once per call it went in -- with the harness's preamble of each call (PREAMBLE):
    {tokens, entries: [{group, name, items, tokens}], not_counted}, the groups as read() names
    them (an event before its read's cut is KEPT, after it RECENT); `not_counted` is what the
    provider counted beyond them, over the calls it counted. Kept until the channel's next read:
    a long agent's sum is a scan of every read."""
    path = next((r[2] for r in conn.execute("PRAGMA database_list") if r[1] == "main"), "")
    last = conn.execute(f"SELECT max(read_id) FROM _reads WHERE ifnull({CHANNEL}, '') = ?", (channel,)).fetchone()[0]
    kept = _USAGE.get((path, channel))
    if kept and kept[0] == last:
        return dict(kept[1])
    cut = ("LEFT JOIN _builds b ON b.build_id = CAST(r.basis AS INTEGER) " if "_builds" in tables else "")
    since = "b.open_from_row IS NULL OR i.row_id >= b.open_from_row" if cut else "1"
    rows = conn.execute(
        f"SELECT CASE WHEN i.row_id IS NULL THEN 'made' WHEN {since} THEN 'recent' ELSE 'kept' END AS kind, "
        "coalesce(t.name, m.name, '?') AS item, count(*) AS n, sum(coalesce(e.tokens, m.tokens, 0)) AS tok "
        f"FROM {_channel_items(tables)} i JOIN _reads r ON r.read_id = i.read_id {cut}"
        "LEFT JOIN events e ON e.row_id = i.row_id LEFT JOIN event_types t ON t.event_type_id = e.event_type_id "
        "LEFT JOIN _made_items m ON m.made_id = i.made_id GROUP BY 1, 2", {"channel": channel}).fetchall()
    entries = [{"group": RECENT if r["kind"] == "recent" else KEPT if r["kind"] == "kept"
                else AG_KINDS.get(r["item"], "ag's sections"), "name": r["item"], "items": r["n"], "tokens": r["tok"] or 0}
               for r in rows]
    cols = _columns(conn, "_reads")
    pre = "preamble_json" if "preamble_json" in cols else "NULL"
    real = "real_tokens" if "real_tokens" in cols else "NULL"
    per_read = conn.execute(f"SELECT read_id, {pre}, {real} FROM _reads WHERE ifnull({CHANNEL}, '') = ?", (channel,)).fetchall()
    ids = {r[0]: _preamble_ids(r[1]) for r in per_read}
    known = _preambles(conn, [i for v in ids.values() for i in v])
    by_name: Dict[str, dict] = {}
    for v in ids.values():
        for i in v:
            if i in known:
                e = by_name.setdefault(known[i]["name"], {"group": PREAMBLE, "name": known[i]["name"], "items": 0, "tokens": 0})
                e["items"] += 1
                e["tokens"] += known[i]["tokens"]
    entries += list(by_name.values())
    sent = _sent_by_read(conn, channel, tables)
    not_counted = sum(max(0, r[2] - sent.get(r[0], 0) - sum(known[i]["tokens"] for i in ids[r[0]] if i in known))
                      for r in per_read if r[2])
    usage = {"tokens": sum(e["tokens"] for e in entries), "entries": entries, "not_counted": not_counted}
    _USAGE[(path, channel)] = (last, usage)
    return dict(usage)


def _sent(conn, read_id: int) -> int:
    """ag's count of all read `read_id` sent: what it returned, added up."""
    return conn.execute("SELECT coalesce(sum(e.tokens), 0) + coalesce(sum(m.tokens), 0) FROM _read_items i "
                        "LEFT JOIN events e ON e.row_id = i.row_id LEFT JOIN _made_items m ON m.made_id = i.made_id "
                        "WHERE i.read_id = ?", (read_id,)).fetchone()[0]


# ---------------------------------------------------------------- one agent over time

def agent(gatherer: str, channel: str, llm: Optional[List[dict]] = None) -> dict:
    """One agent over time, as the module says. `llm` is the Gatherer's model calls
    (`llm_calls()`), when the caller has them already."""
    conn = _connect(gatherer)
    if conn is None:
        return {"error": f"no database for gatherer {gatherer!r}"}
    try:
        if not _channels_kept(conn):
            return dict(NOTHING_YET)
        return _agent(conn, gatherer, channel, llm if llm is not None else llm_calls())
    finally:
        conn.close()


def _agent(conn, gatherer: str, channel: str, llm: List[dict]) -> dict:
    tables, read_cols = _tables(conn), _columns(conn, "_reads")
    sizes = [c for c in ("est_tokens", "real_tokens", "limit_tokens") if c in read_cols]
    recorded = "sent_tokens" if "sent_tokens" in read_cols else "NULL"
    reads = []
    for r in conn.execute(f"SELECT read_id, read_at, row_id, basis{''.join(', ' + c for c in sizes)}, "
                          f"{recorded} AS recorded FROM _reads WHERE ifnull({CHANNEL}, '') = ? ORDER BY read_id", (channel,)):
        reads.append({"read_id": r["read_id"], "at": _seconds(r["read_at"]), "row_id": r["row_id"],
                      "basis": r["basis"], "recorded_tokens": r["recorded"],
                      **{k: (r[k] if k in sizes else None) for k in ("est_tokens", "real_tokens", "limit_tokens")}})
    tasks = []
    if "tasks" in tables:
        times = dict(conn.execute(f"SELECT row_id, inserted_at FROM events WHERE ifnull({CHANNEL}, '') = ?", (channel,)))
        for r in conn.execute("SELECT task_index, name, description, first_row, last_row, tokens FROM tasks "
                              "WHERE channel_key = ? ORDER BY task_index", (channel,)):
            tasks.append({"index": r["task_index"], "name": r["name"], "description": r["description"],
                          "first_row": r["first_row"], "last_row": r["last_row"], "tokens": r["tokens"],
                          "started": _seconds(times.get(r["first_row"])), "ended": _seconds(times.get(r["last_row"]))})
    sent = _sent_by_read(conn, channel, tables)     # ag's count of all it sent: what each read returned, added up
    pre = dict(conn.execute(f"SELECT read_id, preamble_json FROM _reads WHERE ifnull({CHANNEL}, '') = ?", (channel,))) \
        if "preamble_json" in read_cols else {}
    known = _preambles(conn, [i for raw in pre.values() for i in _preamble_ids(raw)])
    for r in reads:
        r["sent_tokens"] = sent.get(r["read_id"])
        ids = _preamble_ids(pre.get(r["read_id"]))
        # the harness's preamble the call stated (None: none recorded -- a call from before ag kept it)
        r["preamble_tokens"] = sum(known[i]["tokens"] for i in ids if i in known) if ids else None
    starts = sorted(t["started"] for t in tasks if t["started"] is not None)
    for i, r in enumerate(reads):          # the tasks begun by then (a read may answer an older event)
        r["tasks"] = sum(1 for s in starts if r["at"] is not None and s <= r["at"])
        r["rebuild"] = i > 0 and r["basis"] != reads[i - 1]["basis"]
    builds = []
    if "_builds" in tables:
        cols = _columns(conn, "_builds")
        for r in conn.execute(f"SELECT build_id, status, started_at, finished_at, through_row, error"
                              f"{', reason' if 'reason' in cols else ''} FROM _builds WHERE channel_key = ? "
                              f"ORDER BY build_id", (channel,)):
            builds.append({"build_id": r["build_id"], "status": r["status"], "started": _seconds(r["started_at"]),
                           "finished": _seconds(r["finished_at"]), "through_row": r["through_row"],
                           "error": r["error"], "reason": r["reason"] if "reason" in cols else None})
    checks = []
    if "_boundaries" in tables:
        for r in conn.execute("SELECT row_id, asked_at, decided_at, new_task, why FROM _boundaries "
                              "WHERE channel_key = ? ORDER BY row_id", (channel,)):
            checks.append({"row_id": r["row_id"], "asked": _seconds(r["asked_at"]), "decided": _seconds(r["decided_at"]),
                           "new_task": bool(r["new_task"]) if r["new_task"] is not None else None, "why": r["why"]})
    mine = [c for c in llm if _belongs(c, gatherer, channel, builds, checks)]
    usage = _usage(conn, channel, tables)
    usage.update(calls=len(reads), real_tokens=sum(r["real_tokens"] or 0 for r in reads),
                 real_calls=sum(1 for r in reads if r["real_tokens"]))
    harness = _harness(conn, channel)
    return {"gatherer": gatherer, "channel": channel, "harness": harness, "reads": reads,
            "pending": _pending(conn, channel, tables),
            "typed": _unstored(conn, channel, typed(conn, channel)),
            "after_read": _after_read(conn, channel, tables, reads[-1]["row_id"] if reads else None),
            "tasks": tasks, "builds": builds,
            "checks": checks, "rebuilds": sum(1 for r in reads if r["rebuild"]), "llm": _llm_summary(mine), "usage": usage,
            "llm_attributed_by_time": sum(1 for c in mine if not c.get("job"))}


def _unstored(conn, channel: str, typed: List[dict]) -> List[dict]:
    """What the user wrote to the session as it worked (`typed`), less each message that opened a turn ag has stored since. ag
    stores a call's messages before the call goes on to the model, so every turn that ended before a message was sent
    was stored before it: a user message stored after it is its own, or a later one's -- and so is a call ag read after
    it: a message sent again, as it was taken back (Esc), is kept again where it was first stored, at its first time.
    (Matched by when, not by its words: ag may store them otherwise, an image's say.)"""
    opening = [q["sent"] for q in typed if q["sent"] is not None and not q["joins"]]
    if not opening:
        return typed
    got = conn.execute(f"SELECT e.inserted_at FROM events e JOIN event_types t ON t.event_type_id = e.event_type_id "
                       f"WHERE ifnull(e.{CHANNEL}, '') = ? AND t.name = 'user_message' ORDER BY e.row_id DESC LIMIT 1",
                       (channel,)).fetchone()
    read = (_newest_reads(conn, channel, 1) or [None])[0]
    stored = max([t for t in (_seconds(got[0]) if got else None, _seconds(read["read_at"]) if read else None) if t],
                 default=None)
    return [q for q in typed if q["sent"] is None or q["joins"] or stored is None or stored < q["sent"]]


#: What the model answered that no call has carried back yet (the store's `_pending`): the latest context's tail.
PENDING = "Pending"
#: An event stored after the one the latest read responded to: in no read's context yet.
AFTER_READ = "Stored since the latest call"
_tokenizer = None


def _count(text: str) -> int:
    """ag's own count of a pending event's text (pending rows keep none): tiktoken's o200k_base, as
    the store's default; characters / 4 without tiktoken."""
    global _tokenizer
    if not text:
        return 0
    if _tokenizer is None:
        try:
            import tiktoken
            _tokenizer = tiktoken.get_encoding("o200k_base")
        except Exception:  # noqa: BLE001 - no tiktoken, or no encoding file
            _tokenizer = False
    if _tokenizer:
        try:
            return len(_tokenizer.encode(text, disallowed_special=()))
        except Exception:  # noqa: BLE001
            pass
    return max(1, len(text) // 4)


def _pending(conn, channel: str, tables: set) -> List[dict]:
    """The channel's pending events, oldest first, as `context` lists items (group PENDING): each one's
    type, size by ag's own count, time and text (at most TEXT_CHARS; `clipped` says how much more).
    [] when the channel has none: its last call carried them all (`replies`)."""
    items = []
    for r in replies(conn, channel, tables):
        text = r["text"] if r["text"] else readable(r["payload_json"])
        items.append({"position": None, "group": PENDING, "name": r["type"], "tokens": _count(r["text"] or ""),
                      "row_id": None, "made_id": None, "at": _seconds(r["received_at"]),
                      "clipped": max(0, len(text or "") - TEXT_CHARS), "text": (text or "")[:TEXT_CHARS]})
    return items


def _after_read(conn, channel: str, tables: set, row_id: Optional[int]) -> List[dict]:
    """What the channel has that its latest read's context does not, oldest first: the events stored
    after the one that read responded to (`row_id`) -- by a call that logged no read, such as a
    harness's read-only side call, which stores the turn's final answer and clears it from pending --
    merged by time (`inserted_at`, `received_at`) with the pending events. Just the pending ones
    before any read (`row_id` None)."""
    items = []
    if row_id is not None:
        for r in conn.execute(
                "SELECT e.row_id, t.name AS type, e.tokens, e.text, e.payload_json, e.inserted_at FROM events e "
                f"LEFT JOIN event_types t ON t.event_type_id = e.event_type_id WHERE ifnull(e.{CHANNEL}, '') = ? AND e.row_id > ? "
                f"AND {NOT_RECORD} ORDER BY e.row_id LIMIT ?", (channel, row_id, HISTORY_ITEMS)):
            text = r["text"] if r["text"] else readable(r["payload_json"])
            items.append({"position": None, "group": AFTER_READ, "name": r["type"] or "?", "tokens": r["tokens"] or 0,
                          "row_id": r["row_id"], "made_id": None, "at": _seconds(r["inserted_at"]),
                          "clipped": max(0, len(text or "") - TEXT_CHARS), "text": (text or "")[:TEXT_CHARS]})
    stored = len(items)
    items += _pending(conn, channel, tables)
    order = sorted(range(len(items)), key=lambda i: (items[i]["at"] or 0, i >= stored, i))   # a tie: stored first
    return [items[i] for i in order]


# ---------------------------------------------------------------- what a read held

#: The agent's own events, verbatim: since the cut of the build the read was made from (all of
#: them before any build), and those kept from before it (its preamble, the pinned rows).
RECENT, KEPT = "Recent history", "Kept from before the cut"
#: What the harness sent besides its messages (its system prompt, its tools), as it stated them.
PREAMBLE = "Harness preamble"


def _preamble_ids(raw) -> List[int]:
    try:
        ids = json.loads(raw) if raw else []
    except ValueError:
        return []
    return [i for i in ids if isinstance(i, int)] if isinstance(ids, list) else []


def _preambles(conn, ids) -> Dict[int, dict]:
    """The _preambles with these ids: {id: {name, text, tokens}}; {} in a file from before them."""
    ids = sorted(set(ids))
    if not ids or "_preambles" not in _tables(conn):
        return {}
    rows = conn.execute(f"SELECT preamble_id, name, text, tokens FROM _preambles WHERE preamble_id IN ({', '.join('?' * len(ids))})", ids)
    return {r[0]: {"name": r[1], "text": r[2], "tokens": r[3] or 0} for r in rows}
#: ag's own messages by name, as the read's breakdown groups them; any other name is a section of its own.
AG_KINDS = {"environment_update": "File-change notices", "parallel_request": "Other agents' requests",
            "context_stream": "Stream messages", "gatherer_guide": "Gatherer guide"}


def readable(payload_json: Optional[str]) -> str:
    """The words in an event's payload, for one ag stores no text for (reasoning, an empty
    message): the text and thinking of its content blocks (pi's, Claude Code's), a codex
    item's summary or content; the payload itself when there are none; "" for none at all."""
    try:
        p = json.loads(payload_json) if payload_json else None
    except ValueError:
        return payload_json or ""
    if not isinstance(p, dict):
        return payload_json or ""
    words = []
    for key in ("content", "summary", "parts"):
        for block in p.get(key) or [] if isinstance(p.get(key), list) else []:
            if isinstance(block, dict):
                words += [block[k] for k in ("text", "thinking") if isinstance(block.get(k), str) and block[k].strip()]
    if words:
        return "\n\n".join(words)
    has_blocks = any(isinstance(p.get(k), list) for k in ("content", "summary", "parts"))
    return "" if has_blocks else payload_json


def _items(conn, read_id: int):
    """(the read's row, the cut of its build or None, its items in order): each item's place,
    group (RECENT / KEPT for the agent's own events, AG_KINDS or "ag's sections" for ag's),
    name (the event type, or the made item's name), size (the manager's own count), the event
    row or made item it is, and its text (an event's readable text, else its payload; a made
    item's text)."""
    meta = conn.execute("SELECT * FROM _reads WHERE read_id = ?", (read_id,)).fetchone()
    cut = None                           # where the build the read was made from cut the history
    if meta is not None and meta["basis"] and str(meta["basis"]).isdigit() and "_builds" in _tables(conn):
        found = conn.execute("SELECT open_from_row FROM _builds WHERE build_id = ?", (int(meta["basis"]),)).fetchone()
        cut = found[0] if found else None
    rows = conn.execute(
        "SELECT i.position, i.row_id, i.made_id, t.name AS type, e.tokens AS etok, e.text AS etext, "
        "e.payload_json AS payload, e.inserted_at AS at, m.name AS made, m.tokens AS mtok, m.item_json AS item "
        "FROM _read_items i LEFT JOIN events e ON e.row_id = i.row_id "
        "LEFT JOIN event_types t ON t.event_type_id = e.event_type_id "
        "LEFT JOIN _made_items m ON m.made_id = i.made_id WHERE i.read_id = ? ORDER BY i.position",
        (read_id,)).fetchall()
    items = []
    for r in rows:
        if r["row_id"] is not None:              # the agent's own, verbatim
            group = RECENT if cut is None or r["row_id"] >= cut else KEPT
            name, tokens, text = r["type"] or "?", r["etok"] or 0, r["etext"] if r["etext"] else readable(r["payload"])
        else:
            name, tokens = r["made"] or "?", r["mtok"] or 0
            group = AG_KINDS.get(name, "ag's sections")
            try:
                made = json.loads(r["item"]) if r["item"] else {}
            except ValueError:
                made = {}
            text = made.get("text") if isinstance(made, dict) and isinstance(made.get("text"), str) else r["item"]
        items.append({"position": r["position"], "group": group, "name": name, "tokens": tokens,
                      "row_id": r["row_id"], "made_id": r["made_id"], "at": _seconds(r["at"]), "text": text or ""})
    return meta, cut, items


def read(gatherer: str, read_id: int) -> dict:
    """What read `read_id` put in the context: each item's kind and size (the manager's own
    count; all of them add up to its `sent_tokens`), grouped as the agent's own events,
    verbatim, by event type -- RECENT (since the cut of the read's build) and KEPT (before
    it) -- and ag's own messages, by name."""
    conn = _connect(gatherer)
    if conn is None:
        return {"error": f"no database for gatherer {gatherer!r}"}
    try:
        meta, cut, items = _items(conn, read_id)
        groups: Dict[str, dict] = {}
        for it in items:
            g = groups.setdefault(it["group"], {"group": it["group"], "tokens": 0, "items": 0, "by_name": {}})
            g["tokens"] += it["tokens"]
            g["items"] += 1
            n = g["by_name"].setdefault(it["name"], {"name": it["name"], "tokens": 0, "items": 0})
            n["tokens"] += it["tokens"]
            n["items"] += 1
        return {"read_id": read_id, "cut": cut, "at": _seconds(meta["read_at"]) if meta else None,
                "real_tokens": meta["real_tokens"] if meta is not None and "real_tokens" in meta.keys() else None,
                "groups": [dict(g, by_name=sorted(g["by_name"].values(), key=lambda n: -n["tokens"]))
                           for g in sorted(groups.values(), key=lambda g: -g["tokens"])]}
    finally:
        conn.close()


TEXT_CHARS = 20000          # the most of one item's text `context` returns; the rest is counted, not sent


HISTORY_ITEMS = 3000        # the most events `history` returns at once


def history(gatherer: str, channel: str, first_row: int, last_row: Optional[int] = None) -> dict:
    """The channel's own events from row `first_row` to `last_row` (None: to its newest), in
    order, as `context` lists items: each one's type, size, time and text (at most
    TEXT_CHARS; `clipped` says how much more), at most HISTORY_ITEMS of them (`more` counts
    the rest) -- a task's messages, or those since the last task. To its newest, they end with
    the channel's pending events (`_pending`): what the model answered that no call has stored yet."""
    conn = _connect(gatherer)
    if conn is None:
        return {"error": f"no database for gatherer {gatherer!r}"}
    try:
        if not _channels_kept(conn):
            return dict(NOTHING_YET)
        top = last_row if last_row is not None else 2 ** 62
        where = f"ifnull(e.{CHANNEL}, '') = ? AND e.row_id >= ? AND e.row_id <= ? AND {NOT_RECORD}"
        n = conn.execute(f"SELECT count(*) FROM events e WHERE {where}", (channel, first_row, top)).fetchone()[0]
        items = []
        for r in conn.execute(
                "SELECT e.row_id, t.name AS type, e.tokens, e.text, e.payload_json, e.inserted_at FROM events e "
                f"LEFT JOIN event_types t ON t.event_type_id = e.event_type_id WHERE {where} ORDER BY e.row_id LIMIT ?",
                (channel, first_row, top, HISTORY_ITEMS)):
            text = r["text"] if r["text"] else readable(r["payload_json"])
            items.append({"row_id": r["row_id"], "name": r["type"] or "?", "tokens": r["tokens"] or 0,
                          "at": _seconds(r["inserted_at"]), "clipped": max(0, len(text or "") - TEXT_CHARS),
                          "text": (text or "")[:TEXT_CHARS]})
        if last_row is None:               # to its newest: what the model answered since, no call has carried yet
            items += _pending(conn, channel, _tables(conn))
        return {"first_row": first_row, "last_row": last_row, "items": items, "more": max(0, n - len(items))}
    finally:
        conn.close()


# ---------------------------------------------------------------- the transcript: the conversation as parts

TRANSCRIPT_ITEMS = 400      # the most events `transcript` returns at once
#: Which role an event's text has, by its type: what the transcript shows it as.
ROLES = {"user_message": "user", "agent_message": "assistant", "agent_reasoning": "thinking",
         "tool_call": "assistant", "tool_output": "user"}


def _clip(value, chars: int = TEXT_CHARS):
    """`value` with every string in it at most `chars` long: a tool's input, as the page shows it."""
    if isinstance(value, str):
        return value if len(value) <= chars else value[:chars] + f"\n… ({len(value) - chars:,} more characters)"
    if isinstance(value, list):
        return [_clip(v, chars) for v in value]
    if isinstance(value, dict):
        return {k: _clip(v, chars) for k, v in value.items()}
    return value


def parts(event_type: str, payload_json: Optional[str], text: Optional[str],
          chars: Optional[int] = TEXT_CHARS, harness: Optional[str] = None, kind: Optional[str] = None) -> List[dict]:
    """An event as the transcript shows it, whatever harness wrote it: its parts, each one of
        {"kind": "text", "role": user/assistant/system, "text"}
        {"kind": "thinking", "text"}                ("" when it is encrypted)
        {"kind": "call", "id", "name", "input", "action"?, "view"?}
                                                    a tool call (input: its object, or a string), what it does and
                                                    how it is shown, as its harness's rules read it (harness_kit's
                                                    Action, ToolCall.view); a script that calls tools (codex's code
                                                    mode) also has `calls`: [{name, input, action, view}], the calls
                                                    it makes (input None: not written out)
        {"kind": "result", "id", "error", "text", "shown"?, "exit"?, "took"?}
                                                    a tool's result, `id` its call's; its harness's lines about the
                                                    run taken off (`shown`), and what they said (ToolResult's)
        {"kind": "note", "name", "text", "said"?}   anything else: the harness's or ag's own messages; an attachment
                                                    (`name` "image", "document"). `said`, where its harness's rules
                                                    read it: {kind (a Kind), detail} (harness_kit's Part)
    The channel's harness's own format (`harness`, as `_harness` has it) is read by its rules (harness_kit's `read_one`;
    `kind`, the Kind the event was stored as, for a piece its neighbours decided) and drawn here the same for every
    harness (`_view`); a format its rules do not read (pi's, opencode's) is drawn from its content blocks, and anything
    else shows as its readable text. A channel whose harness is not known is read by DEFAULT's rules (whose channels
    they were, before the harness was recorded). Each text, input and what was said is clipped at `chars` (None: kept
    whole)."""
    try:
        p = json.loads(payload_json) if payload_json else None
    except ValueError:
        p = None
    role = ROLES.get(event_type)
    h = harness_kit.get(harness or harness_kit.DEFAULT)
    if role is None:                         # not the conversation: a system message, the harness's or ag's notices
        out = [{"kind": "note", "name": event_type, "text": text or readable(payload_json)}]
        said = next(iter(_read(h, p, kind)), None)
        if said is not None and said.text is not None:
            out[0]["said"] = _reading(said)
    else:
        read = _read(h, p, kind)
        out = [v for x in read for v in _view(x, role)]
        if not out and isinstance(p, dict) and isinstance(p.get("content"), list):
            out = _blocks_view(p["content"], "system" if p.get("role") in ("system", "developer") else role)
        if not out:                          # a format this does not read: its words, as its type says
            words = text or readable(payload_json)
            if event_type == "agent_reasoning":
                out.append({"kind": "thinking", "text": words if words != payload_json else ""})
            elif words:
                out.append({"kind": "text", "role": role, "text": words})
    for part in out if chars is not None else []:
        for k in ("text", "input", "calls", "said", "view", "shown"):
            if k in part:
                part[k] = _clip(part[k], chars)
    return out


def _read(h: Optional["harness_kit.Harness"], payload, kind: Optional[str] = None) -> List["harness_kit.Part"]:
    """A stored piece as `h`'s rules read it on its own ([] where there are none, or it is no piece of theirs)."""
    if h is None or not isinstance(payload, dict):
        return []
    try:
        return h.read_one(payload, kind)
    except Exception:  # noqa: BLE001 - a piece the rules trip on is drawn as its words, not an error
        return []


def _reading(x: "harness_kit.Part") -> dict:
    """What a harness's rules read of a note: its Kind, and what that kind says besides (Part.detail)."""
    return {"kind": x.kind, "detail": {k: v for k, v in x.detail.items() if k != "block"}}


def _view(x: "harness_kit.Part", role: str) -> List[dict]:
    """A piece, as its harness's rules read it (harness_kit's Part), as the transcript draws it -- the same for every
    harness: a tool call (and the calls of a script), a result, thinking, an attachment, the user's or the model's
    words in the role they came in (a system message's as the system's), and the harness's own text a note."""
    if x.tool is not None:
        bare = lambda v: {k: x for k, x in (v or {}).items() if x is not None}     # noqa: E731 - what it says, no more
        call = {"kind": "call", "id": x.tool.id, "name": x.tool.name, "input": x.tool.input, "action": x.tool.action,
                "view": bare(x.tool.view)}
        if x.tool.calls:
            call["calls"] = [{"name": c.name, "input": c.input, "action": c.action, "view": bare(c.view)} for c in x.tool.calls]
        return [call]
    if x.result is not None:
        r = x.result
        return [{"kind": "result", "id": r.call_id, "error": r.error, "text": r.output,
                 **{k: v for k, v in (("shown", r.shown), ("exit", r.exit), ("took", r.took)) if v is not None}}]
    if x.kind == Kind.REASONING:
        return [{"kind": "thinking", "text": x.detail.get("thinking", x.text) or ""}]
    if x.attachment:
        return [{"kind": "note", "name": x.attachment, "text": f"[{x.attachment}]"}]
    if not (x.text or "").strip():
        return []
    if x.kind in USERS or x.kind == Kind.AGENT:
        return [{"kind": "text", "role": "system" if x.role in ("system", "developer") else role, "text": x.text}]
    return [{"kind": "note", "name": "context", "text": x.text, "said": _reading(x)}]


def _blocks_view(content: list, speaker: str) -> List[dict]:
    """Content blocks of a format no harness's rules read (pi's; an item codex sends untyped), as the transcript draws
    them: their words and thinking, any calls and results among them, an image as a note."""
    out = []
    for b in content:
        if not isinstance(b, dict):
            continue
        t = b.get("type")
        if t in ("text", "input_text", "output_text"):
            if (b.get("text") or "").strip():
                out.append({"kind": "text", "role": speaker, "text": b["text"]})
        elif t in ("thinking", "redacted_thinking", "reasoning_text"):
            out.append({"kind": "thinking", "text": b.get("thinking") or b.get("text") or ""})
        elif t in ("tool_use", "server_tool_use"):
            out.append({"kind": "call", "id": b.get("id"), "name": b.get("name") or "tool", "input": b.get("input")})
        elif t in ("tool_result", "web_search_tool_result"):
            out.append({"kind": "result", "id": b.get("tool_use_id"), "error": bool(b.get("is_error")),
                        "text": _output(b.get("content"))})
        elif t in ("image", "input_image"):
            out.append({"kind": "note", "name": "image", "text": "[image]"})
    return out


def transcript(gatherer: str, channel: str, after: Optional[int] = None, before: Optional[int] = None) -> dict:
    """The channel's conversation as the transcript shows it: each event's row, type, time and
    `parts` (`parts`), oldest first, at most TRANSCRIPT_ITEMS of them -- those after row `after`,
    else the newest before row `before` (None: the newest of all). `earlier` says whether the
    channel has events before the first; reaching its newest, the items end with its pending
    events (row None): what the model answered that no call has stored yet."""
    conn = _connect(gatherer)
    if conn is None:
        return {"error": f"no database for gatherer {gatherer!r}"}
    try:
        if not _channels_kept(conn):
            return dict(NOTHING_YET)
        cols = ("SELECT e.row_id, t.name AS type, e.text, e.payload_json, e.inserted_at FROM events e "
                f"LEFT JOIN event_types t ON t.event_type_id = e.event_type_id WHERE ifnull(e.{CHANNEL}, '') = ? AND {NOT_RECORD} ")
        if after is not None:
            rows = conn.execute(cols + "AND e.row_id > ? ORDER BY e.row_id LIMIT ?",
                                (channel, after, TRANSCRIPT_ITEMS + 1)).fetchall()
            newest = len(rows) <= TRANSCRIPT_ITEMS
            rows = rows[:TRANSCRIPT_ITEMS]
        else:
            rows = conn.execute(cols + "AND e.row_id < ? ORDER BY e.row_id DESC LIMIT ?",
                                (channel, before if before is not None else 2 ** 62, TRANSCRIPT_ITEMS)).fetchall()[::-1]
            newest = before is None
        harness = _harness(conn, channel)
        items = [{"row_id": r["row_id"], "type": r["type"] or "?", "at": _seconds(r["inserted_at"]),
                  "parts": parts(r["type"] or "?", r["payload_json"], r["text"], harness=harness)} for r in rows]
        earlier = False
        if items:
            earlier = conn.execute(f"SELECT 1 FROM events e WHERE ifnull(e.{CHANNEL}, '') = ? AND e.row_id < ? AND {NOT_RECORD} LIMIT 1",
                                   (channel, items[0]["row_id"])).fetchone() is not None
        elif after is not None:
            earlier = True
        if newest:
            for r in replies(conn, channel):
                items.append({"row_id": None, "type": r["type"], "at": _seconds(r["received_at"]),
                              "parts": parts(r["type"], r["payload_json"], r["text"], harness=harness)})
        return {"items": items, "earlier": earlier, "newest": newest}
    finally:
        conn.close()


def context(gatherer: str, read_id: int) -> dict:
    """Every item read `read_id` put in the context, in the order the model got them: its
    group, name, size and text (at most TEXT_CHARS of it; `clipped` says how much more)."""
    conn = _connect(gatherer)
    if conn is None:
        return {"error": f"no database for gatherer {gatherer!r}"}
    try:
        meta, cut, items = _items(conn, read_id)
        ids = _preamble_ids(meta["preamble_json"]) if meta is not None and "preamble_json" in meta.keys() else []
        known = _preambles(conn, ids)
        preamble = [{"position": None, "group": PREAMBLE, "name": known[i]["name"], "tokens": known[i]["tokens"],
                     "row_id": None, "made_id": None, "at": None, "text": known[i]["text"]} for i in ids if i in known]
        for it in preamble + items:
            it["clipped"] = max(0, len(it["text"]) - TEXT_CHARS)
            it["text"] = it["text"][:TEXT_CHARS]
        real = meta["real_tokens"] if meta is not None and "real_tokens" in meta.keys() else None
        counted = sum(it["tokens"] for it in preamble + items)
        return {"read_id": read_id, "cut": cut, "at": _seconds(meta["read_at"]) if meta else None,
                "basis": meta["basis"] if meta is not None else None, "real_tokens": real,
                "tokens": sum(it["tokens"] for it in items), "preamble": preamble,
                "not_counted": max(0, real - counted) if real else None, "items": items}
    finally:
        conn.close()


# ---------------------------------------------------------------- the Gatherer's own model calls

def llm_calls() -> List[dict]:
    """The Gatherer's model calls, as its call log keeps them (<home>/logs/llm): each one's
    purpose, model, start, seconds, tokens in and out, error, and the job it ran for when
    the worker named it (`job`: gatherer, job, id, properties)."""
    out = []
    for path in sorted(glob.glob(os.path.join(paths.llm_log_dir(), "*.json"))):
        try:
            with open(path, encoding="utf-8") as fh:
                rec = json.load(fh)
        except (OSError, ValueError):
            continue
        usage = rec.get("usage") or {}
        tin = usage.get("prompt_tokens", usage.get("input_tokens"))
        tout = usage.get("completion_tokens", usage.get("output_tokens"))
        out.append({"purpose": rec.get("purpose"), "model": rec.get("model"), "started": _seconds(rec.get("started")),
                    "seconds": rec.get("seconds"), "tokens_in": tin if isinstance(tin, int) else 0,
                    "tokens_out": tout if isinstance(tout, int) else 0, "error": rec.get("error"),
                    "job": rec.get("job") if isinstance(rec.get("job"), dict) else None})
    return out


def _belongs(call: dict, gatherer: str, channel: str, builds: List[dict], checks: List[dict]) -> bool:
    """Whether a model call was made for this agent: as its job says, else (a log from before
    jobs were named) by time -- within one of its builds, or one of its new-task checks."""
    job = call.get("job")
    if job:
        return job.get("gatherer") == gatherer and (job.get("properties") or {}).get("channel") in (channel, None)
    t = call.get("started")
    if t is None:
        return False
    if call.get("purpose") == "boundary":
        return any(c["asked"] and c["asked"] - 1 <= t <= (c["decided"] or c["asked"]) + 1 for c in checks)
    return any(b["started"] and b["started"] - 1 <= t <= (b["finished"] or time.time()) + 1 for b in builds)


def _cost(model: Optional[str], tin: int, tout: int) -> Optional[float]:
    """The call's cost in USD by LiteLLM's price table, None when it has no price for the model."""
    if not model or "/" not in model or model.split("/", 1)[0] in ("codex", "claude-code"):
        return None
    os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")    # the price table it ships: no fetch
    os.environ.setdefault("LITELLM_LOG", "ERROR")
    try:
        import litellm
        a, b = litellm.cost_per_token(model=model, prompt_tokens=tin, completion_tokens=tout)
        return float(a) + float(b)
    except Exception:  # noqa: BLE001 - an unpriced model costs "unknown", not an error
        return None


def _llm_summary(calls: List[dict]) -> dict:
    by: Dict[str, dict] = {}
    for c in calls:
        p = by.setdefault(c["purpose"] or "?", {"purpose": c["purpose"] or "?", "calls": 0, "tokens_in": 0,
                                                "tokens_out": 0, "seconds": 0.0, "errors": 0, "cost": 0.0,
                                                "unpriced": 0, "models": set()})
        p["calls"] += 1
        p["tokens_in"] += c["tokens_in"]
        p["tokens_out"] += c["tokens_out"]
        p["seconds"] += c["seconds"] or 0
        p["errors"] += 1 if c["error"] else 0
        p["models"].add(c["model"] or "?")
        cost = _cost(c["model"], c["tokens_in"], c["tokens_out"])
        if cost is None:
            p["unpriced"] += 1
        else:
            p["cost"] += cost
    rows = [dict(p, models=sorted(p["models"]), seconds=round(p["seconds"], 1)) for p in by.values()]
    rows.sort(key=lambda p: -p["calls"])
    total = {k: sum(p[k] for p in rows) for k in ("calls", "tokens_in", "tokens_out", "errors", "cost", "unpriced")}
    return {"by_purpose": rows, "total": total,
            "calls": [{k: c[k] for k in ("purpose", "started", "seconds", "tokens_in", "tokens_out")} for c in calls]}


def snapshot() -> dict:
    """Everything, for a page that stands alone (`ag dashboard --out`): the home, every
    agent over time, and the last read's contents of each (by kind, and item by item); and the
    avatars the actors were given (avatars.py), each picture inside it."""
    pool = avatars.pictures()
    has, said = avatars.kept()
    h = avatars.attach(home(), has, pool, said)
    llm = llm_calls()
    agents, reads, contexts = {}, {}, {}
    for g in h["gatherers"]:
        for a in g["agents"]:
            detail = agent(g["name"], a["channel"], llm)
            agents[f"{g['name']}\u0000{a['channel']}"] = detail
            if detail.get("reads"):
                rid = detail["reads"][-1]["read_id"]
                reads[f"{g['name']}\u0000{rid}"] = read(g["name"], rid)
                contexts[f"{g['name']}\u0000{rid}"] = context(g["name"], rid)
    pictures = {}
    for name in {a["avatar"] for g in h["gatherers"] for a in g["agents"] if a["avatar"]}:
        with open(avatars.path(name), encoding="utf-8") as fh:
            pictures[name] = fh.read()
    return {"home": h, "agents": agents, "reads": reads, "contexts": contexts, "avatars": pictures}
