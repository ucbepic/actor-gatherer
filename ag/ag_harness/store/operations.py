"""Operations on the database schema.py defines.

    event types register_type (define one; get its id if defined), event_types, has_type
    properties  Spec, spec (what each type declares), property_values
    events      row_of, insert, insert_many, locate; Row, rows, read; high_water
    made items  make_item (each item once: made_sha), made_items
    read log    Ref, record_read, read_items, last_read, basis_opened
    counts      counted_rows, uncounted, record_counts
    polls       polled_at, mark_polled
    old tables  old_tables, mark_migrated

What the harness's hooks recorded besides the conversation before they recorded it as events (`_pending`,
`_recaps`, `_names`, `_touches`, `_reads.error`) is no longer kept: an older gatherer's is copied into records once
(`old_tables`, `mark_migrated`; the harness side's ag/integrations/tools/ag_orchestrator/migrate.py).

What a property means is not known here: an event carries the values its
type declares, each in its column, NULL when unset. Two filters read them
back (`rows`): `match`, what a read with those properties sees -- the value,
or unset -- and `differ`, set to anything else.
"""

import hashlib
import json
import os
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from ag.ag_interface import Event, EventType, Property, Tokenizer, property_column
from ag.ag_interface.event import PROPERTY_NAME
from ag.ag_interface.store import Ref, Row, event_text  # noqa: F401 - the interface's, used here too

from .schema import add_properties, identifying_names, index, property_names, stays, writing


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------- event types

def register_type(conn: sqlite3.Connection, event_type: EventType) -> int:
    """Define `event_type` for the gatherer and return its id. A name already
    defined keeps its id, and gains any property it did not declare yet. Each property declared gets its columns
    (`schema.add_properties`). Its own transactions.

    Raises:
        TypeError: `event_type` is not an EventType with a non-empty name,
            or a property of it is not a `Property` with a valid name.
    """
    if not isinstance(event_type, EventType) or not isinstance(event_type.name, str) or not event_type.name:
        raise TypeError(f"an event type must be an EventType with a name, not {event_type!r}")
    for p in event_type.properties:
        if not isinstance(p, Property) or not isinstance(p.name, str) or not PROPERTY_NAME.match(p.name):
            raise TypeError(f"event type {event_type.name!r}: a property must be a Property named with letters, "
                            f"digits and '_', not {p!r}")
    add_properties(conn, [p.name for p in event_type.properties])
    with conn:
        conn.execute("INSERT INTO event_types (name, created_at) VALUES (?, ?) ON CONFLICT (name) DO NOTHING",
                     (event_type.name, _now()))
        type_id = conn.execute("SELECT event_type_id FROM event_types WHERE name = ?",
                               (event_type.name,)).fetchone()[0]
        conn.executemany("INSERT INTO event_type_properties (event_type_id, name, required, identifies) "
                         "VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET identifies = "
                         "max(identifies, excluded.identifies)",        # declared identifying since: it is
                         [(type_id, p.name, int(bool(p.required)), int(bool(p.identifies)))
                          for p in event_type.properties])
        index(conn, property_names(conn))              # the identity, if this type changed it
    return type_id


def _declared(conn: sqlite3.Connection) -> Dict[int, Tuple[Property, ...]]:
    out: Dict[int, list] = {}
    for i, n, r, k in conn.execute("SELECT event_type_id, name, required, identifies FROM event_type_properties "
                                   "ORDER BY rowid"):
        out.setdefault(i, []).append(Property(n, bool(r), bool(k)))
    return {i: tuple(ps) for i, ps in out.items()}


def event_types(conn: sqlite3.Connection) -> List[EventType]:
    """Every type the gatherer has, in the order defined, each with its id and
    its properties."""
    declared = _declared(conn)
    return [EventType(n, declared.get(i, ()), id=i) for i, n in conn.execute(
        "SELECT event_type_id, name FROM event_types ORDER BY event_type_id")]


def has_type(conn: sqlite3.Connection, type_id: int) -> bool:
    return conn.execute("SELECT 1 FROM event_types WHERE event_type_id = ?", (type_id,)).fetchone() is not None


text = event_text


# ---------------------------------------------------------------- properties

@dataclass
class Spec:
    """The gatherer's properties, as an insert checks them: the columns there
    are, in order, and what each type declares. Loaded once (`spec`) and
    kept while no type is added."""
    names: List[str] = field(default_factory=list)
    types: Dict[int, Tuple[str, Dict[str, bool]]] = field(default_factory=dict)   # id -> (name, {property: required})
    identifying: List[str] = field(default_factory=list)   # those of `names` that are part of an event's identity


def spec(conn: sqlite3.Connection) -> Spec:
    declared = _declared(conn)
    return Spec(property_names(conn), {i: (n, {p.name: p.required for p in declared.get(i, ())})
                                       for i, n in conn.execute("SELECT event_type_id, name FROM event_types")},
                identifying_names(conn))


def _value(name: str, value: Any) -> Any:
    if value is not None and (isinstance(value, bool) or not isinstance(value, (str, int, float))):
        raise TypeError(f"property {name!r} must be a string or a number, not {value!r}")
    return value


def property_values(event: Event, spec: Spec) -> tuple:
    """The event's properties in `spec.names`' order (None: unset), checked
    against what its type declares.

    Raises:
        LookupError: its type is not in `spec`.
        ValueError: it lacks a property its type requires, or carries one
            its type does not declare.
        TypeError: its properties are not a dict of strings and numbers.
    """
    given = event.properties or {}
    if not isinstance(given, dict):
        raise TypeError(f"an event's properties must be a dict, not {given!r}")
    if event.type_id not in spec.types:
        raise LookupError(f"no event type with id {event.type_id!r} in this gatherer; "
                          f"define it with init or add_event_type first")
    type_name, declared = spec.types[event.type_id]
    for name, value in given.items():
        if _value(name, value) is not None and name not in declared:
            raise ValueError(f"event type {type_name!r} declares no property {name!r}"
                             f" (it declares {', '.join(declared) or 'none'})")
    for name, required in declared.items():
        if required and given.get(name) is None:
            raise ValueError(f"event type {type_name!r} requires the property {name!r}")
    return tuple(given.get(n) for n in spec.names)


def _given(conn: sqlite3.Connection, properties: Optional[Dict[str, Any]], what: str) -> tuple:
    """(the gatherer's property names, `properties`' values in their order), for
    a made item or a read. A property the gatherer has no column for may only be
    None."""
    names, given = property_names(conn), properties or {}
    for name, value in given.items():
        if _value(name, value) is not None and name not in names:
            raise ValueError(f"{what}: this gatherer has no property {name!r} (it has {', '.join(names) or 'none'})")
    return names, tuple(given.get(n) for n in names)


def _columns(names: List[str], alias: str = "") -> str:
    return "".join(f", {alias}{property_column(n)}" for n in names)


def _same(names: List[str], alias: str = "") -> str:
    """The SQL for "these properties are exactly these values (unset: '')",
    in the unique index's own terms, so it uses it; one ? per name."""
    return "".join(f"ifnull({alias}{property_column(n)}, '') = ? AND " for n in names)


def _unset_is_empty(values) -> list:
    return ["" if v is None else v for v in values]


def _filter(names: List[str], alias: str, match: Optional[Dict[str, Any]], differ: Optional[Dict[str, Any]],
            unset_matches: bool) -> tuple:
    """(SQL conditions, each ending in AND, params) for `match` and `differ`
    (the interface's GathererStore.rows). A property the gatherer has no column for
    is unset on every event."""
    parts, params = [], []
    for name, value in (match or {}).items():
        col = alias + property_column(name)
        if name not in names:
            parts.append("1" if value is None or unset_matches else "0")
        elif value is None:
            parts.append(f"{col} IS NULL")
        elif unset_matches:
            parts.append(f"({col} = ? OR {col} IS NULL)")
            params.append(value)
        else:
            parts.append(f"{col} = ?")
            params.append(value)
    for name, value in (differ or {}).items():
        col = alias + property_column(name)
        if name not in names:
            parts.append("0")
        else:
            parts.append(f"({col} IS NOT NULL AND {col} IS NOT ?)")
            params.append(value)
    return "".join(f"{p} AND " for p in parts), params


# ---------------------------------------------------------------- events

def check(event: Event) -> None:
    """Raises TypeError unless `event` is an Event with an int `type_id`."""
    if not isinstance(event, Event):
        raise TypeError(f"insert takes an Event, not {type(event).__name__}")
    if not isinstance(event.type_id, int) or isinstance(event.type_id, bool):
        raise TypeError(f"an event's type_id must be an int (an EventType's id), not {event.type_id!r}")


def row_of(event: Event, values: tuple, tokenizer: Tokenizer, at: Optional[str] = None) -> tuple:
    """The values for one INSERT, in `insert_sql`'s column order; `values`
    are its properties' (`property_values`).

    The payload is serialized with sorted keys. An empty event id is stored
    as NULL. The event's tokens are its own `tokens` if given, else the
    tokenizer's count of its text -- of the JSON, if it has none -- taken
    here, once. Stored now, or `at` (UTC, ISO): when what it records happened, where that was before.

    Raises:
        TypeError: `event` is not an Event, its `type_id` is not an int, or
            its payload is not JSON-serializable.
    """
    check(event)
    raw = json.dumps(event.payload, sort_keys=True, ensure_ascii=False)
    text = event.text if isinstance(event.text, str) else None
    tokens = event.tokens if event.tokens is not None else tokenizer.count(raw if text is None else text)
    return (at or _now(), event.id or None, event.type_id, raw, tokens, text, *values)


def unknown_type(conn: sqlite3.Connection, exc: sqlite3.IntegrityError, event: Event) -> Exception:
    """The error to raise for a failed INSERT: a LookupError if the event's
    type is not one of the gatherer's, else `exc` itself."""
    if "FOREIGN KEY" in str(exc) and not has_type(conn, event.type_id):
        return LookupError(f"no event type with id {event.type_id!r} in this gatherer; "
                           f"define it with init or add_event_type first")
    return exc


def insert_sql(names: List[str]) -> str:
    return (f"INSERT INTO events (inserted_at, event_id, event_type_id, payload_json, tokens, text{_columns(names)}) "
            f"VALUES (?, ?, ?, ?, ?, ?{', ?' * len(names)}) ON CONFLICT DO NOTHING RETURNING row_id")


def stored(conn: sqlite3.Connection, sp: Spec, values: tuple, event_id: str) -> bool:
    """Whether an event with this id and these identifying properties (of `values`, in `sp.names`'
    order) is stored: the same event, whatever its other properties."""
    keyed = [v for n, v in zip(sp.names, values) if n in sp.identifying]
    return conn.execute(f"SELECT 1 FROM events WHERE {_same(sp.identifying)}event_id = ?",
                        (*_unset_is_empty(keyed), event_id)).fetchone() is not None


#: Leaves out the events the harness took back (`withdraw`): a condition on `e`, an events row.
KEPT = " AND NOT EXISTS (SELECT 1 FROM _withdrawn w WHERE w.row_id = e.row_id)"


def withdraw(conn: sqlite3.Connection, row_ids: Iterable[int], read_id: Optional[int] = None) -> int:
    """Withdraw these events (the `_withdrawn` table): the harness took them back. How many were not already."""
    ids = sorted({r for r in row_ids if isinstance(r, int) and not isinstance(r, bool)})
    with conn:
        before = conn.total_changes
        conn.executemany("INSERT INTO _withdrawn (row_id, withdrawn_at, read_id) SELECT ?, ?, ? "
                         "WHERE EXISTS (SELECT 1 FROM events WHERE row_id = ?) ON CONFLICT DO NOTHING",
                         [(r, _now(), read_id, r) for r in ids])
        return conn.total_changes - before


def sent_again(conn: sqlite3.Connection, sp: Spec, values: tuple, event_id: str) -> List[int]:
    """An event the harness sends again, already stored: its rows no longer withdrawn, if they were. Those rows."""
    keyed = [v for n, v in zip(sp.names, values) if n in sp.identifying]
    back = [r for (r,) in conn.execute(
        f"SELECT w.row_id FROM _withdrawn w JOIN events e ON e.row_id = w.row_id WHERE {_same(sp.identifying, 'e.')}"
        "e.event_id = ?", (*_unset_is_empty(keyed), event_id))]
    if back:
        with conn:
            conn.executemany("DELETE FROM _withdrawn WHERE row_id = ?", [(r,) for r in back])
    return back


def latest(conn: sqlite3.Connection, properties: Optional[Dict[str, Any]], n: int,
           types: Optional[List[str]] = None) -> List[Tuple[str, Any]]:
    """(event id, payload) of the `n` events last stored with exactly these identifying properties (one
    not given: unset) and an id -- of these `types` alone, when given (a harness's conversation, not what it
    records besides) -- oldest first: where a harness that re-sends its history picks it up -- not one it took
    back (`withdraw`)."""
    names = identifying_names(conn)
    given = properties or {}
    typed, named = "", []
    if types is not None:
        named = [t for t in types if isinstance(t, str)]
        typed = (f"e.event_type_id IN (SELECT event_type_id FROM event_types WHERE name IN "
                 f"({', '.join('?' * len(named))})) AND " if named else "0 AND ")
    found = conn.execute(f"SELECT event_id, payload_json FROM events e WHERE {_same(names, 'e.')}{typed}event_id IS NOT NULL"
                         f"{KEPT} ORDER BY row_id DESC LIMIT ?",
                         (*_unset_is_empty([given.get(name) for name in names]), *named, max(0, n))).fetchall()
    return [(event_id, json.loads(payload)) for event_id, payload in reversed(found)]


def locate(conn: sqlite3.Connection, properties: Optional[Dict[str, Any]], event_id: str) -> Optional[int]:
    """The row id of the event with this id as a read with `properties` sees
    it -- with each identifying property its value or unset (one not given:
    unset); the others are not the event's identity -- whichever was stored
    first (the one `rows` returns), or None."""
    if not event_id:
        return None
    names = identifying_names(conn)
    given = properties or {}
    where, params = _filter(names, "", {n: given.get(n) for n in names}, None, True)
    row = conn.execute(f"SELECT min(row_id) FROM events WHERE {where}event_id = ?", (*params, event_id)).fetchone()
    return row[0] if row and row[0] is not None else None


def insert(conn: sqlite3.Connection, event: Event, tokenizer: Tokenizer, spec_: Optional[Spec] = None, *,
           kept: Optional[List[int]] = None) -> Optional[int]:
    """Store one event in its own transaction. Returns its row id, or None if
    it was already stored (same id, same identifying properties). An event without an
    id is always stored. `spec_`: the gatherer's (`spec`), if the caller keeps it.
    `kept`, if given, gets the rows of an event the harness took back (`withdraw`)
    and now sends again: in reads again, and for the caller to withdraw again
    should the harness take it back once more.

    A re-sent event is recognised by its id BEFORE it is serialized and
    counted: a caller inserts the whole conversation on every model call, and
    tokenizing thousands of events already stored took seconds per call. The
    unique index still catches a race between two processes.

    Raises:
        TypeError: `event` is not an Event with an int `type_id`, or its
            payload is not JSON-serializable. Nothing is stored.
        LookupError: the gatherer has no event type with that id. Nothing is
            stored.
        ValueError: its properties are not what its type declares. Nothing
            is stored.
    """
    check(event)
    sp = spec_ or spec(conn)
    values = property_values(event, sp)
    if event.id and stored(conn, sp, values, event.id):
        back = sent_again(conn, sp, values, event.id)   # one the harness took back, sent again: kept again
        if kept is not None:
            kept.extend(back)
        return None
    row_values = row_of(event, values, tokenizer)
    try:
        with conn:   # committed on return
            row = conn.execute(insert_sql(sp.names), row_values).fetchone()
    except sqlite3.IntegrityError as exc:
        raise unknown_type(conn, exc, event) from exc
    return row[0] if row else None


def insert_many(conn: sqlite3.Connection, events, tokenizer: Tokenizer, times: Optional[List[Optional[str]]] = None) -> None:
    """Store a whole history in ONE transaction (a bulk load). Events already
    stored (same id, same identifying properties) are skipped, as `insert` skips them. `times`: each one's
    `inserted_at` (`row_of`'s `at`), where it is not now.

    Raises:
        TypeError, LookupError, ValueError: as `insert`. Nothing is stored.
    """
    sp = spec(conn)
    sql = insert_sql(sp.names)
    event = None
    try:
        with conn:
            for i, event in enumerate(events):
                check(event)
                conn.execute(sql, row_of(event, property_values(event, sp), tokenizer, times[i] if times else None))
    except sqlite3.IntegrityError as exc:
        raise unknown_type(conn, exc, event) from exc


_FROM = "events e JOIN event_types t ON t.event_type_id = e.event_type_id"


def _select(names: List[str]) -> str:
    return f"e.row_id, e.event_id, t.event_type_id, t.name, e.payload_json, e.tokens, e.text{_columns(names, 'e.')}"


def _row(r, names: List[str]) -> Row:
    return Row(r[0], r[1], EventType(r[3], id=r[2]), json.loads(r[4]), r[5],
               {n: v for n, v in zip(names, r[7:]) if v is not None}, r[6])


def rows_by_id(conn: sqlite3.Connection, row_ids: Iterable[int]) -> dict:
    """{row_id: Row} for the given row ids."""
    ids = sorted(set(row_ids))
    if not ids:
        return {}
    names = property_names(conn)
    marks = ",".join("?" * len(ids))
    return {r[0]: _row(r, names) for r in conn.execute(
        f"SELECT {_select(names)} FROM {_FROM} WHERE e.row_id IN ({marks})", ids)}


def _types_clause(type_ids: Optional[Iterable[int]]) -> tuple:
    """(SQL fragment, params) restricting rows to `type_ids`; ("", ()) for
    None = every type. An empty set matches nothing."""
    if type_ids is None:
        return "", ()
    ids = sorted(set(type_ids))
    if not ids:
        return " AND 0", ()
    return f" AND e.event_type_id IN ({','.join('?' * len(ids))})", tuple(ids)


def rows(conn: sqlite3.Connection, after_row: int = 0, type_ids: Optional[Iterable[int]] = None, *,
         match: Optional[Dict[str, Any]] = None, differ: Optional[Dict[str, Any]] = None,
         unset_matches: bool = True) -> list:
    """Every event whose properties pass `match` and `differ`
    (ag.ag_interface.store), as Rows, in order; only rows after `after_row`,
    and -- with `type_ids` -- only events of those types.

    Without `differ`, an event id is returned once, at the position it was
    first stored among the events that pass: the same event can have a row
    with a property unset and one with it set (bulk-loaded without it, then
    re-sent with it). With `after_row`, an id first stored at or before it is
    not repeated: it is a re-send of something already seen. An event the
    harness took back (`withdraw`) is not one.
    """
    names = property_names(conn)
    clause, params = _types_clause(type_ids)
    where, where_params = _filter(names, "e.", match, differ, unset_matches)
    once, once_params = "", []
    if not differ:
        inner, once_params = _filter(names, "x.", match, None, unset_matches)
        once = (f" AND (e.event_id IS NULL OR e.row_id IN (SELECT min(x.row_id) FROM events x "
                f"WHERE {inner}x.event_id IS NOT NULL GROUP BY x.event_id))")
    sql = f"SELECT {_select(names)} FROM {_FROM} WHERE {where}e.row_id > ?{clause}{once}{KEPT} ORDER BY e.row_id"
    return [_row(r, names) for r in conn.execute(sql, (*where_params, after_row, *params, *once_params))]


def read(conn: sqlite3.Connection, match: Optional[Dict[str, Any]] = None) -> list:
    """The payloads a read with `match`'s properties sees, in order (see `rows`)."""
    return [r.payload for r in rows(conn, match=match)]


# ---------------------------------------------------------------- made items

def made_sha(name: Optional[str], source: Optional[str], item_json: str) -> str:
    """What makes two made items the same one (`_made_items.sha`): their name, source and text."""
    return hashlib.sha256(json.dumps([name, source, item_json], ensure_ascii=False).encode("utf-8")).hexdigest()


def make_item(conn: sqlite3.Connection, item: Any, tokenizer: Tokenizer, *,
              properties: Optional[Dict[str, Any]] = None, name: Optional[str] = None,
              source: Optional[str] = None) -> int:
    """Store an item the manager made, with its size and the properties of
    the read it is first made for; returns its made_id. Stored once: an item
    made again with the same name, source and text (`made_sha`), for this read
    or any other, is the one stored, as it was first stored.

    Raises:
        ValueError: a property the gatherer has no column for.
    """
    names, values = _given(conn, properties, "a made item")
    raw = json.dumps(item, ensure_ascii=False)
    sha = made_sha(name, source, raw)
    found = conn.execute("SELECT made_id FROM _made_items WHERE sha = ?", (sha,)).fetchone()
    if found:
        return found[0]
    with conn:
        cur = conn.execute(
            f"INSERT OR IGNORE INTO _made_items (created_at, name, source, item_json, tokens, sha{_columns(names)}) "
            f"VALUES (?, ?, ?, ?, ?, ?{', ?' * len(names)})",
            (_now(), name, source, raw, tokenizer.count(raw), sha, *values))
    if cur.rowcount:
        return cur.lastrowid
    return conn.execute("SELECT made_id FROM _made_items WHERE sha = ?", (sha,)).fetchone()[0]   # another just made it


def made_items(conn: sqlite3.Connection, made_ids) -> dict:
    """{made_id: (name, item, tokens)} for the given ids."""
    ids = list(made_ids)
    if not ids:
        return {}
    marks = ",".join("?" * len(ids))
    return {m: (n, json.loads(j), t or 0) for m, n, j, t in conn.execute(
        f"SELECT made_id, name, item_json, tokens FROM _made_items WHERE made_id IN ({marks})", ids)}


# ---------------------------------------------------------------- the read log

def record_read(conn: sqlite3.Connection, properties: Optional[Dict[str, Any]], refs, *,
                manager: str, basis: Optional[str] = None, row_id: Optional[int] = None,
                est_tokens: Optional[int] = None, limit_tokens: Optional[int] = None,
                preamble_ids: Optional[List[int]] = None, sent_tokens: Optional[int] = None,
                process: Optional[Dict[str, Any]] = None, run: Optional[str] = None) -> int:
    """Log one read: a `_reads` row (with its properties, `row_id`, the
    event it responded to, `est_tokens`, the context's size by the
    manager's count, `limit_tokens`, the harness's own limit the call
    stated, `preamble_ids`, the _preambles it sent besides its messages, and
    `sent_tokens`, all of it as counted now, `process`, {"pid", "started"}, the harness's process
    that made the call, and `run`, the harness's run that made it, as its launcher named it), and the
    items it returned, in order: as stays of its context (`log_items`) once the file keeps them, else a
    `_read_items` row each (schema.py). Returns the read_id."""
    names, values = _given(conn, properties, "a read")
    preamble = json.dumps(list(preamble_ids)) if preamble_ids else None
    pid, started = (process.get("pid"), process.get("started")) if isinstance(process, dict) else (None, None)
    with writing(conn):
        cur = conn.execute(f"INSERT INTO _reads (read_at, row_id, manager, basis, est_tokens, limit_tokens, preamble_json, "
                           f"sent_tokens, pid, pid_started, run{_columns(names)}) "
                           f"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?{', ?' * len(names)})",
                           (_now(), row_id, manager, basis, est_tokens, limit_tokens, preamble, sent_tokens,
                            pid, started, run, *values))
        read_id = cur.lastrowid
        if stays(conn):
            context = conn.execute("SELECT context_id FROM _reads WHERE read_id = ?", (read_id,)).fetchone()[0]
            log_items(conn, context, read_id, [(r.row_id, r.made_id) for r in refs])
        else:
            conn.executemany("INSERT INTO _read_items (read_id, position, row_id, made_id) VALUES (?, ?, ?, ?)",
                             [(read_id, i, r.row_id, r.made_id) for i, r in enumerate(refs)])
    return read_id


def log_items(conn: sqlite3.Connection, context: int, read_id: int, items: List[Tuple[Optional[int], Optional[int]]]) -> None:
    """Keep what read `read_id` of `context` returned, [(row_id, made_id)] in order, as stays (schema.py): the
    part it shares with the context's read before it, from the start, goes on (each stay as it is); from the first
    difference on, that read's stays end at it and this read's items start stays of their own. The read before's
    stays are the context's open ones -- or, when none are (an older file's read log just moved, migrate.py),
    those that end at it. A made item an older file kept copies of is named by the one kept (`_made_folded`): a
    read made while migrate.py folded them may name a copy. Within the transaction that logged the read."""
    if any(m is not None for _, m in items) and conn.execute("SELECT EXISTS (SELECT 1 FROM _made_folded)").fetchone()[0]:
        made = [m for _, m in items if m is not None]
        kept = dict(conn.execute(f"SELECT old, made_id FROM _made_folded WHERE old IN ({','.join('?' * len(made))})", made))
        items = [(r, kept.get(m, m)) for r, m in items]
    prev = conn.execute("SELECT max(read_id) FROM _reads WHERE context_id = ? AND read_id < ?",
                        (context, read_id)).fetchone()[0]
    before = [] if prev is None else conn.execute(
        "SELECT rowid, row_id, made_id, to_read FROM _stays WHERE context_id = ? AND to_read IS NULL ORDER BY position",
        (context,)).fetchall() or conn.execute(
        "SELECT rowid, row_id, made_id, to_read FROM _stays WHERE context_id = ? AND to_read = ? ORDER BY position",
        (context, prev)).fetchall()
    same = 0
    while same < min(len(before), len(items)) and (before[same][1], before[same][2]) == tuple(items[same]):
        same += 1
    conn.executemany("UPDATE _stays SET to_read = ? WHERE rowid = ?", [(prev, s[0]) for s in before[same:] if s[3] is None])
    conn.executemany("UPDATE _stays SET to_read = NULL WHERE rowid = ?", [(s[0],) for s in before[:same] if s[3] is not None])
    conn.executemany("INSERT INTO _stays (context_id, position, row_id, made_id, from_read) VALUES (?, ?, ?, ?, ?)",
                     [(context, i, r, m, read_id) for i, (r, m) in enumerate(items) if i >= same])


def read_items(conn: sqlite3.Connection, read_id: int) -> List[Tuple[Optional[int], Optional[int]]]:
    """What read `read_id` returned, in order: [(row_id, made_id)] -- the open stays of its context when it is the
    context's latest read (the usual question: `last_read`), else the stays that span it (`_read_items`)."""
    found = conn.execute("SELECT context_id, (SELECT max(p.read_id) FROM _reads p WHERE p.context_id = r.context_id) "
                         "FROM _reads r WHERE read_id = ?", (read_id,)).fetchone()
    if found and found[0] is not None and found[1] == read_id and stays(conn):
        items = conn.execute("SELECT row_id, made_id FROM _stays WHERE context_id = ? AND to_read IS NULL "
                             "ORDER BY position", (found[0],)).fetchall()
        if items:
            return items
    return conn.execute("SELECT row_id, made_id FROM _read_items WHERE read_id = ? ORDER BY position",
                        (read_id,)).fetchall()


def last_read(conn: sqlite3.Connection, properties: Optional[Dict[str, Any]] = None) -> Optional[dict]:
    """The most recent read with these properties -- each given one its
    value (None: unset), those not given any value -- {read_id, read_at,
    row_id (the event it responded to), manager, basis, est_tokens,
    real_tokens (None: not reported), limit_tokens (None: none stated),
    fixed_tokens (the size of the preamble it named: 0 for none), sent_tokens (None: not known),
    refs: [Ref, ...]}, or None."""
    names, _ = _given(conn, properties, "a read")
    given = {n: v for n, v in (properties or {}).items() if n in names}
    row = conn.execute(f"SELECT read_id, read_at, row_id, manager, basis, est_tokens, real_tokens, limit_tokens, "
                       f"preamble_json, sent_tokens FROM _reads "
                       f"WHERE {_same(list(given))}1 ORDER BY read_id DESC LIMIT 1",
                       _unset_is_empty(given.values())).fetchone()
    if not row:
        return None
    refs = [Ref(r, m) for r, m in read_items(conn, row[0])]
    ids = [i for i in json.loads(row[8] or "[]") if isinstance(i, int)]
    fixed = conn.execute(f"SELECT COALESCE(SUM(tokens), 0) FROM _preambles WHERE preamble_id IN ({','.join('?' * len(ids))})",
                         ids).fetchone()[0] if ids else 0
    return {"read_id": row[0], "read_at": row[1], "row_id": row[2], "manager": row[3], "basis": row[4],
            "est_tokens": row[5], "real_tokens": row[6], "limit_tokens": row[7], "fixed_tokens": fixed,
            "sent_tokens": row[9], "refs": refs}


def basis_opened(conn: sqlite3.Connection, properties: Optional[Dict[str, Any]], basis: Optional[str]) -> Optional[int]:
    """The row the context of these properties switched to `basis` at: the event the first of their latest
    reads made from it, in a row, responded to. None for no basis, or when their latest read was made from
    another (a read made from it now is the switch)."""
    if basis is None:
        return None
    names, _ = _given(conn, properties, "a read")
    given = {n: v for n, v in (properties or {}).items() if n in names}
    same, values = _same(list(given)), _unset_is_empty(given.values())
    before = conn.execute(f"SELECT max(read_id) FROM _reads WHERE {same}basis IS NOT ?", (*values, basis)).fetchone()[0]
    row = conn.execute(f"SELECT row_id FROM _reads WHERE {same}read_id > ? ORDER BY read_id LIMIT 1",
                       (*values, before or 0)).fetchone()
    return row[0] if row else None


def counted_rows(conn: sqlite3.Connection, row_ids) -> set:
    """Those of the rows `row_ids` whose size is the provider's count (`record_counts`)."""
    ids = sorted(set(row_ids))
    if not ids:
        return set()
    return {r for (r,) in conn.execute(f"SELECT row_id FROM events WHERE counted = 1 AND row_id IN "
                                       f"({','.join('?' * len(ids))})", ids)}


def uncounted(conn: sqlite3.Connection, properties: Optional[Dict[str, Any]], event_ids) -> List[str]:
    """Those of the events with these ids (and `properties`, as `record_counts` finds them) the provider
    has not counted yet."""
    ids = sorted({i for i in event_ids if isinstance(i, str)})
    names = [n for n in identifying_names(conn) if properties and n in properties]
    where = "".join(f" AND {property_column(n)} = ?" for n in names)
    out = []
    for start in range(0, len(ids), 500):                    # within SQLite's limit on parameters
        chunk = ids[start:start + 500]
        out += [i for (i,) in conn.execute(f"SELECT event_id FROM events WHERE counted IS NULL AND event_id IN "
                                           f"({','.join('?' * len(chunk))}){where}",
                                           (*chunk, *[properties[n] for n in names]))]
    return out


def record_preamble(conn: sqlite3.Connection, name: str, text: str, tokenizer) -> int:
    """The id of a harness's preamble part `name` (its system prompt, its tools...) with
    this `text`: stored the first time, found after -- each distinct text once."""
    sha = hashlib.sha256(f"{name}\u0000{text}".encode("utf-8")).hexdigest()
    with conn:
        conn.execute("INSERT OR IGNORE INTO _preambles (name, sha, text, tokens) VALUES (?, ?, ?, ?)",
                     (name, sha, text, tokenizer.count(text)))
    return conn.execute("SELECT preamble_id FROM _preambles WHERE sha = ?", (sha,)).fetchone()[0]


def record_counts(conn: sqlite3.Connection, properties: Optional[Dict[str, Any]], events: Dict[str, int],
                  made: Dict[int, int], preamble: List[tuple], left_out: Optional[Dict[int, int]] = None) -> Dict[str, int]:
    """Set sizes the model's provider counted, after the fact, in place of the tokenizer's: of the
    events with these ids (and `properties`), of the made items with these ids, and of the preamble
    parts (name, text, tokens). Each is marked `counted`. `left_out`, {read_id: tokens}: what the
    harness left out of a read's context before sending it, taken off the read's `sent_tokens`.
    How many of each were found."""
    names = [n for n in identifying_names(conn) if properties and n in properties]   # the events' identity
    where = "".join(f" AND {property_column(n)} = ?" for n in names)
    values = [properties[n] for n in names]
    found = {"events": 0, "made": 0, "preamble": 0}
    with conn:
        for event_id, tokens in events.items():
            cur = conn.execute(f"UPDATE events SET tokens = ?, counted = 1 WHERE event_id = ?{where}",
                               (tokens, event_id, *values))
            found["events"] += cur.rowcount
        for made_id, tokens in made.items():                         # a copy migrate.py folded: the one kept
            cur = conn.execute("UPDATE _made_items SET tokens = ?, counted = 1 WHERE made_id = coalesce("
                               "(SELECT made_id FROM _made_folded WHERE old = ?), ?)", (tokens, made_id, made_id))
            found["made"] += cur.rowcount
        for name, text, tokens in preamble:
            sha = hashlib.sha256(f"{name}\u0000{text}".encode("utf-8")).hexdigest()
            cur = conn.execute("UPDATE _preambles SET tokens = ?, counted = 1 WHERE sha = ?", (tokens, sha))
            found["preamble"] += cur.rowcount
        for read_id, tokens in (left_out or {}).items():
            conn.execute("UPDATE _reads SET sent_tokens = sent_tokens - ? WHERE read_id = ? AND sent_tokens IS NOT NULL",
                         (tokens, read_id))
    return found


def preamble_tokens(conn: sqlite3.Connection, parts) -> int:
    """The size of a call's preamble parts ({"name", "text"}) as stored: the provider's count where it
    was set (`record_counts`), else the tokenizer's taken when the part was first stored."""
    total = 0
    for p in parts or ():
        sha = hashlib.sha256(f"{p['name']}\u0000{p['text']}".encode("utf-8")).hexdigest()
        row = conn.execute("SELECT tokens FROM _preambles WHERE sha = ?", (sha,)).fetchone()
        total += (row[0] or 0) if row else 0
    return total


def raw_texts(conn: sqlite3.Connection, skip_types: Iterable[str] = ("environment_update", "context_stream")) -> List[str]:
    """The texts of the conversation's raw part: the events each set of properties' latest read sent
    verbatim (its stored rows), and every event since the earliest of those reads -- all of them,
    before any read -- the events of `skip_types` (the pollers') left out, and those with no text:
    an opaque blob (a model's encrypted reasoning), whose payload names nothing a reader could."""
    names = property_names(conn)
    group = f" GROUP BY {', '.join(property_column(n) for n in names)}" if names else ""
    latest = conn.execute(f"SELECT read_id, row_id FROM _reads WHERE read_id IN "
                          f"(SELECT max(read_id) FROM _reads{group})").fetchall()
    since = min((row or 0 for _, row in latest), default=0)
    reads = [read_id for read_id, _ in latest]
    skip = list(skip_types)
    marks, skipped = ",".join("?" * len(reads)) or "NULL", ",".join("?" * len(skip)) or "NULL"
    rows = conn.execute(
        f"SELECT e.text FROM events e JOIN event_types t ON t.event_type_id = e.event_type_id "
        f"WHERE t.name NOT IN ({skipped}) AND e.text IS NOT NULL AND (e.row_id > ? OR e.row_id IN "
        f"(SELECT row_id FROM _read_items WHERE read_id IN ({marks}) AND row_id IS NOT NULL)) ORDER BY e.row_id",
        (*skip, since, *reads)).fetchall()
    return [text for (text,) in rows]


def record_real_tokens(conn: sqlite3.Connection, read_id: int, tokens: int) -> bool:
    """Set read `read_id`'s `real_tokens`: the size of the context it
    returned as the model's provider counted it (the call's input tokens,
    cached ones included). Whether that read exists."""
    with conn:
        cur = conn.execute("UPDATE _reads SET real_tokens = ? WHERE read_id = ?", (tokens, read_id))
    return cur.rowcount > 0


def high_water(conn: sqlite3.Connection) -> int:
    """The highest row id stored in the gatherer (whatever its properties); 0 when empty."""
    row = conn.execute("SELECT max(row_id) FROM events").fetchone()
    return row[0] or 0


# ---------------------------------------------------------------- polls

def polled_at(conn: sqlite3.Connection, name: str) -> Optional[float]:
    """When the poller `name` was last asked for this gatherer (seconds since
    the epoch), or None if never."""
    row = conn.execute("SELECT polled_at FROM _polls WHERE name = ?", (name,)).fetchone()
    return row[0] if row else None


def mark_polled(conn: sqlite3.Connection, name: str, at: float) -> None:
    """Record that the poller `name` was asked at `at`."""
    with conn:
        conn.execute("INSERT INTO _polls (name, polled_at) VALUES (?, ?) "
                     "ON CONFLICT (name) DO UPDATE SET polled_at = excluded.polled_at", (name, at))


def last_inserted_at(conn: sqlite3.Connection) -> Optional[str]:
    """When the gatherer's most recent event was first stored (UTC, ISO
    format, whatever its properties), or None when it has none."""
    row = conn.execute("SELECT max(inserted_at) FROM events").fetchone()
    return row[0] if row else None


# ---------------------------------------------------------------- the old tables, copied once

OLD_TABLES = ("_pending", "_recaps", "_names", "_touches")


def old_tables(conn: sqlite3.Connection, by: Optional[str] = None, types: Iterable[str] = (), first: int = 0) -> dict:
    """What an older file's tables kept that are no longer kept -- for the harness side to copy into events once
    (`migrated`): {"migrated": whether that was done ("records"), "recaps": [{recap_id, session, made_at, text}],
    "names": [{session, by, named_at, text}], "touches": [{session, call_id, at, path, how, checked, named, detail}],
    "pending": [{pending_id, received_at, answer, stop, type, payload, text, properties}], "failed": [{read_id,
    read_at, properties, status, error}] (`_reads.error`), and with `by` (a property: the harness's session, e.g.) each
    value its events have, "groups": [{value, first (its first event's time), types (those of `types`
    it has events of), payloads (its first `first` events' payloads, of other types)}], and its newest answer kept on
    a read, "answered": [{read_id, answered_at, properties}] (`_reads.answered_at`) -- [] for a table the file does
    not have."""
    tables = {n for (n,) in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    names = property_names(conn)
    out = {"migrated": "_migrated" in tables and conn.execute(
        "SELECT 1 FROM _migrated WHERE name = 'records'").fetchone() is not None,
        "recaps": [], "names": [], "touches": [], "pending": [], "failed": [], "groups": [], "answered": []}
    if "_recaps" in tables:
        out["recaps"] = [{"recap_id": r[0], "session": r[1], "made_at": r[2], "text": r[3]} for r in conn.execute(
            "SELECT recap_id, session, made_at, text FROM _recaps ORDER BY recap_id")]
    if "_names" in tables:
        out["names"] = [{"session": r[0], "by": r[1], "named_at": r[2], "text": r[3]} for r in conn.execute(
            "SELECT session, by, named_at, text FROM _names ORDER BY named_at")]
    if "_touches" in tables:
        out["touches"] = [{"session": r[0], "call_id": r[1], "at": r[2], "path": r[3], "how": r[4], "checked": r[5],
                           "named": r[6], "detail": json.loads(r[7]) if r[7] else None} for r in conn.execute(
            "SELECT session, call_id, at, path, how, checked, named, detail_json FROM _touches ORDER BY touch_id")]
    if "_pending" in tables:
        have = {c[1] for c in conn.execute("PRAGMA table_info(_pending)")}
        own = [n for n in names if property_column(n) in have]
        stop = "stop" if "stop" in have else "NULL"
        for r in conn.execute(f"SELECT pending_id, received_at, answer, {stop}, type, payload_json, text{_columns(own)} "
                              "FROM _pending ORDER BY pending_id"):
            out["pending"].append({"pending_id": r[0], "received_at": r[1], "answer": r[2], "stop": r[3], "type": r[4],
                                   "payload": json.loads(r[5]), "text": r[6],
                                   "properties": {n: v for n, v in zip(own, r[7:]) if v is not None}})
    read_columns = {c[1] for c in conn.execute("PRAGMA table_info(_reads)")}
    if "error" in read_columns:
        own = [n for n in names if property_column(n) in read_columns]
        for r in conn.execute(f"SELECT read_id, read_at, error_status, error{_columns(own)} FROM _reads "
                              "WHERE error IS NOT NULL ORDER BY read_id"):
            out["failed"].append({"read_id": r[0], "read_at": r[1], "status": r[2], "error": r[3],
                                  "properties": {n: v for n, v in zip(own, r[4:]) if v is not None}})
    column = property_column(by) if by else None
    if column and {"answered_at", column} <= read_columns:
        own = [n for n in names if property_column(n) in read_columns]
        for r in conn.execute(f"SELECT read_id, answered_at{_columns(own)} FROM _reads WHERE read_id IN (SELECT "
                              f"max(read_id) FROM _reads WHERE answered_at IS NOT NULL GROUP BY {column})"):
            out["answered"].append({"read_id": r[0], "answered_at": r[1],
                                    "properties": {n: v for n, v in zip(own, r[2:]) if v is not None}})
    if column and column in {c[1] for c in conn.execute("PRAGMA table_info(events)")}:
        types = list(dict.fromkeys(types))
        marks = ", ".join("?" * len(types)) or "NULL"
        has: Dict[str, List[str]] = {}
        for value, t in conn.execute(f"SELECT DISTINCT e.{column}, t.name FROM events e JOIN event_types t "
                                  f"ON t.event_type_id = e.event_type_id WHERE t.name IN ({marks}) "
                                  f"AND e.{column} IS NOT NULL", types):
            has.setdefault(value, []).append(t)
        for value, at in conn.execute(f"SELECT {column}, min(inserted_at) FROM events WHERE {column} IS NOT NULL "
                                      f"GROUP BY {column}"):
            payloads = [json.loads(p) for (p,) in conn.execute(
                f"SELECT e.payload_json FROM events e JOIN event_types t ON t.event_type_id = e.event_type_id "
                f"WHERE ifnull(e.{column}, '') = ? AND t.name NOT IN ({marks}) ORDER BY e.row_id LIMIT ?",
                (value, *types, first))] if first else []
            out["groups"].append({"value": value, "first": at, "types": sorted(has.get(value, [])), "payloads": payloads})
    return out


def mark_migrated(conn: sqlite3.Connection, name: str) -> None:
    """That the one-time copy `name` was made in the file (`_migrated`)."""
    with conn:
        conn.execute("INSERT OR REPLACE INTO _migrated (name, at) VALUES (?, ?)", (name, _now()))


# ---------------------------------------------------------------- which process has a session open

def claim(conn: sqlite3.Connection, session: str, process: Dict[str, Any], by: str) -> dict:
    """`process` ({"pid", "started"}) opens `session` (`_open`): {"claimed": True}, and "took_over",
    the holder it stopped, when that one yielded (idle, `hold`). Refused while another process that
    still runs has it and does not yield: {"claimed": False, "holder": that one ({"pid", "started",
    "opened_at", "opened_by"})}, and nothing changes. A process holds one session: one it held before is
    let go."""
    import signal
    from .processes import alive
    pid, started = process["pid"], process["started"]
    out = {"claimed": True}
    conn.execute("BEGIN IMMEDIATE")              # read and write as one: two claims never both win
    try:
        row = conn.execute("SELECT pid, pid_started, opened_at, opened_by, yields FROM _open WHERE session = ?",
                           (session,)).fetchone()
        other = row is not None and (row[0], row[1]) != (pid, started) and alive(row[0], row[1]) is not False
        held = {"pid": row[0], "started": row[1], "opened_at": row[2], "opened_by": row[3]} if other else None
        if other and not row[4]:
            conn.execute("ROLLBACK")
            return {"claimed": False, "holder": held}
        if other:                                # idle, and yields: stopped, under the lock (its `hold` waits)
            try:
                os.kill(row[0], signal.SIGTERM)
            except OSError:
                pass
            out["took_over"] = held
        conn.execute("DELETE FROM _open WHERE pid = ? AND pid_started = ? AND session != ?", (pid, started, session))
        if row is None or (row[0], row[1]) != (pid, started):
            conn.execute("INSERT OR REPLACE INTO _open (session, pid, pid_started, opened_at, opened_by, yields) "
                         "VALUES (?, ?, ?, ?, ?, 0)", (session, pid, started, _now(), by))
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    return out


def hold(conn: sqlite3.Connection, session: str, process: Dict[str, Any], yields: bool) -> bool:
    """`process`, which has `session` open, says whether it yields to another's claim (idle: it may be
    stopped) or not (a turn begins). Whether it still has the session: False when another took it."""
    with conn:
        cur = conn.execute("UPDATE _open SET yields = ? WHERE session = ? AND pid = ? AND pid_started = ?",
                           (1 if yields else 0, session, process["pid"], process["started"]))
    return cur.rowcount == 1


def holder(conn: sqlite3.Connection, session: str) -> Optional[dict]:
    """The process that has `session` open and still runs (`claim`'s), or None."""
    from .processes import alive
    row = conn.execute("SELECT pid, pid_started, opened_at, opened_by, yields FROM _open WHERE session = ?",
                       (session,)).fetchone()
    if row is None or alive(row[0], row[1]) is False:
        return None
    return {"pid": row[0], "started": row[1], "opened_at": row[2], "opened_by": row[3], "yields": bool(row[4])}
