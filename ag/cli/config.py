"""ag's own settings: the [cli] section of the home's config.toml -- how each
harness is launched.

    [cli]                   ag's own: the gatherer runs file into
    [cli.harnesses.<name>]  each harness ag can run: its launcher and adaptor
                            classes, and the launcher's settings (ag/cli/launch.py)

The rest of the file -- [policies], [pollers] -- is the context manager's,
which ignores [cli]. When the file is new, the context manager's home makes it
(`python -m ag.ag_harness.home path`: ag imports nothing of it); when it has
no [cli], ag adds one with every default written out -- and the harnesses
this clone ships (ag/cli/harnesses.toml). A missing key (or a missing file, when
the home cannot be written) is the default.
"""

import os
import subprocess
import sys
import tomllib
from typing import Any, Dict

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # the directory that holds ag/

HEADER = '''
# ================================================================ cli
# ag, the command line: how `ag <harness>` launches each harness. Added by ag
# with the defaults written out; edit freely.

# The gatherer every run files into ("." for one per harness session); `ag --gatherer NAME`
# (or `--gatherer .`) overrides it for one run.
[cli]
gatherer = "default"
'''

#: The gatherer a run files into when neither --gatherer nor [cli] gatherer names one
#: ("" names none: a config.toml written before there was a default says so).
DEFAULT_GATHERER = "default"
#: ag's own defaults; a harness's settings default to its launcher's `defaults`.
DEFAULTS: Dict[str, Any] = {"gatherer": DEFAULT_GATHERER}
#: The harnesses this clone ships, as ag writes them into [cli.harnesses].
HARNESSES_TOML = os.path.join(REPO, "ag", "cli", "harnesses.toml")


#: The environment variables ag and every harness read: (name, "", default, what it does). A
#: harness's own are its launcher's `environment`. The docs' tables are made from both.
ENVIRONMENT = (
    ("AG_HOME", "", "~/.ag", "The home directory: settings, gatherers, logs."),
    ("AG_PYTHON", "", "python3", "The Python that runs the Gatherer's server. The Claude Code and Codex "
                                 "proxies default to the Python they run in."),
    ("AG_LLM_MODEL", "", "[policies.llm] model", "The Gatherer's model."),
    ("AG_LLM_URL", "", "[policies.llm] api_base", "Where the Gatherer's LiteLLM calls go."),
    ("AG_LLM_KEY", "", "the variable key_env names", "The API key for those calls."),
    ("AG_GATHERER", "", "", "The gatherer, for the Pi extension and the OpenCode plugin when run without "
                            "`ag`. Ignored under `ag`: use `--gatherer`."),
    ("AG_ADAPTOR", "", "set by ag", "The adaptor the Pi extension or OpenCode plugin loads, as "
                                    "`\"path.ts:Export\"`."),
    ("AG_JOB", "", "set by the worker", "The job a worker runs (gatherer, job, id, properties), as JSON: each "
                                        "of its model calls' logs names it, for `ag dashboard`."),
    ("AG_ACTOR", "", "set by the dashboard", "The actor `ag actors` asks as, where its harness does not say "
                                             "(CLAUDE_CODE_SESSION_ID, CODEX_THREAD_ID)."),
    ("AG_DASHBOARD", "", "set by the dashboard", "The dashboard `ag actors` asks: the one that runs the actor, else "
                                                 "the one <home>/dashboard/address.json names."),
)


class ConfigError(Exception):
    pass


def template() -> str:
    """The [cli] section as ag writes it: its own, then the harnesses this clone ships."""
    with open(HARNESSES_TOML, encoding="utf-8") as fh:
        return HEADER + "\n" + fh.read()


def home() -> str:
    """The context manager's home: AG_HOME, or ~/.ag."""
    return os.path.abspath(os.path.expanduser(os.environ.get("AG_HOME") or "~/.ag"))


def path() -> str:
    return os.path.join(home(), "config.toml")


def _read(p: str) -> Dict[str, Any]:
    if not os.path.exists(p):
        return {}
    with open(p, "rb") as fh:
        try:
            return tomllib.load(fh)
        except tomllib.TOMLDecodeError as exc:
            raise ConfigError(f"{p}: {exc}") from exc


def ensure() -> str:
    """config.toml, made by the context manager's home if there is none, with
    a [cli] section added if it has none; its path."""
    p = path()
    if not os.path.exists(p):
        env = {**os.environ, "AG_HOME": home(),
               "PYTHONPATH": os.pathsep.join(x for x in (REPO, os.environ.get("PYTHONPATH")) if x)}
        subprocess.run([os.environ.get("AG_PYTHON") or sys.executable, "-m", "ag.ag_harness.home", "path"],
                       cwd=REPO, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)   # this clone's
    if "cli" not in _read(p):
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "a", encoding="utf-8") as fh:
                fh.write(template())
        except OSError:
            pass
    return p


#: ag's own commands: no harness may be named one. `gatherers`, `show` and `new`
#: are the home's (`ag home <them>`), given at the top for short.
HOME_SHORTCUTS = ("gatherers", "show", "new", "model")
RESERVED = ("help", "home", "config", "status", "stop", "dashboard", "actors", "preview") + HOME_SHORTCUTS


def load() -> Dict[str, Any]:
    """The settings: {"defaults": [cli]'s own, "harnesses": {name: its entry}}.

    Raises:
        ConfigError: the file is malformed, or names a harness after one of
            ag's own commands (RESERVED).
    """
    p = ensure()
    cli = _read(p).get("cli") or {}
    if not isinstance(cli, dict):
        raise ConfigError(f"{p}: [cli] is not a table")
    harnesses = cli.get("harnesses") or {}
    if not isinstance(harnesses, dict) or not all(isinstance(e, dict) for e in harnesses.values()):
        raise ConfigError(f"{p}: [cli.harnesses] is not a table of tables")
    taken = sorted(set(harnesses) & set(RESERVED))
    if taken:
        raise ConfigError(f"{p}: [cli.harnesses.{taken[0]}]: {', '.join(taken)} is ag's own command "
                          f"({', '.join(RESERVED)}); name the harness otherwise")
    return {"defaults": {**DEFAULTS, **{k: v for k, v in cli.items() if k in DEFAULTS}},
            "harnesses": {name: dict(entry) for name, entry in harnesses.items()}}


def harness(settings: Dict[str, Any], name: str, defaults: Dict[str, Any]) -> Dict[str, Any]:
    """A harness's launcher settings: its entry over its launcher's `defaults`
    (without `launcher` and `adaptor`)."""
    entry = {k: v for k, v in settings["harnesses"][name].items() if k not in ("launcher", "adaptor")}
    out = {**defaults, **entry}
    if isinstance(out.get("command"), str):
        out["command"] = [out["command"]]
    if "env" in out and not isinstance(out["env"], dict):
        raise ConfigError(f"{path()}: [cli.harnesses.{name}] env is not a table")
    return out
