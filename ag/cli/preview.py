"""`ag preview`: the preview of a git project -- the command the dashboard Editor's Execute button runs in the project,
and what it shows beside the file (a file the command writes, the page of a server it starts, or its output) -- asked of
the dashboard (ag_dashboard/preview.py), over its local API (POST /api/preview/<op>), as `ag actors` asks it.

    ag preview [show]                       the preview of the repository of this directory (or --repo D)
    ag preview set <command> [--show S]     set it: <command> run through the shell in the project's checkout (- reads
                                            it from stdin; none: S shown as it is); S a path in the checkout or a URL
                                            (the command a server: kept running, its page shown); none: its output.
                                            {file}, {stem}, {name}, {dir}: the file open in the Editor
    ag preview run [--file F] [--wait N]    run it now, in this directory's checkout, as the user has let it run;
                                            the pages showing its preview show the run. Waits N seconds (default 60)
                                            for it to end -- or its server to answer -- then says how it went
    ag preview stop                         the run stopped
    ag preview clear                        no preview for the repository any more

A preview an actor sets runs only once the user lets it: they are asked when they next press Execute. Who asks is the
session the command runs in, as for `ag actors`. `--json` prints the answer as JSON. Standard library only."""

import argparse
import json
import os
import sys
import time
from typing import List

from . import actors

WAIT = 60.0                 # seconds `run` waits, by default, for the run to end


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="ag preview", description="The preview of a git project: the command the dashboard "
                                 "Editor's Execute button runs, and what it shows beside the file.")
    ap.add_argument("--repo", help="a directory of the project (default: this one)")
    ap.add_argument("--as", dest="who", help="ask as this actor (its id), not the session the command runs in")
    ap.add_argument("--json", action="store_true", help="print the answer as JSON")
    sub = ap.add_subparsers(dest="op")
    sub.add_parser("show", help="the project's preview")
    s = sub.add_parser("set", help="set the project's preview")
    s.add_argument("command", nargs="*", help="run through the shell in the project's checkout (- reads it from stdin); "
                   "{file}, {stem}, {name}, {dir}: the file open in the Editor")
    s.add_argument("--show", default="", help="what it shows: a path in the checkout, or a URL (the command a server); "
                   "none: its output")
    r = sub.add_parser("run", help="run it now, as the user has let it run")
    r.add_argument("--file", help="the file {file} names (default: none)")
    r.add_argument("--wait", type=float, default=WAIT, help=f"seconds to wait for it to end (default {WAIT:g})")
    sub.add_parser("stop", help="stop its run")
    sub.add_parser("clear", help="no preview for the project any more")
    return ap


def main(argv: List[str]) -> int:
    opts = parser().parse_args(argv)
    op = opts.op or "show"
    try:
        url = actors.dashboard_url()
        if not url:
            raise actors.ActorsError("no dashboard runs on this home: the preview is the dashboard's (`ag dashboard`)")
        body = {"path": os.path.abspath(os.path.expanduser(opts.repo or ".")), "actor": actors.actor_id(given=opts.who) or ""}
        if op == "set":
            body["command"] = sys.stdin.read().strip() if opts.command == ["-"] else " ".join(opts.command)
            body["show"] = opts.show
        if op == "run":
            body["wait"] = max(0.0, opts.wait)
            if opts.file:
                body["file"] = os.path.abspath(os.path.expanduser(opts.file))
        got = actors.ask(url, op, body, api="preview")
    except actors.ActorsError as exc:
        print(f"ag preview: {exc}", file=sys.stderr)
        return 1
    if opts.json:
        print(json.dumps(got, indent=2))
    else:
        print(shown(op, got, body["actor"]))
    return 0


def _ago(at) -> str:
    s = max(0, int(time.time() - (at or 0)))
    return f"{s}s ago" if s < 90 else f"{s // 60} min ago" if s < 5400 else f"{s // 3600} h ago"


def _by(by: str, me: str) -> str:
    return "the user" if not by else "you" if by == me else "a shell, not an actor's" if by == "cli" else f"actor {by}"


def _run(r: dict) -> str:
    took = f" in {max(0.1, (r['ended'] or time.time()) - r['started']):.1f}s" if r.get("started") else ""
    state = r.get("state")
    said = {"done": f"done{took} (exit 0)", "failed": f"failed{took} (exit {r.get('code')})",
            "stopped": f"stopped{took}", "timed out": f"stopped: it ran too long{took}",
            "ready": "running, its page answering", "running": f"still running{took}"}.get(state, state)
    return said if r.get("command") else ("shown as it is" if state in ("done", "ready") else said)


def _shows(r: dict) -> str:
    s = r.get("shows") or {}
    if s.get("url"):
        return f"It shows {s['url']}" + (", which answers." if r.get("state") == "ready" else
                                         ", which does not answer yet." if r.get("state") == "running" else ".")
    if s.get("error"):
        return f"What it shows: {s['error']}."
    if s.get("path"):
        return f"It shows {s['path']}" + ("." if s.get("exists") else ", which it has not made.")
    return "It shows its output."


def shown(op: str, got: dict, me: str) -> str:
    p = got.get("preview")
    where = got["key"] + (f" (checkout {got['checkout']})" if got.get("checkout") != got.get("key") else "")
    if op == "clear":
        return f"The preview of {where} is cleared."
    if op == "stop":
        r = got.get("run")
        return f"Stopped: its run in {got['checkout']} is {_run(r)}." if r else f"Nothing runs in {got['checkout']}."
    if p is None:
        return (f"No preview is set for {where}. `ag preview set \"<command>\" --show <file or URL>` sets one: the Editor's "
                f"Execute button runs it and shows what it makes beside the file.")
    lines = []
    if op == "set":
        lines.append(f"Set the preview of {where}.")
    else:
        lines.append(f"The preview of {where}:")
    lines.append(f"  runs:   {p['command'] or '(nothing: what it shows, shown as it is)'}")
    lines.append(f"  shows:  {p['show'] or 'its output'}")
    lines.append(f"  set by {_by(p['set_by'], me)}, {_ago(p['set_at'])}")
    if p.get("needs_ok"):
        lines.append("The user has not let this command run yet: they are asked when they next press Execute in the "
                     "Editor. Until then, `ag preview run` does not run it.")
    r = got.get("run")
    if op == "run" and r:
        lines.append(f"Ran `{r['command']}` in {r['checkout']}: {_run(r)}." if r.get("command")
                     else f"Nothing to run. {_shows(r)}")
        if r.get("command"):
            lines.append(_shows(r))
        out = (got.get("output") or "").rstrip()
        if out:
            lines += ["The end of its output:" if len(out) >= 3990 else "Its output:", out]
        lines.append("The user sees the run in the Editor's preview, beside the file, if they have it open.")
    elif r:
        lines.append(f"Its latest run here, {_ago(r['started'])}: {_run(r)}.")
    return "\n".join(lines)
