"""What an app's backend is, and what the host gives it (DESIGN.md, "An app is a manifest, a backend and a panel").

    App         what an app's backend subclasses: open and close instances, answer tool calls and its panel's own
                requests, hear of agents attached. Every method has a default (`call`'s refuses every tool)
    Host        what the host gives an app: insert and read events, the agents of an instance, a message to its
                panels, the app's own folder
    Instance    one opened copy of an app: the host makes its id; the app may set its title and data
    Caller      who made a tool call: an agent (its channel), or the user through the panel
    ToolResult  a tool call's answer, as MCP's `tools/call` gives one
    Response    the answer to a request the panel made of the backend (its own routes)
    AppError    a refusal: the tool call answers it as an error, a request with its status

An app in the host's process is one of these directly; an app in its own process is reached through remote.py, which
gives each side the other as these same classes. An app's pollers are not here: ag builds them in its own process from
the manifest's [[pollers]] (manifest.Poller). Standard library only."""

import base64
import json
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from .manifest import Manifest


class AppError(Exception):
    """A refusal from an app or the host: `str(error)` is what the caller is told; `status` the HTTP status a request
    is answered with."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Instance:
    """One opened copy of an app. `id` is the host's (16 hex digits), `gatherer` the one it was opened in, `folder`
    what it works on, where it has one (per-folder and per-checkout apps). `title` and `data` are the app's: what the
    page shows of it, and anything the app wants kept with it (JSON)."""
    id: str
    app: str
    gatherer: str
    folder: Optional[str] = None
    title: str = ""
    data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Instance":
        return cls(id=d["id"], app=d["app"], gatherer=d["gatherer"], folder=d.get("folder"),
                   title=d.get("title") or "", data=dict(d.get("data") or {}))


@dataclass(frozen=True)
class Caller:
    """Who made a tool call: an agent, by its channel (and its gatherer and harness), or the user through the app's
    panel (`channel` None)."""
    channel: Optional[str] = None
    gatherer: Optional[str] = None
    harness: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Optional[dict]) -> "Caller":
        d = d or {}
        return cls(channel=d.get("channel"), gatherer=d.get("gatherer"), harness=d.get("harness"))


@dataclass
class ToolResult:
    """A tool call's answer: MCP content items (`{"type": "text", "text": ...}`, `{"type": "image", ...}`), and whether
    it is an error the agent should read as one."""
    content: List[dict]
    is_error: bool = False

    @classmethod
    def text(cls, text: str) -> "ToolResult":
        return cls([{"type": "text", "text": text}])

    @classmethod
    def error(cls, text: str) -> "ToolResult":
        return cls([{"type": "text", "text": text}], is_error=True)

    @classmethod
    def json(cls, value: Any) -> "ToolResult":
        return cls([{"type": "text", "text": json.dumps(value, ensure_ascii=False, indent=1)}])

    @classmethod
    def image(cls, data: bytes, mime_type: str = "image/png") -> "ToolResult":
        return cls([{"type": "image", "data": base64.b64encode(data).decode("ascii"), "mimeType": mime_type}])

    def to_dict(self) -> dict:
        """As MCP's `tools/call` result."""
        return {"content": self.content, "isError": self.is_error}

    @classmethod
    def from_dict(cls, d: dict) -> "ToolResult":
        return cls(list(d.get("content") or []), bool(d.get("isError", d.get("is_error", False))))


@dataclass
class Response:
    """The backend's answer to a request its panel made (`App.request`)."""
    status: int = 200
    body: bytes = b""
    headers: Dict[str, str] = field(default_factory=dict)

    @classmethod
    def json(cls, value: Any, status: int = 200) -> "Response":
        return cls(status, json.dumps(value).encode(), {"Content-Type": "application/json"})


class Host(ABC):
    """What the host gives an app. Every event an app inserts carries `app` and `instance`, which the host sets; an
    app inserts only its own types and the context types (manifest.CONTEXT_TYPES), and reads only what its manifest
    lets it (`Manifest.may_read`). Each method raises AppError for what the host refuses."""

    @abstractmethod
    def insert(self, instance: Instance, events: List[dict], channel: Optional[str] = None) -> None:
        """`events` put into the instance's gatherer, in ag's insert shape (as `ag home insert` and ag's hooks send
        them): each `{"type", "payload", "id"?, "text"?, "properties"?}`, `text` what a policy shows of it. With
        `channel`, an agent's (one attached to the instance); without, the gatherer's, seen by every agent there
        (for the context types). An `id` makes a re-sent event the same event, stored once."""

    @abstractmethod
    def read(self, instance: Instance, types: Sequence[str], after: int = 0, channel: Optional[str] = None,
             limit: int = 500) -> List[dict]:
        """The instance's gatherer's events of `types` after row `after`, oldest first, at most `limit`: each
        `{"row_id", "type", "payload", "text", "properties"}`. The app's own types are read for this instance only;
        `channel` narrows them to one agent's."""

    @abstractmethod
    def attached(self, instance: Instance) -> List[str]:
        """The channels of the agents attached to the instance."""

    @abstractmethod
    def tell_panel(self, instance: Instance, message: dict) -> None:
        """`message` (JSON) to every open panel of the instance, as the SDK's `onMessage` gives it."""

    @abstractmethod
    def folder(self) -> str:
        """The app's own folder (<home>/apps/<name>/data), for what it keeps outside the gatherer."""

    def instances(self) -> List[Instance]:
        """The app's open instances, in every gatherer."""
        return []


class App:
    """An app's backend. The host sets `manifest` and calls `start` once, before anything else; then, from any thread,
    the rest. Override what the app does; the defaults do nothing (and `call` refuses every tool)."""

    manifest: Optional[Manifest] = None
    host: Optional[Host] = None

    def start(self, host: Host) -> None:
        self.host = host

    def stop(self) -> None:
        """The host is closing: let go of what it holds (processes, files)."""

    def open(self, instance: Instance, args: dict) -> Instance:
        """A new instance, made by the host (its id, gatherer, folder) from `args` (what opened it: a tool, the
        user, an intent). Returns it, its `title` and `data` set as the app wants."""
        return instance

    def close(self, instance: Instance) -> None:
        """The instance closed: by the user, or its gatherer gone."""

    def call(self, instance: Instance, tool: str, args: dict, caller: Caller) -> ToolResult:
        """A call of one of its tools (its own name) handled by the backend, on `instance`, by `caller`. Raise
        AppError, or return ToolResult.error, to refuse it."""
        raise AppError(f"{tool}: not a tool of this app's backend")

    def request(self, instance: Optional[Instance], method: str, path: str, query: Dict[str, str],
                body: bytes) -> Response:
        """A request the panel made of the backend: `path` is what follows /apps/<name>/api/. Its data that are not
        events (a file's contents, a picture)."""
        return Response(404, b"not found")

    def attached(self, instance: Instance, channel: str) -> None:
        """An agent was attached to the instance: tell it what it needs to know now, by inserting a context_stream
        into its channel."""

    def detached(self, instance: Instance, channel: str) -> None:
        """An agent was detached from the instance."""
