"""Actors talking to one another, and the GATHERER AGENT that coordinates them for the user -- through the dashboard,
which runs them. Every actor of a gatherer is told (the gatherer's guide, ag's policy) that the others exist and how to
reach them: `ag actors` (ag/cli/actors.py), run in its shell, asks this dashboard (api/sessions.py's /api/actors/<op>):

    list      the actors of its gatherer, those not closed (`all`: every one): each one's id, name, status, harness,
              directory, what it was last asked and its recap
    show      one actor: that, what it said last, and the files its latest turn changed (files.py's `files`)
    who       the actors of its gatherer that changed a file lately, the latest first (livedocs.py's `writers`)
    send      a message to an actor -- `gatherer` names the gatherer agent, started for it if it has none -- typed into
              its terminal as a message of its conversation, as Chat sends one (sessions.py's `send`: its terminal opened
              for it, if it has none open), in an envelope saying who it is from and how to answer (`envelope`)
    new       a new actor in the gatherer, started with a message: in a directory, on a harness and model, as given, else
              as the actor it is `like` has them, else as the asker's -- or an app's actor (`--<name>`, an app that
              starts an agent of its own: app_agents.py's `start`): a new one of the app on the directory, its actor
              attached to it and named as asked -- a DocWriter's (`docwriter`), writing with the user there, its edits
              proposals the user accepts or rejects in DocWriter; a Browser's (`browser`), a Chrome tab in the
              dashboard the actor and the user use together -- or an actor on a branch of its own (`branch`): a new
              worktree of the repository the
              directory is in (branches.py's `create`, as the page's branch button makes one; the repository made one
              of the gatherer's projects if it is not yet), what the actor changes there merged into the repository's
              checkout by the dashboard (`approve`: each change waiting for the user in the Editor)
    when      the asker told, by an update in its conversation, once an actor's turn is over (WATCHES)
    watches   what the asker asked to be told and has not been yet; `unwatch`, one of them dropped
    save      an actor of its gatherer saved for later, as the bookmark in the list saves one (saved.py) -- and put in
              a folder, if one is named (made if new), or at the gatherer's top (`unfiled`); `unsave`, no longer saved
              (it stays where it is)
    folders   the gatherer's folders (folders.py), each with the actors in it and the folders in it, and the actors at
              its top
    folder    a folder made (`new`), renamed (`rename`), put in another (`move`) or deleted (`delete`: what was in it
              moved up into the folder it was in) -- each named by its path (`Harnesses/Codex`)
    move      actors put in a folder (made if new), or at the gatherer's top

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
conversation, where Chat knows it by its envelope (the page's `envelope`, ENVELOPE here).

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
from typing import Any, Callable, Dict, List, Optional, Tuple

import harness_kit
from app_kit import AppError

from . import actions, branches, data, files, folders, groups, livedocs, naming, saved, sessions

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
ALONE = "self:"                                     # an actor on its own's group of one (groups.py): no coordinator
CHANGES = {"edit", "write", "delete"}               # what a file in a turn's list was, when the turn changed it
INSTRUCTIONS_FILE = "gatherer_agent.md"             # what the gatherer agent is told (`instructions`), beside this module
INSTRUCTIONS = os.path.join(os.path.dirname(os.path.abspath(__file__)), INSTRUCTIONS_FILE)

# The envelope a message goes in, its first line saying who it is from and how to answer, then a blank line, then the
# message: from the gatherer agent, or from another actor (its id, and its name as JSON). ENVELOPE reads it back (as
# the page's `envelope` does, the same pattern) -- also with its lines made one, as data.py's `last_user_message` has
# a message. A watch's news (`update`) is no one's message: its first line says which watch and what became of the
# actor watched, then what it was asked and said last, and the watcher's note (UPDATE reads it back).
FROM_COORDINATOR = 'Message from the coordinator agent (answer it with: ag actors send coordinator "..."):'
FROM_ACTOR = 'Message from actor {id}{name} (answer it with: ag actors send {id} "..."):'
ENVELOPE = re.compile(r'^Message from (the (?:gatherer|coordinator) agent|actor ([\w-]+)(?:, ("(?:[^"\\]|\\.)*"))?)'
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
    who = "coordinator" if m.group(1).startswith("the ") else "actor"      # its old name, or the one it is told by
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
    raise CoordinationError(f"no instructions for the coordinator agent: {INSTRUCTIONS} is missing")




def _app_of(s: dict) -> Optional[str]:
    """The app of app_kit's whose actor the session is (app_agents.py's `role_of`: DocWriter's), else None."""
    from . import app_agents, tool_gateway
    got = app_agents.role_of(s)
    return got[0] if got and tool_gateway.HOST is not None and got[0] in tool_gateway.HOST.apps else None


def _starters() -> Dict[str, Any]:
    """The apps on this dashboard's host that start an agent of their own ([agent] start), by name: what
    `ag actors new --<name>` may ask for."""
    from . import tool_gateway
    h = tool_gateway.HOST
    if h is None:
        return {}
    return {n: x.manifest for n, x in h.apps.items() if x.manifest.agent.start}


class Coordination:
    """What actors ask the dashboard (module doc), and the watches: `started`, the dashboard's sessions, which run the
    actors; `ring(gatherer)`, told when a gatherer's actors changed; `branched`, its actors' branches (branches.py),
    which a new actor may be on. A new actor may be an app's (`_starters`: the app host's apps that start one).
    Thread-safe: the server's handlers share one, and its watches are looked at on a thread of its own, until
    `close`."""

    def __init__(self, started: "sessions.Sessions", ring: Optional[Callable[[Optional[str]], None]] = None,
                 watch: bool = True, branched: Optional["branches.Branches"] = None):
        self.started, self.ring, self.branched = started, ring, branched
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.marked: set = set()                 # the gatherer agents' channels marked private by this dashboard
        self.unnamed: Dict[str, Tuple[str, str]] = {}   # a new actor's id, its harness's still to come -> (gatherer, name)
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
        if gatherer.startswith(ALONE):
            raise CoordinationError("an actor on its own has no coordinator agent")
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
            raise CoordinationError("which actor? Give its id (`ag actors` lists them), or `coordinator` for the coordinator agent")
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
        raise CoordinationError(f"no actor {ref} in the group" + (f" ({len(named)} have that name)" if named else ""))

    def _sender(self, me: dict) -> dict:
        return {"kind": "coordinator"} if self._is_coordinator(me) else {"kind": "actor", "id": me["channel"], "name": _name(me)}

    def _view(self, a: dict, me: Optional[dict] = None, kept: Optional[Tuple[dict, dict]] = None) -> dict:
        """An actor as `ag actors` shows it -- by its whole id: a codex thread's opens with the time it was made, so
        codex actors started within a minute share their first characters (a command takes any start of an id that
        names one actor). With `kept` -- its gatherer's (_kept) -- whether it is saved, and the path of its folder."""
        s = a.get("session") or {}
        mark = {}
        if kept is not None:
            filed = _kept_as(a, kept[1])
            mark = {"saved": _kept_as(a, kept[0]) is not None, "folder": kept[1][filed] if filed else None}
        return {**mark, "id": a["channel"], "channel": a["channel"], "name": NAME if self._is_coordinator(a) else _name(a),
                "status": a.get("status"), "harness": a.get("harness") or s.get("harness"), "cwd": a.get("cwd") or s.get("cwd"),
                "asked": _clip(_unwrapped(a.get("last_user_message")), ASKED_CHARS),
                "recap": _clip((a.get("recap") or {}).get("text"), ASKED_CHARS),
                "last": a.get("last"), "you": bool(me) and a["channel"] == me["channel"],
                "gatherer_agent": self._is_coordinator(a), **({_app_of(s): True} if _app_of(s) else {})}

    # ---- what an actor asks

    def list(self, actor: str, every: bool = False) -> dict:
        g, me, agents = self._asker(actor)
        shown = [a for a in agents if every or a.get("status") != data.CLOSED or a["channel"] == me["channel"]
                 or self._is_coordinator(a)]
        shown.sort(key=lambda a: (not self._is_coordinator(a), -(a.get("last") or 0)))
        kept = _kept(g)
        return {"gatherer": g, "you": me["channel"], "actors": [self._view(a, me, kept) for a in shown],
                "closed": len(agents) - len(shown)}

    def show(self, actor: str, ref: str) -> dict:
        g, me, agents = self._asker(actor)
        a = self._find(g, ref, agents)
        if a is None:
            raise CoordinationError("the group has no coordinator agent yet")
        got = _latest(g, a["channel"], a.get("cwd"))
        return {**self._view(a, me, _kept(g)), "said": _clip(got.get("said"), SAID_CHARS),
                "asked": _clip(_unwrapped(got.get("asked")), SAID_CHARS) or self._view(a, me)["asked"], "turns": got.get("turns", 0),
                "now": got.get("now"), "changed": got.get("changed") or []}

    def who(self, actor: str, path: str) -> dict:
        g, me, agents = self._asker(actor)
        path = (path or "").strip()
        if not path:
            raise CoordinationError("which file?")
        full = os.path.normpath(os.path.join(me.get("cwd") or os.getcwd(), os.path.expanduser(path)))
        found = livedocs.writers([os.path.dirname(full)], time.time() - WHO_SECONDS).get(os.path.basename(full), [])
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
            branch: bool = False, approve: bool = False, folder: Optional[str] = None, **app: bool) -> dict:
        """A new actor (module doc), in the folder at the path `folder` if given (made if new). `app`, {<name>: True}:
        the actor of a new one of that app (an app that starts an agent of its own: app_agents.py), as
        `ag actors new --<name>` asks."""
        starters = _starters()                            # apps on the host that start an agent of their own
        g, me, agents = self._asker(actor)
        text = _message(text)
        asked = [n for n in sorted(app) if app[n]]          # the apps asked for, found here or not
        found = starters
        label = lambda n: found[n].label if n in found else n   # noqa: E731
        if asked and branch:
            raise CoordinationError(f"a {label(asked[0])}'s actor works in its folder, not on a branch: "
                                    f"--{asked[0]} or --branch, not both")
        if len(asked) > 1:
            raise CoordinationError("an actor is one app's at most: " + " or ".join(f"--{n} alone" for n in asked))
        if asked and asked[0] not in found:               # an app this dashboard's host has none of (or no host)
            raise CoordinationError(f"this dashboard runs no {asked[0]}: no such app is found here")
        chosen = [found[n] for n in asked]
        if approve and not branch:
            raise CoordinationError("--approve is for an actor on a branch of its own (--branch): each change it makes "
                                    "there waits for the user to accept or reject it")
        try:
            target = folders.find_or_make(g, folder) if folder else None
        except folders.FolderError as exc:
            raise CoordinationError(str(exc)) from None
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
        if chosen:
            row, made = self._new_with_app(chosen[0].name, g, cwd or "", harness, model, name)
        else:
            if branch:
                row, on = self._new_on_branch(g, cwd or "", harness, model, mode, approve)
            else:
                row = self.started.create(g, cwd or "", mode, harness, model)
            if name and sessions.picks_id(harness):       # one whose harness picks its id: named once it has it
                with self.lock:
                    self.unnamed[row["session_id"]] = (g, name)
            elif name:
                threading.Thread(target=_name_it, args=(g, row["session_id"], name), daemon=True).start()
        if target is not None:                            # filed by the id it is started under
            folders.file(g, [row["session_id"]], target)
        to = {"channel": row["session_id"], "session": row, "harness": harness, "cwd": row["cwd"], "status": data.IDLE,
              "name": {"text": name} if name else None}
        self._deliver(g, to, envelope(self._sender(me), text))
        self._keep(g, me["channel"], "new", to, text)
        if self.ring is not None:
            self.ring(g)
        return {"started": True, "actor": self._view(to, me, _kept(g) if target is not None else None),
                **({chosen[0].name: made} if made else {}),
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

    def _new_with_app(self, app: str, gatherer: str, cwd: str, harness: str, model: Optional[str],
                      name: Optional[str]) -> Tuple[dict, dict]:
        """A new instance of the app on `cwd` and its actor (app_agents.py's `start`), named `name`, else as the app
        names it: (its actor's session, as the dashboard's table has it; {key, root})."""
        from . import app_agents, tool_gateway
        try:
            got, inst = app_agents.start(self.started, tool_gateway.HOST, app, gatherer, cwd, harness, model, name)
        except AppError as exc:
            label = tool_gateway.HOST.apps[app].manifest.label if app in tool_gateway.HOST.apps else app
            raise CoordinationError(f"no {label} started: {exc}") from None
        row = next(r for r in self.started.list() if r["session_id"] == got["session_id"])
        return row, {"key": inst.id, "root": inst.folder}

    def when(self, actor: str, ref: str, note: str = "") -> dict:
        g, me, agents = self._asker(actor)
        to = self._find(g, ref, agents)
        if to is None:
            raise CoordinationError("the group has no coordinator agent yet")
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

    # ---- the user's saved actors (saved.py), and the folders they keep actors in (folders.py), as the list has them

    def _own(self, actor: str, ref: str) -> Tuple[str, dict, dict]:
        """(its gatherer, the asker, the actor `ref` names): never the gatherer agent, always at its gatherer's top."""
        g, me, agents = self._asker(actor)
        return g, me, self._ownable(g, ref, agents)

    def _ownable(self, g: str, ref: str, agents: List[dict]) -> dict:
        a = self._find(g, ref, agents)
        if a is None:
            raise CoordinationError("the group has no coordinator agent yet")
        if self._is_coordinator(a):
            raise CoordinationError("the coordinator agent is not saved or put in a folder: it is always at the top of its group")
        return a

    def save(self, actor: str, ref: str, folder: Optional[str] = None, unfiled: bool = False) -> dict:
        """The actor `ref` saved for later -- put in `folder` too if one is named (made if new), at the gatherer's top if
        `unfiled`, else left where it is."""
        g, me, a = self._own(actor, ref)
        try:
            target = folders.find_or_make(g, folder) if folder else None
            saved.choose(g, _kept_as(a, saved.stored().get(g, {})) or a["channel"], True)
            if folder or unfiled:
                folders.file(g, [_kept_as(a, _filed(g)) or a["channel"]], target)
        except folders.FolderError as exc:
            raise CoordinationError(str(exc)) from None
        self._rang(g)
        return {"actor": self._view(a, me, _kept(g))}

    def unsave(self, actor: str, ref: str) -> dict:
        g, me, a = self._own(actor, ref)
        saved.choose(g, _kept_as(a, saved.stored().get(g, {})) or a["channel"], False)
        self._rang(g)
        return {"actor": self._view(a, me, _kept(g))}

    def move(self, actor: str, refs: List[str], folder: Optional[str], group: Optional[str] = None) -> dict:
        """The actors `refs` put in the folder at the path `folder` (made if new), or at the gatherer's top (none, or
        folders.TOP) -> {actors, folder (its path; None: the top)}. `group`, another group: into its folder, the actors
        then sharing with it (groups.py's `move`, each one's task with it) -> {..., group}."""
        if not refs:
            raise CoordinationError("which actors? Name one or more")
        g, me, agents = self._asker(actor)
        found = list({a["channel"]: a for a in (self._ownable(g, ref, agents) for ref in refs)}.values())
        if group and group != g:
            try:
                target = folders.find_or_make(group, folder or "") if group in data.gatherer_names() else None
                moved = groups.move(g, group, [a["channel"] for a in found], into=target)
            except (folders.FolderError, groups.GroupError) as exc:
                raise CoordinationError(str(exc)) from None
            self._rang(g)
            kept = _kept(group)
            views = [self._view(a, me, kept) for a in found if a["channel"] in moved["actors"]]
            return {"actors": views, "folder": folders.path(folders.of(group), target), "group": group}
        try:
            target = folders.find_or_make(g, folder or "")
            filed = _filed(g)
            folders.file(g, [_kept_as(a, filed) or a["channel"] for a in found], target)
        except folders.FolderError as exc:
            raise CoordinationError(str(exc)) from None
        self._rang(g)
        kept = _kept(g)
        return {"actors": [self._view(a, me, kept) for a in found], "folder": folders.path(folders.of(g), target)}

    def alone(self, actor: str, ref: str) -> dict:
        """The actor `ref` taken out of every group (groups.py's `alone`): it works on its own, sharing context with no
        one, and no one with it -> {actor, group}."""
        g, me, agents = self._asker(actor)
        a = self._ownable(g, ref, agents)
        try:
            made = groups.alone(g, a["channel"])
        except groups.GroupError as exc:
            raise CoordinationError(str(exc)) from None
        self._rang(g)
        return {"actor": self._view(a, me, _kept(g)), "group": made["group"]}

    def folders(self, actor: str) -> dict:
        """The gatherer's folders as a tree: {gatherer, folders: [{name, path, actors, closed, folders, shut}], actors,
        closed} -- at each level the folders in it (by name), the actors in it that are open or saved (the latest
        first), and how many closed ones; `shut`, whether the folder was closed (folders.py's `close`)."""
        g, me, agents = self._asker(actor)
        tree, kept = folders.of(g), _kept(g)
        nodes = {f["id"]: {"name": f["name"], "path": folders.path(tree, f["id"]), "actors": [], "closed": 0, "folders": [],
                           "shut": bool(f.get("closed"))}
                 for f in tree["folders"]}
        top = {"gatherer": g, "folders": [], "actors": [], "closed": 0}
        for f in tree["folders"]:                        # by name already
            (nodes.get(f["parent"]) or top)["folders"].append(nodes[f["id"]])
        for a in sorted(agents, key=lambda a: -(a.get("last") or 0)):
            if self._is_coordinator(a):
                continue
            v = self._view(a, me, kept)
            node = nodes.get(tree["filed"].get(_kept_as(a, tree["filed"]) or ""), top)
            if a.get("status") == data.CLOSED and not v["saved"]:
                node["closed"] += 1
            else:
                node["actors"].append(v)
        return top

    def folder(self, actor: str, do: str, name: str, to: str = "", group: Optional[str] = None) -> dict:
        """A folder, by its path, made (`new`: the folders of its path not there made too), renamed (`rename`: `to` its
        new name), put in another (`move`: `to` the other's path; none, or folders.TOP: the top -- of `group`, another
        group, the folder's actors then sharing with it), made a group of its own (`split`) or deleted (`delete`) ->
        what `folders` says, after, and what was done."""
        g, _, _ = self._asker(actor)
        if do in ("split", "move") and (do == "split" or (group and group != g)):
            try:
                fid = self._folder_at(g, name)
                if do == "split":
                    made = groups.split(g, fid)
                    done = {"done": do, "name": "/".join(folders._parts(name)), "group": made["group"]}
                else:
                    target = folders.find_or_make(group, to or "") if group in data.gatherer_names() else None
                    groups.move(g, group, folder=fid, into=target)
                    done = {"done": do, "name": "/".join(folders._parts(name)), "group": group,
                            "to": folders.path(folders.of(group), target)}
            except (folders.FolderError, groups.GroupError) as exc:
                raise CoordinationError(str(exc)) from None
            self._rang(g)
            return {**self.folders(actor), **done}
        try:
            if do == "new":
                folders.find_or_make(g, name)
            elif do == "rename":
                folders.rename(g, self._folder_at(g, name), to)
            elif do == "move":
                folders.move(g, self._folder_at(g, name), folders.find(g, to or ""))
            elif do == "delete":
                folders.delete(g, self._folder_at(g, name))
            else:
                raise CoordinationError("`ag actors folder` new, rename, move, split or delete?")
            done = {"done": do, "name": "/".join(folders._parts(name))}
            if do == "rename":
                done["to"] = folders.folder_name(to)
            if do == "move":
                done["to"] = folders.path(folders.of(g), folders.find(g, to or ""))
        except folders.FolderError as exc:
            raise CoordinationError(str(exc)) from None
        self._rang(g)
        return {**self.folders(actor), **done}

    @staticmethod
    def _folder_at(gatherer: str, where: str) -> int:
        """The folder at the path `where` -- not the top, which no change names."""
        fid = folders.find(gatherer, where)
        if fid is None:
            raise CoordinationError("which folder? Give its path, as `ag actors folders` lists it")
        return fid

    def _rang(self, gatherer: str) -> None:
        """The pages told: what the list shows besides its actors' data changed (live.py's "list")."""
        if self.ring is not None:
            self.ring(gatherer, what="list")

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
        now_in = data.groups_now()           # the home's one database: where each actor is now (a move between groups)
        for w in waiting:
            if self._regrouped(w, now_in.get(now_as.get(w["target"], w["target"])), now_in.get(w["watcher"]), now):
                told.append(w["id"])
                continue
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

    def _regrouped(self, w: sqlite3.Row, target_in: Optional[str], watcher_in: Optional[str], now: float) -> bool:
        """A watch whose target or watcher changed group since it was made (groups.py): both in one group again, the
        watch goes with them (looked at in it next time); apart, it ends -- the watcher told only that, nothing of the
        target's work, which is no longer its group's. -> whether the watcher was told."""
        g = w["gatherer"]
        target_in, watcher_in = target_in or g, watcher_in or g
        if target_in == g and watcher_in == g:
            return False
        if target_in == watcher_in:
            self._mark(w["id"], gatherer=target_in)
            return False
        how = "it left your group, so this watch has ended" if watcher_in == g else \
            "you left its group, so this watch has ended"
        self._mark(w["id"], fired=now, outcome="moved")
        try:
            self._deliver(watcher_in, self._watcher(w, watcher_in), update(w["id"], w["target"], None, how, ""))
        except Exception as exc:  # noqa: BLE001 - one watcher's trouble is not the others'
            self._mark(w["id"], outcome=f"moved, not told: {exc}"[:300])
        return True

    def _watcher(self, w: sqlite3.Row, g: str) -> dict:
        """The watch's watcher, as an actor of `g`, else as the dashboard's table has it."""
        rows = self.started.list()
        watcher = next((x for x in data.gatherer_actors(g, rows) if x["channel"] == w["watcher"]), None)
        if watcher is None:
            row = next((r for r in rows if w["watcher"] in (r["session_id"], r.get("started_as"))), None)
            if row is None:
                raise CoordinationError(f"no actor {w['watcher']} to tell")
            watcher = {"channel": row["session_id"], "session": row, "harness": row["harness"]}
        return watcher

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
        self._deliver(g, self._watcher(w, g), update(w["id"], target, name, how, "\n\n".join(lines)))

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

    def _name_later(self) -> None:
        """The names given to new actors whose harness picks the session's id (`new`), each recorded in the channel of
        that id once the session has it (sessions.py's `_rename`) -- forgotten if the session is gone before."""
        with self.lock:
            if not self.unnamed:
                return
        rows = {r.get("started_as"): r for r in self.started.list() if r.get("started_as")}   # each one's, made before
        with self.lock:
            due = {k: (v, rows[k]["session_id"] if k in rows else None) for k, v in self.unnamed.items()
                   if k not in rows or rows[k]["session_id"] != k}
            for k in due:
                del self.unnamed[k]
        for (g, name), now in due.values():
            if now:
                threading.Thread(target=_name_it, args=(g, now, name), daemon=True).start()

    def _run(self) -> None:
        while not self.stop.wait(WATCH_CHECK):
            for step in (self._mark_private, self._name_later, self.check):
                try:
                    step()
                except Exception:  # noqa: BLE001 - never stop looking
                    pass

    def close(self) -> None:
        self.stop.set()


def _filed(gatherer: str) -> dict:
    """{channel: its folder's id}, of folders.py's `gatherer`."""
    return folders.of(gatherer)["filed"]


def _kept(gatherer: str) -> Tuple[dict, dict]:
    """What saved.py and folders.py keep of `gatherer`: ({channel: when saved}, {channel: its folder's path})."""
    tree = folders.of(gatherer)
    return saved.stored().get(gatherer, {}), {c: folders.path(tree, fid) for c, fid in tree["filed"].items()}


def _kept_as(a: dict, keys: dict) -> Optional[str]:
    """The channel the actor `a` is kept as, of {channel: ...} (saved, or filed): its own, else the one it was started
    under (a codex session's, renamed to its thread since), as the page's `savedAs` finds it; None: not kept there."""
    started = (a.get("session") or {}).get("started_as")
    return a["channel"] if a["channel"] in keys else started if started and started in keys else None


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
