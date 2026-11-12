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

    split(gatherer, folder)                 a folder dragged outside every group: made a group of its own, named after
                                            it (`ag new`, as "+ New group" makes one), what was in it at its top

Not yet: an app does not move between groups (GroupError), and the coordinator agent's watches of an actor stay
where they were."""

import re
import secrets
from typing import Dict, Iterable, List, Optional

from . import actions, data, folders, home, sessions, tasks, titles

GROUP = "group"
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
    """The actors a move takes: those named, those filed in `folder` or a folder in it, and every other actor of a task
    one of them is in (a task moves whole)."""
    out = {str(c) for c in channels}
    if folder is not None:
        tree = _tree(gatherer)
        if not any(f["id"] == int(folder) for f in tree["folders"]):
            raise GroupError(f"{gatherer} has no folder {folder}")
        inside = set(_under(tree, int(folder)))
        out |= {c for c, f in tree["filed"].items() if f in inside}
    mine = (tasks.stored() or {}).get(gatherer) or {"tasks": [], "tasked": {}}
    joined = {mine["tasked"][c] for c in out if c in mine["tasked"]}
    out |= {c for c, t in mine["tasked"].items() if t in joined}
    if any(c.startswith(folders.APP) for c in out):
        raise GroupError("an app does not move between groups yet: take it out of the folder or the task first")
    return sorted(out)


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
    moving = actors(gatherer, channels, folder)
    before = _sizes(gatherer, to)
    return {"actors": moving, "from": gatherer, "to": to, "folder": folder, "before": before,
            "after": {gatherer: before[gatherer] - len(moving), to: before[to] + len(moving)}}


def move(gatherer: str, to: str, channels: Iterable[str] = (), folder: Optional[int] = None,
         into: Optional[int] = None, dissolve: bool = False) -> dict:
    """The move done (module doc): {actors, from, to}. GroupError: no such group or folder, a folder of that name in the
    place it would go, or a record ag did not take -- nothing of the dashboard's then changed. `dissolve`: the folder
    itself gone, what was in it at `into` instead (`split`'s)."""
    _check(gatherer, to)
    moving = actors(gatherer, channels, folder)
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
             for c in moving}                         # in a folder moved: still in it
    events = [{"type": GROUP, "id": f"{GROUP}:{c}:{secrets.token_hex(6)}", "properties": {"channel": c},
               "payload": {**said, "folder": there[c]}} for c in moving]
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
    _rows(gatherer, to, moving)
    return {"actors": moving, "from": gatherer, "to": to}


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
    itself gone. -> {group, actors, from}. GroupError: no such folder, an app in it, or the move not taken."""
    if not home.merged():
        raise GroupError("a new group from a folder needs the home's one database: run `ag home merge` first")
    f = next((x for x in _tree(gatherer)["folders"] if x["id"] == int(folder)), None)
    if f is None:
        raise GroupError(f"{gatherer} has no folder {folder}")
    actors(gatherer, (), folder)                      # an app in it: refused before anything is made
    name = _group_name(f["name"])
    try:
        sessions.new_gatherer(name)
    except sessions.SessionError as exc:
        raise GroupError(str(exc)) from None
    if name != f["name"]:
        titles.give(name, f["name"])
    moved = move(gatherer, name, folder=folder, into=None, dissolve=True)
    return {"group": name, "actors": moved["actors"], "from": gatherer}
