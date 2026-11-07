"""The dashboard's FastAPI app (`create`): its routers (api/, one per feature), each request first through `OwnPage`
-- the query read as the page's (`first_values`), and only the dashboard's own page let write -- and errors answered
as the page reads them (api/common.py). `uvicorn` is the server that runs it (server.py's `serve_forever`).

`python -m ag_dashboard --routes` prints `routes()`: every route, with what its handler's docstring says first."""

import importlib.util
from typing import List, Optional, Tuple
from urllib.parse import parse_qsl, urlencode, urlsplit

import uvicorn
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException

from . import apps, server
from .api import (agent, branches, common, editor, files, history, home, monitor, page, preview, sessions, settings,
                  stream, terminal, ws)
from .api import apps as apps_api

ROUTERS = (page.router, home.router, stream.router, agent.router, files.router, history.router, sessions.router,
           terminal.router, editor.router, preview.router, branches.router, monitor.router, settings.router, ws.router,
           apps_api.router,                           # the apps' host (app_host.py)
           *(a.router() for a in apps.APPS))          # each app's own (apps.py)
WEBSOCKETS = "wsproto" if importlib.util.find_spec("wsproto") else "none"   # without it, the page's streams are its own
                                                                           # connections (api/ws.py)
WRITES = ("POST", "PUT", "PATCH", "DELETE")


def create(srv: Optional["server.Server"] = None) -> FastAPI:
    """The app over `srv`'s parts (its sessions, editors, previews, ...: what the routes share); without one, only to
    list its routes or make its schema."""
    app = FastAPI(title="ag dashboard", docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False)
    app.state.server = srv
    app.state.streams = set()                    # the open streams' cancel scopes (common.Events), ended on a stop
    for router in ROUTERS:
        app.include_router(router)
    app.add_middleware(OwnPage)
    app.add_middleware(apps_api.Origins)         # outermost: an app's origin never reaches the dashboard's routes
    app.add_exception_handler(HTTPException, _no_route)
    app.add_exception_handler(RequestValidationError, _not_valid)
    app.add_exception_handler(common.Answered, _answered)
    return app


def routes() -> List[Tuple[str, str, str]]:
    """(methods, path, what it answers) of every route, in the routers' order: what it answers, the first paragraph of
    its handler's docstring, on one line."""
    out = []
    for router in ROUTERS:
        for route in router.routes:
            doc = " ".join((route.endpoint.__doc__ or "").strip().split("\n\n")[0].split())
            out.append((", ".join(sorted(getattr(route, "methods", None) or ["WEBSOCKET"])), route.path, doc))
    return out


def uvicorn_server(app: FastAPI) -> "Uvicorn":
    """uvicorn's server for the app (h11, quiet; WebSockets by wsproto, uncompressed: this machine's), its open streams
    ended as it stops."""
    config = uvicorn.Config(app, http="h11", ws=WEBSOCKETS, ws_per_message_deflate=False, lifespan="off",
                            log_config=None, log_level="warning",
                            access_log=False, proxy_headers=False, server_header=False,
                            timeout_keep_alive=server.IDLE_SECONDS, timeout_graceful_shutdown=server.STOP_SECONDS,
                            h11_max_incomplete_event_size=server.MAX_HEAD)
    return Uvicorn(config, lambda: common.end_streams(app))


class Uvicorn(uvicorn.Server):
    """uvicorn's server, its open streams ended as it stops, once it takes no new connection (a page's stream would
    open again): each stream's response ends, so its connection closes, as uvicorn waits for every one to."""

    def __init__(self, config: uvicorn.Config, end_streams):
        super().__init__(config)
        self.end_streams = end_streams

    async def shutdown(self, sockets=None):
        for listening in getattr(self, "servers", []):
            listening.close()
        self.end_streams()
        await super().shutdown(sockets)


def first_values(query: bytes) -> bytes:
    """The query as the page's routes read it, as http.server's handler did (parse_qs, the first of each): a value
    left blank is no value, and a key given twice is its first."""
    out = {}
    for k, v in parse_qsl(query.decode("latin-1")):
        out.setdefault(k, v)
    return urlencode(out).encode("ascii")


def own_page(headers: Headers, host_named: bool, json_only: bool = True) -> bool:
    """Whether a write comes from the dashboard's own page: JSON (which a page elsewhere can send only after a
    preflight this server never answers), from no other origin, to this host as named (not a name rebound to it)."""
    origin = headers.get("origin")
    return (not json_only or (headers.get("content-type") or "").split(";")[0].strip() == "application/json") \
        and (origin is None or urlsplit(origin).netloc == (headers.get("host") or "")) and host_named


class OwnPage:
    """Every request's query read as the page's (`first_values`), its path's leading slashes made one, as http.server's
    handler did; and a write (POST, PUT, PATCH, DELETE) taken from the dashboard's own page only (`own_page`), its body
    no larger than MAX_BODY (an app's page's, under /<name>/w/: its own `max_body`, apps.py): else 403 -- or, a body
    too large from the page to /api, 400 -- its connection not used again. PUT, PATCH and DELETE only to an app's page
    that takes them (its `page_writes`), JSON or not. A method other than these and GET: 501, as http.server's handler
    answered it -- so no preflight is ever answered."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        scope = dict(scope, query_string=first_values(scope.get("query_string") or b""))
        if scope["path"].startswith("//"):          # one slash, as http.server made of a path's leading slashes
            scope["path"] = "/" + scope["path"].lstrip("/")
            if scope.get("raw_path"):
                scope["raw_path"] = b"/" + scope["raw_path"].lstrip(b"/")
        method, path = scope["method"], scope["path"]
        if method == "GET":
            return await self.app(scope, receive, send)
        if method not in WRITES:
            return await common.send(501, f"Unsupported method ({method!r})".encode(), "text/plain")(scope, receive, send)
        headers = Headers(scope=scope)
        host_named = common.named_here(headers.get("host"), scope["app"].state.server if "app" in scope else None)
        mine = apps.under(path)                     # an app's page's: its own limit and methods
        limit = mine.max_body if mine is not None and mine.max_body else server.MAX_BODY
        try:
            length = int(headers.get("content-length") or 0)
        except ValueError:
            length = -1
        large = not 0 <= length <= limit
        refused = common.failure(403, common.REFUSED)
        if method != "POST":
            ok = mine is not None and method in mine.page_writes and own_page(headers, host_named, json_only=False)
        else:
            ok = own_page(headers, host_named)
        if large:                                    # its body left unread: the connection is not used again
            answer = refused if mine is not None or not ok or method != "POST" else \
                common.failure(400, "a JSON object, please")
            answer.headers["connection"] = "close"
            return await answer(scope, receive, send)
        if not ok:
            return await refused(scope, receive, send)
        return await self.app(scope, receive, send)


async def _no_route(request: Request, exc: HTTPException):
    """No route for the path, or not for its method: "not found", as http.server's handler said it."""
    if exc.status_code in (404, 405):
        return common.not_found()
    return common.send(exc.status_code, str(exc.detail).encode(), "text/plain")


async def _not_valid(request: Request, exc: RequestValidationError):
    """A query or path not as the route takes it (a number that is not one, a name left out): not found, as http.server's
    handler found no route for it."""
    return common.not_found()


async def _answered(request: Request, exc: common.Answered):
    return exc.response
