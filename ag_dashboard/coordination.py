"""Actors talking to one another, and the GATHERER AGENT that coordinates them for the user -- through the dashboard,
which runs them. Every actor of a gatherer is told (the gatherer's guide, ag's policy) that the others exist and how to
reach them: `ag actors` (ag/cli/actors.py), run in its shell, asks this dashboard (server.py's /api/actors/<op>):

    list      the actors of its gatherer, those not closed (`all`: every one): each one's id, name, status, harness,
              directory, what it was last asked and its recap
    show      one actor: that, what it said last, and the files its latest turn changed (files.py's `files`)
    who       the actors of its gatherer that changed a file lately, the latest first (editor.py's `writers`)
    send      a message to an actor -- `gatherer` names the gatherer agent, started for it if it has none -- typed into
              its terminal as a message of its conversation, as Chat sends one (sessions.py's `send`: its terminal opened
              for it, if it has none open), in an envelope saying who it is from and how to answer (`envelope`)
    new       a new actor in the gatherer, started with a message: in a directory, on a harness and model, as given, else
              as the actor it is `like` has them, else as the asker's -- or a DocWriter's actor (`docwriter`): a new
              DocWriter on the directory (docwriter.py's `create`), its actor writing with the user there, its edits
              proposals the user accepts or rejects in its DocWriter view -- or an actor on a branch of its own
              (`branch`): a new worktree of the repository the directory is in (branches.py's `create`, as the page's
              branch button makes one; the repository made one of the gatherer's projects if it is not yet), what the
              actor changes there merged into the repository's checkout by the dashboard (`approve`: each change
              waiting for the user in the Editor) -- or a Browser's actor (`browser`): a new Browser (browser.py's
              `create`), a Chrome tab in the dashboard the actor and the user use together
    when      the asker told, by an update in its conversation, once an actor's turn is over (WATCHES)
    watches   what the asker asked to be told and has not been yet; `unwatch`, one of them dropped

The asker is the actor whose command it is, by the id the command found (its harness's own session variable, else
sessions.py's ACTOR_VAR, set in every session the dashboard starts): a session started here, by its id or the one it
was started under, else any channel of the home's gatherers. Its gatherer is that channel's.

The GATHERER AGENT is a session of its gatherer like any other -- so its context holds what the user asked each actor,
as the gatherer's policy shows every session the others' requests -- kept in the dashboard's table with the role
COORDINATOR (sessions.py), and run with `instructions` added to its harness's own on every run: the file
gatherer_agent.md beside this module, or the home's own copy of it (<home>/dashboard/gatherer_agent.md), read anew for
each run -- a change to it is what the agent is told next. One per gatherer:
started from the page (`coordinator`), or by the first message an actor sends it, in the directory asked for, else the
asker's, on Claude Code where it can run, else codex.

Its channel is PRIVATE: no other actor's context shows what is said in it. The policy reads that from a `role` record
in it ({role: "coordinator", private: true}; ag's proactive_context_manager, `unseen`), which the dashboard puts there
once the channel is in its gatherer (`_mark_private`): the agent sees every actor's requests, they see none of its.
The messages it and the actors send one another are not shown to the others either (the policy's
`unshared_openings`, which these envelopes open with).

Each message is kept in its sender's channel as an `actor_message` event (actions.py's `record`) -- {to, to_name, text,
kind: "send" or "new"} -- which Chat shows in the sender's turn; the message itself is the receiver's, in its
conversation, where Chat knows it by its envelope (page.html's `envelope`, ENVELOPE here).

WATCHES, table `watches` in the dashboard's database (<home>/dashboard.db, beside sessions.py's), one row per watch:

    id            its number, by which it is dropped
    gatherer      the gatherer of both actors
    watcher       the channel to tell
    target        the channel watched
    note          what the watcher asked to be reminded of when told ("" none)
    created       when it was asked (epoch seconds)
    seen_running  1 once the target was seen at work since
    fired         when the watcher was told (epoch seconds); 0 not yet
    outcome       what telling it did: "told", or why it could not be told; "due <status>: why" (fired still 0) while
                  the watcher's message box could not take it

`Watches` looks at them every WATCH_CHECK seconds: a target is done once it no longer works -- idle, closed, or
stopped on an error; not while it waits on the user, nor while work it left running in the background (which wakes it
again) goes on -- after it was seen at work, or WATCH_GRACE seconds after the watch was asked, never seen at work (idle
already, and nothing woke it). The watcher is then sent
what it asked to be told, with what the target was asked and said last. A watcher whose message box cannot take it
then -- a dialog or a question open in its terminal, something typed there and not sent (sessions.py's NotAtBox) -- is
told at each later look until it can be, of the end it missed, whatever its target does meanwhile.
"""

import json
import os
import re
import sqlite3
import threading
import time
import uuid
from typing import Callable, Dict, List, Optional, Tuple

import harness_kit

from . import actions, branches, browser as bw, data, docwriter as dw, editor, files, naming, sessions

COORDINATOR = sessions.COORDINATOR
ALIASES = ("gatherer", "gatherer-agent", "coordinator")   # what `send`, `show` and `when` take for the gatherer agent
NAME = data.COORDINATOR_NAME
ASKED_CHARS = 300               # the most of what an actor was asked, in a list
SAID_CHARS = 1500               # the most of what it said last, in `show` and a watch's message
MESSAGE_CHARS = 20000           # the longest message sent
NOTE_CHARS = 2000               # the longest note a watch keeps
WHO_SECONDS = 24 * 3600         # how far back `who` looks
WATCH_CHECK = 3.0               # how often the watches are looked at
WATCH_GRACE = 20.0              # a target never seen at work: over, this long after the watch was asked
#: An actor at work: its turn not over -- waiting on the user, or on work it left running in the background, which
#: wakes it again when done (Claude Code's background commands, agents and monitors).
BUSY = (data.RUNNING, data.ASKING, data.BACKGROUND)
DUE = "due "                     # a watch's outcome while its watcher's box could not take it: "due <status>: why"
ACTOR_MESSAGE = "actor_message"
ROLE = "role"                                       # the record that makes the gatherer agent's channel private
CHANGES = {"edit", "write", "delete"}               # what a file in a turn's list was, when the turn changed it
INSTRUCTIONS_FILE = "gatherer_agent.md"             # what the gatherer agent is told (`instructions`), beside this module
INSTRUCTIONS = os.path.join(os.path.dirname(os.path.abspath(__file__)), INSTRUCTIONS_FILE)

# The envelope a message goes in, its first line saying who it is from and how to answer, then a blank line, then the
# message: from the gatherer agent, or from another actor (its id, and its name as JSON). ENVELOPE reads it back (as
# page.html's `envelope` does, the same pattern) -- also with its lines made one, as data.py's `last_user_message` has
# a message. A watch's news (`update`) is no one's message: its first line says which watch and what became of the
# actor watched, then what it was asked and said last, and the watcher's note (UPDATE reads it back).
FROM_COORDINATOR = 'Message from the gatherer agent (answer it with: ag actors send gatherer "..."):'
FROM_ACTOR = 'Message from actor {id}{name} (answer it with: ag actors send {id} "..."):'
ENVELOPE = re.compile(r'^Message from (the gatherer agent|actor ([\w-]+)(?:, ("(?:[^"\\]|\\.)*"))?)'
                      r'(?: \(answer it with: [^\n]*?\))?:\s+([\s\S]*)$')
UPDATE_HEAD = "Update (you asked with `ag actors when`, watch {n}): actor {id}{name} is done: {how}."
UPDATE = re.compile(r'^Update \(you asked with `ag actors when`, watch (\d+)\): actor ([\w-]+)(?: \(("(?:[^"\\]|\\.)*")\))?'
                    r' is done: ([^\n]*?)\.(?:\s+([\s\S]*))?$')

SCHEMA = """CREATE TABLE IF NOT EXISTS watches (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    gatherer     TEXT NOT NULL,
    watcher      TEXT NOT NULL,
    target       TEXT NOT NULL,
    note         TEXT NOT NULL DEFAULT '',
    created      REAL NOT NULL,
    seen_running INTEGER NOT NULL DEFAULT 0,
    fired        REAL NOT NULL DEFAULT 0,
    outcome      TEXT
)"""


class CoordinationError(sessions.SessionError):
    """What an actor asked that cannot be done: its command prints the text."""


def envelope(sender: dict, text: str) -> str:
    """`text` as the receiver gets it, from `sender`: {"kind": "coordinator"}, or {"kind": "actor", "id": its id, "name":
    its name or None}."""
    if sender["kind"] == "coordinator":
        head = FROM_COORDINATOR
    else:
        head = FROM_ACTOR.format(id=sender["id"], name=f", {json.dumps(sender['name'])}" if sender.get("name") else "")
    return f"{head}\n\n{text.strip()}"


def update(n: int, target: str, name: Optional[str], how: str, text: str) -> str:
    """A watch's news, watch `n`'s: the actor `target` (its `name`) is done (`how`), then `text`."""
    head = UPDATE_HEAD.format(n=n, id=target, name=f" ({json.dumps(name)})" if name else "", how=how)
    return f"{head}\n\n{text.strip()}" if text.strip() else head


def opened(text: str) -> Optional[dict]:
    """A message's envelope read back: {"from": "coordinator" | "actor", "id", "name", "text"} -- or a watch's news,
    {"from": "update", "id" (the actor watched), "name", "how", "watch", "text"}; None for a message in neither."""
    m = UPDATE.match(text or "")
    if m is not None:
        try:
            name = json.loads(m.group(3)) if m.group(3) else None
        except ValueError:
            name = None
        return {"from": "update", "id": m.group(2), "name": name, "how": m.group(4), "watch": int(m.group(1)),
                "text": m.group(5) or ""}
    m = ENVELOPE.match(text or "")
    if m is None:
        return None
    who = "coordinator" if m.group(1) == "the gatherer agent" else "actor"
    try:
        name = json.loads(m.group(3)) if m.group(3) else None
    except ValueError:
        name = None
    return {"from": who, "id": m.group(2), "name": name, "text": m.group(4)}


def instructions(gatherer: str) -> str:
    """What the gatherer agent of `gatherer` is told, on every run, besides its harness's own instructions: the
    INSTRUCTIONS file -- the home's own (<home>/dashboard/gatherer_agent.md), else the dashboard's -- read anew for each
    run, so a change to it is what the next run is told; `{gatherer}` in it, the gatherer's name."""
    for path in (os.path.join(sessions.home.HOME, "dashboard", INSTRUCTIONS_FILE), INSTRUCTIONS):
        try:
            with open(path, encoding="utf-8") as fh:
                return fh.read().replace("{gatherer}", gatherer)
        except OSError:
            continue
    raise CoordinationError(f"no instructions for the gatherer agent: {INSTRUCTIONS} is missing")




class Coordination:
    """What actors ask the dashboard (module doc), and the watches: `started`, the dashboard's sessions, which run the
    actors; `ring(gatherer)`, told when a gatherer's actors changed; `docwriters`, its DocWriters (docwriter.py), which
    a new actor may be one of; `branched`, its actors' branches (branches.py), which a new actor may be on.
    Thread-safe: the server's handlers share one, and its watches are looked at on a thread of its own, until
    `close`."""

    def __init__(self, started: "sessions.Sessions", ring: Optional[Callable[[Optional[str]], None]] = None,
                 watch: bool = True, docwriters: Optional["dw.DocWriters"] = None,
                 branched: Optional["branches.Branches"] = None, browsers: Optional["bw.Browsers"] = None):
        self.started, self.ring, self.docwriters, self.branched = started, ring, docwriters, branched
        self.browsers = browsers
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.marked: set = set()                 # the gatherer agents' channels marked private by this dashboard
        if watch:
            threading.Thread(target=self._run, name="ag-watches", daemon=True).start()

    # ---- who asks, and whom

    def _asker(self, actor: str) -> Tuple[str, dict, List[dict]]:
        """(its gatherer, the asker as an agent, the gatherer's agents) for the actor whose id is `actor`."""
        actor = (actor or "").strip()
        if not actor:
            raise CoordinationError("which actor asks? Run `ag actors` from an actor's shell: its harness says which "
                                    f"session it is (or set {sessions.ACTOR_VAR})")
        rows = self.started.list()
        row = next((r for r in rows if actor in (r["session_id"], r.get("started_as"))), None)
        if row is None:                          # its id's start (`ag actors --as`), where it names one session alone
            some = [r for r in rows if r["session_id"].startswith(actor) or (r.get("started_as") or "").startswith(actor)]
            row = some[0] if len(some) == 1 else None
        channel = row["session_id"] if row else actor
        for g in [row["gatherer"]] if row else data.gatherer_names():
            try:
                agents = data.gatherer_actors(g, rows)
            except sqlite3.Error:
                continue
            mine = [a for a in agents if a["channel"] == channel] or [a for a in agents if a["channel"].startswith(channel)]
            if len(mine) == 1:
                return g, mine[0], agents
        raise CoordinationError(f"no actor {actor} in this dashboard's home ({sessions.home.HOME})")

    def coordinator(self, gatherer: str) -> Optional[dict]:
        """The gatherer agent of `gatherer`, as the dashboard's table has it; None while it has none."""
        return next((r for r in self.started.list() if r["gatherer"] == gatherer and r.get("role") == COORDINATOR), None)

    def ensure(self, gatherer: str, cwd: Optional[str] = None, harness: Optional[str] = None,
               model: Optional[str] = None) -> dict:
        """The gatherer agent of `gatherer`, started if it has none: in `cwd` (else the user's home), on `harness` (else
        the first harness that can run here, in harness_kit's order) and `model`. As the dashboard's table has it."""
        with self.lock:
            row = self.coordinator(gatherer)
            if row is not None:
                return row
            can = sessions.available() or list(sessions.HARNESSES)
            harness = harness if harness in sessions.HARNESSES else next((h for h in sessions.HARNESSES if h in can), harness_kit.DEFAULT)
            cwd = cwd if cwd and os.path.isdir(cwd) else os.path.expanduser("~")
            row = self.started.create(gatherer, cwd, "auto", harness, model, role=COORDINATOR)
        if self.ring is not None:
            self.ring(gatherer)
        threading.Thread(target=self._mark_private, name="ag-private", daemon=True).start()   # before its first call
        return row

    @staticmethod
    def _is_coordinator(a: dict) -> bool:
        return (a.get("session") or {}).get("role") == COORDINATOR

    def _find(self, gatherer: str, ref: str, agents: List[dict], start: Optional[dict] = None) -> Optional[dict]:
        """The agent `ref` names among `agents`: an alias of the gatherer agent (None while there is none, unless `start`
        -- {cwd, harness} -- says to start it), an id or its start, the id it was started under, or a name."""
        ref = (ref or "").strip()
        if not ref:
            raise CoordinationError("which actor? Give its id (`ag actors` lists them), or `gatherer` for the gatherer agent")
        if ref.lower() in ALIASES:
            found = next((a for a in agents if self._is_coordinator(a)), None)
            if found is not None or start is None:
                return found
            row = self.ensure(gatherer, start.get("cwd"), start.get("harness"))
            return next((a for a in data.gatherer_actors(gatherer, self.started.list()) if a["channel"] == row["session_id"]),
                        None) or {"channel": row["session_id"], "session": row, "harness": row["harness"], "cwd": row["cwd"],
                                  "status": data.IDLE}

        def ids(a: dict) -> List[str]:
            return [x for x in (a["channel"], (a.get("session") or {}).get("started_as")) if x]
        exact = [a for a in agents if ref in ids(a)]
        if exact:
            return exact[0]
        starts = [a for a in agents if any(x.startswith(ref) for x in ids(a))]
        if len(starts) == 1:
            return starts[0]
        if len(starts) > 1:
            raise CoordinationError(f"{ref} starts {len(starts)} actors' ids: give more of it")
        named = [a for a in agents if _name(a) and _name(a).lower() == ref.lower()]
        if len(named) == 1:
            return named[0]
        raise CoordinationError(f"no actor {ref} in the gatherer" + (f" ({len(named)} have that name)" if named else ""))

    def _sender(self, me: dict) -> dict:
        return {"kind": "coordinator"} if self._is_coordinator(me) else {"kind": "actor", "id": me["channel"], "name": _name(me)}

    def _view(self, a: dict, me: Optional[dict] = None) -> dict:
        """An actor as `ag actors` shows it -- by its whole id: a codex thread's opens with the time it was made, so
        codex actors started within a minute share their first characters (a command takes any start of an id that
        names one actor)."""
        s = a.get("session") or {}
        return {"id": a["channel"], "channel": a["channel"], "name": NAME if self._is_coordinator(a) else _name(a),
                "status": a.get("status"), "harness": a.get("harness") or s.get("harness"), "cwd": a.get("cwd") or s.get("cwd"),
                "asked": _clip(_unwrapped(a.get("last_user_message")), ASKED_CHARS),
                "recap": _clip((a.get("recap") or {}).get("text"), ASKED_CHARS),
                "last": a.get("last"), "you": bool(me) and a["channel"] == me["channel"],
                "gatherer_agent": self._is_coordinator(a), "docwriter": _docwriter_of(s) is not None,
                "browser": bw.key_of(s) is not None}

    # ---- what an actor asks

    def list(self, actor: str, every: bool = False) -> dict:
        g, me, agents = self._asker(actor)
        shown = [a for a in agents if every or a.get("status") != data.CLOSED or a["channel"] == me["channel"]
                 or self._is_coordinator(a)]
        shown.sort(key=lambda a: (not self._is_coordinator(a), -(a.get("last") or 0)))
        return {"gatherer": g, "you": me["channel"], "actors": [self._view(a, me) for a in shown],
                "closed": len(agents) - len(shown)}

    def show(self, actor: str, ref: str) -> dict:
        g, me, agents = self._asker(actor)
        a = self._find(g, ref, agents)
        if a is None:
            raise CoordinationError("the gatherer has no gatherer agent yet")
        got = _latest(g, a["channel"], a.get("cwd"))
        return {**self._view(a, me), "said": _clip(got.get("said"), SAID_CHARS),
                "asked": _clip(_unwrapped(got.get("asked")), SAID_CHARS) or self._view(a, me)["asked"], "turns": got.get("turns", 0),
                "now": got.get("now"), "changed": got.get("changed") or []}

    def who(self, actor: str, path: str) -> dict:
        g, me, agents = self._asker(actor)
        path = (path or "").strip()
        if not path:
            raise CoordinationError("which file?")
        full = os.path.normpath(os.path.join(me.get("cwd") or os.getcwd(), os.path.expanduser(path)))
        found = editor.writers([os.path.dirname(full)], time.time() - WHO_SECONDS).get(os.path.basename(full), [])
        by = {a["channel"]: a for a in agents}
        return {"path": full, "actors": [{**self._view(by[w["channel"]], me), "how": w["how"], "at": w["at"]}
                                         for w in found if w["gatherer"] == g and w["channel"] in by]}

    def send(self, actor: str, ref: str, text: str) -> dict:
        g, me, agents = self._asker(actor)
        text = _message(text)
        to = self._find(g, ref, agents, start={"cwd": me.get("cwd"), "harness": me.get("harness")})
        if to["channel"] == me["channel"]:
            raise CoordinationError("that is you")
        got = self._deliver(g, to, envelope(self._sender(me), text))
        self._keep(g, me["channel"], "send", to, text)
        return {"sent": True, "to": self._view(to, me), "session": {k: got.get(k) for k in ("status", "terminal")}}

    def new(self, actor: str, text: str, cwd: Optional[str] = None, harness: Optional[str] = None,
            model: Optional[str] = None, like: Optional[str] = None, name: Optional[str] = None,
            docwriter: bool = False, branch: bool = False, approve: bool = False, browser: bool = False) -> dict:
        g, me, agents = self._asker(actor)
        text = _message(text)
        if docwriter and branch:
            raise CoordinationError("a DocWriter writes in its folder, not on a branch: --docwriter or --branch, not both")
        if browser and (docwriter or branch):
            raise CoordinationError("a Browser's actor is neither a DocWriter nor on a branch: --browser alone")
        if approve and not branch:
            raise CoordinationError("--approve is for an actor on a branch of its own (--branch): each change it makes "
                                    "there waits for the user in the Editor")
        base = self._find(g, like, agents) if like else None
        base = base or me
        bs = base.get("session") or {}
        harness = harness or base.get("harness") or bs.get("harness") or harness_kit.DEFAULT
        if harness not in sessions.HARNESSES:
            raise CoordinationError(f"harness {harness!r}: one of {', '.join(sessions.HARNESSES)}")
        cwd = os.path.abspath(os.path.expanduser(cwd)) if cwd else base.get("cwd") or bs.get("cwd") or me.get("cwd")
        same = harness == (base.get("harness") or bs.get("harness"))
        model = model or (bs.get("model") if same else None)
        name = naming.clean(name)
        made = on = None
        mode = bs.get("permission_mode") or "auto"
        if docwriter:
            row, made = self._new_docwriter(g, cwd or "", harness, model, name)
        elif browser:
            row, made = self._new_browser(g, cwd or "", harness, model, name)
        else:
            if branch:
                row, on = self._new_on_branch(g, cwd or "", harness, model, mode, approve)
            else:
                row = self.started.create(g, cwd or "", mode, harness, model)
            if name and not sessions.picks_id(harness):   # one whose harness picks its id: named once it has it
                threading.Thread(target=_name_it, args=(g, row["session_id"], name), daemon=True).start()
        to = {"channel": row["session_id"], "session": row, "harness": harness, "cwd": row["cwd"], "status": data.IDLE,
              "name": {"text": name} if name else None}
        self._deliver(g, to, envelope(self._sender(me), text))
        self._keep(g, me["channel"], "new", to, text)
        if self.ring is not None:
            self.ring(g)
        return {"started": True, "actor": self._view(to, me), **({"browser" if browser else "docwriter": made} if made else {}),
                **({"branch": on} if on else {})}

    def _new_on_branch(self, gatherer: str, cwd: str, harness: str, model: Optional[str], mode: str,
                       approve: bool) -> Tuple[dict, dict]:
        """A new actor on a branch of its own (branches.py's `create`) of the repository `cwd` is in -- made one of the
        gatherer's projects first if it is not yet, as the page's "Add a source" makes one: (its session, as the
        dashboard's table has it; {branch, project, worktree, approve})."""
        if self.branched is None:
            raise CoordinationError("this dashboard makes no branches")
        project = branches.repository(cwd) if cwd else None
        if project is None:
            raise CoordinationError(f"{cwd or 'no directory'}: not in a git repository, which an actor's branch is made "
                                    f"from (--cwd: a folder in one)")
        try:
            if project not in {p["path"] for p in branches.projects(gatherer)}:
                branches.add_project(gatherer, project)
            got = self.branched.create(gatherer, project, harness, approve, model, permission_mode=mode)
        except branches.BranchError as exc:
            raise CoordinationError(f"no branch made: {exc}") from None
        b = got["branch"]
        row = next(r for r in self.started.list() if r["session_id"] == got["session_id"])
        return row, {k: b[k] for k in ("branch", "project", "worktree", "approve")}

    def _new_docwriter(self, gatherer: str, cwd: str, harness: str, model: Optional[str],
                       name: Optional[str]) -> Tuple[dict, dict]:
        """A new DocWriter on `cwd` (docwriter.py's `create`), its actor named `name`, else as DocWriter names it, once
        its first message is sent: (its actor's session, as the dashboard's table has it; {key, root})."""
        if self.docwriters is None:
            raise CoordinationError("this dashboard runs no DocWriter")
        try:
            got = self.docwriters.create(gatherer, cwd, harness, model)
        except dw.DocWriterError as exc:
            raise CoordinationError(f"no DocWriter started: {exc}") from None
        self.docwriters.name_actor(got["key"], name)
        row = next(r for r in self.started.list() if r["session_id"] == got["channel"])
        return row, {"key": got["key"], "root": got["root"]}

    def _new_browser(self, gatherer: str, cwd: str, harness: str, model: Optional[str],
                     name: Optional[str]) -> Tuple[dict, dict]:
        """A new Browser in `cwd` (browser.py's `create`), its actor named `name`, else "Browser · <folder>", once its
        first message is sent: (its actor's session, as the dashboard's table has it; {key, root})."""
        if self.browsers is None:
            raise CoordinationError("this dashboard runs no Browser")
        try:
            got = self.browsers.create(gatherer, cwd, harness, model)
        except bw.BrowserError as exc:
            raise CoordinationError(f"no Browser started: {exc}") from None
        self.browsers.name_actor(got["key"], name)
        row = next(r for r in self.started.list() if r["session_id"] == got["channel"])
        return row, {"key": got["key"], "root": got["root"]}

    def when(self, actor: str, ref: str, note: str = "") -> dict:
        g, me, agents = self._asker(actor)
        to = self._find(g, ref, agents)
        if to is None:
            raise CoordinationError("the gatherer has no gatherer agent yet")
        if to["channel"] == me["channel"]:
            raise CoordinationError("that is you: your turn is over when you end it")
        note = (note or "").strip()[:NOTE_CHARS]
        conn = self._db()
        try:
            n = conn.execute("INSERT INTO watches (gatherer, watcher, target, note, created, seen_running) VALUES (?, ?, ?, ?, ?, ?)",
                             (g, me["channel"], to["channel"], note, time.time(), int(to.get("status") in BUSY))).lastrowid
        finally:
            conn.close()
        return {"watch": n, "target": self._view(to, me), "note": note}

    def watches(self, actor: str) -> dict:
        g, me, agents = self._asker(actor)
        by = {a["channel"]: a for a in agents}
        conn = self._db()
        try:
            rows = conn.execute("SELECT * FROM watches WHERE gatherer = ? AND watcher = ? AND fired = 0 ORDER BY id",
                                (g, me["channel"])).fetchall()
        finally:
            conn.close()
        return {"watches": [{"watch": r["id"], "note": r["note"], "created": r["created"],
                             "target": self._view(by[r["target"]], me) if r["target"] in by else {"id": r["target"]}}
                            for r in rows]}

    def unwatch(self, actor: str, n) -> dict:
        g, me, _ = self._asker(actor)
        try:
            n = int(n)
        except (TypeError, ValueError):
            raise CoordinationError("which watch? Its number, as `ag actors watches` lists it") from None
        conn = self._db()
        try:
            gone = conn.execute("DELETE FROM watches WHERE id = ? AND gatherer = ? AND watcher = ? AND fired = 0",
                                (n, g, me["channel"])).rowcount
        finally:
            conn.close()
        if not gone:
            raise CoordinationError(f"you have no watch {n} waiting")
        return {"dropped": n}

    # ---- the page's

    def page_coordinator(self, gatherer: str, cwd: Optional[str] = None, harness: Optional[str] = None) -> dict:
        """The gatherer agent of `gatherer`, for the page to show: started (with no message yet) if it has none."""
        if not sessions.GATHERER.fullmatch(gatherer or ""):
            raise CoordinationError("which gatherer?")
        return self.ensure(gatherer, cwd, harness)

    # ---- delivering, and keeping what was sent

    def _deliver(self, gatherer: str, to: dict, body: str) -> dict:
        """`body` typed into the actor `to`'s terminal, as Chat sends a message (sessions.py's `send`): its session
        taken into the dashboard's table first, if it was not started here (`adopt`). Refused (NotAtBox), nothing typed,
        while its message box cannot take it -- a dialog or a question open in its terminal, or something typed there
        and not sent: said to the sender as what it can do about it."""
        s = to.get("session")
        sid = s["session_id"] if s else self.started.adopt(gatherer, to["channel"])["session_id"]
        harness = (s or {}).get("harness") or to.get("harness")
        try:
            rules = harness_kit.get(harness)          # its screen, as the page opens a terminal
            return self.started.send(sid, body, fullscreen=bool(rules is None or rules.fullscreen))
        except sessions.NotAtBox as exc:
            who = NAME if self._is_coordinator(to) else f"actor {to['channel'][:8]}"
            raise sessions.NotAtBox(f"not delivered: {who}'s terminal shows a dialog or a question, or holds something "
                                    f"typed there and not sent (the user may be at it). Nothing was typed; try again "
                                    f"in a while.", exc.box) from None

    def _keep(self, gatherer: str, sender: str, kind: str, to: dict, text: str) -> None:
        actions.record(gatherer, sender, [{"type": ACTOR_MESSAGE, "id": f"{ACTOR_MESSAGE}:{uuid.uuid4().hex}",
                                           "payload": {"at": time.time(), "kind": kind, "to": to["channel"],
                                                       "to_name": NAME if self._is_coordinator(to) else _name(to),
                                                       "text": text}}])

    # ---- the watches

    def _db(self) -> sqlite3.Connection:
        os.makedirs(os.path.dirname(sessions.db_path()), exist_ok=True)
        conn = sqlite3.connect(sessions.db_path(), timeout=8, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute(SCHEMA)
        return conn

    def check(self, now: Optional[float] = None) -> List[int]:
        """The watches whose watcher was told now: their numbers."""
        now = time.time() if now is None else now
        if not os.path.exists(sessions.db_path()):
            return []
        conn = self._db()
        try:
            waiting = conn.execute("SELECT * FROM watches WHERE fired = 0 ORDER BY id").fetchall()
        finally:
            conn.close()
        if not waiting:
            return []
        started = self.started.list()
        now_as = {r["started_as"]: r["session_id"] for r in started if r.get("started_as")}   # a codex session: its thread's
        by_gatherer: Dict[str, Dict[str, dict]] = {}
        for g in {w["gatherer"] for w in waiting}:
            channels = {now_as.get(w["target"], w["target"]) for w in waiting if w["gatherer"] == g}
            try:
                by_gatherer[g] = {a["channel"]: a for a in data.actors(g, channels, started)}
            except sqlite3.Error:                # not read: left as it is, till the next look
                continue
        told = []
        for w in waiting:
            if w["gatherer"] not in by_gatherer:
                continue
            a = by_gatherer[w["gatherer"]].get(now_as.get(w["target"], w["target"]))
            due = _due(w)                    # over before, its watcher's box busy then: told now, as it was then
            busy = a is not None and a.get("status") in BUSY
            if busy and not w["seen_running"] and not due:
                self._mark(w["id"], seen_running=1)
            if not due and (busy or (not w["seen_running"] and now - w["created"] < WATCH_GRACE)):
                continue
            status = due or (a or {}).get("status") or data.CLOSED
            self._mark(w["id"], fired=now, outcome="telling")       # once: a slow message is not sent twice
            try:
                self._tell(w, a, status)
                self._mark(w["id"], outcome="told")
            except sessions.NotAtBox as exc:     # nothing typed: a dialog, a draft in its box -- told at a later look
                self._mark(w["id"], fired=0, outcome=f"{DUE}{status}: {exc}"[:300])
                continue
            except Exception as exc:  # noqa: BLE001 - one watcher's trouble is not the others'
                self._mark(w["id"], outcome=f"not told: {exc}"[:300])
            told.append(w["id"])
        return told

    def _tell(self, w: sqlite3.Row, a: Optional[dict], status: Optional[str] = None) -> None:
        g = w["gatherer"]
        status = status or (a or {}).get("status") or data.CLOSED
        how = {data.IDLE: "its turn is over", data.CLOSED: "it is closed", data.ERROR: "its turn stopped on an error"}.get(status, status)
        name = (NAME if a and self._is_coordinator(a) else _name(a)) if a else None
        target = (a or {}).get("channel") or w["target"]
        lines = []
        try:
            got = _latest(g, target, (a or {}).get("cwd"))
        except Exception:  # noqa: BLE001 - told all the same, without it
            got = {}
        if got.get("asked"):
            lines.append(f"It was asked: {_clip(_unwrapped(got['asked']), SAID_CHARS)}")
        if got.get("said"):
            lines.append(f"It said last: {_clip(got['said'], SAID_CHARS)}")
        if w["note"]:
            lines.append(f"Your note: {w['note']}")
        rows = self.started.list()
        watcher = next((x for x in data.gatherer_actors(g, rows) if x["channel"] == w["watcher"]), None)
        if watcher is None:
            row = next((r for r in rows if w["watcher"] in (r["session_id"], r.get("started_as"))), None)
            if row is None:
                raise CoordinationError(f"no actor {w['watcher']} to tell")
            watcher = {"channel": row["session_id"], "session": row, "harness": row["harness"]}
        self._deliver(g, watcher, update(w["id"], target, name, how, "\n\n".join(lines)))

    def _mark(self, n: int, **values) -> None:
        conn = self._db()
        try:
            conn.execute(f"UPDATE watches SET {', '.join(k + ' = ?' for k in values)} WHERE id = ?", (*values.values(), n))
        finally:
            conn.close()

    def _mark_private(self) -> None:
        """Each gatherer agent's channel marked private, once in this dashboard's run: a `role` record in it, put in by
        ag (actions.py's `record`) once its gatherer has a database and the channel is the session's own -- a codex
        session's, once it has its thread's id. Its id is the channel's, so marking it again stores nothing new."""
        for r in self.started.list():
            key = (r["gatherer"], r["session_id"])
            if r.get("role") != COORDINATOR or key in self.marked or not os.path.exists(sessions.home.db_path(r["gatherer"])):
                continue
            if sessions.picks_id(r["harness"]) and r.get("started_as") == r["session_id"]:
                continue                             # not yet under its thread's id: no channel of the gatherer's
            self.marked.add(key)
            actions.record(r["gatherer"], r["session_id"], [{"type": ROLE, "id": f"{ROLE}:{r['session_id']}:{COORDINATOR}",
                                                             "payload": {"role": COORDINATOR, "private": True}}], wait=True)

    def _run(self) -> None:
        while not self.stop.wait(WATCH_CHECK):
            for step in (self._mark_private, self.check):
                try:
                    step()
                except Exception:  # noqa: BLE001 - never stop looking
                    pass

    def close(self) -> None:
        self.stop.set()


def _latest(gatherer: str, channel: str, cwd: Optional[str]) -> dict:
    """Of the actor's latest turn (files.py's `files`): {turns (how many), asked (its message), said (the last it said),
    now (what it is doing), changed (the files it changed, not in a temporary folder)}; {turns: 0} before its first."""
    got = files.files(gatherer, channel, None, cwd or "")
    turns = got.get("turns") or []
    if "error" in got or not turns:
        return {"turns": len(turns)}
    t = turns[-1]
    return {"turns": len(turns), "asked": t.get("text"), "now": t.get("now"),
            "said": next((r["text"] for r in reversed(t.get("replies") or []) if r.get("kind") == "text"), None),
            "changed": [f["path"] for f in got.get("files") or [] if not f.get("temporary") and set(f.get("kinds") or []) & CHANGES]}


def _unwrapped(text: Optional[str]) -> Optional[str]:
    """A message as a list says it: one in an envelope, by whom it is from, then its words."""
    got = opened(text or "")
    if got is None:
        return text
    if got["from"] == "update":
        return f"(update) actor {got['id']} is done: {got['how']}"
    who = "the gatherer agent" if got["from"] == "coordinator" else f"actor {got['id']}"
    return f"(from {who}) {got['text']}"


def _due(w: sqlite3.Row) -> Optional[str]:
    """The status a watch's target was over with, when its watcher could not be told then (DUE); else None."""
    outcome = w["outcome"] or ""
    return outcome[len(DUE):].split(":", 1)[0] or None if outcome.startswith(DUE) else None


def _docwriter_of(session: dict) -> Optional[str]:
    """The key of the DocWriter whose actor the session is (its `role`, docwriter.py's `create`), or None."""
    try:
        role = json.loads(session.get("role") or "null")
    except ValueError:
        return None
    key = role.get("docwriter") if isinstance(role, dict) else None
    return key if isinstance(key, str) and key else None


def _name(a: Optional[dict]) -> Optional[str]:
    n = (a or {}).get("name")
    return (n.get("text") if isinstance(n, dict) else n) or None


def _clip(text: Optional[str], chars: int) -> Optional[str]:
    if not text:
        return None
    text = str(text).strip()
    return text if len(text) <= chars else text[:chars].rstrip() + "…"


def _message(text: Optional[str]) -> str:
    text = (text or "").strip()
    if not text:
        raise CoordinationError("an empty message")
    if len(text) > MESSAGE_CHARS:
        raise CoordinationError(f"a message of {len(text)} characters: at most {MESSAGE_CHARS}")
    return text


def _name_it(gatherer: str, channel: str, name: str) -> None:
    try:
        naming.record(gatherer, channel, name)
    except naming.NamingError:
        pass
