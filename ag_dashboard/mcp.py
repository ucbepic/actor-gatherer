"""The MCP server an actor reaches the dashboard's tools by -- a DocWriter's its document tools (docwriter.py), a
Browser's its browser tools (browser.py): MCP's streamable HTTP transport,
the least of it -- each JSON-RPC request POSTed, answered with JSON, no stream of the server's own -- which Claude
Code (`"type": "http"` in --mcp-config) and codex (`mcp_servers.<name>.url`) both speak.

    initialize                  the protocol version the client asked for (or PROTOCOL), its tools offered, and its
                                `instructions` where it has some (what Claude Code adds to its system prompt)
    notifications/*             taken, nothing answered (202)
    tools/list                  `tools`: each one's name, description and input schema
    tools/call                  `call(name, arguments)`: what it says, as MCP's result ({content, isError})
    ping                        {}

Standard library only.

A harness asks for `tools/list` once it has connected, and a turn it starts before that has none of the server's
tools: Claude Code and codex both start one without waiting for their MCP servers. So each endpoint's last list is
kept (`listed`, by `endpoint`), and the dashboard types a session's first message only once its actor's endpoints
have listed their tools (sessions.py's `_first_message`, apps.py's `tools_of`)."""
import json
import threading
import time
from typing import Callable, Dict, List, Optional, Tuple

PROTOCOL = "2025-06-18"     # the version answered to a client that names none
NAME = "ag-dashboard"       # a server's name, where none is given (`handle`): its tools' names, as harnesses show them,
                            # carry it -- an app's server is given its own (docwriter.py's MCP_NAME, browser.py's NAME)

_listed: Dict[str, float] = {}      # when each endpoint last answered `tools/list` (epoch seconds), by `endpoint`
_listed_lock = threading.Lock()


def endpoint(app: str, key: str) -> str:
    """The id of an app's actor's MCP server, the one at /<app>/w/<key>/mcp, as `handle` and `listed` take it."""
    return f"{app}/{key}"


def listed(at: str) -> Optional[float]:
    """When the endpoint `at` last answered `tools/list` (epoch seconds), else None."""
    with _listed_lock:
        return _listed.get(at)


def result(text: str, error: bool = False) -> dict:
    """A tool's result, as MCP has it."""
    return {"content": [{"type": "text", "text": text}], **({"isError": True} if error else {})}


def handle(body: bytes, tools: List[dict], call: Callable[[str, dict], dict],
           name: str = NAME, at: Optional[str] = None, instructions: str = "") -> Tuple[int, Optional[dict]]:
    """One POST to the server: (status, JSON to answer with, or None for none). `tools`: [{name, description,
    inputSchema}]; `call(name, arguments)`: a tool's result (`result`). A batch -- a list of messages -- is answered
    with the list of their answers. `at`: the server's endpoint (`endpoint`), its `tools/list` answered kept (`listed`).
    `instructions`: what `initialize` tells the client of the server's tools."""
    try:
        message = json.loads(body or b"null")
    except ValueError:
        return 400, _error(None, -32700, "not JSON")
    if isinstance(message, list):
        answers = [a for a in (_one(m, tools, call, name, at, instructions) for m in message) if a is not None]
        return (200, answers) if answers else (202, None)
    answer = _one(message, tools, call, name, at, instructions)
    return (200, answer) if answer is not None else (202, None)


def _one(message, tools: List[dict], call: Callable[[str, dict], dict], server: str = NAME,
         at: Optional[str] = None, instructions: str = "") -> Optional[dict]:
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        return _error(None, -32600, "not a JSON-RPC 2.0 message")
    if "id" not in message:                     # a notification, or a client's answer: nothing to say
        return None
    mid, method, params = message["id"], message.get("method"), message.get("params") or {}
    if method == "initialize":
        return _ok(mid, {"protocolVersion": params.get("protocolVersion") or PROTOCOL,
                         "capabilities": {"tools": {"listChanged": False}},
                         "serverInfo": {"name": server, "version": "1"},
                         **({"instructions": instructions} if instructions else {})})
    if method == "ping":
        return _ok(mid, {})
    if method == "tools/list":
        if at is not None:
            with _listed_lock:
                _listed[at] = time.time()
        return _ok(mid, {"tools": tools})
    if method == "tools/call":
        name, arguments = params.get("name"), params.get("arguments") or {}
        if not any(t["name"] == name for t in tools):
            return _error(mid, -32602, f"no tool {name!r}")
        if not isinstance(arguments, dict):
            return _error(mid, -32602, "arguments: an object, please")
        try:
            return _ok(mid, call(name, arguments))
        except Exception as exc:  # noqa: BLE001 - the model is told, and goes on
            return _ok(mid, result(f"{type(exc).__name__}: {exc}", error=True))
    return _error(mid, -32601, f"no method {method!r}")


def _ok(mid, value: dict) -> dict:
    return {"jsonrpc": "2.0", "id": mid, "result": value}


def _error(mid, code: int, text: str) -> dict:
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": text}}
