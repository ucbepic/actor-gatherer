"""Moving actors and folders from one group to another. A group is what a gatherer is (the Notes design "Groups:
design"): in the home's one database (home.py's `merged`) a gatherer's actors are the channels whose latest `group`
record names it (data.py's `members`), so an actor changes group by a new record -- with a database per gatherer, an
actor's group is its file, and none moves (GroupError).

    plan(gatherer, to, channels, folder)    what a move would do, for the page to ask first: the actors that change
                                            group -- those named, every one in the folder and the folders in it, and
                                            the others of each one's task, which moves whole -- and how many actors each
                                            of the two groups has before and after
    move(gatherer, to, channels, folder, into)   it done: a `group` record in each actor's channel ({group, was, name,
                                            was_name}: its id names the channel and the move, as a read returns an id
                                            once, whatever its channel), then the dashboard's own rows of them moved
                                            to the group's name, in one transaction -- the session's, its saved mark,
                                            what was seen of it, its avatar, its folder (`into`: one of the group's;
                                            none, its top), its task; the folder, and every folder in it, with them

Not yet: an actor's apps' attachments and the gatherer agent's watches of it stay where they were."""

import secrets
import sqlite3
from typing import Dict, Iterable, List, Optional

from . import actions, data, folders, home, tasks, titles

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
    """{actors, from, to, before: {group: actors}, after: {group: actors}} -- what `move` would do, nothing done."""
    _check(gatherer, to)
    moving = actors(gatherer, channels, folder)
    before = _sizes(gatherer, to)
    return {"actors": moving, "from": gatherer, "to": to, "before": before,
            "after": {gatherer: before[gatherer] - len(moving), to: before[to] + len(moving)}}


def move(gatherer: str, to: str, channels: Iterable[str] = (), folder: Optional[int] = None,
         into: Optional[int] = None) -> dict:
    """The move done (module doc): {actors, from, to}. GroupError: no such group or folder, a folder of that name in the
    place it would go, or a record ag did not take -- nothing of the dashboard's then changed."""
    _check(gatherer, to)
    moving = actors(gatherer, channels, folder)
    target = _tree(to)
    if into is not None and not any(f["id"] == int(into) for f in target["folders"]):
        raise GroupError(f"{to} has no folder {into}")
    if folder is not None:
        name = next(f["name"] for f in _tree(gatherer)["folders"] if f["id"] == int(folder))
        if any(f.get("parent") == into and f["name"].lower() == name.lower() for f in target["folders"]):
            raise GroupError(f'{to} has a folder "{name}" there already')
    said = {"group": to, "was": gatherer, "name": _names(to), "was_name": _names(gatherer)}
    for c in moving:                                 # ag first: what the policy reads
        event = {"type": GROUP, "id": f"{GROUP}:{c}:{secrets.token_hex(6)}", "payload": said}
        actions.record(to, c, [event], wait=True)
    got = _members(to)
    missed = [c for c in moving if c not in got]
    if missed:
        raise GroupError(f"ag did not take the move of {', '.join(missed)}; nothing else changed")
    _rows(gatherer, to, moving, folder, into)
    return {"actors": moving, "from": gatherer, "to": to}


def _rows(gatherer: str, to: str, moving: List[str], folder: Optional[int], into: Optional[int]) -> None:
    """The dashboard's own rows of the moved actors (and of the folder, with every folder in it) moved to `to`'s name,
    in one transaction."""
    under = _under(_tree(gatherer), int(folder)) if folder is not None else []
    filed = _tree(gatherer)["filed"]
    marks = ", ".join("?" * len(moving))
    conn = folders._write()
    try:
        conn.execute("BEGIN IMMEDIATE")
        if moving and folders._has(conn, "sessions"):
            conn.execute(f"UPDATE sessions SET gatherer = ? WHERE gatherer = ? AND session_id IN ({marks})",
                         (to, gatherer, *moving))
        if moving:
            for table in ACTOR_TABLES:
                if folders._has(conn, table):
                    conn.execute(f"UPDATE {table} SET gatherer = ? WHERE gatherer = ? AND channel IN ({marks})",
                                 (to, gatherer, *moving))
            if folders._has(conn, "tasks"):
                conn.execute(f"UPDATE tasks SET gatherer = ? WHERE id IN (SELECT task FROM tasked WHERE gatherer = ? "
                             f"AND channel IN ({marks}))", (to, to, *moving))
        if under:
            ids = ", ".join("?" * len(under))
            conn.execute(f"UPDATE folders SET gatherer = ? WHERE id IN ({ids})", (to, *under))
            conn.execute("UPDATE folders SET parent = ? WHERE id = ?", (into, int(folder)))
        loose = [c for c in moving if filed.get(c) not in under]               # moved by themselves: into `into`
        for c in moving:
            if c in loose:
                conn.execute("DELETE FROM filed WHERE gatherer = ? AND channel = ?", (gatherer, c))
                if into is not None:
                    conn.execute("INSERT OR REPLACE INTO filed (gatherer, channel, folder, at) VALUES (?, ?, ?, ?)",
                                 (to, c, int(into), folders._now()))
            else:
                conn.execute("UPDATE filed SET gatherer = ? WHERE gatherer = ? AND channel = ?", (to, gatherer, c))
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
