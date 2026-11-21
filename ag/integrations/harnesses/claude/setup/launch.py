"""Claude Code's launcher, ClaudeLauncher, for `ag claude ...`: Claude Code, its Anthropic API pointed at a
hook server that calls the context manager (its setup, setup.py), for this run only:

    ANTHROPIC_BASE_URL = "http://127.0.0.1:<port>[/h/<gatherer>][/l/<limit>]<path>"

The hook server relays to where Claude Code would have gone: the `upstream` setting, else
ANTHROPIC_BASE_URL as the environment has it, else https://api.anthropic.com. Its key or login, its
headers, the model and everything else stay as they were; nothing is written to Claude Code's settings.
Each Claude Code session is a channel in the run's gatherer.

When the upstream is Anthropic's own API, ag also sets ENABLE_TOOL_SEARCH=true (unless the environment
sets it): Claude Code turns tool search off for a base URL that is not a first-party host, and then
sends every tool in full on every call, which breaks the cache. And it sets
CLAUDE_CODE_GATEWAY_HINT_HEADERS=true (unless the environment sets it): Claude Code says what each call
is (`X-Claude-Code-Request-Class`: main, subagent, auxiliary, ...) only to a first-party host unless
asked, and the context manager tells the session's turns from Claude Code's side calls by it.

`system_messages` ("keep" or "user") forces how the hook sends system messages back for every request;
unset, the hook chooses by each request's model. `trace_root` traces every model call there (the
request as the model got it, and its answer), each under its Claude Code session; `log_dir` keeps the
requests the hook changed, before and after.

Claude Code keeps its own automatic compaction; the run states where it compacts (`/l/<limit>`),
for the context manager to keep under (`harness_limit`): its auto-compact window less the
auto-compact buffer it keeps, as Claude Code itself reports them -- `/context` in print mode, a
local command that calls no model, run with the run's model and auto-compact flags and
environment (`probe`; about 0.3 s). When that cannot be asked, Claude Code's documented rules stand in
(`documented`): the model (`--model`, else ANTHROPIC_MODEL, else settings.json `model` in
$CLAUDE_CONFIG_DIR or ~/.claude) has CLAUDE_CODE_MAX_CONTEXT_TOKENS, else 1M for a `[1m]` model
or a native 1M one (unless CLAUDE_CODE_DISABLE_1M_CONTEXT), else 200K; an auto-compact window
set and smaller replaces it (CLAUDE_CODE_AUTO_COMPACT_WINDOW, `--autocompact`, the settings'
`modelSettings.<model>.autoCompactWindow`, `autoCompactWindow`, first found); less BUFFER.
CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, which `/context` does not show, lowers it further. A model
switched to inside the session is not followed.

The run's session is known to ag (`Launch.session`), which claims it, so no other process -- a
terminal, the dashboard's chat -- runs it at once: `--session-id <id>`, `--resume <id>`, and
`--continue`, which ag turns into `--resume` with the newest session of the directory, as Claude
Code would pick it (`session_args`). `--resume` with no id (Claude Code's picker) is refused: ag
could not tell which session it opens. `--fork-session` opens a new one, claimed on its first call.

Claude Code's PermissionRequest hook is added for the run (`--settings`, beside the user's own hooks;
the `permission_hook` setting, on by default): each permission it asks in its terminal is POSTed to
the hook server as it is asked, which records it for the dashboard (proxy_hook.py's `reported`). A
`--settings` given already, as JSON or a file, gets the hook in it (`with_settings`).
"""

import http.server
import json
import os
import re
import subprocess
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

from ag.cli.launch import Launch, Launcher, LaunchError, Run
from harness_kit.base import HOOK_PATH
from harness_kit.claude import permission_hook_settings
from .hook_servers import HookServers, config_part

SETUP = "ag.integrations.harnesses.claude.setup.setup"     # Claude Code's setup: the hook server with its hook
DEFAULT_API = "https://api.anthropic.com"
FIRST_PARTY = ("api.anthropic.com",)                    # hosts Claude Code's tool search works with
SESSION_HEADER = "x-claude-code-session-id"             # the trace files each call under its session
HINT_HEADERS = "CLAUDE_CODE_GATEWAY_HINT_HEADERS"       # what has Claude Code say what each call is, to any host
WINDOW, WINDOW_1M = 200_000, 1_000_000                  # Claude Code's windows: the default, and extended
BUFFER = 33_000                                         # the auto-compact buffer Claude Code keeps below its window
NATIVE_1M = re.compile(r"fable|sonnet-(?:[5-9]|\d{2,})|haiku-(?:5-5|[6-9]|\d{2,})|opus-(?:4-(?:[7-9]|\d{2,})|[5-9]|\d{2,})"
                       r"|^(?:opus|sonnet|haiku|fable)$")    # the aliases name the newest, native 1M


def upstream_of(settings: Dict[str, Any], env: Dict[str, str]):
    """(origin, path) of where Claude Code's requests go without ag."""
    url = str(settings.get("upstream") or env.get("ANTHROPIC_BASE_URL") or DEFAULT_API)
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise LaunchError(f"Claude Code's API is at {url}, which ag cannot relay to")
    return f"{parts.scheme}://{parts.netloc}", parts.path.rstrip("/")


def base_url(server_url: str, gatherer: Optional[str], path: str, limit: Optional[int] = None,
             config: Optional[str] = None, run: Optional[str] = None) -> str:
    """The hook server's URL for Claude Code: its gatherer, its run (the process it runs in: ag execs it), its config
    folder when one is set (where the hook finds its record of each session), its limit."""
    return (server_url + (f"/h/{gatherer}" if gatherer else "") + (f"/r/{run}" if run else "")
            + (config_part(config) if config else "") + (f"/l/{limit}" if limit else "") + path)


def tokens(value: Any, thousands: bool = False) -> Optional[int]:
    """A token count as Claude Code takes one: a number, or "200k", "1M"; with `thousands`
    (a flag's or a command's value), a bare 100-1000 is thousands. None if it is none."""
    text = str(value).strip().lower() if value is not None else ""
    match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)\s*([km]?)", text)
    if not match:
        return None
    n = float(match.group(1)) * {"": 1, "k": 1_000, "m": 1_000_000}[match.group(2)]
    if thousands and not match.group(2) and 100 <= n <= 1000:
        n *= 1000
    return int(n) or None


def flag(args: List[str], name: str) -> Optional[str]:
    """The value of `--name v` or `--name=v` in the arguments, the last one given."""
    found = None
    for i, a in enumerate(args):
        if a == "--":
            break
        if a == name and i + 1 < len(args):
            found = args[i + 1]
        elif a.startswith(name + "="):
            found = a[len(name) + 1:]
    return found


SESSION_ID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def projects_dir(env: Dict[str, str], cwd: str) -> str:
    """Where Claude Code keeps the sessions of `cwd`: $CLAUDE_CONFIG_DIR (else ~/.claude)/projects/<cwd,
    each character but a letter or a digit made '-'>."""
    config = env.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
    return os.path.join(config, "projects", re.sub(r"[^A-Za-z0-9]", "-", cwd))


def newest_session(env: Dict[str, str], cwd: str) -> Optional[str]:
    """The session `--continue` would resume in `cwd`: the one written last there; None if none."""
    d = projects_dir(env, cwd)
    try:
        found = [(os.path.getmtime(os.path.join(d, f)), f[:-6]) for f in os.listdir(d)
                 if f.endswith(".jsonl") and SESSION_ID.fullmatch(f[:-6])]
    except OSError:
        return None
    return max(found)[1] if found else None


def session_args(args: List[str], env: Dict[str, str], cwd: str) -> Tuple[List[str], Optional[str]]:
    """(the arguments to run Claude Code with, the session they open: None for a new one with no id
    given). `--continue` becomes `--resume <the newest session>`. Raises LaunchError for `--resume`
    with no session id (the picker, or a search for one)."""
    out, session, forks, i = [], None, False, 0
    while i < len(args):
        a = args[i]
        if a == "--":
            out += args[i:]
            break
        name, value, given = a, None, False
        if a.startswith("--") and "=" in a:
            name, value, given = a.split("=", 1)[0], a.split("=", 1)[1], True
        if name in ("--resume", "-r"):
            if not given and i + 1 < len(args) and not args[i + 1].startswith("-"):
                value, i = args[i + 1], i + 1
            if not value or not SESSION_ID.fullmatch(value):
                raise LaunchError("--resume needs the session's id (`ag claude --resume <id>`): ag makes sure no "
                                  "other process -- another terminal, the dashboard's chat -- has the session open, "
                                  "and Claude Code's picker does not say which session it opens")
            session = value
            out += ["--resume", value]
        elif name in ("--continue", "-c") and not given:
            found = newest_session(env, cwd)
            if found is None:
                out.append(a)                      # none to continue: Claude Code says so
            else:
                session = found
                out += ["--resume", found]
        elif name == "--session-id":
            if not given and i + 1 < len(args):
                value, i = args[i + 1], i + 1
            session = value or None
            out += ["--session-id", value] if value else [a]
        else:
            forks = forks or a == "--fork-session"
            out.append(a)
        i += 1
    return out, None if forks else session


def _settings_of(value: str) -> Optional[Dict[str, Any]]:
    """A `--settings` value as Claude Code reads it -- JSON, or the path of a JSON file -- None if it can't be read."""
    text = value.strip()
    if not text.startswith("{"):
        try:
            with open(os.path.expanduser(text), encoding="utf-8") as fh:
                text = fh.read()
        except OSError:
            return None
    try:
        got = json.loads(text)
    except ValueError:
        return None
    return got if isinstance(got, dict) else None


def with_settings(args: List[str], extra: Dict[str, Any]) -> Tuple[List[str], Optional[str]]:
    """(`args` with `extra`'s hooks added -- to each `--settings` given before `--`, its value made JSON; else a
    `--settings` of their own, before `--`; a note when they could not be: a `--settings` that can't be read, kept as
    it is). Each hook event's list is added to, never replaced."""
    end = args.index("--") if "--" in args else len(args)
    places = [i for i in range(end) if args[i] == "--settings" and i + 1 < end or args[i].startswith("--settings=")]
    if not places:
        return [*args[:end], "--settings", json.dumps(extra), *args[end:]], None
    out = list(args)
    for i in places:
        given = out[i + 1] if out[i] == "--settings" else out[i].split("=", 1)[1]
        got = _settings_of(given)
        if got is None:
            return args, f"ag's hooks not added: --settings {given!r} can't be read"
        hooks = dict(got.get("hooks") or {}) if isinstance(got.get("hooks"), dict) else {}
        for event, entries in (extra.get("hooks") or {}).items():
            hooks[event] = [*(hooks.get(event) if isinstance(hooks.get(event), list) else []), *entries]
        merged = json.dumps({**got, "hooks": hooks})
        if out[i] == "--settings":
            out[i + 1] = merged
        else:
            out[i] = f"--settings={merged}"
    return out, None


def claude_settings(env: Dict[str, str]) -> Dict[str, Any]:
    """Claude Code's user settings.json, {} if there is none to read."""
    path = os.path.join(os.path.expanduser(env.get("CLAUDE_CONFIG_DIR") or "~/.claude"), "settings.json")
    try:
        with open(path, encoding="utf-8") as fh:
            found = json.load(fh)
    except (OSError, ValueError):
        return {}
    return found if isinstance(found, dict) else {}


CONTEXT_TOKENS = re.compile(r"\*\*Tokens:\*\*\s*[0-9.]+\s*[km]?\s*/\s*([0-9.]+\s*[km]?)", re.I)
CONTEXT_BUFFER = re.compile(r"^\|\s*Autocompact buffer\s*\|\s*([0-9.]+\s*[km]?)\s*\|", re.I | re.M)
DEAD_API = "http://127.0.0.1:9"       # where the probe's Claude Code would call the model when NoAPI cannot listen
PROBED_FLAGS = ("--model", "--autocompact", "--settings", "--setting-sources")
#: The probe's Claude Code sends nothing it does not need -- telemetry, error reports, update checks --
#: which it otherwise finishes sending, after printing its report, before it exits (about 0.75 s).
PROBE_ENV = {"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"}


class _NotFound(http.server.BaseHTTPRequestHandler):
    def answer(self) -> None:
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        body = b'{"type":"error","error":{"type":"not_found_error","message":"no API here: ag\'s /context probe"}}'
        self.send_response(404)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_HEAD = do_POST = answer

    def log_message(self, *args) -> None:
        pass


class NoAPI:
    """Where the probe's Claude Code calls the model: a local address answering every request at once
    with a 404, relaying nothing, so nothing is billed. `/context` asks the API to count its tokens
    (some sixty requests) before it reports; an address nothing listens on (DEAD_API) keeps it
    waiting about 1.3 s on them, an answer at once does not. `with NoAPI() as url:` -- DEAD_API when
    it cannot listen."""

    def __enter__(self) -> str:
        try:
            self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _NotFound)
        except OSError:
            self.server = None
            return DEAD_API
        self.server.daemon_threads = True
        # polled every 0.02 s, not 0.5: its shutdown, once the probe is done, waits for a poll
        threading.Thread(target=self.server.serve_forever, args=(0.02,), daemon=True).start()
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def __exit__(self, *exc) -> None:
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()


def context_of(text: str) -> Optional[Tuple[int, Optional[int]]]:
    """(the window, the auto-compact buffer or None when none is shown) from Claude Code's
    `/context` report; None if it is not one."""
    window = CONTEXT_TOKENS.search(text)
    if not window or not tokens(window.group(1).replace(" ", "")):
        return None
    buffer = CONTEXT_BUFFER.search(text)
    return tokens(window.group(1).replace(" ", "")), tokens(buffer.group(1).replace(" ", "")) if buffer else None


def probe(command: List[str], args: List[str], env: Dict[str, str]) -> Optional[Tuple[int, Optional[int]]]:
    """Ask Claude Code itself: `/context` in print mode, a local command that calls no model, with the
    run's model and auto-compact flags and its environment, its API pointed at an address that relays
    nothing (NoAPI), no traffic it does not need (PROBE_ENV) and its session not kept. (window, buffer)
    as `context_of`, or None."""
    given = [x for name in PROBED_FLAGS if flag(args, name) is not None for x in (name, flag(args, name))]
    try:
        with NoAPI() as api:
            done = subprocess.run([*command, "-p", "/context", "--no-session-persistence", "--strict-mcp-config",
                                   *given], env={**os.environ, **env, **PROBE_ENV, "ANTHROPIC_BASE_URL": api},
                                  capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    return context_of(done.stdout) if done.returncode == 0 else None


def documented(args: List[str], env: Dict[str, str], settings: Dict[str, Any]) -> Tuple[int, str]:
    """(the auto-compact window, how that was found) by Claude Code's documented rules, for when
    `/context` cannot be asked: the model's window, else the auto-compact window when one is set
    and smaller."""
    model = flag(args, "--model") or env.get("ANTHROPIC_MODEL") or settings.get("model")
    model = str(model).strip() if model else ""
    plain = model.lower().replace("[1m]", "")
    native = bool(plain and NATIVE_1M.search(plain)) and not env.get("CLAUDE_CODE_DISABLE_1M_CONTEXT")
    if tokens(env.get("CLAUDE_CODE_MAX_CONTEXT_TOKENS")):
        window, source = tokens(env["CLAUDE_CODE_MAX_CONTEXT_TOKENS"]), "CLAUDE_CODE_MAX_CONTEXT_TOKENS"
    elif "[1m]" in model.lower() or native:
        window, source = WINDOW_1M, f"{model}'s 1M window"
    else:
        window = WINDOW
        source = f"{model}'s 200K window" if model else "the 200K window (no model named)"
    per_model = ((settings.get("modelSettings") or {}).get(model) or {}).get("autoCompactWindow") if model else None
    for value, thousands, name in ((env.get("CLAUDE_CODE_AUTO_COMPACT_WINDOW"), False, "CLAUDE_CODE_AUTO_COMPACT_WINDOW"),
                                   (flag(args, "--autocompact"), True, "--autocompact"),
                                   (per_model, False, f"modelSettings.{model}.autoCompactWindow"),
                                   (settings.get("autoCompactWindow"), False, "autoCompactWindow")):
        if tokens(value, thousands):
            return min(tokens(value, thousands), window), f"{name} (window {window})"
    return window, source


def harness_limit(args: List[str], env: Dict[str, str], settings: Dict[str, Any],
                  asked: Optional[Callable[[], Optional[Tuple[int, Optional[int]]]]] = None) -> Tuple[int, str]:
    """(where Claude Code compacts by itself in this run, how that was found): its auto-compact
    window less its auto-compact buffer, both as `/context` reports them (`asked`, the probe),
    else by the documented rules less BUFFER; then CLAUDE_AUTOCOMPACT_PCT_OVERRIDE percent of the
    window, when lower (`/context` does not show it)."""
    found = asked() if asked else None
    if found:
        window, buffer = found
        source = f"Claude Code's /context: window {window}, auto-compact buffer " + \
            (f"{buffer}" if buffer else f"none shown, {BUFFER} assumed")
    else:
        window, source = documented(args, env, settings)
        buffer, source = None, f"{source}, less the {BUFFER} buffer (/context could not be asked)"
    at = window - (buffer or BUFFER)
    percent = tokens(env.get("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"))
    if percent and percent < 100 and window * percent // 100 < at:
        at, source = window * percent // 100, f"CLAUDE_AUTOCOMPACT_PCT_OVERRIDE={percent} of {window}; {source}"
    return at, source


class ClaudeLauncher(Launcher):
    defaults = {"command": ["claude"], "upstream": "", "port": 4113, "log_dir": "", "trace_root": "", "system_messages": "", "env": {},
                "permission_hook": True}

    def __init__(self, settings: Dict[str, Any], home: str):
        super().__init__(settings, home)
        self.servers = HookServers(home)

    def launch(self, run: Run) -> Launch:
        """Claude Code, ANTHROPIC_BASE_URL pointed at the hook server -- started if none with its upstream
        is running (not in a dry run)."""
        args, session = session_args(run.args, run.env, getattr(run, "cwd", None) or os.getcwd())   # before anything starts
        origin, path = upstream_of(self.settings, run.env)
        log_dir = os.path.expanduser(str(self.settings.get("log_dir") or ""))
        trace_root = os.path.expanduser(str(self.settings.get("trace_root") or ""))
        port = int(self.settings["port"])
        options = {"adaptor": run.adaptor} if run.adaptor else {}
        first_party = urlsplit(origin).hostname in FIRST_PARTY
        if self.settings.get("system_messages"):            # else the hook's own: by the request's model
            options["system_messages"] = str(self.settings["system_messages"])
        notes = [f"model trace: {trace_root}"] if trace_root else []
        server_url, runs = self.servers.serving(
            SETUP, origin, port, run.dry_run, f"Claude Code's API already points at a hook server ag started ({origin}); "
            f"run Claude Code through ag with its own API address", log_dir, options, trace_root=trace_root,
            thread_headers=(SESSION_HEADER,))
        if run.dry_run:
            notes.append(f"hook server: {server_url}{'' if runs else ' (not started: dry run)'} -> {origin}")
        command = list(run.command)
        limit, how = harness_limit(args, run.env, claude_settings(run.env),
                                   lambda: probe(command, args, run.env))
        config = run.env.get("CLAUDE_CONFIG_DIR") or os.environ.get("CLAUDE_CONFIG_DIR")
        folder = os.path.abspath(os.path.expanduser(config)) if config else None
        # its run, this process, which Claude Code is once ag execs it: a call it drops is the hook's to tell an Esc
        # from its process ending (its terminal closed), which keeps the message (the hook's `failed`)
        url = base_url(server_url, run.gatherer, path, limit, folder, None if run.dry_run else str(os.getpid()))
        notes.append(f"ANTHROPIC_BASE_URL={url} -> {origin}{path}")
        if self.settings.get("permission_hook", True) not in (False, "off", "false", 0):
            hook = base_url(server_url, run.gatherer, HOOK_PATH, None, folder)
            args, refused = with_settings(args, permission_hook_settings(hook))
            notes.append(refused or f"its permission prompts reported to {hook} (the permission_hook setting)")
        notes.append(f"Claude Code's own limit: {limit} tokens, {how}; the context manager keeps under it")
        if options.get("system_messages"):
            notes.append(f"system messages: {options['system_messages']} (the system_messages setting)")
        env = {**run.env, "ANTHROPIC_BASE_URL": url}
        if first_party and "ENABLE_TOOL_SEARCH" not in run.env:
            env["ENABLE_TOOL_SEARCH"] = "true"
            notes.append("ENABLE_TOOL_SEARCH=true (the hook server forwards to Anthropic's API)")
        if HINT_HEADERS not in run.env:
            env[HINT_HEADERS] = "true"
        return Launch([*run.command, *args], env, notes, session)

    def describe(self, env: Dict[str, str]) -> List[str]:
        try:
            origin, path = upstream_of(self.settings, env)
        except LaunchError as exc:
            return [f"API: {exc}"]
        return [f"API: {origin}{path}"]

    def status(self) -> List[str]:
        """The hook servers ag started for Claude Code, one line each."""
        return self.servers.status(SETUP)

    def stop(self) -> List[str]:
        """Stop the hook servers ag started for Claude Code."""
        return self.servers.stop_all(SETUP)

    def serving(self) -> List[str]:
        """The addresses of the hook servers ag started for Claude Code."""
        return [s.url for s in self.servers.of(SETUP)]
