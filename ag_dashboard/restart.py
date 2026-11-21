"""`ag dashboard restart [--host H] [--port N] [--open]`: the home's dashboard stopped and started again, so that it runs
the code now on disk (after a pull). `ag stop` leaves the dashboard alone: it stops what ag's launchers started, the hook
servers, which start again only as ag next starts a harness -- until then the sessions that call through them have
their calls refused; a dashboard does not come back by itself either, and stopping it closes every terminal it runs.

Which dashboard: the one the home's address file names (home.address_path, written as each dashboard starts), and only
once its process runs and its page says it serves this home -- never a process only the file names, whose pid may since
be another program's. With none running, one is started.

The stop is the one Ctrl-C makes (SIGTERM), which closes every terminal the dashboard runs: its actors' harnesses, and
this command's own when it runs in one of them. So the stop and the start are done by a process of their own
(`python -m ag_dashboard.restart --worker ...`, in a session of its own, writing to LOG), which outlives that terminal;
the command waits for it and says what it did, if it is still there to say it.

The new dashboard listens where the old one did (--host / --port: elsewhere) and starts in its working directory, where
new actors start. Its environment is the caller's less what ties it to an actor (as sessions.agent_env makes an actor's,
less ag's own AG_ACTOR / AG_DASHBOARD): an actor's shell is a usual place to run this from. It is started as the ag app
starts one, detached, its output added to LOG. Its actors are listed as they were, each to open again; an open page or
the app reconnects by itself, but a page keeps the script it loaded until it is reloaded."""

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlsplit

from . import home

LOG = os.path.join("logs", "dashboard", "restart.log")      # in the home
STOP_WAIT = 30.0            # seconds the old dashboard is given to close its terminals and end, before it is killed
KILL_WAIT = 5.0
START_WAIT = 120.0          # a checkout's dashboard builds its page first (page_build.ensure), as the app allows for
MARK = "ag dashboard restart:"


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="ag dashboard restart",
                                 description="Stop the home's dashboard and start it again, on the code now on disk. "
                                             "Every terminal it runs closes (this one too, if it is one of them); its "
                                             "actors stay listed, each to open again.")
    ap.add_argument("--home", help="the context manager's home (default: AG_HOME, or ~/.ag)")
    ap.add_argument("--host", help="where the new one listens (default: where the old one did, else 127.0.0.1)")
    ap.add_argument("--port", type=int, help="its port (default: the old one's, else 4200)")
    ap.add_argument("--open", action=argparse.BooleanOptionalAction, default=False,
                    help="open the page once it is up (default: not: a page already open reconnects by itself)")
    args = ap.parse_args(argv)
    if args.home:
        home.HOME = os.path.abspath(os.path.expanduser(args.home))
    old, problem = running()
    if problem:
        print(f"ag dashboard restart: {problem}", file=sys.stderr)
        return 1
    host, port, cwd = where(old, args.host, args.port)
    if not old and home.serves(_url(host, port)):
        print(f"ag dashboard restart: a dashboard of this home answers at {_url(host, port)}, but "
              f"{home.address_path()} names no process for it: stop it yourself (Ctrl-C where it runs), then run this "
              "again", file=sys.stderr)
        return 1
    log = os.path.join(home.HOME, LOG)
    os.makedirs(os.path.dirname(log), exist_ok=True)
    if old:
        print(f"ag dashboard restart: stopping the dashboard at {old['url']} (pid {old['pid']}): the terminals it runs "
              f"close, this one too if it is one of them. Then starting it again; its log: {log}", file=sys.stderr)
    else:
        print(f"ag dashboard restart: no dashboard of {home.HOME} is running: starting one; its log: {log}",
              file=sys.stderr)
    since = os.path.getsize(log) if os.path.exists(log) else 0
    with open(log, "ab") as out:
        worker = subprocess.Popen(
            [sys.executable, "-m", "ag_dashboard.restart", "--worker", "--home", home.HOME, "--host", host,
             "--port", str(port), "--cwd", cwd, "--pid", str(old["pid"] if old else 0),
             "--open" if args.open else "--no-open"],
            env=environ(), cwd=cwd, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT,
            start_new_session=True)
    try:
        code = worker.wait()
    except KeyboardInterrupt:
        print(f"\nag dashboard restart: it goes on without this command; its log: {log}", file=sys.stderr)
        return 130
    for line in _said(log, since):
        print(line, file=sys.stderr)
    if code == 0 and old:
        print("ag dashboard restart: reload the open page for its new script", file=sys.stderr)
    return code


def _url(host: str, port: int) -> str:
    """The page's address for a browser on this machine (a dashboard on every address is on localhost too)."""
    if host in ("", "0.0.0.0", "::"):
        host = "127.0.0.1"
    return f"http://[{host}]:{port}/" if ":" in host else f"http://{host}:{port}/"


def running() -> Tuple[Optional[dict], Optional[str]]:
    """The dashboard the home's address file names, when its process runs and its page serves this home: {url, pid,
    host, cwd} (host and cwd None from a dashboard older than them); else None. What is wrong instead, as the second:
    a dashboard of this home answering whose process is not the file's, which cannot be told apart to stop it."""
    try:
        with open(home.address_path(), encoding="utf-8") as fh:
            kept = json.load(fh)
        url, pid = kept["url"], int(kept["pid"])
    except (OSError, ValueError, KeyError, TypeError):
        return None, None
    serves = home.serves(url + "/")
    if serves and home.alive(pid):
        return {"url": url, "pid": pid, "host": kept.get("host"), "cwd": kept.get("cwd")}, None
    if serves:
        return None, (f"a dashboard of this home answers at {url}, but not the process {home.address_path()} names "
                      f"(pid {pid}, not running): stop it yourself, then run this again")
    return None, None                                  # stopped, or its pid reused by another program: left alone


def where(old: Optional[dict], host: Optional[str], port: Optional[int]) -> Tuple[str, int, str]:
    """Where the new dashboard listens and runs: the old one's address and working directory, but for what was asked;
    with no old one, 127.0.0.1:4200 and the caller's directory."""
    if not old:
        return host or "127.0.0.1", port or 4200, os.getcwd()
    parts = urlsplit(old["url"])
    cwd = old.get("cwd") or cwd_of(old["pid"])
    return (host or old.get("host") or parts.hostname or "127.0.0.1", port or parts.port or 4200,
            cwd if cwd and os.path.isdir(cwd) else os.getcwd())


def cwd_of(pid: int) -> Optional[str]:
    """A process's working directory, for a dashboard older than the address file's `cwd`: /proc's on Linux, lsof's on
    macOS; None where neither tells."""
    try:
        return os.readlink(f"/proc/{pid}/cwd")
    except OSError:
        pass
    try:
        out = subprocess.run(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"], capture_output=True, text=True,
                             timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return next((line[1:] for line in out.splitlines() if line.startswith("n/")), None)


def environ() -> Dict[str, str]:
    """The new dashboard's environment: the caller's, less what ties it to an actor -- its harness's session variables
    and an API pointed at ag's hook server (sessions.agent_env, which also names the home), and ag's AG_ACTOR and
    AG_DASHBOARD, which the dashboard gives each actor it runs."""
    from . import sessions
    env = sessions.agent_env()
    for name in (sessions.ACTOR_VAR, sessions.DASHBOARD_VAR):
        env.pop(name, None)
    return env


def _said(log: str, since: int) -> List[str]:
    """The worker's lines in the log from `since` on (the new dashboard's own lines are the log's to keep)."""
    try:
        with open(log, "rb") as fh:
            fh.seek(since)
            text = fh.read().decode("utf-8", "replace")
    except OSError:
        return []
    return [line for line in text.splitlines() if line.startswith(MARK)]


# -- the worker: the stop and the start, in a session of its own


def work(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(prog="python -m ag_dashboard.restart --worker")
    ap.add_argument("--home", required=True)
    ap.add_argument("--host", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--cwd", required=True)
    ap.add_argument("--pid", type=int, default=0)
    ap.add_argument("--open", action=argparse.BooleanOptionalAction, default=False)
    args = ap.parse_args(argv)
    home.HOME = args.home
    if args.pid:
        said = stop(args.pid)
        if said:
            say(said)
            if not _ended(args.pid, 0):
                return 1
    if not free(args.host, args.port, KILL_WAIT):
        say(f"{args.host}:{args.port} is still taken: not started")
        return 1
    proc = subprocess.Popen([sys.executable, "-m", "ag_dashboard", "--home", args.home, "--host", args.host,
                             "--port", str(args.port), "--open" if args.open else "--no-open"],
                            cwd=args.cwd, stdin=subprocess.DEVNULL, stdout=sys.stdout, stderr=sys.stderr,
                            start_new_session=True)
    url = _url(args.host, args.port)
    until = time.time() + START_WAIT
    while time.time() < until:
        code = proc.poll()
        if code is not None:
            say(f"the new dashboard stopped (exit {code}) before it answered: its lines above say why")
            return 1
        if home.serves(url):
            say(f"started again: {url} (pid {proc.pid}, in {args.cwd})" if args.pid else
                f"started: {url} (pid {proc.pid}, in {args.cwd})")
            return 0
        time.sleep(0.25)
    say(f"the new dashboard (pid {proc.pid}) did not answer at {url} in {START_WAIT:g} s: it is left running")
    return 1


def stop(pid: int) -> Optional[str]:
    """The dashboard `pid` stopped as Ctrl-C stops it (SIGTERM), killed if it has not ended in STOP_WAIT: what went
    otherwise than planned, None when it ended as asked."""
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return None
    except PermissionError as exc:
        return f"cannot stop pid {pid}: {exc}"
    if _ended(pid, STOP_WAIT):
        return None
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        return None
    if _ended(pid, KILL_WAIT):
        return f"pid {pid} had not ended {STOP_WAIT:g} s after it was asked to: it was killed"
    return f"pid {pid} did not end, even killed: not started again"


def _ended(pid: int, wait: float) -> bool:
    """Whether `pid` ended within `wait`: gone, or a zombie its parent has yet to collect (which signals still reach)."""
    until = time.time() + wait
    while home.alive(pid) and not _zombie(pid):
        if time.time() >= until:
            return False
        time.sleep(0.2)
    return True


def _zombie(pid: int) -> bool:
    try:
        state = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True,
                               timeout=5).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return False
    return state.startswith("Z")


def free(host: str, port: int, wait: float) -> bool:
    """Whether nothing listens on host:port, waiting up to `wait` for it to be let go."""
    target = "127.0.0.1" if host in ("", "0.0.0.0") else "::1" if host == "::" else host
    until = time.time() + wait
    while True:
        try:
            with socket.create_connection((target, port), timeout=1):
                pass
        except OSError:
            return True
        if time.time() >= until:
            return False
        time.sleep(0.1)


def say(what: str) -> None:
    print(f"{MARK} {what}", flush=True)


if __name__ == "__main__":
    if sys.argv[1:2] == ["--worker"]:
        sys.exit(work(sys.argv[2:]))
    sys.exit(main())
