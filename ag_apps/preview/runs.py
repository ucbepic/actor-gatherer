"""The Preview app's runs (backend.py): a project's preview run in a checkout, its output kept and followed, what it
shows found and served, and SyncTeX between a PDF it shows and its source. Ported from the dashboard's own preview
(ag_dashboard/preview.py before it became this app); nothing of the dashboard is imported.

    place(path)              (key, checkout) of a file or folder: its git repository (a worktree's: its repository's,
                             which its worktrees share) and the checkout holding it; in no repository, its folder
    guess(file, checkout)    a preview to start from, by the file open (LaTeX: its document's main file, tex_main)
    expand(text, file, ..)   {file}, {stem}, {name}, {dir}: the file open, in the command and what it shows
    Run, Runs                a checkout's latest run: its process, output, state; told to `tell(run, name, value)`
    synctex(checkout, body)  a place in a PDF to its source line, or (forward) a source line to its place in the PDF

Who may run what is backend.py's: a command an actor set runs only once the user lets it."""

import codecs
import json
import mimetypes
import os
import re
import secrets
import shlex
import shutil
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request
from typing import Callable, Dict, List, Optional, Tuple

TIMEOUT = 300.0             # seconds a command that is not a server is given
READY_WAIT = 120.0          # seconds a server's URL is tried for, until it answers
STOP_WAIT = 3.0             # seconds a command is given to end once asked to (SIGTERM), before it is killed
KEEP = 256_000              # the most bytes of a run's output kept: its last
MAX_FILE = 100_000_000      # the largest file served
URL = re.compile(r"https?://", re.I)
NAMES = re.compile(r"\{(file|stem|name|dir)\}")
#: What a guess runs a file of each kind with, and the kinds shown as they are.
RUN_WITH = {".py": "python3 {file}", ".js": "node {file}", ".mjs": "node {file}", ".sh": "sh {file}",
            ".r": "Rscript {file}", ".rb": "ruby {file}", ".jl": "julia {file}"}
SHOWN_AS_IS = {".html", ".htm", ".svg", ".md", ".markdown", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"}
IMAGES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif"}
LATEX = "latexmk -pdf -synctex=1 -cd -interaction=nonstopmode "
TEX_ROOT = re.compile(r"^[ \t]*%[ \t]*![ \t]*TeX[ \t]+root[ \t]*=[ \t]*(.+?)[ \t]*$", re.I | re.M)   # % !TeX root = main.tex
TEX_CLASS = re.compile(r"^[^%\n]*\\documentclass\b", re.M)                    # not in a comment
TEX_INPUT = re.compile(r"^[^%\n]*?\\(?:input|include|subfile)[ \t]*\{[ \t]*([^}]+?)[ \t]*\}", re.M)
TEX_HEAD = 65_536           # the most bytes of a .tex file looked at
TEX_MANY = 200              # the most .tex files of a folder looked at
#: The environment a run is not given: what says the dashboard runs inside an agent's session.
NOT_PASSED = re.compile(r"^(CLAUDECODE|CLAUDE_CODE_.*|CODEX_.*|AG_ACTOR|AG_DASHBOARD)$")


class PreviewError(ValueError):
    """Why a preview cannot be set, run or shown: what the user, or the agent, is told."""


def _git(folder: str, *args: str) -> Optional[str]:
    try:
        done = subprocess.run(["git", "-C", folder, *args], capture_output=True, text=True, timeout=10,
                              stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    return done.stdout.strip() if done.returncode == 0 and done.stdout.strip() else None


def repository(folder: str) -> Optional[str]:
    """The repository a folder is in -- a worktree's, the worktree's own repository -- as a real path; None: in none."""
    common = _git(folder, "rev-parse", "--path-format=absolute", "--git-common-dir")
    if common is None:
        return None
    top = os.path.dirname(common) if os.path.basename(common) == ".git" else _git(folder, "rev-parse", "--show-toplevel")
    return os.path.realpath(top) if top else None


def place(path: str) -> Tuple[str, str]:
    """(key, checkout) of a file or folder: its git repository's real path, and the checkout holding it (git's top
    folder); in no repository, its folder both."""
    path = os.path.realpath(os.path.expanduser(path or ""))
    folder = path if os.path.isdir(path) else os.path.dirname(path)
    if not path or not os.path.isdir(folder):
        raise PreviewError(f"no folder {folder or path!r} here")
    repo = repository(folder)
    if repo is None:
        return folder, folder
    top = _git(folder, "rev-parse", "--show-toplevel")
    return repo, os.path.realpath(top) if top else repo


def expand(text: str, file: Optional[str], checkout: str, quote: bool = False) -> str:
    """`text` with {file}, {stem}, {name} and {dir} as the file is in the checkout -- `quote`: each a shell word."""
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
    """How the panel shows a file: image, svg, pdf, html, markdown or text."""
    ext = os.path.splitext(path)[1].lower()
    return ("image" if ext in IMAGES else "svg" if ext == ".svg" else "pdf" if ext == ".pdf"
            else "html" if ext in (".html", ".htm") else "markdown" if ext in (".md", ".markdown") else "text")


def guess(file: Optional[str], checkout: str, folder: Optional[str] = None) -> dict:
    """A preview to start from, for a project with none: by the file open, else by the folder and what the checkout
    has. LaTeX's builds the document's main file (`tex_main`): the same one whichever of its files is open."""
    ext = os.path.splitext(file or "")[1].lower()
    if ext == ".tex":
        return _latex(tex_main(file, checkout) or file, checkout)
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
    main = tex_main(None, checkout, folder) if not file and folder else None
    if main:
        return _latex(main, checkout)
    if any(os.path.isfile(os.path.join(checkout, m)) for m in ("Makefile", "makefile")):
        return {"command": "make", "show": ""}
    return {"command": "", "show": ""}


def _latex(main: str, checkout: str) -> dict:
    rel = os.path.relpath(main, checkout)
    return {"command": LATEX + shlex.quote(rel), "show": os.path.splitext(rel)[0] + ".pdf"}


def _tex_head(path: str) -> str:
    try:
        with open(path, "rb") as fh:
            return fh.read(TEX_HEAD).decode("utf-8", "replace")
    except OSError:
        return ""


def tex_main(file: Optional[str], checkout: str, folder: Optional[str] = None) -> Optional[str]:
    """The main file of the LaTeX document a .tex file is part of -- or, with none, of `folder`: the one a `% !TeX
    root = ...` line names; the file itself, if it is one (a \\documentclass, not in a comment); else a main file of
    its folder, or of the nearest folder above it in the checkout that has one -- the one that \\input's (\\include's,
    \\subfile's) it, else main.tex, else the first by name. None: none."""
    top = os.path.realpath(checkout)
    if file:
        file = os.path.realpath(file)
        head = _tex_head(file)
        named = TEX_ROOT.search(head[:4000])
        if named:
            p = inside(top, os.path.join(os.path.dirname(file), named.group(1)))
            if p and os.path.isfile(p):
                return p
        if TEX_CLASS.search(head):
            return file
        here = os.path.dirname(file)
    elif folder:
        here = os.path.realpath(folder)
    else:
        return None
    while True:
        try:
            names = sorted(n for n in os.listdir(here) if n.lower().endswith(".tex"))[:TEX_MANY]
        except OSError:
            names = []
        mains = []
        for n in names:
            p = os.path.join(here, n)
            if p != file and os.path.isfile(p):
                head = _tex_head(p)
                if TEX_CLASS.search(head):
                    mains.append((p, head))
        if mains:
            if file:
                stem = os.path.normpath(os.path.splitext(os.path.relpath(file, here))[0])
                for p, head in mains:
                    if any(os.path.normpath(re.sub(r"\.tex$", "", m.group(1), flags=re.I)) == stem
                           for m in TEX_INPUT.finditer(head)):
                        return p
            return next((p for p, _ in mains if os.path.basename(p).lower() == "main.tex"), mains[0][0])
        if not file or here == top or not here.startswith(top.rstrip(os.sep) + os.sep):
            return None
        here = os.path.dirname(here)


def run_env() -> Dict[str, str]:
    """The environment a run is given: the host's, less what says it runs inside an agent's session -- its variables,
    and an API pointed at a local hook server."""
    env = {k: v for k, v in os.environ.items() if not NOT_PASSED.match(k)}
    base = env.get("ANTHROPIC_BASE_URL", "")
    if base.startswith(("http://127.0.0.1", "http://localhost")):
        env.pop("ANTHROPIC_BASE_URL")
    return env


class Run:
    """One run of a project's preview in a checkout: its process, if it has a command, and its output."""

    def __init__(self, key: str, checkout: str, command: str, show: str, by: str, file: Optional[str]):
        self.id = secrets.token_hex(6)
        self.key, self.checkout, self.command, self.show, self.by, self.file = key, checkout, command, show, by, file
        self.url = show if URL.match(show) else None
        self.started, self.ended, self.code = time.time(), None, None
        self.state = "running"          # running, ready (a server whose URL answers), done, failed, stopped, timed out
        self.stopping: Optional[str] = None
        self.out, self.dropped = bytearray(), 0
        self.proc: Optional[subprocess.Popen] = None
        self.over = threading.Event()
        self.changed = threading.Condition()
        self.unwatched: Optional[float] = None

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
            return {"path": p, "rel": os.path.relpath(p, self.checkout), "kind": kind_of(p), "exists": True,
                    "mtime": st.st_mtime, "size": st.st_size}
        except OSError:
            return {"path": p, "rel": os.path.relpath(p, self.checkout), "kind": kind_of(p), "exists": False}

    def view(self) -> dict:
        return {"id": self.id, "key": self.key, "checkout": self.checkout, "command": self.command, "show": self.show,
                "by": self.by, "file": self.file, "started": self.started, "ended": self.ended, "code": self.code,
                "state": self.state, "server": bool(self.url and self.command), "shows": self.shows()}

    def text(self) -> str:
        return bytes(self.out).decode("utf-8", "replace")


class Runs:
    """Each checkout's latest run. `tell(run, name, value)` hears of each change: "run" (its view), "out" (its
    output as it comes), "ended" (its view, once over)."""

    def __init__(self, tell: Callable[[Run, str, dict], None], env: Callable[[], Dict[str, str]] = run_env):
        self.lock = threading.Lock()
        self.runs: Dict[str, Run] = {}          # checkout -> its latest run
        self.tokens: Dict[str, str] = {}        # token -> checkout: its files' paths in the panel
        self.tell, self.env = tell, env
        self.closed = threading.Event()

    def token(self, checkout: str) -> str:
        with self.lock:
            for t, c in self.tokens.items():
                if c == checkout:
                    return t
            t = secrets.token_hex(8)
            self.tokens[t] = checkout
            return t

    def latest(self, checkout: str) -> Optional[Run]:
        return self.runs.get(checkout)

    def start(self, key: str, checkout: str, command: str, show: str, file: Optional[str], by: str) -> Run:
        cmd = expand(command, file, checkout, quote=True)
        shown = expand(show, file, checkout)
        if shown and not URL.match(shown) and inside(checkout, shown) is None:
            raise PreviewError(f"what it shows, {shown}, is not in {checkout}")
        self.end(checkout, "stopped")                       # the one before: ended first (a server's port freed)
        r = Run(key, checkout, cmd, shown, by, file)
        with self.lock:
            self.runs[checkout] = r
        if not cmd:                                         # nothing to run: what it shows, shown
            r.state, r.ended = ("ready" if r.url else "done"), time.time()
            r.over.set()
            self._tell(r, "run", r.view())
            self._tell(r, "ended", r.view())
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
            self._tell(r, "ended", r.view())
            return r
        self._tell(r, "run", r.view())
        threading.Thread(target=self._read, args=(r,), name="preview-run", daemon=True).start()
        if r.url:
            threading.Thread(target=self._ready, args=(r,), name="preview-ready", daemon=True).start()
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
        with r.changed:
            r.code, r.ended = code, time.time()
            r.state = r.stopping or ("done" if code == 0 else "failed")
            self._tell(r, "run", r.view())
            r.over.set()
            r.changed.notify_all()
        self._tell(r, "ended", r.view())

    def _ready(self, r: Run) -> None:
        """A server's URL tried until it answers -- any answer, an error's too -- then the run `ready`."""
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        until = time.time() + READY_WAIT
        while time.time() < until and not r.over.is_set() and not self.closed.is_set():
            try:
                opener.open(r.url, timeout=2).close()
            except urllib.error.HTTPError:
                pass
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

    def _tell(self, r: Run, name: str, value: dict) -> None:
        if self.runs.get(r.checkout) is not r and name != "ended":   # an earlier run's, once the next has begun
            return
        try:
            self.tell(r, name, value)
        except Exception:  # noqa: BLE001 - a run goes on whether or not anyone heard
            pass

    def servers(self) -> List[Run]:
        with self.lock:
            return [r for r in self.runs.values() if r.url and r.command and not r.over.is_set()]

    def file(self, token: str, rel: str) -> Tuple[bytes, str]:
        """A file of the checkout the token names, and its type; FileNotFoundError: none such, PermissionError: not
        in it, or too large."""
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
            runs = list(self.runs.values())
        threads = [threading.Thread(target=self._kill, args=(r, "stopped"), daemon=True) for r in runs]
        for t in threads:
            t.start()
        for t in threads:
            t.join(STOP_WAIT + 2.5)


def synctex(checkout: str, body: dict) -> dict:
    """SyncTeX between a PDF of the checkout (`pdf`) and its source: `mode` forward, a line of a source (`file`,
    `line`, `column`) to its place in the PDF {page, x, y, h, v, w, height: big points from the page's top left}; else
    a place in the PDF (`page`, `x`, `y`) to its source {file (in the checkout), line}. {ok: false, reason} with no
    answer: "no-synctex" (the build wrote none: no -synctex=1), "no-tool" (no `synctex` here), "no-match"."""
    pdf = inside(checkout, str(body.get("pdf") or ""))
    if pdf is None or not os.path.isfile(pdf):
        raise PreviewError(f"no PDF {body.get('pdf')!r} in {checkout}")
    stem = os.path.splitext(pdf)[0]
    if not any(os.path.isfile(stem + ext) for ext in (".synctex.gz", ".synctex")):
        return {"ok": False, "reason": "no-synctex"}
    if shutil.which("synctex") is None:
        return {"ok": False, "reason": "no-tool"}
    try:
        if body.get("mode") == "forward":
            src = inside(checkout, str(body.get("file") or ""))
            if src is None or not os.path.isfile(src):
                raise PreviewError(f"no file {body.get('file')!r} in {checkout}")
            line, col = int(body.get("line") or 0), int(body.get("column") or 0)
            if line < 1:
                raise PreviewError("line: 1 or more")
            got: Dict[str, str] = {}
            for raw in _synctex(["view", "-i", f"{line}:{col}:{src}", "-o", pdf], checkout).splitlines():
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
    except (TypeError, ValueError):
        raise PreviewError("page, x and y: numbers") from None
    src, line = None, None
    begun = False
    for raw in _synctex(["edit", "-o", f"{round(page)}:{x}:{y}:{pdf}"], checkout).splitlines():
        begun = begun or raw.startswith("SyncTeX result begin")
        if begun and raw.startswith("Input:") and src is None:
            src = raw[len("Input:"):].strip()
        elif begun and raw.startswith("Line:") and line is None:
            line = int(raw[len("Line:"):].strip() or 0)
    if not src or not line:
        return {"ok": False, "reason": "no-match"}
    full = inside(checkout, os.path.normpath(src if os.path.isabs(src) else os.path.join(os.path.dirname(pdf), src)))
    if full is None:
        return {"ok": False, "reason": "outside-checkout"}
    return {"ok": True, "file": os.path.relpath(full, checkout), "line": line}


def _synctex(args: List[str], cwd: str) -> str:
    try:
        return subprocess.run(["synctex", *args], cwd=cwd, capture_output=True, text=True, timeout=20,
                              stdin=subprocess.DEVNULL).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def _texty(body: bytes) -> bool:
    head = body[:4096]
    if b"\0" in head:
        return False
    try:
        head.decode("utf-8")
        return True
    except UnicodeDecodeError as exc:
        return exc.start > len(head) - 4
