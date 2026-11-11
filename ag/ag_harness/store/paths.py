"""Where a gatherer's database lives.

Every gatherer has a directory of its own in the context manager's home,
`~/.ag/gatherers/<gatherer>/` (AG_HOME moves the home), holding its database
`context.db` and its config `gatherer.toml`; its logs are under the home's
`logs/`, in `logs/gatherers/<gatherer>/`. Callers name gatherers; only this
module knows files.

Once the home has ONE database for every gatherer, `context.db` in the home
itself (`home_db`, made by `ag home merge`), every gatherer's database is that
one (`merged`): a gatherer is then a group of its channels -- those whose
latest `group` record names it -- and its directory keeps its config alone.
"""

import os
import re

#: The context manager's home: gatherers, configs, plugins. AG_HOME overrides it;
#: read once, at import, so a background worker (which inherits the
#: environment) finds the same files.
AG_HOME = os.path.abspath(os.path.expanduser(os.environ.get("AG_HOME") or "~/.ag"))

# A module attribute rather than a parameter, so a test can point it elsewhere
# without every call carrying a path.
TRACE_DIR = os.path.join(AG_HOME, "gatherers")

_UNSAFE = re.compile(r"[^A-Za-z0-9._-]")


def gatherer_key(gatherer_id: str) -> str:
    """The name of `gatherer_id`'s directory: characters unsafe in a file name
    become `_`; an empty id maps to `unknown`."""
    key = _UNSAFE.sub("_", (gatherer_id or "").strip())
    return "unknown" if key in ("", ".", "..") else key


def gatherer_dir(gatherer_id: str) -> str:
    """The directory of `gatherer_id`: its database and config."""
    return os.path.join(TRACE_DIR, gatherer_key(gatherer_id))


def home_db() -> str:
    """The home's one database, beside the gatherers' directories (`merged`)."""
    return os.path.join(os.path.dirname(TRACE_DIR), "context.db")


def merged() -> bool:
    """Whether every gatherer's work is in the home's one database (`home_db`): once it exists, and from then on."""
    return os.path.isfile(home_db())


def db_path(gatherer_id: str) -> str:
    """The database for `gatherer_id`: the home's one database once there is one (`merged`), else its own."""
    return home_db() if merged() else os.path.join(gatherer_dir(gatherer_id), "context.db")


def log_dir() -> str:
    """The home's logs: every log the context manager and its harnesses write.
    Beside the gatherers, so the two are always in the same home (a test that
    points TRACE_DIR elsewhere gets its logs there too)."""
    return os.path.join(os.path.dirname(TRACE_DIR), "logs")


def gatherer_log_dir(gatherer_id: str) -> str:
    """`gatherer_id`'s logs: server.log (what each request came to) and
    worker.log (its background builds)."""
    return os.path.join(log_dir(), "gatherers", gatherer_key(gatherer_id))


def server_log(gatherer_id: str) -> str:
    return os.path.join(gatherer_log_dir(gatherer_id), "server.log")


def worker_log(gatherer_id: str) -> str:
    return os.path.join(gatherer_log_dir(gatherer_id), "worker.log")
