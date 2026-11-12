"""The Browser's backend (app.toml): its instances, the agent's tools, its panel's requests, what its agent is told,
and the ag app's link -- the app's side of what core.py does (module doc there).

    BrowserApp   the App the host runs: an instance is a Browser (its key the instance's id, its folder the agent's);
                 a tool call run by core.py's Browsers; a request of its panel (on the app's own origin) answered by
                 its Browser; what the user did there told the attached agents as context_stream events in their
                 channels; their next message to it seen (`_seen`: picks put away, a stop lifted); the ag app's link
                 (`native`) handed to the Chrome, the app's pages its own

What it keeps is in its own database, in its data folder (browser.db): each Browser's tabs, and the pages the Browsers
went to (visited.py). A home whose dashboard had Browsers has them in dashboard.db (its table `browser`): copied here
once, the first time (`_import`), and left there; and their Chrome's history, its pages added once too (`_seed`).
The Chrome's profile, downloads and uploads stay where the dashboard kept them, in <home>/dashboard/.

Its panel's requests (under /api/w/<gatherer>/<instance>/ on its origin):

    GET  stream?video=&page=&hidden=&native=   server-sent events: `state` as it changes, `frame` / `video` its screen
    POST input {events}, nav {url | action}, resize {width, height, dpr}, hover {x, y}, mode {mode}, pick {x, y | box},
         unpick {id}, dialog {accept, text}, copy {cut}, choose {n, index, value}, find {q, back, again},
         file {name, data}, chosen {n, ids}, drop {x, y, ids}, reveal {i}, tab {action, index, url}, stop, watch
         {page, visible}, where {i}
    POST scheme {scheme}     the dashboard's theme, light or dark: every Browser's pages shown in it
    GET  logins / POST logins {sites}   the user's Chrome's sites with logins / those copied into the Browsers' Chrome
    GET  visited?q= / POST visited {forget}   the pages to suggest for what is typed in the address bar, {pages: [{url,
         title}]} (visited.py: every Browser's) / one of them forgotten
"""

import json
import os
import sqlite3
import threading
from typing import Callable, Dict, List, Optional, Tuple

from app_kit import App, AppError, Caller, Host, Instance, Response, ToolResult, context_stream

from . import core, visited

STREAM = "Browser"              # the context stream what the user did is told in, as its agent sees it named
SEEN_EVERY = 3.0                # seconds between looks for the user's next message, while a Browser waits on one
IMPORTED = "imported:dashboard.db"
SEEDED = "seeded:chrome history"
BODY_POSTS = {"input", "nav", "resize", "hover", "mode", "pick", "unpick", "dialog", "copy", "choose", "find", "file",
              "chosen", "drop", "reveal", "tab", "stop", "watch", "where", "open"}


class BrowserApp(App):
    def start(self, host: Host) -> None:
        self.host = host
        data = host.folder()
        core.DB_PATH = os.path.join(data, "browser.db")
        core.HOME = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(data))))   # <home>/apps/<app>/data
        _import(os.path.join(core.HOME, "dashboard.db"))
        _seed(core.profile_dir())
        self.lock = threading.Lock()
        self.by_key: Dict[str, Instance] = {}
        self.seen: Dict[Tuple[str, str], int] = {}       # (key, channel) -> the last row of the agent's read for messages
        self.bs = core.Browsers(self._tell)
        for i in host.instances():
            self._keep(i)
        self.stopped = threading.Event()
        threading.Thread(target=self._watch, name="ag-browser-seen", daemon=True).start()

    def stop(self) -> None:
        self.stopped.set()
        self.bs.close()

    # -- instances

    def _keep(self, instance: Instance) -> None:
        with self.lock:
            self.by_key[instance.id] = instance
        self.bs.keep(instance.id, instance.folder or "", instance.gatherer)

    def _instance(self, key: str) -> Optional[Instance]:
        with self.lock:
            return self.by_key.get(key)

    def open(self, instance: Instance, args: dict) -> Instance:
        if not core.available():
            raise AppError("no Chrome here: install Google Chrome (or Chromium), or name one in config.toml's "
                           "[dashboard] browser", 409)
        folder = instance.folder or ""
        if folder and not os.path.isdir(folder):
            raise AppError(f"no directory {folder}")
        self._keep(instance)
        return Instance(id=instance.id, app=instance.app, gatherer=instance.gatherer, folder=instance.folder,
                        title=os.path.basename(folder.rstrip("/")) or "Browser", data=dict(instance.data))

    def close(self, instance: Instance) -> None:
        with self.lock:
            self.by_key.pop(instance.id, None)

    def sleep(self, instance: Instance) -> None:
        """Its task closed: its tabs closed, their pages kept, opened again as they were on its next use."""
        self.bs.sleep(instance.id)

    # -- the agent's tools

    def call(self, instance: Instance, tool: str, args: dict, caller: Caller) -> ToolResult:
        if instance.id not in self.by_key:
            self._keep(instance)
        self._seen(instance)                             # its next message seen first: a stop it lifts, lifted
        return ToolResult.from_dict(self.bs.call(instance.id, tool, args))

    # -- what its agent is told, and its next message

    def _tell(self, key: str, text: str) -> None:
        """What the user did in Browser `key`, told each agent attached to it, in its channel."""
        i = self._instance(key)
        if i is None:
            return
        for channel in self.host.attached(i):
            self.host.insert(i, [context_stream(STREAM, "the user", text)], channel=channel)

    def _seen(self, instance: Instance) -> None:
        """The user's message to an agent attached to the Browser, since it last looked: the Browser's `sent`."""
        try:
            b = self.bs.open.get(instance.id)
        except AttributeError:
            return
        if b is None:
            return
        new = False
        for channel in self.host.attached(instance):
            mark = self.seen.get((instance.id, channel))
            last = self._last_message(instance, channel, mark or 0)
            if mark is not None and last > mark:
                new = True
            self.seen[(instance.id, channel)] = max(last, mark or 0)
        if new and (b.picks or b.halt.is_set()):
            b.sent()

    def _last_message(self, instance: Instance, channel: str, after: int) -> int:
        """The row of the agent's latest message from the user after row `after` (`after` when none)."""
        last = after
        while True:
            got = self.host.read(instance, ["user_message"], after=last, channel=channel, limit=500)
            if not got:
                return last
            last = max(e["row_id"] for e in got)
            if len(got) < 500:
                return last

    def _watch(self) -> None:
        """Each Browser in use looked at every SEEN_EVERY: where its agents' messages are now (so a message after the
        user's Esc is one after it), and, one waiting on the next (a pick shown, a stop to lift), whether it came."""
        while not self.stopped.wait(SEEN_EVERY):
            for key in list(self.bs.open):
                i = self._instance(key)
                if i is not None:
                    try:
                        self._seen(i)
                    except Exception:  # noqa: BLE001 - looked at again next time
                        pass

    # -- the ag app's link

    def native(self, send: Callable[[str], None], close: Callable[[], None]):
        return self.bs.chrome.attach_app(send, close).got

    # -- its panel's requests

    def request(self, instance: Optional[Instance], method: str, path: str, query: Dict[str, str],
                body: bytes) -> Response:
        try:
            if path == "scheme" and method == "POST":
                return Response.json(self.bs.set_scheme(str(_body(body).get("scheme") or "")))
            if path == "logins":
                if method == "POST":
                    return Response.json(self.bs.import_logins(_body(body).get("sites") or []))
                return Response.json(self.bs.login_sites())
            if path == "visited":
                if method == "POST":
                    url = str(_body(body).get("forget") or "")
                    core.in_db(lambda conn: visited.forget(conn, url))
                    return Response.json({})
                q = str(query.get("q") or "")[:visited.LONGEST]
                return Response.json({"pages": core.in_db(lambda conn: visited.suggest(conn, q))})
            if instance is None:
                return _error(404, "which Browser? (its gatherer and instance)")
            if instance.id not in self.by_key:
                self._keep(instance)
            b = self.bs.get(instance.id)
            if path == "stream" and method == "GET":
                viewer = b.join(query.get("video") == "1", str(query.get("page") or "")[:64],
                                query.get("hidden") != "1", query.get("native") == "1")
                return Response.stream(viewer.take, lambda: b.leave(viewer))
            if path == "config" and method == "GET":
                return Response.json(self.bs.config(instance.id))
            if method != "POST" or path not in BODY_POSTS:
                return _error(404, "not found")
            return Response.json(_post(b, path, _body(body)))
        except core.BrowserError as exc:
            return _error(getattr(exc, "status", 400), str(exc))
        except (ValueError, TypeError, OSError) as exc:
            return _error(400, f"{type(exc).__name__}: {exc}")


def _post(b: "core.Browser", what: str, body: dict):
    """One of the panel's POSTs, as the dashboard's routes answered them (api/browser.py before)."""
    num = lambda k: None if body.get(k) is None else float(body[k])   # noqa: E731
    ids = body.get("ids") if isinstance(body.get("ids"), list) else []
    if what == "input":
        return b.input(body.get("events") if isinstance(body.get("events"), list) else [])
    if what == "nav":
        return {"done": b.navigate(str(body.get("url") or ""), str(body.get("action") or ""))}
    if what == "open":                                   # a link clicked in the dashboard (the open-url intent)
        return {"done": b.open_link(str(body.get("url") or ""))}
    if what == "resize":
        b.resize(int(body.get("width") or 0), int(body.get("height") or 0), float(body.get("dpr") or 1))
    elif what == "hover":
        b.hover(num("x"), num("y"))
    elif what == "mode":
        b.set_mode(body.get("mode") if isinstance(body.get("mode"), str) else None)
    elif what == "pick":
        box = body.get("box")
        return b.pick(num("x"), num("y"), box if isinstance(box, list) and len(box) == 4 else None)
    elif what == "unpick":
        b.unpick(str(body.get("id") or ""))
    elif what == "dialog":
        return {"done": b.answer_dialog(bool(body.get("accept")),
                                        body.get("text") if isinstance(body.get("text"), str) else None)}
    elif what == "copy":
        return b.copy(bool(body.get("cut")))
    elif what == "choose":
        b.choose(int(body.get("n") or 0), None if body.get("index") is None else int(body["index"]),
                 None if body.get("value") is None else str(body["value"]))
    elif what == "find":
        return b.find(str(body.get("q") or ""), bool(body.get("back")), bool(body.get("again")))
    elif what == "file":
        return {"id": b.upload(str(body.get("name") or ""), str(body.get("data") or ""))}
    elif what == "chosen":
        return {"given": b.chosen(int(body.get("n") or 0), ids)}
    elif what == "drop":
        return {"given": b.drop(num("x") or 0.0, num("y") or 0.0, ids)}
    elif what == "reveal":
        b.reveal(int(body.get("i") or 0))
    elif what == "tab":
        action, i = str(body.get("action") or ""), int(body.get("index") or 0)
        if action == "switch":
            b.switch(i)
        elif action == "close":
            b.close_tab(i)
        elif action == "new":
            b.new_tab(str(body.get("url") or ""))
        elif action == "reopen":
            b.reopen_tab()
        elif action == "move":
            b.move_tab(i, int(body.get("to") or 0))
        elif action == "mute":
            return {"muted": b.mute(None if body.get("index") is None else i, bool(body.get("muted")))}
        elif action == "zoom":
            return {"zoom": b.zoom(None if body.get("index") is None else i, int(body.get("step") or 0))}
        else:
            raise core.BrowserError("switch, close, new, reopen, move, mute or zoom")
    elif what == "stop":
        b.stop()
    elif what == "watch":
        b.watch(str(body.get("page") or "")[:64], bool(body.get("visible")))
    elif what == "where":
        return {"box": b.where(int(body.get("i") or 0))}
    return {}


def _body(body: bytes) -> dict:
    try:
        got = json.loads(body or b"{}")
    except ValueError:
        raise core.BrowserError("a JSON body, please") from None
    if not isinstance(got, dict):
        raise core.BrowserError("a JSON object, please")
    return got


def _error(status: int, text: str) -> Response:
    return Response.json({"error": text}, status)


def _import(old: str) -> None:
    """The Browsers the dashboard kept before it was an app (dashboard.db's `browser`: their tabs), copied into the
    app's own database once: what is here already wins."""
    conn = core._db()
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS kept (name TEXT PRIMARY KEY)")
        if conn.execute("SELECT 1 FROM kept WHERE name = ?", (IMPORTED,)).fetchone():
            return
        if os.path.isfile(old):
            src = sqlite3.connect(f"file:{old}?mode=ro", uri=True, timeout=8)
            try:
                if src.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'browser'").fetchone():
                    cols = [r[1] for r in src.execute("PRAGMA table_info(browser)")]
                    want = [c for c in ("key", "gatherer", "root", "session_id", "created_at", "tabs", "active", "named")
                            if c in cols]
                    for row in src.execute(f"SELECT {', '.join(want)} FROM browser"):
                        conn.execute(f"INSERT OR IGNORE INTO browser ({', '.join(want)}) VALUES "
                                     f"({', '.join('?' for _ in want)})", row)
            finally:
                src.close()
        conn.execute("INSERT OR IGNORE INTO kept (name) VALUES (?)", (IMPORTED,))
    finally:
        conn.close()


def _seed(profile: str) -> None:
    """The pages in the Browsers' Chrome's own history (its profile's), added once to those the address bar suggests:
    a home whose Browsers ran before they were kept here has them from the start. Not the user's own Chrome's."""
    conn = core._db()
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS kept (name TEXT PRIMARY KEY)")
        if conn.execute("SELECT 1 FROM kept WHERE name = ?", (SEEDED,)).fetchone():
            return
        try:
            visited.seed(conn, profile)
        except (OSError, sqlite3.Error):
            return                                       # (tried again next time)
        conn.execute("INSERT OR IGNORE INTO kept (name) VALUES (?)", (SEEDED,))
    finally:
        conn.close()
