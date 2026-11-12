"""The folders the reader keeps a gatherer's actors in: the list's tree, the gatherer its top. Kept in the dashboard's
own database (<home>/dashboard.db, beside saved.py's and hiding.py's tables), so every dashboard on this home shows the
same ones. Folders only organise the list: what a gatherer's actors share of one another's context is the gatherer's,
whatever folder each is in, and an actor never leaves its gatherer.

Table `folders`, one row per folder, kept until it is deleted, empty or not:

    id          its number (never used again)
    gatherer    the gatherer it is in
    parent      the folder it is in; NULL: the gatherer's top level
    name        unique among the folders beside it, whatever its case; never holding "/", which joins a folder's
                name to those it is in into its PATH (`Harnesses/Codex`), as `ag actors` names a folder
    at          when it was made (ISO, UTC)
    closed      when it was CLOSED (ISO, UTC; NULL: open) -- by `close`, with every folder in it, at once

Table `filed`, one row per actor in a folder (none: at its gatherer's top level):

    gatherer, channel   the actor, by the channel it was filed as: its own, or the id the dashboard started it under
                        (a Codex session's, before its thread's id comes with its first turn) -- the page and
                        `ag actors` find it by either, as they find saved.py's bookmark
    folder              the folder's id
    at                  when it was put there

Saving an actor (saved.py's bookmark) is apart from this: saved or not, an actor is in its folder; a saved one, once
closed, is listed in its folder's "saved" line, not with the closed ones. A folder deleted, what was in it -- actors
and folders -- moves up into the one it was in.

A folder CLOSED (`close`): every actor in it, at any depth, closed as the list's x closes one (sessions.py's `stop`; one
that never started, discarded), its bookmark taken off (saved.py), every terminal opened in it ended -- then it, and every
folder in it, marked closed. The list shows a closed folder in its parent's "closed" line, with its actors, for as long as
nothing in it is open again (an actor in it used since, a terminal opened in it). Reopened (`reopen`), it and the folders
in it are open again, its actors as they are. Putting an actor or a folder in a closed folder, or making one there,
reopens it, and the closed folders it is in.

THE FOLDERS OF SAVED ACTORS that saved.py kept before this module (table `saved_folders`, column `saved.folder`) are
copied here once, when this module first makes its tables: each one a folder at its gatherer's top level, each saved
actor in one filed in it (and still saved). saved.py's are left as they were, no longer read.

IN THE HOME'S ONE DATABASE (home.py's `merged`: `ag home merge`'s), where a gatherer is a GROUP of its channels, the
tree is kept there instead, as records ag reads and never shows an agent (the Notes design "Groups: design", section 3):

    folder      no channel's: {id, group, parent, name, at, closed} -- the folder as it is now, in the group `group`;
                {id, gone: true}, deleted. The latest of an id wins.
    group       in each actor's channel (the one it is filed as): {group, was, folder} -- `folder` its folder's id, none
                at its group's top. One that only files it has `was` its `group`: no move, nothing rebuilt
                (groups.py's are the moves).

A change is made as in dashboard.db -- on a copy of the tree in memory, by the same code -- and what it changed put in
by ag at once (actions.py's `insert`): a FolderError, and nothing kept, if ag did not take it. dashboard.db's folders
are copied in once, at the first read or change there (`_copy_in`); its tables are left as they were, no longer read."""

import json
import os
import secrets
import sqlite3
import sys
import time
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional

from . import actions, saved, sessions

FOLDER_CHARS = 60               # the longest name a folder takes
TOP = ("", "/", "top")          # what names the gatherer's top level, where a folder is asked for by path

SCHEMA = (
    """CREATE TABLE IF NOT EXISTS folders (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    gatherer TEXT NOT NULL,
    parent   INTEGER,
    name     TEXT NOT NULL,
    at       TEXT NOT NULL,
    closed   TEXT
)""",
    "CREATE UNIQUE INDEX IF NOT EXISTS folders_named ON folders (gatherer, ifnull(parent, 0), name COLLATE NOCASE)",
    """CREATE TABLE IF NOT EXISTS filed (
    gatherer TEXT NOT NULL,
    channel  TEXT NOT NULL,
    folder   INTEGER NOT NULL,
    at       TEXT NOT NULL,
    PRIMARY KEY (gatherer, channel)
)""",
)


class FolderError(ValueError):
    """A folder that cannot be made, named, moved or found as asked: its text says why."""


def folder_name(text) -> str:
    """A folder's name as given, its spaces made one and its ends trimmed; FolderError for none, or one with "/"."""
    name = " ".join(str(text or "").split())[:FOLDER_CHARS].strip()
    if not name:
        raise FolderError("which folder? Give it a name")
    if "/" in name:
        raise FolderError(f'"{name}": a folder\'s name can\'t hold "/" (it joins the names of folders in folders)')
    return name


def _now() -> str:
    """Now (ISO, UTC), by time.time(): the clock an actor's activity is told by, which a folder's `closed` is compared with."""
    return datetime.fromtimestamp(time.time(), timezone.utc).isoformat()


def _has(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone() is not None


def _from_saved(conn: sqlite3.Connection) -> None:
    """saved.py's folders of saved actors copied in (module doc): each at its gatherer's top, its actors filed in it."""
    if not _has(conn, "saved_folders"):
        return
    made: Dict[tuple, int] = {}
    for g, name, at in conn.execute("SELECT gatherer, name, at FROM saved_folders ORDER BY gatherer, at").fetchall():
        clean = " ".join(str(name).replace("/", "-").split())[:FOLDER_CHARS] or "Folder"
        if (g, clean.lower()) in made:
            continue
        cur = conn.execute("INSERT INTO folders (gatherer, parent, name, at) VALUES (?, NULL, ?, ?)", (g, clean, at))
        made[(g, clean.lower())] = made[(g, str(name).lower())] = cur.lastrowid
    if made and _has(conn, "saved") and "folder" in [r[1] for r in conn.execute("PRAGMA table_info(saved)")]:
        for g, c, f, at in conn.execute("SELECT gatherer, channel, folder, at FROM saved WHERE folder IS NOT NULL").fetchall():
            fid = made.get((g, str(f).lower()))
            if fid is not None:
                conn.execute("INSERT OR IGNORE INTO filed (gatherer, channel, folder, at) VALUES (?, ?, ?, ?)", (g, c, fid, at))


def _with_closed(conn: sqlite3.Connection) -> None:
    """Table `folders` as made before `closed`: given it (every folder open)."""
    if "closed" in [r[1] for r in conn.execute("PRAGMA table_info(folders)")]:
        return
    try:
        conn.execute("ALTER TABLE folders ADD COLUMN closed TEXT")
    except sqlite3.OperationalError:                    # another gave it meanwhile
        if "closed" not in [r[1] for r in conn.execute("PRAGMA table_info(folders)")]:
            raise


FOLDER, GROUP = "folder", "group"
COPIED = "folders_in_home"      # dashboard.db's: when its folders were copied into the home's one database
_copied: set = set()            # the dashboard.db paths whose folders are copied in, as seen by this process


def _in_home() -> bool:
    return sessions.home.merged()


def _payload(raw) -> Optional[dict]:
    try:
        got = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return None
    return got if isinstance(got, dict) else None


def _records() -> tuple:
    """Of the home's one database: ({id: {id, group, parent, name, at, closed}} the folders there are, {channel: (group,
    folder id or None)} each one's latest `group` record's, the highest folder id ever kept, gone or not)."""
    kept: Dict[int, dict] = {}
    placed: Dict[str, tuple] = {}
    top = 0
    path = sessions.home.home_db()
    if not os.path.exists(path):
        return kept, placed, top
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=8)
    try:
        for kind in (FOLDER, GROUP):
            for ch, raw in conn.execute("SELECT e.p_channel, e.payload_json FROM events e JOIN event_types t "
                                        "ON t.event_type_id = e.event_type_id WHERE t.name = ? ORDER BY e.row_id", (kind,)):
                p = _payload(raw)
                if p is None:
                    continue
                if kind == FOLDER and ch is None and isinstance(p.get("id"), int):
                    top = max(top, p["id"])
                    if p.get("gone"):
                        kept.pop(p["id"], None)
                    else:
                        kept[p["id"]] = {k: p.get(k) for k in ("id", "group", "parent", "name", "at", "closed")}
                elif kind == GROUP and ch is not None:
                    folder = p.get("folder")
                    placed[ch] = (str(p.get("group") or ""), folder if isinstance(folder, int) else None)
    except sqlite3.OperationalError:                    # no events yet, or no channel's column
        pass
    finally:
        conn.close()
    return kept, placed, top


def _filed(kept: Dict[int, dict], placed: Dict[str, tuple]) -> List[tuple]:
    """(group, channel, folder id) of each actor in a folder of its own group."""
    return [(g, ch, f) for ch, (g, f) in placed.items() if f in kept and kept[f]["group"] == g]


def _stored_in_home() -> Dict[str, dict]:
    _copy_in()
    kept, placed, _ = _records()
    found: Dict[str, dict] = {}
    for f in sorted(kept.values(), key=lambda f: (str(f["group"]), str(f["name"]).lower(), str(f["name"]))):
        found.setdefault(str(f["group"]), {"folders": [], "filed": {}})["folders"].append(
            {"id": f["id"], "parent": f["parent"], "name": f["name"], "closed": f["closed"]})
    for g, ch, f in _filed(kept, placed):
        found.setdefault(g, {"folders": [], "filed": {}})["filed"][ch] = f
    return found


def _tree(conn: sqlite3.Connection) -> tuple:
    """({id: (group, parent, name, at, closed)}, {(group, channel): folder id}) as `conn` has them."""
    return ({r[0]: tuple(r[1:]) for r in conn.execute("SELECT id, gatherer, parent, name, at, closed FROM folders")},
            {(g, c): f for g, c, f in conn.execute("SELECT gatherer, channel, folder FROM filed")})


def _put(gatherer: str, events: List[dict]) -> None:
    """`events` put in by ag (actions.py's `insert`); FolderError if it did not take them."""
    if not events:
        return
    try:
        actions.insert(gatherer, events)
    except (RuntimeError, OSError, ValueError) as exc:
        raise FolderError(f"not kept: {exc}") from None


def _folder_event(fid: int, row: Optional[tuple], tag: Optional[str] = None) -> dict:
    payload = ({"id": fid, "gone": True} if row is None else
               {"id": fid, "group": row[0], "parent": row[1], "name": row[2], "at": row[3], "closed": row[4]})
    return {"type": FOLDER, "id": f"{FOLDER}:{fid}:{tag or secrets.token_hex(6)}", "payload": payload}


def _group_event(group: str, channel: str, folder: Optional[int], tag: Optional[str] = None) -> dict:
    # its id names the channel: a read returns an id once, whatever its channel
    return {"type": GROUP, "id": f"{GROUP}:{channel}:{tag or secrets.token_hex(6)}", "properties": {"channel": channel},
            "payload": {"group": group, "was": group, "folder": folder}}


def _change_in_home(gatherer: str, do):
    """`do(conn)` on the home's tree, copied into memory, and what it changed put in by ag (module doc)."""
    _copy_in()
    kept, placed, top = _records()
    conn = sqlite3.connect(":memory:", isolation_level=None)
    try:
        for statement in SCHEMA:
            if not statement.lstrip().upper().startswith("CREATE UNIQUE INDEX"):   # names are checked by `_beside`
                conn.execute(statement)
        conn.executemany("INSERT INTO folders (id, gatherer, parent, name, at, closed) VALUES (?, ?, ?, ?, ?, ?)",
                         [(f["id"], str(f["group"]), f["parent"], str(f["name"]), f["at"] or _now(), f["closed"])
                          for f in kept.values()])
        conn.execute("DELETE FROM sqlite_sequence WHERE name = 'folders'")               # an id is never used again
        conn.execute("INSERT INTO sqlite_sequence (name, seq) VALUES ('folders', ?)", (max([top, *kept]),))
        conn.executemany("INSERT INTO filed (gatherer, channel, folder, at) VALUES (?, ?, ?, '')",
                         _filed(kept, placed))
        before = _tree(conn)
        conn.execute("BEGIN")
        got = do(conn)
        conn.execute("COMMIT")
        after = _tree(conn)
    finally:
        conn.close()
    events = [_folder_event(fid, after[0].get(fid)) for fid in sorted(set(before[0]) | set(after[0]))
              if before[0].get(fid) != after[0].get(fid)]
    events += [_group_event(g, c, after[1].get((g, c))) for g, c in sorted(set(before[1]) | set(after[1]))
               if before[1].get((g, c)) != after[1].get((g, c))]
    _put(gatherer, events)
    return got


def _copy_in() -> None:
    """dashboard.db's folders and filed actors copied into the home's one database as records, once (module doc). An
    actor whose channel has a folder there already, or is in another group there now, is left as the records have it.
    Each record's id is the copy's, so a copy made twice keeps nothing new."""
    if sessions.db_path() in _copied or not os.path.exists(sessions.db_path()):
        return
    conn = _write()
    try:
        if _has(conn, COPIED):
            _copied.add(sessions.db_path())
            return
        rows = conn.execute("SELECT id, gatherer, parent, name, at, closed FROM folders").fetchall()
        filed = conn.execute("SELECT gatherer, channel, folder FROM filed").fetchall()
    finally:
        conn.close()
    kept, placed, _ = _records()
    by: Dict[str, List[dict]] = {}
    for fid, g, parent, name, at, closed in rows:
        if fid not in kept:
            by.setdefault(g, []).append(_folder_event(fid, (g, parent, name, at, closed), tag="copied"))
    known = {r[0] for r in rows}
    for g, ch, fid in filed:
        now, there = placed.get(ch, (g, None))
        if fid in known and now == g and there is None:
            by.setdefault(g, []).append(_group_event(g, ch, fid, tag="folder-copied"))
    for g, events in by.items():
        _put(g, events)
    conn = _write()
    try:
        conn.execute(f"CREATE TABLE IF NOT EXISTS {COPIED} (at TEXT NOT NULL)")
        conn.execute(f"INSERT INTO {COPIED} (at) VALUES (?)", (_now(),))
    finally:
        conn.close()
    _copied.add(sessions.db_path())


def _write() -> sqlite3.Connection:
    """The dashboard's database, for a change: this module's tables made the first time, saved.py's folders copied in."""
    os.makedirs(os.path.dirname(sessions.db_path()), exist_ok=True)
    conn = sqlite3.connect(sessions.db_path(), timeout=8, isolation_level=None)
    if _has(conn, "folders"):
        try:
            _with_closed(conn)
        except BaseException:
            conn.close()
            raise
        return conn
    try:
        conn.execute("BEGIN IMMEDIATE")
        if not _has(conn, "folders"):                   # another made them meanwhile
            for statement in SCHEMA:
                conn.execute(statement)
            _from_saved(conn)
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        conn.close()
        raise
    return conn


def ensure() -> None:
    """The tables made, and saved.py's folders copied in, if not yet: at the dashboard's start -- and, in the home's one
    database, dashboard.db's copied there (`_copy_in`)."""
    _write().close()
    if _in_home():
        try:
            _copy_in()
        except (FolderError, sqlite3.Error) as exc:     # tried again at the first read
            print(f"dashboard: folders not copied into the home's database yet: {exc}", file=sys.stderr, flush=True)


def stored() -> Dict[str, dict]:
    """{gatherer: {folders: [{id, parent, name, closed}] (by name, whatever its case), filed: {channel: folder id}}}, of
    every gatherer with a folder: {} when there is none yet. In the home's one database, its records' (module doc)."""
    if _in_home():
        try:
            return _stored_in_home()
        except (FolderError, sqlite3.Error) as exc:
            print(f"dashboard: folders not read: {exc}", file=sys.stderr, flush=True)
            return {}
    if not os.path.exists(sessions.db_path()):
        return {}
    conn = sqlite3.connect(f"file:{sessions.db_path()}?mode=ro", uri=True, timeout=8)
    try:
        if not _has(conn, "folders"):
            conn.close()
            ensure()                                    # made, and saved.py's copied, at the first read
            conn = sqlite3.connect(f"file:{sessions.db_path()}?mode=ro", uri=True, timeout=8)
        found: Dict[str, dict] = {}
        closed = "closed" if "closed" in [r[1] for r in conn.execute("PRAGMA table_info(folders)")] else "NULL"   # before `closed`
        for fid, g, parent, name, shut in conn.execute(f"SELECT id, gatherer, parent, name, {closed} FROM folders "
                                                       "ORDER BY gatherer, lower(name), name"):
            found.setdefault(g, {"folders": [], "filed": {}})["folders"].append({"id": fid, "parent": parent, "name": name, "closed": shut})
        for g, c, fid in conn.execute("SELECT gatherer, channel, folder FROM filed ORDER BY at"):
            found.setdefault(g, {"folders": [], "filed": {}})["filed"][c] = fid
        return found
    except sqlite3.Error:
        return {}
    finally:
        conn.close()


def of(gatherer: str) -> dict:
    """`stored()` of one gatherer: {folders, filed}, both empty for a gatherer with none."""
    return stored().get(gatherer) or {"folders": [], "filed": {}}


# ---- changes: each in one transaction, its gatherer's folders after

def _change(gatherer: str, do) -> sqlite3.Connection:
    """`do(conn)` in a transaction of its own (BEGIN IMMEDIATE), rolled back if it raises."""
    if not gatherer:
        raise FolderError("which gatherer?")
    if _in_home():
        return _change_in_home(gatherer, do)
    conn = _write()
    try:
        conn.execute("BEGIN IMMEDIATE")
        got = do(conn)
        conn.execute("COMMIT")
        return got
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


def _folder(conn: sqlite3.Connection, gatherer: str, fid) -> tuple:
    """(id, parent, name) of the folder `fid` of `gatherer`; FolderError for none."""
    try:
        fid = int(fid)
    except (TypeError, ValueError):
        raise FolderError(f"which folder? {fid!r} is none") from None
    row = conn.execute("SELECT id, parent, name FROM folders WHERE id = ? AND gatherer = ?", (fid, gatherer)).fetchone()
    if row is None:
        raise FolderError(f"no folder {fid} in {gatherer}")
    return row


def _beside(conn: sqlite3.Connection, gatherer: str, parent: Optional[int], name: str, but: Optional[int] = None) -> Optional[str]:
    """The name of a folder in `parent` (None: the top) already named `name`, whatever its case, but `but`."""
    row = conn.execute("SELECT name FROM folders WHERE gatherer = ? AND ifnull(parent, 0) = ? AND name = ? COLLATE NOCASE "
                       "AND id != ?", (gatherer, parent or 0, name, but or 0)).fetchone()
    return row[0] if row else None


def _opened(conn: sqlite3.Connection, fid: Optional[int]) -> None:
    """The folder `fid`, something put in it, open -- and the folders it is in (module doc); None: the top."""
    seen = set()
    while fid is not None and fid not in seen:
        seen.add(fid)
        conn.execute("UPDATE folders SET closed = NULL WHERE id = ? AND closed IS NOT NULL", (fid,))
        row = conn.execute("SELECT parent FROM folders WHERE id = ?", (fid,)).fetchone()
        fid = row[0] if row else None


def _inside(conn: sqlite3.Connection, fid: int) -> List[int]:
    """The folder `fid` and every folder in it, at any depth: their ids."""
    out, todo = [], [int(fid)]
    while todo:
        f = todo.pop()
        if f in out:
            continue
        out.append(f)
        todo.extend(r[0] for r in conn.execute("SELECT id FROM folders WHERE parent = ?", (f,)))
    return out


def make(gatherer: str, name: str, parent: Optional[int] = None) -> int:
    """A new folder, empty, in `parent` (None: the gatherer's top) -> its id. FolderError for no such parent, or one
    beside it already named so."""
    name = folder_name(name)

    def do(conn):
        if parent is not None:
            _folder(conn, gatherer, parent)
            _opened(conn, int(parent))
        other = _beside(conn, gatherer, parent, name)
        if other is not None:
            raise FolderError(f'there is a folder "{other}" there already')
        return conn.execute("INSERT INTO folders (gatherer, parent, name, at) VALUES (?, ?, ?, ?)",
                            (gatherer, parent, name, _now())).lastrowid
    return _change(gatherer, do)


def rename(gatherer: str, fid: int, to: str) -> None:
    """The folder named `to`, what is in it still in it. FolderError for no such folder, or one beside it named so."""
    to = folder_name(to)

    def do(conn):
        _, parent, _ = _folder(conn, gatherer, fid)
        other = _beside(conn, gatherer, parent, to, but=int(fid))
        if other is not None:
            raise FolderError(f'there is a folder "{other}" there already')
        conn.execute("UPDATE folders SET name = ? WHERE id = ?", (to, int(fid)))
    _change(gatherer, do)


def move(gatherer: str, fid: int, parent: Optional[int]) -> None:
    """The folder, and all in it, put in `parent` (None: the gatherer's top). FolderError for no such folder, a folder
    put in itself or in one of its own, or one there named as it is."""
    def do(conn):
        _, _, name = _folder(conn, gatherer, fid)
        if parent is not None:
            up = _folder(conn, gatherer, parent)[0]
            while up is not None:                       # its own folders, up to the top
                if up == int(fid):
                    raise FolderError(f'"{name}" can\'t go in itself, nor in a folder of its own')
                up = conn.execute("SELECT parent FROM folders WHERE id = ?", (up,)).fetchone()[0]
        other = _beside(conn, gatherer, parent, name, but=int(fid))
        if other is not None:
            raise FolderError(f'there is a folder "{other}" there already')
        conn.execute("UPDATE folders SET parent = ? WHERE id = ?", (parent, int(fid)))
        _opened(conn, None if parent is None else int(parent))
    _change(gatherer, do)


def delete(gatherer: str, fid: int) -> None:
    """The folder gone, what was in it -- its actors, its folders -- moved up into the one it was in (module doc). A
    folder moved up next to one of its name keeps its own, with " 2" (" 3", ...) after it."""
    def do(conn):
        _, parent, _ = _folder(conn, gatherer, fid)
        for cid, cname in conn.execute("SELECT id, name FROM folders WHERE parent = ?", (int(fid),)).fetchall():
            name, n = cname, 1
            while _beside(conn, gatherer, parent, name, but=cid) is not None:
                n += 1
                name = f"{cname} {n}"
            conn.execute("UPDATE folders SET parent = ?, name = ? WHERE id = ?", (parent, name, cid))
        if parent is None:
            conn.execute("DELETE FROM filed WHERE folder = ?", (int(fid),))
        else:
            conn.execute("UPDATE filed SET folder = ? WHERE folder = ?", (parent, int(fid)))
        conn.execute("DELETE FROM folders WHERE id = ?", (int(fid),))
    _change(gatherer, do)


def file(gatherer: str, channels: Iterable[str], folder: Optional[int]) -> None:
    """The actors (by the channels they are filed as, or would be) put in `folder` (None: the gatherer's top).
    FolderError for no such folder."""
    channels = [c for c in dict.fromkeys(str(c or "").strip() for c in channels) if c]
    if not channels:
        raise FolderError("which actors?")

    def do(conn):
        if folder is None:
            conn.executemany("DELETE FROM filed WHERE gatherer = ? AND channel = ?", [(gatherer, c) for c in channels])
            return
        fid = _folder(conn, gatherer, folder)[0]
        at = _now()
        conn.executemany("INSERT INTO filed (gatherer, channel, folder, at) VALUES (?, ?, ?, ?) "
                         "ON CONFLICT (gatherer, channel) DO UPDATE SET folder = excluded.folder, at = excluded.at",
                         [(gatherer, c, fid, at) for c in channels])
        _opened(conn, fid)
    _change(gatherer, do)


def mark(gatherer: str, fid: int, closed: bool) -> List[int]:
    """The folder and every folder in it marked closed now (`closed`) or open -> their ids. FolderError for no such
    folder. Its actors are `close`'s."""
    def do(conn):
        _folder(conn, gatherer, fid)
        ids, at = _inside(conn, fid), _now() if closed else None
        conn.executemany("UPDATE folders SET closed = ? WHERE id = ?", [(at, i) for i in ids])
        return ids
    return _change(gatherer, do)


def reopen(gatherer: str, fid: int) -> None:
    """The folder open again, and the folders in it (module doc): its actors as they are."""
    mark(gatherer, fid, False)


def _within(tree: dict, ids: set, a: dict) -> Optional[str]:
    """The channel the actor `a` (data.home()'s) is filed as, if in one of the folders `ids` (its own, or the id the
    dashboard started it under, as the page finds it); None: in none of them."""
    filed, s = tree.get("filed") or {}, a.get("session") or {}
    at = a["channel"] if a["channel"] in filed else s.get("started_as") if s.get("started_as") in filed else None
    return at if at is not None and filed[at] in ids else None


def close(gatherer: str, fid: int, started: "sessions.Sessions", home: dict) -> List[dict]:
    """The folder CLOSED (module doc): every actor in it, at any depth -- as `home` (data.home()'s, read now) has them --
    closed, its bookmark taken off, every terminal opened in it ended; then it, and every folder in it, marked closed.
    -> the actors in it left open, each {channel, why}: one no process of the dashboard's runs for (a terminal outside
    it has it, say), or one whose end failed. FolderError for no such folder."""
    from . import data                                  # here: data.py imports this module
    tree = of(gatherer)
    try:
        want = int(fid)
    except (TypeError, ValueError):
        raise FolderError(f"which folder? {fid!r} is none") from None
    if not any(f["id"] == want for f in tree["folders"]):
        raise FolderError(f"no folder {fid} in {gatherer}")
    ids = {want}
    while True:                                        # every folder in it, at any depth
        more = {f["id"] for f in tree["folders"] if f["parent"] in ids} - ids
        if not more:
            break
        ids |= more
    g = next((x for x in home.get("gatherers") or [] if x.get("name") == gatherer), {"agents": []})
    kept, left = saved.stored().get(gatherer) or {}, []
    for a in g.get("agents") or []:
        if a.get("role") == "coordinator" or _within(tree, ids, a) is None:
            continue
        s = a.get("session") or {}
        for key in {a["channel"], s.get("started_as")} & set(kept):
            saved.choose(gatherer, key, False)          # its bookmark off: closed, it goes with the closed ones
        if a.get("status") == data.CLOSED:
            continue
        sid = s.get("session_id")
        try:
            if sid and (s.get("terminal") or s.get("pid") or s.get("kept")):
                started.stop(sid)
            elif sid and not a.get("events") and not a.get("reads"):
                started.discard(sid)                    # never started: nothing of it kept, as the list's x does
            else:
                left.append({"channel": a["channel"], "why": "no process of the dashboard's runs for it"})
        except sessions.SessionError as err:
            left.append({"channel": a["channel"], "why": str(err)})
    for key in [c for c, f in (tree.get("filed") or {}).items() if f in ids and c in kept]:
        saved.choose(gatherer, key, False)              # saved, not in the home now: off too
    for sh in started.shells():
        if sh.get("gatherer") == gatherer and sh.get("folder") in ids:
            try:
                started.close_shell(sh["id"])
            except sessions.SessionError:
                pass                                    # ended meanwhile
    mark(gatherer, want, True)
    return left


# ---- folders by path, as `ag actors` names them

def path(tree: dict, fid: Optional[int]) -> Optional[str]:
    """The folder `fid`'s path in `of()`'s `tree` (`Harnesses/Codex`); None for none, or no such folder."""
    by = {f["id"]: f for f in tree.get("folders") or []}
    names, seen = [], set()
    while fid in by and fid not in seen:
        seen.add(fid)
        names.append(by[fid]["name"])
        fid = by[fid]["parent"]
    return "/".join(reversed(names)) or None


def _parts(text: str) -> List[str]:
    return [folder_name(p) for p in str(text or "").strip().strip("/").split("/")]


def find(gatherer: str, where: str) -> Optional[int]:
    """The folder of `gatherer` at the path `where` (its names, whatever their case), None for the top (TOP); FolderError
    for no such folder."""
    if str(where or "").strip().lower() in TOP:
        return None
    tree, parent = of(gatherer), None
    for part in _parts(where):
        hit = next((f for f in tree["folders"] if f["parent"] == parent and f["name"].lower() == part.lower()), None)
        if hit is None:
            raise FolderError(f'no folder "{where.strip().strip("/")}" in {gatherer}')
        parent = hit["id"]
    return parent


def find_or_make(gatherer: str, where: str) -> Optional[int]:
    """`find`, the folders of the path that are not there made: the folder's id (None: the top)."""
    if str(where or "").strip().lower() in TOP:
        return None
    parent = None
    for part in _parts(where):
        tree = of(gatherer)
        hit = next((f for f in tree["folders"] if f["parent"] == parent and f["name"].lower() == part.lower()), None)
        parent = hit["id"] if hit else make(gatherer, part, parent)
    return parent
