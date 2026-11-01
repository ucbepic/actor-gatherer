"""DocWriter (github.com/docwriter-org/docwriter, MIT) in the dashboard: its page -- a writing app where the author
and an agent edit the same draft, the agent's edits proposed beside the text until the author accepts them -- built
against the dashboard (assets/src/docwriter -> vendor/docwriter/), and its agent an ACTOR of the gatherer: an ordinary
session started from the dashboard (sessions.py), in the list, whose view DocWriter is (page.html's "docwriter" chat view,
beside its Terminal, Chat and History), that the page sends its requests to as messages. What DocWriter's own server did
is done here, or in the page:

    each DocWriter        `DocWriters.create`: its actor's -- one each -- made with it: its KEY, the page served at
                          /docwriter/w/<key>/ (every request of the page under it), its actor a session (sessions.py's
                          `create`, its `role` {"docwriter": key}) started with DocWriter's instructions and its document
                          tools (`launch_args`); its folder is the workspace. Its open tabs, and what its actor last saw,
                          are its own (`kv`, scoped by its key); rules, settings and hooks are the folder's. Made from a
                          gatherer's DocWriter button, or by the gatherer agent (coordination.py's `new`), which sends
                          its actor a task as it does any actor's
    its documents        `Docs`: each open file one Yjs document (an XmlFragment of paragraphs, DocWriter's comment
                          threads beside it), kept by pycrdt unread and passed between the pages that have it open; its
                          state kept in dashboard.db (`docwriter_docs`), so proposals and threads outlive the page. The
                          page seeds a new document from its file, writes it back as the author has it (no proposed
                          insertions), and folds in a change of the file on disk (`external`, sent to one page): the
                          page's code knows a proposal from the text, this does not
    its routes            `api`: files, tabs, settings, hooks (`<folder>/.docwriter/hooks.json`, as DocWriter keeps
                          them), previews, SyncTeX (`synctex`), and the live notices (`live`: a built preview changed)
    the agent's turn      the page's: it makes DocWriter's prompt and sends it here (`send`), typed into the actor's
                          terminal or starting it (sessions.py's `send`), and follows the turn in the gatherer
    the agent's tools     `Tools` + mcp.py: edit_doc, read_doc, write_doc, comment_doc, reply_to_comment, list_threads,
                          an MCP server the actor reaches at /docwriter/w/<key>/mcp, each call passed to a page with
                          the DocWriter open, which runs DocWriter's own code on its document and answers -- a call
                          made while none has, waiting PAGE_WAIT for one: the dashboard's page opens the DocWriter of
                          an actor at work (page.html's `dwTell`), a moment after its turn starts. Claude Code
                          is kept from editing an open document with its own tools by a PreToolUse hook
                          (docwriter_guard.py, asking `guard`); codex is told to
    what the author does  `record`: an event of the dashboard's in the actor's channel (`ag home insert`), as naming.py's
                          name: a proposal accepted, rejected or dismissed (`proposal_resolved`), a comment, a reply,
                          the agent's settings (`doc_settings`)

Needs pycrdt, as the Editor panel does (`AVAILABLE`)."""
import base64
import json
import mimetypes
import os
import queue
import re
import secrets
import shlex
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import threading
import time
from typing import Dict, List, Optional, Tuple

import harness_kit

from . import home, mcp, naming, sessions

try:
    from pycrdt import Doc
    AVAILABLE = True
except ImportError:                                 # the page says what to install
    Doc = None
    AVAILABLE = False

HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(HERE, "vendor", "docwriter")
GUARD = os.path.join(HERE, "docwriter_guard.py")
INSTRUCTIONS = os.path.join(VENDOR, "instructions.md")   # DocWriter's system prompt, as build.mjs takes it out
ORIGIN = "http://127.0.0.1:4200"   # where the actors reach the dashboard (its MCP server): set by server.py's `serve`
KEY = re.compile(r"[0-9a-f]{16}")
POLL = 0.5                  # seconds between looks at each open file, and each previewed one
LINGER = 30.0               # seconds a document stays open after its last page goes
PERSIST = 2.0               # seconds between writes of the documents changed to dashboard.db
TOOL_WAIT = 120.0           # the most a tool call waits for a page to answer it
PAGE_WAIT = 30.0            # the most a tool call waits for a page to open its DocWriter, none having it open
TOOL_CHECK = 0.5            # how often a waiting tool call looks whether its page is there, and still there
NAME_WAIT = 600.0           # how long a new actor's first call is waited for, to name it (its gatherer has it then)
PREVIEW_KEEP = 3600.0       # seconds a previewed file is watched after it was last asked for
HOOK_TIMEOUT = 300          # seconds a hook's command may run
HOOK_KEEP = 2000            # the last characters of a hook's output kept
MAX_TEXT = 5_000_000        # the largest file read as text
SKIPPED = frozenset({".git", "node_modules", ".svelte-kit", "build", ".DS_Store", "__pycache__", ".venv"})
SOURCES = frozenset({"md", "markdown", "txt", "json", "yaml", "yml", "tex", "ltx", "sty", "cls", "bib"})
BINARY = frozenset({"pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "tif", "tiff", "zip", "gz", "tar",
                    "docx", "xlsx", "pptx", "mp3", "mp4", "mov", "wav"})
EDIT_TOOLS = "Edit|Write|MultiEdit|NotebookEdit"   # what Claude Code edits a file with: refused on an open document
SCHEMA = """CREATE TABLE IF NOT EXISTS docwriter (
    key         TEXT PRIMARY KEY,
    gatherer    TEXT NOT NULL,
    root        TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    created_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS docwriter_docs (
    path        TEXT PRIMARY KEY,
    state       BLOB NOT NULL,
    disk        TEXT,
    at          REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS docwriter_kv (
    scope       TEXT NOT NULL,
    name        TEXT NOT NULL,
    value       TEXT NOT NULL,
    PRIMARY KEY (scope, name)
)"""
DEFAULT_META = {"rules": [], "agentSettings": {"agency": "balanced", "muted": False, "paused": False,
                                               "intendedAudience": ""}}


class DocWriterError(ValueError):
    """What the page is told: why it cannot be done. `status`: the HTTP status it is answered with."""

    def __init__(self, text: str, status: int = 400):
        super().__init__(text)
        self.status = status


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _db() -> sqlite3.Connection:
    os.makedirs(home.HOME, exist_ok=True)
    conn = sqlite3.connect(sessions.db_path(), timeout=8, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def wake() -> bool:
    """Whether a pause in typing wakes the agent, as DocWriter's own does: the home's config.toml's
    `[dashboard] docwriter_wake` (default: not -- each wake is a message the actor shows and answers)."""
    try:
        import tomllib
        with open(os.path.join(home.HOME, "config.toml"), "rb") as fh:
            dashboard = tomllib.load(fh).get("dashboard")
    except (OSError, ValueError):
        return False
    return bool(isinstance(dashboard, dict) and dashboard.get("docwriter_wake"))


# ---- what is kept: per folder, per DocWriter ------------------------------------------------------------------

def kv_get(scope: str, names: List[str]) -> Dict[str, Optional[str]]:
    conn = _db()
    try:
        got = {}
        for name in names:
            row = conn.execute("SELECT value FROM docwriter_kv WHERE scope = ? AND name = ?", (scope, name)).fetchone()
            got[name] = row["value"] if row else None
        return got
    finally:
        conn.close()


def kv_set(scope: str, values: Dict[str, Optional[str]]) -> None:
    conn = _db()
    try:
        for name, value in values.items():
            if value is None:
                conn.execute("DELETE FROM docwriter_kv WHERE scope = ? AND name = ?", (scope, name))
            else:
                conn.execute("INSERT INTO docwriter_kv (scope, name, value) VALUES (?, ?, ?) ON CONFLICT (scope, name) "
                             "DO UPDATE SET value = excluded.value", (scope, name, str(value)))
    finally:
        conn.close()


def _kv_json(scope: str, name: str, default):
    raw = kv_get(scope, [name])[name]
    try:
        got = json.loads(raw) if raw else None
    except ValueError:
        got = None
    return got if isinstance(got, type(default)) else default


# ---- paths under the folder ------------------------------------------------------------------------------------

def inside(root: str, path: str, must_exist: bool = False) -> str:
    """`path` (absolute, or relative to `root`) as an absolute path under `root`, links followed -- of the part that
    exists -- so none leads out of it. Raises DocWriterError (403) when it is not under it."""
    if not path:
        raise DocWriterError("no path")
    full = os.path.normpath(path if os.path.isabs(path) else os.path.join(root, path))
    real_root = os.path.realpath(root)
    probe = full
    while not os.path.exists(probe) and os.path.dirname(probe) != probe:
        probe = os.path.dirname(probe)
    real = os.path.realpath(probe)
    if real != real_root and not real.startswith(real_root + os.sep):
        raise DocWriterError(f"{path} is outside the workspace", 403)
    if must_exist and not os.path.exists(full):
        raise DocWriterError(f"{path} does not exist", 404)
    return full


def _real(path: str) -> str:
    """`path` with the links of the part of it that exists followed: where it is, or would be."""
    head, tail = path, []
    while not os.path.exists(head) and os.path.dirname(head) != head:
        head, part = os.path.split(head)
        tail.append(part)
    return os.path.join(os.path.realpath(head), *reversed(tail))


def tab_id(root: str, path: str) -> str:
    """A workspace-relative POSIX path, as DocWriter names a tab: never out of the folder, no . or .. or empty
    segments."""
    rel = os.path.relpath(_real(inside(root, path)), os.path.realpath(root)) if os.path.isabs(path) else os.path.normpath(path)
    segs = rel.replace(os.sep, "/").split("/")
    if not rel or len(rel) > 512 or any(s in ("", ".", "..") for s in segs) or "\0" in rel:
        raise DocWriterError(f"{path}: not a path in the workspace")
    return "/".join(segs)


def _ext(path: str) -> str:
    base = os.path.basename(path)
    return base.rsplit(".", 1)[1].lower() if "." in base[1:] else ""


def read_text(path: str) -> Optional[str]:
    """The file's text (None: no such file), as UTF-8, its line ends as written."""
    try:
        with open(path, "rb") as fh:
            raw = fh.read(MAX_TEXT + 1)
    except (FileNotFoundError, NotADirectoryError):
        return None
    if len(raw) > MAX_TEXT:
        raise DocWriterError(f"{os.path.basename(path)} is too large to open here", 413)
    return raw.decode("utf-8", errors="replace")


def write_text(path: str, text: str) -> None:
    """The file written whole, in place of what it was (whoever reads it meanwhile reads all of the old or all of
    the new), its mode kept."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    try:
        mode = stat.S_IMODE(os.stat(path).st_mode)
    except FileNotFoundError:
        mode = None
    fd, tmp = tempfile.mkstemp(prefix=".dw-", dir=os.path.dirname(path) or ".")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
        if mode is not None:
            os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ---- the documents ---------------------------------------------------------------------------------------------

class _Sink:
    """Where a page is sent what concerns it of one document: `put((event, value))`."""

    def __init__(self, cid: str, put):
        self.id, self.put, self.at = cid, put, time.time()


class _Page:
    """A DocWriter page's one stream (`DocWriters.join_page`): its documents' updates and changes on disk (`doc`, each
    with its tab), the actor's tool calls for it to run (`call`), the live notices (`live`) -- one connection for all,
    as a browser keeps only a few open to a host."""

    def __init__(self, key: str, cid: str):
        self.key, self.id, self.queue = key, cid, queue.Queue()
        self.rooms: Dict[str, "Room"] = {}         # tab -> its document, while the page has it open

    def put(self, item) -> None:
        self.queue.put(item)

    def sink(self, tab: str) -> _Sink:
        return _Sink(self.id, lambda item: self.queue.put(("doc", {"tab": tab, "type": item[0], **item[1]})))


class Room:
    """One open file's document, as the pages share it (module doc). `disk`: the file's text as last written or
    folded in here -- what the document's committed view stands for; a file found otherwise has changed on disk."""

    def __init__(self, path: str):
        self.path, self.lock = path, threading.RLock()
        self.doc = Doc()
        self.conns: Dict[str, _Sink] = {}
        self.disk: Optional[str] = None
        self.seeding: Optional[str] = None         # the page asked to seed the document from its file, until it does
        self.filled = False                        # it has content: stored, or edited since
        self.dirty, self.left, self.stat = False, 0.0, None
        conn = _db()
        try:
            row = conn.execute("SELECT state, disk FROM docwriter_docs WHERE path = ?", (path,)).fetchone()
        finally:
            conn.close()
        if row is not None:
            self.doc.apply_update(bytes(row["state"]))
            self.disk, self.filled = row["disk"], True

    def _stat(self):
        try:
            s = os.stat(self.path)
            return (s.st_mtime_ns, s.st_size)
        except OSError:
            return None

    def join(self, sink: _Sink) -> dict:
        """A page's copy of the document begun: the document as it is here (`update`, and its state vector `sv`, for the
        page to send what it has that this lacks); the file to seed it from, the first time (`seed`, to one page); a
        change of the file on disk since (`external`, to fold in). What changes after comes through the page's stream."""
        with self.lock:
            cid = sink.id
            self.conns[cid] = sink
            now = read_text(self.path)
            self.stat = self._stat()
            init = {"update": b64(self.doc.get_update()), "sv": b64(self.doc.get_state())}
            if not self.filled and (self.seeding is None or self.seeding not in self.conns or self.seeding == cid):
                init["seed"], self.seeding, self.disk = now or "", cid, now or ""
            elif now is not None and self.disk is not None and now != self.disk:
                init["external"], self.disk = now, now
            return init

    def leave(self, cid: str) -> None:
        with self.lock:
            if self.conns.pop(cid, None) is not None:
                if self.seeding == cid and not self.filled:
                    self.seeding = None
                if not self.conns:
                    self.left = time.time()

    def edit(self, cid: str, update: bytes) -> None:
        with self.lock:
            self.doc.apply_update(update)
            self.filled = self.dirty = True
            if self.seeding == cid:
                self.seeding = None
            for other in self.conns.values():
                if other.id != cid:
                    other.put(("update", {"update": b64(update)}))

    def save(self, cid: str, text: str) -> dict:
        """The page's document written to the file, as the author has it -- unless the file changed on disk since it
        was last read or written here: that change is sent to the page to fold in first (it saves again after)."""
        with self.lock:
            now = read_text(self.path)
            if now is not None and self.disk is not None and now != self.disk:
                self.disk, self.stat = now, self._stat()
                target = self.conns.get(cid) or self._latest()
                if target is not None:
                    target.put(("external", {"text": now}))
                return {"saved": False, "changed": True}
            if now != text:
                write_text(self.path, text)
            self.disk, self.stat, self.dirty = text, self._stat(), True
            return {"saved": True}

    def _latest(self) -> Optional[_Sink]:
        return max(self.conns.values(), key=lambda c: c.at) if self.conns else None

    def check(self) -> None:
        """A change of the file on disk, by an actor or anyone: sent to one page to fold in (all would fold it twice)."""
        with self.lock:
            st = self._stat()
            if st is None or st == self.stat:
                return
            self.stat = st
            try:
                now = read_text(self.path)
            except DocWriterError:
                return
            if now is None or now == self.disk:
                return
            self.disk = now
            target = self._latest()
            if target is not None:
                target.put(("external", {"text": now}))

    def persist(self) -> None:
        with self.lock:
            if not self.dirty:
                return
            state, disk, self.dirty = self.doc.get_update(), self.disk, False
        conn = _db()
        try:
            conn.execute("INSERT INTO docwriter_docs (path, state, disk, at) VALUES (?, ?, ?, ?) ON CONFLICT (path) DO "
                         "UPDATE SET state = excluded.state, disk = excluded.disk, at = excluded.at",
                         (self.path, state, disk, time.time()))
        finally:
            conn.close()


class Docs:
    """The documents open in DocWriter pages, by file (module doc): looked at every POLL seconds while open, written
    to dashboard.db every PERSIST, closed LINGER after their last page goes."""

    def __init__(self):
        self.lock = threading.Lock()
        self.rooms: Dict[str, Room] = {}
        self.closing = threading.Event()
        self.thread = threading.Thread(target=self._loop, name="ag-docwriter-docs", daemon=True)
        self.thread.start()

    def room(self, path: str) -> Room:
        with self.lock:
            r = self.rooms.get(path)
            if r is None:
                r = self.rooms[path] = Room(path)
            return r

    def drop(self, path: str) -> None:
        """A file's document forgotten: deleted, or moved (`move` keeps it under the new name)."""
        with self.lock:
            self.rooms.pop(path, None)
        conn = _db()
        try:
            conn.execute("DELETE FROM docwriter_docs WHERE path = ?", (path,))
        finally:
            conn.close()

    def move(self, old: str, new: str) -> None:
        r = self.rooms.get(old)
        if r is not None:
            r.persist()
        with self.lock:
            self.rooms.pop(old, None)
        conn = _db()
        try:
            conn.execute("DELETE FROM docwriter_docs WHERE path = ?", (new,))
            conn.execute("UPDATE docwriter_docs SET path = ? WHERE path = ?", (new, old))
        finally:
            conn.close()

    def _loop(self) -> None:
        last = 0.0
        while not self.closing.wait(POLL):
            with self.lock:
                rooms = list(self.rooms.items())
            for path, r in rooms:
                try:
                    if r.conns:
                        r.check()
                except Exception:  # noqa: BLE001 - one file's trouble is not the others'
                    pass
            if time.time() - last >= PERSIST:
                last = time.time()
                for path, r in rooms:
                    try:
                        r.persist()
                    except Exception:  # noqa: BLE001
                        pass
                    if not r.conns and r.left and time.time() - r.left > LINGER:
                        with self.lock:
                            if self.rooms.get(path) is r and not r.conns:
                                del self.rooms[path]

    def close(self) -> None:
        self.closing.set()
        with self.lock:
            rooms = list(self.rooms.values())
        for r in rooms:
            try:
                r.persist()
            except Exception:  # noqa: BLE001
                pass


# ---- the agent's tools, run in a page ---------------------------------------------------------------------------

class Tools:
    """The actor's tool calls passed to a page with its DocWriter open -- the one that opened its stream last -- and
    the page's answers back (module doc). What the tools are, the pages say (`listed`); kept, for an actor that starts
    before a page has said."""

    def __init__(self):
        self.lock = threading.Lock()
        self.streams: Dict[str, List[_Page]] = {}
        self.waiting: Dict[str, list] = {}         # call id -> [Event, result]

    def join(self, page: _Page) -> None:
        with self.lock:
            self.streams.setdefault(page.key, []).append(page)

    def leave(self, page: _Page) -> None:
        with self.lock:
            if page in self.streams.get(page.key, []):
                self.streams[page.key].remove(page)

    def listed(self, tools) -> None:
        if isinstance(tools, list) and tools:
            kv_set("*", {"tools": json.dumps(tools)})

    def tools(self) -> list:
        return _kv_json("*", "tools", [])

    def call(self, key: str, name: str, arguments: dict) -> dict:
        cid, start = secrets.token_hex(8), time.time()
        while True:                                  # none open yet: the dashboard's page opens it as the turn starts
            with self.lock:
                open_ = self.streams.get(key) or []
                target = open_[-1] if open_ else None
                if target is not None:
                    self.waiting[cid] = [threading.Event(), None]
            if target is not None or time.time() - start >= PAGE_WAIT:
                break
            time.sleep(TOOL_CHECK)
        if target is None:
            return mcp.result("DocWriter is not open in the dashboard, so the documents are not there to change: ask "
                              "me to show this DocWriter (select its actor in the dashboard), then try again.", error=True)
        target.put(("call", {"id": cid, "name": name, "arguments": arguments}))
        done, there, end = self.waiting[cid][0], True, time.time() + TOOL_WAIT
        while not done.wait(TOOL_CHECK) and time.time() < end:
            with self.lock:                          # its page gone before it answered: not waited for any longer
                there = target in self.streams.get(key, [])
            if not there:
                break
        with self.lock:
            got = self.waiting.pop(cid, [None, None])[1]
        if isinstance(got, dict):
            return got
        if not there:
            return mcp.result(f"DocWriter's page closed before it answered {name}, so it may or may not have been done: "
                              f"read_doc to see the document now, then try again. If DocWriter is not open, ask me to "
                              f"show it.", error=True)
        return mcp.result(f"DocWriter did not answer {name} in {int(TOOL_WAIT)} s: is its page still open?", error=True)

    def answered(self, cid: str, result) -> None:
        with self.lock:
            w = self.waiting.get(cid)
            if w is not None:
                w[1] = result
                w[0].set()


# ---- previews and their notices ----------------------------------------------------------------------------------

class Live:
    """DocWriter's /api/live, per folder: `preview_ready` {path} when a previewed file (a built PDF, say) changes --
    each file asked for at /api/preview watched PREVIEW_KEEP after -- or a hook built it."""

    def __init__(self):
        self.lock = threading.Lock()
        self.streams: Dict[str, List[_Page]] = {}
        self.watched: Dict[str, Tuple[str, float, Optional[tuple]]] = {}   # path -> (root, asked at, (mtime, size))
        self.closing = threading.Event()
        threading.Thread(target=self._loop, name="ag-docwriter-live", daemon=True).start()

    def join(self, root: str, page: _Page) -> None:
        with self.lock:
            self.streams.setdefault(root, []).append(page)

    def leave(self, root: str, page: _Page) -> None:
        with self.lock:
            if page in self.streams.get(root, []):
                self.streams[root].remove(page)

    def ring(self, root: str, event: str, value: dict) -> None:
        with self.lock:
            for page in self.streams.get(root, []):
                page.put(("live", {"event": event, "data": value}))

    def watch(self, root: str, path: str) -> None:
        with self.lock:
            had = self.watched.get(path)
            self.watched[path] = (root, time.time(), had[2] if had else _stat(path))

    def _loop(self) -> None:
        while not self.closing.wait(POLL * 2):
            with self.lock:
                items = list(self.watched.items())
            for path, (root, asked, was) in items:
                if time.time() - asked > PREVIEW_KEEP:
                    with self.lock:
                        self.watched.pop(path, None)
                    continue
                now = _stat(path)
                if now != was:
                    with self.lock:
                        if path in self.watched:
                            self.watched[path] = (root, asked, now)
                    if now is not None:
                        self.ring(root, "preview_ready", {"path": path})

    def close(self) -> None:
        self.closing.set()


def _stat(path: str) -> Optional[tuple]:
    try:
        s = os.stat(path)
        return (s.st_mtime_ns, s.st_size)
    except OSError:
        return None


# ---- the actor ---------------------------------------------------------------------------------------------------

def instructions(root: str) -> str:
    """What the actor is told, as DocWriter's own agent is (its system prompt), and where it is."""
    try:
        with open(INSTRUCTIONS, encoding="utf-8") as fh:
            prompt = fh.read()
    except OSError:
        prompt = ""
    return (f"# DocWriter\n\nYou are the agent of DocWriter, a writing app open in the ag dashboard, where the author "
            f"writes and reviews your work. The workspace is {root}: its files open in DocWriter as tabs. Change an open "
            f"document only with the docwriter-doc tools (read_doc, edit_doc, write_doc, comment_doc, reply_to_comment, "
            f"list_threads): your edits are proposed beside the text, and the file changes only when the author accepts "
            f"them. Each message from DocWriter carries the workspace's state (<workspace_state>) and the author's "
            f"request.\n\n{prompt}").strip()


def launch_args(s: dict) -> List[str]:
    """What a DocWriter actor's harness is started with besides its own options (sessions.py): DocWriter's document
    tools (the MCP server here), its instructions, and -- for Claude Code -- a hook refusing its own edit tools on an
    open document. [] for any other session."""
    try:
        role = json.loads(s.get("role") or "null")
    except ValueError:
        role = None
    key = role.get("docwriter") if isinstance(role, dict) else None
    if not key or not KEY.fullmatch(str(key)):
        return []
    base = f"{ORIGIN}/docwriter/w/{key}"
    told = instructions(s.get("cwd") or "")
    if s.get("harness") == "codex":
        return ["-c", f'mcp_servers.{mcp.NAME}.url="{base}/mcp"',
                "-c", f"developer_instructions={json.dumps(told, ensure_ascii=False)}"]
    guard = f"{shlex.quote(sys.executable)} {shlex.quote(GUARD)} {shlex.quote(base + '/guard')}"
    return ["--mcp-config", json.dumps({"mcpServers": {mcp.NAME: {"type": "http", "url": f"{base}/mcp"}}}),
            "--append-system-prompt", told,
            "--settings", json.dumps({"hooks": {"PreToolUse": [{"matcher": EDIT_TOOLS,
                                                                "hooks": [{"type": "command", "command": guard}]}]}})]


def record(gatherer: str, channel: str, kind: str, payload: dict) -> None:
    """What the author did in DocWriter, an event of the dashboard's in the actor's channel (`ag home insert`), in
    the background: ag takes a moment, and the author's click does not wait on it."""
    event = {"type": kind, "payload": {**payload, "by": "user", "via": "docwriter"}}

    def put() -> None:
        try:
            subprocess.run([*sessions.ag_command(), "home", "insert", gatherer, "--properties",
                            json.dumps({"channel": channel}), "--events", json.dumps([event])],
                           env=sessions.agent_env(), capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL)
        except (OSError, subprocess.SubprocessError, sessions.SessionError):
            pass
    threading.Thread(target=put, name="ag-docwriter-record", daemon=True).start()


class DocWriters:
    """Every DocWriter the dashboard serves (module doc)."""

    def __init__(self, started: sessions.Sessions):
        self.started = started
        self.docs = Docs() if AVAILABLE else None
        self.tools = Tools()
        self.live = Live()
        self.lock = threading.Lock()
        self.pages: Dict[Tuple[str, str], _Page] = {}

    def close(self) -> None:
        if self.docs is not None:
            self.docs.close()
        self.live.close()

    # -- which DocWriter

    def create(self, gatherer: str, cwd: str, harness: str = harness_kit.DEFAULT, model: Optional[str] = None) -> dict:
        """A new DocWriter on `cwd`, its actor a new session of `harness` in `gatherer` (a new gatherer if none has the
        name; its agent starts with its first message): its settings (`config`)."""
        if not AVAILABLE:
            raise DocWriterError("DocWriter needs pycrdt where the dashboard runs: pip install pycrdt, then restart it")
        root = os.path.realpath(os.path.abspath(os.path.expanduser(cwd or "")))
        if not os.path.isdir(root):
            raise DocWriterError(f"no directory {cwd}")
        with self.lock:
            key = secrets.token_hex(8)
            s = self.started.create(gatherer, root, "auto", harness if harness in sessions.HARNESSES else harness_kit.DEFAULT,
                                    model, role=json.dumps({"docwriter": key}))
            conn = _db()
            try:
                conn.execute("INSERT INTO docwriter (key, gatherer, root, session_id, created_at) VALUES (?, ?, ?, ?, ?)",
                             (key, gatherer, root, s["session_id"], time.time()))
            finally:
                conn.close()
            return self.config(key)

    def _session(self, sid: str, listed: Optional[dict] = None) -> Optional[dict]:
        """Its actor's session, under the id it has now (codex's renamed to its thread's)."""
        listed = listed if listed is not None else {s["session_id"]: s for s in self.started.list()}
        if sid in listed:
            return listed[sid]
        return next((s for s in listed.values() if s.get("started_as") == sid), None)

    def row(self, key: str) -> dict:
        if not KEY.fullmatch(key or ""):
            raise DocWriterError("no such DocWriter", 404)
        conn = _db()
        try:
            r = conn.execute("SELECT * FROM docwriter WHERE key = ?", (key,)).fetchone()
        finally:
            conn.close()
        if r is None:
            raise DocWriterError("no such DocWriter", 404)
        return dict(r)

    def config(self, key: str) -> dict:
        r = self.row(key)
        s = self._session(r["session_id"])
        out = {"key": key, "root": r["root"], "gatherer": r["gatherer"], "channel": s["session_id"] if s else r["session_id"],
               "harness": (s or {}).get("harness") or harness_kit.DEFAULT, "name": "DocWriter", "wake": wake()}
        if s is None:
            out["error"] = "This DocWriter's actor is gone: close DocWriter and open it again for a new one."
        return out

    def send(self, key: str, text: str) -> dict:
        """DocWriter's prompt to its actor: typed into its terminal, or starting it with it."""
        r = self.row(key)
        s = self._session(r["session_id"])
        if s is None:
            raise DocWriterError("This DocWriter's actor is gone: close DocWriter and open it again.", 409)
        try:
            sent = self.started.send(s["session_id"], text)
        except sessions.SessionError as exc:
            raise DocWriterError(str(exc), 409) from None
        self.name_actor(key)
        return sent

    def name_actor(self, key: str, name: Optional[str] = None) -> None:
        """Its actor named, once -- `name`, else "DocWriter · <folder>" -- as its first message is sent (`_name`)."""
        if kv_get(key, ["named"])["named"]:
            return
        kv_set(key, {"named": "1"})
        r = self.row(key)
        threading.Thread(target=self._name, args=(r["gatherer"], r["session_id"], r["root"], name),
                         name="ag-docwriter-name", daemon=True).start()

    def _name(self, gatherer: str, sid: str, root: str, name: Optional[str] = None) -> None:
        """Its actor named `name`, else "DocWriter · <folder>" -- else the list shows it by its first message,
        DocWriter's prompt -- once its gatherer has it (its first call): a name is an event there (naming.py)."""
        end = time.time() + NAME_WAIT
        now = (self._session(sid) or {}).get("session_id") or sid
        while time.time() < end and not sessions._has_calls(gatherer, now):
            time.sleep(2)
            now = (self._session(sid) or {}).get("session_id") or sid      # codex's: renamed to its thread
        try:
            naming.record(gatherer, now, name or f"DocWriter · {os.path.basename(root) or root}")
        except naming.NamingError:
            pass

    def record(self, key: str, kind: str, payload) -> None:
        if kind not in ("proposal_resolved", "comment", "reply", "doc_settings") or not isinstance(payload, dict):
            raise DocWriterError("not an event DocWriter records")
        r = self.row(key)
        s = self._session(r["session_id"])
        record(r["gatherer"], s["session_id"] if s else r["session_id"], kind, payload)

    def guard(self, key: str, path: str) -> Optional[str]:
        """Why the actor may not change `path` with its own tools -- it is open in DocWriter, where the author
        reviews each change -- or None: it may."""
        r = self.row(key)
        try:
            tab = tab_id(r["root"], path)
        except DocWriterError:
            return None
        if tab.startswith(".docwriter/"):
            return None
        if tab not in self._tabs(key)["order"]:
            return None
        return (f"{tab} is open in DocWriter, where the author reviews each change: propose this one with "
                f"mcp__{mcp.NAME}__edit_doc (or write_doc for the whole file) instead. The file changes when the "
                f"author accepts it.")

    # -- the page's streams and what it keeps

    def _doc_path(self, key: str, tab: str) -> str:
        if self.docs is None:
            raise DocWriterError("DocWriter needs pycrdt where the dashboard runs", 503)
        root = self.row(key)["root"]
        return inside(root, tab_id(root, tab))

    def join_page(self, key: str, cid: str):
        """A page's one stream (`_Page`): (the page, what to call once it goes -- its documents left, its tool calls and
        notices no longer sent it). A page coming back under the same id takes its old stream's place."""
        root = self.row(key)["root"]
        if not cid:
            raise DocWriterError("no connection id")
        page = _Page(key, cid)
        with self.lock:
            old = self.pages.pop((key, cid), None)
            self.pages[(key, cid)] = page
        if old is not None:
            old.put(None)
        self.tools.join(page)
        self.live.join(root, page)

        def leave() -> None:
            with self.lock:
                if self.pages.get((key, cid)) is page:
                    del self.pages[(key, cid)]
            self.tools.leave(page)
            self.live.leave(root, page)
            for room in list(page.rooms.values()):
                room.leave(cid)
        return page, leave

    def _page(self, key: str, cid: str) -> _Page:
        with self.lock:
            page = self.pages.get((key, cid))
        if page is None:
            raise DocWriterError("no stream of this page open: open it first", 409)
        return page

    def join_doc(self, key: str, cid: str, tab: str) -> dict:
        """A page's copy of a document begun (Room.join's): what changes after comes through its stream."""
        page = self._page(key, cid)
        room = self.docs.room(self._doc_path(key, tab))
        page.rooms[tab] = room
        return room.join(page.sink(tab))

    def leave_doc(self, key: str, cid: str, tab: str) -> None:
        page = self._page(key, cid)
        room = page.rooms.pop(tab, None)
        if room is not None:
            room.leave(cid)

    def edit_doc(self, key: str, tab: str, cid: str, update: bytes) -> None:
        self.docs.room(self._doc_path(key, tab)).edit(cid, update)

    def save_doc(self, key: str, tab: str, cid: str, text: str) -> dict:
        return self.docs.room(self._doc_path(key, tab)).save(cid, text)

    def _scope(self, key: str, name: str) -> str:
        """Where a name is kept: what the actor last saw, per DocWriter (its actor); the rest, per folder."""
        return key if name.startswith(("last_seen:", "last_render:")) else self.row(key)["root"]

    def kv(self, key: str, names: List[str]) -> Dict[str, Optional[str]]:
        out: Dict[str, Optional[str]] = {}
        for name in names[:500]:
            out.update(kv_get(self._scope(key, name), [name]))
        return out

    def kv_set(self, key: str, values: dict) -> None:
        for name, value in list(values.items())[:500]:
            kv_set(self._scope(key, str(name)), {str(name): None if value is None else str(value)})

    # -- the page's synchronous file calls (its server code's fs: src/server/fs.ts)

    def fs(self, key: str, body: dict) -> dict:
        root = self.row(key)["root"]
        op = body.get("op")
        if op == "open":
            return self.api(key, "POST", "tabs", {}, {"id": body.get("id"), "activate": bool(body.get("activate"))})[1]
        path = inside(root, str(body.get("path") or ""))
        if op == "exists":
            return {"exists": os.path.exists(path)}
        if op == "read":
            text = read_text(path)
            if text is None:
                raise DocWriterError(f"ENOENT: no such file, open '{path}'", 404)
            return {"text": text}
        if op == "write":
            write_text(path, str(body.get("text") or ""))
            return {}
        if op == "mkdir":
            os.makedirs(path, exist_ok=True)
            return {}
        raise DocWriterError(f"no operation {op!r}")

    # -- DocWriter's /api routes

    def _tabs(self, key: str) -> dict:
        """The DocWriter's open tabs: its own, not its folder's (another DocWriter there has its own)."""
        got = _kv_json(key, "tabs", {})
        order = [t for t in got.get("order", []) if isinstance(t, str)]
        active = got.get("active") if got.get("active") in order else (order[0] if order else None)
        return {"order": order, "active": active}

    def _set_tabs(self, key: str, order: List[str], active: Optional[str]) -> dict:
        kv_set(key, {"tabs": json.dumps({"order": order, "active": active})})
        return {"order": order, "active": active, "tabs": order}

    def api(self, key: str, method: str, route: str, q: dict, body) -> Tuple[int, dict]:
        """One of DocWriter's /api routes: (status, the JSON answer)."""
        r = self.row(key)
        root, scope = r["root"], r["root"]
        body = body if isinstance(body, dict) else {}
        if route == "tabs":
            state = self._tabs(key)
            order, active = state["order"], state["active"]
            if method == "GET":
                return 200, {**state, "tabs": order,
                             "missing": [t for t in order if not os.path.exists(os.path.join(root, t))]}
            if method == "POST":
                tab = tab_id(root, str(body.get("id") or ""))
                path = inside(root, tab)
                if not os.path.exists(path):
                    write_text(path, "")
                if tab not in order:
                    order = order + [tab]
                return 200, self._set_tabs(key, order, tab if body.get("activate", True) else active or tab)
            if method == "PATCH":
                tab = str(body.get("id") or "")
                if body.get("newId"):
                    new = tab_id(root, str(body["newId"]))
                    old_path, new_path = inside(root, tab, must_exist=True), inside(root, new)
                    if os.path.exists(new_path):
                        raise DocWriterError(f"{new} exists already", 409)
                    os.makedirs(os.path.dirname(new_path), exist_ok=True)
                    os.rename(old_path, new_path)
                    if self.docs:
                        self.docs.move(old_path, new_path)
                    order = [new if t == tab else t for t in order]
                    return 200, self._set_tabs(key, order, new if active == tab else active)
                if tab in order and body.get("active"):
                    return 200, self._set_tabs(key, order, tab)
                return 200, {**state, "tabs": order}
            if method == "DELETE":
                tab = str(q.get("id") or "")
                if tab in order:
                    i = order.index(tab)
                    order = order[:i] + order[i + 1:]
                    if active == tab:
                        active = order[min(i, len(order) - 1)] if order else None
                if q.get("deleteFile") == "true":
                    path = inside(root, tab)
                    if os.path.isfile(path):
                        os.unlink(path)
                    if self.docs:
                        self.docs.drop(path)
                return 200, self._set_tabs(key, order, active)
        if route == "document":
            meta = {**DEFAULT_META, **_kv_json(scope, "meta", {})}
            if method == "GET":
                if q.get("tab"):
                    text = read_text(inside(root, q["tab"]))
                    return 200, {"tabId": q["tab"], "content": text or "", "meta": meta}
                return 200, {"meta": meta}
            if method == "PUT":
                got = body.get("meta") if isinstance(body.get("meta"), dict) else {}
                if isinstance(got.get("rules"), list):
                    meta["rules"] = got["rules"]
                if isinstance(got.get("agentSettings"), dict):
                    meta["agentSettings"] = {**meta["agentSettings"], **got["agentSettings"]}
                kv_set(scope, {"meta": json.dumps(meta)})
                return 200, {"ok": True, "meta": meta}
        if route == "files":
            return self._files(key, root, method, q, body)
        if route == "session":
            kept = _kv_json(scope, "session", {})
            if method == "GET":
                return 200, {"serverInstanceId": key, "sessionId": self.config(key)["channel"],
                             "recentActions": kept.get("recentActions", []), "actionUsageCounts": kept.get("actionUsageCounts", {}),
                             "editorSoftWrap": kept.get("editorSoftWrap", True), "editorLineNumbers": kept.get("editorLineNumbers", False),
                             "theme": kept.get("theme", "light")}
            if method == "PUT":
                kv_set(scope, {"session": json.dumps({**kept, **{k: v for k, v in body.items() if k in (
                    "recentActions", "actionUsageCounts", "editorSoftWrap", "editorLineNumbers", "theme")}})})
                return 200, {"ok": True}
            if method == "DELETE":                   # "New session": what the agent last saw, forgotten
                conn = _db()
                try:
                    conn.execute("DELETE FROM docwriter_kv WHERE scope = ? AND (name LIKE 'last_seen:%' OR name LIKE "
                                 "'last_render:%')", (key,))
                finally:
                    conn.close()
                return 200, {"ok": True}
        if route == "reviewers":
            customs = _kv_json(scope, "reviewers", [])
            if method == "GET":
                return 200, {"reviewers": customs}
            if method == "POST":
                if not str(body.get("name") or "").strip() or not str(body.get("prompt") or "").strip():
                    raise DocWriterError("a reviewer needs a name and a prompt")
                rev = {"id": "rev_" + secrets.token_hex(6), "name": str(body["name"]).strip(), "icon": body.get("icon"),
                       "color": body.get("color"), "prompt": str(body["prompt"]).strip()}
                kv_set(scope, {"reviewers": json.dumps(customs + [rev])})
                return 200, {"reviewer": rev}
        if route == "hooks":
            if method == "GET":
                return 200, {"hooks": self._hooks(root)}
            if method == "PUT":
                hooks = [h for h in body.get("hooks") or [] if isinstance(h, dict)]
                write_text(os.path.join(root, ".docwriter", "hooks.json"), json.dumps({"hooks": hooks}, indent=2) + "\n")
                return 200, {"ok": True, "hooks": hooks}
        if route == "hooks/run" and method == "POST":
            return 200, self._run_hook(root, str(body.get("id") or ""), body.get("file"))
        if route == "hooks/preview-match" and method == "GET":
            return 200, {"outputPath": self._preview_match(root, q.get("file") or "")}
        if route == "synctex" and method == "POST":
            return 200, synctex(root, body)
        if route in ("history",) and method == "GET":
            return 200, {"provider": self.config(key)["harness"], "raw": [], "messages": []}
        if route == "models" and method == "GET":
            return 200, {"models": []}
        if route == "sessions" and method == "GET":
            return 200, {"sessions": []}
        if route == "keys" and method == "GET":
            return 200, {"providers": []}
        if route == "skills" and method == "GET":
            return 200, {"skills": [], "nativeDirs": []}
        if route == "style-profile" and method == "GET":     # style references are not offered: its pill quiet
            return 200, {"status": "off", "unresolvedCount": 0, "hasUnpublishedChanges": False}
        if route == "opengraph":
            return 200, {"error": "link previews are not fetched here"}
        raise DocWriterError(f"DocWriter's {route} is not offered here", 404)

    def _files(self, key: str, root: str, method: str, q: dict, body: dict) -> Tuple[int, dict]:
        if method == "GET":
            rel = (q.get("path") or "").strip("/")
            where = inside(root, rel) if rel else root
            if not os.path.isdir(where):
                raise DocWriterError(f"{rel} is not a folder", 404)
            entries = []
            with os.scandir(where) as it:
                for e in it:
                    if e.name in SKIPPED:
                        continue
                    folder = e.is_dir(follow_symlinks=False)
                    path = f"{rel}/{e.name}" if rel else e.name
                    entries.append({"name": e.name, "kind": "folder" if folder else "file", "path": path,
                                    "watched": not folder and _ext(e.name) in SOURCES, "internal": path.startswith(".docwriter")})
            entries.sort(key=lambda x: (x["kind"] != "folder", x["name"].lower()))
            return 200, {"entries": entries}
        if method == "POST":
            path = inside(root, tab_id(root, str(body.get("path") or "")))
            if "content" in body:
                if os.path.exists(path):
                    return 409, {"error": "exists"}
                raw = base64.b64decode(str(body["content"])) if body.get("encoding") == "base64" else str(body["content"]).encode()
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "wb") as fh:
                    fh.write(raw)
                return 200, {"ok": True}
            if os.path.exists(path):
                return 409, {"error": f"{body.get('path')} exists already"}
            if body.get("kind") == "folder":
                os.makedirs(path)
            else:
                write_text(path, "")
            return 200, {"ok": True}
        if method == "PATCH":
            old = inside(root, tab_id(root, str(body.get("from") or "")), must_exist=True)
            new_id = tab_id(root, str(body.get("to") or ""))
            new = inside(root, new_id)
            if os.path.exists(new):
                return 409, {"error": f"{body.get('to')} exists already"}
            os.makedirs(os.path.dirname(new), exist_ok=True)
            os.rename(old, new)
            if self.docs:
                self.docs.move(old, new)
            old_id = tab_id(root, str(body.get("from")))
            state = self._tabs(key)
            moved = [new_id + t[len(old_id):] if t == old_id or t.startswith(old_id + "/") else t for t in state["order"]]
            act = state["active"]
            if act and (act == old_id or act.startswith(old_id + "/")):
                act = new_id + act[len(old_id):]
            self._set_tabs(key, moved, act)
            return 200, {"ok": True}
        if method == "DELETE":
            rel = tab_id(root, q.get("path") or "")
            path = inside(root, rel, must_exist=True)
            if os.path.isdir(path) and not os.path.islink(path):
                shutil.rmtree(path)
            else:
                os.unlink(path)
            if self.docs:
                self.docs.drop(path)
            state = self._tabs(key)
            order = [t for t in state["order"] if t != rel and not t.startswith(rel + "/")]
            self._set_tabs(key, order, state["active"] if state["active"] in order else (order[0] if order else None))
            return 200, {"ok": True}
        raise DocWriterError("not a files request", 405)

    def _hooks(self, root: str) -> list:
        try:
            with open(os.path.join(root, ".docwriter", "hooks.json"), encoding="utf-8") as fh:
                got = json.load(fh)
        except (OSError, ValueError):
            return []
        return [h for h in got.get("hooks", []) if isinstance(h, dict)] if isinstance(got, dict) else []

    def _run_hook(self, root: str, hook_id: str, file) -> dict:
        """A hook's command, run in the folder as DocWriter runs it (its shell, {{file}} {{stem}} {{tool}} filled in):
        its exit, and the last HOOK_KEEP characters of what it printed. What it built, if it says (`output`), is a
        preview made new."""
        hook = next((h for h in self._hooks(root) if h.get("id") == hook_id), None)
        if hook is None:
            raise DocWriterError("no such hook", 404)
        command = fill(str(hook.get("command") or ""), file if isinstance(file, str) else "")
        started = time.time()
        try:
            done = subprocess.run(command, shell=True, cwd=root, capture_output=True, text=True, timeout=HOOK_TIMEOUT,
                                  stdin=subprocess.DEVNULL)
            code, out, err = done.returncode, done.stdout, done.stderr
        except subprocess.TimeoutExpired as exc:
            code, out, err = -1, str(exc.stdout or ""), f"timed out after {HOOK_TIMEOUT} s"
        entry = {"hookId": hook_id, "event": hook.get("event"), "command": command, "status": "done" if code == 0 else "failed",
                 "exitCode": code, "stdout": (out or "")[-HOOK_KEEP:], "stderr": (err or "")[-HOOK_KEEP:],
                 "durationMs": int((time.time() - started) * 1000)}
        if code == 0 and hook.get("output"):
            built = inside(root, fill(str(hook["output"]), file if isinstance(file, str) else ""))
            self.live.ring(root, "preview_ready", {"path": built})
        return {"ok": True, "entry": entry}

    def _preview_match(self, root: str, file: str) -> Optional[str]:
        """What a source file builds, for its preview: a .tex file's PDF beside it, else the first enabled hook's
        `output` (absolute)."""
        if not file:
            return None
        try:
            src = inside(root, file)
        except DocWriterError:
            return None
        if _ext(src) == "tex":
            pdf = src[:-4] + ".pdf"
            if os.path.isfile(pdf):
                return pdf
        for h in self._hooks(root):
            if h.get("enabled", True) and h.get("output"):
                try:
                    return inside(root, fill(str(h["output"]), file))
                except DocWriterError:
                    return None
        return None

    def preview(self, key: str, path: str) -> Tuple[bytes, str]:
        """A file of the folder as it is, for the preview (a PDF, an image, a page); watched from now on, so a change
        to it reloads the preview (`Live`)."""
        root = self.row(key)["root"]
        full = inside(root, path, must_exist=True)
        if not os.path.isfile(full):
            raise DocWriterError(f"{path} is not a file")
        with open(full, "rb") as fh:
            raw = fh.read()
        self.live.watch(root, full)
        kind = {"pdf": "application/pdf", "md": "text/plain; charset=utf-8", "txt": "text/plain; charset=utf-8",
                "html": "text/html; charset=utf-8", "htm": "text/html; charset=utf-8", "svg": "image/svg+xml"}.get(_ext(full)) \
            or mimetypes.guess_type(full)[0] or "application/octet-stream"
        return raw, kind


def fill(template: str, file: str) -> str:
    """A hook's {{file}}, {{stem}} (the file without its last extension) and {{tool}}, as DocWriter fills them."""
    stem = file.rsplit(".", 1)[0] if "." in os.path.basename(file) else file
    return template.replace("{{file}}", file).replace("{{stem}}", stem).replace("{{tool}}", "")


def synctex(root: str, body: dict) -> dict:
    """SyncTeX, as DocWriter asks it: a place in the PDF to its source line (`synctex edit`), or, `mode` forward, a
    source line to its place in the PDF (`synctex view`). {ok: false, reason} when it has no answer, or no synctex."""
    pdf = inside(root, str(body.get("pdf") or ""), must_exist=True)
    try:
        if body.get("mode") == "forward":
            src = inside(root, str(body.get("file") or ""), must_exist=True)
            line, col = int(body.get("line") or 0), int(body.get("column") or 0)
            if line < 1:
                raise DocWriterError("line: 1 or more")
            out = _synctex(["view", "-i", f"{line}:{col}:{src}", "-o", pdf], root)
            got = {}
            for raw in out.splitlines():
                k, _, v = raw.partition(":")
                if k in ("Page", "x", "y", "h", "v", "W", "H") and k not in got:
                    got[k] = v.strip()
                if raw.startswith("SyncTeX result end"):
                    break
            if "Page" not in got:
                return {"ok": False, "reason": "no-match"}
            num = lambda k: float(got[k]) if k in got else None   # noqa: E731
            return {"ok": True, "page": int(float(got["Page"])), "x": num("x"), "y": num("y"), "h": num("h"),
                    "v": num("v"), "w": num("W"), "height": num("H")}
        page, x, y = float(body.get("page")), float(body.get("x")), float(body.get("y"))
        out = _synctex(["edit", "-o", f"{round(page)}:{x}:{y}:{pdf}"], root)
    except (TypeError, ValueError):
        raise DocWriterError("page, x and y: numbers") from None
    src, line = None, None
    begun = False
    for raw in out.splitlines():
        begun = begun or raw.startswith("SyncTeX result begin")
        if begun and raw.startswith("Input:") and src is None:
            src = raw[len("Input:"):].strip()
        elif begun and raw.startswith("Line:") and line is None:
            line = int(raw[len("Line:"):].strip() or 0)
    if not src or not line:
        return {"ok": False, "reason": "no-match"}
    full = os.path.normpath(src if os.path.isabs(src) else os.path.join(os.path.dirname(pdf), src))
    try:
        rel = tab_id(root, inside(root, full))
    except DocWriterError:
        return {"ok": False, "reason": "outside-workspace"}
    return {"ok": True, "file": rel, "line": line}


def _synctex(args: List[str], root: str) -> str:
    try:
        return subprocess.run(["synctex", *args], cwd=root, capture_output=True, text=True, timeout=20,
                              stdin=subprocess.DEVNULL).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


# ---- the page's own files ------------------------------------------------------------------------------------------

STATIC_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
                ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
                ".ftl": "text/plain; charset=utf-8", ".bcmap": "application/octet-stream", ".pfb": "application/octet-stream",
                ".png": "image/png", ".gif": "image/gif", ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8"}


def asset(rel: str) -> Optional[Tuple[bytes, str]]:
    """A file of the built page (vendor/docwriter/), by its path there: "" its page, "preview" its preview's."""
    rel = {"": "index.html", "preview": "preview.html"}.get(rel, rel)
    full = os.path.normpath(os.path.join(VENDOR, rel))
    if not full.startswith(VENDOR + os.sep) or not os.path.isfile(full):
        return None
    with open(full, "rb") as fh:
        return fh.read(), STATIC_TYPES.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
