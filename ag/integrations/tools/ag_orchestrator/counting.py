"""The provider's own count of what a proxied harness's calls hold, for the context manager to size contexts by.

Why. ag counts every event with its own tokenizer (o200k_base), and a model's provider counts the same text its own
way: Gemini counts ~20% more than o200k_base on prose and code alike, Anthropic and OpenAI a few % either way, and
each frames messages, tool calls and tool definitions differently. The policy sizes a context by these counts -- when
it builds, where it cuts the running task -- while what it is held to is the provider's count of the call (its
reported input tokens). A harness whose events keep ag's counts is built for too late, or over and over (2026-11-01:
an Antigravity actor started 15 builds in 50 minutes, 12 of which changed nothing, because ag's count said the
context fit while Gemini's said it did not). So each new event's count is replaced by the provider's.

How. After a call is sent, in the background (`Counter.start`, never delaying it), the provider's count endpoint is
asked for:

    a new step        each step of the harness's items not counted yet (items up to a cut that leaves no tool call
                      without its output, as `ends_step` says), counted standalone -- after a one-word placeholder,
                      the placeholder subtracted -- then split into its items by counting it again without each: a
                      message (or other item) taken out, a tool output's content cut to one word; a tool call gets
                      what is left. A step the endpoint will not take alone is counted in the history, shared by size.
    the context       ag's own items (its sections, notices) standalone, once per text, as the adaptor sends them.
    manager's items
    the preamble      the harness's two preamble fields (`PREAMBLE`: its instructions, its tools), once per version:
                      the placeholder with both, with the first alone, and with neither.

What an endpoint counts as nothing but the call is charged for (`COSTS_HIDDEN`: codex's encrypted reasoning items,
Gemini's thought signatures) costs what the call's own count is over the endpoint's count of the request as sent
(`hidden_counts`): codex's, less the reasoning already costed, shared among the reasoning new in it; Gemini's, at a
rate per signature character, the whole gap over every signature sent. Until a call's own count is back, the hidden
part costs what it was last found to (`hidden_estimate`, `extra`).
Without an endpoint (no credentials, one that cannot count, a model it does not know), the call's own counts tell the
rest: two calls of a channel in a row, the later's context the earlier's with items added (the same build, nothing
taken out), differ by exactly what those items cost (`differenced`). Near the policy's budget, the hook also counts the
request exactly before sending it (`exact`) and, over the budget, reports that count (the server's `measured`) and
reads again, so the build happens before the call rather than after it.

The counts go to the server (`counted`), which sets them in place of the tokenizer's. What is known is ag's, not this
process's: each stored event of a context comes with its size as stored and whether that is the provider's count, and
the answer names the call's events not counted yet (`uncounted`). So a hook server started again counts what the last
one would have.

A NEW HARNESS. A proxied harness whose provider has a count endpoint subclasses `Counter` with the provider's half --
the endpoint and its credentials (`where`), what it is posted (`payload`) and answers (`tokens_of`, `unknown_model`),
the request's conversation field (`INPUT`) and the rest the endpoint takes (`base_of`, `bare_of`), a one-word
`PLACEHOLDER`, its `PREAMBLE` fields, and its items' shapes (`call_of`, `cut_output`, `ends_step`, `is_reasoning`,
`made_weight`; `COSTS_HIDDEN` with `hidden_counts`, `hidden_estimate` and `extra` for what its endpoint does not
count) -- and its hook calls `exact` near the budget, `sent` and `start` once a call is sent, and `reported`
with the call's own count (as codex's and Antigravity's hooks do). Codex's (OpenAI's /v1/responses/input_tokens) and
Antigravity's (Gemini's :countTokens) are the two subclasses; Claude Code's counting.py is older and its own (Anthropic's
/v1/messages/count_tokens, and its thinking's binding). Check the endpoint against the call's own count on a real
request before relying on it: rebuild calls from their reads, count each whole, and compare with the calls' own
counts -- calls with and without reasoning, tool calls and images, since an endpoint can count a part as nothing that
the call is charged for (codex's reasoning; Gemini's endpoint matched its calls to the token without signatures, and
fell short by 0.114 tokens a signature character with them).
"""

import asyncio
import copy
import hashlib
import json
import sys
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from harness_kit import Kind

from .adaptor import CHANNEL
from .call_ag import preamble_of

CANNOT_COUNT = (403, 404, 405, 501)          # the endpoint is not there: not asked again
BUSY = 429                                   # too many asks: this one not counted, nothing else asked instead
COUNT_SECONDS = 5.0
REPORT_SECONDS = 600.0       # how long the reasoning's count waits for the call's own counting to finish
STEPS_PER_CALL = 25          # new steps counted after one call at most; the rest after the next ones
KEPT_SENT = 8                # calls whose own count is awaited, per channel, at most


def event_of(adaptor, item) -> Optional[dict]:
    """The event an item is, as the adaptor makes it; None for one it makes none of."""
    try:
        made = adaptor.to_events([item]) if isinstance(item, dict) else []
    except Exception:  # noqa: BLE001 - an item the adaptor cannot read: not counted
        return None
    return made[0] if made and isinstance(made[0], dict) else None


def kind_of(adaptor, item) -> str:
    """An item's event type, as the adaptor gives it."""
    return (event_of(adaptor, item) or {}).get("type") or ""


def key_of(adaptor, item) -> str:
    """An item's id, as its event has it (the adaptor's: the harness's own id, else a hash of it)."""
    made = event_of(adaptor, item)
    return made["id"] if made and isinstance(made.get("id"), str) else json.dumps(item, sort_keys=True)


def ag_item(adaptor, text: str) -> Optional[dict]:
    """The context manager's own item as the adaptor sends it."""
    try:
        out = adaptor.to_messages([{"type": "ag", "name": "", "text": text}], [])
    except Exception:  # noqa: BLE001
        return None
    return out[0] if out and isinstance(out[0], dict) else None


def weight_of(adaptor, item) -> int:
    """An item's share of a count shared among items, as ag counts it: the length of its event's text,
    else of its JSON; nothing for an event ag counts as nothing (an encrypted reasoning item)."""
    made = event_of(adaptor, item) or {}
    if made.get("tokens") == 0:
        return 0
    text = made.get("text")
    return len(text if isinstance(text, str) else json.dumps(item, sort_keys=True, ensure_ascii=False))


@dataclass
class Sent:
    """One call's context as it was sent, for counting by the call's own count: its build, its preamble
    parts ([(name, text)]), and each item's key with what it is in the gatherer -- ("event", its id, or
    None: not this call's) or ("made", made_id) -- and the item."""
    basis: Optional[str]
    preamble: List[Tuple[str, str]]
    keys: List[str]
    parts: List[Tuple[str, Optional[object], dict]]


@dataclass
class Channel:
    """What one conversation's counting remembers between calls: caches (see the module's doc), and
    what a call needs until its own count is back."""
    counting: Set[str] = field(default_factory=set)           # event ids this process counted
    reasoning: Dict[str, int] = field(default_factory=dict)   # an item's id: what its hidden part costs
    visible: Dict[str, int] = field(default_factory=dict)     # an event's id: its count as the endpoint gave it
    rate: Optional[float] = None                              # a hidden part's cost per unit, as the calls charged it
    texts: Dict[str, int] = field(default_factory=dict)       # the sha of an ag item's text: its cost
    made: Set[int] = field(default_factory=set)               # made ids counted
    preambles: Set[str] = field(default_factory=set)          # the instructions and tools counted
    exact: Dict[int, "asyncio.Future"] = field(default_factory=dict)   # read_id: the request as sent, counted
    sent: Dict[int, Sent] = field(default_factory=dict)       # read_id: its context, kept until its count is back
    last: Optional[tuple] = None                              # (Sent, its own count): the last call counted so
                                                              # (False: none yet, but the store has counts)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class Counter:
    """The provider's counts of a harness's calls, for one hook: `exact` before a call is sent (the
    pre-send check), `start` once it is sent, `reported` once its own count is back. The provider's half
    is a subclass's (the module's doc, A NEW HARNESS)."""

    INPUT = "input"                   # the request's field holding the conversation
    PLACEHOLDER: list = []            # one one-word user message, in the request's shape
    PREAMBLE = ("instructions", "tools")   # the preamble's two fields, named as preamble_of names them
    COSTS_HIDDEN = False              # the endpoint counts part of what a call is charged as nothing: the call's own
                                      # count costs it (`hidden_counts`)

    def __init__(self, adaptor, enabled: bool = True, log=lambda gatherer, line: None):
        self.adaptor, self.enabled, self.log = adaptor, enabled, log
        types = getattr(adaptor, "event_types", None) or {}      # the adaptor's: which event type each Kind becomes
        self.call_type, self.output_type, self.reasoning_type = (types.get(Kind.TOOL_CALL), types.get(Kind.TOOL_RESULT),
                                                                 types.get(Kind.REASONING))
        self.uncountable: Set[str] = set()                    # endpoints that cannot count
        self.unknown: Set[tuple] = set()                      # (endpoint, model): a model it does not know
        self.channels: Dict[tuple, Channel] = {}
        self.tasks: Set[asyncio.Task] = set()

    def channel(self, gatherer: str, channel: str) -> Channel:
        return self.channels.setdefault((gatherer, channel), Channel())

    # ------------------------------------------------------------------ the provider's half

    def where(self, request, body: dict) -> Optional[Tuple[str, dict]]:
        """(url, headers): the endpoint the request is counted at, with the credentials it is asked with;
        None: it cannot be (no upstream, no credentials)."""
        raise NotImplementedError

    def payload(self, request, body: dict) -> dict:
        """What is posted to the endpoint to count a request `body`."""
        raise NotImplementedError

    def tokens_of(self, answer) -> Optional[int]:
        """The count in the endpoint's answer."""
        raise NotImplementedError

    def model_of(self, request, body: dict) -> Optional[str]:
        return body.get("model")

    def unknown_model(self, status: int, error, message: str) -> bool:
        """Whether an error answer says the endpoint does not know the model (it is then not asked for it
        again, other models still are)."""
        return False

    def base_of(self, body: dict) -> dict:
        """What the endpoint takes of a request besides its conversation (`INPUT`)."""
        raise NotImplementedError

    def bare_of(self, base: dict) -> dict:
        """`base` without the preamble or the settings: what a request needs to be counted at all."""
        return {}

    def call_of(self, item) -> Optional[str]:
        """The id a tool call and its output share; None for an item that is neither."""
        return None

    def cut_output(self, item) -> dict:
        """A tool output with its content cut to one word."""
        raise NotImplementedError

    def ends_step(self, item, kind: str, waiting: Set[str]) -> bool:
        """Whether a step may end after `item` (of event type `kind`: the adaptor's, `call_type`,
        `output_type`, `reasoning_type` among them), `waiting` the calls of the step still without their outputs:
        the endpoint refuses an output whose call is not before it."""
        return kind not in (self.call_type, self.reasoning_type) and not waiting

    def is_reasoning(self, item) -> bool:
        """A reasoning item the endpoint counts as nothing, whole (with `COSTS_HIDDEN`): not counted in a step."""
        return False

    def made_weight(self, item) -> int:
        """An ag item's share of a differenced count, as the adaptor sends it: its text's length."""
        return len(json.dumps(item, ensure_ascii=False))

    def extra(self, ch: "Channel", item) -> int:
        """What an item's hidden part is known to cost, added to the endpoint's count of it when its step is counted:
        nothing by default (a reasoning item the endpoint counts as nothing is not counted in a step at all)."""
        return 0

    def hidden_estimate(self, ch: "Channel", items: list) -> int:
        """What the hidden parts of `items` are known to cost, for a count of a request (`exact`): each reasoning
        item at what it was found to cost."""
        return sum(ch.reasoning.get(key_of(self.adaptor, i), 0) for i in items if self.is_reasoning(i))

    # ------------------------------------------------------------------ asking the endpoint

    def with_input(self, base: dict, items: list) -> dict:
        return dict(base, **{self.INPUT: items})

    def steps_of(self, items: list, kinds: List[str]) -> List[tuple]:
        """(start, end) of each step: cut where `ends_step` allows, once every tool call since the last cut has
        its output."""
        out, start, waiting = [], 0, set()
        for i, it in enumerate(items):
            kind, call = kinds[i], self.call_of(it)
            if kind == self.call_type and call:
                waiting.add(call)
            elif kind == self.output_type:
                waiting.discard(call)
            if self.ends_step(it, kind, waiting):
                out.append((start, i + 1))
                start = i + 1
        if start < len(items):
            out.append((start, len(items)))
        return out

    def target(self, request, body: dict) -> Optional[Tuple[str, dict]]:
        """(url, headers) the request is counted at, or None: not counted (off, no credentials, an endpoint
        that cannot count, a model it does not know)."""
        if not self.enabled:
            return None
        found = self.where(request, body)
        if found is None:
            return None
        url, headers = found
        if url in self.uncountable or (url, self.model_of(request, body)) in self.unknown:
            return None
        return url, dict(headers, **{"content-type": "application/json"})

    def can_count(self, request, body: dict) -> bool:
        return self.target(request, body) is not None

    async def ask(self, session, request, body: dict):
        """The endpoint's count of `body`: the count; an error's message (a string) when it refuses it;
        None when it cannot be asked."""
        where = self.target(request, body)
        if where is None:
            return None
        url, headers = where
        from aiohttp import ClientError                 # the hook server's own: it runs there
        try:
            async with session.post(url, json=self.payload(request, body), headers=headers) as resp:
                answer = await resp.json(content_type=None)
        except (ClientError, OSError, ValueError, asyncio.TimeoutError) as exc:
            print(f"counting tokens failed: {exc!r}", file=sys.stderr, flush=True)
            return None
        error = answer.get("error") if isinstance(answer, dict) else answer
        message = str(error.get("message") if isinstance(error, dict) else error or "")[:300]
        if resp.status == 404 and self.unknown_model(resp.status, error, message):
            model = self.model_of(request, body)
            self.unknown.add((url, model))
            print(f"{url} does not know the model {model!r}; not asked for it again", file=sys.stderr, flush=True)
            return None
        if resp.status in CANNOT_COUNT:
            self.uncountable.add(url)
            print(f"{url} cannot count tokens ({resp.status}); not asked again", file=sys.stderr, flush=True)
            return None
        if resp.status == BUSY:
            return None
        if resp.status != 200:
            return message
        tokens = self.tokens_of(answer)
        return tokens if isinstance(tokens, int) and tokens >= 0 else None

    def session(self):
        from aiohttp import ClientSession, ClientTimeout
        return ClientSession(timeout=ClientTimeout(total=COUNT_SECONDS))

    async def exact(self, gatherer: str, channel: str, request, body: dict) -> Optional[int]:
        """The request counted exactly as it is, what the endpoint counts as nothing at what it was found to
        cost (`hidden_estimate`); None if it cannot be."""
        async with self.session() as session:
            n = await self.ask(session, request, body)
        if not isinstance(n, int):
            return None
        return n + self.hidden_estimate(self.channel(gatherer, channel), body.get(self.INPUT) or [])

    def learn(self, gatherer: str, channel: str, context: Optional[list]) -> None:
        """What a context the server answered says reasoning costs: each counted reasoning event's size
        as stored, for one this process has not costed itself (started since, say)."""
        known = self.channel(gatherer, channel).reasoning
        for e in context or ():
            if isinstance(e, dict) and e.get("counted") and isinstance(e.get("id"), str) and e["id"] not in known \
                    and isinstance(e.get("payload"), dict) and self.is_reasoning(e["payload"]):
                known[e["id"]] = e.get("tokens") or 0

    # ------------------------------------------------------------------ once it is sent

    def sent(self, gatherer: str, channel: str, out: dict, sent: list, preamble: list) -> None:
        """Keep what the read `out` (call_ag's) sent -- its preamble parts, its items, each the event or
        ag item it is -- until the call's own count is back (`reported`)."""
        read_id = out.get("read_id")
        if not self.enabled or not isinstance(read_id, int):
            return
        ids = {e.get("id") for e in out.get("events") or () if isinstance(e, dict)}
        made = {}
        for made_id, text in out.get("ag_items") or ():
            item = ag_item(self.adaptor, text) if isinstance(text, str) else None
            if item is not None:
                made.setdefault(json.dumps(item, sort_keys=True), (made_id, text))
        keys, parts = [], []
        for item in sent:
            if not isinstance(item, dict):
                continue
            mine = made.get(json.dumps(item, sort_keys=True))
            if mine is not None:
                keys.append("made:" + hashlib.sha256(mine[1].encode("utf-8")).hexdigest())
                parts.append(("made", mine[0], item))
            else:
                iid = key_of(self.adaptor, item)
                keys.append(iid)
                parts.append(("event", iid if iid in ids else None, item))
        ch = self.channel(gatherer, channel)
        self.learn(gatherer, channel, out.get("context"))
        if ch.last is None and any(isinstance(e, dict) and e.get("counted") for e in out.get("context") or ()):
            ch.last = False                      # counted before this process: not differenced from nothing
        ch.sent[read_id] = Sent(out.get("basis"), [(p["name"], p["text"]) for p in preamble or ()], keys, parts)
        while len(ch.sent) > KEPT_SENT:          # a call whose count never came back
            ch.sent.pop(next(iter(ch.sent)))

    def start(self, request, client, gatherer: str, properties: dict, body: dict, items: list,
              sent: list, out: dict) -> None:
        """Count what the call holds that is not counted yet, in the background: `items` the harness's own,
        `sent` what the model got, `out` call_ag's (its events, ag's items, its read_id)."""
        if not self.can_count(request, body):
            return
        read_id = out.get("read_id")
        ch = self.channel(gatherer, properties.get(CHANNEL, ""))
        if isinstance(read_id, int):
            ch.exact[read_id] = asyncio.get_event_loop().create_future()
        task = asyncio.ensure_future(self.count_call(request, client, gatherer, properties, body, items, sent, out))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def count_call(self, request, client, gatherer, properties, body, items, sent, out) -> None:
        ch = self.channel(gatherer, properties.get(CHANNEL, ""))
        exact = ch.exact.get(out.get("read_id"))
        async with ch.lock:
            try:
                async with self.session() as session:
                    counts = await self.counts(session, request, ch, body, items, sent, out, exact)
            except Exception as exc:  # noqa: BLE001 - a lost count never breaks the hook
                print(f"[{gatherer}] counting failed: {exc!r}", file=sys.stderr, flush=True)
                counts = None
            finally:
                if exact is not None and not exact.done():
                    exact.set_result(None)
            if counts and any(counts.values()):
                await client.request("counted", {"gatherer": gatherer, "properties": properties, **counts})
                self.log(gatherer, f"counted {len(counts['counts'])} events, {len(counts['made'])} of ag's items, "
                                   f"{len(counts['preamble_counts'])} preamble parts")

    async def counts(self, session, request, ch: Channel, body: dict, items: list, sent: list, out: dict,
                     exact=None) -> dict:
        found = {"counts": {}, "made": {}, "preamble_counts": []}
        base = self.base_of(body)
        if self.COSTS_HIDDEN:                     # as sent: for the hidden parts' count
            whole = await self.ask(session, request, self.with_input(base, sent))
            if exact is not None and not exact.done():
                exact.set_result(whole if isinstance(whole, int) else None)
        placeholder = await self.ask(session, request, self.with_input(base, self.PLACEHOLDER))
        if not isinstance(placeholder, int):
            return found
        await self.preamble(session, request, ch, base, placeholder, found)
        ids = self.event_ids(items, out.get("events") or [])
        uncounted = set(out["uncounted"]) if isinstance(out.get("uncounted"), list) else None
        await self.steps(session, request, ch, base, placeholder, items, ids, uncounted, found)
        for made_id, text in out.get("ag_items") or ():
            if made_id in ch.made or not isinstance(text, str):
                continue
            sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
            if sha not in ch.texts:
                item = ag_item(self.adaptor, text)
                if item is None:
                    continue
                n = await self.ask(session, request, self.with_input(base, self.PLACEHOLDER + [item]))
                if not isinstance(n, int):
                    continue
                ch.texts[sha] = max(n - placeholder, 0)
            found["made"][str(made_id)] = ch.texts[sha]
            ch.made.add(made_id)
        return found

    async def preamble(self, session, request, ch: Channel, base: dict, placeholder: int, found: dict) -> None:
        """The preamble fields' counts, once per version (named as preamble_of names them)."""
        first, second = self.PREAMBLE
        parts = {p["name"]: p["text"] for p in preamble_of({first: base.get(first), second: base.get(second)})}
        sha = hashlib.sha256(json.dumps(parts, sort_keys=True).encode("utf-8")).hexdigest()
        if not parts or sha in ch.preambles:
            return
        bare_base = self.bare_of(base)
        bare = await self.ask(session, request, self.with_input(bare_base, self.PLACEHOLDER))
        alone = await self.ask(session, request, self.with_input(dict(bare_base, **{first: base.get(first)}),
                                                                 self.PLACEHOLDER)) if first in parts else bare
        if not (isinstance(bare, int) and isinstance(alone, int)):
            return
        sizes = {first: alone - bare, second: placeholder - alone}
        found["preamble_counts"] += [{"name": n, "text": t, "tokens": max(sizes.get(n, 0), 0)} for n, t in parts.items()]
        ch.preambles.add(sha)

    def event_ids(self, items: list, events: list) -> List[Optional[str]]:
        """For each of the harness's items, the id of the event it is (None: none of this call's -- before
        a compacted history's summary, say)."""
        ids = {e.get("id") for e in events if isinstance(e, dict)}
        return [k if k in ids else None for k in (key_of(self.adaptor, i) for i in items)]

    async def steps(self, session, request, ch: Channel, base: dict, placeholder: int, items: list,
                    ids: List[Optional[str]], uncounted: Optional[Set[str]], found: dict) -> None:
        """The new steps' counts (the module's doc): of this call's events the store has not counted
        (`uncounted`; None: not known, all of them), but those this process has."""
        def due(event) -> bool:
            return bool(event) and event not in ch.counting and (uncounted is None or event in uncounted)

        done, kinds = 0, [kind_of(self.adaptor, i) for i in items]
        for start, end in self.steps_of(items, kinds):
            if done >= STEPS_PER_CALL:
                return
            todo = [i for i in range(start, end) if not self.is_reasoning(items[i]) and due(ids[i])]
            if not todo:
                continue
            # reasoning the endpoint counts as nothing is the reasoning count's: the step without it
            at = [i for i in range(start, end) if not self.is_reasoning(items[i])]
            step = [copy.deepcopy(items[i]) for i in at]
            costs = await self.split(session, request, base, placeholder, step, [kinds[i] for i in at])
            if costs is not None:
                costs = {at[k]: n for k, n in costs.items()}
            if costs is None:                       # not standalone: in the history, by size
                costs = await self.in_history(session, request, base, items, start, end)
            if costs is None:
                continue
            for i, n in costs.items():
                if due(ids[i]):
                    ch.visible[ids[i]] = max(n, 0)
                    found["counts"][ids[i]] = max(n, 0) + self.extra(ch, items[i])
                    ch.counting.add(ids[i])
            done += 1

    async def split(self, session, request, base: dict, placeholder: int, step: list, kinds: List[str]):
        """{index in the step: cost} of a step's items (of these event types), standalone; None if the
        endpoint will not take the step alone."""
        whole = await self.ask(session, request, self.with_input(base, self.PLACEHOLDER + step))
        if not isinstance(whole, int):
            return None
        costs, rest = {}, []
        for k, item in enumerate(step):
            kind, n = kinds[k], None
            if kind == self.output_type:
                cut = copy.deepcopy(step)
                cut[k] = self.cut_output(cut[k])
                c = await self.ask(session, request, self.with_input(base, self.PLACEHOLDER + cut))
                n = whole - c + 1 if isinstance(c, int) else None      # beside a one-word output
            elif kind != self.call_type:                               # a message, or anything else: taken out
                cut = [x for j, x in enumerate(step) if j != k]
                c = await self.ask(session, request, self.with_input(base, self.PLACEHOLDER + cut)) if cut else placeholder
                n = whole - c if isinstance(c, int) else None
            if n is None:
                rest.append(k)
            else:
                costs[k] = n
        left = whole - placeholder - sum(costs.values())
        if rest:                                    # tool calls: what is left, shared
            for j, k in enumerate(rest):
                costs[k] = left // len(rest) + (1 if j < left % len(rest) else 0)
        elif costs:                                 # the step's framing, on its last item
            last = list(costs)[-1]
            costs[last] += left
        return costs

    async def in_history(self, session, request, base: dict, items: list, start: int, end: int):
        """{item index: cost} of a step counted where it is -- the history to its end less the history
        before it -- shared by the size of each item but reasoning; None if refused."""
        before = await self.ask(session, request, self.with_input(base, items[:start])) if start else 0
        upto = await self.ask(session, request, self.with_input(base, items[:end]))
        if not (isinstance(before, int) and isinstance(upto, int)):
            return None
        sizes = {i: len(json.dumps(items[i])) for i in range(start, end) if not self.is_reasoning(items[i])}
        total, whole = sum(sizes.values()) or 1, upto - before
        return {i: whole * s // total for i, s in sizes.items()}

    # ------------------------------------------------------------------ once its own count is back

    def reported(self, request, client, gatherer: str, channel: str, read_id: int, tokens: Optional[int],
                 body: dict) -> None:
        """The call's own count of read `read_id` is back: what it tells, counted in the background --
        the reasoning's cost, where the endpoint counted the call; else every new item's, by
        difference with the call before."""
        if not self.enabled or not isinstance(tokens, int) or tokens <= 0:
            return
        task = asyncio.ensure_future(self.count_reported(request, client, gatherer, channel, read_id, tokens, body))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def count_reported(self, request, client, gatherer, channel, read_id, tokens, body) -> None:
        ch = self.channel(gatherer, channel)
        exact = ch.exact.pop(read_id, None)
        try:
            n = await asyncio.wait_for(asyncio.shield(exact), REPORT_SECONDS) if exact is not None else None
        except (asyncio.TimeoutError, asyncio.CancelledError):
            n = None
        async with ch.lock:
            sent = ch.sent.pop(read_id, None)
            try:
                if exact is not None:
                    counts = self.hidden_counts(ch, sent, tokens, n) if self.COSTS_HIDDEN else {}
                elif not self.can_count(request, body):
                    counts = self.differenced(ch, sent, tokens)
                else:
                    counts = {}
            except Exception as exc:  # noqa: BLE001 - a lost count never breaks the hook
                print(f"[{gatherer}] counting by the call's own count failed: {exc!r}", file=sys.stderr, flush=True)
                return
            if sent is not None:
                ch.last = (sent, tokens)
            if counts.get("counts") or counts.get("made") or counts.get("preamble_counts"):
                await client.request("counted", {"gatherer": gatherer, "properties": {CHANNEL: channel},
                                                 "counts": counts.get("counts", {}), "made": counts.get("made", {}),
                                                 "preamble_counts": counts.get("preamble_counts", [])})
                self.log(gatherer, f"[{channel}] counted {len(counts.get('counts', {}))} events, "
                                   f"{len(counts.get('made', {}))} of ag's items by the call's own count")

    def hidden_counts(self, ch: Channel, sent: Optional[Sent], tokens: int, exact: Optional[int]) -> dict:
        """What a call's own count (`tokens`) says its hidden parts cost, over the endpoint's count of it as sent
        (`exact`), as {"counts": {event id: its count}}. By default reasoning items': the rise less the reasoning
        it sent that is costed already, shared evenly among the reasoning new in it."""
        if sent is None or not isinstance(exact, int):
            return {}
        reasoning = [(k, at) for k, (kind, at, item) in zip(sent.keys, sent.parts)
                     if kind == "event" and self.is_reasoning(item)]
        new = [(k, at) for k, at in reasoning if k not in ch.reasoning]
        if not new:
            return {}
        rise = max(tokens - exact - sum(ch.reasoning[k] for k, _ in reasoning if k in ch.reasoning), 0)
        counts = {}
        for j, (k, at) in enumerate(new):
            ch.reasoning[k] = rise // len(new) + (1 if j < rise % len(new) else 0)
            if at:
                counts[at] = ch.reasoning[k]
                ch.counting.add(at)
        return {"counts": counts}

    def differenced(self, ch: Channel, sent: Optional[Sent], tokens: int) -> dict:
        """Every item new in a call since the last one counted so -- the same build and preamble, its
        context that one's with items added -- at what the two calls' own counts differ by, shared by
        ag's counts (`weight_of`). A channel's first is so from nothing: its preamble parts too."""
        if sent is None or ch.last is False:          # False: counted before this process, from no count of its
            return {}
        first = ch.last is None
        before, base = (Sent(sent.basis, sent.preamble, [], []), 0) if first else ch.last
        if before.basis != sent.basis or before.preamble != sent.preamble or sent.keys[:len(before.keys)] != before.keys:
            return {}                                    # a build, or something taken out: not by difference
        new = [("item", k, part) for k, part in zip(sent.keys[len(before.keys):], sent.parts[len(before.keys):])]
        if first:
            new = [("preamble", name, text) for name, text in sent.preamble] + new
        rise = tokens - base
        if not new or rise <= 0:
            return {}
        weights = [len(x[2]) if x[0] == "preamble" else self.part_weight(x[2]) for x in new]
        total = sum(weights)
        shares = [rise * w // total for w in weights] if total else [rise // len(new)] * len(new)
        shares[-1] += rise - sum(shares)                 # what rounding left, on the last
        counts, made, preamble = {}, {}, []
        for (what, key, part), share in zip(new, shares):
            if what == "preamble":
                preamble.append({"name": key, "text": part, "tokens": share})
                continue
            kind, at, item = part
            if kind == "event" and at:
                counts[at] = share
                ch.counting.add(at)
                if self.is_reasoning(item):
                    ch.reasoning[key] = share
            elif kind == "made" and isinstance(at, int):
                made[str(at)] = share
        return {"counts": counts, "made": made, "preamble_counts": preamble}

    def part_weight(self, part: tuple) -> int:
        """A sent item's share of a differenced count: an ag item's `made_weight`, else `weight_of`'s."""
        kind, _, item = part
        if kind == "made":
            return self.made_weight(item)
        return weight_of(self.adaptor, item)

    async def close(self) -> None:
        """Let counts still being taken finish (briefly)."""
        if self.tasks:
            await asyncio.wait(list(self.tasks), timeout=COUNT_SECONDS * 2)
