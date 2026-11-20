"""FileEdit: the backend of an app that edits a folder's files live (the package's doc) -- each text file shared with
every other page that has it open and with the file on disk, as the host shares them (app_kit.docs: Host.docs()), any
other file shown. An app subclasses it, its manifest asking `docs` (and `edit_guard`, for the guard), its tools named
`read`, `edit`, `write`, `open` (each <app>_<tool>), and its event `<app>.mode`; it adds its own requests and tools by
overriding `request` and `call`, handing on what it does not take. Its panel's requests, each answered as JSON ({error}
with a status, refused):

    edit/list, about, raw/<path>, files, choose, reveal, create     the folders, a file's kind (or that it is a
                                                                    folder) and bytes, Go to file's list, the system's
                                                                    dialogs, a new file
    edit/stream, update, aware, save, settle, zone/clear            a file open live (app_kit.docs: its events)
    edit/text, put                                                  a file open plain (PLAIN): its text and version, and
                                                                    saved -- refused (409) if it changed on disk since
    edit/settle_all                                                 an actor's changes held there, all taken or not
    mode                                                            its mode: GET it, POST {mode}
    branches, branches/approve, branches/decide                     the actors on branches of the project shown
    files/changes                                                   an actor's changes to the file open

Each instance is on a folder (its own), started with an actor of its own, as the Browser and DocWriter are.

An app may edit its files PLAIN instead (its panel's `plain` part, panel/plain.js's: the Files app): a file read, edited
in the page alone, and saved whole -- no live document, no mode, no conflict zone; a save over a file changed on disk
since it was read is refused, for the reader to reload it or keep theirs (`edit/put`, `force`). Its agents then have
only <app>_open.

Its agents change files with its tools, not their own -- Claude Code's Edit and Write on a file open in one are
refused (`guard`, the host's edit_guard), pointing at <app>_edit. A file no such app has open is read and written on
disk, whatever the mode. One open in one is changed through the host's live documents, as its MODE says -- the
strictest of those that have it open, of every app built on this (the Files app's and the LaTeX editor's alike: they
edit the same files):

    live        the change lands at once, in the agent's hue, and is written to the file; what meets the lines the
                user is editing (the conflict zone) is held for them, in a box (docs.put "live")
    review      each change a proposal, shown in place, the user accepting or rejecting it when they choose -- the
                file on disk as it was until they accept (docs.put "propose"); the agent does not wait for them: it
                carries on, reading the file with its proposals in, and is told what they chose when they do
    handsoff    refused: the user is editing it, the agent to ask them first

In review and handsoff, a write that does not come through the tools -- a shell command's, another harness's edit
tool's -- is asked about too, not merged in (docs.hold "ask"): Reject puts the user's lines back on the file. The
agent that made a change held is told what the user chose (a context_stream message, `_told_settled`); one attached to
an instance that has used its file tools, when its mode changes (another learns it from its tools' answers, or the
guard, when it next changes a file: a message to an agent that never started would list it as one with a
conversation).

    <app>.mode             {mode, by}: the instance's mode (live until one is set)
"""

import base64
import json
import os
import tempfile
import threading
import weakref
from typing import Dict, List, Optional, Tuple
from urllib.parse import unquote

from ..backend import App, AppError, Caller, Instance, Response, ToolResult
from ..events import context_stream
from . import chooser

USER = ""                   # `by` of what the user did, in the panel
MODES = ("live", "review", "handsoff")      # strictest last
MODE_SAID = {"live": "Live", "review": "Review", "handsoff": "Hands off"}
READ_LINES = 2000                           # the most lines <app>_read gives at once
MAX_WRITE = 2_000_000                       # the largest file its tools write
TOLD_TEXT = 1500                            # the most characters of lines the user wrote in that an agent is told
RAW_HEADERS = {"cache-control": "no-cache", "x-content-type-options": "nosniff", "content-security-policy": "sandbox"}
FILE_TOOLS = ("read", "edit", "write", "open")

# Every app built on this, as the host started them, and the files their pages have open -- one registry, since they
# edit the same files: a file's mode is the strictest of them all, and a change one put in may be settled in another.
_lock = threading.Lock()
_apps: "weakref.WeakSet[FileEdit]" = weakref.WeakSet()
_pages: Dict[str, Dict[str, Tuple["FileEdit", str, str]]] = {}   # a file open (real path) -> {conn: (app, instance id, root)}


def _body(raw: bytes) -> dict:
    try:
        got = json.loads(raw or b"{}")
    except ValueError:
        raise AppError("a JSON object, please") from None
    if not isinstance(got, dict):
        raise AppError("a JSON object, please")
    return got


def _b64(text) -> bytes:
    try:
        return base64.b64decode(str(text or ""), validate=True)
    except ValueError:
        raise AppError("an update in base64, please") from None


def _opt(body: dict, key: str) -> Optional[str]:
    return body[key] if isinstance(body.get(key), str) else None


class FileEdit(App):
    #: What its agents are told it is: "the user's <CALLED>" (a subclass names itself: "Files app", "LaTeX editor").
    CALLED = "editor"

    @property
    def name(self) -> str:
        """The app's name (its manifest's): its tools <name>_<tool>, its event <name>.mode."""
        return self.manifest.name if self.manifest is not None else "fileedit"

    def tool(self, t: str) -> str:
        return f"{self.name}_{t}"

    def start(self, host) -> None:
        super().start(host)
        self.lock = threading.Lock()
        self.modes: Dict[str, str] = {}                          # instance id -> its mode, as its events say
        self.used: set = set()                                   # the agents that used its file tools (channels)
        with _lock:
            _apps.add(self)

    def stop(self) -> None:
        with _lock:
            _apps.discard(self)

    def open(self, instance: Instance, args: dict) -> Instance:
        """An instance on a folder: the one it shows first (its title, the folder's name)."""
        folder = instance.folder or ""
        if not os.path.isdir(folder):
            raise AppError(f"no directory {folder or '(none)'}: {self.manifest.label if self.manifest else 'it'} "
                           f"shows a folder")
        return Instance(id=instance.id, app=instance.app, gatherer=instance.gatherer, folder=instance.folder,
                        title=os.path.basename(folder.rstrip("/")) or folder, data=dict(instance.data))

    def mine(self, gatherer: str) -> List[Instance]:
        """The gatherer's instances of this app open (the host's)."""
        return [i for i in self.host.instances() if i.gatherer == gatherer]

    # -- its panel's requests

    def request(self, instance: Optional[Instance], method: str, path: str, query: Dict[str, str],
                body: bytes) -> Response:
        here = query.get("_here") == "1"
        try:
            if path.startswith("edit/raw/"):
                return self._raw("/" + unquote(path[len("edit/raw/"):]).lstrip("/"), query)
            if path == "edit/stream" and method == "GET":
                return self._stream(instance, query)
            if path == "mode":
                if instance is None:
                    raise AppError("which one? (its gatherer and instance)", 404)
                if method == "POST":
                    self.set_mode(instance, str(_body(body).get("mode") or ""))
                return Response.json({"mode": self.mode(instance), "modes": list(MODES)})
            if path in ("edit/settle", "edit/settle_all") and method == "POST":
                return Response.json(self._settle(path, _body(body)))
            if method == "GET":
                return Response.json(self._get(path, query, here))
            if method == "POST":
                return Response.json(self._post(path, _body(body), here))
        except chooser.Busy as exc:
            return Response.json({"error": str(exc)}, 409)
        except chooser.ChooseError as exc:
            return Response.json({"error": str(exc)}, 400)
        except AppError as exc:
            if path == "edit/list":                 # a folder that cannot be listed can still be left by the dialog
                return Response.json({"error": str(exc), "choose": chooser.name() if here else None}, exc.status)
            return Response.json({"error": str(exc)}, exc.status)
        return Response.json({"error": f"{path}: no such request"}, 404)

    def _get(self, path: str, q: Dict[str, str], here: bool):
        docs = self.host.docs()
        if path == "edit/list":
            try:
                since = float(q["since"]) if q.get("since") else None
            except ValueError:
                raise AppError("since: seconds, please") from None
            return {**docs.listing(q.get("dir", ""), q.get("root", ""), since), "choose": chooser.name() if here else None}
        if path == "edit/text":                     # a file open plain: its text and version (`have`: unchanged, no text)
            real = docs.resolve(q.get("path", ""), q.get("root", ""))
            got = _version(real)
            if got is None:
                return {"version": None, "missing": True}
            if q.get("have") == got:
                return {"version": got, "same": True}
            return {"version": got, "text": _read_file(real)}
        if path == "edit/about":                    # a folder: said so, for the panel to show it in the tree
            real = docs.resolve(q.get("path", ""), q.get("root", ""))
            if os.path.isdir(real):
                return {"path": q.get("path", ""), "real": real, "kind": "folder"}
            return {**docs.about(q.get("path", ""), q.get("root", "")), "reveal": chooser.shower() if here else None}
        if path == "edit/files":
            return docs.files(q.get("dir", ""), q.get("root", ""))
        if path == "branches":
            return docs.branches(q.get("root", ""))
        if path == "files/changes":
            try:
                since = float(q.get("since") or 0)
            except ValueError:
                raise AppError("since: seconds, please") from None
            return docs.changes(q.get("gatherer", ""), q.get("channel", ""), q.get("path", ""), since,
                                q.get("cwd", ""))
        raise AppError(f"{path}: no such request", 404)

    def _post(self, path: str, b: dict, here: bool):
        docs = self.host.docs()
        p, root = str(b.get("path") or ""), str(b.get("root") or "")
        if path == "edit/update":                    # `save`: saved too, the page's last keys as it goes (one request)
            state = docs.edit(p, root, str(b.get("conn") or ""), _b64(b.get("update")))
            return docs.save(p, root) if b.get("save") else state
        if path == "edit/aware":
            docs.aware(p, root, str(b.get("conn") or ""), _b64(b.get("update")))
            return {}
        if path == "edit/save":
            return docs.save(p, root)
        if path == "edit/put":                      # a file open plain, saved whole: not over a change made since
            return _put(docs.resolve(p, root), b)
        if path == "edit/zone/clear":
            return docs.clear_zone(p, root)
        if path == "edit/create":
            return docs.create(p, root, bool(b.get("dir")))
        if path == "edit/reveal":
            if not here:
                raise chooser.ChooseError("It would open on the dashboard's machine, not this one")
            chooser.reveal(docs.resolve(p, root))
            return {}
        if path == "edit/choose":
            if not here:
                raise chooser.ChooseError("The dialog would open on the dashboard's machine, not this one")
            return {"path": chooser.choose(str(b.get("what") or ""), str(b.get("start") or ""))}
        if path == "branches/approve":
            docs.approve(str(b.get("session_id") or ""), bool(b.get("approve")))
            return {}
        if path == "branches/decide":
            docs.decide(str(b.get("session_id") or ""), p, str(b.get("take") or ""))
            return {}
        raise AppError(f"{path}: no such request", 404)

    def _raw(self, path: str, q: Dict[str, str]) -> Response:
        """The bytes of the file, as the host's `about` says to serve them -- by its path, so what it names beside it
        (a page's images) is found beside it: inline (an image, a PDF for pdf.js, a video, in ranges), or (download)
        to be saved. Sandboxed: a page or an SVG opened here runs nothing that reaches the dashboard or the panel."""
        got = self.host.docs().about(path, q.get("root") or "/")
        return Response.file_at(got["real"], got["type"], got["name"], bool(q.get("download")), RAW_HEADERS)

    def _stream(self, instance: Optional[Instance], q: Dict[str, str]) -> Response:
        """The file opened by the page (app_kit.docs's `open`), its events until it goes; `failed` if it cannot be.
        Kept as one of its instance's pages while it is open: how it takes the file's changes on disk is its mode's."""
        client, path, root, conn = q.get("client", ""), q.get("path", ""), q.get("root", ""), q.get("conn", "")
        docs = self.host.docs()
        try:
            hold = "ask" if instance is not None and self.mode(instance) != "live" else "merge"
            joined = docs.open(path, root, conn, int(client) if client.isdigit() else 0, hold)
            real = docs.resolve(path, root)
        except AppError as exc:
            said = [[("failed", {"error": str(exc)})]]
            return Response.stream(lambda wait: said.pop() if said else None)
        with _lock:
            _pages.setdefault(real, {})[conn] = (self, instance.id if instance else "", root)

        def close() -> None:
            with _lock:
                got = _pages.get(real, {})
                got.pop(conn, None)
                if not got:
                    _pages.pop(real, None)
            joined.close()
        return Response.stream(joined.take, close)

    # -- its mode

    def mode(self, instance: Instance) -> str:
        """The instance's mode, as its events say (live until one is set)."""
        with self.lock:
            if instance.id in self.modes:
                return self.modes[instance.id]
        got = self.host.read(instance, [f"{self.name}.mode"], limit=5000)
        mode = next((e["payload"].get("mode") for e in reversed(got) if (e["payload"] or {}).get("mode") in MODES),
                    "live")
        with self.lock:
            self.modes[instance.id] = mode
        return mode

    def set_mode(self, instance: Instance, mode: str, by: str = USER) -> None:
        """The instance's mode, set: kept as its event, its pages' hold on their files changed to it, its panels and
        its agents told."""
        if mode not in MODES:
            raise AppError(f"mode {mode!r}: {', '.join(MODES)}")
        if mode == self.mode(instance):
            return
        with self.lock:
            self.modes[instance.id] = mode
        with _lock:
            mine = [(real, conn, root) for real, got in _pages.items() for conn, (app, i, root) in got.items()
                    if app is self and i == instance.id]
        self.host.insert(instance, [{"type": f"{self.name}.mode", "payload": {"mode": mode, "by": by}}])
        docs = self.host.docs()
        for real, conn, root in mine:
            try:
                docs.hold(real, root, conn, "merge" if mode == "live" else "ask")
            except AppError:
                pass                                # closed meanwhile
        try:
            self.host.tell_panel(instance, {"mode": mode})
        except AppError:
            pass
        edit, write, read = self.tool("edit"), self.tool("write"), self.tool("read")
        said = {"live": f"Live: your edits to files open there ({edit}, {write}) land at once, shown to the user as "
                        f"they land, and are written to the file; one to lines the user is editing is held for them "
                        f"to settle.",
                "review": f"Review: your edits to files open there ({edit}, {write}) are proposals the user accepts "
                          f"or rejects in their own time -- propose and carry on with your task, without waiting for "
                          f"them. The file on disk changes only when they accept; {read} shows your proposals in, so "
                          f"your next edits build on them.",
                "handsoff": f"Hands off: do not change files open there; ask the user first ({edit} and {write} "
                            f"refuse them)."}[mode]
        for channel in self.host.attached(instance):
            if channel not in self.used:
                continue
            try:
                self.host.insert(instance, [context_stream(self._stream_name(), "the user",
                                                           f"The user set the {self.CALLED} to {said}")], channel)
            except AppError:
                pass

    def _stream_name(self) -> str:
        """What its agents' messages say they come from: its label."""
        return self.manifest.label if self.manifest is not None else self.CALLED

    @staticmethod
    def _open_in(real: str) -> List[Tuple["FileEdit", Instance, str]]:
        """The instances that have the file open now -- of any app built on this -- each with its app and the folder
        its page opened it under."""
        with _lock:
            got = list(_pages.get(real, {}).values())
        out, seen = [], set()
        for app, i, root in got:
            if (app, i) in seen:
                continue
            found = next((x for x in app.host.instances() if x.id == i), None)
            if found is not None:
                seen.add((app, i))
                out.append((app, found, root))
        return out

    def file_mode(self, real: str) -> Optional[str]:
        """How an agent's change to the file lands: the strictest mode of those that have it open; None, none has it
        open (its tools write the file on disk)."""
        modes = [app.mode(i) for app, i, _ in self._open_in(real)]
        return max(modes, key=MODES.index) if modes else None

    # -- its agents' own edit tools, on a file open in it

    def guard(self, instance: Instance, path: str, caller: Caller) -> Optional[str]:
        real = os.path.realpath(os.path.expanduser(path or ""))
        mode = self.file_mode(real)
        if mode is None:
            return None
        if mode == "handsoff":
            return f"{path} is open in the user's {self.CALLED}, set to Hands off: do not change it; ask the user first."
        return (f"{path} is open in the user's {self.CALLED}: change it with {self.tool('edit')} (or "
                f"{self.tool('write')} for the whole file) instead, so your change goes through it"
                + (" -- shown to the user as it lands." if mode == "live" else
                   " -- it is set to Review: your change is a proposal the user reviews in their own time, and you "
                   "carry on meanwhile."))

    # -- its tools

    def call(self, instance: Instance, tool: str, args: dict, caller: Caller) -> ToolResult:
        if tool not in FILE_TOOLS:
            raise AppError(f"{tool}: no such tool")
        if caller.channel:
            self.used.add(caller.channel)
        try:
            return getattr(self, f"_tool_{tool}")(instance, args, caller)
        except AppError as exc:
            return ToolResult.error(str(exc))

    def _path(self, args: dict, caller: Caller) -> str:
        """The tool's file: absolute, or from the agent's folder; its links followed."""
        p = str(args.get("path") or args.get("file_path") or "").strip()
        if not p:
            raise AppError("which file? (path)")
        p = os.path.expanduser(p)
        if not os.path.isabs(p):
            p = os.path.join(caller.folder or os.getcwd(), p)
        return os.path.realpath(p)

    def _where(self, real: str) -> Tuple[Optional[str], Optional[str]]:
        """(mode, root) of the file: as those that have it open open it, else (None, None) -- not open in one."""
        got = self._open_in(real)
        if not got:
            return None, None
        return max((app.mode(i) for app, i, _ in got), key=MODES.index), got[0][2]

    def _tool_read(self, instance: Instance, args: dict, caller: Caller) -> ToolResult:
        real = self._path(args, caller)
        mode, root = self._where(real)
        note = ""
        if mode is not None:
            text = self.host.docs().view(real, root, caller.channel if mode == "review" else None)
            mine = sum(1 for c in self.host.docs().state(real, root)["conflicts"] if _held_by(c, caller.channel))
            note = (f"Open in the user's {self.CALLED} ({MODE_SAID[mode]}): as it is there, with what they typed and "
                    f"have not saved" + (f"; your {mine} change{'s' if mine != 1 else ''} waiting for them shown in"
                                         if mine and mode == "review" else
                                         f"; {mine} change{'s' if mine != 1 else ''} of yours held for them, not in"
                                         if mine else "") + ".")
        else:
            text = _read_file(real)
        lines = text.splitlines()
        try:
            start = max(int(args.get("offset") or 1), 1)
            n = max(int(args.get("limit") or READ_LINES), 1)
        except (TypeError, ValueError):
            raise AppError("offset and limit: line numbers") from None
        shown = lines[start - 1:start - 1 + n]
        body = "\n".join(f"{k:>6}\t{line}" for k, line in enumerate(shown, start))
        more = len(lines) - (start - 1 + len(shown))
        tail = f"\n({more} more lines: offset {start + len(shown)})" if more > 0 else ""
        return ToolResult.text((note + "\n" if note else "") + (body or "(empty)") + tail)

    def _tool_edit(self, instance: Instance, args: dict, caller: Caller) -> ToolResult:
        real = self._path(args, caller)
        old, new = args.get("old_string"), args.get("new_string")
        if not isinstance(old, str) or not isinstance(new, str):
            raise AppError("old_string and new_string, please")
        if old == new:
            raise AppError("old_string and new_string are the same: nothing to change")
        every = bool(args.get("replace_all"))

        def edited(text: str) -> str:
            if not old:
                raise AppError(f"old_string is empty: to write a whole file, {self.tool('write')}")
            n = text.count(old)
            if n == 0:
                raise AppError(f"old_string is not in {real}" + (f" as it is in the {self.CALLED}: read it again"
                                                                  if self._where(real)[0] else ""))
            if n > 1 and not every:
                raise AppError(f"old_string is in {real} {n} times: give more of the lines around it to say which, "
                               f"or replace_all")
            return text.replace(old, new) if every else text.replace(old, new, 1)
        return self._change(instance, real, edited, caller)

    def _tool_write(self, instance: Instance, args: dict, caller: Caller) -> ToolResult:
        real = self._path(args, caller)
        content = args.get("content")
        if not isinstance(content, str):
            raise AppError("content, please: the whole file")
        return self._change(instance, real, lambda text: content, caller, create=True)

    def _change(self, instance: Instance, real: str, edited, caller: Caller, create: bool = False) -> ToolResult:
        """An agent's change to the file -- `edited(text)`, the whole of it as the agent wants it -- as its mode says
        (module doc)."""
        mode, root = self._where(real)
        if mode is None:                            # none has it open: on disk
            exists = os.path.isfile(real)
            if not exists and not create:
                raise AppError(f"{real}: no such file ({self.tool('write')} makes one)")
            text = _read_file(real) if exists else ""
            wanted = edited(text)
            if len(wanted.encode("utf-8")) > MAX_WRITE:
                raise AppError(f"too large: the most it writes is {MAX_WRITE} bytes")
            _write_file(real, wanted)
            return ToolResult.text(f"{'Wrote' if exists else 'Made'} {real}: the user doesn't have it open, so it is "
                                   f"written on disk.")
        if mode == "handsoff":
            raise AppError(f"{real} is open in the user's {self.CALLED}, set to Hands off: they are editing it. Ask "
                           f"them first.")
        docs = self.host.docs()
        how = "propose" if mode == "review" else "live"
        seen = docs.view(real, root, caller.channel if how == "propose" else None)
        wanted = edited(seen)
        if len(wanted.encode("utf-8")) > MAX_WRITE:
            raise AppError(f"too large: the most it writes is {MAX_WRITE} bytes")
        by = {"gatherer": caller.gatherer, "channel": caller.channel, "via": self.name, "instance": instance.id}
        got = docs.put(real, root, seen, wanted, by, how)
        if how == "propose":
            n = len(got["proposed"])
            return ToolResult.text(
                f"Proposed: {real} is open in the user's {self.CALLED}, set to Review, so your change is a proposal "
                f"there ({n} of yours in this file now). Do not wait for the user: carry on with your task. They "
                f"review proposals in their own time, and you are told what they choose when they do. Your next edits "
                f"build on it ({self.tool('read')} shows the file with your proposals in); until they accept, the "
                f"file on disk is without it, so a test or build you run sees it as it was.")
        said = f"Edited {real}: it is open in the user's {self.CALLED}, where your change shows as it lands"
        if got["landed"]:
            said += ", and it is written to the file"
        if got["held"]:
            k = len(got["held"])
            said += (f". {k} of your changes touch lines the user is editing: held for them to settle, not in the "
                     f"file yet. You will be told what they choose")
        return ToolResult.text(said + ".")

    def _tool_open(self, instance: Instance, args: dict, caller: Caller) -> ToolResult:
        real = self._path(args, caller)
        if not os.path.exists(real):
            raise AppError(f"{real}: no such file or folder")
        try:
            line = 0 if os.path.isdir(real) else int(args.get("line") or 0)     # a folder: shown in the tree
        except (TypeError, ValueError):
            raise AppError("line: a line number") from None
        if self.host.panels(instance) == 0:
            raise AppError(f"the user's {self.CALLED} is not open now: say where to look instead")
        self.host.tell_panel(instance, {"show": {"path": real, "line": line}})
        return ToolResult.text(f"Shown in the user's {self.CALLED}: {real}" + (f", line {line}" if line else "") + ".")

    # -- a change held, settled by the user: its agent told

    def _settle(self, path: str, b: dict) -> dict:
        """A conflict settled (edit/settle) -- or every change of one actor's held in the file (edit/settle_all:
        {take: theirs or mine, channel}) -- the agent whose changes they were told what the user chose."""
        docs = self.host.docs()
        p, root = str(b.get("path") or ""), str(b.get("root") or "")
        held = {c["id"]: c for c in docs.state(p, root)["conflicts"]}
        if path == "edit/settle":
            ids = [str(b.get("conflict") or "")]
        else:
            channel = _opt(b, "channel")
            ids = [c["id"] for c in held.values() if _held_by(c, channel) and (c["agent"] or {}).get("why") == "approve"]
        take, state, done, failed = str(b.get("take") or ""), None, [], ""
        for cid in ids:
            try:
                state = docs.settle(p, root, cid, take, _opt(b, "text"), _opt(b, "theirs"), _opt(b, "mine"))
                done.append(cid)
            except AppError as exc:
                if path == "edit/settle":
                    raise
                failed = str(exc)                   # (one changed since: the rest still settled)
        if state is None:
            state = docs.state(p, root)
        if failed:
            state = {**state, "error": failed}
        real = docs.resolve(p, root)
        for cid in done:
            c = held.get(cid)
            if c is not None and _held_by(c, None):
                _told_settled(real, c, take, _opt(b, "text"))
        return state


def _held_by(c: dict, channel: Optional[str]) -> bool:
    """Whether a conflict of the file's state is an actor's change put in through an app built on this -- that
    actor's."""
    a = c.get("agent") or {}
    if not a.get("put"):
        return False
    with _lock:
        ours = {app.name for app in _apps}
    return a.get("via") in ours and (channel is None or a.get("channel") == channel)


def _told_settled(real: str, c: dict, take: str, text: Optional[str]) -> None:
    """The agent whose change `c` was told what the user chose -- through the instance it made it in, if it is still
    attached to it, else any of these apps' it is attached to."""
    a = c["agent"] or {}
    with _lock:
        apps = list(_apps)
    found = [(app, i) for app in apps for i in app.host.instances()]
    got = next(((app, i) for app, i in found if i.id == a.get("instance") and a.get("channel") in app.host.attached(i)),
               None) or next(((app, i) for app, i in found if a.get("channel") in app.host.attached(i)), None)
    if got is None:
        return
    app, i = got
    what = "proposed" if a.get("why") == "approve" else "made to lines they were editing"
    lines = (c.get("theirs") or "").strip("\n").splitlines()
    first = lines[0][:80] if lines else "(a deletion)"
    said = {"theirs": "accepted", "mine": "rejected",
            "both": "kept both their lines and yours, yours after theirs, for", "edited": "edited, then accepted"}
    msg = f"The user {said.get(take, take)} the change you {what} in {real} (\"{first}\"...)."
    if take == "edited" and text is not None:
        msg += f" It reads now:\n{text[:TOLD_TEXT]}"
    if take == "mine":
        msg += " The file keeps its lines there."
    try:
        app.host.insert(i, [context_stream(app._stream_name(), "the user", msg)], a["channel"])
    except AppError:
        pass


def _version(real: str) -> Optional[str]:
    """What a file is now, to tell a change on disk by: its modification time (ns) and size; None, no such file."""
    try:
        st = os.stat(real)
    except OSError:
        return None
    if not os.path.isfile(real):
        raise AppError(f"{real} is a folder")
    return f"{st.st_mtime_ns}-{st.st_size}"


def _put(real: str, b: dict) -> dict:
    """A file open plain, saved: `text` written in place of it, unless it changed on disk since the page read it
    (`base`, its version then; none: it was not there) -- refused then (409, with the version now), the page to reload
    it or keep its own (`force`)."""
    text = b.get("text")
    if not isinstance(text, str):
        raise AppError("text, please: the whole file")
    if len(text.encode("utf-8")) > MAX_WRITE:
        raise AppError(f"too large: the most it writes is {MAX_WRITE} bytes")
    now = _version(real)
    if not b.get("force") and now != (b.get("base") or None):
        raise AppError("changed on disk since you opened it", 409)
    _write_file(real, text)
    return {"version": _version(real)}


def _read_file(real: str) -> str:
    try:
        with open(real, "rb") as fh:
            raw = fh.read(MAX_WRITE + 1)
    except FileNotFoundError:
        raise AppError(f"{real}: no such file") from None
    except IsADirectoryError:
        raise AppError(f"{real} is a folder") from None
    except OSError as exc:
        raise AppError(f"{real}: {exc.strerror or exc}") from None
    if len(raw) > MAX_WRITE:
        raise AppError(f"{real} is too large to read here ({MAX_WRITE} bytes at most)")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        raise AppError(f"{real} is not UTF-8 text") from None


def _write_file(real: str, text: str) -> None:
    """`text` written in place of the file (whoever reads it meanwhile reads all of the old or all of the new), its
    mode kept; the folders above it made."""
    folder = os.path.dirname(real)
    os.makedirs(folder, exist_ok=True)
    try:
        mode = os.stat(real).st_mode & 0o7777
    except FileNotFoundError:
        mode = 0o644
    fd, temp = tempfile.mkstemp(prefix="." + os.path.basename(real) + ".", suffix=".ag-edit", dir=folder)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(text.encode("utf-8"))
        os.chmod(temp, mode)
        os.replace(temp, real)
    except BaseException:
        if os.path.exists(temp):
            os.unlink(temp)
        raise
