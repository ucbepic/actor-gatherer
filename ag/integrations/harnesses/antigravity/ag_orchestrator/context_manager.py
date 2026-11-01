"""The context manager as Antigravity's hook. agy has no hook that can replace what it sends its model; on its Gemini
API route the hook server (ag/integrations/tools/hook_server/hook_server.py) gives it one, and calls this on every
request agy sends; setup/setup.py sets that up. It is given a request -- anything with `method`, `path`, `label`,
`headers` and `body` -- and returns agy's request body with the context manager's context as its `contents`, or None
to leave the request as it is.

What it decides, by Antigravity's rules (harness_kit/antigravity.py):

    a model call   a POST to .../models/<model>:streamGenerateContent with `contents`; anything else: None
    the session    the conversation its system instruction names (`Conversation ID:`); a call naming none is
                   agy's own side call, and goes through as it is, nothing of it stored, but for one answer --
        title          a title for the conversation, after its first message: its answer kept as the
                       conversation's name (by "antigravity") -- for the conversation whose own turn the same run
                       (`request.run`, the /r/<run>/ the launcher puts in the URL) sent last; with no run, or no
                       turn yet, not kept
    gatherer       the request's label (/h/<label>/ in the URL agy was pointed at), each conversation a channel
                   in it; without one, the conversation id, and the channel the conversation id too
    cwd            its system instruction's `Command Working Directory:`

Then one model call through routing (ag/integrations/tools/ag_orchestrator/call_ag.py) with Antigravity's adaptor
(adaptor/adaptor.py, or the one named by the `adaptor` option), each gatherer with a context manager server of its
own (codex's ag_clients.py). None when the context manager could not answer, or its context is agy's contents as they
were. Options (the hook server's --option): `adaptor`, `cwd`, and `files` ("on" or "off"), as codex's hook takes
them.

Besides its turns:

    a subagent     its calls as they are, recorded on the session it works for (its caller's), the subagent a
                   background task of it (`task_started` by its caller's call's result, `task_ended` once its own
                   answer calls no tool, `task_started` "resumed" when it is called again)
    a compaction   as codex's: the gatherer builds in its place (the server's `compaction`), and the call gets that
                   context read only, agy's request for a summary after it
    what it asks   and its background tasks, from the answers and the calls' new pieces (harness_kit's `derived`)
    its record     followed (session_files.py): a turn given up on an error, its name
    instructions   a run's (told.py, by the URL's /r/<run>/), after the system instruction of each of its calls
"""

import os
import sys
import time
from typing import Callable, Dict, Optional, Set, Tuple, Union

from harness_kit import Antigravity, CallKind, Fact, Facts, Kind
from harness_kit.antigravity import answer_start, with_instructions

from ag.integrations.harnesses.codex.ag_orchestrator.ag_clients import AgClients
from ag.integrations.harnesses.codex.ag_orchestrator.context_manager import load_adaptor
from ag.integrations.tools.ag_connection.ag_client import AgClient
from ag.integrations.tools.ag_orchestrator.adaptor import CHANNEL, Adaptor
from ag.integrations.tools.ag_orchestrator.call_ag import call_ag, keep_read, preamble_of
from ag.integrations.tools.ag_orchestrator.file_touches import Files
from ag.integrations.tools.ag_orchestrator.proxy_hook import ProxyHook
from ag.integrations.tools.ag_orchestrator.records import derived, record
from ..adaptor.adaptor import AntigravityAdaptor
from .told import Told

ANSWERED = "antigravity_answered"   # the hook's key in the hook server's `request.state`: where a call's answer is kept
FILES = "antigravity_files"         # the same, for what the answer's calls do to files: (gatherer, session, cwd, since)
TITLE = "antigravity_title"         # the same, for a title call: (label, run, the call), its conversation known by its answer
SUBAGENT_OF = "antigravity_subagent"   # the same, for a subagent's call: (gatherer, channel, the subagent)
NAME_CHARS = 120                    # the longest name kept


def _print(gatherer: str, line: str) -> None:
    print(f"[{gatherer}] {line}", flush=True)


class AntigravityContextManager(ProxyHook):
    """The hook: `await hook(request)` -> agy's body with new `contents`, or None.

    Args:
        cwd: the working directory when a request does not state one.
        ag_clients: the server client per gatherer (`AgClients` of `ag_client.AgClient` by default).
        adaptor: the adaptor, or its class as "module:Class"; Antigravity's own by default.
        files: "on" (what each tool call did to files, found on disk) or "off".
        log: (gatherer, line) -> None, for what each model call came to.
    """
    harness = Antigravity()
    ANSWERED, FILES = ANSWERED, FILES

    def __init__(self, cwd: Optional[str] = None, ag_clients: Optional[AgClients] = None,
                 log: Callable[[str, str], None] = _print, adaptor: Union[Adaptor, str, None] = None, files: str = "on",
                 home: Optional[str] = None):
        ag_clients = ag_clients or AgClients(lambda gatherer: AgClient("antigravity"))
        if files not in ("on", "off"):
            raise ValueError(f"files: {files!r}, not on or off")
        super().__init__(ag_clients, log, Files(ag_clients, log, harness=self.harness) if files == "on" else None)
        self.cwd = cwd
        self.adaptor = load_adaptor(adaptor) if isinstance(adaptor, str) else (adaptor or AntigravityAdaptor())
        self.runs = {}                    # (label, run) -> (gatherer, session): the one whose own turn it sent last
        self.told = Told(home or os.environ.get("AG_HOME"))     # each run's instructions (told.py)
        self.callers: Dict[str, str] = {}                       # a subagent's conversation -> its caller's
        self.ended: Set[Tuple[str, str]] = set()                # (channel, subagent) whose turn ended: idle

    async def __call__(self, request) -> Optional[dict]:
        body, since = request.body, time.time()
        call = self.harness.call(request.method, request.path, request.headers, body)
        if call is None:
            return None
        run = getattr(request, "run", None)
        if call.kind == CallKind.SUBAGENT:
            return self.subagent(request, call)
        if call.kind not in (CallKind.TURN, CallKind.COMPACTION):
            if call.kind == CallKind.TITLE and run and isinstance(getattr(request, "state", None), dict):
                request.state[TITLE] = (request.label, run, call)       # its conversation: known by its answer
            else:
                print(f"agy's own {call.kind} call, for no conversation known: as it is", file=sys.stderr, flush=True)
            return None
        session = call.session
        gatherer, channel = (request.label, session) if request.label else (session, session)
        if run:
            self.runs[(request.label, run)] = (gatherer, channel)
        told = self.told.of(run)
        if told:
            body = with_instructions(body, told)
        cwd = call.cwd or self.cwd
        if call.kind == CallKind.COMPACTION:
            self.following(request, gatherer, channel, call)
            self.called(gatherer, channel, call)
            return await self.compaction(request, gatherer, channel, body, cwd, call.history, call.own, told)
        items = self.harness.items(body["contents"])
        if isinstance(getattr(request, "state", None), dict):
            request.state[ANSWERED] = (gatherer, channel, cwd)
            if self.files is not None:
                request.state[FILES] = (gatherer, channel, cwd, since)
        if self.files is not None:                         # the results of the last answer's calls: checked
            self.files.arrived(gatherer, channel, cwd, items)
        # its last answer and what came after -- its calls' results, tasks' notices: what they say of its asks and tasks
        self.derive(gatherer, channel, self.harness.read(items[answer_start(items):]), items, asks=False)
        out = {}
        messages, note = await call_ag(
            self.ag_clients.client(gatherer), gatherer, {CHANNEL: channel}, cwd, items, self.adaptor, out=out,
            limit=getattr(request, "limit", None), process=getattr(request, "process", None), run=run,
            preamble=preamble_of({"systemInstruction": body.get("systemInstruction"), "tools": body.get("tools")}))
        self.log(gatherer, f"[{channel}] {note}")
        keep_read(request, gatherer, out)
        self.called(gatherer, channel, call, out.get("read_id"))
        # its record followed (session_files.py) once the call is stored: agy makes it before its first call, so it is
        # found at once -- and a new gatherer's database is made by that first call's insert, which another would race
        self.following(request, gatherer, channel, call)
        if messages is None or messages == items:
            return body if told else None                 # nothing to change: agy's own bytes go through
        return dict(body, contents=messages)

    def subagent(self, request, call) -> None:
        """A subagent's call: as it is -- ag takes no part in its conversation, as in a Claude Code subagent's -- recorded
        on the session it works for (its caller's; a subagent's subagent, the first caller's), and the subagent a
        background task of it: going on again (`task_started`, "resumed") when it had ended its turn, its end known by
        its answer (`side_answered`)."""
        agent = call.detail.get("agent")
        if agent and call.session:
            self.callers[agent] = call.session
        root, seen = call.session, set()
        while root in self.callers and root not in seen:
            seen.add(root)
            root = self.callers[root]
        gatherer, channel = (request.label, root) if request.label else (root, root)
        self.called(gatherer, channel, call)
        if agent and (channel, agent) in self.ended:
            self.ended.discard((channel, agent))
            self.facts(gatherer, channel, [Fact(Facts.TASK_STARTED, f"{agent}.{time.time():.3f}", time.time(),
                                                {"task": agent, "kind": "agent", "how": "resumed", "label": None,
                                                 "output": None})])
        if agent and isinstance(getattr(request, "state", None), dict):
            request.state[SUBAGENT_OF] = (gatherer, channel, agent)
        return None

    async def compaction(self, request, gatherer: str, channel: str, body: dict, cwd: Optional[str], history: list,
                         own: list, told: Optional[str]) -> Optional[dict]:
        """A compaction call's body, as codex's: the gatherer built in agy's place (the server's `compaction`), its
        context read only, agy's request for a summary after it -- the summary agy goes on from, which ag does not
        store, holding the history itself (to_events.py); agy's own call where there is none."""
        new, note = await call_ag(self.ag_clients.client(gatherer), gatherer, {CHANNEL: channel}, cwd,
                                  self.harness.items(history), self.adaptor, limit=getattr(request, "limit", None),
                                  op="compaction", process=getattr(request, "process", None),
                                  run=getattr(request, "run", None),
                                  preamble=preamble_of({"systemInstruction": body.get("systemInstruction"),
                                                        "tools": body.get("tools")}))
        self.log(gatherer, f"[{channel}] compaction: {note}")
        if new is None:
            return body if told else None
        return dict(body, contents=new + [dict(o) for o in own])

    def facts(self, gatherer: str, channel: str, facts: list) -> None:
        """Facts the hook knows itself, recorded in the background, beside the session's reads."""
        self.keep(record(self.ag_clients.client(gatherer), gatherer, channel, [derived(f) for f in facts], self.log,
                         beside=True))

    async def side_answered(self, request, status: int, answer) -> bool:
        """A subagent's answer (`subagent`): one that calls no tool ends its turn -- its task ended until it is called
        again. Then a title call's answer (`titled`)."""
        state = getattr(request, "state", None) or {}
        sub = state.get(SUBAGENT_OF)
        if sub is not None:
            gatherer, channel, agent = sub
            ok = status == 200 and isinstance(answer, dict) and not answer.get("error")
            reply = self.harness.read(self.harness.items(answer.get("output_items") or [])) if ok else []
            if ok and not any(p.kind == Kind.TOOL_CALL for p in reply):
                self.ended.add((channel, agent))
                self.facts(gatherer, channel, [Fact(Facts.TASK_ENDED, f"{agent}.{answer.get('response_id')}",
                                                    time.time(), {"task": agent, "kind": "agent", "status": "completed"})])
            return True
        return await self.titled(request, status, answer)

    async def titled(self, request, status: int, answer) -> bool:
        """A title call's answer, kept as the name (by "antigravity") of the conversation whose own turn its run sent
        last: its words, on one line. agy asks for the title as the conversation's first turn starts, so which one it is
        for is known by its answer, not its call; with no turn of the run by then, it is not kept."""
        kept = (getattr(request, "state", None) or {}).get(TITLE)
        if kept is None:
            return False
        label, run, call = kept
        of = self.runs.get((label, run))
        if of is None:
            print(f"agy's title, for no conversation known (run {run}): not kept", file=sys.stderr, flush=True)
            return True
        self.called(*of, call)
        ok = status == 200 and isinstance(answer, dict) and not answer.get("error")
        reply = self.harness.read(answer.get("output_items") or []) if ok else []
        text = " ".join((self.harness.title(reply) or "").split())[:NAME_CHARS]
        await self.named(*of, text or None, "antigravity")
        self.log(of[0], f"[{of[1]}] agy's title: {text!r}" if text else f"[{of[1]}] agy's title: nothing to keep ({status})")
        return True
