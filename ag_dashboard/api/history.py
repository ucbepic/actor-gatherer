"""The History panel: a gatherer's events (outline, one event, search), and what the Gatherer's model makes of them
(extracts: a summary, memory or skill), saved where a harness reads it."""

from typing import List, Optional, Union

from fastapi import APIRouter
from starlette.responses import Response

from .. import history
from ..models import Event, Extract, Failed, Outline, Search
from .common import Body, Errors, Whole, answer

router = APIRouter(route_class=Errors)


@router.get("/api/outline", response_model=Union[Outline, Failed])
def outline(gatherer: str, channel: Optional[str] = None, after: Whole = 0) -> Response:
    """history.outline(G, C, A): the events after row A (the channel's only, with one), light, and the tasks."""
    return answer(history.outline(gatherer, channel, after))


@router.get("/api/event", response_model=Union[Event, Failed])
def event(gatherer: str, row_id: Whole) -> Response:
    """history.event(G, R): one event, as the transcript shows it."""
    return answer(history.event(gatherer, row_id))


@router.get("/api/search", response_model=Union[Search, Failed])
def search(gatherer: str, channel: Optional[str] = None, q: str = "") -> Response:
    """history.search(G, C, Q): the events whose words hold Q (the channel's only, with one)."""
    return answer(history.search(gatherer, channel, q))


@router.get("/api/extracts", response_model=List[Extract])
def extracts(gatherer: str) -> Response:
    """history.extracts(G): what the model made of the history, newest first."""
    return answer(history.extracts(gatherer))


@router.post("/api/history/export")
def export(body: Body) -> Response:
    """{gatherer, rows, format}: those events as a file -> {name, text} (history.py)."""
    return answer(history.export(str(body.get("gatherer") or ""), body.get("rows"), str(body.get("format") or "md")))


@router.post("/api/history/extract", response_model=Extract)
def extract(body: Body) -> Response:
    """{gatherer, rows, kind, ask?}: the Gatherer's model asked for a summary, memory or skill of them, in the
    background -> its record."""
    return answer(history.start(str(body.get("gatherer") or ""), str(body.get("kind") or ""), body.get("rows"),
                                str(body.get("ask") or "")))


@router.post("/api/history/delete")
def delete(body: Body) -> Response:
    """{id}: a record removed, its job stopped -> {id}."""
    return answer(history.delete(str(body.get("id") or "")))


@router.post("/api/history/build")
def build(body: Body) -> Response:
    """{gatherer, channel}: ag asked to build the actor's history (history.build)."""
    return answer(history.build(str(body.get("gatherer") or ""), str(body.get("channel") or "")))


@router.post("/api/history/save")
def save(body: Body) -> Response:
    """{id, target, dir?, version?, harness?}: where the harness reads it -- the plan, without `version`; with the
    plan's, the files written -> {saved, where}."""
    return answer(history.save(str(body.get("id") or ""), str(body.get("target") or ""), str(body.get("dir") or ""),
                               str(body.get("version") or ""), str(body.get("harness") or "") or None))
