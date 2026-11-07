"""Knowing when the home changed, the moment it does: what `/api/stream` waits on.

    Hub        the open streams, each watching a gatherer's channel (and the home); `ring` marks
               the ones a change concerns and wakes them, counts it (`version`: the home one read
               serves every stream until the next), and tells what changed (`on_change`: the
               actors kept between reads of the home, data.py's `Kept`)
    Listener   ag's notifications: a Unix datagram socket in <home>/listeners/, which ag sends
               one JSON message to after each write it commits -- {"gatherer", "what",
               "properties": {"channel"}, "row"} (ag/ag_tools/notify.py) -- rung on the hub
    Fallback   every FALLBACK_SECONDS, the size and time of each gatherer's context.db and
               its -wal, and of the call log: rung on a change. It covers a writer that sends
               nothing (an older ag; Windows, which has no Unix datagram sockets) and a lost message;
               and every RECORD_SECONDS, each actor whose failed call would count as given up by now, with
               no word of it (`wake_at`), rung once then

A message only says that something changed; the stream reads what from the database. So a
lost message delays an update and never makes one wrong. Standard library only; nothing of
ag is imported."""

import json
import os
import socket
import threading
import time
from typing import Callable, Dict, Optional, Tuple

from . import home

FALLBACK_SECONDS = 5.0
RECORD_SECONDS = 1.0
HEARD_SECONDS = 2 * FALLBACK_SECONDS   # a gatherer ag told of a change this lately: its files' change was told of
_WAKES: Dict[Tuple[str, str], float] = {}           # (gatherer, channel) -> when to ring it
_RECORDS_LOCK = threading.Lock()
LISTENERS = "listeners"         # the folder in the home ag sends to


def gatherer_key(gatherer: Optional[str]) -> str:
    """The gatherer's directory name, as ag names it (a message names the gatherer as ag was given it)."""
    return os.path.basename(home.gatherer_dir(gatherer or ""))


class Watch:
    """One open stream: what it shows -- the home, the actor picked (`gatherer`, `channel`), and the page's
    other actors (`also`: [(gatherer, channel)], its other panes) -- and what has changed since it last looked."""

    def __init__(self, gatherer: Optional[str], channel: Optional[str], also=()):
        self.gatherer = gatherer_key(gatherer) if gatherer else None
        self.channel = channel
        self.also = [(gatherer_key(g), c) for g, c in also]
        self.wake = threading.Event()
        self.home = self.agent = True               # a new stream sends them all at once
        self.others = set(range(len(self.also)))
        self.wake.set()

    def take(self):
        """(home changed, agent changed, which of `also` changed: their indexes) since the last take, cleared."""
        self.wake.clear()
        got = self.home, self.agent, self.others
        self.home, self.agent, self.others = False, False, set()
        return got


class Hub:
    def __init__(self):
        self.lock = threading.Lock()
        self.watches = set()
        self.on_llm: Optional[Callable[[], None]] = None     # the call log changed (the server's cache)
        self.on_change: Optional[Callable[..., None]] = None   # an actor's data: (gatherer, channel, what, row)
        self.version = 0                                     # the home's changes rung: one more each
        self.heard: Dict[str, float] = {}                    # gatherer -> when ag last told of a change of it
        self.listeners: list = []                            # each told the gatherer of every change (`listen`)

    def listen(self, fn: Callable[[Optional[str]], None]) -> None:
        """`fn(gatherer)` on every change rung (None: any gatherer): the apps' host follows its instances' events so."""
        self.listeners.append(fn)

    def watch(self, gatherer: Optional[str], channel: Optional[str], also=()) -> Watch:
        w = Watch(gatherer, channel, also)
        with self.lock:
            self.watches.add(w)
        return w

    def drop(self, w: Watch) -> None:
        with self.lock:
            self.watches.discard(w)

    def shown(self) -> set:
        """The actors the open streams show: {(gatherer, channel)}, the gatherer as ag names its directory."""
        with self.lock:
            watches = list(self.watches)
        return {(w.gatherer, w.channel) for w in watches if w.gatherer and w.channel} | {a for w in watches for a in w.also}

    def ring(self, gatherer: Optional[str], channel: Optional[str] = None, what: str = "", row: Optional[int] = None) -> None:
        """Something of `gatherer` changed (None: unknown, every gatherer), for `channel` (None:
        unknown, every channel): every stream's home, and the streams watching it. `what` "llm": the
        call log, which the home does not show; "list": a change no actor need be read again for -- what
        the home shows besides its actors' data (sessions started here, what the reader hid or saved), or
        actors read already (data.py's `Kept`, in the background);
        "file": the gatherer's files changed (the Fallback's) -- told of already, if ag told of a change of
        it lately, with the channel; else what ag wrote (ag/ag_tools/notify.py's, with its `row`), or "" (the
        dashboard's)."""
        if what == "llm" and self.on_llm:
            self.on_llm()
        g = gatherer_key(gatherer) if gatherer else None
        concerns = lambda wg, wc: (g is None or g == wg) and (channel is None or channel == wc)   # noqa: E731
        now = time.time()
        if g and what not in ("", "file", "llm", "list"):
            self.heard[g] = now
        told = what == "file" and g is not None and now - self.heard.get(g, 0.0) < HEARD_SECONDS
        if what not in ("llm", "list") and not told and self.on_change:
            self.on_change(g, channel, what, row)            # before the count: a stream that reads it, reads this
        if what not in ("llm", "list"):
            for fn in self.listeners:
                fn(g)
        with self.lock:
            watches = list(self.watches)
            if what != "llm":
                self.version += 1
        for w in watches:
            w.home = True
            if w.gatherer is not None and concerns(w.gatherer, w.channel):
                w.agent = True
            w.others.update(i for i, (wg, wc) in enumerate(w.also) if concerns(wg, wc))
            w.wake.set()


class Listener:
    """ag's notifications, rung on `hub` from a thread of its own until `close()`. `ok` false:
    no socket (no AF_UNIX, or the folder cannot be written): the fallback alone."""

    def __init__(self, hub: Hub):
        self.hub, self.ok, self.path, self.sock = hub, False, None, None
        self.closed = False
        folder = os.path.join(home.HOME, LISTENERS)
        try:
            os.makedirs(folder, exist_ok=True)
            self.path = os.path.join(folder, f"dashboard-{os.getpid()}-{id(self) & 0xffff:x}.sock")
            if os.path.exists(self.path):
                os.unlink(self.path)
            self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
            self.sock.bind(self.path)
            self.sock.settimeout(0.5)                # so close() is noticed
        except (OSError, AttributeError):            # AttributeError: no AF_UNIX (Windows' Python)
            self.sock = None
            return
        self.ok = True
        threading.Thread(target=self._run, name="ag-listener", daemon=True).start()

    def _run(self) -> None:
        while not self.closed:
            try:
                raw = self.sock.recv(65536)
            except socket.timeout:
                continue
            except OSError:
                return
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            props = msg.get("properties") if isinstance(msg.get("properties"), dict) else {}
            self.hub.ring(msg.get("gatherer") if isinstance(msg.get("gatherer"), str) else None,
                          props.get("channel") if isinstance(props.get("channel"), str) else None,
                          str(msg.get("what") or ""), msg.get("row") if isinstance(msg.get("row"), int) else None)

    def close(self) -> None:
        self.closed = True
        if self.sock is not None:
            self.sock.close()
        if self.ok and self.path:
            try:
                os.unlink(self.path)
            except OSError:
                pass


def _stat(path: str):
    try:
        s = os.stat(path)
        return s.st_mtime_ns, s.st_size
    except OSError:
        return None


def wake_at(found: Dict[Tuple[str, str], float]) -> None:
    """The actors to ring at a time of their own, from now on in place of those before: {(gatherer, channel): when}
    -- whose status changes then with nothing written (data.py's `given_up`)."""
    with _RECORDS_LOCK:
        _WAKES.clear()
        _WAKES.update(found)


def files() -> dict:
    """What the fallback compares: {gatherer: (context.db's, its -wal's)}, and the call log's folder."""
    seen = {}
    root = home.gatherers_dir()
    for name in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        db = os.path.join(root, name, "context.db")
        seen[name] = (_stat(db), _stat(db + "-wal"))
    seen[None] = _stat(home.llm_log_dir())           # a new file changes the folder's time
    return seen


class Fallback:
    """Every `seconds`, `files()` compared with the last: each gatherer that changed rung on `hub`."""

    def __init__(self, hub: Hub, seconds: float = FALLBACK_SECONDS):
        self.hub, self.seconds = hub, seconds
        self.stop = threading.Event()
        self.last = files()
        threading.Thread(target=self._run, name="ag-fallback", daemon=True).start()
        threading.Thread(target=self._records, name="ag-records", daemon=True).start()

    def check(self) -> None:
        now = files()
        for name in set(now) | set(self.last):
            if now.get(name) != self.last.get(name):
                if name is None:
                    self.hub.ring(None, None, "llm")
                else:
                    self.hub.ring(name, what="file")
        self.last = now

    def check_records(self) -> None:
        with _RECORDS_LOCK:
            due = [k for k, when in _WAKES.items() if when <= time.time()]
            for k in due:
                del _WAKES[k]
        for gatherer, channel in due:
            self.hub.ring(gatherer, channel)

    def _records(self) -> None:
        while not self.stop.wait(RECORD_SECONDS):
            try:
                self.check_records()
            except Exception:  # noqa: BLE001 - never stop watching
                pass

    def _run(self) -> None:
        while not self.stop.wait(self.seconds):
            try:
                self.check()
            except Exception:  # noqa: BLE001 - never stop watching
                pass

    def close(self) -> None:
        self.stop.set()
