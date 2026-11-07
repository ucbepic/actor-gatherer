"""The dashboard's local server: the page (frontend/, built into static/) and the JSON it reads, from the
context manager's home (data.py), read-only -- a FastAPI app (app.py, its routers in api/) run by uvicorn.
`python -m ag_dashboard --routes` lists the routes, each with the first line of its handler's docstring.

The POSTs are the only writes, and only to the dashboard's own tables and records, the agents it
runs (and the shells it opens), the gatherers `ag new` makes, the builds and model calls `ag home build` and `ag home complete`
start, its own events `ag home insert` puts in (an actor's name), the harness's own store of a name
(naming.py), the files a History extract is saved as (where Claude Code reads them, once the reader has
seen them), ag's config.toml, and the files edited in the Editor panel (editor.py: under the directory the
page names), and what its apps run and keep (app_host.py: the Preview app's runs, a project's Execute button's)
-- besides the avatar the home gives an actor it has not seen before
(avatars.py), kept in the dashboard's own table:
the gatherers' databases are otherwise only read. They are taken from the dashboard's own page only
(app.py's `OwnPage`), and the server listens on localhost unless told otherwise.

`page(snapshot)` is the page itself, the libraries it renders markdown with (VENDOR: marked,
and DOMPurify to make what it makes safe) and draws terminals with (TERMINAL: xterm.js, its
fit and WebGL add-ons, and its stylesheet) inside it, never fetched; with a snapshot (data.snapshot()) it
stands alone, its data inside it (`ag dashboard --out`), and no terminal: it has none to draw. Writing one
(`page`, `built`, `asset`) needs nothing of the server's: FastAPI and uvicorn are imported once one serves."""

import asyncio
import json
import os
import re
import socket
import threading
import time
from typing import Optional

import harness_kit

from . import (actions, app_host, apps, avatars, branches, coordination, data, editor, folders, home, live, migrating,
               page_build, saved, sessions, tool_gateway)

STATIC, INDEX = page_build.STATIC, page_build.INDEX   # frontend/'s build (vite.config.ts), built by page_build.py
BUILD = page_build.COMMAND
ASSET_TYPES = {".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".map": "application/json",
               ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2"}
_VENDOR_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor")
VENDOR = [os.path.join(_VENDOR_DIR, n) for n in ("marked.min.js", "purify.min.js")]
TERMINAL = [os.path.join(_VENDOR_DIR, n) for n in ("xterm.js", "addon-fit.js", "addon-webgl.js", "xterm.css")]
EDITOR = os.path.join(_VENDOR_DIR, "editor.js")
_VENDOR_FILES = {"/vendor/" + os.path.basename(p): p for p in VENDOR + TERMINAL}
LLM_SECONDS = 10.0          # how long the Gatherer's call log is reused before it is read again
KEEPALIVE = 15.0            # the most a stream stays silent
COALESCE = 0.03             # after a wake, how long to wait for the rest of a burst (a call stores many events)
SHARED_SECONDS = 2.0        # a home read for one stream given to another woken by the same change: at most this old
MAX_BODY = 30_000_000       # the largest request body taken: a message, or an image pasted into one (an app's
                            # page's writes: its own, apps.py's `max_body`)
MAX_ALSO = 8                # the most other actors one stream follows (the page shows at most 4 panes)
THREADS = 1000              # the most requests and stream waits at once, each in a thread, as http.server's had one each
STOP_SECONDS = 2.0          # how long a stop waits for requests still being answered (its streams end at once)
IDLE_SECONDS = 120          # how long a connection is kept open with nothing asked: a terminal's keys reuse it
MAX_HEAD = 1 << 20          # the largest request line and headers taken (a long query: the monitor's actors)


def built() -> Optional[str]:
    """What is wrong with the page's build, said for a person: None, nothing (or no source here to compare it with)."""
    wrong = page_build.wrong()
    return wrong and f"{wrong}: run `{BUILD}` in the repository, then reload"


def asset(name: str) -> Optional[bytes]:
    """A file the page's build made (static/assets/<name>), or None: none such, or a name that leaves the folder."""
    if not re.fullmatch(r"[\w.-]+", name) or name.startswith("."):
        return None
    path = os.path.join(STATIC, "assets", name)
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as fh:
        return fh.read()


def _inlined(text: str) -> str:
    """The page with its build's script and styles in it, not fetched: a snapshot is one file, opened with no server."""
    def script(m):
        code = (asset(m.group(1)) or b"").decode("utf-8")
        code = re.sub(r"\n//# sourceMappingURL=\S+\s*$", "\n", code)
        return '<script type="module">' + code.replace("</script", "<\\/script") + "</script>"

    def style(m):
        return "<style>" + (asset(m.group(1)) or b"").decode("utf-8").replace("</style", "<\\/style") + "</style>"

    text = re.sub(r'<script type="module" crossorigin src="/assets/([\w.-]+)"></script>', script, text)
    text = re.sub(r'<link rel="stylesheet" crossorigin href="/assets/([\w.-]+)">', style, text)
    return re.sub(r'<link rel="modulepreload"[^>]*>', "", text)


def page(snapshot: Optional[dict] = None) -> str:
    """The page; with `snapshot`, its data inside it, and all it needs in it. Not built: a page saying how."""
    if not os.path.exists(INDEX):
        return ("<!doctype html><meta charset=utf-8><title>ag</title><p style=\"font: 14px system-ui; margin: 40px\">"
                f"The ag dashboard's page is not built here. In the repository, run <code>{BUILD}</code>, then reload. "
                "(ag from PyPI comes with it built.)</p>")
    with open(INDEX, encoding="utf-8") as fh:
        text = fh.read()
    scripts = []
    for path in VENDOR + (TERMINAL if snapshot is None else []):
        with open(path, encoding="utf-8") as fh:
            if path.endswith(".css"):
                scripts.append("<style>" + fh.read().replace("</style", "<\\/style") + "</style>")
            else:
                scripts.append("<script>" + fh.read().replace("</script", "<\\/script") + "</script>")
    text = text.replace("<!--VENDOR-->", "\n".join(scripts), 1)
    if snapshot is None:
        return text
    embedded = json.dumps(snapshot).replace("</", "<\\/")      # never closes the script it sits in
    return _inlined(text.replace("/*SNAPSHOT*/null", embedded, 1))


class _Calls:
    """The Gatherer's call log, read at most every LLM_SECONDS: polling reads it often."""

    def __init__(self):
        self.lock, self.at, self.calls = threading.Lock(), 0.0, []

    def get(self):
        with self.lock:
            if time.time() - self.at > LLM_SECONDS:
                self.calls, self.at = data.llm_calls(), time.time()
            return self.calls

    def changed(self) -> None:
        """A call was logged: read the log again next time."""
        with self.lock:
            self.at = 0.0


def _bind(address) -> socket.socket:
    """A socket listening at `address` (host, port; port 0: any free one), as http.server's bound it."""
    host, port = address
    sock = socket.socket(socket.AF_INET6 if ":" in host else socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((host, port))
        sock.listen(2048)
    except BaseException:
        sock.close()
        raise
    return sock


class Server:
    """The server: what wakes its streams (live.py), the sessions started from the page (sessions.py), whose agents
    it runs -- those of actors saved for later put away once left unused (saved.py's `Rest`) -- and the rest its
    routes share (app.py), all stopped with it. Bound at once (`server_port` known: port 0 is any free one); served by
    `serve_forever()`, until `shutdown()` from another thread or an interrupt in its own (Ctrl-C, or a signal made
    one); `server_close()` stops it all."""

    def __init__(self, address, live_updates: bool = True):
        self.calls, self.hub = _Calls(), live.Hub()
        self.hub.on_llm = self.calls.changed
        known = data.Kept(lambda g: self.hub.ring(g, what="list")) if live_updates else None   # told what changed by
        self.hub.on_change = known.changed if known else None                                  # ag's notifications
        self.known = known
        self.sessions = sessions.Sessions(on_change=self.hub.ring)     # a session's state: its gatherer's streams
        self.editors = editor.Editors()                                # the files open in the Editor panel
        self.listener = self.fallback = self.rest = self.address_file = None   # for server_close,
        self.app_host = None
        self.apps = {}                                                                          # which a failed bind calls
        self.socket = self.app = self._uvicorn = self._done = self._failed = None
        self._lock = threading.Lock()
        self._shared, self._sharing = {"version": None, "at": 0.0, "value": None}, threading.Lock()
        self.apps = {a.name: a.start(self.sessions) for a in apps.APPS}   # each app's running part, by its name
        self.branches = branches.Branches(self.editors, self.sessions, self.hub.ring)   # the actors' own branches
        self.crew = coordination.Coordination(self.sessions, self.hub.ring, watch=live_updates,   # actors' `ag actors`
                                              branched=self.branches, apps=self.apps)
        self.keeps_actions = False
        try:
            self.socket = _bind(address)
            self.server_address = self.socket.getsockname()[:2]
            self.server_port = self.server_address[1]
            self.app_host = app_host.AppHost(self.server_port)        # the apps (app_kit's): their backends, events
            self.hub.listen(self.app_host.rung)                       # and instances
            from . import app                                          # FastAPI: only once one serves
            self.app = app.create(self)
        except BaseException:
            self.server_close()
            raise
        for a in apps.APPS:                                            # where their actors reach it
            a.served_at(f"http://127.0.0.1:{self.server_port}")
        tool_gateway.HOST, tool_gateway.ORIGIN = self.app_host, f"http://127.0.0.1:{self.server_port}"   # the apps'
                                                                       # tools, for every session it starts
        self.keeps_actions = live_updates and not actions.ENABLED     # the reader's actions kept in the gatherers
        actions.ENABLED = actions.ENABLED or live_updates             # (actions.py), while it serves
        self.migrating = migrating.start(self.hub.ring) if live_updates else None   # an older gatherer's tables, once
        self.listener = live.Listener(self.hub) if live_updates else None
        self.fallback = live.Fallback(self.hub) if live_updates else None
        folders.ensure()                                              # its tables, saved.py's folders copied in once
        self.rest = saved.Rest(self.sessions, self.hub.shown)
        if live_updates:                     # where actors' `ag actors` reach it: its own, told; any other, by the file
            host = self.server_address[0]
            sessions.DASHBOARD = f"http://{'127.0.0.1' if host in ('', '0.0.0.0', '::') else host}:{self.server_port}"
            self.address_file = home.write_address(sessions.DASHBOARD, host)
        if known is not None:                                          # its agents all read once, now: a page's
            threading.Thread(target=lambda: data.home([], known), name="ag-home-first", daemon=True).start()   # first

    # -- what the routes share (api/)

    def home_view(self, woken: bool = False) -> dict:
        """The home as the page gets it (`read_home`). One read serves every stream woken by the same change
        (`woken`): read again only once another is rung (the hub's `version`), so a read begun after the ring
        that woke a stream has what it rang for -- not once for each stream open, which a change woke all of
        at once, each reading the whole home over the others'. Not one older than SHARED_SECONDS (a page
        opened long after the last change: what time changed since, the sessions' state). One at a time: a
        stream woken during a read waits for it, then has it, or reads again for a ring that came during it."""
        shared = self._shared
        with self._sharing:
            if woken and shared["value"] is not None and shared["version"] == self.hub.version \
                    and time.time() - shared["at"] < SHARED_SECONDS:
                return shared["value"]
            version, at = self.hub.version, time.time()
            shared.update(version=version, at=at, value=self.read_home())
            return shared["value"]

    def read_home(self) -> dict:
        """The home as the page gets it: with the sessions' state, and what a new session starts from -- the
        harnesses it can run on here (sessions.py's `available`); the shells open, and the user's home directory,
        which the page shows their directories under as ~; what each app says of itself (apps.py's `home`: whether
        one can be made here). A name held for a session's terminal is typed there once its turn is over
        (`rename_due`). Its agents as read before (data.py's `Kept`), where kept."""
        started = self.sessions
        got = data.home(started.list(), self.known)
        if started.renames:
            started.rename_due(a["channel"] for g in got["gatherers"] for a in g["agents"]
                               if a.get("turn_over") and a.get("status") not in (data.ASKING, data.RUNNING))
        return {**avatars.assign(got), "cwd": os.getcwd(), "permission_modes": list(sessions.PERMISSION_MODES),
                "terminals": sessions.TERMINALS, "harnesses": sessions.available(), "shells": started.shells(),
                "home_dir": os.path.expanduser("~"), "editor": editor.AVAILABLE,
                "branches": self.branches.listed() if self.branches is not None else [],
                **{k: v for a in apps.APPS for k, v in a.home(self.apps.get(a.name)).items()}}

    def dialog(self, sid: str) -> Optional[dict]:
        """What a session's terminal -- the dashboard's -- shows asking the user now, where a message typed into it
        would answer the dialog (its harness's `messages_answer_asks`: codex's): a question its turn waits on (a
        message's keys would pick its options), or the plan it asks whether to take (Enter would take it). None:
        nothing, or a harness whose dialogs a message waits for."""
        row = next((x for x in self.sessions.list() if x["session_id"] == sid), None)
        rules = harness_kit.get(row.get("harness")) if row is not None else None
        if row is None or rules is None or not rules.messages_answer_asks or not row.get("terminal"):
            return None
        ask = data.asking_of(row["gatherer"], sid, row.get("cwd"))
        if ask is None or ask.get("async") or (row.get("since") or 0) > (ask.get("at") or 0) \
                or (row.get("typed") and row["typed"] >= (ask.get("at") or 0)):
            return None                              # answered as it works; or not shown there, or touched since
        return ask

    # -- serving: uvicorn, in a thread of its own

    def serve_forever(self, poll_interval: float = 0.5) -> None:
        """Serves until `shutdown()` or an interrupt in this thread (KeyboardInterrupt: Ctrl-C, or what a signal
        handler raises), as http.server's did: uvicorn runs in a thread of its own, so the signals still reach this
        one -- where the main thread runs it, the caller's handlers (__main__.py's) -- and none of uvicorn's are set."""
        from . import app
        with self._lock:
            if self._uvicorn is not None or self.socket is None:
                raise RuntimeError("the dashboard's server serves already, or is closed")
            self._uvicorn, self._done = app.uvicorn_server(self.app), threading.Event()
            done = self._done
            threading.Thread(target=self._run, args=(self._uvicorn, done), name="ag-dashboard-server",
                             daemon=True).start()
        try:
            while not done.wait(poll_interval):
                pass
        finally:
            self._stop()
        if self._failed is not None:                                   # uvicorn's own failure: the caller's
            raise self._failed

    def _run(self, server, done: threading.Event) -> None:
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(self._serve(server))
        except BaseException as exc:  # noqa: BLE001 - raised again in serve_forever's thread
            self._failed = exc
        finally:
            try:
                _finish(loop)
            finally:
                done.set()

    async def _serve(self, server) -> None:
        import anyio.to_thread
        anyio.to_thread.current_default_thread_limiter().total_tokens = THREADS
        await server.serve(sockets=[self.socket])

    def _stop(self) -> None:
        """uvicorn told to stop, and waited for: its streams ended, what is being answered given STOP_SECONDS."""
        server, done = self._uvicorn, self._done
        if server is None or done is None:
            return
        server.should_exit = True
        done.wait(STOP_SECONDS + 5)

    def shutdown(self) -> None:
        """`serve_forever()` stopped, from another thread: once it has, it returns."""
        self._stop()

    def server_close(self) -> None:
        """Everything stopped: uvicorn (if it still serves), the parts, the socket, the sessions' agents and shells."""
        self._stop()
        for part in (self.listener, self.fallback, self.rest, self.editors, self.crew, self.branches,
                     *self.apps.values(), self.app_host):
            if part is not None:
                part.close()
        if self.keeps_actions:
            actions.ENABLED = False
        if tool_gateway.HOST is self.app_host:          # the gateway's no longer: no session is given a closed host's
            tool_gateway.HOST, tool_gateway.ORIGIN = None, ""
        if self.address_file:
            home.forget_address(self.address_file, sessions.DASHBOARD)
        if self.socket is not None:
            self.socket.close()
            self.socket = None
        self.sessions.close()


def _finish(loop: asyncio.AbstractEventLoop) -> None:
    """The server's event loop closed once uvicorn has stopped: what it still runs (a request answered in a thread
    that takes long) cancelled, and given a second; a thread still at work is left to end on its own."""
    rest = [t for t in asyncio.all_tasks(loop) if not t.done()]
    for t in rest:
        t.cancel()
    if rest:
        loop.run_until_complete(asyncio.wait(rest, timeout=1.0))
    if all(t.done() for t in rest):
        loop.run_until_complete(loop.shutdown_asyncgens())
        loop.close()


def serve(host: str = "127.0.0.1", port: int = 4200, live_updates: bool = True) -> Server:
    """The server, bound and ready (`serve_forever()` runs it); `server_close()` stops it, its
    listener and its sessions' agents. Without `live_updates`, streams are woken by nothing but
    their keep-alive (and the sessions' own changes)."""
    return Server((host, port), live_updates)
