"""The context manager's home, from the command line.

    python -m ag.ag_harness.home path                 where it is (AG_HOME, or ~/.ag)
    python -m ag.ag_harness.home list                 every policy and poller, and any problem
    python -m ag.ag_harness.home gatherers                every gatherer: its policy, pollers, events, last activity
    python -m ag.ag_harness.home show <gatherer>          a gatherer's config, as it resolves
    python -m ag.ag_harness.home new <gatherer> [--policy P] [--poller X ... | --no-pollers] [--force]
                                                        make a gatherer's config ahead of use
    python -m ag.ag_harness.home model [NAME] [--api-base URL] [--key-env VAR]
                                                        the LLM the policies call: shown, or set in
                                                        config.toml ([policies.llm]) for every gatherer
    python -m ag.ag_harness.home contract [--gatherer S] [--policy P] [--poller X ... | --no-pollers]
                                                        what a run would take, as JSON: the policy,
                                                        its event types, each poller's outputs
    python -m ag.ag_harness.home claim <gatherer> <session> --pid N [--by WHAT]
                                                        process N opens the session (as JSON: claimed,
                                                        or the process that has it); exit 3 when held
    python -m ag.ag_harness.home hold <gatherer> <session> --pid N (--yields | --keeps)
                                                        process N, which has the session open, gives way
                                                        to another's claim (idle) or not; exit 3 when it
                                                        no longer has it
    python -m ag.ag_harness.home complete [--purpose P] [--system TEXT] [--effort E] [--timeout S] [--json]
                                                        the Gatherer's model asked once, as a policy asks
                                                        it: the prompt on stdin, its answer on stdout
                                                        (--json: {"text", "model", "error"}); exit 1 when
                                                        the call failed
    python -m ag.ag_harness.home insert <gatherer> --properties JSON --events JSON
                                                        events put into the gatherer: a reader's record
                                                        of what it did (the dashboard's: a name it gave an
                                                        actor), as the server's `insert` takes a harness's;
                                                        each one's row, as JSON
    python -m ag.ag_harness.home build <gatherer> --properties JSON [--min-messages N]
                                                        a build of the history these properties name (a
                                                        channel's, e.g.) started in the background -- an
                                                        ordinary one, adopted at its next user message --
                                                        once it has N user messages since the last; what
                                                        came of it, as JSON (`Manager.requested`)
    python -m ag.ag_harness.home migrate [<gatherer> ...] [--no-vacuum] [--now]
                                                        a gatherer's file an older ag wrote moved to the
                                                        current layout (ag/ag_harness/store/migrate.py): those
                                                        named, else every one due; a line for each. ag runs it
                                                        in the background as it starts (ag/cli/main.py)

`ag home ...` runs the same.
"""

import argparse
import importlib.util
import json
import os
import shutil
import sqlite3
import sys

from ag.ag_interface import property_column
from ..store import paths, schema
from . import CLI_MODELS, ConfigError, GathererConfig, home


def cmd_list(h) -> int:
    policies, pollers = h.policies(), h.pollers()
    default = h.default_policy()
    print(f"home: {h.root}")
    print("\npolicies:")
    for spec in policies.values():
        mark = "  (default)" if spec.name == default else ""
        print(f"  {spec.name:18s} {spec.origin:34s}{mark}")
        if spec.options:
            print(f"  {'':18s} options: {spec.options}")
    print(f"\npollers:  (a new gatherer's: {', '.join(h.default_pollers()) or '-'})")
    for spec in pollers.values():
        try:
            cls = h.poller_class(spec)
            outputs = ", ".join(cls.outputs)
            sets = ", ".join(getattr(cls, "properties", ())) or "-"
        except ConfigError:
            outputs, sets = "?", "?"
        print(f"  {spec.name:18s} {spec.origin:34s} outputs: {outputs:20s} sets: {sets:8s} args: {spec.args}")
    problems = h.problems()
    print("\nproblems:" if problems else "\nno problems")
    for line in problems:
        print(f"  {line}")
    return 1 if problems else 0


def gatherer_stats(gatherer: str) -> dict:
    """What a gatherer's database holds, read without writing to it: its events,
    when the last was stored, and how many distinct values each property
    has (e.g. its channels); {} with no database."""
    path = paths.db_path(gatherer)
    if not os.path.exists(path):
        return {}
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=8)
    try:
        events, last = conn.execute("SELECT count(*), max(inserted_at) FROM events").fetchone()
        values = {name: conn.execute(f"SELECT count(DISTINCT {property_column(name)}) FROM events").fetchone()[0]
                  for name in schema.property_names(conn)}
        return {"events": events, "last": last, "properties": values}
    except sqlite3.Error as exc:
        return {"error": str(exc)}
    finally:
        conn.close()


def cmd_gatherers(h) -> int:
    """Every gatherer in the home, newest activity first."""
    root = paths.TRACE_DIR
    names = sorted(n for n in os.listdir(root) if os.path.isfile(os.path.join(root, n, "gatherer.toml"))) \
        if os.path.isdir(root) else []
    if not names:
        print(f"no gatherers in {root}")
        return 0
    rows = []
    for name in names:
        try:
            cfg = h.gatherer(name, create=False)
            policy, pollers = cfg.policy, ", ".join(cfg.pollers) or "-"
        except ConfigError as exc:
            policy, pollers = "?", str(exc)
        rows.append((name, policy, pollers, gatherer_stats(name)))
    rows.sort(key=lambda r: r[3].get("last") or "", reverse=True)
    print(f"gatherers in {root}:")
    width = max(len(r[0]) for r in rows)
    for name, policy, pollers, stats in rows:
        if "error" in stats:
            about = f"database unreadable: {stats['error']}"
        elif not stats:
            about = "no database yet"
        else:
            seen = ", ".join(f"{n} {c}" for n, c in stats["properties"].items() if c) or "-"
            last = (stats["last"] or "")[:16].replace("T", " ")
            about = f"{stats['events']} events, last {last or '-'} UTC; distinct {seen}"
        print(f"  {name:{width}s}  {policy:14s} pollers: {pollers:14s} {about}")
    return 0


def cmd_show(h, gatherer: str) -> int:
    cfg = h.gatherer(gatherer, create=False)
    print(f"gatherer:    {gatherer}\nconfig:  {cfg.path}\ndatabase: {paths.db_path(gatherer)}"
          f"{'' if os.path.exists(paths.db_path(gatherer)) else '  (not yet)'}")
    print(f"policy:  {cfg.policy}" + (f"  (read with {h.locked_policy(gatherer)})" if h.locked_policy(gatherer) else ""))
    if cfg.options:
        print(f"options: {cfg.options}")
    known = h.pollers()
    print("pollers:")
    for name in cfg.pollers:
        spec = known.get(name)
        print(f"  {name:18s} " + (f"{spec.origin}  args: {spec.args}" if spec else "NOT KNOWN"))
    return 0


def cmd_new(h, gatherer: str, policy, pollers, force: bool, none: bool = False) -> int:
    path = h.gatherer_path(gatherer)
    if os.path.exists(path) and not force:
        print(f"{path} exists (--force to replace it)", file=sys.stderr)
        return 1
    policy = policy or h.default_policy()
    spec = h.policies().get(policy)
    if spec is None:
        print(f"no policy {policy!r}; `list` shows them", file=sys.stderr)
        return 1
    chosen = [] if none else (list(pollers) if pollers else h.default_pollers())
    unknown = [p for p in chosen if p not in h.pollers()]
    if unknown:
        print(f"no poller {', '.join(unknown)}; `list` shows them", file=sys.stderr)
        return 1
    h.write_gatherer(GathererConfig(gatherer, policy, chosen, {}, path))
    print(path)
    return 0


def contract(h, gatherer, policy, pollers, none: bool = False) -> dict:
    """What a run takes: the policy -- the gatherer's, if it exists, else
    `policy` or the default -- its event types (with their properties), and
    the outputs of each poller, and the properties each sets
    (`pollers`, else the gatherer's, else [pollers] default)."""
    cfg = h.gatherer(gatherer, create=False) if gatherer and os.path.exists(h.gatherer_path(gatherer)) else None
    policy = policy or (cfg.policy if cfg else h.default_policy())
    spec = h.policies().get(policy)
    if spec is None:
        raise ConfigError(f"no policy {policy!r}; `list` shows them")
    names = [] if none else (list(pollers) if pollers else (list(cfg.pollers) if cfg else h.default_pollers()))
    source = "given" if (none or pollers) else ("gatherer" if cfg else "default")
    known = h.pollers()
    unknown = [p for p in names if p not in known]
    if unknown:
        raise ConfigError(f"no poller {', '.join(unknown)}; `list` shows them")
    return {"policy": policy,
            "event_types": [{"name": t.name, "properties": [{"name": p.name, "required": p.required,
                                                             "identifies": p.identifies}
                                                            for p in t.properties]}
                            for t in h.policy_class(spec).event_types],
            "pollers": {name: list(h.poller_class(known[name]).outputs) for name in names},
            "poller_properties": {name: list(getattr(h.poller_class(known[name]), "properties", ()))
                                  for name in names},
            "pollers_from": source,                                   # given, the gatherer's, or [pollers] default
            "model": h.model(),                                       # the LLM's; "": none set
            "llm_problem": h.llm_problem()}                           # why it cannot run here; "": none
def cmd_model(h, model, api_base, key_env) -> int:
    """[policies.llm]: set what is given (a flag left out stays; "" removes it), then
    show it, and what overrides it from the environment."""
    if model is not None and not model.strip():
        print("the model cannot be empty: name one, e.g. gemini/gemini-3.8-flash", file=sys.stderr)
        return 1
    if (model, api_base, key_env) != (None, None, None):
        h.set_llm(model, api_base, key_env)
    cfg = h._llm_config()
    base = h.api_base_of(cfg.get("api_base") or cfg.get("url"))
    key_env = str(cfg.get("key_env") or ("LITELLM_KEY" if cfg.get("url") else ""))
    print(f"model:     {cfg.get('model') or '(none set: every call fails until one is)'}")
    cli = str(cfg.get("model") or "").partition("/")[0]
    if cli in CLI_MODELS and not cfg.get("class"):
        command = str(cfg.get(f"{cli.replace('-code', '')}_command") or ("claude" if cli == "claude-code" else "codex"))
        found = shutil.which(command)
        if cli == "codex":
            sdk = importlib.util.find_spec("openai_codex") is not None
            print(f"runs:      {command} ({found or 'NOT FOUND on PATH'}), kept running, through the Codex SDK "
                  f"({'installed' if sdk else 'NOT INSTALLED: pip install openai-codex'})")
        else:
            print(f"runs:      {command} ({found or 'NOT FOUND on PATH'}), headless, once per call")
        print(f"login:     {command}'s own -- a subscription's calls count against its limits")
        if base or key_env:
            print("note:      api_base and key_env are not used by this model")
    else:
        print("api_base:  " + (base or "(the provider's own API)"))
        print("key:       " + (f"${key_env} ({'set' if os.environ.get(key_env) else 'NOT SET'})" if key_env
                               else "the provider's own variable (e.g. GEMINI_API_KEY)"))
    if cfg.get("class"):
        print(f"class:     {cfg['class']}")
    print(f"config:    {h.config_path}")
    for var, what in (("AG_LLM_MODEL", "model"), ("AG_LLM_URL", "api_base"), ("AG_LLM_KEY", "key")):
        if os.environ.get(var):
            print(f"note:      {var} is set and overrides the {what} here")
    model = cfg.get("model") or ""
    if model and "/" not in model and not base:
        print(f"note:      {model!r} names no provider; expected provider/model, e.g. gemini/{model} "
              f"(LiteLLM), or claude-code/{model} or codex/{model} (a CLI, on its login)")
    return 0


def cmd_claim(gatherer: str, session: str, pid: int, by: str) -> int:
    """Process `pid` opens `session` in `gatherer`'s database -- made if there is none yet -- unless
    another running process has it: {"claimed": true}, or {"claimed": false, "holder": {...}} (exit 3);
    {"claimed": null} when the process cannot be told (no /proc): nothing is recorded."""
    from ..store import operations
    from ..store.notify import notify
    from ..store.processes import identity
    process = identity(pid)
    if process is None:
        print(json.dumps({"claimed": None}))
        return 0
    got = operations.claim(schema.connect(gatherer), session, process, by)
    if got["claimed"]:
        notify(gatherer, "open")
    print(json.dumps(got))
    return 0 if got["claimed"] else 3


def cmd_hold(gatherer: str, session: str, pid: int, yields: bool) -> int:
    """Process `pid`, which has `session` open, yields to another's claim or not (`operations.hold`):
    exit 0 while it has the session, 3 once another took it (or it never had it)."""
    from ..store import operations
    from ..store.notify import notify
    from ..store.processes import identity
    process = identity(pid)
    if process is None or not os.path.exists(paths.db_path(gatherer)):
        return 3
    kept = operations.hold(schema.connect(gatherer), session, process, yields)
    if kept:
        notify(gatherer, "open")
    return 0 if kept else 3


def cmd_complete(h, purpose: str, system: str, effort: str, timeout: float, as_json: bool) -> int:
    """The Gatherer's model, [policies.llm]'s, asked once with the prompt on stdin, the call logged
    with the policies' own (and put to the job AG_JOB names). A client never raises: a failed call
    answers "", and its error is read back from the call's own record in the log."""
    prompt = sys.stdin.read()
    model, error, text = h.model(), "", ""
    if not prompt.strip():
        error = "no prompt: give it on stdin"
    else:
        error = h.llm_problem()
    if not error:
        text = h.llm().complete(prompt, system=system or None, model=model, effort=effort, timeout=timeout,
                                purpose=purpose)
        if not text.strip():
            error = logged_error(h.root, purpose) or "the model answered nothing"
    if as_json:
        print(json.dumps({"text": text, "model": model, "error": error}))
    elif text:
        print(text)
    if error and not as_json:
        print(error, file=sys.stderr)
    return 1 if error else 0


def cmd_build(h, gatherer: str, properties: str, min_messages: int) -> int:
    """A build the reader asked for: started in the background, not waited for (the policy's
    `requested`), for the events `properties` (a JSON object, in the policy's own names) name; what
    came of it on stdout, as JSON. Exit 1 when the gatherer has no database, or the properties do not
    read as an object."""
    try:
        props = json.loads(properties or "{}")
    except ValueError:
        props = None
    if not isinstance(props, dict):
        print(json.dumps({"error": "--properties is a JSON object"}))
        return 1
    if not os.path.exists(paths.db_path(gatherer)):
        print(json.dumps({"error": f"no database for gatherer {gatherer}"}))
        return 1
    manager = h.manager(gatherer)
    manager.init(gatherer)
    print(json.dumps(manager.requested(gatherer, properties=props, min_messages=min_messages)))
    return 0


def cmd_insert(h, gatherer: str, properties: str, events: str) -> int:
    """Events put into the gatherer -- a reader's record of what it did (the dashboard's: a name it gave an actor),
    as the server's `insert` takes a harness's: each {"type", "payload", "id"?, "text"?, "properties"?}, with
    `properties` (a JSON object, in the policy's own names); a type the gatherer does not have is added. Each one's
    row on stdout, as JSON: {"rows": [row id, or null when it was stored already]}. Exit 1 when the gatherer has no
    database, or an argument does not read, or an event is not one."""
    from ..server import BadEvent, Server
    try:
        props, given = json.loads(properties or "{}"), json.loads(events or "[]")
    except ValueError:
        props = given = None
    if not isinstance(props, dict) or not isinstance(given, list):
        print(json.dumps({"error": "--properties is a JSON object, --events a JSON list"}))
        return 1
    if not os.path.exists(paths.db_path(gatherer)):         # not made here: a misspelled name would make one
        print(json.dumps({"error": f"no database for gatherer {gatherer}"}))
        return 1
    manager = h.manager(gatherer)
    manager.init(gatherer)
    try:
        rows = [manager.insert(gatherer, e) for e in Server.events_of(manager, gatherer, given, props)]
    except (BadEvent, TypeError, LookupError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}))
        return 1
    print(json.dumps({"rows": rows}))
    return 0


def cmd_migrate(h, gatherers, vacuum: bool, now: bool = False) -> int:
    """Each gatherer's file moved to the current layout (store/migrate.py): those named, else every one due. One run
    at a time in a home: another that finds it running leaves it to it."""
    import fcntl
    from ..store import migrate
    h.ensure()
    with open(os.path.join(h.root, "migrate.lock"), "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            print("another `ag home migrate` is running in this home", flush=True)
            return 0
        names = gatherers or [g for g in (sorted(os.listdir(paths.TRACE_DIR)) if os.path.isdir(paths.TRACE_DIR) else [])
                              if migrate.due(paths.db_path(g))]
        failed = 0
        for g in names:
            try:
                print(migrate.said(migrate.migrate(g, vacuum=vacuum, now=now)), flush=True)
            except Exception as exc:  # noqa: BLE001 - the next gatherer's is still to do
                print(f"{g}: failed: {exc!r}", flush=True)
                failed += 1
        return 1 if failed else 0


def logged_error(root: str, purpose: str) -> str:
    """The error this process's last call for `purpose` logged (CallLog names each record after the
    process and the purpose), or "" when it logged none."""
    folder = os.path.join(root, "logs", "llm")
    mine = sorted(n for n in os.listdir(folder) if f"-{os.getpid()}-" in n and n.endswith(f"-{purpose}.json")) \
        if os.path.isdir(folder) else []
    if not mine:
        return ""
    try:
        with open(os.path.join(folder, mine[-1]), encoding="utf-8") as fh:
            return str(json.load(fh).get("error") or "")
    except (OSError, ValueError):
        return ""


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m ag.ag_harness.home")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("path")
    sub.add_parser("list")
    sub.add_parser("gatherers")
    show = sub.add_parser("show")
    show.add_argument("gatherer")
    new = sub.add_parser("new")
    new.add_argument("gatherer")
    new.add_argument("--policy")
    new.add_argument("--poller", action="append", default=[])
    new.add_argument("--no-pollers", action="store_true")
    new.add_argument("--force", action="store_true")
    mod = sub.add_parser("model")
    mod.add_argument("model", nargs="?")
    mod.add_argument("--api-base", help='send every call to this server ("": the provider\'s own API)')
    mod.add_argument("--key-env", help='read the key from this variable ("": the provider\'s own)')
    con = sub.add_parser("contract")
    con.add_argument("--gatherer")
    con.add_argument("--policy")
    con.add_argument("--poller", action="append", default=[])
    con.add_argument("--no-pollers", action="store_true")
    cl = sub.add_parser("claim")
    cl.add_argument("gatherer")
    cl.add_argument("session")
    cl.add_argument("--pid", type=int, required=True)
    cl.add_argument("--by", default="launcher")
    ho = sub.add_parser("hold")
    ho.add_argument("gatherer")
    ho.add_argument("session")
    ho.add_argument("--pid", type=int, required=True)
    yields = ho.add_mutually_exclusive_group(required=True)
    yields.add_argument("--yields", action="store_true")
    yields.add_argument("--keeps", action="store_true")
    ins = sub.add_parser("insert")
    ins.add_argument("gatherer")
    ins.add_argument("--properties", default="{}", help="the events' properties, as a JSON object")
    ins.add_argument("--events", required=True, help='the events, as a JSON list of {"type", "payload", ...}')
    bu = sub.add_parser("build")
    bu.add_argument("gatherer")
    bu.add_argument("--properties", default="{}", help="the events' properties, as a JSON object")
    bu.add_argument("--min-messages", type=int, default=0, help="only with this many user messages since the last build")
    mi = sub.add_parser("migrate")
    mi.add_argument("gatherer", nargs="*")
    mi.add_argument("--no-vacuum", action="store_true", help="keep the space freed in the file (ag fills it first)")
    mi.add_argument("--now", action="store_true", help="move the read log without waiting for an older ag to stop")
    co = sub.add_parser("complete")
    co.add_argument("--purpose", default="ask", help="the call's name in the call log")
    co.add_argument("--system", default="", help="the system message")
    co.add_argument("--effort", default="", help="reasoning effort (low, medium, high, ...): the model's own when not given")
    co.add_argument("--timeout", type=float, default=900)
    co.add_argument("--json", action="store_true", help='print {"text", "model", "error"}')
    a = ap.parse_args(argv)
    h = home()
    try:
        if a.cmd == "path":
            h.ensure()
            print(h.root)
            return 0
        if a.cmd == "list":
            return cmd_list(h)
        if a.cmd == "gatherers":
            return cmd_gatherers(h)
        if a.cmd == "migrate":
            return cmd_migrate(h, a.gatherer, not a.no_vacuum, a.now)
        if a.cmd == "contract":
            print(json.dumps(contract(h, a.gatherer, a.policy, a.poller, a.no_pollers)))
            return 0
        if a.cmd == "hold":
            return cmd_hold(a.gatherer, a.session, a.pid, a.yields)
        if a.cmd == "claim":
            return cmd_claim(a.gatherer, a.session, a.pid, a.by)
        if a.cmd == "show":
            return cmd_show(h, a.gatherer)
        if a.cmd == "model":
            return cmd_model(h, a.model, a.api_base, a.key_env)
        if a.cmd == "insert":
            return cmd_insert(h, a.gatherer, a.properties, a.events)
        if a.cmd == "build":
            return cmd_build(h, a.gatherer, a.properties, a.min_messages)
        if a.cmd == "complete":
            return cmd_complete(h, a.purpose, a.system, a.effort, a.timeout, a.json)
        return cmd_new(h, a.gatherer, a.policy, a.poller, a.force, a.no_pollers)
    except ConfigError as exc:
        print(exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
