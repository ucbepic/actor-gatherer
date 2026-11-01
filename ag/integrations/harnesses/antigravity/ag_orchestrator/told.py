"""A run's instructions for agy, as agy's hook reads them: kept by ag's launcher (setup/told.py, whose `path` this
copies), by the run -- the /r/<run>/ of the URL agy is pointed at -- and added after the system instruction of each of
the run's calls."""

import os
from typing import Dict, Optional, Tuple


def path(home: str, run: str) -> str:
    return os.path.join(home, "runs", "antigravity", f"{run}.txt")


class Told:
    """The runs' instructions as the hook reads them: each file read again only once it changed."""

    def __init__(self, home: Optional[str]):
        self.home = home
        self.kept: Dict[str, Tuple[int, Optional[str]]] = {}      # run -> (its file's mtime, its text)

    def of(self, run: Optional[str]) -> Optional[str]:
        """The run's instructions, None when it has none."""
        if not self.home or not run:
            return None
        p = path(self.home, str(run))
        try:
            mtime = os.stat(p).st_mtime_ns
        except OSError:
            self.kept.pop(str(run), None)
            return None
        got = self.kept.get(str(run))
        if got is None or got[0] != mtime:
            try:
                with open(p, encoding="utf-8") as fh:
                    got = (mtime, fh.read() or None)
            except OSError:
                return None
            self.kept[str(run)] = got
        return got[1]
