"""What a proxy hook does for every harness (the Claude Code and codex hooks build on it): once the hook server has a
call's answer, as it streams and once whole, the answer is recorded as events of the session -- each complete part
(`reply_part`), then its end (`reply_end`) -- and a call that failed as `call_failed`; every call it sees is recorded as
`model_call` (records.py). A side call whose answer is the session's recap or name is the subclass's to read
(`side_answered`). From each call of a session on, the harness's own record of it is followed (`following`,
session_files.py): what it says that no call carries recorded as it is written. What an answer asks the user, and what
a call's new pieces say of background tasks, are recorded too (`derive`: harness_kit's `derived`), each once, by the
harness's own ids. What a call is, the harness's rules say (its `harness`, harness_kit's).

A subclass gives:
    harness           the harness's rules (harness_kit.Harness)
    ANSWERED, FILES   its keys in the hook server's `request.state`: where a call's (gatherer, channel, cwd) is kept
                      for its answer, and (gatherer, channel, cwd, since) for the files the answer's calls touch
    answer_items      the harness's messages an answer's output items are (Claude Code's: one assistant message)
and may override `overtaken` (an answer a later call has carried back already) and `side_answered`.

What the hook server reports once the harness has an answer (`answered`, `failed`) or as it streams (`streamed`, a
task of its own) is recorded then and there: the harness waits on none of it. A model call is recorded in the
background, so the call is not held up for it; `close` waits for what is under way.
"""

import asyncio
import time
from typing import Callable, List, Optional, Set

from harness_kit import Call, Facts, Harness, Part

from .call_ag import HUNG_UP, read_of, report_measured
from .records import call_failed, derived, model_call, record, recap, reply_end, reply_parts, name
from .session_files import SessionFiles


class ProxyHook:
    harness: Harness
    ANSWERED = "answered"
    FILES = "files"

    def __init__(self, ag_clients, log: Callable[[str, str], None], files=None, sessions: Optional[SessionFiles] = ...):
        self.ag_clients, self.log, self.files = ag_clients, log, files
        self.sessions = SessionFiles(ag_clients, log) if sessions is ... else sessions
        self.adaptor = getattr(self, "adaptor", None)
        self.under_way: Set[asyncio.Future] = set()

    # ---- recording, in the background

    def keep(self, coro) -> None:
        """Run `coro` in the background, kept until it is done (`close` waits for it)."""
        task = asyncio.ensure_future(coro)
        self.under_way.add(task)
        task.add_done_callback(self.under_way.discard)

    async def recorded(self, gatherer: str, channel: str, events: list) -> Optional[dict]:
        """`events` recorded in the channel (records.py's `record`: never raises)."""
        return await record(self.ag_clients.client(gatherer), gatherer, channel, events, self.log) if events else None

    def called(self, gatherer: str, channel: str, call: Call, read_id: Optional[int] = None, **detail) -> None:
        """A model call the hook saw, recorded (`model_call`), in the background: its kind, the harness and its version
        -- and `derives`, that this hook records what its answers ask and its tasks (`derive`), so a reader may take
        their absence as none."""
        self.keep(self.recorded(gatherer, channel, [model_call(call.kind, self.harness.name, call.version, read_id,
                                                               {"derives": True, **detail})]))

    def derive(self, gatherer: str, channel: str, parts: List[Part], history: Optional[list] = None,
               asks: bool = True) -> None:
        """What `parts` -- an answer's, or a call's new pieces -- say besides the conversation (harness_kit's `derived`:
        an ask, an asking call's result, a background task started, stopped or noticed), recorded in the background,
        beside the session's reads; a task's output file followed while it runs (session_files.py's `task`). `asks`:
        what the parts ask too (a call's new pieces open with the answer that asked: recorded already)."""
        try:
            facts = [f for f in self.harness.derived(parts, time.time(), history)
                     if not (f.type == Facts.ASKED and (self.harness.asks_recorded or not asks))]
        except Exception as exc:  # noqa: BLE001 - a lost record never breaks the call
            self.log(gatherer, f"[{channel}] nothing derived: {exc!r}")
            return
        if not facts:
            return
        if self.sessions is not None:
            for f in facts:
                if f.type in (Facts.TASK_STARTED, Facts.TASK_ENDED):
                    self.sessions.task(gatherer, channel, f.data["task"], f.data.get("output") if f.type == Facts.TASK_STARTED else None)
        self.keep(record(self.ag_clients.client(gatherer), gatherer, channel, [derived(f) for f in facts], self.log,
                         beside=True))

    def following(self, request, gatherer: str, channel: str, call: Call) -> None:
        """The session's own record followed (session_files.py), from this call of it on: where it runs, and the
        harness's own folder for it as its launcher named it (`request.config`, the URL's /c/)."""
        if self.sessions is not None and call is not None and call.session:
            self.sessions.follow(gatherer, channel, self.harness, call.session, call.cwd, getattr(request, "config", None))

    async def recapped(self, gatherer: str, channel: str, text: Optional[str]) -> None:
        """A recap the harness made of the session, recorded."""
        if text and await self.recorded(gatherer, channel, [recap(text)]) is not None:
            self.log(gatherer, f"[{channel}] recap: kept")

    async def named(self, gatherer: str, channel: str, text: Optional[str], by: str) -> None:
        """A name for the session, recorded as `by` gave it."""
        if text and await self.recorded(gatherer, channel, [name(text, by)]) is not None:
            self.log(gatherer, f"[{channel}] name: kept")

    # ---- the hook server's reports

    def answer_items(self, output_items: list) -> list:
        """The harness's messages an answer's output items are, as its adaptor takes them."""
        return output_items

    def overtaken(self, request, gatherer: str, channel: str) -> bool:
        """Whether a later call of the channel has carried this answer back already: then it is not recorded."""
        return False

    async def side_answered(self, request, status: int, answer) -> bool:
        """Whether the answer is a side call's the subclass kept (a recap, a title), read by it; False: a call of the
        session's own."""
        return False

    async def reply(self, request, answer: dict, ended: bool) -> Optional[str]:
        """The answer's parts recorded, and -- once it `ended` -- its end, why it stopped: a note, None when there is
        nothing."""
        kept = (getattr(request, "state", None) or {}).get(self.ANSWERED)
        if kept is None or not isinstance(answer, dict) or not answer.get("output_items"):
            return None
        gatherer, channel, _cwd = kept
        if self.overtaken(request, gatherer, channel):
            return None
        try:
            events = self.adaptor.to_events(self.answer_items(answer["output_items"]))
        except Exception as exc:  # noqa: BLE001 - a lost record never breaks the call
            return f"could not make events: {exc!r}; nothing kept"
        answer_id = answer.get("response_id") or f"read{read_of(request)}"
        out = reply_parts(answer_id, events)
        if ended:
            out.append(reply_end(answer_id, answer.get("status"), read_of(request)))
        await self.recorded(gatherer, channel, out)
        if ended:                                         # what it asks the user, once the answer is whole
            body = getattr(request, "body", None)
            history = body.get("messages") or body.get("input") or body.get("contents") if isinstance(body, dict) else None
            self.derive(gatherer, channel, self.harness.read(self.harness.items(self.answer_items(answer["output_items"]))),
                        self.harness.items(history) if isinstance(history, list) else None)
        return f"{len(events)} parts" + (f", ended ({answer.get('status')})" if ended else "")

    async def streamed(self, request, answer: dict) -> None:
        """The hook server's report, while the answer to one of the session's own calls streams, that a part of it is
        complete: the parts complete so far recorded (`reply_part`, each once) -- so a reader of the gatherer sees what
        the agent wrote before a tool call as the harness shows it, not once the call's input has streamed too."""
        if not isinstance(answer, dict) or not answer.get("response_id"):
            return
        note = await self.reply(request, answer, False)
        kept = (getattr(request, "state", None) or {}).get(self.ANSWERED)
        if note and kept:
            self.log(kept[0], f"[{kept[1]}] streaming: {note}")

    async def answered(self, request, status: int, answer: dict) -> None:
        """The hook server's report, once the harness has the whole answer to one of the session's own calls: its parts
        and its end recorded (`reply_part`, `reply_end`) -- so a reader of the gatherer sees the reply that ends a
        turn, which no call carries until the user writes again, and a tool call while it runs. A failed answer, or one
        with no content, is not; a side call's is the subclass's (`side_answered`)."""
        if await self.side_answered(request, status, answer):
            return
        if status != 200 or not isinstance(answer, dict) or answer.get("error"):
            return
        note = await self.reply(request, answer, True)
        kept = (getattr(request, "state", None) or {}).get(self.ANSWERED)
        if note and kept:
            self.log(kept[0], f"[{kept[1]}] answered ({answer.get('status')}): {note}")

    async def measured(self, request, tokens: Optional[int]) -> None:
        """The hook server's report, once the answer is back: the call's input tokens, to the read."""
        await report_measured(self.ag_clients, request, tokens)

    async def failed(self, request, status: Optional[int], error: str) -> None:
        """The hook server's report that one of the session's own calls failed -- its endpoint answered an error, or
        could not be reached: recorded (`call_failed`), on the read it came from -- what tells a turn that stopped on an
        error from one under way."""
        kept = (getattr(request, "state", None) or {}).get(self.ANSWERED)
        if kept is None:
            return
        gatherer, channel, _cwd = kept
        reached = getattr(request, "answer_reached", None) if status == HUNG_UP else None   # Esc: before its words, or after
        await self.recorded(gatherer, channel, [call_failed(read_of(request), status, error, reached)])

    async def before_end(self, request, status: int, answer: dict) -> None:
        """The hook server's report, once the answer to one of the session's own calls is back whole and before the
        harness has its end -- before it runs the tools the answer calls: the files they name, looked at as they are
        (file_touches)."""
        kept = (getattr(request, "state", None) or {}).get(self.FILES)
        if kept is None or self.files is None or status != 200 or not isinstance(answer, dict) or answer.get("error"):
            return
        gatherer, channel, cwd, since = kept              # the answer's calls can't have run before it began
        self.files.started(gatherer, channel, cwd, self.answer_items(answer.get("output_items") or []),
                           getattr(request, "answer_started", None) or since)

    async def close(self) -> None:
        """Let what is under way finish -- records, counts, file checks -- then stop every gatherer's server."""
        if self.under_way:
            await asyncio.gather(*list(self.under_way), return_exceptions=True)
        counter = getattr(self, "counter", None)
        if counter is not None:
            await counter.close()
        if self.files is not None:
            await self.files.close()
        if self.sessions is not None:
            await self.sessions.close()
        await self.ag_clients.close()
