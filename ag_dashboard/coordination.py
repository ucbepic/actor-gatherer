"""Actors talking to one another, and the COORDINATOR AGENTS that coordinate them for the user -- through the
dashboard, which runs them. Every actor of a group is told (the guide, ag's policy) that the others exist and how to
reach them: `ag actors` (ag/cli/actors.py), run in its shell, asks this dashboard (api/sessions.py's /api/actors/<op>):

    list      the actors of its group, those not closed (`all`: every one): each one's id, name, status, harness,
              directory, what it was last asked and its recap -- and the coordinator agents over it, the nearest first;
              a coordinator agent's: those under its node
    coordinators   the coordinator agents over the asker, the nearest first -- and, a coordinator agent's, those under it
    show      one actor: that, what it said last, and the files its latest turn changed (files.py's `files`)
    who       the actors that changed a file lately, the latest first (livedocs.py's `writers`): those the asker reaches
              in full, any other by its id and group alone -- so an actor in a conflict across groups can name it
    send      a message to an actor, typed into its terminal as a message of its conversation, as Chat sends one
              (sessions.py's `send`: its terminal opened for it, if it has none open), in an envelope saying who it is
              from and how to answer (`envelope`) -- `coordinator` names the coordinator agent of the nearest node over
              the asker and the actors given `with` (coordinators.py's `nearest`), none started for it
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

A COORDINATOR AGENT is over a NODE of the list (coordinators.py: a folder in a group, a group, a folder of groups, or
everything), and over every actor under it. There is none until the user starts one from the page (`ensure`), one a
node at most. It is a session like any other -- one over a group, or a folder in one, is of that group, so its
context holds what the user asked the group's actors; one above groups is in a group of its own (`self:<channel>`, as
an actor on its own) and READS the groups under its node -- kept in the dashboard's table with the role COORDINATOR
and its node `over` (sessions.py), and run with `instructions` added to its harness's own on every run: the file
gatherer_agent.md beside this module, or the home's own copy of it (<home>/dashboard/gatherer_agent.md), read anew for
each run, its node filled in -- a change to it is what the agent is told next.

What it can name is what is under its node (`_scope`): it messages, shows, watches, moves and starts actors there
alone, and a folder is named by its path from its node down. An actor names the actors of its group, and the
coordinator agents over it.

Its channel is PRIVATE: no other actor's context shows what is said in it. The policy reads that from a `role` record
in it ({role: "coordinator", private: true, over, reads}; ag's proactive_context_manager, `unseen`), which the
dashboard puts there, and again whenever its node or the groups under it change (`_mark_roles`): the agent sees the
requests of the actors it is shown, they see none of its.
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
from typing import Any, Callable, Dict, Iterable, List, NamedTuple, Optional, Tuple

import harness_kit
from app_kit import AppError

from . import (actions, branches, coordinators, data, files, folders, groups, home, livedocs, naming, saved, sessions,
               store)

COORDINATOR = sessions.COORDINATOR
ALIASES = ("gatherer", "gatherer-agent", "coordinator")   # what `send`, `show` and `when` take for a coordinator agent
NAME = data.COORDINATOR_NAME
ASKED_CHARS = 300               # the most of what an actor was asked, in a list
SAID_CHARS = 1500               # the most of what it said last, in `show` and a watch's message
MESSAGE_CHARS = 20000           # the longest message sent
NOTE_CHARS = 2000               # the longest note a watch keeps
WHO_SECONDS = 24 * 3600         # how far back `who` looks
WATCH_CHECK = 3.0               # how often the watches are looked at
WATCH_GRACE = 20.0              # a target never seen at work: over, this long after the watch was asked
STOP_WAIT = 10.0                # seconds `close` waits for a look at the watches under way to end
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
# message: from a coordinator agent (the node it is over, `everything` or its label as JSON, and its id to answer to),
# or from another actor (its id, and its name as JSON). ENVELOPE reads it back (as the page's `envelope` does, the same
# pattern) -- also with its lines made one, as data.py's `last_user_message` has a message, and as those from before
# coordinator agents had nodes said it ("the gatherer agent", "the coordinator agent", answered to `coordinator`). A
# watch's news (`update`) is no one's message: its first line says which watch and what became of the actor watched,
# then what it was asked and said last, and the watcher's note (UPDATE reads it back).
FROM_COORDINATOR = 'Message from the coordinator agent{over} (answer it with: ag actors send {id} "..."):'
FROM_ACTOR = 'Message from actor {id}{name} (answer it with: ag actors send {id} "..."):'
ENVELOPE = re.compile(r'^Message from (the (?:gatherer|coordinator) agent(?: over (everything|"(?:[^"\\]|\\.)*"))?|'
                      r'actor ([\w-]+)(?:, ("(?:[^"\\]|\\.)*"))?)'
                      r'(?: \(answer it with: (?:ag actors send ([\w-]+) )?[^\n]*?\))?:\s+([\s\S]*)$')
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
# a watch's group is followed by the watch itself (`_regrouped`: with its actors when both move, ended when they part)
store.table("watches", SCHEMA, merged=store.STAY)


class CoordinationError(sessions.SessionError):
    """What an actor asked that cannot be done: its command prints the text."""


def envelope(sender: dict, text: str) -> str:
    """`text` as the receiver gets it, from `sender`: {"kind": "coordinator", "id": its id, "over": the label of its node
    (coordinators.py's; "everything" for all)}, or {"kind": "actor", "id": its id, "name": its name or None}."""
    if sender["kind"] == "coordinator":
        over = sender.get("over")
        head = FROM_COORDINATOR.format(over="" if not over else " over everything" if over == "everything"
                                       else f" over {json.dumps(over)}", id=sender.get("id") or "coordinator")
    else:
        head = FROM_ACTOR.format(id=sender["id"], name=f", {json.dumps(sender['name'])}" if sender.get("name") else "")
    return f"{head}\n\n{text.strip()}"


def update(n: int, target: str, name: Optional[str], how: str, text: str) -> str:
    """A watch's news, watch `n`'s: the actor `target` (its `name`) is done (`how`), then `text`."""
    head = UPDATE_HEAD.format(n=n, id=target, name=f" ({json.dumps(name)})" if name else "", how=how)
    return f"{head}\n\n{text.strip()}" if text.strip() else head


def opened(text: str) -> Optional[dict]:
    """A message's envelope read back: {"from": "actor", "id", "name", "text"}, or {"from": "coordinator", "id" (its, to
    answer to: None in one from before), "name": None, "over" (its node's label; None in one from before), "text"} --
    or a watch's news, {"from": "update", "id" (the actor watched), "name", "how", "watch", "text"}; None for a message
    in neither."""
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
    if m.group(1).startswith("the "):                  # a coordinator agent's: its old names too
        over = m.group(2)
        try:
            over = json.loads(over) if over and over != "everything" else over
        except ValueError:
            over = None
        reply = m.group(5)
        return {"from": "coordinator", "id": None if not reply or reply.lower() in ALIASES else reply, "name": None,
                "over": over, "text": m.group(6)}
    try:
        name = json.loads(m.group(4)) if m.group(4) else None
    except ValueError:
        name = None
    return {"from": "actor", "id": m.group(3), "name": name, "text": m.group(6)}


def instructions(gatherer: str, over: Optional[str] = None, channel: Optional[str] = None) -> str:
    """What the coordinator agent of the session in `gatherer` over the node `over` (none: the group's) is told, on
    every run, besides its harness's own instructions: the INSTRUCTIONS file -- the home's own
    (<home>/dashboard/gatherer_agent.md), else the dashboard's -- read anew for each run, so a change to it is what the
    next run is told. In it, its node: `{over}` (as its messages name it), `{over_long}`, `{reads}` (whose requests it
    is shown), `{across}` (", across the groups in it" above groups), `{paths}` (how a folder's path starts there),
    `{id}` (its own, `channel`), and `{gatherer}` (the group it runs in)."""
    node = over or coordinators.group_node(gatherer)
    tree = coordinators.Tree()
    label = tree.label(node) or gatherer
    shown = tree.reads(node) if coordinators.above_groups(node) else [tree.group_of(node) or gatherer]
    paths = {"all": "with the group's name (`paper/Figures`)",
             "groups": "with the group's name (`paper/Figures`)",
             "group": "from the group's top (`Figures/Plots`)",
             "folder": "from your folder down (`Plots`, a folder in it)"}[coordinators.kind(node) or "group"]
    fill = {"{over}": "everything" if label == "everything" else json.dumps(label), "{over_long}": tree.described(node),
            "{reads}": ("the group " if len(shown) == 1 else "the groups ") + coordinators._and(shown) if shown else "no group",
            "{across}": ", across the groups in it" if coordinators.above_groups(node) else "",
            "{paths}": paths, "{id}": channel or "", "{gatherer}": gatherer}
    for path in (os.path.join(sessions.home.HOME, "dashboard", INSTRUCTIONS_FILE), INSTRUCTIONS):
        try:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
        except OSError:
            continue
        for k, v in fill.items():
            text = text.replace(k, v)
        return text
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
    return {n: x.manifest for n, x in h.apps.items() if x.manifest.agent.offered}


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
        self.marked: Dict[str, dict] = {}        # each coordinator agent's role record, as last put in (`_mark_roles`)
        self.thread: Optional[threading.Thread] = None
        if watch:
            self.thread = threading.Thread(target=self._run, name="ag-watches", daemon=True)
            self.thread.start()

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

    def coordinators(self, rows: Optional[List[dict]] = None) -> Dict[str, dict]:
        """{node: its coordinator agent's session}, as the dashboard's table has them (coordinators.py): one a node, the
        first made."""
        rows = self.started.list() if rows is None else rows
        out: Dict[str, dict] = {}
        for r in sorted((r for r in rows if r.get("role") == COORDINATOR), key=lambda r: r.get("created_at") or ""):
            out.setdefault(coordinators.node_of(r), r)
        return out

    def coordinator(self, gatherer: str) -> Optional[dict]:
        """The coordinator agent over the group `gatherer`, as the dashboard's table has it; None while it has none."""
        return self.coordinators().get(coordinators.group_node(gatherer))

    def ensure(self, node: str, cwd: Optional[str] = None, harness: Optional[str] = None,
               model: Optional[str] = None) -> dict:
        """The coordinator agent over `node` (coordinators.py's; a group's name: that group), started if it has none: in
        `cwd` (else the user's home), on `harness` (else the first harness that can run here, in harness_kit's order)
        and `model`. One over a group, or a folder in one, is a session of that group; one above groups, a session in a
        group of its own run under a group under its node, its `group` record and its role record in before its first
        call, as an actor started on its own (groups.py's `start_alone`). As the dashboard's table has it."""
        node = str(node or "").strip()
        if node.startswith(ALONE):
            raise CoordinationError("an actor on its own has no coordinator agent")
        node = node if coordinators.kind(node) else coordinators.group_node(node)
        tree = coordinators.Tree()
        if tree.path(node) is None:
            raise CoordinationError(f"no folder {node} in this home to put a coordinator agent over")
        above = coordinators.above_groups(node)
        if above and not home.merged():
            raise CoordinationError("a coordinator agent over several groups needs the home's one database: run "
                                    "`ag home merge` first")
        with self.lock:
            row = self.coordinators().get(node)
            if row is not None:
                return row
            can = sessions.available() or list(sessions.HARNESSES)
            fits = [h for h in sessions.HARNESSES if h in can]
            harness = harness if harness in fits else fits[0] if fits else \
                harness if harness in sessions.HARNESSES else harness_kit.DEFAULT
            cwd = cwd if cwd and os.path.isdir(cwd) else os.path.expanduser("~")
            if not above:
                g = tree.group_of(node)
                row = self.started.create(g, cwd, "auto", harness, model, role=COORDINATOR,
                                          over=None if coordinators.kind(node) == "group" else node)
            else:
                row = self._above(tree, node, cwd, harness, model)
        if self.ring is not None:
            self.ring(row["gatherer"])
        threading.Thread(target=self._mark_roles, name="ag-private", daemon=True).start()   # before its first call
        return row

    def _above(self, tree: "coordinators.Tree", node: str, cwd: str, harness: str, model: Optional[str]) -> dict:
        """A new coordinator agent over a node above groups: started on its own, run under the group under its node of
        the actor started here last (else the first it reads; else the home's first), its `group` and `role` records
        put in before its first call."""
        reads = tree.reads(node)
        latest = sorted((r for r in self.started.list() if r["gatherer"] in reads and r.get("role") != COORDINATOR),
                        key=lambda r: r.get("created_at") or "", reverse=True)
        under = latest[0]["gatherer"] if latest else (reads or tree.groups or [""])[0]   # the group latest at work under it
        if not under:
            raise CoordinationError("no group in this home to run a coordinator agent under")
        row = self.started.create(under, cwd, "auto", harness, model, role=COORDINATOR, alone=True, over=node)
        ch = row["session_id"]
        role = self._role_payload(row, tree)
        events = [{"type": groups.GROUP, "id": f"{groups.GROUP}:{ch}:{uuid.uuid4().hex[:12]}", "properties": {"channel": ch},
                   "payload": {"group": ALONE + ch, "under": under, "name": "", "folder": None}},
                  {"type": ROLE, "id": f"{ROLE}:{ch}:{uuid.uuid4().hex[:12]}", "properties": {"channel": ch}, "payload": role}]
        try:
            actions.insert(under, events)
        except (RuntimeError, OSError, ValueError) as exc:
            self.started.discard(ch)
            raise CoordinationError(f"ag did not take it: {exc}; nothing was started") from None
        with self.lock:
            self.marked[ch] = role
        return row

    @staticmethod
    def _is_coordinator(a: dict) -> bool:
        return (a.get("session") or {}).get("role") == COORDINATOR

    def _find(self, gatherer: str, ref: str, agents: List[dict]) -> Optional[dict]:
        """The agent `ref` names among `agents`: an alias of a coordinator agent (the first among them; None for none),
        an id or its start, the id it was started under, or a name."""
        ref = (ref or "").strip()
        if not ref:
            raise CoordinationError("which actor? Give its id (`ag actors` lists them), or `coordinator` for the "
                                    "coordinator agent over you")
        if ref.lower() in ALIASES:
            return next((a for a in agents if self._is_coordinator(a)), None)

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
        raise CoordinationError(f"no actor {ref} " + ("under your folder" if any(self._is_coordinator(a) and a.get("you")
                                                                                  for a in agents) else "in the group")
                                + (f" ({len(named)} have that name)" if named else ""))

    def _scope(self, actor: str) -> "Scope":
        """Who asks (`_asker`), and what it reaches (module doc): its group's actors, and the coordinator agents over it;
        a coordinator agent's, the actors under its node -- across groups above them -- and the coordinator agents under
        it and over it. Each agent with its `group`, and a coordinator agent's with the label of its node (`over`)."""
        g, me, agents = self._asker(actor)
        rows = self.started.list()
        tree, by_node = coordinators.Tree(), self.coordinators(rows)
        for a in agents:
            a.setdefault("group", g)
        s = me.get("session") or {}
        if s.get("role") == COORDINATOR:
            node = coordinators.node_of(s)
            path = tree.path(node)
            if path is None:
                reach = []
            elif coordinators.above_groups(node):
                reach = []
                for x in tree.reads(node):
                    try:
                        reach += [{**a, "group": x} for a in data.gatherer_actors(x, rows)]
                    except sqlite3.Error:
                        continue
            elif coordinators.kind(node) == "folder":
                reach = [a for a in agents if node in self._place(tree, a)]
            else:
                reach = list(agents)
            place = path or []
            under = [r for n, r in by_node.items() if r["session_id"] != me["channel"] and node in (tree.path(n) or [])]
            over = [by_node[n] for n in reversed(place) if n in by_node and by_node[n]["session_id"] != me["channel"]]
            reach = [a for a in reach if not self._is_coordinator(a)
                     or a["channel"] in {r["session_id"] for r in under}]
        else:
            node, place = None, self._place(tree, {**me, "group": g})
            over = [by_node[n] for n in reversed(place) if n in by_node]
            reach = [a for a in agents if not self._is_coordinator(a)]
            under = []
        mine = {a["channel"] for a in reach}
        extra = [self._agent_of(r, rows, agents) for r in over + under if r["session_id"] not in mine]
        reach = [a for a in reach if a["channel"] != me["channel"]] + [a for a in extra if a is not None]
        for a in reach + [me]:
            if self._is_coordinator(a):
                a["over"] = tree.label(coordinators.node_of(a.get("session") or {}))
        me["you"] = True
        return Scope(g, me, [me] + reach, node, place, tree, rows, by_node,
                     [x for x in (self._agent_of(r, rows, reach) for r in over) if x is not None],
                     [x for x in (self._agent_of(r, rows, reach) for r in under) if x is not None])

    @staticmethod
    def _place(tree: "coordinators.Tree", a: dict) -> List[str]:
        return tree.place(a.get("group") or "", a["channel"], (a.get("session") or {}).get("started_as"))

    def _agent_of(self, row: dict, rows: List[dict], among: Optional[List[dict]] = None) -> Optional[dict]:
        """The session `row` as an agent, with its group: one of `among`, else read from its group."""
        found = next((a for a in among or [] if a["channel"] == row["session_id"]), None)
        if found is not None:
            return found
        try:
            got = next((a for a in data.gatherer_actors(row["gatherer"], rows) if a["channel"] == row["session_id"]), None)
        except sqlite3.Error:
            got = None
        got = got or {"channel": row["session_id"], "session": row, "harness": row["harness"], "cwd": row["cwd"],
                      "status": data.IDLE, "role": row.get("role")}
        return {**got, "group": row["gatherer"]}

    def _target(self, sc: "Scope", ref: str) -> dict:
        """The agent `ref` names in the scope: a coordinator agent's alias, the nearest over the asker."""
        if (ref or "").strip().lower() in ALIASES:
            if not sc.over:
                raise CoordinationError(_none_over(sc, []))
            return sc.over[0]
        return self._find(sc.g, ref, sc.agents)

    def _sender(self, sc: "Scope") -> dict:
        if self._is_coordinator(sc.me):
            return {"kind": "coordinator", "id": sc.me["channel"], "over": sc.tree.label(sc.node)}
        return {"kind": "actor", "id": sc.me["channel"], "name": _name(sc.me)}

    def _view(self, a: dict, me: Optional[dict] = None, kept: Optional[Tuple[dict, dict]] = None) -> dict:
        """An actor as `ag actors` shows it -- by its whole id: a codex thread's opens with the time it was made, so
        codex actors started within a minute share their first characters (a command takes any start of an id that
        names one actor). With `kept` -- its gatherer's (_kept) -- whether it is saved, and the path of its folder."""
        s = a.get("session") or {}
        mark = {}
        if kept is not None:
            filed = _kept_as(a, kept[1])
            mark = {"saved": _kept_as(a, kept[0]) is not None, "folder": kept[1][filed] if filed else None}
        return {**mark, "id": a["channel"], "channel": a["channel"], "name": _name(a) or (NAME if self._is_coordinator(a) else None),
                "status": a.get("status"), "harness": a.get("harness") or s.get("harness"), "cwd": a.get("cwd") or s.get("cwd"),
                "asked": _clip(_unwrapped(a.get("last_user_message")), ASKED_CHARS),
                "recap": _clip((a.get("recap") or {}).get("text"), ASKED_CHARS),
                "last": a.get("last"), "you": bool(me) and a["channel"] == me["channel"],
                "gatherer_agent": self._is_coordinator(a), **({_app_of(s): True} if _app_of(s) else {}),
                **({"over": a["over"]} if self._is_coordinator(a) and a.get("over") is not None else {}),
                **({"group": a["group"]} if a.get("group") else {})}

    # ---- what an actor asks

    def list(self, actor: str, every: bool = False) -> dict:
        sc = self._scope(actor)
        me, over = sc.me, [a["channel"] for a in sc.over]
        shown = [a for a in sc.agents if every or a.get("status") != data.CLOSED or a["channel"] == me["channel"]
                 or self._is_coordinator(a)]
        shown.sort(key=lambda a: (a["channel"] not in over, over.index(a["channel"]) if a["channel"] in over else 0,
                                  -(a.get("last") or 0)))
        kept = {g: _kept(g) for g in {a.get("group") or sc.g for a in shown}}
        return {"gatherer": sc.g, "you": me["channel"], "node": sc.tree.label(sc.node) if sc.node else None,
                "actors": [self._view(a, me, kept[a.get("group") or sc.g]) for a in shown],
                "over": [self._view(a, me) for a in sc.over], "closed": len(sc.agents) - len(shown)}

    def coordinators_of(self, actor: str) -> dict:
        """The coordinator agents over the asker, the nearest first, and -- a coordinator agent's -- those under it."""
        sc = self._scope(actor)
        return {"you": sc.me["channel"], "node": sc.tree.label(sc.node) if sc.node else None,
                "over": [self._view(a, sc.me) for a in sc.over], "under": [self._view(a, sc.me) for a in sc.inside]}

    def show(self, actor: str, ref: str) -> dict:
        sc = self._scope(actor)
        a = self._target(sc, ref)
        g = a.get("group") or sc.g
        got = _latest(g, a["channel"], a.get("cwd"))
        return {**self._view(a, sc.me, _kept(g)), "said": _clip(got.get("said"), SAID_CHARS),
                "asked": _clip(_unwrapped(got.get("asked")), SAID_CHARS) or self._view(a, sc.me)["asked"],
                "turns": got.get("turns", 0), "now": got.get("now"), "changed": got.get("changed") or []}

    def who(self, actor: str, path: str) -> dict:
        """The actors that changed the file lately: those the asker reaches, in full; any other, by its id and its group
        alone (`other`), nothing of its work -- so an actor in a conflict across groups can name it."""
        sc = self._scope(actor)
        path = (path or "").strip()
        if not path:
            raise CoordinationError("which file?")
        full = os.path.normpath(os.path.join(sc.me.get("cwd") or os.getcwd(), os.path.expanduser(path)))
        found = livedocs.writers([os.path.dirname(full)], time.time() - WHO_SECONDS).get(os.path.basename(full), [])
        by = {a["channel"]: a for a in sc.agents}
        out = []
        for w in found:
            if w["channel"] in by:
                out.append({**self._view(by[w["channel"]], sc.me), "how": w["how"], "at": w["at"]})
            elif not str(w.get("gatherer") or "").startswith(ALONE):
                out.append({"id": w["channel"], "channel": w["channel"], "group": w.get("gatherer"), "other": True,
                            "how": w["how"], "at": w["at"]})
        return {"path": full, "actors": out}

    def send(self, actor: str, ref: str, text: str, with_: Iterable[str] = ()) -> dict:
        """A message to the actor `ref` names -- `coordinator`: the coordinator agent of the nearest node over the asker
        and the actors `with_` names, of any group (coordinators.py's `nearest`); CoordinationError, nothing sent, for
        none (`_none_over`)."""
        sc = self._scope(actor)
        text = _message(text)
        with_ = [str(w).strip() for w in with_ if str(w or "").strip()]
        if (ref or "").strip().lower() in ALIASES:
            to = self._nearest(sc, with_)
        elif with_:
            raise CoordinationError("--with goes with `coordinator`: the actors in the conflict, for the coordinator agent "
                                    "over you all")
        else:
            to = self._find(sc.g, ref, sc.agents)
        if to["channel"] == sc.me["channel"]:
            raise CoordinationError("that is you")
        got = self._deliver(to.get("group") or sc.g, to, envelope(self._sender(sc), text))
        self._keep(sc.g, sc.me["channel"], "send", to, text)
        return {"sent": True, "to": self._view(to, sc.me), "session": {k: got.get(k) for k in ("status", "terminal")}}

    def _nearest(self, sc: "Scope", with_: List[str]) -> dict:
        """The coordinator agent of the nearest node over the asker and the actors `with_` names (module doc)."""
        places, named = [sc.place], []
        for ref in with_:
            ch, g, started_as = self._locate(sc, ref)
            if ch == sc.me["channel"]:
                raise CoordinationError("--with names you: give the other actor's id")
            named.append(ch)
            places.append(sc.tree.place(g, ch, started_as) if g else [])
        row, lca = coordinators.nearest(places, sc.by_node, but=[sc.me["channel"]])
        if row is None:
            raise CoordinationError(_none_over(sc, named, lca))
        found = next((a for a in sc.over if a["channel"] == row["session_id"]), None)
        if found is None:
            found = self._agent_of(row, sc.rows)
            found["over"] = sc.tree.label(coordinators.node_of(row))
        return found

    def _locate(self, sc: "Scope", ref: str) -> Tuple[str, Optional[str], Optional[str]]:
        """(its channel, its group, the id it was started under) of the actor `ref` names, in any group of the home:
        one the asker reaches, else by its id or its start (data.py's `groups_now`, the sessions started here)."""
        try:
            a = self._find(sc.g, ref, sc.agents)
        except CoordinationError:
            a = None
        if a is not None and not self._is_coordinator(a):
            return a["channel"], a.get("group") or sc.g, (a.get("session") or {}).get("started_as")
        where = dict(data.groups_now())
        started = {r["session_id"]: r for r in sc.rows}
        for r in sc.rows:
            where.setdefault(r["session_id"], r["gatherer"])
        as_of = {r["started_as"]: r["session_id"] for r in sc.rows if r.get("started_as")}
        ch = as_of.get(ref) or (ref if ref in where else None)
        if ch is None:
            some = sorted({c for c in where if c.startswith(ref)} | {as_of[k] for k in as_of if k.startswith(ref)})
            if len(some) > 1:
                raise CoordinationError(f"{ref} starts {len(some)} actors' ids: give more of it")
            ch = some[0] if some else None
        if ch is None:
            raise CoordinationError(f"no actor {ref} in this home: give the other actor's id, as a file-change notice "
                                    "or `ag actors who <file>` names it")
        group = where.get(ch)
        return ch, None if str(group or "").startswith(ALONE) else group, (started.get(ch) or {}).get("started_as")

    def new(self, actor: str, text: str, cwd: Optional[str] = None, harness: Optional[str] = None,
            model: Optional[str] = None, like: Optional[str] = None, name: Optional[str] = None,
            branch: bool = False, approve: bool = False, folder: Optional[str] = None, group: Optional[str] = None,
            **app: bool) -> dict:
        """A new actor (module doc), in the folder at the path `folder` if given (made if new; from the asker's node down,
        a coordinator agent's), in the asker's group -- a coordinator agent's above groups: `group`, or the one its
        path starts with. `app`, {<name>: True}: the actor of a new one of that app (an app that starts an agent of its
        own: app_agents.py), as `ag actors new --<name>` asks."""
        starters = _starters()                            # apps on the host that start an agent of their own
        sc = self._scope(actor)
        me = sc.me
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
        g, where = self._where(sc, folder or "", group)
        try:
            target = folders.find_or_make(g, where) if where else None
        except folders.FolderError as exc:
            raise CoordinationError(str(exc)) from None
        base = self._find(sc.g, like, sc.agents) if like else None
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
            if name:
                threading.Thread(target=_name_it, args=(g, row["session_id"], name), daemon=True).start()
        if target is not None:                            # filed by the id it is started under
            folders.file(g, [row["session_id"]], target)
        to = {"channel": row["session_id"], "session": row, "harness": harness, "cwd": row["cwd"], "status": data.IDLE,
              "name": {"text": name} if name else None, "group": g}
        self._deliver(g, to, envelope(self._sender(sc), text))
        self._keep(sc.g, me["channel"], "new", to, text)
        if self.ring is not None:
            self.ring(g)
        view = self._view(to, me, _kept(g) if target is not None else None)
        if view.get("folder") and sc.node:
            view["folder"] = self._shown_path(sc, g, view["folder"])
        return {"started": True, "actor": view, **({chosen[0].name: made} if made else {}), **({"branch": on} if on else {})}

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
        sc = self._scope(actor)
        to = self._target(sc, ref)
        if to["channel"] == sc.me["channel"]:
            raise CoordinationError("that is you: your turn is over when you end it")
        note = (note or "").strip()[:NOTE_CHARS]
        conn = self._db()
        try:
            n = conn.execute("INSERT INTO watches (gatherer, watcher, target, note, created, seen_running) VALUES (?, ?, ?, ?, ?, ?)",
                             (to.get("group") or sc.g, sc.me["channel"], to["channel"], note, time.time(),
                              int(to.get("status") in BUSY))).lastrowid
        finally:
            conn.close()
        return {"watch": n, "target": self._view(to, sc.me), "note": note}

    def watches(self, actor: str) -> dict:
        sc = self._scope(actor)
        by = {a["channel"]: a for a in sc.agents}
        conn = self._db()
        try:
            rows = conn.execute("SELECT * FROM watches WHERE watcher = ? AND fired = 0 ORDER BY id",
                                (sc.me["channel"],)).fetchall()
        finally:
            conn.close()
        return {"watches": [{"watch": r["id"], "note": r["note"], "created": r["created"],
                             "target": self._view(by[r["target"]], sc.me) if r["target"] in by else {"id": r["target"]}}
                            for r in rows]}

    def unwatch(self, actor: str, n) -> dict:
        _, me, _ = self._asker(actor)
        try:
            n = int(n)
        except (TypeError, ValueError):
            raise CoordinationError("which watch? Its number, as `ag actors watches` lists it") from None
        conn = self._db()
        try:
            gone = conn.execute("DELETE FROM watches WHERE id = ? AND watcher = ? AND fired = 0",
                                (n, me["channel"])).rowcount
        finally:
            conn.close()
        if not gone:
            raise CoordinationError(f"you have no watch {n} waiting")
        return {"dropped": n}

    # ---- folders, as a coordinator agent names them: from its node down

    def _where(self, sc: "Scope", path: str, group: Optional[str] = None) -> Tuple[str, str]:
        """(the group, the folder's path in it from its top; "" its top) that `path` names: an actor's, and a group's
        coordinator agent's, from the group's top; a folder's coordinator agent's, from its folder down ("" or `top`:
        its folder); one above groups', starting with the group's name (or in `group`)."""
        path = str(path or "").strip().strip("/")
        top = path.lower() in folders.TOP
        k = coordinators.kind(sc.node)
        if sc.node is None or k == "group":
            g = (sc.tree.group_of(sc.node) if sc.node else None) or sc.g
            if group and group != g:
                raise CoordinationError(f"{group} is not your group: name a folder of {g}")
            return g, "" if top else path
        if k == "folder":
            g = sc.tree.group_of(sc.node)
            if g is None:
                raise CoordinationError("your folder is no longer there")
            if group and group != g:
                raise CoordinationError(f"{group} is not the group of your folder: name a folder inside yours")
            base = folders.path(sc.tree.folders_of(g), sc.tree.folder_id(sc.node)) or ""
            return g, base if top else f"{base}/{path}"
        reads = sc.tree.reads(sc.node)
        if group:
            g, rest = group, path
        else:
            g, _, rest = path.partition("/")
        if g not in reads:
            raise CoordinationError("which group? Above groups a folder's path starts with its group's name: one of "
                                    + (", ".join(reads) or "none"))
        return g, "" if rest.strip("/").lower() in folders.TOP else rest

    def _shown_path(self, sc: "Scope", g: str, path: Optional[str]) -> Optional[str]:
        """A folder's path in `g` as the asker names it (`_where`'s reverse); None for its top."""
        if not path:
            return g if coordinators.above_groups(sc.node) else None
        k = coordinators.kind(sc.node)
        if k == "folder":
            base = folders.path(sc.tree.folders_of(g), sc.tree.folder_id(sc.node)) or ""
            return path[len(base) + 1:] or None if path.lower().startswith(base.lower() + "/") else None if path == base else path
        if coordinators.above_groups(sc.node):
            return f"{g}/{path}"
        return path

    def _folder_at_scope(self, sc: "Scope", where: str) -> Tuple[str, int]:
        """(its group, the folder's id) of the folder at the path `where`, as the asker names it -- never its own
        folder, nor a group's top, which no change names."""
        g, path = self._where(sc, where)
        if coordinators.kind(sc.node) == "folder" and path == self._where(sc, "")[1]:
            raise CoordinationError("that is your own folder: only the user changes it")
        return g, self._folder_at(g, path)

    # ---- the user's saved actors (saved.py), and the folders they keep actors in (folders.py), as the list has them

    def _own(self, actor: str, ref: str) -> Tuple["Scope", dict]:
        """(the asker's scope, the actor `ref` names): never a coordinator agent."""
        sc = self._scope(actor)
        return sc, self._ownable(sc, ref)

    def _ownable(self, sc: "Scope", ref: str) -> dict:
        a = self._target(sc, ref)
        if self._is_coordinator(a):
            raise CoordinationError("a coordinator agent is not saved or put in a folder: it stays over its folder")
        return a

    def save(self, actor: str, ref: str, folder: Optional[str] = None, unfiled: bool = False) -> dict:
        """The actor `ref` saved for later -- put in `folder` too if one is named (made if new), at the top of the
        asker's node if `unfiled`, else left where it is."""
        sc, a = self._own(actor, ref)
        g = a.get("group") or sc.g
        try:
            if folder or unfiled:
                fg, where = self._where(sc, folder or "", g if coordinators.above_groups(sc.node) and not folder else None)
                if fg != g:
                    raise CoordinationError(f"{folder} is a folder of {fg}, not of {g}: move it there first")
                target = folders.find_or_make(g, where) if where else None
            saved.choose(g, _kept_as(a, saved.stored().get(g, {})) or a["channel"], True)
            if folder or unfiled:
                folders.file(g, [_kept_as(a, _filed(g)) or a["channel"]], target)
        except folders.FolderError as exc:
            raise CoordinationError(str(exc)) from None
        self._rang(g)
        return {"actor": self._shown(sc, a, g)}

    def unsave(self, actor: str, ref: str) -> dict:
        sc, a = self._own(actor, ref)
        g = a.get("group") or sc.g
        saved.choose(g, _kept_as(a, saved.stored().get(g, {})) or a["channel"], False)
        self._rang(g)
        return {"actor": self._shown(sc, a, g)}

    def _shown(self, sc: "Scope", a: dict, g: str) -> dict:
        v = self._view(a, sc.me, _kept(g))
        if sc.node and v.get("folder"):
            v["folder"] = self._shown_path(sc, g, v["folder"])
        return v

    def move(self, actor: str, refs: List[str], folder: Optional[str], group: Optional[str] = None) -> dict:
        """The actors `refs` put in the folder at the path `folder` (made if new), or at the top (none, or folders.TOP)
        -> {actors, folder (its path; None: the top)}. `group`, another group: into its folder, the actors then sharing
        with it (groups.py's `move`, each one's task with it) -> {..., group}. A coordinator agent names the folder from
        its node down, and moves actors under it alone, to a folder under it."""
        if not refs:
            raise CoordinationError("which actors? Name one or more")
        sc = self._scope(actor)
        found = list({a["channel"]: a for a in (self._ownable(sc, ref) for ref in refs)}.values())
        froms = {a.get("group") or sc.g for a in found}
        if len(froms) > 1:
            raise CoordinationError("those actors are in different groups: move each group's apart")
        g = froms.pop()
        if group and group != g and not coordinators.above_groups(sc.node):
            to, where = group, folder or ""                 # into another group: only when the user asks
        else:
            to, where = self._where(sc, folder or "", group if coordinators.above_groups(sc.node) else None)
        if to != g:
            try:
                target = folders.find_or_make(to, where) if to in data.gatherer_names() and where else None
                moved = groups.move(g, to, [a["channel"] for a in found], into=target)
            except (folders.FolderError, groups.GroupError) as exc:
                raise CoordinationError(str(exc)) from None
            self._rang(g)
            kept = _kept(to)
            views = [self._view(a, sc.me, kept) for a in found if a["channel"] in moved["actors"]]
            return {"actors": views, "folder": self._shown_path(sc, to, folders.path(folders.of(to), target)), "group": to}
        try:
            target = folders.find_or_make(g, where) if where else None
            filed = _filed(g)
            folders.file(g, [_kept_as(a, filed) or a["channel"] for a in found], target)
        except folders.FolderError as exc:
            raise CoordinationError(str(exc)) from None
        self._rang(g)
        kept = _kept(g)
        return {"actors": [self._view(a, sc.me, kept) for a in found],
                "folder": self._shown_path(sc, g, folders.path(folders.of(g), target))}

    def alone(self, actor: str, ref: str) -> dict:
        """The actor `ref` taken out of every group (groups.py's `alone`): it works on its own, sharing context with no
        one, and no one with it -> {actor, group}."""
        sc, a = self._own(actor, ref)
        g = a.get("group") or sc.g
        try:
            made = groups.alone(g, a["channel"])
        except groups.GroupError as exc:
            raise CoordinationError(str(exc)) from None
        self._rang(g)
        return {"actor": self._view(a, sc.me, _kept(g)), "group": made["group"]}

    def folders(self, actor: str) -> dict:
        """The folders under the asker's node as a tree: {gatherer, folders: [{name, path, actors, closed, folders,
        shut}], actors, closed} -- at each level the folders in it (by name), the actors in it that are open or saved
        (the latest first), and how many closed ones; `shut`, whether the folder was closed (folders.py's `close`). An
        actor's, and a group's coordinator agent's: its group's; a folder's coordinator agent's: its folder's; one
        above groups': each group a node of it (`group`)."""
        sc = self._scope(actor)
        if coordinators.above_groups(sc.node):
            top = {"gatherer": sc.g, "node": sc.tree.label(sc.node), "folders": [], "actors": [], "closed": 0}
            for g in sc.tree.reads(sc.node):
                part = self._folder_tree(sc, g, None)
                top["folders"].append({**part, "name": g, "path": g, "shut": False, "group": True})
            return top
        g, path = self._where(sc, "")
        root = folders.find(g, path) if path else None
        return {**self._folder_tree(sc, g, root), "gatherer": g, **({"node": sc.tree.label(sc.node)} if sc.node else {})}

    def _folder_tree(self, sc: "Scope", g: str, root: Optional[int]) -> dict:
        """The folders of `g` under the folder `root` (None: its top), and the actors in each, as `folders` gives them."""
        tree, kept = folders.of(g), _kept(g)
        inside = {root} if root is not None else set()
        while True:
            more = {f["id"] for f in tree["folders"] if f["parent"] in inside or (root is None and f["parent"] is None)} - inside
            if not more:
                break
            inside |= more
        nodes = {f["id"]: {"name": f["name"], "path": self._shown_path(sc, g, folders.path(tree, f["id"])), "actors": [],
                           "closed": 0, "folders": [], "shut": bool(f.get("closed"))}
                 for f in tree["folders"] if f["id"] in inside and f["id"] != root}
        top = {"folders": [], "actors": [], "closed": 0}
        for f in tree["folders"]:                        # by name already
            if f["id"] in nodes:
                (nodes.get(f["parent"]) or top)["folders"].append(nodes[f["id"]])
        for a in sorted((a for a in sc.agents if (a.get("group") or sc.g) == g), key=lambda a: -(a.get("last") or 0)):
            if self._is_coordinator(a):
                continue
            v = self._view(a, sc.me, kept)
            fid = tree["filed"].get(_kept_as(a, tree["filed"]) or "")
            node = nodes.get(fid) if fid in nodes else top if fid == root or root is None else None
            if node is None:
                continue
            v["folder"] = self._shown_path(sc, g, v.get("folder")) if sc.node else v.get("folder")
            if a.get("status") == data.CLOSED and not v["saved"]:
                node["closed"] += 1
            else:
                node["actors"].append(v)
        return top

    def tree_text(self, actor: str, where: str = "") -> str:
        """dashboard_ls (tool_gateway.py's AG_TOOLS), `ag tasks`: what is in one place of the list, as text an agent
        reads -- a folder's folders, its tasks, and the actors and app instances in it that are in no task; a task's
        actors and apps. `where`: a folder's path, `task:<id>`, `/` (the group's top; above groups, the groups), or ""
        (the asker's own folder). Only what `ag actors` reaches (`_scope`). Read only."""
        from . import access, tasks
        sc = self._scope(actor)
        groups_shown = sc.tree.reads(sc.node) if coordinators.above_groups(sc.node) else [sc.g]
        where = (where or "").strip()
        if where in ("/", "") and len(groups_shown) > 1:
            return "\n".join(["/ (the groups you coordinate)"] + [f"  {g}/   group" for g in groups_shown])
        g, rest = sc.g, where.strip("/")
        if len(groups_shown) > 1:
            first, _, more = rest.partition("/")
            if first not in groups_shown:
                raise CoordinationError(f"{where}: no group of yours named {first!r} ({', '.join(groups_shown)})")
            g, rest = first, more
        tree, known, kept = folders.of(g), tasks.of(g), _kept(g)
        agents = [a for a in sc.agents if (a.get("group") or sc.g) == g and not self._is_coordinator(a)]
        by_item: Dict[str, dict] = {}
        for a in agents:
            for c in (a["channel"], (a.get("session") or {}).get("started_as")):
                if c:
                    by_item[c] = a
        host = access._host()
        insts = {tasks.app_item(i.id): i for i in host.instances_of(g)} if host is not None else {}
        mine = {c for c in (sc.me["channel"], (sc.me.get("session") or {}).get("started_as")) if c}
        my_task = next((known["tasked"][c] for c in mine if c in known["tasked"]), None)

        def folder_of(item: str) -> Optional[int]:
            a = by_item.get(item)
            return tree["filed"].get((_kept_as(a, tree["filed"]) if a else None) or item)

        def task_items(tid: int) -> List[str]:
            return [x for x, t in known["tasked"].items() if t == tid and (x in by_item or x in insts)]

        def task_name(tid: int) -> str:
            name = next((t["name"] for t in known["tasks"] if t["id"] == tid), "")
            if name:
                return name
            lead = next((by_item[x] for x in task_items(tid) if x in by_item), None)
            app = next((insts[x] for x in task_items(tid) if x in insts), None)
            return (_name(lead) or "") if lead else access.shown(app) if app else ""

        def actor_line(a: dict) -> str:
            v = self._view(a, sc.me, kept)
            bits = [v.get("status") or "?", v.get("harness") or "?", v.get("cwd") or "?"]
            if v.get("asked"):
                bits.append(f"asked: {json.dumps(v['asked'], ensure_ascii=False)}")
            name = f" {json.dumps(v['name'], ensure_ascii=False)}" if v.get("name") else ""
            return f"actor {v['id']}{name}{' (you)' if v['you'] else ''} -- {' · '.join(bits)}"

        def app_line(i) -> str:
            m = access._manifest(i.app)
            who = tool_gateway_who(m.access) if m is not None else "?"
            return f"app {access.shown(i)}{' in ' + i.folder if i.folder else ''} -- used by {who}"

        if rest.startswith("task:"):
            try:
                tid = int(rest[5:])
            except ValueError:
                raise CoordinationError(f"{where}: task:<its number>") from None
            items = task_items(tid)
            if not items:
                raise CoordinationError(f"{where}: no task {rest[5:]} in {g}")
            at = folders.path(tree, folder_of(items[0]))
            out = [f"task:{tid} {json.dumps(task_name(tid), ensure_ascii=False)} (group {g}, in /{at or ''})"
                   + (" -- your task" if tid == my_task else "")]
            out += ["  " + actor_line(by_item[x]) for x in items if x in by_item]
            out += ["  " + app_line(insts[x]) for x in items if x in insts]
            return "\n".join(out)

        if where == "":
            here = next((tree["filed"][c] for c in mine if c in tree["filed"]), None)
        else:
            try:
                here = folders.find(g, rest) if rest else None
            except folders.FolderError as exc:
                raise CoordinationError(str(exc)) from None
        out = [f"/{folders.path(tree, here) or ''} (group {g})"]
        for f in tree["folders"]:
            if f["parent"] == here:
                inside = sum(1 for x in [*by_item, *insts] if folder_of(x) == f["id"])
                out.append(f"  {f['name']}/ -- folder" + (" · closed" if f.get("closed") else "")
                           + (f" · {inside} item(s) directly in it" if inside else ""))
        shown_tasks, closed = set(), 0
        for x in [*known["tasked"]]:
            tid = known["tasked"][x]
            if tid in shown_tasks or (x not in by_item and x not in insts):
                continue
            items = task_items(tid)
            if folder_of(items[0]) != here:
                continue
            shown_tasks.add(tid)
            n_actors = sum(1 for y in items if y in by_item)
            out.append(f"  task:{tid} {json.dumps(task_name(tid), ensure_ascii=False)} -- task · {n_actors} actor(s), "
                       f"{len(items) - n_actors} app(s)" + (" · your task" if tid == my_task else ""))
        seen = set()
        for a in sorted(agents, key=lambda a: -(a.get("last") or 0)):
            if a["channel"] in seen or any(c in known["tasked"] for c in (a["channel"],
                                                                         (a.get("session") or {}).get("started_as"))):
                continue
            seen.add(a["channel"])
            if folder_of(a["channel"]) != here:
                continue
            if a.get("status") == data.CLOSED and _kept_as(a, kept[0]) is None and a["channel"] not in mine:
                closed += 1
                continue
            out.append("  " + actor_line(a))
        for item, i in insts.items():
            if item not in known["tasked"] and folder_of(item) == here:
                out.append("  " + app_line(i))
        if closed:
            out.append(f"  ({closed} closed actor(s) not listed)")
        if len(out) == 1:
            out.append("  (nothing here)")
        out.append("A folder: dashboard_ls <its path>. A task: dashboard_ls task:<id>. The top: dashboard_ls /.")
        return "\n".join(out)

    def folder(self, actor: str, do: str, name: str, to: str = "", group: Optional[str] = None) -> dict:
        """A folder, by its path (from the asker's node down), made (`new`: the folders of its path not there made too),
        renamed (`rename`: `to` its new name), put in another (`move`: `to` the other's path; none, or folders.TOP: the
        top -- of `group`, another group, the folder's actors then sharing with it), made a group of its own (`split`)
        or deleted (`delete`) -> what `folders` says, after, and what was done."""
        sc = self._scope(actor)
        if do not in ("new", "rename", "move", "split", "delete"):
            raise CoordinationError("`ag actors folder` new, rename, move, split or delete?")
        shown_name = "/".join(folders._parts(name))
        if do == "new":
            g, where = self._where(sc, name)
            try:
                folders.find_or_make(g, where)
            except folders.FolderError as exc:
                raise CoordinationError(str(exc)) from None
            self._rang(g)
            return {**self.folders(actor), "done": do, "name": shown_name}
        g, fid = self._folder_at_scope(sc, name)
        across = do == "split" or (do == "move" and group and group != g)
        if across:
            try:
                if do == "split":
                    made = groups.split(g, fid)
                    done = {"done": do, "name": shown_name, "group": made["group"]}
                else:
                    target = folders.find_or_make(group, to or "") if group in data.gatherer_names() and (to or "").strip().lower() not in folders.TOP else None
                    groups.move(g, group, folder=fid, into=target)
                    done = {"done": do, "name": shown_name, "group": group, "to": folders.path(folders.of(group), target)}
            except (folders.FolderError, groups.GroupError) as exc:
                raise CoordinationError(str(exc)) from None
            self._rang(g)
            return {**self.folders(actor), **done}
        try:
            done = {"done": do, "name": shown_name}
            if do == "rename":
                folders.rename(g, fid, to)
                done["to"] = folders.folder_name(to)
            elif do == "move":
                tg, where = self._where(sc, to or "")
                if tg != g:
                    raise CoordinationError(f"{to} is in {tg}: --group {tg} moves a folder into another group")
                dest = folders.find(g, where) if where else None
                folders.move(g, fid, dest)
                done["to"] = self._shown_path(sc, g, folders.path(folders.of(g), dest))
            else:
                folders.delete(g, fid)
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

    def page_coordinator(self, node: str, cwd: Optional[str] = None, harness: Optional[str] = None) -> dict:
        """The coordinator agent over `node` (coordinators.py's; a group's name: that group), for the page to show:
        started (with no message yet) if it has none."""
        node = str(node or "").strip()
        if not coordinators.kind(node) and not sessions.GATHERER.fullmatch(node):
            raise CoordinationError("which folder?")
        return self.ensure(node, cwd, harness)

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
            who = ("the coordinator agent" + (f" over {to['over']}" if to.get("over") else "")) if self._is_coordinator(to) \
                else f"actor {to['channel'][:8]}"
            raise sessions.NotAtBox(f"not delivered: {who}'s terminal shows a dialog or a question, or holds something "
                                    f"typed there and not sent (the user may be at it). Nothing was typed; try again "
                                    f"in a while.", exc.box) from None

    def _keep(self, gatherer: str, sender: str, kind: str, to: dict, text: str) -> None:
        actions.record(gatherer, sender, [{"type": ACTOR_MESSAGE, "id": f"{ACTOR_MESSAGE}:{uuid.uuid4().hex}",
                                           "payload": {"at": time.time(), "kind": kind, "to": to["channel"],
                                                       "to_name": _name(to) or (NAME if self._is_coordinator(to) else None),
                                                       "text": text}}])

    # ---- the watches

    def _db(self) -> sqlite3.Connection:
        return store.write("watches", rows=True)

    def check(self, now: Optional[float] = None) -> List[int]:
        """The watches whose watcher was told now: their numbers."""
        now = time.time() if now is None else now
        if not os.path.exists(store.path()):
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
        watching = {r["session_id"]: r for r in started if r.get("role") == COORDINATOR}
        tree = coordinators.Tree() if any(w["watcher"] in watching for w in waiting) else None
        for w in waiting:
            target = now_as.get(w["target"], w["target"])
            if w["watcher"] in watching:             # a coordinator agent's: while the actor stays under its node
                if self._left(w, watching[w["watcher"]], tree, now_in.get(target), now):
                    told.append(w["id"])
                    continue
            elif self._regrouped(w, now_in.get(target), now_in.get(w["watcher"]), now):
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

    def _left(self, w: sqlite3.Row, row: dict, tree: "coordinators.Tree", target_in: Optional[str], now: float) -> bool:
        """A coordinator agent's watch: the actor still under its node, the watch goes on (looked at in the actor's
        group, should it have moved); left it, the watch ends -- the coordinator agent told only that. -> whether it was
        told."""
        g = target_in or w["gatherer"]
        started_as = next((r.get("started_as") for r in self.started.list() if r["session_id"] == w["target"]), None)
        if coordinators.node_of(row) in tree.place(g, w["target"], started_as):
            if g != w["gatherer"]:
                self._mark(w["id"], gatherer=g)
            return False
        self._mark(w["id"], fired=now, outcome="moved")
        try:
            self._deliver(row["gatherer"], self._watcher(w, row["gatherer"]),
                          update(w["id"], w["target"], None, "it left your folder, so this watch has ended", ""))
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
        name = (_name(a) or (NAME if self._is_coordinator(a) else None)) if a else None
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

    def _role_payload(self, row: dict, tree: Optional["coordinators.Tree"] = None) -> dict:
        """The role record a coordinator agent's channel should hold now: private; its node (`over`) unless its group's;
        above groups, the groups under its node it reads, and their names where the user gave them others."""
        node = coordinators.node_of(row)
        payload: Dict[str, Any] = {"role": COORDINATOR, "private": True}
        if row.get("over"):
            payload["over"] = node
        if coordinators.above_groups(node):
            tree = tree or coordinators.Tree()
            reads = tree.reads(node)
            payload["reads"] = reads
            names = {g: tree.title(g) for g in reads if tree.title(g) != g}
            if names:
                payload["names"] = names
        return payload

    def _mark_roles(self) -> None:
        """Each coordinator agent's channel marked private, with its node and, above groups, the groups it reads: a
        `role` record in it, put in by ag (actions.py's `record`) once its gatherer has a database -- the channel the
        session's id, whatever its harness (`ag --channel`) -- and again whenever what it should say changed
        (a folder moved, a group put into or out of a folder of groups), never twice the same: what the channel holds is
        read once a dashboard's run, then kept (`marked`). A coordinator agent over a node no longer there (its folder
        deleted) is closed, once."""
        rows = [r for r in self.started.list() if r.get("role") == COORDINATOR]
        if not rows:
            return
        tree = coordinators.Tree()
        for r in rows:
            ch, group = r["session_id"], r["gatherer"]
            if not os.path.exists(sessions.home.db_path(groups.runs_under(group))):
                continue
            if r.get("over") and tree.path(r["over"]) is None:
                self._orphaned(r)
                continue
            want = self._role_payload(r, tree)
            with self.lock:
                had = self.marked.get(ch)
            if had is None:
                had = _role_in(group, ch)
            if had == want:
                with self.lock:
                    self.marked[ch] = want
                continue
            actions.record(group, ch, [{"type": ROLE, "id": f"{ROLE}:{ch}:{uuid.uuid4().hex[:12]}", "payload": want}],
                           wait=True)
            with self.lock:
                self.marked[ch] = want

    def _orphaned(self, row: dict) -> None:
        """A coordinator agent whose node is gone (its folder deleted): closed, once a dashboard's run -- it is over
        nothing now, and no message goes to it."""
        ch = row["session_id"]
        with self.lock:
            if self.marked.get(ch) == {"gone": True}:
                return
            self.marked[ch] = {"gone": True}
        try:
            if row.get("pid") or row.get("terminal"):
                self.started.stop(ch)
        except sessions.SessionError:
            pass

    def _run(self) -> None:
        while not self.stop.wait(WATCH_CHECK):
            for step in (self._mark_roles, self.check):
                try:
                    step()
                except Exception:  # noqa: BLE001 - never stop looking
                    pass

    def close(self) -> None:
        """No more looks at the watches: one under way -- its messages, its records -- ended first (STOP_WAIT at most)."""
        self.stop.set()
        if self.thread is not None and self.thread is not threading.current_thread():
            self.thread.join(STOP_WAIT)


class Scope(NamedTuple):
    """Who asks, and what it reaches (Coordination's `_scope`)."""
    g: str                          # the asker's group (a coordinator agent's above groups: its own, `self:<channel>`)
    me: dict                        # the asker, as an agent
    agents: List[dict]              # what it can name: it first, then the others (module doc), each with its `group`
    node: Optional[str]             # a coordinator agent's node (coordinators.py); None for an actor
    place: List[str]                # the path of nodes down to it: its folder's; a coordinator agent's, its node's
    tree: "coordinators.Tree"
    rows: List[dict]                # the dashboard's sessions
    by_node: Dict[str, dict]        # {node: its coordinator agent's session}
    over: List[dict]                # the coordinator agents over it, the nearest first
    inside: List[dict]              # a coordinator agent's: those under its node


def _said(label: str) -> str:
    return label if label == "everything" else json.dumps(label)


def _none_over(sc: Scope, named: List[str], lca: Optional[List[str]] = None) -> str:
    """Why no coordinator agent got a message (Coordination's `send`), and what to do then."""
    tell = "Tell the user about it here." if sc.node else (
        "Stop changing what the conflict touches, and end your turn telling the user about it -- what it touches, the "
        "other actor's id, and how you found it: they can settle it, or start a coordinator agent over a folder that "
        "holds you both.")
    you = f"your folder {_said(sc.tree.label(sc.node))}" if sc.node else "you"
    if not named:
        return f"No coordinator agent is over {you}: nothing was sent. " + (tell if sc.node else (
            "If your work conflicts with another actor's, give its id (`--with <id>`) all the same, then: " + tell[0].lower() + tell[1:]))
    who = ("actor " + named[0]) if len(named) == 1 else "actors " + coordinators._and(named)
    if not lca:
        where = "no folder holds you all (one of you works on its own)"
    else:
        where = f"the nearest folder holding you all is {_said(sc.tree.label(lca[-1]))}, and no folder from there up has one"
    return f"No coordinator agent is over {you} and {who}: {where}. Nothing was sent. {tell}"


def _role_in(group: str, channel: str) -> Optional[dict]:
    """The latest `role` record's payload in the channel, as ag keeps it; None for none (or not read)."""
    conn = store.gatherer(groups.runs_under(group))
    if conn is None:
        return None
    try:
        row = conn.execute(f"SELECT e.payload_json FROM events e JOIN event_types t ON t.event_type_id = e.event_type_id "
                           f"WHERE t.name = ? AND ifnull(e.{data.CHANNEL}, '') = ? ORDER BY e.row_id DESC LIMIT 1",
                           (ROLE, channel)).fetchone()
    except sqlite3.Error:
        return None
    finally:
        conn.close()
    got = data._json(row[0]) if row else None
    return got if isinstance(got, dict) else None


def _filed(gatherer: str) -> dict:
    """{channel: its folder's id}, of folders.py's `gatherer`."""
    return folders.of(gatherer)["filed"]


def tool_gateway_who(how: str) -> str:
    """Who may use an app's instances, as agents are told (tool_gateway.py's WHO)."""
    from . import tool_gateway
    return tool_gateway.WHO.get(how, how)


def _kept(gatherer: str) -> Tuple[dict, dict]:
    """What saved.py and folders.py keep of `gatherer`: ({channel: when saved}, {channel: its folder's path})."""
    tree = folders.of(gatherer)
    return saved.stored().get(gatherer, {}), {c: folders.path(tree, fid) for c, fid in tree["filed"].items()}


def _kept_as(a: dict, keys: dict) -> Optional[str]:
    """The channel the actor `a` is kept as, of {channel: ...} (saved, or filed): its own, else the one it was started
    under (a codex session's from before `ag --channel`, renamed to its thread since), as the page's `savedAs` finds it;
    None: not kept there."""
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
    who = ("the coordinator agent" + (f" over {got['over']}" if got.get("over") else "")) \
        if got["from"] == "coordinator" else f"actor {got['id']}"
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
