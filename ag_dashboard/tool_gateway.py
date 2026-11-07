"""The tool gateway (app_kit/DESIGN.md step 3): the apps' tools for every agent, through one MCP server each --
/mcp/<actor>, given to every session at launch whose harness takes one (harness_kit's `mcp_args`: Claude Code, codex)
-- and the same calls through `ag apps` in the agent's shell, for any harness (ag/cli/apps.py).

    on(gatherer)                 the apps turned on for a gatherer: its gatherer.toml's `apps`, else every app found
    tools(gatherer)              their tools, as MCP lists them: `<app>_<tool>`, each with the host's `instance` argument
    instructions(gatherer)       what agents are told of them: the MCP server's `instructions` (Claude Code adds them to
                                 its system prompt), and `ag apps`'s list
    call(actor, name, args)      a tool called by an actor: to the instance it is attached to -- the one it names
                                 (`instance`) when it has several; none, one opened for its gatherer and folder, and it
                                 attached -- then as the host calls any (app_host.py's `call`)
    launch_args(session)         what a session's harness is started with for them: the MCP server, where its harness
                                 takes one (`served`); else (Antigravity) instructions naming `ag apps`; none if no app
                                 is on

`HOST` (the AppHost) and `ORIGIN` (where the dashboard serves) are the server's, set as it starts."""

import os
import tomllib
from typing import List, Optional, Tuple

import app_kit
import harness_kit
from app_kit import AppError, Caller, Instance

from . import home, mcp

NAME = "ag-apps"                # the MCP server's name: harnesses show its tools as mcp__ag-apps__<app>_<tool>
HOST = None                     # the server's AppHost (server.py)
ORIGIN = ""                     # where the dashboard serves (server.py)
CLI = ("Run `ag apps` in your shell to list them and what each tool takes, and `ag apps call <app>_<tool> '<JSON "
       "arguments>'` to call one: it reaches the dashboard on this machine.")


def endpoint(actor: str) -> str:
    """The id of an actor's MCP server for the apps, as mcp.py's `listed` keeps it."""
    return mcp.endpoint("apps", actor)


def actor_of(s: dict) -> str:
    """The id an actor is known by: the one it was started under (a codex session's, before its thread had one)."""
    return s.get("started_as") or s["session_id"]


def on(gatherer: str) -> List["app_kit.Manifest"]:
    """The apps on for `gatherer`: those its gatherer.toml names in `apps`, found; without the key, every app found."""
    if HOST is None:
        return []
    named: Optional[list] = None
    try:
        with open(os.path.join(home.gatherer_dir(gatherer), "gatherer.toml"), "rb") as fh:
            named = tomllib.load(fh).get("apps")
    except (OSError, tomllib.TOMLDecodeError):
        named = None
    found = {n: h.manifest for n, h in HOST.apps.items()}
    if not isinstance(named, list):
        return [found[n] for n in sorted(found)]
    return [found[n] for n in named if isinstance(n, str) and n in found]


def tools(gatherer: str) -> List[dict]:
    """The tools of the apps on for `gatherer`, as MCP lists them."""
    return [t.mcp(m.name, m.label) for m in on(gatherer) for t in m.tools]


def instructions(gatherer: str, cli: bool = False) -> str:
    """What agents are told of the apps on for `gatherer`: each one's own words, under its name. `cli`: with how to
    reach them through `ag apps`, for a harness given no MCP server."""
    apps = on(gatherer)
    if not apps:
        return ""
    parts = ["The apps of this gatherer: tools you can call, each on an app the user may also have open beside your "
             "conversation. What you do in one, the user sees there; what the user does there, you are told as a "
             "message. Each app's tools are named <app>_<tool>." + (" " + CLI if cli else "")]
    for m in apps:
        about = (m.instructions or m.description).strip()
        parts.append(f"## {m.label} ({m.name})\n{about}" if about else f"## {m.label} ({m.name})")
    return "\n\n".join(parts)


def served(s: dict) -> bool:
    """Whether the session `s` is given the apps' MCP server at launch (`launch_args`)."""
    if HOST is None or not ORIGIN or not s.get("gatherer") or not on(s["gatherer"]):
        return False
    h = harness_kit.get(s.get("harness") or harness_kit.DEFAULT)
    return h is not None and h.mcp_args(NAME, f"{ORIGIN}/mcp/{actor_of(s)}") is not None


def launch_args(s: dict) -> List[str]:
    """What the session `s` (a row of sessions' table) is started with for the apps of its gatherer: an MCP server
    where its harness takes one (`mcp_args`), else instructions naming `ag apps` (`instruction_args`), where it takes
    those and has no instructions of its own (a gatherer agent's); [] when no app is on there, or neither is taken."""
    if HOST is None or not ORIGIN or not s.get("gatherer") or not on(s["gatherer"]):
        return []
    h = harness_kit.get(s.get("harness") or harness_kit.DEFAULT)
    if h is None:
        return []
    served = h.mcp_args(NAME, f"{ORIGIN}/mcp/{actor_of(s)}")
    if served is not None:
        return served
    if s.get("role"):
        return []
    return list(h.instruction_args(instructions(s["gatherer"], cli=True)) or [])


def row_of(rows: List[dict], actor: str) -> dict:
    """The session an actor's id names (its own, or the one it was started under), else AppError."""
    row = next((r for r in rows if actor and actor in (r["session_id"], r.get("started_as"))), None)
    if row is None:
        raise AppError(f"{actor or '(none)'}: not an actor this dashboard runs", 404)
    return row


def resolve(row: dict, name: str, args: dict) -> Tuple[str, str, Instance, dict]:
    """(app, tool, instance, the tool's own arguments) of a call by the actor of `row`: the app one on for its
    gatherer; the instance the one it names, or the one it is attached to -- none: one opened for its gatherer and
    folder, as the app's `instances` says, and the actor attached to it."""
    gatherer, channel = row["gatherer"], row["session_id"]
    apps = {m.name: m for m in on(gatherer)}
    split = app_kit.split_tool_name(name, apps)
    if split is None or apps[split[0]].tool(split[1]) is None:
        raise AppError(f"{name}: no such tool of this gatherer's apps ({', '.join(sorted(apps)) or 'none on'})", 404)
    app, tool = split
    args = dict(args or {})
    named = args.pop(app_kit.manifest.INSTANCE_ARG, None)
    mine = [i for i in HOST.attached_to(gatherer, channel) if i.app == app]
    if named:
        inst = next((i for i in mine if i.id == named), None)
        if inst is None:
            raise AppError(f"{named}: not a {apps[app].label} you are attached to "
                           f"({', '.join(i.id for i in mine) or 'none'})", 403)
    elif len(mine) == 1:
        inst = mine[0]
    elif mine:
        raise AppError(f"you are attached to {len(mine)} of {apps[app].label}: say which with `instance` "
                       f"({', '.join(f'{i.id} ({i.title or i.folder or i.id})' for i in mine)})")
    else:
        inst = HOST.open(app, gatherer, row.get("cwd") or None, {}, by=channel)
        HOST.attach(gatherer, inst.id, channel, by=channel)
    return app, tool, inst, args


def call(rows: List[dict], actor: str, name: str, args: dict) -> dict:
    """A tool called by an actor (its id): MCP's result, {content, isError} -- a refusal one too, for the agent to
    read."""
    try:
        row = row_of(rows, actor)
        app, tool, inst, own = resolve(row, name, args)
    except AppError as exc:
        return app_kit.ToolResult.error(str(exc)).to_dict()
    caller = Caller(channel=row["session_id"], gatherer=row["gatherer"], harness=row.get("harness"),
                    folder=row.get("cwd") or None)
    return HOST.call(app, inst, tool, own, caller).to_dict()


def listed(rows: List[dict], actor: str) -> dict:
    """What `ag apps` shows an actor: its gatherer's apps, each with its tools and instructions, and the instances it
    is attached to."""
    row = row_of(rows, actor)
    attached = {}
    for i in HOST.attached_to(row["gatherer"], row["session_id"]):
        attached.setdefault(i.app, []).append({"id": i.id, "title": i.title, "folder": i.folder})
    return {"gatherer": row["gatherer"], "instructions": instructions(row["gatherer"], cli=True),
            "apps": [{"name": m.name, "label": m.label, "tools": [t.mcp(m.name) for t in m.tools],
                      "attached": attached.get(m.name, [])} for m in on(row["gatherer"])]}
