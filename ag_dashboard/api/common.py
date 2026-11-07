"""What the routers share: the server's parts (`Parts`), answers as the page reads them (`send`, `answer`), the errors
answered so (`Errors`), a POST's JSON body (`Body`), the query's numbers (`Whole`, `Decimal`), the check that a request
names this host (`local_only`), and server-sent events (`Events`, `queue_events`, `blocking`)."""

import json
import queue
from typing import Annotated, Any, Callable, Optional
from urllib.parse import urlsplit

import anyio
from fastapi import Depends, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BeforeValidator
from sse_starlette import EventSourceResponse
from starlette.exceptions import HTTPException
from starlette.responses import Response

from .. import editor, server, sessions

LOCAL = ("127.0.0.1", "localhost", "::1")      # the names of this host a page on it is reached by
REFUSED = "only the dashboard's own page may do that"
KEEPALIVE_EVENT = b": keepalive\n\n"


def send(status: int, body: bytes, kind: str, cache: str = "no-store", headers: Optional[dict] = None) -> Response:
    """A response as http.server's handler sent it: its type as given (no charset added), not kept by the browser."""
    return Response(body, status_code=status, headers={"content-type": kind, "cache-control": cache, **(headers or {})})


def answer(value, status: int = 200) -> Response:
    """JSON as json.dumps writes it (the page reads nothing else)."""
    return send(status, json.dumps(value).encode("utf-8"), "application/json")


def failure(status: int, message: str, **more) -> Response:
    return answer({"error": message, **more}, status)


def not_found(body: bytes = b"not found") -> Response:
    return send(404, body, "text/plain")


class Answered(Exception):
    """A response given at once, from a check before the route's own work (`local_only`)."""

    def __init__(self, response: Response):
        super().__init__(response.status_code)
        self.response = response


async def parts(request: Request) -> "server.Server":
    """The server whose app this is: its sessions, editors, apps, ... (server.py's Server)."""
    return request.app.state.server


Parts = Annotated[server.Server, Depends(parts)]


def named_here(host_header: Optional[str], srv: Optional["server.Server"]) -> bool:
    """Whether a request's Host names this host as it is named (not a name rebound to it, as a page elsewhere could):
    localhost, or the address the server listens on."""
    host = urlsplit("//" + (host_header or "")).hostname
    return host in LOCAL or (srv is not None and host == srv.server_address[0])


async def local_only(request: Request) -> None:
    """Refused (403) unless asked of this host as named: a route that reads files' text, or runs what a preview runs."""
    if not named_here(request.headers.get("host"), request.app.state.server):
        raise Answered(send(403, REFUSED.encode(), "text/plain"))


async def _body(request: Request) -> dict:
    """The POST's body: a JSON object, else a ValueError (400) -- an empty one too, as http.server's handler took none."""
    raw = await request.body()
    if not raw:
        raise ValueError("a JSON object, please")
    value = json.loads(raw) if len(raw) < 1_000_000 else await anyio.to_thread.run_sync(json.loads, raw)
    if not isinstance(value, dict):
        raise ValueError("a JSON object, please")
    return value


Body = Annotated[dict, Depends(_body)]


def _whole(value):
    if isinstance(value, str) and not value.isdigit():
        raise ValueError("a whole number, please")
    return value


def _decimal(value):
    if isinstance(value, str) and not value.replace(".", "", 1).isdigit():
        raise ValueError("a number, please")
    return value


Whole = Annotated[int, BeforeValidator(_whole)]             # digits only: no sign, no space, no "1_000"
Decimal = Annotated[float, BeforeValidator(_decimal)]       # digits, with one point at most


def _read_error(exc: Exception) -> Response:
    if isinstance(exc, editor.EditorError):
        return failure(400, str(exc))
    return failure(500, f"{type(exc).__name__}: {exc}")


def _write_error(exc: Exception) -> Response:
    if isinstance(exc, ValueError):          # a session's, an editor's, a preview's... error; a body not JSON
        return failure(400, str(exc), **({"box": exc.box} if isinstance(exc, sessions.NotAtBox) else {}))
    return failure(500, f"{type(exc).__name__}: {exc}")


class Errors(APIRoute):
    """A route whose errors are answered as the page reads them, JSON {error}: a GET's an editor's 400,
    any other 500; a POST's ValueError (a session's, a body not a JSON object...) 400 -- with `box` when its terminal's
    message box cannot take it now -- any other 500. An app's routes answer its own errors (api/<name>.py)."""

    def failed(self, request: Request, exc: Exception) -> Response:
        return _read_error(exc) if request.method == "GET" else _write_error(exc)

    def get_route_handler(self):
        handle = super().get_route_handler()

        async def route(request: Request) -> Response:
            try:
                return await handle(request)
            except (HTTPException, RequestValidationError, Answered):
                raise
            except Exception as exc:  # noqa: BLE001 - the page shows the error and keeps its last view
                return self.failed(request, exc)
        return route


async def blocking(fn: Callable, *args) -> Any:
    """`fn(*args)` in a thread, as a stream's waits are: given up on at once when its page goes (the stream's `close`
    then ends the wait too: its watch woken, its queue given None, its viewer closed)."""
    return await anyio.to_thread.run_sync(fn, *args, abandon_on_cancel=True)


_EMPTY = object()                                # a queue's wait that brought nothing


def _taken(q: "queue.Queue", wait: float):
    try:
        return q.get(timeout=wait)
    except queue.Empty:
        return _EMPTY


async def _queued(q: "queue.Queue"):
    while True:
        item = await blocking(_taken, q, editor.GONE_CHECK)
        if item is _EMPTY:
            yield KEEPALIVE_EVENT
        elif item is None:
            return
        else:
            yield event(*item)


def queue_events(q: "queue.Queue", leave: Callable[[], None]) -> "Events":
    """Server-sent events, each a (name, value) the queue gets, until None comes (another stream took its place, or
    the server stops); a comment each GONE_CHECK seconds with none. Once it is over, `leave()` -- and None put in the
    queue, so a thread still waiting on it is let go too."""
    def close() -> None:
        try:
            leave()
        finally:
            q.put(None)
    return Events(_queued(q), close=close)


def event(name: str, value) -> bytes:
    """One server-sent event, as the page reads it."""
    return f"event: {name}\ndata: {json.dumps(value)}\n\n".encode("utf-8")


class Events(EventSourceResponse):
    """Server-sent events (sse-starlette), each chunk the content yields as it is (`event`, KEEPALIVE_EVENT), until
    the content ends, the page goes (the content cancelled at once) or the server stops (`end_streams`: the response
    ended, so its connection closes). `close` is called once it is over, whichever it was: what the stream held let go."""

    def __init__(self, content, close: Optional[Callable[[], None]] = None):
        super().__init__(content, ping=0, sep="\n", headers={"content-type": "text/event-stream"})
        self.close = close

    async def __call__(self, scope, receive, send):
        state = {"started": False, "done": False}

        async def sending(message):
            if message["type"] == "http.response.start":
                state["started"] = True
            elif not message.get("more_body", False):
                state["done"] = True
            await send(message)
        streams = scope["app"].state.streams
        try:
            with anyio.CancelScope() as scope_:
                streams.add(scope_)
                try:
                    await super().__call__(scope, receive, sending)
                finally:
                    streams.discard(scope_)
            if scope_.cancelled_caught and state["started"] and not state["done"]:   # the server stops: the page told
                await send({"type": "http.response.body", "body": b"", "more_body": False})
        finally:
            if self.close is not None:
                with anyio.CancelScope(shield=True):
                    await anyio.to_thread.run_sync(self.close)


def end_streams(app) -> None:
    """Every open stream of the app ended (`Events`), as the server stops; called on its event loop."""
    for scope in list(app.state.streams):
        scope.cancel()
