"""The dashboard as the apps' host (app_kit/DESIGN.md, step 2): it finds the apps, runs their backends, keeps their
instances and the agents attached to them, and puts their events into the gatherers -- ag's events, by ag's own
`ag home insert`, after the checks a host makes. It names no app: what it knows of one is its manifest.

    AppHost         every app found (`find`): `listed(gatherer)`, and the operations the routes call -- `open`,
                    `close`, `attach`, `detach`, `insert`, `read`, `call`, `request`, `subscribe` -- each checked
                    against the app's manifest
    Bound           the Host (app_kit's) an app's backend is given: the same operations, for its own instances only

Where apps are found is app_kit's `finding` (the repo's apps/, AG_APPS_PATH, <home>/apps/), as ag finds their
pollers. An app whose manifest can't be read is `broken`, with why, and nothing else.

What it keeps, as events of the gatherer an instance was opened in (app_kit's HOST_TYPES, records no policy groups) --
in the home's one database (home.py's `merged`) every gatherer's together, each instance knowing its own gatherer, and
the context events an app puts in with no channel naming its group (`group`), for the policy to show only to that
group's agents:

    app_opened    {instance}: the instance (its id, folder, title, data), no channel -- its gatherer's
    app_named     {name, by}: what the user called it ("": its own title again) -- the page shows it over its title
    app_closed    {}
    app_attached  {by}: in the agent's channel
    app_detached  {by}
    app_call      {tool, ok}: a tool call it passed to the app, in the caller's channel (none: the user's)
    app_notified  {id, key, title, text, show, where}: a notification the app sent the user (`notify`; app_kit's
                  notices.py), open until
    app_notice_settled  {id or key, how, by}: the app cleared it, or the user dismissed it (`settle_notice`)

A notification is the user's, never an agent's: what the dashboard shows of an instance's open ones -- in its list, a
pop-up -- it reads from these records (data.py's `app_notices`), as it reads an agent's status from its facts; the
page told as each is written (`told`).

A gatherer's are read once, the first time it is asked about (`_load`), and kept in memory after; what this host does
is kept in memory at once and written behind, in order (`_write`). An app's own events and the context types it may
insert (app_kit's CONTEXT_TYPES, in the shape ag's policies read: app_kit.events) carry the host's properties -- `app`, `instance`, and the agent's `channel` -- which
the app cannot set itself, and its own types are declared to ag first (`--types`: their flags as the manifest says).

Live: `subscribe` follows an instance's events as they are stored -- the hub rings `rung` on every change of a
gatherer -- and what its backend tells its panels (`Host.tell_panel`)."""

import importlib.util
import json
import os
import queue
import re
import secrets
import sqlite3
import subprocess
import sys
import threading
import time
from dataclasses import replace
from typing import Any, Callable, Dict, List, Optional, Sequence, Set, Tuple

import app_kit
from app_kit import App, AppError, Caller, Instance, Manifest, Response, ToolResult, remote

from . import home

PATH_ENV = app_kit.finding.PATH_ENV
HELD_RETRY = 2.0                # a new gatherer has no database until its first call: its writes, held, tried this often
HELD_MAX = 1000                 # the most writes held for one such gatherer: the oldest dropped past it
PAGE_WAIT = 30.0                # seconds a tool its panel answers waits for a panel of the instance to be open
TOOL_WAIT = 120.0               # and for the panel's answer
READ_MAX = 2000
NO_DATABASE = "no database for gatherer"
NAME_CHARS = 120                # the longest name the user gives an instance
TOLD = (*app_kit.NOTICE_TYPES, "app_closed")   # records that change what the page shows of the gatherer's apps


def home_apps() -> str:
    return os.path.join(home.HOME, "apps")


def origin_label(name: str) -> str:
    """An app's name as its panel's host name's label (<label>.localhost): `_` is not a letter a host name takes."""
    return name.replace("_", "-")


class Hosted:
    """One app the host found: its manifest, and its backend once started (`backend`)."""

    def __init__(self, manifest: Manifest):
        self.manifest = manifest
        self.app: Optional[App] = None
        self.token = remote.new_token()
        self.lock = threading.Lock()
        self.failed: Optional[str] = None


class _Sub:
    """A panel's following of an instance's events: what it reads, from which row on, and its queue of
    (name, value) for the stream (`api/apps.py`)."""

    def __init__(self, app: str, instance: Instance, types: Tuple[str, ...], after: int, messages: bool = True):
        self.app, self.instance, self.types, self.after, self.messages = app, instance, types, after, messages
        self.queue: "queue.Queue" = queue.Queue()
        self.rung = True


class AppHost:
    """Every app found, their instances and attachments, and their events (module doc). `port` is the dashboard's:
    where an app in its own process reaches the host, and where its panel's origin is."""

    def __init__(self, port: int = 0, write: Optional[Callable[[str, dict, List[dict], List[dict]], None]] = None):
        self.port = port
        self.apps: Dict[str, Hosted] = {}
        self.broken: Dict[str, str] = {}                       # an app's folder -> why it can't be used
        self.instances: Dict[str, Instance] = {}
        self.attached: Dict[str, Set[str]] = {}                # an instance's id -> its agents' channels
        self.loaded: Set[str] = set()                          # the gatherers whose records were read
        self.loaded_then: Optional[Callable[[str], None]] = None   # told each gatherer read (task_links.py's on_load)
        # who may be attached, (gatherer, channel) -> bool: the server's (task_links.py's `attachable`: not a gatherer's
        # own agent, which reaches every app attached to none); none set, anyone
        self.attachable: Optional[Callable[[str, str], bool]] = None
        self.subs: List[_Sub] = []
        self.asked: Dict[str, dict] = {}                       # a call its panel answers, by its id: {done, result}
        self.page_wait, self.tool_wait = PAGE_WAIT, TOOL_WAIT
        self.docs: Optional[app_kit.Docs] = None              # the dashboard's shared files (app_docs.py), once set
        self.told: Optional[Callable[[str], None]] = None      # the page told a gatherer's notifications changed, as
                                                               # written (the server's hub.ring)
        self.agents = None                                     # an app's messages to its agents, and agents it starts
                                                               # (app_agents.py's Messenger: the server's sessions)
        self.lock = threading.RLock()
        self._write_fn = write or _ag_insert
        self._writes: "queue.Queue" = queue.Queue()
        self._held: Dict[str, List[tuple]] = {}               # a gatherer with no database yet: its writes, in order
        self._writer = threading.Thread(target=self._writing, name="app-host-writes", daemon=True)
        self._writer.start()
        self._rung: "queue.Queue" = queue.Queue()
        self._follower = threading.Thread(target=self._following, name="app-host-follows", daemon=True)
        self._follower.start()
        self.find()

    # -- the apps

    def find(self) -> None:
        """The apps found (app_kit's `finding`: where ag finds their pollers too), read again: an app already running
        from the same folder is kept as it is."""
        manifests, broken = app_kit.finding.find(home.HOME)
        found = {n: self.apps[n] if n in self.apps and self.apps[n].manifest.folder == m.folder else Hosted(m)
                 for n, m in manifests.items()}
        with self.lock:
            self.apps, self.broken = found, broken

    def hosted(self, name: str) -> Hosted:
        h = self.apps.get(name)
        if h is None:
            raise AppError(f"{name}: no such app", 404)
        return h

    def backend(self, name: str) -> App:
        """The app's backend, started the first time it is needed: imported from its folder (`python`), or its
        process started (`command`). An app with neither has none: AppError."""
        h = self.hosted(name)
        with h.lock:
            if h.app is not None:
                return h.app
            if h.failed:
                raise AppError(f"{name}: its backend failed to start: {h.failed}", 502)
            m = h.manifest
            try:
                if m.backend.python:
                    app = _import(m)
                elif m.backend.command:
                    app = remote.launch(m.backend.command, m.folder, self.host_url(name), h.token,
                                        self.data_folder(name))
                else:
                    raise AppError(f"{name}: has no backend", 404)
                app.manifest = m
                app.start(Bound(self, name))
            except AppError:
                raise
            except Exception as exc:  # noqa: BLE001 - an app's failure is its own, shown, not the host's
                h.failed = f"{type(exc).__name__}: {exc}"
                raise AppError(f"{name}: its backend failed to start: {h.failed}", 502) from None
            h.app = app
            return app

    def host_url(self, name: str) -> str:
        """Where an app in its own process reaches the host (api/apps.py's /apps/host/<name>/<op>)."""
        return f"http://127.0.0.1:{self.port}/apps/host/{name}"

    def origin(self, name: str) -> str:
        """Its panel's origin: an origin of its own, so its page can't read the dashboard's or call its API."""
        return f"http://{origin_label(name)}.localhost:{self.port}"

    def named_by_label(self, label: str) -> Optional[Hosted]:
        return next((h for n, h in self.apps.items() if origin_label(n) == label), None)

    def data_folder(self, name: str) -> str:
        path = os.path.join(home_apps(), name, "data")
        os.makedirs(path, exist_ok=True)
        return path

    def close(self) -> None:
        """Every backend stopped, and what is left to write written. Once: closed again, nothing more."""
        with self.lock:
            if getattr(self, "_closed", False):
                return
            self._closed = True
        for h in list(self.apps.values()):
            if h.app is not None:
                try:
                    h.app.stop()
                except Exception:  # noqa: BLE001 - stopping the rest matters more
                    pass
        self._writes.put(None)
        self._writer.join(10)
        self._rung.put(None)

    # -- what the page is told

    def listed(self, gatherer: Optional[str] = None) -> dict:
        """Every app found (its manifest, its panel's origin), the broken ones, and -- for `gatherer` -- its open
        instances and the agents attached to each."""
        if gatherer:
            self._load(gatherer)
        with self.lock:
            apps = [{**h.manifest.to_dict(), "origin": self.origin(n), "folder": h.manifest.folder,
                     "failed": h.failed} for n, h in sorted(self.apps.items())]
            insts = [i.to_dict() for i in self.instances.values() if gatherer and i.gatherer == gatherer]
            attached = {i["id"]: sorted(self.attached.get(i["id"], ())) for i in insts}
            broken = [{"folder": f, "error": e} for f, e in sorted(self.broken.items())]
        return {"apps": apps, "broken": broken, "instances": insts, "attached": attached}

    # -- instances

    def instances_of(self, gatherer: str, app: Optional[str] = None) -> List[Instance]:
        """The gatherer's open instances (of `app`), as they were opened."""
        self._load(gatherer)
        with self.lock:
            return [i for i in self.instances.values() if i.gatherer == gatherer and (app is None or i.app == app)]

    def instance(self, gatherer: str, instance_id: str, app: Optional[str] = None) -> Instance:
        self._load(gatherer)
        with self.lock:
            i = self.instances.get(instance_id)
        if i is None or i.gatherer != gatherer or (app is not None and i.app != app):
            raise AppError(f"{instance_id}: no such instance{' of ' + app if app else ''} in {gatherer}", 404)
        return i

    def open(self, name: str, gatherer: str, folder: Optional[str] = None, args: Optional[dict] = None,
             by: str = "user") -> Instance:
        """The app's instance for `gatherer` and `folder`, as its manifest's `instances` says: the open one where
        there is one to be (one per gatherer, folder or checkout), else a new one, opened by its backend (when it has
        one) and kept (`app_opened`)."""
        m = self.hosted(name).manifest
        self._load(gatherer)
        key = _instance_key(m.instances, folder)
        with self.lock:
            if m.instances != "many":
                for i in self.instances.values():
                    if i.app == name and i.gatherer == gatherer and _instance_key(m.instances, i.folder) == key:
                        return i
        made = Instance(id=secrets.token_hex(8), app=name, gatherer=gatherer,
                        folder=os.path.realpath(folder) if folder else None)
        if m.backend.python or m.backend.command:
            got = self.backend(name).open(made, dict(args or {}))
            made = Instance(id=made.id, app=name, gatherer=gatherer, folder=made.folder, title=got.title,
                            data=dict(got.data))                    # the app's title and data; the rest the host's
        with self.lock:
            self.instances[made.id] = made
            self.attached.setdefault(made.id, set())
        self._record(made, "app_opened", {"instance": made.to_dict(), "by": by})
        self._ring(made)
        return made

    def adopt(self, name: str, gatherer: str, instance_id: str, folder: Optional[str], channel: str) -> Instance:
        """An instance the app had before it was an app here -- its actor's stored role, {"<app>": key} -- kept as one
        whose id is that key (its backend finds its own data by it: `open`'s args say `adopted`), the actor attached.
        Once: the instance open already, only the attachment is made, if it is not."""
        self._load(gatherer)
        with self.lock:
            i = self.instances.get(instance_id)
        if i is None:
            if not re.fullmatch(r"[0-9a-f]{16}", instance_id or ""):
                raise AppError(f"{instance_id!r}: not an instance's id")
            m = self.hosted(name).manifest
            made = Instance(id=instance_id, app=name, gatherer=gatherer,
                            folder=os.path.realpath(folder) if folder else None)
            if m.backend.python or m.backend.command:
                got = self.backend(name).open(made, {"adopted": True})
                made = Instance(id=made.id, app=name, gatherer=gatherer, folder=made.folder, title=got.title,
                                data=dict(got.data))
            with self.lock:
                self.instances[made.id] = made
                self.attached.setdefault(made.id, set())
            self._record(made, "app_opened", {"instance": made.to_dict(), "by": "adopted"})
            i = made
        elif i.app != name or i.gatherer != gatherer:
            raise AppError(f"{instance_id}: an instance of {i.app} in {i.gatherer}", 409)
        if channel:
            self.attach(gatherer, i.id, channel, by="adopted")
        return i

    def native_link(self, send: Callable[[str], None], close: Callable[[], None]) -> Callable[[Optional[str]], None]:
        """The ag desktop app connected (api/apps.py's /api/desktop; desktop.py): its link handed to each app that asks
        `native_view` and runs inside the dashboard (App.native) -- each message the app sends tagged with its name
        ("app"), so the desktop app keeps each app's pages apart; each message from the desktop app given to the app it
        names (naming none, as a desktop app from before apps did: the only such app). Returns what takes each message
        from the desktop app (None: the link gone)."""
        takers: Dict[str, Callable[[Optional[str]], None]] = {}
        for name, h in sorted(self.apps.items()):
            m = h.manifest
            if not m.capabilities.native_view or not m.backend.python:
                continue
            try:
                took = self.backend(name).native(lambda text, n=name: send(_tagged(text, n)), close)
            except Exception:  # noqa: BLE001 - an app that fails to take it goes without its native pages
                took = None
            if took is not None:
                takers[name] = took

        def got(text: Optional[str]) -> None:
            if text is None:
                for take in takers.values():
                    take(None)
                return
            try:
                name = json.loads(text).get("app")
            except (ValueError, AttributeError):
                return
            if name is None and len(takers) == 1:
                name = next(iter(takers))
            take = takers.get(name)
            if take is not None:
                take(text)
        return got

    def guard(self, gatherer: str, channel: str, path: str) -> Optional[str]:
        """Why the agent must not change `path` with its harness's own edit tools: the first refusal of an app it is
        attached to whose manifest asks `edit_guard` (App.guard); None: it may."""
        for i in self.attached_to(gatherer, channel):
            h = self.hosted(i.app)
            if not h.manifest.capabilities.edit_guard:
                continue
            try:
                said = self.backend(i.app).guard(i, path, Caller(channel=channel, gatherer=gatherer))
            except Exception:  # noqa: BLE001 - an app that fails to say lets the edit be
                said = None
            if said:
                return str(said)
        return None

    def close_instance(self, gatherer: str, instance_id: str, by: str = "user") -> None:
        i = self.instance(gatherer, instance_id)
        m = self.hosted(i.app).manifest
        if m.backend.python or m.backend.command:
            self.backend(i.app).close(i)
        with self.lock:
            self.instances.pop(i.id, None)
            channels = self.attached.pop(i.id, set())
        for c in sorted(channels):
            self._record(i, "app_detached", {"by": by}, channel=c)
        self._record(i, "app_closed", {"by": by})
        self._ring(i)

    def rename(self, gatherer: str, instance_id: str, name: Any, by: str = "user") -> Instance:
        """The instance called `name` by the user -- its spaces made one, NAME_CHARS at most; "": not named, its own title
        shown again (`app_named`) -> it, renamed. Its panels told (`_ring`)."""
        i = self.instance(gatherer, instance_id)
        text = " ".join(str(name or "").split())[:NAME_CHARS].strip()
        if text == i.name:
            return i
        with self.lock:
            i = self.instances[i.id] = replace(self.instances.get(i.id, i), name=text)
        self._record(i, "app_named", {"name": text, "by": by})
        self._ring(i)
        return i

    def sleep_instance(self, gatherer: str, instance_id: str) -> None:
        """The instance put to sleep (its task closed: task_links.py): its backend lets go of what runs for it, the
        instance kept open, its agents attached -- used again, it comes back as it was (App.sleep)."""
        i = self.instance(gatherer, instance_id)
        m = self.hosted(i.app).manifest
        if m.backend.python or m.backend.command:
            self.backend(i.app).sleep(i)

    def attach(self, gatherer: str, instance_id: str, channel: str, by: str = "user") -> None:
        """An agent attached to the instance: its tool calls go to it, and the app may tell it what it does."""
        i = self.instance(gatherer, instance_id)
        if not channel:
            raise AppError("attach: which agent (its channel)?")
        if self.attachable is not None and not self.attachable(gatherer, channel):
            raise AppError(f"{channel}: a gatherer's own agent is attached to no app: it reaches every one without", 403)
        with self.lock:
            if channel in self.attached.setdefault(i.id, set()):
                return
            self.attached[i.id].add(channel)
        self._record(i, "app_attached", {"by": by}, channel=channel)
        self._ring(i)                                              # its panels told first; then its backend
        h = self.hosted(i.app)
        if h.manifest.backend.python or h.manifest.backend.command:
            self.backend(i.app).attached(i, channel)

    def detach(self, gatherer: str, instance_id: str, channel: str, by: str = "user") -> None:
        i = self.instance(gatherer, instance_id)
        with self.lock:
            if channel not in self.attached.get(i.id, set()):
                return
            self.attached[i.id].discard(channel)
        self._record(i, "app_detached", {"by": by}, channel=channel)
        h = self.hosted(i.app)
        if h.app is not None:
            h.app.detached(i, channel)
        self._ring(i)

    # -- notifications to the user

    def notify(self, name: str, instance: Instance, title: Any, text: Any = "", key: Any = None, show: Any = ("ag",),
               where: Any = None) -> str:
        """A notification of app `name`'s to the user (app_kit's Host.notify), for one whose manifest asks `notify`:
        recorded in the instance's gatherer (`app_notified`), the page told once it is written. -> its id."""
        m = self.hosted(name).manifest
        if instance.app != name:
            raise AppError(f"{instance.id}: not an instance of {name}", 403)
        if not m.capabilities.notify:
            raise AppError(f"{m.label} does not ask to send notifications (capabilities.notify)", 403)
        made = app_kit.notices.made(title, text, key, show, where)
        self._record(instance, "app_notified", made)
        return made["id"]

    def settle_notice(self, gatherer: str, instance_id: str, which: Any, by: str = "user",
                      name: Optional[str] = None) -> None:
        """The instance's open notification `which` (its id, or every one of that key) settled: dismissed by the user,
        or cleared by its app (`name`, by "app")."""
        i = self.instance(gatherer, instance_id, name)
        how = "cleared" if by == "app" else "dismissed"
        self._record(i, "app_notice_settled", {**app_kit.notices.settled(which, how), "by": by})

    # -- an app's own messages to its agents

    def send_agent(self, name: str, instance: Instance, channel: Any, text: Any) -> None:
        """A message of app `name`'s to an agent attached to `instance`, as the user (app_kit's Host.send_agent), for one
        whose manifest asks `message_agents`."""
        self._may_message(name, instance)
        if channel not in self.agents_of(instance):
            raise AppError(f"{channel}: not an agent attached to this {self.hosted(name).manifest.label}", 403)
        if not isinstance(text, str) or not text.strip():
            raise AppError("send_agent: what to say?")
        self.agents.send(instance.gatherer, str(channel), text)

    def start_agent(self, name: str, instance: Instance, text: Any, label: Any = None, harness: Any = None,
                    model: Any = None, folder: Any = None) -> str:
        """A new agent of app `name`'s own, attached to `instance`, started with `text` (app_kit's Host.start_agent)
        -> its channel."""
        m = self._may_message(name, instance)
        if not isinstance(text, str) or not text.strip():
            raise AppError("start_agent: its first message?")
        where = folder or instance.folder or os.path.join(home_apps(), name, "agent")
        os.makedirs(where, exist_ok=True)
        return self.agents.start(self, instance, text, str(label or m.agent.name.format(
            app=m.label, folder=os.path.basename(where.rstrip("/")))), harness or None, model or None, where)

    def _may_message(self, name: str, instance: Instance) -> Manifest:
        m = self.hosted(name).manifest
        if instance.app != name:
            raise AppError(f"{instance.id}: not an instance of {name}", 403)
        if not m.capabilities.message_agents:
            raise AppError(f"{m.label} does not ask to message its agents (capabilities.message_agents)", 403)
        if self.agents is None:
            raise AppError("this host has no agents to message", 404)
        return m

    def panels_of(self, instance: Instance) -> int:
        """How many panels of the instance are open: its streams that take its backend's messages."""
        with self.lock:
            return sum(1 for s in self.subs if s.instance.id == instance.id and s.messages)

    def agents_of(self, instance: Instance) -> List[str]:
        with self.lock:
            return sorted(self.attached.get(instance.id, ()))

    def attached_to(self, gatherer: str, channel: str) -> List[Instance]:
        """The instances an agent is attached to."""
        self._load(gatherer)
        with self.lock:
            return [self.instances[i] for i, cs in self.attached.items()
                    if channel in cs and i in self.instances and self.instances[i].gatherer == gatherer]

    # -- events

    def insert(self, name: str, instance: Instance, events: List[dict], channel: Optional[str] = None) -> None:
        """An app's `events` (ag's insert shape) put into its instance's gatherer, after the host's checks: each of a
        type it may insert (its own, declared; or a context type, with readable `text`); with `channel`, one of the
        instance's agents'. The host's properties are set here, and its own types declared to ag first."""
        m = self.hosted(name).manifest
        if instance.app != name:
            raise AppError(f"{instance.id}: not an instance of {name}", 403)
        if channel is not None and channel not in self.agents_of(instance):
            raise AppError(f"{channel}: not an agent attached to this {m.label}", 403)
        if not isinstance(events, list) or not events:
            raise AppError("events: a list of {type, payload, ...}")
        out, declared = [], {}
        for e in events:
            if not isinstance(e, dict) or not isinstance(e.get("type"), str) or "payload" not in e:
                raise AppError(f"not an event: {str(e)[:120]}")
            t = e["type"]
            if not m.may_insert(t):
                raise AppError(f"{t}: not an event type {name} may insert (its own, declared, or "
                               f"{' or '.join(app_kit.CONTEXT_TYPES)})", 403)
            if t in app_kit.CONTEXT_TYPES:                          # in the shape ag's policies read
                try:
                    e = app_kit.events.checked(e)
                except ValueError as exc:
                    raise AppError(str(exc)) from None
            own = e.get("properties") or {}
            if not isinstance(own, dict) or any(k in app_kit.manifest.HOST_PROPERTY_NAMES for k in own):
                raise AppError(f"{t}: properties are an object, without the host's "
                               f"({', '.join(app_kit.manifest.HOST_PROPERTY_NAMES)})")
            if t not in app_kit.CONTEXT_TYPES:
                known = {p.name for p in m.event(t).properties}
                extra = [k for k in own if k not in known]
                if extra:
                    raise AppError(f"{t}: declares no property {', '.join(extra)}")
                declared[t] = m.event_types()[[x.name for x in m.events].index(t)]
            # the host's properties on the event itself: ag declares a property an event carries on a type that lacks
            # it (the context types), where one given for the whole insert must be its type's already
            payload = e["payload"]
            if channel is None and t in app_kit.CONTEXT_TYPES and home.merged() and isinstance(payload, dict):
                payload = {**payload, "group": instance.gatherer}   # the home's one database: its group's agents alone
            ev = {"type": t, "payload": payload, **({"text": e["text"]} if isinstance(e.get("text"), str) else {}),
                  "properties": {**own, "app": name, "instance": instance.id}}
            if e.get("id"):
                ev["id"] = f"{name}:{instance.id}:{e['id']}"     # one app's ids never another's
            out.append(ev)
        self._write(instance.gatherer, {"channel": channel} if channel else {}, out,
                    [_type_json(t) for t in declared.values()])

    def read(self, name: str, instance: Instance, types: Sequence[str], after: int = 0,
             channel: Optional[str] = None, limit: int = 500) -> List[dict]:
        """The events of `types` the app may read (its manifest's `may_read`), oldest first: its own types and the
        host's records of it, this instance's only; the context types, those it inserted for this instance; any
        other its capabilities name, its agents' only."""
        m = self.hosted(name).manifest
        if instance.app != name:
            raise AppError(f"{instance.id}: not an instance of {name}", 403)
        refused = [t for t in types if not m.may_read(t)]
        if refused:
            raise AppError(f"{', '.join(refused)}: not event types {name} may read", 403)
        agents = self.agents_of(instance)
        if channel is not None and channel not in agents:
            raise AppError(f"{channel}: not an agent attached to this {m.label}", 403)
        return _read(instance, types, after, channel, agents, min(max(1, limit), READ_MAX))

    # -- tools and the panel's own requests

    def call(self, name: str, instance: Instance, tool: str, args: dict, caller: Caller,
             from_panel: bool = False, reaches_all: bool = False) -> ToolResult:
        """A call of the app's tool, by an agent attached to the instance (or the user, through the panel:
        `caller.channel` None; or, `reaches_all`, a gatherer's own agent, attached to none), kept as `app_call`: to its
        backend, or -- a tool its panel answers -- to an open panel of the instance (`ask_panel`). A refusal is an error
        result, as the agent reads it."""
        m = self.hosted(name).manifest
        t = m.tool(tool)
        if instance.app != name or t is None:
            return ToolResult.error(f"{tool}: not a tool of {m.label}")
        if t.handled_by == "panel" and from_panel:
            return ToolResult.error(f"{tool}: its panel answers it, not its backend")
        if caller.channel is not None and not reaches_all and caller.channel not in self.agents_of(instance):
            return ToolResult.error(f"not attached to this {m.label}")
        try:
            got = self.ask_panel(name, instance, tool, dict(args or {}), caller) if t.handled_by == "panel" else \
                self.backend(name).call(instance, tool, dict(args or {}), caller)
        except AppError as exc:
            got = ToolResult.error(str(exc))
        except Exception as exc:  # noqa: BLE001 - an app's bug is its call's error, not the host's
            got = ToolResult.error(f"{tool} failed: {type(exc).__name__}: {exc}")
        self._record(instance, "app_call", {"tool": tool, "ok": not got.is_error}, channel=caller.channel)
        return got

    def ask_panel(self, name: str, instance: Instance, tool: str, args: dict, caller: Caller) -> ToolResult:
        """A tool its panel answers, asked of the instance's open panels -- each told {"ag": "call", id, tool, args,
        caller}; the first answer (`answer_panel`) is the call's. Waits `page_wait` for a panel to be open, then
        `tool_wait` for its answer."""
        label = self.hosted(name).manifest.label
        end = time.time() + self.page_wait
        while not any(s.instance.id == instance.id and s.messages for s in list(self.subs)):
            if time.time() >= end:
                return ToolResult.error(f"{tool}: {label}'s panel answers it, and none is open: ask the user to "
                                        f"open {label}")
            time.sleep(0.2)
        cid = secrets.token_hex(8)
        waiting = {"done": threading.Event(), "result": None, "instance": instance.id}
        with self.lock:
            self.asked[cid] = waiting
        try:
            self.tell(instance, {"ag": "call", "id": cid, "tool": tool, "args": args, "caller": caller.to_dict()})
            if not waiting["done"].wait(self.tool_wait):
                return ToolResult.error(f"{tool}: {label}'s panel did not answer within {self.tool_wait:g} s")
            return waiting["result"]
        finally:
            with self.lock:
                self.asked.pop(cid, None)

    def answer_panel(self, instance: Instance, cid: str, result: dict) -> None:
        """A panel's answer to a call it was asked (`ask_panel`): MCP's result, {content, isError}."""
        with self.lock:
            waiting = self.asked.get(cid)
        if waiting is None or waiting["instance"] != instance.id:
            raise AppError(f"{cid}: no call of this instance waits for an answer", 404)
        if not isinstance(result, dict) or not isinstance(result.get("content"), list):
            raise AppError("result: {content: [...], isError?}")
        waiting["result"] = ToolResult.from_dict(result)
        waiting["done"].set()

    def request(self, name: str, instance: Optional[Instance], method: str, path: str, query: Dict[str, str],
                body: bytes) -> Response:
        return self.backend(name).request(instance, method, path, query, body)

    # -- live

    def subscribe(self, name: str, instance: Instance, types: Sequence[str], after: int = 0,
                  messages: bool = True) -> Tuple[_Sub, Callable]:
        """A panel following the instance: each new event of `types` as ("event", row) and -- with `messages`: one
        stream of a panel's has them, so a tool call reaches it once -- each message its backend sends its panels as
        ("message", value), on the subscription's queue; and how to stop."""
        m = self.hosted(name).manifest
        refused = [t for t in types if not m.may_read(t)]
        if refused:
            raise AppError(f"{', '.join(refused)}: not event types {name} may read", 403)
        sub = _Sub(name, instance, tuple(types), after, messages)
        with self.lock:
            self.subs.append(sub)
        self._rung.put(instance.gatherer)

        def leave() -> None:
            with self.lock:
                if sub in self.subs:
                    self.subs.remove(sub)
        return sub, leave

    def tell(self, instance: Instance, message: Any) -> None:
        with self.lock:
            subs = [s for s in self.subs if s.instance.id == instance.id and s.messages]
        for s in subs:
            s.queue.put(("message", message))

    def rung(self, gatherer: Optional[str]) -> None:
        """The hub's word that `gatherer` changed (None: any): its subscriptions read again."""
        self._rung.put(gatherer)

    def _ring(self, instance: Instance) -> None:
        with self.lock:
            now = self.instances.get(instance.id, instance)
        self.tell(instance, {"ag": "instance", "attached": self.agents_of(instance), "name": now.name})

    def _following(self) -> None:
        while True:
            g = self._rung.get()
            if g is None:
                return
            time.sleep(0.05)                                       # a burst of rings, read once
            gs = {g}
            while not self._rung.empty():
                more = self._rung.get_nowait()
                if more is None:
                    return
                gs.add(more)
            with self.lock:
                subs = [s for s in self.subs if s.instance.gatherer in gs or None in gs]
            for s in subs:
                while True:                                        # until caught up, a batch at a time
                    try:
                        rows = self.read(s.app, s.instance, s.types, s.after)
                    except (AppError, sqlite3.Error):
                        break
                    for r in rows:
                        s.after = max(s.after, r["row_id"])
                        s.queue.put(("event", r))
                    if len(rows) < 500:
                        break

    # -- the host's records

    def _record(self, instance: Instance, kind: str, payload: dict, channel: Optional[str] = None) -> None:
        props = {"app": instance.app, "instance": instance.id, **({"channel": channel} if channel else {})}
        t = next(t for t in app_kit.HOST_TYPES if t.name == kind)
        self._write(instance.gatherer, props, [{"type": kind, "payload": {**payload, "at": time.time()}}],
                    [_type_json(t)])

    def _write(self, gatherer: str, properties: dict, events: List[dict], types: List[dict]) -> None:
        self._writes.put((gatherer, properties, events, types))

    def flush(self, timeout: float = 30.0) -> None:
        """Everything handed to be written, written (for tests, and before a read that needs it); at once, closed. A
        write held for a gatherer with no database yet (`_writing`) is not waited for: it can't be read either."""
        if not self._writer.is_alive():
            return
        done = threading.Event()
        self._writes.put(done)
        done.wait(timeout)

    def _writing(self) -> None:
        """The writes, in order, one at a time. A gatherer with no database yet (a new one, before its first agent's
        first call) holds its writes -- the later ones behind the first, in order -- and they are tried again every
        HELD_RETRY seconds once its database is there, never holding up another gatherer's writes, nor a flush."""
        while True:
            try:
                item = self._writes.get(timeout=HELD_RETRY if self._held else None)
            except queue.Empty:
                self._retry_held()
                continue
            if item is None:
                for gatherer, held in self._held.items():
                    print(f"dashboard: apps' {len(held)} record(s) not kept in {gatherer}: it has no database yet",
                          file=sys.stderr, flush=True)
                return
            if isinstance(item, threading.Event):
                item.set()
                continue
            gatherer = item[0]
            if gatherer in self._held:
                self._hold(item)
                self._retry_held()
                continue
            self._write_one(item)

    def _write_one(self, item: tuple) -> bool:
        """One write; False if its gatherer has no database yet (held, then)."""
        gatherer, props, events, types = item
        try:
            self._write_fn(gatherer, props, events, types)
        except Exception as exc:  # noqa: BLE001 - a lost record is a line in the log, never the reader's
            if NO_DATABASE in str(exc):
                self._hold(item)
                return False
            print(f"dashboard: apps' {', '.join(e['type'] for e in events)} not kept in {gatherer}: {exc}",
                  file=sys.stderr, flush=True)
        self.rung(gatherer)
        if self.told is not None and any(e["type"] in TOLD for e in events):
            try:
                self.told(gatherer)
            except Exception:  # noqa: BLE001 - the page reads it next time all the same
                pass
        return True

    def _hold(self, item: tuple) -> None:
        held = self._held.setdefault(item[0], [])
        held.append(item)
        if len(held) > HELD_MAX:
            del held[0]

    def _retry_held(self) -> None:
        """Each gatherer's held writes, in order, once its database is there."""
        for gatherer in list(self._held):
            if not os.path.exists(home.db_path(gatherer)):
                continue
            held = self._held.pop(gatherer)
            for n, item in enumerate(held):
                if not self._write_one(item):                       # (held again: the rest after it, as they were)
                    self._held[gatherer] = self._held.get(gatherer, []) + held[n + 1:]
                    break

    def _load(self, gatherer: str) -> None:
        """The gatherer's apps' records read, once: its open instances and their agents."""
        with self.lock:
            if gatherer in self.loaded:
                return
            self.loaded.add(gatherer)
        opened: Dict[str, Instance] = {}
        attached: Dict[str, Set[str]] = {}
        for kind, inst, channel, payload in _host_records(gatherer):
            if kind == "app_opened" and isinstance(payload.get("instance"), dict):
                try:
                    opened[inst] = Instance.from_dict(payload["instance"])
                except (KeyError, TypeError):
                    continue
                attached.setdefault(inst, set())
            elif kind == "app_named" and inst in opened:
                opened[inst] = replace(opened[inst], name=str(payload.get("name") or ""))
            elif kind == "app_closed":
                opened.pop(inst, None)
                attached.pop(inst, None)
            elif kind == "app_attached" and inst in opened and channel:
                attached.setdefault(inst, set()).add(channel)
            elif kind == "app_detached" and channel:
                attached.get(inst, set()).discard(channel)
        with self.lock:
            for i, inst in opened.items():
                if inst.app in self.apps:                          # an app no longer found: its instances wait for it
                    self.instances.setdefault(i, inst)
                    self.attached.setdefault(i, set()).update(attached.get(i, ()))
        if self.loaded_then is not None:
            try:
                self.loaded_then(gatherer)
            except Exception:  # noqa: BLE001 - what is told of it is not what reads it
                pass


def _tagged(text: str, app: str) -> str:
    """A message of an app's to the desktop app, its name on it ("app")."""
    try:
        m = json.loads(text)
    except ValueError:
        return text
    return json.dumps({**m, "app": app}) if isinstance(m, dict) else text


class Bound(app_kit.Host):
    """The Host an app's backend is given (app_kit's): the host's operations, for this app's instances only."""

    def __init__(self, host: AppHost, name: str):
        self._host, self._name = host, name

    def _own(self, instance: Instance) -> Instance:
        return self._host.instance(instance.gatherer, instance.id, self._name)

    def insert(self, instance, events, channel=None):
        self._host.insert(self._name, self._own(instance), list(events), channel)

    def read(self, instance, types, after=0, channel=None, limit=500):
        self._host.flush()                                          # what it inserted, readable
        return self._host.read(self._name, self._own(instance), list(types), after, channel, limit)

    def attached(self, instance):
        return self._host.agents_of(self._own(instance))

    def tell_panel(self, instance, message):
        self._host.tell(self._own(instance), message)

    def folder(self):
        return self._host.data_folder(self._name)

    def instances(self):
        with self._host.lock:
            return [i for i in self._host.instances.values() if i.app == self._name]

    def panels(self, instance):
        return self._host.panels_of(self._own(instance))

    def notify(self, instance, title, text="", key=None, show=("ag",), where=None):
        return self._host.notify(self._name, self._own(instance), title, text, key, show, where)

    def clear_notice(self, instance, which):
        i = self._own(instance)
        self._host.settle_notice(i.gatherer, i.id, which, by="app", name=self._name)

    def send_agent(self, instance, channel, text):
        self._host.send_agent(self._name, self._own(instance), channel, text)

    def start_agent(self, instance, text, name=None, harness=None, model=None, folder=None):
        return self._host.start_agent(self._name, self._own(instance), text, name, harness, model, folder)

    def docs(self):
        m = self._host.hosted(self._name).manifest
        if not m.capabilities.docs:
            raise AppError(f"{self._name} does not ask for the host's shared files (capabilities.docs)", 403)
        if self._host.docs is None:
            raise AppError("this host has no shared files", 404)
        return self._host.docs

    def instance_of(self, d: dict) -> Instance:
        """The instance an app in its own process names (remote.py's `host_ops`): one of its own, as the host has it."""
        return self._host.instance(str(d.get("gatherer") or ""), str(d.get("id") or ""), self._name)


# ---------------------------------------------------------------- helpers


def _instance_key(instances: str, folder: Optional[str]) -> Optional[str]:
    if instances == "one" or not folder:
        return None
    real = os.path.realpath(folder)
    if instances == "per-repository":                  # a worktree's: its repository's, as its other worktrees'
        try:
            common = subprocess.run(["git", "-C", real, "rev-parse", "--path-format=absolute", "--git-common-dir"],
                                    capture_output=True, text=True, timeout=5, stdin=subprocess.DEVNULL)
            got = common.stdout.strip()
            if common.returncode == 0 and got:
                return os.path.realpath(os.path.dirname(got) if os.path.basename(got) == ".git" else got)
        except (OSError, subprocess.SubprocessError):
            pass
        instances = "per-checkout"
    if instances == "per-checkout":
        try:
            top = subprocess.run(["git", "-C", real, "rev-parse", "--show-toplevel"], capture_output=True, text=True,
                                 timeout=5, stdin=subprocess.DEVNULL)
            if top.returncode == 0 and top.stdout.strip():
                return os.path.realpath(top.stdout.strip())
        except (OSError, subprocess.SubprocessError):
            pass
    return real


def _import(m: Manifest) -> App:
    """The backend class of an app in the host's process, imported from its folder as a package of its own (so two
    apps' modules of one name never meet): `python = "module:Class"`, module a file or package in the folder."""
    module, cls = m.backend.python.split(":", 1)
    pkg = f"_ag_app_{m.name}"
    if pkg not in sys.modules:
        spec = importlib.util.spec_from_file_location(pkg, os.path.join(m.folder, "__init__.py"),
                                                      submodule_search_locations=[m.folder])
        mod = importlib.util.module_from_spec(spec)
        sys.modules[pkg] = mod
        if os.path.exists(os.path.join(m.folder, "__init__.py")):
            spec.loader.exec_module(mod)
    found = importlib.import_module(f"{pkg}.{module}")
    app = getattr(found, cls)()
    if not isinstance(app, App):
        raise AppError(f"{m.backend.python}: not an app_kit App")
    return app


def _type_json(t) -> dict:
    return {"name": t.name, "properties": [{"name": p.name, "required": p.required, "identifies": p.identifies}
                                           for p in t.properties]}


def _ag_insert(gatherer: str, properties: dict, events: List[dict], types: List[dict]) -> None:
    """`events` put into the gatherer by ag (`ag home insert`), `types` declared first."""
    from . import sessions                                          # how ag is run, and its environment
    done = subprocess.run([*sessions.ag_command(), "home", "insert", gatherer, "--properties", json.dumps(properties),
                           "--types", json.dumps(types), "--events", json.dumps(events)],
                          env=sessions.agent_env(), capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL)
    if done.returncode:
        raise RuntimeError((done.stdout or done.stderr).strip()[-300:] or f"exited {done.returncode}")


def _connect(gatherer: str) -> Optional[sqlite3.Connection]:
    path = home.db_path(gatherer)
    if not os.path.exists(path):
        return None
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=8)
    conn.row_factory = sqlite3.Row
    return conn


def _columns(conn: sqlite3.Connection) -> Set[str]:
    return {r[1] for r in conn.execute("PRAGMA table_info(events)")}


def _host_records(gatherer: str) -> List[Tuple[str, str, Optional[str], dict]]:
    """(kind, instance, channel, payload) of the gatherer's app records, in order."""
    conn = _connect(gatherer)
    if conn is None:
        return []
    try:
        cols = _columns(conn)
        if "p_app" not in cols or "p_instance" not in cols:
            return []
        marks = ", ".join("?" for _ in app_kit.HOST_RECORDS)
        rows = conn.execute(
            f"SELECT t.name, e.p_instance, e.p_channel, e.payload_json FROM events e JOIN event_types t "
            f"ON t.event_type_id = e.event_type_id WHERE t.name IN ({marks}) AND t.name != 'app_call' "
            f"ORDER BY e.row_id", app_kit.HOST_RECORDS).fetchall()
    finally:
        conn.close()
    out = []
    for kind, inst, channel, payload in rows:
        try:
            out.append((kind, inst, channel, json.loads(payload)))
        except ValueError:
            continue
    return out


def _read(instance: Instance, types: Sequence[str], after: int, channel: Optional[str], agents: List[str],
          limit: int) -> List[dict]:
    conn = _connect(instance.gatherer)
    if conn is None:
        return []
    try:
        cols = _columns(conn)
        ids = {r[0]: r[1] for r in conn.execute(
            f"SELECT event_type_id, name FROM event_types WHERE name IN ({', '.join('?' for _ in types)})",
            list(types))} if types else {}
        if not ids:
            return []
        own = [i for i, n in ids.items() if n.startswith(instance.app + ".") or n in app_kit.HOST_RECORDS
               or n in app_kit.CONTEXT_TYPES]
        theirs = [i for i in ids if i not in own]
        clauses, args = [], []
        if own and "p_app" in cols and "p_instance" in cols:
            clauses.append(f"(e.event_type_id IN ({', '.join('?' for _ in own)}) AND e.p_app = ? AND e.p_instance = ?)")
            args += [*own, instance.app, instance.id]
        if theirs and agents:
            clauses.append(f"(e.event_type_id IN ({', '.join('?' for _ in theirs)}) AND e.p_channel IN "
                           f"({', '.join('?' for _ in agents)}))")
            args += [*theirs, *agents]
        if not clauses:
            return []
        where = f"e.row_id > ? AND ({' OR '.join(clauses)})"
        args = [after, *args]
        if channel is not None:
            where += " AND e.p_channel = ?"
            args.append(channel)
        props = [c for c in sorted(cols) if c.startswith("p_")]
        rows = conn.execute(
            f"SELECT e.row_id, e.event_id, e.event_type_id, e.payload_json, e.text, e.inserted_at, "
            f"{', '.join('e.' + c for c in props)} FROM events e WHERE {where} ORDER BY e.row_id LIMIT ?",
            [*args, limit]).fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        try:
            payload = json.loads(r["payload_json"])
        except (TypeError, ValueError):
            payload = None
        out.append({"row_id": r["row_id"], "type": ids[r["event_type_id"]], "payload": payload, "text": r["text"],
                    "at": r["inserted_at"],
                    "properties": {c[2:]: r[c] for c in props if r[c] is not None}})
    return out
