"""The MCP server an actor reaches the dashboard's tools by -- a DocWriter's its document tools (docwriter.py), a
Browser's its browser tools (browser.py): MCP's streamable HTTP transport,
the least of it -- each JSON-RPC request POSTed, answered with JSON, no stream of the server's own -- which Claude
Code (`"type": "http"` in --mcp-config) and codex (`mcp_servers.<name>.url`) both speak.

    initialize                  the protocol version the client asked for (or PROTOCOL), its tools offered
    notifications/*             taken, nothing answered (202)
    tools/list                  `tools`: each one's name, description and input schema
    tools/call                  `call(name, arguments)`: what it says, as MCP's result ({content, isError})
    ping                        {}

Standard library only."""
import json
from typing import Callable, List, Optional, Tuple

PROTOCOL = "2025-06-18"     # the version answered to a client that names none
NAME = "docwriter-doc"      # DocWriter's server's name (`handle` takes another's): the tools' names, as the harness shows them, carry it


def result(text: str, error: bool = False) -> dict:
    """A tool's result, as MCP has it."""
    return {"content": [{"type": "text", "text": text}], **({"isError": True} if error else {})}


def handle(body: bytes, tools: List[dict], call: Callable[[str, dict], dict],
           name: str = NAME) -> Tuple[int, Optional[dict]]:
    """One POST to the server: (status, JSON to answer with, or None for none). `tools`: [{name, description,
    inputSchema}]; `call(name, arguments)`: a tool's result (`result`). A batch -- a list of messages -- is answered
    with the list of their answers."""
    try:
        message = json.loads(body or b"null")
    except ValueError:
        return 400, _error(None, -32700, "not JSON")
    if isinstance(message, list):
        answers = [a for a in (_one(m, tools, call, name) for m in message) if a is not None]
        return (200, answers) if answers else (202, None)
    answer = _one(message, tools, call, name)
    return (200, answer) if answer is not None else (202, None)


def _one(message, tools: List[dict], call: Callable[[str, dict], dict], server: str = NAME) -> Optional[dict]:
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        return _error(None, -32600, "not a JSON-RPC 2.0 message")
    if "id" not in message:                     # a notification, or a client's answer: nothing to say
        return None
    mid, method, params = message["id"], message.get("method"), message.get("params") or {}
    if method == "initialize":
        return _ok(mid, {"protocolVersion": params.get("protocolVersion") or PROTOCOL,
                         "capabilities": {"tools": {"listChanged": False}},
                         "serverInfo": {"name": server, "version": "1"}})
    if method == "ping":
        return _ok(mid, {})
    if method == "tools/list":
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
