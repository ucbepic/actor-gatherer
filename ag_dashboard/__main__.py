"""`python -m ag_dashboard [--home DIR] [--host H] [--port N] [--open] [--out FILE] [--routes] [--openapi]` (or `ag`,
`ag dashboard`): the page on localhost until interrupted (Ctrl-C, SIGTERM or SIGHUP: each one stops it the same
way, removing its socket in the home's listeners/), or, with --out, written to FILE with its
data inside it. With --open (as `ag` runs it), the page is also opened in the browser -- the one
already on that port, if it is this home's dashboard. With --routes, the server's routes are listed instead: each
one's methods, path, and the first paragraph of its handler's docstring (what it answers); with --openapi, their
OpenAPI schema, as JSON (what frontend/scripts/gen-types.mjs makes the page's types of)."""

import argparse
import errno
import importlib.util
import os
import signal
import sys
import webbrowser
from typing import List, Optional

from . import data, home, live, page_build, server

NEEDED = ["fastapi", "uvicorn", "sse_starlette"]   # what of pyproject.toml's `dashboard` extra it can't start without
                                                  # (pycrdt it can: the Editor is left out), missing when ag is alone


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="ag dashboard", description="Start, talk to and watch your agents in the browser.",
                                 epilog="ag dashboard restart: stop the home's dashboard and start it again, on the code "
                                        "now on disk (`ag dashboard restart --help`).")
    ap.add_argument("--home", help="the context manager's home (default: AG_HOME, or ~/.ag)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=4200)
    ap.add_argument("--open", action=argparse.BooleanOptionalAction, default=False,
                    help="open the page in the browser (`ag` does; --no-open: not)")
    ap.add_argument("--out", help="write the page, its data inside it, to this file and stop")
    ap.add_argument("--routes", action="store_true", help="list the server's routes, each with what it answers, and stop")
    ap.add_argument("--openapi", action="store_true", help="write the routes' OpenAPI schema, as JSON, and stop")
    args = ap.parse_args(argv)
    missing = [name for name in NEEDED if importlib.util.find_spec(name) is None]
    if missing:
        print(f"ag dashboard: the dashboard's packages are not installed ({', '.join(missing)} missing): "
              "pip install 'actor-gatherer[dashboard]', or from a checkout: pip install -e '.[dashboard]'",
              file=sys.stderr)
        return 1
    if args.routes:
        from . import app
        listed = app.routes()
        width = max(len(m) for m, _, _ in listed), max(len(p) for _, p, _ in listed)
        for methods, path, doc in listed:
            print(f"{methods:<{width[0]}}  {path:<{width[1]}}  {doc}")
        return 0
    if args.openapi:
        import json
        from . import app
        print(json.dumps(app.schema(), indent=1, ensure_ascii=False))
        return 0
    if args.home:
        home.HOME = os.path.abspath(os.path.expanduser(args.home))
    page_build.ensure(lambda said: print(f"ag dashboard: {said}", file=sys.stderr))   # built, in a checkout, if it
    wrong = server.built()                         # is missing or older than frontend/ (a pull); else what is wrong
    if wrong:
        print(f"ag dashboard: {wrong}", file=sys.stderr)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(server.page(data.snapshot()))
        print(f"wrote {os.path.abspath(args.out)}")
        return 0
    try:
        httpd = server.serve(args.host, args.port)
    except (OSError, ValueError) as exc:
        url = _url(args.host, args.port)
        if args.open and getattr(exc, "errno", None) == errno.EADDRINUSE and _serves_this_home(url):
            print(f"dashboard: {url}  (already running, on home {home.HOME})", file=sys.stderr)
            _open(url)
            return 0
        print(f"ag dashboard: cannot listen on {args.host}:{args.port}: {exc}", file=sys.stderr)
        return 1
    stopping = {}
    for name in ("SIGTERM", "SIGHUP"):             # a kill, a closed terminal: stopped as Ctrl-C stops it
        sig = getattr(signal, name, None)          # (Windows has no SIGHUP); before it says it is up
        if sig is not None:
            stopping[sig] = signal.signal(sig, _interrupt)
    try:                                           # a stop from here on, even mid-print, closes it
        updates = "ag's notifications" if httpd.listener and httpd.listener.ok else \
            f"a check of the files every {live.FALLBACK_SECONDS:g}s"
        print(f"dashboard: http://{args.host}:{httpd.server_port}/  (home {home.HOME}; live from {updates}; "
              f"Ctrl-C to stop)", file=sys.stderr)
        if args.open:                              # bound already: the browser's first request waits for it
            _open(_url(args.host, httpd.server_port))
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        for sig, before in stopping.items():
            signal.signal(sig, before)
    return 0


def _interrupt(signum, frame):
    raise KeyboardInterrupt


def _url(host: str, port: int) -> str:
    """The page's address for a browser on this machine: a server on every address is on localhost too."""
    if host in ("", "0.0.0.0", "::"):
        host = "127.0.0.1"
    return f"http://[{host}]:{port}/" if ":" in host else f"http://{host}:{port}/"


def _serves_this_home(url: str) -> bool:
    """Whether the server at `url` is a dashboard of this home (its /api/home says so)."""
    return home.serves(url)


def _open(url: str) -> None:
    """The page in the user's browser, where there is one to show it: on Linux only with a display, since
    without one Python's webbrowser falls back on a text browser that would take over this terminal."""
    if sys.platform.startswith("linux") and not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        print(f"ag dashboard: no display to open a browser on; open {url} yourself", file=sys.stderr)
        return
    try:
        if not webbrowser.open(url):
            print(f"ag dashboard: could not open a browser; open {url} yourself", file=sys.stderr)
    except webbrowser.Error as exc:
        print(f"ag dashboard: could not open a browser ({exc}); open {url} yourself", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
