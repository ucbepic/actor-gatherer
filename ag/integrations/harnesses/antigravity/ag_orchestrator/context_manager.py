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

Not done yet, as agy's calls for them are not read yet (harness_kit/antigravity.py): its compaction, a subagent's
conversation as one of the session's, and its record of a conversation followed.
"""

import sys
import time
from typing import Callable, Optional, Union

from harness_kit import Antigravity, CallKind

from ag.integrations.harnesses.codex.ag_orchestrator.ag_clients import AgClients
from ag.integrations.harnesses.codex.ag_orchestrator.context_manager import load_adaptor
from ag.integrations.tools.ag_connection.ag_client import AgClient
from ag.integrations.tools.ag_orchestrator.adaptor import CHANNEL, Adaptor
from ag.integrations.tools.ag_orchestrator.call_ag import call_ag, keep_read, preamble_of
from ag.integrations.tools.ag_orchestrator.file_touches import Files
from ag.integrations.tools.ag_orchestrator.proxy_hook import ProxyHook
from ..adaptor.adaptor import AntigravityAdaptor

ANSWERED = "antigravity_answered"   # the hook's key in the hook server's `request.state`: where a call's answer is kept
FILES = "antigravity_files"         # the same, for what the answer's calls do to files: (gatherer, session, cwd, since)
TITLE = "antigravity_title"         # the same, for a title call: (label, run, the call), its conversation known by its answer
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
                 log: Callable[[str, str], None] = _print, adaptor: Union[Adaptor, str, None] = None, files: str = "on"):
        ag_clients = ag_clients or AgClients(lambda gatherer: AgClient("antigravity"))
        if files not in ("on", "off"):
            raise ValueError(f"files: {files!r}, not on or off")
        # shortcut: agy's record of a conversation (a SQLite file) is not followed, upgrade once harness_kit has a Follower for it
        super().__init__(ag_clients, log, Files(ag_clients, log, harness=self.harness) if files == "on" else None,
                         sessions=None)
        self.cwd = cwd
        self.adaptor = load_adaptor(adaptor) if isinstance(adaptor, str) else (adaptor or AntigravityAdaptor())
        self.runs = {}                    # (label, run) -> (gatherer, session): the one whose own turn it sent last

    async def __call__(self, request) -> Optional[dict]:
        body, since = request.body, time.time()
        call = self.harness.call(request.method, request.path, request.headers, body)
        if call is None:
            return None
        run = getattr(request, "run", None)
        if call.kind != CallKind.TURN:
            if call.kind == CallKind.TITLE and run and isinstance(getattr(request, "state", None), dict):
                request.state[TITLE] = (request.label, run, call)       # its conversation: known by its answer
            else:
                print(f"agy's own {call.kind} call, for no conversation known: as it is", file=sys.stderr, flush=True)
            return None
        session = call.session
        gatherer, channel = (request.label, session) if request.label else (session, session)
        if run:
            self.runs[(request.label, run)] = (gatherer, channel)
        cwd = call.cwd or self.cwd
        items = self.harness.items(body["contents"])
        if isinstance(getattr(request, "state", None), dict):
            request.state[ANSWERED] = (gatherer, channel, cwd)
            if self.files is not None:
                request.state[FILES] = (gatherer, channel, cwd, since)
        if self.files is not None:                         # the results of the last answer's calls: checked
            self.files.arrived(gatherer, channel, cwd, items)
        out = {}
        messages, note = await call_ag(
            self.ag_clients.client(gatherer), gatherer, {CHANNEL: channel}, cwd, items, self.adaptor, out=out,
            limit=getattr(request, "limit", None), process=getattr(request, "process", None), run=run,
            preamble=preamble_of({"systemInstruction": body.get("systemInstruction"), "tools": body.get("tools")}))
        self.log(gatherer, f"[{channel}] {note}")
        keep_read(request, gatherer, out)
        self.called(gatherer, channel, call, out.get("read_id"))
        if messages is None or messages == items:
            return None                                   # nothing to change: agy's own bytes go through
        return dict(body, contents=messages)

    async def side_answered(self, request, status: int, answer) -> bool:
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
