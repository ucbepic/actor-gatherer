"""The dashboard's APPS still in the dashboard itself: the Browser (browser.py) -- DocWriter is an app of app_kit's now
(ag_apps/docwriter/), and the Browser will be (app_kit/DESIGN.md step 8). Each is a view of its own in the
dashboard whose agent is an ACTOR of the gatherer: a session whose `role` is {"<name>": key} (sessions.py), made
from the app's button (its router's /api/<name>) or by the gatherer agent (coordination.py's `new`, as `ag actors new
--<name>` asks).

Only this module, the apps' own modules and their routers (api/<name>.py) name an app (DESIGN.md's rule 3, which
tests/test_dashboard_apps.py checks). The rest of the dashboard loops over APPS, or finds one by its name (`named`),
its page's path (`under`) or its actor's session (`of`), and asks it through `App`:

    name, label        its role's key, its routes' first part (/<name>/w/<key>/..., /api/<name>) and its flag in
                       `ag actors new` (--<name>); its name as the user reads it
    start(started)     its running part, one per dashboard (server.py's `apps`, by name): `create(gatherer, cwd,
                       harness, model)`, a new one and its actor -> its settings {key, root, channel, ...};
                       `name_actor(key, name)`, its actor named once its first message is sent; `close()`
    served_at(origin)  where its actors reach the dashboard (their MCP server)
    available, home    whether a new one can be made here; what the home says of it (`home_fields`, models.py)
    key_of             the key of the one whose actor a session is (its `role`), else None
    launch_args        what that actor's harness is started with besides its own options: its tools and
                       instructions (sessions.py's `extra_args`)
    tools_at           the endpoint its actor reaches its tools by (mcp.py's `endpoint`, at /<name>/w/<key>/mcp),
                       which a session's first message waits to have listed them (`tools_of`)
    compose            a message to its actor as the actor is to get it (/api/send), and what to tell it once sent
    error              what it raises: a ValueError, with the HTTP `status` it is answered with
    path, max_body, page_writes   where its page is served, the largest body its writes there take, and their
                       methods (app.py's `OwnPage`)
    router()           its routes (api/<name>.py): imported only once one serves, as FastAPI is

What its actor was asked, without the app's own state block (<workspace_state>, <browser_state>), the page works out
(frontend/: the apps' own code there); the server never needs it."""

import importlib
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import browser, mcp


class App:
    """What the dashboard's shared code asks of an app (module doc). An app gives each; `home` and `compose` have
    defaults: the home says whether it is `available`; a message goes to its actor as it is written."""

    name = ""
    label = ""
    error = ValueError
    max_body: Optional[int] = None                  # None: the server's MAX_BODY
    page_writes: Tuple[str, ...] = ("POST",)        # POST's body JSON, any other's as it is
    home_fields: Dict[str, type] = {}               # the home's fields of it (`home`), for its model (models.py)

    def start(self, started) -> Any:
        raise NotImplementedError

    def served_at(self, origin: str) -> None:
        raise NotImplementedError

    def available(self, running) -> bool:
        raise NotImplementedError

    def home(self, running) -> dict:
        return {self.name: self.available(running)}

    def key_of(self, session: dict) -> Optional[str]:
        raise NotImplementedError

    def launch_args(self, session: dict) -> List[str]:
        raise NotImplementedError

    def tools_at(self, key: str) -> str:
        """The endpoint the actor of the one of that key reaches its tools by: its MCP server (/<name>/w/<key>/mcp)."""
        return mcp.endpoint(self.name, key)

    def compose(self, running, session: dict, text: str) -> Tuple[str, Optional[Callable[[], None]]]:
        return text, None

    def path(self) -> str:
        """Where its page, and its actor's tools, are served: /<name>/w/<key>/..."""
        return f"/{self.name}/w/"

    def router(self):
        return importlib.import_module(f"{__package__}.api.{self.name}").router


class Browser(App):
    """browser.py: a Chrome tab the user and its actor use together; a message to the actor says what the user did
    and picked in it."""

    name, label, error = "browser", "Browser", browser.BrowserError
    home_fields = {"browser": bool, "browser_profile": str}   # browser_profile: whose Chrome (`mode`)

    def start(self, started) -> "browser.Browsers":
        return browser.Browsers(started)

    def served_at(self, origin: str) -> None:
        browser.ORIGIN = origin

    def available(self, running) -> bool:
        return running is not None and browser.available()

    def home(self, running) -> dict:
        return {"browser": self.available(running), "browser_profile": browser.mode() if running is not None else None}

    def key_of(self, session: dict) -> Optional[str]:
        return browser.key_of(session)

    def launch_args(self, session: dict) -> List[str]:
        return browser.launch_args(session)

    def compose(self, running, session: dict, text: str) -> Tuple[str, Optional[Callable[[], None]]]:
        text, b = running.compose(session, text)
        return text, (b.sent if b is not None else None)


APPS: List[App] = [Browser()]


def named(name: str) -> Optional[App]:
    """The app of that name, else None."""
    return next((a for a in APPS if a.name == name), None)


def under(path: str) -> Optional[App]:
    """The app whose page (/<name>/w/...) the path is of, else None."""
    return next((a for a in APPS if path.startswith(a.path())), None)


def of(session: dict) -> Optional[App]:
    """The app whose actor the session is (its `role`), else None."""
    return next((a for a in APPS if a.key_of(session) is not None), None)


def tools_of(session: dict) -> List[str]:
    """The dashboard's MCP endpoints a session reaches its tools by (mcp.py's `endpoint`): its app's, where its
    harness is given them (`launch_args`); [] for any other session. A message the session's terminal starts with
    waits for each to have listed its tools (sessions.py's `_first_message`): neither Claude Code nor codex waits for
    an MCP server before the turn its first message starts, and that turn then runs without the server's tools."""
    a = of(session)
    if a is None:                               # any other actor: the apps' MCP server, where it was given one
        from . import tool_gateway
        return [tool_gateway.endpoint(tool_gateway.actor_of(session))] if tool_gateway.served(session) else []
    return [a.tools_at(a.key_of(session))] if a.launch_args(session) else []


def home_fields() -> Dict[str, type]:
    """Every app's fields of the home, in APPS' order."""
    return {k: t for a in APPS for k, t in a.home_fields.items()}
