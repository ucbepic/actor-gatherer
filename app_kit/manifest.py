"""An app's manifest: its `app.toml`, read and checked (DESIGN.md, "An app is a manifest, a backend and a panel").

    load(folder)            the manifest of the app in `folder` (its app.toml), its files checked to be there
    parse(data, folder)     the same from the TOML's data, already read
    Manifest                what the manifest says: name, label, version, instances, backend, panel, tools, events,
                            the intents it handles, its capabilities, what agents are told of it
    tool_name(app, tool)    a tool's name as agents see it: <app>_<tool>
    split_tool_name(name)   the reverse, given the apps there are

An app's events are ag's: its event types are ag EventTypes with ag Propertys (`Manifest.event_types`), its pollers ag
Pollers that ag's catalog builds (PollerDef), and what it inserts is ag's insert shape. Nothing here is a second kind of
event: an app is one more user of ag's contract (ag.ag_interface), as a policy, a poller or an adaptor is.

A manifest that says something the host doesn't know is refused, not read past: a capability the host can't show the
user before it is granted, or a key in the wrong place, is a ManifestError naming where it is. Standard library and
ag.ag_interface only."""

import os
import re
import tomllib
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Tuple

from ag.ag_interface import EventType, Property
from ag.ag_interface.event import PROPERTY_NAME

FILE = "app.toml"

#: An app's name: what its tools and event types start with, its panel's origin (<name>.localhost) and its folder.
NAME = re.compile(r"^[a-z][a-z0-9_]{0,23}$")
#: A tool's own name, and the part of an event type's name after "<app>.".
PART = re.compile(r"^[a-z][a-z0-9_]*$")
#: The longest a tool's name may be as agents see it (<app>_<tool>): the Messages API's and MCP clients' limit.
TOOL_NAME_MAX = 64
#: The argument the host adds to every tool: which instance, for an agent attached to more than one of the app's.
INSTANCE_ARG = "instance"

#: How many instances of an app there are: one per gatherer, one per folder, one per git checkout, or any number.
INSTANCES = ("one", "per-folder", "per-checkout", "many")
#: Who answers a tool's calls: the app's backend, or its open panel (the call waits for one to be open).
HANDLED_BY = ("backend", "panel")
#: The properties the host puts on every app event itself, which an app's event type does not declare: the app's name,
#: the instance's id, and the agent's channel -- identifying, as on every type of ag's that carries it.
HOST_PROPERTIES = (Property("app", required=True), Property("instance"), Property("channel", identifies=True))
HOST_PROPERTY_NAMES = tuple(p.name for p in HOST_PROPERTIES)
#: The event types any app may insert besides its own: those ag's policy already shows agents (its poller doc's
#: advice), so no policy changes for an app. An app's pollers output these only, as ag requires of any poller.
CONTEXT_TYPES = ("context_stream", "environment_update")
#: The records the host keeps of each app: an instance opened or closed, an agent attached or detached, a tool call it
#: passed to the app. Records like the harness's: no policy groups them. An app reads its own; no app inserts them.
HOST_TYPES = (EventType("app_opened", HOST_PROPERTIES), EventType("app_closed", HOST_PROPERTIES),
              EventType("app_attached", HOST_PROPERTIES), EventType("app_detached", HOST_PROPERTIES),
              EventType("app_call", HOST_PROPERTIES))
HOST_RECORDS = tuple(t.name for t in HOST_TYPES)
#: The intents the host routes, and what each one carries.
INTENTS = {
    "open-file": "path, line?, row_id?: a file to show",
    "open-url": "url: a web page to show",
    "show-activity": "channel, turn: what an agent did in a turn",
    "explain-answer": "channel, turn: where an agent's answer came from",
    "use-history": "channel, rows: events of an agent's history picked by the user",
}
#: What an app may ask of the host beyond its own events, tools and panel; each shown to the user before it is granted.
CAPABILITIES = {
    "native_view": "a native web view over its panel, in the desktop app",
    "reads": "these event types of the gatherer besides its own: its agents' (tool_call, tool_output, ...)",
    "files": "reading files in its agents' folders",
    "commands": "running commands",
}


class ManifestError(ValueError):
    """A manifest that can't be used: what is wrong, and where (the file, then the key)."""


@dataclass(frozen=True)
class Tool:
    """A tool agents call, as MCP describes one: its own `name` (agents see `<app>_<name>`), what it does, and the
    JSON Schema of its arguments. `handled_by` the backend, or the open panel."""
    name: str
    description: str
    input_schema: Dict[str, Any]
    handled_by: str = "backend"

    def mcp(self, app: str, label: str = "") -> dict:
        """The tool as an MCP server lists it (`tools/list`): its schema with the host's `instance` argument added,
        its description saying whose it is (`label`)."""
        schema = dict(self.input_schema)
        schema["properties"] = {**(schema.get("properties") or {}), INSTANCE_ARG: {
            "type": "string", "description": "Which one, if you are attached to more than one (its id); else leave out."}}
        return {"name": tool_name(app, self.name), "inputSchema": schema,
                "description": f"{label}: {self.description}" if label else self.description}


@dataclass(frozen=True)
class Handles:
    """An intent the app takes (INTENTS), and for `open-file` the media types it shows (`image/*`; none: any)."""
    intent: str
    types: Tuple[str, ...] = ()

    def takes(self, intent: str, media_type: Optional[str] = None) -> bool:
        if intent != self.intent:
            return False
        if not self.types or media_type is None:
            return not self.types
        return any(t == media_type or (t.endswith("/*") and media_type.startswith(t[:-1])) for t in self.types)


@dataclass(frozen=True)
class PollerDef:
    """One of the app's ag pollers (ag.ag_interface.Poller), built by ag in its own process before each model call of
    a gatherer the app is on, as its catalog builds one ([pollers.available]): a class in a file of the app's folder
    (`file` + `cls`), or an importable "module:Class" (`cls` alone), with `args` ({cwd}, {gatherer}, {home} filled
    in). ag knows it as `<app>.<name>`. It is an ag Poller like any other: ag checks its `outputs` are among the
    gatherer's policy's types, so it outputs the context types (CONTEXT_TYPES); the app's own records it inserts."""
    name: str
    cls: str
    file: Optional[str] = None
    args: Dict[str, Any] = field(default_factory=dict)

    def catalog(self, folder: Optional[str]) -> dict:
        """Its entry as ag's catalog takes one: `file` made absolute in the app's folder."""
        entry: Dict[str, Any] = {"class": self.cls, "args": dict(self.args)}
        if self.file:
            entry["file"] = os.path.join(folder, self.file) if folder else self.file
        return entry


@dataclass(frozen=True)
class Backend:
    """Where the app's backend runs: `python`, a "module:Class" in the host's process; or `command`, a process of its
    own speaking app_kit's HTTP protocol (remote.py). Neither: an app whose tools its panel answers."""
    python: Optional[str] = None
    command: Tuple[str, ...] = ()


@dataclass(frozen=True)
class Capabilities:
    native_view: bool = False
    reads: Tuple[str, ...] = ()
    files: bool = False
    commands: bool = False

    def asked(self) -> List[str]:
        """What it asks for, as the user is shown it before granting it."""
        said = []
        if self.native_view:
            said.append(CAPABILITIES["native_view"])
        if self.reads:
            said.append(f"reading these events of the gatherer: {', '.join(self.reads)}")
        if self.files:
            said.append(CAPABILITIES["files"])
        if self.commands:
            said.append(CAPABILITIES["commands"])
        return said


@dataclass(frozen=True)
class Manifest:
    """What an app's app.toml says. `folder` is where it was read from (None: parsed from data alone)."""
    name: str
    label: str
    version: str
    description: str = ""
    instances: str = "one"
    instructions: str = ""
    backend: Backend = field(default_factory=Backend)
    panel: Optional[str] = None
    tools: Tuple[Tool, ...] = ()
    events: Tuple[EventType, ...] = ()        # as declared, its own properties only (`event_types`: with the host's)
    pollers: Tuple[PollerDef, ...] = ()
    handles: Tuple[Handles, ...] = ()
    capabilities: Capabilities = field(default_factory=Capabilities)
    folder: Optional[str] = None

    def tool(self, name: str) -> Optional[Tool]:
        """Its tool of that name (its own name, not `<app>_<name>`), else None."""
        return next((t for t in self.tools if t.name == name), None)

    def event(self, name: str) -> Optional[EventType]:
        return next((e for e in self.events if e.name == name), None)

    def event_types(self) -> Tuple[EventType, ...]:
        """Its own event types as ag registers them: each with the host's properties (HOST_PROPERTIES) before its own.
        Records: no policy groups them, so they never reach a context."""
        return tuple(EventType(e.name, HOST_PROPERTIES + e.properties) for e in self.events)

    def may_insert(self, type_name: str) -> bool:
        """Whether the app may insert an event of that type: one of its own, or one the policy shows agents."""
        return type_name in CONTEXT_TYPES or self.event(type_name) is not None

    def may_read(self, type_name: str) -> bool:
        """Whether the app may read events of that type: its own, the context types, the host's records of it, and
        those its capabilities name."""
        return (type_name.startswith(self.name + ".") or type_name in CONTEXT_TYPES or type_name in HOST_RECORDS
                or type_name in self.capabilities.reads)

    def panel_path(self) -> Optional[str]:
        """Its panel's entry page on disk, if it has a panel and was read from a folder."""
        return os.path.join(self.folder, self.panel) if self.panel and self.folder else None

    def to_dict(self) -> dict:
        """The manifest as JSON (the host's /api/apps, the remote protocol)."""
        return {
            "name": self.name, "label": self.label, "version": self.version, "description": self.description,
            "instances": self.instances, "instructions": self.instructions,
            "backend": {"python": self.backend.python, "command": list(self.backend.command)},
            "panel": self.panel,
            "tools": [{"name": t.name, "description": t.description, "input_schema": t.input_schema,
                       "handled_by": t.handled_by} for t in self.tools],
            "events": [{"name": e.name, "properties": [{"name": p.name, "required": p.required,
                                                          "identifies": p.identifies} for p in e.properties]}
                       for e in self.events],
            "pollers": [{"name": p.name, "class": p.cls, "file": p.file, "args": p.args} for p in self.pollers],
            "handles": [{"intent": h.intent, "types": list(h.types)} for h in self.handles],
            "capabilities": {"native_view": self.capabilities.native_view, "reads": list(self.capabilities.reads),
                             "files": self.capabilities.files, "commands": self.capabilities.commands},
        }


def tool_name(app: str, tool: str) -> str:
    """A tool's name as agents see it."""
    return f"{app}_{tool}"


def split_tool_name(name: str, apps: Iterable[str]) -> Optional[Tuple[str, str]]:
    """(app, tool) of a tool's name as agents see it, the app one of `apps`; None if none matches. The longest app
    name that matches wins, so `a_b` and `a` can both be apps."""
    for app in sorted(apps, key=len, reverse=True):
        if name.startswith(app + "_") and len(name) > len(app) + 1:
            return app, name[len(app) + 1:]
    return None


# ---------------------------------------------------------------- reading


def load(folder: str) -> Manifest:
    """The manifest of the app in `folder`: its app.toml read and checked, with the files it names (its panel's entry,
    its instructions file) found there."""
    path = os.path.join(folder, FILE)
    try:
        with open(path, "rb") as fh:
            data = tomllib.load(fh)
    except FileNotFoundError:
        raise ManifestError(f"{path}: no such file") from None
    except tomllib.TOMLDecodeError as exc:
        raise ManifestError(f"{path}: {exc}") from None
    return parse(data, os.path.abspath(folder), where=path)


def parse(data: Dict[str, Any], folder: Optional[str] = None, where: str = FILE) -> Manifest:
    """The manifest the TOML's `data` says. With `folder`, the files it names are read from there and must exist."""
    r = _Reader(where)
    _known(r, data, "", ("name", "label", "version", "description", "instances", "instructions",
                         "instructions_file", "backend", "panel", "tools", "events", "pollers", "handles",
                         "capabilities"))
    name = r.string(data, "name")
    if not NAME.match(name):
        r.fail("name", f"{name!r}: lowercase letters, digits and _, starting with a letter, at most 24")
    instances = r.string(data, "instances", "one")
    if instances not in INSTANCES:
        r.fail("instances", f"{instances!r}: one of {', '.join(INSTANCES)}")

    instructions = r.string(data, "instructions", "")
    ifile = r.string(data, "instructions_file", "")
    if instructions and ifile:
        r.fail("instructions_file", "give the instructions inline or in a file, not both")
    if ifile and folder is not None:
        instructions = _read_text(r, folder, ifile, "instructions_file")

    backend = _backend(r, data.get("backend", {}))
    panel = _panel(r, data.get("panel"), folder)
    tools = tuple(_tool(r, name, i, t) for i, t in enumerate(r.tables(data, "tools")))
    seen = set()
    for i, t in enumerate(tools):
        if t.name in seen:
            r.fail(f"tools[{i}].name", f"{t.name!r} twice")
        seen.add(t.name)
        if t.handled_by == "backend" and not (backend.python or backend.command):
            r.fail(f"tools[{i}].handled_by", "\"backend\", but the app has no [backend]")
        if t.handled_by == "panel" and panel is None:
            r.fail(f"tools[{i}].handled_by", "\"panel\", but the app has no [panel]")
    events = tuple(_event(r, name, i, e) for i, e in enumerate(r.tables(data, "events")))
    if len({e.name for e in events}) != len(events):
        r.fail("events", "an event type named twice")
    pollers = tuple(_poller(r, i, p, folder) for i, p in enumerate(r.tables(data, "pollers")))
    if len({p.name for p in pollers}) != len(pollers):
        r.fail("pollers", "a poller named twice")
    handles = tuple(_handles(r, i, h) for i, h in enumerate(r.tables(data, "handles")))
    if handles and panel is None:
        r.fail("handles", "an app handles intents in its panel, and it has no [panel]")
    return Manifest(name=name, label=r.string(data, "label", name), version=r.string(data, "version", "0"),
                    description=r.string(data, "description", ""), instances=instances, instructions=instructions,
                    backend=backend, panel=panel, tools=tools, events=events, pollers=pollers, handles=handles,
                    capabilities=_capabilities(r, data.get("capabilities", {})), folder=folder)


class _Reader:
    def __init__(self, where: str):
        self.where = where

    def fail(self, key: str, why: str):
        raise ManifestError(f"{self.where}: {key}: {why}")

    def string(self, d: dict, key: str, default: Optional[str] = None, at: str = "") -> str:
        v = d.get(key, default)
        if v is None:
            self.fail(at + key, "required")
        if not isinstance(v, str):
            self.fail(at + key, f"a string, not {type(v).__name__}")
        return v

    def flag(self, d: dict, key: str, at: str = "") -> bool:
        v = d.get(key, False)
        if not isinstance(v, bool):
            self.fail(at + key, f"true or false, not {v!r}")
        return v

    def strings(self, d: dict, key: str, at: str = "") -> Tuple[str, ...]:
        v = d.get(key, [])
        if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
            self.fail(at + key, "a list of strings")
        return tuple(v)

    def tables(self, d: dict, key: str) -> List[dict]:
        v = d.get(key, [])
        if not isinstance(v, list) or not all(isinstance(x, dict) for x in v):
            self.fail(key, f"a list of tables ([[{key}]])")
        return v


def _known(r: _Reader, d: Any, at: str, keys: Tuple[str, ...]) -> None:
    if not isinstance(d, dict):
        r.fail(at.rstrip(".") or "the file", "a table")
    for k in d:
        if k not in keys:
            r.fail(at + k, f"not a key here (these are: {', '.join(keys)})")


def _read_text(r: _Reader, folder: str, rel: str, key: str) -> str:
    path = _inside(r, folder, rel, key)
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except OSError as exc:
        r.fail(key, f"{rel}: {exc.strerror or exc}")


def _inside(r: _Reader, folder: str, rel: str, key: str) -> str:
    """`rel` as a path in the app's folder; a path that leaves it is refused."""
    if os.path.isabs(rel):
        r.fail(key, f"{rel!r}: a path in the app's folder, not an absolute one")
    path = os.path.realpath(os.path.join(folder, rel))
    if os.path.commonpath([path, os.path.realpath(folder)]) != os.path.realpath(folder):
        r.fail(key, f"{rel!r} is outside the app's folder")
    return path


def _backend(r: _Reader, d: Any) -> Backend:
    _known(r, d, "backend.", ("python", "command"))
    python = d.get("python")
    if python is not None:
        python = r.string(d, "python", at="backend.")
        if not re.match(r"^[A-Za-z_][\w.]*:[A-Za-z_]\w*$", python):
            r.fail("backend.python", f"{python!r}: \"module:Class\"")
    command = r.strings(d, "command", at="backend.")
    if python and command:
        r.fail("backend", "python or command, not both")
    return Backend(python=python, command=command)


def _panel(r: _Reader, d: Any, folder: Optional[str]) -> Optional[str]:
    if d is None:
        return None
    _known(r, d, "panel.", ("entry",))
    entry = r.string(d, "entry", at="panel.")
    if folder is not None:
        path = _inside(r, folder, entry, "panel.entry")
        if not os.path.isfile(path):
            r.fail("panel.entry", f"{entry}: no such file in the app's folder")
    return entry


def _tool(r: _Reader, app: str, i: int, d: dict) -> Tool:
    at = f"tools[{i}]."
    _known(r, d, at, ("name", "description", "input_schema", "handled_by"))
    name = r.string(d, "name", at=at)
    if not PART.match(name):
        r.fail(at + "name", f"{name!r}: lowercase letters, digits and _, starting with a letter")
    if len(tool_name(app, name)) > TOOL_NAME_MAX:
        r.fail(at + "name", f"{tool_name(app, name)!r} is longer than {TOOL_NAME_MAX}")
    schema = d.get("input_schema", {"type": "object", "properties": {}})
    if not isinstance(schema, dict) or schema.get("type") != "object":
        r.fail(at + "input_schema", "a JSON Schema whose type is \"object\"")
    if INSTANCE_ARG in (schema.get("properties") or {}):
        r.fail(at + "input_schema", f"{INSTANCE_ARG!r} is the host's argument: which instance, for an agent attached "
                                    "to more than one")
    handled_by = r.string(d, "handled_by", "backend", at=at)
    if handled_by not in HANDLED_BY:
        r.fail(at + "handled_by", f"{handled_by!r}: one of {', '.join(HANDLED_BY)}")
    return Tool(name=name, description=r.string(d, "description", at=at), input_schema=schema, handled_by=handled_by)


def _event(r: _Reader, app: str, i: int, d: dict) -> EventType:
    """An [[events]] table as ag's EventType: each property a name (optional, describing) or a table {name, required,
    identifies}, as ag's Property says them. `description` is for the reader of the manifest."""
    at = f"events[{i}]."
    _known(r, d, at, ("name", "properties", "description"))
    name = r.string(d, "name", at=at)
    prefix = app + "."
    if not name.startswith(prefix) or not PART.match(name[len(prefix):]):
        r.fail(at + "name", f"{name!r}: \"{prefix}<what>\", <what> lowercase letters, digits and _")
    r.string(d, "description", "", at=at)
    raw = d.get("properties", [])
    if not isinstance(raw, list):
        r.fail(at + "properties", "a list of names or {name, required, identifies} tables")
    props = []
    for j, p in enumerate(raw):
        where = f"{at}properties[{j}]."
        if isinstance(p, str):
            p = {"name": p}
        if not isinstance(p, dict):
            r.fail(at + "properties", "a list of names or {name, required, identifies} tables")
        _known(r, p, where, ("name", "required", "identifies"))
        pname = r.string(p, "name", at=where)
        if not PROPERTY_NAME.match(pname):
            r.fail(where + "name", f"{pname!r}: letters, digits and _, not starting with a digit")
        if pname in HOST_PROPERTY_NAMES:
            r.fail(where + "name", f"{pname!r} is the host's: every app event carries it")
        props.append(Property(pname, required=r.flag(p, "required", where), identifies=r.flag(p, "identifies", where)))
    if len({p.name for p in props}) != len(props):
        r.fail(at + "properties", "a property named twice")
    return EventType(name, tuple(props))


def _poller(r: _Reader, i: int, d: dict, folder: Optional[str]) -> PollerDef:
    at = f"pollers[{i}]."
    _known(r, d, at, ("name", "file", "class", "args"))
    name = r.string(d, "name", at=at)
    if not PART.match(name):
        r.fail(at + "name", f"{name!r}: lowercase letters, digits and _, starting with a letter")
    cls = r.string(d, "class", at=at)
    file = d.get("file")
    if file is not None:
        file = r.string(d, "file", at=at)
        if not re.match(r"^[A-Za-z_]\w*$", cls):
            r.fail(at + "class", f"{cls!r}: the class's name in {file}")
        if folder is not None and not os.path.isfile(_inside(r, folder, file, at + "file")):
            r.fail(at + "file", f"{file}: no such file in the app's folder")
    elif not re.match(r"^[A-Za-z_][\w.]*:[A-Za-z_]\w*$", cls):
        r.fail(at + "class", f"{cls!r}: \"module:Class\", or a class's name with `file`")
    args = d.get("args", {})
    if not isinstance(args, dict):
        r.fail(at + "args", "a table")
    return PollerDef(name=name, cls=cls, file=file, args=dict(args))


def _handles(r: _Reader, i: int, d: dict) -> Handles:
    at = f"handles[{i}]."
    _known(r, d, at, ("intent", "types"))
    intent = r.string(d, "intent", at=at)
    if intent not in INTENTS:
        r.fail(at + "intent", f"{intent!r}: one of {', '.join(INTENTS)}")
    types = r.strings(d, "types", at=at)
    if types and intent != "open-file":
        r.fail(at + "types", "media types are for open-file only")
    for t in types:
        if not re.match(r"^[a-z]+/([a-z0-9.+-]+|\*)$", t):
            r.fail(at + "types", f"{t!r}: a media type such as \"application/pdf\" or \"image/*\"")
    return Handles(intent=intent, types=types)


def _capabilities(r: _Reader, d: Any) -> Capabilities:
    _known(r, d, "capabilities.", tuple(CAPABILITIES))
    reads = r.strings(d, "reads", at="capabilities.")
    return Capabilities(native_view=r.flag(d, "native_view", "capabilities."), reads=reads,
                        files=r.flag(d, "files", "capabilities."), commands=r.flag(d, "commands", "capabilities."))
