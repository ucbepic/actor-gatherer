"""What files.py's `_git` found in a database of ag's, kept in the dashboard's own (<home>/dashboard.db): the calls that
ran git so as to change files, the files they changed, and the work trees they made. Finding them reads every file
record of every group in the database (every one in the home's one database: about ten seconds on a home of a few GB),
so a dashboard started again takes what was kept and reads on from where it was kept up to. Only a cache: with
nothing kept, the database is read from its start, as before.

Table `git_read`, one row per database read:

    db     its path
    last   the row of its `events` read up to
    mark   what that row was (`mark`: when it was stored, its type, its channel). Not the same row now: the database
           was replaced at that path, and is read again from its start
    rules  RULES, when it was read. Other rules now: it is read again from its start

Table `git_found`, what was found in it, one row per thing, read back in the order of the record it was found in:

    db, row_id      the database and its record
    kind            CALL: a call that ran git so as to change files (`call`, `at`, `session`); CHANGED: a file such a
                    call changed (`path`, `how`: created, modified or deleted, `call`, `at`, `session`); TREE: a work
                    tree a call made (`path`: its root, `call`, `at`, `session`)
    call            the call's id
    at              when its record was stored (seconds)
    session         the session (channel) it was found in

Written by whichever dashboard reads on: several may run on one home, and a row found twice is kept once. It names no
group and no actor, so a move, a merge or a discard leaves it as it is (store.py): it follows the database's records,
which those do not change."""
import sqlite3
from typing import List, Optional, Tuple

from . import store

#: Raised when what `_git` finds changes -- runs_git's rules, what it reads of a record: everything kept is found
#: again, once, with the new rules.
RULES = 1
CALL, CHANGED, TREE = "call", "changed", "tree"
#: Rows read on with nothing found are kept as read at most this many behind: a dashboard started again reads them again.
KEEP_ROWS = 5000
#: Seconds a write waits for another's on dashboard.db: past it, what was found waits for the next read's.
WAIT = 0.5

#: (row_id, kind, call, at, session, path, how): one thing found, as kept and as `_git` takes it.
Found = Tuple[int, str, str, Optional[float], str, Optional[str], Optional[str]]

store.table("git_read", """CREATE TABLE IF NOT EXISTS git_read (
    db    TEXT PRIMARY KEY,
    last  INTEGER NOT NULL,
    mark  TEXT NOT NULL,
    rules INTEGER NOT NULL
)""")
store.table("git_found", """CREATE TABLE IF NOT EXISTS git_found (
    db      TEXT NOT NULL,
    row_id  INTEGER NOT NULL,
    kind    TEXT NOT NULL,
    call    TEXT NOT NULL,
    at      REAL,
    session TEXT NOT NULL,
    path    TEXT,
    how     TEXT,
    PRIMARY KEY (db, row_id, kind, call)
) WITHOUT ROWID""")


def mark(conn, row_id: int) -> Optional[str]:
    """What row `row_id` of the database `conn` is open on is: when it was stored, its type and its channel; None: no
    such row."""
    r = conn.execute("SELECT inserted_at, event_type_id, ifnull(p_channel, '') FROM events WHERE row_id = ?",
                     (row_id,)).fetchone()
    return None if r is None else f"{r[0]}|{r[1]}|{r[2]}"


def load(conn, db: str) -> Tuple[int, List[Found]]:
    """What is kept of the database `db` (`conn`, open on it): (the row it was read up to, what was found in it, in the
    order of its records) -- (0, []): nothing kept, or what is kept is of a database replaced since, or of other rules
    (module doc)."""
    with store.reading() as kept:
        if kept is None or not store.has(kept, "git_read") or not store.has(kept, "git_found"):
            return 0, []
        r = kept.execute("SELECT last, mark, rules FROM git_read WHERE db = ?", (db,)).fetchone()
        if r is None or r[2] != RULES or r[0] <= 0 or mark(conn, r[0]) != r[1]:
            return 0, []
        return r[0], kept.execute("SELECT row_id, kind, call, at, session, path, how FROM git_found "
                                  "WHERE db = ? AND row_id <= ? ORDER BY row_id", (db, r[0])).fetchall()


def save(conn, db: str, last: int, found: List[Found], fresh: bool) -> bool:
    """Keep what was found in the database `db` (`conn`, open on it) up to its row `last` -- `fresh`: in place of
    whatever is kept of it, else with it. False: not kept now (dashboard.db locked by another's write past WAIT seconds,
    or row `last` gone), for the caller to keep with the next."""
    m = mark(conn, last)
    if m is None:
        return False
    try:
        with store.transaction("git_read", "git_found", timeout=WAIT) as w:
            if fresh:
                w.execute("DELETE FROM git_found WHERE db = ?", (db,))
                w.execute("DELETE FROM git_read WHERE db = ?", (db,))
            w.executemany("INSERT OR IGNORE INTO git_found (db, row_id, kind, call, at, session, path, how) "
                          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [(db, *f) for f in found])
            w.execute("INSERT INTO git_read (db, last, mark, rules) VALUES (?, ?, ?, ?) ON CONFLICT (db) DO UPDATE "
                      "SET last = excluded.last, mark = excluded.mark, rules = excluded.rules "
                      "WHERE excluded.last > git_read.last", (db, last, m, RULES))
    except sqlite3.OperationalError:
        return False
    return True
