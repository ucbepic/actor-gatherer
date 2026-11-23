"""ag's settings, its config.toml (settings.py): read, and the Gatherer's model, a new gatherer's defaults, or the file
itself set."""

from fastapi import APIRouter
from starlette.responses import Response

from .. import settings
from ..models import Settings
from .common import Body, Errors, answer

router = APIRouter(route_class=Errors)


@router.get("/api/settings", response_model=Settings)
def read() -> Response:
    """ag's settings, its config.toml (settings.py)."""
    return answer(settings.read())


@router.post("/api/settings/model", response_model=Settings)
def model(body: Body) -> Response:
    """{model, api_base?, key_env?}: the Gatherer's model, by `ag model` -> the settings."""
    opt = lambda k: None if body.get(k) is None else str(body[k])    # noqa: E731
    return answer(settings.set_model(str(body.get("model") or ""), opt("api_base"), opt("key_env")))


@router.post("/api/settings/defaults", response_model=Settings)
def defaults(body: Body) -> Response:
    """{version, policy?, pollers?, gatherer?}: a new gatherer's defaults -> the settings."""
    pollers = body.get("pollers")
    return answer(settings.set_defaults(
        str(body.get("version") or ""), None if body.get("policy") is None else str(body["policy"]),
        None if pollers is None else [str(p) for p in pollers] if isinstance(pollers, list) else [],
        None if body.get("gatherer") is None else str(body["gatherer"])))


@router.post("/api/settings/file", response_model=Settings)
def config_file(body: Body) -> Response:
    """{version, text}: config.toml as the reader edited it -> the settings."""
    return answer(settings.save_text(str(body.get("text") or ""), str(body.get("version") or "")))
