"""Every gatherer's database made one, the home's (`paths.home_db`): `ag home merge`.

Once `<home>/context.db` exists every gatherer's database is that one (`paths.merged`), and a gatherer is the group of
its conversations: those whose latest `group` record names it. This makes that file, once, from the gatherers' own:

    1. The largest gatherer's file, copied whole (SQLite's backup): its rows keep their row ids, so the `[id N]` its
       sessions were shown stay right.
    2. Each other gatherer's appended to it, its row ids moved past the rows before (`offset`): its events (their
       types matched by name, a type or property it lacks added) and the events its harness took back (`_withdrawn`),
       so they stay taken back; and the policy's own tables, by the policy (`append`: Policy.append), their row ids
       moved the same way. Not its read log: each session takes up its latest build again at its next call. Its
       records of no conversation (an app's, a poller's) name its group (`group` in their payload), so they reach
       its sessions alone.
    3. A `group` record for every conversation with none -- its gatherer's -- and the largest one's records of no
       conversation named for its group too.

A conversation is a combination of values of the gatherer's identifying properties (`schema.identifying_names`); this
module names none of them. The file is written beside the home as `context.db.part` and moved into place last,
checked, so the home is merged whole or not at all. Nothing of the gatherers' own files is changed: going back is
removing `<home>/context.db`, losing what was done after. It runs with nothing using the home (`busy`): no hook server,
no dashboard, no session's process -- what they wrote meanwhile would be in the old files only.
"""

import json
import os
import sqlite3
import time
from typing import Callable, Dict, List, Tuple
from urllib.request import pathname2url

from ag.ag_interface import EventType, Property

from . import operations as store
from . import paths, schema

GROUP = "group"
Key = Tuple                     # a conversation: its values of the identifying properties, in their order


class MergeError(Exception):
    """Why the home cannot be merged now."""


def gatherers() -> List[str]:
    """The gatherers with a database of their own, by name."""
    root = paths.TRACE_DIR
    if not os.path.isdir(root):
        return []
    return sorted(g for g in os.listdir(root) if os.path.isfile(os.path.join(root, g, "context.db")))


def own(gatherer: str) -> str:
    """The gatherer's own database file, whatever `paths.db_path` names."""
    return os.path.join(paths.gatherer_dir(gatherer), "context.db")


def _alive(pid) -> bool:
    try:
        os.kill(int(pid), 0)
    except (OSError, ValueError, TypeError):
        return False
    return True


def busy() -> List[str]:
    """What uses the home now, said for a person: a hook server, the dashboard, a session's process (its claim)."""
    home = os.path.dirname(paths.TRACE_DIR)
    out = []
    folder = os.path.join(home, "hook_server")
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        try:
            with open(os.path.join(folder, name), encoding="utf-8") as fh:
                pid = json.load(fh).get("pid")
        except (OSError, ValueError, AttributeError):
            continue
        if _alive(pid):
            out.append(f"a hook server (pid {pid})")
    try:
        with open(os.path.join(home, "dashboard", "address.json"), encoding="utf-8") as fh:
            pid = json.load(fh).get("pid")
        if _alive(pid):
            out.append(f"the dashboard (pid {pid})")
    except (OSError, ValueError, AttributeError):
        pass
    for g in gatherers():
        conn = _read_only(own(g))
        try:
            held = conn.execute("SELECT session, pid FROM _open").fetchall() if "_open" in _tables(conn) else []
        finally:
            conn.close()
        out += [f"session {s} of {g} (pid {pid})" for s, pid in held if _alive(pid)]
    return out


def _read_only(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{pathname2url(path)}?mode=ro", uri=True, timeout=8)


def _tables(conn, db: str = "main") -> set:
    return {r[0] for r in conn.execute(f"SELECT name FROM {db}.sqlite_master WHERE type = 'table'")}


def _columns(conn, table: str, db: str = "main") -> List[str]:
    return [r[1] for r in conn.execute(f"PRAGMA {db}.table_info({table})")]


def _identity(conn) -> List[str]:
    """The identifying properties' columns."""
    return [schema.PREFIX + n for n in schema.identifying_names(conn)]


def _conversations(conn, cols: List[str], db: str = "main") -> List[Key]:
    if not cols:
        return []
    return [tuple(r) for r in conn.execute(f"SELECT DISTINCT {', '.join(cols)} FROM {db}.events "
                                           f"WHERE {' OR '.join(f'{c} IS NOT NULL' for c in cols)}")]


def plan() -> dict:
    """What a merge would do: {target, others, sizes (bytes), events and conversations of each}."""
    names = gatherers()
    if not names:
        raise MergeError("no gatherer has a database")
    sizes = {g: os.path.getsize(own(g)) for g in names}
    events, conversations = {}, {}
    for g in names:
        conn = _read_only(own(g))
        try:
            events[g] = conn.execute("SELECT count(*) FROM events").fetchone()[0]
            conversations[g] = len(_conversations(conn, _identity(conn)))
        finally:
            conn.close()
    target = max(names, key=lambda g: (sizes[g], events[g], g))      # pages round sizes: then the events
    return {"target": target, "others": [g for g in names if g != target], "sizes": sizes, "events": events,
            "conversations": conversations}


def merge(append: Callable[[str, sqlite3.Connection, str, int], None] = lambda gatherer, conn, db, offset: None,
          say: Callable[[str], None] = print) -> dict:
    """The home's one database made from every gatherer's (module doc): {target, others, copied: {gatherer: events},
    skipped: {gatherer: events already there}, grouped: conversations given a record}. `append(gatherer, conn, db,
    offset)`: the gatherer's policy's own tables copied from the attached `db` (Policy.append). MergeError: merged
    already, nothing to merge, or the home in use."""
    home = paths.home_db()
    if os.path.exists(home):
        raise MergeError(f"the home has one database already: {home}")
    p = plan()
    using = busy()
    if using:
        raise MergeError("the home is in use; stop these first (`ag stop`, and the dashboard): " + "; ".join(using))
    part = home + ".part"
    _remove(part)
    target = p["target"]
    say(f"copying {target} ({p['events'][target]} events)")
    source = _read_only(own(target))
    conn = sqlite3.connect(part, timeout=8)
    try:
        source.backup(conn)
    finally:
        source.close()
    copied, skipped = {target: p["events"][target]}, {target: 0}
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        owners = {k: target for k in _conversations(conn, _identity(conn))}
        for g in p["others"]:
            say(f"appending {g} ({p['events'][g]} events)")
            n, gone, theirs = _append(conn, g, append)
            copied[g], skipped[g] = n, gone
            owners.update((k, g) for k in theirs if k not in owners)
        grouped = _group(conn, owners, target)
        bad = conn.execute("PRAGMA quick_check").fetchone()[0]
        if bad != "ok":
            raise MergeError(f"the merged file failed its check: {bad}")
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except BaseException:
        conn.close()
        _remove(part)
        raise
    conn.close()
    os.replace(part, home)
    say(f"the home's one database: {home}")
    return {"target": target, "others": p["others"], "copied": copied, "skipped": skipped, "grouped": grouped}


def _remove(path: str) -> None:
    for leftover in (path, path + "-wal", path + "-shm", path + "-journal"):
        if os.path.exists(leftover):
            os.remove(leftover)


def _append(conn, gatherer: str, append) -> Tuple[int, int, List[Key]]:
    """`gatherer`'s file appended (module doc, 2): (events stored, events already there -- the same event id of the
    same conversation -- and its conversations)."""
    src = _read_only(own(gatherer))
    try:
        types, ident = store.event_types(src), _identity(src)
    finally:
        src.close()
    conn.execute("ATTACH DATABASE ? AS src", (f"file:{pathname2url(own(gatherer))}?mode=ro",))
    try:
        offset = conn.execute("SELECT ifnull(max(row_id), 0) FROM events").fetchone()[0]
        mapped = {t.id: store.register_type(conn, EventType(t.name, t.properties)) for t in types}
        mine = _columns(conn, "events")
        for col in _columns(conn, "events", "src"):
            if col.startswith(schema.PREFIX) and col not in mine:   # a property no type of the home declares yet
                conn.execute(f'ALTER TABLE events ADD COLUMN "{col}"')
                mine.append(col)
        conn.execute("CREATE TEMP TABLE IF NOT EXISTS type_map (old INTEGER PRIMARY KEY, new INTEGER)")
        conn.execute("DELETE FROM type_map")
        conn.executemany("INSERT INTO type_map VALUES (?, ?)", mapped.items())
        theirs = _columns(conn, "events", "src")
        props = [c for c in theirs if c.startswith(schema.PREFIX)]
        plain = [c for c in ("inserted_at", "event_id", "tokens", "text", "counted") if c in theirs]
        nobody = " AND ".join(f"s.{c} IS NULL" for c in ident) or "1"           # a record of no conversation
        payload = (f"CASE WHEN {nobody} AND json_valid(s.payload_json) AND json_type(s.payload_json) = 'object' "
                   "THEN json_set(s.payload_json, '$.group', ?) ELSE s.payload_json END")
        names = ["row_id", "event_type_id", "payload_json", *plain, *props]
        values = ["s.row_id + ?", "m.new", payload, *(f"s.{c}" for c in plain), *(f"s.{c}" for c in props)]
        before = conn.execute("SELECT count(*) FROM events").fetchone()[0]
        with conn:
            conn.execute(f"INSERT OR IGNORE INTO events ({', '.join(names)}) SELECT {', '.join(values)} FROM src.events s "
                         f"JOIN type_map m ON m.old = s.event_type_id ORDER BY s.row_id", (offset, gatherer))
            stored = conn.execute("SELECT count(*) FROM events").fetchone()[0] - before
            total = conn.execute("SELECT count(*) FROM src.events").fetchone()[0]
            if "_withdrawn" in _tables(conn, "src"):
                conn.execute("INSERT OR IGNORE INTO _withdrawn (row_id, withdrawn_at) "
                             "SELECT row_id + ?, withdrawn_at FROM src._withdrawn", (offset,))
            append(gatherer, conn, "src", offset)
        return stored, total - stored, _conversations(conn, ident, "src")
    finally:
        conn.execute("DETACH DATABASE src")


def _group(conn, owners: Dict[Key, str], target: str) -> int:
    """A `group` record for every conversation with none, its gatherer's (`owners`); and the records of no conversation
    that name no group -- the largest gatherer's, the others' named as they were appended -- named for the largest
    one's group. How many conversations were given a record."""
    ident = _identity(conn)
    if not ident:
        return 0
    names = [c[len(schema.PREFIX):] for c in ident]
    type_id = store.register_type(conn, EventType(GROUP, tuple(Property(n) for n in names)))
    has = set(tuple(r) for r in conn.execute(f"SELECT DISTINCT {', '.join(ident)} FROM events WHERE event_type_id = ?",
                                             (type_id,)))
    now = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
    # each its own id, naming the conversation: a read returns an id once, where it was first stored, whatever else
    made = [(now, f"{GROUP}:{':'.join(str(v) for v in k)}:merge", type_id, json.dumps({"group": g}), 0, *k)
            for k, g in sorted(owners.items(), key=lambda kv: [str(v) for v in kv[0]]) if k not in has]
    nobody = " AND ".join(f"{c} IS NULL" for c in ident)
    with conn:
        conn.executemany(f"INSERT INTO events (inserted_at, event_id, event_type_id, payload_json, tokens, "
                         f"{', '.join(ident)}) VALUES ({', '.join('?' * (5 + len(ident)))})", made)
        conn.execute(f"UPDATE events SET payload_json = json_set(payload_json, '$.group', ?) WHERE {nobody} "
                     "AND json_valid(payload_json) AND json_type(payload_json) = 'object' "
                     "AND json_extract(payload_json, '$.group') IS NULL", (target,))
    return len(made)
