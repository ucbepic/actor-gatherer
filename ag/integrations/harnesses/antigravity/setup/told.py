"""A run's instructions for agy (harness_kit's `instruction_args`): agy has no option that adds to its instructions, so
ag's launcher takes them (`--append-system-prompt`, not passed on) and keeps them here, by the run (the launcher's
process, which execs agy: the /r/<run>/ of the URL agy is pointed at); agy's hook adds them after the system
instruction of each of the run's calls.

    <home>/runs/antigravity/<run>.txt

A run's file stays while its process does; the next launch clears those whose process is gone (`tidy`). The hook
reads them (ag_orchestrator/told.py, which has its own copy of `path`: the two sides share nothing else).
"""

import os


def path(home: str, run: str) -> str:
    return os.path.join(home, "runs", "antigravity", f"{run}.txt")


def keep(home: str, run: str, text: str) -> None:
    """`text` kept as the run's instructions."""
    p = path(home, run)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p + ".tmp", "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(p + ".tmp", p)


def tidy(home: str) -> None:
    """The instructions of runs whose process is gone, removed."""
    folder = os.path.dirname(path(home, "0"))
    try:
        names = os.listdir(folder)
    except OSError:
        return
    for name in names:
        run = name[:-len(".txt")] if name.endswith(".txt") else None
        if not run or not run.isdigit():
            continue
        try:
            os.kill(int(run), 0)
        except ProcessLookupError:
            try:
                os.remove(os.path.join(folder, name))
            except OSError:
                pass
        except OSError:
            pass                                       # another user's process: still there
