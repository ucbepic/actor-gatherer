"""Codex, as harness_kit reads it (0.164): its model calls (the Responses API), the items of its input,
its own context among them, and its tools.

    calls        a POST to .../responses whose input holds a user message; what each is for, in its turn
                 metadata (the `x-codex-turn-metadata` header, else the body's `client_metadata`):
                 `thread_source` user is the thread's own turn, any other one of codex's side calls --
                 thread_title (a title, its answer {"title"}), system (/recap, {"summary", "next_action"}),
                 a subagent's (`parent_thread_id`), guardian_review, memory_consolidation; `request_kind`
                 compaction, its input ending with a `compaction_trigger`. The thread in the `thread-id`
                 header (then `session-id`, then the body's `prompt_cache_key`); the working directory in
                 the last <environment_context> (its <cwd>, else its first workspace root)
    items        each input item, as it is (codex's items are already one thing each)
    kinds        by the item's type (CODEX_TYPES) -- a message by its role, but a user-role message made
                 only of codex's own context (PREAMBLE_MARKERS) is codex's

Codex item types are defined in codex-rs/protocol/src/models.rs (`ResponseItem`); its own context
fragments in core/src/context/contextual_user_message.rs.
"""

import glob
import json
import os
import queue
import re
import subprocess
import threading
import time
from typing import Dict, List, Optional, Tuple

from .base import (Action, AnswerError, Box, Call, CallKind, Fact, Facts, Follower, Harness, Kind, Part, RenameError,
                   ToolCall, ToolResult, one_line, output_of, picked, seconds, typed_in)

# Codex item type -> Kind. None = a message: its role decides (ROLES). An item type not listed here is OTHER.
ITEM_KINDS = {
    "message":                   None,
    "additional_tools":          Kind.TOOL_NOTICE,        # tool definitions
    "reasoning":                 Kind.REASONING,
    "agent_message":             Kind.PEER_MESSAGE,       # another agent's message to this one (a subagent's report:
                                                          # AGENT_REPORT): codex's, not the model's -- as Claude Code's
    "compaction":                Kind.COMPACTION_SUMMARY, # codex's summary of dropped history
    "compaction_summary":        Kind.COMPACTION_SUMMARY, # older name codex still accepts
    "context_compaction":        Kind.COMPACTION_SUMMARY,
    "compaction_trigger":        Kind.OTHER,              # marks where compaction happened
    "function_call":             Kind.TOOL_CALL,
    "custom_tool_call":          Kind.TOOL_CALL,
    "local_shell_call":          Kind.TOOL_CALL,
    "tool_search_call":          Kind.TOOL_CALL,
    "web_search_call":           Kind.TOOL_CALL,          # run by the API; no output item
    "image_generation_call":     Kind.TOOL_CALL,          # result is carried in the call
    "function_call_output":      Kind.TOOL_RESULT,
    "custom_tool_call_output":   Kind.TOOL_RESULT,
    "tool_search_output":        Kind.TOOL_RESULT,
}
# A message's role -> its Kind. `system` is what the API calls developer instructions in older models.
ROLES = {"user": Kind.USER, "assistant": Kind.AGENT, "developer": Kind.ENVIRONMENT, "system": Kind.ENVIRONMENT}

# Codex's own context, sent in USER-role messages. A user message made only of these is codex's, not the user's:
# the user did not say it, so it opens no turn. Each of the Kind it is.
PREAMBLE = (
    ("# AGENTS.md instructions for ", Kind.ENVIRONMENT), ("</INSTRUCTIONS>", Kind.ENVIRONMENT),
    ("<environment_context>", Kind.ENVIRONMENT), ("<environments_instructions>", Kind.ENVIRONMENT),
    ("<user_shell_command>", Kind.COMMAND_OUTPUT), ("<skill>", Kind.SKILL), ("<skills_instructions>", Kind.ENVIRONMENT),
    ("<goal_context>", Kind.ENVIRONMENT), ("<codex_internal_context", Kind.ENVIRONMENT),
    ("<subagent_notification>", Kind.AGENT_REPORT), ("<turn_aborted>", Kind.INTERRUPT),
    ("<hook_prompt", Kind.HOOK_FEEDBACK), ("<permissions instructions>", Kind.ENVIRONMENT),
    ("<recommended_plugins>", Kind.ENVIRONMENT), ("<external_", Kind.ENVIRONMENT),
    ("Warning: The maximum number of unified exec processes", Kind.OTHER),
    ("Warning: apply_patch was requested via ", Kind.OTHER),
    ("Warning: Your account was flagged for potentially high-risk cyber activity", Kind.OTHER),
)
PREAMBLE_MARKERS = tuple(m for m, _ in PREAMBLE)
#: The user's answers to what codex asked as it worked (request_user_input_async), as codex sends them, one message
#: for each submitted: <send_user_message_question_reply>[{"answer", "question", "questionItemId"}]</...>.
REPLY = "<send_user_message_question_reply>"
REPLIED = re.compile(r"^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*(?:</send_user_message_question_reply>\s*)?$")
# codex's message from another of its agents (an `agent_message` item: a subagent's report handed back, FINAL_ANSWER;
# any other message between them), as it words it for the model
AGENT_TEXT = re.compile(r"^\s*Message Type: (\w+)\s*\nTask name: [^\n]*\nSender: ([^\n]*)\nPayload:\n?([\s\S]*)$")

#: Codex's summary of the history it compacted: what its input starts again from.
COMPACTED = ("compaction", "compaction_summary", "context_compaction")
TRIGGER = "compaction_trigger"   # the compaction call's last item: what asks for the summary

METADATA = "x-codex-turn-metadata"   # codex's header (and client_metadata key) saying what a call is for
TURN = "user"                         # the thread_source of a thread's own turn; any other is a side call
SIDE_KINDS = {"thread_title": CallKind.TITLE, "system": CallKind.RECAP, "subagent": CallKind.SUBAGENT}
CWD = re.compile(r"<cwd>\s*(.*?)\s*</cwd>", re.S)
ROOT = re.compile(r"<workspace_roots>\s*<root>\s*(.*?)\s*</root>", re.S)
VERSION = re.compile(r"codex[_-][\w-]+/([\d.]+)")  # its User-Agent: codex-tui/0.164.0 (its terminal), codex_exec/...

#: Its tools: each one's action, and the input key that names the file it works on.
TOOLS = {"exec_command": (Action.SHELL, None), "shell": (Action.SHELL, None), "shell_command": (Action.SHELL, None),
         "local_shell": (Action.SHELL, None), "apply_patch": (Action.EDIT, None), "write_stdin": (Action.TASK, None),
         "view_image": (Action.READ, "path"), "web_search": (Action.WEB, None), "spawn_agent": (Action.DELEGATE, None),
         "send_message": (Action.DELEGATE, None), "wait": (Action.TASK, None), "update_plan": (Action.OTHER, None),
         "request_user_input": (Action.ASK, None), "request_user_input_async": (Action.ASK, None)}
#: Its tool that asks the user in its terminal, its turn waiting on the answer (Plan mode's); and the one it asks
#: with as its turn goes on.
ASK, ASK_ASYNC = "request_user_input", "request_user_input_async"
#: Answering what it asks in its terminal (`answer_keys`), its keys as 0.164 takes them -- in three ways:
#:
#:     a question (request_user_input, Plan mode's; its turn waits): a dialog, one question at a time
#:         an option                  its number: picked, and on to the next question -- after the last, all sent
#:         the reader's own words     Down to "None of the above" (the one after the options), Tab (a note), the
#:                                    words, Enter
#:       and it tells the model {"answers": {<id>: {"answers": [label, "user_note: <words>"]}}}
#:     a question asked as the turn goes on (request_user_input_async): Shift+Left from the prompt opens it
#:         an option                  its number (it only moves there), Enter
#:         the reader's own words     the number after the options' ("Other"), the words (in its place), Enter
#:       and it sends the replies as the user's next message: [{"answer", "question", "questionItemId"}]
#:     a plan its turn proposed (its <proposed_plan>), once the turn is over: "Implement this plan?"
#:         "implement"                1 "Yes, implement this plan": Default mode, and "Implement the plan." sent
#:         "change"                   3 "No, stay in Plan mode", then the words and Enter, as a message in Plan mode
#:       (2 "Yes, clear context and implement" starts another thread: left to the terminal)
PLAN_KEYS = {"implement": "1", "change": "3"}
IMPLEMENT = "Implement the plan."
NOTE = "user_note: "
DOWN, OPEN_ASYNC = "\x1b[B", "\x1b[1;2D"            # Down; Shift+Left, which opens its question asked as it works
#: What it may do unasked, by Claude Code's names for it: auto is --approve-for-me (its reviewer approves), bypass
#: its bypass; any other, nothing (it asks).
PERMISSIONS = {"auto": ["--approve-for-me"], "bypassPermissions": ["--dangerously-bypass-approvals-and-sandbox"]}
COMPOSER_ROWS = 12                  # its composer's rows at most
FOOT_ROWS = 3                       # the rows under it at most: its status line, its hints
#: The item types the dashboard reads as codex's, by shape.
SHAPES = {"message", "function_call", "function_call_output", "custom_tool_call", "custom_tool_call_output",
          "reasoning", "local_shell_call", "web_search_call", "compaction", "compaction_summary"}
SPAWN = "spawn_agent"                 # its tool that starts a subagent


def texts_of(item) -> list:
    """A message's text parts' words."""
    if not isinstance(item, dict):
        return []
    parts = item.get("content")
    if isinstance(parts, str):
        return [parts]
    return [p["text"] for p in parts or [] if isinstance(p, dict) and isinstance(p.get("text"), str)]


def own_context(item) -> Optional[str]:
    """The Kind of codex's own context a user-role message is -- made only of it (PREAMBLE_MARKERS), or of nothing
    (OTHER) -- by its first text that says anything; None: the user's."""
    texts = [p.get("text", "") for p in item.get("content") or []
             if isinstance(p, dict) and p.get("type") == "input_text"]
    if not any(t.strip() for t in texts):
        return Kind.OTHER
    if not all(t.strip().startswith(PREAMBLE_MARKERS) or not t.strip() for t in texts):
        return None
    first = next(t.strip() for t in texts if t.strip())
    return next(kind for marker, kind in PREAMBLE if first.startswith(marker))


def is_harness_context(item) -> bool:
    """A user-role message made only of codex's own context (or of nothing)."""
    return own_context(item) is not None


def kind_of(item) -> str:
    """A codex item's Kind. Never raises: anything it does not know is OTHER."""
    if not isinstance(item, dict):
        return Kind.OTHER
    kind, role = item.get("type"), item.get("role")
    if kind == "message" or (kind is None and role is not None):
        if role == "user":
            own = own_context(item)
            if own is not None:
                return own
            text = "\n".join(texts_of(item))
            return Kind.ASK_REPLY if text.lstrip().startswith(REPLY) else Kind.USER
        own = own_context(item) if role in ("developer", "system") else None   # 0.164 sends <turn_aborted> as developer
        if own not in (None, Kind.OTHER):
            return own
        return ROLES.get(role, Kind.OTHER)
    return ITEM_KINDS.get(kind) or Kind.OTHER


def _parts_text(content) -> str:
    """The words of a message's content (or of a tool output given as parts): its text parts, an image as `[image]`."""
    if isinstance(content, str):
        return content
    out = []
    for p in content or []:
        if isinstance(p, str):
            out.append(p)
        elif isinstance(p, dict):
            if isinstance(p.get("text"), str):
                out.append(p["text"])
            elif str(p.get("type", "")).endswith("image"):
                out.append("[image]")
    return "\n".join(out)


def _output_text(output) -> str:
    """A tool output's text: a string as it is, a `{content}` object's content, parts' words."""
    if isinstance(output, str):
        return output
    if isinstance(output, dict) and "content" in output:
        return _output_text(output["content"])
    if isinstance(output, list):
        return _parts_text(output)
    return json.dumps(output, ensure_ascii=False)


def text_of(item) -> Optional[str]:
    """What the model reads of a codex item, without codex's bookkeeping; None when it has nothing to read (reasoning,
    compaction's encrypted summary) or is not a shape codex makes.

        message                      its words (text parts; an image as `[image]`)
        function / custom tool call  name(arguments)
        local shell call             local_shell(the command)
        web search call              web_search(the query)
        any call's output            the output's text
    """
    if not isinstance(item, dict):
        return None
    kind = item.get("type")
    if kind == "message" or (kind is None and "role" in item) or kind == "agent_message":
        return _parts_text(item.get("content"))
    if kind in ("function_call", "custom_tool_call", "tool_search_call"):
        args = item.get("arguments", item.get("input", ""))
        return f"{item.get('name') or kind}({args if isinstance(args, str) else json.dumps(args, ensure_ascii=False)})"
    if kind == "local_shell_call":
        cmd = (item.get("action") or {}).get("command")
        return f"local_shell({' '.join(cmd) if isinstance(cmd, list) else cmd or ''})"
    if kind == "web_search_call":
        return f"web_search({(item.get('action') or {}).get('query') or ''})"
    if kind in ("function_call_output", "custom_tool_call_output", "tool_search_output"):
        return _output_text(item.get("output", item.get("tools")))
    return None


def arguments(raw):
    """A codex call's arguments: a JSON string, read as its object when it is one."""
    if isinstance(raw, str):
        try:
            got = json.loads(raw)
            return got if isinstance(got, dict) else raw
        except ValueError:
            return raw
    return raw


def replied(text: str) -> Optional[List[dict]]:
    """The user's answers in codex's reply to what it asked as it worked (REPLIED): [{answer, question,
    questionItemId}]; None when the text is not one."""
    m = REPLIED.match(text or "")
    if not m:
        return None
    try:
        got = json.loads(m.group(1))
    except ValueError:
        return None
    return [r for r in got if isinstance(r, dict)] if isinstance(got, list) else None


def replies(text) -> bool:
    """Whether a user message is codex's wrapper of answers to what it asked as it worked (REPLY): the user's words,
    sent while the turn that asked runs -- part of that turn, not one of its own."""
    return isinstance(text, str) and text.lstrip().startswith(REPLY)


def report_of(text: str) -> Optional[dict]:
    """What codex's message from another of its agents says (AGENT_TEXT): {kind: AGENT_REPORT, from, text} for a
    subagent's report handed back (FINAL_ANSWER), {kind: PEER_MESSAGE, name, text} for any other; None: not one."""
    m = AGENT_TEXT.match(text or "")
    if not m:
        return None
    if m.group(1) == "FINAL_ANSWER":
        return {"kind": Kind.AGENT_REPORT, "from": m.group(2).strip(), "text": m.group(3).strip()}
    return {"kind": Kind.PEER_MESSAGE, "name": m.group(2).strip(), "text": m.group(3).strip()}


def questions_of(given) -> list:
    """Codex's questions (request_user_input's: {id, header, question, options: [{label, description}]}; the async
    one's: {title, options: [label]}) as ToolCall.ask has them."""
    out = []
    for q in given if isinstance(given, list) else []:
        if not isinstance(q, dict):
            continue
        options = [o if isinstance(o, dict) else {"label": str(o)} for o in q.get("options") or [] if isinstance(o, (dict, str))]
        out.append({"id": q.get("id"), "header": q.get("header"), "question": q.get("question") or q.get("title"),
                    "multiSelect": False, "options": [{"label": o.get("label"), "description": o.get("description")}
                                                      for o in options]})
    return out


def ask_of(name: str, args) -> Optional[dict]:
    if name not in (ASK, ASK_ASYNC):
        return None
    got = args if isinstance(args, dict) else {}
    return {"kind": "question", "async": name == ASK_ASYNC, "questions": questions_of(got.get("questions"))}


def is_model_call(method: str, path: str, body) -> bool:
    """Whether the request is a model call whose input the context manager answers for: a POST to .../responses with
    an input list holding a user message."""
    if method != "POST" or not path.split("?", 1)[0].rstrip("/").endswith("/responses"):
        return False
    if not isinstance(body, dict) or not isinstance(body.get("input"), list):
        return False
    return any(isinstance(i, dict) and i.get("role") == "user" for i in body["input"])


def thread_of(headers, body: dict) -> Optional[str]:
    """The codex thread id the request belongs to, or None."""
    lower = {k.lower(): v for k, v in (headers or {}).items()}
    return lower.get("thread-id") or lower.get("session-id") or body.get("prompt_cache_key") or None


def metadata_of(headers, body: dict) -> dict:
    """What codex says of the call (its turn metadata: thread_source, request_kind, parent_thread_id, ...), from its
    header, else the body's client_metadata; {} when it says nothing."""
    lower = {k.lower(): v for k, v in (headers or {}).items()}
    raw = lower.get(METADATA) or ((body.get("client_metadata") or {}) if isinstance(body.get("client_metadata"), dict)
                                  else {}).get(METADATA)
    try:
        found = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return {}
    return found if isinstance(found, dict) else {}


def side_call(metadata: dict) -> Optional[str]:
    """The kind of codex's own side call this is (its thread_source: thread_title, system, subagent, guardian_review,
    ...), or None: the thread's own turn -- a user source, or none said."""
    source = metadata.get("thread_source")
    if metadata.get("parent_thread_id") and source in (None, TURN):
        source = "subagent"
    return None if source in (None, TURN) else str(source)


def compaction_split(metadata: dict, items: list) -> Optional[Tuple[list, list]]:
    """(the history, the trigger) of a compaction call -- `request_kind` compaction, or an input ending with a
    `compaction_trigger` -- else None."""
    last = items[-1] if items else None
    if isinstance(last, dict) and last.get("type") == TRIGGER:
        return items[:-1], [last]
    if metadata.get("request_kind") == "compaction":
        return items, []
    return None


def answer_object(reply: List[Part]) -> dict:
    """What a side call's answer says, read as the JSON object codex asked for (its output schema): the text of its
    messages; {} when it is not one."""
    text = "".join(p.text or "" for p in reply if p.kind == Kind.AGENT)
    try:
        found = json.loads(text)
    except ValueError:
        return {}
    return found if isinstance(found, dict) else {}


def cwd_of(items: list) -> Optional[str]:
    """The agent's working directory, as the last <environment_context> in the input states it -- its <cwd>, or,
    where codex writes none, the first of its <workspace_roots> -- None if none does."""
    found = None
    for item in items:
        for text in texts_of(item):
            if "<environment_context>" in text:
                match = CWD.findall(text) or ROOT.findall(text)
                if match:
                    found = match[-1]
    return found


def after_compaction(items: list) -> Tuple[int, list]:
    """(where what is new since codex's summary of its compacted history starts, the indexes of the items from then on
    that are not a compaction trigger): after the last summary (`COMPACTED`), if any is there; all of them when it
    compacted nothing."""
    at = max((i for i, item in enumerate(items) if isinstance(item, dict) and item.get("type") in COMPACTED), default=-1)
    return at, [i for i in range(at + 1, len(items)) if not (isinstance(items[i], dict) and items[i].get("type") == TRIGGER)]


APP_SERVER_SECONDS = 20            # the longest codex's app server is waited for (it answers in well under a second)


def app_server(messages: List[dict], env=None, timeout: float = APP_SERVER_SECONDS) -> dict:
    """Codex's app server (`codex app-server`) sent these JSON-RPC messages over its stdin, one per line, each request
    once the one before is answered: {id: its answer} of the requests answered before it ended or `timeout` passed.
    Raises RenameError when codex cannot be run."""
    try:
        proc = subprocess.Popen(["codex", "app-server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, text=True, env=env)
    except OSError as exc:
        raise RenameError(f"Codex could not be run: {exc}") from None
    answers: "queue.Queue[Optional[dict]]" = queue.Queue()

    def read() -> None:
        for line in proc.stdout:
            try:
                got = json.loads(line)
            except ValueError:
                continue
            if isinstance(got, dict) and "id" in got and "method" not in got:
                answers.put(got)
        answers.put(None)
    reader = threading.Thread(target=read, name="codex-app-server", daemon=True)
    reader.start()
    out, end = {}, time.monotonic() + timeout
    try:
        for m in messages:
            proc.stdin.write(json.dumps(m) + "\n")
            proc.stdin.flush()
            while "id" in m and m["id"] not in out:
                got = answers.get(timeout=max(0.0, end - time.monotonic()))
                if got is None:
                    return out
                out[got["id"]] = got
    except (OSError, ValueError, queue.Empty):
        pass
    finally:
        try:
            proc.stdin.close()
            proc.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            proc.kill()
            proc.wait()
        reader.join(timeout=1)                       # what it printed last read: its end
        proc.stdout.close()
    return out


class Codex(Harness):
    name = "codex"
    label = "Codex"
    checked_with = "0.164.0"
    fullscreen = False               # its classic inline screen (`--no-alt-screen`): scrolled in the terminal's own scrollback
    picks_session_id = True          # its thread's id, which it picks
    stopped_says = {"lead": "■", "interrupted": "Conversation interrupted", "error": "Error",    # 0.164's tui, less its
                    "reasons": {"budget_limited": "Goal budget reached - the turn was stopped."}}  # pointer to /feedback
    NAME_CHARS = 120                 # the longest title kept (codex asks for 36 characters at most)

    def call(self, method: str, path: str, headers, body) -> Optional[Call]:
        """The request as a model call (module doc), None if it is not one; `detail["metadata"]`, what codex said of it,
        and `detail["source"]`, the side call's own name for one."""
        if not is_model_call(method, path, body):
            return None
        metadata = metadata_of(headers, body)
        agent = next((str(v) for k, v in (headers or {}).items() if k.lower() == "user-agent"), "")
        found = VERSION.search(agent)
        items = body["input"]
        out = Call(CallKind.TURN, thread_of(headers, body), cwd_of(items), found.group(1) if found else None,
                   history=items, detail={"metadata": metadata})
        source = side_call(metadata)
        if source is not None:
            out.kind, out.detail["source"] = SIDE_KINDS.get(source, CallKind.OTHER), source
            return out
        split = compaction_split(metadata, items)
        if split is not None:
            out.kind, out.history, out.own = CallKind.COMPACTION, split[0], split[1]
        return out

    def title(self, reply: List[Part]) -> Optional[str]:
        text = " ".join(str(answer_object(reply).get("title") or "").split())[:self.NAME_CHARS]
        return text or None

    def recap(self, reply: List[Part]) -> Optional[str]:
        got = answer_object(reply)
        summary, then = str(got.get("summary") or "").strip(), str(got.get("next_action") or "").strip()
        text = summary + (f"\n\nNext: {then}" if summary and then else "")
        return text or None

    def rename_command(self, name: str) -> Optional[str]:
        """Its own `/rename`, the name after it (without one it asks in a dialog): the name in its status line, and
        kept in its state. A codex ag runs has no app server of its own to hear of a name set from outside (`--no-daemon`)."""
        name = " ".join((name or "").split())
        return f"/rename {name}" if name else None

    def rename(self, session: str, name: str, record: Optional[str] = None, env=None, cwd: Optional[str] = None) -> str:
        """The thread named through codex's app server (`codex app-server`, JSON-RPC over its stdin), as its own
        /rename names it: `thread/name/set`, kept in its state database and its session index, where `codex resume`
        lists and finds it. A codex running the thread shows the name it holds until it is resumed, or told by
        `rename_command`."""
        name = " ".join((name or "").split())
        if not name:
            raise RenameError("Codex keeps no empty name")
        got = app_server([{"id": 1, "method": "initialize", "params": {"clientInfo": {"name": "harness_kit", "title": None,
                                                                                      "version": "0"}, "capabilities": None}},
                          {"method": "initialized"},
                          {"id": 2, "method": "thread/name/set", "params": {"threadId": session, "name": name}}], env)
        error = got.get(2, {}).get("error") if 2 in got else {"message": "it did not answer"}
        if error:
            raise RenameError(f"Codex did not take the name: {error.get('message') if isinstance(error, dict) else error}")
        return "named in its state"

    asks_recorded = True          # its asks, and their answers, are in its rollout (Rollout)

    def box(self, screen) -> Optional[str]:
        """Its composer: a "›" row and the rows of what is typed under it (each two columns in), the cursor shown in it
        while it has the keys; under it a blank row, then only its status line and its hints, at the foot of the screen.
        A popup (/model), an approval it asks, takes the keys and hides the cursor."""
        if not screen.cursor_shown:
            return Box.AWAY
        lines = screen.lines()
        first = screen.y
        while first >= 0 and not lines[first].startswith("›"):
            if lines[first].strip() and not lines[first].startswith("  "):
                return Box.AWAY
            first -= 1
        if first < 0 or screen.y - first > COMPOSER_ROWS:
            return Box.AWAY
        end = screen.y                                   # what is typed may go on below the cursor, up to a blank row
        while end + 1 < len(lines) and lines[end + 1].startswith("  ") and lines[end + 1].strip():
            end += 1
        below = [r for r in range(end + 1, len(lines)) if lines[r].strip()]
        if below and (below != list(range(end + 2, end + 2 + len(below))) or len(below) > FOOT_ROWS):
            return Box.AWAY
        return Box.HOLDS if typed_in(screen, first, end, 1).strip() else Box.EMPTY

    def command(self, session: str, resume: bool = False, model: Optional[str] = None,
                permission_mode: Optional[str] = None, fullscreen: bool = True,
                instructions: Optional[str] = None) -> List[str]:
        """Its own options (PERMISSIONS), its instructions, its classic inline screen where not `fullscreen`, and
        `resume <thread>`."""
        return [*(["-m", model] if model else []), *PERMISSIONS.get(permission_mode or "", []),
                *(self.instruction_args(instructions) if instructions else []),
                *([] if fullscreen else ["--no-alt-screen"]), *(["resume", session] if resume else [])]

    def instruction_args(self, text: str) -> List[str]:
        """Its config's `developer_instructions`, set for the run (`-c`, whose value is TOML: a JSON string is one): a
        developer message it sends after its own, on every call -- `codex` and `codex exec` alike, before `resume`."""
        return ["-c", "developer_instructions=" + json.dumps(text)]

    def models(self, env: Optional[Dict[str, str]] = None) -> dict:
        """Its catalog (`codex debug models`, the ones it lists), and the model its config.toml names."""
        found = []
        try:
            done = subprocess.run(["codex", "debug", "models"], env=env, capture_output=True, text=True, timeout=30,
                                  stdin=subprocess.DEVNULL)
            listed = json.loads(done.stdout).get("models") if done.returncode == 0 else None
        except (OSError, subprocess.SubprocessError, ValueError, AttributeError):
            listed = None
        for m in listed if isinstance(listed, list) else []:
            if isinstance(m, dict) and m.get("slug") and m.get("visibility", "list") == "list":
                found.append({"slug": m["slug"], "name": m.get("display_name") or m["slug"], "description": m.get("description") or ""})
        default = None
        try:
            import tomllib
            with open(os.path.join(codex_home((env or {}).get("CODEX_HOME")), "config.toml"), "rb") as fh:
                default = tomllib.load(fh).get("model")
        except (OSError, ValueError, ImportError):
            pass
        return {"models": found, "default": default}

    def answer_keys(self, ask: dict, choice: dict) -> List[str]:
        """Its dialogs' keys (PLAN_KEYS' notes)."""
        if ask.get("kind") == "plan":
            how = choice.get("plan")
            if how not in PLAN_KEYS:
                raise AnswerError("implement the plan or say what to change")
            return [PLAN_KEYS[how]] if how == "implement" else [PLAN_KEYS[how], one_line(choice.get("text")), "\r"]
        out: List[str] = [OPEN_ASYNC] if ask.get("async") else []
        for p in picked(ask, choice):
            if ask.get("async"):
                out += [str(p["count"] + 1), p["text"].strip(), "\r"] if p["text"] is not None else [str(p["places"][0] + 1), "\r"]
            elif p["text"] is not None:
                out += [DOWN] * p["count"] + ["\t", p["text"].strip(), "\r"]
            else:
                out.append(str(p["places"][0] + 1))
        return out

    def answer_expected(self, ask: dict, choice: dict) -> List[str]:
        """In the JSON it records: each a string as its JSON has it."""
        if ask.get("kind") == "plan":
            return [IMPLEMENT] if choice.get("plan") == "implement" else [one_line(choice.get("text"))]
        if ask.get("async"):
            return ['"answer":' + _json_str(p["text"].strip() if p["text"] is not None else p["labels"][0])
                    for p in picked(ask, choice)]
        return [_json_str(NOTE + p["text"].strip()) if p["text"] is not None else _json_str(p["labels"][0])
                for p in picked(ask, choice)]

    def answer_summary(self, ask: dict, choice: dict) -> str:
        if ask.get("kind") == "plan":
            return "Implement the plan" if choice.get("plan") == "implement" else f"Change: {(choice.get('text') or '').strip()}"
        return super().answer_summary(ask, choice)

    def items(self, history: list) -> list:
        return list(history or [])

    def words(self, text: str) -> tuple:
        got = replied(text)
        if got is None:
            return Kind.USER, text
        return Kind.ASK_REPLY, "\n".join(f"{str(r.get('question') or '').strip()}{' → ' if r.get('question') else ''}"
                                          f"{str(r.get('answer') or '').strip()}" for r in got) or text

    def record_path(self, session: str, cwd: Optional[str] = None, config: Optional[str] = None) -> Optional[str]:
        return record_path(session, config)

    def follower(self, path: str) -> Follower:
        return Rollout(path)

    def read(self, items: list) -> List[Part]:
        """Each item read. After codex compacts its history, its input starts again: its preamble re-sent under new ids,
        the user messages it kept, and its encrypted summary (a `compaction` item), then what comes after -- the
        items up to the summary are COMPACTION_REPEAT, the summary COMPACTION_SUMMARY, and a compaction trigger OTHER."""
        out = [self.part(it) for it in items]
        at, _ = after_compaction(items)
        for i in range(at):
            out[i].detail["repeated"] = out[i].kind
            out[i].kind = Kind.COMPACTION_REPEAT
        if at >= 0:
            out[at].detail["opens"] = True
        return out

    def part(self, item) -> Part:
        """One item read on its own."""
        kind = kind_of(item)
        p = Part(kind, item.get("role") if isinstance(item, dict) else None, text_of(item),
                 detail={"block": item.get("type") if isinstance(item, dict) else None})
        if not isinstance(item, dict):
            return p
        t = item.get("type")
        if kind == Kind.USER:
            p.words = p.text
        elif kind == Kind.ASK_REPLY:
            p.words = self.words(p.text or "")[1]
            p.detail["replies"] = replied(p.text or "") or []
        elif t == "agent_message":
            p.detail["between"] = "author" in item or "recipient" in item
            said = report_of(p.text or "")
            if said:
                p.kind = said.pop("kind")
                p.detail.update(said)
        elif kind == Kind.ENVIRONMENT or p.role == "user":
            texts = texts_of(item)
            found = next((CWD.findall(x) or ROOT.findall(x) for x in texts if "<environment_context>" in x), None)
            if found:
                p.cwd = found[-1]
        if t in ("function_call", "custom_tool_call", "tool_search_call"):
            name = item.get("name") or t
            args = arguments(item.get("arguments", item.get("input")))
            action = TOOLS.get(name, (Action.OTHER, None))[0]
            p.tool = ToolCall(item.get("call_id") or item.get("id"), name, args, action, ask=ask_of(name, args))
        elif t == "local_shell_call":
            p.tool = ToolCall(item.get("call_id") or item.get("id"), "local_shell", item.get("action") or {}, Action.SHELL)
        elif t == "web_search_call":
            p.tool = ToolCall(item.get("id"), "web_search", item.get("action") or {}, Action.WEB)
        elif t == "image_generation_call":
            p.tool = ToolCall(item.get("id"), "image_generation", {}, Action.OTHER)
        elif kind == Kind.TOOL_RESULT:
            p.result = ToolResult(item.get("call_id"), False, output_of(item.get("output", item.get("tools"))))
        elif kind == Kind.REASONING:
            p.opaque = True
            p.detail["thinking"] = "\n\n".join(s.get("text", "") for s in item.get("summary") or [] if isinstance(s, dict))
        return p



# ---------------------------------------------------------------- its own record of a thread: its rollout file

#: Codex's record of a thread, its rollout: <its home: CODEX_HOME, else ~/.codex>/sessions/<year>/<month>/<day>/
#: rollout-<time>-<thread>.jsonl, a line {"timestamp", "type", "payload"} per thing as codex does it. What is read
#: of it (0.164):
#:
#:     event_msg task_started       a turn begins: its id, its collaboration mode ("plan", "default")
#:     event_msg task_complete      it ends; with `error` {message, codex_error_info} when it stopped on a model call
#:                                  that failed, its tries spent
#:     event_msg turn_aborted       it ends, interrupted (Esc) -- a question it was asking with it
#:     event_msg item_completed     a Plan item: the plan a Plan-mode turn proposes (its <proposed_plan>), which its
#:                                  terminal then asks whether to implement; a SubAgentActivity: a subagent started,
#:                                  or ended; a CommandExecution: a command ended, its `process_id` that of one left
#:                                  running
#:     response_item function_call  request_user_input: questions asked in the terminal, the turn waiting on them;
#:                                  request_user_input_async: asked while the turn goes on
#:     response_item function_call_output  a question's answer, the moment it is picked: {"answers": {id: {"answers":
#:                                  [label, "user_note: ..."]}}}, or "aborted by user after ..." (Esc)
#:     response_item ..._output     a command left running: its output names its session ("session_id": N, or
#:                                  "Process running with session ID N"), what write_stdin and wait go on with
#:     response_item message        the user's: an async question's reply (REPLY), and the message the turn after a
#:                                  proposed plan opens with ("Implement the plan.", or the reader's own)
#:
#: Not in it: codex's prompts themselves as they show -- a command's approval, the plan's "Implement this plan?" --
#: nor the plan's dismissed (Esc), which leaves no line anywhere.
ABORTED = "aborted by user"     # a question's output when it was dismissed (Esc), its turn interrupted
#: A subagent's activity that says it ended (any other but "started" is not taken for an end).
AGENT_ENDS = {"completed", "interrupted", "errored", "failed", "closed", "shutdown", "cancelled", "stopped", "exited"}
#: A command codex left running, as its call's output names it (a code-mode script's, as JSON in its text).
RUNS = re.compile(r'(?:\\?"session_id\\?":\s*|Process running with session ID )(\d+)')
CMD = re.compile(r'\bcmd\\?"?\s*:\s*\\?"((?:[^"\\]|\\.)*?)\\?"')   # a call's command: {cmd: "..."}
CALLS_KEPT = 20                 # the newest command calls kept, to name a command left running by its call
REPORT_SECONDS = 60.0           # how long an ended subagent's report is looked for in its own rollout
TAIL = 1 << 20                  # how much of a subagent's rollout's end is read for its report
#: What a line must hold to be one `take` reads: anything else (most of it) is not parsed at all.
WANTED = (b'"task_started"', b'"task_complete"', b'"turn_aborted"', b'"SubAgentActivity"', b'"type":"Plan"',
          b'"name":"request_user_input', REPLY.encode(), b'"CommandExecution"', b'session_id', b'session ID')


def _json_str(text: str) -> str:
    """A string as its record has it in its JSON."""
    return json.dumps(text, ensure_ascii=False)


def codex_home(config: Optional[str] = None) -> str:
    """Codex's home: `config`, else CODEX_HOME, else ~/.codex."""
    return os.path.abspath(os.path.expanduser(config or os.environ.get("CODEX_HOME") or "~/.codex"))


def record_path(thread: str, config: Optional[str] = None, sessions: Optional[str] = None) -> Optional[str]:
    """Codex's rollout of `thread`, if it has one now (the newest, should there be more); `sessions`, the folder of
    its sessions, when known (else under its home)."""
    if not thread:
        return None
    root = sessions or os.path.join(codex_home(config), "sessions")
    found = sorted(glob.glob(os.path.join(glob.escape(root), "*", "*", "*", f"rollout-*-{glob.escape(thread)}.jsonl")))
    return found[-1] if found else None


def last_said(path: Optional[str]) -> Optional[str]:
    """What a thread answered last, as its rollout has it: its newest turn's last message, once that turn completed;
    None while it runs, or if it ended otherwise or said nothing."""
    try:
        with open(path, "rb") as fh:
            size = os.path.getsize(path)
            fh.seek(max(0, size - TAIL))
            lines = fh.read().split(b"\n")
    except (OSError, TypeError):
        return None
    for line in reversed(lines):
        if not any(k in line for k in (b'"task_complete"', b'"turn_aborted"', b'"task_started"')):
            continue
        try:
            p = json.loads(line).get("payload") or {}
        except (ValueError, AttributeError):
            continue
        if p.get("type") == "task_complete" and not p.get("error"):
            said = p.get("last_agent_message")
            return said if isinstance(said, str) and said.strip() else None
        if p.get("type") in ("task_complete", "turn_aborted", "task_started"):
            return None
    return None


def _status(error: Optional[dict]) -> Optional[int]:
    """The HTTP status a turn's error names ({codex_error_info: {<kind>: {http_status_code}}}), if it names one."""
    info = error.get("codex_error_info") if error else None
    for v in info.values() if isinstance(info, dict) else []:
        if isinstance(v, dict) and isinstance(v.get("http_status_code"), int):
            return v["http_status_code"]
    return None


class Rollout(Follower):
    """Codex's rollout of a thread, followed (its notes above): how each turn ended; what it asked in its terminal and
    what that came to; the plan a turn proposed, and what the next turn opened with; the subagents and commands it
    left running, and their ends."""

    def __init__(self, path: Optional[str] = None):
        self.sessions = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(path)))) if path else None
        self.turn: Optional[dict] = None     # the newest turn: {id, mode, plan (its Plan item's text)}
        self.asks: Dict[str, dict] = {}       # an open question's call id -> {name, questions, turn}
        self.replied: Dict[str, dict] = {}    # an async question's call id -> {place: its reply}
        self.offered: Optional[str] = None    # the turn whose proposed plan is asked about, until the next begins
        self.after_plan: Optional[str] = None  # a proposed plan's turn, while the turn after it has not said what was chosen
        self.agents: Dict[str, str] = {}      # a running subagent's thread -> its path
        self.commands: Dict[str, str] = {}    # a command left running, by its process -> its command
        self.calls: Dict[str, str] = {}       # the newest command calls: call id -> their command
        self.reports: Dict[str, dict] = {}    # an ended subagent's thread -> {key, at, path, until}: its report, looked for

    def wanted(self, line: bytes) -> bool:
        if any(k in line for k in WANTED):
            return True
        if b'"exec' in line and (b'"custom_tool_call"' in line or b'"function_call"' in line):
            return True                                            # a command's call: what names one left running
        if b'"function_call_output"' in line:                      # the answer to a question asked in the terminal
            return any(c.encode() in line for c, a in self.asks.items() if a["name"] == ASK)
        return self.after_plan is not None and b'"role":"user"' in line   # what was chosen of a plan

    def take(self, line: bytes, at: str) -> List[Fact]:
        try:
            o = json.loads(line)
        except ValueError:
            return []
        p = o.get("payload") if isinstance(o, dict) else None
        if not isinstance(p, dict):
            return []
        key, when, kind = str(at), seconds(o.get("timestamp")), p.get("type")
        if o.get("type") == "event_msg":
            if kind == "task_started":
                return self._started(p, key, when)
            if kind in ("task_complete", "turn_aborted") and self.turn is not None and p.get("turn_id") in (self.turn["id"], None):
                return self._ended(p, kind, key, when)
            if kind == "item_completed" and isinstance(p.get("item"), dict):
                return self._item(p, p["item"], key, when)
            return []
        if o.get("type") != "response_item":
            return []
        out = []
        if kind in ("function_call", "custom_tool_call") and str(p.get("name") or "").startswith("exec") and p.get("call_id"):
            m = CMD.search(str(p.get("arguments") or p.get("input") or ""))
            self.calls[p["call_id"]] = m.group(1).encode().decode("unicode_escape", "replace") if m else ""
            while len(self.calls) > CALLS_KEPT:
                self.calls.pop(next(iter(self.calls)))
            return out
        if kind in ("function_call_output", "custom_tool_call_output") and p.get("call_id") in self.calls:
            text = json.dumps(p.get("output"), ensure_ascii=False)
            if "exit_code" not in text and "Process exited with code" not in text:
                for i, m in enumerate(RUNS.finditer(text)):
                    if m.group(1) not in self.commands:
                        self.commands[m.group(1)] = self.calls[p["call_id"]]
                        out.append(Fact(Facts.TASK_STARTED, f"{key}.{i}", when, {"task": m.group(1), "kind": "command",
                                                                                  "label": self.calls[p["call_id"]] or None}))
        if kind == "function_call" and p.get("name") in (ASK, ASK_ASYNC) and p.get("call_id"):
            try:
                args = json.loads(p.get("arguments") or "{}")
            except ValueError:
                args = {}
            questions = args.get("questions") if isinstance(args, dict) else None
            questions = questions if isinstance(questions, list) else []
            self.asks[p["call_id"]] = {"name": p["name"], "questions": questions, "turn": self.turn["id"] if self.turn else None}
            out.append(Fact(Facts.ASKED, key, when, {"call": p["call_id"], "kind": "question", "questions": questions,
                                                      "async": p["name"] == ASK_ASYNC, "turn": self.asks[p["call_id"]]["turn"]}))
        elif kind == "function_call_output" and self.asks.get(p.get("call_id"), {}).get("name") == ASK:
            got = p.get("output")
            result = got if isinstance(got, str) else json.dumps(got, ensure_ascii=False)
            del self.asks[p["call_id"]]
            out.append(Fact(Facts.ASK_SETTLED, key, when, {"call": p["call_id"], "how": "dismissed" if result.startswith(ABORTED)
                                                            else "answered", "result": result}))
        elif kind == "message" and p.get("role") == "user":
            text = "\n".join(c.get("text") or "" for c in p.get("content") or [] if isinstance(c, dict)).strip()
            if text.startswith(REPLY):
                out += self._reply(text, key, when)
            elif self.after_plan is not None and text and not text.startswith("<"):   # not codex's own context
                out.append(Fact(Facts.ASK_SETTLED, key, when, {"call": f"plan:{self.after_plan}", "how": "answered", "result": text}))
                self.after_plan = None
        return out

    def due(self, now: float) -> List[Fact]:
        """An ended subagent's report, once its own rollout has it (or given up on after REPORT_SECONDS)."""
        out = []
        for thread, r in list(self.reports.items()):
            said = last_said(record_path(thread, sessions=self.sessions))
            if said is not None:
                out.append(Fact(Facts.TASK_ENDED, r["key"], r["at"], {"task": thread, "kind": "agent", "path": r["path"], "report": said}))
            if said is not None or now > r["until"]:
                del self.reports[thread]
        return out

    def _started(self, p: dict, key: str, when: Optional[float]) -> List[Fact]:
        out = []
        if self.offered is not None:                     # the turn after a proposed plan: the offer is over
            out.append(Fact(Facts.ASK_SETTLED, key, when, {"call": f"plan:{self.offered}", "how": "answered", "result": None}))
            self.after_plan, self.offered = self.offered, None
        self.turn = {"id": p.get("turn_id"), "mode": p.get("collaboration_mode_kind"), "plan": None}
        return out

    def _ended(self, p: dict, kind: str, key: str, when: Optional[float]) -> List[Fact]:
        turn = self.turn["id"]
        error = p.get("error") if isinstance(p.get("error"), dict) else None
        how = "interrupted" if kind == "turn_aborted" else "error" if error else "over"
        out = []
        for call, a in list(self.asks.items()):          # what it asked in the turn: no longer to be answered
            if a["turn"] == turn:
                del self.asks[call]
                out.append(Fact(Facts.ASK_SETTLED, f"{key}.{call}", when, {"call": call, "how": "dismissed", "result": None}))
        out.append(Fact(Facts.TURN_STOPPED, key, when, {"how": how, "turn": turn, "status": _status(error),
                                                         "error": str(error.get("message") or "") or None if error else None,
                                                         **({"reason": p.get("reason")} if kind == "turn_aborted" else {})}))
        if how == "over" and self.turn["plan"] is not None:
            self.offered = turn
            out.append(Fact(Facts.ASKED, f"{key}.plan", when, {"call": f"plan:{turn}", "kind": "plan",
                                                                "plan": self.turn["plan"], "async": False, "turn": turn}))
        return out

    def _item(self, p: dict, item: dict, key: str, when: Optional[float]) -> List[Fact]:
        if item.get("type") == "Plan" and self.turn is not None and p.get("turn_id") == self.turn["id"]:
            self.turn["plan"] = str(item.get("text") or "")
        elif item.get("type") == "CommandExecution" and str(item.get("process_id") or "") in self.commands:
            if item.get("status") != "in_progress":
                process = str(item["process_id"])
                del self.commands[process]
                return [Fact(Facts.TASK_ENDED, key, when, {"task": process, "kind": "command"})]
        elif item.get("type") == "SubAgentActivity" and item.get("agent_thread_id"):
            thread, path = item["agent_thread_id"], item.get("agent_path")
            if item.get("kind") == "started":
                self.agents[thread] = path or self.agents.get(thread)
                return [Fact(Facts.TASK_STARTED, key, when, {"task": thread, "kind": "agent", "label": self.agents[thread]})]
            if item.get("kind") in AGENT_ENDS:
                path = self.agents.pop(thread, None) or path
                said = last_said(record_path(thread, sessions=self.sessions))
                if said is None:
                    self.reports[thread] = {"key": f"{key}.report", "at": when, "path": path, "until": time.time() + REPORT_SECONDS}
                return [Fact(Facts.TASK_ENDED, key, when, {"task": thread, "kind": "agent", "path": path, "report": said})]
        return []

    def _reply(self, text: str, key: str, when: Optional[float]) -> List[Fact]:
        """An async question's reply: [{answer, question, questionItemId: '["request_user_input_async", call, place]'}]
        -- settled once every question it asked has its reply."""
        out = []
        for i, one in enumerate(replied(text) or []):
            try:
                _, call, place = json.loads(one.get("questionItemId") or "")
            except (ValueError, TypeError, AttributeError):
                continue
            got = self.replied.setdefault(call, {})
            got[place] = json.dumps(one, ensure_ascii=False, separators=(",", ":"))
            ask = self.asks.get(call)
            if ask is not None and len(got) >= len(ask["questions"]):
                del self.asks[call]
                out.append(Fact(Facts.ASK_SETTLED, f"{key}.{i}", when, {"call": call, "how": "answered",
                                                                         "result": "\n".join(got[k] for k in sorted(got))}))
        return out
