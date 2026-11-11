"""Where the dashboard reads from: the context manager's home (AG_HOME, default ~/.ag), as ag
lays it out -- the dashboard's only knowledge of ag, which it never imports:

    gatherers/<gatherer>/context.db      the gatherer's database (read-only)
    gatherers/<gatherer>/gatherer.toml   its config: the policy
    logs/llm/*.json                      the Gatherer's model calls, one file each
    hook_server/<port>.json              each hook server ag started: pid, port, upstream

and the dashboard's own, beside them:

    dashboard/views/*.js                 the reader's own chat views, which the page loads
    dashboard/address.json               where the dashboard that last started on this home listens: {url, pid,
                                         host, cwd} -- how an actor it did not start reaches it (`ag actors`,
                                         coordination.py), and what `ag dashboard restart` stops and starts again
    dashboard/uploads/*                  images pasted or dropped into a message box, named in the message by path

and, of each read, the harness's process that made the call (`_reads.pid`, `pid_started`: the
boot's id and the process's start in clock ticks, as /proc gives them), to tell whether it runs.

HOME is a module attribute, so a test (or `--home`) can point it elsewhere."""

import base64
import json
import os
import re
import uuid
from typing import List, Optional

from harness_kit.processes import running

HOME = os.path.abspath(os.path.expanduser(os.environ.get("AG_HOME") or "~/.ag"))

_UNSAFE = re.compile(r"[^A-Za-z0-9._-]")


def gatherers_dir() -> str:
    return os.path.join(HOME, "gatherers")


def gatherer_dir(gatherer: str) -> str:
    """The gatherer's directory: unsafe characters in its name become `_`, as ag names it."""
    key = _UNSAFE.sub("_", (gatherer or "").strip())
    return os.path.join(gatherers_dir(), "unknown" if key in ("", ".", "..") else key)


def db_path(gatherer: str) -> str:
    return os.path.join(gatherer_dir(gatherer), "context.db")


def llm_log_dir() -> str:
    return os.path.join(HOME, "logs", "llm")


IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}


def save_upload(mime: str, data: str) -> dict:
    """An image pasted or dropped into a message box (`data`, base64), saved where the agent can read it: {path}."""
    ext = IMAGE_TYPES.get(mime)
    if ext is None:
        raise ValueError(f"not an image the agents read: {mime or 'no type'}")
    folder = os.path.join(HOME, "dashboard", "uploads")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, uuid.uuid4().hex + ext)
    with open(path, "wb") as fh:
        fh.write(base64.b64decode(data, validate=True))
    return {"path": path}


VIEW_FILE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\.js")


def views_dir() -> str:
    return os.path.join(HOME, "dashboard", "views")


def address_path() -> str:
    return os.path.join(HOME, "dashboard", "address.json")


def write_address(url: str, host: Optional[str] = None) -> Optional[str]:
    """`url` kept as where this dashboard listens (address_path), for actors it did not start, with this process, the
    address it was asked to listen on (`host`: url names 127.0.0.1 for 0.0.0.0) and its working directory (where new
    actors start), for `ag dashboard restart` (restart.py) to start it again as it was: the file, or None where it could
    not be written."""
    path = address_path()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path + ".tmp", "w", encoding="utf-8") as fh:
            json.dump({"url": url, "pid": os.getpid(), "host": host, "cwd": os.getcwd()}, fh)
        os.replace(path + ".tmp", path)
        return path
    except OSError:
        return None


def serves(url: str, timeout: float = 10) -> bool:
    """Whether the server at `url` (ending in "/") is a dashboard of this home: its /api/home says so, as the ag app
    tells its own (desktop/src/dashboard.ts)."""
    import urllib.request
    try:
        with urllib.request.urlopen(url + "api/home", timeout=timeout) as answer:
            return json.load(answer).get("home") == HOME
    except (OSError, ValueError, AttributeError):
        return False


def forget_address(path: str, url: Optional[str]) -> None:
    """The address file taken away, if it still names this dashboard (`url`, this process): not another's since."""
    try:
        with open(path, encoding="utf-8") as fh:
            kept = json.load(fh)
        if kept.get("url") == url and kept.get("pid") == os.getpid():
            os.remove(path)
    except (OSError, ValueError, AttributeError):
        pass


def view_names() -> List[str]:
    """The reader's own chat views: the .js files in views_dir(), by name; [] when there is none."""
    d = views_dir()
    return sorted(n for n in os.listdir(d) if VIEW_FILE.fullmatch(n) and os.path.isfile(os.path.join(d, n))) \
        if os.path.isdir(d) else []


def view_file(name: str) -> Optional[str]:
    """The path of the view named `name`, None when it is not one of view_names() (no other path is served)."""
    return os.path.join(views_dir(), name) if name in view_names() else None


def alive(pid) -> bool:
    return running(pid)


def _boot_id() -> Optional[str]:
    try:
        with open("/proc/sys/kernel/random/boot_id", encoding="ascii") as fh:
            return fh.read().strip()
    except OSError:
        return None


def runs_under(pid, root) -> bool:
    """Whether process `pid` is `root` or runs under it (Linux's /proc): a harness whose command is a
    wrapper -- codex's `codex` starts the real codex as its child -- makes its calls from below the
    process the dashboard started. False when either is not known, or it cannot be told."""
    if not isinstance(pid, int) or not isinstance(root, int):
        return False
    for _ in range(16):
        if pid == root:
            return True
        try:
            with open(f"/proc/{pid}/stat", encoding="ascii", errors="replace") as fh:
                pid = int(fh.read().rsplit(")", 1)[1].split()[1])     # its parent
        except (OSError, ValueError, IndexError):
            return False
        if pid <= 1:
            return False
    return False


def process_alive(pid, started) -> Optional[bool]:
    """Whether the process ag recorded -- `pid`, started at `started` ("<boot id>:<start ticks>") --
    still runs: False when no process has that pid, or a later one does (another start, another
    boot); None when it cannot be told (nothing recorded, no /proc)."""
    if not isinstance(pid, int) or not isinstance(started, str) or not os.path.isdir("/proc"):
        return None
    try:
        with open(f"/proc/{pid}/stat", encoding="ascii", errors="replace") as fh:
            fields = fh.read().rsplit(")", 1)[-1].split()
    except OSError:
        return False
    boot = _boot_id()
    if boot is None or len(fields) < 20:
        return None
    return started == f"{boot}:{fields[19]}"


def hook_servers() -> List[dict]:
    """The hook servers ag started that are still running: {port, pid, upstream}. Their records
    are only read: a dead one's is left for ag to remove."""
    d = os.path.join(HOME, "hook_server")
    found = []
    for name in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(d, name), encoding="utf-8") as fh:
                s = json.load(fh)
        except (OSError, ValueError):
            continue
        if isinstance(s, dict) and alive(s.get("pid")):
            found.append({"port": s.get("port"), "pid": s.get("pid"), "upstream": s.get("upstream")})
    return found
