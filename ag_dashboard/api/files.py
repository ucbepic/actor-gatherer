"""An actor's files: each turn's (what it changed, read, made), a file's changes, an image a call's result holds."""

from typing import Optional, Union

from fastapi import APIRouter
from starlette.responses import Response

from .. import files as turn_files
from ..models import Failed, Files
from .common import Decimal, Errors, Whole, answer, send

router = APIRouter(route_class=Errors)


@router.get("/api/files", response_model=Union[Files, Failed])
def files(gatherer: str, channel: str, turn: Optional[Whole] = None, cwd: str = "") -> Response:
    """files.files(G, C, N, D): the actor's turns and the files of each (the turn N's, in the directory D)."""
    return answer(turn_files.files(gatherer, channel, turn, cwd))


@router.get("/api/files/changes")
def changes(gatherer: str, channel: str, path: str, since: Decimal, cwd: str = "") -> Response:
    """files.changes(G, C, P, S, D): the actor's changes to the file P since S (seconds)."""
    return answer(turn_files.changes(gatherer, channel, path, since, cwd))


@router.get("/api/image")
def image(gatherer: str, row_id: Whole, id: str) -> Response:  # noqa: A002 - the query's name
    """files.image(G, R, I): the image the call I's result holds, as stored in event R."""
    got = turn_files.image(gatherer, row_id, id)
    return send(200, got[1], got[0]) if got else send(404, b"no image", "text/plain")
