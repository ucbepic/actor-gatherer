"""What a policy is given to work on a gatherer's database -- by the context
manager's harness, which owns it (ag/ag_harness/store/). A policy imports these
definitions and nothing of the harness.

    GathererStore  one gatherer's open database: the shared tables' operations
                   a policy needs (reading the history, storing what it makes),
                   and -- for the tables the policy keeps itself -- the sqlite3
                   connection's own methods (execute, commit, `with store:`),
                   and `changed`, to say it wrote them
    Gatherers      opens a gatherer's store, for work outside a read (a
                   background job): `gatherers.open(gatherer_id)`, closed after
    Jobs           starts a policy's background job in another process:
                   `jobs.start(gatherer_id, properties, "build", build_id)`; the
                   harness then calls the policy's method of that name there
    Row, Ref       a stored event, and where a context item came from

Events, made items and reads carry PROPERTIES (event.py): the values the
event types declare, by name. A filter on them is a dict, name -> value:

    match   {name: value}: the property is `value`, or unset (with
            `unset_matches`, the default) -- what a read with these
            properties sees; value None: the property is unset
    differ  {name: value}: the property is set, and not `value`

In the shared tables each property is the column `property_column(name)`.
"""

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional

from .event import EventType
from .tokenizer import Tokenizer


def property_column(name: str) -> str:
    """The column that holds the property `name` in the shared tables
    (`events`, `_made_items`, `_reads`)."""
    return f"p_{name}"


@dataclass
class Row:
    """One stored event, with its type."""
    row_id: int
    event_id: Optional[str]
    type: EventType
    payload: Any
    tokens: int                          # the caller's, else its text's count (its payload's as JSON
                                         # without one), taken at insert
    properties: Dict[str, Any] = field(default_factory=dict)   # the ones set
    text: Optional[str] = None           # its readable text, as the caller gave it; None: none given


@dataclass
class Ref:
    """One item a read returned: a stored event, or a made item."""
    row_id: Optional[int] = None
    made_id: Optional[int] = None


def event_text(row: Row) -> str:
    """The text of a stored event, wherever a policy needs it: the text the
    caller gave with it, else its payload as JSON."""
    if row.text is not None:
        return row.text
    return json.dumps(row.payload, ensure_ascii=False)


class GathererStore(ABC):
    """One gatherer's open database. Beyond the operations below, it answers
    the sqlite3 connection's own methods (`execute`, `executemany`, `commit`,
    `with store:` ...), for the tables a policy creates and keeps itself."""

    #: The gatherer, and the database's file (for what a report shows).
    gatherer: str
    path: str

    @abstractmethod
    def event_types(self) -> List[EventType]:
        """The gatherer's event types, with their ids."""

    @abstractmethod
    def rows(self, after_row: int = 0, type_ids: Optional[Iterable[int]] = None, *,
             match: Optional[Dict[str, Any]] = None, differ: Optional[Dict[str, Any]] = None,
             unset_matches: bool = True) -> List[Row]:
        """The events after `after_row` whose properties pass `match` and
        `differ` (module doc), of `type_ids` if given, in order. Without
        `differ`, an event id is returned once, at its first row: the same
        event stored unset and then with the property is one event."""

    @abstractmethod
    def make_item(self, item: Any, tokenizer: Tokenizer, *, properties: Optional[Dict[str, Any]] = None,
                  name: Optional[str] = None, source: Optional[str] = None) -> int:
        """Store an item the policy made for the model, with the properties
        of the read it is first made for; its made id. Stored once: made again
        with the same name, source and text, for any read, it is the same id."""

    @abstractmethod
    def made_items(self, made_ids) -> dict:
        """made id -> (the item, its name, its tokens, ...) for `made_ids`."""

    @abstractmethod
    def last_read(self, properties: Optional[Dict[str, Any]] = None) -> Optional[dict]:
        """The last read with these properties (each given one its value,
        None: unset; those not given: any), as the read log has it, or None."""

    @abstractmethod
    def high_water(self) -> int:
        """The highest row id stored."""

    def changed(self, what: str, properties: Optional[Dict[str, Any]] = None, row: Optional[int] = None) -> None:
        """Tell whoever watches the gatherer (the dashboard) that the policy wrote `what` of its own
        tables -- e.g. "build", "tasks" -- for `properties` (e.g. {"channel": ...}; None: unknown), with
        `row` the id of what it wrote, if any. Call it after the write commits. The shared tables'
        writes are told by the harness itself. Never raises; the default tells no one."""

    def close(self) -> None:
        """Close it (a store `Gatherers.open` gave)."""


class Gatherers(ABC):
    """Opens a gatherer's store, for work outside a read."""

    @abstractmethod
    def open(self, gatherer_id: str) -> GathererStore:
        """The gatherer's store, open; the caller closes it."""


class Jobs(ABC):
    """Starts a policy's background job in another process."""

    @abstractmethod
    def start(self, gatherer_id: str, properties: Optional[Dict[str, Any]], job: str, job_id: int) -> None:
        """Start `policy.<job>(gatherer_id, properties, job_id)` elsewhere, and
        return at once. Raises OSError if it cannot be started."""
