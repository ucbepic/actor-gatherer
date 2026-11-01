"""The dashboard's local server: the page (page.html) and the JSON it reads, from the
context manager's home (data.py), read-only. Standard library only.

    GET /                                 the page
    GET /api/home                         data.home(), each actor with its avatar (avatars.py's `assign`), and the
                                          shells open (sessions.py's `shells`)
    GET /avatars/<kind>/<name>.svg        an avatar's picture (ag_dashboard/avatars/); ?bare=1: without its circle
    GET /api/agent?gatherer=G&channel=C   data.agent(G, C)
    GET /api/read?gatherer=G&read_id=N    data.read(G, N)
    GET /api/context?gatherer=G&read_id=N data.context(G, N)
    GET /api/history?gatherer=G&channel=C&from=A[&to=B]   data.history(G, C, A, B)
    GET /api/transcript?gatherer=G&channel=C[&after=A|&before=B]   data.transcript(G, C, A, B)
    GET /api/files?gatherer=G&channel=C[&turn=N][&cwd=D]   files.files(G, C, N, D): a turn's files
    GET /api/files/changes?gatherer=G&channel=C&path=P&since=S[&cwd=D]   files.changes(G, C, P, S, D): its changes to P since S
    GET /api/monitor?actors=[[G, C, D], ...]               monitor.actors: what each is doing, its latest turn
    GET /api/image?gatherer=G&row_id=R&id=I                files.image(G, R, I): the image call I's result holds
    GET /api/outline?gatherer=G[&channel=C][&after=A]      history.outline(G, C, A): the events, light, and the tasks
    GET /api/event?gatherer=G&row_id=R                     history.event(G, R): one event, as the transcript shows it
    GET /api/search?gatherer=G[&channel=C]&q=Q             history.search(G, C, Q): the events whose words hold Q
    GET /api/extracts?gatherer=G                           history.extracts(G): what the model made of the history
    GET /api/stream[?gatherer=G&channel=C][&also=[[G2, C2], ...]]   server-sent events, until the page goes:
        `home` (data.home()) and, with a channel, `agent` (data.agent(G, C)) at once, then again
        each time they change -- woken by ag's notifications or the fallback check (live.py) -- what the
        harness's own record of a session says (the user writing to it as it works, a question answered in its
        terminal, Esc) among them, as ag's hook records it -- and every KEEPALIVE seconds a comment, or `home` if the time alone changed it (Running/Idle).
        `also` (JSON): the page's other actors, its other panes, each sent the same way as `actor`
        {gatherer, channel, agent}: one stream for all a page shows, as a browser keeps few open
    GET /api/sessions                     the sessions started from the page (sessions.py)
    GET /api/models?harness=H             the models a new session of H can run on (sessions.py's `models`)
    GET /api/terminal?session_id=S        server-sent events, until the page goes: what the session's (or the
        shell's: S its id) terminal prints, `out` {data (base64), at (where it ends), reset (all that is kept: start over --
        a full screen then drawn all again, sessions.py's `redraw`)}, then `exit` {code} when its process
        ends; `none` when it has no terminal
    GET /api/views                        the reader's own chat views: <home>/dashboard/views/*.js, by name
    GET /vendor/editor.js                 the Editor panel's editor (CodeMirror and Yjs, assets/src/editor), loaded the
                                          first time the page shows the view
    GET /api/edit/list?dir=D&root=R       editor.listing(D, R): a directory under R, each entry with who edits it
    GET /api/edit/place?gatherer=G&channel=C&cwd=D   {dir}: where the actor's work is, the Editor opened from its pane
    GET /api/projects?gatherer=G[&dirs=[D, ...]]   {projects, suggestions}: the gatherer's projects, the repositories
                                          its actors' branches are made from, and those the directories D are in
                                          (branches.py)
    GET /api/branches?root=R              the actors' branches of the projects R is in or holds, each with its changes
                                          held for the reader (branches.py's `under`)
        shows (editor.place: the folder holding what it changed lately; null, none)
    GET /api/edit/stream?path=P&root=R&conn=C&client=N   server-sent events, until the page goes: the file P (under
        R) opened for editing (editor.py), shared with every other page editing it: `init` {epoch, update (the
        document, a Yjs update, base64), sv (its state vector), aware (the other pages' cursors)}, then `update`
        {update, disk (true: the file's own change on disk)}, `aware` {update}, `left` {client} and `state`
        {dirty, missing, error, changed, saved, editors, conflicts: [{id, from, to (UTF-16), base, theirs, at, zone}],
        zone: [[from, to], ...] (the conflict zone)} as they come; `failed` {error} when it cannot be opened
    GET /views/<name>.js                  one of them, which the page loads (page.html: chat views)
    POST /api/gatherers {name}            a new gatherer (`ag new`), no session yet -> {name}
    POST /api/projects {gatherer, add | remove, dirs?}   a project set for the gatherer (a folder in a repository, or a
                                          GitHub repository: cloned), or no longer -> as GET /api/projects
    POST /api/branches {gatherer, project, harness?, approve?, model?}   a new session on a new branch of the project,
                                          in a worktree of its own (branches.py's `create`) -> the session
    POST /api/branches/approve {session_id, approve}   whether every change of its branch's is asked about
    POST /api/branches/decide {session_id, path, take}   each change of its branch's to the file held for the reader,
                                          taken in ("theirs") or left out ("mine") -> the branch
    POST /api/sessions {gatherer, cwd?, permission_mode?, harness?, model?}  a new one (harness claude, the
                                          default, or codex) -> the session
    POST /api/send {session_id, text, cols?, rows?, fullscreen?}  a message to it -> the session: typed into
                                          its terminal, or one opened for it (that size, that screen), or to
                                          its agent (sessions.py's `send`); while the codex in the dashboard's
                                          terminal asks whether to implement its plan, what to change instead
                                          ("No, stay in Plan mode", then the message); refused while it waits on
                                          a question there (`codex_dialog`), and while its terminal's message box
                                          is not there, empty, to take it -- a dialog, a menu, a question, a
                                          permission asked, or something typed there and not sent: the error then
                                          has `box` (sessions.py's NotAtBox)
    POST /api/send {gatherer, channel, text, ...}  the same to a Claude Code or codex session not started here,
                                          taken into the table first (sessions.py's `adopt`)
    POST /api/coordinator {gatherer, cwd?, harness?}  the gatherer's gatherer agent, started (with no message yet) if it
                                          has none (coordination.py) -> the session
    POST /api/actors/<op> {actor, ...}    what an actor's `ag actors` asks (coordination.py; `actor`, its id): list {all?},
                                          show {ref}, who {path}, send {ref, text}, new {text, cwd?, harness?, model?, like?,
                                          name?, docwriter?}, when {ref, note?}, watches, unwatch {watch} -> what it answers; an
                                          error's text for the command to print (400)
    POST /api/stop {session_id}           its agent, idle, ended -- or its terminal closed -> the session
    POST /api/discard {session_id}        one that never started -- no process of it running, nothing of it in its
                                          gatherer -- forgotten: listed nowhere, nothing of it kept (sessions.py's
                                          `discard`) -> {}
    POST /api/terminal {session_id | gatherer, channel, cols, rows, fullscreen?}  the session opened in a
                                          terminal, Claude Code's own UI (sessions.py's `terminal`), in its
                                          classic screen unless `fullscreen` -> the session
    POST /api/answer {session_id, call, choice}  what its terminal asks (data.py's `asking`, the call `call`),
                                          answered with `choice` (answers.py): its keys typed there -> the answer
    POST /api/terminal/input {session_id, data}       what was typed in it
    POST /api/terminal/resize {session_id, cols, rows}  its new size
    POST /api/shells {gatherer, cwd, cols?, rows?}  a shell opened in `cwd`, listed under the gatherer (sessions.py's
                                          `shell`) -> the shell, its id the session_id its terminal is reached by
    POST /api/shells/close {id}           the shell's terminal closed, as a window is
    POST /api/hiding {gatherer, choice}   keep "hidden" / "shown" / "" for it (hiding.py) -> every choice
    POST /api/saved {gatherer, channel, saved}  the actor saved for later, or no longer (saved.py) -> every one saved
    POST /api/name {gatherer, channel, name, harness?, cwd?}  the reader's name for the actor ("": none), a `name`
                                          event in its gatherer, put in by ag (naming.py), given to its harness's own
                                          store too, and -- where the dashboard runs its terminal -- typed there as the
                                          harness's own command once its turn is over (sessions.py's `rename`)
                                          -> {name, store: what was done there, error: why not, terminal: held for it}
    POST /api/seen {seen: [[gatherer, channel, last], ...]}  those actors looked at, each with its `last`
                                          (seen.py) -> every one seen
    POST /api/history/export {gatherer, rows, format}   those events as a file: {name, text} (history.py)
    POST /api/history/extract {gatherer, rows, kind, ask?}  the Gatherer's model asked for a summary, memory
                                          or skill of them, in the background -> its record
    POST /api/history/delete {id}         a record removed, its job stopped -> {id}
    POST /api/history/build {gatherer, channel}   ag asked to build the actor's history (history.build)
    POST /api/history/save {id, target, dir?, version?}  where Claude Code reads it: the plan, without
                                          `version`; with the plan's, the files written -> {saved, where}
    POST /api/edit/update {path, root, conn, update}   the page's edit of an open file (a Yjs update, base64) ->
                                          its state
    POST /api/edit/aware {path, root, conn, update}    the page's cursor in it (a y-protocols awareness update)
    POST /api/edit/save {path, root}      the file written as its document has it -> its state
    POST /api/edit/settle {path, root, conflict, take}   a conflict with the file on disk settled: the lines kept
                                          (take "mine"), the file's in their place ("theirs"), or both -> its state
    POST /api/edit/zone/clear {path, root}   the conflict zone cleared: the lines edited here the file's to change,
                                          as any other -> its state
    GET /docwriter/w/<key>/...            a DocWriter (docwriter.py): its page and pdf.js viewer (vendor/docwriter/), its
                                          settings (dw), what it keeps (kv), the page's one stream (stream: its
                                          documents' changes, the actor's tool calls for it to run, the live notices),
                                          DocWriter's own /api routes (preview, a file's bytes; the rest JSON)
    POST, PUT, PATCH, DELETE /docwriter/w/<key>/...   the rest of them: a document opened, left, edited and saved
                                          (doc/join, doc/leave, doc/update, doc/save), the message to its actor (send), what the author decided
                                          (record), the page's file calls (fs), a tool's answer (tools/result, and
                                          tools/list), the MCP server its actor calls (mcp), its edit guard (guard),
                                          DocWriter's own /api routes
    POST /api/docwriter {gatherer, cwd, harness?, model?}   a new DocWriter on `cwd`, its actor a new session of
                                          `harness` in the gatherer (docwriter.py's `create`) -> its settings: {key, ...}
    GET /browser/w/<key>/stream[?video=1] server-sent events, until the page goes: a Browser's (browser.py) `state` {tabs,
                                          active, picks, acting, dialog, error, running, viewport, video} as it changes,
                                          and its screen, `frame` {data (a JPEG, base64), w, h (the page's size), seq}, as
                                          it does; with video=1 (the page decodes video), `video` chunks {t: key | delta,
                                          ts, d (base64), seq; a key's codec, w, h} instead where they can be
                                          (browser_video.py), every one from a key frame on, in order
    POST /browser/w/<key>/<what>          what the user does in it: input {events}, nav {url | action}, resize {width,
                                          height, dpr}, hover {x, y}, pick {x, y | box}, unpick {id}, dialog {accept, text?},
                                          copy -> {text}, tab {action: switch | close | new, index?, url?}; and the MCP
                                          server its actor calls (mcp)
    POST /api/browser {gatherer, cwd, harness?, model?}   a new Browser, its actor a new session of `harness` in the
                                          gatherer, in `cwd` (browser.py's `create`) -> {key, channel, ...}
    A message to a Browser's actor (/api/send) ends with what the user did and picked in it (browser.py's `compose`).
    Its Chrome is the dashboard's own, or the user's (config.toml's `[dashboard] browser_profile = "mine"`).
    GET /api/settings                     ag's settings, its config.toml (settings.py)
    POST /api/settings/model {model, api_base?, key_env?}   the Gatherer's model, by `ag model` -> the settings
    POST /api/settings/defaults {version, policy?, pollers?, gatherer?}   a new gatherer's defaults -> the settings
    POST /api/settings/file {version, text}   config.toml as the reader edited it -> the settings

The POSTs are the only writes, and only to the dashboard's own tables and records, the agents it
runs (and the shells it opens), the gatherers `ag new` makes, the builds and model calls `ag home build` and `ag home complete`
start, its own events `ag home insert` puts in (an actor's name), the harness's own store of a name
(naming.py), the files a History extract is saved as (where Claude Code reads them, once the reader has
seen them), ag's config.toml, and the files edited in the Editor panel (editor.py: under the directory the
page names) -- besides the avatar the home gives an actor it has not seen before
(avatars.py), kept in the dashboard's own table:
the gatherers' databases are otherwise only read. They are taken from the dashboard's own page only
(`own_page`), and the server listens on localhost unless told otherwise.

`page(snapshot)` is the page itself, the libraries it renders markdown with (VENDOR: marked,
and DOMPurify to make what it makes safe) and draws terminals with (TERMINAL: xterm.js, its
fit and WebGL add-ons, and its stylesheet) inside it, never fetched; with a snapshot (data.snapshot()) it
stands alone, its data inside it (`ag dashboard --out`), and no terminal: it has none to draw.

Standard library only, but for the Editor panel's shared documents (editor.py: pycrdt), offered only with it."""

import base64
import json
import os
import queue
import re
import select
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import List, Optional
from urllib.parse import parse_qs, urlsplit

import harness_kit

from . import (actions, avatars, branches, browser, coordination, data, docwriter, editor, files, hiding, history, home,
               live, mcp, migrating, monitor, naming, saved, seen, sessions, settings)

PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "page.html")
_VENDOR_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor")
VENDOR = [os.path.join(_VENDOR_DIR, n) for n in ("marked.min.js", "purify.min.js")]
TERMINAL = [os.path.join(_VENDOR_DIR, n) for n in ("xterm.js", "addon-fit.js", "addon-webgl.js", "xterm.css")]
EDITOR = os.path.join(_VENDOR_DIR, "editor.js")
LLM_SECONDS = 10.0          # how long the Gatherer's call log is reused before it is read again
KEEPALIVE = 15.0            # the most a stream stays silent
COALESCE = 0.03             # after a wake, how long to wait for the rest of a burst (a call stores many events)
SHARED_SECONDS = 2.0        # a home read for one stream given to another woken by the same change: at most this old


def page(snapshot: Optional[dict] = None) -> str:
    """The page; with `snapshot`, its data inside it."""
    with open(PAGE, encoding="utf-8") as fh:
        text = fh.read()
    scripts = []
    for path in VENDOR + (TERMINAL if snapshot is None else []):
        with open(path, encoding="utf-8") as fh:
            if path.endswith(".css"):
                scripts.append("<style>" + fh.read().replace("</style", "<\\/style") + "</style>")
            else:
                scripts.append("<script>" + fh.read().replace("</script", "<\\/script") + "</script>")
    text = text.replace("<!--VENDOR-->", "\n".join(scripts), 1)
    if snapshot is None:
        return text
    embedded = json.dumps(snapshot).replace("</", "<\\/")      # never closes the script it sits in
    return text.replace("/*SNAPSHOT*/null", embedded, 1)


class _Calls:
    """The Gatherer's call log, read at most every LLM_SECONDS: polling reads it often."""

    def __init__(self):
        self.lock, self.at, self.calls = threading.Lock(), 0.0, []

    def get(self):
        with self.lock:
            if time.time() - self.at > LLM_SECONDS:
                self.calls, self.at = data.llm_calls(), time.time()
            return self.calls

    def changed(self) -> None:
        """A call was logged: read the log again next time."""
        with self.lock:
            self.at = 0.0


def _signature(value) -> str:
    """What a stream compares to send only a change: the value, less the time it was read at."""
    if isinstance(value, dict):
        value = {k: v for k, v in value.items() if k != "now"}
    return json.dumps(value, sort_keys=True, default=str)


def handler(calls: _Calls, hub: live.Hub, started: sessions.Sessions, editors: editor.Editors,
            crew: coordination.Coordination, known: Optional[data.Kept] = None,
            branched: Optional[branches.Branches] = None, docwriters: Optional[docwriter.DocWriters] = None,
            browsers: Optional[browser.Browsers] = None):
    shared, sharing = {"version": None, "at": 0.0, "value": None}, threading.Lock()

    def home_view(woken: bool = False) -> dict:
        """The home as the page gets it (`read_home`). One read serves every stream woken by the same change
        (`woken`): read again only once another is rung (the hub's `version`), so a read begun after the ring
        that woke a stream has what it rang for -- not once for each stream open, which a change woke all of
        at once, each reading the whole home over the others'. Not one older than SHARED_SECONDS (a page
        opened long after the last change: what time changed since, the sessions' state). One at a time: a
        stream woken during a read waits for it, then has it, or reads again for a ring that came during it."""
        with sharing:
            if woken and shared["value"] is not None and shared["version"] == hub.version \
                    and time.time() - shared["at"] < SHARED_SECONDS:
                return shared["value"]
            version, at = hub.version, time.time()
            shared.update(version=version, at=at, value=read_home(known))
            return shared["value"]

    def read_home(known: Optional[data.Kept] = None) -> dict:
        """The home as the page gets it: with the sessions' state, and what a new session starts from -- the
        harnesses it can run on here (sessions.py's `available`); the shells open, and the user's home directory,
        which the page shows their directories under as ~. A name held for a session's terminal is typed there once
        its turn is over (`rename_due`). `known`: its agents as read before (data.py's `Kept`)."""
        home = data.home(started.list(), known)
        if started.renames:
            started.rename_due(a["channel"] for g in home["gatherers"] for a in g["agents"]
                               if a.get("turn_over") and a.get("status") not in (data.ASKING, data.RUNNING))
        return {**avatars.assign(home), "cwd": os.getcwd(), "permission_modes": list(sessions.PERMISSION_MODES),
                "terminals": sessions.TERMINALS, "harnesses": sessions.available(), "shells": started.shells(),
                "home_dir": os.path.expanduser("~"), "editor": editor.AVAILABLE,
                "branches": branched.listed() if branched is not None else [],
                "docwriter": docwriter.AVAILABLE and os.path.isfile(os.path.join(docwriter.VENDOR, "index.html")),
                "browser": browsers is not None and browser.available()}

    def codex_dialog(sid: str) -> Optional[dict]:
        """What a codex session's terminal -- the dashboard's -- shows asking the user now, where a message typed
        into it would answer the dialog: a question its turn waits on (a message's keys would pick its options),
        or the plan it asks whether to implement (Enter would implement it). None: nothing, or not codex's."""
        row = next((x for x in started.list() if x["session_id"] == sid), None)
        if row is None or row.get("harness") != "codex" or not row.get("terminal"):
            return None
        ask = data.asking_of(row["gatherer"], sid, row.get("cwd"))
        if ask is None or ask.get("async") or (row.get("since") or 0) > (ask.get("at") or 0) \
                or (row.get("typed") and row["typed"] >= (ask.get("at") or 0)):
            return None                              # answered as it works; or not shown there, or touched since
        return ask

    class Handler(BaseHTTPRequestHandler):
        # One connection kept for many requests (HTTP/1.1): each key typed in a terminal is a request, and a
        # connection opened for each costs a round trip more -- through an SSH tunnel, a whole one.
        # Small writes sent at once (no Nagle). A connection idle this long is closed.
        protocol_version = "HTTP/1.1"
        disable_nagle_algorithm = True
        timeout = 120

        def log_message(self, fmt, *args):      # quiet: one line per request is noise
            pass

        def send(self, status: int, body: bytes, kind: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def answer(self, value) -> None:
            self.send(200, json.dumps(value).encode("utf-8"), "application/json")

        def do_GET(self):  # noqa: N802 - http.server's name
            url = urlsplit(self.path)
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            try:
                if url.path in ("/", "/index.html"):
                    return self.send(200, page().encode("utf-8"), "text/html; charset=utf-8")
                if url.path == "/api/stream":
                    return self.stream(q.get("gatherer"), q.get("channel"), _pairs(q.get("also")))
                if url.path == "/api/home":
                    return self.answer(home_view())    # read now: a page's first, its stream's after it shared
                if url.path == "/api/sessions":
                    return self.answer(started.list())
                if url.path == "/api/models":
                    return self.answer(sessions.models(q.get("harness") or ""))
                if url.path == "/api/terminal":
                    return self.terminal(q.get("session_id") or "")
                if url.path == "/api/views":
                    return self.answer(home.view_names())
                if url.path == "/api/settings":
                    return self.answer(settings.read())
                if url.path == "/vendor/editor.js":
                    with open(EDITOR, "rb") as fh:
                        return self.send(200, fh.read(), "text/javascript; charset=utf-8")
                if url.path in ("/api/edit/list", "/api/edit/stream", "/api/edit/place", "/api/projects",
                                "/api/branches") and not self.local_host():
                    return self.send(403, b"only the dashboard's own page may do that", "text/plain")
                if url.path == "/api/edit/list":
                    return self.answer(editors.listing(q.get("dir", ""), q.get("root", "")))
                if url.path == "/api/projects" and q.get("gatherer"):
                    g = q["gatherer"]
                    return self.answer({"projects": branches.projects(g),
                                        "suggestions": branches.suggestions(g, _strings(q.get("dirs")))})
                if url.path == "/api/branches" and branched is not None:
                    return self.answer(branched.under(q.get("root", "")))
                if url.path == "/api/edit/place" and q.get("gatherer") and "channel" in q:
                    return self.answer({"dir": editor.place(q["gatherer"], q["channel"], q.get("cwd", ""))})
                if url.path == "/api/edit/stream":
                    return self.edit_stream(q)
                if url.path.startswith("/avatars/") and url.path.endswith(".svg"):
                    return self.avatar(url.path[len("/avatars/"):-len(".svg")], "bare" in q)
                if url.path.startswith("/views/"):
                    path = home.view_file(url.path[len("/views/"):])
                    if path is None:
                        return self.send(404, b"not found", "text/plain")
                    with open(path, "rb") as fh:
                        return self.send(200, fh.read(), "text/javascript; charset=utf-8")
                if url.path == "/api/agent" and q.get("gatherer") and "channel" in q:
                    return self.answer(data.agent(q["gatherer"], q["channel"], calls.get()))
                if url.path == "/api/read" and q.get("gatherer") and q.get("read_id", "").isdigit():
                    return self.answer(data.read(q["gatherer"], int(q["read_id"])))
                if url.path == "/api/context" and q.get("gatherer") and q.get("read_id", "").isdigit():
                    return self.answer(data.context(q["gatherer"], int(q["read_id"])))
                if url.path == "/api/history" and q.get("gatherer") and "channel" in q and q.get("from", "").isdigit() \
                        and q.get("to", "0").isdigit():
                    return self.answer(data.history(q["gatherer"], q["channel"], int(q["from"]),
                                                    int(q["to"]) if "to" in q else None))
                if url.path == "/api/transcript" and q.get("gatherer") and "channel" in q \
                        and q.get("after", "0").isdigit() and q.get("before", "0").isdigit():
                    return self.answer(data.transcript(q["gatherer"], q["channel"],
                                                       int(q["after"]) if "after" in q else None,
                                                       int(q["before"]) if "before" in q else None))
                if url.path == "/api/files/changes" and q.get("gatherer") and "channel" in q and q.get("path") \
                        and q.get("since", "").replace(".", "", 1).isdigit():
                    return self.answer(files.changes(q["gatherer"], q["channel"], q["path"], float(q["since"]), q.get("cwd", "")))
                if url.path == "/api/files" and q.get("gatherer") and "channel" in q and q.get("turn", "0").isdigit():
                    return self.answer(files.files(q["gatherer"], q["channel"],
                                                   int(q["turn"]) if "turn" in q else None, q.get("cwd", "")))
                if url.path == "/api/monitor":
                    return self.answer({"actors": monitor.actors(_actors(q.get("actors")))})
                if url.path == "/api/image" and q.get("gatherer") and q.get("row_id", "").isdigit() and q.get("id"):
                    got = files.image(q["gatherer"], int(q["row_id"]), q["id"])
                    return self.send(200, got[1], got[0]) if got else self.send(404, b"no image", "text/plain")
                if url.path == "/api/outline" and q.get("gatherer") and q.get("after", "0").isdigit():
                    return self.answer(history.outline(q["gatherer"], q.get("channel"), int(q.get("after", "0"))))
                if url.path == "/api/event" and q.get("gatherer") and q.get("row_id", "").isdigit():
                    return self.answer(history.event(q["gatherer"], int(q["row_id"])))
                if url.path == "/api/search" and q.get("gatherer"):
                    return self.answer(history.search(q["gatherer"], q.get("channel"), q.get("q", "")))
                if url.path == "/api/extracts" and q.get("gatherer"):
                    return self.answer(history.extracts(q["gatherer"]))
                if url.path.startswith("/docwriter/w/"):
                    return self.docwriter("GET", url, b"")
                if url.path.startswith("/browser/w/"):
                    m = re.fullmatch(r"/browser/w/([0-9a-f]{16})/stream", url.path)
                    if m is None or browsers is None:
                        return self.send(404, b"not found", "text/plain")
                    return self.browser_stream(browsers.get(m.group(1)), q.get("video") == "1")
                if url.path == "/docwriter-mark.svg":         # DocWriter's mark, which its page asks for at the root
                    got = docwriter.asset("docwriter-mark.svg")
                    return self.send(200, *got) if got else self.send(404, b"not found", "text/plain")
                return self.send(404, b"not found", "text/plain")
            except editor.EditorError as exc:
                return self.send(400, json.dumps({"error": str(exc)}).encode(), "application/json")
            except browser.BrowserError as exc:
                return self.send(exc.status, json.dumps({"error": str(exc)}).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001 - the page shows the error and keeps its last view
                return self.send(500, json.dumps({"error": f"{type(exc).__name__}: {exc}"}).encode(), "application/json")

        def avatar(self, name: str, bare: bool = False) -> None:
            """A picture, kept by the browser a while (the list is drawn again often), its scripts never run
            even opened on its own: a picture put in the folder by hand is the reader's, not ours. `bare`
            (?bare=1): without its circle, the character alone (the Chat view's, at work)."""
            found = avatars.path(name)
            if found is None:
                return self.send(404, b"not found", "text/plain")
            with open(found, "rb") as fh:
                body = fh.read()
            if bare:
                body = avatars.bare(body)
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "max-age=3600")
            self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
            self.end_headers()
            self.wfile.write(body)

        def event(self, name: str, value) -> None:
            self.wfile.write(f"event: {name}\ndata: {json.dumps(value)}\n\n".encode("utf-8"))

        def gone(self) -> bool:
            """Whether the page closed the connection: it sends nothing more, so readable means closed."""
            try:
                if not select.select([self.connection], [], [], 0)[0]:
                    return False
                return self.connection.recv(1, socket.MSG_PEEK) == b""
            except (OSError, ValueError):
                return True

        def stream(self, gatherer: Optional[str], channel: Optional[str], also=()) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")      # it has no length: it ends when the connection does
            self.close_connection = True
            self.end_headers()
            watch = hub.watch(gatherer, channel, also)
            sent = {}

            def agent_of(g: str, c: str) -> dict:
                try:
                    return data.agent(g, c, calls.get())
                except Exception as exc:  # noqa: BLE001 - the page shows it; the stream stays up
                    return {"error": f"{type(exc).__name__}: {exc}"}
            try:
                while True:
                    woken = watch.wake.wait(KEEPALIVE)
                    if self.gone():
                        return
                    if woken:
                        time.sleep(COALESCE)
                    home, agent, others = watch.take()
                    out = []                             # (event, what it is kept as, value)
                    if home or not woken:                # unwoken: the time alone may have changed it
                        out.append(("home", "home", home_view(woken)))
                    if agent and gatherer and channel is not None:
                        out.append(("agent", "agent", agent_of(gatherer, channel)))
                    for i in sorted(others):
                        g, c = also[i]
                        out.append(("actor", ("actor", g, c), {"gatherer": g, "channel": c, "agent": agent_of(g, c)}))
                    wrote = False
                    for name, kept, value in out:
                        sig = _signature(value)
                        if sent.get(kept) != sig:
                            self.event(name, value)
                            sent[kept], wrote = sig, True
                    if not wrote and not woken:
                        self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
            except OSError:                              # the page went away
                pass
            finally:
                hub.drop(watch)

        def terminal(self, session_id: str) -> None:
            """What the session's terminal prints, as it prints it: all that is kept first."""
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")      # it has no length: it ends when the connection does
            self.close_connection = True
            self.end_headers()
            at = -1                                      # nothing yet: all that is kept
            try:
                while True:
                    got = started.output(session_id, at, KEEPALIVE)
                    if got is None:
                        self.event("none" if at < 0 else "exit", {"code": None})
                        return self.wfile.flush()
                    out, end, reset, code = got
                    if out or reset:
                        self.event("out", {"data": base64.b64encode(out).decode("ascii"), "at": end, "reset": reset})
                        at = end
                    if reset:                            # what is kept may not hold all of its full screen
                        started.redraw(session_id)
                    if code is not None:
                        self.event("exit", {"code": code})
                        return self.wfile.flush()
                    if not out and not reset:
                        if self.gone():
                            return
                        self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
            except OSError:                              # the page went away
                pass

        def edit_stream(self, q: dict) -> None:
            """A file open for editing, as the other pages and the disk change it (editor.py)."""
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")      # it has no length: it ends when the connection does
            self.close_connection = True
            self.end_headers()
            try:
                room, conn = editors.join(q.get("path", ""), q.get("root", ""), q.get("conn", ""),
                                          int(q["client"]) if q.get("client", "").isdigit() else 0)
            except (editor.EditorError, OSError) as exc:
                self.event("failed", {"error": str(exc)})
                return self.wfile.flush()
            try:
                while True:
                    try:
                        item = conn.queue.get(timeout=editor.GONE_CHECK)
                    except queue.Empty:
                        if self.gone():
                            return
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
                        continue
                    if item is None:             # another stream of the page's took its place, or the server stops
                        return
                    self.event(*item)
                    if conn.queue.empty():
                        self.wfile.flush()
            except OSError:                              # the page went away
                pass
            finally:
                room.leave(conn)

        def docwriter(self, method: str, url, raw: bytes) -> None:
            """A request of a DocWriter's page, or of its actor (its MCP server, its edit guard): docwriter.py's."""
            m = re.fullmatch(r"/docwriter/w/([0-9a-f]{16})(?:/(.*))?", url.path)
            if m is None or docwriters is None:
                return self.send(404, b"not found", "text/plain")
            key, rest = m.group(1), m.group(2) or ""
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            dws = docwriters
            try:
                if method == "GET":
                    if rest in ("", "preview") or rest.startswith(("assets/", "pdfjs/")):
                        got = docwriter.asset(rest)
                        return self.send(200, *got) if got else self.send(404, b"not found", "text/plain")
                    if rest == "dw":
                        return self.answer(dws.config(key))
                    if rest == "kv":
                        names = [str(n) for n in json.loads(q.get("names") or "[]")]
                        return self.answer(dws.kv(key, names))
                    if rest == "stream":
                        return self.queue_stream(*dws.join_page(key, q.get("conn", "")))
                    if rest == "api/preview":
                        body, kind = dws.preview(key, q.get("path", ""))
                        self.send_response(200)
                        self.send_header("Content-Type", kind)
                        self.send_header("Content-Length", str(len(body)))
                        self.send_header("Cache-Control", "no-store")
                        self.send_header("X-Content-Type-Options", "nosniff")
                        self.end_headers()
                        return self.wfile.write(body)
                    if rest == "mcp":                   # no stream of the server's own (mcp.py)
                        return self.send(405, b"POST only", "text/plain")
                    if rest.startswith("api/"):
                        return self.answer_status(*dws.api(key, "GET", rest[4:], q, None))
                    return self.send(404, b"not found", "text/plain")
                if rest == "mcp" and method == "POST":
                    status, value = mcp.handle(raw, dws.tools.tools(), lambda name, args: dws.tools.call(key, name, args))
                    return self.answer_status(status, value) if value is not None else self.send(202, b"", "text/plain")
                try:
                    body = json.loads(raw or b"{}")
                except ValueError:
                    return self.send(400, json.dumps({"error": "a JSON body, please"}).encode(), "application/json")
                if method == "POST" and rest == "doc/join":
                    return self.answer(dws.join_doc(key, str(body.get("conn") or ""), str(body.get("tab") or "")))
                if method == "POST" and rest == "doc/leave":
                    dws.leave_doc(key, str(body.get("conn") or ""), str(body.get("tab") or ""))
                    return self.answer({})
                if method == "POST" and rest == "doc/update":
                    dws.edit_doc(key, str(body.get("tab") or ""), str(body.get("conn") or ""),
                                 base64.b64decode(str(body.get("update") or ""), validate=True))
                    return self.answer({})
                if method == "POST" and rest == "doc/save":
                    return self.answer(dws.save_doc(key, str(body.get("tab") or ""), str(body.get("conn") or ""),
                                                    str(body.get("text") or "")))
                if method == "POST" and rest == "kv":
                    dws.kv_set(key, body.get("set") if isinstance(body.get("set"), dict) else {})
                    return self.answer({})
                if method == "POST" and rest == "send":
                    return self.answer(dws.send(key, str(body.get("text") or "")))
                if method == "POST" and rest == "record":
                    dws.record(key, str(body.get("type") or ""), body.get("payload"))
                    return self.answer({})
                if method == "POST" and rest == "fs":
                    return self.answer(dws.fs(key, body))
                if method == "POST" and rest == "tools/list":
                    dws.tools.listed(body.get("tools"))
                    return self.answer({})
                if method == "POST" and rest == "tools/result":
                    dws.tools.answered(str(body.get("id") or ""), body.get("result"))
                    return self.answer({})
                if method == "POST" and rest == "guard":
                    return self.answer({"deny": dws.guard(key, str(body.get("path") or ""))})
                if rest.startswith("api/"):
                    return self.answer_status(*dws.api(key, method, rest[4:], q, body))
                return self.send(404, b"not found", "text/plain")
            except docwriter.DocWriterError as exc:
                return self.send(exc.status, json.dumps({"error": str(exc)}).encode(), "application/json")
            except (sessions.SessionError, ValueError, OSError) as exc:
                return self.send(400, json.dumps({"error": f"{type(exc).__name__}: {exc}"}).encode(), "application/json")

        def browser_stream(self, b: "browser.Browser", video: bool = False) -> None:
            """A Browser's state and screen, as they change (browser.py's `join`), until the page goes; `video`: the
            page decodes video, so its screen may come as video chunks (browser_video.py)."""
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")      # it has no length: it ends when the connection does
            self.close_connection = True
            self.end_headers()
            viewer = b.join(video)
            try:
                while True:
                    got = viewer.take(editor.GONE_CHECK)
                    if got is None:
                        return
                    if not got:
                        if self.gone():
                            return
                        self.wfile.write(b": keepalive\n\n")
                    for name, value in got:
                        self.event(name, value)
                    self.wfile.flush()
            except OSError:                              # the page went away
                pass
            finally:
                b.leave(viewer)

        def browser_post(self, url, raw: bytes) -> None:
            """What the user does in a Browser's view, or its actor's MCP server (browser.py)."""
            m = re.fullmatch(r"/browser/w/([0-9a-f]{16})/([a-z]+)", url.path)
            if m is None or browsers is None:
                return self.send(404, b"not found", "text/plain")
            key, what = m.group(1), m.group(2)
            try:
                if what == "mcp":
                    status, value = mcp.handle(raw, browser.TOOLS, lambda name, args: browsers.call(key, name, args),
                                               browser.NAME)
                    return self.answer_status(status, value) if value is not None else self.send(202, b"", "text/plain")
                try:
                    body = json.loads(raw or b"{}")
                except ValueError:
                    body = None
                if not isinstance(body, dict):
                    return self.send(400, json.dumps({"error": "a JSON object, please"}).encode(), "application/json")
                b = browsers.get(key)
                num = lambda k: None if body.get(k) is None else float(body[k])    # noqa: E731
                if what == "input":
                    b.input(body.get("events") if isinstance(body.get("events"), list) else [])
                    return self.answer({})
                if what == "nav":
                    return self.answer({"done": b.navigate(str(body.get("url") or ""), str(body.get("action") or ""))})
                if what == "resize":
                    b.resize(int(body.get("width") or 0), int(body.get("height") or 0), float(body.get("dpr") or 1))
                    return self.answer({})
                if what == "hover":
                    b.hover(num("x"), num("y"))
                    return self.answer({})
                if what == "pick":
                    box = body.get("box")
                    return self.answer(b.pick(num("x"), num("y"), box if isinstance(box, list) and len(box) == 4 else None))
                if what == "unpick":
                    b.unpick(str(body.get("id") or ""))
                    return self.answer({})
                if what == "dialog":
                    return self.answer({"done": b.answer_dialog(bool(body.get("accept")),
                                                                body.get("text") if isinstance(body.get("text"), str) else None)})
                if what == "copy":
                    return self.answer({"text": b.selection()})
                if what == "tab":
                    action, i = str(body.get("action") or ""), int(body.get("index") or 0)
                    if action == "switch":
                        b.switch(i)
                    elif action == "close":
                        b.close_tab(i)
                    elif action == "new":
                        b.new_tab(str(body.get("url") or ""))
                    else:
                        raise browser.BrowserError("switch, close or new")
                    return self.answer({})
                return self.send(404, b"not found", "text/plain")
            except browser.BrowserError as exc:
                return self.send(exc.status, json.dumps({"error": str(exc)}).encode(), "application/json")
            except (ValueError, TypeError, OSError) as exc:
                return self.send(400, json.dumps({"error": f"{type(exc).__name__}: {exc}"}).encode(), "application/json")

        def answer_status(self, status: int, value) -> None:
            self.send(status, json.dumps(value).encode("utf-8"), "application/json")

        def queue_stream(self, conn, leave) -> None:
            """Server-sent events, each a (name, value) its queue gets, until the page goes or None comes; `leave`
            called then."""
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")      # it has no length: it ends when the connection does
            self.close_connection = True
            self.end_headers()
            try:
                while True:
                    try:
                        item = conn.queue.get(timeout=editor.GONE_CHECK)
                    except queue.Empty:
                        if self.gone():
                            return
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
                        continue
                    if item is None:
                        return
                    self.event(*item)
                    if conn.queue.empty():
                        self.wfile.flush()
                        if self.gone():                  # what was just sent went to a page that has gone
                            return
            except OSError:                              # the page went away
                pass
            finally:
                leave()

        def body_of(self, limit: int) -> Optional[bytes]:
            """The request's body, or None: none to take (too large: its connection not used again)."""
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if not 0 <= length <= limit:
                self.close_connection = True
                return None
            return self.rfile.read(length) if length else b""

        def do_PUT(self):  # noqa: N802 - http.server's name; DocWriter's routes only
            self.other("PUT")

        def do_PATCH(self):  # noqa: N802
            self.other("PATCH")

        def do_DELETE(self):  # noqa: N802
            self.other("DELETE")

        def other(self, method: str) -> None:
            """A PUT, PATCH or DELETE of a DocWriter's page: a method no page elsewhere sends without a preflight
            this server never answers -- from no other origin, to this host as named."""
            url = urlsplit(self.path)
            raw = self.body_of(DOCWRITER_BODY)
            origin = self.headers.get("Origin")
            if raw is None or not url.path.startswith("/docwriter/w/") or not self.local_host() \
                    or (origin is not None and urlsplit(origin).netloc != (self.headers.get("Host") or "")):
                return self.send(403, json.dumps({"error": "only the dashboard's own page may do that"}).encode(),
                                 "application/json")
            return self.docwriter(method, url, raw)

        def local_host(self) -> bool:
            """Whether the request is to this host as named (not a name rebound to it): what reads files' text."""
            host = self.headers.get("Host") or ""
            return urlsplit("//" + host).hostname in ("127.0.0.1", "localhost", "::1", self.server.server_address[0])

        def own_page(self) -> bool:
            """Whether a POST comes from the dashboard's own page: JSON (which a page elsewhere can
            send only after a preflight this server never answers), from no other origin, to this
            host as named (not a name rebound to it)."""
            host = self.headers.get("Host") or ""
            origin = self.headers.get("Origin")
            return (self.headers.get("Content-Type") or "").split(";")[0].strip() == "application/json" \
                and (origin is None or urlsplit(origin).netloc == host) \
                and urlsplit("//" + host).hostname in ("127.0.0.1", "localhost", "::1", self.server.server_address[0])

        def do_POST(self):  # noqa: N802 - http.server's name
            url = urlsplit(self.path)
            if url.path.startswith("/docwriter/w/"):          # a document's state may be larger than a message
                raw = self.body_of(DOCWRITER_BODY)
                if raw is None or not self.own_page():
                    return self.send(403, json.dumps({"error": "only the dashboard's own page may do that"}).encode(),
                                     "application/json")
                return self.docwriter("POST", url, raw)
            if url.path.startswith("/browser/w/"):            # a Browser's view, or its actor's MCP server
                raw = self.body_of(MAX_BODY)
                if raw is None or not self.own_page():
                    return self.send(403, json.dumps({"error": "only the dashboard's own page may do that"}).encode(),
                                     "application/json")
                return self.browser_post(url, raw)
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            raw = self.rfile.read(length) if 0 < length <= MAX_BODY else b""
            if not 0 <= length <= MAX_BODY:              # its body left unread: the connection is not used again
                self.close_connection = True
            if not self.own_page():
                return self.send(403, json.dumps({"error": "only the dashboard's own page may do that"}).encode(),
                                 "application/json")
            try:
                body = json.loads(raw or b"{}") if 0 < length <= MAX_BODY else None
                if not isinstance(body, dict):
                    return self.send(400, json.dumps({"error": "a JSON object, please"}).encode(), "application/json")
                if url.path == "/api/gatherers":
                    return self.answer(sessions.new_gatherer(str(body.get("name") or "")))
                if url.path == "/api/sessions":
                    return self.answer(started.create(str(body.get("gatherer") or ""), str(body.get("cwd") or ""),
                                                      str(body.get("permission_mode") or "auto"),
                                                      str(body.get("harness") or "claude"), str(body.get("model") or "") or None))
                if url.path == "/api/projects":
                    g = str(body.get("gatherer") or "")
                    got = branches.remove_project(g, str(body["remove"])) if body.get("remove") \
                        else branches.add_project(g, str(body.get("add") or ""))
                    return self.answer({"projects": got, "suggestions": branches.suggestions(g, _strings(body.get("dirs")))})
                if url.path == "/api/branches" and branched is not None:
                    s = branched.create(str(body.get("gatherer") or ""), str(body.get("project") or ""),
                                        str(body.get("harness") or "claude"), bool(body.get("approve")),
                                        str(body.get("model") or "") or None)
                    hub.ring(s["gatherer"], what="list")
                    return self.answer(s)
                if url.path == "/api/branches/approve" and branched is not None:
                    got = branched.set_approve(str(body.get("session_id") or ""), bool(body.get("approve")))
                    hub.ring(got["gatherer"], what="list")
                    return self.answer(got)
                if url.path == "/api/branches/decide" and branched is not None:
                    return self.answer(branched.decide(str(body.get("session_id") or ""), str(body.get("path") or ""),
                                                       str(body.get("take") or "")))
                if url.path == "/api/docwriter":
                    if docwriters is None:
                        return self.send(404, b"not found", "text/plain")
                    return self.answer(docwriters.create(str(body.get("gatherer") or ""), str(body.get("cwd") or ""),
                                                       str(body.get("harness") or "claude"), str(body.get("model") or "") or None))
                if url.path == "/api/browser":
                    if browsers is None:
                        return self.send(404, b"not found", "text/plain")
                    return self.answer(browsers.create(str(body.get("gatherer") or ""), str(body.get("cwd") or ""),
                                                       str(body.get("harness") or "claude"), str(body.get("model") or "") or None))
                if url.path == "/api/send":
                    sid = str(body.get("session_id") or "")
                    if not sid and body.get("gatherer") and body.get("channel"):     # a session not started here
                        sid = started.adopt(str(body["gatherer"]), str(body["channel"]))["session_id"]
                    text = str(body.get("text") or "")
                    held = codex_dialog(sid)
                    if held is not None and held.get("kind") == "plan":     # what to change: "No, stay in Plan mode" first
                        started.answer(sid, held, {"plan": "change", "text": " ".join(text.split())})
                        return self.answer(next(x for x in started.list() if x["session_id"] == sid))
                    if held is not None:
                        raise sessions.SessionError("Codex waits on its question in the terminal: answer it, "
                                                    "or press Esc there to stop the turn, first")
                    row = next((x for x in started.list() if x["session_id"] == sid), None)
                    told = None                          # a Browser's actor: what the user did and picked in it, after
                    if browsers is not None and row is not None and text.strip() and text.lstrip()[0] not in "/!":
                        text, told = browsers.compose(row, text)
                    sent = started.send(sid, text, int(body.get("cols") or 120), int(body.get("rows") or 32),
                                        bool(body.get("fullscreen")))
                    if told is not None:
                        told.sent()
                    return self.answer(sent)
                if url.path == "/api/upload":
                    return self.answer(home.save_upload(str(body.get("type") or ""), str(body.get("data") or "")))
                if url.path == "/api/stop":
                    return self.answer(started.stop(str(body.get("session_id") or "")))
                if url.path == "/api/coordinator":
                    return self.answer(crew.page_coordinator(str(body.get("gatherer") or ""), str(body.get("cwd") or "") or None,
                                                             str(body.get("harness") or "") or None))
                if url.path.startswith("/api/actors/"):
                    return self.answer(actors_op(crew, url.path[len("/api/actors/"):], body))
                if url.path == "/api/discard":
                    sid = str(body.get("session_id") or "")
                    row = next((x for x in started.list() if x["session_id"] == sid), None)
                    if row is None:
                        raise sessions.SessionError(f"no session {sid} started from the dashboard")
                    if data.actors(row["gatherer"], {sid}, []):   # its gatherer has something of it: a history to keep
                        raise sessions.SessionError("it has a conversation in its gatherer: close it instead")
                    started.discard(sid)
                    if branched is not None:             # its branch, if it had one: gone too
                        branched.discarded(sid)
                    hub.ring(None, what="list")          # every open page's list
                    return self.answer({})
                if url.path == "/api/terminal":
                    sid = str(body.get("session_id") or "")
                    if not sid and body.get("gatherer") and body.get("channel"):     # a session not started here
                        sid = started.adopt(str(body["gatherer"]), str(body["channel"]))["session_id"]
                    return self.answer(started.terminal(sid, int(body.get("cols") or 120), int(body.get("rows") or 32),
                                                         bool(body.get("fullscreen"))))
                if url.path == "/api/answer":
                    sid = str(body.get("session_id") or "")
                    row = next((x for x in started.list() if x["session_id"] == sid), None)
                    if row is None:
                        raise sessions.SessionError(f"no session {sid} started from the dashboard")
                    ask = data.asking_of(row["gatherer"], sid, row.get("cwd"))
                    if not ask or ask.get("call") != body.get("call"):
                        raise sessions.SessionError("it no longer asks that")
                    choice = body.get("choice")
                    return self.answer(started.answer(sid, ask, choice if isinstance(choice, dict) else {}))
                if url.path == "/api/terminal/input":
                    started.type(str(body.get("session_id") or ""), str(body.get("data") or ""))
                    return self.answer({})
                if url.path == "/api/terminal/resize":
                    started.resize(str(body.get("session_id") or ""), int(body.get("cols") or 0), int(body.get("rows") or 0))
                    return self.answer({})
                if url.path == "/api/shells":
                    return self.answer(started.shell(str(body.get("gatherer") or ""), str(body.get("cwd") or ""),
                                                     int(body.get("cols") or 120), int(body.get("rows") or 32)))
                if url.path == "/api/shells/close":
                    started.close_shell(str(body.get("id") or ""))
                    return self.answer({})
                if url.path == "/api/hiding":
                    kept = hiding.choose(str(body.get("gatherer") or ""), str(body.get("choice") or ""))
                    hub.ring(None, what="list")          # every open page's list
                    return self.answer(kept)
                if url.path == "/api/saved":
                    kept = saved.choose(str(body.get("gatherer") or ""), str(body.get("channel") or ""), bool(body.get("saved")))
                    hub.ring(None, what="list")
                    return self.answer(kept)
                if url.path == "/api/name":
                    g, c, name = str(body.get("gatherer") or ""), str(body.get("channel") or ""), naming.clean(body.get("name"))
                    naming.record(g, c, name)
                    harness = str(body.get("harness") or "") or None
                    out = {"name": name, "store": None, "error": None, "terminal": False}
                    try:
                        out["store"] = naming.in_store(harness, c, name, str(body.get("cwd") or "") or None)
                    except harness_kit.RenameError as exc:
                        out["error"] = str(exc)
                    rules = harness_kit.get(harness)
                    command = rules.rename_command(name) if rules is not None else None
                    out["terminal"] = bool(command) and started.rename(c, command)
                    hub.ring(g, c)                       # every open page's home: one types it, once it may
                    return self.answer(out)
                if url.path == "/api/seen":              # not rung: a home costs every stream a read of every
                    return self.answer(seen.look(body.get("seen")))   # gatherer; the page that looked has it, the
                                                         # others with their next home (KEEPALIVE at most)
                if url.path == "/api/history/export":
                    return self.answer(history.export(str(body.get("gatherer") or ""), body.get("rows"),
                                                      str(body.get("format") or "md")))
                if url.path == "/api/history/extract":
                    return self.answer(history.start(str(body.get("gatherer") or ""), str(body.get("kind") or ""),
                                                     body.get("rows"), str(body.get("ask") or "")))
                if url.path == "/api/history/build":
                    return self.answer(history.build(str(body.get("gatherer") or ""), str(body.get("channel") or "")))
                if url.path == "/api/history/delete":
                    return self.answer(history.delete(str(body.get("id") or "")))
                if url.path == "/api/history/save":
                    return self.answer(history.save(str(body.get("id") or ""), str(body.get("target") or ""),
                                                    str(body.get("dir") or ""), str(body.get("version") or "")))
                if url.path == "/api/settings/model":
                    opt = lambda k: None if body.get(k) is None else str(body[k])    # noqa: E731
                    return self.answer(settings.set_model(str(body.get("model") or ""), opt("api_base"), opt("key_env")))
                if url.path == "/api/settings/defaults":
                    pollers = body.get("pollers")
                    return self.answer(settings.set_defaults(
                        str(body.get("version") or ""), None if body.get("policy") is None else str(body["policy"]),
                        None if pollers is None else [str(p) for p in pollers] if isinstance(pollers, list) else [],
                        None if body.get("gatherer") is None else str(body["gatherer"])))
                if url.path in ("/api/edit/update", "/api/edit/aware"):
                    path, root, cid = str(body.get("path") or ""), str(body.get("root") or ""), str(body.get("conn") or "")
                    update = base64.b64decode(str(body.get("update") or ""), validate=True)
                    if url.path == "/api/edit/aware":
                        editors.aware(path, root, cid, update)
                        return self.answer({})
                    return self.answer(editors.edit(path, root, cid, update))
                if url.path == "/api/edit/save":
                    return self.answer(editors.save(str(body.get("path") or ""), str(body.get("root") or "")))
                if url.path == "/api/edit/zone/clear":
                    return self.answer(editors.clear_zone(str(body.get("path") or ""), str(body.get("root") or "")))
                if url.path == "/api/edit/settle":
                    return self.answer(editors.settle(str(body.get("path") or ""), str(body.get("root") or ""),
                                                      str(body.get("conflict") or ""), str(body.get("take") or "")))
                if url.path == "/api/settings/file":
                    return self.answer(settings.save_text(str(body.get("text") or ""), str(body.get("version") or "")))
                return self.send(404, b"not found", "text/plain")
            except browser.BrowserError as exc:
                return self.send(exc.status, json.dumps({"error": str(exc)}).encode(), "application/json")
            except (sessions.SessionError, ValueError) as exc:     # `box`: a message its terminal's box cannot take now
                return self.send(400, json.dumps({"error": str(exc), **({"box": exc.box} if isinstance(exc, sessions.NotAtBox)
                                                                         else {})}).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                return self.send(500, json.dumps({"error": f"{type(exc).__name__}: {exc}"}).encode(), "application/json")

    return Handler


def actors_op(crew: coordination.Coordination, op: str, body: dict):
    """What an actor's `ag actors <op>` asked (server.py's doc): the coordination's answer."""
    s = lambda k: str(body.get(k) or "")              # noqa: E731
    opt = lambda k: s(k) or None                      # noqa: E731
    me = s("actor")
    if op == "list":
        return crew.list(me, bool(body.get("all")))
    if op == "show":
        return crew.show(me, s("ref"))
    if op == "who":
        return crew.who(me, s("path"))
    if op == "send":
        return crew.send(me, s("ref"), s("text"))
    if op == "new":
        return crew.new(me, s("text"), opt("cwd"), opt("harness"), opt("model"), opt("like"), opt("name"),
                        bool(body.get("docwriter")))
    if op == "when":
        return crew.when(me, s("ref"), s("note"))
    if op == "watches":
        return crew.watches(me)
    if op == "unwatch":
        return crew.unwatch(me, body.get("watch"))
    raise coordination.CoordinationError(f"no `ag actors {op}`: one of list, show, who, send, new, when, watches, unwatch")


MAX_BODY = 30_000_000       # the largest request body taken: a message, or an image pasted into one
DOCWRITER_BODY = 32_000_000  # the largest a DocWriter's: a document's state, a file dropped into its folder
MAX_ALSO = 8                # the most other actors one stream follows (the page shows at most 4 panes)


def _pairs(raw: Optional[str]) -> list:
    """A stream's `also`: [[gatherer, channel], ...] as JSON, each a pair of strings; what is not one is left out."""
    try:
        got = json.loads(raw) if raw else []
    except ValueError:
        return []
    if not isinstance(got, list):
        return []
    return [tuple(p) for p in got if isinstance(p, list) and len(p) == 2 and all(isinstance(x, str) for x in p) and p[0]][:MAX_ALSO]


def _strings(raw) -> List[str]:
    """A list of strings, as JSON (a query's) or as is (a body's); what is not one is left out."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return []
    return [x for x in raw if isinstance(x, str)][:64] if isinstance(raw, list) else []


def _actors(raw: Optional[str]) -> list:
    """The monitor's `actors`: [[gatherer, channel, cwd], ...] as JSON (cwd may be left out, or null); what is not
    one is left out."""
    try:
        got = json.loads(raw) if raw else []
    except ValueError:
        return []
    out = []
    for p in got if isinstance(got, list) else []:
        if isinstance(p, list) and len(p) in (2, 3) and all(isinstance(x, str) for x in p[:2]) and p[0] \
                and (len(p) == 2 or p[2] is None or isinstance(p[2], str)):
            out.append((p[0], p[1], (p[2] if len(p) == 3 else None) or ""))
    return out


class Server(ThreadingHTTPServer):
    """The HTTP server, with what wakes its streams (live.py) and the sessions started from the page
    (sessions.py), whose agents it runs -- those of actors saved for later put away once left unused
    (saved.py's `Rest`): stopped with it."""

    daemon_threads = True               # an open stream never holds up the exit

    def __init__(self, address, live_updates: bool = True):
        self.calls, self.hub = _Calls(), live.Hub()
        self.hub.on_llm = self.calls.changed
        known = data.Kept(lambda g: self.hub.ring(g, what="list")) if live_updates else None   # told what changed by
        self.hub.on_change = known.changed if known else None                                  # ag's notifications
        self.sessions = sessions.Sessions(on_change=self.hub.ring)     # a session's state: its gatherer's streams
        self.editors = editor.Editors()                                # the files open in the Editor panel
        self.listener = self.fallback = self.rest = self.address_file = self.docwriters = self.browsers = None   # for server_close, which a failed bind calls
        self.docwriters = docwriter.DocWriters(self.sessions)          # the DocWriters' documents, tools and notices
        self.browsers = browser.Browsers(self.sessions)                # the Browsers' Chrome, tabs and tools
        self.crew = coordination.Coordination(self.sessions, self.hub.ring, watch=live_updates,   # actors' `ag actors`
                                              docwriters=self.docwriters)
        self.branches = branches.Branches(self.editors, self.sessions, self.hub.ring)   # the actors' own branches
        self.keeps_actions = False
        super().__init__(address, handler(self.calls, self.hub, self.sessions, self.editors, self.crew, known, self.branches,
                                          self.docwriters, self.browsers))
        docwriter.ORIGIN = browser.ORIGIN = f"http://127.0.0.1:{self.server_address[1]}"   # where their actors reach it
        self.keeps_actions = live_updates and not actions.ENABLED     # the reader's actions kept in the gatherers
        actions.ENABLED = actions.ENABLED or live_updates             # (actions.py), while it serves
        self.migrating = migrating.start(self.hub.ring) if live_updates else None   # an older gatherer's tables, once
        self.listener = live.Listener(self.hub) if live_updates else None
        self.fallback = live.Fallback(self.hub) if live_updates else None
        self.rest = saved.Rest(self.sessions, self.hub.shown)
        if live_updates:                     # where actors' `ag actors` reach it: its own, told; any other, by the file
            host = self.server_address[0]
            sessions.DASHBOARD = f"http://{'127.0.0.1' if host in ('', '0.0.0.0', '::') else host}:{self.server_address[1]}"
            self.address_file = home.write_address(sessions.DASHBOARD)
        if known is not None:                                          # its agents all read once, now: a page's
            threading.Thread(target=lambda: data.home([], known), name="ag-home-first", daemon=True).start()   # first

    def server_close(self) -> None:
        for part in (self.listener, self.fallback, self.rest, self.editors, self.crew, self.branches, self.docwriters,
                     self.browsers):
            if part is not None:
                part.close()
        if self.keeps_actions:
            actions.ENABLED = False
        if self.address_file:
            home.forget_address(self.address_file, sessions.DASHBOARD)
        super().server_close()
        self.sessions.close()


def serve(host: str = "127.0.0.1", port: int = 4200, live_updates: bool = True) -> Server:
    """The server, bound and ready (`serve_forever()` runs it); `server_close()` stops it, its
    listener and its sessions' agents. Without `live_updates`, streams are woken by nothing but
    their keep-alive (and the sessions' own changes)."""
    return Server((host, port), live_updates)
