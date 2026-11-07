"""A home for the dashboard's browser tests (frontend/e2e/): its gatherer `demo` holds a Claude Code actor and a Codex
actor, each the longest conversation of its harness's newest recorded session (tests/fixtures/harnesses/), stored
through the calls ag's hooks make -- the conversation rewritten, the model call recorded, a recap and a name -- with
the clock held at AT, so every run stores the same times; and the dashboard served with its clock an hour
after (NOW), as the tests hold the page's, so every run draws the same page.

    python tests/web_home.py HOME            build it at HOME (a folder that does not exist yet)
    python tests/web_home.py --serve PORT    build one in a temporary folder and run the dashboard on it, at PORT,
                                             until stopped (frontend/playwright.config.ts starts it so)
    python tests/web_home.py --snapshot FILE build one, and write the page with its data inside it to FILE
"""
import argparse
import datetime
import io
import itertools
import json
import os
import random
import shlex
import shutil
import sys
import tempfile
import time
import unittest.mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

FIXTURES = os.path.join(ROOT, "tests", "fixtures", "harnesses")
AT = 1790874000                 # 2026-10-01 17:00 UTC: when the sessions were stored
NOW = AT + 3600                 # when the tests run, as the served dashboard's clock and the page's say
GATHERER = "demo"
CWD = "/w/demo"
#: The actors: (channel, harness, the fixture's version, its adaptor, its name or None, its recap or None).
ACTORS = (
    ("5f0c2a2e-8d1b-4c7e-9a3f-1b2c3d4e5f60", "claude", "2.1.314", "claude",
     "Parser fixes", "Fixed the CSV parser's quoting and added tests; a plan for streaming input waits for approval."),
    ("019a1f2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b", "codex", "0.164.0", "codex", None, None),
)


def _adaptor(name):
    if name == "claude":
        from ag.integrations.harnesses.claude.adaptor.adaptor import ClaudeAdaptor
        return ClaudeAdaptor()
    from ag.integrations.harnesses.codex.adaptor.adaptor import CodexAdaptor
    return CodexAdaptor()


def _answered(history: list) -> list:
    """The history up to the probe's failing call (its last step: a request the model never answered), so each
    actor's latest turn is over and the page shows it done, not at work."""
    at = next((i for i, item in enumerate(history) if "PROBE-API-ERROR" in json.dumps(item)), len(history))
    return history[:at]


def build(home: str) -> str:
    """The home, made at `home`."""
    from ag.ag_harness import home as ag_home
    from ag.ag_harness.server import serve
    from ag.ag_harness.server.__main__ import server_for
    from ag.ag_harness.store import paths
    from ag.integrations.tools.ag_orchestrator import records

    os.makedirs(home)
    paths.AG_HOME = home
    paths.TRACE_DIR = os.path.join(home, "gatherers")
    ag_home._HOMES.clear()
    os.makedirs(os.path.join(paths.TRACE_DIR, GATHERER))
    with open(os.path.join(paths.TRACE_DIR, GATHERER, "gatherer.toml"), "w") as fh:
        fh.write('policy = "proactive_context_manager"\n')
    server = server_for()
    ids = itertools.count(1)

    def ask(request):
        out = io.StringIO()
        serve(server, [json.dumps(dict(request, id=next(ids)))], out)
        got = [json.loads(line) for line in out.getvalue().splitlines()]
        if not got or "error" in got[0]:
            raise RuntimeError(f"{request.get('op')}: {got}")
        return got[0]

    clock = itertools.count()

    def now() -> float:                                 # a quarter second on for each time asked, from AT
        return AT + next(clock) * 0.25

    def stamp() -> str:                                 # the store's own clock (operations._now)
        return datetime.datetime.fromtimestamp(now(), datetime.timezone.utc).isoformat()

    with unittest.mock.patch("time.time", now), \
            unittest.mock.patch("ag.ag_harness.store.operations._now", stamp):
        for channel, harness, version, adaptor, name, recap in ACTORS:
            with open(os.path.join(FIXTURES, harness, version, "conversation.json"), encoding="utf-8") as fh:
                history = _answered(json.load(fh)["history"])
            props = {"channel": channel}
            got = ask({"op": "rewrite", "gatherer": GATHERER, "properties": props, "cwd": CWD,
                       "events": _adaptor(adaptor).to_events(history)})
            said = [records.model_call("turn", harness, version, got.get("read_id"))]
            if recap:
                said.append(records.recap(recap))
            if name:
                said.append(records.name(name, "user"))
            ask({"op": "insert", "gatherer": GATHERER, "properties": props, "events": said})
    from ag_dashboard import settings                   # a model set, as `ag model` sets it: else the page opens
    cfg = os.path.join(home, "config.toml")             # its settings by itself, to ask for one
    with open(cfg, encoding="utf-8") as fh:
        text = fh.read()
    with open(cfg, "w", encoding="utf-8") as fh:
        fh.write(settings.set_key(text, "policies.llm", "model", "claude-code/sonnet"))
    from ag_dashboard import avatars, data              # each actor's avatar given now, and the line it says chosen
    from ag_dashboard import home as dashboard_home     # by a fixed seed: the dashboard keeps them, not choosing anew
    dashboard_home.HOME = home
    random.seed(0)
    avatars.assign(data.home([]))
    return home


def serve_at(port: int) -> None:
    """A home built in a temporary folder, and the dashboard on it at `port` until stopped; the folder removed then."""
    import faulthandler
    import signal
    faulthandler.register(signal.SIGUSR1, all_threads=True)   # `kill -USR1 <pid>`: every thread's stack, on stderr
    for name in ("ANTHROPIC_BASE_URL", "AG_ACTOR", "AG_DASHBOARD"):     # never this session's own
        os.environ.pop(name, None)
    # ag run from this checkout (the apps' host inserts through `ag home insert`), and the test apps found (tests/apps/)
    os.environ.setdefault("AG_COMMAND", f"{shlex.quote(sys.executable)} {shlex.quote(os.path.join(ROOT, 'ag', 'cli', 'ag'))}")
    os.environ.setdefault("AG_APPS_PATH", os.path.join(ROOT, "tests", "apps"))
    tmp = tempfile.mkdtemp(prefix="ag-web-home-")
    try:
        home = build(os.path.join(tmp, "ag"))
        os.environ["AG_HOME"] = home
        from ag_dashboard.__main__ import main
        real = time.time
        shift = real() - NOW                            # the server's clock starts at NOW, as the page's is held
        with unittest.mock.patch("time.time", lambda: real() - shift):
            main(["--home", home, "--port", str(port), "--no-open"])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def snapshot_to(out: str) -> None:
    """The page with a home's data inside it (`ag-dashboard --out`), written to `out`, as at NOW."""
    tmp = tempfile.mkdtemp(prefix="ag-web-home-")
    try:
        build(os.path.join(tmp, "ag"))
        from ag_dashboard import data, server
        with unittest.mock.patch("time.time", lambda: NOW):
            text = server.page(data.snapshot())
        with open(out, "w", encoding="utf-8") as fh:
            fh.write(text)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("home", nargs="?")
    ap.add_argument("--serve", type=int, metavar="PORT")
    ap.add_argument("--snapshot", metavar="FILE", help="write the page with a home's data inside it to FILE")
    a = ap.parse_args()
    if a.serve:
        serve_at(a.serve)
    elif a.snapshot:
        snapshot_to(a.snapshot)
    elif a.home:
        print(build(os.path.abspath(a.home)))
    else:
        ap.error("HOME, --serve PORT or --snapshot FILE")
