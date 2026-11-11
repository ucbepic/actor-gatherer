"""The hook servers ag starts (for codex, and for Claude Code through its own hook_servers.py): a
harness's setup run as `python -m <setup> --port P --upstream U`, each relaying to one upstream,
detached so that it outlives the run that started it and later runs share it.

Each is recorded in <home>/hook_server/<port>.json (<home> the context manager's:
its pid, port, upstream and setup), its output in
<home>/logs/hook_servers/<port>.log. A run finds the live one with
its setup and upstream, or starts one on the first free port from the one
asked for.
"""

import base64
import json
import os
import signal
import socket
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional, Sequence

from harness_kit.processes import running
from ag.cli.launch import REPO


@dataclass
class HookServer:
    port: int
    pid: int
    upstream: str
    setup: str                      # the module run, e.g. ag.integrations.harnesses.codex.setup.setup
    log_dir: str = ""
    options: Dict[str, str] = field(default_factory=dict)   # its --option KEY=VALUE, e.g. the adaptor
    trace_root: str = ""            # its --trace-root: every model call traced there (hook_server/trace.py)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"


def config_part(folder: str) -> str:
    """A hook server URL's part naming the harness's own folder for a run (its config folder, where the hook finds its
    record of each session): /c/<the path, base64url-encoded, unpadded> -- the hook server's `config_of` reads it."""
    return "/c/" + base64.urlsafe_b64encode(folder.encode()).decode().rstrip("=")


def _alive(pid: int) -> bool:
    return running(pid)


def _detached(breakaway: bool = True) -> dict:
    """Popen's options for a process that outlives the run that started it. POSIX: a session of its own.
    Windows ignores start_new_session; there it gets no console (so closing the terminal, or Ctrl-C in it, does
    not end it), a process group of its own and, with `breakaway`, leaves the job ag runs in: the launcher pip
    installs as ag.exe puts its python in a job that is killed when ag.exe exits."""
    if os.name == "nt":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        if breakaway:
            flags |= subprocess.CREATE_BREAKAWAY_FROM_JOB
        return {"creationflags": flags}
    return {"start_new_session": True}


def _listening(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def _free(port: int) -> bool:
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


class HookServers:
    """The hook servers ag started under the home `home`."""

    def __init__(self, home: str):
        self.home = home
        self.directory = os.path.join(home, "hook_server")         # the records
        self.logs = os.path.join(home, "logs", "hook_servers")    # their output

    def log(self, port: int) -> str:
        return os.path.join(self.logs, f"{port}.log")

    def running(self) -> List[HookServer]:
        """The hook servers ag started that are still running; the records of
        the others are removed."""
        found = []
        d = self.directory
        if not os.path.isdir(d):
            return found
        for name in sorted(os.listdir(d)):
            if not name.endswith(".json"):
                continue
            p = os.path.join(d, name)
            try:
                with open(p, encoding="utf-8") as fh:
                    server = HookServer(**json.load(fh))
            except (OSError, ValueError, TypeError):
                continue
            if _alive(server.pid):
                found.append(server)
            else:
                os.remove(p)
        return found


    def find(self, setup: str, upstream: str, log_dir: str = "",
             options: Optional[Dict[str, str]] = None, trace_root: str = "") -> Optional[HookServer]:
        for server in self.running():
            if (server.setup, server.upstream, server.log_dir, server.options, server.trace_root) == \
                    (setup, upstream, log_dir, dict(options or {}), trace_root) and _listening(server.port):
                return server
        return None


    def start(self, setup: str, upstream: str, port: int, log_dir: str = "",
              options: Optional[Dict[str, str]] = None, timeout: float = 15.0,
              trace_root: str = "", thread_headers: Sequence[str] = ("thread-id", "session-id")) -> HookServer:
        """The live hook server `setup` runs, relaying to `upstream`, started if
        there is none. With `trace_root`, it traces every model call there, each under the thread
        the first of `thread_headers` it carries names (codex's, by default)."""
        options = dict(options or {})
        server = self.find(setup, upstream, log_dir, options, trace_root)
        if server:
            return server
        taken = {s.port for s in self.running()}
        while port in taken or not _free(port):
            port += 1
        os.makedirs(self.directory, exist_ok=True)
        os.makedirs(self.logs, exist_ok=True)
        log = self.log(port)
        argv = [os.environ.get("AG_PYTHON") or sys.executable, "-m", setup, "--port", str(port), "--upstream", upstream]
        if log_dir:
            argv += ["--log-dir", log_dir]
        if trace_root:
            argv += ["--trace-root", trace_root, *[x for h in thread_headers for x in ("--thread-header", h)]]
        argv += [x for k, v in options.items() for x in ("--option", f"{k}={v}")]
        env = {**os.environ, "AG_HOME": self.home,
               "PYTHONPATH": os.pathsep.join(p for p in (REPO, os.environ.get("PYTHONPATH")) if p)}
        with open(log, "ab") as out:
            try:
                proc = subprocess.Popen(argv, cwd=REPO, env=env, stdin=subprocess.DEVNULL, stdout=out,
                                        stderr=subprocess.STDOUT, **_detached())
            except PermissionError:          # Windows: a job that may not be left
                proc = subprocess.Popen(argv, cwd=REPO, env=env, stdin=subprocess.DEVNULL, stdout=out,
                                        stderr=subprocess.STDOUT, **_detached(breakaway=False))
        server = HookServer(port, proc.pid, upstream, setup, log_dir, options, trace_root)
        with open(os.path.join(self.directory, f"{port}.json"), "w", encoding="utf-8") as fh:
            json.dump(asdict(server), fh)
        deadline = time.time() + timeout
        while time.time() < deadline:
            if proc.poll() is not None:
                os.remove(os.path.join(self.directory, f"{port}.json"))
                raise RuntimeError(f"the hook server did not start (exit {proc.returncode}); "
                                   f"the end of {log}:\n{_tail(log)}")
            if _listening(port):
                return server
            time.sleep(0.1)
        raise RuntimeError(f"the hook server did not listen on :{port} within {timeout:.0f}s; see {log}")


    def stop(self, server: HookServer) -> None:
        try:
            os.kill(server.pid, signal.SIGTERM)
        except OSError:                      # gone already (on Windows a bare OSError, not ProcessLookupError)
            pass
        for _ in range(50):
            if not _alive(server.pid):
                break
            time.sleep(0.1)
        try:
            os.remove(os.path.join(self.directory, f"{server.port}.json"))
        except FileNotFoundError:
            pass


def _tail(path: str, n: int = 15) -> str:
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return "".join(fh.readlines()[-n:])
    except OSError:
        return ""
