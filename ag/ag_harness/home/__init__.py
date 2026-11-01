"""The context manager's home, `~/.ag` (AG_HOME moves it): every policy and
poller it knows, and each gatherer's choice of them.

    ~/.ag/config.toml               this home's settings: [policies] and [pollers] (read
                                    here: the catalog, the default policy, the LLM the
                                    policies call) and [cli] (ag's; ignored here)
    ~/.ag/plugins/                  your Python files, with your policies and pollers
    ~/.ag/gatherers/<name>/             one directory per gatherer:
        gatherer.toml                       its policy, that policy's options, its pollers
        context.db                      its database
    ~/.ag/logs/                     every log: gatherers/<name>/server.log (what each request
                                    came to), worker.log, the servers' output, llm/
    ~/.ag/hook_server/              ag's (the command line's): the hook servers it started

The CATALOG (`config.toml`, made on first use with the policies and pollers
this clone ships) names each policy and poller available:

    [policies]
    default = "proactive_context_manager"   the policy a new gatherer gets
    [policies.llm]                      the LLM the policies call: model ("provider/model"
                                        through LiteLLM, or claude-code/<model>, codex/<model>
                                        on that CLI's login), api_base, key_env, class;
                                        log_prompts (keep each call's system text and prompt)

    [policies.available.proactive_context_manager]   a policy: its class, "module:Class"
    class = "ag.ag_policies.proactive_context_manager:ProactiveContextManager"
    options = {}                        (ag.ag_policies' own, or any importable one; another
                                        entry naming the same class, with other options, is a variant)

    [policies.available.mine]           your own: a class (or factory) in plugins/, built with
    file = "mine.py"                    whichever of format=, llm=, options=, tokenizer=, jobs=
    class = "MyPolicy"                  it takes -- the harness knows no policy but by the catalog

    [pollers]
    default = ["file_changes"]          the pollers a new gatherer gets

    [pollers.available.file_changes]    a poller: its class, "module:Class" (or `file`/`module`
    class = "ag.ag_pollers.file_changes:FileChangePoller"   + `class`), built with `args`, where {cwd}
    args = { root = "{cwd}" }           (the request's working directory), {gatherer}, {home} are filled in

A GATHERER's `gatherer.toml` is made the first time the gatherer is seen,
from `[policies] default` and `[pollers] default`, and read from then on:

    policy = "proactive_context_manager"
    pollers = ["file_changes"]
    [options]                           this gatherer's overrides of the policy's options

Its pollers may be changed at any time (the file is re-read when it
changes). Policies and pollers know nothing of each other: any policy runs
with any pollers whose outputs are among its event types (ag checks that
before a run; the manager drops what a poller returns beyond its outputs).
Its policy may not change, once the gatherer has been read with another:
a different policy is a different contract and different tables in the
same database, so that is refused -- start a new gatherer.
"""

import importlib
import importlib.util
import inspect
import json
import os
import re
import sys
import threading
import tomllib
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from ag.ag_tools.notify import LISTENERS

from ..store import paths

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

TEMPLATE = '''# This home's settings, by who reads them:
#   [policies], [pollers]   the context manager: which policies and pollers are
#                           available, the policy a new gatherer gets, the LLM
#                           the policies call
#   [cli]                   ag, the command line: how it launches each harness
#                           (added by ag the first time it runs)
#   [dashboard]             ag dashboard: `chat = "headless"` sends a message to an
#                           actor with no terminal open to an agent with no screen
#                           (`claude -p`, `codex exec`); the default, "terminal",
#                           opens the actor's terminal with it. `browser = "<path>"`:
#                           the Chrome a Browser runs (else one installed is found);
#                           `browser_profile = "mine"`: Browsers run in your own Chrome,
#                           your logins and history (turn on its remote debugging at
#                           chrome://inspect/#remote-debugging), not a profile of ag's;
#                           `browser_video = false`: ag's own Chrome's screen shown as
#                           JPEG frames, not as video (sharper, quicker)
#
# The policies and pollers below are a CATALOG -- what is AVAILABLE, not what
# runs. What a gatherer runs is its own gatherers/<name>/gatherer.toml, made when
# the gatherer is first seen:
#   - its policy: `ag --gatherer NAME --policy P` (or `ag home new NAME
#     --policy P`), else [policies] default -- fixed once the gatherer has been
#     read with it;
#   - its pollers: `--poller X ...`, else [pollers] default -- edit
#     gatherer.toml to change them at any time.
# Policies and pollers are chosen apart and know nothing of each other: any
# pair runs so long as every event type the pollers output is one of the
# policy's (ag refuses a run otherwise).
# `ag home list` shows the catalog as it resolves; `ag home show NAME` a gatherer.

# ================================================================ policies

[policies]
default = "proactive_context_manager"   # the policy a new gatherer gets when none is named

# The LLM the policies call. `model` is a coding agent on its own login,
# claude-code/<model> or codex/<model>, or any other "provider/model" through LiteLLM,
# e.g. "gemini/gemini-3.8-flash". `api_base` and `key_env` are for LiteLLM only; without
# `key_env`, the key is the provider's own variable, e.g. GEMINI_API_KEY.
[policies.llm]
model = ""                              # required: no default (AG_LLM_MODEL)
# api_base = "http://127.0.0.1:4011/v1" # a LiteLLM proxy, or any OpenAI-compatible endpoint (AG_LLM_URL)
# key_env = "LITELLM_KEY"               # the variable holding the key (AG_LLM_KEY)

# ---------------------------------------------------------------- available policies
# Every policy a gatherer may run.

# Earlier history as sections, built in the background; file-change notices; the user's
# requests to the other channels, shown during a task.
[policies.available.proactive_context_manager]
class = "ag.ag_policies.proactive_context_manager:ProactiveContextManager"

# A variant: the same class, other options. Its budgets must add up to less than its
# max_context_tokens; the rest is headroom before the next build.
# [policies.available.pcm_small]
# class = "ag.ag_policies.proactive_context_manager:ProactiveContextManager"
# [policies.available.pcm_small.options]
# max_context_tokens = 100000
# all_task_tokens = 30000
# parallel_index_tokens = 15000
# keep_temporal_relevant_tokens = 7500
# keep_task_relevant_tokens = 7500
# keep_previous_task_tokens = 7500
# keep_so_far_tokens = 7500
# keep_pinned_tokens = 5000

# Your own: a Policy subclass (or a factory) in plugins/mine.py, built with whichever of
# format=, llm=, options= it takes.
# [policies.available.mine]
# file = "mine.py"
# class = "MyPolicy"
# options = {}

# ================================================================ pollers

[pollers]
default = ["file_changes"]              # the pollers a new gatherer gets, whatever its policy

# ---------------------------------------------------------------- available pollers
# Every poller a gatherer may list: where its events come from outside the conversation.

# Files changed under the agent's working directory, as environment_update events.
[pollers.available.file_changes]
class = "ag.ag_pollers.file_changes:FileChangePoller"
args = { root = "{cwd}" }

# Your own: a Poller in plugins/tickets.py, built with its args.
# [pollers.available.tickets]
# file = "tickets.py"
# class = "TicketPoller"
# args = { ticket = "4123", cwd = "{cwd}" }
'''


class ConfigError(ValueError):
    """A policy or poller that cannot be resolved or built, or a gatherer
    config that asks for something not allowed."""


@dataclass
class PolicySpec:
    name: str
    file: Optional[str] = None
    module: Optional[str] = None
    cls: Optional[str] = None
    options: Dict[str, Any] = field(default_factory=dict)

    @property
    def origin(self) -> str:
        return f"{self.file or self.module}:{self.cls}"


@dataclass
class PollerSpec:
    name: str
    file: Optional[str] = None
    module: Optional[str] = None
    cls: Optional[str] = None
    args: Dict[str, Any] = field(default_factory=dict)

    @property
    def origin(self) -> str:
        return f"{self.file or self.module}:{self.cls}"


@dataclass
class GathererConfig:
    name: str
    policy: str
    pollers: List[str]
    options: Dict[str, Any]
    path: str


# ---------------------------------------------------------------- writing TOML (the little we need)

def _value(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(_value(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{ " + ", ".join(f"{k} = {_value(x)}" for k, x in v.items()) + " }"
    raise ConfigError(f"cannot write {v!r} to TOML")


def gatherer_toml(cfg: GathererConfig) -> str:
    lines = [f"# The gatherer {cfg.name}: its policy (fixed once it has been read), and its",
             "# pollers (change them any time). Made from ~/.ag/config.toml.",
             f"policy = {_value(cfg.policy)}", f"pollers = {_value(cfg.pollers)}", "", "[options]",
             "# this gatherer's overrides of the policy's options"]
    lines += [f"{k} = {_value(v)}" for k, v in cfg.options.items()]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- the home

#: Models of a coding agent's CLI, run on its login: CLIClient's (ag/ag_tools/llm/cli_client.py).
CLI_MODELS = ("claude-code", "codex")
#: [policies.llm]'s own keys; any other is offered to the LLM's constructor.
LLM_KEYS = ("model", "api_base", "key_env", "url", "class", "file", "module", "log_prompts")
#: [policies.llm]'s settings, as the docs list them: (key, for which models, default, what it
#: does, the environment variable that overrides it).
LLM_SETTINGS = (
    ("model", "all", "none", "The model: claude-code/<model> or codex/<model> for a coding agent on its "
                             "own login, any other \"provider/model\" through LiteLLM. Without one, `ag` warns "
                             "at launch and every Gatherer call fails.", "AG_LLM_MODEL"),
    ("api_base", "LiteLLM", "the provider's", "Send every call to this server instead.", "AG_LLM_URL"),
    ("key_env", "LiteLLM", "the provider's variable", "The environment variable that holds the API key.",
     "AG_LLM_KEY (the key itself)"),
    ("claude_command", "claude-code", "\"claude\"", "The Claude Code executable, found on `PATH`.", ""),
    ("codex_command", "codex", "\"codex\"", "The Codex executable, found on `PATH`.", ""),
    ("log_prompts", "all", "false", "Keep each call's system text and prompt, whole, in `~/.ag/logs/llm/`. "
                                    "Usage, timing and the answer are always logged.", ""),
    ("class", "your own", "none", "An LLM implementation of your own, named like a policy's `class` (with "
                                  "`file` or `module` if needed), instead of the two above.", ""),
)
#: What the home holds, as the docs show it.
LAYOUT = """\
~/.ag/
├── config.toml                     every setting: policies, pollers, the LLM, harnesses
├── plugins/                        your own policies and pollers (Python files)
├── gatherers/<name>/               one directory per gatherer:
│   ├── gatherer.toml               its policy, its options and its pollers
│   └── context.db                  its database (SQLite): every event, and every context it sent
├── hook_server/<port>.json         the proxies ag started (Claude Code, Codex)
└── logs/
    ├── gatherers/<name>/server.log what each model call came to
    ├── gatherers/<name>/worker.log the gatherer's background builds
    ├── <harness>_server.log        each Gatherer server's own output
    ├── hook_servers/<port>.log     each proxy's output
    └── llm/                        one JSON file per LLM call the policies make"""

_HEADER = re.compile(r"^\s*\[\s*([^\]]+?)\s*\]\s*(#.*)?$")


def set_keys(lines: List[str], table: str, values: Dict[str, Optional[str]]) -> List[str]:
    """`lines` of a TOML file with keys of `[table]` set to strings (None: as it
    is; "": the key's line removed), touching nothing else: a key's line keeps
    its comment, a new key goes after the table's header (or its last key), and
    a missing table is added after its parent's keys, or at the end."""
    lines = list(lines)
    headers = [(i, m.group(1)) for i, l in enumerate(lines) for m in [_HEADER.match(l)] if m]
    start = next((i for i, name in headers if name == table), None)
    if start is None:
        if not any(v for v in values.values()):
            return lines
        parent = table.rsplit(".", 1)[0]
        at = next((i for i, name in headers if name == parent), None)
        if at is None:
            pos = len(lines)
        else:
            pos = next((i for i, _ in headers if i > at), len(lines))
            while pos > at + 1 and not lines[pos - 1].strip():
                pos -= 1
        lines[pos:pos] = ["", f"[{table}]"]
        start = pos + 1
    for key, value in values.items():
        if value is None:
            continue
        end = next((i for i, _ in _headers_after(lines, start)), len(lines))
        pattern = re.compile(rf"^(\s*{re.escape(key)}\s*=\s*)(\"(?:[^\"\\]|\\.)*\"|'[^']*'|[^#\s]*)(\s*#.*)?$")
        found = next((i for i in range(start + 1, end) if pattern.match(lines[i])), None)
        if value == "":
            if found is not None:
                del lines[found]
            continue
        quoted = json.dumps(value)
        if found is not None:
            m = pattern.match(lines[found])
            line, comment = m.group(1) + quoted, (m.group(3) or "").strip()
            if comment:                                          # the comment where it was, if it fits
                line += " " * max(1, m.start(3) + len(m.group(3)) - len(m.group(3).lstrip()) - len(line)) + comment
            lines[found] = line
        else:
            keys = [i for i in range(start + 1, end) if re.match(r"^\s*[A-Za-z0-9_-]+\s*=", lines[i])]
            lines.insert((keys[-1] if keys else start) + 1, f"{key} = {quoted}")
    return lines


def write_whole(path: str, text: str) -> None:
    """Write `path` so that a reader finds the old file or the new one, never part of it: another
    thread (the server's lanes) or process may be reading it as it is made."""
    tmp = f"{path}.{os.getpid()}.{threading.get_ident()}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)


def _headers_after(lines: List[str], start: int):
    return ((i, m.group(1)) for i in range(start + 1, len(lines)) for m in [_HEADER.match(lines[i])] if m)


class Home:
    """The registry and the gatherers under one home directory."""

    def __init__(self, root: Optional[str] = None):
        self.root = os.path.abspath(os.path.expanduser(root or paths.AG_HOME))
        self.config_path = os.path.join(self.root, "config.toml")
        self.plugins = os.path.join(self.root, "plugins")
        self._loaded: Tuple[float, dict] = (-1.0, {})
        self._modules: Dict[str, Any] = {}
        self._pollers: Dict[Tuple, List] = {}             # (gatherer, cwd, mtimes) -> the pollers built
        self._lock = threading.RLock()                    # the server's lanes share the home: its loads, its pollers

    # ---- the registry

    def ensure(self) -> None:
        """The home, its plugins directory, and a config.toml listing every
        policy and poller this clone ships, if there is none."""
        os.makedirs(self.plugins, exist_ok=True)
        if not os.path.exists(self.config_path):
            write_whole(self.config_path, TEMPLATE)

    def config(self) -> dict:
        """config.toml, parsed; re-read when it changes."""
        self.ensure()
        mtime = os.path.getmtime(self.config_path)
        if mtime != self._loaded[0]:
            with open(self.config_path, "rb") as fh:
                try:
                    self._loaded = (mtime, tomllib.load(fh))
                except tomllib.TOMLDecodeError as exc:
                    raise ConfigError(f"{self.config_path}: {exc}") from exc
        return self._loaded[1]

    # ---- the file's sections

    def _section(self, kind: str) -> dict:
        section = self.config().get(kind) or {}
        if not isinstance(section, dict):
            raise ConfigError(f"[{kind}] is not a table")
        return section

    def _available(self, kind: str) -> dict:
        """[<kind>.available]: the catalog."""
        available = self._section(kind).get("available") or {}
        if not isinstance(available, dict):
            raise ConfigError(f"[{kind}.available] is not a table")
        return available

    def _llm_config(self) -> dict:
        return self._section("policies").get("llm") or {}

    @staticmethod
    def _where(entry: dict, what: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        """(file, module, class) of a catalog entry: `class = "module:Class"`,
        or `file` (in plugins/) or `module` with `class = "Class"`."""
        cls, file, module = entry.get("class"), entry.get("file"), entry.get("module")
        if not isinstance(cls, str) or not cls:
            raise ConfigError(f"{what} names no `class`")
        if not file and not module:
            module, _, cls = cls.partition(":")
            if not cls:
                raise ConfigError(f"{what}: `class` is \"module:Class\" (or give `file`/`module`)")
        return file, module, cls

    def policies(self) -> Dict[str, PolicySpec]:
        """Every policy the catalog names ([policies.available]): nothing else
        is known -- the harness knows no policy of its own."""
        found = {}
        for name, entry in self._available("policies").items():
            if not isinstance(entry, dict):
                raise ConfigError(f"[policies.available.{name}] is not a table")
            if "pollers" in entry:
                raise ConfigError(f"[policies.available.{name}] names pollers: a policy has none; "
                                  f"a gatherer's are [pollers] default, --poller, or its gatherer.toml")
            file, module, cls = self._where(entry, f"[policies.available.{name}]")
            found[name] = PolicySpec(name, file=file, module=module, cls=cls, options=dict(entry.get("options") or {}))
        return found

    def pollers(self) -> Dict[str, PollerSpec]:
        """Every poller the catalog names ([pollers.available])."""
        found = {}
        for name, entry in self._available("pollers").items():
            if not isinstance(entry, dict):
                raise ConfigError(f"[pollers.available.{name}] is not a table")
            file, module, cls = self._where(entry, f"[pollers.available.{name}]")
            found[name] = PollerSpec(name, file=file, module=module, cls=cls, args=dict(entry.get("args") or {}))
        return found

    def default_pollers(self) -> List[str]:
        """[pollers] default: the pollers a new gatherer gets, whatever its policy."""
        names = self._section("pollers").get("default") or []
        if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
            raise ConfigError("[pollers] default is not a list of poller names")
        return list(names)

    def default_policy(self) -> str:
        return str(self._section("policies").get("default") or "proactive_context_manager")

    # ---- loading classes

    def _load(self, file: Optional[str], module: Optional[str], cls: Optional[str], what: str):
        if not cls:
            raise ConfigError(f"{what}: no `class`")
        if self.plugins not in sys.path:
            sys.path.insert(0, self.plugins)                 # plugins may import each other
        if file:
            path = file if os.path.isabs(file) else os.path.join(self.plugins, file)
            path = os.path.expanduser(path)
            if not os.path.exists(path):
                raise ConfigError(f"{what}: {path} does not exist")
            key = f"ag_plugins.{os.path.splitext(os.path.basename(path))[0]}"
            with self._lock:                                 # loaded once, whole, before any lane uses it
                mod = self._modules.get(path)
                if mod is None:
                    spec = importlib.util.spec_from_file_location(key, path)
                    mod = importlib.util.module_from_spec(spec)
                    sys.modules[key] = mod
                    try:
                        spec.loader.exec_module(mod)
                    except Exception as exc:  # noqa: BLE001
                        raise ConfigError(f"{what}: {path} failed to load: {exc!r}") from exc
                    self._modules[path] = mod
        elif module:
            try:
                mod = importlib.import_module(module)
            except Exception as exc:  # noqa: BLE001
                raise ConfigError(f"{what}: cannot import {module}: {exc!r}") from exc
        else:
            raise ConfigError(f"{what}: needs `file` (in plugins/) or `module`")
        try:
            return getattr(mod, cls)
        except AttributeError as exc:
            raise ConfigError(f"{what}: no {cls} in {file or module}") from exc

    def policy_class(self, spec: PolicySpec):
        return self._load(spec.file, spec.module, spec.cls, f"policy {spec.name}")

    def poller_class(self, spec: PollerSpec):
        cls = self._load(spec.file, spec.module, spec.cls, f"poller {spec.name}")
        if not tuple(getattr(cls, "outputs", ()) or ()):
            raise ConfigError(f"poller {spec.name}: {spec.cls} declares no outputs (the event types it outputs)")
        return cls

    # ---- building

    def llm_class(self):
        """The LLM implementation [policies.llm] names (`class`, as a policy's:
        "module:Class", or `file`/`module` with "Class"); without one,
        CLIClient for a coding agent's CLI (claude-code/..., codex/...), else
        LiteLLMClient."""
        from ag.ag_tools.llm import CLIClient, LiteLLMClient
        cfg = self._llm_config()
        if cfg.get("class"):
            return self._load(*self._where(cfg, "[policies.llm]"), "[policies.llm]")
        return CLIClient if self.model().partition("/")[0] in CLI_MODELS else LiteLLMClient

    def llm(self):
        """The LLM the policies call: llm_class(), built with whichever of these
        its constructor takes -- api_base, api_key, log_dir, log_prompts, listeners, home,
        and [policies.llm]'s other keys (e.g. claude_command) -- and the model
        a policy's calls default to set on it.

        Raises:
            ConfigError: the class cannot be loaded or built.
        """
        cfg = self._llm_config()
        base = self.api_base()
        key_env = str(cfg.get("key_env") or ("LITELLM_KEY" if cfg.get("url") else ""))   # url: api_base's other name
        key = os.environ.get("AG_LLM_KEY") or (os.environ.get(key_env) if key_env else None)
        if base and not key:
            key = "sk-local"                                 # a server of our own may want some key
        offered = {k: v for k, v in cfg.items() if k not in LLM_KEYS}
        offered.update(api_base=base, api_key=key, log_dir=os.path.join(self.root, "logs", "llm"),
                       log_prompts=bool(cfg.get("log_prompts")), listeners=os.path.join(self.root, LISTENERS),
                       home=self.root)
        cls = self.llm_class()
        try:
            params = inspect.signature(cls).parameters
            takes_all = any(p.kind is p.VAR_KEYWORD for p in params.values())
            client = cls(**{k: v for k, v in offered.items() if takes_all or k in params})
        except Exception as exc:  # noqa: BLE001
            raise ConfigError(f"[policies.llm]: {getattr(cls, '__name__', cls)} could not be built: {exc!r}") from exc
        client.model = self.model()                          # the model a policy's calls default to
        return client

    def api_base(self) -> Optional[str]:
        """The server every call goes to, or None for the provider's own API. A
        `url` (a Responses API endpoint, ".../v1/responses") is taken as its
        base."""
        cfg = self._llm_config()
        return self.api_base_of(os.environ.get("AG_LLM_URL") or cfg.get("api_base") or cfg.get("url"))

    def model(self) -> str:
        """The model the policies call: AG_LLM_MODEL, else [policies.llm] model; "" when
        neither is set -- there is no default, and every call then fails (logged)."""
        return os.environ.get("AG_LLM_MODEL") or str(self._llm_config().get("model") or "")

    def llm_problem(self) -> str:
        """Why the Gatherer's LLM cannot run in this Python, or "": a codex/ model
        needs OpenAI's Codex SDK (openai_codex) importable here."""
        model = self.model()
        if self._llm_config().get("class") or model.partition("/")[0] != "codex":
            return ""
        if importlib.util.find_spec("openai_codex") is None:
            return (f"the Gatherer's model {model} runs through OpenAI's Codex SDK, which is not installed "
                    f"for {sys.executable}: pip install openai-codex")
        return ""

    def set_llm(self, model: Optional[str] = None, api_base: Optional[str] = None,
                key_env: Optional[str] = None) -> dict:
        """Write [policies.llm] in config.toml: each of `model`, `api_base`,
        `key_env` that is given (None: left as it is; "": removed). Only those
        lines change -- the rest of the file, comments included, stays. An
        older config's `url` becomes `api_base` (unless one is given) and goes.
        Every gatherer reads it on its next call. Returns the section as written.

        Raises:
            ConfigError: the file would not parse after the change.
        """
        self.ensure()
        with open(self.config_path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
        old = self._llm_config()
        if old.get("url") and api_base is None and not old.get("api_base"):
            api_base = str(self.api_base_of(old["url"]) or "")
        values = {"model": model, "api_base": api_base, "key_env": key_env}
        if old.get("url"):
            values["url"] = ""
        text = "\n".join(set_keys(lines, "policies.llm", values)) + "\n"
        try:
            tomllib.loads(text)
        except tomllib.TOMLDecodeError as exc:
            raise ConfigError(f"{self.config_path}: not written, it would not parse: {exc}") from exc
        with open(self.config_path, "w", encoding="utf-8") as fh:
            fh.write(text)
        self._loaded = (-1.0, {})
        return dict(self._llm_config())

    @staticmethod
    def api_base_of(url) -> Optional[str]:
        """A base URL as LiteLLM takes it: without a trailing / or /responses."""
        base = str(url or "").rstrip("/")
        return base[:-len("/responses")] if base.endswith("/responses") else (base or None)

    def tokenizer(self):
        from ag.ag_tools.tokenizers import Tiktoken
        return Tiktoken()

    def build_policy(self, spec: PolicySpec, options: Dict[str, Any]):
        """The policy, given whichever of these its constructor takes: the
        format of the context manager's own messages, the LLM (its default
        model on it), its options (the catalog's, then the gatherer's), the
        tokenizer, and Jobs, to start background work (a worker that gets the
        same policy from this home). It imports nothing of the harness."""
        from ag.ag_interface import FORMAT as format
        from ag.ag_tools.worker import WorkerJobs
        options = {**spec.options, **options}
        cls = self.policy_class(spec)
        offered = {"format": format, "llm": self.llm(), "options": options, "tokenizer": self.tokenizer(),
                   "jobs": WorkerJobs("ag.ag_harness.home:manager", [REPO, self.plugins], log=paths.worker_log)}
        try:
            params = inspect.signature(cls).parameters
        except (TypeError, ValueError) as exc:
            raise ConfigError(f"policy {spec.name}: {spec.origin} is not a class that can be built: {exc}") from exc
        takes_all = any(p.kind is p.VAR_KEYWORD for p in params.values())
        try:
            return cls(**{k: v for k, v in offered.items() if takes_all or k in params})
        except (TypeError, ValueError) as exc:
            raise ConfigError(f"policy {spec.name}: bad options {sorted(options)}: {exc}") from exc
        except Exception as exc:  # noqa: BLE001
            raise ConfigError(f"policy {spec.name}: could not be built: {exc!r}") from exc

    def build_poller(self, spec: PollerSpec, gatherer: str, cwd: Optional[str]):
        """The poller, with its args filled in, and its id: its name in the
        catalog. None when an arg needs the working directory and the
        request states none."""
        fills = {"cwd": cwd or "", "gatherer": gatherer, "home": self.root}
        args = {}
        for key, value in spec.args.items():
            if isinstance(value, str):
                if "{cwd}" in value and not cwd:
                    return None
                value = os.path.expanduser(value.format(**fills))
            args[key] = value
        cls = self.poller_class(spec)
        try:
            poller = cls(**args)
        except Exception as exc:  # noqa: BLE001
            raise ConfigError(f"poller {spec.name}: could not be built with {args}: {exc!r}") from exc
        poller.id = spec.name
        return poller

    # ---- gatherers

    def gatherer_path(self, gatherer: str) -> str:
        return os.path.join(paths.gatherer_dir(gatherer), "gatherer.toml")

    def gatherer(self, gatherer: str, create: bool = True) -> GathererConfig:
        """The gatherer's config: gatherer.toml, made from the defaults the
        first time."""
        path = self.gatherer_path(gatherer)
        if not os.path.exists(path):
            if not create:
                raise ConfigError(f"gatherer {gatherer}: no {path}")
            policy = self.default_policy()
            spec = self.policies().get(policy)
            if spec is None:
                raise ConfigError(f"[policies] default = {policy!r} is not a known policy")
            self.write_gatherer(GathererConfig(gatherer, policy, self.default_pollers(), {}, path))
        with open(path, "rb") as fh:
            try:
                data = tomllib.load(fh)
            except tomllib.TOMLDecodeError as exc:
                raise ConfigError(f"{path}: {exc}") from exc
        return GathererConfig(gatherer, str(data.get("policy") or self.default_policy()),
                             list(data.get("pollers") or []), dict(data.get("options") or {}), path)

    def write_gatherer(self, cfg: GathererConfig) -> None:
        os.makedirs(os.path.dirname(cfg.path), exist_ok=True)
        write_whole(cfg.path, gatherer_toml(cfg))

    def locked_policy(self, gatherer: str) -> Optional[str]:
        """The policy the gatherer's reads were made by, if any."""
        import sqlite3
        db = paths.db_path(gatherer)
        if not os.path.exists(db):
            return None
        conn = sqlite3.connect(db)
        try:
            row = conn.execute("SELECT manager FROM _reads WHERE manager IS NOT NULL ORDER BY read_id DESC LIMIT 1") \
                .fetchone()
        except sqlite3.Error:
            row = None
        finally:
            conn.close()
        return row[0] if row else None

    def manager(self, gatherer: str):
        """A new manager for the gatherer: its policy, with its options.
        Refused if the gatherer was read with another policy."""
        from ..manager import Manager
        cfg = self.gatherer(gatherer)
        spec = self.policies().get(cfg.policy)
        if spec is None:
            raise ConfigError(f"gatherer {gatherer}: policy {cfg.policy!r} is not known ({cfg.path})")
        policy = self.build_policy(spec, cfg.options)
        locked = self.locked_policy(gatherer)
        if locked and locked != policy.name:
            raise ConfigError(f"gatherer {gatherer} was read with policy {locked!r}; {cfg.path} asks for "
                              f"{cfg.policy!r} ({policy.name}). A gatherer keeps its policy: start a new one.")
        return Manager(policy)

    def gatherer_pollers(self, gatherer: str, cwd: Optional[str]) -> List:
        """The gatherer's pollers for a request in `cwd`: built again only
        when gatherer.toml or config.toml has changed, so a poller that holds
        a connection is not remade on every call."""
        cfg = self.gatherer(gatherer)
        key = (gatherer, cwd, os.path.getmtime(cfg.path), os.path.getmtime(self.config_path))
        with self._lock:                        # built once: lanes in one directory share them (Manager.poll)
            if key in self._pollers:
                return self._pollers[key]
            known = self.pollers()
            found = []
            for name in cfg.pollers:
                spec = known.get(name)
                if spec is None:
                    raise ConfigError(f"gatherer {gatherer}: poller {name!r} is not known ({cfg.path})")
                poller = self.build_poller(spec, gatherer, cwd)
                if poller is not None:
                    found.append(poller)
            self._pollers = {k: v for k, v in self._pollers.items() if k[:2] != (gatherer, cwd)}
            self._pollers[key] = found
            return found

    def problems(self) -> List[str]:
        """What in the registry cannot be resolved, or does not fit."""
        out = []
        try:
            policies, pollers = self.policies(), self.pollers()
        except ConfigError as exc:
            return [str(exc)]
        for spec in pollers.values():
            try:
                self.poller_class(spec)
            except ConfigError as exc:
                out.append(str(exc))
        for spec in policies.values():
            try:
                self.policy_class(spec)
            except ConfigError as exc:
                out.append(str(exc))
        try:
            unknown = [p for p in self.default_pollers() if p not in pollers]
        except ConfigError as exc:
            unknown, out = [], out + [str(exc)]
        if unknown:
            out.append(f"[pollers] default names {', '.join(unknown)}, which [pollers.available] does not")
        if self.default_policy() not in policies:
            out.append(f"[policies] default = {self.default_policy()!r} is not a known policy")
        return out


# ---------------------------------------------------------------- what the server and the worker call

_HOMES: Dict[str, Home] = {}
_HOMES_LOCK = threading.Lock()


def home(root: Optional[str] = None) -> Home:
    """The Home at `root` (default: AG_HOME, or ~/.ag), one per process."""
    root = os.path.abspath(os.path.expanduser(root or paths.AG_HOME))
    with _HOMES_LOCK:
        if root not in _HOMES:
            _HOMES[root] = Home(root)
        return _HOMES[root]


def manager(gatherer: str):
    """A new manager for `gatherer`, as its config says: the server's
    factory, and the background worker's."""
    return home().manager(gatherer)


def pollers(gatherer: str, cwd: Optional[str]) -> List:
    """The gatherer's pollers for a request in `cwd`."""
    return home().gatherer_pollers(gatherer, cwd)
