"""Actors on branches of their own: each started in a git worktree of one of its gatherer's PROJECTS -- a new branch
from the project's checkout as it is committed (its HEAD) -- and what it changes there merged into that checkout, the
one the Editor panel shows, as it changes it.

    a gatherer's projects       `projects`: the git repositories its actors' branches are made from, each a clone on
                                this machine (`add_project`: a folder in one, or a GitHub repository, cloned under
                                <home>/projects when none here has it); `suggestions`: the repositories its actors work
                                in, a worktree's own repository for one in a worktree
    an actor on a branch        `Branches.create`: `git worktree add -b ag/<id>` beside the project, in
                                <project>-worktrees/ag-<id> -- where the actor runs (sessions.py's `create`)
    what it changes there       `Branches.look`, every POLL seconds while the dashboard runs a process of the actor's
                                (else every SLOW): the files that differ from where the branch started (git's diff, and
                                those it does not track and does not ignore), each merged into the project's (`_merge`)

Each of the branch's files is merged three ways, as editor.py's `merge` merges the disk into a file open there: its
BASE -- the branch's file as far as the project has it, merged in or settled (`branch_files.base`: at first as the
branch started) -- the project's (MINE: the document, when the file is open in the Editor; else the file) and the
branch's now (THEIRS). The places only the branch changed are taken in, and the base moves on there; the places held
are not, until the reader settles them in the Editor: each a conflict of the file's open document (editor.py's
`Conflict.agent`), whose Accept takes the branch's lines (`theirs`), Reject leaves them out (`mine`) -- the base moving
on either way, so each change is asked about once. HELD are, with `approve` (the actor's "auto-merge with approval"):
every change; without: the branch's changes to the conflict zone (the lines edited in the Editor since the file was
opened), and those to lines the project changed too, differently -- and, either way, a place held before, until
settled (`branch_files.held`, by `_key`). A file the branch made or deleted, or that the project no longer has, is
asked about whole (`decide`).

Nothing goes the other way: the actor's worktree is its own, and what the project has that it lacks -- the reader's
edits, other actors', a change of its own left out -- it is not given. When the reader leaves out a change of the
actor's (Reject, Keep yours, a file not added or not deleted) or keeps both, the actor is TOLD (`tell`): a message from
a stream (the policy's `context_stream`: "Message in the Editor from the gatherer ..."), put in its channel, which it
reads at its next model call -- in its turn, or at the start of the next -- with its lines and the project's there; what
to make of the difference is its own to work out. No turn is started for it.

The branch's lines, merged in, are MARKED in the document (editor.py's `Room.marks`): those of its file now that differ
from the file as the branch started and are in the project's as they are -- for as long as the actor is not closed, which
is the page's to say. A file that is not text, or too large to edit, is not merged."""
import difflib
import hashlib
import json
import os
import re
import shutil
import sqlite3
import stat
import subprocess
import tempfile
import threading
import time
import uuid
from contextlib import nullcontext
from typing import Callable, Dict, Iterable, List, Optional, Set, Tuple

import harness_kit

from . import actions, editor, home, sessions

POLL = 1.0              # seconds between looks at a branch whose actor the dashboard runs a process of
SLOW = 10.0             # ... at any other
GIT_TIMEOUT = 30        # seconds a git command is given
CLONE_TIMEOUT = 600     # ... a clone
SCHEMA = """CREATE TABLE IF NOT EXISTS projects (
    gatherer TEXT NOT NULL,
    path     TEXT NOT NULL,
    remote   TEXT,
    added    REAL NOT NULL,
    PRIMARY KEY (gatherer, path)
);
CREATE TABLE IF NOT EXISTS branches (
    session_id TEXT PRIMARY KEY,
    gatherer   TEXT NOT NULL,
    project    TEXT NOT NULL,
    worktree   TEXT NOT NULL,
    branch     TEXT NOT NULL,
    start      TEXT NOT NULL,
    started_on TEXT,
    approve    INTEGER NOT NULL DEFAULT 0,
    created    REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS branch_files (
    session_id TEXT NOT NULL,
    path       TEXT NOT NULL,
    base       TEXT,
    held       TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (session_id, path)
)"""
GITHUB = re.compile(r"(?:https?://github\.com/|git@github\.com:|ssh://git@github\.com/)([\w.-]+)/([\w.-]+?)(?:\.git)?/?$")
SHORT = re.compile(r"([\w.-]+)/([\w.-]+)")      # owner/repo
WHOLE = "file"          # a held file, asked about whole
STREAM, AUTHOR = "the Editor", "the gatherer"   # where an actor is told the reader left its change out, and by whom
CLIP = 1500             # the most characters of each side's lines told
ONTO_SECONDS = 5.0      # how long what a project has checked out is kept before git is asked again


class BranchError(ValueError):
    """What the page is told: why a project cannot be set, or a branch made or settled."""


def _db() -> sqlite3.Connection:
    os.makedirs(home.HOME, exist_ok=True)
    conn = sqlite3.connect(sessions.db_path(), timeout=8, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    if "started_on" not in {r[1] for r in conn.execute("PRAGMA table_info(branches)")}:   # a table from before it
        try:
            conn.execute("ALTER TABLE branches ADD COLUMN started_on TEXT")
        except sqlite3.OperationalError:            # another process added it meanwhile
            pass
    return conn


def _git(cwd: str, *args: str, timeout: float = GIT_TIMEOUT, ok: Tuple[int, ...] = (0,)) -> subprocess.CompletedProcess:
    try:
        done = subprocess.run(["git", "-C", cwd, *args], capture_output=True, timeout=timeout, stdin=subprocess.DEVNULL,
                              env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0"})
    except (OSError, subprocess.SubprocessError) as exc:
        raise BranchError(f"git {args[0]}: {exc}") from exc
    if done.returncode not in ok:
        said = (done.stderr or done.stdout).decode("utf-8", "replace").strip()
        raise BranchError(f"git {args[0]}: {said or f'exited {done.returncode}'}")
    return done


def _out(cwd: str, *args: str) -> str:
    return _git(cwd, *args).stdout.decode("utf-8", "replace").strip()


def repository(path: str) -> Optional[str]:
    """The repository a folder is in -- for one in a worktree, the worktree's own repository -- as a real path; None:
    not in one."""
    path = os.path.abspath(os.path.expanduser(path or ""))
    if not os.path.isdir(path):
        return None
    try:
        common = _out(path, "rev-parse", "--path-format=absolute", "--git-common-dir")
    except BranchError:
        return None
    top = os.path.dirname(common) if os.path.basename(common) == ".git" else None
    if top is None:                                 # a bare repository, or one whose git folder is elsewhere
        try:
            top = _out(path, "rev-parse", "--show-toplevel")
        except BranchError:
            return None
    return os.path.realpath(top) if top else None


def _remote(top: str) -> str:
    try:
        names = _out(top, "remote").split()
    except BranchError:
        return ""
    for name in (["origin"] if "origin" in names else []) + names:
        try:
            return _out(top, "remote", "get-url", name)
        except BranchError:
            continue
    return ""


def github(url: str) -> Optional[str]:
    """owner/repo, when `url` is a GitHub repository's."""
    m = GITHUB.match((url or "").strip())
    return f"{m.group(1)}/{m.group(2)}" if m else None


def checked_out(path: str) -> dict:
    """What the folder has checked out: {branch (None: no branch, a commit alone), head (its commit, short)}."""
    try:
        head = _out(path, "rev-parse", "--short", "HEAD")
    except BranchError:                             # gone, or no commit yet
        return {"branch": None, "head": None}
    name = _git(path, "symbolic-ref", "--short", "-q", "HEAD", ok=(0, 1)).stdout.decode("utf-8", "replace").strip()
    return {"branch": name or None, "head": head}


def _project(path: str, remote: Optional[str] = None) -> dict:
    remote = _remote(path) if remote is None else remote
    return {"path": path, "name": os.path.basename(path), "remote": remote, "github": github(remote),
            "exists": os.path.isdir(path), **checked_out(path)}


def projects(gatherer: str) -> List[dict]:
    """The gatherer's projects, in the order they were set: [{path, name, remote, github, exists}]."""
    conn = _db()
    try:
        rows = conn.execute("SELECT path, remote FROM projects WHERE gatherer = ? ORDER BY added", (gatherer,)).fetchall()
    finally:
        conn.close()
    return [_project(r["path"], r["remote"] or "") for r in rows]


def suggestions(gatherer: str, dirs: Iterable[str]) -> List[dict]:
    """The repositories `dirs` are in (the gatherer's actors' working directories, the page says which), not among its
    projects yet, each once, in the order of `dirs`."""
    have, out = {p["path"] for p in projects(gatherer)}, []
    for d in dirs:
        top = repository(d) if isinstance(d, str) and d else None
        if top and top not in have:
            have.add(top)
            out.append(_project(top))
    return out


def add_project(gatherer: str, where: str) -> List[dict]:
    """A project set for the gatherer: `where` a folder in a git repository (its repository's), or a GitHub repository
    (its URL, or owner/repo) -- the clone here of it among the gatherer's actors' (`dirs`), else cloned under
    <home>/projects/<owner>/<repo>. The gatherer's projects."""
    if not sessions.GATHERER.fullmatch(gatherer or ""):
        raise BranchError("no such gatherer")
    where = (where or "").strip()
    if not where:
        raise BranchError("a folder in a git repository, or a GitHub repository, please")
    local = os.path.abspath(os.path.expanduser(where))
    if os.path.isdir(local):
        top = repository(local)
        if top is None:
            raise BranchError(f"{where} is not in a git repository")
    else:
        m = GITHUB.match(where) or (SHORT.fullmatch(where) if not where.startswith((".", "/", "~")) else None)
        if m is None:
            raise BranchError(f"{where}: no such folder, nor a GitHub repository (https://github.com/owner/repo, or owner/repo)")
        owner, repo = m.group(1), m.group(2)
        top = os.path.join(home.HOME, "projects", owner, repo)
        if repository(top) is None:
            if os.path.exists(top) and os.listdir(top):
                raise BranchError(f"{top} is there already, and is not a clone of {owner}/{repo}")
            os.makedirs(os.path.dirname(top), exist_ok=True)
            _git(os.path.dirname(top), "clone", "--quiet", f"https://github.com/{owner}/{repo}.git", top,
                 timeout=CLONE_TIMEOUT)
        top = os.path.realpath(top)
    conn = _db()
    try:
        conn.execute("INSERT OR IGNORE INTO projects (gatherer, path, remote, added) VALUES (?, ?, ?, ?)",
                     (gatherer, top, _remote(top), time.time()))
    finally:
        conn.close()
    return projects(gatherer)


def remove_project(gatherer: str, path: str) -> List[dict]:
    """The project no longer the gatherer's (its branches, and their actors, as they were)."""
    conn = _db()
    try:
        conn.execute("DELETE FROM projects WHERE gatherer = ? AND path = ?", (gatherer, path))
    finally:
        conn.close()
    return projects(gatherer)


def _key(o: List[str], lo: int, hi: int) -> str:
    """A place of the base, lines `lo` to `hi`, as told apart from the others: its lines, and the one each side."""
    return hashlib.sha1("".join(["\0".join(o[max(0, lo - 1):lo]), "\1", *o[lo:hi], "\1",
                                 "\0".join(o[hi:hi + 1])]).encode("utf-8")).hexdigest()[:16]


def combine(base: str, mine: str, theirs: str, approve: bool = False, held: Optional[Dict[str, str]] = None,
            guard: List[Tuple[int, int]] = (), decided: Optional[Dict[str, str]] = None,
            every: Optional[str] = None, settled: Optional[list] = None) -> Tuple[str, str, List[tuple], Dict[str, str]]:
    """The branch's file now (`theirs`) merged into the project's (`mine`), from where the project has it (`base`):
    the project's text with what was taken in; the base moved on where it was, or the reader settled it (`decided`:
    by place, the branch's lines they settled -- of these lines, not lines the branch changed again since); each place
    held, (start, end) of the project's lines there (characters of the text), the base's lines, the branch's, why it
    is held, its key; and the places held, by key, with why -- "approve" (every change is asked about), "zone" (lines
    in `guard`, the conflict zone: ranges of `mine`'s lines), "both" (the project changed them too, differently), or why
    before (`held`). `every`: each place held settled so -- "theirs" (the branch's lines taken in), "mine" (left out) --
    each one left out added to `settled`, as (the project's lines, the branch's)."""
    held, decided = held or {}, decided or {}
    o, a, b = base.splitlines(True), mine.splitlines(True), theirs.splitlines(True)
    out, moved, found, keys, size = [], [], [], {}, 0
    zo = za = zb = 0
    for lo, hi, sa, sb in editor.syncs(o, a, b):
        was, ours, others = o[zo:lo], a[za:sa], b[zb:sb]
        put, now = ours, was
        if others == was:                           # the branch's as the project has it
            pass
        elif ours == others:                        # the project has its change already
            now = others
        else:
            key, said = _key(o, zo, lo), "".join(others)
            both = others if ours == was else editor._both(was, ours, others)
            zoned = (ours != was and editor._guarded(za, sa, guard)) or editor._theirs_guarded(was, ours, others, za, guard)
            why = "approve" if approve else held.get(key) or ("zone" if zoned else "both" if both is None else None)
            if every is not None and why:
                put, now = (others if every == "theirs" else ours), others
                if every == "mine" and settled is not None:
                    settled.append(("".join(ours), said))
            elif decided.get(key) == said:          # settled, these very lines: the project's lines as they are
                now = others
            elif why:
                keys[key] = why
                found.append((size, size + sum(map(len, ours)), "".join(was), said, why, key))
            else:
                put, now = both, others
        out += put + o[lo:hi]
        moved += now + o[lo:hi]
        size += sum(map(len, put)) + sum(map(len, o[lo:hi]))
        zo, za, zb = hi, sa + hi - lo, sb + hi - lo
    return "".join(out), "".join(moved), found, keys


def _block(text: str) -> str:
    text = text.strip("\n")
    text = text if len(text) <= CLIP else text[:CLIP] + "\n[...]"
    return "```\n" + (text.rstrip("\n") or "(no lines)") + "\n```"


def note(what: str, rel: str, project: str, pairs: List[Tuple[str, str]] = ()) -> str:
    """What an actor on a branch is told when the reader left a change of its out of its project (module doc): `what`
    -- "rejected" (Reject: with approval), "kept" (Keep yours: lines the reader edited too), "both" (both kept), or a
    file's -- "created" (not added), "deleted" (not deleted), "missing" (left out of the project) -- and, for lines,
    `pairs`: (the project's lines there now, the branch's) -- and, where the project has the file, to read its latest
    version there before changing it again."""
    if what == "created":
        return f"The user did not add {rel}, which you created, to the project ({project}): it is only on your branch."
    latest = (f"Before you change this file again, read its latest version in the project: "
              f"{os.path.join(project, rel)}.")
    if what == "deleted":
        return f"The user kept {rel} in the project ({project}), though you deleted it on your branch. {latest}"
    if what == "missing":
        return f"The user left {rel} out of the project ({project}), though your branch has it, with your changes."
    many = len(pairs) > 1
    head = {"rejected": f"The user rejected {f'{len(pairs)} of your changes' if many else 'your change'} to {rel}: the "
                        f"project ({project}) keeps its own lines there.",
            "kept": f"The user kept their own lines in {rel}, which they had edited too, in place of your change: the "
                    f"project ({project}) keeps them.",
            "both": f"The user kept both their lines and yours in {rel}: the project ({project}) has theirs, then "
                    f"yours."}[what]
    parts = [f"{head} Your branch still has your version, so it and the project now differ in this file. {latest}"]
    for ours, theirs in pairs:
        parts.append(f"Yours:\n{_block(theirs)}\n\nThe project's:\n{_block(ours)}")
    return "\n\n".join(parts)


def tell(gatherer: str, channel: str, text: str) -> None:
    """`text` put in the actor's channel as a message from a stream (module doc), for its next model call."""
    actions.record(gatherer, channel, [{"type": "context_stream", "id": f"context_stream:editor:{uuid.uuid4().hex}",
                                        "payload": {"stream": STREAM, "author": AUTHOR, "text": text,
                                                    "timestamp": time.time()}}])


def marked(start: str, theirs: str, mine: str) -> List[Tuple[int, int]]:
    """The branch's lines in the project's: (start, end) of `mine`'s lines that are lines of `theirs` (the branch's
    file now) that differ from `start` (its file as the branch started), where `mine` has them as `theirs` does."""
    s, t, m = start.splitlines(True), theirs.splitlines(True), mine.splitlines(True)
    same = set()
    for i, j, n in difflib.SequenceMatcher(None, s, t, autojunk=False).get_matching_blocks():
        same.update(range(j, j + n))
    lines = []
    for i, j, n in difflib.SequenceMatcher(None, t, m, autojunk=False).get_matching_blocks():
        lines += [j + k for k in range(n) if i + k not in same and t[i + k].strip()]
    out: List[Tuple[int, int]] = []
    for j in sorted(lines):
        if out and out[-1][1] == j:
            out[-1] = (out[-1][0], j + 1)
        else:
            out.append((j, j + 1))
    return out


def _text(path: str) -> Optional[str]:
    """The file's text; None: there is none. editor.EditorError: not text, or too large."""
    for _ in range(5):
        try:
            return editor.read(path)[0]
        except editor._Changing:
            time.sleep(0.05)
        except editor.EditorError:
            if not os.path.lexists(path):
                return None
            raise
    raise editor.EditorError(f"{path} keeps changing")


def _sig(path: str) -> Optional[tuple]:
    try:
        return editor._signature(os.stat(path))
    except OSError:
        return None


def _write(path: str, text: str, was: Optional[tuple]) -> bool:
    """`text` written in place of the file -- made, with its folders, if there is none -- when it is still as last read
    (`was`, its signature; None: there was none). Whether it was."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        mode = stat.S_IMODE(os.stat(path).st_mode)
    except FileNotFoundError:
        mode = 0o644
    fd, temp = tempfile.mkstemp(prefix="." + os.path.basename(path) + ".", suffix=editor.TEMP, dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(text.encode("utf-8"))
        os.chmod(temp, mode)
        if _sig(path) != was:
            os.unlink(temp)
            return False
        os.replace(temp, path)
    except BaseException:
        if os.path.exists(temp):
            os.unlink(temp)
        raise
    return True


class Branches:
    """The actors' branches, each looked at as the module doc says, by a thread of its own; their changes held for the
    reader shown in the files open in the Editor (`editors`, whose `branches` this becomes). `started`: the sessions
    started from the page (sessions.py), where a branch's actor is made and which says whose process runs.
    `on_change(gatherer, channel)`: told when a branch's held changes change."""

    def __init__(self, editors: "editor.Editors", started: "sessions.Sessions",
                 on_change: Optional[Callable[[str, str], None]] = None, poll: Optional[float] = None):
        self.editors, self.started, self.on_change = editors, started, on_change
        self.lock = threading.RLock()
        self.looked: Dict[str, float] = {}                  # by branch: when last looked at
        self.seen: Dict[Tuple[str, str], tuple] = {}        # by (branch, file): what it was merged at (its file, the project's)
        self.decided: Dict[Tuple[str, str], Dict[str, str]] = {}   # by (branch, file): what the reader settled, not merged yet
        self.held: Dict[str, Dict[str, dict]] = {}          # by branch: its files with places held, {n, kind}
        self.counts: Dict[str, int] = {}                    # by the project's file: the places held of it (`pending`)
        self.starts: Dict[Tuple[str, str], Optional[str]] = {}   # a file as its branch started
        self.ontos: Dict[str, Tuple[float, dict]] = {}      # by project: when read, what it has checked out
        self.redo: Set[str] = set()                         # files opened in the Editor since the last look
        self.redo_lock = threading.Lock()
        self.poll = POLL if poll is None else poll
        self.wakeup, self.stop = threading.Event(), threading.Event()
        editors.branches = self
        self.thread = threading.Thread(target=self._watch, name="branches", daemon=True)
        self.thread.start()

    # ------------------------------------------------------------------ the branches
    def rows(self) -> List[dict]:
        """Every branch, with its actor's channel now (`channel`: a codex session renamed to its thread's)."""
        conn = _db()
        try:
            rows = conn.execute("SELECT b.*, coalesce((SELECT s.session_id FROM sessions s WHERE s.session_id = b.session_id "
                                "OR s.started_as = b.session_id), b.session_id) AS channel FROM branches b "
                                "ORDER BY b.created").fetchall()
        finally:
            conn.close()
        return [dict(r) for r in rows]

    def _row(self, sid: str) -> dict:
        b = next((r for r in self.rows() if sid in (r["session_id"], r["channel"])), None)
        if b is None:
            raise BranchError(f"{sid} is no actor on a branch of its own")
        return b

    def listed(self) -> List[dict]:
        """Every branch as the page lists it: {session_id (the one it was made with), channel, gatherer, project,
        worktree, branch, start (the commit it started from), started_on (the project's branch then), onto (what the
        project has checked out now, which its changes are merged into: `checked_out`), approve, held: {file: {n,
        kind}}}."""
        return [{**{k: b[k] for k in ("session_id", "channel", "gatherer", "project", "worktree", "branch", "start",
                                      "started_on")},
                 "onto": self._onto(b["project"]), "approve": bool(b["approve"]),
                 "held": dict(self.held.get(b["session_id"], {}))} for b in self.rows()]

    def _onto(self, project: str) -> dict:
        """`checked_out` of the project, read again at most every ONTO_SECONDS: the page's home reads it often."""
        at, got = self.ontos.get(project, (0.0, None))
        if got is None or time.time() - at > ONTO_SECONDS:
            got = checked_out(project)
            self.ontos[project] = (time.time(), got)
        return got

    def create(self, gatherer: str, project: str, harness: str = harness_kit.DEFAULT, approve: bool = False,
               model: Optional[str] = None, permission_mode: str = "auto") -> dict:
        """A new actor of `harness` in `gatherer`, on a new branch of `project` (one of the gatherer's): its worktree
        made beside the project, the session made there (sessions.py's `create`, in `permission_mode`). The session,
        with its `branch`."""
        mine = next((p for p in projects(gatherer) if p["path"] == project), None)
        if mine is None:
            raise BranchError(f"{project} is not one of {gatherer}'s projects")
        if not os.path.isdir(project):
            raise BranchError(f"{project} is not there any more")
        start = _out(project, "rev-parse", "--verify", "HEAD^{commit}")
        started_on = checked_out(project)["branch"]
        sid = uuid.uuid4().hex[:8]
        name, branch = f"ag-{sid}", f"ag/{sid}"
        where = os.path.join(os.path.dirname(project), os.path.basename(project) + "-worktrees", name)
        os.makedirs(os.path.dirname(where), exist_ok=True)
        _git(project, "worktree", "add", "--quiet", "-b", branch, where, start)
        try:
            s = self.started.create(gatherer, where, permission_mode, harness=harness, model=model)
        except Exception:
            _git(project, "worktree", "remove", "--force", where, ok=(0, 128))
            _git(project, "branch", "-D", branch, ok=(0, 1))
            raise
        conn = _db()
        try:
            conn.execute("INSERT INTO branches (session_id, gatherer, project, worktree, branch, start, started_on, approve, "
                         "created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                         (s["session_id"], gatherer, project, os.path.realpath(where), branch, start, started_on,
                          int(bool(approve)), time.time()))
        finally:
            conn.close()
        self.wakeup.set()
        return {**s, "branch": {"branch": branch, "project": project, "worktree": where, "approve": bool(approve),
                                "start": start, "started_on": started_on}}

    def discarded(self, sid: str) -> None:
        """A session never started, forgotten (sessions.py's `discard`): its branch, if it had one, and the worktree,
        if nothing was changed there, gone too."""
        conn = _db()
        try:
            b = conn.execute("SELECT * FROM branches WHERE session_id = ?", (sid,)).fetchone()
            if b is None:
                return
            conn.execute("DELETE FROM branches WHERE session_id = ?", (sid,))
            conn.execute("DELETE FROM branch_files WHERE session_id = ?", (sid,))
        finally:
            conn.close()
        try:
            if not _out(b["worktree"], "status", "--porcelain") and _out(b["worktree"], "rev-parse", "HEAD") == b["start"]:
                _git(b["project"], "worktree", "remove", b["worktree"])
                _git(b["project"], "branch", "-d", b["branch"], ok=(0, 1))
        except BranchError:                             # changed, or gone: left as it is
            pass
        with self.lock:
            self.held.pop(sid, None)
            self._count()

    def set_approve(self, sid: str, approve: bool) -> dict:
        """Whether every change of the branch's is asked about (`approve`) -- what was held, still held."""
        b = self._row(sid)
        conn = _db()
        try:
            conn.execute("UPDATE branches SET approve = ? WHERE session_id = ?", (int(bool(approve)), b["session_id"]))
        finally:
            conn.close()
        with self.lock:
            for k in [k for k in self.seen if k[0] == b["session_id"]]:
                del self.seen[k]                            # each file merged again, now so
        self.wakeup.set()
        return {**b, "approve": bool(approve)}

    # ------------------------------------------------------------------ what waits, for the page
    def pending(self, path: str, folder: bool = False) -> int:
        """How many places of the branches' changes wait for the reader in the project's file `path` (a real path) --
        or, a folder, in the files under it."""
        counts = self.counts
        if not folder:
            return counts.get(path, 0)
        top = path.rstrip("/") + "/"
        return sum(n for p, n in counts.items() if p.startswith(top))

    def under(self, root: str) -> List[dict]:
        """The branches of the projects `root` is in, or holds: as `listed` has them, each file with places held named
        by its path (`held`: {path: {n, kind}})."""
        root = os.path.realpath(root or "/")
        out = []
        for b in self.listed():
            p = b["project"]
            if root == p or root.startswith(p.rstrip("/") + "/") or p.startswith(root.rstrip("/") + "/"):
                out.append({**b, "held": {os.path.join(p, rel): v for rel, v in b["held"].items()}})
        return out

    def _count(self) -> None:
        rows = {b["session_id"]: b["project"] for b in self.rows()}
        counts: Dict[str, int] = {}
        for sid, files in self.held.items():
            for rel, v in files.items():
                if sid in rows:
                    p = os.path.join(rows[sid], rel)
                    counts[p] = counts.get(p, 0) + v["n"]
        self.counts = counts

    # ------------------------------------------------------------------ looking
    def opened(self, path: str) -> None:
        """A file opened in the Editor (a real path): its branches' changes shown in it at once."""
        with self.redo_lock:
            self.redo.add(path)
        self.wakeup.set()

    def _watch(self) -> None:
        while not self.stop.is_set():
            self.wakeup.wait(self.poll)
            self.wakeup.clear()
            if self.stop.is_set():
                return
            try:
                self.look()
            except Exception:                           # noqa: BLE001 - the next look
                pass

    def look(self, everything: bool = False) -> None:
        """Each branch due a look (`everything`: each) looked at: its files merged into its project's."""
        now = time.time()
        running = set()
        for s in self.started.list():
            if s.get("pid"):
                running.update(x for x in (s["session_id"], s.get("started_as")) if x)
        with self.redo_lock:
            redo, self.redo = self.redo, set()
        with self.lock:
            for b in self.rows():
                sid = b["session_id"]
                due = everything or now - self.looked.get(sid, 0) >= (self.poll if (sid in running or b["channel"] in running)
                                                                       else SLOW)
                mine = [p for p in redo if p.startswith(b["project"].rstrip("/") + "/")]
                if not (due or mine) or not os.path.isdir(b["worktree"]):
                    continue
                if due:
                    self.looked[sid] = now
                try:
                    self._look(b, [os.path.relpath(p, b["project"]) for p in mine], due)
                except BranchError:                     # its worktree or repository in trouble: the next look
                    continue
            self._count()

    def _look(self, b: dict, opened: List[str], due: bool) -> None:
        sid = b["session_id"]
        names = set(opened)
        if due:
            for args in (("diff", "--name-only", "--no-renames", "-z", b["start"]),
                         ("ls-files", "--others", "--exclude-standard", "-z")):
                names.update(n for n in _git(b["worktree"], *args).stdout.decode("utf-8", "replace").split("\0") if n)
            names.update(rel for s, rel in self.seen if s == sid)
            names.update(self.held.get(sid, {}))
        changed = False
        for rel in sorted(names):
            room = self.editors.rooms.get(os.path.join(b["project"], rel))
            now = (_sig(os.path.join(b["worktree"], rel)),
                   (id(room), hash(str(room.text))) if room is not None else _sig(os.path.join(b["project"], rel)))
            if rel not in opened and self.seen.get((sid, rel)) == now:
                continue
            changed |= self._merge(b, rel, room)
        if changed and self.on_change is not None:
            try:
                self.on_change(b["gatherer"], b["channel"])
            except Exception:                           # noqa: BLE001 - a listener's trouble is not the branch's
                pass

    def _start(self, b: dict, rel: str) -> Optional[str]:
        """The file as the branch started; None: there was none, or not text."""
        k = (b["start"], os.path.join(b["project"], rel))
        if k not in self.starts:
            done = _git(b["project"], "show", f"{b['start']}:{rel}", ok=(0, 128))
            text = None
            if done.returncode == 0 and b"\0" not in done.stdout[:8192] and len(done.stdout) <= editor.MAX_BYTES:
                try:
                    text = done.stdout.decode("utf-8")
                except UnicodeDecodeError:
                    pass
            self.starts[k] = text
        return self.starts[k]

    def _file(self, sid: str, rel: str) -> Optional[sqlite3.Row]:
        conn = _db()
        try:
            return conn.execute("SELECT base, held FROM branch_files WHERE session_id = ? AND path = ?", (sid, rel)).fetchone()
        finally:
            conn.close()

    def _keep(self, sid: str, rel: str, base: Optional[str], held: Dict[str, str]) -> None:
        conn = _db()
        try:
            conn.execute("INSERT INTO branch_files (session_id, path, base, held) VALUES (?, ?, ?, ?) "
                         "ON CONFLICT (session_id, path) DO UPDATE SET base = excluded.base, held = excluded.held",
                         (sid, rel, base, json.dumps(held)))
        finally:
            conn.close()

    def _merge(self, b: dict, rel: str, room=None, every: Optional[str] = None, settled: Optional[list] = None) -> bool:
        """The branch's file `rel` merged into its project's (the module doc): `room`, the project's file open in the
        Editor, else the file itself. `every`: each place held settled so (`combine`'s, with `settled`). Whether what
        waits changed."""
        sid, approve = b["session_id"], bool(b["approve"])
        theirs_path, mine_path = os.path.join(b["worktree"], rel), os.path.join(b["project"], rel)
        theirs_sig = _sig(theirs_path)
        skipped = (theirs_sig, (id(room), hash(str(room.text))) if room is not None else _sig(mine_path))
        try:
            theirs = _text(theirs_path)
        except editor.EditorError:                      # not text, or too large: not merged
            self.seen[(sid, rel)] = skipped
            return False
        row = self._file(sid, rel)
        base = row["base"] if row is not None else self._start(b, rel)
        if row is None and base is None \
                and _git(b["project"], "cat-file", "-e", f"{b['start']}:{rel}", ok=(0, 1, 128)).returncode == 0:
            self.seen[(sid, rel)] = skipped             # there as it started, not text
            return False
        held: Dict[str, str] = json.loads(row["held"]) if row is not None else {}
        decided = self.decided.pop((sid, rel), {})
        kind, found = None, []
        with room.lock if room is not None else nullcontext():
            mine_sig = _sig(mine_path)
            if room is not None:
                mine = str(room.text)
            else:
                try:
                    mine = _text(mine_path)
                except editor.EditorError:              # the project's is not text: left alone
                    self.seen[(sid, rel)] = skipped
                    return False
            if theirs == base:                          # nothing of the branch's the project lacks
                base, held = theirs, {}
            elif theirs is None:                        # the branch deleted it
                if mine is None or every == "mine":
                    base, held = None, {}
                elif every == "theirs" or (mine == base and not approve and WHOLE not in held and room is None):
                    try:
                        os.unlink(mine_path)
                    except FileNotFoundError:
                        pass
                    base, held = None, {}
                else:
                    kind, held = "deleted", {WHOLE: held.get(WHOLE) or ("approve" if approve else "both")}
            elif mine is None:                          # the project has none: the branch made it, or the project deleted it
                if every == "mine":
                    base, held = theirs, {}
                elif every == "theirs" or (base is None and not approve and WHOLE not in held):
                    if not _write(mine_path, theirs, None):
                        return False                    # made meanwhile: the next look
                    base, held = theirs, {}
                else:
                    kind = "created" if base is None else "missing"
                    held = {WHOLE: held.get(WHOLE) or ("approve" if approve else "both")}
            else:
                guard = room._lines(mine, room.zone) if room is not None else []
                merged, base, found, held = combine(base or "", mine, theirs, approve,
                                                    {k: v for k, v in held.items() if k != WHOLE}, guard, decided, every,
                                                    settled)
                if merged != mine:
                    if room is not None:
                        clean = mine == room.disk
                        before = room.doc.get_state()
                        editor.change(room.text, merged)
                        room._send("update", {"update": editor.b64(room.doc.get_update(before))})
                        if clean:                       # nothing unsaved but this: written now
                            try:
                                room.save()
                            except editor.EditorError:
                                pass
                    elif not _write(mine_path, merged, mine_sig):
                        return False                    # changed meanwhile: the next look
                    mine = merged
            if room is not None:
                self._show(b, rel, room, mine if mine is not None else "", theirs, found)
        self._keep(sid, rel, base, held)
        room_now = (id(room), hash(str(room.text))) if room is not None else _sig(mine_path)
        self.seen[(sid, rel)] = (theirs_sig, room_now)
        files = self.held.setdefault(sid, {})
        was = files.get(rel)
        if kind or found:
            files[rel] = {"n": 1 if kind else len(found), "kind": kind or "lines"}
        else:
            files.pop(rel, None)
        return files.get(rel) != was

    def _show(self, b: dict, rel: str, room, mine: str, theirs: Optional[str], found: List[tuple]) -> None:
        """In the open file: the branch's places held, each a conflict (`Conflict.agent`), and its lines marked."""
        who = {"gatherer": b["gatherer"], "channel": b["channel"], "branch": b["branch"], "session_id": b["session_id"],
               "path": rel, "approve": bool(b["approve"])}
        old = {c.id: c for c in room.conflicts.values() if c.agent and c.agent["session_id"] == b["session_id"]
               and c.agent["path"] == rel}
        for cid in old:
            del room.conflicts[cid]
        for start, end, was, said, why, key in found:
            b0 = len(mine[:start].encode("utf-8"))
            b1 = b0 + len(mine[start:end].encode("utf-8"))
            cid = hashlib.sha1(f"{b['session_id']}\0{rel}\0{key}".encode()).hexdigest()[:12]
            before = old.get(cid)
            c = editor.Conflict(b0, b1, was, said, why == "zone", before.since if before else None,
                                {**who, "key": key, "why": why}, cid)
            if before is not None and before.theirs == said:
                c.at = before.at
            room.conflicts[cid] = c
        lines = marked(self._start(b, rel) or "", theirs, mine) if theirs is not None else []
        starts, at = [], 0
        for line in mine.splitlines(True):
            starts.append(at)
            at += len(line.encode("utf-8"))
        starts.append(at)
        room.marks = [m for m in room.marks if (m[2], m[3]) != (b["gatherer"], b["channel"])] \
            + [[starts[i], starts[j], b["gatherer"], b["channel"]] for i, j in lines]
        room._restate()

    # ------------------------------------------------------------------ the reader's say
    def settle(self, room, c, take: str) -> dict:
        """A place held, settled in the Editor (editor.py's `Editors.settle`): `take` put in the document as for any
        conflict, and the base moved on there -- the branch's lines as the reader saw them taken in, or left out."""
        if take not in ("mine", "theirs", "both"):
            raise editor.EditorError(f"take {take!r}: mine, theirs or both")
        b = self._row(c.agent["session_id"])
        rel = c.agent["path"]
        with self.lock, room.lock:
            if room.conflicts.pop(c.id, None) is None:
                raise editor.EditorError("that change is settled already")
            ours = str(room.text).encode("utf-8")[c.start:c.end].decode("utf-8", "replace")
            room.take(c, take)
            self.decided.setdefault((b["session_id"], rel), {})[c.agent["key"]] = c.theirs
            self._merge(b, rel, room)
            self._count()
            room._restate()
            state = room.state()
        if take != "theirs":                            # its change left out, or not alone: it is told
            what = "both" if take == "both" else "rejected" if c.agent.get("why") == "approve" else "kept"
            now = ours + ("\n" if ours and not ours.endswith("\n") else "") + c.theirs if take == "both" else ours
            tell(b["gatherer"], b["channel"], note(what, rel, b["project"], [(now, c.theirs)]))
        return state

    def decide(self, sid: str, path: str, take: str) -> dict:
        """Every place held of the branch's file `path` (the project's, or its path in the project) settled so -- "theirs"
        (the branch's taken in: a file it made, made; one it deleted, deleted), "mine" (left out). `listed`'s branch."""
        if take not in ("mine", "theirs"):
            raise BranchError(f"take {take!r}: mine or theirs")
        b = self._row(sid)
        rel = os.path.relpath(path, b["project"]) if os.path.isabs(path) else path
        if rel.startswith(".."):
            raise BranchError(f"{path} is not in {b['project']}")
        with self.lock:
            room = self.editors.rooms.get(os.path.join(b["project"], rel))
            kind = (self.held.get(b["session_id"], {}).get(rel) or {}).get("kind")
            settled: List[Tuple[str, str]] = []
            self._merge(b, rel, room, every=take, settled=settled)
            self._count()
        if take == "mine" and (settled or kind in ("created", "deleted", "missing")):   # left out: it is told
            tell(b["gatherer"], b["channel"], note("rejected" if settled else kind, rel, b["project"], settled))
        return next(x for x in self.listed() if x["session_id"] == b["session_id"])

    def close(self) -> None:
        self.stop.set()
        self.wakeup.set()
