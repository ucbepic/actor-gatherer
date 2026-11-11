"""A run's instructions for agy (harness_kit's `instruction_args`): agy has no option that adds to its instructions, so
ag's launcher takes them (`--append-system-prompt`, not passed on) and keeps them here, by the run (the launcher's
process, which execs agy: the /r/<run>/ of the URL agy is pointed at); agy's hook adds them after the system
instruction of each of the run's calls.

    <home>/runs/antigravity/<run>.txt

The run's directory is kept the same way, beside them, for the hook to use when agy names none: agy states its
`Command Working Directory:` only when it has a workspace, and run in a folder it does not trust yet, with its first
message given (`--prompt-interactive`), it has none.

    <home>/runs/antigravity/<run>.cwd

A run's files stay while its process does; the next launch clears those whose process is gone (`tidy`). The hook
reads them (ag_orchestrator/told.py, which has its own copy of `path`: the two sides share nothing else).
"""

import os
from typing import Optional

from harness_kit.processes import running


KINDS = ("txt", "cwd")                  # its instructions, its directory


def path(home: str, run: str, kind: str = "txt") -> str:
    return os.path.join(home, "runs", "antigravity", f"{run}.{kind}")


def keep(home: str, run: str, text: Optional[str], kind: str = "txt") -> None:
    """`text` kept as the run's instructions (`kind` "txt") or its directory ("cwd"); None: the run has none (a file
    left by an earlier process of the same id removed)."""
    p = path(home, run, kind)
    if text is None:
        try:
            os.remove(p)
        except OSError:
            pass
        return
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p + ".tmp", "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(p + ".tmp", p)


def tidy(home: str) -> None:
    """The files of runs whose process is gone, removed."""
    folder = os.path.dirname(path(home, "0"))
    try:
        names = os.listdir(folder)
    except OSError:
        return
    for name in names:
        run, _, kind = name.partition(".")
        if kind not in KINDS or not run.isdigit():
            continue
        if not running(int(run)):                      # another user's process counts as still there
            try:
                os.remove(os.path.join(folder, name))
            except OSError:
                pass
