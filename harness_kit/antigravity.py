"""Antigravity's CLI (`agy`), as harness_kit reads it (1.4.12): its model calls on the Gemini API route, the
contents of its history, its own context among them, and its tools.

`agy` calls the Gemini API itself when `settings.json` sets `modelProvider: "gemini"` and GEMINI_API_KEY is set
(its 1.1.13 changelog); GOOGLE_GEMINI_BASE_URL moves the endpoint. Signed in with Google instead, it calls
Google's internal Cloud Code API, which none of this reads.

    calls        a POST to .../models/<model>:streamGenerateContent (or :generateContent) whose body holds
                 `contents`. Nothing in its headers says what a call is for, or names a session (its
                 User-Agent is the Go genai SDK's), so its system instruction does: its <user_information>
                 names the conversation (`Conversation ID:`) and the working directory (`Command Working
                 Directory:`); a call whose system instruction is TITLE_PROMPT is its side call for a
                 conversation's title, on a lighter model, naming no conversation
    items        each part of each content, as a content of its own -- `{"role", "parts": [part]}` -- as
                 agy itself sends them back, one part to a content
    kinds        by the part: a function call or response a tool's call or result (agy sends a response in
                 the model's role); text the model's (its words, or its reasoning when `thought`); text in
                 the user's role the user's words when it holds USER_REQUEST, agy's own when it is a
                 SYSTEM_MESSAGE, else the user's

Not read yet (no capture of them): what it sends after compacting, a subagent's calls (each its own
conversation, read as one), the shape of `ask_question`'s questions, and its record of a conversation
(`conversations/<id>.db`, SQLite, in its app data folder: ~/.gemini/antigravity-cli).
"""

import json
import re
from typing import List, Optional

from .base import Action, Call, CallKind, Harness, Kind, Part, ToolCall, ToolResult, output_of

MODEL_CALL = re.compile(r"/models/([^/:]+):(?:stream)?[gG]enerateContent$")
CONVERSATION = re.compile(r"^Conversation ID:\s*([0-9a-fA-F-]{36})\s*$", re.M)
CWD = re.compile(r"^Command Working Directory:\s*(.+?)\s*$", re.M)
TITLE_PROMPT = "You are a conversation title generator."
#: The user's words, as agy wraps them: a <USER_REQUEST>, then its own notes (<ADDITIONAL_METADATA>, the time;
#: <USER_SETTINGS_CHANGE>, a model switched) in the same text.
USER_REQUEST = re.compile(r"<USER_REQUEST>\n?([\s\S]*?)\n?</USER_REQUEST>")
#: Its own messages in the user's role: "The following is a <SYSTEM_MESSAGE> not actually sent by the user. ..."
SYSTEM_MESSAGE = "<SYSTEM_MESSAGE>"
#: Its tools (1.4.12's twelve): each one's action, and the input key that names the file it works on.
TOOLS = {"read_file": (Action.READ, "Path"), "write_file": (Action.EDIT, "Path"), "edit_file": (Action.EDIT, "Path"),
         "run_command": (Action.SHELL, None), "search_web": (Action.WEB, None),
         "invoke_subagent": (Action.DELEGATE, None), "define_subagent": (Action.DELEGATE, None),
         "manage_subagents": (Action.DELEGATE, None), "send_message": (Action.DELEGATE, None),
         "manage_task": (Action.TASK, None), "schedule": (Action.TASK, None), "ask_question": (Action.ASK, None)}
#: `command`'s permission modes, as Claude Code names them, in agy's options.
PERMISSIONS = {"auto": ["--mode", "auto"], "acceptEdits": ["--mode", "accept-edits"], "plan": ["--mode", "plan"],
               "bypassPermissions": ["--dangerously-skip-permissions"]}


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


def words_of(text: str) -> tuple:
    """(the Kind, the user's words as typed) of a text in the user's role."""
    if SYSTEM_MESSAGE in (text or "")[:200]:
        return Kind.ENVIRONMENT, text
    m = USER_REQUEST.search(text or "")
    return Kind.USER, m.group(1) if m else text


class Antigravity(Harness):
    name = "antigravity"
    label = "Antigravity"
    checked_with = "1.4.12"

    def call(self, method: str, path: str, headers, body) -> Optional[Call]:
        """The request as a model call (module doc), None if it is not one; `detail["model"]`, the model its path
        names."""
        if not is_model_call(method, path, body):
            return None
        system = system_text(body)
        session, cwd = CONVERSATION.search(system), CWD.search(system)
        model = MODEL_CALL.search(path.split("?", 1)[0]).group(1)
        kind = CallKind.TITLE if system.lstrip().startswith(TITLE_PROMPT) else \
            CallKind.TURN if session else CallKind.OTHER
        return Call(kind, session.group(1) if session else None, cwd.group(1) if cwd else None, None,
                    history=body["contents"], detail={"model": model})

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
            return Part(Kind.TOOL_CALL, role, text, tool=ToolCall(c.get("id"), name, args, action,
                                                                  [path] if isinstance(path, str) else []))
        if isinstance(p.get("functionResponse"), dict):
            r = p["functionResponse"]
            error = isinstance(r.get("response"), dict) and "error" in r["response"]
            return Part(Kind.TOOL_RESULT, role, text, result=ToolResult(r.get("id"), error, text or ""))
        if text is None:
            return Part(Kind.OTHER, role, None)
        if role == "model":
            return Part(Kind.REASONING if p.get("thought") else Kind.AGENT, role, text)
        kind, words = words_of(text)
        return Part(kind, role, text, words if kind == Kind.USER else None)

    def command(self, session: str, resume: bool = False, model: Optional[str] = None,
                permission_mode: Optional[str] = None, fullscreen: bool = True,
                instructions: Optional[str] = None) -> List[str]:
        """Its own options: `--model`, the permission mode (PERMISSIONS), and `--conversation <id>` to resume. It
        takes no id for a new conversation: the id is known from its first call. Instructions it does not take per
        run (`instruction_args` raises)."""
        return [*(["--model", model] if model else []), *PERMISSIONS.get(permission_mode or "", []),
                *(self.instruction_args(instructions) if instructions else []),
                *(["--conversation", session] if resume else [])]

    def first_prompt(self, text: str) -> List[str]:
        """`--prompt-interactive=<text>`: agy takes no prompt after `--`. The `=` keeps a message starting with `-` its value."""
        return [f"--prompt-interactive={text}"]
