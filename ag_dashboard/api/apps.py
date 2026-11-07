"""The apps (app_host.py): what the page asks of them, what an app in its own process asks of the host, and each app's
own origin (`Origins`) -- its panel's files and its backend's routes, and nothing of the dashboard's.

On the dashboard's origin, for its page:

    GET  /api/apps?gatherer=G                    the apps found, broken ones, G's instances and their agents
    POST /api/apps/open    {app, gatherer, folder?, args?, channel?}   an instance (attached to `channel`, if given)
    POST /api/apps/close   {gatherer, instance}
    POST /api/apps/attach  {gatherer, instance, channel}      POST /api/apps/detach (the same)
    GET  /api/apps/events?app&gatherer&instance&types=a,b&after&channel&limit     what the app may read
    POST /api/apps/insert  {app, gatherer, instance, events, channel?}            what its panel inserts
    POST /api/apps/call    {app, gatherer, instance, tool, args}                  the user's call, from its panel
    GET  /api/apps/stream?app&gatherer&instance&types&after     server-sent `event` (a row) and `message` (its
                                                                backend's word to its panels), until the page goes

    POST /api/apps/answer  {app, gatherer, instance, id, result}               a panel's answer to a tool call

For agents (tool_gateway.py): POST /mcp/<actor>, the apps' MCP server; POST /api/apps/agent {actor} and
/api/apps/agent/call {actor, tool, args}, what `ag apps` asks.

For an app in its own process (app_kit's remote.py), with its token: POST /apps/host/<name>/<op>.

On an app's own origin, http://<name>.localhost:<port> (app_host's `origin`), which a page of the dashboard frames:
GET its panel's files (`/` is its entry), and /api/<path>?gatherer&instance (any method) its backend's `request`. A
write there only from that origin. No other route of the dashboard answers there, its WebSocket included."""

import hmac
import mimetypes
import os
import re
from typing import Optional
from urllib.parse import parse_qsl

import anyio
from fastapi import APIRouter, Depends, Request
from starlette.datastructures import Headers
from starlette.responses import Response

from app_kit import AppError, Caller, remote

from .. import app_host, mcp, tool_gateway
from .common import Body, Errors, Parts, answer, failure, local_only, not_found, queue_events

router = APIRouter(route_class=Errors)
ORIGIN_HOST = re.compile(r"^([a-z][a-z0-9-]{0,23})\.localhost(?::\d+)?$")


def _failed(exc: AppError) -> Response:
    return failure(exc.status if 400 <= exc.status < 600 else 400, str(exc))


def _host(srv) -> "app_host.AppHost":
    if getattr(srv, "app_host", None) is None:
        raise AppError("no apps here", 404)
    return srv.app_host


def _need(body: dict, *keys: str) -> list:
    missing = [k for k in keys if not isinstance(body.get(k), str) or not body.get(k)]
    if missing:
        raise AppError(f"{', '.join(missing)}: required")
    return [body[k] for k in keys]


@router.get("/api/apps", dependencies=[Depends(local_only)])
def apps_listed(srv: Parts, gatherer: str = "") -> Response:
    """The apps found (each its manifest, its panel's origin), those whose manifest can't be read (`broken`), and --
    for gatherer G -- its open instances and the agents attached to each."""
    try:
        return answer(_host(srv).listed(gatherer or None))
    except AppError as exc:
        return _failed(exc)


@router.post("/api/apps/open")
def apps_open(srv: Parts, body: Body) -> Response:
    """The app's instance for the gatherer (and folder, for an app with one per folder or checkout): the open one, or
    a new one. With `channel`, that agent attached to it."""
    try:
        name, gatherer = _need(body, "app", "gatherer")
        h = _host(srv)
        i = h.open(name, gatherer, body.get("folder") or None, body.get("args") or {})
        if body.get("channel"):
            h.attach(gatherer, i.id, body["channel"])
        return answer(i.to_dict())
    except AppError as exc:
        return _failed(exc)


@router.post("/api/apps/close")
def apps_close(srv: Parts, body: Body) -> Response:
    """The instance closed: its agents detached, its backend told."""
    try:
        gatherer, instance = _need(body, "gatherer", "instance")
        _host(srv).close_instance(gatherer, instance)
        return answer({})
    except AppError as exc:
        return _failed(exc)


@router.post("/api/apps/attach")
def apps_attach(srv: Parts, body: Body) -> Response:
    """An agent (its channel) attached to the instance."""
    try:
        gatherer, instance, channel = _need(body, "gatherer", "instance", "channel")
        _host(srv).attach(gatherer, instance, channel)
        return answer({})
    except AppError as exc:
        return _failed(exc)


@router.post("/api/apps/detach")
def apps_detach(srv: Parts, body: Body) -> Response:
    """An agent detached from the instance."""
    try:
        gatherer, instance, channel = _need(body, "gatherer", "instance", "channel")
        _host(srv).detach(gatherer, instance, channel)
        return answer({})
    except AppError as exc:
        return _failed(exc)


@router.get("/api/apps/events", dependencies=[Depends(local_only)])
def apps_events(srv: Parts, app: str = "", gatherer: str = "", instance: str = "", types: str = "", after: int = 0,
                channel: str = "", limit: int = 500) -> Response:
    """The instance's events of TYPES (comma-separated) after row AFTER, as the app may read them."""
    try:
        h = _host(srv)
        i = h.instance(gatherer, instance, app)
        wanted = [t for t in types.split(",") if t]
        return answer({"events": h.read(app, i, wanted, after, channel or None, limit)})
    except AppError as exc:
        return _failed(exc)


@router.post("/api/apps/insert")
def apps_insert(srv: Parts, body: Body) -> Response:
    """Events the app's panel puts into its instance's gatherer, checked as its backend's are."""
    try:
        name, gatherer, instance = _need(body, "app", "gatherer", "instance")
        h = _host(srv)
        h.insert(name, h.instance(gatherer, instance, name), body.get("events"), body.get("channel") or None)
        return answer({})
    except AppError as exc:
        return _failed(exc)


@router.post("/api/apps/call")
def apps_call(srv: Parts, body: Body) -> Response:
    """A tool of the app called by the user, from its panel: the backend's answer, as MCP gives one."""
    try:
        name, gatherer, instance, tool = _need(body, "app", "gatherer", "instance", "tool")
        h = _host(srv)
        args = body.get("args") if isinstance(body.get("args"), dict) else {}
        return answer(h.call(name, h.instance(gatherer, instance, name), tool, args, Caller(gatherer=gatherer),
                             from_panel=True).to_dict())
    except AppError as exc:
        return _failed(exc)


@router.post("/api/apps/answer")
def apps_answer(srv: Parts, body: Body) -> Response:
    """A panel's answer to a tool call it was asked (its `ag: call` message): MCP's result."""
    try:
        name, gatherer, instance, cid = _need(body, "app", "gatherer", "instance", "id")
        h = _host(srv)
        h.answer_panel(h.instance(gatherer, instance, name), cid, body.get("result"))
        return answer({})
    except AppError as exc:
        return _failed(exc)


@router.post("/mcp/{actor}")
async def apps_mcp(srv: Parts, actor: str, request: Request) -> Response:
    """The apps' MCP server for an actor (tool_gateway.py): its gatherer's apps' tools, their instructions, and each
    call to the instance the actor is attached to."""
    raw = await request.body()
    rows = srv.sessions.list()

    def serve():
        try:
            row = tool_gateway.row_of(rows, actor)
        except AppError as exc:
            return 404, {"jsonrpc": "2.0", "id": None, "error": {"code": -32001, "message": str(exc)}}
        return mcp.handle(raw, tool_gateway.tools(row["gatherer"]),
                          lambda name, args: tool_gateway.call(srv.sessions.list(), actor, name, args),
                          tool_gateway.NAME, tool_gateway.endpoint(actor), tool_gateway.instructions(row["gatherer"]))
    status, got = await anyio.to_thread.run_sync(serve)
    return answer(got, status) if got is not None else Response(status_code=status)


@router.post("/api/apps/agent")
def apps_agent(srv: Parts, body: Body) -> Response:
    """What `ag apps` lists for an actor: its gatherer's apps, their tools and instructions, and its instances."""
    try:
        (actor,) = _need(body, "actor")
        _host(srv)
        return answer(tool_gateway.listed(srv.sessions.list(), actor))
    except AppError as exc:
        return _failed(exc)


@router.post("/api/apps/agent/call")
def apps_agent_call(srv: Parts, body: Body) -> Response:
    """A tool called by an actor through `ag apps call`: MCP's result, as its MCP server would give it."""
    try:
        actor, tool = _need(body, "actor", "tool")
        _host(srv)
        args = body.get("args") if isinstance(body.get("args"), dict) else {}
        return answer(tool_gateway.call(srv.sessions.list(), actor, tool, args))
    except AppError as exc:
        return _failed(exc)


@router.get("/api/apps/stream", dependencies=[Depends(local_only)])
def apps_stream(srv: Parts, app: str = "", gatherer: str = "", instance: str = "", types: str = "",
                after: int = 0) -> Response:
    """Server-sent events, until the page goes: `event` (a new row of TYPES the app may read, after AFTER) and
    `message` (what its backend tells its panels)."""
    try:
        h = _host(srv)
        sub, leave = h.subscribe(app, h.instance(gatherer, instance, app), [t for t in types.split(",") if t], after)
    except AppError as exc:
        return _failed(exc)
    return queue_events(sub.queue, leave)


@router.post("/apps/host/{name}/{op}")
async def host_op(srv: Parts, name: str, op: str, request: Request) -> Response:
    """What an app in its own process asks of the host (app_kit's remote.py), with the token it was started with."""
    try:
        h = _host(srv)
        hosted = h.hosted(name)
    except AppError as exc:
        return _failed(exc)
    got = request.headers.get("authorization", "")
    if not hmac.compare_digest(got.encode(), f"Bearer {hosted.token}".encode()):
        return failure(401, "not this app's token")
    try:
        body = await request.json()
    except ValueError:
        return failure(400, "a JSON object, please")
    bound = app_host.Bound(h, name)
    fn = remote.host_ops(bound, bound.instance_of).get(op)
    if fn is None or not isinstance(body, dict):
        return not_found()
    try:
        return answer(await anyio.to_thread.run_sync(fn, body))
    except AppError as exc:
        return _failed(exc)
    except (KeyError, TypeError, ValueError) as exc:
        return failure(400, f"{op}: {exc}")


# ---------------------------------------------------------------- each app's own origin


class Origins:
    """Requests to an app's origin (<name>.localhost) answered here, never by the dashboard's routes: its panel's
    files, and its backend's /api/. Every other request passes on."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)
        m = ORIGIN_HOST.match((headers.get("host") or "").lower())
        if m is None:
            return await self.app(scope, receive, send)
        if scope["type"] == "websocket":
            return await send({"type": "websocket.close", "code": 1008})
        srv = scope["app"].state.server
        h = getattr(srv, "app_host", None)
        hosted = h.named_by_label(m.group(1)) if h is not None else None
        if hosted is None:
            return await send_plain(404, b"no such app", scope, receive, send)
        origin = h.origin(hosted.manifest.name)
        path, method = scope["path"], scope["method"]
        if path == "/api" or path.startswith("/api/"):
            if method != "GET" and headers.get("origin") != origin:
                return await send_plain(403, b"only the app's own panel may do that", scope, receive, send)
            body = await _read_body(receive)
            query = dict(parse_qsl((scope.get("query_string") or b"").decode("latin-1")))
            try:
                inst = h.instance(query.get("gatherer", ""), query.get("instance", ""), hosted.manifest.name) \
                    if query.get("instance") else None
                r = await anyio.to_thread.run_sync(h.request, hosted.manifest.name, inst, method,
                                                   path[len("/api/"):], query, body)
            except AppError as exc:
                return await _failed(exc)(scope, receive, send)
            return await Response(r.body, r.status, headers={**r.headers, **_framed(srv)})(scope, receive, send)
        if method != "GET":
            return await send_plain(405, b"its panel's files are read only", scope, receive, send)
        found = _panel_file(hosted.manifest, path)
        if found is None:
            return await send_plain(404, b"not found", scope, receive, send)
        kind = mimetypes.guess_type(found)[0] or "application/octet-stream"
        with open(found, "rb") as fh:
            raw = fh.read()
        return await Response(raw, 200, media_type=kind, headers=_framed(srv))(scope, receive, send)


def _framed(srv) -> dict:
    """An app's answers framed by the dashboard's own page only, and read as what they say they are."""
    port = srv.server_port if srv is not None else 0
    return {"content-security-policy": f"frame-ancestors http://127.0.0.1:{port} http://localhost:{port}",
            "x-content-type-options": "nosniff", "cache-control": "no-store"}


def _panel_file(manifest, path: str) -> Optional[str]:
    """The file of the app's panel a path names: `/` its entry; anything outside its panel's folder, none."""
    entry = manifest.panel_path()
    if entry is None:
        return None
    root = os.path.realpath(os.path.dirname(entry))
    rel = path.lstrip("/") or os.path.basename(entry)
    full = os.path.realpath(os.path.join(root, rel))
    if os.path.commonpath([full, root]) != root or not os.path.isfile(full):
        return None
    return full


async def _read_body(receive) -> bytes:
    chunks, more = [], True
    while more:
        msg = await receive()
        chunks.append(msg.get("body", b""))
        more = msg.get("more_body", False)
    return b"".join(chunks)


async def send_plain(status: int, body: bytes, scope, receive, send_) -> None:
    await Response(body, status, media_type="text/plain")(scope, receive, send_)
