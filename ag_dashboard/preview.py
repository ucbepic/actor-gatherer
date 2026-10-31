"""The Editor panel's Execute button: each git project's PREVIEW -- a command the dashboard runs in the checkout of the
file open in the Editor, and what it makes, shown in a panel beside the file -- kept in the dashboard's own database,
set by the reader in that panel or by an actor with `ag preview` (ag/cli/preview.py).

    a project's preview     table `previews` in <home>/dashboard.db, one row per git repository (`place`: its real path;
                            a worktree's, its repository's -- branches.py's `repository` -- so all its worktrees share
                            one; a folder in none, the folder itself): `command`, a shell's ("": none -- what it shows
                            is shown as it is), `show` (a path in the checkout; a URL, the page of a server the command
                            starts; "": its output), each naming the file open in the Editor by {file}, {stem}, {name},
                            {dir} (`expand`); who set it (`set_by`: READER, from the page; else the actor's id, or "cli",
                            a shell not an actor's) and when; and `allowed`: the command the reader set, or let run.
    who may run it          the reader, from the page -- an actor's command once the reader lets it run (`ok`), which
                            makes it `allowed`; an actor, with `ag preview run`, only the command `allowed`: through the
                            dashboard, an actor never runs a command the reader has not seen.
    a run                   `Runs.start`: in the checkout (git's top folder, of the file's), through the user's shell,
                            its output (stdout and stderr, as they come) kept -- its last KEEP bytes -- and sent to the
                            pages that watch the checkout (`watch`); one at a time in a checkout, a new one stopping the
                            one before. A command that shows a URL is a server: kept running until stopped, the
                            dashboard stops, or no page has watched it for IDLE; `ready` once the URL answers. Any other
                            is stopped after TIMEOUT.
    what it shows           a file of the checkout, served to the page under a token of the checkout's (`token`,
                            `file`): never one outside it. HTML and SVG are served sandboxed by server.py (an origin of
                            their own: a page previewed cannot call the dashboard's API). A PDF is shown in pdf.js's
                            viewer -- DocWriter's copy, PDFJS (`viewer_file`) -- which the page keeps from run to run,
                            each new build opened in it where the reader was; and SyncTeX between it and its source
                            (`synctex`, DocWriter's), for a build that wrote it (-synctex=1)."""

import codecs
import json
import mimetypes
import os
import queue
import re
import secrets
import shlex
import shutil
import signal
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.request
from contextlib import closing
from typing import Callable, Dict, List, Optional, Tuple

from . import branches, home, sessions

SCHEMA = """CREATE TABLE IF NOT EXISTS previews (
    repo    TEXT PRIMARY KEY,
    command TEXT NOT NULL DEFAULT '',
    show    TEXT NOT NULL DEFAULT '',
    set_by  TEXT NOT NULL DEFAULT '',
    set_at  REAL NOT NULL,
    allowed TEXT
)"""
READER = ""                 # `set_by` of a preview the reader set, from the page
TIMEOUT = 300.0             # seconds a command that is not a server is given
IDLE = 600.0                # seconds a server is kept running with no page watching it
READY_WAIT = 120.0          # seconds a server's URL is tried for, until it answers
STOP_WAIT = 3.0             # seconds a command is given to end once asked to (SIGTERM), before it is killed
KEEP = 256_000              # the most bytes of a run's output kept: its last
TAIL = 4000                 # the most characters of its output an actor's `ag preview run` is told
MAX_FILE = 100_000_000      # the largest file served
PDFJS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor", "docwriter", "pdfjs")   # pdf.js, its viewer
URL = re.compile(r"https?://", re.I)
NAMES = re.compile(r"\{(file|stem|name|dir)\}")

#: What a guess runs a file of each kind with, and the kinds shown as they are.
RUN_WITH = {".py": "python3 {file}", ".js": "node {file}", ".mjs": "node {file}", ".sh": "sh {file}",
            ".r": "Rscript {file}", ".rb": "ruby {file}", ".jl": "julia {file}"}
SHOWN_AS_IS = {".html", ".htm", ".svg", ".md", ".markdown", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"}
IMAGES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif"}


class PreviewError(ValueError):
    """What the page, or the actor's `ag preview`, is told: why a preview cannot be set or run."""


def _db() -> sqlite3.Connection:
    os.makedirs(home.HOME, exist_ok=True)
    conn = sqlite3.connect(sessions.db_path(), timeout=8, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


# ---- whose preview: a file's or folder's project

def place(path: str) -> Tuple[str, str]:
    """(key, checkout) of a file or folder: its git repository's real path -- a worktree's, its repository's -- and
    the checkout holding it (git's top folder); in no repository, its folder both."""
    path = os.path.realpath(os.path.expanduser(path or ""))
    folder = path if os.path.isdir(path) else os.path.dirname(path)
    if not path or not os.path.isdir(folder):
        raise PreviewError(f"no folder {folder or path!r} here")
    repo = branches.repository(folder)
    if repo is None:
        return folder, folder
    try:
        top = os.path.realpath(branches._out(folder, "rev-parse", "--show-toplevel"))
    except branches.BranchError:                    # a folder in .git, or a bare repository
        top = repo
    return repo, top


def _row(r) -> Optional[dict]:
    if r is None:
        return None
    d = dict(r)
    d["needs_ok"] = bool(d["command"]) and d["set_by"] != READER and d["allowed"] != d["command"]
    return d


def get(key: str) -> Optional[dict]:
    """The project's preview, `needs_ok` with it: a command an actor set that the reader has not let run yet."""
    with closing(_db()) as conn:
        return _row(conn.execute("SELECT * FROM previews WHERE repo = ?", (key,)).fetchone())


def put(key: str, command: str, show: str, by: str = READER) -> dict:
    """The project's preview set: by the reader (READER: the command `allowed` too), or by an actor (its id)."""
    command, show = (command or "").strip(), (show or "").strip()
    if not command and not show:
        raise PreviewError("a command to run, or what to show, or both")
    if "\n" in show:
        raise PreviewError("what to show is one path, or one URL")
    with closing(_db()) as conn:
        old = conn.execute("SELECT allowed FROM previews WHERE repo = ?", (key,)).fetchone()
        allowed = command if by == READER else (old["allowed"] if old else None)
        conn.execute("INSERT OR REPLACE INTO previews (repo, command, show, set_by, set_at, allowed) VALUES (?, ?, ?, ?, ?, ?)",
                     (key, command, show, by, time.time(), allowed))
        return _row(conn.execute("SELECT * FROM previews WHERE repo = ?", (key,)).fetchone())


def allow(key: str, command: str) -> None:
    """The reader let the command run: run without asking from now on, an actor's `ag preview run` too."""
    with closing(_db()) as conn:
        conn.execute("UPDATE previews SET allowed = ? WHERE repo = ? AND command = ?", (command, key, command))


def clear(key: str) -> None:
    with closing(_db()) as conn:
        conn.execute("DELETE FROM previews WHERE repo = ?", (key,))


def expand(text: str, file: Optional[str], checkout: str, quote: bool = False) -> str:
    """`text` with {file}, {stem} (the file without its extension), {name} (without its folder) and {dir} (its folder)
    as the file is in the checkout -- `quote`: each as a shell word."""
    if not NAMES.search(text or ""):
        return text or ""
    if not file:
        raise PreviewError(f"{text!r} names the file open in the Editor ({{file}}, ...): open a file first")
    rel = os.path.relpath(os.path.realpath(file), checkout)
    if rel == ".." or rel.startswith(".." + os.sep):
        raise PreviewError(f"{file} is not in {checkout}")
    vals = {"file": rel, "stem": os.path.splitext(rel)[0], "name": os.path.basename(rel), "dir": os.path.dirname(rel) or "."}
    return NAMES.sub(lambda m: shlex.quote(vals[m.group(1)]) if quote else vals[m.group(1)], text)


def inside(checkout: str, rel: str) -> Optional[str]:
    """The path `rel` names in the checkout, real, if it is in it; None: outside it."""
    p = os.path.realpath(os.path.join(checkout, rel))
    return p if p == checkout or p.startswith(checkout.rstrip(os.sep) + os.sep) else None


def kind_of(path: str) -> str:
    """How the page shows a file: image, svg, pdf, html, markdown or text."""
    ext = os.path.splitext(path)[1].lower()
    return ("image" if ext in IMAGES else "svg" if ext == ".svg" else "pdf" if ext == ".pdf"
            else "html" if ext in (".html", ".htm") else "markdown" if ext in (".md", ".markdown") else "text")


def guess(file: Optional[str], checkout: str) -> dict:
    """A preview to start from, for a project with none: by the file open, else by what the checkout has."""
    ext = os.path.splitext(file or "")[1].lower()
    if ext == ".tex":
        return {"command": "latexmk -pdf -synctex=1 -cd -interaction=nonstopmode {file}", "show": "{stem}.pdf"}
    if ext in RUN_WITH:
        return {"command": RUN_WITH[ext], "show": ""}
    if ext in SHOWN_AS_IS:
        return {"command": "", "show": "{file}"}
    try:
        with open(os.path.join(checkout, "package.json"), encoding="utf-8") as fh:
            scripts = json.load(fh).get("scripts") or {}
    except (OSError, ValueError, AttributeError):
        scripts = {}
    for name in ("dev", "start"):
        script = scripts.get(name) if isinstance(scripts, dict) else None
        if isinstance(script, str):
            port = 5173 if "vite" in script else 4321 if "astro" in script else 3000
            return {"command": f"npm run {name}", "show": f"http://localhost:{port}"}
    if any(os.path.isfile(os.path.join(checkout, m)) for m in ("Makefile", "makefile")):
        return {"command": "make", "show": ""}
    return {"command": "", "show": ""}


# ---- runs

class Run:
    """One run of a project's preview in a checkout: its process, if it has a command, and its output."""

    def __init__(self, key: str, checkout: str, command: str, show: str, by: str, file: Optional[str]):
        self.id = secrets.token_hex(6)
        self.key, self.checkout, self.command, self.show, self.by, self.file = key, checkout, command, show, by, file
        self.url = show if URL.match(show) else None
        self.started, self.ended, self.code = time.time(), None, None
        self.state = "running"          # running, ready (a server whose URL answers), done, failed, stopped, timed out
        self.stopping: Optional[str] = None     # why it was asked to end: "stopped", "timed out"
        self.out, self.dropped = bytearray(), 0
        self.proc: Optional[subprocess.Popen] = None
        self.over = threading.Event()   # its process ended (or it had none)
        self.changed = threading.Condition()
        self.unwatched: Optional[float] = None  # since when no page has watched it

    def shows(self) -> dict:
        """What it shows: {url} or {path (real), rel, kind, exists, mtime}; {} its output."""
        if self.url:
            return {"url": self.url, "kind": "url"}
        if not self.show:
            return {}
        p = inside(self.checkout, self.show)
        if p is None:
            return {"rel": self.show, "error": f"{self.show} is not in {self.checkout}", "kind": "text"}
        try:
            st = os.stat(p)
            return {"path": p, "rel": os.path.relpath(p, self.checkout), "kind": kind_of(p), "exists": True, "mtime": st.st_mtime,
                    "size": st.st_size}
        except OSError:
            return {"path": p, "rel": os.path.relpath(p, self.checkout), "kind": kind_of(p), "exists": False}

    def view(self) -> dict:
        return {"id": self.id, "checkout": self.checkout, "command": self.command, "show": self.show, "by": self.by,
                "file": self.file, "started": self.started, "ended": self.ended, "code": self.code, "state": self.state,
                "server": bool(self.url and self.command), "shows": self.shows()}

    def text(self) -> str:
        return bytes(self.out).decode("utf-8", "replace")


class Watcher:
    """A page's stream of a checkout's runs: (name, value) on its queue, None when it ends."""

    def __init__(self, key: str, checkout: str):
        self.key, self.checkout, self.queue = key, checkout, queue.Queue()


class Runs:
    """The previews run by this dashboard: each checkout's latest run, and the pages that watch them."""

    def __init__(self, env: Optional[Callable[[], Dict[str, str]]] = None):
        self.lock = threading.Lock()
        self.runs: Dict[str, Run] = {}          # checkout -> its latest run
        self.tokens: Dict[str, str] = {}        # token -> checkout, for its files' paths on the page
        self.watchers: List[Watcher] = []
        self.env = env or sessions.agent_env
        self.closed = threading.Event()
        threading.Thread(target=self._idle, name="ag-preview-idle", daemon=True).start()

    # -- what the page and `ag preview` ask

    def token(self, checkout: str) -> str:
        with self.lock:
            for t, c in self.tokens.items():
                if c == checkout:
                    return t
            t = secrets.token_hex(8)
            self.tokens[t] = checkout
            return t

    def about(self, path: str) -> dict:
        """A file's or folder's project, its preview (a guess when it has none) and its checkout's latest run."""
        key, checkout = place(path)
        row = get(key)
        file = os.path.realpath(path) if os.path.isfile(path) else None
        run = self.runs.get(checkout)
        return {"key": key, "checkout": checkout, "name": os.path.basename(key) or key,
                "git": branches.repository(checkout) is not None, "preview": row,
                "guess": guess(file, checkout) if row is None else None, "run": run.view() if run else None,
                "token": self.token(checkout), "pdfjs": os.path.isfile(os.path.join(PDFJS, "web", "viewer.html"))}

    def set(self, path: str, command: str, show: str, by: str = READER) -> dict:
        key, _ = place(path)
        put(key, command, show, by)
        self._tell_key(key)
        return self.about(path)

    def clear(self, path: str) -> dict:
        key, _ = place(path)
        clear(key)
        self._tell_key(key)
        return self.about(path)

    def run(self, path: str, file: Optional[str] = None, ok: Optional[str] = None, by: str = READER,
            wait: float = 0.0) -> dict:
        """The project's preview run in the path's checkout: by the reader (`ok`: the command an actor set, which
        they let run), or by an actor (`by`: only the command allowed). With `wait`, waited for that long: until it
        ends, or its server answers. -> {run, output (its end), ...about}"""
        key, checkout = place(path)
        row = get(key)
        if row is None:
            raise PreviewError(f"no preview is set for {key}: set one with `ag preview set`, or in the Editor's preview")
        if row["needs_ok"]:
            if by != READER:
                raise PreviewError(f"the user has not let this command run yet ({row['command']!r}, set by "
                                   f"{_who(row['set_by'])}): they are asked when they next press Execute in the "
                                   f"Editor, and once they let it run, `ag preview run` runs it too")
            if ok != row["command"]:
                raise PreviewError("this command was set by an actor: let it run first")
            allow(key, row["command"])
        if file is None and os.path.isfile(path):
            file = os.path.realpath(path)
        r = self.start(key, checkout, row["command"], row["show"], file, by)
        if wait > 0:
            self.wait(r, wait)
        got = self.about(path)
        got["run"], got["output"] = r.view(), r.text()[-TAIL:]
        return got

    def stop(self, path: str) -> dict:
        _, checkout = place(path)
        self.end(checkout, "stopped")
        return self.about(path)

    # -- running

    def start(self, key: str, checkout: str, command: str, show: str, file: Optional[str], by: str = READER) -> Run:
        cmd = expand(command, file, checkout, quote=True)
        shown = expand(show, file, checkout)
        if shown and not URL.match(shown) and inside(checkout, shown) is None:
            raise PreviewError(f"what it shows, {shown}, is not in {checkout}")
        self.end(checkout, "stopped")                       # the one before: ended first (a server's port freed)
        r = Run(key, checkout, cmd, shown, by, file)
        with self.lock:
            r.unwatched = None if any(w.checkout == checkout for w in self.watchers) else time.time()
            self.runs[checkout] = r
        if not cmd:                                         # nothing to run: what it shows, shown
            r.state, r.ended = ("ready" if r.url else "done"), time.time()
            r.over.set()
            self._tell(r, "run", r.view())
            return r
        env = {**self.env(), "AG_PREVIEW_FILE": file or "", "AG_PREVIEW_CHECKOUT": checkout, "BROWSER": "none"}
        shell = os.environ.get("SHELL") or "/bin/sh"
        try:
            r.proc = subprocess.Popen([shell, "-c", cmd], cwd=checkout, env=env, stdin=subprocess.DEVNULL,
                                      stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        except OSError as exc:
            r.out += f"{shell}: {exc}\n".encode()
            r.state, r.ended = "failed", time.time()
            r.over.set()
            self._tell(r, "run", r.view())
            self._tell(r, "out", {"id": r.id, "text": r.text(), "reset": True})
            return r
        self._tell(r, "run", r.view())
        threading.Thread(target=self._read, args=(r,), name="ag-preview-run", daemon=True).start()
        if r.url:
            threading.Thread(target=self._ready, args=(r,), name="ag-preview-ready", daemon=True).start()
        else:
            timer = threading.Timer(TIMEOUT, lambda: self._kill(r, "timed out"))
            timer.daemon = True
            timer.start()
        return r

    def _read(self, r: Run) -> None:
        decoder = codecs.getincrementaldecoder("utf-8")("replace")
        fd = r.proc.stdout.fileno()
        while True:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                chunk = b""
            if not chunk:
                break
            with r.changed:
                r.out += chunk
                if len(r.out) > KEEP:
                    cut = len(r.out) - KEEP
                    del r.out[:cut]
                    r.dropped += cut
            text = decoder.decode(chunk)
            if text:
                self._tell(r, "out", {"id": r.id, "text": text})
        r.proc.stdout.close()
        code = r.proc.wait()
        with r.changed:                                     # the pages told before a waiter (`ag preview run`) is
            r.code, r.ended = code, time.time()
            r.state = r.stopping or ("done" if code == 0 else "failed")
            self._tell(r, "run", r.view())
            r.over.set()
            r.changed.notify_all()

    def _ready(self, r: Run) -> None:
        """A server's URL tried until it answers -- any answer, an error's too -- then the run `ready`."""
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        until = time.time() + READY_WAIT
        while time.time() < until and not r.over.is_set() and not self.closed.is_set():
            try:
                opener.open(r.url, timeout=2).close()
            except urllib.error.HTTPError:
                pass                                        # it answered
            except (urllib.error.URLError, OSError, ValueError):
                r.over.wait(0.4)
                continue
            with r.changed:
                if r.state != "running":
                    return
                r.state = "ready"
                self._tell(r, "run", r.view())
                r.changed.notify_all()
            return

    def _kill(self, r: Run, why: str) -> None:
        """The run's process -- and what it started, its process group -- ended: asked, then killed."""
        p = r.proc
        if p is None or r.over.is_set():
            return
        r.stopping = r.stopping or why
        for sig, wait in ((signal.SIGTERM, STOP_WAIT), (signal.SIGKILL, 2.0)):
            try:
                os.killpg(p.pid, sig)
            except (ProcessLookupError, PermissionError):
                pass
            if r.over.wait(wait):
                return

    def end(self, checkout: str, why: str) -> None:
        r = self.runs.get(checkout)
        if r is not None:
            self._kill(r, why)

    def wait(self, r: Run, seconds: float) -> None:
        """Until the run ends -- or is `ready`, a server -- or `seconds` pass."""
        until = time.time() + seconds
        with r.changed:
            while r.state == "running" and time.time() < until:
                r.changed.wait(min(0.5, max(0.0, until - time.time())))

    # -- the pages watching

    def watch(self, path: str) -> Tuple[Watcher, Callable[[], None]]:
        """A page's stream of the path's checkout: its latest run and output now, then each change -- of its runs,
        and of the project's preview -- as it comes."""
        key, checkout = place(path)
        w = Watcher(key, checkout)
        with self.lock:
            self.watchers.append(w)
            r = self.runs.get(checkout)
            if r is not None:
                r.unwatched = None
                w.queue.put(("run", r.view()))
                w.queue.put(("out", {"id": r.id, "text": r.text(), "reset": True, "dropped": r.dropped}))
        return w, lambda: self.leave(w)

    def leave(self, w: Watcher) -> None:
        with self.lock:
            if w in self.watchers:
                self.watchers.remove(w)
            r = self.runs.get(w.checkout)
            if r is not None and not any(x.checkout == w.checkout for x in self.watchers):
                r.unwatched = time.time()

    def _tell(self, r: Run, name: str, value) -> None:
        with self.lock:
            if self.runs.get(r.checkout) is not r:          # an earlier run's end, once the next has begun: not news
                return
            for w in self.watchers:
                if w.checkout == r.checkout:
                    w.queue.put((name, value))

    def _tell_key(self, key: str) -> None:
        row = get(key)
        with self.lock:
            for w in self.watchers:
                if w.key == key:
                    w.queue.put(("preview", row))

    def _idle(self) -> None:
        """A server no page has watched for IDLE, stopped."""
        while not self.closed.wait(min(30.0, IDLE / 4)):
            with self.lock:
                idle = [r for r in self.runs.values() if r.url and not r.over.is_set() and r.unwatched
                        and time.time() - r.unwatched > IDLE]
            for r in idle:
                self._kill(r, "stopped")

    # -- what it shows

    def file(self, token: str, rel: str) -> Tuple[bytes, str]:
        """A file of the checkout the token names, and its type; FileNotFoundError: none such, PermissionError: not
        in it."""
        checkout = self.tokens.get(token)
        if checkout is None:
            raise FileNotFoundError(token)
        p = inside(checkout, rel)
        if p is None:
            raise PermissionError(rel)
        if not os.path.isfile(p):
            raise FileNotFoundError(rel)
        if os.path.getsize(p) > MAX_FILE:
            raise PermissionError(f"{rel} is larger than {MAX_FILE // 1_000_000} MB")
        with open(p, "rb") as fh:
            body = fh.read()
        kind = mimetypes.guess_type(p)[0] or ("text/plain" if _texty(body) else "application/octet-stream")
        if kind.startswith("text/") or kind in ("application/json", "application/javascript", "image/svg+xml"):
            kind += "; charset=utf-8"
        return body, kind

    def close(self) -> None:
        self.closed.set()
        with self.lock:
            runs, watchers = list(self.runs.values()), list(self.watchers)
        threads = [threading.Thread(target=self._kill, args=(r, "stopped"), daemon=True) for r in runs]
        for t in threads:
            t.start()
        for t in threads:
            t.join(STOP_WAIT + 2.5)
        for w in watchers:
            w.queue.put(None)


def viewer_file(rel: str) -> Optional[Tuple[bytes, str]]:
    """A file of pdf.js (its build/ and web/, the viewer), by its path there; None: none such."""
    from .docwriter import STATIC_TYPES
    full = os.path.normpath(os.path.join(PDFJS, rel))
    if not full.startswith(PDFJS + os.sep) or not os.path.isfile(full):
        return None
    with open(full, "rb") as fh:
        return fh.read(), STATIC_TYPES.get(os.path.splitext(full)[1].lower(), "application/octet-stream")


def synctex(checkout: str, body: dict) -> dict:
    """SyncTeX between a PDF of the checkout (`pdf`) and its source, as DocWriter's `synctex` answers it: `mode`
    forward, a line of a source (`file`, `line`, `column`) to its place in the PDF {page, x, y, h, v, w, height: big
    points from the page's top left}; else a place in the PDF (`page`, `x`, `y`) to its source {file (in the
    checkout), line}. {ok: false, reason} with no answer: "no-synctex", the build wrote none (no -synctex=1);
    "no-tool", no `synctex` here; "no-match"."""
    from . import docwriter
    full = inside(checkout, str(body.get("pdf") or ""))
    if full is None or not os.path.isfile(full):
        raise PreviewError(f"no PDF {body.get('pdf')!r} in {checkout}")
    stem = os.path.splitext(full)[0]
    if not any(os.path.isfile(stem + ext) for ext in (".synctex.gz", ".synctex")):
        return {"ok": False, "reason": "no-synctex"}
    if shutil.which("synctex") is None:
        return {"ok": False, "reason": "no-tool"}
    return docwriter.synctex(checkout, {**body, "pdf": full})


def _texty(body: bytes) -> bool:
    head = body[:4096]
    if b"\0" in head:
        return False
    try:
        head.decode("utf-8")
        return True
    except UnicodeDecodeError as exc:
        return exc.start > len(head) - 4            # a character cut at the end of what was looked at


def _who(by: str) -> str:
    return "the user" if by == READER else "a shell, not an actor's" if by == "cli" else f"actor {by}"
