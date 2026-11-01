"""The harness's own record of each session, followed as it grows, and what it says recorded as events of the session
(records.py) -- what no model call carries, or carries only much later: a message typed while the agent works, a
question answered or dismissed in its terminal, Esc, a model call given up on, a background task's end. What each
line says is the harness's to read (harness_kit's `record_path` and `Follower`); here it is followed and recorded.
Run by the proxy hooks:

    a call of a session comes in       `SessionFiles.follow`: its record found (where the session runs, the
                                       harness's own folder for it, as its launcher named it; none yet: looked
                                       for every FIND_EVERY seconds for FIND_SECONDS -- a harness may write it
                                       only once its first call is under way, and a run that ends with that call
                                       (`claude -p` refused) makes no other -- then again with the next call),
                                       recorded as followed (`session_file`),
                                       and read on in the background every
                                       POLL_SECONDS while it changes -- each new fact inserted (the server's
                                       `insert`, in its lane for records: beside the session's, so not held up
                                       behind a read that waits for its build), each the same event however
                                       often it is read, by its line's place in the file
    the record unchanged QUIET_SECONDS  followed no more; the session's next call follows it again, from where
                                       it was
    a background task started          `SessionFiles.task` (the hook's `derive`, from the call's result): its output
                                       file looked at every ACTIVITY_SECONDS while the record is followed, its
                                       growing recorded (`task_activity`), until the task ends

The first time a hook server follows a record it reads it from its start, so a fact it missed while it did not run
is recorded then, and one recorded before is not stored twice. Nothing raises into the hook: a failure is a line in
its log, and the call is never held up for it."""
import asyncio
import os
import time
from typing import Callable, Dict, Optional, Tuple

from harness_kit import Fact, Facts, Harness

from .records import fact, record, session_file

POLL_SECONDS = 0.25         # how often a followed record is looked at
QUIET_SECONDS = 3600.0      # unchanged this long, with no call of its session: followed no more
FIND_SECONDS = 30.0         # a record not there at a call: looked for this long
FIND_EVERY = 0.5            # that often
ACTIVITY_SECONDS = 5.0      # how often a running background task's output is looked at
BATCH = 200                 # the most events inserted at once


class _Followed:
    """One session's record, as followed so far."""

    def __init__(self, harness: Harness, session: str, cwd: Optional[str], config: Optional[str]):
        self.harness, self.session, self.cwd, self.config = harness, session, cwd, config
        self.path: Optional[str] = None
        self.follower = None
        self.offset = 0
        self.seen: Optional[Tuple[int, int, int]] = None     # (inode, size, mtime) when last read
        self.called = time.time()                             # the session's newest call
        self.task: Optional[asyncio.Task] = None
        self.outputs: Dict[str, str] = {}                     # a running background task -> the file it writes to
        self.written: Dict[str, float] = {}                   # -> when that was last seen written, as recorded
        self.looked = 0.0                                     # when they were last looked at


class SessionFiles:
    """The hook's: `follow` on each call of a session.

    Args:
        ag_clients: the server client per gatherer (the hook's own).
        log: (gatherer, line) -> None.
        poll, quiet, find: POLL_SECONDS, QUIET_SECONDS and FIND_SECONDS, for a test.
    """

    def __init__(self, ag_clients, log: Callable[[str, str], None], poll: float = POLL_SECONDS,
                 quiet: float = QUIET_SECONDS, find: float = FIND_SECONDS):
        self.ag_clients, self.log, self.poll, self.quiet, self.find = ag_clients, log, poll, quiet, find
        self.followed: Dict[Tuple[str, str], _Followed] = {}

    def follow(self, gatherer: str, channel: str, harness: Harness, session: Optional[str], cwd: Optional[str] = None,
               config: Optional[str] = None) -> None:
        """A call of `session` (the channel's) has come in: its record followed, if it is not already."""
        if not session:
            return
        try:
            f = self.followed.get((gatherer, channel))
            if f is None or f.harness.name != harness.name:
                f = self.followed[(gatherer, channel)] = _Followed(harness, session, cwd, config)
            f.called = time.time()
            f.cwd, f.config = cwd or f.cwd, config or f.config
            if f.task is None or f.task.done():
                f.task = asyncio.ensure_future(self._follow(gatherer, channel, f))
        except Exception as exc:  # noqa: BLE001 - never in the way of the call
            self.log(gatherer, f"[{channel}] session file: not followed: {exc!r}")

    async def _follow(self, gatherer: str, channel: str, f: _Followed) -> None:
        try:
            if f.path is None and not await self._looked_for(gatherer, channel, f):
                return
            while True:
                await self._read(gatherer, channel, f)
                if time.time() - max(f.called, f.seen[2] / 1e9 if f.seen else 0) > self.quiet:
                    return                                    # quiet: the next call follows it again
                await asyncio.sleep(self.poll)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - a lost record never breaks the hook
            self.log(gatherer, f"[{channel}] session file: stopped following {f.path}: {exc!r}")

    async def _looked_for(self, gatherer: str, channel: str, f: _Followed) -> bool:
        """Whether the session's record is there, or comes within `find` seconds (module doc)."""
        end = time.time() + self.find
        while not await self._found(gatherer, channel, f):
            if time.time() >= end:
                return False                                  # the next call looks again
            await asyncio.sleep(min(FIND_EVERY, self.find))
        return True

    async def _found(self, gatherer: str, channel: str, f: _Followed) -> bool:
        """Whether the session's record is there: then recorded as followed."""
        path = await asyncio.to_thread(f.harness.record_path, f.session, f.cwd, f.config)
        follower = f.harness.follower(path) if path else None
        if follower is None:
            return False
        f.path, f.follower = path, follower
        await self._insert(gatherer, channel, [session_file(f.harness.name, f.path)])
        self.log(gatherer, f"[{channel}] session file: following {f.path}")
        return True

    def task(self, gatherer: str, channel: str, task: str, output: Optional[str]) -> None:
        """A background task of the session started, writing to `output`, which is looked at from now on (module
        doc); `output` None: it ended, and is looked at no more."""
        f = self.followed.get((gatherer, channel))
        if f is None or not task:
            return
        if output:
            f.outputs[task] = output
        else:
            f.outputs.pop(task, None)
            f.written.pop(task, None)

    def _activity(self, f: _Followed) -> list:
        """The running background tasks whose output was written since last seen: a `task_activity` fact each."""
        out = []
        for task, path in list(f.outputs.items()):
            at = _written(path)
            if at is not None and at > f.written.get(task, 0):
                f.written[task] = at
                out.append(Fact(Facts.TASK_ACTIVITY, f"{task}.output.{int(at * 1000)}", at, {"task": task, "event": None}))
        return out

    async def _read(self, gatherer: str, channel: str, f: _Followed) -> None:
        """What the record says since it was last read, and what has come due, recorded."""
        now = f.follower.stamp(f.path)                        # (inode, size, mtime), as harness_kit's Follower has it
        facts = []
        if now is not None and now != f.seen:
            if f.seen is not None and f.follower.anew(now, f.seen, f.offset):         # written anew: from its start
                f.follower, f.offset = f.harness.follower(f.path), 0
            if f.follower.database or now[1] - f.offset > 1 << 20:     # a database, or a long read: off the loop
                facts, f.offset = await asyncio.to_thread(f.follower.read_on, f.path, f.offset)
            else:
                facts, f.offset = f.follower.read_on(f.path, f.offset)
            f.seen = now
        facts += f.follower.due(time.time())
        if f.outputs and time.time() - f.looked >= ACTIVITY_SECONDS:
            f.looked = time.time()
            facts += await asyncio.to_thread(self._activity, f)
        if facts:
            await self._insert(gatherer, channel, [fact(x, f.path) for x in facts])

    async def _insert(self, gatherer: str, channel: str, events: list) -> None:
        for i in range(0, len(events), BATCH):
            await record(self.ag_clients.client(gatherer), gatherer, channel, events[i:i + BATCH], self.log, beside=True)

    async def close(self) -> None:
        """Every record followed no more."""
        tasks = [f.task for f in self.followed.values() if f.task is not None and not f.task.done()]
        for t in tasks:
            t.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


def _written(path: str) -> Optional[float]:
    """When a task's output was last written: its file's time, or a folder's (a workflow's transcripts) newest file's."""
    try:
        if not os.path.isdir(path):
            return os.stat(path).st_mtime
        with os.scandir(path) as found:
            return max((e.stat().st_mtime for e in found if e.is_file()), default=None)
    except OSError:
        return None
