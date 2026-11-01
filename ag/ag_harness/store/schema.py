"""The trace database: the tables every policy shares, and how a gatherer's
file is opened.

One SQLite file per gatherer (paths.py):

    event_types          every event type the gatherer has: defined at init or added
                         later; its name
    event_type_properties  the properties each type declares, required or not,
                         identifying or not
    events               every event stored, in the order first seen, each of
                         one event type, with the tokenizer's count of each
    _made_items          items a policy MADE (e.g. condensation messages),
                         exactly as sent, each once; never read back as history (internal)
    _reads, _read_items  the read log: what each read returned, in order, and in
                         response to which event (internal). A file starts with
                         `_read_items` a table, one row per item of every read, as every
                         ag has kept it; migrate.py moves it to STAYS once no older ag has
                         the file open: `_stays` keeps each item's run through its
                         context's reads (`_contexts`: the reads with the same
                         properties), so a read that extends the one before adds rows
                         only for what it adds, and `_read_items` becomes a view of them
    _preambles           what harnesses sent besides their messages (system prompts, tool
                         definitions), each text once; a read names its own (internal)
    _polls               when each poller (a source of events from outside the
                         conversation) was last asked (internal)
    _withdrawn           the events the harness took back (internal)
    _open                which process has each session open (internal)
    _migrated            which one-time copies were made in the file (internal): "records", an older
                         gatherer's `_pending`, `_recaps`, `_names`, `_touches` and `_reads.error` copied
                         into events (ag/integrations/tools/ag_orchestrator/migrate.py); those tables
                         are no longer made, and stay in an older file as they were. "stays", the
                         file's read log moved into stays and an older ag's copies of one made item
                         folded into one (migrate.py)

A leading underscore marks a table internal to the manager (`_made_items`,
`_reads`, `_read_items`, `_contexts`, `_stays`, `_polls`, `_withdrawn`, `_open`, `_migrated`), which the agent has no reason to know about; the
others (`event_types`, `events`) it may be pointed at. Operations on these
tables are in operations.py.

A policy that keeps state of its own creates its own tables in its `init`, which the manager
calls after `create`; none of them are here.

Event types are not enumerated here or anywhere else in the package: they are
the rows a caller puts in `event_types`, at init or later, and every event
points at one of them. Nor are their PROPERTIES: `events`, `_made_items` and `_reads`
get a column for each property a registered type declares
(`add_properties`, `p_<name>`, NULL = unset), and the unique index on events
covers the identifying ones (`identifying_names`: those a type declares
`identifies`), so an event id is one event per combination of them; the other
properties only describe it, and keep the values it was first stored with.
"""

import os
import sqlite3
import threading
from contextlib import contextmanager
from typing import List, Optional

from ag.ag_interface import property_column

from .paths import db_path

PREFIX = property_column("")

SCHEMA = """
CREATE TABLE IF NOT EXISTS event_types (
    event_type_id INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL UNIQUE,  -- what identifies the type (e.g. user_message)
    created_at  TEXT    NOT NULL    -- UTC time the type was defined
);

CREATE TABLE IF NOT EXISTS events (
    row_id      INTEGER PRIMARY KEY,  -- insertion order; what `read` sorts by. Not
                                      -- AUTOINCREMENT: that spends an id (and a
                                      -- write) on every duplicate DO NOTHING
                                      -- skips. Rows are never deleted, so ids
                                      -- are never reused either way.
    inserted_at TEXT    NOT NULL,   -- UTC time the event was first stored
    event_id    TEXT,               -- the caller's id for the event: what makes a
                                    -- re-sent event a duplicate. NULL = the caller
                                    -- gave none; the row is then its own event,
                                    -- known by row_id, and never a duplicate.
    event_type_id INTEGER NOT NULL REFERENCES event_types (event_type_id),
    payload_json TEXT   NOT NULL,   -- the payload, as given
    tokens      INTEGER NOT NULL,   -- the caller's count if it gave one, else the
                                    -- tokenizer's count of `text` (of payload_json
                                    -- without one), taken at insert
    text        TEXT,               -- the event's readable text, as the caller gave it:
                                    -- what a policy shows and counts of it. NULL: none
    counted     INTEGER             -- 1: `tokens` is the model's provider's count, set after
                                    -- insert (`record_counts`); NULL: the caller's or the tokenizer's
                                    -- given; its payload as JSON stands in
                                    -- (then a p_<name> column per property: add_properties)
);
CREATE INDEX IF NOT EXISTS events_type ON events (event_type_id);

-- The properties each type declares: what its events may carry.
CREATE TABLE IF NOT EXISTS event_type_properties (
    event_type_id INTEGER NOT NULL REFERENCES event_types (event_type_id),
    name        TEXT    NOT NULL,   -- the property; its column is p_<name>
    required    INTEGER NOT NULL,   -- 1: an event of the type must carry it
    identifies  INTEGER NOT NULL DEFAULT 0,   -- 1: part of an event's identity, with its id
    PRIMARY KEY (event_type_id, name)
);

-- Items the manager MADE rather than received: a condensation of earlier
-- history, sent to the model as a message. Stored exactly as sent, each once:
-- an item made again with the same name, source and text is the one stored
-- (`sha`), whatever read it is for. Never part of `events`, so never read back
-- as history.
CREATE TABLE IF NOT EXISTS _made_items (
    made_id     INTEGER PRIMARY KEY,
    created_at  TEXT    NOT NULL,   -- (and the properties of the read it was made for)
    name        TEXT,               -- what it is, in the manager's terms
    source      TEXT,               -- what made it, in the manager's terms (e.g. a build)
    item_json   TEXT    NOT NULL,   -- the item, exactly as returned by read
    tokens      INTEGER,            -- its size, by the manager's tokenizer (or, `counted`, the provider's)
    counted     INTEGER,            -- 1: `tokens` is the provider's count (`record_counts`)
    sha         TEXT                -- of its name, source and text (`made_sha`): what makes it the same item;
                                    -- NULL: made by an older ag, not yet folded (migrate.py)
);

-- One row per read: what the manager returned as the context, when, and in
-- response to which event.
CREATE TABLE IF NOT EXISTS _reads (
    read_id     INTEGER PRIMARY KEY,
    read_at     TEXT    NOT NULL,   -- (and the read's properties)
    row_id      INTEGER,            -- the event (an events row) the read responded to
    manager     TEXT,               -- which implementation read
    basis       TEXT,               -- what the context was built from, in the
                                    -- manager's terms (e.g. a build id); NULL = none
    est_tokens  INTEGER,            -- the context's size by the manager's own count; NULL = not given
    real_tokens INTEGER,            -- its size as the model's provider counted it (the
                                    -- call's input tokens, reported after it); NULL = not yet
    limit_tokens INTEGER,           -- the harness's own limit the call stated (where it compacts,
                                    -- or its window ends); NULL = none
    preamble_json TEXT,             -- the harness's preamble the call stated: the _preambles it
                                    -- sent besides its messages, as a JSON list of ids; NULL = none
    sent_tokens INTEGER,            -- all the call sent -- every item and the preamble -- as the
                                    -- manager counted it at the read (less what the harness then
                                    -- left out, as it reports); NULL = not known
    pid         INTEGER,            -- the harness's process that made the call, and when it started
    pid_started TEXT,               -- ("<boot id>:<start ticks>", so a reused pid is not it); NULL = not known
    run         TEXT,               -- the harness's run that made the call, as its launcher named it (the hook
                                    -- server's /r/<run>/: codex's, the id of the process ag started); NULL = none
    error_status INTEGER,           -- no longer set: a failed call is a `call_failed` event (an older
    error       TEXT,               -- file's copied there once, `_migrated`)
    answered_at TEXT,               -- no longer set: an answer is its `reply_end` event
    context_id  INTEGER             -- the reads it shares its context with: those with the same properties
                                    -- (set as it is logged, `_reads_context`); NULL: an older file's, until moved
);

-- The contexts reads share: one per combination of properties a read was made with.
CREATE TABLE IF NOT EXISTS _contexts (
    context_id  INTEGER PRIMARY KEY,
    key         TEXT    NOT NULL UNIQUE   -- the properties set, as JSON, by name (`context_key`)
);

-- What a harness sends besides its messages -- its system prompt, its tool definitions --
-- each distinct text once (a call names the ones it sent, `_reads.preamble_json`).
CREATE TABLE IF NOT EXISTS _preambles (
    preamble_id INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,   -- what it is, as the harness names it: "instructions", "tools", ...
    sha         TEXT    NOT NULL UNIQUE,   -- of the name and the text
    text        TEXT    NOT NULL,
    tokens      INTEGER,            -- its size, by the manager's tokenizer (or, `counted`, the provider's)
    counted     INTEGER             -- 1: `tokens` is the provider's count (`record_counts`)
);

-- What each read returned, in order: a stored event (row_id) or a made item
-- (made_id), exactly one of the two. One row per item of every read, as every ag
-- has kept it, until migrate.py moves it into stays: then a view of them (`read_log`),
-- which an older ag can't open (it indexes this table as it connects).
CREATE TABLE IF NOT EXISTS _read_items (
    read_id     INTEGER NOT NULL,
    position    INTEGER NOT NULL,
    row_id      INTEGER,
    made_id     INTEGER,
    PRIMARY KEY (read_id, position),
    CHECK ((row_id IS NULL) != (made_id IS NULL))
);

-- The read log as stays, once migrate.py moved it: an item's unbroken run at one
-- position through a context's reads, from the read it came in at to the last read
-- it was in (NULL: it is in the context's latest read). A read's items, in order,
-- are its context's stays that span it (the `_read_items` view); a read that extends
-- the one before adds a row only for what it adds (`record_read`). Empty before.
CREATE TABLE IF NOT EXISTS _stays (
    context_id  INTEGER NOT NULL,
    position    INTEGER NOT NULL,
    row_id      INTEGER,
    made_id     INTEGER,
    from_read   INTEGER NOT NULL,
    to_read     INTEGER,
    CHECK ((row_id IS NULL) != (made_id IS NULL))
);
CREATE INDEX IF NOT EXISTS _stays_open ON _stays (context_id, position) WHERE to_read IS NULL;
CREATE INDEX IF NOT EXISTS _stays_from ON _stays (context_id, from_read);

-- An older file's copies of one made item, folded into the one kept (migrate.py): each copy's made_id and the
-- kept one's. Kept a while after the fold, so a read made while it ran, which may still name a copy, is logged
-- naming the kept one (`log_items`, the read log's insert trigger); emptied by a later migrate.py. Empty in a
-- file an older ag never wrote.
CREATE TABLE IF NOT EXISTS _made_folded (
    old         INTEGER PRIMARY KEY,
    made_id     INTEGER NOT NULL
) WITHOUT ROWID;

-- When each poller was last asked for this gatherer's events: the moment the
-- next poll starts from.
CREATE TABLE IF NOT EXISTS _polls (
    name        TEXT    PRIMARY KEY,    -- the poller's name
    polled_at   REAL    NOT NULL        -- seconds since the epoch
);

-- The events the harness took back: stored for a model call it hung up on before the answer came (the
-- user stopped it), and not in what it sent after -- Claude Code puts the user's message back in its input
-- box. Kept, but in no read (`rows`) and not where a request picks up its history (`latest`). An event
-- sent again is stored again as itself: its row is no longer withdrawn (`insert`).
CREATE TABLE IF NOT EXISTS _withdrawn (
    row_id       INTEGER PRIMARY KEY,  -- the event (an events row)
    withdrawn_at TEXT    NOT NULL,     -- when (UTC, ISO)
    read_id      INTEGER               -- the read of the call it came with; NULL = not known
);

-- Which process has each session open: one per session, so two processes (a terminal, the
-- dashboard's chat) never run it at once. Claimed by ag's launcher as it starts the harness on a
-- known session, and by each model call of a process the hook server could tell (`claim`); a row
-- whose process has ended holds nothing. A process holds one session: claiming another drops it.
-- A holder that `yields` (the dashboard's chat agent, between its turns: `hold`) gives way: another
-- process's claim stops it and takes the session.
CREATE TABLE IF NOT EXISTS _open (
    session     TEXT    PRIMARY KEY,   -- the session: its calls' `channel`
    pid         INTEGER NOT NULL,      -- the harness's process, and when it started
    pid_started TEXT    NOT NULL,      -- ("<boot id>:<start ticks>", as _reads has it)
    opened_at   TEXT    NOT NULL,
    opened_by   TEXT,                  -- what claimed it: "launcher", "call"
    yields      INTEGER NOT NULL DEFAULT 0   -- 1: idle, and gives way to another process's claim
);

-- The one-time copies made in the file, by name, and when.
CREATE TABLE IF NOT EXISTS _migrated (
    name        TEXT    PRIMARY KEY,
    at          TEXT    NOT NULL
);
"""


class OutdatedDatabase(RuntimeError):
    """The file was written by an earlier schema: it has an `items` table
    and no `events`, or it holds one event twice by the identity its types
    now declare. It is not migrated; delete it, or load the gatherer
    again."""


#: The tables that carry the properties.
PROPERTY_TABLES = ("events", "_made_items", "_reads")


def create(conn: sqlite3.Connection) -> None:
    """Create every table that is absent. Idempotent.

    Raises:
        OutdatedDatabase: the file predates the current tables.
    """
    names = {n for (n,) in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    file = next((row[2] for row in conn.execute("PRAGMA database_list") if row[1] == "main"), "?")
    if "items" in names and "events" not in names:
        raise OutdatedDatabase(f"{file}: written before the events table (it has `items`); "
                               "delete it or load the gatherer again")
    conn.executescript(SCHEMA)
    if "text" not in {c[1] for c in conn.execute("PRAGMA table_info(events)")}:
        add_column(conn, "events", "text TEXT")                       # a file from before events had text
    for table in ("events", "_made_items", "_preambles"):            # a file from before counts were set
        if "counted" not in {c[1] for c in conn.execute(f"PRAGMA table_info({table})")}:
            add_column(conn, table, "counted INTEGER")
    read_columns = {c[1] for c in conn.execute("PRAGMA table_info(_reads)")}
    for column, kind in (("est_tokens", "INTEGER"), ("real_tokens", "INTEGER"), ("limit_tokens", "INTEGER"),
                         ("preamble_json", "TEXT"), ("sent_tokens", "INTEGER"), ("pid", "INTEGER"),
                         ("pid_started", "TEXT"), ("error_status", "INTEGER"),
                         ("error", "TEXT"), ("answered_at", "TEXT"), ("run", "TEXT")):                           # a file from before reads had them
        if column not in read_columns:
            add_column(conn, "_reads", f"{column} {kind}")
    if "yields" not in {c[1] for c in conn.execute("PRAGMA table_info(_open)")}:     # a file from before holders yielded
        add_column(conn, "_open", "yields INTEGER NOT NULL DEFAULT 0")
    if "identifies" not in {c[1] for c in conn.execute("PRAGMA table_info(event_type_properties)")}:
        add_column(conn, "event_type_properties", "identifies INTEGER NOT NULL DEFAULT 0")
    if "context_id" not in read_columns:                              # a file from before stays
        add_column(conn, "_reads", "context_id INTEGER")
    if "sha" not in {c[1] for c in conn.execute("PRAGMA table_info(_made_items)")}:   # ... and made items kept once
        add_column(conn, "_made_items", "sha TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS _reads_context ON _reads (context_id, read_id)")
    if not stays(conn):                              # by event, as before; a view can't be indexed
        conn.execute("CREATE INDEX IF NOT EXISTS _read_items_row ON _read_items (row_id)")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS _made_items_sha ON _made_items (sha)")
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'events_id'").fetchone() is None:
        with writing(conn):                          # a new file: over no property yet
            index(conn, property_names(conn))
    if not read_log_current(conn):
        with writing(conn):
            read_log(conn)


def add_column(conn: sqlite3.Connection, table: str, column: str) -> None:
    """`ALTER TABLE table ADD COLUMN column`, unless another connection has just added it."""
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column}")
    except sqlite3.OperationalError as exc:
        if "duplicate column name" not in str(exc):
            raise


@contextmanager
def writing(conn: sqlite3.Connection):
    """A transaction that holds the database's write lock from its start (BEGIN IMMEDIATE), committed
    at the end: what it reads of the schema no other connection changes before it writes. Within a
    transaction already begun, that one."""
    with conn:
        if not conn.in_transaction:
            conn.execute("BEGIN IMMEDIATE")
        yield conn


def property_names(conn: sqlite3.Connection) -> List[str]:
    """The properties the gatherer has columns for, in the order they were added."""
    return [c[len(PREFIX):] for c in (r[1] for r in conn.execute("PRAGMA table_info(events)"))
            if c.startswith(PREFIX)]


def identifying_names(conn: sqlite3.Connection) -> List[str]:
    """The properties that are part of an event's identity -- those a type declares `identifies` --
    in the order they were added."""
    marked = {n for (n,) in conn.execute("SELECT DISTINCT name FROM event_type_properties WHERE identifies = 1")}
    return [n for n in property_names(conn) if n in marked]


def index(conn: sqlite3.Connection, names: List[str]) -> None:
    """(Re)make the unique index on events -- one row per event id per
    combination of identifying properties (`identifying_names`) -- and the
    read log's, over all of `names`. ifnull() because SQLite treats NULLs as
    distinct in a unique index, which would let events with a property unset
    duplicate. event_id is left bare for exactly that reason: rows without an
    id never collide, so each is stored.

    Raises:
        OutdatedDatabase: the events already stored hold one event twice by
            the new identity (a file from before properties were identifying).
    """
    keys = "".join(f"ifnull({property_column(n)}, ''), " for n in identifying_names(conn))
    sql = f"CREATE UNIQUE INDEX events_id ON events ({keys}event_id)"
    found = conn.execute("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'events_id'").fetchone()
    if found is None or found[0] != sql:
        conn.execute("DROP INDEX IF EXISTS events_id")
        try:
            conn.execute(sql)
        except sqlite3.IntegrityError as exc:
            file = next((row[2] for row in conn.execute("PRAGMA database_list") if row[1] == "main"), "?")
            raise OutdatedDatabase(f"{file}: holds the same event more than once by its identifying properties "
                                   f"(written before they were declared); delete the gatherer") from exc
    every = "".join(f"ifnull({property_column(n)}, ''), " for n in names)
    sql = f"CREATE INDEX _reads_properties ON _reads ({every}read_id)"
    found = conn.execute("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = '_reads_properties'").fetchone()
    if found is None or found[0] != sql:
        conn.execute("DROP INDEX IF EXISTS _reads_properties")
        conn.execute(sql)
    if "_stays" in {n for (n,) in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}:
        read_log(conn)                               # a read's context is over every property


# ---------------------------------------------------------------- the read log, as stays

#: The read log as it was, one row per item of every read, while migrate.py moves it into stays (`switch`).
OLD_READ_ITEMS = "_read_items_old"


def stays(conn: sqlite3.Connection) -> bool:
    """Whether the file keeps its read log as stays: migrate.py has switched it (`switch`), and `_read_items` is no
    longer the table every file starts with (SCHEMA) -- a view, or about to be one."""
    found = conn.execute("SELECT type FROM sqlite_master WHERE name = '_read_items'").fetchone()
    return not found or found[0] != "table"


def context_key(names: List[str], row: str = "") -> str:
    """SQL for a read's context key: its properties that are set, as a JSON object by name -- `row` the
    alias (or NEW) its columns are read from. Unset ones are left out (json_patch drops nulls), so a
    property added later leaves the key of every read made before it as it was."""
    at = f"{row}." if row else ""
    pairs = ", ".join(f"'{n.replace(chr(39), chr(39) * 2)}', {at}{property_column(n)}" for n in sorted(names))
    return f"json_patch('{{}}', json_object({pairs}))"


def _read_log_sql(conn: sqlite3.Connection) -> dict:
    """{name: CREATE statement} for the read log's trigger that gives each read its context, and once it is kept as
    stays, its view and the view's insert trigger, as this file's properties and tables have them: the view also
    shows the read log as it was while migrate.py moves it (OLD_READ_ITEMS)."""
    names = property_names(conn)
    key = context_key(names, "NEW")
    out = {"_reads_context": ("CREATE TRIGGER _reads_context AFTER INSERT ON _reads WHEN NEW.context_id IS NULL BEGIN "
                              f"INSERT OR IGNORE INTO _contexts (key) VALUES ({key}); "
                              f"UPDATE _reads SET context_id = (SELECT context_id FROM _contexts WHERE key = {key}) "
                              "WHERE read_id = NEW.read_id; END")}
    if not stays(conn):
        return out
    old = conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (OLD_READ_ITEMS,)).fetchone()
    out["_read_items"] = (
        "CREATE VIEW _read_items (read_id, position, row_id, made_id) AS "
        "SELECT r.read_id, s.position, s.row_id, s.made_id FROM _reads r JOIN _stays s "
        "ON s.context_id = r.context_id AND s.from_read <= r.read_id AND (s.to_read IS NULL OR s.to_read >= r.read_id)"
        + (f" UNION ALL SELECT read_id, position, row_id, made_id FROM {OLD_READ_ITEMS}" if old else ""))
    # A read's items written one by one, in order of position, as an older ag writes them (and SQL by hand): at
    # its first, the context's open stays close at the read before it; an item the read before had at the same
    # place, after only items that were too, carries its stay on; any other starts a stay. (ag itself writes a
    # read's items at once: operations.record_read.)
    ctx = "(SELECT context_id FROM _reads WHERE read_id = NEW.read_id)"
    prev = f"(SELECT max(p.read_id) FROM _reads p WHERE p.context_id = {ctx} AND p.read_id < NEW.read_id)"
    made = "coalesce((SELECT f.made_id FROM _made_folded f WHERE f.old = NEW.made_id), NEW.made_id)"
    out["_read_items_insert"] = (
        "CREATE TRIGGER _read_items_insert INSTEAD OF INSERT ON _read_items BEGIN "
        "SELECT RAISE(ABORT, 'no read with this read_id in _reads') WHERE NOT EXISTS "
        "(SELECT 1 FROM _reads WHERE read_id = NEW.read_id AND context_id IS NOT NULL); "
        f"UPDATE _stays SET to_read = {prev} WHERE NEW.position = 0 AND to_read IS NULL AND context_id = {ctx}; "
        f"UPDATE _stays SET to_read = NULL WHERE rowid = (SELECT rowid FROM _stays WHERE context_id = {ctx} "
        f"AND position = NEW.position AND to_read = {prev} AND row_id IS NEW.row_id AND made_id IS {made}) "
        f"AND (NEW.position = 0 OR EXISTS (SELECT 1 FROM _stays WHERE context_id = {ctx} "
        "AND position = NEW.position - 1 AND to_read IS NULL AND from_read < NEW.read_id)); "
        f"INSERT INTO _stays (context_id, position, row_id, made_id, from_read) SELECT {ctx}, NEW.position, "
        f"NEW.row_id, {made}, NEW.read_id WHERE NOT EXISTS "
        f"(SELECT 1 FROM _stays WHERE context_id = {ctx} AND position = NEW.position AND to_read IS NULL); END")
    return out


def read_log_current(conn: sqlite3.Connection) -> bool:
    """Whether the read log's triggers (and view) are as this file needs them (`read_log` has nothing to do)."""
    have = dict(conn.execute("SELECT name, sql FROM sqlite_master WHERE name IN "
                             "('_reads_context', '_read_items_insert') OR (name = '_read_items' AND type = 'view')"))
    return have == _read_log_sql(conn)


def read_log(conn: sqlite3.Connection) -> None:
    """(Re)make the read log's triggers, and its view once it is kept as stays (`_read_log_sql`), where they differ.
    Within a transaction holding the write lock (`writing`)."""
    have = dict(conn.execute("SELECT name, sql FROM sqlite_master WHERE name IN "
                             "('_reads_context', '_read_items_insert') OR (name = '_read_items' AND type = 'view')"))
    want = _read_log_sql(conn)
    if "_read_items" in want and have.get("_read_items") != want["_read_items"]:
        conn.execute("DROP VIEW IF EXISTS _read_items")             # drops its trigger too
        have.pop("_read_items_insert", None)
        conn.execute(want["_read_items"])
    for name in ("_reads_context", "_read_items_insert"):
        if name in want and have.get(name) != want[name]:
            conn.execute(f"DROP TRIGGER IF EXISTS {name}")
            conn.execute(want[name])


def switch(conn: sqlite3.Connection) -> None:
    """Keep the read log as stays from now on: the `_read_items` table set aside as OLD_READ_ITEMS -- shown through
    the view, written to by no one, until migrate.py moves it -- and the view made in its place. What migrate.py does
    once no older ag has the file open: one could no longer open it. Within a transaction holding the write lock."""
    if stays(conn):
        return
    conn.execute(f"ALTER TABLE _read_items RENAME TO {OLD_READ_ITEMS}")
    conn.execute("DROP INDEX IF EXISTS _read_items_row")          # by event: nothing reads it
    read_log(conn)


def add_properties(conn: sqlite3.Connection, names) -> None:
    """A column in each of PROPERTY_TABLES for every one of `names` the gatherer
    has none for yet, and the indexes over them all. Its own transaction, which
    looks at the columns again once it holds the write lock (`writing`): another
    connection may have just added them."""
    names, have = list(dict.fromkeys(names)), property_names(conn)
    if all(n in have for n in names):
        return
    with writing(conn):
        have = property_names(conn)
        new = [n for n in names if n not in have]
        for name in new:
            for table in PROPERTY_TABLES:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {property_column(name)}")
        if new:
            index(conn, have + new)


def connect(gatherer_id: str) -> sqlite3.Connection:
    """Open the gatherer's database, creating the file, its directory and its
    schema if absent."""
    path = db_path(gatherer_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path, timeout=8)
    conn.execute("PRAGMA busy_timeout=8000")
    # WAL with synchronous=NORMAL: a commit does not wait for the disk (with
    # the rollback journal every insert, even a duplicate, paid for fsyncs).
    # A power loss can drop the last few commits, never corrupt the file. WAL
    # also lets readers run while a writer writes. The journal mode is stored
    # in the file, so it holds for every connection.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    # Per connection: every event's type must exist.
    conn.execute("PRAGMA foreign_keys=ON")
    create(conn)
    return conn


# One open connection per database for each thread, kept until the thread ends
# (`release`). `insert` is called once per event, and the server inserts every
# event of a request on every model call, so opening a connection (and re-running
# the schema) each time would dominate its cost. Per thread, as a connection is
# used by one thread at a time: the server answers each channel's requests on a
# thread of its own, side by side (ag/ag_harness/server/).
_LOCAL = threading.local()


def connection(gatherer_id: str) -> sqlite3.Connection:
    """This thread's connection to the gatherer's database, opened on first use."""
    path = db_path(gatherer_id)
    connections = getattr(_LOCAL, "connections", None)
    if connections is None:
        connections = _LOCAL.connections = {}
    conn = connections.get(path)
    if conn is None:
        conn = connections[path] = connect(gatherer_id)
    return conn


def opened(gatherer_id: str) -> Optional[sqlite3.Connection]:
    """This thread's connection to the gatherer's database, if `connection` has opened one."""
    return (getattr(_LOCAL, "connections", None) or {}).get(db_path(gatherer_id))


def release() -> None:
    """Close this thread's connections (`connection`): what a thread that ends does."""
    connections, _LOCAL.connections = getattr(_LOCAL, "connections", None) or {}, {}
    for conn in connections.values():
        conn.close()
