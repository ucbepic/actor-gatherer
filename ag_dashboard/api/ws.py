"""The page's streams over one WebSocket (`/api/ws`), in place of a connection each.

A browser keeps at most six HTTP/1.1 connections to one server open, for all its tabs together, and each server-sent
events stream holds one for as long as it is open: two tabs, or a tab with a terminal, an Editor and a Preview open,
held them all, and every other request the page made (a message sent, Chat's turns, a key typed into a terminal) waited
in the browser for one to close. A WebSocket is not one of the six.

The page opens one WebSocket and, on it, each stream it would have opened (`STREAM`'s routes) by its URL. Each runs as
the same GET would -- the same route, its checks and what it holds let go when it ends -- its events passed on as they
come. What the page sends, JSON text:

    {"open": id, "url": "/api/terminal?session_id=..."}     a stream, `id` the page's name for it
    {"close": id}                                            it is let go, as a page closing its EventSource

What it is sent, text, the stream's id and an event's name each on a line of its own, then its data as it is:

    0\\nhello\\n             the socket is ready: streams can be opened
    <id>\\n!open\\n          the stream answered (200)
    <id>\\n<event>\\n<data>  one of its events (its `data` lines joined, as EventSource joins them)
    <id>\\n!end\\n           it ended (the page may open it again, as an EventSource would)
    <id>\\n!fail\\n<status>  it was refused or is not a stream: not tried again

Only the dashboard's own page may open one (`own_page`): a page elsewhere may open a WebSocket to any server, where it
could not read these streams' answers over HTTP."""

import json
import logging
import re
from typing import Dict
from urllib.parse import unquote, urlsplit

import anyio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .common import named_here

log = logging.getLogger(__name__)
router = APIRouter()
STREAM = re.compile(r"/api/(?:stream|terminal|edit/stream|apps/stream)|/[a-z]+/w/[^/]+/stream")
MAX_OPEN = 64                                    # the most streams one socket holds at once (a page has a few)
PASSED = (b"host", b"origin", b"user-agent", b"cookie")   # the socket's headers each stream's request has too


def own_page(ws: WebSocket) -> bool:
    """Whether the socket is the dashboard's own page's: from its origin (a browser always says where a page is), to
    this host as named (not a name rebound to it)."""
    origin, host = ws.headers.get("origin"), ws.headers.get("host") or ""
    return bool(origin) and urlsplit(origin).netloc == host and named_here(host, ws.app.state.server)


def events(raw: bytes):
    """Each (name, data) of complete server-sent events: a comment (a keepalive), or one with no data, none."""
    for block in raw.split(b"\n\n"):
        name, data = "message", []
        for line in block.split(b"\n"):
            if not line or line.startswith(b":"):
                continue
            field, _, value = line.partition(b":")
            value = value[1:] if value.startswith(b" ") else value
            if field == b"event":
                name = value.decode("utf-8", "replace")
            elif field == b"data":
                data.append(value)
        if data:
            yield name, b"\n".join(data).decode("utf-8", "replace")


@router.websocket("/api/ws")
async def streams(ws: WebSocket) -> None:
    """The page's streams, each by its URL, over this one socket (the module's docstring says how)."""
    if not own_page(ws):
        await ws.close(code=1008)                # refused before it opens: the page sees 403
        return
    await ws.accept()
    lock = anyio.Lock()

    async def say(text: str) -> None:
        async with lock:                         # one message at a time: each stream sends from its own task
            await ws.send_text(text)

    gone: Dict[str, anyio.Event] = {}            # each open stream's: set once the page lets it go

    async def run(sid: str, url: str, left: anyio.Event) -> None:
        parts = urlsplit(url)
        if not STREAM.fullmatch(parts.path):
            await say(f"{sid}\n!fail\n404")
            return
        scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"}, "http_version": "1.1",
                 "method": "GET", "scheme": "http", "path": unquote(parts.path), "raw_path": parts.path.encode(),
                 "query_string": parts.query.encode("latin-1"), "root_path": "",
                 "headers": [(k, v) for k, v in ws.scope["headers"] if k in PASSED] + [(b"accept", b"text/event-stream")],
                 "client": ws.scope.get("client"), "server": ws.scope.get("server"),
                 "state": dict(ws.scope.get("state") or {})}
        asked, status, rest = False, 0, b""

        async def receive() -> dict:
            nonlocal asked
            if not asked:
                asked = True
                return {"type": "http.request", "body": b"", "more_body": False}
            await left.wait()
            return {"type": "http.disconnect"}

        async def send(message: dict) -> None:
            nonlocal status, rest
            if left.is_set():
                return
            if message["type"] == "http.response.start":
                status = message["status"]
                if status == 200:
                    await say(f"{sid}\n!open\n")
            elif message["type"] == "http.response.body" and status == 200:
                rest += message.get("body", b"")
                end = rest.rfind(b"\n\n")
                if end >= 0:
                    whole, rest = rest[:end], rest[end + 2:]
                    for name, data in events(whole):
                        await say(f"{sid}\n{name}\n{data}")

        try:
            await ws.app(scope, receive, send)
        except Exception:                        # noqa: BLE001 - the stream's own failure: the page is told it ended
            log.exception("stream %s", parts.path)
        finally:
            if gone.get(sid) is left:
                del gone[sid]
        if not left.is_set():
            with anyio.CancelScope(shield=True):
                try:
                    await say(f"{sid}\n!end\n" if status == 200 else f"{sid}\n!fail\n{status or 500}")
                except Exception:                # noqa: BLE001 - the socket went meanwhile
                    pass

    async with anyio.create_task_group() as tasks:
        try:
            await say("0\nhello\n")
            while True:
                try:
                    ask = json.loads(await ws.receive_text())
                except (ValueError, KeyError):   # not JSON text: not the page's
                    continue
                if not isinstance(ask, dict):
                    continue
                if "open" in ask:
                    sid = str(ask["open"])
                    if sid in gone or len(gone) >= MAX_OPEN:
                        await say(f"{sid}\n!fail\n429")
                        continue
                    left = gone[sid] = anyio.Event()
                    tasks.start_soon(run, sid, str(ask.get("url") or ""), left)
                elif "close" in ask:
                    left = gone.pop(str(ask["close"]), None)
                    if left is not None:
                        left.set()
        except (WebSocketDisconnect, RuntimeError):   # the page went (RuntimeError: a send after it did)
            pass
        finally:
            for left in gone.values():           # each stream sees its page go, and lets go what it holds
                left.set()
            gone.clear()
