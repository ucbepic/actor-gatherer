"""A Browser in the dashboard: a Chrome tab the user and an agent use together. The user sees the tab live in the
actor's pane and clicks, types and navigates in it; the agent -- an ACTOR of the gatherer, an ordinary session started
from the dashboard (sessions.py), its `role` {"browser": key} -- uses it through tools the dashboard serves. What each
piece is:

    the Chrome            `Chrome`: ONE Chrome for every Browser the dashboard serves, as the home's config.toml's
                          `[dashboard] browser_profile` says (`mode`) --
                          - "own" (the default): the dashboard's own, headless, started on first use and stopped once
                            none was used for IDLE_STOP; spoken to over a pipe (--remote-debugging-pipe, the Chrome
                            DevTools Protocol), so it opens no port: nothing else on the machine can drive it. Its profile
                            is the home's (<home>/dashboard/browser): logins made in it last, apart from the user's own
                            Chrome. Which Chrome: `[dashboard] browser`, else one installed (`executable`); none: no
                            Browser is offered (`available`)
                          - "mine": the user's own Chrome, running, its logins and history -- its remote debugging turned
                            on by them (chrome://inspect/#remote-debugging, Chrome 144+), reached by a WebSocket to the
                            port its DevToolsActivePort names (`devtools_port`), once they click Allow in it; one
                            connection kept (each new one asks again). Each tab is hidden from their tab strip (else in a
                            minimized window of its own), closed when the dashboard stops; their downloads and windows
                            are left as they are
    each Browser          `Browsers.create`: its KEY, its actor a new session of the harness chosen (its folder the
                          session's), started with the tools and instructions (`launch_args`); its own tabs, opened in the
                          Chrome when it is used and again after the Chrome stopped (their pages kept in dashboard.db,
                          `browser`)
    what the user sees    `Browser.join`: while a page shows the Browser's view, the tab's screen, as it changes, to the
                          page's stream (server.py's `browser_stream`) -- in the dashboard's own Chrome as video (H.264,
                          `Capture`: browser_video.py) to a page that can decode it, else as the JPEG frames of Chrome's
                          screencast (also until the video comes, and if it fails: `_recast`) -- and its state -- tabs,
                          what the user picked, what the agent does now, a dialog open; at the view's size (`resize`),
                          which the agent's screenshots then have too
    what the user does    `input`: the page's mouse, wheel and keys, given to the tab as Chrome's own input; `navigate`;
                          noted (`log`) as the agent is to hear it: "clicked button "Pay"", "typed into textbox "Email""
                          -- never what was typed
    what the user points  `pick`: an element (the one under a click, its tag, text, CSS path, HTML, styles, role and name,
    at                    and a picture of it) or an area (a picture of it, its text): p1, p2, ... a ref the tools take
    the agent's tools     `TOOLS` + mcp.py: snapshot, click, type, press, select, hover, scroll, navigate, back, forward,
                          reload, tabs, screenshot, console, evaluate, wait, dialog, upload: an MCP server the actor
                          reaches at /browser/w/<key>/mcp, each call run here, on the tab -- with or without a page open
    the user's message    `compose`: what the user sends the actor (server.py's /api/send) ends with <browser_state>: the
                          page they are on, what they did since their last message, what they picked; then forgotten
                          (`sent`) but for the picks' refs, which keep working

Standard library only."""
import base64
import collections
import contextlib
import json
import os
import queue
import re
import secrets
import shlex
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time
from typing import Callable, Dict, List, Optional, Tuple

from . import browser_video, home, mcp, naming, sessions

NAME = "ag-browser"         # the MCP server's name: the tools' names, as the harness shows them, carry it
ORIGIN = "http://127.0.0.1:4200"   # where the actors reach the dashboard (its MCP server): set by server.py's `serve`
KEY = re.compile(r"[0-9a-f]{16}")
IDLE_STOP = 600.0           # seconds the Chrome runs on with no Browser used
CALL_WAIT = 20.0            # the most a call to Chrome is waited for
LOAD_WAIT = 15.0            # the most an action waits for the page it started loading
SETTLE = 0.25               # seconds after an action before what it did is looked at
ACTING_KEEP = 1.2           # seconds what the agent did stays marked on the screen after
OPENED_BY_CLICK = 3.0       # seconds after a click in a Browser a tab that names no opener is taken as one it opened
OPENED_WAIT = 0.6           # seconds a tab a page opens is waited for, before the dashboard opens it itself: a tab
                            # hidden from the user's tab strip opens none (Chrome says it would, then doesn't)
VIEWPORT = (1280, 800, 1.0)  # the tab's size when no page has said its view's: (width, height, device pixel ratio)
QUALITY = 50                # the screencast's JPEG quality: at 2x, 70 costs Chrome ~20% more per frame, unseen
QUICK_SCALE = 1.5           # the density the screen is sent at while the user scrolls or drags (a 2x frame takes
                            # Chrome ~3x as long to make as a 1x one), full again QUICK_FOR seconds after the last
QUICK_FOR = 0.2             # (wheel notches come ~0.1-0.15 s apart while scrolling: no flicker to sharp between)
DRAG_PX = 4                 # how far a held button moves before it is a drag, not a shaky click
MAX_SNAPSHOT = 40_000       # the most characters of a snapshot
MAX_EVAL = 20_000           # the most characters of an evaluation's result
MAX_HTML = 1_500            # the most characters of a pick's HTML
CONSOLE_KEEP = 200          # the console messages kept per tab
NAME_WAIT = 600.0           # how long a new actor's first call is waited for, to name it (its gatherer has it then)
ARGS = ["--headless=new", "--remote-debugging-pipe", "--no-first-run", "--no-default-browser-check",
        "--use-mock-keychain", "--password-store=basic", "--mute-audio", "--hide-crash-restore-bubble",
        "--disable-features=Translate,OptimizationHints,MediaRouter", "--disable-search-engine-choice-screen"]
APPS = ["Google Chrome.app/Contents/MacOS/Google Chrome", "Chromium.app/Contents/MacOS/Chromium",
        "Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "Brave Browser.app/Contents/MacOS/Brave Browser"]
COMMANDS = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"]
ALLOW_WAIT = 120.0          # the most the user's Chrome is waited on to be allowed (its "Allow remote debugging?")
USER_DIRS = {               # where the user's Chrome keeps its profiles (and DevToolsActivePort, its debugging on)
    "darwin": ["~/Library/Application Support/Google/Chrome", "~/Library/Application Support/Google/Chrome Beta",
               "~/Library/Application Support/Chromium", "~/Library/Application Support/Microsoft Edge",
               "~/Library/Application Support/BraveSoftware/Brave-Browser"],
    "linux": ["~/.config/google-chrome", "~/.config/google-chrome-beta", "~/.config/chromium",
              "~/.config/microsoft-edge", "~/.config/BraveSoftware/Brave-Browser"],
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS browser (
    key         TEXT PRIMARY KEY,
    gatherer    TEXT NOT NULL,
    root        TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    created_at  REAL NOT NULL,
    tabs        TEXT NOT NULL DEFAULT '[]',
    active      INTEGER NOT NULL DEFAULT 0,
    named       INTEGER NOT NULL DEFAULT 0
)"""


class BrowserError(ValueError):
    """What the page, or the agent, is told: why it cannot be done. `status`: the HTTP status it is answered with."""

    def __init__(self, text: str, status: int = 400):
        super().__init__(text)
        self.status = status


def _db() -> sqlite3.Connection:
    os.makedirs(home.HOME, exist_ok=True)
    conn = sqlite3.connect(sessions.db_path(), timeout=8, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def _config() -> dict:
    try:
        import tomllib
        with open(os.path.join(home.HOME, "config.toml"), "rb") as fh:
            got = tomllib.load(fh).get("dashboard")
    except (OSError, ValueError):
        return {}
    return got if isinstance(got, dict) else {}


def executable() -> Optional[str]:
    """The Chrome the Browsers run: the home's config.toml's `[dashboard] browser`, else Chrome, Chromium, Edge or Brave
    where macOS installs them, else on the PATH. None: none here."""
    named = _config().get("browser")
    if isinstance(named, str) and named.strip():
        path = os.path.expanduser(named.strip())
        found = path if os.path.isfile(path) else shutil.which(path)
        return found if found and os.access(found, os.X_OK) else None
    for top in ("/Applications", os.path.expanduser("~/Applications")):
        for app in APPS:
            path = os.path.join(top, app)
            if os.access(path, os.X_OK):
                return path
    for name in COMMANDS:
        found = shutil.which(name)
        if found:
            return found
    return None


def available() -> bool:
    """Whether a Browser can be started here: a Chrome -- the dashboard's own, or the user's (`mode`) -- on Unix (its
    own is handed its pipe by a shell)."""
    return os.name == "posix" and (mode() == "mine" or executable() is not None)


def profile_dir() -> str:
    return os.path.join(home.HOME, "dashboard", "browser")


def downloads_dir() -> str:
    return os.path.join(home.HOME, "dashboard", "downloads")


# ---- the Chrome: its own, over a pipe; or the user's, over a WebSocket ------------------------------------------

class Cdp:
    """A connection to a Chrome, the DevTools protocol over it: messages are JSON. `call` waits for the answer; `post`
    does not (for what an event handler sends: it runs on the reader's thread, which a wait there would block). Events
    go to `on_event(method, params, session)`; `on_exit(self)` once the connection is gone. What carries the messages
    is the subclass's: `_send` one, `_read` them all (each to `_got`), `_closed` once done."""

    mode = ""

    def __init__(self, on_event: Callable, on_exit: Callable):
        self.on_event, self.on_exit = on_event, on_exit
        self.lock = threading.Lock()
        self.n = 0
        self.waiting: Dict[int, "queue.Queue"] = {}
        self.alive = True

    def _start(self) -> None:
        threading.Thread(target=self._run, name="ag-browser-cdp", daemon=True).start()

    def _write(self, message: dict) -> None:
        data = json.dumps(message).encode("utf-8")
        with self.lock:
            if not self.alive:
                raise BrowserError("the browser stopped: try again")
            try:
                self._send(data)
            except OSError:
                raise BrowserError("the browser stopped: try again") from None

    def _id(self) -> int:
        with self.lock:
            self.n += 1
            return self.n

    def call(self, method: str, params: Optional[dict] = None, session: Optional[str] = None,
             timeout: float = CALL_WAIT, until: Optional[Callable[[], bool]] = None) -> dict:
        """Chrome's answer. `until`: what, once true, makes the answer not waited for ({} then) -- a click whose page
        opened an alert is answered only once the alert is."""
        mid = self._id()
        box: "queue.Queue" = queue.Queue(1)
        self.waiting[mid] = box
        try:
            self._write({"id": mid, "method": method, "params": params or {}, **({"sessionId": session} if session else {})})
            end = time.time() + timeout
            while True:
                try:
                    got = box.get(timeout=min(0.1, max(0.0, end - time.time())) if until else timeout)
                    break
                except queue.Empty:
                    if until is not None and until():
                        return {}
                    if time.time() >= end:
                        raise BrowserError(f"the browser did not answer ({method}) in {timeout:.0f} s") from None
        finally:
            self.waiting.pop(mid, None)
        if got is None:
            raise BrowserError("the browser stopped: try again")
        if "error" in got:
            raise CdpError(method, got["error"].get("message") or str(got["error"]))
        return got.get("result") or {}

    def post(self, method: str, params: Optional[dict] = None, session: Optional[str] = None) -> None:
        try:
            self._write({"id": self._id(), "method": method, "params": params or {},
                         **({"sessionId": session} if session else {})})
        except BrowserError:
            pass

    def _got(self, raw: bytes) -> None:
        try:
            message = json.loads(raw)
        except ValueError:
            return
        if "id" in message:
            box = self.waiting.get(message["id"])
            if box is not None:
                box.put(message)
        elif "method" in message:
            try:
                self.on_event(message["method"], message.get("params") or {}, message.get("sessionId"))
            except Exception:  # noqa: BLE001 - one event's trouble stops no other
                pass

    def _run(self) -> None:
        try:
            self._read()
        except (OSError, EOFError, ValueError):
            pass
        finally:
            with self.lock:
                self.alive = False
            for box in list(self.waiting.values()):
                box.put(None)
            self._closed()
            self.on_exit(self)

    def _send(self, data: bytes) -> None:
        raise NotImplementedError

    def _read(self) -> None:
        raise NotImplementedError

    def _closed(self) -> None:
        pass

    def stop(self) -> None:
        raise NotImplementedError


class PipeCdp(Cdp):
    """The dashboard's own Chrome, started headless with its DevTools pipe on fds 3 (it reads) and 4 (it writes), each
    message ended by a NUL; stopping it ends the Chrome."""

    mode = "own"

    def __init__(self, exe: str, profile: str, on_event: Callable, on_exit: Callable):
        super().__init__(on_event, on_exit)
        os.makedirs(profile, exist_ok=True)
        log_dir = os.path.join(home.HOME, "logs", "dashboard")
        os.makedirs(log_dir, exist_ok=True)
        r3, w3 = os.pipe()
        r4, w4 = os.pipe()
        log = open(os.path.join(log_dir, "browser.log"), "ab")
        try:   # sh hands Chrome the pipes as 3 and 4: they keep the numbers they have here otherwise
            self.proc = subprocess.Popen(["/bin/sh", "-c", f'exec "$0" "$@" 3<&{r3} 4>&{w4}', exe, *ARGS,
                                          browser_video.FLAG, f"--user-data-dir={profile}", "about:blank"],
                                         pass_fds=(r3, w4), stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                         start_new_session=True, env=_chrome_env())
        finally:
            os.close(r3)
            os.close(w4)
            log.close()
        self.out, self.inp = w3, r4
        self._start()

    def _send(self, data: bytes) -> None:
        data += b"\0"
        while data:
            data = data[os.write(self.out, data):]

    def _read(self) -> None:
        buf = b""
        while True:
            chunk = os.read(self.inp, 1 << 16)
            if not chunk:
                return
            buf += chunk
            while b"\0" in buf:
                raw, buf = buf.split(b"\0", 1)
                self._got(raw)

    def _closed(self) -> None:
        for fd in (self.inp, self.out):
            try:
                os.close(fd)
            except OSError:
                pass

    def stop(self) -> None:
        try:
            self.proc.terminate()
            self.proc.wait(5)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        except OSError:
            pass


class WsCdp(Cdp):
    """The user's own Chrome, its remote debugging turned on (chrome://inspect/#remote-debugging): a WebSocket to the
    port its DevToolsActivePort names, opened once the user has allowed it in Chrome (which asks at each new
    connection: one is kept). Stopping it closes the connection; the Chrome runs on."""

    mode = "mine"

    def __init__(self, port: int, path: str, on_event: Callable, on_exit: Callable, wait: float = 0):
        super().__init__(on_event, on_exit)
        try:
            self.sock = socket.create_connection(("127.0.0.1", port), timeout=5)
        except OSError:
            raise BrowserError(MINE_OFF, 409) from None
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        self.sock.sendall((f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\n"
                           f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
                          .encode("ascii"))
        self.sock.settimeout(wait or ALLOW_WAIT)         # Chrome answers once the user has said Allow
        head = b""
        try:
            while b"\r\n\r\n" not in head:
                chunk = self.sock.recv(4096)
                if not chunk:
                    raise BrowserError("Chrome closed the connection: was it not allowed?", 409)
                head += chunk
        except socket.timeout:
            self.sock.close()
            raise BrowserError("Chrome did not let the dashboard in: click Allow in its \"Allow remote debugging?\" "
                               "dialog, then try again", 409) from None
        head, rest = head.split(b"\r\n\r\n", 1)
        status = head.split(b"\r\n", 1)[0].decode("latin-1")
        if " 101" not in status:
            self.sock.close()
            raise BrowserError(f"Chrome refused the connection ({status})", 409)
        self.sock.settimeout(None)
        self.buf = bytearray(rest)
        self._start()

    def _send(self, data: bytes, op: int = 1) -> None:
        n, mask = len(data), os.urandom(4)
        head = bytes([0x80 | op]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + n.to_bytes(2, "big")
                                     if n < 1 << 16 else bytes([0x80 | 127]) + n.to_bytes(8, "big"))
        masked = (int.from_bytes(data, "big") ^ int.from_bytes((mask * (n // 4 + 1))[:n], "big")).to_bytes(n, "big") if n else b""
        self.sock.sendall(head + mask + masked)

    def _take(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(1 << 20)
            if not chunk:
                raise EOFError
            self.buf += chunk
        out = bytes(self.buf[:n])
        del self.buf[:n]
        return out

    def _read(self) -> None:
        message = bytearray()
        while True:
            b0, b1 = self._take(2)
            op, n = b0 & 0x0F, b1 & 0x7F
            if n == 126:
                n = int.from_bytes(self._take(2), "big")
            elif n == 127:
                n = int.from_bytes(self._take(8), "big")
            mask = self._take(4) if b1 & 0x80 else None
            data = self._take(n)
            if mask:
                data = (int.from_bytes(data, "big") ^ int.from_bytes((mask * (n // 4 + 1))[:n], "big")).to_bytes(n, "big")
            if op == 8:                                  # Chrome closed it
                return
            if op == 9:                                  # ping: pong
                with self.lock:
                    self._send(data, 10)
                continue
            if op in (0, 1, 2):
                message += data
                if b0 & 0x80:
                    self._got(bytes(message))
                    message = bytearray()

    def _closed(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass

    def stop(self) -> None:
        try:
            with self.lock:
                self._send(b"", 8)
        except OSError:
            pass
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass


class CdpError(BrowserError):
    def __init__(self, method: str, text: str):
        super().__init__(f"{method}: {text}")
        self.method, self.text = method, text


MINE_OFF = ("Your Chrome is not open to the dashboard: open chrome://inspect/#remote-debugging in it and turn remote "
            "debugging on (Chrome 144 or later), then try again")


def _chrome_env() -> Dict[str, str]:
    """The dashboard's environment, less what ties it to a session it runs in (its harness's, ag's)."""
    env = dict(os.environ)
    for k in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "ANTHROPIC_BASE_URL", "AG_ACTOR", "AG_DASHBOARD"):
        env.pop(k, None)
    return env


_mode_seen: Dict[str, object] = {"at": None, "mode": "own"}


_NO_LOCK = contextlib.nullcontext()


def video_on() -> bool:
    """Whether a Browser in the dashboard's own Chrome is shown as video (browser_video.py): the home's config.toml's
    `[dashboard] browser_video`, true unless it says false."""
    return _config().get("browser_video", True) is not False


def mode() -> str:
    """Which Chrome the Browsers run in: "mine", the user's own (the home's config.toml's `[dashboard] browser_profile
    = "mine"`: their logins and history), else "own", the dashboard's, its profile the home's. The file read again only
    once it changed."""
    path = os.path.join(home.HOME, "config.toml")
    try:
        at = (path, os.stat(path).st_mtime_ns)
    except OSError:
        at = (path, None)
    if _mode_seen["at"] != at:
        _mode_seen.update(at=at, mode="mine" if _config().get("browser_profile") == "mine" else "own")
    return str(_mode_seen["mode"])


def devtools_port() -> Optional[Tuple[int, str]]:
    """Where the user's Chrome takes a connection, its remote debugging on: the port and path its DevToolsActivePort
    (in its user data folder) names -- Chrome's, else Chromium's, Edge's or Brave's. None: none says one."""
    for d in USER_DIRS.get(sys.platform, USER_DIRS["linux"]):
        try:
            with open(os.path.join(os.path.expanduser(d), "DevToolsActivePort")) as fh:
                lines = fh.read().split()
        except OSError:
            continue
        if len(lines) >= 2 and lines[0].isdigit() and lines[1].startswith("/devtools/browser/"):
            return int(lines[0]), lines[1]
    return None


class Chrome:
    """The Chrome every Browser uses (module doc): connected by `cdp()` -- the dashboard's own, started headless, or
    the user's, as `mode` says, a change of it taken at the next use -- its events handed to the Browser whose tab
    they are of. Its own is stopped by `idle` once no Browser was used for IDLE_STOP; the user's stays connected (a
    new connection is one more "Allow" for the user to click)."""

    def __init__(self, browsers: "Browsers"):
        self.browsers = browsers
        self.lock = threading.Lock()
        self.conn: Optional[Cdp] = None
        self.used = time.time()
        self.closed = False
        self.status = ""                                 # "allow": waiting on the user to allow the dashboard in Chrome
        self.chores: "queue.Queue" = queue.Queue()       # what an event asks done that must wait on Chrome: not on its reader
        threading.Thread(target=self._chores, name="ag-browser-chores", daemon=True).start()
        threading.Thread(target=self._idle, name="ag-browser-idle", daemon=True).start()

    def cdp(self) -> Cdp:
        with self.lock:
            self.used = time.time()
            want = mode()
            if self.conn is not None and self.conn.alive and self.conn.mode == want:
                return self.conn
            if self.closed:
                raise BrowserError("the dashboard is stopping")
            if self.conn is not None:                    # the other Chrome, or one gone: its tabs to open again here
                old, self.conn = self.conn, None
                old.stop()
                self.browsers.chrome_gone()
            self.conn = self._mine() if want == "mine" else self._own()
            return self.conn

    def _own(self) -> Cdp:
        exe = executable()
        if exe is None:
            raise BrowserError("no Chrome here: install Google Chrome (or Chromium), or name one in config.toml's "
                               "[dashboard] browser", 409)
        conn = PipeCdp(exe, profile_dir(), self._event, self._exited)
        try:
            conn.call("Target.setDiscoverTargets", {"discover": True}, timeout=30)
            os.makedirs(downloads_dir(), exist_ok=True)
            conn.call("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": downloads_dir(),
                                                      "eventsEnabled": True})
        except BrowserError as exc:
            conn.stop()
            raise BrowserError(f"Chrome did not start ({exc}): see {os.path.join(home.HOME, 'logs', 'dashboard', 'browser.log')}",
                               409) from None
        return conn

    def _mine(self) -> Cdp:
        found = devtools_port()
        if found is None:
            raise BrowserError(MINE_OFF, 409)
        self.status = "allow"                            # the user's Chrome asks them first: the pages say so
        self.browsers.publish()
        try:
            conn = WsCdp(found[0], found[1], self._event, self._exited)
            try:
                conn.call("Target.setDiscoverTargets", {"discover": True}, timeout=30)
            except BrowserError:
                conn.stop()
                raise
            return conn
        finally:
            self.status = ""
            self.browsers.publish()

    def new_target(self, cdp: Cdp) -> str:
        """A new tab for a Browser: in its own Chrome, a page; in the user's, one hidden from their tab strip (Chrome
        renders it all the same), else in a window of its own, minimized, out of their way."""
        if cdp.mode != "mine":                           # a window of its own: sized to its view, for its video
            return cdp.call("Target.createTarget", {"url": "about:blank", "newWindow": True})["targetId"]
        try:
            return cdp.call("Target.createTarget", {"url": "about:blank", "hidden": True})["targetId"]
        except CdpError:
            target = cdp.call("Target.createTarget", {"url": "about:blank", "newWindow": True, "background": True})["targetId"]
            try:
                window = cdp.call("Browser.getWindowForTarget", {"targetId": target})["windowId"]
                cdp.call("Browser.setWindowBounds", {"windowId": window, "bounds": {"windowState": "minimized"}})
            except (CdpError, KeyError):
                pass
            return target

    def running(self) -> bool:
        return self.conn is not None and self.conn.alive

    def which(self) -> str:
        """The Chrome in use now, or to be used next: "own" or "mine"."""
        conn = self.conn
        return conn.mode if conn is not None and conn.alive else mode()

    def touch(self) -> None:
        self.used = time.time()

    def later(self, job: Callable) -> None:
        self.chores.put(job)

    def _chores(self) -> None:
        while True:
            job = self.chores.get()
            if job is None:
                return
            try:
                job()
            except Exception:  # noqa: BLE001 - one chore's trouble stops no other
                pass

    def _event(self, method: str, params: dict, session: Optional[str]) -> None:
        self.browsers.event(method, params, session)

    def _exited(self, conn: Cdp) -> None:
        """A connection gone: if it is the one in use (its Chrome quit, or closed it), its tabs are gone too."""
        with self.lock:
            current = self.conn is conn
            if current:
                self.conn = None
        if current:
            self.browsers.chrome_gone()

    def _idle(self) -> None:
        while not self.closed:
            time.sleep(10)
            with self.lock:
                conn = self.conn
                quiet = conn is not None and conn.mode == "own" and time.time() - self.used > IDLE_STOP \
                    and not self.browsers.watched()
                if quiet:
                    self.conn = None
            if quiet:
                conn.stop()
                self.browsers.chrome_gone()

    def close(self) -> None:
        with self.lock:
            self.closed = True
            conn, self.conn = self.conn, None
        self.chores.put(None)
        if conn is not None:
            if conn.mode == "mine":                      # the user's Chrome runs on: the dashboard's tabs closed in it
                for b in list(self.browsers.open.values()):
                    for t in list(b.tabs):
                        conn.post("Target.closeTarget", {"targetId": t.target})
            conn.stop()


# ---- a Browser's tabs, its viewers, its picks ------------------------------------------------------------------

class Tab:
    def __init__(self, target: str, session: str, url: str = "", title: str = ""):
        self.target, self.session = target, session
        self.url, self.title = url, title
        self.loading = False
        self.starts = 0             # main-frame loads started, ever: an action looks whether one started after it
        self.loads = 0              # main-frame loads finished
        self.console: "collections.deque" = collections.deque(maxlen=CONSOLE_KEEP)
        self.dialog: Optional[dict] = None
        self.cast: Optional[Tuple[int, int]] = None   # the screencast's size, while it runs


class Viewer:
    """A page showing a Browser: what its stream sends next -- the state if it changed, the latest frame if newer than
    the one it sent last (frames between are dropped: a slow page gets the screen as it is, not a backlog); and, if
    the page can decode video (`video`), every video chunk since the last key frame, in order (a chunk can't be
    dropped: the next is drawn on it; a page too far behind, KEEP_CHUNKS, waits for a new key frame)."""

    def __init__(self, video: bool = False):
        self.cond = threading.Condition()
        self.state: Optional[dict] = None
        self.frame: Optional[dict] = None
        self.video = video
        self.chunks: List[dict] = []
        self.need_key = True
        self.closed = False

    def give(self, state: Optional[dict] = None, frame: Optional[dict] = None, chunk: Optional[dict] = None) -> bool:
        """False: a chunk dropped the page's backlog -- a key frame is wanted."""
        with self.cond:
            if state is not None:
                self.state = state
            if frame is not None:
                self.frame = frame
            wanted = True
            if chunk is not None:
                if chunk["t"] == "key":
                    self.chunks, self.need_key = [chunk], False
                elif not self.need_key:
                    self.chunks.append(chunk)
                    if len(self.chunks) > browser_video.KEEP_CHUNKS:
                        self.chunks, self.need_key, wanted = [], True, False
            self.cond.notify_all()
            return wanted

    def take(self, timeout: float) -> Optional[List[Tuple[str, dict]]]:
        """What to send now ([] after `timeout` with nothing), or None: closed."""
        with self.cond:
            if self.state is None and self.frame is None and not self.chunks and not self.closed:
                self.cond.wait(timeout)
            if self.closed:
                return None
            out = []
            if self.state is not None:
                out.append(("state", self.state))
            if self.frame is not None:
                out.append(("frame", self.frame))
            out += [("video", c) for c in self.chunks]
            self.state = self.frame = None
            self.chunks = []
            return out

    def close(self) -> None:
        with self.cond:
            self.closed = True
            self.cond.notify_all()


class Browser:
    """One Browser's tabs and what happens in them (module doc). Its lock guards its fields; calls to Chrome are made
    outside it."""

    def __init__(self, browsers: "Browsers", key: str, row: dict):
        self.browsers, self.chrome, self.key = browsers, browsers.chrome, key
        self.gatherer, self.root, self.session_id = row["gatherer"], row["root"], row["session_id"]
        try:
            saved = json.loads(row.get("tabs") or "[]")
        except ValueError:
            saved = []
        self.saved = [t for t in saved if isinstance(t, dict) and isinstance(t.get("url"), str)]
        self.saved_active = int(row.get("active") or 0)
        self.lock = threading.RLock()
        self.opening = threading.Lock()                  # one opening of its tabs at a time
        self.tabs: List[Tab] = []
        self.active = 0
        self.viewport = VIEWPORT
        self.viewers: List[Viewer] = []
        self.frame: Optional[dict] = None                # the last frame, for a viewer joining
        self.seq = 0
        self.casting: Optional[str] = None               # the session whose screen is cast now
        self.picks: List[dict] = []                      # picked, not yet sent
        self.kept_picks: Dict[str, dict] = {}            # every pick, sent or not: its ref keeps working
        self.pick_n = 0
        self.log: List[str] = []                         # what the user did since their last message
        self.refs: Dict[str, Tuple[str, int]] = {}       # "e12" -> (target, backend node id)
        self.ref_of: Dict[Tuple[str, int], str] = {}
        self.ref_n = 0
        self.acting: Optional[dict] = None               # what the agent does now: {label, box}
        self.clicked = 0.0                               # when the user or the agent last clicked in it
        self.behind = False                              # whether that click opens a link behind: Cmd/Ctrl, middle
        self.pending: List[dict] = []                    # tabs its pages asked for, Chrome not yet seen to open
        self.asked = 0                                   # of those, not yet opened (by Chrome or the dashboard)
        self.quick_until = 0.0                           # the screen sent at QUICK_SCALE until then
        self.pressed_at: Optional[Tuple[float, float]] = None   # where the button went down, for a drag
        self.sharpen: Optional[threading.Timer] = None   # what sends it at full density again after
        self.video = browser_video.Capture(lambda i: self.browsers.owner.__setitem__(i, self.key), home.HOME,
                                           self.chrome.later, lambda: self.chrome.later(self._video_changed))
        self.vseq = 0
        self.acting_until = 0.0
        self.error = ""
        self.saving = False
        self.downloads: List[str] = []

    # -- its tabs, opened in the Chrome

    def live(self) -> Cdp:
        """The Chrome, with this Browser's tabs open in it: those it had (the pages kept), else one, blank."""
        try:
            cdp = self.chrome.cdp()
        except BrowserError as exc:
            with self.lock:
                self.error = str(exc)
            self._publish()
            raise
        with self.opening:
            with self.lock:
                if self.tabs:
                    return cdp
                saved, active = self.saved or [{"url": "about:blank"}], self.saved_active
            for t in saved:
                try:
                    self._open(cdp, t["url"] if _openable(t["url"]) else "about:blank", select=False)
                except BrowserError:
                    pass
            with self.lock:
                if not self.tabs:
                    raise BrowserError("the browser opened no tab: try again")
                self.active = min(max(active, 0), len(self.tabs) - 1)
                self.error = ""
            self._recast()
            self._publish()
            return cdp

    def _open(self, cdp: Cdp, url: str, select: bool = True, target: Optional[str] = None) -> Tab:
        """A tab of this Browser's: a new one, opened at `url`; or `target`, one Chrome opened for it, at the page it
        has (`url`)."""
        adopted = target
        with browser_video.WINDOWS if cdp.mode == "own" else _NO_LOCK:   # (its windows: browser_video.py)
            if target is None:
                target = self.chrome.new_target(cdp)
            session = cdp.call("Target.attachToTarget", {"targetId": target, "flatten": True})["sessionId"]
        self.browsers.owner[target] = self.key
        self.browsers.owner[session] = self.key
        tab = Tab(target, session, url)
        with self.lock:
            self.tabs.append(tab)
            if select:
                self.active = len(self.tabs) - 1
        for method, params in (("Page.enable", {}), ("Runtime.enable", {}), ("Log.enable", {}), ("DOM.enable", {}),
                               ("Overlay.enable", {}), ("Emulation.setFocusEmulationEnabled", {"enabled": True}),
                               ("Page.setInterceptFileChooserDialog", {"enabled": False})):
            try:
                cdp.call(method, params, session)
            except CdpError:
                pass
        self._size(cdp, tab)
        if url and url != "about:blank" and adopted is None:
            cdp.call("Page.navigate", {"url": url}, session)
        return tab

    def _size(self, cdp: Cdp, tab: Tab) -> None:
        w, h, dpr = self.viewport
        try:
            cdp.call("Emulation.setDeviceMetricsOverride", {"width": w, "height": h, "deviceScaleFactor": dpr,
                                                            "mobile": False}, tab.session)
        except CdpError:
            pass

    def tab(self, index: Optional[int] = None) -> Tab:
        with self.lock:
            if not self.tabs:
                raise BrowserError("no tab is open")
            i = self.active if index is None else index
            if not 0 <= i < len(self.tabs):
                raise BrowserError(f"no tab {i + 1}: there are {len(self.tabs)}")
            return self.tabs[i]

    def _tab_of(self, session: Optional[str] = None, target: Optional[str] = None) -> Optional[Tab]:
        with self.lock:
            for t in self.tabs:
                if (session and t.session == session) or (target and t.target == target):
                    return t
        return None

    # -- what Chrome says

    def event(self, method: str, params: dict, session: Optional[str]) -> None:
        if method == "Page.screencastFrame":
            return self._frame(params, session)
        if method == "Runtime.bindingCalled" and session is not None and session == self.video.session:
            if params.get("name") == browser_video.BINDING:
                self._chunk(self.video.got(str(params.get("payload") or "")))
            return
        if method.startswith("Target."):
            return self._target_event(method, params)
        tab = self._tab_of(session=session)
        if tab is None:
            return
        frame = params.get("frame") or {}
        if method == "Page.frameStartedLoading" and params.get("frameId") == tab.target:
            tab.loading, tab.starts = True, tab.starts + 1
            self._publish()
        elif method == "Page.frameStoppedLoading" and params.get("frameId") == tab.target:
            tab.loading, tab.loads = False, tab.loads + 1
            self._publish()
            self.chrome.later(lambda: self._retitle(tab))
        elif method == "Page.domContentEventFired":
            self.chrome.later(lambda: self._retitle(tab))
        elif method == "Page.frameNavigated" and not frame.get("parentId"):
            url = frame.get("url", "") + frame.get("urlFragment", "")
            if url != tab.url:
                tab.url = url
                self._forget_refs(tab.target)
                if self.video.failed_on is tab:          # its video failed on the page it had: worth trying again
                    self.video.retry()
                    self.chrome.later(self._recast)
                with self.lock:
                    shown = bool(self.tabs) and self.tabs[self.active] is tab
                if shown and not self._acting_now():
                    self.note(f"the page went to {url}")
            self._publish()
            self._save()
        elif (method == "Page.windowOpen" and params.get("userGesture")) or (
                method == "Page.frameRequestedNavigation" and params.get("disposition") in ("newTab", "newWindow")):
            self._asked_for(params.get("url") or "")     # window.open, target=_blank; a link Cmd/Ctrl/middle-clicked
        elif method == "Page.navigatedWithinDocument" and params.get("frameId") == tab.target:
            tab.url = params.get("url", tab.url)
            self._publish()
            self._save()
            self.chrome.later(lambda: self._retitle(tab))
        elif method == "Page.javascriptDialogOpening":
            tab.dialog = {"type": params.get("type"), "message": params.get("message", ""),
                          "default": params.get("defaultPrompt", "")}
            self._publish()
        elif method == "Page.javascriptDialogClosed":
            tab.dialog = None
            self._publish()
        elif method == "Runtime.consoleAPICalled":
            text = " ".join(_remote_text(a) for a in params.get("args") or [])
            tab.console.append(f"[{params.get('type', 'log')}] {text}"[:2000])
        elif method == "Runtime.exceptionThrown":
            d = params.get("exceptionDetails") or {}
            text = (d.get("exception") or {}).get("description") or d.get("text") or "an exception"
            tab.console.append(f"[exception] {text}"[:2000])
        elif method == "Log.entryAdded":
            e = params.get("entry") or {}
            tab.console.append(f"[{e.get('level', 'log')}] {e.get('text', '')}{' ' + e['url'] if e.get('url') else ''}"[:2000])

    def _target_event(self, method: str, params: dict) -> None:
        info = params.get("targetInfo") or {}
        if method == "Target.targetInfoChanged":
            tab = self._tab_of(target=info.get("targetId"))
            if tab is not None and (tab.title != info.get("title") or tab.url != info.get("url")):
                tab.title, tab.url = info.get("title") or "", info.get("url") or tab.url
                self._publish()
                self._save()
        elif method == "Target.targetDestroyed":
            if params.get("targetId") and params.get("targetId") == self.video.target:
                self.video.gone()
                self.chrome.later(self._recast)
            self._dropped(params.get("targetId"))
        elif method == "Target.targetCreated" and info.get("type") == "page":
            opener = info.get("openerId")
            if opener and self._tab_of(target=opener) is not None and self._tab_of(target=info["targetId"]) is None:
                self.adopt(info, select=True)             # a window its page opened: shown, as Chrome shows it

    def adopt(self, info: dict, select: bool) -> None:
        """A tab Chrome opened for this Browser -- a window its page opened (shown), or a link a click opened in a
        new tab (Cmd+click, a middle click: kept behind, as Chrome keeps it) -- one of its tabs."""
        with self.lock:                                  # what was asked for, opened by Chrome
            mine = next((e for e in self.pending if e["url"] == info.get("url")), self.pending[0] if self.pending else None)
            if mine is not None:
                self.pending.remove(mine)

        def adopt():
            try:
                cdp = self.chrome.cdp()
                tab = self._open(cdp, info.get("url") or "", select=select, target=info["targetId"])
                self._retitle(tab)                       # its page as it is now: it may have moved on unseen
                if not self._acting_now():               # the user's doing, not the agent's
                    self.note(f"a new tab opened{'' if select else ' behind'}: {tab.url or 'blank'}")
                self._recast()
                self._publish()
                self._save()
            except BrowserError:
                pass
        self.chrome.later(adopt)

    def _retitle(self, tab: Tab) -> None:
        """The tab's title, as its page has it now (Chrome tells no change of it)."""
        cdp = self.chrome.conn
        if cdp is None or not cdp.alive:
            return
        try:
            info = cdp.call("Target.getTargetInfo", {"targetId": tab.target}, timeout=5)["targetInfo"]
        except (BrowserError, KeyError):
            return
        url = info.get("url") or tab.url
        if info.get("title") != tab.title or url != tab.url:
            tab.title, tab.url = info.get("title") or "", url
            self._publish()
            self._save()

    def _dropped(self, target: Optional[str]) -> None:
        with self.lock:
            i = next((n for n, t in enumerate(self.tabs) if t.target == target), None)
            if i is None:
                return
            gone = self.tabs.pop(i)
            if self.active >= len(self.tabs):
                self.active = max(0, len(self.tabs) - 1)
            elif i < self.active:
                self.active -= 1
            if self.casting == gone.session:
                self.casting = None
        self._forget_refs(target)
        self.chrome.later(self._recast)
        self._publish()
        self._save()

    def chrome_gone(self) -> None:
        """The Chrome stopped: the tabs are gone, their pages kept, to open again on next use."""
        with self.lock:
            if self.tabs:
                self.saved = [{"url": t.url, "title": t.title} for t in self.tabs]
                self.saved_active = self.active
            self.tabs, self.casting, self.refs, self.ref_of = [], None, {}, {}
        self.video.gone()
        self._publish()

    # -- what the page sees

    def join(self, video: bool = False) -> Viewer:
        """A page showing it (until `leave`): `video`, the page can decode video (browser_video.py)."""
        v = Viewer(video)
        with self.lock:
            self.viewers.append(v)
            frame = self.frame
        v.give(state=self.state(), frame=frame)

        def start():
            try:
                self.live()
                self._recast()
                if video:
                    self.video.key()                     # the capture running already: a key frame to start it on
            except BrowserError as exc:
                with self.lock:
                    self.error = str(exc)
                self._publish()
        self.chrome.later(start)
        return v

    def leave(self, v: Viewer) -> None:
        v.close()
        with self.lock:
            if v in self.viewers:
                self.viewers.remove(v)
        self.chrome.later(self._recast)

    def _recast(self) -> None:
        """While a page watches, the active tab's screen at the view's size: as video where it can be (the dashboard's
        own Chrome, a page that decodes it: browser_video.py), as the screencast's frames until it comes and for any
        other page; off otherwise."""
        cdp = self.chrome.conn
        if cdp is None or not cdp.alive:
            return
        with self.lock:
            shown = self.tabs[self.active] if self.viewers and self.tabs else None
            some_video = any(v.video for v in self.viewers)
            all_video = bool(self.viewers) and all(v.video for v in self.viewers)
            w, h, dpr = self.viewport
        if shown is not None and some_video and cdp.mode == "own" and video_on() and self.video.usable(shown):
            self.video.follow(cdp, shown, (w, h, dpr))
        else:
            self.video.stop()
        with self.lock:
            want = shown if not (all_video and self.video.ok and self.video.tab is shown) else None
            w, h, dpr = self.viewport
            if time.time() < self.quick_until:           # the user scrolling or dragging: quick frames, not sharp ones
                dpr = min(dpr, QUICK_SCALE)
            size = (int(w * dpr), int(h * dpr))
            old = None if self.casting is None else self._tab_of(session=self.casting)
            if want is not None and old is want and want.cast == size:
                return
            self.casting = want.session if want is not None else None
        if old is not None and (old is not want or old.cast != size):
            try:
                cdp.call("Page.stopScreencast", {}, old.session)
            except BrowserError:
                pass
            old.cast = None
        if want is not None:
            try:
                cdp.call("Page.startScreencast", {"format": "jpeg", "quality": QUALITY, "maxWidth": size[0],
                                                  "maxHeight": size[1], "everyNthFrame": 1}, want.session)
                want.cast = size
            except BrowserError:
                pass

    def _frame(self, params: dict, session: Optional[str]) -> None:
        cdp = self.chrome.conn
        if cdp is not None:
            cdp.post("Page.screencastFrameAck", {"sessionId": params.get("sessionId")}, session)
        if session != self.casting:
            return
        meta = params.get("metadata") or {}
        with self.lock:
            self.seq += 1
            self.frame = {"data": params.get("data", ""), "w": meta.get("deviceWidth"), "h": meta.get("deviceHeight"),
                          "seq": self.seq}
            viewers, frame = list(self.viewers), self.frame
        for v in viewers:
            v.give(frame=frame)

    def _video_changed(self) -> None:
        """The video came, or stopped: the screencast stopped or started again, the pages told."""
        self._recast()
        self._publish()

    def _chunk(self, chunk: Optional[dict]) -> None:
        if chunk is None:
            return
        with self.lock:
            self.vseq += 1
            chunk["seq"] = self.vseq
            viewers = [v for v in self.viewers if v.video]
        if not all([v.give(chunk=chunk) for v in viewers]):
            self.video.key()                             # a page fell behind: a key frame to start it again

    def watched(self) -> bool:
        with self.lock:
            return bool(self.viewers)

    def state(self) -> dict:
        with self.lock:
            acting = self.acting if self.acting and (self.acting_until == 0 or time.time() < self.acting_until) else None
            tab = self.tabs[self.active] if self.tabs else None
            return {"tabs": [{"title": t.title, "url": t.url, "loading": t.loading} for t in self.tabs],
                    "active": self.active, "picks": [{"id": p["id"], "label": p["label"]} for p in self.picks],
                    "acting": acting, "dialog": tab.dialog if tab else None, "error": self.error,
                    "running": self.chrome.running(), "viewport": list(self.viewport[:2]),
                    "chrome": self.chrome.which(), "allow": self.chrome.status == "allow", "video": self.video.ok}

    def _publish(self) -> None:
        with self.lock:
            viewers = list(self.viewers)
        if viewers:
            s = self.state()
            for v in viewers:
                v.give(state=s)

    def _save(self) -> None:
        """Its tabs' pages kept, for after the Chrome stopped: at most every second."""
        with self.lock:
            if self.saving:
                return
            self.saving = True

        def save():
            time.sleep(1.0)
            with self.lock:
                self.saving = False
                tabs = [{"url": t.url, "title": t.title} for t in self.tabs]
                active = self.active
            if not tabs:
                return
            conn = _db()
            try:
                conn.execute("UPDATE browser SET tabs = ?, active = ? WHERE key = ?", (json.dumps(tabs), active, self.key))
            finally:
                conn.close()
        threading.Thread(target=save, name="ag-browser-save", daemon=True).start()

    def resize(self, width: int, height: int, dpr: float) -> None:
        w, h = max(200, min(int(width), 3840)), max(150, min(int(height), 2400))
        dpr = max(1.0, min(float(dpr or 1), 2.0))
        with self.lock:
            if (w, h, dpr) == self.viewport:
                return
            self.viewport = (w, h, dpr)
            tabs = list(self.tabs)
        cdp = self.chrome.conn
        if cdp is not None and cdp.alive:
            for t in tabs:
                self._size(cdp, t)
        self._recast()
        self._publish()

    # -- what the user does

    def note(self, what: str) -> None:
        """Something the user did, for the agent's next message: a run of typing into one field is one note."""
        with self.lock:
            if self.log and (self.log[-1] == what or (what.startswith("the page went to ")
                                                      and self.log[-1] == "opened " + what[len("the page went to "):])):
                return
            self.log.append(what)
            del self.log[:-40]

    def _acting_now(self) -> bool:
        with self.lock:
            return self.acting is not None and self.acting_until == 0

    def _quick(self, events: list) -> None:
        """The screen sent at QUICK_SCALE while the user scrolls or drags -- the motion hides the softness -- and at
        full density again QUICK_FOR after the last of it. A click, a key or a bare move of the pointer leaves it sharp:
        a soft frame after each would show."""
        if self.video.ok:                                # video: always sharp, and quick already
            return
        moving = False
        with self.lock:
            for e in events:
                if not isinstance(e, dict) or e.get("type") != "mouse":
                    continue
                kind, x, y = e.get("kind"), float(e.get("x") or 0), float(e.get("y") or 0)
                if kind == "mousePressed":
                    self.pressed_at = (x, y)
                elif kind == "mouseReleased":
                    self.pressed_at = None
                elif kind == "mouseWheel":
                    moving = True
                elif kind == "mouseMoved" and int(e.get("buttons") or 0) and self.pressed_at is not None \
                        and abs(x - self.pressed_at[0]) + abs(y - self.pressed_at[1]) > DRAG_PX:
                    moving = True
        if not moving:
            return
        with self.lock:
            if self.viewport[2] <= QUICK_SCALE:
                return
            was = time.time() < self.quick_until
            self.quick_until = time.time() + QUICK_FOR
            timer = None
            if self.sharpen is None:
                timer = self.sharpen = threading.Timer(QUICK_FOR, self._sharpen)
                timer.daemon = True
        if timer is not None:
            timer.start()
        if not was:
            self._recast()                               # before the input: the frame it makes comes quick

    def _sharpen(self) -> None:
        with self.lock:
            left = self.quick_until - time.time()
            if left > 0:                                 # more since: wait for the last of it
                timer = self.sharpen = threading.Timer(left, self._sharpen)
                timer.daemon = True
            else:
                timer = self.sharpen = None
        if timer is not None:
            timer.start()
        else:
            self.chrome.later(self._recast)

    def input(self, events: list) -> None:
        cdp = self.live()
        tab = self.tab()
        if tab.dialog:                                   # a page under a dialog takes no input: it would wait on it
            return
        self.chrome.touch()
        self._quick(events)
        for e in events[:200]:
            if not isinstance(e, dict):
                continue
            kind = e.get("type")
            mods = int(e.get("modifiers") or 0)
            if kind == "mouse":
                what = str(e.get("kind") or "")
                if what not in ("mousePressed", "mouseReleased", "mouseMoved", "mouseWheel"):
                    continue
                x, y = float(e.get("x") or 0), float(e.get("y") or 0)
                p = {"type": what, "x": x, "y": y, "modifiers": mods, "button": e.get("button") or "none",
                     "buttons": int(e.get("buttons") or 0), "clickCount": int(e.get("clickCount") or 0),
                     "pointerType": "mouse"}
                if what == "mouseWheel":
                    p.update(deltaX=float(e.get("deltaX") or 0), deltaY=float(e.get("deltaY") or 0))
                if what == "mousePressed":
                    with self.lock:
                        self.clicked, self.behind = time.time(), bool(mods & 6) or p["button"] == "middle"
                cdp.call("Input.dispatchMouseEvent", p, tab.session, until=lambda: tab.dialog is not None)
                if tab.dialog:
                    return
                if what == "mousePressed" and p["button"] == "left":
                    self.chrome.later(lambda x=x, y=y, t=tab: self._note_click(t, x, y))
            elif kind == "key":
                p = _key_event(e, bool(e.get("down")), mods)
                if p is not None:
                    cdp.call("Input.dispatchKeyEvent", p, tab.session, until=lambda: tab.dialog is not None)
                    if tab.dialog:
                        return
                    if e.get("down") and (p.get("text") or e.get("key") in ("Backspace", "Delete")):
                        self.chrome.later(lambda t=tab: self._note_typing(t))
            elif kind == "text" and isinstance(e.get("text"), str) and e["text"]:
                cdp.call("Input.insertText", {"text": e["text"][:100_000]}, tab.session, until=lambda: tab.dialog is not None)
                self.chrome.later(lambda t=tab: self._note_typing(t))

    def _asked_for(self, url: str) -> None:
        """A tab its page means to open, at `url`: Chrome opens it (and `adopt` takes it) -- but not from a tab hidden
        from the user's tab strip, there Chrome says it would and then doesn't. So: opened by the dashboard if no tab
        did in OPENED_WAIT. Shown, or behind if the click that asked was a Cmd/Ctrl or middle one. Not a blank one:
        what the page puts in it later can't be followed."""
        if not re.match(r"(?i)(https?|file):", url):
            return
        now = time.time()
        with self.lock:                                  # (each way of opening one sends one report)
            asked = {"url": url, "at": now, "behind": self.behind and now - self.clicked < OPENED_BY_CLICK}
            self.pending.append(asked)
            self.asked += 1

        def unless_opened():
            try:
                time.sleep(OPENED_WAIT)
                with self.lock:
                    if not any(e is asked for e in self.pending):
                        return                           # Chrome opened it: adopted
                    self.pending.remove(asked)
                cdp = self.chrome.cdp()
                self._open(cdp, url, select=not asked["behind"])
                if not self._acting_now():
                    self.note(f"a new tab opened{' behind' if asked['behind'] else ''}: {url}")
                self._recast()
                self._publish()
                self._save()
            except BrowserError:
                pass
            finally:
                with self.lock:
                    self.asked -= 1
        threading.Thread(target=unless_opened, name="ag-browser-open", daemon=True).start()

    def _note_click(self, tab: Tab, x: float, y: float) -> None:
        try:
            label = self._label_at(tab, x, y)
        except BrowserError:
            return
        if label:
            self.note(f"clicked {label}")

    def _note_typing(self, tab: Tab) -> None:
        try:
            got = self.chrome.cdp().call("Runtime.evaluate", {"expression": f"({LABEL_JS})(document.activeElement)",
                                                              "returnByValue": True}, tab.session)
        except BrowserError:
            return
        label = (got.get("result") or {}).get("value")
        if label:
            self.note(f"typed into {label}")

    def _label_at(self, tab: Tab, x: float, y: float) -> str:
        cdp = self.chrome.cdp()
        obj = self._object_at(cdp, tab, x, y)
        if obj is None:
            return ""
        got = cdp.call("Runtime.callFunctionOn", {"objectId": obj, "returnByValue": True,
                                                  "functionDeclaration": f"function () {{ return ({LABEL_JS})(this); }}"},
                       tab.session)
        return (got.get("result") or {}).get("value") or ""

    def _object_at(self, cdp: Cdp, tab: Tab, x: float, y: float) -> Optional[str]:
        node = self._node_at(cdp, tab, x, y)
        if node is None:
            return None
        return cdp.call("DOM.resolveNode", {"backendNodeId": node}, tab.session)["object"].get("objectId")

    def _node_at(self, cdp: Cdp, tab: Tab, x: float, y: float) -> Optional[int]:
        try:
            cdp.call("DOM.getDocument", {"depth": 0}, tab.session)
            return cdp.call("DOM.getNodeForLocation", {"x": int(x), "y": int(y), "includeUserAgentShadowDOM": False,
                                                       "ignorePointerEventsNone": True}, tab.session).get("backendNodeId")
        except CdpError:
            return None

    def navigate(self, url: str = "", action: str = "", by_user: bool = True) -> str:
        cdp = self.live()
        tab = self.tab()
        if action in ("back", "forward"):
            hist = cdp.call("Page.getNavigationHistory", {}, tab.session)
            i = hist.get("currentIndex", 0) + (-1 if action == "back" else 1)
            entries = hist.get("entries") or []
            if not 0 <= i < len(entries):
                raise BrowserError(f"nothing to go {action} to")
            cdp.call("Page.navigateToHistoryEntry", {"entryId": entries[i]["id"]}, tab.session)
        elif action == "reload":
            cdp.call("Page.reload", {}, tab.session)
        else:
            url = _url(url)
            got = cdp.call("Page.navigate", {"url": url}, tab.session)
            if got.get("errorText"):
                raise BrowserError(f"{url} did not open: {got['errorText']}")
            if by_user:
                self.note(f"opened {url}")
        return url or action

    def switch(self, index: int) -> None:
        with self.lock:
            if not 0 <= index < len(self.tabs):
                raise BrowserError(f"no tab {index + 1}")
            self.active = index
            tab = self.tabs[index]
        cdp = self.chrome.cdp()
        try:
            if cdp.mode != "mine":                       # the user's Chrome: their window left as it is
                cdp.call("Page.bringToFront", {}, tab.session)
        except CdpError:
            pass
        self._recast()
        self._publish()
        self._save()

    def new_tab(self, url: str = "") -> Tab:
        cdp = self.live()
        tab = self._open(cdp, _url(url) if url else "about:blank")
        self._recast()
        self._publish()
        self._save()
        return tab

    def close_tab(self, index: int) -> None:
        tab = self.tab(index)
        self.chrome.cdp().call("Target.closeTarget", {"targetId": tab.target})
        self._dropped(tab.target)

    def answer_dialog(self, accept: bool, text: Optional[str] = None) -> str:
        tab = self.tab()
        if not tab.dialog:
            raise BrowserError("no dialog is open")
        d = tab.dialog
        self.chrome.cdp().call("Page.handleJavaScriptDialog", {"accept": bool(accept),
                                                               **({"promptText": text} if text is not None else {})},
                               tab.session)
        tab.dialog = None
        self._publish()
        return f"the {d.get('type') or 'dialog'} \"{d.get('message', '')[:200]}\" was {'accepted' if accept else 'dismissed'}"

    def selection(self) -> str:
        """What is selected in the page, for the user's clipboard."""
        tab = self.tab()
        got = self.chrome.cdp().call("Runtime.evaluate", {"returnByValue": True, "expression": SELECTION_JS}, tab.session)
        value = (got.get("result") or {}).get("value")
        return value if isinstance(value, str) else ""

    # -- what the user points at

    def hover(self, x: Optional[float], y: Optional[float]) -> None:
        """The element under (x, y) outlined, as DevTools' picker does; none: the outline gone."""
        cdp = self.chrome.cdp()
        tab = self.tab()
        if x is None or y is None:
            try:
                cdp.call("Overlay.hideHighlight", {}, tab.session)
            except CdpError:
                pass
            return
        node = self._node_at(cdp, tab, x, y)
        if node is None:
            return
        try:
            cdp.call("Overlay.highlightNode", {"backendNodeId": node, "highlightConfig": HIGHLIGHT}, tab.session)
        except CdpError:
            pass

    def pick(self, x: Optional[float] = None, y: Optional[float] = None, box: Optional[list] = None) -> dict:
        cdp = self.live()
        tab = self.tab()
        self.chrome.touch()
        if box is not None:
            bx, by, bw, bh = (float(v) for v in box[:4])
            if bw < 4 or bh < 4:
                raise BrowserError("too small an area")
            got = cdp.call("Runtime.evaluate", {"returnByValue": True,
                                                "expression": f"({AREA_JS})({bx}, {by}, {bw}, {bh})"}, tab.session)
            text = (got.get("result") or {}).get("value") or ""
            image = _save_png(cdp.call("Page.captureScreenshot", {"format": "png", "clip": _clip(cdp, tab, bx, by, bw, bh)},
                                       tab.session)["data"])
            pick = {"kind": "area", "box": [round(bx), round(by), round(bw), round(bh)], "text": text, "image": image,
                    "label": f"an area {round(bw)}×{round(bh)}", "url": tab.url}
        else:
            node = self._node_at(cdp, tab, float(x or 0), float(y or 0))
            if node is None:
                raise BrowserError("nothing there to pick")
            obj = cdp.call("DOM.resolveNode", {"backendNodeId": node}, tab.session)["object"]["objectId"]
            # the element meant: the nearest one a person would name (a button, not the text inside it)
            got = cdp.call("Runtime.callFunctionOn", {"objectId": obj, "functionDeclaration": f"function () {{ return ({MEANT_JS})(this); }}"},
                           tab.session)
            meant = (got.get("result") or {}).get("objectId") or obj
            node = cdp.call("DOM.describeNode", {"objectId": meant}, tab.session)["node"]["backendNodeId"]
            info = cdp.call("Runtime.callFunctionOn", {"objectId": meant, "returnByValue": True,
                                                       "functionDeclaration": f"function () {{ return ({PICK_JS})(this, {MAX_HTML}); }}"},
                            tab.session)["result"]["value"]
            role, name = self._ax(cdp, tab, node)
            x0, y0, w, h = info["box"]
            image = None
            if w > 0 and h > 0:
                try:
                    image = _save_png(cdp.call("Page.captureScreenshot", {"format": "png", "clip": _clip(
                        cdp, tab, max(0, x0 - 6), max(0, y0 - 6), w + 12, h + 12)}, tab.session)["data"])
                except BrowserError:
                    pass
            label = _named(role or info["tag"], name or info.get("text", "")[:80])
            pick = {"kind": "element", **info, "role": role, "name": name, "image": image, "label": label,
                    "target": tab.target, "node": node, "url": tab.url}
            try:
                cdp.call("Overlay.hideHighlight", {}, tab.session)
            except CdpError:
                pass
        with self.lock:
            self.pick_n += 1
            pick["id"] = f"p{self.pick_n}"
            self.picks.append(pick)
            self.kept_picks[pick["id"]] = pick
        self._publish()
        return {"id": pick["id"], "label": pick["label"]}

    def unpick(self, pid: str) -> None:
        with self.lock:
            self.picks = [p for p in self.picks if p["id"] != pid]
        self._publish()

    def _ax(self, cdp: Cdp, tab: Tab, node: int) -> Tuple[str, str]:
        try:
            got = cdp.call("Accessibility.getPartialAXTree", {"backendNodeId": node, "fetchRelatives": False},
                           tab.session)["nodes"]
        except CdpError:
            return "", ""
        n = got[0] if got else {}
        return (n.get("role") or {}).get("value") or "", (n.get("name") or {}).get("value") or ""

    # -- the user's message

    def compose(self, text: str) -> str:
        """The user's message as the agent gets it: their words, then <browser_state> (module doc)."""
        with self.lock:
            tabs, active, log, picks = list(self.tabs), self.active, list(self.log), list(self.picks)
        lines = ["<browser_state>", "The browser you share with the user, as they sent this message:"]
        if tabs:
            t = tabs[active]
            lines.append(f"page: {t.title or '(no title)'} — {t.url or 'about:blank'}"
                         + (f"  (tab {active + 1} of {len(tabs)})" if len(tabs) > 1 else ""))
        elif self.saved:
            t = self.saved[min(self.saved_active, len(self.saved) - 1)]
            lines.append(f"page: {t.get('title') or '(no title)'} — {t.get('url')}  (closed for now: it opens again when used)")
        else:
            lines.append("page: none open yet")
        if log:
            lines.append("since their last message, the user: " + "; ".join(log))
        if picks:
            lines.append("they picked (use these refs in the ag-browser tools, as e-refs):")
            for p in picks:
                lines.extend(_pick_lines(p))
        lines.append("</browser_state>")
        return f"{text}\n\n" + "\n".join(lines)

    def sent(self) -> None:
        """The message went: what it said of the user's actions and picks is told."""
        with self.lock:
            self.log, self.picks = [], []
        self._publish()

    # -- the agent's tools

    def _forget_refs(self, target: str) -> None:
        with self.lock:
            for ref, (t, _) in list(self.refs.items()):
                if t == target:
                    del self.ref_of[self.refs.pop(ref)]

    def _ref(self, target: str, node: int) -> str:
        with self.lock:
            ref = self.ref_of.get((target, node))
            if ref is None:
                self.ref_n += 1
                ref = f"e{self.ref_n}"
                self.refs[ref], self.ref_of[(target, node)] = (target, node), ref
            return ref

    def resolve(self, ref: str) -> Tuple[Tab, int, str]:
        """A ref's tab, node and live object: the tab made the active one, as the agent works there."""
        ref = str(ref or "").strip().strip("[]")
        if ref.startswith("ref="):
            ref = ref[4:]
        with self.lock:
            if ref in self.refs:
                target, node = self.refs[ref]
            elif ref in self.kept_picks and self.kept_picks[ref].get("kind") == "element":
                target, node = self.kept_picks[ref]["target"], self.kept_picks[ref]["node"]
            elif ref in self.kept_picks:
                raise BrowserError(f"{ref} is an area the user picked, not an element: use its picture, or a snapshot")
            elif re.fullmatch(r"e\d+", ref) and int(ref[1:]) <= self.ref_n:
                raise BrowserError(f"{ref} is gone: its page changed since (by you, the user, or itself) -- take a new "
                                   f"snapshot")
            else:
                raise BrowserError(f"no element {ref}: take a snapshot for the refs of the page as it is")
        tab = self._tab_of(target=target)
        if tab is None:
            raise BrowserError(f"{ref} was in a tab that is closed now")
        with self.lock:
            i = self.tabs.index(tab)
        if i != self.active:
            self.switch(i)
        cdp = self.chrome.cdp()
        try:
            obj = cdp.call("DOM.resolveNode", {"backendNodeId": node}, tab.session)["object"]["objectId"]
        except CdpError:
            raise BrowserError(f"{ref} is gone: the page changed since (by you, the user, or itself) -- take a new "
                               f"snapshot") from None
        return tab, node, obj

    def acting_on(self, label: str, box: Optional[list] = None) -> None:
        with self.lock:
            self.acting, self.acting_until = {"label": label, "box": box}, 0
        self._publish()

    def acted(self) -> None:
        with self.lock:
            if self.acting is not None:
                self.acting_until = time.time() + ACTING_KEEP
        self._publish()

        def clear():
            time.sleep(ACTING_KEEP + 0.05)
            with self.lock:
                if self.acting is not None and self.acting_until and time.time() >= self.acting_until:
                    self.acting = None
            self._publish()
        threading.Thread(target=clear, name="ag-browser-acted", daemon=True).start()


def _pick_lines(p: dict) -> List[str]:
    if p.get("kind") == "area":
        x, y, w, h = p["box"]
        out = [f"[{p['id']}] an area {w}×{h} at ({x}, {y}) of the page"]
        if p.get("text"):
            out.append(f"  text in it: {json.dumps(p['text'][:600], ensure_ascii=False)}")
    else:
        out = [f"[{p['id']}] {p['label']}", f"  where: {p.get('selector') or p.get('tag')}"]
        if p.get("html"):
            out.append(f"  html: {p['html']}")
        if p.get("styles"):
            out.append("  styles: " + "; ".join(f"{k} {v}" for k, v in p["styles"].items()))
    if p.get("image"):
        out.append(f"  image: {p['image']}")
    return out


def _a(word: Optional[str]) -> str:
    word = word or "a"
    return ("An " if word[:1] in "aeiou" else "A ") + word


def _named(role: str, name: str) -> str:
    name = " ".join(str(name or "").split())
    return f"{role} {json.dumps(name[:80], ensure_ascii=False)}" if name else role


def _openable(url: str) -> bool:
    return bool(re.match(r"(https?|file|about|data|chrome):", url or ""))


def _url(url: str) -> str:
    """What the user or agent typed, as a URL: a scheme added to a host -- http for one on this machine."""
    url = (url or "").strip()
    if not url:
        raise BrowserError("which page?")
    if re.match(r"[A-Za-z][A-Za-z0-9+.-]*:", url) and not re.match(r"(localhost|127\.0\.0\.1|\[::1\]):\d", url):
        if not _openable(url):
            raise BrowserError(f"not a page the browser opens: {url}")
        return url
    if url.startswith("/") or url.startswith("~"):
        return "file://" + os.path.abspath(os.path.expanduser(url))
    local = re.match(r"(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])([:/]|$)", url)
    return ("http://" if local else "https://") + url


def _clip(cdp: "Cdp", tab: "Tab", x: float, y: float, w: float, h: float, scale: float = 1.0) -> dict:
    """A screenshot's clip of what shows at (x, y, w, h) in the viewport: Chrome takes it in the document's
    coordinates, so where it is scrolled to is added."""
    try:
        m = cdp.call("Page.getLayoutMetrics", {}, tab.session)
        v = m.get("cssLayoutViewport") or m.get("layoutViewport") or {}
        px, py = float(v.get("pageX") or 0), float(v.get("pageY") or 0)
    except CdpError:
        px = py = 0.0
    return {"x": x + px, "y": y + py, "width": w, "height": h, "scale": scale}


def _save_png(data: str) -> str:
    return home.save_upload("image/png", data)["path"]


def _remote_text(arg: dict) -> str:
    if "value" in arg:
        v = arg["value"]
        return v if isinstance(v, str) else json.dumps(v)
    return arg.get("description") or arg.get("type") or ""


def _key_event(e: dict, down: bool, mods: int) -> Optional[dict]:
    """The page's key (KeyboardEvent's key, code, keyCode) as Chrome's own: text for a printable key, Enter's "\\r";
    the editing commands macOS gives Cmd+A, C, X, V, Z (headless Chrome has no menu to give them)."""
    key, code = str(e.get("key") or ""), str(e.get("code") or "")
    if not key:
        return None
    vk = int(e.get("keyCode") or KEYS.get(key, (None, 0))[1] or 0)
    p = {"type": "keyUp", "key": key, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk,
         "modifiers": mods, "location": int(e.get("location") or 0), "autoRepeat": bool(e.get("repeat"))}
    if not down:
        return p
    text = "\r" if key == "Enter" else key if len(key) == 1 and not mods & (2 | 4) else ""
    p["type"] = "keyDown" if text else "rawKeyDown"
    if text:
        p["text"] = p["unmodifiedText"] = text
    command = EDIT_COMMANDS.get((key.lower(), bool(mods & 8))) if mods & (2 | 4) else None
    if command:
        p["commands"] = [command]
    return p


KEYS = {   # a key's name -> (its code, its Windows virtual key code)
    "Enter": ("Enter", 13), "Tab": ("Tab", 9), "Escape": ("Escape", 27), "Backspace": ("Backspace", 8),
    "Delete": ("Delete", 46), "ArrowLeft": ("ArrowLeft", 37), "ArrowUp": ("ArrowUp", 38), "ArrowRight": ("ArrowRight", 39),
    "ArrowDown": ("ArrowDown", 40), "Home": ("Home", 36), "End": ("End", 35), "PageUp": ("PageUp", 33),
    "PageDown": ("PageDown", 34), " ": ("Space", 32), "Space": ("Space", 32),
    **{f"F{n}": (f"F{n}", 111 + n) for n in range(1, 13)},
}
EDIT_COMMANDS = {("a", False): "selectAll", ("c", False): "copy", ("x", False): "cut", ("v", False): "paste",
                 ("z", False): "undo", ("z", True): "redo"}
MODIFIERS = {"alt": 1, "option": 1, "control": 2, "ctrl": 2, "meta": 4, "cmd": 4, "command": 4, "shift": 8}
HIGHLIGHT = {"showInfo": True, "showAccessibilityInfo": True, "contentColor": {"r": 80, "g": 140, "b": 255, "a": 0.22},
             "paddingColor": {"r": 80, "g": 200, "b": 120, "a": 0.18}, "borderColor": {"r": 40, "g": 100, "b": 230, "a": 1}}

# An element's name as a person would say it: its role or tag and its words (a password field's value never).
LABEL_JS = r"""function (el) {
  if (!el || el.nodeType !== 1 || el === document.body || el === document.documentElement) return "";
  el = el.closest('a,button,input,select,textarea,summary,label,[role],[contenteditable=""],[contenteditable=true]') || el;
  const tag = el.localName, type = (el.getAttribute('type') || '').toLowerCase();
  const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag === 'select' ? 'combobox'
    : tag === 'textarea' ? 'textbox' : tag === 'input' ? ({checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button',
      search: 'searchbox', password: 'password field'}[type] || 'textbox') : el.isContentEditable ? 'textbox' : tag);
  const lab = el.labels && el.labels[0] ? el.labels[0].innerText : '';
  const name = (el.getAttribute('aria-label') || lab || (tag === 'input' || tag === 'textarea' ? '' : el.innerText) ||
    el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') || el.getAttribute('alt') || '')
    .replace(/\s+/g, ' ').trim().slice(0, 80);
  return name ? `${role} ${JSON.stringify(name)}` : role;
}"""
# The element a click meant: the nearest named, actionable one around the node under it.
MEANT_JS = r"""function (el) {
  if (el && el.nodeType !== 1) el = el.parentElement;
  return (el && el.closest('a,button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=option]')) || el;
}"""
# What a pick tells of an element: its tag, words, a CSS path, its HTML (password values left out), box and styles.
PICK_JS = r"""function (el, max) {
  const css = (e) => { const p = []; for (; e && e.nodeType === 1 && e !== document.body && e !== document.documentElement && p.length < 5; e = e.parentElement) {
      if (e.id && /^[A-Za-z][\w-]*$/.test(e.id)) { p.unshift('#' + e.id); break; }
      let s = e.localName; const t = e.getAttribute('data-testid');
      if (t) s += `[data-testid="${t}"]`;
      else if (e.classList.length) s += '.' + [...e.classList].slice(0, 3).map((c) => CSS.escape(c)).join('.');
      const sib = e.parentElement ? [...e.parentElement.children].filter((x) => x.localName === e.localName) : [];
      if (!t && sib.length > 1) s += `:nth-of-type(${sib.indexOf(e) + 1})`;
      p.unshift(s); } return p.join(' > '); };
  const copy = el.cloneNode(true);
  for (const i of [copy, ...copy.querySelectorAll('input')]) if (i.localName === 'input' && (i.type || '').toLowerCase() === 'password') i.removeAttribute('value');
  let html = copy.outerHTML || '';
  if (html.length > max) html = html.slice(0, max) + '…';
  const r = el.getBoundingClientRect(), st = getComputedStyle(el);
  const styles = {};
  for (const k of ['color', 'background-color', 'font-size', 'font-weight', 'padding', 'margin', 'border-radius', 'display'])
    if (st[k] && !['normal', 'none', '0px', 'rgba(0, 0, 0, 0)'].includes(st[k])) styles[k] = st[k];
  return { tag: el.localName, text: (el.innerText || el.value && el.type !== 'password' && el.value || '').replace(/\s+/g, ' ').trim().slice(0, 300),
           selector: css(el), html, box: [r.x, r.y, r.width, r.height].map(Math.round), styles };
}"""
# The text in an area of the page.
AREA_JS = r"""function (x, y, w, h) {
  const out = [], walk = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let n = 0;
  for (let t = walk.nextNode(); t && n < 600; t = walk.nextNode()) {
    const s = t.nodeValue.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const range = document.createRange(); range.selectNodeContents(t);
    const r = range.getBoundingClientRect();
    if (r.width && r.right > x && r.left < x + w && r.bottom > y && r.top < y + h) { out.push(s); n += s.length; }
  }
  return out.join(' ').slice(0, 600);
}"""
SELECTION_JS = r"""(() => { const a = document.activeElement;
  if (a && (a.localName === 'textarea' || (a.localName === 'input' && a.type !== 'password')) && a.selectionStart !== a.selectionEnd)
    return a.value.slice(a.selectionStart, a.selectionEnd);
  return String(getSelection() || ''); })()"""


# ---- every Browser: made, found, its agent's tools -------------------------------------------------------------

def instructions(root: str) -> str:
    return (
        "# Browser\n\n"
        "You are the agent of a Browser in the ag dashboard: a Chrome tab you share with the user. They see the page "
        "live in the dashboard and can click, type and navigate in it themselves, at any time -- also while you work. "
        f"For this browser use the {NAME} tools (snapshot, click, type, navigate, screenshot, ...), not other browser "
        "tools: those drive a browser the user does not see.\n\n"
        "## Click only when there is no other way\n\n"
        "Working through the page -- clicking, typing, scrolling, a new snapshot after each step -- is slow and breaks "
        "easily. Before you start, look at the tools you have, and use the first of these that can do the job:\n"
        "1. A dedicated tool for the service: an MCP server or connector for it (Google Docs, Drive, Sheets, Gmail, "
        "Calendar, GitHub, Slack, Notion, Figma, Jira, ...), or its command-line tool or API if one is set up for you "
        "(gh, gcloud, ...). To edit a Google Doc, for example, use a Google Docs or Drive tool, not the document's page.\n"
        "2. To read a page: `snapshot`, or `evaluate` to pull out what you need in one go, not screenshots and "
        "scrolling.\n"
        "3. Clicking and typing in the page, only for what neither of these can do.\n\n"
        "If a dedicated tool could do the task but you don't have it, or it isn't connected or authorized, then before "
        "doing anything for it in the page -- even opening it, even for a small task -- stop and ask. Tell the user "
        "which tool would do it (for example a Google Docs MCP server or connector) and how they can add or connect "
        "it, warn them that without it you will work by clicking through the page, which is much slower, and ask "
        "whether they will add it or want you to go ahead in the page. Then wait for their answer. Only a task that is "
        "itself just to open or read a page needs no asking.\n\n"
        "After you change something through another tool, open or reload its page in the browser if the page does not "
        "update on its own, so the user sees the result there.\n\n"
        "## Using the page\n\n"
        "- `snapshot` shows the page's elements, each with a ref ([e12]); act on an element by its ref. What you do may "
        "change the page: take a new snapshot before acting on what you have not seen.\n"
        "- A ref that stopped working means the page changed (by you, the user, or the page itself): take a new snapshot.\n"
        "- Each message from the user ends with <browser_state>: the page they were on, what they did in the browser "
        "since their last message, and the elements or areas they picked to point at what they mean (p1, p2, ...: "
        "refs the tools take, as e-refs, each with a picture of it you can read).\n"
        "- For a login, a two-factor code, a captcha or a payment, ask the user to do it in the browser. Never ask them "
        "for a password.\n"
        f"- Downloads go to {downloads_dir()} (or, if the Browser runs in the user's own Chrome, where it saves them). "
        f"Your working directory is {root}.").strip()


def launch_args(s: dict) -> List[str]:
    """What a Browser's actor's harness is started with besides its own options (sessions.py): the tools (the MCP
    server here) and its instructions. [] for any other session."""
    key = key_of(s)
    if key is None:
        return []
    url = f"{ORIGIN}/browser/w/{key}/mcp"
    told = instructions(s.get("cwd") or "")
    if s.get("harness") == "codex":
        return ["-c", f'mcp_servers.{NAME}.url="{url}"',
                "-c", f"developer_instructions={json.dumps(told, ensure_ascii=False)}"]
    return ["--mcp-config", json.dumps({"mcpServers": {NAME: {"type": "http", "url": url}}}),
            "--append-system-prompt", told]


def key_of(s: dict) -> Optional[str]:
    """The key of the Browser whose actor the session is (its `role`), or None."""
    raw = str(s.get("role") or "")
    if not raw.startswith("{"):
        return None
    try:
        role = json.loads(raw)
    except ValueError:
        return None
    key = role.get("browser") if isinstance(role, dict) else None
    return key if isinstance(key, str) and KEY.fullmatch(key) else None


def _tool(name: str, description: str, properties: Optional[dict] = None, required: Optional[list] = None) -> dict:
    return {"name": name, "description": description,
            "inputSchema": {"type": "object", "properties": properties or {}, **({"required": required} if required else {})}}


REF = {"type": "string", "description": "the element's ref: e12 from a snapshot, or p1 that the user picked"}
TOOLS = [
    _tool("snapshot", "The page as an outline of its elements -- role, name, value, state -- each with a ref to act on "
          "it by, and the page's address, title and tabs. With `ref`: that element's part of the page only.",
          {"ref": {"type": "string", "description": "only this element and what is inside it"}}),
    _tool("click", "Click an element.", {"ref": REF, "double": {"type": "boolean"},
                                         "button": {"type": "string", "enum": ["left", "right", "middle"]},
                                         "modifiers": {"type": "array", "items": {"type": "string",
                                                       "enum": ["Alt", "Control", "Meta", "Shift"]}}}, ["ref"]),
    _tool("type", "Type text into a field (its text replaced, unless `append`); `submit`: press Enter after.",
          {"ref": REF, "text": {"type": "string"}, "submit": {"type": "boolean"}, "append": {"type": "boolean"}},
          ["ref", "text"]),
    _tool("press", "Press a key in the page, or in an element: Enter, Tab, Escape, Backspace, ArrowDown, PageDown, "
          "a letter, or a combination such as Meta+a or Shift+Tab.", {"key": {"type": "string"}, "ref": REF}, ["key"]),
    _tool("select", "Choose options of a <select> by their value or label.",
          {"ref": REF, "values": {"type": "array", "items": {"type": "string"}}}, ["ref", "values"]),
    _tool("hover", "Move the mouse over an element.", {"ref": REF}, ["ref"]),
    _tool("scroll", "Scroll the page, or an element, by about a screen (`amount`: pixels instead); or, with only "
          "`ref`, bring the element into view.",
          {"direction": {"type": "string", "enum": ["up", "down", "left", "right"]}, "amount": {"type": "number"},
           "ref": REF}),
    _tool("navigate", "Open a page in the tab shown: a URL, or a host (https://, or http:// for localhost).",
          {"url": {"type": "string"}}, ["url"]),
    _tool("back", "Go back a page."),
    _tool("forward", "Go forward a page."),
    _tool("reload", "Load the page again."),
    _tool("tabs", "The tabs: list them, open a new one (`url`), switch to one or close one (`index`, from 1).",
          {"action": {"type": "string", "enum": ["list", "new", "switch", "close"]}, "index": {"type": "integer"},
           "url": {"type": "string"}}),
    _tool("screenshot", "A picture of the page as shown (the user's view), or of an element; `full`: the whole page.",
          {"ref": REF, "full": {"type": "boolean"}}),
    _tool("console", "The page's console: its messages, errors and failed loads, latest last; `clear`: then forgotten.",
          {"clear": {"type": "boolean"}}),
    _tool("evaluate", "Run a JavaScript expression in the page (awaited), its value as JSON; with `ref`, the element "
          "is `el`.", {"expression": {"type": "string"}, "ref": REF}, ["expression"]),
    _tool("wait", "Wait until `text` shows in the page (at most `seconds`, 10 by default, 60 at most), or for `seconds`.",
          {"text": {"type": "string"}, "seconds": {"type": "number"}}),
    _tool("dialog", "Answer the page's alert, confirm or prompt: accept (with `text` for a prompt) or dismiss it.",
          {"accept": {"type": "boolean"}, "text": {"type": "string"}}, ["accept"]),
    _tool("upload", "Give a file input files from this machine.",
          {"ref": REF, "paths": {"type": "array", "items": {"type": "string"}}}, ["ref", "paths"]),
]


class Browsers:
    """Every Browser the dashboard serves (module doc)."""

    def __init__(self, started: sessions.Sessions):
        self.started = started
        self.lock = threading.Lock()
        self.open: Dict[str, Browser] = {}
        self.owner: Dict[str, str] = {}                  # a tab's target id, and its session id -> its Browser's key
        self.chrome = Chrome(self)

    def close(self) -> None:
        self.chrome.close()

    # -- which Browser

    def create(self, gatherer: str, cwd: str, harness: str = "claude", model: Optional[str] = None) -> dict:
        """A new Browser, its actor a new session of `harness` in `gatherer`, in `cwd` (a new gatherer if none has the
        name; its agent starts with its first message): its settings (`config`)."""
        if not available():
            raise BrowserError("no Chrome here: install Google Chrome (or Chromium), or name one in config.toml's "
                               "[dashboard] browser", 409)
        root = os.path.realpath(os.path.abspath(os.path.expanduser(cwd or "")))
        if not os.path.isdir(root):
            raise BrowserError(f"no directory {cwd}")
        key = secrets.token_hex(8)
        s = self.started.create(gatherer, root, "auto", harness if harness in sessions.HARNESSES else "claude",
                                model, role=json.dumps({"browser": key}))
        conn = _db()
        try:
            conn.execute("INSERT INTO browser (key, gatherer, root, session_id, created_at) VALUES (?, ?, ?, ?, ?)",
                         (key, gatherer, root, s["session_id"], time.time()))
        finally:
            conn.close()
        return self.config(key)

    def row(self, key: str) -> dict:
        if not KEY.fullmatch(key or ""):
            raise BrowserError("no such Browser", 404)
        conn = _db()
        try:
            r = conn.execute("SELECT * FROM browser WHERE key = ?", (key,)).fetchone()
        finally:
            conn.close()
        if r is None:
            raise BrowserError("no such Browser", 404)
        return dict(r)

    def get(self, key: str) -> Browser:
        with self.lock:
            b = self.open.get(key)
        if b is not None:
            return b
        row = self.row(key)
        with self.lock:
            return self.open.setdefault(key, Browser(self, key, row))

    def _session(self, sid: str) -> Optional[dict]:
        listed = {s["session_id"]: s for s in self.started.list()}
        return listed.get(sid) or next((s for s in listed.values() if s.get("started_as") == sid), None)

    def config(self, key: str) -> dict:
        r = self.row(key)
        s = self._session(r["session_id"])
        return {"key": key, "root": r["root"], "gatherer": r["gatherer"],
                "channel": s["session_id"] if s else r["session_id"], "harness": (s or {}).get("harness") or "claude"}

    def watched(self) -> bool:
        with self.lock:
            return any(b.watched() for b in self.open.values())

    def publish(self) -> None:
        """Every open Browser's state to its pages: the Chrome waits on the user, or no longer does."""
        for b in list(self.open.values()):
            b._publish()

    # -- Chrome's events, to the Browser whose tab each is of

    def event(self, method: str, params: dict, session: Optional[str]) -> None:
        if method.startswith("Browser.download"):
            return self._download(method, params)
        if session is None:                              # the Chrome's own: its targets
            info = params.get("targetInfo") or {}
            key = self.owner.get(params.get("targetId") or info.get("targetId")) or self.owner.get(info.get("openerId"))
            if key is None and method == "Target.targetCreated" and info.get("type") == "page" \
                    and not info.get("openerId") and info.get("url") not in ("", "about:blank"):
                now = time.time()                        # a link a click opened in a new tab (Cmd+click): no opener
                clicked = max(list(self.open.values()), key=lambda b: b.clicked, default=None)
                if clicked is not None and now - clicked.clicked < OPENED_BY_CLICK:
                    clicked.adopt(info, select=False)
            return self._route(key, method, params, session)
        else:
            key = self.owner.get(session)
        self._route(key, method, params, session)

    def _route(self, key: Optional[str], method: str, params: dict, session: Optional[str]) -> None:
        b = self.open.get(key) if key else None
        if b is not None:
            b.event(method, params, session)

    def _download(self, method: str, params: dict) -> None:
        if method == "Browser.downloadProgress" and params.get("state") == "completed":
            for b in list(self.open.values()):
                b.note(f"a download finished in {downloads_dir()}")

    def chrome_gone(self) -> None:
        self.owner.clear()
        for b in list(self.open.values()):
            b.chrome_gone()

    # -- the user's message

    def compose(self, session: dict, text: str) -> Tuple[str, Optional[Browser]]:
        """`text` as the session's agent is to get it: with <browser_state> if it is a Browser's (and the Browser, to
        tell it the message went: its `sent`)."""
        key = key_of(session)
        if key is None:
            return text, None
        try:
            b = self.get(key)
        except BrowserError:
            return text, None
        self.name_actor(key)
        return b.compose(text), b

    def name_actor(self, key: str) -> None:
        """Its actor named "Browser · <folder>", once, as its first message is sent -- once its gatherer has it."""
        r = self.row(key)
        if r.get("named"):
            return
        conn = _db()
        try:
            conn.execute("UPDATE browser SET named = 1 WHERE key = ?", (key,))
        finally:
            conn.close()

        def name():
            end, sid = time.time() + NAME_WAIT, r["session_id"]
            now = (self._session(sid) or {}).get("session_id") or sid
            while time.time() < end and not sessions._has_calls(r["gatherer"], now):
                time.sleep(2)
                now = (self._session(sid) or {}).get("session_id") or sid
            try:
                naming.record(r["gatherer"], now, f"Browser · {os.path.basename(r['root']) or r['root']}")
            except naming.NamingError:
                pass
        threading.Thread(target=name, name="ag-browser-name", daemon=True).start()

    # -- the agent's tools

    def call(self, key: str, name: str, args: dict) -> dict:
        """A tool's result (mcp.py's `result`, or with a picture): what went wrong said as an error the agent reads."""
        b = self.get(key)
        try:
            b.live()
            self.chrome.touch()
            tab = b.tab()
            if tab.dialog and name not in ("dialog", "tabs", "console"):
                d = tab.dialog
                return mcp.result(f"The page shows {_a(d.get('type')).lower()} dialog: {json.dumps(d.get('message', ''))}"
                                  f"{' (default answer ' + json.dumps(d['default']) + ')' if d.get('default') else ''}. "
                                  "Answer it with the dialog tool first.", error=True)
            return getattr(self, f"_t_{name}")(b, args)
        except BrowserError as exc:
            return mcp.result(str(exc), error=True)
        finally:
            b.acted()

    def _act(self, b: Browser, ref: str, verb: str) -> Tuple[Cdp, Tab, int, str, str, List[float]]:
        """The element `ref` names, brought into view, and where its middle is; marked on the user's screen as what
        the agent does now ("clicking button "Pay"")."""
        tab, node, obj = b.resolve(ref)
        cdp = self.chrome.cdp()
        try:
            cdp.call("DOM.scrollIntoViewIfNeeded", {"backendNodeId": node}, tab.session)
        except CdpError:
            pass
        role, name = b._ax(cdp, tab, node)
        label = _named(role or "element", name) + f" [{ref}]"
        try:
            quads = cdp.call("DOM.getContentQuads", {"backendNodeId": node}, tab.session).get("quads") or []
        except CdpError:
            quads = []
        if not quads:
            b.acting_on(f"{verb} {label}")
            raise BrowserError(f"{label} is not shown on the page (hidden, or of no size): nothing to {verb.split()[0]}")
        q = quads[0]
        xs, ys = q[0::2], q[1::2]
        box = [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)]
        b.acting_on(f"{verb} {label}", box)
        return cdp, tab, node, obj, label, [sum(xs) / 4, sum(ys) / 4]

    def _after(self, b: Browser, tab: Tab, starts: int, tabs: int, did: str) -> dict:
        """What an action did, told: the page it went to, a tab it opened, a dialog it brought up."""
        time.sleep(SETTLE)
        if tab.starts > starts:
            end = time.time() + LOAD_WAIT
            while tab.loading and time.time() < end and not tab.dialog:
                time.sleep(0.1)
            b._retitle(tab)
        out = [did]
        end = time.time() + OPENED_WAIT + 3              # a tab its page asked for, opened by the dashboard
        while b.asked and time.time() < end:
            time.sleep(0.05)
        with b.lock:
            now = len(b.tabs)
        if now > tabs:
            with b.lock:
                new, shown = b.tabs[-1], b.tabs[b.active] is b.tabs[-1]
            end = time.time() + 2                        # its address: a tab opened for it starts blank
            while new.url in ("", "about:blank") and time.time() < end:
                time.sleep(0.05)
            out.append(f"It opened a new tab ({now}), {'shown now' if shown else 'behind this one'}: {new.url or 'blank'}.")
        if tab.starts > starts:
            out.append(f"The page is now {json.dumps(tab.title)} — {tab.url}" + (" (still loading)." if tab.loading else "."))
        if tab.dialog:
            out.append(f"{_a(tab.dialog.get('type'))} dialog opened: {json.dumps(tab.dialog.get('message', ''))} -- "
                       "answer it with the dialog tool.")
        return mcp.result(" ".join(out))

    def _t_snapshot(self, b: Browser, args: dict) -> dict:
        tab = b.tab()
        cdp = self.chrome.cdp()
        start = None
        if args.get("ref"):
            tab, start, _ = b.resolve(str(args["ref"]))
        nodes = cdp.call("Accessibility.getFullAXTree", {}, tab.session).get("nodes") or []
        lines = _outline(nodes, lambda node: b._ref(tab.target, node), start)
        try:
            pos = cdp.call("Runtime.evaluate", {"returnByValue": True, "expression":
                           "[scrollX, scrollY, innerWidth, innerHeight, document.documentElement.scrollWidth, "
                           "document.documentElement.scrollHeight]"}, tab.session)["result"]["value"]
        except (BrowserError, KeyError, TypeError):
            pos = None
        with b.lock:
            tabs, active = list(b.tabs), b.active
        head = [f"page: {tab.title or '(no title)'} — {tab.url}" + (" (loading)" if tab.loading else "")]
        if len(tabs) > 1:
            head.append("tabs: " + "; ".join(f"{i + 1}{'*' if i == active else ''} {t.title or t.url}"
                                             for i, t in enumerate(tabs)))
        if pos:
            head.append(f"viewport {pos[2]}×{pos[3]}, scrolled to ({pos[0]}, {pos[1]}) of {pos[4]}×{pos[5]}")
        text = "\n".join(head + [""] + lines)
        if len(text) > MAX_SNAPSHOT:
            cut = text[:MAX_SNAPSHOT].rsplit("\n", 1)[0]
            text = cut + f"\n… {text[len(cut):].count(chr(10))} more lines: snapshot a part (`ref`), or scroll"
        return mcp.result(text)

    def _t_click(self, b: Browser, args: dict) -> dict:
        cdp, tab, _, _, label, (x, y) = self._act(b, str(args.get("ref") or ""), "clicking")
        mods = _mods(args.get("modifiers"))
        button = args.get("button") if args.get("button") in ("left", "right", "middle") else "left"
        starts, tabs = tab.starts, len(b.tabs)
        with b.lock:
            b.clicked, b.behind = time.time(), bool(mods & 6) or button == "middle"
        cdp.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y, "modifiers": mods}, tab.session)
        for n in (1, 2) if args.get("double") else (1,):
            for kind in ("mousePressed", "mouseReleased"):
                cdp.call("Input.dispatchMouseEvent", {"type": kind, "x": x, "y": y, "button": button, "clickCount": n,
                                                      "modifiers": mods,
                                                      "buttons": 0 if kind == "mouseReleased" else BUTTONS[button]},
                         tab.session, until=lambda: tab.dialog is not None)
                if tab.dialog:
                    break
        return self._after(b, tab, starts, tabs, f"{'Double-clicked' if args.get('double') else 'Clicked'} {label}.")

    def _t_type(self, b: Browser, args: dict) -> dict:
        text = str(args.get("text") or "")
        cdp, tab, node, obj, label, _ = self._act(b, str(args.get("ref") or ""), "typing into")
        starts, tabs = tab.starts, len(b.tabs)
        cdp.call("DOM.focus", {"backendNodeId": node}, tab.session)
        if not args.get("append"):                     # what is there selected: the text typed takes its place
            had = cdp.call("Runtime.callFunctionOn", {"objectId": obj, "functionDeclaration": CLEAR_JS,
                                                      "returnByValue": True}, tab.session).get("result", {}).get("value")
            if had and not text:
                _press(cdp, tab, "Backspace")
        if text:
            cdp.call("Input.insertText", {"text": text}, tab.session, until=lambda: tab.dialog is not None)
        if args.get("submit") and not tab.dialog:
            _press(cdp, tab, "Enter")
        return self._after(b, tab, starts, tabs, f"Typed {len(text)} characters into {label}"
                           + (", then pressed Enter." if args.get("submit") else "."))

    def _t_press(self, b: Browser, args: dict) -> dict:
        tab = b.tab()
        cdp = self.chrome.cdp()
        if args.get("ref"):
            cdp, tab, node, _, label, _ = self._act(b, str(args["ref"]), f"pressing {args.get('key')} in")
            cdp.call("DOM.focus", {"backendNodeId": node}, tab.session)
        else:
            b.acting_on(f"pressing {args.get('key')}")
        starts, tabs = tab.starts, len(b.tabs)
        _press(cdp, tab, str(args.get("key") or ""))
        return self._after(b, tab, starts, tabs, f"Pressed {args.get('key')}.")

    def _t_select(self, b: Browser, args: dict) -> dict:
        values = [str(v) for v in args.get("values") or []]
        cdp, tab, _, obj, label, _ = self._act(b, str(args.get("ref") or ""), "choosing in")
        got = cdp.call("Runtime.callFunctionOn", {"objectId": obj, "returnByValue": True, "functionDeclaration": SELECT_JS,
                                                  "arguments": [{"value": values}]}, tab.session)["result"].get("value")
        if isinstance(got, str):
            raise BrowserError(f"{label}: {got}")
        return mcp.result(f"Chose {', '.join(json.dumps(v) for v in got)} in {label}.")

    def _t_hover(self, b: Browser, args: dict) -> dict:
        cdp, tab, _, _, label, (x, y) = self._act(b, str(args.get("ref") or ""), "hovering over")
        cdp.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y}, tab.session)
        time.sleep(SETTLE)
        return mcp.result(f"The mouse is over {label}.")

    def _t_scroll(self, b: Browser, args: dict) -> dict:
        tab = b.tab()
        cdp = self.chrome.cdp()
        direction = args.get("direction")
        if args.get("ref") and not direction:
            _, _, _, _, label, _ = self._act(b, str(args["ref"]), "showing")
            return mcp.result(f"{label} is in view.")
        w, h, _ = b.viewport
        x, y = w / 2, h / 2
        if args.get("ref"):
            cdp, tab, _, _, _, (x, y) = self._act(b, str(args["ref"]), "scrolling")
        else:
            b.acting_on(f"scrolling {direction or 'down'}")
        amount = float(args.get("amount") or (h if direction in (None, "up", "down") else w) * 0.8)
        dx, dy = {"up": (0, -amount), "down": (0, amount), "left": (-amount, 0), "right": (amount, 0)}.get(direction or "down")
        cdp.call("Input.dispatchMouseEvent", {"type": "mouseWheel", "x": x, "y": y, "deltaX": dx, "deltaY": dy}, tab.session)
        time.sleep(SETTLE + 0.2)
        pos = cdp.call("Runtime.evaluate", {"returnByValue": True, "expression":
                       "[scrollX, scrollY, document.documentElement.scrollHeight]"}, tab.session)["result"].get("value")
        return mcp.result(f"Scrolled {direction or 'down'}" + (f": the page is at ({pos[0]}, {pos[1]}) of height {pos[2]}." if pos else "."))

    def _t_navigate(self, b: Browser, args: dict) -> dict:
        tab = b.tab()
        url = _url(str(args.get("url") or ""))
        b.acting_on(f"opening {url}")
        starts, tabs = tab.starts, len(b.tabs)
        b.navigate(url, by_user=False)
        return self._after(b, tab, starts, tabs, f"Opened {url}.")

    def _history(self, b: Browser, action: str) -> dict:
        tab = b.tab()
        b.acting_on({"back": "going back", "forward": "going forward", "reload": "reloading"}[action])
        starts, tabs = tab.starts, len(b.tabs)
        b.navigate(action=action, by_user=False)
        return self._after(b, tab, starts, tabs, {"back": "Went back.", "forward": "Went forward.", "reload": "Reloaded."}[action])

    def _t_back(self, b: Browser, args: dict) -> dict:
        return self._history(b, "back")

    def _t_forward(self, b: Browser, args: dict) -> dict:
        return self._history(b, "forward")

    def _t_reload(self, b: Browser, args: dict) -> dict:
        return self._history(b, "reload")

    def _t_tabs(self, b: Browser, args: dict) -> dict:
        action = args.get("action") or "list"
        i = int(args.get("index") or 0) - 1
        if action == "new":
            b.acting_on("opening a new tab")
            tab = b.new_tab(str(args.get("url") or ""))
            if not args.get("url"):
                return mcp.result("Opened a new tab, blank, shown now.")
            return self._after(b, tab, -1, len(b.tabs), "Opened a new tab, shown now.")
        if action == "switch":
            b.switch(i)
        elif action == "close":
            b.close_tab(i)
        with b.lock:
            tabs, active = list(b.tabs), b.active
        listed = "\n".join(f"{n + 1}{' (shown)' if n == active else ''}: {t.title or '(no title)'} — {t.url}"
                           for n, t in enumerate(tabs)) or "no tab is open"
        return mcp.result(listed)

    def _t_screenshot(self, b: Browser, args: dict) -> dict:
        tab = b.tab()
        cdp = self.chrome.cdp()
        w, h, dpr = b.viewport
        params = {"format": "png", "clip": _clip(cdp, tab, 0, 0, w, h, 1 / dpr)}
        what = "the page as shown"
        if args.get("ref"):
            _, tab, _, _, label, _ = self._act(b, str(args["ref"]), "looking at")
            box = b.acting["box"] if b.acting else None
            if box:
                params["clip"] = _clip(cdp, tab, box[0], box[1], max(box[2], 1), max(box[3], 1), 1 / dpr)
            what = label
        elif args.get("full"):
            size = cdp.call("Page.getLayoutMetrics", {}, tab.session).get("cssContentSize") or {}
            params = {"format": "png", "captureBeyondViewport": True, "clip": {
                "x": 0, "y": 0, "width": size.get("width", w), "height": min(size.get("height", h), 12000), "scale": 1 / dpr}}
            what = "the whole page"
        data = cdp.call("Page.captureScreenshot", params, tab.session, timeout=30)["data"]
        if len(data) > 4_000_000:                        # too large a picture for a model: as a JPEG
            params["format"], params["quality"] = "jpeg", 70
            data = cdp.call("Page.captureScreenshot", params, tab.session, timeout=30)["data"]
        kind = "image/jpeg" if params["format"] == "jpeg" else "image/png"
        return {"content": [{"type": "text", "text": f"{what} — {tab.url}"},
                            {"type": "image", "data": data, "mimeType": kind}]}

    def _t_console(self, b: Browser, args: dict) -> dict:
        tab = b.tab()
        lines = list(tab.console)
        if args.get("clear"):
            tab.console.clear()
        return mcp.result("\n".join(lines[-100:]) if lines else "(the console is empty)")

    def _t_evaluate(self, b: Browser, args: dict) -> dict:
        expression = str(args.get("expression") or "")
        tab = b.tab()
        cdp = self.chrome.cdp()
        b.acting_on("running a script")
        if args.get("ref"):
            tab, _, obj = b.resolve(str(args["ref"]))
            got = cdp.call("Runtime.callFunctionOn", {"objectId": obj, "returnByValue": True, "awaitPromise": True,
                                                      "functionDeclaration": "async function () { const el = this; "
                                                      f"return await eval({json.dumps(expression)}); }}"}, tab.session)
        else:                                            # as the console runs it: `await`, `let` again; a promise awaited
            got = cdp.call("Runtime.evaluate", {"expression": expression, "awaitPromise": True, "replMode": True,
                                                "timeout": 15000}, tab.session)
            r = got.get("result") or {}
            if not got.get("exceptionDetails") and r.get("objectId"):
                got = cdp.call("Runtime.awaitPromise", {"promiseObjectId": r["objectId"], "returnByValue": True}, tab.session) \
                    if r.get("subtype") == "promise" else cdp.call("Runtime.callFunctionOn", {
                        "objectId": r["objectId"], "functionDeclaration": "function () { return this; }", "returnByValue": True},
                        tab.session)
        if got.get("exceptionDetails"):
            d = got["exceptionDetails"]
            raise BrowserError(((d.get("exception") or {}).get("description") or d.get("text") or "it threw")[:MAX_EVAL])
        r = got.get("result") or {}
        value = r.get("value") if "value" in r else r.get("description", r.get("type"))
        text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
        return mcp.result(text if len(text) <= MAX_EVAL else text[:MAX_EVAL] + f"… ({len(text)} characters)")

    def _t_wait(self, b: Browser, args: dict) -> dict:
        tab = b.tab()
        cdp = self.chrome.cdp()
        seconds = max(0.0, min(float(args.get("seconds") or (10 if args.get("text") else 1)), 60.0))
        text = args.get("text")
        if not text:
            time.sleep(seconds)
            return mcp.result(f"Waited {seconds:g} s.")
        b.acting_on(f"waiting for {json.dumps(str(text))}")
        end = time.time() + seconds
        while True:
            try:
                got = cdp.call("Runtime.evaluate", {"returnByValue": True, "expression":
                               f"(document.body ? document.body.innerText : '').includes({json.dumps(str(text))})"},
                               tab.session, timeout=5)
                if (got.get("result") or {}).get("value"):
                    return mcp.result(f"{json.dumps(str(text))} shows in the page.")
            except BrowserError:
                pass
            if time.time() >= end:
                raise BrowserError(f"{json.dumps(str(text))} did not show in {seconds:g} s")
            time.sleep(0.3)

    def _t_dialog(self, b: Browser, args: dict) -> dict:
        done = b.answer_dialog(bool(args.get("accept")), args.get("text") if isinstance(args.get("text"), str) else None)
        return mcp.result(done[:1].upper() + done[1:] + ".")

    def _t_upload(self, b: Browser, args: dict) -> dict:
        paths = [os.path.abspath(os.path.expanduser(str(p))) for p in args.get("paths") or []]
        missing = [p for p in paths if not os.path.isfile(p)]
        if missing:
            raise BrowserError(f"no file {missing[0]}")
        cdp, tab, node, _, label, _ = self._act(b, str(args.get("ref") or ""), "giving files to")
        cdp.call("DOM.setFileInputFiles", {"files": paths, "backendNodeId": node}, tab.session)
        return mcp.result(f"Gave {label} {len(paths)} file{'s' if len(paths) != 1 else ''}.")


BUTTONS = {"left": 1, "right": 2, "middle": 4}
CLEAR_JS = r"""function () {
  if (typeof this.select === 'function') return this.select(), !!this.value;
  if (this.isContentEditable) { const r = document.createRange(); r.selectNodeContents(this);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); return !!this.textContent; }
  return false;
}"""
SELECT_JS = r"""function (values) {
  if (this.localName !== 'select') return 'not a <select>';
  const chosen = [];
  for (const o of this.options) {
    const on = values.includes(o.value) || values.includes(o.label) || values.includes(o.text.trim());
    if (on) chosen.push(o.label || o.value);
    if (this.multiple) o.selected = on; else if (on && !chosen.slice(1).length) o.selected = true;
  }
  if (!chosen.length) return 'no option ' + JSON.stringify(values) + ': it has ' + JSON.stringify([...this.options].map((o) => o.label || o.value).slice(0, 30));
  this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true }));
  return chosen;
}"""


def _mods(names) -> int:
    return sum({1: 1, 2: 2, 4: 4, 8: 8}.get(MODIFIERS.get(str(n).lower(), 0), 0) for n in (names or []))


def _press(cdp: Cdp, tab: Tab, combo: str) -> None:
    """A key, or a combination ("Meta+a", "Shift+Tab"), pressed and let go."""
    parts = [p for p in re.split(r"\+(?!$)", combo.strip()) if p]
    if not parts:
        raise BrowserError("which key?")
    *held, key = parts
    mods = 0
    for m in held:
        if m.lower() not in MODIFIERS:
            raise BrowserError(f"no modifier {m}: one of Alt, Control, Meta, Shift")
        mods |= MODIFIERS[m.lower()]
    if key in ("Space", "space"):
        key = " "
    if key not in KEYS and len(key) != 1:
        found = next((k for k in KEYS if k.lower() == key.lower()), None)
        if found is None:
            raise BrowserError(f"no key {key}")
        key = found
    code, vk = KEYS.get(key, (None, 0))
    if len(key) == 1:
        up = key.upper()
        code = code or (f"Key{up}" if up.isalpha() else f"Digit{key}" if key.isdigit() else "")
        vk = vk or (ord(up) if up.isalnum() else 0)
    if mods & 8 and len(key) == 1:
        key = key.upper()
    e = {"key": key, "code": code or "", "keyCode": vk}
    for down in (True, False):
        p = _key_event(e, down, mods)
        if p is not None:
            cdp.call("Input.dispatchKeyEvent", p, tab.session, until=lambda: tab.dialog is not None)
            if tab.dialog:
                return


SKIP_ROLES = {"generic", "none", "presentation", "InlineTextBox", "LineBreak", "LayoutTable", "LayoutTableRow",
              "LayoutTableCell", "group", "LabelText", "MenuListPopup"}
FIELDS = {"textbox", "searchbox", "combobox", "spinbutton", "slider"}   # their text is their value, said once
STATES = ("checked", "selected", "expanded", "pressed", "disabled", "required", "focused", "invalid", "readonly",
          "level", "modal", "multiselectable")


def _outline(nodes: list, ref: Callable[[int], str], start: Optional[int] = None) -> List[str]:
    """Chrome's accessibility tree as an outline: one line per element worth naming (its role, name, value and state,
    and a ref), the text of the page as text lines; nameless wrappers and what Chrome ignores left out, their insides
    kept."""
    by_id = {n["nodeId"]: n for n in nodes if "nodeId" in n}
    root = None
    if start is not None:
        root = next((n for n in nodes if n.get("backendDOMNodeId") == start), None)
    if root is None:
        root = next((n for n in nodes if not n.get("parentId")), nodes[0] if nodes else None)
    out: List[str] = []
    if root is None:
        return out

    def val(x):
        return (x or {}).get("value")

    def flat(n: dict) -> List[dict]:
        """The nodes shown in n's place: n, or -- a wrapper -- what it holds."""
        role, name = val(n.get("role")) or "", (val(n.get("name")) or "").strip()
        if n.get("ignored") or (role in SKIP_ROLES and not name) or role == "RootWebArea":
            return [x for c in n.get("childIds") or [] if c in by_id for x in flat(by_id[c])]
        return [n]

    def walk(n: dict, depth: int, parent_name: str, near: frozenset = frozenset()) -> None:
        role, name = val(n.get("role")) or "", (val(n.get("name")) or "").strip()
        if role == "StaticText":
            text = " ".join(name.split())
            if text and text not in parent_name and text not in near:
                out.append("  " * depth + f"- text: {json.dumps(text[:300], ensure_ascii=False)}")
            return
        line = "  " * depth + f"- {role}"
        if name:
            line += " " + json.dumps(" ".join(name.split())[:200], ensure_ascii=False)
        node = n.get("backendDOMNodeId")
        if node:
            line += f" [{ref(node)}]"
        props = {p["name"]: val(p.get("value")) for p in n.get("properties") or [] if "name" in p}
        states = [f"{k}={props[k]}" if k == "level" else k for k in STATES if props.get(k) not in (None, False, "false", "")]
        if states:
            line += " (" + ", ".join(states) + ")"
        v = val(n.get("value"))
        if v not in (None, "") and role not in ("link",):
            line += f": {json.dumps(str(v)[:200], ensure_ascii=False)}"
        out.append(line)
        if role not in FIELDS:
            shown = [x for c in n.get("childIds") or [] if c in by_id for x in flat(by_id[c])]
            names = frozenset(" ".join((val(x.get("name")) or "").split()) for x in shown if val(x.get("role")) != "StaticText")
            for k in shown:
                walk(k, depth + 1, name, names)

    shown = flat(root)
    names = frozenset(" ".join((val(x.get("name")) or "").split()) for x in shown if val(x.get("role")) != "StaticText")
    for k in shown:
        walk(k, 0, "", names)
    return out
