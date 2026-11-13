"""Moving actors and folders from one group to another. A group is what a gatherer is (the Notes design "Groups:
design"): in the home's one database (home.py's `merged`) a gatherer's actors are the channels whose latest `group`
record names it (data.py's `members`), so an actor changes group by a new record -- with a database per gatherer, an
actor's group is its file, and none moves (GroupError).

    plan(gatherer, to, channels, folder)    what a move would do, for the page to ask first: the actors that change
                                            group -- those named, every one in the folder and the folders in it, and
                                            the others of each one's task, which moves whole -- and how many actors each
                                            of the two groups has before and after
    move(gatherer, to, channels, folder, into)   it done, in one call to ag: a `group` record in each actor's channel
                                            ({group, was, name, was_name, folder}: its id names the channel and the
                                            move, as a read returns an id once, whatever its channel) -- its folder
                                            `into` (one of the group's; none, its top), or the one it was in, inside
                                            the folder moved -- and a `folder` record of the folder and each folder in
                                            it, now the group's (folders.py); then the dashboard's own rows of the
                                            actors moved to the group's name, in one transaction -- the session's, its
                                            saved mark, what was seen of it, its avatar, its task

An app in a task or a folder that moves goes with it, as its actors keep using it (`apps`): one with many instances
(Browser, DocWriter, Editor) -- its `filed` record names the new group, and the host moves it (app_host.py's
`regroup`). An app's own agent (one it started: app_agents.py's `role_of`, its role naming the instance) and that
instance go together, as a task does (`_own`): Paper news's agent and its Paper news. A group's only one of its app
(Notes, Slack, Paper news: one per group) is its group's, and stays -- a move that would take one is refused
(GroupError) -- unless its own agent goes with it: then it goes too, into a group that has none of that app; into one
that has, it is closed, and its agents work with that group's instead (`_folds`: its role names that one from then on,
as the host would open the old one again for it at its next start). An attachment a move would leave across groups --
a moved actor to an app that stays, an actor that stays to an app that moves -- is dropped (`_unhook`), as attaching
across groups is refused.

    split(gatherer, folder)                 a folder dragged outside every group: made a group of its own, named after
                                            it (`ag new`, as "+ New group" makes one), what was in it at its top
    alone(gatherer, channel)                an actor dragged outside every group: on its own, a group of one
                                            (`self:<channel>`) -- it shares with no one, no one with it, and it has no
                                            coordinator agent -- with the apps of its task (none of its actors but it),
                                            and its app's own window if it is an app's agent; `move` brings it back
    start_alone(started, gatherer, cwd, harness)   a new actor on its own from its start (the list's "+" beside
                                            "+ New group"): its session made (sessions.py's `create`, `alone`) and its
                                            `group` record in before its first call, so it never shares
    runs_under(group)                       the group ag runs a write of `group`'s under: an actor on its own's, the
                                            group it left (`launch_group`) -- ag keeps a config for the home's groups,
                                            and would make one for a name it does not know

A watch of the coordinator agent's on a moved actor goes as coordination.py's `check` says."""

import os
import re
import secrets
import sqlite3
from typing import Dict, Iterable, List, Optional

import harness_kit
from app_kit import AppError

from . import actions, data, folders, home, sessions, tasks, titles

GROUP = "group"
ALONE = "self:"                 # an actor on its own: the group of one `self:<its channel>` (the policy's ALONE too)
#: The dashboard's tables that name an actor's gatherer beside its channel (sessions apart: by its session_id).
ACTOR_TABLES = ("saved", "seen", "avatars", "tasked")


class GroupError(ValueError):
    """A move the groups cannot take: the page shows its text."""


def _names(gatherer: str) -> str:
    return (titles.stored() or {}).get(gatherer) or gatherer


def _tree(gatherer: str) -> dict:
    return folders.of(gatherer)


def _under(tree: dict, fid: int) -> List[int]:
    """The folder and every folder in it, by id."""
    out, todo = [], [int(fid)]
    while todo:
        f = todo.pop()
        out.append(f)
        todo += [x["id"] for x in tree["folders"] if x.get("parent") == f]
    return out


def actors(gatherer: str, channels: Iterable[str] = (), folder: Optional[int] = None) -> List[str]:
    """The items a move takes: the actors named, those filed in `folder` or a folder in it, and every other item of a
    task one of them is in (a task moves whole) -- apps among them, as APP + its id, each one that can move (`apps`)."""
    out = {str(c) for c in channels}
    if folder is not None:
        tree = _tree(gatherer)
        if not any(f["id"] == int(folder) for f in tree["folders"]):
            raise GroupError(f"{gatherer} has no folder {folder}")
        inside = set(_under(tree, int(folder)))
        out |= {c for c, f in tree["filed"].items() if f in inside}
    mine = (tasks.stored() or {}).get(gatherer) or {"tasks": [], "tasked": {}}
    agents = _app_agents(gatherer)
    while True:                                       # each one's task, and an app's own agent with its instance
        joined = {mine["tasked"][c] for c in out if c in mine["tasked"]}
        grown = out | {c for c, t in mine["tasked"].items() if t in joined} | _own(gatherer, out, agents)
        if grown == out:
            break
        out = grown
    apps(gatherer, out)
    return sorted(out)


def _app_agents(gatherer: str) -> Dict[str, List[str]]:
    """The agents of `gatherer` an app started, by the instance their role names: {instance id: [channel]}."""
    from . import app_agents                          # (it imports what imports this module)
    out: Dict[str, List[str]] = {}
    for s in sessions.stored():
        got = app_agents.role_of(s)
        if got is not None and s.get("gatherer") == gatherer:
            out.setdefault(got[1], []).append(s["session_id"])
    return out


def _own(gatherer: str, items: set, agents: Dict[str, List[str]]) -> set:
    """What an app's own agent and its instance bring along (module doc): of each agent among `items`, its instance,
    open in `gatherer` (with no host to say, it all the same: `apps` refuses it then) -- of each instance among them,
    its agents."""
    host = _host()
    here = None if host is None else {i.id for i in host.instances_of(gatherer)}
    out = set()
    for inst, channels in agents.items():
        if folders.APP + inst in items:
            out |= set(channels)
        elif any(c in items for c in channels) and (here is None or inst in here):
            out.add(folders.APP + inst)
    return out


def _host():
    from . import tool_gateway                        # the server's AppHost, its apps' (None: none run here)
    return tool_gateway.HOST


def apps(gatherer: str, items: Iterable[str]) -> list:
    """The app instances among `items` (APP + its id) -> [Instance]. GroupError: one not found, or one that can't move --
    a group's only one of its app (one per group, folder, checkout or repository), which is its group's, unless its own
    agent is among `items` too."""
    items = [str(c) for c in items]
    ids = [c[len(folders.APP):] for c in items if c.startswith(folders.APP)]
    if not ids:
        return []
    host = _host()
    if host is None:
        raise GroupError("an app moves between groups only where the dashboard runs its apps")
    out, agents = [], _app_agents(gatherer)
    for i in ids:
        try:
            inst = host.instance(gatherer, i)
        except AppError:
            raise GroupError(f"{gatherer} has no app {i}") from None
        if host.hosted(inst.app).manifest.instances != "many" and not set(agents.get(i, ())) & set(items):
            raise GroupError(f"{inst.name or inst.title or inst.app} is its group's own (the group's only one): it stays "
                             "with its group -- take it out of the task or the folder first")
        out.append(inst)
    return out


def _folds(to: str, moved: list) -> dict:
    """Of the instances `moved` (`apps`), those a group has one of at most (its app not "many") that `to` has one of
    already: {moved id: `to`'s one} -- it closed, and its agents that move work with `to`'s one (module doc)."""
    host = _host()
    out = {}
    for inst in moved:
        if host.hosted(inst.app).manifest.instances == "many":
            continue
        there = host.instances_of(to, inst.app)
        if there:
            out[inst.id] = there[0]
    return out


def _close(gatherer: str, inst, moving: List[str]) -> tuple:
    """The instance `inst` of `gatherer` closed, as the group it goes to has its app's one (`_folds`), and out of its
    task -- before the moving actors' rows move -> (the moving actors that used it, its own agents among them)."""
    from . import task_links                          # (it imports what imports this module)
    host = _host()
    gone = set(moving)
    own = [c for c in _app_agents(gatherer).get(inst.id, ()) if c in gone]
    users = sorted({c for c in host.agents_of(inst) if c in gone} | set(own))
    host.close_instance(gatherer, inst.id, by="group")
    task_links.closed(gatherer, inst.id)
    return users, own


def _join(to: str, there, users: List[str], own: List[str]) -> None:
    """The actors `users` of an instance closed for `to`'s own one, `there` (`_close`), attached to it, in its task as
    an agent attached to an app is (task_links.py's `link`) -- once their rows are `to`'s -- and each of its own agents
    `own` given a role naming `there` from now on, as the host would make the one it named again for it at its next
    start (app_host.py's `adopt`)."""
    from . import app_agents, task_links
    if own:
        conn = folders._write()
        try:
            with conn:
                conn.executemany("UPDATE sessions SET role = ? WHERE session_id = ?",
                                 [(app_agents.role(there.app, there.id), c) for c in own])
        finally:
            conn.close()
    for c in users:
        task_links.link(to, there.id, c)
        _host().attach(to, there.id, c, by="group")


def _unhook(gatherer: str, moving: List[str], moved_apps: List[str]) -> None:
    """The attachments a move from `gatherer` leaves across groups dropped (module doc), before the apps move: the
    actors `moving` from the apps that stay, the actors that stay from the apps `moved_apps`."""
    host = _host()
    if host is None:
        return
    gone, going = set(moving), set(moved_apps)
    for inst in host.instances_of(gatherer):
        stays = inst.id not in going
        for c in host.agents_of(inst):
            if (c in gone) == stays:
                host.detach(gatherer, inst.id, c, by="group")


def _members(group: str) -> set:
    conn = data._connect(group)
    if conn is None:
        return set()
    try:
        return data.members(conn, group) or set()
    finally:
        conn.close()


def _sizes(*groups: str) -> Dict[str, int]:
    conn = data._connect(groups[0])
    if conn is None:
        return {g: 0 for g in groups}
    try:
        return {g: len(data.members(conn, g) or ()) for g in groups}
    finally:
        conn.close()


def _check(gatherer: str, to: str) -> None:
    if not home.merged():
        raise GroupError("moving between groups needs the home's one database: run `ag home merge` first")
    if to == gatherer:
        raise GroupError(f"already in {to}")
    if to not in data.gatherer_names():
        raise GroupError(f"no group {to!r}")


def plan(gatherer: str, to: str, channels: Iterable[str] = (), folder: Optional[int] = None) -> dict:
    """{actors, from, to, folder, before: {group: actors}, after: {group: actors}} -- what `move` would do, nothing done."""
    _check(gatherer, to)
    items = actors(gatherer, channels, folder)
    moving = [c for c in items if not c.startswith(folders.APP)]
    before = _sizes(gatherer, to)
    moved = apps(gatherer, items)
    folds = _folds(to, moved)
    return {"actors": moving, "from": gatherer, "to": to, "folder": folder, "before": before,
            "after": {gatherer: before[gatherer] - len(moving), to: before[to] + len(moving)},
            "apps": [{"id": i.id, "app": i.app, "title": i.name or i.title,
                      **({"joins": {"id": folds[i.id].id, "title": folds[i.id].name or folds[i.id].title}}
                         if i.id in folds else {})} for i in moved]}


def move(gatherer: str, to: str, channels: Iterable[str] = (), folder: Optional[int] = None,
         into: Optional[int] = None, dissolve: bool = False) -> dict:
    """The move done (module doc): {actors, apps, joined, from, to} -- `apps` the instances moved, `joined` those closed
    for `to`'s own one of their app, {id: its id} (`_folds`). GroupError: no such group or folder, a folder of that
    name in the place it would go, or a record ag did not take -- nothing of the dashboard's then changed. `dissolve`:
    the folder itself gone, what was in it at `into` instead (`split`'s)."""
    _check(gatherer, to)
    items = actors(gatherer, channels, folder)
    moving = [c for c in items if not c.startswith(folders.APP)]
    moved = apps(gatherer, items)
    folds = _folds(to, moved)
    moved_apps = [i.id for i in moved if i.id not in folds]
    items = [c for c in items if not (c.startswith(folders.APP) and c[len(folders.APP):] in folds)]   # closed ones: none
    target = _tree(to)
    if into is not None and not any(f["id"] == int(into) for f in target["folders"]):
        raise GroupError(f"{to} has no folder {into}")
    if folder is not None and not dissolve:
        name = next(f["name"] for f in _tree(gatherer)["folders"] if f["id"] == int(folder))
        if any(f.get("parent") == into and f["name"].lower() == name.lower() for f in target["folders"]):
            raise GroupError(f'{to} has a folder "{name}" there already')
    said = {"group": to, "was": gatherer, "name": _names(to), "was_name": _names(gatherer)}
    tree = _tree(gatherer)
    under = _under(tree, int(folder)) if folder is not None else []
    gone = int(folder) if dissolve and folder is not None else None
    there = {c: tree["filed"][c] if tree["filed"].get(c) in under and tree["filed"][c] != gone else into
             for c in items}                          # in a folder moved: still in it
    events = [{"type": GROUP, "id": f"{GROUP}:{c}:{secrets.token_hex(6)}", "properties": {"channel": c},
               "payload": {**said, "folder": there[c]}} for c in moving]
    events += [folders._filed_event(to, c, there[c]) for c in items if c.startswith(folders.APP)]   # an app's place
    kept = folders._records()[0]
    for fid in under:                                 # the folder at `into`, those in it where they were
        f = kept[fid]
        if fid == gone:
            events.append(folders._folder_event(fid, None))
            continue
        parent = into if fid == int(folder) or f["parent"] == gone else f["parent"]
        events.append(folders._folder_event(fid, (to, parent, f["name"], f["at"], f["closed"])))
    try:
        actions.insert(to, events)                    # ag first: what the policy reads, and where the folders are
    except (RuntimeError, OSError, ValueError) as exc:
        raise GroupError(f"ag did not take the move: {exc}; nothing else changed") from None
    got = _members(to)
    missed = [c for c in moving if c not in got]
    if missed:
        raise GroupError(f"ag did not take the move of {', '.join(missed)}; nothing else changed")
    _unhook(gatherer, moving, [i.id for i in moved])  # one closed for `to`'s: its own let go of at its close
    for i in moved_apps:
        _host().regroup(gatherer, i, to)
    closed = {inst.id: _close(gatherer, inst, moving) for inst in moved if inst.id in folds}
    _rows(gatherer, to, items)
    for i, (users, own) in closed.items():
        _join(to, folds[i], users, own)
    return {"actors": moving, "apps": moved_apps, "joined": {i: there.id for i, there in folds.items()},
            "from": gatherer, "to": to}


def _rows(gatherer: str, to: str, moving: List[str]) -> None:
    """The dashboard's own rows of the moved actors moved to `to`'s name, in one transaction: their folders are the
    records' (folders.py)."""
    if not moving:
        return
    marks = ", ".join("?" * len(moving))
    conn = folders._write()
    try:
        conn.execute("BEGIN IMMEDIATE")
        if folders._has(conn, "sessions"):
            conn.execute(f"UPDATE sessions SET gatherer = ? WHERE gatherer = ? AND session_id IN ({marks})",
                         (to, gatherer, *moving))
        for table in ACTOR_TABLES:
            if folders._has(conn, table):
                conn.execute(f"UPDATE {table} SET gatherer = ? WHERE gatherer = ? AND channel IN ({marks})",
                             (to, gatherer, *moving))
        if folders._has(conn, "tasks"):
            conn.execute(f"UPDATE tasks SET gatherer = ? WHERE id IN (SELECT task FROM tasked WHERE gatherer = ? "
                         f"AND channel IN ({marks}))", (to, to, *moving))
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


def _group_name(title: str) -> str:
    """A new group's name, from `title`: what ag takes of it (letters, digits, '.', '_', '-'), one no group has."""
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", title).strip("._-")[:60] or "group"
    taken = {n.lower() for n in data.gatherer_names()}
    name, n = base, 1
    while name.lower() in taken:
        n += 1
        name = f"{base}_{n}"
    return name


def split(gatherer: str, folder: int) -> dict:
    """The folder `folder` of `gatherer` made a group of its own (module doc): a new group named after it -- its exact
    name its title, where ag takes another -- and what was in it, actors and folders, at the new group's top; the folder
    itself gone. -> {group, actors, apps, from}. GroupError: no such folder, a group's only one of an app in it, or the
    move not taken."""
    if not home.merged():
        raise GroupError("a new group from a folder needs the home's one database: run `ag home merge` first")
    f = next((x for x in _tree(gatherer)["folders"] if x["id"] == int(folder)), None)
    if f is None:
        raise GroupError(f"{gatherer} has no folder {folder}")
    actors(gatherer, (), folder)                      # an app that stays in it: refused before anything is made
    name = _group_name(f["name"])
    try:
        sessions.new_gatherer(name)
    except sessions.SessionError as exc:
        raise GroupError(str(exc)) from None
    if name != f["name"]:
        titles.give(name, f["name"])
    moved = move(gatherer, name, folder=folder, into=None, dissolve=True)
    return {"group": name, "actors": moved["actors"], "apps": moved["apps"], "from": gatherer}


def is_alone(group: str) -> bool:
    """Whether `group` is an actor's on its own (`alone`): a group of one, no group of the home's."""
    return str(group or "").startswith(ALONE)


def alone(gatherer: str, channel: str) -> dict:
    """The actor `channel` of `gatherer` taken out of every group (module doc), in one call to ag: its `group` record,
    {group: self:<channel>, was, name: "", was_name, folder: none}, and a `filed` record of each app that goes with it --
    its task's, and its app's own window (`actors`) -- at that group's top; then the apps moved there (the host's
    `regroup`), and the dashboard's own rows of them under that name. -> {group, actors, apps, from}. GroupError: not on
    the home's one database, no such actor, the coordinator agent (it stays with its group), one working in a task
    with other actors (a task moves whole: out of it first), or an app of its task that can't move (`apps`)."""
    if not home.merged():
        raise GroupError("an actor on its own needs the home's one database: run `ag home merge` first")
    channel = str(channel or "").strip()
    if is_alone(gatherer):
        raise GroupError("it is on its own already")
    if channel not in _members(gatherer):
        raise GroupError(f"{gatherer} has no actor {channel}")
    if any(r.get("session_id") == channel and r.get("role") == sessions.COORDINATOR for r in sessions.stored()):
        raise GroupError("the coordinator agent stays with its group")
    items = actors(gatherer, [channel])
    if [c for c in items if not c.startswith(folders.APP)] != [channel]:
        raise GroupError("it works in a task with others: take it out of the task first")
    moved = [i.id for i in apps(gatherer, items)]
    to = ALONE + channel
    event = {"type": GROUP, "id": f"{GROUP}:{channel}:{secrets.token_hex(6)}", "properties": {"channel": channel},
             "payload": {"group": to, "was": gatherer, "name": "", "was_name": _names(gatherer), "folder": None}}
    try:                                              # ag runs it under a group of the home's: the one it leaves
        actions.insert(gatherer, [event, *(folders._filed_event(to, folders.APP + i, None) for i in moved)])
    except (RuntimeError, OSError, ValueError) as exc:
        raise GroupError(f"ag did not take it: {exc}; nothing else changed") from None
    if channel not in _members(to):
        raise GroupError(f"ag did not take it out of {gatherer}; nothing else changed")
    _unhook(gatherer, [channel], moved)               # the apps it used that stay: their group's, not its own
    for i in moved:
        _host().regroup(gatherer, i, to)
    _rows(gatherer, to, items)
    return {"group": to, "actors": [channel], "apps": moved, "from": gatherer}


def start_alone(started, gatherer: str, cwd: str, harness: str, permission_mode: str = "auto",
                model: Optional[str] = None) -> dict:
    """A new actor on its own from its start: a session of `harness` in `cwd` (`started`'s `create`), listed as its group
    of one and run under `gatherer`, a group of the home's -- ag runs every session in one (`launch_group`) -- with its
    `group` record, {group: self:<channel>, under: gatherer, name: "", folder: none}, put in before its first call as the
    conversation's first record -- ag writes one of its own only when it has none (ag_harness's `grouped`), and none
    with an insert that brings one -- so even its first call is built with its own context alone. No `was`: it came from no group, so it is never told it left one (the policy's
    `group_changes`). -> the session. GroupError: not on the home's one database, no such group, or a harness that
    names its session only at its first call (codex's thread, agy's conversation: no channel to record before then);
    or ag did not take the record (the session forgotten)."""
    if not home.merged():
        raise GroupError("an actor on its own needs the home's one database: run `ag home merge` first")
    if is_alone(gatherer) or gatherer not in data.gatherer_names():
        raise GroupError(f"no group {gatherer!r} to run it under")
    if sessions.picks_id(harness):
        rules = harness_kit.get(harness)
        raise GroupError(f"{rules.label if rules else harness} names its session only at its first call: "
                         "start it in a group, then drag it out of the group")
    s = started.create(gatherer, cwd, permission_mode, harness, model, alone=True)
    channel = s["session_id"]
    event = {"type": GROUP, "id": f"{GROUP}:{channel}:{secrets.token_hex(6)}", "properties": {"channel": channel},
             "payload": {"group": ALONE + channel, "under": gatherer, "name": "", "folder": None}}
    try:
        actions.insert(gatherer, [event])
    except (RuntimeError, OSError, ValueError) as exc:
        started.discard(channel)
        raise GroupError(f"ag did not take it: {exc}; nothing was started") from None
    return s


def runs_under(group: str) -> str:
    """The group ag runs a write of `group`'s under (`ag home insert`, module doc): `group` -- or, for an actor on its
    own, the group it left (`launch_group`)."""
    return launch_group(group[len(ALONE):], group) if is_alone(group) else group


def launch_group(channel: str, group: str) -> str:
    """The group a session's process starts under (`ag --gatherer`, sessions.py): its own -- or, for an actor on its
    own, the group it left, as its latest `group` record says (`was`; one started on its own: the one it was started
    under, `under`): ag runs a session in a group of the home, and what the actor shares is its record's, no one's.
    Else the home's first group."""
    if not is_alone(group):
        return group
    path = home.home_db()
    if os.path.exists(path):
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=8)
        try:
            row = conn.execute("SELECT e.payload_json FROM events e JOIN event_types t ON t.event_type_id = e.event_type_id "
                               "WHERE t.name = ? AND ifnull(e.p_channel, '') = ? ORDER BY e.row_id DESC LIMIT 1",
                               (GROUP, channel)).fetchone()
        except sqlite3.Error:
            row = None
        finally:
            conn.close()
        p = (folders._payload(row[0]) or {}) if row else {}
        was = p.get("was") or p.get("under")
        if was and not is_alone(str(was)):
            return str(was)
    names = data.gatherer_names()
    return names[0] if names else group
