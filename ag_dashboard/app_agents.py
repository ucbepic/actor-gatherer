"""Apps that start an agent of their own (app_kit/DESIGN.md step 8; a manifest's `[agent] start`): DocWriter, say, whose
menu entry makes a new instance in a folder and a new actor there to work with the user in it. Both ways in -- the page's
"+ ⋯" menu (/api/apps/start, api/apps.py) and the gatherer agent's `ag actors new --<app>` (coordination.py) -- come
here, so they make the same thing:

    start(started, host, app, gatherer, cwd, harness, model=None, name=None)
        a new instance of `app` (app_host.py's `open`), in `cwd`; a new session there (sessions.py's `create`) whose
        role says whose it is, {"app": <name>, "key": <instance>} -- the page shows an app's actor by it -- attached to
        the instance before its harness starts, so the tool gateway gives it the app's tools, instructions and guard
        at launch (tool_gateway.py's `launch_args`); named once its gatherer has it (`name`, else the manifest's
        `[agent] name`) -> (its session, as the table has it; the instance)

    role_of(session)   the app and instance a session's role names: {"app": name, "key": id}, or an app's own older
                       form, {"<name>": key} -- None for any other
    adopt_all(started, host)   each session whose role names an app the host has (an app's actor from before it was
                       an app: DocWriter's, {"docwriter": key}) attached to that app's instance of that key -- made, if
                       it is not yet, on the session's folder (app_host.py's `adopt`): at the server's start, once
                       each (the host's events keep it)
"""

import json
import os
import threading
import time
from typing import Optional, Tuple

from app_kit import AppError, Instance

from . import naming, sessions

NAME_WAIT = 600.0           # how long a new actor's first call is waited for, to name it (its gatherer has it then)


def role(app: str, key: str) -> str:
    return json.dumps({"app": app, "key": key})


def role_of(s: dict) -> Optional[Tuple[str, str]]:
    """(app, instance id) of an app's actor: its role {"app": name, "key": id}, or {"<name>": key} (an app's actor
    from before it was an app, kept so: the host adopts it, app_host.py's `adopt`); None for any other session."""
    try:
        got = json.loads(s.get("role") or "null")
    except (TypeError, ValueError):
        return None
    if not isinstance(got, dict):
        return None
    if isinstance(got.get("app"), str) and isinstance(got.get("key"), str):
        return got["app"], got["key"]
    if len(got) == 1:
        (name, key), = got.items()
        if isinstance(key, str):
            return name, key
    return None


def adopt_all(started: "sessions.Sessions", host) -> None:
    """Each app's actor from before it was an app attached to its instance (module doc)."""
    if host is None:
        return
    for s in started.list():
        got = role_of(s)
        if got is None or got[0] not in host.apps:
            continue
        name, key = got
        try:
            host.adopt(name, s["gatherer"], key, s.get("cwd") or None, s["session_id"])
        except Exception:  # noqa: BLE001 - one actor's trouble is not the others'
            pass


def start(started: "sessions.Sessions", host, app: str, gatherer: str, cwd: str, harness: str,
          model: Optional[str] = None, name: Optional[str] = None) -> Tuple[dict, Instance]:
    """A new instance of `app` and a new actor working with it (module doc)."""
    m = host.hosted(app).manifest
    if not m.agent.start:
        raise AppError(f"{m.label} starts no agent of its own: open it, and attach an actor to it")
    cwd = os.path.realpath(os.path.abspath(os.path.expanduser((cwd or "").strip() or ".")))
    if not os.path.isdir(cwd):
        raise AppError(f"no directory {cwd}")
    inst = host.open(app, gatherer, cwd, {}, by="user")
    try:
        s = started.create(gatherer, cwd, "auto", harness, model, role=role(app, inst.id))
    except sessions.SessionError as exc:
        host.close_instance(gatherer, inst.id)
        raise AppError(str(exc)) from None
    host.attach(gatherer, inst.id, s["session_id"])
    said = name or m.agent.name.format(app=m.label, folder=os.path.basename(cwd.rstrip("/")) or cwd)
    threading.Thread(target=_name, args=(started, gatherer, s["session_id"], said), name=f"ag-{app}-name",
                     daemon=True).start()
    return s, inst


def _name(started: "sessions.Sessions", gatherer: str, sid: str, said: str) -> None:
    """The new actor named `said` once its gatherer has it (its first call): a name is an event there (naming.py) --
    else the list shows it by its first message, which an app's page may have written."""
    end = time.time() + NAME_WAIT

    def now() -> str:                                  # codex's: renamed to its thread
        row = next((r for r in started.list() if sid in (r["session_id"], r.get("started_as"))), None)
        return (row or {}).get("session_id") or sid
    while time.time() < end and not sessions._has_calls(gatherer, now()):
        time.sleep(2)
    try:
        naming.record(gatherer, now(), said)
    except naming.NamingError:
        pass
