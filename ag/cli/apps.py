"""`ag apps`: the apps of the gatherer an actor works in -- each one's tools, and a call of one -- asked of the
dashboard (ag_dashboard/tool_gateway.py), over its local API (POST /api/apps/agent...), as `ag actors` asks it. For an
agent whose harness the dashboard gives no MCP server; one it gives one (Claude Code, codex) has the same tools there.

    ag apps [list]                              the gatherer's apps: what each says of itself, its tools (with what
                                                each takes) and the ones you are attached to
    ag apps call <app>_<tool> [ARGS]            a tool called: ARGS its arguments, a JSON object (- reads it from
                                                stdin; none: {}); --instance I, which one, when attached to several

Who asks is the session the command runs in, as for `ag actors` (--as names another). `--json` prints the answer as
JSON. Standard library only."""

import argparse
import json
import sys
from typing import List

from . import actors


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="ag apps", description="The apps of this actor's gatherer: their tools, and a "
                                 "call of one.")
    ap.add_argument("--as", dest="who", help="ask as this actor (its id), not the session the command runs in")
    ap.add_argument("--json", action="store_true", help="print the answer as JSON")
    sub = ap.add_subparsers(dest="op")
    sub.add_parser("list", help="the gatherer's apps and their tools")
    c = sub.add_parser("call", help="call an app's tool")
    c.add_argument("tool", help="<app>_<tool>, as `ag apps` lists it")
    c.add_argument("args", nargs="?", default="{}", help="its arguments, a JSON object (- reads it from stdin)")
    c.add_argument("--instance", help="which one, when you are attached to more than one")
    return ap


def main(argv: List[str]) -> int:
    opts = parser().parse_args(argv)
    op = opts.op or "list"
    try:
        url = actors.dashboard_url()
        if not url:
            raise actors.ActorsError("no dashboard runs on this home: the apps are the dashboard's (`ag dashboard`)")
        actor = actors.actor_id(given=opts.who)
        if not actor:
            raise actors.ActorsError("not run by an actor: say which with --as <id>")
        if op == "call":
            raw = sys.stdin.read() if opts.args == "-" else opts.args
            try:
                args = json.loads(raw or "{}")
            except ValueError as exc:
                raise actors.ActorsError(f"its arguments are not JSON: {exc}") from None
            if not isinstance(args, dict):
                raise actors.ActorsError("its arguments are a JSON object")
            if opts.instance:
                args["instance"] = opts.instance
            got = actors.ask(url, "agent/call", {"actor": actor, "tool": opts.tool, "args": args}, api="apps")
        else:
            got = actors.ask(url, "agent", {"actor": actor}, api="apps")
    except actors.ActorsError as exc:
        print(f"ag apps: {exc}", file=sys.stderr)
        return 1
    if opts.json:
        print(json.dumps(got, indent=2))
    elif op == "call":
        print(said(got))
    else:
        print(listed(got))
    return 1 if op == "call" and got.get("isError") else 0


def said(result: dict) -> str:
    """A tool's result as text: its text parts, and a line for each picture or other part."""
    out = []
    for part in result.get("content") or []:
        if part.get("type") == "text":
            out.append(part.get("text", ""))
        else:
            out.append(f"[{part.get('type')}{': ' + part['mimeType'] if part.get('mimeType') else ''}]")
    return "\n".join(out) or ("(an error, with no words)" if result.get("isError") else "(done)")


def listed(got: dict) -> str:
    if not got.get("apps"):
        return f"No app is on in gatherer {got.get('gatherer')}."
    out = [got.get("instructions", "").strip(), ""]
    for a in got["apps"]:
        mine = ", ".join(f"{i['id']} ({i.get('title') or i.get('folder') or i['id']})" for i in a.get("attached") or [])
        out.append(f"{a['label']} ({a['name']})" + (f" -- attached: {mine}" if mine else ""))
        for t in a.get("tools") or []:
            props = (t.get("inputSchema") or {}).get("properties") or {}
            need = set((t.get("inputSchema") or {}).get("required") or [])
            args = ", ".join(f"{k}{'' if k in need else '?'}" for k in props if k != "instance")
            out.append(f"  {t['name']}({args}): {t.get('description', '')}")
        out.append("")
    return "\n".join(out).rstrip()
