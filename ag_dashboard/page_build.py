"""The dashboard's page, built from frontend/ (Vite, ag_dashboard/DESIGN.md) into static/ -- in a checkout of the
repository only, as ag from PyPI comes with it built. Built by `ag dashboard` when it starts and the page is
missing or older than frontend/ (the first start, a pull), so only those who use the dashboard need Node; by a
wheel built from a checkout (setup.py); and by hand: `python -m ag_dashboard.page_build`.

The standard library only, and nothing of the package: setup.py loads this file by its path, before anything is
installed."""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Callable, List, Optional

try:
    import fcntl
except ImportError:                                  # (Windows: one build at a time is not kept)
    fcntl = None

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")                # the build (vite.config.ts's outDir), which the package ships
INDEX = os.path.join(STATIC, "index.html")
FRONT = os.path.join(os.path.dirname(HERE), "frontend")   # in a checkout only
COMMAND = "python -m ag_dashboard.page_build"        # what a person runs to build it
SOURCES = ("src", "index.html", "package.json", "pnpm-lock.yaml", "vite.config.ts", "vite-plugin-legacy.ts")
NODE = ((20, 19), (22, 12))                          # Vite's: ^20.19 || >=22.12
NODE_SAID = "Node.js 22.12 or newer"
TAIL = 30                                            # the lines of a failed step's output told


class BuildError(Exception):
    """The page could not be built: why, said for a person."""


class NoTools(BuildError):
    """No Node to build it with, or none new enough, or no way to run pnpm."""


def checkout() -> bool:
    """Whether this is a checkout of the repository, with the page's source beside the package."""
    return os.path.isfile(os.path.join(FRONT, "package.json"))


def _newest() -> float:
    """When the page's source last changed."""
    newest = 0.0
    for name in SOURCES:
        path = os.path.join(FRONT, name)
        if os.path.isdir(path):
            for d, _, files in os.walk(path):
                for f in files:
                    newest = max(newest, os.path.getmtime(os.path.join(d, f)))
        elif os.path.exists(path):
            newest = max(newest, os.path.getmtime(path))
    return newest


def wrong() -> Optional[str]:
    """What is wrong with the build: None, nothing (or, outside a checkout, nothing to compare it with)."""
    if not os.path.exists(INDEX):
        return "the dashboard's page is not built"
    if checkout() and _newest() > os.path.getmtime(INDEX):
        return "the dashboard's page is older than its source in frontend/"
    return None


def _node_ok(text: str) -> bool:
    m = re.match(r"v?(\d+)\.(\d+)", text.strip())
    if not m:
        return False
    have = (int(m.group(1)), int(m.group(2)))
    return any(have[0] == want[0] and have >= want for want in NODE) or have[0] > NODE[-1][0]


def pnpm() -> List[str]:
    """How pnpm is run here: Node's corepack (the version frontend/package.json names), a pnpm of one's own, else npx
    fetching that version."""
    node = shutil.which("node")
    if not node:
        raise NoTools(f"building the dashboard's page from source needs {NODE_SAID} (https://nodejs.org, or "
                         "`brew install node`), and none is on PATH. (`pip install actor-gatherer` installs ag with "
                         "its page built, no Node needed.)")
    try:
        version = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        version = ""
    if not _node_ok(version):
        raise NoTools(f"building the dashboard's page needs {NODE_SAID}; this one is {version.strip() or 'unknown'}")
    # Each by its full path: on Windows these are .cmd files, which subprocess can't start by a bare name
    if shutil.which("corepack"):
        return [shutil.which("corepack"), "pnpm"]
    if shutil.which("pnpm"):
        return [shutil.which("pnpm")]
    if shutil.which("npx"):
        with open(os.path.join(FRONT, "package.json"), encoding="utf-8") as fh:
            named = json.load(fh).get("packageManager") or "pnpm"
        return [shutil.which("npx"), "--yes", named.split("+")[0]]
    raise NoTools("building the dashboard's page needs pnpm: Node's corepack, pnpm or npx, and none is on PATH")


def build(quiet: bool = False) -> None:
    """Builds it: frontend/'s packages installed as its lockfile has them, then Vite's build into static/. `quiet`:
    what the steps print kept back, and told only if one fails. One build at a time, for every process."""
    if not checkout():
        raise BuildError(f"there is no frontend/ beside {HERE} to build the page from")
    run = pnpm()
    env = dict(os.environ, COREPACK_ENABLE_DOWNLOAD_PROMPT="0")
    with _one_at_a_time():
        for step in (["install", "--frozen-lockfile"], ["build"]):
            out = subprocess.run(run + step, cwd=FRONT, env=env, text=True, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE if quiet else None,
                                 stderr=subprocess.STDOUT if quiet else None)
            if out.returncode:
                said = "\n".join((out.stdout or "").rstrip().splitlines()[-TAIL:])
                raise BuildError(f"`{' '.join(run + step)}` in {FRONT} failed (exit {out.returncode})"
                                 + (f":\n{said}" if said else ""))


class _one_at_a_time:
    """A lock on this checkout's build, so two dashboards starting at once don't build into static/ together."""

    def __enter__(self):
        self.fh = None
        if fcntl is not None:
            name = "ag-page-build-" + re.sub(r"\W", "_", os.path.realpath(FRONT))[-120:] + ".lock"
            self.fh = open(os.path.join(tempfile.gettempdir(), name), "w")
            fcntl.flock(self.fh, fcntl.LOCK_EX)
        return self

    def __exit__(self, *exc):
        if self.fh is not None:
            fcntl.flock(self.fh, fcntl.LOCK_UN)
            self.fh.close()


def ensure(say: Callable[[str], None]) -> None:
    """In a checkout, the page built if it is missing or older than frontend/ (after a pull), saying so; a build that
    fails said too, and left for what serves the page to tell (server.py's `built`). The first build shows its
    steps, as installing frontend/'s packages can take a minute; a build again after a pull is quiet."""
    why = wrong()
    if not why or not checkout():
        return
    first = not os.path.exists(INDEX)
    say(f"{why}: building it" + (" (the first time: frontend/'s packages are installed first)" if first else ""))
    try:
        build(quiet=not first)
    except BuildError as exc:
        say(str(exc))


def main(argv: Optional[List[str]] = None) -> int:
    """`python -m ag_dashboard.page_build [--if-needed]`: builds the page (with --if-needed, only if it is missing or
    older than frontend/)."""
    args = sys.argv[1:] if argv is None else argv
    if "--if-needed" in args and not wrong():
        print("the dashboard's page is built and up to date")
        return 0
    try:
        build()
    except BuildError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"built the dashboard's page into {STATIC}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
