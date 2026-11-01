"""A gatherer's file moved to the current layout once (schema.py; `_migrated` "stays"):

    read log      its `_read_items` table, one row per item of every read, into stays, each read's items exactly
                  as they were, in order -- once no older ag has the file open (`older`): an older ag can't open
                  a file whose read log is stays, and one that runs keeps the file open. Till then it waits, and
                  says what it waits for; ag reads and writes the read log as it was meanwhile
    made items    the copies an older ag stored of one made item (one for every read that sent it) folded into
                  the first: the reads name it, and `_made_folded` maps each copy to it
    the file      the space this frees given back to the disk (VACUUM), when nothing else has the file open
                  and the disk has room for it; else the file keeps it, and fills it before it grows again

ag runs it when it starts (ag/cli/main.py), in the background, for each gatherer `due`; by hand:

    ag home migrate [<gatherer> ...] [--no-vacuum] [--now]      --now: without waiting for an older ag

It works beside running sessions (schema.py's triggers take the writes of an older ag that slipped in): it reads
what it moves without holding the write lock, then writes in short transactions (the switch; the read log; the made
items), each well under the 8 s other writers wait (schema.connect). A later run, an hour on, empties `_made_folded`
(no read made during the fold is still going) and gives back what it can then.
"""

import json
import os
import re
import shutil
import sqlite3
import subprocess
import time
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, List, Optional, Tuple

DONE = "stays"                  # the move's name in `_migrated`
OLD_READ_ITEMS = "_read_items_old"
FOLDED_FOR = timedelta(hours=1)  # how long a fold's map is kept: longer than any read made while it ran
FREE_WORTH = 64 * 1024 * 1024   # the least free space in a file worth a VACUUM ...
FREE_SHARE = 0.10               # ... and the least share of it
TRIES = 5                       # a transaction tried again while another writer holds the lock
ROOM = 256 * 1024 * 1024        # the least free disk the move starts with: what it writes goes to the WAL first
#: A process that reads the file and never opens it as ag does (schema.connect): a dashboard -- `ag` alone,
#: `ag dashboard`, `python -m ag_dashboard`. An older one goes on reading a file moved to stays (the view).
READER = re.compile(r"(-m ag_dashboard\b|/ag(\s+dashboard\b.*)?\s*$)")


def _connect_ro(path: str) -> Optional[sqlite3.Connection]:
    if not os.path.isfile(path):
        return None
    try:
        return sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2)
    except sqlite3.Error:
        return None


def due(path: str) -> Optional[str]:
    """What the gatherer file at `path` is due, cheaply, without opening it for writing: "move" (its read log is
    still one row per item, or is being moved), "tidy" (a fold's map an hour old to empty, or free space worth giving
    back), or None."""
    conn = _connect_ro(path)
    if conn is None:
        return None
    try:
        tables = dict(conn.execute("SELECT name, type FROM sqlite_master WHERE name IN "
                                   f"('_read_items', '{OLD_READ_ITEMS}', '_made_folded', '_migrated')"))
        if "_read_items" not in tables:                  # no read log yet: a file being made
            return None
        if tables["_read_items"] == "table" or OLD_READ_ITEMS in tables:
            return "move"
        moved = "_migrated" in tables and conn.execute("SELECT at FROM _migrated WHERE name = ?", (DONE,)).fetchone()
        if not moved:
            return None
        if "_made_folded" in tables and _since(moved[0]) >= FOLDED_FOR and conn.execute(
                "SELECT EXISTS (SELECT 1 FROM _made_folded)").fetchone()[0]:
            return "tidy"
        return "tidy" if _worth_vacuum(conn) else None
    except sqlite3.Error:
        return None
    finally:
        conn.close()


def _since(at: str) -> timedelta:
    try:
        return datetime.now(timezone.utc) - datetime.fromisoformat(at)
    except ValueError:
        return timedelta(0)


def _worth_vacuum(conn: sqlite3.Connection) -> bool:
    size = conn.execute("PRAGMA page_size").fetchone()[0]
    pages, free = conn.execute("PRAGMA page_count").fetchone()[0], conn.execute("PRAGMA freelist_count").fetchone()[0]
    return free * size >= FREE_WORTH and free >= FREE_SHARE * pages


def _tables(conn: sqlite3.Connection) -> set:
    return {n for (n,) in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def _retry(conn: sqlite3.Connection, write: Callable[[], None]) -> None:
    """`write` in a transaction holding the write lock (schema.writing), tried again while others hold it."""
    from .schema import writing
    for attempt in range(TRIES):
        try:
            with writing(conn):
                write()
            return
        except sqlite3.OperationalError as exc:
            if "locked" not in str(exc) and "busy" not in str(exc) or attempt == TRIES - 1:
                raise
            time.sleep(1 + attempt)


# ---------------------------------------------------------------- what else has the file open

def _others(path: str) -> Optional[set]:
    """The processes besides this one and the one that started it (`ag`, which runs the harness once it has) that
    have the file open: by lsof, else /proc; None when neither can tell."""
    files = [p for p in (path, path + "-wal", path + "-shm") if os.path.exists(p)]
    lsof = shutil.which("lsof") or next((p for p in ("/usr/sbin/lsof", "/usr/bin/lsof") if os.path.exists(p)), None)
    found: Optional[set] = None
    if lsof:
        try:
            done = subprocess.run([lsof, "-t", "--", *files], capture_output=True, text=True, timeout=30)
            found = {int(p) for p in done.stdout.split() if p.isdigit()}
        except (OSError, subprocess.SubprocessError):
            found = None
    if found is None and os.path.isdir("/proc/self/fd"):
        wanted, found = {os.path.realpath(f) for f in files}, set()
        for pid in (p for p in os.listdir("/proc") if p.isdigit()):
            try:
                fds = os.listdir(f"/proc/{pid}/fd")
            except OSError:
                continue
            for fd in fds:
                try:
                    if os.path.realpath(os.readlink(f"/proc/{pid}/fd/{fd}")) in wanted:
                        found.add(int(pid))
                        break
                except OSError:
                    continue
    return None if found is None else found - {os.getpid(), os.getppid()}


def _process(pid: int) -> Optional[Tuple[float, str]]:
    """(when process `pid` started, in seconds since the epoch; its command line), or None when it has ended."""
    try:
        out = subprocess.run(["ps", "-o", "lstart=,command=", "-p", str(pid)], capture_output=True, text=True,
                             timeout=10, env={**os.environ, "LC_ALL": "C"}).stdout.strip()
        started = time.mktime(time.strptime(" ".join(out.split()[:5]), "%a %b %d %H:%M:%S %Y"))
        return started, " ".join(out.split()[5:])
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def code_since() -> float:
    """When the code that keeps the read log as stays was put where it runs from: a process started before runs the
    code from before (an older ag), which can't open a file moved to stays."""
    here = os.path.dirname(os.path.abspath(__file__))
    return max(os.path.getmtime(os.path.join(here, f)) for f in ("migrate.py", "schema.py", "operations.py"))


def older(path: str) -> Optional[List[str]]:
    """The processes of an older ag that have the file open -- each started before this code was (`code_since`) and
    not a dashboard (READER) -- as "<pid> (<command>)"; None when what has it open can't be told."""
    others = _others(path)
    if others is None:
        return None
    since, out = code_since(), []
    for pid in sorted(others):
        found = _process(pid)
        if found and found[0] < since - 1 and not READER.search(found[1]):
            out.append(f"{pid} ({found[1][:120]})")
    return out


# ---------------------------------------------------------------- the plan, read without the write lock

def _plan_made(conn: sqlite3.Connection) -> dict:
    """The fold of the made items as they are now: {"top": the newest made_id seen, "kept": {sha: made_id},
    "copies": {made_id: the kept one}, "set": {kept made_id: (sha, tokens, counted)} for each kept one an older ag
    made, to give its sha and best count, "counts": {kept made_id: (tokens, counted)} for one a current ag made}.
    The kept one of an item: the one that has its sha (a current ag made it), else the first; its count, a copy's
    the provider counted when it has none."""
    from .operations import made_sha
    kept: Dict[str, int] = {}
    for sha, made_id in conn.execute("SELECT sha, made_id FROM _made_items WHERE sha IS NOT NULL"):
        kept[sha] = made_id
    copies: Dict[int, int] = {}
    best: Dict[int, Tuple[Optional[int], Optional[int]]] = {}   # kept made_id -> (tokens, counted) to give it
    shas: Dict[int, str] = {}
    top = 0
    for made_id, name, source, item_json, tokens, counted in conn.execute(
            "SELECT made_id, name, source, item_json, tokens, counted FROM _made_items WHERE sha IS NULL ORDER BY made_id"):
        top = max(top, made_id)
        sha = made_sha(name, source, item_json)
        keep = kept.setdefault(sha, made_id)
        if keep == made_id:
            shas[made_id] = sha
            best[made_id] = (tokens, counted)
        else:
            copies[made_id] = keep
            if counted and not (best.get(keep) or (None, None))[1]:
                best[keep] = (tokens, counted)          # the provider's count, where the kept one has the estimate
    top = max([top] + list(kept.values()))
    return {"top": top, "kept": kept, "copies": copies,
            "set": {m: (shas[m], *best[m]) for m in shas}, "counts": {m: best[m] for m in best if m not in shas}}


def _plan_stays(conn: sqlite3.Connection, copies: Dict[int, int]) -> Tuple[List[tuple], int]:
    """The old read log as stays: [(context_id, position, row_id, made_id, from_read, to_read)], every one ended
    (a read a current ag logs next picks up where it ends: operations.log_items), and how many rows it had. Each
    read's items as they were, a copy named by its kept one. Each read's context is set first (`_set_contexts`)."""
    context_of = dict(conn.execute("SELECT read_id, context_id FROM _reads"))
    stays: List[list] = []
    open_: Dict[int, Tuple[int, List[int]]] = {}       # context -> (its latest read, the index of each stay of it)
    rows = 0

    def logged(read_id: int, items: List[tuple]) -> None:
        if read_id not in context_of:                    # rows of a read no longer in _reads: shown by nothing
            return
        ctx = context_of[read_id]
        if ctx is None:
            raise RuntimeError(f"read {read_id} has no context: set them first (_set_contexts)")
        prev, had = open_.get(ctx, (None, []))
        same = 0
        while same < min(len(had), len(items)) and tuple(stays[had[same]][2:4]) == items[same]:
            same += 1
        for i in had[same:]:
            stays[i][5] = prev
        now = had[:same]
        for position in range(same, len(items)):
            stays.append([ctx, position, items[position][0], items[position][1], read_id, None])
            now.append(len(stays) - 1)
        open_[ctx] = (read_id, now)

    current, items = None, []
    for read_id, position, row_id, made_id in conn.execute(
            f"SELECT read_id, position, row_id, made_id FROM {OLD_READ_ITEMS} ORDER BY read_id, position"):
        rows += 1
        if read_id != current:
            if current is not None:
                logged(current, items)
            current, items = read_id, []
        items.append((row_id, copies.get(made_id, made_id) if made_id is not None else None))
    if current is not None:
        logged(current, items)
    for last, had in open_.values():
        for i in had:
            stays[i][5] = last
    return [tuple(s) for s in stays], rows


# ---------------------------------------------------------------- the writes

def _set_contexts(conn: sqlite3.Connection) -> None:
    """Each read logged before stays its context (`_reads.context_id`), as the read log's trigger sets a new one's."""
    from .schema import context_key, property_names
    key = context_key(property_names(conn))
    conn.execute(f"INSERT OR IGNORE INTO _contexts (key) SELECT DISTINCT {key} FROM _reads WHERE context_id IS NULL")
    conn.execute(f"UPDATE _reads SET context_id = (SELECT c.context_id FROM _contexts c WHERE c.key = {key}) "
                 "WHERE context_id IS NULL")


def _switch(conn: sqlite3.Connection) -> None:
    """The read log kept as stays from now on (schema.switch), each read's context set first."""
    from .schema import switch
    _set_contexts(conn)
    switch(conn)


def _move_read_log(conn: sqlite3.Connection, stays: List[tuple]) -> bool:
    """The old read log replaced by `stays`, at once: False when another run moved it first."""
    from .schema import read_log
    if OLD_READ_ITEMS not in _tables(conn):
        return False
    conn.executemany("INSERT INTO _stays (context_id, position, row_id, made_id, from_read, to_read) "
                     "VALUES (?, ?, ?, ?, ?, ?)", stays)
    conn.execute(f"DROP TABLE {OLD_READ_ITEMS}")
    read_log(conn)                                             # the view, without it
    return True


def _fold_made(conn: sqlite3.Connection, plan: dict) -> int:
    """The copies of each made item folded into the kept one (`_plan_made`), the table rebuilt without them (a
    DROP frees their pages without writing them again, as a DELETE would). A current ag that made one of them since
    the plan was read keeps it: it is the item's kept one. Returns how many copies went."""
    copies, kept, top = dict(plan["copies"]), plan["kept"], plan["top"]
    since = dict(conn.execute("SELECT sha, made_id FROM _made_items WHERE made_id > ? AND sha IS NOT NULL", (top,)))
    give = dict(plan["set"])
    for sha, made_id in since.items():                         # made again since the plan: that one is kept
        old = kept.get(sha)
        if old is not None and old != made_id:
            give.pop(old, None)
            copies[old] = made_id
            for c, k in list(copies.items()):
                if k == old:
                    copies[c] = made_id
    if copies:
        _rebuild(conn, copies)
    conn.executemany("UPDATE _made_items SET sha = ?, tokens = coalesce(?, tokens), counted = coalesce(?, counted) "
                     "WHERE made_id = ?", [(sha, t, c, m) for m, (sha, t, c) in give.items()])
    conn.executemany("UPDATE _made_items SET tokens = ?, counted = ? WHERE made_id = ? AND counted IS NULL",
                     [(t, c, m) for m, (t, c) in plan["counts"].items() if c])
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS _made_items_sha ON _made_items (sha)")
    return len(copies)


def _rebuild(conn: sqlite3.Connection, copies: Dict[int, int]) -> None:
    """`_made_items` without `copies` ({copy: the kept one}), each mapped in `_made_folded`, and the stays that name
    one naming the kept one."""
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS folding (old INTEGER PRIMARY KEY, made_id INTEGER NOT NULL)")
    conn.execute("DELETE FROM temp.folding")
    conn.executemany("INSERT INTO temp.folding (old, made_id) VALUES (?, ?)", copies.items())
    conn.execute("INSERT OR REPLACE INTO _made_folded (old, made_id) SELECT old, made_id FROM temp.folding")
    conn.execute("UPDATE _stays SET made_id = (SELECT f.made_id FROM temp.folding f WHERE f.old = _stays.made_id) "
                 "WHERE made_id IN (SELECT old FROM temp.folding)")    # named since the read log moved
    sql = conn.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '_made_items'").fetchone()[0]
    conn.execute(sql.replace("_made_items", "_made_items_kept", 1))
    conn.execute("INSERT INTO _made_items_kept SELECT * FROM _made_items WHERE made_id NOT IN (SELECT old FROM temp.folding)")
    conn.execute("DROP TABLE _made_items")
    conn.execute("ALTER TABLE _made_items_kept RENAME TO _made_items")
    conn.execute("DROP TABLE temp.folding")


def _mark(conn: sqlite3.Connection) -> None:
    conn.execute("INSERT OR REPLACE INTO _migrated (name, at) VALUES (?, ?)", (DONE, datetime.now(timezone.utc).isoformat()))


# ---------------------------------------------------------------- the space given back

def _vacuum(conn: sqlite3.Connection, path: str) -> str:
    """The file's free space given back (VACUUM), or why not."""
    if not _worth_vacuum(conn):
        return "nothing worth giving back"
    others = _others(path)
    if others is None:
        return "kept: can't tell what else has it open (no lsof, no /proc)"
    if others:
        return (f"kept until nothing else has it open (process{'es' if len(others) > 1 else ''} "
                f"{', '.join(map(str, sorted(others)))}): ag fills it before the file grows")
    size = conn.execute("PRAGMA page_size").fetchone()[0]
    used = (conn.execute("PRAGMA page_count").fetchone()[0] - conn.execute("PRAGMA freelist_count").fetchone()[0]) * size
    free = shutil.disk_usage(os.path.dirname(path)).free
    if free < 2 * used + FREE_WORTH:                           # a copy of what is kept, and the WAL it is written to
        return f"kept: the disk has {free / 1e9:.1f} GB free, and giving it back needs {2 * used / 1e9:.1f} GB"
    conn.execute("VACUUM")
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    return "given back"


# ---------------------------------------------------------------- one gatherer

def migrate(gatherer_id: str, vacuum: bool = True, now: bool = False) -> dict:
    """Move the gatherer's file to the current layout (the module's doc): {"gatherer", "waiting" (why the read log
    was not moved yet: None when it was, or had been), "read_items" (the old read log's rows; None: nothing moved),
    "stays", "made_before", "made_after", "folded_map" ("emptied" when a later run emptied it), "vacuum" (what came of
    giving the space back), "bytes_before", "bytes_after"}. `now`: without waiting for an older ag (`older`)."""
    from .paths import db_path
    from .schema import connect, stays as kept_as_stays
    path = db_path(gatherer_id)
    out = {"gatherer": gatherer_id, "waiting": None, "read_items": None, "stays": None, "made_before": None,
           "made_after": None, "folded_map": None, "vacuum": None, "bytes_before": _bytes(path)}
    conn = connect(gatherer_id)
    try:
        if not kept_as_stays(conn):
            olds = [] if now else older(path)
            free = shutil.disk_usage(os.path.dirname(path)).free
            if olds is None:
                out["waiting"] = ("can't tell whether an older ag has it open (no lsof, no /proc): once none runs "
                                  "(`ag stop`), `ag home migrate --now`")
            elif olds:
                out["waiting"] = (f"an older ag has it open -- {'; '.join(olds)} -- and could not open it once moved: "
                                  "it moves once that stops (`ag stop`), at ag's next start")
            elif free < ROOM:
                out["waiting"] = f"the disk has {free / 1e6:.0f} MB free; it moves with at least {ROOM / 1e6:.0f} MB"
            else:
                _retry(conn, lambda: _switch(conn))
        if OLD_READ_ITEMS in _tables(conn):
            out["made_before"] = conn.execute("SELECT count(*) FROM _made_items").fetchone()[0]
            plan = _plan_made(conn)
            stays, out["read_items"] = _plan_stays(conn, plan["copies"])
            moved: List[bool] = []
            _retry(conn, lambda: moved.append(_move_read_log(conn, stays)))
            if moved and moved[-1]:
                _retry(conn, lambda: (_fold_made(conn, plan), _mark(conn)))
            out["stays"] = conn.execute("SELECT count(*) FROM _stays").fetchone()[0]
            out["made_after"] = conn.execute("SELECT count(*) FROM _made_items").fetchone()[0]
        elif kept_as_stays(conn):
            at = conn.execute("SELECT at FROM _migrated WHERE name = ?", (DONE,)).fetchone()
            if at and _since(at[0]) >= FOLDED_FOR and conn.execute("SELECT EXISTS (SELECT 1 FROM _made_folded)").fetchone()[0]:
                _retry(conn, lambda: conn.execute("DELETE FROM _made_folded"))
                out["folded_map"] = "emptied"
        if vacuum and out["waiting"] is None:
            out["vacuum"] = _vacuum(conn, path)
    finally:
        conn.close()
    out["bytes_after"] = _bytes(path)
    return out


def _bytes(path: str) -> int:
    return sum(os.path.getsize(p) for p in (path, path + "-wal") if os.path.exists(p))


def said(result: dict) -> str:
    """A line for one gatherer's result (`migrate`)."""
    parts = []
    if result.get("waiting"):
        parts.append(f"read log not moved yet: {result['waiting']}")
    if result.get("read_items") is not None:
        parts.append(f"read log {result['read_items']:,} rows -> {result['stays']:,} stays; "
                     f"made items {result['made_before']:,} -> {result['made_after']:,}")
    if result.get("folded_map"):
        parts.append("map of folded made items emptied")
    if result.get("vacuum"):
        parts.append(f"free space {result['vacuum']}")
    parts.append(f"file {result['bytes_before'] / 1e6:,.0f} MB -> {result['bytes_after'] / 1e6:,.0f} MB")
    return f"{result['gatherer']}: " + "; ".join(parts)


def as_json(result: dict) -> str:
    return json.dumps(result)
