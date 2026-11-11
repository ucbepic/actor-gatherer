"""A gatherer's notebook, the Notes app's: pages (each under another, or at the top), each a list of blocks -- text,
headings, to-dos, lists, quotes, code, dividers -- kept in one JSON file in the app's data folder. It changes only by
ops, applied one batch at a time, whether they come from the panel (the user typing) or from an agent's tools; agents
read and write it as markdown.

    Notebook(path)              the notebook kept in that file (written when first changed)
      .state()                  everything, as the panel draws it: {version, pages}
      .apply(ops)               a batch of ops applied in order: (version, the ops as applied); NotebookError for an
                                op that is not one (nothing of the batch applied then)
      .page(name)               a page that is not in the trash, by its id or its title
      .outline()                its pages as an agent reads them
      .markdown(page)           a page's blocks as markdown, each line its block's id first
    blocks_from_markdown(text)  blocks ({type, text, checked, indent}, no id) from markdown
    inline_html(md)             a line's markdown (bold, italic, code, links) as a block's text
    inline_markdown(html, title?)   the reverse (`title`: a page's title now, for a link to that page)
    clean_html(text)            a block's text kept to the inline tags it may hold
    new_id()                    a page's or a block's id

The ops (each a dict, `op` its kind):

    page.new      {page: {id, title?, icon?, parent?}, blocks?: [block]}
    page.set      {page, title?, icon?, parent?}
    page.delete   {page}            into the trash, with its subpages
    page.restore  {page}            out of it, with what went in with it
    page.purge    {page}            gone for good, with its subpages (a page in the trash only)
    block.put     {page, block: {id, type?, text?, checked?, indent?, to?, sent?, extra?, group?, work?, ended?,
                  ended_at?}, after?}   a new block
                                    (after the block `after`; "": first; none: last), or what is given of one there
                                    changed
    block.move    {page, block, after}
    block.delete  {page, block}      (its thread with it)
    thread.add    {page, block, line: {id, by, text, at?, done?, results?}}   a line of the block's thread, at its end

A block sent to an agent (the panel sends it, as the user's message: an actor of the gatherer, or its gatherer agent)
says so: `to`, the actor's channel, `sent`, when, and `extra`, what the user added to it when they sent it (their
instructions beyond the line's words), if anything; `group`, when it went with other lines in one message, an id
those lines share (a line sent alone again has none). What is said about it after -- the user's replies, sent to that
agent too, and the agent's reports (the Notes app's notes_report) -- is the block's `thread`: lines, each `by` "user" or
"agent:<its channel>", in the order written; an agent's report may say it finished (`done`) and name what it made
(`results`: files, a branch, a PR). An `agents` block holds no text: the panel draws the gatherer's actors there, as
they are now; a `work` block, the user's open work items.

WORK ITEMS: the lines the user tracks -- each sent to an agent (`to`), or marked as one (`work`, kept when it is sent,
so a line sent to no one again is still one). The user alone says when one is over (`ended`, "done" or "canceled", and
`ended_at`): a to-do work item is done as it is ticked. How one stands otherwise (sent, worked on, waiting for the user's
review) is not kept: the panel reads it from its actor, as it is now.

A block an agent wrote from its own conversation with the user -- what it found, worked out or decided with them, not
words the user told it to put down (the Notes app's notes_add and notes_change, `from_conversation`) -- names its
SOURCE: `source`, that agent's channel, and `source_at`, when it wrote it: the conversation, and the point in it. Lines
written by one call share both, and show as one. The user's follow-ups on them go to that agent and, with its replies,
are the block's thread. Retyped -- by the user, or by an agent not from its conversation -- a block keeps its source.

A LINK TO A PAGE: an `a` whose href is `page:<the page's id>` (markdown: `[its title](page:<id>)`). Its words are the
page's title when it was linked; the panel and the markdown agents read show the title the page has now, and the id
stays the same however the page is renamed or moved.

PICTURES: an `image` block shows a picture kept in the app's files (media.py), `file` its name there (its contents'
hash and its kind), `w` and `h` its size in pixels, `width` how wide it is drawn (a percent of the page's width; none:
as wide as it is, up to the page's); a `figma` block shows a frame or board of Figma live, `url` its link, `title` its
name in Figma, and `snap` (`w`, `h`, `snap_at`, `snap_mod`: Figma's last change to it) a picture of it kept from when it
was last fetched, shown when Figma can't show it and given to agents. The words of either (`text`) are its caption.
Markdown: `![caption](image:<file>)`, and `[Figma: title](url) -- caption`; an agent's `![caption](<a file>)` is the
backend's to read in (blocks_from_markdown leaves it as `src`).

An op naming a page or block that is not there (another window deleted it) is skipped, not refused: the panel and the
agents change the notebook at once, and the one later never undoes the other. Standard library only."""

import html
import json
import os
import re
import secrets
import threading
import time
from html.parser import HTMLParser
from typing import Any, Callable, Dict, List, Optional, Tuple

TYPES = ("text", "h1", "h2", "h3", "todo", "bullet", "number", "quote", "code", "divider", "agents", "work", "image",
         "figma")
#: the blocks that show a picture, their words its caption
MEDIA = ("image", "figma")
#: a picture kept in the app's files (media.py): its contents' hash, and its kind
FILE = re.compile(r"^[a-f0-9]{16}\.(?:png|jpg|gif|webp|svg)$")
#: a link to a file of Figma's -- a design, a FigJam board, a prototype, slides -- that its embed shows
FIGMA_URL = re.compile(r"^https://(?:www\.)?figma\.com/(?:design|file|board|proto|slides|deck)/[A-Za-z0-9]{6,64}"
                       r"(?:[/?#][^\s<>\"']*)?$")
MAX_SIDE = 100_000
#: the blocks that may be set in (the rest are always at the left edge)
INDENTED = ("text", "todo", "bullet", "number", "quote")
MAX_INDENT = 6
MAX_TEXT = 20_000
MAX_TITLE = 300
ID = re.compile(r"^[a-z0-9]{6,24}$")
PAGE_HREF = re.compile(r"^page:[a-z0-9]{6,24}$")
#: an actor's channel, as a block sent to one names it (a session's id, a codex thread's)
CHANNEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")
#: who wrote a thread's line: the user, or an agent (its channel)
BY = re.compile(r"^(user|agent:[A-Za-z0-9][A-Za-z0-9._:-]{0,99})$")
#: the blocks that are sent to no one (nothing in them to send; a picture's caption is not a line of work)
UNSENT = ("divider", "agents", "work", "image", "figma")
#: how the user ended a work item
ENDED = ("done", "canceled")
MAX_RESULTS = 8                   # what a report names it made
MAX_RESULT = 300
MAX_THREAD = 200                  # a block's thread keeps its last lines
MAX_LINE = 4_000
_ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789"


class NotebookError(ValueError):
    """An op that is not one: what is wrong with it."""


def new_id() -> str:
    return "".join(secrets.choice(_ID_CHARS) for _ in range(8))


def is_work(b: dict) -> bool:
    """A work item: a line sent to an agent, or marked as one."""
    return b.get("type") not in UNSENT and bool(b.get("to") or b.get("work"))


def ended_of(b: dict) -> str:
    """How the user ended a work item -- "done", "canceled" -- or "" (open; not one). A to-do one is done as it is
    ticked (one ticked before work items were ended has no `ended`)."""
    if not is_work(b):
        return ""
    return b.get("ended") or ("done" if b.get("type") == "todo" and b.get("checked") else "")


# ---------------------------------------------------------------- a block's text


class _Cleaner(HTMLParser):
    """A block's text as the inline tags it may hold (b, i, u, s, code, a with a web or mail link, br), the rest of
    any markup dropped and its text kept -- but a script's or a style's, dropped with it."""

    TAGS = {"b": "b", "strong": "b", "i": "i", "em": "i", "u": "u", "s": "s", "strike": "s", "del": "s",
            "code": "code", "a": "a"}
    DROP = {"script", "style", "template", "head", "title"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: List[str] = []
        self.open: List[str] = []
        self.dropping = 0
        self.blocks = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.DROP:
            self.dropping += 1
            return
        if self.dropping:
            return
        if tag == "br":
            self.out.append("<br>")
        elif tag in ("div", "p", "li"):                      # a line of pasted or browser-made markup: a line break
            if self.blocks and self.out and self.out[-1] != "<br>":
                self.out.append("<br>")
            self.blocks += 1
        elif tag in self.TAGS:
            t = self.TAGS[tag]
            if t == "a":
                href = dict(attrs).get("href") or ""
                if not re.match(r"^(https?:|mailto:)", href.strip(), re.I) and not PAGE_HREF.match(href.strip()):
                    return
                self.out.append(f'<a href="{html.escape(href.strip(), quote=True)}">')
            else:
                self.out.append(f"<{t}>")
            self.open.append(t)

    def handle_startendtag(self, tag, attrs):
        if tag == "br" and not self.dropping:
            self.out.append("<br>")

    def handle_endtag(self, tag):
        if tag in self.DROP:
            self.dropping = max(0, self.dropping - 1)
            return
        t = self.TAGS.get(tag)
        if self.dropping or t is None or t not in self.open:
            return
        while self.open:                                     # what was opened inside it, closed with it
            last = self.open.pop()
            self.out.append(f"</{last}>")
            if last == t:
                break

    def handle_data(self, data):
        if not self.dropping:
            self.out.append(html.escape(data, quote=False))

    def text(self) -> str:
        self.close()
        out = "".join(self.out) + "".join(f"</{t}>" for t in reversed(self.open))
        out = re.sub(r"<(b|i|u|s|code)></\1>", "", out)
        return re.sub(r"(<br>)+$", "", out) if out.replace("<br>", "") == "" else out


def clean_html(text: Any) -> str:
    if not isinstance(text, str) or not text:
        return ""
    c = _Cleaner()
    c.feed(text[:MAX_TEXT * 2])
    return c.text()[:MAX_TEXT]


class _Markdowner(HTMLParser):
    MARKS = {"b": "**", "i": "*", "s": "~~", "code": "`", "u": ""}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: List[str] = []
        self.hrefs: List[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "br":
            self.out.append("<br>")
        elif tag == "a":
            self.hrefs.append(dict(attrs).get("href") or "")
            self.out.append("[")
        elif tag in self.MARKS:
            self.out.append(self.MARKS[tag])

    def handle_endtag(self, tag):
        if tag == "a" and self.hrefs:
            self.out.append(f"]({self.hrefs.pop()})")
        elif tag in self.MARKS:
            self.out.append(self.MARKS[tag])

    def handle_data(self, data):
        self.out.append(data)


def inline_markdown(text: str, title: Optional[Callable[[str], Optional[str]]] = None) -> str:
    """A block's text (clean_html's) as markdown: **bold**, *italic*, ~~struck~~, `code`, [links](url), <br>. A link to
    a page says the title `title(its id)` gives (the page's now), if it gives one; else the words it was linked with."""
    if title:
        def now(m: "re.Match[str]") -> str:
            name = title(m.group(1))
            return m.group(0) if name is None else f'<a href="page:{m.group(1)}">{html.escape(name, quote=False)}</a>'
        text = _PAGE_LINK.sub(now, text or "")
    m = _Markdowner()
    m.feed(text or "")
    m.close()
    return "".join(m.out)


_CODE = re.compile(r"`([^`]+)`")
_LINK = re.compile(r"\[([^\]]+)\]\(((?:https?:|mailto:)[^)\s]+|page:[a-z0-9]{6,24})\)")
_PAGE_LINK = re.compile(r'<a href="page:([a-z0-9]{6,24})">(.*?)</a>', re.S)
_STYLES = ((re.compile(r"\*\*(?=\S)(.+?)(?<=\S)\*\*"), "b"), (re.compile(r"__(?=\S)(.+?)(?<=\S)__"), "b"),
           (re.compile(r"~~(?=\S)(.+?)(?<=\S)~~"), "s"),
           (re.compile(r"(?<![*\w])\*(?=\S)(.+?)(?<=\S)\*(?![*\w])"), "i"),
           (re.compile(r"(?<![_\w])_(?=\S)(.+?)(?<=\S)_(?![_\w])"), "i"))


def inline_html(md: str) -> str:
    """A line's markdown as a block's text: the reverse of inline_markdown (anything else in it is text)."""
    held: List[str] = []

    def hold(s: str) -> str:
        held.append(s)
        return f"\x00{len(held) - 1}\x00"

    out = _CODE.sub(lambda m: hold(f"<code>{html.escape(m.group(1), quote=False)}</code>"), md or "")
    out = html.escape(out, quote=False)
    out = _LINK.sub(lambda m: hold(f'<a href="{html.escape(html.unescape(m.group(2)), quote=True)}">') + m.group(1)
                    + hold("</a>"), out)
    for rx, tag in _STYLES:
        out = rx.sub(lambda m, t=tag: f"<{t}>{m.group(1)}</{t}>", out)
    out = re.sub(r"&lt;br\s*/?&gt;", "<br>", out)
    while "\x00" in out:
        out = re.sub(r"\x00(\d+)\x00", lambda m: held[int(m.group(1))], out)
    return clean_html(out)


# ---------------------------------------------------------------- markdown, for agents


_FENCE = re.compile(r"^(\s*)```")
_ID_PREFIX = re.compile(r"^\[[a-z0-9]{6,24}\]\s?")          # an id notes_read put before a line, copied back with it
_LINE_RULES = (
    (re.compile(r"^(?:-{3,}|\*{3,}|_{3,})$"), lambda m: ("divider", "", False)),
    (re.compile(r"^(#{1,6})\s+(.*)$"), lambda m: (f"h{min(3, len(m.group(1)))}", m.group(2), False)),
    (re.compile(r"^[-*+]\s+\[([ xX])\](?!\()\s*(.*)$"),        # (not "- [x](...)": a list item, a link in it)
     lambda m: ("todo", m.group(2), m.group(1) != " ")),
    (re.compile(r"^\[([ xX])\]\s+(.*)$"), lambda m: ("todo", m.group(2), m.group(1) != " ")),
    (re.compile(r"^[-*+•]\s+(.*)$"), lambda m: ("bullet", m.group(1), False)),
    (re.compile(r"^\d+[.)]\s+(.*)$"), lambda m: ("number", m.group(1), False)),
    (re.compile(r"^>\s?(.*)$"), lambda m: ("quote", m.group(1), False)),
)


_IMAGE_LINE = re.compile(r"^!\[([^\]]*)\]\(\s*<?([^()<>\s][^()<>]*?)>?\s*\)$")
_FIGMA_LINE = re.compile(r"^(?:\[([^\]]*)\]\(\s*<?(https://[^)\s>]+)>?\s*\)|<?(https://[^\s>]+)>?)"
                         r"(?:\s+(?:--|—|–|-)\s+(.*))?$")


def _media_line(body: str) -> Optional[dict]:
    """A line that is a picture: `![caption](where)` an image (`src` where it is, for the backend to read in), a link to
    Figma alone on the line (or `[Figma: title](url) -- caption`) a frame of it."""
    m = _IMAGE_LINE.match(body)
    if m:
        return {"type": "image", "text": inline_html(m.group(1)), "src": m.group(2).strip()}
    m = _FIGMA_LINE.match(body)
    if m and FIGMA_URL.match(m.group(2) or m.group(3) or ""):
        url = html.unescape(m.group(2) or m.group(3))
        words = (m.group(1) or "").strip()
        title = re.sub(r"^figma:\s*", "", words, flags=re.I) if words and words != url else ""
        return {"type": "figma", "text": inline_html(m.group(4) or ""), "url": url, "title": _title(title)}
    return None


def blocks_from_markdown(text: str) -> List[dict]:
    """Markdown as blocks, one a line (a fenced code block one block): `# ` headings, `- [ ] ` to-dos, `- ` and `1. `
    lists, `> ` quotes, `---` dividers, `![caption](where)` a picture, a Figma link alone a frame of it, the rest
    text; two spaces (or a tab) in, a level in. Blank lines go."""
    lines = (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out: List[dict] = []
    i = 0
    while i < len(lines):
        line = _ID_PREFIX.sub("", lines[i].lstrip(), count=1)
        lead = lines[i][:len(lines[i]) - len(lines[i].lstrip())]
        line = lead + line
        fence = _FENCE.match(line)
        if fence:
            pad = len(fence.group(1))
            body: List[str] = []
            i += 1
            while i < len(lines) and not _FENCE.match(lines[i]):
                body.append(lines[i][pad:] if lines[i][:pad].strip() == "" else lines[i].lstrip())
                i += 1
            i += 1                                           # the closing fence
            out.append({"type": "code", "text": "\n".join(body)[:MAX_TEXT], "checked": False, "indent": 0})
            continue
        i += 1
        if not line.strip():
            continue
        spaces = len(line.expandtabs(2)) - len(line.expandtabs(2).lstrip())
        body = line.strip()
        media = _media_line(body)
        if media:
            out.append({**media, "checked": False, "indent": 0})
            continue
        kind, words, checked = "text", body, False
        for rx, made in _LINE_RULES:
            m = rx.match(body)
            if m:
                kind, words, checked = made(m)
                break
        indent = min(MAX_INDENT, spaces // 2) if kind in INDENTED else 0
        out.append({"type": kind, "text": "" if kind == "divider" else inline_html(words), "checked": checked,
                    "indent": indent})
    return out


def _numbers(blocks: List[dict]) -> List[Optional[int]]:
    """Each numbered block's number: counted along a run at its level, deeper blocks not breaking it."""
    counts: Dict[int, int] = {}
    out: List[Optional[int]] = []
    for b in blocks:
        k = b.get("indent", 0)
        for deeper in [d for d in counts if d > k]:
            del counts[deeper]
        if b["type"] == "number":
            counts[k] = counts.get(k, 0) + 1
            out.append(counts[k])
        else:
            counts.pop(k, None)
            out.append(None)
    return out


def markdown_lines(blocks: List[dict], ids: bool = True,
                   title: Optional[Callable[[str], Optional[str]]] = None) -> List[str]:
    lines: List[str] = []
    for b, n in zip(blocks, _numbers(blocks)):
        tag = f"[{b['id']}] " if ids else ""
        pad = "  " * b.get("indent", 0)
        t, words = b["type"], inline_markdown(b.get("text", ""), title) if b["type"] != "code" else ""
        if t == "code":
            lines.append(f"{tag}```")
            lines.extend((b.get("text") or "").split("\n"))
            lines.append("```")
            continue
        if t == "agents":
            lines.append(f"{tag}(a table of the gatherer's actors, as they are now: the user sees it in Notes)")
            continue
        if t == "work":
            lines.append(f"{tag}(a list of the user's open work items, as they are now: the user sees it in Notes)")
            continue
        if t == "image":
            lines.append(f"{tag}![{words}](image:{b.get('file', '')})")
            continue
        if t == "figma":
            name = b.get("title") or "a frame"
            lines.append(f"{tag}[Figma: {name}]({b.get('url', '')})" + (f" -- {words}" if words else ""))
            continue
        head = {"text": "", "h1": "# ", "h2": "## ", "h3": "### ", "bullet": "- ", "quote": "> ", "divider": "---",
                "todo": "- [x] " if b.get("checked") else "- [ ] ", "number": f"{n}. "}[t]
        lines.append(f"{tag}{pad}{head}{words}".rstrip() if t == "divider" else f"{tag}{pad}{head}{words}")
    return lines


# ---------------------------------------------------------------- the notebook


def _now() -> float:
    return round(time.time(), 3)


class Notebook:
    def __init__(self, path: str):
        self.path = path
        self.lock = threading.RLock()
        self.version = 0
        self.pages: List[dict] = []
        if os.path.isfile(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    d = json.load(fh)
                self.version = int(d.get("version") or 0)
                self.pages = [p for p in d.get("pages") or [] if isinstance(p, dict) and ID.match(str(p.get("id")))]
            except (OSError, ValueError, TypeError):
                bad = f"{path}.unreadable-{int(time.time())}"         # kept aside, never written over
                try:
                    os.replace(path, bad)
                except OSError:
                    pass

    # -- reading

    def state(self) -> dict:
        with self.lock:
            return json.loads(json.dumps({"version": self.version, "pages": self.pages}))

    def _get(self, pid: Any) -> Optional[dict]:
        return next((p for p in self.pages if p["id"] == pid), None)

    def page(self, name: Any) -> Optional[dict]:
        """A page not in the trash: by its id, else by its title (case aside), else by the start of one."""
        if not isinstance(name, str) or not name.strip():
            return None
        name = name.strip()
        live = [p for p in self.pages if not p.get("deleted")]
        for test in (lambda p: p["id"] == name, lambda p: p.get("title", "").strip().lower() == name.lower(),
                     lambda p: p.get("title", "").strip().lower().startswith(name.lower())):
            got = [p for p in live if test(p)]
            if got:
                return got[0]
        return None

    def link_title(self, pid: str) -> Optional[str]:
        """What a link to that page says now: its title (and that it is in the trash, if it is); None: no such page."""
        p = self._get(pid)
        if p is None:
            return None
        return (p.get("title") or "Untitled") + (" (in the trash)" if p.get("deleted") else "")

    def page_links(self, md: str) -> str:
        """Markdown an agent wrote, its links to pages by id and said as the page's title: `[words](page:<an id, or a
        title>)` made `[its title](page:<its id>)` (the words kept, if the title would break the link). NotebookError
        for a page that is not there, so the agent can look it up."""
        def one(m: "re.Match[str]") -> str:
            words, name = m.group(1), m.group(2).strip()
            p = self._get(name) if ID.match(name) else None
            p = p or self.page(name)
            if p is None:
                raise NotebookError(f"no page {name!r} to link to: a link to a page is [its title](page:<its id>), "
                                    f"the id from notes_read.\n{self.outline()}")
            title = p.get("title") or "Untitled"
            return f"[{words if re.search(r'[][]', title) else title}](page:{p['id']})"
        with self.lock:
            return re.sub(r"\[([^\]\n]*)\]\(page:([^)\n]+)\)", one, md or "")

    def children(self, pid: Optional[str], deleted: bool = False) -> List[dict]:
        return [p for p in self.pages if p.get("parent") == pid and bool(p.get("deleted")) == deleted]

    def _descendants(self, pid: str) -> List[dict]:
        out, todo = [], [pid]
        while todo:
            here = todo.pop()
            for p in self.pages:
                if p.get("parent") == here and p not in out:
                    out.append(p)
                    todo.append(p["id"])
        return out

    def outline(self) -> str:
        with self.lock:
            trash = [p for p in self.pages if p.get("deleted") and p.get("deleted_with") == p["id"]]
            binned = ("In the trash (the user can restore them): "
                      + ", ".join(p.get("title") or "Untitled" for p in trash))
            if not any(not p.get("deleted") for p in self.pages):
                return "\n".join(["The notebook has no pages yet. notes_add with a `title` makes one.",
                                  *([binned] if trash else [])])
            lines = ["The notebook's pages (id: title):"]

            def walk(pid: Optional[str], depth: int) -> None:
                for p in self.children(pid):
                    todos = [b for b in p.get("blocks", []) if b["type"] == "todo"]
                    left = sum(1 for b in todos if not b.get("checked"))
                    work = sum(1 for b in p.get("blocks", []) if is_work(b) and not ended_of(b))
                    said = ([f"{left} of {len(todos)} to-dos open"] if todos else []) + (
                        [f"{work} work item{'' if work == 1 else 's'} open"] if work else [])
                    note = f" ({', '.join(said)})" if said else ""
                    lines.append(f"{'  ' * depth}- {p['id']}: {(p.get('icon') or '') + ' ' if p.get('icon') else ''}"
                                 f"{p.get('title') or 'Untitled'}{note}")
                    walk(p["id"], depth + 1)
            walk(None, 0)
            if trash:
                lines.append(binned)
            return "\n".join(lines)

    def markdown(self, page: dict, me: Optional[str] = None) -> str:
        """The page as an agent reads it: its blocks, each line its id first; then the blocks sent to agents, each with
        who it went to and its thread (`me`: the reading agent's channel, said as "you")."""
        with self.lock:
            parent = self._get(page.get("parent"))
            head = f"# {(page.get('icon') + ' ') if page.get('icon') else ''}{page.get('title') or 'Untitled'}"
            where = f"page {page['id']}" + (f", under {parent.get('title') or 'Untitled'} ({parent['id']})"
                                           if parent else "")
            lines = [f"{head}   ({where})", ""]
            body = markdown_lines(page.get("blocks", []), title=self.link_title)
            lines.extend(body or ["(no blocks yet)"])
            sent = [b for b in page.get("blocks", []) if is_work(b) or (b.get("thread") and not b.get("source"))]
            if sent:
                who = lambda by: ("the user" if by == "user"                       # noqa: E731
                                  else f"actor {by[6:]}{' (you)' if me and by[6:] == me else ''}")
                flat = lambda h: " / ".join(inline_markdown(h, self.link_title).splitlines())        # noqa: E731
                lines += ["", "The user's work items on this page (each: who it went to, whether the user has ended "
                              "it -- only the user says when one is done -- then what was said about it):"]
                for b in sent:
                    to, ended = b.get("to"), ended_of(b)
                    lines.append(f"- [{b['id']}] " + (f"sent to actor {to}{' (you)' if me and to == me else ''}"
                                                      if to else "sent to no one yet")
                                 + (f", with: {flat(b['extra'])}" if b.get("extra") else "")
                                 + {"done": "; the user accepted it as done", "canceled": "; the user canceled it",
                                    "": ""}[ended])
                    for line in b.get("thread") or []:
                        made = f" (made: {', '.join(line['results'])})" if line.get("results") else ""
                        said = " (said it is done)" if line.get("done") and line["by"] != "user" else ""
                        lines.append(f"    {who(line['by'])}: {flat(line['text'])}{said}{made}")
            lines += sources_lines(page.get("blocks", []), me, self.link_title)
            subs = self.children(page["id"])
            if subs:
                lines += ["", "Subpages: " + ", ".join(f"{p.get('title') or 'Untitled'} ({p['id']})" for p in subs)]
            return "\n".join(lines)

    def block(self, bid: Any) -> Optional[Tuple[dict, dict]]:
        """The block with that id, on a page not in the trash, and its page; None if there is none."""
        if not isinstance(bid, str):
            return None
        with self.lock:
            for p in self.pages:
                if p.get("deleted"):
                    continue
                b = next((x for x in p.get("blocks", []) if x["id"] == bid), None)
                if b is not None:
                    return p, b
            return None

    # -- changing

    def apply(self, ops: Any) -> Tuple[int, List[dict]]:
        """The batch applied in order and kept: the new version, and the ops as applied (cleaned; what deleting or
        restoring a page took with it named), for the panels to apply in turn. Nothing of a batch with an op that is
        not one is applied."""
        if not isinstance(ops, list):
            raise NotebookError("ops: a list")
        with self.lock:
            before = json.dumps(self.pages)
            done: List[dict] = []
            try:
                for op in ops:
                    got = self._one(op)
                    if got is not None:
                        done.append(got)
            except NotebookError:
                self.pages = json.loads(before)
                raise
            if done:
                self.version += 1
                self._save()
            return self.version, done

    def _save(self) -> None:
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        tmp = f"{self.path}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"version": self.version, "pages": self.pages}, fh, ensure_ascii=False)
        os.replace(tmp, self.path)

    def _one(self, op: Any) -> Optional[dict]:
        if not isinstance(op, dict) or not isinstance(op.get("op"), str):
            raise NotebookError(f"not an op: {str(op)[:120]}")
        kind = op["op"]
        if kind == "page.new":
            return self._page_new(op)
        page = self._get(op.get("page"))
        if kind in ("page.set", "page.delete", "page.restore", "page.purge", "block.put", "block.move",
                    "block.delete", "thread.add"):
            if not isinstance(op.get("page"), str):
                raise NotebookError(f"{kind}: which page (`page`, its id)")
            if page is None:
                return None
        else:
            raise NotebookError(f"{kind}: not an op of the notebook's")
        if kind == "page.set":
            return self._page_set(page, op)
        if kind == "page.delete":
            if page.get("deleted"):
                return None
            at = _now()
            gone = [page, *[p for p in self._descendants(page["id"]) if not p.get("deleted")]]
            for p in gone:
                p["deleted"], p["deleted_with"] = at, page["id"]
            return {"op": kind, "page": page["id"], "at": at, "pages": [p["id"] for p in gone]}
        if kind == "page.restore":
            if not page.get("deleted"):
                return None
            back = [p for p in self.pages if p.get("deleted") and p.get("deleted_with") == page.get("deleted_with")
                    and (p is page or p in self._descendants(page["id"]))]
            for p in back:
                p.pop("deleted", None)
                p.pop("deleted_with", None)
            parent = self._get(page.get("parent"))
            if page.get("parent") and (parent is None or parent.get("deleted")):
                page["parent"] = None                         # its parent gone, or still in the trash: at the top
            return {"op": kind, "page": page["id"], "pages": [p["id"] for p in back], "parent": page.get("parent")}
        if kind == "page.purge":
            if not page.get("deleted"):
                raise NotebookError("page.purge: only a page in the trash")
            gone = {page["id"], *(p["id"] for p in self._descendants(page["id"]))}
            self.pages = [p for p in self.pages if p["id"] not in gone]
            return {"op": kind, "page": page["id"], "pages": sorted(gone)}
        if kind == "block.put":
            return self._block_put(page, op)
        if kind == "thread.add":
            return self._thread_add(page, op)
        blocks = page.setdefault("blocks", [])
        bid = op.get("block")
        i = next((n for n, b in enumerate(blocks) if b["id"] == bid), None)
        if i is None:
            return None
        if kind == "block.delete":
            blocks.pop(i)
            page["updated"] = _now()
            return {"op": kind, "page": page["id"], "block": bid}
        b = blocks.pop(i)                                     # block.move
        at = self._place(blocks, op.get("after", None), kind)
        blocks.insert(at, b)
        page["updated"] = _now()
        return {"op": kind, "page": page["id"], "block": bid, "after": blocks[at - 1]["id"] if at else ""}

    def _place(self, blocks: List[dict], after: Any, kind: str) -> int:
        """Where a block goes in `blocks`: after the block `after` ("": first); none, or one not there: last."""
        if after == "":
            return 0
        if after is None:
            return len(blocks)
        if not isinstance(after, str):
            raise NotebookError(f"{kind}: `after` is a block's id, or \"\" for the first")
        i = next((n for n, b in enumerate(blocks) if b["id"] == after), None)
        return len(blocks) if i is None else i + 1

    def _page_new(self, op: dict) -> Optional[dict]:
        given = op.get("page")
        if not isinstance(given, dict) or not ID.match(str(given.get("id") or "")):
            raise NotebookError("page.new: `page` is {id, title?, icon?, parent?}, its id 6-24 of a-z and 0-9")
        if self._get(given["id"]):
            return None                                       # sent again: made already
        parent = given.get("parent")
        if parent is not None and (not isinstance(parent, str) or self._get(parent) is None):
            parent = None
        at = _now()
        page = {"id": given["id"], "title": _title(given.get("title")), "icon": _icon(given.get("icon")),
                "parent": parent, "created": at, "updated": at, "blocks": []}
        for b in op.get("blocks") or []:
            made = _block({**b, "id": b.get("id") or new_id()} if isinstance(b, dict) else b, None, "page.new")
            if not any(x["id"] == made["id"] for x in page["blocks"]):
                page["blocks"].append(made)
        self.pages.append(page)
        return {"op": "page.new", "page": {k: page[k] for k in ("id", "title", "icon", "parent", "created",
                                                                 "updated")}, "blocks": page["blocks"]}

    def _page_set(self, page: dict, op: dict) -> Optional[dict]:
        out: Dict[str, Any] = {"op": "page.set", "page": page["id"]}
        if "title" in op:
            page["title"] = out["title"] = _title(op.get("title"))
        if "icon" in op:
            page["icon"] = out["icon"] = _icon(op.get("icon"))
        if "parent" in op:
            parent = op.get("parent")
            if parent is not None:
                if not isinstance(parent, str) or self._get(parent) is None:
                    raise NotebookError("page.set: `parent` is a page's id, or null for the top")
                if parent == page["id"] or parent in {p["id"] for p in self._descendants(page["id"])}:
                    raise NotebookError("page.set: a page can't go under itself or its own subpages")
            page["parent"] = out["parent"] = parent
        if len(out) == 2:
            return None
        page["updated"] = _now()
        return out

    def _thread_add(self, page: dict, op: dict) -> Optional[dict]:
        b = next((x for x in page.get("blocks", []) if x["id"] == op.get("block")), None)
        if b is None:
            return None
        line = _line(op.get("line"), "thread.add")
        thread = b.setdefault("thread", [])
        if any(x["id"] == line["id"] for x in thread):
            return None                                       # sent again: there already
        thread.append(line)
        del thread[:-MAX_THREAD]
        page["updated"] = _now()
        return {"op": "thread.add", "page": page["id"], "block": b["id"], "line": line}

    def _block_put(self, page: dict, op: dict) -> Optional[dict]:
        given = op.get("block")
        if not isinstance(given, dict) or not ID.match(str(given.get("id") or "")):
            raise NotebookError("block.put: `block` is {id, type?, text?, checked?, indent?}, its id 6-24 of a-z "
                                "and 0-9")
        blocks = page.setdefault("blocks", [])
        there = next((b for b in blocks if b["id"] == given["id"]), None)
        if there is None:
            made = _block(given, None, "block.put")
            at = self._place(blocks, op.get("after", None), "block.put")
            blocks.insert(at, made)
            page["updated"] = _now()
            return {"op": "block.put", "page": page["id"], "block": made, "after": blocks[at - 1]["id"] if at else ""}
        changed = _block({**there, **given}, there, "block.put")
        if changed == there:
            return None
        there.clear()
        there.update(changed)
        page["updated"] = _now()
        return {"op": "block.put", "page": page["id"], "block": dict(there)}


def _title(t: Any) -> str:
    return re.sub(r"\s+", " ", t).strip()[:MAX_TITLE] if isinstance(t, str) else ""


def _icon(t: Any) -> str:
    return t.strip()[:8] if isinstance(t, str) else ""


def _block(b: Any, was: Optional[dict], kind: str) -> dict:
    """A block as kept: its type one of TYPES, its text clean (a code block's plain), its indent in range."""
    if not isinstance(b, dict):
        raise NotebookError(f"{kind}: a block is {{id, type?, text?, checked?, indent?}}")
    t = b.get("type", (was or {}).get("type", "text"))
    if t not in TYPES:
        raise NotebookError(f"{kind}: {t!r} is not a block's type ({', '.join(TYPES)})")
    text = b.get("text", "")
    if not isinstance(text, str):
        raise NotebookError(f"{kind}: a block's `text` is a string")
    if t == "divider":
        text = ""
    elif t == "code":
        text = text[:MAX_TEXT]
    else:
        text = clean_html(text)
    try:
        indent = max(0, min(MAX_INDENT, int(b.get("indent") or 0))) if t in INDENTED else 0
    except (TypeError, ValueError):
        raise NotebookError(f"{kind}: a block's `indent` is a whole number") from None
    out = {"id": b["id"], "type": t, "text": text, "checked": bool(b.get("checked")) and t == "todo", "indent": indent}
    if t in MEDIA:
        out.update(_media(b, t, kind))
    to = b.get("to") or ""
    if to and t not in UNSENT:
        if not isinstance(to, str) or not CHANNEL.match(to):
            raise NotebookError(f"{kind}: a block's `to` is the channel of the actor it was sent to")
        out["to"], out["sent"] = to, _when(b.get("sent"), kind)
        extra = b.get("extra")
        if extra is not None and not isinstance(extra, str):
            raise NotebookError(f"{kind}: a block's `extra` is what the user added to it, a string")
        if extra and clean_html(extra[:MAX_LINE]):
            out["extra"] = clean_html(extra[:MAX_LINE])
        group = b.get("group") or ""
        if group:
            if not isinstance(group, str) or not ID.match(group):
                raise NotebookError(f"{kind}: a block's `group` is the id the lines sent with it in one message share, "
                                    f"6-24 of a-z and 0-9")
            out["group"] = group
    if b.get("work") and t not in UNSENT:
        out["work"] = True
    ended = b.get("ended") or ""
    if ended and (out.get("to") or out.get("work")):              # (a line no longer a work item: nothing to end)
        if ended not in ENDED:
            raise NotebookError(f"{kind}: a block's `ended` is how the user ended it, {' or '.join(ENDED)}")
        out["ended"], out["ended_at"] = ended, _when(b.get("ended_at"), kind)
    thread = b.get("thread")
    if thread:
        if not isinstance(thread, list):
            raise NotebookError(f"{kind}: a block's `thread` is a list of lines")
        out["thread"] = [_line(x, kind) for x in thread][-MAX_THREAD:]
    source = b.get("source") or ""
    if source and (t not in UNSENT or t in MEDIA):
        if not isinstance(source, str) or not CHANNEL.match(source):
            raise NotebookError(f"{kind}: a block's `source` is the channel of the agent that wrote it")
        out["source"], out["source_at"] = source, _when(b.get("source_at"), kind)
    return out


def _media(b: dict, t: str, kind: str) -> dict:
    """What a picture's block keeps beside its caption (PICTURES, above)."""
    out: Dict[str, Any] = {}

    def side(k: str) -> None:
        v = b.get(k)
        if v is None:
            return
        if isinstance(v, bool) or not isinstance(v, int) or not 0 < v <= MAX_SIDE:
            raise NotebookError(f"{kind}: a picture's `{k}` is its size in pixels, a whole number")
        out[k] = v

    if t == "image":
        if not isinstance(b.get("file"), str) or not FILE.match(b["file"]):
            raise NotebookError(f"{kind}: an image's `file` is the name the app gave the picture when it was kept")
        out["file"] = b["file"]
    else:
        if not isinstance(b.get("url"), str) or not FIGMA_URL.match(b["url"]):
            raise NotebookError(f"{kind}: a figma block's `url` is a link to a Figma file, https://www.figma.com/...")
        out["url"] = b["url"]
        if b.get("title"):
            out["title"] = _title(b.get("title"))
        snap = b.get("snap")
        if snap:
            if not isinstance(snap, str) or not FILE.match(snap):
                raise NotebookError(f"{kind}: a figma block's `snap` is the name of a picture the app kept")
            out["snap"], out["snap_at"] = snap, _when(b.get("snap_at"), kind)
            mod = b.get("snap_mod")
            if isinstance(mod, str) and mod:
                out["snap_mod"] = mod[:64]
    side("w")
    side("h")
    width = b.get("width")
    if width is not None:
        if isinstance(width, bool) or not isinstance(width, (int, float)):
            raise NotebookError(f"{kind}: a picture's `width` is a percent of the page's width")
        out["width"] = max(10, min(100, int(round(width))))
    return out


def written_with(blocks: List[dict], b: dict) -> List[dict]:
    """The blocks written with `b` from one agent's conversation, in the page's order -- the same `source` and
    `source_at`: one call's -- or [] if it has no source."""
    if not b.get("source"):
        return []
    return [x for x in blocks if x.get("source") == b["source"] and x.get("source_at") == b.get("source_at")]


def sources_lines(blocks: List[dict], me: Optional[str] = None,
                  title: Optional[Callable[[str], Optional[str]]] = None) -> List[str]:
    """Where the blocks agents wrote from their conversations came from, as an agent reads a page: each run's ids, who
    wrote it (`me`, the reader: "you") and when; then the user's follow-ups on it and the replies (lines also sent to an
    agent show theirs with the sent ones). [] if there are none."""
    out: List[str] = []
    seen = set()
    for b in blocks:
        run = written_with(blocks, b)
        if not run or b["id"] in seen:
            continue
        seen.update(x["id"] for x in run)
        ch = b["source"]
        ids = ", ".join("[" + x["id"] + "]" for x in run)
        out.append(f"- {ids} by actor {ch}{' (you)' if me and ch == me else ''}, "
                   f"{time.strftime('%Y-%m-%d %H:%M', time.localtime(b['source_at']))}")
        for x in run:
            if is_work(x):                                        # (a work item's thread: with the work items)
                continue
            for line in x.get("thread") or []:
                by = line["by"]
                who = "the user" if by == "user" else f"actor {by[6:]}{' (you)' if me and by[6:] == me else ''}"
                out.append(f"    {who}: {' / '.join(inline_markdown(line['text'], title).splitlines())}")
    if out:
        out[:0] = ["", "Lines agents wrote from their conversations with the user (each: who wrote it and when -- the "
                       "user can follow up on them with that agent -- then the follow-ups and replies):"]
    return out


def _when(at: Any, kind: str) -> float:
    if at is None:
        return _now()
    if isinstance(at, bool) or not isinstance(at, (int, float)) or at < 0:
        raise NotebookError(f"{kind}: a time is seconds since 1970")
    return round(float(at), 3)


def _line(x: Any, kind: str) -> dict:
    """A thread's line as kept: {id, by, text (clean, as a block's), at, done?, results?}."""
    if not isinstance(x, dict) or not ID.match(str(x.get("id") or "")):
        raise NotebookError(f"{kind}: a thread's line is {{id, by, text, at?, done?}}, its id 6-24 of a-z and 0-9")
    if not isinstance(x.get("by"), str) or not BY.match(x["by"]):
        raise NotebookError(f"{kind}: a line's `by` is \"user\", or \"agent:\" and the agent's channel")
    if not isinstance(x.get("text"), str) or not x["text"].strip():
        raise NotebookError(f"{kind}: a line's `text` says something")
    out = {"id": x["id"], "by": x["by"], "text": clean_html(x["text"][:MAX_LINE]), "at": _when(x.get("at"), kind)}
    if x.get("done"):
        out["done"] = True
    made = x.get("results")
    if made:
        if not isinstance(made, list) or not all(isinstance(r, str) for r in made):
            raise NotebookError(f"{kind}: a line's `results` is a list of what was made: files, a branch, a PR")
        made = [" ".join(r.split())[:MAX_RESULT] for r in made if r.strip()][:MAX_RESULTS]
        if made:
            out["results"] = made
    return out
