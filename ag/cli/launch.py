"""Launchers: how a harness is started with the context manager set up in it,
for one run -- what `ag <harness> ...` runs.

ag knows a harness only from its entry in config.toml, which names its
launcher class and its adaptor class:

    [cli.harnesses.mine]
    launcher = "pkg.mine.launch:MineLauncher"     # a Launcher subclass, "module:Class"
    adaptor  = "pkg.mine.adaptor:MineAdaptor"     # Python "module:Class", or TypeScript "path.ts:Export"
    command  = ["mine"]                           # and the launcher's own settings

    class MineLauncher(Launcher):
        defaults = {"command": ["mine"], "env": {}}   # a setting the entry leaves out
        def launch(self, run: Run) -> Launch: ...

The launcher is imported from its entry at run time -- ag imports nothing of
a harness otherwise -- and given its settings (the entry over its
`defaults`), the home, and each run: the harness's arguments, the command,
the environment, the gatherer, and the adaptor, which it hands on to the
harness's setup. A launcher changes nothing the harness reads: what it adds
(a flag, a variable, a hook server) is for the run alone. Of the harness side
it knows its harness's setup and nothing else.
"""

import importlib
import json
import os
import subprocess
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, ClassVar, Dict, List, Optional, Tuple, Type

HERE = os.path.dirname(os.path.abspath(__file__))
#: The directory that holds ag/ (the clone, or site-packages): what a launcher's own processes need on their PYTHONPATH, and
#: what a TypeScript adaptor's path is relative to.
REPO = os.path.dirname(os.path.dirname(HERE))


class LaunchError(Exception):
    pass


@dataclass
class Run:
    args: List[str]                 # the harness's arguments, as given to ag
    command: List[str]              # the harness's command (its settings', expanded)
    env: Dict[str, str]             # the environment it runs in (with AG_HOME)
    gatherer: Optional[str]             # the named gatherer, if any: each launcher passes it its own way
    cwd: str
    dry_run: bool = False           # nothing may be started
    adaptor: str = ""               # the adaptor, as its entry names it (a TypeScript path made absolute)
    channel: Optional[str] = None   # the channel its own session is kept in, as its starter chose it (`--channel`): a
                                    # launcher of a harness that picks its session's id at its first call names it in
                                    # the hook's URL (/a/<channel>/); None: the session's own id


@dataclass
class Launch:
    argv: List[str]
    env: Dict[str, str]
    notes: List[str] = field(default_factory=list)
    session: Optional[str] = None   # the harness's session the run opens, when it is known: ag claims it, so
                                    # no other process runs it at once (a launcher that cannot tell: None)


class Launcher(ABC):
    r"""One harness's launcher, built with its settings (its entry in config.toml over its
    `defaults`) and the context manager's home.

    `ag` calls `launch` with a `Run`: the harness's arguments, its command, the environment, the
    gatherer (`None` for one per session), the working directory, whether this is a dry run, and
    the adaptor named in the entry. `launch` returns the command and environment to run. A
    launcher may also implement `describe` (for `ag config`), and `status` and `stop` (for
    anything it keeps running, such as a proxy). It changes nothing the harness reads on disk:
    everything is passed for this run only, through flags or the environment.

    **A sketch**, for a harness that loads a plugin given by a flag:

    ```python
    from ag.cli.launch import Launch, Launcher


    class MyLauncher(Launcher):
        defaults = {"command": ["mine"], "env": {}}

        def launch(self, run):
            env = {**run.env, "AG_ADAPTOR": run.adaptor}          # the plugin loads the adaptor ag checked
            flags = ["--plugin", "/path/to/my_plugin"] + (["--ag-gatherer", run.gatherer] if run.gatherer else [])
            return Launch([*run.command, *flags, *run.args], env)
    ```

    **Registering the harness** in config.toml:

    ```toml
    [cli.harnesses.mine]
    launcher = "my_pkg.launch:MyLauncher"
    adaptor  = "my_pkg.adaptor:MyAdaptor"        # or "path/to/adaptor.ts:MyAdaptor"
    command  = ["mine"]
    ```

    Then `ag mine` runs it. Before every run, `ag` checks that the gatherer's policy accepts
    what the adaptor and the pollers output, and `ag --dry-run mine` shows the command it would
    run. A harness cannot be named after one of `ag`'s own commands.

    Working launchers: each shipped harness's, in `ag/integrations/harnesses/<name>/setup/launch.py`.
    """

    defaults: ClassVar[Dict[str, Any]] = {"command": [], "env": {}}
    #: The environment variables this harness's side reads: (name, default, what it does).
    environment: ClassVar[Tuple[Tuple[str, str, str], ...]] = ()
    #: Whether it names the run's channel (`Run.channel`) in the hook's URL: a harness that picks its session's id only
    #: at its first call, whose session a dashboard keeps under an id of its own.
    names_channel: ClassVar[bool] = False

    def __init__(self, settings: Dict[str, Any], home: str):
        self.settings = settings
        self.home = home

    @abstractmethod
    def launch(self, run: Run) -> Launch:
        """The command and environment for this run; LaunchError when the
        harness cannot be set up."""

    def describe(self, env: Dict[str, str]) -> List[str]:
        """For `ag config`: what it would resolve to."""
        return []

    def status(self) -> List[str]:
        """For `ag status`: what it started and keeps running."""
        return []

    def stop(self) -> List[str]:
        """For `ag stop`: stop that; what was stopped."""
        return []

    def serving(self) -> List[str]:
        """For `ag stop`: the address of each server `stop` would stop that harnesses call their model through
        ("http://127.0.0.1:<port>"), so that `ag stop` can tell when it would cut off the session it runs in."""
        return []


def _import(spec: str, what: str):
    module, _, attr = spec.partition(":")
    if not module or not attr:
        raise LaunchError(f"{what} {spec!r} is not \"module:Class\"")
    try:
        return getattr(importlib.import_module(module), attr)
    except (ImportError, AttributeError) as exc:
        raise LaunchError(f"{what} {spec!r} cannot be imported: {exc}") from exc


def load_launcher(spec: str) -> Type[Launcher]:
    """The launcher class `spec` ("module:Class") names."""
    cls = _import(spec, "launcher")
    if not (isinstance(cls, type) and issubclass(cls, Launcher)):
        raise LaunchError(f"launcher {spec!r} is not a Launcher")
    return cls


def is_typescript(spec: str) -> bool:
    return spec.rpartition(":")[0].endswith((".ts", ".js", ".mjs"))


def resolve_adaptor(spec: str) -> str:
    """`spec`, a TypeScript adaptor's path made absolute (relative to the clone)."""
    if not is_typescript(spec):
        return spec
    path, _, export = spec.rpartition(":")
    return f"{os.path.join(REPO, os.path.expanduser(path))}:{export}"


def adaptor_declarations(spec: str) -> Dict[str, Any]:
    """{"name", "outputs", "accepts", "properties"} of the adaptor class `spec` names:
    imported, if Python ("module:Class"); read by node, if TypeScript
    ("path.ts:Export")."""
    if not is_typescript(spec):
        cls = _import(spec, "adaptor")
        if not all(hasattr(cls, a) for a in ("outputs", "accepts")):
            raise LaunchError(f"adaptor {spec!r} is not an Adaptor (outputs, accepts)")
        return {"name": getattr(cls, "name", "") or spec, "outputs": list(cls.outputs), "accepts": list(cls.accepts),
                "properties": list(getattr(cls, "properties", ()))}
    path, _, export = resolve_adaptor(spec).rpartition(":")
    script = ("const m = await import(process.argv[1]); const c = m[process.argv[2]];"
              "if (!c || !Array.isArray(c.outputs) || !Array.isArray(c.accepts)) { console.error('not an adaptor class"
              " (static adaptorName, outputs, accepts)'); process.exit(2); }"
              "console.log(JSON.stringify({ name: c.adaptorName, outputs: c.outputs, accepts: c.accepts,"
              " properties: c.properties ?? [] }));")
    from pathlib import Path
    try:
        out = subprocess.run(["node", "--experimental-strip-types", "--no-warnings", "--input-type=module",
                              "-e", script, Path(path).as_uri(), export], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise LaunchError(f"adaptor {spec!r}: node could not read it: {exc}") from exc
    if out.returncode != 0:
        raise LaunchError(f"adaptor {spec!r}: {(out.stderr or out.stdout).strip().splitlines()[-1:] or ['node failed']}")
    return json.loads(out.stdout)
