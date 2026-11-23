"""The page's one stream of the home and the actors it shows (live.py wakes it)."""

import json
import sqlite3
import sys
import threading
import time
from typing import Optional

from fastapi import APIRouter
from sse_starlette import EventSourceResponse
from starlette.responses import Response

from .. import chat_view, data, server
from ..models import Stream
from .common import KEEPALIVE_EVENT, Errors, Events, Parts, blocking, event

router = APIRouter(route_class=Errors)


def pairs(raw: Optional[str]) -> list:
    """A stream's `also`: [[gatherer, channel], ...] as JSON, each a pair of strings; what is not one is left out."""
    try:
        got = json.loads(raw) if raw else []
    except ValueError:
        return []
    if not isinstance(got, list):
        return []
    return [tuple(p) for p in got if isinstance(p, list) and len(p) == 2 and all(isinstance(x, str) for x in p)
            and p[0]][:server.MAX_ALSO]


LEFT = object()                 # a value not read now: the page keeps what it was sent last


def signature(value) -> str:
    """What a stream compares to send only a change: the value, less the time it was read at."""
    if isinstance(value, dict):
        value = {k: v for k, v in value.items() if k != "now"}
    return json.dumps(value, sort_keys=True, default=str)


@router.get("/api/stream", response_model=Stream, response_class=EventSourceResponse,  # the schema's: each event's
            responses={200: {"content": {"text/event-stream": {"schema": {"$ref": "#/components/schemas/Stream"}}}}})   # data
def stream(srv: Parts, gatherer: Optional[str] = None, channel: Optional[str] = None,
           also: Optional[str] = None) -> Response:
    """Server-sent events, until the page goes: `home` (data.home()) and, with `gatherer` and `channel`, `agent`
    (data.agent(G, C)) and `chat` (what Chat shows of it: chat_view.py's `view`, made from one read) at once -- `chat`
    first, each sent as soon as it is read -- then again each time they change; `chat` also as time alone changes it
    (a send not seen for long), checked every KEEPALIVE.

    Woken by ag's notifications or the fallback check (live.py) -- what the harness's own record of a session says (the
    user writing to it as it works, a question answered in its terminal, Esc) among them, as ag's hook records it --
    and every KEEPALIVE seconds a comment, or `home` if the time alone changed it (Running/Idle). `also` (JSON
    [[G2, C2], ...]): the page's other actors, its other panes, each sent the same way as `actor` {gatherer, channel,
    agent, chat}: one stream for all a page shows, as a browser keeps few open."""
    others = pairs(also)
    watch = srv.hub.watch(gatherer, channel, others)
    sent, gone = {}, threading.Event()

    def agent_of(g: str, c: str) -> dict:
        try:
            return data.agent(g, c, srv.calls.get())
        except Exception as exc:  # noqa: BLE001 - the page shows it; the stream stays up
            return {"error": f"{type(exc).__name__}: {exc}"}

    def chat_of(g: str, c: str) -> dict:
        try:
            return chat_view.of(g, c, srv.sessions.chat_row(c))
        except Exception as exc:  # noqa: BLE001 - the page shows it; the stream stays up
            return {"error": f"{type(exc).__name__}: {exc}"}

    def home_of(woken: bool):
        """The home, or LEFT while the dashboard's database stays locked past store.TIMEOUT: the page keeps the one it
        has, and the stream reads it again at its next wake, or KEEPALIVE seconds on."""
        try:
            return srv.home_view(woken)
        except sqlite3.OperationalError as exc:
            print(f"dashboard: the home not read now ({exc}); kept as the page has it", file=sys.stderr, flush=True)
            return LEFT

    def next_events() -> tuple:
        """What to send next, once woken (or KEEPALIVE passed): (woken, [(event, what it is kept as, how it is read)]) --
        the actor's Chat first, then its agent, the other actors and the home last: each sent as soon as it is read, so
        the Chat of an actor just picked, or of a pane just opened beside it, waits for no read of the whole home (every
        actor of every group: the longest read here)."""
        woken = watch.wake.wait(server.KEEPALIVE)
        if gone.is_set():                        # the page went: nothing more to read for it
            return woken, []
        if woken and sent:                       # the stream's first: nothing to wait for
            time.sleep(server.COALESCE)
        home, agent, changed = watch.take()
        out = []
        if (agent or not woken) and gatherer and channel is not None:
            out.append(("chat", "chat", lambda: chat_of(gatherer, channel)))
        if agent and gatherer and channel is not None:
            out.append(("agent", "agent", lambda: agent_of(gatherer, channel)))
        for i in sorted(changed):
            g, c = others[i]
            out.append(("actor", ("actor", g, c), lambda g=g, c=c: {"gatherer": g, "channel": c,
                                                                     "agent": agent_of(g, c), "chat": chat_of(g, c)}))
        if home or not woken:                    # unwoken: the time alone may have changed it
            out.append(("home", "home", lambda: home_of(woken)))
        return woken, out

    def changed(name: str, kept, value) -> Optional[bytes]:
        """The event to send for a value read: None if it is what was sent last, or was not read now (LEFT)."""
        if value is LEFT:
            return None
        sig = signature(value)
        if sent.get(kept) == sig:
            return None
        sent[kept] = sig
        return event(name, value)

    async def events():
        while True:
            woken, out = await blocking(next_events)
            told = False
            for name, kept, read in out:
                if gone.is_set():
                    break
                chunk = changed(name, kept, await blocking(read))
                if chunk is not None:
                    told = True
                    yield chunk
            if not told and not woken and not gone.is_set():
                yield KEEPALIVE_EVENT

    def close() -> None:
        """The stream let go: the hub rings it no more, and its wait (in a thread) ends now."""
        gone.set()
        srv.hub.drop(watch)
        watch.wake.set()
    return Events(events(), close=close)
