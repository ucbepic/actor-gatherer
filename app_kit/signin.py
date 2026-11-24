"""A site signed in to in a Chrome window of its own, for an app that reads the site as the user (the LaTeX editor's
Overleaf history): the window opened at the site's sign-in page, with a profile of the app's (kept, so the site may
remember the user next time); the user signs in there however the site lets them (a password, Google, their
institution); the window's cookies read as they do, through Chrome's DevTools pipe (`Storage.getCookies`), until the
app's `check` finds the sign-in in them; then the window closed. Nothing is typed or read in the page itself.

    SignIn(url, profile, check)   started: `state` "open" while the window is; then "done" (`got`: what `check`
                                  returned), "closed" (the user closed the window), "failed" (`error`) or "timeout"
    executable()                  the Chrome it runs: Chrome, Chromium, Edge or Brave where the system keeps them

`check(cookies)` is called with the window's cookies (DevTools' shape: {name, value, domain, ...}) each time those of
the site's domain change: whatever it returns, not None, is the sign-in (it may ask the site to be sure: it runs on
the SignIn's own thread). Standard library only."""

import json
import os
import shutil
import subprocess
import sys
import threading
import time
from typing import Any, Callable, List, Optional

APPS = ["Google Chrome.app/Contents/MacOS/Google Chrome", "Chromium.app/Contents/MacOS/Chromium",
        "Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "Brave Browser.app/Contents/MacOS/Brave Browser"]
COMMANDS = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"]
#: Not headless, a window of its own; navigator.webdriver false (Google's sign-in refuses a browser that says it is
#: driven); no keychain asked for its cookies' key (macOS would ask the user to let it).
ARGS = ["--remote-debugging-pipe", "--no-first-run", "--no-default-browser-check", "--use-mock-keychain",
        "--password-store=basic", "--disable-blink-features=AutomationControlled", "--window-size=560,760"]
EVERY = 1.0                 # seconds between looks at the window's cookies
TIMEOUT = 900.0             # seconds the window is left open for a sign-in
CALL_WAIT = 10.0            # the most a DevTools call is waited for


def executable() -> Optional[str]:
    """The Chrome a SignIn runs: where macOS keeps one, else one on the PATH; None, none here."""
    if sys.platform == "darwin":
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


class SignInError(RuntimeError):
    """Why the window could not be opened: no Chrome, or it would not start."""


class _Pipe:
    """Chrome's DevTools pipe: JSON messages, each ended by a NUL -- written to its fd 3, read from its fd 4."""

    def __init__(self, write_fd: int, read_fd: int):
        self.w, self.r = os.fdopen(write_fd, "wb", buffering=0), os.fdopen(read_fd, "rb", buffering=0)
        self.n, self.buf, self.lock = 0, b"", threading.Lock()

    def call(self, method: str, params: Optional[dict] = None) -> dict:
        """`method`'s result (its error raised), the events read meanwhile let go."""
        with self.lock:
            self.n += 1
            n = self.n
            self.w.write(json.dumps({"id": n, "method": method, "params": params or {}}).encode() + b"\0")
            deadline = time.time() + CALL_WAIT
            while time.time() < deadline:
                while b"\0" not in self.buf:
                    got = self.r.read(65536)
                    if not got:
                        raise EOFError("Chrome went")
                    self.buf += got
                raw, self.buf = self.buf.split(b"\0", 1)
                msg = json.loads(raw)
                if msg.get("id") == n:
                    if "error" in msg:
                        raise RuntimeError(f"{method}: {msg['error'].get('message')}")
                    return msg.get("result") or {}
            raise TimeoutError(method)

    def close(self) -> None:
        for f in (self.w, self.r):
            try:
                f.close()
            except OSError:
                pass


#: Run as `python -c PLACE_PIPES R W exe args...`: fds R and W, passed as they are, become 3 and 4 -- where Chrome's
#: --remote-debugging-pipe reads and writes -- and exe runs with them (as the Browser app starts its Chrome). Each is
#: copied above 9 first, so neither is overwritten by the other moved to 3 or 4.
PLACE_PIPES = ("import fcntl, os, sys; r, w = (int(a) for a in sys.argv[1:3]); "
               "hi = [fcntl.fcntl(f, fcntl.F_DUPFD, 10) for f in (r, w)]; "
               "[os.close(f) for f in {r, w}]; os.dup2(hi[0], 3); os.dup2(hi[1], 4); [os.close(f) for f in hi]; "
               "os.execvp(sys.argv[3], sys.argv[3:])")


def _spawn(exe: str, args: List[str], env: dict) -> "tuple[subprocess.Popen, _Pipe]":
    """Chrome started with its DevTools pipe on its fds 3 (it reads) and 4 (it writes)."""
    to_chrome, from_chrome = os.pipe(), os.pipe()
    try:
        proc = subprocess.Popen([sys.executable, "-c", PLACE_PIPES, str(to_chrome[0]), str(from_chrome[1]), exe, *args],
                                env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, pass_fds=(to_chrome[0], from_chrome[1]),
                                start_new_session=True)
    except OSError as exc:
        for f in (*to_chrome, *from_chrome):
            os.close(f)
        raise SignInError(f"Chrome would not start: {exc}") from None
    os.close(to_chrome[0])
    os.close(from_chrome[1])
    return proc, _Pipe(to_chrome[1], from_chrome[0])


class SignIn:
    def __init__(self, url: str, profile: str, check: Callable[[List[dict]], Any], domain: str = "",
                 exe: Optional[str] = None, timeout: float = TIMEOUT, env: Optional[dict] = None,
                 args: List[str] = ()):
        self.url, self.profile, self.check, self.timeout, self.args = url, profile, check, timeout, list(args)
        self.domain = domain or url.split("//", 1)[-1].split("/", 1)[0].split(":", 1)[0]
        self.exe = exe or executable()
        self.env = env if env is not None else dict(os.environ)
        self.state, self.error, self.got, self.started = "open", "", None, time.time()
        self._stop = threading.Event()
        self.proc: Optional[subprocess.Popen] = None
        self.pipe: Optional[_Pipe] = None

    def start(self) -> "SignIn":
        """The window opened (SignInError: it could not be), and watched on a thread of its own."""
        if not self.exe:
            raise SignInError("No Chrome to sign in with: install Google Chrome (or Chromium, Edge, Brave)")
        os.makedirs(self.profile, mode=0o700, exist_ok=True)
        self.proc, self.pipe = _spawn(self.exe, [f"--user-data-dir={self.profile}", *ARGS, *self.args, "--new-window",
                                                 self.url],
                                      self.env)
        threading.Thread(target=self._watch, name="signin", daemon=True).start()
        return self

    def _mine(self, c: dict) -> bool:
        d = (c.get("domain") or "").lstrip(".")
        return d == self.domain or self.domain.endswith("." + d) or d.endswith("." + self.domain)

    def _watch(self) -> None:
        seen = None
        try:
            while not self._stop.is_set():
                if time.time() - self.started > self.timeout:
                    self.state = "timeout"
                    break
                if self.proc.poll() is not None:
                    self.state = "closed"
                    break
                try:
                    pages = [t for t in self.pipe.call("Target.getTargets").get("targetInfos", [])
                             if t.get("type") == "page"]
                    cookies = [c for c in self.pipe.call("Storage.getCookies").get("cookies", []) if self._mine(c)]
                except (EOFError, OSError, ValueError):
                    self.state = "closed"            # Chrome quit (the user did)
                    break
                if not pages:                        # its window closed (macOS keeps Chrome running with none)
                    self.state = "closed"
                    break
                now = sorted((c.get("name"), c.get("value")) for c in cookies)
                if now != seen:
                    seen = now
                    got = self.check(cookies)
                    if got is not None:
                        self.got, self.state = got, "done"
                        break
                self._stop.wait(EVERY)
        except Exception as exc:                     # noqa: BLE001 - said, not raised on a thread nobody reads
            self.state, self.error = "failed", str(exc)
        finally:
            if self.state == "open":
                self.state = "closed"
            self._quit()

    def close(self) -> None:
        """Given up on: the window closed."""
        self._stop.set()
        if self.state == "open":
            self.state = "closed"
        self._quit()

    def _quit(self) -> None:
        proc, pipe = self.proc, self.pipe
        if proc is None:
            return
        try:
            if proc.poll() is None and pipe is not None:
                pipe.call("Browser.close")
        except Exception:                            # noqa: BLE001 - going anyway
            pass
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()
        if pipe is not None:
            pipe.close()

    def view(self) -> dict:
        """What the panel is told: its state, and why it failed."""
        return {"state": self.state, **({"error": self.error} if self.error else {})}
