"""The Notes app's backend (app.toml): each gatherer's notebook (notebook.py), kept in a file of the app's data folder,
changed by its panels' ops and by agents' tools, each change told to every open panel in the order it was made.

The panel's routes (its own origin, /api/...):

    GET  state                  the notebook: {version, pages}
    POST ops    {by, ops}       ops applied: {version}; told to the panels as {ops, by, version}
    POST parse  {markdown}      blocks made from pasted markdown, with new ids (nothing changed)

The tools (notes_read, notes_add, notes_change) read and write it as markdown; what an agent changes is told to the
panels with its channel, so the panel shows who changed what. Lines an agent writes from its own conversation with the
user (`from_conversation`) name it as their source, and when (notebook.py), for the user to follow up on with it.
notes_report is an agent's report on a block the user sent it: a line of the block's thread, by it -- whether it says it
finished, and what it made (refused from an agent the user took the line back from). Only the user ends a work item
(notebook.py): no tool ticks one, or says it is done. A line of a thread a panel adds is the user's, whatever it
says."""
import json
import os
import threading
import time
import urllib.parse
from typing import Dict, Optional

from app_kit import App, AppError, Caller, Instance, Response, ToolResult

from . import notebook as nb


class NotesApp(App):
    def __init__(self):
        self._books: Dict[str, nb.Notebook] = {}
        self._lock = threading.Lock()

    # -- the notebooks

    def book(self, gatherer: str) -> nb.Notebook:
        """The gatherer's notebook, read once from its file."""
        with self._lock:
            got = self._books.get(gatherer)
            if got is None:
                name = urllib.parse.quote(gatherer, safe="") or "_"
                got = self._books[gatherer] = nb.Notebook(os.path.join(self.host.folder(), f"{name}.json"))
            return got

    def change(self, instance: Instance, ops: list, by: str, agent: Optional[str] = None) -> int:
        """`ops` applied to the instance's notebook and told to its panels, in the order applied."""
        book = self.book(instance.gatherer)
        with book.lock:                                       # told in order: no other change between
            version, done = book.apply(ops)
            if done:
                self.host.tell_panel(instance, {"ops": done, "by": by, "version": version,
                                                **({"agent": agent} if agent else {})})
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
            if path in ("ops", "parse") and method == "POST":
                ask = json.loads(body or b"{}")
                if not isinstance(ask, dict):
                    raise ValueError
                if path == "parse":
                    blocks = nb.blocks_from_markdown(str(ask.get("markdown") or ""))
                    return Response.json({"blocks": [{**b, "id": nb.new_id()} for b in blocks]})
                by = str(ask.get("by") or "user")[:40]
                return Response.json({"version": self.change(instance, _users(ask.get("ops")), by)})
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
                return ToolResult.text(book.markdown(self._page(book, args.get("page")), caller.channel))
            if tool == "add":
                return self._add(instance, book, args, caller)
            if tool == "change":
                return self._change(instance, book, args, caller)
            if tool == "report":
                return self._report(instance, book, args, caller)
        except nb.NotebookError as exc:
            return ToolResult.error(str(exc))
        raise AppError(f"{tool}: not a tool of Notes")

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
        blocks = [{**b, "id": nb.new_id(), **src} for b in nb.blocks_from_markdown(book.page_links(md or ""))]
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
            made = [{**b, **src} for b in nb.blocks_from_markdown(book.page_links(md))]
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
