"""Antigravity's launcher, AntigravityLauncher, for `ag antigravity ...`: Antigravity's CLI (agy) on its Gemini API
route, that API pointed at a hook server that calls the context manager (its setup, setup.py), for this run only:

    --settings '{"modelProvider": "gemini", ...}'     agy calls the Gemini API itself, not Google's Cloud Code API
    GOOGLE_GEMINI_BASE_URL  "http://127.0.0.1:<port>[/h/<gatherer>][/r/<run>]<path>"

The hook server relays to where agy would have gone: GOOGLE_GEMINI_BASE_URL as the environment has it, else
https://generativelanguage.googleapis.com. The key (GEMINI_API_KEY), the model and everything else stay as they were;
nothing is written to agy's settings.json (`--settings` is for the session only -- settings given with it are kept,
`modelProvider` set over them). Each agy conversation is a channel in the run's gatherer.

agy's title call names no conversation: the run (`/r/<run>`, this process's id, as agy is exec'd) says which it is
for. A conversation resumed by id (`--conversation <id>`) is claimed by ag (`Launch.session`); a new one is not.
"""

import json
import os
from typing import List, Optional, Tuple
from urllib.parse import urlsplit

from ag.cli.launch import Launch, Launcher, LaunchError, Run
from .hook_servers import HookServers

SETUP = "ag.integrations.harnesses.antigravity.setup.setup"     # agy's setup: the hook server with its hook
DEFAULT_API = "https://generativelanguage.googleapis.com"
BASE_URL, KEY = "GOOGLE_GEMINI_BASE_URL", "GEMINI_API_KEY"
PROVIDER = {"modelProvider": "gemini"}                          # agy's Gemini API route (its 1.1.13 changelog)


def session_args(args: List[str]) -> Tuple[List[str], Optional[str]]:
    """(agy's arguments, `modelProvider: "gemini"` set in its `--settings`, or added; the conversation they resume by
    id, else None). Raises LaunchError for settings that are not inline JSON, or that name another provider."""
    out, settings, session, i = [], {}, None, 0
    while i < len(args):
        a = args[i]
        if a == "--":
            out += args[i:]
            break
        name, _, value = a.partition("=") if a.startswith("--") else (a, "", "")
        if name in ("--settings", "--conversation") and not value and i + 1 < len(args):
            value, i = args[i + 1], i + 1
        if name == "--settings":
            try:                        # shortcut: inline JSON only, not agy's settings-file path; read the file if asked
                settings = json.loads(value)
            except ValueError:
                settings = None
            if not isinstance(settings, dict):
                raise LaunchError("ag takes agy's --settings as an inline JSON object")
            if settings.get("modelProvider", "gemini") != "gemini":
                raise LaunchError("ag hooks agy on its Gemini API route only (modelProvider \"gemini\")")
        elif name == "--conversation":
            session = value
            out += ["--conversation", value]
        else:
            out.append(a)
        i += 1
    return ["--settings", json.dumps({**settings, **PROVIDER}), *out], session


class AntigravityLauncher(Launcher):
    defaults = {"command": ["agy"], "port": 4213, "env": {}}

    def __init__(self, settings, home: str):
        super().__init__(settings, home)
        self.servers = HookServers(home)

    def launch(self, run: Run) -> Launch:
        """agy on its Gemini API route, GOOGLE_GEMINI_BASE_URL pointed at the hook server -- started if none with its
        upstream is running (not in a dry run)."""
        args, session = session_args(run.args)
        if not run.env.get(KEY) and not run.dry_run:
            raise LaunchError(f"agy's Gemini API route needs a key: set {KEY}")
        url = urlsplit(run.env.get(BASE_URL) or DEFAULT_API)
        origin, path = f"{url.scheme}://{url.netloc}", url.path.rstrip("/")
        options = {"adaptor": run.adaptor} if run.adaptor else {}
        if run.dry_run:
            found = self.servers.find(SETUP, origin, "", options)
            server_url = found.url if found else f"http://127.0.0.1:{int(self.settings['port'])}"
        else:
            if any(origin == s.url for s in self.servers.running()):
                raise LaunchError(f"{BASE_URL} already points at a hook server ag started ({origin})")
            try:
                server_url = self.servers.start(SETUP, origin, int(self.settings["port"]), "", options).url
            except RuntimeError as exc:
                raise LaunchError(str(exc)) from exc
        server_url += (f"/h/{run.gatherer}" if run.gatherer else "") + ("" if run.dry_run else f"/r/{os.getpid()}")
        return Launch([*run.command, *args], {**run.env, BASE_URL: server_url + path},
                      [f"{BASE_URL}={server_url + path} -> {origin}{path}"], session)
