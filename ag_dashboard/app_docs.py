"""The host's files shared live as apps are given them (app_kit.docs's Docs): livedocs.py's documents, the actors'
branches merged into them (branches.py), and an actor's changes to a file (files.py) -- for an app whose manifest asks
`docs`, run in the dashboard's own process (app_host.py's Bound.docs). Each refusal of theirs an AppError, as app_kit
says; the same calls the page made of the dashboard's routes before the Editor became an app."""

import queue
from typing import Dict, List, Optional

from app_kit import AppError, Docs, Joined

from . import files, livedocs


def _app_error(exc: Exception) -> AppError:
    return AppError(str(exc), 400)


class HostDocs(Docs):
    """The dashboard's (module doc): over its LiveDocs, its Branches (None: the server has none) and `ring(gatherer)`,
    which tells the page a gatherer's list changed (an actor's branch's approval is shown there)."""

    def __init__(self, docs: "livedocs.LiveDocs", branches=None, ring=None):
        self._docs, self._branches, self._ring = docs, branches, ring

    def _call(self, f, *args):
        try:
            return f(*args)
        except AppError:
            raise
        except (ValueError, OSError) as exc:        # livedocs.DocError is a ValueError
            raise _app_error(exc) from None

    @property
    def available(self) -> bool:
        return livedocs.AVAILABLE

    # -- the folders

    def listing(self, directory: str, root: str, since: Optional[float] = None) -> dict:
        return self._call(self._docs.listing, directory, root, since)

    def about(self, path: str, root: str) -> dict:
        return self._call(livedocs.about, path, root)

    def create(self, path: str, root: str, folder: bool = False) -> dict:
        return self._call(livedocs.create, path, root, folder)

    def files(self, directory: str, root: str) -> dict:
        return self._call(livedocs.file_list, directory, root)

    def resolve(self, path: str, root: str) -> str:
        return self._call(livedocs.resolve, path, root)

    # -- a file open

    def open(self, path: str, root: str, conn: str, client: int, hold: str = "zone") -> Joined:
        room, joined = self._call(self._docs.join, path, root, conn, client, hold)
        q = joined.queue

        def take(wait: float):
            try:
                item = q.get(timeout=wait)
            except queue.Empty:
                return []
            if item is None:
                return None
            out = [item]
            while True:                             # what else came meanwhile, sent with it
                try:
                    more = q.get_nowait()
                except queue.Empty:
                    return out
                if more is None:
                    q.put(None)                     # the end, after these
                    return out
                out.append(more)

        def close() -> None:
            try:
                room.leave(joined)
            finally:
                q.put(None)
        return Joined(take, close)

    def edit(self, path: str, root: str, conn: str, update: bytes) -> dict:
        return self._call(self._docs.edit, path, root, conn, update)

    def aware(self, path: str, root: str, conn: str, update: bytes) -> None:
        self._call(self._docs.aware, path, root, conn, update)

    def save(self, path: str, root: str) -> dict:
        return self._call(self._docs.save, path, root)

    def settle(self, path: str, root: str, conflict: str, take: str, text: Optional[str] = None,
               theirs: Optional[str] = None, mine: Optional[str] = None) -> dict:
        return self._call(self._docs.settle, path, root, conflict, take, text, theirs, mine)

    def clear_zone(self, path: str, root: str) -> dict:
        return self._call(self._docs.clear_zone, path, root)

    def hold(self, path: str, root: str, conn: str, how: str) -> dict:
        return self._call(self._docs.hold, path, root, conn, how)

    def state(self, path: str, root: str) -> dict:
        return self._call(self._docs.state, path, root)

    def view(self, path: str, root: str, channel: Optional[str] = None) -> str:
        return self._call(self._docs.view, path, root, channel)

    def put(self, path: str, root: str, seen: str, wanted: str, by: dict, how: str) -> dict:
        return self._call(self._docs.put, path, root, seen, wanted, by, how)

    def proposals(self, root: str) -> List[dict]:
        return self._call(self._docs.proposals, root)

    # -- the actors

    def _need_branches(self):
        if self._branches is None:
            raise AppError("this dashboard keeps no actors' branches", 404)
        return self._branches

    def branches(self, root: str) -> List[dict]:
        if self._branches is None:
            return []
        return self._call(self._branches.under, root)

    def approve(self, session: str, on: bool) -> None:
        got = self._call(self._need_branches().set_approve, session, on)
        if self._ring is not None and got and got.get("gatherer"):
            self._ring(got["gatherer"])

    def decide(self, session: str, path: str, take: str) -> None:
        self._call(self._need_branches().decide, session, path, take)

    def changes(self, gatherer: str, channel: str, path: str, since: float, cwd: str = "") -> dict:
        return self._call(files.changes, gatherer, channel, path, since, cwd)

    def writers(self, directories: List[str], since: float) -> Dict[str, List[dict]]:
        return self._call(livedocs.writers, directories, since)

