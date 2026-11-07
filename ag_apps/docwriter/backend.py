"""DocWriter's backend (app.toml): its instances, its page's requests, its records, its guard on the agent's own edits
-- the app's side of what core.py does (module doc there).

    DocWriterApp   the App the host runs: an instance is a DocWriter (its key the instance's id, its folder the
                   workspace); a request of its page (its panel, on the app's own origin) answered by core.py's
                   DocWriters; the author's records inserted as the app's events, in the agent's channel; an edit of
                   a file open in it, by the agent's own tools, refused (`guard`: the host's edit_guard)

What it keeps is in its own database, in its data folder (docwriter.db): the documents' state and what each DocWriter
and folder keeps. A home that had DocWriter in its dashboard has those in dashboard.db: copied here once, the first time
(`_import`), and left there.

Its page's requests (core.py's routes, under /api/w/<gatherer>/<instance>/ on its origin):

    GET  dw                  its settings: its folder, its agent's channel, ...
    GET  kv?names=[...]      what it keeps; POST kv {set}
    POST page/join {conn}    a page there; page/alive {conn} every 10 s (-> {alive}); page/leave {conn}
    POST doc/join|leave|update|save {conn, tab, ...}   a document shared with the other pages
    POST record {type, payload}                         what the author did: a record
    POST fs {op, ...}        its server code's file calls
    GET  api/preview?path    a file it previews; GET|POST|PUT|DELETE api/<route>: DocWriter's own /api
    GET  preview?...         its preview page (panel/preview.html)
"""

import base64
import json
import os
import sqlite3
import threading
from typing import Dict, Optional

from app_kit import App, AppError, Caller, Host, Instance, Response

from . import core

HERE = os.path.dirname(os.path.abspath(__file__))
PANEL = os.path.join(HERE, "panel")
SWEEP = 10.0                    # seconds between looks for pages gone without saying so
IMPORTED = "imported:dashboard.db"


class DocWriterApp(App):
    def start(self, host: Host) -> None:
        self.host = host
        data = host.folder()
        core.DB_PATH = os.path.join(data, "docwriter.db")
        home = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(data))))   # <home>/apps/<app>/data
        core.CONFIG = os.path.join(home, "config.toml")
        _import(os.path.join(home, "dashboard.db"))
        self.lock = threading.Lock()
        self.by_key: Dict[str, Instance] = {}
        self.dw = core.DocWriters(self._tell, self._record)
        for i in host.instances():
            self._keep(i)
        self.stopped = threading.Event()
        threading.Thread(target=self._sweep, name="ag-docwriter-sweep", daemon=True).start()

    def stop(self) -> None:
        self.stopped.set()
        self.dw.close()

    # -- instances and agents

    def _keep(self, instance: Instance, known: bool = True) -> None:
        """An instance kept: its agent the first attached to it, for one the host has already (not one it is opening)."""
        with self.lock:
            self.by_key[instance.id] = instance
        channels = self.host.attached(instance) if known else []
        self.dw.keep(instance.id, instance.folder or "", instance.gatherer, channels[0] if channels else "")

    def open(self, instance: Instance, args: dict) -> Instance:
        if not core.AVAILABLE:
            raise AppError("DocWriter needs pycrdt where the dashboard runs: pip install pycrdt, then restart it", 503)
        folder = instance.folder or ""
        if not os.path.isdir(folder):
            raise AppError(f"no directory {folder or '(none)'}: DocWriter works in a folder")
        self._keep(instance, known=False)
        return Instance(id=instance.id, app=instance.app, gatherer=instance.gatherer, folder=instance.folder,
                        title=os.path.basename(folder.rstrip("/")) or folder, data=dict(instance.data))

    def close(self, instance: Instance) -> None:
        with self.lock:
            self.by_key.pop(instance.id, None)

    def attached(self, instance: Instance, channel: str) -> None:
        with self.lock:
            known = instance.id in self.by_key
        if not known:
            self._keep(instance)
        self.dw.attach(instance.id, channel)

    def guard(self, instance: Instance, path: str, caller: Caller) -> Optional[str]:
        try:
            return self.dw.guard(instance.id, path)
        except core.DocWriterError:
            return None

    # -- what it tells its panels, and records

    def _instance(self, key: str) -> Optional[Instance]:
        with self.lock:
            return self.by_key.get(key)

    def _tell(self, key: str, message: dict) -> None:
        i = self._instance(key)
        if i is not None:
            self.host.tell_panel(i, message)

    def _record(self, key: str, kind: str, payload: dict) -> None:
        i = self._instance(key)
        if i is None:
            return
        channel = self.dw.row(key).get("channel") or None
        if channel and channel not in self.host.attached(i):
            channel = None
        self.host.insert(i, [{"type": f"docwriter.{kind}", "payload": payload}], channel=channel)

    def _sweep(self) -> None:
        while not self.stopped.wait(SWEEP):
            try:
                self.dw.sweep()
            except Exception:  # noqa: BLE001 - the next look tries again
                pass

    # -- its page's requests

    def request(self, instance: Optional[Instance], method: str, path: str, query: Dict[str, str],
                body: bytes) -> Response:
        if instance is None:
            return _error(404, "which DocWriter? (its gatherer and instance)")
        key = instance.id
        if key not in self.by_key:
            self._keep(instance)
        try:
            if path == "preview" and method == "GET":
                return _file(os.path.join(PANEL, "preview.html"))
            if path == "api/preview" and method == "GET":
                got, kind = self.dw.preview(key, query.get("path", ""))
                return Response(200, got, {"content-type": kind, "x-content-type-options": "nosniff"})
            if path.startswith("api/"):
                status, value = self.dw.api(key, method, path[len("api/"):], query,
                                            _json(body) if method != "GET" else None)
                return Response.json(value, status)
            if method == "GET":
                if path == "dw":
                    return Response.json(self.dw.config(key))
                if path == "kv":
                    return Response.json(self.dw.kv(key, [str(n) for n in json.loads(query.get("names") or "[]")]))
                return _error(404, "not found")
            b = _json(body)
            if not isinstance(b, dict):
                return _error(400, "a JSON object, please")
            conn = str(b.get("conn") or "")
            if path == "page/join":
                self.dw.join_page(key, conn)
                return Response.json({})
            if path == "page/alive":
                return Response.json({"alive": self.dw.alive(key, conn)})
            if path == "page/leave":
                self.dw.leave_page(key, conn)
                return Response.json({})
            if path == "doc/join":
                return Response.json(self.dw.join_doc(key, conn, str(b.get("tab") or "")))
            if path == "doc/leave":
                self.dw.leave_doc(key, conn, str(b.get("tab") or ""))
                return Response.json({})
            if path == "doc/update":
                self.dw.edit_doc(key, str(b.get("tab") or ""), conn,
                                 base64.b64decode(str(b.get("update") or ""), validate=True))
                return Response.json({})
            if path == "doc/save":
                return Response.json(self.dw.save_doc(key, str(b.get("tab") or ""), conn, str(b.get("text") or "")))
            if path == "kv":
                self.dw.kv_set(key, b.get("set") if isinstance(b.get("set"), dict) else {})
                return Response.json({})
            if path == "record":
                self.dw.record(key, str(b.get("type") or ""), b.get("payload"))
                return Response.json({})
            if path == "fs":
                return Response.json(self.dw.fs(key, b))
            return _error(404, "not found")
        except core.DocWriterError as exc:
            return _error(exc.status, str(exc))
        except (ValueError, OSError) as exc:
            return _error(400, f"{type(exc).__name__}: {exc}")


def _json(body: bytes):
    try:
        return json.loads(body or b"{}")
    except ValueError:
        raise core.DocWriterError("a JSON body, please") from None


def _error(status: int, text: str) -> Response:
    return Response.json({"error": text}, status)


def _file(path: str) -> Response:
    try:
        with open(path, "rb") as fh:
            return Response(200, fh.read(), {"content-type": "text/html; charset=utf-8"})
    except OSError:
        return _error(404, "DocWriter's page is not built here")


def _import(old: str) -> None:
    """What DocWriter kept in the dashboard's own database before it was an app (dashboard.db's docwriter_docs and
    docwriter_kv), copied into its own once: what is here already wins."""
    conn = core._db()
    try:
        if conn.execute("SELECT 1 FROM docwriter_kv WHERE scope = '*' AND name = ?", (IMPORTED,)).fetchone():
            return
        if os.path.isfile(old):
            src = sqlite3.connect(f"file:{old}?mode=ro", uri=True, timeout=8)
            try:
                tables = {r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
                if "docwriter_docs" in tables:
                    for row in src.execute("SELECT path, state, disk, at FROM docwriter_docs"):
                        conn.execute("INSERT OR IGNORE INTO docwriter_docs (path, state, disk, at) VALUES (?, ?, ?, ?)", row)
                if "docwriter_kv" in tables:
                    for row in src.execute("SELECT scope, name, value FROM docwriter_kv WHERE scope != '*'"):
                        conn.execute("INSERT OR IGNORE INTO docwriter_kv (scope, name, value) VALUES (?, ?, ?)", row)
            finally:
                src.close()
        conn.execute("INSERT OR IGNORE INTO docwriter_kv (scope, name, value) VALUES ('*', ?, '1')", (IMPORTED,))
    finally:
        conn.close()
