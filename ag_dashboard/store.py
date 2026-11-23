"""The dashboard's own database, <home>/dashboard.db, and how the dashboard opens a gatherer's.

Each table of dashboard.db is declared once, by the module that keeps it (`table`): its statements (CREATE TABLE, its
indexes), the columns added to it since, and what becomes of its rows when what they name changes:

    an actor moves to another group (groups.py's `move`)   a table with `actor` (the column naming an actor: a channel,
                                                           or a session's id) has that actor's rows moved; `on_move`, a
                                                           function of the table's own, does instead what it needs
    a group is merged into another (groups.py's `merge`)   `merged`: MOVE (its rows to the other group's name), DROP
                                                           (the group is gone: so are they), STAY (left: another part
                                                           of the dashboard follows them), or a function of its own
    an actor is discarded (sessions.py's `discard`)        a table with `actor` loses its rows, unless `discarded` is
                                                           False (a row that stands for something outside the table)

and `tidy`, run after any of those has changed it. A table that names a group (a `gatherer` column) must say what a
merge does to it: there is no default, so one added later is decided, not forgotten.

A table is made when it is first written to (`write`, `transaction`), not before -- some tell "never kept" by its
absence (seen.py's) -- and, once made, given the columns added since, once per database a process opens. Read with
`read()`, read-only, None while the file does not exist, and `has()`: a missing file or table is nothing kept; any
other error (the database locked past TIMEOUT seconds) is raised, never taken for nothing kept.

`gatherer(name)` opens a gatherer's database (ag's: the home's one, or the gatherer's own), read-only."""
import importlib
import os
import random
import re
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Callable, Dict, Iterable, Iterator, Optional, Sequence, Set, Tuple, Union

from . import home

TIMEOUT = 8                      # seconds a connection waits on another's lock before it raises

MOVE, DROP, STAY = "move", "drop", "stay"
GROUP_COLUMN = re.compile(r"[(,]\s*gatherer\s+\w")       # a table's `gatherer` column, in its CREATE TABLE
Merged = Union[str, Callable[[sqlite3.Connection, str, str], None]]


@dataclass(frozen=True)
class Table:
    name: str
    statements: Tuple[str, ...]
    added: Tuple[Tuple[str, str], ...] = ()                       # (column, its type) added since the table was first made
    made: Optional[Callable[[sqlite3.Connection], None]] = None   # once, as it is made: what is copied in from before
    on_added: Optional[Callable[[sqlite3.Connection, str], None]] = None   # after a column is added to a table from before
    actor: Optional[str] = None                                   # the column naming an actor
    merged: Optional[Merged] = None
    on_move: Optional[Callable[[sqlite3.Connection, str, str, Sequence[str]], None]] = None
    discarded: bool = True
    tidy: Optional[Callable[[sqlite3.Connection, str], None]] = None


#: The modules that declare tables (a test checks it is all of them): each imported before a move, a merge or a
#: discard, so every table is there to follow it, whatever the process has loaded so far.
OWNERS = ("sessions", "saved", "seen", "avatars", "tasks", "hiding", "titles", "merges", "gatherer_folders", "folders",
          "branches", "coordination", "git_found")
TABLES: Dict[str, Table] = {}
# (database file) -> (its schema's version then, the tables made and given their columns at it), in this process: a
# change to its schema since (another process's, or a table dropped and made again) has them looked at again. The file
# is told by its path, device and inode, and by a token kept in it (`PRAGMA user_version`, set once, when it is 0): a
# file deleted and made again at the same path can be given the same inode (Linux does), and a new one's schema
# version can match the old one's, but a new file's token is 0 -- it is looked at again.
_made: Dict[tuple, Tuple[int, Set[str]]] = {}
_lock = threading.Lock()


def table(name: str, *statements: str, added: Iterable[Tuple[str, str]] = (), made=None, on_added=None,
          actor: Optional[str] = None, merged: Optional[Merged] = None, on_move=None, discarded: bool = True,
          tidy=None) -> Table:
    """The table `name` declared (module doc) -> it. ValueError for one naming a group (a `gatherer` column) that does
    not say what a merge does to it."""
    if not statements or name not in statements[0]:
        raise ValueError(f"{name}: its CREATE TABLE first")
    if merged is None and GROUP_COLUMN.search(statements[0]):
        raise ValueError(f"{name} names a group: say what a merge does to its rows (merged=MOVE, DROP, STAY or a function)")
    if isinstance(merged, str) and merged not in (MOVE, DROP, STAY):
        raise ValueError(f"{name}: merged is MOVE, DROP, STAY or a function")
    t = Table(name, tuple(statements), tuple(added), made, on_added, actor, merged, on_move, discarded, tidy)
    TABLES[name] = t
    return t


def path() -> str:
    return os.path.join(home.HOME, "dashboard.db")


def has(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def columns(conn: sqlite3.Connection, name: str) -> Set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({name})")}


def read(rows: bool = False) -> Optional[sqlite3.Connection]:
    """dashboard.db, read-only (`rows`: as sqlite3.Row); None while the file does not exist."""
    if not os.path.exists(path()):
        return None
    conn = sqlite3.connect(f"file:{path()}?mode=ro", uri=True, timeout=TIMEOUT)
    if rows:
        conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def reading(rows: bool = False) -> Iterator[Optional[sqlite3.Connection]]:
    """`read()`, closed after."""
    conn = read(rows)
    try:
        yield conn
    finally:
        if conn is not None:
            conn.close()


def write(*tables: str, rows: bool = False, timeout: float = TIMEOUT) -> sqlite3.Connection:
    """dashboard.db for a change (autocommit; `transaction` for several statements as one), `tables` made first;
    waiting `timeout` seconds at most on another's lock."""
    os.makedirs(os.path.dirname(path()), exist_ok=True)
    conn = sqlite3.connect(path(), timeout=timeout, isolation_level=None)
    if rows:
        conn.row_factory = sqlite3.Row
    try:
        prepare(conn, tables)
    except BaseException:
        conn.close()
        raise
    return conn


@contextmanager
def transaction(*tables: str, rows: bool = False, timeout: float = TIMEOUT) -> Iterator[sqlite3.Connection]:
    """`write(*tables)` in a transaction of its own (BEGIN IMMEDIATE): committed at the end, rolled back if it raises."""
    conn = write(*tables, rows=rows, timeout=timeout)
    try:
        conn.execute("BEGIN IMMEDIATE")
        yield conn
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


def prepare(conn: sqlite3.Connection, tables: Iterable[str]) -> None:
    """`tables` made on `conn` (dashboard.db, autocommit), and given the columns added since: once per database file."""
    st = os.stat(path())
    token = conn.execute("PRAGMA user_version").fetchone()[0]
    if not token:                                       # a file new to this store (or from before it): told apart
        token = random.randint(1, 2 ** 31 - 1)
        conn.execute(f"PRAGMA user_version = {token}")
        token = conn.execute("PRAGMA user_version").fetchone()[0]   # (another process's, if it set one first)
    key = (path(), st.st_dev, st.st_ino, token)
    version = conn.execute("PRAGMA schema_version").fetchone()[0]
    with _lock:
        seen, done = _made.get(key, (None, set()))
        done = set(done) if seen == version else set()
        wanted = [TABLES[t] for t in tables if t not in done]
    if not wanted:
        return
    for t in wanted:
        if not has(conn, t.name):
            conn.execute("BEGIN IMMEDIATE")
            try:
                if not has(conn, t.name):                # another made it meanwhile
                    for statement in t.statements:
                        conn.execute(statement)
                    if t.made:
                        t.made(conn)
                conn.execute("COMMIT")
            except BaseException:
                if conn.in_transaction:
                    conn.execute("ROLLBACK")
                raise
        else:
            have = columns(conn, t.name)
            for name, kind in t.added:
                if name in have:
                    continue
                try:
                    conn.execute(f"ALTER TABLE {t.name} ADD COLUMN {name} {kind}")
                except sqlite3.OperationalError:         # another added it meanwhile
                    continue
                if t.on_added:
                    t.on_added(conn, name)
            for statement in t.statements[1:]:          # its indexes: one added since is made too
                conn.execute(statement)
        done.add(t.name)
    with _lock:
        _made[key] = (conn.execute("PRAGMA schema_version").fetchone()[0], done)


def _present(conn: sqlite3.Connection) -> Iterator[Table]:
    for owner in OWNERS:
        importlib.import_module(f"{__package__}.{owner}")
    for t in list(TABLES.values()):
        if has(conn, t.name):
            yield t


def _tidy(conn: sqlite3.Connection, changed: Iterable[Table], *gatherers: str) -> None:
    """Each changed table's `tidy` for `gatherers`, once every table has changed: what one table's tidy reads of another
    (tasks.py's: `tasked` and `tasks`) is then as the change left it, whatever order the tables were declared in."""
    for t in changed:
        if t.tidy:
            for g in gatherers:
                t.tidy(conn, g)


def move_actors(conn: sqlite3.Connection, gatherer: str, to: str, actors: Sequence[str]) -> None:
    """In `conn`'s transaction: the rows of `actors` (channels, and so session ids) moved from the group `gatherer` to
    `to`, in every table that keeps any (module doc)."""
    if not actors:
        return
    marks = ", ".join("?" * len(actors))
    changed = []
    for t in list(_present(conn)):
        if t.on_move:
            t.on_move(conn, gatherer, to, actors)
        elif t.actor:
            conn.execute(f"UPDATE {t.name} SET gatherer = ? WHERE gatherer = ? AND {t.actor} IN ({marks})",
                         (to, gatherer, *actors))
        else:
            continue
        changed.append(t)
    _tidy(conn, changed, gatherer, to)


def merge_group(conn: sqlite3.Connection, gatherer: str, to: str) -> None:
    """In `conn`'s transaction: every table's rows of the group `gatherer`, merged into `to`, as each says (module doc)."""
    changed = []
    for t in list(_present(conn)):
        if t.merged == MOVE:
            conn.execute(f"UPDATE {t.name} SET gatherer = ? WHERE gatherer = ?", (to, gatherer))
        elif t.merged == DROP:
            conn.execute(f"DELETE FROM {t.name} WHERE gatherer = ?", (gatherer,))
        elif callable(t.merged):
            t.merged(conn, gatherer, to)
        else:
            continue
        changed.append(t)
    _tidy(conn, changed, to)


def discard_actor(conn: sqlite3.Connection, gatherer: str, actor: str) -> None:
    """In `conn`'s transaction: every row kept of the actor `actor` of `gatherer`, gone (module doc)."""
    changed = []
    for t in list(_present(conn)):
        if t.actor and t.discarded:
            conn.execute(f"DELETE FROM {t.name} WHERE gatherer = ? AND {t.actor} = ?", (gatherer, actor))
            changed.append(t)
    _tidy(conn, changed, gatherer)


def gatherer(name: str) -> Optional[sqlite3.Connection]:
    """The gatherer `name`'s database (ag's), read-only, its rows as sqlite3.Row; None while it has none."""
    p = home.db_path(name)
    if not os.path.exists(p):
        return None
    conn = sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=TIMEOUT)
    conn.row_factory = sqlite3.Row
    return conn
