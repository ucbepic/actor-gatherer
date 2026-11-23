"""One actor: its state and calls (agent), what a read held (read, context), its history and transcript."""

from typing import Optional, Union

from fastapi import APIRouter, Query
from starlette.responses import Response

from .. import data
from ..models import Agent, Context, Failed, History, Transcript
from .common import Errors, Parts, Whole, answer

router = APIRouter(route_class=Errors)


@router.get("/api/agent", response_model=Union[Agent, Failed])
def agent(srv: Parts, gatherer: str, channel: str) -> Response:
    """data.agent(G, C): the actor's state, its calls and reads."""
    return answer(data.agent(gatherer, channel, srv.calls.get()))


@router.get("/api/read")
def read(gatherer: str, read_id: Whole) -> Response:
    """data.read(G, N): what the read N held."""
    return answer(data.read(gatherer, read_id))


@router.get("/api/context", response_model=Union[Context, Failed])
def context(gatherer: str, read_id: Whole) -> Response:
    """data.context(G, N): the context the read N gave."""
    return answer(data.context(gatherer, read_id))


@router.get("/api/history", response_model=Union[History, Failed])
def history(gatherer: str, channel: str, from_: Whole = Query(alias="from"), to: Optional[Whole] = None) -> Response:
    """data.history(G, C, A, B): the actor's history from A (to B)."""
    return answer(data.history(gatherer, channel, from_, to))


@router.get("/api/transcript", response_model=Union[Transcript, Failed])
def transcript(gatherer: str, channel: str, after: Optional[Whole] = None, before: Optional[Whole] = None) -> Response:
    """data.transcript(G, C, A, B): the actor's transcript, after A or before B."""
    return answer(data.transcript(gatherer, channel, after, before))
