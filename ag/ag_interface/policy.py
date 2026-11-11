"""The contract between the context manager's harness and a policy.

The harness (ag/ag_harness/) owns the gatherer's database: it creates it,
records events and their types, polls, and logs every read. A POLICY decides
what the context is. It imports this package and nothing of the harness:
everything it works with is given to it --

    at construction      format, llm, options (and, from the harness's home,
                         tokenizer, gatherers, jobs, log): whichever it takes
    on each call         the gatherer's store (`GathererStore`, store.py): the
                         shared tables' operations, and a sqlite3 connection's
                         methods for the policy's own tables
    set by the manager   `tokenizer` and `gatherers`, when not given

A policy learns about events from their TYPES, by id. It defines the types
it expects (`Policy.event_types`, its contract with the harness), groups the
names it works from, and resolves them to the gatherer's type ids with
`TypeIds`; it loads rows by those ids (`store.rows(type_ids=...)`)
and reads an event's text with `event_text` (the caller's text, else the
payload as JSON). It never
writes `events` or the read log. Whatever else it needs to keep lives in
tables it creates in `init` and operates on in its own module.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, FrozenSet, List, Optional, Tuple

import sys
from .event import EventType
from .store import Row, event_text


@dataclass(frozen=True)
class Read:
    """One read call: which gatherer, the read's properties, and the event it
    responds to.

    Attributes:
        gatherer_id: the gatherer, as the caller named it.
        properties: the read's properties, by name (event.py): which events
            it is for, in the policy's own terms (e.g. its `channel`). A
            property it does not give is unset.
        row_id: the event this read responds to -- the row id `insert`
            returned for it; normally the last event before the model call.
        limit: the harness's own limit for this call, in its provider's tokens -- where it
            compacts by itself, or where its model's window ends -- or None when it states none.
        fixed_tokens: the size of what the harness sends besides its messages with this call (its
            system prompt, its tools: its preamble), counted as the events are; 0 when it states none.
            The model gets it with every context, so the context's limits count it too.
        stopped: whether the harness has given up on the call by now -- its user stopped it (Esc)
            while the read was under way, so nothing will be sent. A read that waits for work of
            its own in the background (a build) asks it as often as it likes, and once it is True
            stops waiting and returns what it has. Always False when the harness says nothing.
    """
    gatherer_id: str
    properties: Dict[str, Any]
    row_id: int
    limit: Optional[int] = None
    fixed_tokens: int = 0
    stopped: Callable[[], bool] = field(default=lambda: False, compare=False, repr=False)


@dataclass
class Context:
    """What a policy returns for a read.

    Attributes:
        items: the payloads to send, in order.
        refs: where each item came from, one `Ref` (store.py) per item
            (a stored row, or a made item), in the same order; what the
            manager logs in `_read_items`.
        basis: what the context was built from, in the policy's own terms
            (e.g. a build id), or None; logged in `_reads.basis`.
        tokens: the context's size by the policy's own count, or None;
            logged in `_reads.est_tokens`, beside the size the provider
            reports for it later (`real_tokens`).
        budget: the size the policy keeps the context under, counted as
            `tokens` is and compared with `real_tokens` too, or None: a
            harness that can count the context exactly before sending it
            checks it against this.
    """
    items: list = field(default_factory=list)
    refs: list = field(default_factory=list)
    basis: Optional[str] = None
    tokens: Optional[int] = None
    budget: Optional[int] = None


class TypeIds:
    """A gatherer's event types, resolved for a policy: which id each name has.
    Loaded from the store's `event_types` (`TypeIds.load(store)`); one small
    query, done at each entry point, so a type added while the gatherer runs
    is seen by the next read or build."""

    def __init__(self, types: List[EventType]):
        self.types = list(types)
        self.by_id: Dict[int, EventType] = {t.id: t for t in types}
        self.by_name: Dict[str, int] = {t.name: t.id for t in types}

    @classmethod
    def load(cls, store) -> "TypeIds":
        return cls(store.event_types())

    def of(self, *names: str) -> FrozenSet[int]:
        """The ids of the types named; a name the gatherer does not have has
        none."""
        return frozenset(self.by_name[n] for n in names if n in self.by_name)

    def name(self, type_id: int) -> Optional[str]:
        t = self.by_id.get(type_id)
        return t.name if t else None

    @staticmethod
    def text(row: Row) -> str:
        """An event's readable text (`event_text`)."""
        return event_text(row)


class Policy(ABC):
    r"""One way of building an agent's context from the gatherer's database.

    A policy imports nothing of the rest of `ag`: everything it works with is handed to it.

    **Construction.** The constructor takes whichever of these keyword arguments it names
    (or all of them, with `**kwargs`):

    | argument | what it is |
    |---|---|
    | `format` | Makes the policy's own messages: `format.make_section(text, name)` returns an `ag` message, `{"type": "ag", "name", "text"}`, which each harness shows its own way. |
    | `llm` | The LLM client set in `[policies.llm]`; its model is `llm.model`. |
    | `options` | A dict: the catalog entry's `options`, then the gatherer's `[options]`. |
    | `tokenizer` | Counts tokens: `tokenizer.count(text)`. Also set as `self.tokenizer` when not taken. |
    | `jobs` | Starts background work: `jobs.start(gatherer, properties, "build", job_id)` calls `policy.build(gatherer, properties, job_id)` in a worker process, with the same policy built from the home. The job opens the gatherer with `self.gatherers.open(gatherer)`. |

    **Reading.** `read(store, read)` is called before every model call. `read.properties` holds
    the call's `channel` and `cwd`, and `read.row_id` the event it responds to (normally the
    last one the harness sent). It returns a `Context`: the items to send, in order (stored
    payloads, and `ag` messages), with a `Ref` for each saying where it came from, for the read
    log. The `store` is the gatherer's database (`GathererStore`, in store.py), and answers the
    SQLite connection's own methods (`execute`, `commit`) for tables the policy creates in `init`.

    **A sketch.** A policy that sends the channel's whole conversation and, before the latest
    request, the user's latest requests to other agents in the same gatherer:

    ```python
    # ~/.ag/plugins/other_requests.py
    from ag.ag_interface import Context, Policy, Ref, TypeIds, event_text
    from ag.ag_policies.proactive_context_manager.events import EVENT_TYPES

    CONVERSATION = ("user_message", "agent_message", "tool_call", "tool_output", "context", "agent_reasoning")


    class OtherRequests(Policy):
        name = "other_requests"
        event_types = EVENT_TYPES            # the same types the shipped adaptors and pollers use

        def __init__(self, format, options=None):
            self.format = format
            self.show = int((options or {}).get("show", 5))

        def read(self, store, read):
            channel = read.properties.get("channel")
            types = TypeIds.load(store)
            mine = store.rows(type_ids=types.of(*CONVERSATION), match={"channel": channel})
            items = [r.payload for r in mine]
            refs = [Ref(row_id=r.row_id) for r in mine]

            requests = types.of("user_message")
            latest = max((i for i, r in enumerate(mine) if r.type.id in requests), default=None)
            others = store.rows(type_ids=requests, differ={"channel": channel})[-self.show:]
            if others and latest is not None:
                text = "Meanwhile, the user asked other agents:\n" + "\n".join(f"- {event_text(r)}" for r in others)
                note = self.format.make_section(text, "other_requests")
                made = store.make_item(note, self.tokenizer, properties={"channel": channel}, name="other_requests")
                items.insert(latest, note)                       # just before the latest request
                refs.insert(latest, Ref(made_id=made))
            return Context(items, refs)
    ```

    Registered in config.toml, and used by a gatherer:

    ```toml
    [policies.available.other_requests]
    file = "other_requests.py"
    class = "OtherRequests"
    options = { show = 3 }
    ```

    ```sh
    ag --gatherer team --policy other_requests codex
    ```

    **Keep in mind.**

    - Return payloads exactly as stored: the adaptor turns them back into the harness's
      messages. Keep a tool call with its output, since most model APIs reject one without the
      other.
    - A policy accepts only the event types it declares. To take a new kind of event (say, test
      results), add its type to `event_types` and have a poller output it; no other policy is
      affected.
    - `read` runs before every model call, so keep it fast. Put LLM calls and other slow work in
      a background job (`jobs.start`), and use its result on a later read.
    - The policies' building blocks are in `ag/ag_policies/tools/`: grouping events into turns
      and tasks, segmentation, summarization, the new-task check, ranking, and rendering to a
      token budget. A new policy can compose them.

    A working policy: `ProactiveContextManager`, in `ag/ag_policies/proactive_context_manager/`.
    """

    #: What the registry and the read log call it.
    name: str = ""

    #: The event types this policy expects the harness to insert: its side of
    #: the contract. Name and properties. Registered, in this order, when a gatherer
    #: is created, before any the caller adds.
    event_types: Tuple[EventType, ...] = ()

    #: What the harness gives it, when its constructor was not given them:
    #: the tokenizer events are counted with, and `Gatherers` (store.py), which
    #: opens a gatherer's store for work outside a read. Set by the manager.
    tokenizer = None
    gatherers = None
    #: `Jobs` (store.py), which starts background work; None = none is started.
    jobs = None

    def log(self, line: str) -> None:
        """A line for whoever runs it (a background worker's log). The
        harness may give another (`log=`)."""
        print(f"[policy {self.name}] {line}", file=sys.stderr, flush=True)

    def init(self, store) -> None:
        """Create whatever the policy keeps in the gatherer's database beyond
        the shared tables. Idempotent; the manager calls it whenever it
        creates or first opens a gatherer. Default: nothing."""

    def append(self, conn, db: str, offset: int) -> None:
        """Another gatherer's database appended to this one (`ag home merge`): attached to `conn` (sqlite3) as `db`,
        its events already copied with their row ids moved by `offset` -- what the policy keeps in its own tables of
        them copied too, their row ids moved the same way, in `conn`'s transaction. Default: nothing."""

    @abstractmethod
    def read(self, store, read: Read) -> Context:
        """The context to send in response to `read`, from the gatherer's
        database. May write made items and the policy's own tables, and may
        start or wait for background work. Never records the read: the
        manager does that with what is returned.

        Args:
            store: the gatherer's `GathererStore` (store.py).
            read: the read call: gatherer, properties, and the event responded to.
        """

    def bulk_loaded(self, store, gatherer_id: str, properties: Dict[str, Any]) -> Any:
        """Called after the manager stored a whole recorded history at once
        (`Manager.bulk_load`). A policy that can prepare its context from it
        in one go does so here; what it returns is what `bulk_load` returns.
        Default: nothing."""
        return None
