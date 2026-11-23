"""The gatherer's projects, and its actors' own branches of them (branches.py): each in a worktree of its own, its
changes held for the reader to take in or leave out."""

import json
from typing import List, Optional

import harness_kit
from fastapi import APIRouter, Depends
from starlette.responses import Response

from .. import branches
from ..models import Projects
from .common import Body, Errors, Parts, answer, local_only, not_found

router = APIRouter(route_class=Errors)


def strings(raw) -> List[str]:
    """A list of strings, as JSON (a query's) or as is (a body's); what is not one is left out."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return []
    return [x for x in raw if isinstance(x, str)][:64] if isinstance(raw, list) else []


@router.get("/api/projects", dependencies=[Depends(local_only)], response_model=Projects)
def projects(gatherer: str, dirs: Optional[str] = None) -> Response:
    """{projects, suggestions}: the gatherer's projects, the repositories its actors' branches are made from, and those
    the directories D (?dirs=[D, ...]) are in (branches.py)."""
    return answer({"projects": branches.projects(gatherer), "suggestions": branches.suggestions(gatherer, strings(dirs))})


@router.get("/api/branches", dependencies=[Depends(local_only)])
def under(srv: Parts, root: str = "") -> Response:
    """The actors' branches of the projects R is in or holds, each with its changes held for the reader (branches.py's
    `under`)."""
    if srv.branches is None:
        return not_found()
    return answer(srv.branches.under(root))


@router.post("/api/projects", response_model=Projects)
def set_project(body: Body) -> Response:
    """{gatherer, add | remove, dirs?}: a project set for the gatherer (a folder in a repository, or a GitHub
    repository: cloned), or no longer -> as GET /api/projects."""
    g = str(body.get("gatherer") or "")
    got = branches.remove_project(g, str(body["remove"])) if body.get("remove") \
        else branches.add_project(g, str(body.get("add") or ""))
    return answer({"projects": got, "suggestions": branches.suggestions(g, strings(body.get("dirs")))})


@router.post("/api/branches")
def new_branch(srv: Parts, body: Body) -> Response:
    """{gatherer, project, harness?, approve?, model?}: a new session on a new branch of the project, in a worktree of
    its own (branches.py's `create`) -> the session."""
    if srv.branches is None:
        return not_found()
    s = srv.branches.create(str(body.get("gatherer") or ""), str(body.get("project") or ""),
                            str(body.get("harness") or harness_kit.DEFAULT), bool(body.get("approve")),
                            str(body.get("model") or "") or None)
    srv.hub.ring(s["gatherer"], what="list")
    return answer(s)


@router.post("/api/branches/approve")
def approve(srv: Parts, body: Body) -> Response:
    """{session_id, approve}: whether every change of its branch's is asked about -> the session."""
    if srv.branches is None:
        return not_found()
    got = srv.branches.set_approve(str(body.get("session_id") or ""), bool(body.get("approve")))
    srv.hub.ring(got["gatherer"], what="list")
    return answer(got)


@router.post("/api/branches/decide")
def decide(srv: Parts, body: Body) -> Response:
    """{session_id, path, take}: each change of its branch's to the file held for the reader, taken in ("theirs") or
    left out ("mine") -> the branch."""
    if srv.branches is None:
        return not_found()
    return answer(srv.branches.decide(str(body.get("session_id") or ""), str(body.get("path") or ""),
                                      str(body.get("take") or "")))
