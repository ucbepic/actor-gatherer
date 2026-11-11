"""The Notes app's backend (app.toml): each gatherer's notebook (notebook.py), kept in a file of the app's data folder,
changed by its panels' ops and by agents' tools, each change told to every open panel in the order it was made.

The panel's routes (its own origin, /api/...):

    GET  state                  the notebook: {version, pages}
    POST ops    {by, ops}       ops applied: {version}; told to the panels as {ops, by, version}
    POST parse  {markdown}      blocks made from pasted markdown, with new ids (nothing changed)
    POST image  <the picture>   a picture kept (media.py): {file, w, h}, for an image block to show
    GET  file/<file>            a picture kept
    GET  figma                  whether the user gave a Figma token: {token, who}
    POST figma/token {token}    the token kept (checked with Figma), or forgotten ("")
    POST figma/snap {block}     a figma block's snapshot fetched again (when Figma changed it): {ok} or {error}

Pictures (notebook.py, PICTURES) are kept in one folder for every gatherer's notebook. notes_read gives an agent the
pictures of the page it reads with its words (MAX_SHOWN of them); notes_add and notes_change take `![caption](a file)`
(read in from the agent's folder) and a Figma link alone on a line.

The tools (notes_read, notes_add, notes_change) read and write it as markdown; what an agent changes is told to the
panels with its channel, so the panel shows who changed what. Lines an agent writes from its own conversation with the
user (`from_conversation`) name it as their source, and when (notebook.py), for the user to follow up on with it.
notes_report is an agent's report on a block the user sent it: a line of the block's thread, by it -- whether it says it
finished, and what it made (refused from an agent the user took the line back from). Only the user ends a work item
(notebook.py): no tool ticks one, or says it is done. A line of a thread a panel adds is the user's, whatever it
says."""
import base64
import json
import os
import threading
import time
import urllib.parse
from typing import Dict, List, Optional

from app_kit import App, AppError, Caller, Instance, Response, ToolResult

from . import media
from . import notebook as nb

#: the pictures notes_read gives with a page, and how large each may be (what a model takes)
MAX_SHOWN = 6
MAX_SHOWN_BYTES = 3_700_000
#: how a picture is served: as itself, never a page that runs (an SVG opened on its own)
PICTURE_HEADERS = {"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox"}


class NotesApp(App):
    def __init__(self):
        self._books: Dict[str, nb.Notebook] = {}
        self._lock = threading.Lock()
        self.files: Optional[media.Files] = None
        self.figma: Optional[media.Figma] = None
        self._snapping: set = set()

    def start(self, host) -> None:
        super().start(host)
        self.files = media.Files(os.path.join(host.folder(), "files"))
        self.figma = media.Figma(host.folder())

    # -- the notebooks

    def book(self, gatherer: str) -> nb.Notebook:
        """The gatherer's notebook, read once from its file."""
        with self._lock:
            got = self._books.get(gatherer)
            if got is None:
                name = urllib.parse.quote(gatherer, safe="") or "_"
                got = self._books[gatherer] = nb.Notebook(os.path.join(self.host.folder(), f"{name}.json"))
            return got

    def change(self, instance: Instance, ops: list, by: str, agent: Optional[str] = None, quiet: bool = False) -> int:
        """`ops` applied to the instance's notebook and told to its panels, in the order applied (`quiet`: not shown
        as a change someone made -- a snapshot fetched again)."""
        book = self.book(instance.gatherer)
        with book.lock:                                       # told in order: no other change between
            version, done = book.apply(ops)
            if done:
                self.host.tell_panel(instance, {"ops": done, "by": by, "version": version,
                                                **({"agent": agent} if agent else {}),
                                                **({"quiet": True} if quiet else {})})
        return version

    # -- the instance

    def open(self, instance: Instance, args: dict) -> Instance:
        return Instance(**{**instance.to_dict(), "title": instance.gatherer})

    # -- the panel

    def request(self, instance, method, path, query, body):
        if instance is None:
            return Response(404, b"which notebook?")
        try:
            if path == "state" and method == "GET":
                return Response.json(self.book(instance.gatherer).state())
            if path == "image" and method == "POST":
                return Response.json(self.files.keep(body or b""))
            if path.startswith("file/") and method == "GET":
                found = self.files.path(path[5:])
                if found is None:
                    return Response(404, b"no such picture")
                return Response.file_at(found, media.KINDS[found.rsplit(".", 1)[1]], headers=PICTURE_HEADERS)
            if path == "figma" and method == "GET":
                return Response.json({"token": bool(self.figma.token()), "who": self.figma.who()})
            if path in ("ops", "parse", "figma/token", "figma/snap") and method == "POST":
                ask = json.loads(body or b"{}")
                if not isinstance(ask, dict):
                    raise ValueError
                if path == "parse":
                    blocks = self._pictures_in(nb.blocks_from_markdown(str(ask.get("markdown") or "")), None)
                    return Response.json({"blocks": [{**b, "id": nb.new_id()} for b in blocks]})
                if path == "figma/token":
                    return Response.json(self.figma.set_token(str(ask.get("token") or "")))
                if path == "figma/snap":
                    return Response.json(self.snap(instance, str(ask.get("block") or "")))
                by = str(ask.get("by") or "user")[:40]
                return Response.json({"version": self.change(instance, _users(ask.get("ops")), by)})
        except media.MediaError as exc:
            return Response.json({"error": str(exc)}, 400)
        except nb.NotebookError as exc:
            return Response.json({"error": str(exc)}, 400)
        except ValueError:
            return Response.json({"error": "a JSON object, please"}, 400)
        return Response(404, b"not found")

    # -- agents

    def call(self, instance: Instance, tool: str, args: dict, caller: Caller) -> ToolResult:
        book = self.book(instance.gatherer)
        try:
            if tool == "read":
                if not args.get("page"):
                    return ToolResult.text(book.outline())
                page = self._page(book, args.get("page"))
                return ToolResult([{"type": "text", "text": book.markdown(page, caller.channel)},
                                   *self._shown(page)])
            if tool == "add":
                return self._add(instance, book, args, caller)
            if tool == "change":
                return self._change(instance, book, args, caller)
            if tool == "report":
                return self._report(instance, book, args, caller)
        except (nb.NotebookError, media.MediaError) as exc:
            return ToolResult.error(str(exc))
        raise AppError(f"{tool}: not a tool of Notes")

    # -- pictures

    def _shown(self, page: dict) -> List[dict]:
        """The page's pictures, as an agent is given them with its words: each its block's id and caption, then the
        picture -- at most MAX_SHOWN, each small enough for a model to take (an SVG is not one it takes)."""
        out: List[dict] = []
        n = 0
        for b in page.get("blocks", []):
            name = b.get("file") if b["type"] == "image" else b.get("snap") if b["type"] == "figma" else None
            if not name:
                continue
            said = nb.inline_markdown(b.get("text", "")) or b.get("title") or ""
            head = f"[{b['id']}] " + ("the Figma frame's snapshot" if b["type"] == "figma" else "the picture") + (
                f": {said}" if said else "")
            path = self.files.path(name)
            if n >= MAX_SHOWN:
                out.append({"type": "text", "text": f"{head} (not given: {MAX_SHOWN} pictures given already)"})
                continue
            if path is None or name.endswith(".svg"):
                out.append({"type": "text", "text": f"{head} (not given: " + (
                    "an SVG, which can't be shown to you" if path else "its file is missing") + ")"})
                continue
            size = os.path.getsize(path)
            if size > MAX_SHOWN_BYTES:
                out.append({"type": "text", "text": f"{head} (not given: {size / 1e6:.1f} MB is too large)"})
                continue
            with open(path, "rb") as fh:
                data = fh.read()
            out += [{"type": "text", "text": head},
                    {"type": "image", "data": base64.b64encode(data).decode("ascii"),
                     "mimeType": media.KINDS[name.rsplit(".", 1)[1]]}]
            n += 1
        return out

    def _pictures_in(self, blocks: List[dict], caller: Optional[Caller]) -> List[dict]:
        """Blocks from markdown, each image's `src` read in as a picture kept (its `file`): one already kept
        (`image:<file>`); for an agent (`caller`), a file on this machine -- a path from its folder. Else, for the
        panel's paste, the line kept as text; for an agent, MediaError."""
        out = []
        for b in blocks:
            if b["type"] == "figma" and not b.get("title"):
                b = {**b, "title": media.figma_title(b["url"])}
            if b["type"] != "image" or "src" not in b:
                out.append(b)
                continue
            src = b.pop("src")
            try:
                out.append({**b, **self._picture(src, caller)})
            except media.MediaError:
                if caller is not None:
                    raise
                out.append({"type": "text", "text": nb.inline_html(f"![{nb.inline_markdown(b['text'])}]({src})"),
                            "checked": False, "indent": 0})
        return out

    def _picture(self, src: str, caller: Optional[Caller]) -> dict:
        if src.startswith("image:"):
            name = src[6:]
            path = self.files.path(name)
            if path is None:
                raise media.MediaError(f"no picture {name!r} in the notes: `image:` names one notes_read showed")
            with open(path, "rb") as fh:
                return self.files.keep(fh.read())
        if caller is None:
            raise media.MediaError("only an agent's file is read in")
        if src.startswith(("http:", "https:")):
            raise media.MediaError(f"{src}: a picture on the web isn't fetched -- download it to a file first, then "
                                   f"![caption](<its path>)")
        path = src[5:] if src.startswith("file:") else src
        path = os.path.expanduser(urllib.parse.unquote(path) if src.startswith("file:") else path)
        if not os.path.isabs(path):
            path = os.path.join(caller.folder or os.getcwd(), path)
        if not os.path.isfile(path):
            raise media.MediaError(f"no file {path} to show: ![caption](<a picture's path>), absolute or from "
                                   f"your folder")
        if os.path.getsize(path) > media.MAX_IMAGE:
            raise media.MediaError(f"{path} is too large for a picture in the notes")
        with open(path, "rb") as fh:
            return self.files.keep(fh.read())

    def snap(self, instance: Instance, bid: str) -> dict:
        """A figma block's snapshot fetched again -- only if Figma changed the file since -- and its name in Figma: the
        block changed (quietly), and {ok}; or {error}, why not (no change made)."""
        book = self.book(instance.gatherer)
        found = book.block(bid)
        if found is None or found[1]["type"] != "figma":
            return {"error": "no such Figma frame in the notes"}
        page, b = found
        with self._lock:
            if bid in self._snapping:
                return {"ok": True, "busy": True}
            self._snapping.add(bid)
        try:
            got = self.figma.snapshot(b["url"], b.get("snap_mod", "") if b.get("snap") else "")
            put: Dict[str, object] = {"id": bid}
            if got.get("title"):
                put["title"] = got["title"]
            if "data" in got:
                kept = self.files.keep(got["data"])
                put.update(snap=kept["file"], snap_mod=got.get("mod") or "", **{k: kept[k] for k in ("w", "h")
                                                                                if k in kept})
            if put.get("snap") or b.get("snap"):
                put["snap_at"] = round(time.time(), 3)
            self.change(instance, [{"op": "block.put", "page": page["id"], "block": put}], "figma", quiet=True)
            return {"ok": True}
        except media.MediaError as exc:
            return {"error": str(exc)}
        finally:
            with self._lock:
                self._snapping.discard(bid)

    def _snap_soon(self, instance: Instance, ids: List[str]) -> None:
        """Snapshots of new figma blocks fetched, after the tool call has answered."""
        if ids:
            threading.Thread(target=lambda: [self.snap(instance, i) for i in ids], name="notes-figma",
                             daemon=True).start()

    def _page(self, book: nb.Notebook, name) -> dict:
        page = book.page(name) if isinstance(name, str) else None
        if page is None:
            raise nb.NotebookError(f"no page {name!r} in the notebook.\n{book.outline()}")
        return page

    def _source(self, args: dict, caller: Caller) -> dict:
        """What lines an agent writes say of where they came from: written from its own conversation with the user
        (`from_conversation`), it and now -- one dict for all of one call's lines; else nothing (a line changed keeps
        its own)."""
        fc = args.get("from_conversation")
        if fc is not None and not isinstance(fc, bool):
            raise nb.NotebookError("`from_conversation` is true or false")
        if not fc or not caller.channel:
            return {}
        return {"source": caller.channel, "source_at": round(time.time(), 3)}

    def _by(self, caller: Caller) -> str:
        return f"agent:{caller.channel}" if caller.channel else "user"

    def _add(self, instance, book, args, caller) -> ToolResult:
        md = args.get("markdown")
        if md is not None and not isinstance(md, str):
            raise nb.NotebookError("notes_add: `markdown` is text")
        src = self._source(args, caller)
        blocks = [{**b, "id": nb.new_id(), **src}
                  for b in self._pictures_in(nb.blocks_from_markdown(book.page_links(md or "")), caller)]
        name, title = args.get("page"), args.get("title")
        if name:
            page = self._page(book, name)
            after = args.get("after")
            if after == "start":
                after = ""
            elif after is not None and not any(b["id"] == after for b in page.get("blocks", [])):
                raise nb.NotebookError(f"notes_add: no block {after!r} on {page.get('title') or 'that page'}: "
                                       f"`after` is a block's id from notes_read, or \"start\"")
            if not blocks:
                raise nb.NotebookError("notes_add: `markdown` to add")
            ops, prev = [], after
            for b in blocks:
                ops.append({"op": "block.put", "page": page["id"], "block": b, **({"after": prev}
                                                                                   if prev is not None else {})})
                prev = b["id"]
            self.change(instance, ops, self._by(caller), caller.channel)
            self._snap_soon(instance, [b["id"] for b in blocks if b["type"] == "figma"])
            return ToolResult.text(book.markdown(book.page(page["id"])))
        if not isinstance(title, str) or not title.strip():
            raise nb.NotebookError("notes_add: which page -- `page`, one there (its id or title), or `title` for a "
                                   "new one")
        parent = None
        if args.get("parent"):
            parent = self._page(book, args["parent"])["id"]
        pid = nb.new_id()
        self.change(instance, [{"op": "page.new", "page": {"id": pid, "title": title, "icon": args.get("icon") or "",
                                                           "parent": parent},
                                "blocks": blocks or [{"id": nb.new_id(), "type": "text", "text": ""}]}],
                    self._by(caller), caller.channel)
        self._snap_soon(instance, [b["id"] for b in blocks if b["type"] == "figma"])
        return ToolResult.text(book.markdown(book.page(pid)))

    def _change(self, instance, book, args, caller) -> ToolResult:
        page = self._page(book, args.get("page"))
        bid, by = args.get("block"), self._by(caller)
        if not bid:
            if args.get("delete"):
                self.change(instance, [{"op": "page.delete", "page": page["id"]}], by, caller.channel)
                return ToolResult.text(f"{page.get('title') or 'Untitled'} is in the trash, with its subpages: the "
                                       f"user can restore it from the Notes panel.")
            op = {"op": "page.set", "page": page["id"]}
            for k in ("title", "icon"):
                if isinstance(args.get(k), str):
                    op[k] = args[k]
            if args.get("parent") is not None:
                op["parent"] = None if args["parent"] in ("", "top") else self._page(book, args["parent"])["id"]
            if len(op) == 2:
                raise nb.NotebookError("notes_change: a `block` to change, or the page's `title`, `icon` or "
                                       "`parent`, or `delete`")
            self.change(instance, [op], by, caller.channel)
            return ToolResult.text(book.markdown(book.page(page["id"])))
        block = next((b for b in page.get("blocks", []) if b["id"] == bid), None)
        if block is None:
            raise nb.NotebookError(f"no block {bid!r} on {page.get('title') or 'that page'}:\n{book.markdown(page)}")
        md = args.get("markdown")
        if args.get("delete") or md == "":
            ops = [{"op": "block.delete", "page": page["id"], "block": bid}]
        elif isinstance(md, str):
            src = self._source(args, caller)
            made = [{**b, **src} for b in self._pictures_in(nb.blocks_from_markdown(book.page_links(md)), caller)]
            if not made:
                ops = [{"op": "block.delete", "page": page["id"], "block": bid}]
            else:
                if nb.is_work(block):                         # its tick is the user's: kept as it is
                    made[0]["checked"] = bool(block.get("checked"))
                ops = [{"op": "block.put", "page": page["id"], "block": {**made[0], "id": bid}}]
                prev = bid
                for b in made[1:]:
                    b = {**b, "id": nb.new_id()}
                    ops.append({"op": "block.put", "page": page["id"], "block": b, "after": prev})
                    prev = b["id"]
        elif isinstance(args.get("checked"), bool):
            if nb.is_work(block):
                raise nb.NotebookError(f"block {bid} is one of the user's work items: only the user says when one is "
                                       f"done (they accept it in Notes). Say what you did with notes_report, `done` "
                                       f"true if you finished it.")
            if block["type"] != "todo":
                raise nb.NotebookError(f"block {bid} is not a to-do: give `markdown` (`- [x] ...`) to make it one")
            ops = [{"op": "block.put", "page": page["id"], "block": {"id": bid, "checked": args["checked"]}}]
        else:
            raise nb.NotebookError("notes_change: for a block, `markdown` (what it becomes), `checked` (a to-do "
                                   "ticked or not), or `delete`")
        self.change(instance, ops, by, caller.channel)
        self._snap_soon(instance, [op["block"]["id"] for op in ops if op["op"] == "block.put"
                                   and op["block"].get("type") == "figma" and not op["block"].get("snap")])
        return ToolResult.text(book.markdown(book.page(page["id"])))

    def _report(self, instance, book, args, caller) -> ToolResult:
        """An agent's report on a block the user sent it: a line of the block's thread, by the agent, saying whether
        it finished (`done`) and what it made (`results`). Nothing ticked: the user reviews it, and ends it."""
        found = book.block(args.get("block"))
        if found is None:
            raise nb.NotebookError(f"notes_report: no block {args.get('block')!r} in the notebook: `block` is the id "
                                   f"the message from the user's Notes named")
        page, block = found
        mine = [c for c in nb.calls_of(block) if caller.channel and c["to"] == caller.channel]
        if mine and all(c.get("dropped") for c in mine):
            title = page.get("title") or "Untitled"
            return ToolResult.text(f"Not reported: the user took the line on “{title}” back from you. Leave it, "
                                   f"unless they send it to you again.")
        text = args.get("text")
        if not isinstance(text, str) or not text.strip():
            raise nb.NotebookError("notes_report: `text`, your report: one to three lines")
        if len(text) > REPORT_CHARS:
            raise nb.NotebookError(f"notes_report: {len(text)} characters is too long for a report: say in one to "
                                   f"three lines what you did and where it is; the rest stays in your answer")
        made = args.get("results")
        if made is not None and (not isinstance(made, list) or not all(isinstance(r, str) for r in made)):
            raise nb.NotebookError("notes_report: `results` is a list of what you made: files, a branch, a PR")
        lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
        line = {"id": nb.new_id(), "by": self._by(caller), "text": "<br>".join(nb.inline_html(ln) for ln in lines),
                "done": bool(args.get("done")), **({"results": made} if made else {})}
        self.change(instance, [{"op": "thread.add", "page": page["id"], "block": block["id"], "line": line}],
                    self._by(caller), caller.channel)
        where = f"the line on “{page.get('title') or 'Untitled'}”"
        if not nb.is_work(block):                         # a follow-up on a line it wrote: an answer, no work item
            return ToolResult.text(f"Reported beside {where}: the user sees it there.")
        ended = nb.ended_of(block)
        if ended == "canceled":
            return ToolResult.text(f"Reported on {where}. The user canceled that line: leave it.")
        if ended == "done":
            return ToolResult.text(f"Reported on {where}. The user has accepted it as done already.")
        return ToolResult.text(f"Reported on {where}: the user reviews it there, and says when it is done.")


#: How long a report may be: a few lines, not an answer.
REPORT_CHARS = 1_200


def _users(ops):
    """A panel's ops, any thread line in them the user's (`by` "user"), written now: a panel writes as the user."""
    if not isinstance(ops, list):
        return ops
    out = []
    for op in ops:
        if isinstance(op, dict) and op.get("op") == "thread.add" and isinstance(op.get("line"), dict):
            op = {**op, "line": {**op["line"], "by": "user", "at": None}}
        out.append(op)
    return out
