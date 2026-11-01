"""Antigravity's CLI (`agy`), as harness_kit reads it (1.4.12): its model calls on the Gemini API route, the
contents of its history, its own context among them, its tools, what it asks the user and how its dialog is
answered, its background tasks and subagents, and its record of each conversation.

`agy` calls the Gemini API itself when `settings.json` sets `modelProvider: "gemini"` and GEMINI_API_KEY is set
(its 1.1.13 changelog); GOOGLE_GEMINI_BASE_URL moves the endpoint. Signed in with Google instead, it calls
Google's internal Cloud Code API, which none of this reads.

    calls        a POST to .../models/<model>:streamGenerateContent (or :generateContent) whose body holds
                 `contents`. Nothing in its headers says what a call is for, or names a session (its
                 User-Agent is the Go genai SDK's), so its system instruction does: its <user_information>
                 names the conversation (`Conversation ID:`) and the working directory (`Command Working
                 Directory:`). Of those calls:
        title        its system instruction TITLE_PROMPT: a title for a conversation, on a lighter model,
                     naming no conversation
        subagent     its system instruction holds a <subagent_reminder>, naming the caller (SUBAGENT): a
                     subagent's own conversation, run alongside its caller's (`invoke_subagent` returns at
                     once); read as its caller's session, the subagent's own id in `detail["agent"]`
        compaction   its last content COMPACTION_PROMPT: agy compacting the conversation (/compact, or its own
                     near the model's limit), the summary asked for; after it the history is that summary,
                     as a <CONTEXT_SUMMARY>, then what came since
        turn         any other naming its conversation
    items        each part of each content, as a content of its own -- `{"role", "parts": [part]}` -- as
                 agy itself sends them back, one part to a content
    kinds        by the part: a function call or response a tool's call or result (agy sends a response in
                 the model's role); text the model's (its words, or its reasoning when `thought`); text in
                 the user's role the user's words when it holds USER_REQUEST (a command typed, "/compact",
                 USER_COMMAND); its compacted history's summary (<CONTEXT_SUMMARY>); its own when it is a
                 SYSTEM_MESSAGE -- a background task's end (TASK_NOTICE) and a subagent's message
                 (AGENT_REPORT) among them, as their sender says
    asks         `ask_question({"questions": [{question, options: [label], is_multi_select}]})`: its dialog
                 shows each question in turn, the options numbered, then its own "Write-in..."; the result
                 says each answer on a line, "A<n>: <the labels picked, ", "-joined>" (or the words written,
                 or "User Skipped": Esc), and the turn goes on either way
    tasks        `run_command` gone on in the background ("Tool is running as a background task with task id:
                 <id>"), ended by its notice ('Task id "<id>" finished with result:'); `invoke_subagent`'s
                 subagent ("Created the following subagent: {conversationId, logAbsoluteUri}"), its messages
                 to its caller (`send_message`) the caller's notices
    record       `conversations/<id>.db` in its data folder (~/.gemini/antigravity-cli): SQLite, a row per step
                 (`steps`: idx, step_type, status, step_payload, protobuf), whose status changes in place --
                 read whole (Record). What only it says: a turn it gave up on an error (an ERROR_MESSAGE step,
                 written as the error shows), a step interrupted; and the name the conversation was given
                 (`/rename`, in `annotations/<id>.pbtxt`). Esc, and messages queued while a turn runs, it
                 does not keep: the hook server sees the former (the call hung up on), and agy sends a stopped
                 turn's message again with the next (it is not taken back)
"""

import json
import os
import re
import shutil
import sqlite3
import subprocess
import zlib
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote

from .base import (Action, AnswerError, Box, Call, CallKind, Fact, Facts, Follower, Harness, Kind, Part, RenameError,
                   Shape, ToolCall, ToolResult, ask_arg, other_view, output_of, picked, rule, typed_in)

MODEL_CALL = re.compile(r"/models/([^/:]+):(?:stream)?[gG]enerateContent$")
CONVERSATION = re.compile(r"^Conversation ID:\s*([0-9a-fA-F-]{36})\s*$", re.M)
CWD = re.compile(r"^Command Working Directory:\s*(.+?)\s*$", re.M)
TITLE_PROMPT = "You are a conversation title generator."
#: A subagent's system instruction: who called it.
SUBAGENT = re.compile(r'<subagent_reminder>\s*You are running as a subagent, invoked by a caller agent '
                      r'\(name: "[^"]*", id: "([0-9a-fA-F-]{36})"\)')
#: What a compaction call asks, last: "...have not yet completed\nit. Write a continuation summary ..."
COMPACTION_PROMPT = "You have been working on the task described above but have not yet completed"
#: The summary a compacted history opens with.
CONTEXT_SUMMARY = "<CONTEXT_SUMMARY>"
#: The user's words, as agy wraps them: a <USER_REQUEST>, then its own notes (<ADDITIONAL_METADATA>, the time;
#: <USER_SETTINGS_CHANGE>, a model switched) in the same text.
USER_REQUEST = re.compile(r"<USER_REQUEST>\n?([\s\S]*?)\n?</USER_REQUEST>")
#: A command the user typed, as agy sends it on ("/compact").
TYPED_COMMAND = re.compile(r"^/[A-Za-z][\w:-]*(?:\s|$)")
#: Its own messages in the user's role: "The following is a <SYSTEM_MESSAGE> not actually sent by the user. ..."
SYSTEM_MESSAGE = "<SYSTEM_MESSAGE>"
#: A message among them, from another agent or a task: its sender and what it says.
MESSAGE = re.compile(r"\[Message\] timestamp=(\S*) sender=(\S+) priority=\S+ content=([\s\S]*?)\s*</SYSTEM_MESSAGE>")
TASK_SENDER = re.compile(r"^[0-9a-fA-F-]{36}/task-\d+$")
TASK_FINISHED = re.compile(r'^Task id "([^"]+)" finished with result:\s*([\s\S]*)')
EXITED = re.compile(r"Command exited with code (-?\d+)")
#: A command gone on in the background, as run_command's result says.
BACKGROUND = re.compile(r"Tool is running as a background task with task id: (\S+)"
                        r"(?:\s*\nTask Description: ([^\n]*))?(?:\s*\nTask logs are available at: file://(\S+))?")
#: A subagent started, as invoke_subagent's result says.
SUBAGENT_MADE = re.compile(r'Created the following subagent:\s*\{[^}]*?"conversationId":\s*"([0-9a-fA-F-]{36})"'
                           r'(?:[^}]*?"logAbsoluteUri":\s*"file://([^"]+)")?')
#: Its tools (1.4.12's twelve): each one's action, and the input key that names the file it works on.
TOOLS = {"read_file": (Action.READ, "Path"), "write_file": (Action.EDIT, "Path"), "edit_file": (Action.EDIT, "Path"),
         "run_command": (Action.SHELL, None), "search_web": (Action.WEB, None),
         "invoke_subagent": (Action.DELEGATE, None), "define_subagent": (Action.DELEGATE, None),
         "manage_subagents": (Action.DELEGATE, None), "send_message": (Action.DELEGATE, None),
         "manage_task": (Action.TASK, None), "schedule": (Action.TASK, None), "ask_question": (Action.ASK, None)}
ASK = "ask_question"
#: `command`'s permission modes, as Claude Code names them, in agy's options.
PERMISSIONS = {"auto": ["--mode", "auto"], "acceptEdits": ["--mode", "accept-edits"], "plan": ["--mode", "plan"],
               "bypassPermissions": ["--dangerously-skip-permissions"]}
#: Its Gemini API route, set for a session (`--settings`).
PROVIDER = {"modelProvider": "gemini"}
#: An option ag's launcher takes for agy and agy does not (`instruction_args`): what to add to its instructions, for
#: the run -- its hook adds it to the system instruction of each of the run's calls.
APPEND = "--append-system-prompt"
#: Its question dialog's keys.
DOWN, NEXT, ENTER, TOGGLE = "\x1b[B", "\x1b[C", "\r", " "
#: Its steps' types and statuses, as its protobuf enums number them (CortexStepType, CortexStepStatus).
STEP_ERROR = 17                                  # ERROR_MESSAGE
STATUS_INTERRUPTED = 12
STILL = frozenset({0, 1, 2, 8, 9, 11})           # unspecified, pending, running, generating, waiting, queued


def data_dir(env: Optional[Dict[str, str]] = None) -> str:
    """agy's data folder: ~/.gemini/antigravity-cli, of `env`'s HOME (else this process's)."""
    home = (env or {}).get("HOME") or os.path.expanduser("~")
    return os.path.join(home, ".gemini", "antigravity-cli")


def is_model_call(method: str, path: str, body) -> bool:
    """A POST to a model's generateContent (streamed or not) with `contents`."""
    return (method or "").upper() == "POST" and bool(MODEL_CALL.search((path or "").split("?", 1)[0])) \
        and isinstance(body, dict) and isinstance(body.get("contents"), list)


def system_text(body) -> str:
    """The text of a call's system instruction ("" when it has none)."""
    si = body.get("systemInstruction") if isinstance(body, dict) else None
    parts = si.get("parts") if isinstance(si, dict) else None
    return "".join(p.get("text") or "" for p in parts if isinstance(p, dict)) if isinstance(parts, list) else ""


def part_of(item) -> dict:
    """An item's one part ({} when it is not an item)."""
    parts = item.get("parts") if isinstance(item, dict) else None
    return parts[0] if isinstance(parts, list) and parts and isinstance(parts[0], dict) else {}


def text_of(item) -> Optional[str]:
    """What the model reads of an item: a text's words, a function call as name(arguments), a function response's
    output (or error); None for anything else (inline data, a bare signature)."""
    p = part_of(item)
    if isinstance(p.get("text"), str):
        return p["text"]
    if isinstance(p.get("functionCall"), dict):
        c = p["functionCall"]
        return f"{c.get('name')}({json.dumps(c.get('args') or {}, ensure_ascii=False)})"
    if isinstance(p.get("functionResponse"), dict):
        r = p["functionResponse"].get("response")
        return output_of(r.get("error", r.get("output", r)) if isinstance(r, dict) else r)
    return None


def compaction_at(contents: list) -> bool:
    """Whether the contents end with agy's request for a summary of them: a compaction call's."""
    last = contents[-1] if contents else None
    return isinstance(last, dict) and last.get("role") == "user" \
        and str(part_of(last).get("text") or "").startswith(COMPACTION_PROMPT)


def message_of(text: str) -> Optional[Tuple[str, str]]:
    """(its sender, what it says) of one of agy's system messages that is a message, from an agent or a task."""
    m = MESSAGE.search(text or "")
    return (m.group(2), m.group(3)) if m else None


def report_of(text: str) -> Optional[dict]:
    """What one of agy's messages from another agent (a subagent's, to its caller) says, as Chat shows it: {kind:
    AGENT_REPORT, from (its conversation), text}; None for any other text -- a task's notice among them."""
    if SYSTEM_MESSAGE not in (text or "")[:200]:
        return None
    said = message_of(text)
    if said is None or TASK_SENDER.match(said[0]):
        return None
    return {"kind": Kind.AGENT_REPORT, "from": said[0], "text": said[1].strip()}


def words_of(text: str) -> tuple:
    """(the Kind, the user's words as typed) of a text in the user's role."""
    t = text or ""
    if t.lstrip().startswith(CONTEXT_SUMMARY):
        return Kind.COMPACTION_SUMMARY, t
    if t.startswith(COMPACTION_PROMPT):
        return Kind.OTHER, t                                  # a compaction call's own request
    if SYSTEM_MESSAGE in t[:200]:
        said = message_of(t)
        if said is None:
            return Kind.ENVIRONMENT, t
        return (Kind.TASK_NOTICE if TASK_SENDER.match(said[0]) else Kind.AGENT_REPORT), t
    m = USER_REQUEST.search(t)
    if m is None:
        return Kind.USER, t
    words = m.group(1)
    return (Kind.USER_COMMAND if TYPED_COMMAND.match(words.strip()) else Kind.USER), words


def notice_of(text: str) -> Dict[str, object]:
    """What one of agy's messages from a task or an agent says (Part.detail): a task's end (`notices`), an agent's
    words (`from`, `text`)."""
    said = message_of(text)
    if said is None:
        return {}
    sender, content = said
    if not TASK_SENDER.match(sender):
        return {"from": sender, "text": content}
    done = TASK_FINISHED.match(content)
    if done is None:
        return {"notices": [{"id": sender, "status": None, "event": " ".join(content.split())[:200] or None,
                             "ended": False, "waiting": False}]}
    code = EXITED.search(done.group(2))
    status = "completed" if code is None or code.group(1) == "0" else "failed"
    return {"notices": [{"id": done.group(1), "status": status, "event": None, "ended": True, "waiting": False}]}


def questions_of(raw) -> List[dict]:
    """ask_question's questions, as harness_kit has a question asked ({id, header, question, multiSelect, options:
    [{label, description}]}): agy gives each one's options as labels. agy's record keeps them as a JSON string."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = []
    out = []
    for q in raw if isinstance(raw, list) else []:
        if not isinstance(q, dict):
            continue
        out.append({"id": None, "header": "", "question": str(q.get("question") or ""),
                    "multiSelect": bool(q.get("is_multi_select")),
                    "options": [{"label": str(o), "description": ""} for o in q.get("options") or []]})
    return out


def task_of(name: str, output: str) -> Optional[dict]:
    """The background task a tool's result says started ({id, kind, how, output, label}), None if it says none."""
    if name == "run_command":
        m = BACKGROUND.search(output or "")
        if m:
            return {"id": m.group(1), "kind": "command", "how": "started", "output": m.group(3),
                    "label": (m.group(2) or "").strip() or None}
    elif name == "invoke_subagent":
        m = SUBAGENT_MADE.search(output or "")
        if m:
            return {"id": m.group(1), "kind": "agent", "how": "started", "output": m.group(2), "label": None}
    return None


#: Its header on each tool's output (when it was made, when it finished), and a command's line saying how it exited
#: before what it printed.
OUTPUT_HEAD = re.compile(r"^Created At: [^\n]*\n(?:Completed At: [^\n]*\n)?")
EXIT_LINE = re.compile(r"(^|\n)Command exited with code (-?\d+)\.\n\n?(?:Command output:\n)?")


def view_of(name: str, args: dict, ask: Optional[dict] = None) -> dict:
    """How a call of agy's tool `name` is shown (Shape's views): its file tools as Claude Code's, its subagents by role."""
    s = lambda k: args[k] if isinstance(args.get(k), str) else None         # noqa: E731
    if name == "read_file":
        return {"shape": Shape.READ, "title": "Read", "path": s("Path"), "offset": args.get("StartLine")}
    if name == "write_file":
        return {"shape": Shape.WRITE, "title": "Write", "path": s("Path"), "content": str(args.get("Content") or "")}
    if name == "edit_file":
        return {"shape": Shape.EDIT, "title": "Update", "path": s("Path"),
                "edits": [{"old": str(args.get("Target") or ""), "new": str(args.get("Replacement") or "")}]}
    if name == "run_command":
        return {"shape": Shape.SHELL, "title": "Bash", "command": s("CommandLine") or "", "cwd": s("Cwd"),
                "description": s("toolSummary")}
    if name == "search_web":
        return {"shape": Shape.WEB, "title": "Web Search", "query": s("query")}
    if name == "invoke_subagent":
        return {"shape": Shape.AGENT, "title": s("Role") or "Agent", "name": s("Role"), "arg": s("Prompt")}
    if name == ASK:
        return {"shape": Shape.ASK, "title": "Question", "arg": ask_arg(ask)}
    if name == "send_message":
        return other_view(name, "Message", s("Message"))
    if name == "manage_task":
        return other_view(name, "Task", " ".join(x for x in (s("Action"), s("TaskId")) if x))
    if name == "manage_subagents":
        return other_view(name, "Subagents", s("Action"))
    if name == "define_subagent":
        return other_view(name, "Define Agent", s("Name"))
    if name == "schedule":
        return other_view(name, "Schedule", s("Prompt"))
    return other_view(name)


def label_of(call: Optional[ToolCall]) -> Optional[str]:
    """What a call that started a background task said it was for: a subagent's role and prompt, a command's line."""
    given = call.input if call is not None and isinstance(call.input, dict) else {}
    for k in ("Role", "toolSummary", "CommandLine", "Prompt"):
        if isinstance(given.get(k), str) and given[k].strip():
            return " ".join(given[k].split())[:160]
    return call.name if call is not None else None


def answer_start(items: list) -> int:
    """Where the new pieces of a call's history begin: the model's last answer (its words, reasoning and calls), its
    calls' results after it (agy sends them in the model's role) and the notes after those."""
    i = len(items)
    while i > 0 and (isinstance(part_of(items[i - 1]).get("functionResponse"), dict)
                     or (items[i - 1] or {}).get("role") != "model"):
        i -= 1
    while i > 0 and (items[i - 1] or {}).get("role") == "model" \
            and not isinstance(part_of(items[i - 1]).get("functionResponse"), dict):
        i -= 1
    return i


def with_instructions(body: dict, told: str) -> dict:
    """A call's body with `told` after its system instruction (`instruction_args`)."""
    si = body.get("systemInstruction") if isinstance(body.get("systemInstruction"), dict) else {}
    parts = [p for p in si.get("parts") or [] if isinstance(p, dict)]
    return dict(body, systemInstruction=dict(si, parts=parts + [{"text": "\n\n" + told}]))


def _varint(b: bytes, i: int) -> Tuple[int, int]:
    n = shift = 0
    while True:
        x = b[i]
        n |= (x & 0x7f) << shift
        i += 1
        shift += 7
        if not x & 0x80:
            return n, i


def fields(blob) -> Dict[int, list]:
    """A protobuf message's fields: {number: [value, ...]}, a varint an int, a length-delimited one its bytes."""
    out: Dict[int, list] = {}
    b, i = bytes(blob or b""), 0
    try:
        while i < len(b):
            key, i = _varint(b, i)
            wire = key & 7
            if wire == 0:
                value, i = _varint(b, i)
            elif wire == 2:
                n, i = _varint(b, i)
                value, i = b[i:i + n], i + n
            elif wire in (1, 5):
                n = 8 if wire == 1 else 4
                value, i = b[i:i + n], i + n
            else:
                break
            out.setdefault(key >> 3, []).append(value)
    except IndexError:
        pass
    return out


def field(blob, *path):
    """The first value at `path` (field numbers, each into the message before), None where there is none."""
    value = blob
    for n in path:
        got = fields(value).get(n) if isinstance(value, (bytes, bytearray)) else None
        if not got:
            return None
        value = got[0]
    return value


def step_at(payload) -> Optional[float]:
    """When a step was made, as its payload says (its metadata's timestamp)."""
    secs, nanos = field(payload, 5, 1, 1), field(payload, 5, 1, 2)
    return secs + (nanos or 0) / 1e9 if isinstance(secs, int) else None


def error_of(payload) -> Tuple[Optional[str], Optional[int]]:
    """(why, the HTTP status) of an ERROR_MESSAGE step, as its payload says."""
    text = field(payload, 24, 3, 2) or field(payload, 24, 3, 1)
    status = field(payload, 24, 3, 7)
    why = text.decode("utf-8", "replace").split(", Details:")[0].strip() if isinstance(text, bytes) else None
    return why or None, status if isinstance(status, int) else None


TITLE = re.compile(r'^title:\s*"((?:[^"\\]|\\.)*)"', re.M)


def _written(path: str) -> Optional[float]:
    """When the file at `path` was last written, None when it is not there."""
    try:
        return os.stat(path).st_mtime
    except OSError:
        return None


def annotations_path(record: str) -> str:
    """The file agy keeps a conversation's name in, beside its record: annotations/<id>.pbtxt."""
    base = os.path.dirname(os.path.dirname(record))
    return os.path.join(base, "annotations", os.path.basename(record)[:-len(".db")] + ".pbtxt")


def title_in(path: str) -> Optional[str]:
    """The conversation's name in its annotations file, None when it has none."""
    try:
        with open(path, encoding="utf-8") as fh:
            m = TITLE.search(fh.read())
    except OSError:
        return None
    if m is None:
        return None
    return re.sub(r"\\(.)", r"\1", m.group(1)).strip() or None


class Record(Follower):
    """agy's record of a conversation (module doc), read whole each time it changes: an ERROR_MESSAGE step a turn
    stopped on an error (`turn_stopped`), a step interrupted; and its name (`name`), from its annotations file. The
    offset is the first step not settled yet (its status may still change)."""
    database = True

    def __init__(self, path: str):
        self.path = path
        self.names = annotations_path(path)
        self.told: set = set()                       # the keys of the facts given: a step re-read gives none again

    def stamp(self, path: str) -> Optional[Tuple[int, int, int]]:
        """Its database, its write-ahead log (where agy's writes go first) and its annotations file, as one."""
        try:
            main = os.stat(path)
        except OSError:
            return None
        size, mtime = main.st_size, main.st_mtime_ns
        for other in (path + "-wal", self.names):
            try:
                st = os.stat(other)
            except OSError:
                continue
            size, mtime = size + st.st_size, max(mtime, st.st_mtime_ns)
        return main.st_ino, size, mtime

    def anew(self, now, seen, offset: int) -> bool:
        return now[0] != seen[0]

    def read_on(self, path: str, offset: int) -> Tuple[List[Fact], int]:
        facts: List[Fact] = []
        try:
            conn = sqlite3.connect(f"file:{quote(path)}?mode=ro", uri=True, timeout=1.0)
            try:
                rows = conn.execute("SELECT idx, step_type, status, step_payload FROM steps WHERE idx >= ? "
                                    "ORDER BY idx", (offset,)).fetchall()
            finally:
                conn.close()
        except sqlite3.Error:
            rows = []
        settled = True
        for idx, kind, status, payload in rows:
            if kind == STEP_ERROR:
                why, code = error_of(payload)
                facts.append(Fact(Facts.TURN_STOPPED, f"step{idx}", step_at(payload) or _written(path),
                                  {"how": "error", "error": why, "status": code, "turn": None}))
            elif status == STATUS_INTERRUPTED:
                facts.append(Fact(Facts.TURN_STOPPED, f"step{idx}.interrupted", step_at(payload) or _written(path),
                                  {"how": "interrupted", "error": None, "status": None, "turn": None}))
            if settled and status not in STILL:
                offset = idx + 1
            else:
                settled = False
        title = title_in(self.names)
        if title is not None:
            facts.append(Fact(Facts.NAMED, f"title.{zlib.crc32(title.encode()):08x}", _written(self.names),
                              {"text": title, "by": "antigravity"}))
        new = [f for f in facts if f.key not in self.told]
        self.told.update(f.key for f in new)
        return new, offset


class Antigravity(Harness):
    name = "antigravity"
    label = "Antigravity"
    checked_with = "1.4.12"
    picks_session_id = True          # its conversation's id, which it picks

    def call(self, method: str, path: str, headers, body) -> Optional[Call]:
        """The request as a model call (module doc), None if it is not one; `detail["model"]`, the model its path
        names; a subagent's, `detail["agent"]`, its own conversation (its session is its caller's)."""
        if not is_model_call(method, path, body):
            return None
        system = system_text(body)
        session, cwd = CONVERSATION.search(system), CWD.search(system)
        model = MODEL_CALL.search(path.split("?", 1)[0]).group(1)
        detail = {"model": model}
        contents, own = body["contents"], []
        caller = SUBAGENT.search(system)
        if system.lstrip().startswith(TITLE_PROMPT):
            kind = CallKind.TITLE
        elif not session:
            kind = CallKind.OTHER
        elif caller is not None:
            kind, detail["agent"] = CallKind.SUBAGENT, session.group(1)
        elif compaction_at(contents):
            kind, contents, own = CallKind.COMPACTION, contents[:-1], contents[-1:]
        else:
            kind = CallKind.TURN
        owner = caller.group(1) if caller is not None else session.group(1) if session else None
        return Call(kind, owner, cwd.group(1) if cwd else None, None, history=contents, own=own, detail=detail)

    def items(self, history: list) -> list:
        """Each part of each content as a content of its own, its role kept."""
        out = []
        for c in history or []:
            parts = c.get("parts") if isinstance(c, dict) else None
            if not isinstance(parts, list) or len(parts) <= 1:
                out.append(c)
            else:
                out += [{**c, "parts": [p]} for p in parts]
        return out

    def words(self, text: str) -> tuple:
        return words_of(text)

    def read(self, items: list) -> List[Part]:
        return [self.part(it) for it in items]

    def part(self, item) -> Part:
        """One item read on its own."""
        role = item.get("role") if isinstance(item, dict) else None
        p, text = part_of(item), text_of(item)
        if isinstance(p.get("functionCall"), dict):
            c = p["functionCall"]
            name, args = c.get("name") or "", c.get("args") if isinstance(c.get("args"), dict) else {}
            action, key = TOOLS.get(name, (Action.OTHER, None))
            path = args.get(key) if key else None
            ask = {"kind": "question", "questions": questions_of(args.get("questions"))} if name == ASK else None
            return Part(Kind.TOOL_CALL, role, text, tool=ToolCall(c.get("id"), name, args, action,
                                                                  [path] if isinstance(path, str) else [], ask,
                                                                  view=view_of(name, args, ask)))
        if isinstance(p.get("functionResponse"), dict):
            r = p["functionResponse"]
            error = isinstance(r.get("response"), dict) and "error" in r["response"]
            result = ToolResult(r.get("id"), error, text or "", task_of(r.get("name") or "", text or ""))
            shown, result.exit, result.took = self.tool_output(result.output)
            result.shown = shown if shown != result.output else None
            return Part(Kind.TOOL_RESULT, role, text, result=result)
        if text is None:
            return Part(Kind.OTHER, role, None)
        if role == "model":
            return Part(Kind.REASONING if p.get("thought") else Kind.AGENT, role, text)
        kind, words = words_of(text)
        detail = notice_of(text) if kind in (Kind.TASK_NOTICE, Kind.AGENT_REPORT) else {}
        return Part(kind, role, text, words if kind in (Kind.USER, Kind.USER_COMMAND) else None, detail=detail)

    def derived(self, parts: List[Part], at: float, history: Optional[list] = None) -> List[Fact]:
        """What an answer asks the user (ask_question), and what a call's new pieces say: an asking call's result (its
        answers: agy goes on either way, skipped or not), a background task its tool's result started (a command, a
        subagent), a task's end (its notice), a subagent's message to its caller (a sign it lives). Keyed by the
        call's or the task's id, a notice by its words."""
        calls = {p.tool.id: p.tool for p in parts if p.tool is not None and p.tool.id}
        for it in self.items(history or []):                  # an asking call made by an answer before these pieces
            c = part_of(it).get("functionCall")
            if isinstance(c, dict) and c.get("id") and c["id"] not in calls:
                calls[c["id"]] = self.part(it).tool
        out: List[Fact] = []
        for p in parts:
            t, r = p.tool, p.result
            if t is not None and t.ask and t.id:
                out.append(Fact(Facts.ASKED, t.id, at, {"call": t.id, **t.ask, "async": False, "turn": None}))
            if r is not None and r.call_id:
                asking = calls.get(r.call_id)
                if asking is not None and asking.ask:
                    out.append(Fact(Facts.ASK_SETTLED, r.call_id, at, {"call": r.call_id, "how": "answered",
                                                                       "result": r.output}))
                if r.task and r.task.get("id"):
                    task = r.task
                    out.append(Fact(Facts.TASK_STARTED, f"{task['id']}.{r.call_id}", at,
                                    {"task": task["id"], "kind": task.get("kind"), "how": task.get("how"),
                                     "label": task.get("label") or label_of(calls.get(r.call_id)),
                                     "output": task.get("output")}))
            for n in p.detail.get("notices") or []:
                if not n.get("id"):
                    continue
                key = f"{n['id']}.{zlib.crc32(json.dumps(n, sort_keys=True).encode()):08x}"
                if n.get("ended"):
                    out.append(Fact(Facts.TASK_ENDED, key, at, {"task": n["id"], "kind": None, "status": n.get("status")}))
                else:
                    out.append(Fact(Facts.TASK_ACTIVITY, key, at, {"task": n["id"], "event": n.get("event")}))
            if p.kind == Kind.AGENT_REPORT and p.detail.get("from"):
                key = f"{p.detail['from']}.{zlib.crc32((p.text or '').encode()):08x}"
                out.append(Fact(Facts.TASK_ACTIVITY, key, at, {"task": p.detail["from"], "event": "sent a message"}))
        return out

    # ---- its name, its terminal, its options

    def rename_command(self, name: str) -> Optional[str]:
        """`/rename <name>`: agy takes the name on the same line."""
        name = " ".join(str(name or "").split())
        return f"/rename {name}" if name else None

    def rename(self, session: str, name: str, record: Optional[str] = None, env: Optional[Dict[str, str]] = None,
               cwd: Optional[str] = None) -> str:
        """The name written where agy keeps it (`annotations/<id>.pbtxt`, `title:"..."`), its other lines kept."""
        base = data_dir(env)
        if not os.path.exists(os.path.join(base, "conversations", f"{session}.db")):
            raise RenameError("agy has no such conversation")
        name = " ".join(str(name or "").split())
        if not name:
            raise RenameError("no name given")
        path = os.path.join(base, "annotations", f"{session}.pbtxt")
        try:
            with open(path, encoding="utf-8") as fh:
                kept = [line for line in fh.read().splitlines() if not TITLE.match(line)]
        except OSError:
            kept = []
        escaped = name.replace("\\", "\\\\").replace('"', '\\"')
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path + ".tmp", "w", encoding="utf-8") as fh:
                fh.write("\n".join([f'title:"{escaped}"', *kept]) + "\n")
            os.replace(path + ".tmp", path)
        except OSError as exc:
            raise RenameError(f"could not write agy's name for it: {exc}") from exc
        return "named in agy's annotations"

    def command(self, session: str, resume: bool = False, model: Optional[str] = None,
                permission_mode: Optional[str] = None, fullscreen: bool = True,
                instructions: Optional[str] = None) -> List[str]:
        """Its own options: `--model`, the permission mode (PERMISSIONS), the run's instructions (`instruction_args`),
        and `--conversation <id>` to resume. It takes no id for a new conversation: the id is known from its first
        call."""
        return [*(["--model", model] if model else []), *PERMISSIONS.get(permission_mode or "", []),
                *(self.instruction_args(instructions) if instructions else []),
                *(["--conversation", session] if resume else [])]

    def tool_output(self, text: str) -> Tuple[str, Optional[str], Optional[str]]:
        """Its header on each tool's output (OUTPUT_HEAD), and a command's exit line in it (EXIT_LINE), taken off."""
        m = OUTPUT_HEAD.match(text or "")
        if not m:
            return text, None, None
        text, code = text[m.end():], None
        e = EXIT_LINE.search(text)
        if e:
            code, text = e.group(2), text[:e.start()] + e.group(1) + text[e.end():]
        return text, code, None

    def spawned(self, call: ToolCall, output: str) -> Optional[dict]:
        """An invoke_subagent call's subagent, by the conversation its result names, shown by the role it was given; its
        messages come with later calls."""
        made = task_of(call.name, output) if call.name == "invoke_subagent" else None
        role = call.input.get("Role") if isinstance(call.input, dict) else None
        return {"id": made["id"], "name": str(role or ""), "later": True} if made else None

    def first_prompt(self, text: str) -> List[str]:
        """`--prompt-interactive=<text>`: agy takes no prompt after `--`. The `=` keeps a message starting with `-` its value."""
        return [f"--prompt-interactive={text}"]

    def instruction_args(self, text: str) -> List[str]:
        """agy has no option that adds to its instructions; ag's launcher takes APPEND for it (not passed on), and its
        hook adds the text after the system instruction of each of the run's calls."""
        return [APPEND, text]

    def models(self, env: Optional[Dict[str, str]] = None) -> dict:
        """The models it lists (`agy models`, on its Gemini API route: GEMINI_API_KEY in `env`); none without a key."""
        env = dict(env or os.environ)
        agy = shutil.which("agy", path=env.get("PATH"))
        if not env.get("GEMINI_API_KEY") or agy is None:
            return {"models": [], "default": None}
        try:
            done = subprocess.run([agy, "--settings", json.dumps(PROVIDER), "models"], env=env, capture_output=True,
                                  text=True, timeout=30, stdin=subprocess.DEVNULL)
        except (OSError, subprocess.SubprocessError):
            return {"models": [], "default": None}
        found = []
        for line in done.stdout.splitlines():
            slug, _, title = line.partition("\t")
            if title.strip() and slug.strip() and " " not in slug.strip():
                found.append({"slug": slug.strip(), "name": title.strip(), "description": ""})
        return {"models": found, "default": None}

    def box(self, screen) -> Optional[str]:
        """Its message box: a prompt row (">") and the rows of what is typed, between two full-width rules, the cursor
        shown in it while it has the keys. A dialog (a question, a permission it asks, its folder-trust prompt) takes
        the box's place and hides the cursor."""
        if not screen.cursor_shown:
            return Box.AWAY
        lines = screen.lines()
        top = next((r for r in range(screen.y - 1, -1, -1) if rule(lines[r])), None)
        bottom = next((r for r in range(screen.y + 1, len(lines)) if rule(lines[r])), None)
        if top is None or bottom is None or rule(lines[screen.y]):
            return Box.AWAY
        if not lines[top + 1].startswith(">"):
            return Box.AWAY
        return Box.HOLDS if typed_in(screen, top + 1, bottom - 1, 1).strip() else Box.EMPTY

    def answer_keys(self, ask: dict, choice: dict) -> List[str]:
        """Its question dialog, a question at a time, each starting on its first option: an option picked by moving
        down to it and Enter (which goes on to the next question, or sends them all); several, each toggled with
        Space, then "→" to the next question (Enter on the last sends them all); the reader's own words, its
        "Write-in..." (after the options) opened with Enter, typed and Enter."""
        if ask.get("kind") != "question":
            raise AnswerError("agy asks only questions")
        out: List[str] = []
        chosen = picked(ask, choice)
        for i, p in enumerate(chosen):
            last = i == len(chosen) - 1
            if p["text"] is not None:
                out += [DOWN] * p["count"] + [ENTER, p["text"].strip(), ENTER]
            elif p["multi"]:
                at = 0
                for k in p["places"]:
                    out += [DOWN] * (k - at) + [TOGGLE]
                    at = k
                out.append(ENTER if last else NEXT)
            else:
                out += [DOWN] * p["places"][0] + [ENTER]
        return out

    def answer_expected(self, ask: dict, choice: dict) -> List[str]:
        """In its result: "A<n>: " and the answer, each question's."""
        return [f"A{i + 1}: {p['text'].strip() if p['text'] is not None else ', '.join(p['labels'])}"
                for i, p in enumerate(picked(ask, choice))]

    # ---- its record of a conversation

    def record_path(self, session: str, cwd: Optional[str] = None, config: Optional[str] = None) -> Optional[str]:
        path = os.path.join(config or data_dir(), "conversations", f"{session}.db")
        return path if os.path.exists(path) else None

    def follower(self, path: str) -> Follower:
        return Record(path)
