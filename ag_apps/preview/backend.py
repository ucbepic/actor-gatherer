"""The Preview app (app.toml): a git project's preview -- a command run in the checkout of a file, and what it makes:
a file it writes, the page of a server it starts, or its output -- set by the user in its panel or by an agent with
its tools (or `ag preview`), run by either, shown in its panel.

What it keeps, as its events (the instance's: one per repository, its worktrees sharing it):

    preview.set      {command, show, by}: the project's preview, set by the user (by "") or an agent (its channel)
    preview.allowed  {command}: a command an agent set, let run by the user
    preview.cleared  {}: no preview any more
    preview.ran      {checkout, command, show, by, file, state, code, started, ended}: a run, once over

Who may run what: the user, anything -- a command an agent set, once they let it run (the panel's "Run it", which
passes it as `ok`: a call by an agent passing it is refused). An agent, only the command the user set or let run:
through the dashboard, an agent never runs a command the user has not seen.

The panel hears of each run as it goes (the host's `tell_panel`): {"run": view}, {"out": {id, text, reset?}},
{"preview": {key, row}}. A server no panel has shown for IDLE is stopped."""

import json
import os
import threading
import time
from typing import Dict, Optional

from app_kit import App, AppError, Caller, Instance, Response, ToolResult

from . import runs as R

USER = ""                   # `by` of what the user did, in the panel
IDLE = 600.0                # seconds a server is kept running with no panel of its project open
TICK = 30.0                 # seconds between looks for such a server
TAIL = 4000                 # the most characters of a run's output an agent's `run` is told
EVENTS = ("preview.set", "preview.allowed", "preview.cleared")


class PreviewApp(App):
    def start(self, host) -> None:
        super().start(host)
        self.runs = R.Runs(self._told)
        self.rows: Dict[str, Optional[dict]] = {}          # instance id -> its project's preview (None: none)
        self.keys: Dict[str, Instance] = {}                 # repository -> its instance, to tell its panels
        self.lock = threading.Lock()
        self.closed = threading.Event()
        threading.Thread(target=self._idle, name="preview-idle", daemon=True).start()

    def stop(self) -> None:
        self.closed.set()
        self.runs.close()

    def open(self, instance: Instance, args: dict) -> Instance:
        key = R.place(instance.folder)[0] if instance.folder else ""
        return Instance(**{**instance.to_dict(), "title": os.path.basename(key) if key else "",
                           "data": {"key": key}})

    # -- the project's preview, from its events

    def row(self, instance: Instance) -> Optional[dict]:
        with self.lock:
            if instance.id in self.rows:
                return self.rows[instance.id]
        row: Optional[dict] = None
        for e in self.host.read(instance, list(EVENTS), limit=2000):
            p = e["payload"] or {}
            if e["type"] == "preview.set":
                row = {"command": p.get("command", ""), "show": p.get("show", ""), "set_by": p.get("by", USER),
                       "set_at": p.get("at", 0), "allowed": p.get("command") if p.get("by", USER) == USER else
                       (row or {}).get("allowed")}
            elif e["type"] == "preview.allowed" and row is not None and row["command"] == p.get("command"):
                row["allowed"] = p["command"]
            elif e["type"] == "preview.cleared":
                row = None
        with self.lock:
            self.rows[instance.id] = row
        return row

    @staticmethod
    def shown(row: Optional[dict]) -> Optional[dict]:
        """The preview as said: `needs_ok` with it -- a command an agent set that the user has not let run yet."""
        if row is None:
            return None
        return {**row, "needs_ok": bool(row["command"]) and row["set_by"] != USER and row["allowed"] != row["command"]}

    def _keep(self, instance: Instance, kind: str, payload: dict, row: Optional[dict]) -> None:
        with self.lock:
            self.rows[instance.id] = row
        self.host.insert(instance, [{"type": kind, "payload": {**payload, "at": time.time()}}])
        self.host.tell_panel(instance, {"preview": self.shown(row)})

    # -- whose project

    def place(self, instance: Instance, path: Optional[str]) -> tuple:
        """(key, checkout) of the path -- or the instance's folder -- which must be the instance's project's."""
        key, checkout = R.place(path or instance.folder or "")
        mine = instance.data.get("key") or (R.place(instance.folder)[0] if instance.folder else key)
        if key != mine:
            raise R.PreviewError(f"{path} is in another project than this Preview's ({mine})")
        with self.lock:
            self.keys[key] = instance
        return key, checkout

    def about(self, instance: Instance, path: Optional[str]) -> dict:
        key, checkout = self.place(instance, path)
        row = self.shown(self.row(instance))
        p = os.path.realpath(path) if path else None
        file = p if p and os.path.isfile(p) else None
        run = self.runs.latest(checkout)
        return {"key": key, "checkout": checkout, "name": os.path.basename(key) or key,
                "git": R.repository(checkout) is not None, "preview": row,
                "guess": R.guess(file, checkout, None if file else (p or checkout)) if row is None else None,
                "run": run.view() if run else None, "token": self.runs.token(checkout)}

    # -- its tools

    def call(self, instance: Instance, tool: str, args: dict, caller: Caller) -> ToolResult:
        by = USER if caller.channel is None else caller.channel
        path = str(args.get("path") or "") or (caller.folder if caller.channel else "") or None
        try:
            if tool == "show":
                return ToolResult.json(self.about(instance, path))
            if tool == "set":
                self.place(instance, path)
                command, show = str(args.get("command") or "").strip(), str(args.get("show") or "").strip()
                if not command and not show:
                    raise R.PreviewError("a command to run, or what to show, or both")
                if "\n" in show:
                    raise R.PreviewError("what to show is one path, or one URL")
                old = self.row(instance)
                row = {"command": command, "show": show, "set_by": by, "set_at": time.time(),
                       "allowed": command if by == USER else (old or {}).get("allowed")}
                self._keep(instance, "preview.set", {"command": command, "show": show, "by": by}, row)
                return ToolResult.json(self.about(instance, path))
            if tool == "clear":
                self.place(instance, path)
                self._keep(instance, "preview.cleared", {}, None)
                return ToolResult.json(self.about(instance, path))
            if tool == "run":
                return ToolResult.json(self.run(instance, path, args, by))
            if tool == "stop":
                _, checkout = self.place(instance, path)
                self.runs.end(checkout, "stopped")
                return ToolResult.json(self.about(instance, path))
        except R.PreviewError as exc:
            return ToolResult.error(str(exc))
        raise AppError(f"{tool}: no such tool")

    def run(self, instance: Instance, path: Optional[str], args: dict, by: str) -> dict:
        key, checkout = self.place(instance, path)
        row = self.shown(self.row(instance))
        if row is None:
            raise R.PreviewError(f"no preview is set for {key}: set one (preview_set, or `ag preview set`), or in "
                                 f"the Preview")
        if row["needs_ok"]:
            if by != USER:
                who = "the user" if row["set_by"] == USER else f"actor {row['set_by']}"
                raise R.PreviewError(f"the user has not let this command run yet ({row['command']!r}, set by {who}): "
                                     f"they are asked when they next run the Preview, and once they let it run, your "
                                     f"run runs it too")
            if args.get("ok") != row["command"]:
                raise R.PreviewError("this command was set by an agent: let it run first")
            allowed = {**self.row(instance), "allowed": row["command"]}
            self._keep(instance, "preview.allowed", {"command": row["command"]}, allowed)
        file = str(args.get("file") or "") or None
        if file is None and path and os.path.isfile(path):
            file = os.path.realpath(path)
        r = self.runs.start(key, checkout, row["command"], row["show"], file, by)
        try:
            wait = min(float(args.get("wait") or 0), 600.0)
        except (TypeError, ValueError):
            wait = 0.0
        if wait > 0:
            self.runs.wait(r, wait)
        got = self.about(instance, path)
        got["run"], got["output"] = r.view(), r.text()[-TAIL:]
        return got

    # -- its panel's own requests

    def request(self, instance: Optional[Instance], method: str, path: str, query: Dict[str, str],
                body: bytes) -> Response:
        if instance is None:
            return Response(404, b"which Preview?")
        try:
            if path == "about":
                got = self.about(instance, query.get("path") or None)
                r = self.runs.latest(got["checkout"])
                got["output"] = r.text() if r else ""
                got["dropped"] = r.dropped if r else 0
                return Response.json(got)
            if path.startswith("files/"):
                token, _, rel = path[len("files/"):].partition("/")
                try:
                    data, kind = self.runs.file(token, rel)
                except FileNotFoundError:
                    return Response(404, b"not found")
                except PermissionError as exc:
                    return Response(403, str(exc).encode())
                headers = {"Content-Type": kind}
                if kind.startswith(("text/html", "image/svg+xml", "application/xhtml")):
                    headers["Content-Security-Policy"] = "sandbox allow-scripts allow-forms allow-modals allow-popups"
                return Response(200, data, headers)
            if path == "synctex" and method == "POST":
                ask = json.loads(body or b"{}")
                _, checkout = self.place(instance, ask.get("path") or None)
                return Response.json(R.synctex(checkout, ask))
        except R.PreviewError as exc:
            return Response.json({"error": str(exc)}, 400)
        except ValueError:
            return Response.json({"error": "a JSON object, please"}, 400)
        return Response(404, b"not found")

    # -- runs, told and kept

    def _told(self, run: "R.Run", name: str, value: dict) -> None:
        with self.lock:
            instance = self.keys.get(run.key)
        if instance is None:
            return
        if name == "ended":
            self.host.insert(instance, [{"type": "preview.ran", "payload": {
                k: value.get(k) for k in ("checkout", "command", "show", "by", "file", "state", "code", "started",
                                          "ended")}}])
            return
        self.host.tell_panel(instance, {name: value})

    def _idle(self) -> None:
        """A server no panel of its project has shown for IDLE: stopped."""
        while not self.closed.wait(TICK):
            now = time.time()
            for r in self.runs.servers():
                with self.lock:
                    instance = self.keys.get(r.key)
                try:
                    shown = instance is not None and self.host.panels(instance) > 0
                except AppError:
                    shown = False
                if shown:
                    r.unwatched = None
                elif r.unwatched is None:
                    r.unwatched = now
                elif now - r.unwatched > IDLE:
                    self.runs._kill(r, "stopped")
