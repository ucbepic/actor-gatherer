"""app_kit: what an app is, apart from the dashboard -- the contract an app plugs into a host by (DESIGN.md). An app
is a manifest (its app.toml), a backend (an App subclass, in the host's process or its own) and a panel (a web page the
host shows in an iframe). It reaches the rest only through the tools agents call and the events it puts into the
gatherer -- ag's events: its types are ag EventTypes, its pollers ag Pollers, its inserts ag's insert shape, and ag's
policies take them unchanged. It imports the standard library and ag's contract, ag.ag_interface, and nothing else of
ag or of the dashboard (tests/test_app_kit.py).

    manifest.py   Manifest: load(folder), parse(data); its Tools, event types (ag's), PollerDefs, Handles,
                  Capabilities;
                  tool_name / split_tool_name (<app>_<tool>)
    backend.py    App (what a backend subclasses), Host (what the host gives it), Instance, Caller, ToolResult,
                  Response, AppError
    events.py     what an app inserts for agents to see, in ag's own shapes: context_stream, environment_update
    finding.py    where apps are: find(home), search_path(home)
    remote.py     the same calls over HTTP, for an app in a process of its own: launch / RemoteApp (the host's side),
                  serve / main / RemoteHost (the app's)
"""

from . import events, finding  # noqa: F401
from .backend import App, AppError, Caller, Host, Instance, Response, ToolResult  # noqa: F401 - the package's API
from .manifest import (CAPABILITIES, CONTEXT_TYPES, HOST_PROPERTIES, HOST_RECORDS, HOST_TYPES, INSTANCES,  # noqa: F401
                       INTENTS, Backend, Capabilities, Handles, Manifest, ManifestError, PollerDef, Tool, load, parse,
                       split_tool_name, tool_name)
from .events import context_stream, environment_update  # noqa: F401
