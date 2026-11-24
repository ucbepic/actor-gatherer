"""The LaTeX editor (app.toml): a paper's files edited live, with the actors (app_kit.fileedit: FileEdit, its panel's
code and its agents' file tools), and beside them the project's build -- its preview (runs.py): a command run in the
checkout (latexmk on the main .tex, guessed until one is set), set by the user in the panel or by an agent with its
tools (or `ag preview`), run by either, and what it makes. Its own panel requests, beside FileEdit's:

    preview/about, preview/files/<token>/<rel>, preview/synctex     the project's preview and what it made
    overleaf, overleaf/signin, signout, cancel, link, files,        who changed the paper on Overleaf (overleaf.py):
    changes                                                         the user's sign-in, the instance's project, which
                                                                    files each person changed, and a file's lines
                                                                    credited to who changed them there

The preview's settings are its events, each with the repository it is for (`key`), shared by the gatherer's LaTeX
editors open:

    latex.preview_set       {key, command, show, by}: set by the user (by "") or an agent (its channel)
    latex.preview_allowed   {key, command}: a command an agent set, let run by the user
    latex.preview_cleared   {key}: none any more
    latex.preview_ran       {key, checkout, command, show, by, file, state, code, started, ended}: a run, once over

A folder synced with an Overleaf project (Overleaf's Dropbox sync) is that project's, found by its name once the user
has signed in to Overleaf (from the panel: a Chrome window of its own, the session kept in the app's data folder); or
the one the user names (`latex.overleaf` {project, name, root, by}: "" none, back to the folder's own). The file open's
lines changed there -- by a co-author, or by the user on overleaf.com, not through their own Dropbox -- are credited
to who changed them, as its panel asks (`overleaf/changes`, each few seconds while the file is open).

It takes over the Editor's instances (the app it was, before the Files app and it were made of it: `replaces`) on a
folder with a LaTeX source at its top (`takes_over`); the Files app takes the rest.

Who may run what: the user, anything -- a command an agent set, once they let it run (the panel's "Run it", which
passes it as `ok`: a call by an agent passing it is refused). An agent, only the command the user set or let run.
The panel hears of each run as it goes (`tell_panel`): {"run": view}, {"out": {id, text, reset?}}, {"preview":
{key, row}}. A server no panel has shown for IDLE is stopped. A LaTeX build's view, once it ends, has its problems
(runs.problems: from its log), which the panel lists and marks on the file's lines; an agent running it is told its
errors and warnings as `file:line: message` (runs.said_problems)."""

import os
import re
import threading
import time
from typing import Dict, Optional, Tuple
from urllib.parse import unquote

from app_kit import AppError, Caller, Instance, Response, ToolResult
from app_kit.fileedit import FileEdit
from app_kit.fileedit.backend import USER, _body

from . import overleaf as O
from . import runs as R

IDLE = 600.0                # seconds a server is kept running with no LaTeX editor open
TICK = 30.0                 # seconds between looks for such a server
TAIL = 4000                 # the most characters of a run's output an agent's `preview_run` is told
EVENTS = ("latex.preview_set", "latex.preview_allowed", "latex.preview_cleared")
TEX = (".tex", ".ltx")       # a LaTeX source, at a folder's top: the folder a paper's (takes_over)


def _said(got: dict, by: str) -> dict:
    """A tool's answer about the preview, as an agent is told it: a LaTeX build's problems as `file:line: message`."""
    run = got.get("run")
    if by != USER and run and "problems" in run:
        got = {**got, "run": {**run, "problems": R.said_problems(run["problems"])}}
    return got


class LatexApp(FileEdit):
    CALLED = "LaTeX editor"

    def takes_over(self, instance: Instance) -> int:
        """An Editor (the app it was made of, with the Files app) on a paper's folder: one with a LaTeX source at its
        top -- more than the Files app wants it (1); any other, not."""
        try:
            names = os.listdir(instance.folder or "")
        except OSError:
            return 0
        return 2 if any(n.lower().endswith(TEX) for n in names) else 0

    def start(self, host) -> None:
        super().start(host)
        self.runs = R.Runs(self._told)
        self.rows: Dict[Tuple[str, str], Optional[dict]] = {}   # (gatherer, repository) -> its preview (None: none)
        self.keys: Dict[str, Instance] = {}                      # repository -> the instance last asked of it
        self.closed = threading.Event()
        threading.Thread(target=self._idle, name="latex-preview-idle", daemon=True).start()
        self.overleaf = O.Account(host.folder())
        self.history = O.History(self.overleaf)

    def stop(self) -> None:
        super().stop()
        self.closed.set()
        self.runs.close()
        self.overleaf.cancel()

    def request(self, instance: Optional[Instance], method: str, path: str, query: Dict[str, str],
                body: bytes) -> Response:
        if path == "overleaf" or path.startswith("overleaf/"):
            try:
                return Response.json(self._overleaf_request(instance, method, path[len("overleaf/"):], query, body))
            except AppError as exc:
                return Response.json({"error": str(exc)}, exc.status)
        if not path.startswith("preview/"):
            return super().request(instance, method, path, query, body)
        try:
            return self._preview_request(instance, method, path[len("preview/"):], query, body)
        except R.PreviewError as exc:
            return Response.json({"error": str(exc)}, 400)
        except AppError as exc:
            return Response.json({"error": str(exc)}, exc.status)

    def call(self, instance: Instance, tool: str, args: dict, caller: Caller) -> ToolResult:
        if not tool.startswith("preview_"):
            return super().call(instance, tool, args, caller)
        by = USER if caller.channel is None else caller.channel
        path = str(args.get("path") or "") or (caller.folder if caller.channel else "") or None
        try:
            if tool == "preview_show":
                return ToolResult.json(_said(self.about(instance, path), by))
            if tool == "preview_set":
                key, _ = self.place(instance, path)
                command, show = str(args.get("command") or "").strip(), str(args.get("show") or "").strip()
                if not command and not show:
                    raise R.PreviewError("a command to run, or what to show, or both")
                if "\n" in show:
                    raise R.PreviewError("what to show is one path, or one URL")
                old = self.row(instance, key)
                row = {"command": command, "show": show, "set_by": by, "set_at": time.time(),
                       "allowed": command if by == USER else (old or {}).get("allowed")}
                self._keep(instance, key, "latex.preview_set", {"command": command, "show": show, "by": by}, row)
                return ToolResult.json(_said(self.about(instance, path), by))
            if tool == "preview_clear":
                key, _ = self.place(instance, path)
                self._keep(instance, key, "latex.preview_cleared", {}, None)
                return ToolResult.json(_said(self.about(instance, path), by))
            if tool == "preview_run":
                return ToolResult.json(_said(self.run(instance, path, args, by), by))
            if tool == "preview_stop":
                _, checkout = self.place(instance, path)
                self.runs.end(checkout, "stopped")
                return ToolResult.json(_said(self.about(instance, path), by))
        except R.PreviewError as exc:
            return ToolResult.error(str(exc))
        raise AppError(f"{tool}: no such tool")

    # -- the project's preview, from its events

    def row(self, instance: Instance, key: str) -> Optional[dict]:
        """The project's preview, as the gatherer's LaTeX editors' events say, the latest last."""
        with self.lock:
            if (instance.gatherer, key) in self.rows:
                return self.rows[(instance.gatherer, key)]
        row: Optional[dict] = None
        found = [e for i in self.mine(instance.gatherer) or [instance] for e in self.host.read(i, list(EVENTS), limit=5000)]
        for e in sorted(found, key=lambda e: e["row_id"]):
            p = e["payload"] or {}
            if p.get("key") != key:
                continue
            if e["type"] == "latex.preview_set":
                row = {"command": p.get("command", ""), "show": p.get("show", ""), "set_by": p.get("by", USER),
                       "set_at": p.get("at", 0), "allowed": p.get("command") if p.get("by", USER) == USER else
                       (row or {}).get("allowed")}
            elif e["type"] == "latex.preview_allowed" and row is not None and row["command"] == p.get("command"):
                row["allowed"] = p["command"]
            elif e["type"] == "latex.preview_cleared":
                row = None
        with self.lock:
            self.rows[(instance.gatherer, key)] = row
        return row

    @staticmethod
    def shown(row: Optional[dict]) -> Optional[dict]:
        """The preview as said: `needs_ok` with it -- a command an agent set that the user has not let run yet."""
        if row is None:
            return None
        return {**row, "needs_ok": bool(row["command"]) and row["set_by"] != USER and row["allowed"] != row["command"]}

    def _keep(self, instance: Instance, key: str, kind: str, payload: dict, row: Optional[dict]) -> None:
        with self.lock:
            self.rows[(instance.gatherer, key)] = row
        self.host.insert(instance, [{"type": kind, "payload": {"key": key, **payload, "at": time.time()}}])
        self._tell(instance.gatherer, {"preview": {"key": key, "row": self.shown(row)}})

    def _tell(self, gatherer: str, message: dict) -> None:
        """`message` to the panels of the gatherer's LaTeX editors (each takes what is its project's)."""
        for i in self.mine(gatherer):
            try:
                self.host.tell_panel(i, message)
            except AppError:
                pass

    def place(self, instance: Instance, path: Optional[str]) -> tuple:
        """(key, checkout) of the path: its repository (its worktrees share its preview), and the checkout holding it."""
        if not path:
            raise R.PreviewError("which project? a file or folder of it, please")
        key, checkout = R.place(path)
        with self.lock:
            self.keys[key] = instance
        return key, checkout

    def about(self, instance: Instance, path: Optional[str]) -> dict:
        key, checkout = self.place(instance, path)
        row = self.shown(self.row(instance, key))
        p = os.path.realpath(path) if path else None
        file = p if p and os.path.isfile(p) else None
        run = self.runs.latest(checkout)
        return {"key": key, "checkout": checkout, "name": os.path.basename(key) or key,
                "git": R.repository(checkout) is not None, "preview": row,
                "guess": R.guess(file, checkout, None if file else (p or checkout)) if row is None else None,
                "run": run.view() if run else None, "token": self.runs.token(checkout)}

    def run(self, instance: Instance, path: Optional[str], args: dict, by: str) -> dict:
        key, checkout = self.place(instance, path)
        row = self.shown(self.row(instance, key))
        if row is None:
            raise R.PreviewError(f"no build is set for {key}: set one (latex_preview_set, or `ag preview set`), "
                                 f"or in the LaTeX editor")
        if row["needs_ok"]:
            if by != USER:
                who = "the user" if row["set_by"] == USER else f"actor {row['set_by']}"
                raise R.PreviewError(f"the user has not let this command run yet ({row['command']!r}, set by {who}): "
                                     f"they are asked when they next run it in the LaTeX editor, and once they let it run, "
                                     f"your run runs it too")
            if args.get("ok") != row["command"]:
                raise R.PreviewError("this command was set by an agent: let it run first")
            allowed = {**self.row(instance, key), "allowed": row["command"]}
            self._keep(instance, key, "latex.preview_allowed", {"command": row["command"]}, allowed)
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

    def _preview_request(self, instance: Optional[Instance], method: str, path: str, query: Dict[str, str],
                         body: bytes) -> Response:
        if instance is None:
            return Response.json({"error": "which LaTeX editor? (its gatherer and instance)"}, 404)
        if path == "about":
            got = self.about(instance, query.get("path") or None)
            r = self.runs.latest(got["checkout"])
            got["output"] = r.text() if r else ""
            got["dropped"] = r.dropped if r else 0
            return Response.json(got)
        if path.startswith("files/"):
            token, _, rel = path[len("files/"):].partition("/")
            try:
                data, kind = self.runs.file(token, unquote(rel))
            except FileNotFoundError:
                return Response(404, b"not found")
            except PermissionError as exc:
                return Response(403, str(exc).encode())
            headers = {"Content-Type": kind}
            if kind.startswith(("text/html", "image/svg+xml", "application/xhtml")):
                headers["Content-Security-Policy"] = "sandbox allow-scripts allow-forms allow-modals allow-popups"
            return Response(200, data, headers)
        if path == "synctex" and method == "POST":
            ask = _body(body)
            _, checkout = self.place(instance, ask.get("path") or None)
            return Response.json(R.synctex(checkout, ask))
        return Response(404, b"not found")

    # -- runs, told and kept

    # -- Overleaf (overleaf.py)

    def overleaf_project(self, instance: Instance) -> Optional[dict]:
        """The instance's Overleaf project: {id, name, root (its folder here), how ("set": the user named it; "auto":
        its folder's)} -- None: none (or the user is not signed in, to find it by name). SignedOut, OverleafError."""
        got = self.host.read(instance, ["latex.overleaf"], limit=200)
        named = next((e["payload"] for e in reversed(got) if isinstance(e.get("payload"), dict)), None)
        if named and named.get("project"):
            return {"id": named["project"], "name": named.get("name") or named["project"],
                    "root": named.get("root") or instance.folder, "how": "set"}
        top = O.project_root(instance.folder or "")
        if top is None or self.overleaf.kept() is None:
            return None
        found = self.overleaf.find(top[1])
        return {"id": found["id"], "name": found["name"], "root": top[0], "how": "auto"} if found else None

    def _overleaf_request(self, instance: Optional[Instance], method: str, path: str, query: Dict[str, str],
                          body: bytes) -> dict:
        if instance is None:
            raise AppError("which one? (its gatherer and instance)", 404)
        b = _body(body) if method == "POST" else {}
        if method == "POST" and path == "signin":
            return {**self.overleaf.view(), "signing": self.overleaf.sign_in()}
        if method == "POST" and path == "cancel":
            self.overleaf.cancel()
            return self.overleaf.view()
        if method == "POST" and path == "signout":
            self.overleaf.sign_out()
            return self.overleaf.view()
        if method == "POST" and path == "link":
            url = str(b.get("url") or "").strip()
            m = re.search(r"([0-9a-f]{24})", url)
            if url and not m:
                raise AppError("that isn't an Overleaf project's link (overleaf.com/project/<id>)")
            pid = m.group(1) if m else ""
            name = next((p["name"] for p in self._projects_or_none() if p["id"] == pid), "") if pid else ""
            self.host.insert(instance, [{"type": "latex.overleaf", "payload": {
                "project": pid, "name": name, "root": instance.folder if pid else "", "by": USER}}])
        if method == "GET" and path == "changes":
            return self._overleaf_changes(instance, query)
        if method == "GET" and path == "files":
            return self._overleaf_files(instance, query)
        if path not in ("", "link"):
            raise AppError(f"overleaf/{path}: no such request", 404)
        got = self.overleaf.view()
        try:
            got["project"] = self.overleaf_project(instance)
        except O.SignedOut as exc:
            got.update(project=None, signed_out=str(exc))
        except O.OverleafError as exc:
            got.update(project=None, error=str(exc))
        top = O.project_root(instance.folder or "")
        got["synced"] = top[1] if top else None          # the folder is Overleaf's Dropbox copy of a project so named
        return got

    def _projects_or_none(self) -> list:
        try:
            return self.overleaf.projects()
        except (O.SignedOut, O.OverleafError):
            return []

    def _overleaf_files(self, instance: Instance, query: Dict[str, str]) -> dict:
        """Who changed which of the project's files on Overleaf since `since` (seconds): overleaf.who_changed's."""
        try:
            since = float(query.get("since") or 0)
            project = self.overleaf_project(instance)
            if project is None:
                return {"files": {}, "people": [], "project": None}
            me = (self.overleaf.kept() or {}).get("user_id", "")
            return {**O.who_changed(self.history, project["id"], os.path.realpath(project["root"]), me, since),
                    "project": project}
        except O.SignedOut as exc:
            return {"files": {}, "people": [], "signed_out": str(exc)}
        except (O.OverleafError, ValueError) as exc:
            return {"files": {}, "people": [], "error": str(exc)}

    def _overleaf_changes(self, instance: Instance, query: Dict[str, str]) -> dict:
        """The file's lines changed on Overleaf since `since` (seconds), by others than the user's own Dropbox, credited:
        overleaf.changes' -- the file as it is here (with what is typed and not saved, if it is open)."""
        path, root = query.get("path", ""), query.get("root", "") or instance.folder or "/"
        try:
            since = float(query.get("since") or 0)
            project = self.overleaf_project(instance)
            if project is None:
                return {"lines": [], "people": [], "project": None}
            real = os.path.realpath(path)
            if os.path.commonpath([real, os.path.realpath(project["root"])]) != os.path.realpath(project["root"]):
                return {"lines": [], "people": [], "project": project}
            try:
                text = self.host.docs().view(path, root)
            except AppError:                                 # not open live: as on disk
                with open(real, encoding="utf-8", errors="replace") as fh:
                    text = fh.read()
            me = (self.overleaf.kept() or {}).get("user_id", "")
            return {**O.changes(self.history, project["id"], project["root"], real, text, me, since), "project": project}
        except O.SignedOut as exc:
            return {"lines": [], "people": [], "signed_out": str(exc)}
        except (O.OverleafError, OSError, ValueError) as exc:
            return {"lines": [], "people": [], "error": str(exc)}

    def _told(self, run: "R.Run", name: str, value: dict) -> None:
        with self.lock:
            instance = self.keys.get(run.key)
        if instance is None:
            return
        if name == "ended":
            self.host.insert(instance, [{"type": "latex.preview_ran", "payload": {"key": run.key, **{
                k: value.get(k) for k in ("checkout", "command", "show", "by", "file", "state", "code", "started",
                                          "ended")}}}])
            return
        self._tell(instance.gatherer, {name: value})

    def _idle(self) -> None:
        """A server no LaTeX editor of its project has shown for IDLE: stopped."""
        while not self.closed.wait(TICK):
            now = time.time()
            for r in self.runs.servers():
                with self.lock:
                    instance = self.keys.get(r.key)
                try:
                    shown = instance is not None and any(self.host.panels(i) > 0 for i in self.mine(instance.gatherer))
                except AppError:
                    shown = False
                if shown:
                    r.unwatched = None
                elif r.unwatched is None:
                    r.unwatched = now
                elif now - r.unwatched > IDLE:
                    self.runs._kill(r, "stopped")
