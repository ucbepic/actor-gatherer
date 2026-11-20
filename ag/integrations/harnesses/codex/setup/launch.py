"""codex's launcher, CodexLauncher, for `ag codex ...`: codex, its model provider pointed at a hook server that
calls the context manager (its setup, setup.py), for this run only. ag finds the provider codex would use
and where it points, and overrides the one setting codex takes that provider's base_url from:

    "http://127.0.0.1:<port>[/h/<gatherer>][/r/<run>][/a/<channel>][/l/<limit>]<path>"

<run> is the run's process id: ag runs codex in its own process (exec), so every call this codex
makes -- its thread's turns and its own side calls, a title for the thread or a recap, each in a
thread of its own that names no other -- says which run it came from (the hook's `request.run`). Not in
a dry run, whose process codex is not.

The hook server relays to the provider's own origin, so <path> -- and everything else about the
provider (its key, headers, wire API), the model, the codex home, its hooks and auth -- stays as it
was. Nothing is written to the codex home.

The provider, as codex resolves it: with `--oss`, `--local-provider`, then `oss_provider` (`-c`, the
profile's, codex's config.toml's); otherwise `-c model_provider=...` in the arguments, then ag's
[cli.harnesses.codex] provider, then the profile's (`-p`/`--profile`, or codex's `profile`), then
codex's `model_provider`, else "openai". Codex's config.toml is $CODEX_HOME/config.toml (CODEX_HOME
from the harness's `env`, the environment, or ~/.codex); a project's .codex/config.toml is not read.

Where it points, and the setting overridden, depends on the provider:

    a provider of your own   -c model_providers.<p>.base_url   the arguments' (taken out of them), else
                                                               [model_providers.<p>] base_url in config.toml
    openai (built in)        -c openai_base_url                 the arguments' (taken out), else config.toml's,
                                                               else codex's default for the login in auth.json:
                                                               ChatGPT's for a ChatGPT login, else the API's
    ollama, lmstudio         $CODEX_OSS_BASE_URL                the environment's, else localhost on
             (built in)                                        $CODEX_OSS_PORT or the provider's own port

ag refuses a provider it cannot relay at all -- amazon-bedrock, whose requests are signed over their
host and body -- or one with no base_url.

Codex's own automatic compaction is switched off for the run (`-c model_auto_compact_token_limit=<NO_COMPACTION>`):
condensing the history is the context manager's job, and each codex compaction re-sends the user
messages it keeps under new ids, which the context manager stores again. A limit set in the
arguments, the profile or config.toml stays, with a note. A manual /compact still works.

Codex compacts anyway once a context passes 90% of its model's window, whatever the limit
says (codex caps the limit there), so the run states that as its own limit (`/l/<limit>`),
for the context manager to keep under: 90% of the window `model_context_window` sets (`-c`,
the profile's, config.toml's), else of the model's in codex's catalog (`codex debug
models`), else of the window codex gives a model it does not know (FALLBACK_WINDOW); a
limit set in the arguments, the profile or config.toml, when lower. A window that is set is
capped as codex caps it: at the catalog's max_context_window for the model -- at FALLBACK_WINDOW
for a model the catalog does not have, whatever the setting says, until a `model_catalog_json`
file gives codex an entry for it (that file is the catalog `codex debug models` then lists). The
model is `-m`/`--model`, else `-c model=`, the profile's, config.toml's.

Codex is run without its shared background server (`--no-daemon`, where its version has it): ag's
`-c` overrides need it to run embedded anyway, and with the server running, codex otherwise starts
every session with a warning that it does not use it. Not added when the arguments have it.

A run that resumes a thread by its id -- `resume <id>`, interactive or `exec ... resume <id>` -- has it
known to ag (`Launch.session`), which claims it, so no other process -- a terminal, the dashboard's
chat -- runs it at once. A new thread's id is codex's to choose, and is not known until its first call:
a run given a channel for it (`ag --channel <id>`, as the dashboard starts its actors) has that channel
claimed, the thread kept there; any other new thread is not claimed. `resume --last` and the picker do
not say which thread they open: neither is claimed.
"""

import json
import os
import re
import subprocess
import tempfile
import tomllib
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

from ag.cli.launch import Launch, Launcher, LaunchError, Run
from .hook_servers import HookServers, config_part

SETUP = "ag.integrations.harnesses.codex.setup.setup"      # codex's setup: the hook server with codex's hook
OSS_URL = "CODEX_OSS_BASE_URL"
COMPACT_LIMIT = "model_auto_compact_token_limit"        # the context size at which codex compacts by itself
NO_COMPACTION = 10 ** 15                                # a limit no context reaches: codex never compacts by itself
FALLBACK_WINDOW = 272_000                               # the window codex gives a model it does not know
NO_DAEMON = "--no-daemon"                               # codex without its shared background server
WINDOW_SHARE = 0.9                                      # codex compacts past this share of the window, whatever the limit


def _chatgpt_login(codex_home: str) -> bool:
    """Whether codex is logged in with ChatGPT (not an API key), as its auth.json says."""
    try:
        with open(os.path.join(codex_home, "auth.json"), encoding="utf-8") as fh:
            auth = json.load(fh)
    except (OSError, ValueError):
        return False
    mode = str(auth.get("auth_mode") or "").lower()
    if mode:
        return mode.startswith("chatgpt")
    return bool(auth.get("tokens")) and not auth.get("OPENAI_API_KEY")


def _oss_default(port: int) -> Callable[[str, Dict[str, str]], str]:
    def default(codex_home: str, env: Dict[str, str]) -> str:
        return f"http://localhost:{(env.get('CODEX_OSS_PORT') or '').strip() or port}/v1"
    return default


@dataclass(frozen=True)
class Builtin:
    """One of codex's built-in providers: the setting its base_url comes
    from -- a config key, or `$VAR` for an environment variable -- and its
    base_url when that is unset (given the codex home and the environment)."""
    setting: str
    default: Callable[[str, Dict[str, str]], str]


BUILTINS = {
    "openai": Builtin("openai_base_url", lambda home, env: "https://chatgpt.com/backend-api/codex"
                      if _chatgpt_login(home) else "https://api.openai.com/v1"),
    "ollama": Builtin("$" + OSS_URL, _oss_default(11434)),
    "lmstudio": Builtin("$" + OSS_URL, _oss_default(1234)),
}
UNRELAYABLE = {
    "amazon-bedrock": "signs each request (AWS SigV4) over its host and body, which a relay and a rewritten "
                      "context both break",
}


@dataclass
class Plan:
    provider: str
    upstream: str                   # the provider's origin: where the hook server relays
    path: str                       # the provider's base_url path, e.g. /v1
    args: List[str]                 # codex's arguments, the provider's base_url override taken out
    codex_home: str
    notes: List[str] = field(default_factory=list)
    compaction_off: bool = True     # add the limit that switches codex's own automatic compaction off
    model: Optional[str] = None     # the model, as the arguments or the config name it (None: codex's default)
    window: Optional[int] = None    # model_context_window, when set
    own_limit: Optional[int] = None  # model_auto_compact_token_limit, when set
    limit: Optional[int] = None     # where codex compacts by itself (`harness_limit`), stated in the base URL
    session: Optional[str] = None   # the thread the run resumes (`resume <id>`), claimed by ag; None: a new one
    run: Optional[str] = None       # the run's id (its process's), stated in the base URL; None: not stated
    actor: Optional[str] = None     # the channel its own thread is kept in (`ag --channel`), stated in the base URL
    daemonless: bool = False        # run without codex's shared background server (`--no-daemon`)
    home_set: bool = False          # CODEX_HOME set for the run: stated in the base URL, where the hook finds rollouts

    @property
    def setting(self) -> str:
        """The setting codex takes the provider's base_url from: a config key, or `$VAR`."""
        builtin = BUILTINS.get(self.provider)
        return builtin.setting if builtin else f"model_providers.{self.provider}.base_url"

    def base_url(self, server_url: str, gatherer: Optional[str]) -> str:
        return (server_url + (f"/h/{gatherer}" if gatherer else "") + (f"/r/{self.run}" if self.run else "")
                + (f"/a/{self.actor}" if self.actor else "")
                + (config_part(self.codex_home) if self.home_set else "") + (f"/l/{self.limit}" if self.limit else "")
                + self.path)

    def argv(self, command: List[str], server_url: str, gatherer: Optional[str]) -> List[str]:
        added = [NO_DAEMON] if self.daemonless and NO_DAEMON not in self.args else []   # before any subcommand
        added += ["-c", f"{COMPACT_LIMIT}={NO_COMPACTION}"] if self.compaction_off else []
        if not self.setting.startswith("$"):
            added += ["-c", f'{self.setting}="{self.base_url(server_url, gatherer)}"']
        return [*command, *added, *self.args]

    def env(self, env: Dict[str, str], server_url: str, gatherer: Optional[str]) -> Dict[str, str]:
        if not self.setting.startswith("$"):
            return env
        return {**env, self.setting[1:]: self.base_url(server_url, gatherer)}


def _value(raw: str) -> Any:
    """A `-c key=value` value as codex reads it: TOML, else the string itself."""
    try:
        return tomllib.loads(f"v = {raw}")["v"]
    except tomllib.TOMLDecodeError:
        return raw


THREAD_ID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


@dataclass
class Scan:
    overrides: Dict[str, Tuple[int, Any]]   # each `-c` key -> (index of its value, value)
    profile: Optional[str] = None
    oss: bool = False
    local_provider: Optional[str] = None
    model: Optional[str] = None
    session: Optional[str] = None           # the thread `resume <id>` opens (interactive or exec's)


def scan(args: List[str]) -> Scan:
    """The `-c` overrides in codex's arguments, the profile, whether --oss is
    given, the --local-provider and the thread a `resume <id>` opens."""
    found = Scan({})
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--":
            break
        raw, at = None, None
        if a in ("-c", "--config") and i + 1 < len(args):
            raw, at = args[i + 1], i + 1
            i += 1
        elif a.startswith("--config="):
            raw, at = a[len("--config="):], i
        elif a in ("-p", "--profile") and i + 1 < len(args):
            found.profile = args[i + 1]
            i += 1
        elif a.startswith("--profile="):
            found.profile = a[len("--profile="):]
        elif a == "--local-provider" and i + 1 < len(args):
            found.local_provider = args[i + 1]
            i += 1
        elif a.startswith("--local-provider="):
            found.local_provider = a[len("--local-provider="):]
        elif a in ("-m", "--model") and i + 1 < len(args):
            found.model = args[i + 1]
            i += 1
        elif a.startswith("--model="):
            found.model = a[len("--model="):]
        elif a == "--oss":
            found.oss = True
        elif a == "resume" and i + 1 < len(args) and THREAD_ID.fullmatch(args[i + 1]):
            found.session = args[i + 1]
            i += 1
        if raw is not None and "=" in raw:
            key, _, value = raw.partition("=")
            found.overrides[key.strip()] = (at, _value(value.strip()))
        i += 1
    return found


def _drop(args: List[str], at: int) -> List[str]:
    """The arguments without the override whose value is at `at`."""
    if args[at].startswith("--config="):
        return args[:at] + args[at + 1:]
    return args[:at - 1] + args[at + 1:]


def plan(args: List[str], settings: Dict[str, Any], env: Dict[str, str]) -> Plan:
    """Where codex's provider points, and codex's arguments for ag."""
    codex_home = os.path.abspath(os.path.expanduser(env.get("CODEX_HOME") or "~/.codex"))
    cfg: Dict[str, Any] = {}
    cfg_path = os.path.join(codex_home, "config.toml")
    if os.path.exists(cfg_path):
        with open(cfg_path, "rb") as fh:
            try:
                cfg = tomllib.load(fh)
            except tomllib.TOMLDecodeError as exc:
                raise LaunchError(f"{cfg_path}: {exc}") from exc
    found = scan(args)
    overrides = found.overrides

    def given(key: str) -> Any:
        return (overrides.get(key) or (None, None))[1]

    profile = found.profile or given("profile") or cfg.get("profile")
    profile_cfg = (cfg.get("profiles") or {}).get(profile) or {} if profile else {}

    if found.oss:
        provider = (found.local_provider or given("oss_provider") or profile_cfg.get("oss_provider")
                    or cfg.get("oss_provider"))
        if not provider:
            raise LaunchError("--oss names no provider: pass --local-provider=ollama (or lmstudio), "
                              f"or set oss_provider in {cfg_path}")
    else:
        provider = (given("model_provider") or settings.get("provider")
                    or profile_cfg.get("model_provider") or cfg.get("model_provider") or "openai")
    provider = str(provider)
    if provider in UNRELAYABLE:
        raise LaunchError(f"codex's provider {provider!r} {UNRELAYABLE[provider]}: ag cannot put the context "
                          f"manager in its way")

    builtin = BUILTINS.get(provider)
    table: Dict[str, Any] = {}
    if builtin and builtin.setting.startswith("$"):
        base_url = env.get(builtin.setting[1:], "").strip()
        at = None
    elif builtin:
        base_url, at = cfg.get(builtin.setting), overrides.get(builtin.setting)
    else:
        table = dict((cfg.get("model_providers") or {}).get(provider) or {})
        whole = overrides.get(f"model_providers.{provider}")
        if whole and isinstance(whole[1], dict):
            table.update(whole[1])
        base_url, at = table.get("base_url"), overrides.get(f"model_providers.{provider}.base_url")
    if at:
        base_url = at[1]
        args = _drop(args, at[0])
    if builtin and not base_url:
        base_url = builtin.default(codex_home, env)

    if not base_url:
        if not table:
            raise LaunchError(f"codex's provider {provider!r} is not defined in {cfg_path} "
                             f"(or in the arguments); set [cli.harnesses.codex] provider in config.toml if codex is started "
                             f"by a wrapper that names it")
        raise LaunchError(f"codex's provider {provider!r} has no base_url in {cfg_path}")

    parts = urlsplit(str(base_url))
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise LaunchError(f"codex's provider {provider!r} has a base_url ag cannot relay to: {base_url}")
    notes = []
    if table.get("wire_api", "responses") != "responses":
        notes.append(f"provider {provider!r} speaks wire_api={table['wire_api']!r}; only Responses API calls "
                     f"(/responses) get the context manager, the rest pass through unchanged")
    if parts.query:
        notes.append(f"the query string of {base_url} is dropped")
    limit = given(COMPACT_LIMIT) or profile_cfg.get(COMPACT_LIMIT) or cfg.get(COMPACT_LIMIT)
    if limit:
        notes.append(f"codex's own compaction stays on ({COMPACT_LIMIT}={limit} is set): it works against "
                     f"the context manager's")
    model = found.model or given("model") or profile_cfg.get("model") or cfg.get("model")
    window = given("model_context_window") or profile_cfg.get("model_context_window") or cfg.get("model_context_window")
    return Plan(provider, f"{parts.scheme}://{parts.netloc}", parts.path.rstrip("/"), args, codex_home, notes,
                compaction_off=not limit, model=str(model) if model else None,
                window=window if isinstance(window, int) and window > 0 else None,
                own_limit=limit if isinstance(limit, int) and limit > 0 else None, session=found.session)


def takes(command: List[str], env: Dict[str, str], option: str) -> bool:
    """Whether codex has `option` (its `--help` names it): False when it can't be asked. Asked with a codex
    home of its own, thrown away after: codex writes to its home even for `--help`."""
    try:
        with tempfile.TemporaryDirectory() as home:
            done = subprocess.run([*command, "--help"], env={**env, "CODEX_HOME": home}, capture_output=True, text=True,
                                  timeout=10, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return False
    return done.returncode == 0 and re.search(rf"(?<![\w-]){re.escape(option)}(?![\w-])", done.stdout) is not None


def catalog(command: List[str], env: Dict[str, str]) -> Dict[str, dict]:
    """Codex's model catalog by slug (`codex debug models`: its refreshed catalog, else the
    one it ships); {} when codex gives none."""
    for extra in ([], ["--bundled"]):
        try:
            done = subprocess.run([*command, "debug", "models", *extra], env=env, capture_output=True, text=True,
                                  timeout=30, stdin=subprocess.DEVNULL)
            models = json.loads(done.stdout).get("models") if done.returncode == 0 else None
        except (OSError, subprocess.SubprocessError, ValueError, AttributeError):
            models = None
        if isinstance(models, list):
            return {m["slug"]: m for m in models if isinstance(m, dict) and m.get("slug")}
    return {}


def harness_limit(p: Plan, models: Callable[[], Dict[str, dict]]) -> Tuple[int, str]:
    """(where codex compacts by itself in this run, how that was found): WINDOW_SHARE of
    the model's window -- model_context_window, capped at the catalog's max_context_window
    (at FALLBACK_WINDOW for a model the catalog does not have), else the catalog's
    context_window, else FALLBACK_WINDOW -- or the run's own limit when lower. `models` is
    asked only when the run names a model; when it lists nothing (codex could not be asked),
    a window that is set is taken as it is."""
    known = models() if p.model else {}
    entry = known.get(p.model or "", {})
    if p.window:
        top = entry.get("max_context_window") if entry else FALLBACK_WINDOW if known else None
        window = min(p.window, top) if isinstance(top, int) and top > 0 else p.window
        source = "model_context_window"
        if window < p.window:
            source = (f"model_context_window {p.window}, capped at {p.model}'s largest in codex's catalog" if entry else
                      f"model_context_window {p.window}, capped at codex's window for a model it does not know; "
                      f"a model_catalog_json entry for {p.model} gives it its own")
    elif isinstance(entry.get("context_window"), int) and entry["context_window"] > 0:
        window, source = entry["context_window"], f"{p.model}'s window in codex's catalog"
    else:
        window = FALLBACK_WINDOW
        source = f"codex's window for {'a model it does not know' if p.model else 'its default model'}"
    limit = int(window * WINDOW_SHARE)
    if p.own_limit and p.own_limit < limit:
        return p.own_limit, f"{COMPACT_LIMIT}={p.own_limit}"
    return limit, f"{int(WINDOW_SHARE * 100)}% of {window} ({source})"


class CodexLauncher(Launcher):
    defaults = {"command": ["codex"], "provider": "", "port": 4013, "log_dir": "", "env": {}}
    names_channel = True              # its thread's id is its own, known at its first call: /a/<channel>/
    environment = (("AG_CODEX_AG_ROLE", "developer", "`user`: send the Gatherer's messages to Codex as user "
                                                     "messages instead of developer messages."),)

    def __init__(self, settings: Dict[str, Any], home: str):
        super().__init__(settings, home)
        self.servers = HookServers(home)

    def launch(self, run: Run) -> Launch:
        """codex, its provider pointed at the hook server -- started if none
        with its upstream is running (not in a dry run)."""
        p = plan(run.args, self.settings, run.env)
        p.limit, how = harness_limit(p, lambda: catalog(list(run.command), {**os.environ, **run.env,
                                                                            "CODEX_HOME": p.codex_home}))
        log_dir = os.path.expanduser(str(self.settings.get("log_dir") or ""))
        port = int(self.settings["port"])
        options = {"adaptor": run.adaptor} if run.adaptor else {}                  # the hook builds it
        notes = list(p.notes)
        p.run = None if run.dry_run else str(os.getpid())                          # codex's, once exec'd
        p.actor = getattr(run, "channel", None)                                     # its thread's channel, chosen
        p.daemonless = takes(list(run.command), {**os.environ, **run.env}, NO_DAEMON)
        p.home_set = bool(run.env.get("CODEX_HOME") or os.environ.get("CODEX_HOME"))
        server_url, runs = self.servers.serving(
            SETUP, p.upstream, port, run.dry_run, f"codex's provider {p.provider!r} already points at a hook server ag "
            f"started ({p.upstream}); run codex through ag with its own provider", log_dir, options)
        if run.dry_run:
            notes.append(f"hook server: {server_url}{'' if runs else ' (not started: dry run)'} -> {p.upstream}")
        notes.append(f"codex provider {p.provider}: {p.base_url(server_url, run.gatherer)} -> {p.upstream}{p.path}")
        if p.compaction_off:
            notes.append(f"codex's own automatic compaction: off for the run ({COMPACT_LIMIT}={NO_COMPACTION})")
        notes.append(f"codex's own limit: {p.limit} tokens, {how}; the context manager keeps under it")
        return Launch(p.argv(run.command, server_url, run.gatherer), p.env(run.env, server_url, run.gatherer), notes,
                      p.session)

    def describe(self, env: Dict[str, str]) -> List[str]:
        try:
            p = plan([], self.settings, env)
        except LaunchError as exc:
            return [f"provider: {exc}"]
        return [f"provider: {p.provider} ({p.codex_home}) -> {p.upstream}{p.path}"]

    def status(self) -> List[str]:
        """The hook servers ag started for codex, one line each."""
        return self.servers.status(SETUP)

    def stop(self) -> List[str]:
        """Stop the hook servers ag started for codex."""
        return self.servers.stop_all(SETUP)

    def serving(self) -> List[str]:
        """The addresses of the hook servers ag started for codex."""
        return [s.url for s in self.servers.of(SETUP)]
