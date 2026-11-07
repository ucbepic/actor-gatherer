"""An app in a process of its own: the same calls as backend.py's, over HTTP, so an app can be written in any language
(DESIGN.md, "An app is a manifest, a backend and a panel").

The host starts the manifest's `command` in the app's folder with three variables set:

    AG_APP_HOST     the host's URL for the app's calls (below)
    AG_APP_TOKEN    a secret both sides send as `Authorization: Bearer <token>`, and check on what they receive
    AG_APP_DATA     the app's own folder (Host.folder)

The app listens on 127.0.0.1 and prints one line to its standard output, `{"url": "http://127.0.0.1:<port>"}`; then
each side POSTs JSON to the other:

    host -> app (<url>/<op>)                        app -> host (<AG_APP_HOST>/<op>)
    open     {instance, args} -> {instance}         insert    {instance, events, channel?} -> {}
    close    {instance}                             read      {instance, types, after?, channel?, limit?} -> {events}
    call     {instance, tool, args, caller}         attached  {instance} -> {channels}
             -> {content, isError}                  tell      {instance, message} -> {}
    request  {instance?, method, path, query,       instances {} -> {instances}
                                                    panels    {instance} -> {panels}
              body (base64)} -> {status, headers,
              body (base64)}
    attached / detached  {instance, channel}
    guard    {instance, path, caller} -> {refused}
    stop     {}

A refusal is a 4xx with `{"error": "..."}`. Each side here: `launch` (the host starting an app, RemoteApp the app as
the host calls it), and `serve` / `main` (an App subclass run as such a process, RemoteHost the host as it calls it):

    python -m app_kit.remote mymodule:MyApp       an App subclass, in its own process

Standard library only."""

import base64
import hmac
import importlib
import json
import os
import secrets
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from .backend import App, AppError, Caller, Host, Instance, Response, ToolResult

HOST_ENV, TOKEN_ENV, DATA_ENV = "AG_APP_HOST", "AG_APP_TOKEN", "AG_APP_DATA"
START_WAIT = 20.0           # seconds the host waits for a started app to print its URL
CALL_WAIT = 300.0           # seconds either side waits for an answer (a tool call can take a while)
MAX_BODY = 64 * 1024 * 1024


def new_token() -> str:
    return secrets.token_urlsafe(32)


def _post(url: str, token: str, body: dict, timeout: float = CALL_WAIT) -> dict:
    """`body` POSTed as JSON with the token; the answer's JSON. A refusal (4xx) raises AppError with its words."""
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        try:
            said = json.loads(exc.read() or b"{}").get("error")
        except ValueError:
            said = None
        raise AppError(said or f"{url}: HTTP {exc.code}", exc.code) from None
    except (urllib.error.URLError, OSError) as exc:
        raise AppError(f"{url}: {getattr(exc, 'reason', exc)}", 502) from None
    return json.loads(raw or b"{}")


class _Handler(BaseHTTPRequestHandler):
    """POST /<op> with JSON, answered by `self.server.ops[op](body)`, the token checked first."""

    def log_message(self, *args) -> None:       # the app's own output stays its own
        pass

    def do_POST(self) -> None:
        got = self.headers.get("Authorization", "")
        if not hmac.compare_digest(got.encode(), f"Bearer {self.server.token}".encode()):
            return self._answer(401, {"error": "not this app's host"})
        op = self.path.strip("/")
        fn = self.server.ops.get(op)
        if fn is None:
            return self._answer(404, {"error": f"{op}: no such call"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                return self._answer(413, {"error": "too large"})
            body = json.loads(self.rfile.read(length) or b"{}")
            return self._answer(200, fn(body) or {})
        except AppError as exc:
            return self._answer(exc.status if 400 <= exc.status < 600 else 400, {"error": str(exc)})
        except (KeyError, TypeError, ValueError) as exc:
            return self._answer(400, {"error": f"{op}: {exc}"})
        except Exception as exc:  # noqa: BLE001 - an app's bug is its caller's error, not a dead server
            return self._answer(500, {"error": f"{op}: {type(exc).__name__}: {exc}"})

    def _answer(self, status: int, body: dict) -> None:
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def _server(ops: Dict[str, Callable[[dict], Optional[dict]]], token: str, port: int = 0) -> ThreadingHTTPServer:
    srv = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
    srv.daemon_threads = True
    srv.ops, srv.token = ops, token
    return srv


def _url(srv: ThreadingHTTPServer) -> str:
    return f"http://127.0.0.1:{srv.server_address[1]}"


# ---------------------------------------------------------------- the host's side


class RemoteApp(App):
    """An app in its own process, as the host calls it: each App method a POST to it."""

    def __init__(self, url: str, token: str, process: Optional[subprocess.Popen] = None):
        self.url, self.token, self.process = url.rstrip("/"), token, process

    def _op(self, op: str, body: dict, timeout: float = CALL_WAIT) -> dict:
        return _post(f"{self.url}/{op}", self.token, body, timeout)

    def start(self, host: Host) -> None:
        self.host = host                        # the process has its own: RemoteHost, at AG_APP_HOST

    def stop(self) -> None:
        try:
            self._op("stop", {}, timeout=5)
        except AppError:
            pass
        if self.process is not None:
            if self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
            if self.process.stdout is not None:
                self.process.stdout.close()

    def open(self, instance: Instance, args: dict) -> Instance:
        return Instance.from_dict(self._op("open", {"instance": instance.to_dict(), "args": args})["instance"])

    def close(self, instance: Instance) -> None:
        self._op("close", {"instance": instance.to_dict()})

    def call(self, instance: Instance, tool: str, args: dict, caller: Caller) -> ToolResult:
        return ToolResult.from_dict(self._op("call", {"instance": instance.to_dict(), "tool": tool, "args": args,
                                                       "caller": caller.to_dict()}))

    def request(self, instance: Optional[Instance], method: str, path: str, query: Dict[str, str],
                body: bytes) -> Response:
        got = self._op("request", {"instance": instance.to_dict() if instance else None, "method": method,
                                   "path": path, "query": query, "body": base64.b64encode(body).decode()})
        return Response(int(got.get("status", 200)), base64.b64decode(got.get("body") or ""),
                        dict(got.get("headers") or {}))

    def attached(self, instance: Instance, channel: str) -> None:
        self._op("attached", {"instance": instance.to_dict(), "channel": channel})

    def detached(self, instance: Instance, channel: str) -> None:
        self._op("detached", {"instance": instance.to_dict(), "channel": channel})

    def guard(self, instance: Instance, path: str, caller: Caller) -> Optional[str]:
        return self._op("guard", {"instance": instance.to_dict(), "path": path, "caller": caller.to_dict()}).get("refused")


def host_ops(host: Host, instance_of: Callable[[dict], Instance]) -> Dict[str, Callable[[dict], dict]]:
    """The calls an app in its own process makes of the host, answered by `host`: what a host serves at AG_APP_HOST.
    `instance_of` turns the instance the app names into the host's own (refusing one not the app's)."""
    return {
        "insert": lambda b: host.insert(instance_of(b["instance"]), list(b["events"]), b.get("channel")) or {},
        "read": lambda b: {"events": host.read(instance_of(b["instance"]), list(b["types"]), int(b.get("after", 0)),
                                               b.get("channel"), int(b.get("limit", 500)))},
        "attached": lambda b: {"channels": host.attached(instance_of(b["instance"]))},
        "tell": lambda b: host.tell_panel(instance_of(b["instance"]), dict(b["message"])) or {},
        "instances": lambda b: {"instances": [i.to_dict() for i in host.instances()]},
        "panels": lambda b: {"panels": host.panels(instance_of(b["instance"]))},
    }


def _drain(stream) -> None:
    try:
        for _ in stream:
            pass
    except (OSError, ValueError):               # closed by `stop`
        pass


def close(srv: ThreadingHTTPServer) -> None:
    """A server `serve` or `serve_host` started, stopped and its socket closed."""
    srv.shutdown()
    srv.server_close()


def launch(command: Sequence[str], folder: str, host_url: str, token: str, data: str,
           env: Optional[Dict[str, str]] = None, wait: float = START_WAIT) -> RemoteApp:
    """The manifest's `command` started in the app's `folder`, told where the host is; the app as the host calls it,
    once it has printed its URL. Its standard error goes where the host's does."""
    full = dict(os.environ if env is None else env, **{HOST_ENV: host_url, TOKEN_ENV: token, DATA_ENV: data})
    proc = subprocess.Popen(list(command), cwd=folder, env=full, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            text=True)
    got: List[str] = []
    reader = threading.Thread(target=lambda: got.append(proc.stdout.readline()), daemon=True)
    reader.start()
    reader.join(wait)
    line = got[0].strip() if got else ""
    try:
        url = json.loads(line)["url"]
    except (ValueError, KeyError, TypeError):
        proc.kill()
        proc.wait()
        proc.stdout.close()
        raise AppError(f"{' '.join(command)}: printed no {{\"url\": ...}} line within {wait:g} s"
                       + (f" (it printed {line[:200]!r})" if line else ""), 502) from None
    # what it prints after its URL is its own: read on, so it never blocks on a full pipe
    threading.Thread(target=_drain, args=(proc.stdout,), daemon=True).start()
    return RemoteApp(url, token, proc)


# ---------------------------------------------------------------- the app's side


class RemoteHost(Host):
    """The host, as an app in its own process calls it: each Host method a POST to AG_APP_HOST."""

    def __init__(self, url: str, token: str, data: str):
        self.url, self.token, self.data = url.rstrip("/"), token, data

    def _op(self, op: str, body: dict) -> dict:
        return _post(f"{self.url}/{op}", self.token, body)

    def insert(self, instance: Instance, events: List[dict], channel: Optional[str] = None) -> None:
        self._op("insert", {"instance": instance.to_dict(), "events": events, "channel": channel})

    def read(self, instance: Instance, types: Sequence[str], after: int = 0, channel: Optional[str] = None,
             limit: int = 500) -> List[dict]:
        return self._op("read", {"instance": instance.to_dict(), "types": list(types), "after": after,
                                 "channel": channel, "limit": limit})["events"]

    def attached(self, instance: Instance) -> List[str]:
        return self._op("attached", {"instance": instance.to_dict()})["channels"]

    def tell_panel(self, instance: Instance, message: dict) -> None:
        self._op("tell", {"instance": instance.to_dict(), "message": message})

    def folder(self) -> str:
        return self.data

    def instances(self) -> List[Instance]:
        return [Instance.from_dict(d) for d in self._op("instances", {})["instances"]]

    def panels(self, instance: Instance) -> int:
        return int(self._op("panels", {"instance": instance.to_dict()})["panels"])


def app_ops(app: App) -> Dict[str, Callable[[dict], Optional[dict]]]:
    """The host's calls of an app, answered by `app`: what an app in its own process serves."""
    inst = Instance.from_dict

    def request(b: dict) -> dict:
        r = app.request(inst(b["instance"]) if b.get("instance") else None, b["method"], b["path"],
                        dict(b.get("query") or {}), base64.b64decode(b.get("body") or ""))
        return {"status": r.status, "headers": r.headers, "body": base64.b64encode(r.body).decode()}

    return {
        "open": lambda b: {"instance": app.open(inst(b["instance"]), dict(b.get("args") or {})).to_dict()},
        "close": lambda b: app.close(inst(b["instance"])),
        "call": lambda b: app.call(inst(b["instance"]), b["tool"], dict(b.get("args") or {}),
                                   Caller.from_dict(b.get("caller"))).to_dict(),
        "request": request,
        "attached": lambda b: app.attached(inst(b["instance"]), b["channel"]),
        "detached": lambda b: app.detached(inst(b["instance"]), b["channel"]),
        "guard": lambda b: {"refused": app.guard(inst(b["instance"]), b["path"], Caller.from_dict(b.get("caller")))},
        "stop": lambda b: app.stop(),
    }


def serve(app: App, host: Host, token: str, port: int = 0) -> Tuple[ThreadingHTTPServer, str]:
    """`app` started with `host` and served on 127.0.0.1 (`port`; 0: any free one), in a thread: the server, and its
    URL. Stop it with `close(server)`."""
    app.start(host)
    srv = _server(app_ops(app), token, port)
    threading.Thread(target=srv.serve_forever, name="app-kit-serve", daemon=True).start()
    return srv, _url(srv)


def serve_host(host: Host, instance_of: Callable[[dict], Instance], token: str,
               port: int = 0) -> Tuple[ThreadingHTTPServer, str]:
    """`host` served for one app in its own process (`host_ops`), in a thread: the server, and the URL to give the app
    as AG_APP_HOST. A host with a web server of its own serves `host_ops` there instead."""
    srv = _server(host_ops(host, instance_of), token, port)
    threading.Thread(target=srv.serve_forever, name="app-kit-host", daemon=True).start()
    return srv, _url(srv)


def main(argv: Optional[List[str]] = None) -> int:
    """`python -m app_kit.remote module:Class`: that App subclass run as an app's process (the manifest's `command`):
    it prints its URL, then answers the host until the host stops it."""
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1 or ":" not in argv[0]:
        print("usage: python -m app_kit.remote module:Class", file=sys.stderr)
        return 2
    missing = [v for v in (HOST_ENV, TOKEN_ENV, DATA_ENV) if not os.environ.get(v)]
    if missing:
        print(f"app_kit.remote: started without {', '.join(missing)}: the host starts an app", file=sys.stderr)
        return 2
    module, name = argv[0].split(":", 1)
    sys.path.insert(0, os.getcwd())             # the app's folder: the host starts it there
    app: Any = getattr(importlib.import_module(module), name)()
    token = os.environ[TOKEN_ENV]
    srv, url = serve(app, RemoteHost(os.environ[HOST_ENV], token, os.environ[DATA_ENV]), token)
    stopped = threading.Event()
    stop = app_ops(app)["stop"]
    srv.ops["stop"] = lambda b: (stop(b), stopped.set(), {})[-1]
    print(json.dumps({"url": url}), flush=True)
    parent = os.getppid()
    while not stopped.wait(2.0):
        if os.getppid() != parent:              # the host is gone without stopping it: so is the app
            break
    close(srv)
    return 0


if __name__ == "__main__":
    sys.exit(main())
