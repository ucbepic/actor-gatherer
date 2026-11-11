"""The context manager behind stdio: the one way every harness reaches it.

    <harness> --> ag/integrations/harnesses/<harness>/ag_orchestrator/ --(JSON lines, ag/integrations/tools/ag_connection/)--> python -m ag.ag_harness.server

The server knows no harness. The harness side (`ag/integrations/`) turns its
agent's messages into EVENTS and the context back into messages
(`ag/integrations/harnesses/<harness>/adaptor/`); this side stores the events and runs the
policy.

An event, as the harness side sends it:

    {"type": <type name>, "id": <stable id, or null>, "payload": <any JSON>, "tokens": <int, optional>,
     "text": <string, optional>, "properties": <{name: value}, optional>}

`type` names one of the gatherer's event types -- those its policy declares
(e.g. `user_message`, `tool_call`) -- or any other, added the first time it is
seen (declaring, as optional, the properties the request gives), which no
policy uses. `id` makes a re-sent event a duplicate. `payload` is stored and returned
exactly as given. `text` is its readable text -- a message's words, a tool
call's name and arguments, a tool's output, without the harness's ids and
metadata: what the policies show and count of it (its payload as JSON when
there is none). `tokens` is its cost, if the sender knows better than
counting its text (e.g. 0 for an opaque blob). `properties` are its own,
beside the request's (which win): what the harness's rules read of it (its
kind, the user's words, a tool call's action and id), each declared on its
type, as optional, the first time it is seen -- no policy needs to.

The context, as it comes back -- what the model should see, in order:

    {"type": <type name>, "id": ..., "payload": ...}      an event, as it was sent
    {"type": "ag", "name": <what it is>, "text": ...}     the context manager's own message

An `ag` message is text the policy wrote (a condensation of earlier history,
a notice, a stream message; ag/ag_interface/format.py): the harness side decides
how to show it to its model.

One JSON request per line on stdin, one answer per line on stdout, with the
request's `id`. Every request is stateless: the gatherer's manager is made
for it from the gatherer's directory (its gatherer.toml and its database) and
dropped after. `properties` are the request's: every event it inserts
carries them, and its read is made with them -- {name: value}, the names the
policy's event types declare (e.g. {"channel": <the harness's thread>});
none: {}. `cwd` is the working directory the gatherer's pollers look at.

    {"op": "rewrite", "gatherer", "properties", "cwd", "events", "measured"?, "limit"?, "preamble"?, "process"?, "run"?}
        -> {"context": [...] or null, "note", "read_id", "tokens", "budget", "sent_tokens", "basis", "uncounted"}
                                                one model call: insert, then read
                                                in response to the last event; null: send
                                                your own. `read_id` names the read, for
                                                `measured`; a `measured` given here is
                                                recorded before the read. `limit` is the
                                                harness's own limit for the call (where it
                                                compacts, or its window ends), in its
                                                provider's tokens; the policy keeps under it.
                                                `preamble`, [{"name", "text"}], is what the
                                                harness sends besides its messages (its system
                                                prompt, its tool definitions), kept with the read,
                                                as is `process`, {"pid", "started"}: the
                                                harness's process that made the call, and `run`:
                                                the harness's run that made it, as its launcher
                                                named it (codex's: the id of the process ag
                                                started).
                                                `tokens` is the context's size by the policy's
                                                count, `budget` the size it keeps it under (null:
                                                none), `sent_tokens` all the call sends by that
                                                count (every item, and the preamble), `basis`
                                                what it was built from (null: the history as it
                                                is); an `ag` item carries its `made_id`, a stored
                                                event its size as stored (`tokens`), whether
                                                that is the provider's count (`counted`), and,
                                                under a basis, `before_basis` when it came before
                                                the event the context switched to that basis at
                                                (the first read made from it, of the latest in a
                                                row) or `opens_basis` when it is that event.
                                                `uncounted`: the ids of the events given that the
                                                provider has not counted yet (`counted`). A harness
                                                that counts the context exactly before sending
                                                it, and finds it over `budget`, reports that
                                                count (`measured`) and asks again. `inserted`: the
                                                rows of the events it stored (not those already
                                                stored), and of those the harness had taken back
                                                and sends again: for a `withdraw`, should it take
                                                them back once more
    {"op": "context", "gatherer", "properties", "cwd", "events", "limit"?, "preamble"?}
        -> {"context": [...] or null, "note", "tokens", "budget", "sent_tokens", "basis"}
                                                a rewrite's context, read only: the events are
                                                inserted, then the context the next call would get
                                                is made, and nothing else changes -- nothing
                                                polled, no read logged, no build or check started
                                                (what the policy writes as it reads goes to a
                                                copy of the database). For a side call (a prompt
                                                suggestion) that sees the context without being one
    {"op": "compaction", "gatherer", "properties", "cwd", "events", "limit"?, "preamble"?}
        -> as `context`                         the harness is compacting its own history (Claude
                                                Code's /compact): the events are inserted, the
                                                policy builds -- a build that closes the running
                                                task and is adopted at the next read whatever its
                                                size -- and waits for it, and the context is
                                                answered read only, for the compaction call
    {"op": "measured", "gatherer", "read_id", "tokens"} -> {"recorded": bool}
                                                the provider's count of read `read_id`'s
                                                context: the call's input tokens, cached
                                                ones included, reported after the call (or
                                                counted exactly before it)
    {"op": "withdraw", "gatherer", "properties", "rows", "read_id"?} -> {"withdrawn": n}
                                                the harness took these events back (a call's
                                                `inserted`): it hung up on the call before the
                                                answer came, and does not send them again. Kept,
                                                but in no read and not in `latest`, until the
                                                harness sends one again (`insert` keeps it)
    {"op": "counted", "gatherer", "properties", "counts"?: {event_id: n}, "made"?: {made_id: n},
     "preamble_counts"?: [{"name", "text", "tokens"}], "left_out"?: {read_id: n}}
        -> {"events", "made", "preamble"}       sizes the model's provider counted after the
                                                fact (a harness that can ask it), in place of
                                                the tokenizer's: of the events with these ids
                                                (and properties), the made items, the preamble
                                                parts; and what the harness left out of a
                                                read's context before sending it, taken off the
                                                read's sent_tokens. How many of each were found
    {"op": "insert", "gatherer", "properties", "events", "lane"?} -> {"rows": [row id or null, ...], "last", "kept"}
                                                events as they are, each {"type", "payload", "id"?, "text"?,
                                                "properties"?, "at"?}: with `at` (UTC, ISO), what happened then
                                                and is recorded only now (an older file's tables copied), each
                                                stored at its time, all in one transaction ({"rows": []})
    {"op": "old_tables", "gatherer", "by"?, "types"?, "first"?} -> {"migrated", "recaps", "names", "touches",
                                                "pending", "failed", "groups", "answered"}
                                                what an older file's tables kept that are no longer kept
                                                (`_recaps`, `_names`, `_touches`, `_pending`, `_reads.error`),
                                                for the harness side to copy into events once; and each value
                                                of the property `by` its events have, with which of `types` it
                                                has events of and its first `first` events of other types
                                                (store.old_tables); {} with no database
    {"op": "migrated", "gatherer", "name"} -> {}  that the one-time copy `name` was made ("records")
    {"op": "read", "gatherer", "properties", "cwd", "row", "limit"?, "process"?, "run"?} -> {"context": [...], "read_id", "tokens", "budget", "sent_tokens", "basis"}
    {"op": "claim", "gatherer", "session", "process", "by"?} -> {"claimed": true, "took_over"?} or {"claimed": false, "holder"}
                                                `process` ({"pid", "started"}) opens the session
                                                (`_open`), unless another process that still runs
                                                has it and does not yield: then `holder`, that one
                                                ({"pid", "started", "opened_at", "opened_by"}), and
                                                nothing changes. One that yields (idle: the
                                                dashboard's agent between turns) is stopped, and
                                                named `took_over`. A harness's call is refused when
                                                it is not claimed
    {"op": "locate", "gatherer", "properties", "event_id"} -> {"row"}      (`id` is the request's own)
    {"op": "latest", "gatherer", "properties", "n", "types"?} -> {"events": [{"id", "payload"}, ...]}
                                                the `n` events last stored with exactly these
                                                identifying properties (of `types` alone, when
                                                given: the harness's conversation, not what its
                                                hook records besides), oldest first: where a
                                                harness that re-sends its whole history, and
                                                gives its events ids of its own making, picks
                                                it up (the claude adaptor's Continuity)
    {"op": "init", "gatherer", "event_types"?: [TYPE]} -> {"event_types": [TYPE with its id]}
    {"op": "event_types", "gatherer"} -> {"event_types": [...]}
    {"op": "add_event_type", "gatherer", TYPE's fields} -> {"type_id"}
    {"op": "open", "gatherer", "properties"} -> {"gatherer", "properties", "policy", "pollers", "config", "database"}

where TYPE is {"name", "properties"?: [{"name", "required"?, "identifies"?}]}.
    {"op": "ping"} -> {"pong": true}
    {"op": "hung_up", "gatherer", "properties"} -> {"stopped": bool}
                                                the harness hung up on the call its session's read
                                                is for (its user stopped it: Esc): that read, if one
                                                runs in the session's lane now, stops waiting for
                                                work of its own in the background (`Read.stopped`)
                                                and answers with what it has. Answered at once,
                                                beside the lanes; a read that has not begun is not
                                                touched (the harness says it again while it waits)

A request that fails is answered `{"id", "error"}`; a rewrite that fails is
answered with a null context, so the harness sends its own messages.
Nothing but answers is written to stdout: whatever else would go there (a
print in a policy or a plugin) goes to stderr. What each request came to goes
to the gatherer's `server.log` (`logs/gatherers/<gatherer>/`).

Requests run in LANES, one per gatherer and values of its identifying
properties -- those its types declare `identifies`: the harness's session, its
`channel` -- as the request's `properties` give them. A lane's requests are
answered one at a time, in the order they arrive; different lanes run side by
side, so a read that waits for its build holds up only its own session. An
`insert` that names `"lane": "records"` -- a hook's records of what it saw, which no read
depends on (the harness's own record of the session as it is written) -- runs in a lane of its
own beside its session's, in order with the others there, not behind a read that waits. A
request that gives none (`measured`, `claim`, `init`, ...)
runs in its gatherer's lane for none, in order with the others there but not
with any session's: no read waits on one of them that its sender has not
waited for itself (a `measured` is answered before the harness sees the call's
end, a `claim` before the call is made). A gatherer with no identifying
property, or none known yet (no database), has one lane. Answers come out as
they are ready, each one whole line: a client matches them to its requests by id.
A `hung_up` runs in no lane: it is answered as it is read, so a read it stops
need not end first (`Lanes.hung_up`).
"""

import json
import os
import re
import sqlite3
import sys
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional
from urllib.request import pathname2url

from ag.ag_interface import Event, EventType, Property
from ..store import paths, schema

#: How long a lane's thread waits for its next request before it ends (seconds): a
#: session's next call usually comes within it, and finds the thread's database
#: connections still open.
LINGER = 60.0
#: An insert's `lane` naming events no read depends on: run beside its session's lane (`lane_of`).
RECORDS_LANE = "records"
#: The requests that read for a harness's call -- and may wait for the policy's work in the background, until the
#: harness hangs up on it (`hung_up`).
READS = ("read", "rewrite", "compaction")
GROUP = "group"         # a conversation's group in the home's one database: its record (`Server.grouped`)


def log_line(gatherer: str, line: str) -> None:
    """A line on stderr, and in the gatherer's server.log. Each written whole: lanes log at once."""
    sys.stderr.write(f"[{gatherer}] {line}\n")
    sys.stderr.flush()
    path = paths.server_log(gatherer)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(f"{datetime.now(timezone.utc).isoformat(timespec='seconds')} {line}\n")
    except OSError:
        pass


def _type(t: EventType) -> dict:
    return {"id": t.id, "name": t.name,
            "properties": [{"name": p.name, "required": p.required, "identifies": p.identifies}
                           for p in t.properties]}


def type_of(t) -> EventType:
    """The EventType a request's TYPE is.

    Raises:
        BadEvent: it is not {"name": <non-empty>, "properties"?: [{"name", "required"?, "identifies"?}]}.
    """
    if not isinstance(t, dict) or not isinstance(t.get("name"), str) or not t["name"]:
        raise BadEvent(f"not an event type: {str(t)[:120]}")
    props = t.get("properties") or []
    if not isinstance(props, list) or not all(isinstance(p, dict) and isinstance(p.get("name"), str) for p in props):
        raise BadEvent(f"event type {t['name']!r}: properties must be [{{name, required?, identifies?}}], "
                       f"not {str(props)[:120]}")
    return EventType(t["name"], tuple(Property(p["name"], bool(p.get("required")), bool(p.get("identifies")))
                                      for p in props))


def properties_of(request: dict) -> Dict[str, Any]:
    """The request's properties.

    Raises:
        BadEvent: they are not an object.
    """
    props = request.get("properties")
    if props is None:
        return {}
    if not isinstance(props, dict):
        raise BadEvent(f"properties must be an object, not {str(props)[:120]}")
    return props


def limit_of(value) -> Optional[int]:
    """A harness's stated limit: a positive int, else None (none stated)."""
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def preamble_of(value) -> Optional[List[dict]]:
    """A harness's stated preamble: the [{"name", "text"}] whose name and text are non-empty
    strings; None for none."""
    if not isinstance(value, list):
        return None
    out = [{"name": p["name"], "text": p["text"]} for p in value
           if isinstance(p, dict) and isinstance(p.get("name"), str) and p["name"] and isinstance(p.get("text"), str) and p["text"]]
    return out or None


def process_of(value) -> Optional[dict]:
    """A harness's process, as the hook server found it: {"pid": a positive int, "started": a
    non-empty string}; None if it is not one."""
    if not isinstance(value, dict):
        return None
    pid, started = value.get("pid"), value.get("started")
    if isinstance(pid, int) and not isinstance(pid, bool) and pid > 0 and isinstance(started, str) and started:
        return {"pid": pid, "started": started[:200]}
    return None


def run_of(value) -> Optional[str]:
    """A harness's run, as its launcher named it: letters, digits, `.`, `_` and `-`; None if it is not one."""
    return value if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9._-]{1,64}", value) else None


def counted_of(request) -> Optional[tuple]:
    """(events {id: tokens}, made {made_id: tokens}, preamble [(name, text, tokens)], left_out
    {read_id: tokens}) from a `counted` request, what is not a whole number of tokens left out;
    None if it holds none."""
    def size(v):
        return isinstance(v, int) and not isinstance(v, bool) and v >= 0
    events = {k: v for k, v in (request.get("counts") or {}).items() if isinstance(k, str) and size(v)} \
        if isinstance(request.get("counts"), dict) else {}
    made = {}
    for k, v in (request.get("made") or {}).items() if isinstance(request.get("made"), dict) else ():
        if str(k).isdigit() and size(v):
            made[int(k)] = v
    preamble = [(p["name"], p["text"], p["tokens"]) for p in request.get("preamble_counts") or ()
                if isinstance(p, dict) and isinstance(p.get("name"), str) and isinstance(p.get("text"), str)
                and size(p.get("tokens"))]
    left_out = {}
    for k, v in (request.get("left_out") or {}).items() if isinstance(request.get("left_out"), dict) else ():
        if str(k).isdigit() and size(v):
            left_out[int(k)] = v
    return (events, made, preamble, left_out) if events or made or preamble or left_out else None


def measured_of(value) -> Optional[dict]:
    """{"read_id", "tokens"} from a `measured` (or a `measured` request), both
    positive ints; None if it is not one -- a size that is not given, or not
    one, is no size."""
    if not isinstance(value, dict):
        return None
    read_id, tokens = value.get("read_id"), value.get("tokens")
    ok = all(isinstance(v, int) and not isinstance(v, bool) and v > 0 for v in (read_id, tokens))
    return {"read_id": read_id, "tokens": tokens} if ok else None


def tag(properties: Dict[str, Any]) -> str:
    """How the log shows a request's properties: `[v1/v2] `, or nothing."""
    values = [str(v) for v in properties.values() if v is not None]
    return f"[{'/'.join(values)}] " if values else ""


class BadEvent(ValueError):
    """An event that is not `{"type": <non-empty name>, "payload", ...}`."""


class Server:
    """The manager functions, over generic events.

    Args:
        factory: (gatherer) -> a new manager (a `Manager`).
        pollers: (gatherer, cwd or None) -> the gatherer's pollers for a read.
        log: (gatherer, line) -> None.
        describe: (gatherer) -> what `open` answers besides the gatherer.
    """

    def __init__(self, factory: Callable, pollers: Callable = lambda gatherer, cwd: [],
                 log: Callable[[str, str], None] = lambda gatherer, line: None,
                 describe: Callable = lambda gatherer: {}):
        self.factory, self.pollers, self.log, self.describe = factory, pollers, log, describe
        self.grouped_seen: set = set()      # (gatherer, its identifying values) known to have a `group` record (`grouped`)

    def manager(self, gatherer: str):
        """A manager for one request, made from the gatherer's directory
        (`factory`, then `init`). None is kept."""
        created = not os.path.exists(paths.db_path(gatherer))
        manager = self.factory(gatherer)
        manager.init(gatherer)
        if created:
            self.log(gatherer, f"gatherer {gatherer} created ({manager.name})")
        return manager

    def identifying(self, gatherer: Optional[str]) -> Optional[tuple]:
        """The names of the gatherer's identifying properties -- those its types declare `identifies`
        (`schema.identifying_names`): the harness's session -- as its database has them: through this
        thread's connection to it, if one is open, else a look at the file, read only. None when it
        has no database yet. A request's lane is its values of them (`serve`).

        Raises:
            sqlite3.Error: the file cannot be read.
        """
        if not gatherer:
            return None
        conn = schema.opened(gatherer)
        if conn is not None:
            return tuple(schema.identifying_names(conn))
        path = paths.db_path(gatherer)
        if not os.path.exists(path):
            return None
        conn = sqlite3.connect(f"file:{pathname2url(path)}?mode=ro", uri=True, timeout=8)
        try:
            return tuple(schema.identifying_names(conn))
        finally:
            conn.close()

    def with_pollers(self, manager, gatherer: str, cwd: Optional[str]):
        """The manager, with the gatherer's pollers for `cwd` (none, if they
        cannot be made: a bad poller config must not block the call)."""
        try:
            manager.set_pollers(list(self.pollers(gatherer, cwd)))
        except Exception as exc:  # noqa: BLE001
            self.log(gatherer, f"pollers failed: {exc}; none this call")
            manager.set_pollers([])
        return manager

    @staticmethod
    def events_of(manager, gatherer: str, events: list, properties: Dict[str, Any]) -> List[Event]:
        """The Events `events` are, their types named, each with `properties` -- and with the properties it carries of
        its own (its `properties`; the request's win): a name the gatherer does not have is added, declaring each of
        `properties` as optional; a property an event carries that its type does not declare is declared on it, as
        optional (what a harness's rules read of each event: its kind, the user's words, ...)."""
        types: Dict[str, EventType] = {t.name: t for t in manager.event_types(gatherer)}
        out = []
        for e in events:
            if not isinstance(e, dict) or not isinstance(e.get("type"), str) or not e["type"] or "payload" not in e:
                raise BadEvent(f"not an event: {str(e)[:120]}")
            name = e["type"]
            own = e.get("properties") if isinstance(e.get("properties"), dict) else {}
            own = {k: v for k, v in own.items() if isinstance(k, str) and k not in properties and v is not None}
            if name not in types:
                types[name] = EventType(name, tuple(Property(p) for p in (*properties, *own)))
                types[name] = EventType(name, types[name].properties, id=manager.add_event_type(gatherer, types[name]))
            missing = [k for k in own if k not in {p.name for p in types[name].properties}]
            if missing:
                more = EventType(name, types[name].properties + tuple(Property(k) for k in missing))
                manager.add_event_type(gatherer, more)
                types[name] = EventType(name, more.properties, id=types[name].id)
            tokens, text = e.get("tokens"), e.get("text")
            out.append(Event(types[name].id, e["payload"], id=e.get("id") or None,
                             tokens=tokens if isinstance(tokens, int) else None, properties={**own, **properties},
                             text=text if isinstance(text, str) else None))
        return out

    # ---- the manager functions

    def insert(self, gatherer: str, properties: Dict[str, Any], events: list, manager=None) -> dict:
        """The events stored: each one's row (None: stored already), the one to respond to (`last`), and the rows of
        those the harness had taken back and sends again (`kept`), in reads again. Events given their time (`at`):
        each stored at it, in one transaction, no rows said."""
        manager = manager or self.manager(gatherer)
        self.grouped(manager, gatherer, properties)
        stored = self.events_of(manager, gatherer, events, properties)
        times = [e.get("at") if isinstance(e, dict) and isinstance(e.get("at"), str) else None for e in events]
        if any(times):
            manager.insert_at(gatherer, stored, times)
            return {"rows": [], "last": None, "kept": []}
        kept: List[int] = []
        rows = [manager.insert_kept(gatherer, e, kept) for e in stored]
        last = rows[-1] if rows else None
        if stored and last is None and stored[-1].id:          # the last one was already stored
            last = manager.locate(gatherer, stored[-1].id, properties=properties)
        return {"rows": rows, "last": last, "kept": kept}

    def grouped(self, manager, gatherer: str, properties: Dict[str, Any]) -> None:
        """In the home's one database (`paths.merged`), before a conversation's first event: a `group` record in it --
        {group: the gatherer its request names, the one it was started under} -- so that every conversation there is
        in a group, none by default. Never over a record it has (the dashboard's, moving it); once per process for
        each conversation (its values of the gatherer's identifying properties)."""
        if not paths.merged():
            return
        names = self.identifying(gatherer) or ()
        values = tuple(properties.get(n) for n in names)
        if not names or any(v is None for v in values) or (gatherer, values) in self.grouped_seen:
            return
        own = dict(zip(names, values))
        if not manager.latest(gatherer, own, 1, types=[GROUP]):
            for e in self.events_of(manager, gatherer, [{"type": GROUP, "id": f"{GROUP}:first",
                                                          "payload": {"group": gatherer}}], own):
                manager.insert(gatherer, e)
        self.grouped_seen.add((gatherer, values))

    def read(self, gatherer: str, properties: Dict[str, Any], cwd: Optional[str], row: int, manager=None,
             limit: Optional[int] = None, preamble: Optional[List[dict]] = None,
             process: Optional[dict] = None, run: Optional[str] = None,
             stopped: Optional[Callable[[], bool]] = None) -> dict:
        manager = self.with_pollers(manager or self.manager(gatherer), gatherer, cwd)
        more = {"stopped": stopped} if stopped is not None else {}
        context, read_id, sizes = manager.read_logged(gatherer, row, properties=properties, limit=limit,
                                                      preamble=preamble, process=process, run=run, **more)
        return {"context": context, "read_id": read_id, **sizes}

    def measured(self, gatherer: str, read_id: int, tokens: int) -> dict:
        """Record the provider's count of the context read `read_id` returned."""
        return {"recorded": self.manager(gatherer).record_real_tokens(gatherer, read_id, tokens)}

    def withdraw(self, gatherer: str, properties: Dict[str, Any], rows: list, read_id: Optional[int] = None) -> dict:
        """Withdraw the events of `rows`: the harness took them back (`Manager.withdraw`)."""
        n = self.manager(gatherer).withdraw(gatherer, properties, rows, read_id)
        if n:
            self.log(gatherer, tag(properties) + f"{n} events withdrawn: the harness took them back"
                     + (f" (read {read_id})" if read_id is not None else ""))
        return {"withdrawn": n}

    def counted(self, gatherer: str, properties: Dict[str, Any], events: dict, made: dict, preamble: list,
                left_out: Optional[dict] = None) -> dict:
        """Record sizes the model's provider counted after the fact, in place of the tokenizer's."""
        return self.manager(gatherer).record_counts(gatherer, properties, events, made, preamble, left_out)

    def locate(self, gatherer: str, properties: Dict[str, Any], event_id: str) -> dict:
        return {"row": self.manager(gatherer).locate(gatherer, event_id, properties=properties)}

    def init(self, gatherer: str, event_types=()) -> dict:
        manager = self.manager(gatherer)
        for t in event_types or ():
            manager.add_event_type(gatherer, type_of(t))
        return {"event_types": [_type(t) for t in manager.event_types(gatherer)]}

    def event_types(self, gatherer: str) -> dict:
        return {"event_types": [_type(t) for t in self.manager(gatherer).event_types(gatherer)]}

    def add_event_type(self, gatherer: str, event_type: EventType) -> dict:
        return {"type_id": self.manager(gatherer).add_event_type(gatherer, event_type)}

    # ---- one model call

    def rewrite(self, gatherer: str, properties: Dict[str, Any], cwd: Optional[str], events: list,
                measured: Optional[dict] = None, limit: Optional[int] = None,
                preamble: Optional[List[dict]] = None, read_only: bool = False, compacted: bool = False,
                process: Optional[dict] = None, run: Optional[str] = None,
                stopped: Optional[Callable[[], bool]] = None) -> dict:
        """Insert `events`, then read in response to the last. `measured`,
        {"read_id", "tokens"}, is the provider's count of an earlier read's
        context, recorded first, so this read sees it. With `read_only`, the
        context only (`Manager.context_only`): nothing else of the gatherer's
        state changes, and there is no read_id. With `compacted` (read only
        too), the harness compacted its history: the policy builds first, and
        waits for it (`Manager.compacted`). `stopped`: whether the harness has
        given up on the call -- a read or a compaction waiting for a build stops
        waiting then (`Read.stopped`). Never raises: a failure anywhere
        answers a null context."""
        prefix = tag(properties)
        if measured is not None:
            try:
                self.manager(gatherer).record_real_tokens(gatherer, measured["read_id"], measured["tokens"])
            except Exception as exc:  # noqa: BLE001 - a lost count never blocks the call
                self.log(gatherer, prefix + f"could not record the measured size: {exc!r}")
        try:
            manager = self.manager(gatherer)
            inserted = self.insert(gatherer, properties, events, manager)
            last = inserted["last"]
        except Exception as exc:  # noqa: BLE001 - never block the model call
            note = f"insert failed: {exc!r}; messages unchanged"
            self.log(gatherer, prefix + note)
            return {"context": None, "note": note}
        if last is None:
            note = f"{len(events)} events in, no event to respond to; messages unchanged"
            self.log(gatherer, prefix + note)
            return {"context": None, "note": note}
        built = ""
        if compacted:
            try:
                built = manager.compacted(gatherer, last, properties=properties, limit=limit, preamble=preamble,
                                          **({"stopped": stopped} if stopped is not None else {}))
            except Exception as exc:  # noqa: BLE001 - a failed build never blocks the call
                built = f"failed: {exc!r}"
        try:
            if read_only:
                context, sizes = manager.context_only(gatherer, last, properties=properties, limit=limit,
                                                      preamble=preamble)
                answer = {"context": context, "read_id": None, **sizes}
            else:
                answer = self.read(gatherer, properties, cwd, last, manager, limit, preamble, process, run, stopped)
        except Exception as exc:  # noqa: BLE001
            note = f"read failed: {exc!r}; messages unchanged"
            self.log(gatherer, prefix + note)
            return {"context": None, "note": note}
        context = answer["context"]
        ags = sum(1 for e in context if e.get("type") == "ag")
        note = f"{len(events)} events in (event {last}), {len(context)} out ({ags} ag)" + (" read only" if read_only else "") \
            + (f", compaction build: {built or 'none'}" if compacted else "")
        self.log(gatherer, prefix + note)
        try:
            uncounted = manager.uncounted(gatherer, properties, [e.get("id") for e in events if isinstance(e, dict)])
        except Exception as exc:  # noqa: BLE001 - a harness that does not know counts them again
            self.log(gatherer, prefix + f"could not tell which events are counted: {exc!r}")
            uncounted = None
        return {"context": context, "note": note, "read_id": answer["read_id"], "uncounted": uncounted,
                "inserted": [r for r in inserted["rows"] if r is not None] + inserted["kept"],
                **{k: answer.get(k) for k in ("tokens", "budget", "sent_tokens", "basis")}}

    def open(self, gatherer: str, properties: Dict[str, Any]) -> dict:
        self.manager(gatherer)
        return dict({"gatherer": gatherer, "properties": properties}, **self.describe(gatherer))

    # ---- requests

    def handle(self, request: dict, stopped: Optional[Callable[[], bool]] = None) -> dict:
        """The answer to one request (without its id). `stopped`, for a read (READS): whether the harness has
        hung up on its call since (`hung_up`)."""
        op = request.get("op")
        if op == "ping":
            return {"pong": True}
        gatherer = request.get("gatherer")
        if not isinstance(gatherer, str) or not gatherer:
            return {"error": "no gatherer"}
        properties, cwd, events = properties_of(request), request.get("cwd"), request.get("events")
        if op == "rewrite":
            if not isinstance(events, list):
                return {"context": None, "note": "no events; messages unchanged"}
            return self.rewrite(gatherer, properties, cwd, events, measured_of(request.get("measured")),
                                limit_of(request.get("limit")), preamble_of(request.get("preamble")),
                                process=process_of(request.get("process")), run=run_of(request.get("run")),
                                stopped=stopped)
        if op in ("context", "compaction"):
            if not isinstance(events, list):
                return {"context": None, "note": "no events; messages unchanged"}
            return self.rewrite(gatherer, properties, cwd, events, None, limit_of(request.get("limit")),
                                preamble_of(request.get("preamble")), read_only=True, compacted=op == "compaction",
                                stopped=stopped)
        if op == "measured":
            measured = measured_of(request)
            if measured is None:
                return {"error": "no read_id and tokens"}
            return self.measured(gatherer, measured["read_id"], measured["tokens"])
        if op == "withdraw":
            rows, read_id = request.get("rows"), request.get("read_id")
            if not isinstance(rows, list) or not all(isinstance(r, int) and not isinstance(r, bool) for r in rows):
                return {"error": "no rows"}
            return self.withdraw(gatherer, properties, rows,
                                 read_id if isinstance(read_id, int) and not isinstance(read_id, bool) else None)
        if op == "counted":
            sizes = counted_of(request)
            if sizes is None:
                return {"error": "no counts"}
            return self.counted(gatherer, properties, *sizes)
        if op == "insert":
            if not isinstance(events, list):
                return {"error": "no events"}
            return self.insert(gatherer, properties, events)
        if op == "old_tables":
            by, types, first = request.get("by"), request.get("types"), request.get("first")
            return self.factory(gatherer).old_tables(
                gatherer, by if isinstance(by, str) and by else None,
                [t for t in types if isinstance(t, str)] if isinstance(types, list) else [],
                first if isinstance(first, int) and not isinstance(first, bool) and first > 0 else 0)
        if op == "migrated":
            if not isinstance(request.get("name"), str) or not request["name"]:
                return {"error": "no name"}
            self.manager(gatherer).mark_migrated(gatherer, request["name"])
            self.log(gatherer, f"{request['name']}: copied once")
            return {}
        if op == "read":
            if not isinstance(request.get("row"), int):
                return {"error": "no row"}
            return self.read(gatherer, properties, cwd, request["row"], limit=limit_of(request.get("limit")),
                             process=process_of(request.get("process")), run=run_of(request.get("run")),
                             stopped=stopped)
        if op == "claim":
            process, session = process_of(request.get("process")), request.get("session")
            if process is None or not isinstance(session, str) or not session:
                return {"error": "no session and process"}
            return self.manager(gatherer).claim(gatherer, session, process, str(request.get("by") or "call")[:40])
        if op == "locate":
            if not isinstance(request.get("event_id"), str):
                return {"error": "no event_id"}
            return self.locate(gatherer, properties, request["event_id"])
        if op == "latest":
            n = request.get("n")
            if not isinstance(n, int) or isinstance(n, bool) or n < 0:
                return {"error": "no n"}
            types = request.get("types")
            types = [t for t in types if isinstance(t, str)] if isinstance(types, list) else None
            manager = self.factory(gatherer)        # read only, and on every model call: no `init`
            return {"events": [{"id": i, "payload": p} for i, p in manager.latest(gatherer, properties, n, types)]}
        if op == "init":
            return self.init(gatherer, request.get("event_types"))
        if op == "event_types":
            return self.event_types(gatherer)
        if op == "add_event_type":
            if not isinstance(request.get("name"), str) or not request["name"]:
                return {"error": "no name"}
            return self.add_event_type(gatherer, type_of(request))
        if op == "open":
            return self.open(gatherer, properties)
        return {"error": f"no op {op!r}"}

    def answer(self, request: dict, stopped: Optional[Callable[[], bool]] = None) -> dict:
        """The answer to `request`, with its id; never raises. `stopped`: as `handle`'s."""
        try:
            result = self.handle(request, stopped) if stopped is not None else self.handle(request)
        except Exception as exc:  # noqa: BLE001
            result = {"error": f"{type(exc).__name__}: {exc}"}
        return dict(result, id=request.get("id"))


def gatherer_of(request: dict) -> Optional[str]:
    gatherer = request.get("gatherer")
    return gatherer if isinstance(gatherer, str) else None


def lane_of(request: dict, names: tuple) -> tuple:
    """The lane `request` runs in when its gatherer's identifying properties are `names`
    (`Server.identifying`): its gatherer, and its values of them (None: not given) -- and, for an
    `insert` of records (RECORDS_LANE), a lane of their own beside those."""
    props = request.get("properties")
    props = props if isinstance(props, dict) else {}
    key = gatherer_of(request), tuple((n, _hashable(props.get(n))) for n in names)
    if request.get("op") == "insert" and request.get("lane") == RECORDS_LANE:    # beside its session's (module doc)
        return key + (RECORDS_LANE,)
    return key


def _hashable(value):
    if value is None or isinstance(value, (str, int, float)):
        return value
    return json.dumps(value, sort_keys=True, default=str)          # not a property's value: refused in its lane


class Lanes:
    """The requests `serve` has read, each run in its lane (`lane_of`): a thread per lane while it
    has requests, and `linger` seconds after, answering them one at a time in the order they came;
    lanes side by side. Each answer is written to `out` whole, as it is ready.

    A request is placed by its gatherer's identifying properties as last found (`Server.identifying`:
    when the gatherer is first seen, and after each answer). When they change -- a new gatherer's,
    once its database has its types -- the gatherer's requests after the change are held until those
    placed before it are answered: a lane by the new ones never runs ahead of one by the old.

    A read (READS) running in a lane can be stopped from outside it (`hung_up`): the harness hung up on its call."""

    def __init__(self, server: Server, out, linger: float = LINGER):
        self.server, self.out, self.linger = server, out, linger
        self.lock = threading.Condition()
        self.queues: Dict[tuple, deque] = {}        # lane -> its requests not begun; there while its thread runs
        self.running = 0                            # lane threads not yet ended
        self.ended = False                          # no request comes after these
        self.found: Dict[Any, tuple] = {}           # gatherer -> its identifying properties, as last found
        self.placed: Dict[Any, tuple] = {}          # gatherer -> those its requests not yet answered were placed by
        self.busy: Dict[Any, int] = {}              # gatherer -> its requests placed and not yet answered
        self.held: Dict[Any, deque] = {}            # gatherer -> its requests waiting for those to be answered
        self.writing = threading.Lock()
        self.broken: Optional[Exception] = None     # what writing an answer raised: no one reads them
        self.reading: Dict[tuple, threading.Event] = {}    # lane -> the read running there: set once its harness hangs up

    def write(self, result: dict) -> None:
        try:
            line = json.dumps(result, ensure_ascii=False)
        except (TypeError, ValueError) as exc:
            line = json.dumps({"id": result.get("id"), "error": f"the answer is not JSON: {exc}"})
        with self.writing:
            if self.broken is None:
                try:
                    self.out.write(line + "\n")
                    self.out.flush()
                except (OSError, ValueError) as exc:     # a closed pipe, or file
                    self.broken = exc

    def submit(self, request: dict) -> None:
        gatherer = gatherer_of(request)
        names = None if gatherer in self.found else self.identifying(gatherer)     # a gatherer not seen yet
        stopped = None
        with self.lock:
            if names is not None:
                self.found.setdefault(gatherer, names)
            if request.get("op") == "hung_up":
                stopped = self.hung_up(gatherer, request)
            elif gatherer in self.held:
                self.held[gatherer].append(request)
            else:
                self.place(gatherer, request)
        if stopped is not None:
            self.write({"stopped": stopped, "id": request.get("id")})

    def hung_up(self, gatherer, request: dict) -> bool:
        """The read running in the lane `request` names (under the lock) told that its harness hung up on its call:
        whether one runs there. One queued behind it is not: the harness says it again while it waits."""
        stop = self.reading.get(lane_of(request, self.found.get(gatherer, ())))
        if stop is not None:
            stop.set()
        return stop is not None

    def place(self, gatherer, request: dict) -> None:
        """Put `request` in its lane (under the lock) -- or hold it, while requests of its gatherer
        placed by other identifying properties are not all answered."""
        names = self.found.get(gatherer, ())
        if self.busy.get(gatherer) and self.placed[gatherer] != names:
            self.held.setdefault(gatherer, deque()).append(request)
            return
        self.placed[gatherer], self.busy[gatherer] = names, self.busy.get(gatherer, 0) + 1
        key = lane_of(request, names)
        queue = self.queues.get(key)
        if queue is not None:
            queue.append(request)
            self.lock.notify_all()
            return
        queue = self.queues[key] = deque([request])
        self.running += 1
        try:
            threading.Thread(target=self.run, args=(key, queue), daemon=True,
                             name=f"ag lane {key[0]} {key[1]}").start()
        except RuntimeError as exc:                 # no thread to be had
            del self.queues[key]
            self.running -= 1
            self.write({"id": request.get("id"), "error": f"no thread to answer it: {exc}"})
            self.answered(gatherer, None)

    def answered(self, gatherer, names: Optional[tuple]) -> None:
        """One of the gatherer's requests is answered (under the lock), and its identifying
        properties found to be `names` (None: not known); those held, once none placed is left."""
        if names is not None:
            self.found[gatherer] = names
        self.busy[gatherer] -= 1
        if self.busy[gatherer]:
            return
        del self.busy[gatherer], self.placed[gatherer]
        held = self.held.pop(gatherer, deque())
        while held and gatherer not in self.held:
            self.place(gatherer, held.popleft())
        if held:
            self.held[gatherer].extend(held)

    def identifying(self, gatherer) -> Optional[tuple]:
        try:
            return self.server.identifying(gatherer)
        except Exception:  # noqa: BLE001 - the lanes stay as they were
            return None

    def run(self, key: tuple, queue: deque) -> None:
        gatherer = key[0]
        try:
            while True:
                with self.lock:
                    deadline = time.monotonic() + self.linger
                    while not queue and not self.ended and time.monotonic() < deadline:
                        self.lock.wait(deadline - time.monotonic())
                    if not queue:                   # gone from the lanes as it ends: a request after starts another
                        del self.queues[key]
                        return
                    request = queue.popleft()
                    stop = threading.Event() if request.get("op") in READS else None
                    if stop is not None:
                        self.reading[key] = stop
                self.write(self.server.answer(request, stop.is_set if stop is not None else None))
                names = self.identifying(gatherer)
                with self.lock:
                    if stop is not None and self.reading.get(key) is stop:
                        del self.reading[key]
                    self.answered(gatherer, names)
        finally:
            try:
                schema.release()                    # the thread's database connections
            finally:
                with self.lock:
                    self.running -= 1
                    self.lock.notify_all()

    def close(self) -> None:
        """Once every request submitted is answered, and every lane's thread has ended."""
        with self.lock:
            self.ended = True
            self.lock.notify_all()
            while self.running:
                self.lock.wait()


def serve(server: Server, lines, out, linger: float = LINGER) -> None:
    """Answer each JSON line of `lines` on `out`, one line per answer, until `lines` ends; then
    return once every request is answered. Each request runs in its lane (`Lanes`): one session's
    in the order they came, different sessions' side by side, so answers come out as they are ready."""
    lanes = Lanes(server, out, linger)
    try:
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except ValueError as exc:
                lanes.write({"id": None, "error": f"not JSON: {exc}"})
            else:
                if isinstance(request, dict):
                    lanes.submit(request)
                else:
                    lanes.write({"id": None, "error": "not an object"})
            if lanes.broken is not None:
                break
    finally:
        lanes.close()
    if lanes.broken is not None:
        raise lanes.broken
