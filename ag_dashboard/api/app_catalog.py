"""The Apps page's routes (app_catalog.py; app_kit's installing.py): what is installed, can't load, or can be
installed, and installing, updating and uninstalling. `ag apps install|uninstall|update|list --all` ask the same.

    GET  /api/apps/catalog                       {installed, broken, available, found} (app_catalog.catalog): the app
                                                 folders read again first, `found` what changed since
    GET  /api/apps/updates                       {updates: {name: newest commit}}: apps installed from git, newer
    POST /api/apps/stage      {source}           a folder or git URL copied aside and checked -> what it is, its `id`
    POST /api/apps/install    {id, update?}      the staged app installed (`update`: in place of the one there)
                              {builtin}          an app that comes with ag, uninstalled, installed again
    POST /api/apps/discard    {id}               the staged app removed
    POST /api/apps/uninstall  {name, data?}      uninstalled; `data`: its data/ deleted too
    POST /api/apps/settings   {app, agent?, on_task?}   the reader's choices of an app, each given kept (app_settings.py):
                                                 `agent`, opened with an agent of its own from now on, or on its own;
                                                 `on_task`, what "+" on an actor or a task does with it: "join",
                                                 "folder" or "no" (app_policy.py) -> {agent?, on_task?}

With `actor` -- `ag apps` run in an agent's shell, which says who asks -- install and uninstall only ask the user
(app_requests.py): {waiting: the request}, done once the user approves it in the dashboard:

    GET  /api/apps/requests                      {requests}: those waiting, as the page shows them
    GET  /api/apps/requests/<id>                 one, as its agent's `ag apps` waits on it
    POST /api/apps/requests/<id> {approve}       the user's answer: done as asked, or not; the agent told

An app installed or uninstalled is found again at once (app_host's `find`): its panel opens, or no longer, anywhere;
agents get its tools, or lose them, when their terminal next starts."""

from fastapi import APIRouter, Depends
from starlette.responses import Response

import app_kit
from app_kit import AppError
from app_kit.installing import InstallError

from .. import app_catalog, app_policy, app_requests, app_settings
from ..models import Catalog, Staged, Updates
from .common import Body, Errors, Parts, answer, failure, local_only

router = APIRouter(route_class=Errors)


def _host(srv):
    if getattr(srv, "app_host", None) is None:
        raise AppError("no apps here", 404)
    return srv.app_host


def _run(fn, *args) -> Response:
    try:
        return answer(fn(*args))
    except InstallError as exc:
        return failure(400, str(exc))
    except AppError as exc:
        return failure(exc.status if 400 <= exc.status < 600 else 400, str(exc))


@router.get("/api/apps/catalog", dependencies=[Depends(local_only)], response_model=Catalog)
def apps_catalog(srv: Parts) -> Response:
    """Every app installed (what it gives agents and costs them, what it may do, where it came from, its windows open,
    its data), the folders that couldn't load, and the apps that can be installed."""
    return _run(lambda: app_catalog.catalog(_host(srv)))


@router.get("/api/apps/updates", dependencies=[Depends(local_only)], response_model=Updates)
def apps_updates(srv: Parts) -> Response:
    """The apps installed from git that have a newer commit: {updates: {name: commit}} (asks each source)."""
    return _run(lambda: {"updates": app_catalog.updates(_host(srv))})


@router.post("/api/apps/stage", response_model=Staged)
def apps_stage(srv: Parts, body: Body) -> Response:
    """A folder or git URL copied aside and its app.toml checked: what it is, its staging id, and -- one installed of
    that name -- what an update changes."""
    return _run(lambda: app_catalog.stage(_host(srv), str(body.get("source") or "")))


@router.post("/api/apps/install")
def apps_install(srv: Parts, body: Body) -> Response:
    """The staged app (`id`) installed -- `update`: in place of the one installed -- or (`builtin`) an app that comes
    with ag installed again. On in every group at once."""
    if body.get("actor"):                                     # an agent's: the user's to approve
        op = "update" if body.get("update") else "install"
        args = {"builtin": str(body["builtin"])} if body.get("builtin") else {"id": str(body.get("id") or "")}
        return _run(lambda: {"waiting": app_requests.ask(_host(srv), srv.sessions.list(), str(body["actor"]), op, args)})
    if body.get("builtin"):
        return _run(lambda: app_catalog.restore(_host(srv), str(body["builtin"])))
    return _run(lambda: app_catalog.install(_host(srv), str(body.get("id") or ""), bool(body.get("update"))))


@router.post("/api/apps/discard")
def apps_discard(srv: Parts, body: Body) -> Response:
    """A staged app removed, not installed."""
    return _run(lambda: app_catalog.discard(str(body.get("id") or "")))


@router.post("/api/apps/uninstall")
def apps_uninstall(srv: Parts, body: Body) -> Response:
    """The app uninstalled: its windows close, its backend stops, agents lose its tools at their next start; its data
    kept unless `data`."""
    if body.get("actor"):                                     # an agent's: the user's to approve
        args = {"name": str(body.get("name") or ""), "data": bool(body.get("data"))}
        return _run(lambda: {"waiting": app_requests.ask(_host(srv), srv.sessions.list(), str(body["actor"]),
                                                         "uninstall", args)})
    return _run(lambda: app_catalog.uninstall(_host(srv), str(body.get("name") or ""), bool(body.get("data"))))


@router.post("/api/apps/settings")
def apps_settings(srv: Parts, body: Body) -> Response:
    """{app, agent?, on_task?}: the reader's choices of the app, from now on -- `agent`, started with an agent of its
    own when opened from a menu, or on its own (only for an app that can have one); `on_task`, what "+" on an actor or
    a task does with it (app_policy.py: one it can take; its manifest's own, no choice kept). Each checked before
    either is kept."""
    def chosen():
        name = str(body.get("app") or "")
        m = _host(srv).hosted(name).manifest
        if "agent" not in body and "on_task" not in body:
            raise AppError("which choice? agent or on_task")
        if "agent" in body and not isinstance(body["agent"], bool):
            raise AppError("agent: true or false")
        if "agent" in body and not m.agent.offered:
            raise AppError(f"{name} has no agent of its own to open with")
        if "on_task" in body and not app_policy.allowed(m, body["on_task"]):
            can = [v for v in app_kit.manifest.ON_TASK if app_policy.allowed(m, v)]
            raise AppError(f"on_task: one of {', '.join(can)} for {m.label}")
        got = app_settings.choose(name, body["agent"]) if "agent" in body else {}
        if "on_task" in body:
            got = {**got, "on_task": app_policy.choose(m, body["on_task"])}
        return got
    return _run(chosen)


@router.get("/api/apps/requests", dependencies=[Depends(local_only)])
def apps_requests(srv: Parts) -> Response:
    """The agents' requests waiting for the user (app_requests.py)."""
    return _run(lambda: {"requests": app_requests.pending()})


@router.get("/api/apps/requests/{rid}", dependencies=[Depends(local_only)])
def apps_request(srv: Parts, rid: str) -> Response:
    """One request, as its agent's `ag apps` waits on it."""
    return _run(lambda: app_requests.get(rid))


@router.post("/api/apps/requests/{rid}")
def apps_request_settle(srv: Parts, rid: str, body: Body) -> Response:
    """The user's answer to an agent's request: {approve: true} done as asked; else declined. The agent told."""
    return _run(lambda: app_requests.settle(_host(srv), rid, bool(body.get("approve"))))
