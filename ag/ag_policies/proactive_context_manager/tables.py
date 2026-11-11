"""The proactive context manager's tables, the operations on them, and the
lifecycle primitives around its background builds. The tools return tasks,
a ranking, a verdict; how they are kept is decided here, by the policy.

Created by the policy's `init` (`create`), beside the shared tables in the
gatherer's store (ag.ag_interface.GathererStore):

    tasks        each channel's tasks, by row range, with what each established
    cleaned_messages
                 user messages with their boilerplate removed, by events row
    _builds      every build (an ANALYSIS of a channel's history): running /
                 ready / failed / nothing; what it saw, where the verbatim part
                 starts, its ranking of the earlier tasks (internal)
    _boundaries  the boundary check's verdict per user message (internal)

A leading underscore marks a table internal to the policy, which the agent
has no reason to know about; `tasks` it may be pointed at. The no-channel
pool is keyed '' (`key`) in tasks, _builds and _boundaries, since NULL
cannot be a key.

    tasks       save_tasks, load_tasks, tasks_for, channels_with_tasks
    cleaned     save_cleaned, cleaned_texts
    builds      claim_build, new_build, settle, set_cut, fail_build, latest_build, build_for,
                get_build; basis_of, in_use, waiting
    boundaries  claim_boundary, record_boundary, boundary_verdict, checked_since
"""

import json
import sqlite3
import time

from ag.ag_policies.tools.channel import CHANNEL
from typing import List, Optional

from ..tools.history import Task

SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    channel_key    TEXT    NOT NULL,
    task_index     INTEGER NOT NULL,
    name           TEXT    NOT NULL,
    description    TEXT,
    first_row      INTEGER NOT NULL,
    last_row       INTEGER NOT NULL,
    tokens         INTEGER,
    retention_json TEXT,
    PRIMARY KEY (channel_key, task_index)
);

-- A user message with its boilerplate removed -- the wrapper a harness or template puts
-- around every request: a notice repeated on each message, a standard instruction on how
-- or where to deliver the answer -- the request's words kept exactly. Written by the
-- summarize call when the message's task finished; what the sections show of it.
-- row_id is the original message's `events` row: the [id N] the context names it by.
CREATE TABLE IF NOT EXISTS cleaned_messages (
    row_id      INTEGER PRIMARY KEY,
    text        TEXT    NOT NULL,
    build_id    INTEGER                  -- the build whose summary wrote it
);

CREATE TABLE IF NOT EXISTS _builds (
    build_id          INTEGER PRIMARY KEY,
    channel_key       TEXT NOT NULL,
    status            TEXT NOT NULL,     -- running / ready / failed / nothing
    started_at        REAL NOT NULL,
    finished_at       REAL,
    through_row       INTEGER,           -- the last row the analysis saw
    open_from_row     INTEGER,           -- where the running (open) task starts
    ranking_json      TEXT,              -- earlier tasks, most relevant first: [[channel_key, task_index], ...]
    parallel_mark     INTEGER,           -- other channels' rows up to here were seen
    error             TEXT,
    reason            TEXT               -- why it was started: limit / boundary / request / direct
);
CREATE INDEX IF NOT EXISTS _builds_channel ON _builds (channel_key, build_id);

-- The boundary check's verdict on a user message: does it start a new task?
-- A row is claimed (new_task NULL) when the check is spawned, so it is asked
-- once; the worker fills it in.
CREATE TABLE IF NOT EXISTS _boundaries (
    row_id      INTEGER PRIMARY KEY,     -- the user message (an events row)
    channel_key TEXT NOT NULL,
    asked_at    REAL NOT NULL,
    decided_at  REAL,
    new_task    INTEGER,                 -- 1 / 0; NULL = not decided yet
    why         TEXT
);
"""


def create(conn: sqlite3.Connection) -> None:
    """Create every table that is absent, and add the columns a database made by
    an older version lacks. Idempotent."""
    conn.executescript(SCHEMA)
    if "reason" not in {r[1] for r in conn.execute("PRAGMA table_info(_builds)")}:
        with conn:
            conn.execute("ALTER TABLE _builds ADD COLUMN reason TEXT")     # older builds: NULL


def key(channel_id: Optional[str]) -> str:
    return channel_id or ""


def changed(conn, what: str, channel_id=None, row: Optional[int] = None) -> None:
    """Tell whoever watches the gatherer that `what` of these tables was written, for the channel
    (None: no channel, or not at hand), after it committed (GathererStore.changed). A bare
    connection (a test's) tells no one."""
    tell = getattr(conn, "changed", None)
    if tell is not None:
        tell(what, {CHANNEL: channel_id} if channel_id else None, row)


def _build_changed(conn, build_id: int) -> None:
    row = conn.execute("SELECT channel_key FROM _builds WHERE build_id = ?", (build_id,)).fetchone()
    changed(conn, "build", row[0] if row else None, build_id)


# ---------------------------------------------------------------- tasks

def save_tasks(conn, channel_id, tasks: list) -> None:
    """Replace the channel's tasks with `tasks`, in order."""
    with conn:
        conn.execute("DELETE FROM tasks WHERE channel_key = ?", (key(channel_id),))
        conn.executemany(
            "INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [(key(channel_id), i, t.name, t.description, t.first_row, t.last_row, t.tokens,
              json.dumps(t.retention)) for i, t in enumerate(tasks)])
    changed(conn, "tasks", channel_id)


# ---------------------------------------------------------------- cleaned messages

def save_cleaned(conn, build_id: int, texts: dict) -> None:
    """Keep each message's cleaned text, `{events row_id: text}`, replacing an earlier one."""
    if not texts:
        return
    with conn:
        conn.executemany("INSERT INTO cleaned_messages VALUES (?, ?, ?) ON CONFLICT (row_id) DO UPDATE "
                         "SET text = excluded.text, build_id = excluded.build_id",
                         [(row_id, text, build_id) for row_id, text in texts.items()])
    changed(conn, "tasks", row=build_id)


def cleaned_texts(conn, row_ids) -> dict:
    """{events row_id: cleaned text} for the given rows that have one."""
    ids = sorted(set(row_ids))
    out = {}
    for i in range(0, len(ids), 900):                       # SQLite's limit on bound parameters
        chunk = ids[i:i + 900]
        out.update(conn.execute(f"SELECT row_id, text FROM cleaned_messages WHERE row_id IN "
                                f"({','.join('?' * len(chunk))})", chunk).fetchall())
    return out


def load_tasks(conn, channel_id) -> list:
    """The channel's stored tasks, in order, as `tools.history.Task`s."""
    rows = conn.execute(
        "SELECT task_index, name, description, first_row, last_row, tokens, retention_json "
        "FROM tasks WHERE channel_key = ? ORDER BY task_index", (key(channel_id),))
    return [Task(name=r[1], description=r[2] or "", first_row=r[3], last_row=r[4],
                 tokens=r[5] or 0, retention=json.loads(r[6] or "{}"),
                 channel_id=channel_id, task_index=r[0]) for r in rows]


def tasks_for(conn, channel_id) -> list:
    """The tasks a channel continues from: its own, or -- while it has none
    -- the no-channel pool's, since a channel sees the pool's history as its
    own past (a bulk-loaded gatherer, joined later)."""
    own = load_tasks(conn, channel_id)
    if own or channel_id is None:
        return own
    return load_tasks(conn, None)


def channels_with_tasks(conn) -> List[Optional[str]]:
    return [(k or None) for (k,) in conn.execute(
        "SELECT DISTINCT channel_key FROM tasks ORDER BY channel_key")]


# ---------------------------------------------------------------- builds

BUILD_COLUMNS = ("build_id, status, started_at, finished_at, through_row, open_from_row, "
                 "ranking_json, parallel_mark, error, reason")
#: Why a build was started: the context was over max_context_tokens; the boundary check found a new
#: task; build_every_request; run directly (bulk loading, tests); the harness compacted its own
#: history (a build that closes the running task, as `limit` does, and is adopted whatever its size); a
#: channel with no build of its own joined a gatherer where another channel has one (`joinable`): it
#: starts from their work, its own history all the running task; a reader asked for one from outside
#: any call (the dashboard's History view: `requested`), an ordinary build; the channel's group changed since the
#: build its context comes from (`regrouped`): an ordinary build, adopted whatever its size, mid-turn too.
LIMIT, BOUNDARY, REQUEST, DIRECT, COMPACTION = "limit", "boundary", "request", "direct", "compaction"
JOIN, ASKED, REGROUPED = "join", "asked", "regrouped"


def _build(row) -> Optional[dict]:
    if not row:
        return None
    return {"build_id": row[0], "status": row[1], "started_at": row[2], "finished_at": row[3],
            "through_row": row[4], "open_from_row": row[5],
            "ranking": [tuple(x) for x in json.loads(row[6])] if row[6] else [], "parallel_mark": row[7] or 0,
            "error": row[8], "reason": row[9]}


def claim_build(conn, channel_id, timeout: float, reason: str = DIRECT) -> Optional[int]:
    """Start a build for the channel -- a new `running` row, with why (`reason`) -- unless
    its latest build is still running (and younger than `timeout`). Atomic across
    processes. Returns the new build_id, or None."""
    now = time.time()
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute("SELECT status, started_at FROM _builds WHERE channel_key = ? "
                           "ORDER BY build_id DESC LIMIT 1", (key(channel_id),)).fetchone()
        if row and row[0] == "running" and now - row[1] < timeout:
            conn.execute("ROLLBACK")
            return None
        cur = conn.execute("INSERT INTO _builds (channel_key, status, started_at, reason) "
                           "VALUES (?, 'running', ?, ?)", (key(channel_id), now, reason))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    changed(conn, "build", channel_id, cur.lastrowid)
    return cur.lastrowid


def new_build(conn, channel_id, reason: str = DIRECT) -> int:
    """A `running` build row, unconditionally (for a build run directly)."""
    with conn:
        cur = conn.execute("INSERT INTO _builds (channel_key, status, started_at, reason) "
                           "VALUES (?, 'running', ?, ?)", (key(channel_id), time.time(), reason))
    changed(conn, "build", channel_id, cur.lastrowid)
    return cur.lastrowid


_SETTLE_FIELDS = ("through_row", "open_from_row", "ranking", "parallel_mark", "error")


def settle(conn, build_id: int, status: str, **fields) -> None:
    """Record how a build ended -- 'ready', 'failed' or 'nothing' -- and any
    of `through_row`, `open_from_row`, `ranking`, `parallel_mark`, `error`
    given; the others keep their values (a build refused at adoption keeps
    what its analysis recorded)."""
    unknown = set(fields) - set(_SETTLE_FIELDS)
    if unknown:
        raise TypeError(f"settle: unknown fields {sorted(unknown)}")
    sets, values = ["status = ?", "finished_at = ?"], [status, time.time()]
    for name, value in fields.items():
        if name == "ranking":
            sets.append("ranking_json = ?")
            values.append(json.dumps([list(x) for x in value]) if value is not None else None)
        elif name == "error":
            sets.append("error = ?")
            values.append((value or "")[:2000] or None)
        else:
            sets.append(f"{name} = ?")
            values.append(value)
    with conn:
        conn.execute(f"UPDATE _builds SET {', '.join(sets)} WHERE build_id = ?", (*values, build_id))
    _build_changed(conn, build_id)


def set_cut(conn, build_id: int, open_from_row: int) -> None:
    """Move a ready build's verbatim part to start at `open_from_row`: a cut inside the running task,
    decided when the build is adopted (policy.cut_for)."""
    with conn:
        conn.execute("UPDATE _builds SET open_from_row = ? WHERE build_id = ?", (open_from_row, build_id))
    _build_changed(conn, build_id)


def fail_build(conn, build_id: int, error: str, through_row: Optional[int] = None) -> None:
    fields = {"error": error}
    if through_row is not None:
        fields["through_row"] = through_row
    settle(conn, build_id, "failed", **fields)


def latest_build(conn, channel_id) -> Optional[dict]:
    """The channel's most recent build, whatever its status."""
    return _build(conn.execute(f"SELECT {BUILD_COLUMNS} FROM _builds WHERE channel_key = ? "
                               "ORDER BY build_id DESC LIMIT 1", (key(channel_id),)).fetchone())


def build_for(conn, channel_id) -> Optional[dict]:
    """The build a read of `channel_id` goes by: its own latest, or -- while
    it has none -- the no-channel pool's (see `tasks_for`)."""
    own = latest_build(conn, channel_id)
    if own or channel_id is None:
        return own
    return latest_build(conn, None)


def joinable(conn, channel_id, keep=None) -> bool:
    """Whether a channel with no build of its own can start from the gatherer's other channels:
    another channel (not the no-channel pool) has a ready build -- one `keep(channel)` keeps, given one
    (the policy's: one of its group)."""
    if channel_id is None:
        return False
    others = conn.execute("SELECT DISTINCT channel_key FROM _builds WHERE status = 'ready' AND channel_key NOT IN (?, '')",
                          (key(channel_id),)).fetchall()
    return any(keep is None or keep(k) for (k,) in others)


def get_build(conn, build_id: int) -> Optional[dict]:
    return _build(conn.execute(f"SELECT {BUILD_COLUMNS} FROM _builds WHERE build_id = ?",
                               (build_id,)).fetchone())


def basis_of(last_read) -> Optional[int]:
    """The build the channel's last read came from (its `basis`), or None."""
    basis = last_read and last_read.get("basis")
    return int(basis) if basis else None


def in_use(conn, last_read) -> Optional[dict]:
    """The build the channel's last read came from, or None."""
    used = basis_of(last_read)
    return get_build(conn, used) if used is not None else None


def waiting(build, last_read) -> bool:
    """A ready build the channel's context does not come from yet."""
    return bool(build and build["status"] == "ready" and build["build_id"] != basis_of(last_read))


# ---------------------------------------------------------------- boundaries

def claim_boundary(conn, row_id: int, channel_id) -> bool:
    """Mark the user message `row_id` as being checked. False if it already
    was (or is), so one message is asked about once."""
    try:
        with conn:
            conn.execute("INSERT INTO _boundaries (row_id, channel_key, asked_at) VALUES (?, ?, ?)",
                         (row_id, key(channel_id), time.time()))
    except sqlite3.IntegrityError:
        return False
    changed(conn, "boundary", channel_id, row_id)
    return True


def record_boundary(conn, row_id: int, new_task: bool, why: str, channel_id=None) -> None:
    """The verdict on `row_id`; inserts the row if it was never claimed
    (a check run directly, not through a read)."""
    now = time.time()
    with conn:
        conn.execute("""INSERT INTO _boundaries (row_id, channel_key, asked_at, decided_at, new_task, why)
                        VALUES (?, ?, ?, ?, ?, ?)
                        ON CONFLICT (row_id) DO UPDATE SET decided_at = excluded.decided_at,
                            new_task = excluded.new_task, why = excluded.why""",
                     (row_id, key(channel_id), now, now, 1 if new_task else 0, (why or "")[:2000]))
    changed(conn, "boundary", channel_id, row_id)


def checked_since(conn, channel_id, row_id: int) -> bool:
    """Whether a user message of the channel after row `row_id` has been asked about (or is being)."""
    return conn.execute("SELECT 1 FROM _boundaries WHERE channel_key = ? AND row_id > ? LIMIT 1",
                        (key(channel_id), row_id)).fetchone() is not None


def boundary_verdict(conn, row_id: int) -> Optional[dict]:
    """{new_task (None while undecided), why, asked_at, decided_at} or None."""
    row = conn.execute("SELECT new_task, why, asked_at, decided_at FROM _boundaries WHERE row_id = ?",
                       (row_id,)).fetchone()
    if not row:
        return None
    return {"new_task": None if row[0] is None else bool(row[0]), "why": row[1],
            "asked_at": row[2], "decided_at": row[3]}
