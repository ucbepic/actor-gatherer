"""The monitor: what each actor the page names is doing, its latest turn."""

import json
from typing import Optional

from fastapi import APIRouter
from starlette.responses import Response

from .. import monitor
from ..models import Monitor
from .common import Errors, answer

router = APIRouter(route_class=Errors)


def listed(raw: Optional[str]) -> list:
    """The monitor's `actors`: [[gatherer, channel, cwd], ...] as JSON (cwd may be left out, or null); what is not
    one is left out."""
    try:
        got = json.loads(raw) if raw else []
    except ValueError:
        return []
    out = []
    for p in got if isinstance(got, list) else []:
        if isinstance(p, list) and len(p) in (2, 3) and all(isinstance(x, str) for x in p[:2]) and p[0] \
                and (len(p) == 2 or p[2] is None or isinstance(p[2], str)):
            out.append((p[0], p[1], (p[2] if len(p) == 3 else None) or ""))
    return out


@router.get("/api/monitor", response_model=Monitor)
def the_monitor(actors: Optional[str] = None) -> Response:
    """?actors=[[G, C, D], ...]: monitor.actors, what each is doing, its latest turn -> {actors}."""
    return answer({"actors": monitor.actors(listed(actors))})
