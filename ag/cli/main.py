"""ag's command line; see the package's docstring (`ag --help`)."""

import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from typing import Dict, List, Optional

from . import __doc__ as USAGE
from . import config, usage
from .launch import LaunchError, Run, adaptor_declarations, load_launcher, resolve_adaptor

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # the directory that holds ag/
GATHERER = re.compile(r"^[A-Za-z0-9._-]+$")
#: `--gatherer .` (or `[cli] gatherer = "."`): no shared gatherer, one per harness session, named as the harness names it.
PER_SESSION = "."


class AgError(Exception):
    pass


def say(msg: str) -> None:
    print(f"ag: {msg}", file=sys.stderr)


def parse(argv: List[str]):
    """ag's own options, then the command and everything after it."""
    opts = {"gatherer": None, "policy": None, "pollers": [], "no_pollers": False, "dry_run": False, "quiet": False}
    i = 0
    while i < len(argv):
        a = argv[i]
        name, eq, value = a.partition("=")
        if name in ("--gatherer", "--policy", "--poller"):
            if not eq:
                if i + 1 >= len(argv):
                    raise AgError(f"{name} takes a value")
                value, i = argv[i + 1], i + 1
            if name == "--poller":
                opts["pollers"].append(value)
            else:
                opts[name[2:]] = value
        elif a == "--no-pollers":
            opts["no_pollers"] = True
        elif a == "--dry-run":
            opts["dry_run"] = True
        elif a == "--quiet":
            opts["quiet"] = True
        elif a in ("-h", "--help"):
            return opts, "help", []
        elif a.startswith("-"):
            raise AgError(f"unknown option {a} (ag's options come before the harness; `ag --help`)")
        else:
            return opts, a, argv[i + 1:]
        i += 1
    return opts, "help", []


def python_env() -> Dict[str, str]:
    return {"AG_HOME": config.home(),
            "PYTHONPATH": os.pathsep.join(p for p in (REPO, os.environ.get("PYTHONPATH")) if p)}


def home_cli(args: List[str], capture: bool = False):
    argv = [os.environ.get("AG_PYTHON") or sys.executable, "-m", "ag.ag_harness.home", *args]
    return subprocess.run(argv, cwd=REPO, env={**os.environ, **python_env()},   # this clone's, wherever ag runs
                          capture_output=capture, text=True)


def poller_args(pollers: List[str], none: bool = False) -> List[str]:
    return ["--no-pollers"] if none else [x for p in pollers for x in ("--poller", p)]


def prepare_gatherer(gatherer: str, policy: Optional[str], pollers: List[str], none: bool = False,
                     quiet: bool = False) -> None:
    """Make the named gatherer with this policy and pollers (`none`: no pollers),
    or check the one there is (`quiet`: without saying it was made)."""
    shown = home_cli(["show", gatherer], capture=True)
    if shown.returncode != 0:
        made = home_cli(["new", gatherer, *(["--policy", policy] if policy else []), *poller_args(pollers, none)],
                        capture=True)
        if made.returncode != 0:
            raise AgError((made.stderr or made.stdout).strip())
        if not quiet:
            say(f"made gatherer {gatherer}: {made.stdout.strip()}")
        return
    lines = shown.stdout.splitlines()
    has = next((l.split()[1] for l in lines if l.startswith("policy:")), None)
    config_path = next((l.split(None, 1)[1] for l in lines if l.startswith("config:")), "its gatherer.toml")
    at = next((n for n, l in enumerate(lines) if l.startswith("pollers:")), len(lines))
    has_pollers = [l.split()[0] for l in lines[at + 1:] if l.startswith("  ")]
    if policy and policy != has:
        raise AgError(f"gatherer {gatherer} exists with policy {has}; name a new gatherer for {policy}")
    if (pollers or none) and sorted([] if none else pollers) != sorted(has_pollers):
        raise AgError(f"gatherer {gatherer} exists with pollers {', '.join(has_pollers) or '-'}; "
                      f"edit {config_path} to change them")


def launcher(harness: str, settings):
    """The harness's launcher, from its entry in config.toml ([cli.harnesses.<harness>]),
    built with its settings."""
    entry = settings["harnesses"][harness]
    if not entry.get("launcher"):
        raise AgError(f"[cli.harnesses.{harness}] names no launcher in {config.path()}")
    cls = load_launcher(str(entry["launcher"]))
    return cls(config.harness(settings, harness, cls.defaults), config.home())


def shown(event_type: dict) -> str:
    """An event type as a problem shows it: its name, and its properties
    (`!`: required, `*`: identifying)."""
    props = [p["name"] + ("!" if p.get("required") else "") + ("*" if p.get("identifies") else "")
             for p in event_type.get("properties", [])]
    return event_type["name"] + (f" ({', '.join(props)})" if props else "")


def contract_problems(harness: str, adaptor: str, gatherer: Optional[str], opts) -> List[str]:
    """Why the policy this run would use cannot take what the adaptor and the
    gatherer's pollers output -- nothing, if it can. It takes an event type it
    declares, with the properties it declares, and every one it requires:
    an adaptor's or a poller's events carry the properties it sets
    (`properties`)."""
    args = ["contract", *(["--gatherer", gatherer] if gatherer else []),
            *(["--policy", opts["policy"]] if opts["policy"] else []),
            *poller_args(opts["pollers"], opts["no_pollers"])]
    got = home_cli(args, capture=True)
    if got.returncode != 0:
        raise AgError((got.stderr or got.stdout).strip() or "the home could not say what this run takes")
    contract = json.loads(got.stdout)
    if contract.get("llm_problem"):
        raise AgError(contract["llm_problem"])
    if not contract.get("model", True):
        say("no LLM model set: the Gatherer's calls will fail until one is -- "
            "`ag model gemini/gemini-3.8-flash`, say (or AG_LLM_MODEL)")
    types = {t["name"]: t for t in contract["event_types"]}
    declared = adaptor_declarations(adaptor)
    adaptor_name = declared.get("name") or adaptor
    problems, mismatched = [], []
    extra = sorted(set(declared["outputs"]) - set(types))
    if extra:
        problems.append(f"adaptor {adaptor_name} outputs: {', '.join(extra)}")
    for poller, outputs in contract["pollers"].items():
        extra = sorted(set(outputs) - set(types))
        if extra:
            problems.append(f"poller {poller} outputs: {', '.join(extra)}")
    sources = [(f"adaptor {adaptor_name}", declared["outputs"], declared.get("properties") or [])]
    sets = contract.get("poller_properties", {})
    sources += [(f"poller {poller}", outputs, sets.get(poller, [])) for poller, outputs in contract["pollers"].items()]
    for source, outputs, sets in sources:
        for name in outputs:
            if name not in types:
                continue
            props = {p["name"]: p.get("required") for p in types[name].get("properties", [])}
            undeclared = sorted(set(sets) - set(props))
            missing = sorted(p for p, required in props.items() if required and p not in sets)
            if undeclared:
                mismatched.append(f"{source} sets {', '.join(undeclared)} on {name}, which declares "
                                  f"{', '.join(props) or 'no property'}")
            if missing:
                mismatched.append(f"{source} does not set {', '.join(missing)}, which {name} requires")
    if mismatched:
        problems = problems + mismatched
    if problems:
        where = {"default": "the pollers are [pollers] default: choose others with --poller (or --no-pollers), or change it",
                 "gatherer": f"the pollers are the gatherer's: edit its gatherer.toml (`ag home show {gatherer}`)",
                 "given": "the pollers are the ones --poller named"}.get(contract.get("pollers_from"), "")
        problems = [f"the policy {contract['policy']} does not take what this run would send it:",
                    *(f"  {p}" + ("" if p in mismatched else f"   (not among {contract['policy']}'s event types)")
                      for p in problems),
                    f"{contract['policy']} takes: {', '.join(shown(t) for t in contract['event_types'])}",
                    *([where] if contract["pollers"] and where else [])]
    return problems


def launch(harness: str, args: List[str], opts, settings) -> int:
    """Run the harness as its launcher says, once the policy is known to take
    what its adaptor and pollers output."""
    gatherer = opts["gatherer"] or settings["defaults"].get("gatherer") or config.DEFAULT_GATHERER
    gatherer = None if gatherer == PER_SESSION else gatherer
    if gatherer and not GATHERER.match(gatherer):
        raise AgError(f"a gatherer may hold letters, digits, '.', '_' and '-' only: {gatherer}")
    if opts["no_pollers"] and opts["pollers"]:
        raise AgError("--no-pollers and --poller: one or the other")
    if (opts["policy"] or opts["pollers"] or opts["no_pollers"]) and not gatherer:
        raise AgError("--policy, --poller and --no-pollers make a named gatherer, not one per session (--gatherer .)")
    entry = settings["harnesses"][harness]
    if not entry.get("adaptor"):
        raise AgError(f"[cli.harnesses.{harness}] names no adaptor in {config.path()}")
    adaptor = resolve_adaptor(str(entry["adaptor"]))
    try:
        the_launcher = launcher(harness, settings)
        problems = contract_problems(harness, adaptor, gatherer, opts)
    except LaunchError as exc:
        raise AgError(str(exc)) from exc
    if problems:
        raise AgError("\n    ".join(problems))

    section = the_launcher.settings
    env = {**os.environ, **extra_env(section), "AG_HOME": config.home()}
    if env.pop("AG_GATHERER", None):
        # The harness's setup falls back on it; with ag, the gatherer is --gatherer's or [cli] gatherer's alone.
        say("AG_GATHERER is ignored under ag (it is not passed on): use --gatherer, or [cli] gatherer")
    run = Run(args, [os.path.expanduser(str(c)) for c in section["command"]], env, gatherer, os.getcwd(),
              opts["dry_run"], adaptor)
    if gatherer and (opts["policy"] or opts["pollers"] or opts["no_pollers"]) and not run.dry_run:
        prepare_gatherer(gatherer, opts["policy"], opts["pollers"], opts["no_pollers"], opts["quiet"])
    try:
        out = the_launcher.launch(run)
    except LaunchError as exc:
        raise AgError(str(exc)) from exc
    if not opts["quiet"]:                    # what ag set up; its problems and warnings print either way
        for note in out.notes:
            say(note)
        if gatherer:
            say(f"gatherer {gatherer}")

    if run.dry_run:
        changed = {k: v for k, v in out.env.items() if os.environ.get(k) != v}
        print(" ".join([*(f"{k}={shlex.quote(v)}" for k, v in sorted(changed.items())), *map(shlex.quote, out.argv)]))
        return 0
    if not shutil.which(out.argv[0], path=out.env.get("PATH")):
        raise AgError(f"no {out.argv[0]} to run; install {harness} or set [cli.harnesses.{harness}] command "
                      f"in {config.path()}")
    if out.session:
        claim(gatherer or out.session, out.session, opts["quiet"])
    os.execvpe(out.argv[0], out.argv, out.env)
    return 127  # not reached


def claim(gatherer: str, session: str, quiet: bool = False) -> None:
    """This process -- the harness, once exec'd: the same pid -- opens `session`, unless another
    process that still runs has it open (another terminal, the dashboard's chat mid-turn): then refused.
    The dashboard's chat agent between its turns yields: it is stopped, and the session taken over
    (`quiet`: without saying so)."""
    got = home_cli(["claim", gatherer, session, "--pid", str(os.getpid()), "--by", "launcher"], capture=True)
    try:
        answer = json.loads(got.stdout)
    except ValueError:
        raise AgError((got.stderr or got.stdout).strip() or f"could not claim session {session}") from None
    if answer.get("claimed") is False:
        held = answer.get("holder") or {}
        raise AgError(f"session {session} is open in another process, {held.get('pid')}"
                      f"{shown_process(held.get('pid'))}, since {held.get('opened_at')}: close it there first "
                      f"(the dashboard's chat gives it up once its turn is over)")
    if answer.get("took_over") and not quiet:
        say(f"session {session}: took it over from the dashboard's idle agent ({answer['took_over'].get('pid')})")


def shown_process(pid) -> str:
    """` (its command line)`, as /proc has it; "" when it cannot be read."""
    try:
        with open(f"/proc/{int(pid)}/cmdline", "rb") as fh:
            line = fh.read().replace(b"\0", b" ").decode(errors="replace").strip()
    except (OSError, ValueError, TypeError):
        return ""
    return f" ({line[:160]})" if line else ""


def extra_env(section) -> Dict[str, str]:
    return {str(k): os.path.expanduser(str(v)) for k, v in (section.get("env") or {}).items()}


def show_config(settings) -> int:
    print(f"home:       {config.home()}")
    print(f"config:     {config.path()}  ([cli]: ag's; [policies], [pollers]: `ag home list`)")
    gatherer = settings["defaults"].get("gatherer") or config.DEFAULT_GATHERER
    print(f"gatherer:   {'(one per harness session)' if gatherer == PER_SESSION else gatherer}")
    for harness, entry in settings["harnesses"].items():
        print(f"\n[cli.harnesses.{harness}]")
        print(f"  launcher: {entry.get('launcher') or '(none)'}")
        try:
            declared = adaptor_declarations(resolve_adaptor(str(entry.get("adaptor") or "")))
            print(f"  adaptor:  {entry.get('adaptor')}  outputs: {', '.join(declared['outputs'])}"
                  f"  sets: {', '.join(declared.get('properties') or []) or '-'}")
            the_launcher = launcher(harness, settings)
        except (LaunchError, AgError) as exc:
            print(f"  problem:  {exc}")
            continue
        print(f"  command:  {' '.join(the_launcher.settings['command'])}")
        if the_launcher.settings.get("env"):
            print(f"  env:      {the_launcher.settings['env']}")
        for line in the_launcher.describe({**os.environ, **extra_env(the_launcher.settings)}):
            print(f"  {line}")
    return 0


def each_launcher(settings):
    for name in settings["harnesses"]:
        try:
            yield name, launcher(name, settings)
        except (LaunchError, AgError) as exc:
            say(f"{name}: {exc}")


def status(settings) -> int:
    """What each harness's launcher keeps running."""
    lines = [f"{name}: {line}" for name, the_launcher in each_launcher(settings) for line in the_launcher.status()]
    print("\n".join(lines) or "nothing ag started is running")
    return 0


def stop(settings) -> int:
    lines = [f"{name}: {line}" for name, the_launcher in each_launcher(settings) for line in the_launcher.stop()]
    print("\n".join(lines) or "nothing ag started is running")
    return 0


def dashboard(args: List[str]) -> int:
    """`ag` alone, or `ag dashboard [--host H] [--port N] [--no-open] [--out FILE]`: the dashboard (its own
    package, ag_dashboard, which reads the home's files and imports nothing of ag), on this home, opened
    in the browser -- unless --no-open."""
    from ag_dashboard.__main__ import main as dashboard_main
    try:
        return dashboard_main(["--home", config.home(), "--open", *args])
    except SystemExit as exc:                 # its argument errors: the usage is printed
        return exc.code if isinstance(exc.code, int) else 2


def main(argv: Optional[List[str]] = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    try:
        if not argv:                                                    # `ag` alone: the dashboard
            return dashboard([])
        opts, cmd, rest = parse(argv)
        if cmd == "help":
            print(usage.help_text(USAGE))
            return 0
        if cmd == "home":
            return home_cli(rest).returncode
        if cmd in config.HOME_SHORTCUTS:
            return home_cli([cmd, *rest]).returncode                    # `ag gatherers` is `ag home gatherers`
        settings = config.load()
        if cmd in settings["harnesses"]:
            return launch(cmd, rest, opts, settings)
        if cmd == "config":
            return show_config(settings)
        if cmd == "status":
            return status(settings)
        if cmd == "stop":
            return stop(settings)
        if cmd == "dashboard":
            return dashboard(rest)
        if cmd == "actors":
            from . import actors
            return actors.main(rest)
        if cmd == "preview":
            from . import preview
            return preview.main(rest)
        raise AgError(f"no command {cmd!r}: one of {', '.join(settings['harnesses'])} (the harnesses in "
                      f"{config.path()}), or {', '.join(c for c in config.RESERVED if c != 'help')}")
    except (AgError, config.ConfigError) as exc:
        say(str(exc))
        return 1
