"""Claude Code, as harness_kit reads it (2.1.310): its model calls (the Anthropic Messages API), the
pieces of its conversation, its own text among them, and its tools.

    calls        a POST to .../messages: the session's own turn, a subagent's (X-Claude-Code-Agent-Id),
                 a prompt suggestion ([SUGGESTION MODE:), a recap (The user stepped away ...), a
                 compaction (CRITICAL: Respond with TEXT ONLY), or a side call of its own (no tools
                 offered, the web search tool alone, X-Claude-Code-Request-Class auxiliary or
                 side_reply); the session in X-Claude-Code-Session-Id (else the body's metadata), the
                 working directory in its environment notes ("Primary working directory:")
    pieces       each message split into one piece per content block, its cache_control taken out:
                 the message with that block alone (`items`)
    kinds        by the block: text (the user's, the model's, or Claude Code's own -- told by how it
                 opens, HARNESS_MARKERS, or by its whole text, HARNESS_TEXTS), image and document (the
                 user's), tool_use, tool_result, thinking; a system-role message is Claude Code's own

Claude Code writes a lot in the user's name besides what the user said: its reminders, the output of a
command the user ran, a skill's instructions, a subagent's report, its notes after a response that went
wrong. Each has its opening; `read` tells them apart (its Kinds) and keeps what each says (Part.detail).
"""

import copy
import glob
import json
import os
import re
import textwrap
import zlib
import time
from typing import Dict, List, Optional, Tuple

from .base import (Action, AnswerError, Box, Call, CallKind, Fact, Facts, Follower, Harness, Kind, Part, RenameError,
                   SaveError, Shape, ToolCall, ToolResult, ask_arg, one_line, other_view, output_of, picked, seconds,
                   tool_title, typed_in)

# ---------------------------------------------------------------- Claude Code's own text, in the user's name

# Its notes to the model after a response that went wrong -- a safety classifier stopped it, it was cut off
# mid-stream or at the output limit, its tool call could not be parsed -- or that send it back to work (a
# goal check-in): sent in the user's name, as a message of their own. Claude Code 2.1.310 tells them from the
# user's words by these openings and, the rest, by their whole text; so does this module (RETRY_OPENINGS in
# HARNESS_MARKERS, RETRY_NOTES in HARNESS_TEXTS).
RETRY_OPENINGS = ("[structured-output-enforce]", "[projects-reply-gate]",
                  "You ended the turn without calling SendUserMessage.", "Goal check-in: «")
_CLASSIFIER = ("Your response above was stopped by a safety classifier — this is not a tool or API error. The rest "
               "of it was withheld, and tool calls in it that had not finished did not run. Do not produce that "
               "content again, even reworded.")
RETRY_NOTES = (
    "The previous response failed to produce a valid tool call. Please retry the tool call now.",
    "Your tool call was malformed and could not be parsed. Please retry.",
    "[Your previous response had no visible output. Please continue and produce a user-visible response.]",
    "The PermissionDenied hook indicated you may retry this tool call.",
    "The turn did not end: a tool call in your last message asked to end it, but another call in that message "
    "failed. Deal with the failure, then finish the turn. The calls that succeeded took effect, so do not repeat them.",
    _CLASSIFIER,
    _CLASSIFIER + ' Exception: a tool call whose result reads "Interrupted" was already running when the response '
    "was stopped; it may have partially or fully completed.",
    "Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if "
    "that is where the cut happened. Break remaining work into smaller pieces.",
    "Output token limit hit while you were still reasoning, before this response produced any text or tool call. "
    "That reasoning was not kept and is not part of this conversation, so there is nothing to resume. Continue from "
    "the conversation above: reason much more briefly and produce your answer or next tool call well within the "
    "output limit.",
    "[Your previous response reached the output limit with no visible output. Please continue and produce a brief "
    "user-visible response or tool call right away.]",
    "Your response was cut off because it exceeded the output token limit. Continue from where you left off. What "
    "you write next is shown as a separate block below the text so far, so begin at the start of the line, table "
    "row, list item or sentence that was cut, writing it again in full, and if you were inside a code block or a "
    "table, open it again first (the same code fence and language, the table's header row). Repeat nothing before "
    "that point and do not comment on the interruption. Keep going until the response is complete.",
    "Your response above was cut off mid-stream. Resume directly from where it stops — no apology, no recap. If "
    "none of it survived, answer the request from the start.",
    "Your response above was cut off mid-stream and only your next message is delivered. Write the complete "
    "response again from the start — no apology, no mention of the cut-off.")

# Its own text, sent in the user's name: a user text block opening with one of these is Claude Code's, not the
# user's, each of the Kind it says. Besides its reminders and command output: its notes on an attachment, put
# after it (an image read through a tool, shrunk to fit: "[Image: original 1400x2400, displayed at 1167x2000.
# Multiply coordinates by 1.20 ...]"), not the "[Image #1]" it writes into the user's own words where an image
# was pasted; its note that the user stopped a turn ("[Request interrupted by user]", before the user's next
# words); the output of a command the user ran with `!` (its `<bash-stdout>`; the `<bash-input>`, what the user
# typed, is theirs); its summary of a compacted conversation, which opens the history after it ("This session
# is being continued from a previous conversation that ran out of context. ..."); a skill's instructions, loaded
# by the Skill tool or by the user's /name ("Base directory for this skill: ..."); a message from another
# session -- a subagent's report as it hands back ("Another Claude session sent a message:\n<agent-message
# from=...>"); its copy for the model of what /context shows ("## Context Usage ..."); a hook's reason for not
# letting the turn end ("Stop hook feedback:\n..."); the notes of RETRY_OPENINGS; and its note that the user
# declined its Chrome extension. Its summary may come after its line that content others wrote is in it (OTHERS_WROTE):
# "<artifact-content-authored-by-others/>\nThe summarized conversation included Artifact content ...".
OTHERS_WROTE = "<artifact-content-authored-by-others/>"
OPENINGS = (
    ("<system-reminder>", Kind.ENVIRONMENT),
    ("<local-command-caveat>", Kind.OTHER),
    ("<local-command-stdout>", Kind.COMMAND_OUTPUT),
    ("<local-command-stderr>", Kind.COMMAND_OUTPUT),
    ("<command-name>", Kind.LOCAL_COMMAND),
    ("<command-message>", Kind.LOCAL_COMMAND),
    ("<command-args>", Kind.LOCAL_COMMAND),
    ("Caveat: The messages below were generated by the user while running local commands", Kind.OTHER),
    ("[Image: original ", Kind.ATTACHMENT_NOTE),
    ("[Image: source: ", Kind.ATTACHMENT_NOTE),
    ("[Image source: ", Kind.ATTACHMENT_NOTE),
    ("[Image could not be processed", Kind.ATTACHMENT_NOTE),
    ("[Image left out:", Kind.ATTACHMENT_NOTE),
    ("[Image not shown, read it from ", Kind.ATTACHMENT_NOTE),
    ("[Document removed:", Kind.ATTACHMENT_NOTE),
    ("[Request interrupted by user", Kind.INTERRUPT),
    ("<bash-stdout>", Kind.COMMAND_OUTPUT),
    ("<bash-stderr>", Kind.COMMAND_OUTPUT),
    ("This session is being continued from a previous conversation that ran out of context", Kind.COMPACTION_SUMMARY),
    (OTHERS_WROTE, Kind.COMPACTION_SUMMARY),
    ("Base directory for this skill:", Kind.SKILL),
    ("Another Claude session sent a message:", Kind.PEER_MESSAGE),
    ("<agent-message ", Kind.AGENT_REPORT),
    ("## Context Usage\n", Kind.COMMAND_OUTPUT),
    ("Stop hook feedback:\n", Kind.HOOK_FEEDBACK),
    ("TeammateIdle hook feedback:\n", Kind.HOOK_FEEDBACK),
    ("TaskCreated hook feedback:\n", Kind.HOOK_FEEDBACK),
    ("TaskCompleted hook feedback:\n", Kind.HOOK_FEEDBACK),
    ("The user declined to install the Claude in Chrome extension", Kind.OTHER),
) + tuple((o, Kind.RETRY_NOTE) for o in RETRY_OPENINGS)
HARNESS_MARKERS = tuple(o for o, _ in OPENINGS)
# Its own text that is a whole block, word for word: its note after a tool search's result, in the message of the
# results, that the tools found are loaded ("Tool loaded."), and RETRY_NOTES.
WHOLE_TEXTS = ((("Tool loaded.", Kind.TOOL_NOTICE),) + tuple((t, Kind.RETRY_NOTE) for t in RETRY_NOTES))
HARNESS_TEXTS = tuple(t for t, _ in WHOLE_TEXTS)
SKILL = "Base directory for this skill:"
COMPACTED = "This session is being continued from a previous conversation that ran out of context"
# A command the user typed that Claude Code expands into a prompt -- a skill's /name, a command file's: Claude Code
# sends the line typed as "<command-message>greet</command-message>\n<command-name>/greet</command-name>\n
# <command-args>Bob</command-args>", then the prompt it expands to (the skill's instructions, the file's text). The
# line is the user's message, read as they typed it ("/greet Bob"); the prompt is Claude Code's (COMMAND_PROMPT).
# A command Claude Code runs itself (/context, /model) opens with <command-name> and is followed by its output: its
# own, as its other notes are (LOCAL_COMMAND).
TYPED_COMMAND = re.compile(r"\s*<command-message>[^<]*</command-message>\s*<command-name>([^<]*)</command-name>"
                           r"\s*(?:<command-args>([\s\S]*?)</command-args>)?\s*$")
RAN = re.compile(r"^\s*<command-name>/?([^<]*)</command-name>\s*<command-message>[^<]*</command-message>"
                 r"\s*(?:<command-args>([\s\S]*?)</command-args>)?\s*$")
# A command the user ran with `!`, as Claude Code sends it ("<bash-input>ls -la</bash-input>", its output after it as
# its own text, PRINTED): the user's, as they typed it, "! ls -la". The closing tag may be cut off with a long one.
BANG = re.compile(r"^\s*<bash-input>([\s\S]*?)(?:</bash-input>\s*)?$")
PRINTED = re.compile(r"^\s*<bash-stdout>([\s\S]*?)</bash-stdout>\s*(?:<bash-stderr>([\s\S]*?)</bash-stderr>)?\s*$")
#: A message the user wrote while a turn ran, as Claude Code wraps it for the model mid-turn (its words, 2.1.x).
MID_TURN = re.compile(r"^\s*The user sent a new message while you were working:\s*([\s\S]*?)\s*"
                      r"This is how Claude Code surfaces messages the user sends mid-turn\b[\s\S]*$")
# What the user pasted, as Claude Code sends it when it is long -- one pasted in its terminal, or a long message sent
# into it: between <pasted_content id="55b6"> and </pasted_content id="55b6">. The words, without the tags.
PASTED = re.compile(r"\s*</?pasted_content\b[^>]*>\s*")
#: Claude Code's notes queued in the user's name (its queue, in its record of the session): not the user's words.
QUEUED_NOTES = ("<task-notification>", "<agent-message ", "Another Claude session sent a message:")

SKILL_TEXT = re.compile(r"^\s*Base directory for this skill: ([^\n]*)\n+([\s\S]*?)(?:\n+ARGUMENTS: ([\s\S]*?))?\s*$")
# A skill the Skill tool loads (2.1.310 to 2.1.314): its call's result says so ("Launching skill: <name>"; "Loaded skill
# instructions (read-only): <name>. ..." where the session may only read it), and the skill's instructions follow as a
# message of Claude Code's own, in the message of the calls' results, after them all: one for each skill loaded, in
# their order. Only a skill with a directory -- one on disk, a plugin's, a bundled one that ships files -- has its
# instructions open with it (SKILL); a bundled skill of instructions alone (artifact-diagramming, keybindings-help)
# sends them bare, told from the user's words only by where they are (`ClaudeCode.read`), its arguments after them
# ("ARGUMENTS: ...") as a skill's on disk has them. A skill the model loads again comes with Claude Code's note before
# its instructions ("(Re-invocation of /<name> — ..."), or one in their place ("Skill /<name> is already loaded above;
# instructions unchanged.", "Skill /<name> was loaded earlier ..."). A forked skill's result is its answer: nothing
# follows it.
LAUNCHED = re.compile(r"^(?:Launching skill: (.+)|Loaded skill instructions \(read-only\): (.+?)\. Nothing was executed\b.*)$")
REINVOKED = re.compile(r"^\s*\(Re-invocation of /")
BARE_SKILL = re.compile(r"^\s*([\s\S]*?)(?:\n+ARGUMENTS: ([\s\S]*?))?\s*$")
AGENT_MESSAGE = re.compile(r'<agent-message from="([^"]*)"[^>]*>\n?([\s\S]*?)\n?</agent-message>')
# another session's message, sent to this one (Claude Code's SendMessage across sessions), as it hands it on: the
# sender's name in `from-name` (its socket in `from`), and after the tag Claude Code's own caution about it
PEER_MESSAGE = re.compile(r'<cross-session-message\b([^>]*)>\n?([\s\S]*?)\n?</cross-session-message>')
REPORT_FOLLOWS = "The report follows:\n"
# files a note gives the agent the lines of: one the user @-mentioned (read as the Read tool reads it), the CLAUDE.md
# files and memory it loads ("Contents of <path>:")
MENTIONED = re.compile(r"Called the Read tool with the following input: (\{[^\n]*\})\nResult of calling the Read tool:\n")
LOADED = re.compile(r"(?:^|\n)Contents of (/[^\n]*?)(?: \([^)\n]*\))?:\n\n")
READ_LINE = re.compile(r"^\s*(\d+)(?:\t|→)(.*)$")

# ---------------------------------------------------------------- background tasks, as its tools' results say

#: A background task's start, as its tool's result begins: its kind, and its id.
STARTS = ((re.compile(r"Command running in background with ID: ([\w-]+)"), "command"),
          (re.compile(r"Async agent launched successfully\.[\s\S]*?\bagentId: ([\w-]+)"), "agent"),
          (re.compile(r"Monitor started \(task ([\w-]+)"), "monitor"),
          (re.compile(r"Workflow launched in background\. Task ID: ([\w-]+)"), "workflow"))
SUMMARY = re.compile(r"^Summary: (.+)$", re.M)        # a workflow's: what it is for (its call has no description)
RESUMED = re.compile(r'\{[^\n]*?"resumedAgentId":\s*"([\w-]+)"')    # SendMessage's result, when it resumed an agent
STOPPED = re.compile(r'^(?:\{"message":\s*")?Successfully stopped task: ([\w-]+)')
OUTPUT_FILE = re.compile(r"(?:Output is being written to: |output_file: )(\S+?\.output)\b|^Transcript dir: (\S+)$", re.M)
#: Its end: Claude Code's notification with a status (one without is a monitor's event), or an agent's report handed back.
HANDBACK = re.compile(r'<agent-message from="([\w-]+)">\s*\[Subagent hand-back\]')
NOTIFICATION = re.compile(r"<task-notification>([\s\S]*?)</task-notification>")
TASK_ID, TASK_STATUS = re.compile(r"<task-id>([\w-]+)</task-id>"), re.compile(r"<status>(\w+)</status>")
TASK_EVENT = re.compile(r"<event>([\s\S]*?)</event>")
WAITING = re.compile(r"waiting on its own background work|stopped with background work of its own still running")
MONITOR_END = re.compile(r"^\s*\[Monitor (?:expired|stopped)\b")
AGENT_ID = re.compile(r"\bagentId: ([\w-]+)")

# ---------------------------------------------------------------- its model calls

SESSION_HEADER = "x-claude-code-session-id"
AGENT_HEADER = "x-claude-code-agent-id"           # set on a subagent's calls only
REQUEST_CLASS_HEADER = "x-claude-code-request-class"   # main, subagent, workflow, compaction, auxiliary, side_reply
SIDE_CLASSES = ("auxiliary", "side_reply")       # Claude Code's side calls, not the session's turns
SUGGESTION = "[SUGGESTION MODE:"                 # how Claude Code's prompt suggestion asks
RECAP = "The user stepped away and is coming back."   # how Claude Code's away recap asks
COMPACTION = "CRITICAL: Respond with TEXT ONLY"  # how Claude Code's compaction call asks for its summary
WEB_SEARCH = "web_search_"                       # the web search server tool's type, before its version
CWD = re.compile(r"Primary working directory:\s*(\S+)")
VERSION = re.compile(r"claude-cli/([\d.]+)")      # its User-Agent

# ---------------------------------------------------------------- its tools

#: Each tool's action, and the input key that names the file it works on (None: none).
TOOLS = {"Read": (Action.READ, "file_path"), "NotebookRead": (Action.READ, "notebook_path"),
         "Edit": (Action.EDIT, "file_path"), "MultiEdit": (Action.EDIT, "file_path"),
         "Write": (Action.EDIT, "file_path"), "NotebookEdit": (Action.EDIT, "notebook_path"),
         "Bash": (Action.SHELL, None), "BashOutput": (Action.TASK, None), "KillShell": (Action.TASK, None),
         "Grep": (Action.SEARCH, "path"), "Glob": (Action.SEARCH, "path"), "LS": (Action.SEARCH, "path"),
         "WebSearch": (Action.WEB, None), "WebFetch": (Action.WEB, None),
         "Skill": (Action.SKILL, None), "Agent": (Action.DELEGATE, None), "Task": (Action.DELEGATE, None),
         "SendMessage": (Action.DELEGATE, None), "Workflow": (Action.DELEGATE, None),
         "AskUserQuestion": (Action.ASK, None), "ExitPlanMode": (Action.ASK, None),
         "Monitor": (Action.TASK, None), "TaskStop": (Action.TASK, None), "TaskOutput": (Action.TASK, None),
         "ScheduleWakeup": (Action.TASK, None), "Artifact": (Action.PUBLISH, None)}
#: Its tools that wait for the user in its terminal before the turn goes on: a question, with options to pick
#: from; a plan, to approve.
ASKS = {"AskUserQuestion": "question", "ExitPlanMode": "plan"}
#: Answering them in its terminal (`answer_keys`), its dialogs as 2.1.310 shows them. A QUESTION
#: (AskUserQuestion), its options numbered as the call has them:
#:
#:     one option of a question       its number: picked, and on to the next question
#:     the reader's own words         the number after the options' ("Type something."), the words, Enter
#:     options of a multiSelect one   each one's number (ticked), then Tab: on to the next question
#:     then, after several questions  "1": the review's "Submit answers" -- after a lone multiSelect one too;
#:                                    a lone question of one option is answered by its key
#:
#: and it tells the model `"<question>"="<answer>"` for each, the options' labels joined by ", ". A PLAN
#: (ExitPlanMode): its own choices, which the call says nothing of -- 1 "Yes, and use auto mode", 2 "Yes,
#: manually approve edits", 3 "Tell Claude what to change" (the words, then Enter).
PLAN_KEYS = {"auto": "1", "manual": "2", "change": "3"}
PLAN_APPROVED = "User has approved your plan"         # its result, once a plan is approved
#: Where Claude Code writes the plan it asks to have approved (ExitPlanMode's call carries none).
PLAN_FILE = re.compile(r"/\.claude/plans/[^/\\]+\.md$")
PLAN_CHARS = 20000          # the most of a plan read from its file
#: The kinds of the user's words, as a piece alone shows them (an image the user sent among them); and the model's turn.
SAID = (Kind.USER, Kind.USER_COMMAND, Kind.MID_TURN, Kind.ASK_REPLY)
TURNS = (Kind.AGENT, Kind.REASONING, Kind.TOOL_CALL, Kind.TOOL_RESULT)
#: What opens a turn: the user's words, or a note Claude Code queues in their name (QUEUED_NOTES) -- another
#: session's message, a subagent's report, a background task's notice -- which wakes an idle session as they do.
OPENS = SAID + (Kind.PEER_MESSAGE, Kind.AGENT_REPORT, Kind.TASK_NOTICE)
BLOCK_KINDS = {"text": None, "image": Kind.USER, "document": Kind.USER, "tool_result": Kind.TOOL_RESULT,
               "tool_use": Kind.TOOL_CALL, "server_tool_use": Kind.TOOL_CALL, "thinking": Kind.REASONING,
               "redacted_thinking": Kind.REASONING, "tool_addition": Kind.TOOL_NOTICE, "tool_removal": Kind.TOOL_NOTICE}


def without_cache_control(value):
    """`value` with every `cache_control` key taken out, at any depth."""
    if isinstance(value, dict):
        return {k: without_cache_control(v) for k, v in value.items() if k != "cache_control"}
    if isinstance(value, list):
        return [without_cache_control(v) for v in value]
    return value


def blocks_of(message) -> list:
    """A message's content as blocks: a string is one text block."""
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    return [b for b in content or [] if isinstance(b, dict)]


def pieces(messages: list) -> List[dict]:
    """The items a message list is: each message split into one piece per content block, in order, without
    cache_control, and with its role and content alone. A message's other fields (Claude Code puts
    `output_config`, its effort, on its last message) belong to the request, not the conversation. A message
    with no blocks is one piece as it is."""
    out = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        m = {k: v for k, v in without_cache_control(m).items() if k in ("role", "content")}
        blocks = blocks_of(m)
        if not blocks:
            out.append(m)
            continue
        for b in blocks:
            out.append({**m, "content": [b]})
    return out


def opening(text: str) -> Optional[str]:
    """The Kind of Claude Code's own text a user text block is, by how it opens or its whole text; None: the
    user's. An empty one is its own (OTHER)."""
    text = text.strip()
    if not text:
        return Kind.OTHER
    for start, kind in OPENINGS:
        if text.startswith(start):
            return kind
    return next((kind for whole, kind in WHOLE_TEXTS if text == whole), None)


def is_harness_text(text: str) -> bool:
    return opening(text) is not None


def typed_command(item) -> Optional[str]:
    """The command a piece says the user typed, as they typed it ("/greet Bob"), when it is one Claude Code
    expands into a prompt (TYPED_COMMAND); else None."""
    blocks = blocks_of(item) if isinstance(item, dict) and item.get("role") == "user" else []
    m = TYPED_COMMAND.match(str(blocks[0].get("text") or "")) if len(blocks) == 1 and blocks[0].get("type") == "text" else None
    if not m:
        return None
    name, args = m.group(1).strip(), (m.group(2) or "").strip()
    name = name if name.startswith("/") else "/" + name
    return f"{name} {args}" if args else name


def unpasted(text: str) -> str:
    """The user's words without the tags Claude Code puts around what was pasted (PASTED)."""
    return PASTED.sub("\n\n", text).strip() if text and "pasted_content" in text else text


def words_of(text: str) -> Tuple[str, str]:
    """(the Kind of the user's own words in a text block, the words as they typed them): a command they ran with
    `!` ("! ls"), a /name they typed ("/greet Bob"), a message sent mid-turn (unwrapped) -- else theirs as said."""
    text = unpasted(text)
    m = BANG.match(text)
    if m:
        return Kind.USER_COMMAND, f"! {m.group(1).strip()}"
    m = TYPED_COMMAND.match(text)
    if m:
        name, args = m.group(1).strip(), (m.group(2) or "").strip()
        name = name if name.startswith("/") else "/" + name
        return Kind.USER_COMMAND, f"{name} {args}" if args else name
    m = MID_TURN.match(text)
    if m and m.group(1):
        return Kind.MID_TURN, m.group(1)
    return Kind.USER, text


def mid_turn(text: str) -> Optional[str]:
    """The user's message, if `text` is one Claude Code sent mid-turn (MID_TURN); else None."""
    m = MID_TURN.match(text or "")
    return m.group(1) if m and m.group(1) else None


def kind_of(item) -> str:
    """A piece's Kind, by its own content alone (not its neighbours: `ClaudeCode.read`). Never raises: anything it
    does not know is OTHER."""
    if not isinstance(item, dict):
        return Kind.OTHER
    role = item.get("role")
    blocks = blocks_of(item)
    if role == "system":
        if blocks and blocks[0].get("type") in ("tool_addition", "tool_removal"):
            return Kind.TOOL_NOTICE
        text = " ".join(str(b.get("text") or "") for b in blocks)
        return Kind.TASK_NOTICE if "<task-notification>" in text else Kind.ENVIRONMENT
    if not blocks:
        return Kind.OTHER
    kind = blocks[0].get("type")
    if kind == "text":
        if role == "assistant":
            return Kind.AGENT
        text = str(blocks[0].get("text") or "")
        own = opening(text)
        if own == Kind.ENVIRONMENT and "<task-notification>" in text:
            return Kind.TASK_NOTICE                       # a notice Claude Code wraps in a reminder (2.1.311)
        if own is not None:
            return own
        return words_of(text)[0]
    return BLOCK_KINDS.get(kind) or Kind.OTHER


def _result_text(content) -> str:
    if isinstance(content, str):
        return content
    out = []
    for b in content or []:
        if isinstance(b, dict):
            if isinstance(b.get("text"), str):
                out.append(b["text"])
            elif b.get("type") in ("image", "document"):
                out.append(f"[{b['type']}]")
    return "\n".join(out)


def text_of(item) -> Optional[str]:
    """What the model reads of a piece, without the API's bookkeeping; None for thinking (an opaque or omitted
    blob) or a shape Claude Code does not make.

        text                its words
        image, document     [image], [document]
        tool_use            name(input as JSON)
        tool_result         the result's text (prefixed `error: ` when it is one)
        tool_addition       `tool added: <name>: <description>` and its input schema as JSON (Claude Code's
                            notice that tool search, or a connector, made a tool available: the model gets its
                            whole definition)
        tool_removal        `tool removed: <name>`
    """
    if not isinstance(item, dict):
        return None
    blocks = blocks_of(item)
    if not blocks:
        return None
    b = blocks[0]
    kind = b.get("type")
    if kind == "text":
        return str(b.get("text") or "")
    if kind in ("image", "document"):
        return f"[{kind}]"
    if kind in ("tool_use", "server_tool_use"):
        return f"{b.get('name')}({json.dumps(b.get('input'), ensure_ascii=False)})"
    if kind == "tool_result":
        text = _result_text(b.get("content"))
        return ("error: " + text) if b.get("is_error") else text
    if kind in ("tool_addition", "tool_removal"):
        tool = b.get("tool") if isinstance(b.get("tool"), dict) else {}
        definition = tool.get("definition") if isinstance(tool.get("definition"), dict) else tool
        name = definition.get("name") or tool.get("name")
        if not name:
            return None
        if kind == "tool_removal":
            return f"tool removed: {name}"
        text = f"tool added: {name}" + (f": {definition['description']}" if definition.get("description") else "")
        schema = definition.get("input_schema")
        return text + (f"\n{json.dumps(schema, ensure_ascii=False)}" if schema else "")
    return None


def is_compacted_summary(item) -> bool:
    """Whether a piece is the summary Claude Code goes on from after compacting its history -- perhaps after its notice
    that content others wrote is in it (OTHERS_WROTE)."""
    blocks = blocks_of(item) if isinstance(item, dict) and item.get("role") == "user" else []
    text = str(blocks[0].get("text") or "").lstrip() if len(blocks) == 1 and blocks[0].get("type") == "text" else ""
    if text.startswith(OTHERS_WROTE):                    # its line and the notice on the next
        text = text.split("\n", 2)[-1].lstrip()
    return text.startswith(COMPACTED)


def notices(text: str) -> List[dict]:
    """The task notifications in a text, each {id, status, event, ended, waiting}: `ended` when it says the task
    ended (a status; a monitor's expiry), `waiting` when an agent stopped while background work of its own runs."""
    out = []
    for note in NOTIFICATION.finditer(text or ""):
        body = note.group(1)
        found, status, event = TASK_ID.search(body), TASK_STATUS.search(body), TASK_EVENT.search(body)
        waiting = bool(WAITING.search(body))
        out.append({"id": found.group(1) if found else None, "status": status.group(1) if status else None,
                    "event": event.group(1) if event else None, "waiting": waiting,
                    "ended": not waiting and bool(status or (event and MONITOR_END.match(event.group(1))))})
    return out


def loaded(text: str) -> List[tuple]:
    """The files a note of Claude Code's gives the agent the lines of, not by a call of its own: one the user
    @-mentioned (read as the Read tool reads it), the CLAUDE.md files and memory it loads ("Contents of <path>:") --
    each (path, [(n, line)], how)."""
    out = []
    for m in MENTIONED.finditer(text):
        try:
            path = json.loads(m.group(1)).get("file_path")
        except (ValueError, AttributeError):
            continue
        rows = []
        for line in text[m.end():].split("\n"):
            r = READ_LINE.match(line)
            if not r:
                break
            rows.append((int(r.group(1)), r.group(2)))
        if isinstance(path, str) and path:
            out.append((path, rows, "@-mentioned: read into the message by Claude Code"))
    found = list(LOADED.finditer(text))
    for k, m in enumerate(found):
        body = text[m.end():found[k + 1].start() if k + 1 < len(found) else len(text)]
        body = re.sub(r"\n*</system-reminder>[\s\S]*$", "", body).rstrip("\n")
        out.append((m.group(1), list(enumerate(body.split("\n"), 1)), "loaded into the context by Claude Code"))
    return out


def note_detail(text: str, kind: Optional[str] = None) -> Optional[dict]:
    """What a note of Claude Code's says, as Part.detail has it, with its Kind: None for a note that says nothing
    more than its words.
        SKILL          name, args, instructions: a skill's instructions, loaded by the Skill tool or the user's /name
                       -- by its base directory; or bare, `kind` being SKILL (as `read` had it, by where it was:
                       BARE_SKILL), its name then "" (the Skill call that loaded it names it)
        AGENT_REPORT   from, text: another session's message, a subagent's report as it hands back
        PEER_MESSAGE   name, text: a message another Claude session sent this one
        LOCAL_COMMAND  name: a command the user ran that Claude Code runs itself (/context, /mcp)
        COMMAND_OUTPUT text: what a command the user ran with ! printed"""
    m = SKILL_TEXT.match(text)
    if m:
        return {"kind": Kind.SKILL, "name": os.path.basename(m.group(1).strip().rstrip("/")),
                "args": (m.group(3) or "").strip(), "instructions": m.group(2).strip()}
    if kind == Kind.SKILL:
        m = BARE_SKILL.match(text)
        return {"kind": Kind.SKILL, "name": "", "args": (m.group(2) or "").strip(), "instructions": m.group(1).strip()}
    m = AGENT_MESSAGE.search(text) if text.lstrip().startswith(("Another Claude session sent a message:", "<agent-message ")) else None
    if m:
        body = m.group(2)
        if REPORT_FOLLOWS in body:                   # a hand-back: the report, each of its lines indented by Claude Code
            body = textwrap.dedent(body.split(REPORT_FOLLOWS, 1)[1])
        return {"kind": Kind.AGENT_REPORT, "from": m.group(1), "text": body.strip()}
    m = PEER_MESSAGE.search(text) if text.lstrip().startswith("Another Claude session sent a message:") else None
    if m:
        who = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(1)))
        return {"kind": Kind.PEER_MESSAGE, "name": who.get("from-name") or who.get("from") or "", "text": m.group(2).strip()}
    m = RAN.match(text)
    if m:
        args = (m.group(2) or "").strip()
        return {"kind": Kind.LOCAL_COMMAND, "name": "/" + m.group(1).strip() + (f" {args}" if args else "")}
    m = PRINTED.match(text)
    if m:
        return {"kind": Kind.COMMAND_OUTPUT,
                "text": "\n".join(x for x in (m.group(1).rstrip("\n"), (m.group(2) or "").rstrip("\n")) if x)}
    return None


def launched(items: list, out: List[Part]) -> None:
    """The skills the Skill tool loaded (LAUNCHED), read in `out` (each piece as `ClaudeCode.read` has it so far): in the
    user's message of the calls' results, after them, the instructions of each skill, in the order of the results --
    the first text after them of the user's words, or one opening with its base directory -- are Claude Code's
    (SKILL: the skill's name, and in `call` the call that loaded it, as Part.detail has them); its note before them on
    loading the skill again, its own (OTHER). What the user says in that message ends them: a message sent mid-turn,
    an interrupt and the words after it are theirs."""
    due: List[Tuple[str, Optional[str]]] = []          # each skill loaded, its instructions not seen yet: (name, call)
    for k, it in enumerate(items):
        role, p = (it.get("role") if isinstance(it, dict) else None), out[k]
        if role == "assistant":
            due = []
        elif role != "user":
            continue
        elif p.result is not None:
            m = LAUNCHED.match((p.text or "").strip())
            if m:
                due.append(((m.group(1) or m.group(2)).strip(), p.result.call_id))
        elif not due or p.detail.get("block") != "text":
            continue
        elif p.kind == Kind.SKILL:                      # opened by its base directory, named by it
            p.detail["call"] = due.pop(0)[1]
        elif p.kind == Kind.USER and REINVOKED.match(p.text or ""):
            p.kind, p.words = Kind.OTHER, None
        elif p.kind == Kind.USER:
            name, call = due.pop(0)
            m = BARE_SKILL.match(p.text or "")
            p.kind, p.words = Kind.SKILL, None
            p.detail.update(name=name, args=(m.group(2) or "").strip(), instructions=m.group(1).strip(), call=call)
        elif p.kind in SAID or p.kind == Kind.INTERRUPT:
            due = []


def task_of(text: str) -> Optional[dict]:
    """The background task a tool's result says it started, resumed or stopped: {id, kind, how ("started",
    "resumed", "stopped"), output, label}; None if none."""
    text = text or ""
    m = STOPPED.match(text)
    if m:
        return {"id": m.group(1), "kind": None, "how": "stopped", "output": None, "label": None}
    m = RESUMED.match(text)
    if m:
        return {"id": m.group(1), "kind": "agent", "how": "resumed", "output": None, "label": None}
    for pattern, kind in STARTS:
        m = pattern.match(text)
        if m:
            out, summary = OUTPUT_FILE.search(text), SUMMARY.search(text)
            return {"id": m.group(1), "kind": kind, "how": "started",
                    "output": (out.group(1) or out.group(2)) if out else None,
                    "label": summary.group(1).strip()[:160] if summary else None}
    return None


def ask_of(name: str, inp) -> Optional[dict]:
    """What a call of one of its asking tools asks (ToolCall.ask); None for any other call."""
    if name not in ASKS:
        return None
    got = inp if isinstance(inp, dict) else {}
    if ASKS[name] == "plan":
        return {"kind": "plan", "plan": got["plan"] if isinstance(got.get("plan"), str) else None}
    return {"kind": "question", "questions": [
        {"id": None, "header": q.get("header"), "question": q.get("question"), "multiSelect": bool(q.get("multiSelect")),
         "options": [{"label": o.get("label"), "description": o.get("description")}
                     for o in q.get("options") or [] if isinstance(o, dict)]}
        for q in got.get("questions") or [] if isinstance(q, dict)]}


def tool_call(b: dict) -> ToolCall:
    name = b.get("name") or "tool"
    action, key = TOOLS.get(name, (Action.OTHER, None))
    inp = b.get("input")
    path = inp.get(key) if key and isinstance(inp, dict) else None
    ask = ask_of(name, inp)
    return ToolCall(b.get("id"), name, inp, action, [path] if isinstance(path, str) and path else [], ask,
                    view=view_of(name, inp, ask), server=b.get("type") == "server_tool_use")


def view_of(name: str, inp, ask: Optional[dict] = None) -> dict:
    """How a call of Claude Code's tool `name` is shown (Shape's views), as its own terminal shows it."""
    i = inp if isinstance(inp, dict) else {}
    s = lambda k: i[k] if isinstance(i.get(k), str) else None              # noqa: E731
    if name == "Bash":
        return {"shape": Shape.SHELL, "title": "Bash", "command": s("command") or "", "description": s("description"),
                "background": bool(i.get("run_in_background"))}
    if name in ("Read", "NotebookRead"):
        return {"shape": Shape.READ, "title": "Read", "path": s("file_path") or s("notebook_path"), "offset": i.get("offset")}
    if name == "Write":
        return {"shape": Shape.WRITE, "title": "Write", "path": s("file_path"), "content": str(i.get("content") or "")}
    if name == "Edit":
        return {"shape": Shape.EDIT, "title": "Update", "path": s("file_path"), "all": bool(i.get("replace_all")),
                "edits": [{"old": str(i.get("old_string") or ""), "new": str(i.get("new_string") or "")}]}
    if name == "MultiEdit":
        return {"shape": Shape.EDIT, "title": "Update", "path": s("file_path"),
                "edits": [{"old": str(e.get("old_string") or ""), "new": str(e.get("new_string") or "")}
                          for e in i.get("edits") or [] if isinstance(e, dict)]}
    if name == "NotebookEdit":
        return {"shape": Shape.EDIT, "title": "Update", "path": s("notebook_path"), "lang": "python",
                "edits": [{"old": "", "new": str(i.get("new_source") or "")}]}
    if name in ("Grep", "Glob"):
        return {"shape": Shape.SEARCH, "title": "Search", "pattern": str(i.get("pattern") or ""), "path": s("path"),
                "glob": s("glob"), "finds": "lines" if name == "Grep" else "files"}
    if name == "WebFetch":
        return {"shape": Shape.WEB, "title": "Fetch", "url": s("url")}
    if name == "WebSearch":
        return {"shape": Shape.WEB, "title": "Web Search", "query": s("query")}
    if name in ("Agent", "Task"):
        return {"shape": Shape.AGENT, "title": s("subagent_type") or name, "name": s("subagent_type"),
                "arg": s("description"), "description": s("description")}
    if name == "TodoWrite":
        return {"shape": Shape.TODO, "title": "Update Todos", "items": i.get("todos") if isinstance(i.get("todos"), list) else []}
    if name == "Skill":
        return {"shape": Shape.SKILL, "title": "Skill", "name": s("skill") or "", "args": s("args") or ""}
    if name in ASKS:
        return {"shape": Shape.ASK, "title": "Question" if ASKS[name] == "question" else "Plan", "arg": ask_arg(ask)}
    if name == "ToolSearch":                       # loading tools it was told of by name, or searching for some
        q = (s("query") or "").strip()
        picked = [tool_title(t.strip()) for t in q[len("select:"):].split(",") if t.strip()] if q.startswith("select:") else []
        return {**other_view(name, "Tool Search", s("query")),
                "label": f"Load {', '.join(picked)}" if picked else f"Search tools: {q}"}
    return {**other_view(name), **({"description": s("description")} if s("description") else {})}


#: Its own tools that edit a file: what a guard run before its edits (`edit_guard_args`) is run for.
EDIT_TOOLS = "Edit|Write|MultiEdit|NotebookEdit"


def config_dir(env: Optional[Dict[str, str]] = None) -> str:
    """Its own folder: CLAUDE_CONFIG_DIR, else ~/.claude (of `env`, else this process's environment)."""
    env = os.environ if env is None else env
    return os.path.abspath(os.path.expanduser(env.get("CLAUDE_CONFIG_DIR") or "~/.claude"))


def project_key(directory: str) -> str:
    """The name it gives a directory's folder under <config>/projects/: its path, resolved, every character that is not a
    letter or digit a "-"."""
    return re.sub(r"[^A-Za-z0-9]", "-", os.path.realpath(directory))


def memory_file(m: dict) -> str:
    """A memory as it keeps one: its front matter (strings JSON-quoted: YAML reads them), its body."""
    return (f"---\nname: {json.dumps(m['name'])}\ndescription: {json.dumps(m['description'], ensure_ascii=False)}\n"
            f"metadata:\n  type: {m['type']}\n---\n\n{m['body']}\n")


def memory_line(m: dict, file: str) -> str:
    """A memory's line in its MEMORY.md: its title, its file, what it is."""
    return f"- [{m['title']}]({file}) — {m['description']}"


def _text_of(path: str) -> Optional[str]:
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except FileNotFoundError:
        return None
    except (OSError, UnicodeDecodeError) as exc:
        raise SaveError(f"cannot read {path}: {exc}") from None


#: Its lines about a command's run, around what it printed: "Exit code N" before a failure's output, and its note that
#: the shell's directory was put back, after it.
EXIT_LINE = re.compile(r"^(?:Error: )?Exit code (-?\d+)\n?")
CWD_NOTE = re.compile(r"\n?Shell cwd was reset to [^\n]*\s*$")


def is_model_call(method: str, path: str, body) -> bool:
    """Whether the request is the agent's own model call: a POST to .../messages with a messages list holding a
    user message, offering tools -- not the web search server tool alone, which is Claude Code's WebSearch tool
    searching."""
    if method != "POST" or not path.split("?", 1)[0].rstrip("/").endswith("/messages"):
        return False
    if not isinstance(body, dict) or not isinstance(body.get("messages"), list) or not body.get("tools"):
        return False
    if all(is_web_search(t) for t in body["tools"]):
        return False
    return any(isinstance(m, dict) and m.get("role") == "user" for m in body["messages"])


def is_web_search(tool) -> bool:
    """Whether a tool offered is the API's web search server tool (`web_search_20250305`, ...)."""
    return isinstance(tool, dict) and str(tool.get("type") or "").startswith(WEB_SEARCH)


def session_of(headers, body: dict) -> Optional[str]:
    """The Claude Code session the request belongs to, or None."""
    lower = {k.lower(): v for k, v in (headers or {}).items()}
    if lower.get(SESSION_HEADER):
        return lower[SESSION_HEADER]
    user = (body.get("metadata") or {}).get("user_id") if isinstance(body, dict) else None
    try:
        return json.loads(user).get("session_id") or None if isinstance(user, str) else None
    except (ValueError, AttributeError):
        return None


def request_class(headers) -> Optional[str]:
    """What Claude Code says the call is (`X-Claude-Code-Request-Class`), or None."""
    return next((str(v).lower() for k, v in (headers or {}).items() if k.lower() == REQUEST_CLASS_HEADER and v), None)


def suggestion_at(messages: list, opening: str = SUGGESTION) -> Optional[int]:
    """Where a prompt suggestion's own message is -- a user message of text alone opening with `opening`
    (`[SUGGESTION MODE:`), after the conversation it forks -- or None: not a suggestion. It is the last message, or
    followed only by the suggestion's own tool calls, each an assistant message and the user message of its results:
    Claude Code refuses a tool the suggestion's model calls (`No tools needed for suggestion`) and asks it again,
    the refusal after the call."""
    if len(messages) < 2 or not isinstance(messages[-1], dict) or messages[-1].get("role") != "user":
        return None
    at = len(messages) - 1
    while at >= 2 and any(b.get("type") == "tool_result" for b in blocks_of(messages[at])) and \
            isinstance(messages[at - 1], dict) and messages[at - 1].get("role") == "assistant":
        at -= 2                                           # a call of the suggestion's own, and its refusal
    blocks = blocks_of(messages[at])
    if at < 1 or not blocks or messages[at].get("role") != "user" or any(b.get("type") != "text" for b in blocks):
        return None
    return at if str(blocks[0].get("text") or "").lstrip().startswith(opening) else None


def recap_at(messages: list) -> Optional[int]:
    """Where a recap's own message is, as `suggestion_at` finds a suggestion's; None: not a recap."""
    return suggestion_at(messages, RECAP)


def compaction_split(messages: list) -> Optional[Tuple[list, list]]:
    """(the conversation, the instruction's blocks) of a compaction call -- the last user message's text blocks
    from the one opening with `CRITICAL: Respond with TEXT ONLY` on are the instruction, the rest the conversation
    -- or None: not a compaction. Claude Code joins the instruction to the last message it summarizes, adding a newline
    to that one's text: ag's Claude adaptor finds the message, if stored, in that form (its to_events.merged_key)."""
    at = next((i for i in range(len(messages) - 1, -1, -1)
               if isinstance(messages[i], dict) and messages[i].get("role") == "user"), None)
    if at is None or at < len(messages) - 2:          # the last user message, or just before a system note
        return None
    blocks = blocks_of(messages[at])
    start = next((j for j, b in enumerate(blocks) if b.get("type") == "text"
                  and str(b.get("text") or "").lstrip().startswith(COMPACTION)), None)
    if start is None:
        return None
    rest = [dict(messages[at], content=blocks[:start])] if start else []
    return messages[:at] + rest + messages[at + 1:], blocks[start:]


def is_subagent(headers) -> bool:
    """Whether the call is a subagent's (Claude Code's `Agent` tool), not the session's own."""
    return any(k.lower() == AGENT_HEADER and v for k, v in (headers or {}).items())


def cwd_of(messages: list) -> Optional[str]:
    """The agent's working directory as Claude Code's notes last state it, or None."""
    found = None
    for m in messages:
        for b in blocks_of(m):
            for match in CWD.findall(str(b.get("text") or "")):
                found = match
    return found


def _rule(line: str) -> bool:
    """A row of its screen that is one of its message box's rules: "─" across it, a label in it or not."""
    line = line.strip()
    return len(line) >= 20 and line.count("─") >= 0.8 * len(line)


class ClaudeCode(Harness):
    name = "claude"
    label = "Claude Code"
    checked_with = "2.1.310"
    esc_takes_back = True            # stopped before its answer came, the message is back in its box
    ask_says = {"plan_verb": "approve", "own_answer": "Or type your own answer",       # its plan dialog's choices (PLAN_KEYS)
                "plan_choices": [{"id": "manual", "label": "Approve, I'll approve edits",
                                  "title": "Claude Code's “Yes, manually approve edits”", "primary": False},
                                 {"id": "auto", "label": "Approve, auto mode", "title": "Claude Code's “Yes, and use auto mode”",
                                  "primary": True}],
                "plan_change": {"label": "Or tell Claude what to change", "title": None}}
    stopped_says = {"lead": "⎿", "interrupted": "Interrupted · What should Claude do instead?",
                    "error": "API Error", "error_status": "API Error: {status}"}

    def screen_env(self, fullscreen: bool) -> Dict[str, Optional[str]]:
        """Its classic screen where not `fullscreen`, its environment's choice: what it prints goes into the
        terminal's own scrollback, scrolled there (its full screen takes each wheel tick, and redraws)."""
        return {"CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN": None if fullscreen else "1"}

    def call(self, method: str, path: str, headers, body) -> Optional[Call]:
        """The request as a model call: None unless it is a POST to .../messages with messages holding a user's.
        `detail["model"]` says whether it is one ag takes part in -- tools offered, not the web search tool alone
        (`is_model_call`); a call without is OTHER."""
        if method != "POST" or not path.split("?", 1)[0].rstrip("/").endswith("/messages") or not isinstance(body, dict):
            return None
        messages = body.get("messages")
        if not isinstance(messages, list) or not any(isinstance(m, dict) and m.get("role") == "user" for m in messages):
            return None
        agent = next((str(v) for k, v in (headers or {}).items() if k.lower() == "user-agent"), "")
        found = VERSION.search(agent)
        out = Call(CallKind.TURN, session_of(headers, body), cwd_of(messages), found.group(1) if found else None,
                   history=messages, detail={"model": is_model_call(method, path, body), "class": request_class(headers)})
        if is_subagent(headers):
            out.kind = CallKind.SUBAGENT
            return out
        if not out.detail["model"]:
            out.kind = CallKind.OTHER
            return out
        at = recap_at(messages)
        kind = CallKind.RECAP if at is not None else None
        if at is None:
            at = suggestion_at(messages)
            kind = CallKind.SUGGESTION if at is not None else None
        if at is not None:
            out.kind, out.history, out.own = kind, messages[:at], messages[at:]
            return out
        if out.detail["class"] in SIDE_CLASSES:
            out.kind = CallKind.OTHER
            return out
        split = compaction_split(messages)
        if split is not None:
            out.kind, out.history, out.own = CallKind.COMPACTION, split[0], [{"role": "user", "content": split[1]}]
        return out

    def items(self, history: list) -> list:
        return pieces(copy.deepcopy(history))

    def words(self, text: str) -> tuple:
        return words_of(text)

    def record_path(self, session: str, cwd: Optional[str] = None, config: Optional[str] = None) -> Optional[str]:
        return record_path(session, cwd, config)

    def follower(self, path: str) -> Follower:
        return Record(os.path.splitext(os.path.basename(path))[0])

    def rename_command(self, name: str) -> Optional[str]:
        """Its own `/rename` (also `/name`), which it runs at once, even mid-turn: the name in its prompt box and its
        terminal's title, and kept in its record."""
        name = " ".join((name or "").split())
        return f"/rename {name}" if name else None

    def rename(self, session: str, name: str, record: Optional[str] = None, env=None, cwd: Optional[str] = None) -> str:
        """A `custom-title` line added to the session's record (its JSONL file), as its own `/rename` adds one: the last
        in a record's tail is the name its /resume list and `--resume` show, "" none. A session running elsewhere takes
        it up on exiting -- unless it holds a name of its own already: its metadata, written again as the record grows,
        writes back the name it holds (`rename_command` reaches it)."""
        record = record or self.record_path(session, cwd)
        if not record or not os.path.isfile(record):
            raise RenameError("Claude Code's record of the session was not found")
        line = json.dumps({"type": "custom-title", "customTitle": " ".join((name or "").split()), "sessionId": session},
                          ensure_ascii=False, separators=(",", ":"))      # as it writes it: it looks for '"type":"custom-title"'
        try:
            torn = False                                 # its last line still open: ours goes on a line of its own
            with open(record, "rb") as fh:
                if fh.seek(0, os.SEEK_END) > 0:
                    fh.seek(-1, os.SEEK_END)
                    torn = fh.read(1) != b"\n"
            with open(record, "a", encoding="utf-8") as fh:
                fh.write(("\n" if torn else "") + line + "\n")
        except OSError as exc:
            raise RenameError(f"Claude Code's record of the session could not be written: {exc}") from None
        return "named in its record"

    def command(self, session: str, resume: bool = False, model: Optional[str] = None,
                permission_mode: Optional[str] = None, fullscreen: bool = True,
                instructions: Optional[str] = None) -> List[str]:
        """Its own options: what it may do unasked, the model, its instructions, and the session -- resumed, or started
        with its id."""
        return [*(["--permission-mode", permission_mode] if permission_mode else []), *(["--model", model] if model else []),
                *(self.instruction_args(instructions) if instructions else []),
                *(["--resume", session] if resume else ["--session-id", session])]

    def instruction_args(self, text: str) -> List[str]:
        """`--append-system-prompt`: after its own system prompt, on every call of the run (headless or not)."""
        return ["--append-system-prompt", text]

    headless = "session"             # `-p` with stream-json: one process, a message a line, a turn's end its `result`

    def headless_args(self, session: str, resume: bool = False, model: Optional[str] = None,
                      permission_mode: Optional[str] = None, instructions: Optional[str] = None,
                      extra: Tuple[str, ...] = ()) -> List[str]:
        """`-p` with stream-json in and out, no permission prompts (none can be answered), the model, the starter's
        options, the instructions, and the session -- resumed, or started with its id."""
        return ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
                *(["--permission-mode", permission_mode] if permission_mode else []), "--permission-prompts", "none",
                *(["--model", model] if model else []), *extra,
                *(self.instruction_args(instructions) if instructions else []),
                *(["--resume", session] if resume else ["--session-id", session])]

    def headless_message(self, text: str) -> str:
        return json.dumps({"type": "user", "message": {"role": "user", "content": text}}) + "\n"

    def headless_event(self, event: dict) -> Optional[dict]:
        """Its `result` line: the turn's end, an error unless it says success."""
        if not isinstance(event, dict) or event.get("type") != "result":
            return None
        ok = event.get("subtype") == "success" and not event.get("is_error")
        return {"ended": True, "error": None if ok else str(event.get("result") or event.get("subtype") or "the turn failed")[:2000]}

    def box(self, screen) -> Optional[str]:
        """Its message box: a prompt row ("❯", or "!" in its shell mode) and the rows of what is typed, between two
        full-width rules (the upper one may carry a label: "─── History 9/9 ───"), the cursor shown in it while it has
        the keys. A dialog (/mcp, /model), a menu, a question, a permission it asks, takes the box's place and hides the
        cursor; so does its folder-trust prompt."""
        if not screen.cursor_shown:
            return Box.AWAY
        lines = screen.lines()
        top = next((r for r in range(screen.y - 1, -1, -1) if _rule(lines[r])), None)
        bottom = next((r for r in range(screen.y + 1, len(lines)) if _rule(lines[r])), None)
        if top is None or bottom is None or _rule(lines[screen.y]):
            return Box.AWAY
        first = lines[top + 1]
        if first.startswith("!"):                        # its shell mode: the message would run as a command
            return Box.HOLDS
        if not first.startswith("❯"):
            return Box.AWAY
        return Box.HOLDS if typed_in(screen, top + 1, bottom - 1, 1).strip() else Box.EMPTY

    def answer_keys(self, ask: dict, choice: dict) -> List[str]:
        """Its dialogs' keys (PLAN_KEYS' notes)."""
        if ask.get("kind") == "plan":
            how = choice.get("plan")
            if how not in PLAN_KEYS:
                raise AnswerError("approve the plan (auto or manual) or say what to change")
            return [PLAN_KEYS[how]] if how != "change" else [PLAN_KEYS[how], one_line(choice.get("text")), "\r"]
        got = picked(ask, choice)
        out: List[str] = []
        for p in got:
            if p["text"] is not None:
                out += [str(p["count"] + 1), p["text"].strip(), "\r"]
            elif p["multi"]:
                out += [str(i + 1) for i in p["places"]] + ["\t"]
            else:
                out.append(str(p["places"][0] + 1))
        if len(got) > 1 or got[0]["multi"]:
            out.append("1")
        return out

    def answer_expected(self, ask: dict, choice: dict) -> List[str]:
        if ask.get("kind") == "plan":
            return [one_line(choice.get("text"))] if choice.get("plan") == "change" else [PLAN_APPROVED]
        return [f'"{p["question"]}"="{p["text"].strip() if p["text"] is not None else ", ".join(p["labels"])}"'
                for p in picked(ask, choice)]

    def answer_summary(self, ask: dict, choice: dict) -> str:
        if ask.get("kind") == "plan":
            return {"auto": "Approved, with auto mode", "manual": "Approved, edits approved by hand"}.get(
                choice.get("plan"), f"Change: {(choice.get('text') or '').strip()}")
        return super().answer_summary(ask, choice)

    def derived(self, parts: List[Part], at: float, history: Optional[list] = None) -> List[Fact]:
        """What an answer asks the user (its calls of ASKS, a plan's text read from the plan file it wrote), and what a
        call's new pieces say: an asking call's result (answered; dismissed: Esc rejected the call, its INTERRUPTED note
        with the result -- a plan sent back with what to change is rejected too, and answered), a background
        task its tool's result started, resumed or stopped (task_of), a task's notice (an end, a monitor's event, an
        agent waiting on its own work), an agent's report handed back (its end). Keyed by the call's or the task's id,
        and a notice by its words."""
        calls = {p.tool.id: p.tool for p in parts if p.tool is not None and p.tool.id}
        stopped = any(p.kind == Kind.INTERRUPT for p in parts)
        out: List[Fact] = []
        for p in parts:
            t, r = p.tool, p.result
            if t is not None and t.ask and t.id:
                ask = dict(t.ask)
                if ask.get("kind") == "plan" and not ask.get("plan"):
                    ask["plan"] = plan_text(parts, history)
                out.append(Fact(Facts.ASKED, t.id, at, {"call": t.id, **ask, "async": False, "turn": None}))
            if r is not None and r.call_id:
                asking = calls.get(r.call_id)
                if asking is not None and asking.ask:
                    out.append(Fact(Facts.ASK_SETTLED, r.call_id, at, {"call": r.call_id, "how": "dismissed"
                                                                       if r.error and stopped else "answered", "result": r.output}))
                task = r.task
                if task and task.get("id") and task.get("how") == "stopped":
                    out.append(Fact(Facts.TASK_ENDED, f"{task['id']}.{r.call_id}", at,
                                    {"task": task["id"], "kind": None, "status": "stopped"}))
                elif task and task.get("id"):
                    out.append(Fact(Facts.TASK_STARTED, f"{task['id']}.{r.call_id}", at,
                                    {"task": task["id"], "kind": task.get("kind"), "how": task.get("how"),
                                     "label": task.get("label") or label_of(calls.get(r.call_id)), "output": task.get("output")}))
            for n in p.detail.get("notices") or []:
                if not n.get("id"):
                    continue
                key = f"{n['id']}.{zlib.crc32(json.dumps(n, sort_keys=True).encode()):08x}"
                if n.get("ended"):
                    out.append(Fact(Facts.TASK_ENDED, key, at, {"task": n["id"], "kind": None, "status": n.get("status")}))
                else:
                    event = "waiting on its own background work" if n.get("waiting") else " ".join((n.get("event") or "").split())[:200]
                    out.append(Fact(Facts.TASK_ACTIVITY, key, at, {"task": n["id"], "event": event or None}))
            for agent in p.detail.get("handed_back") or []:
                out.append(Fact(Facts.TASK_ENDED, f"{agent}.{zlib.crc32((p.text or '').encode()):08x}", at,
                                {"task": agent, "kind": "agent", "status": "completed"}))
        return out

    def read(self, items: list) -> List[Part]:
        """Each piece read (module doc). Its neighbours tell three things a piece alone does not: the prompt a command
        the user typed expands to -- the first of the user's words after it, before the agent says anything (a skill's
        instructions are Claude Code's already) -- is Claude Code's (COMMAND_PROMPT); a skill's instructions the Skill
        tool loaded, bare, are Claude Code's (SKILL: `launched`); and when the history opens
        with Claude Code's summary of a compacted conversation, its notes up to the first reply to what first opens a
        turn after it -- the user's words, or a note queued in their name (OPENS: another session's message waking a
        session compacted while idle) -- are what it sends again with the summary (COMPACTION_REPEAT)."""
        out = [self.part(it) for it in items]
        alone = [kind_of(it) for it in items]           # as each piece is alone: a typed command is LOCAL_COMMAND here
        for k, it in enumerate(items):
            if typed_command(it) is None:
                continue
            for j in range(k + 1, len(items)):
                if not isinstance(items[j], dict) or items[j].get("role") == "assistant":
                    break
                if alone[j] == Kind.SKILL or (alone[j] in SAID and not out[j].detail.get("expands")):
                    if out[j].kind != Kind.SKILL:
                        out[j].kind, out[j].words = Kind.COMMAND_PROMPT, None
                    out[j].detail["expands"] = True
                    break
        launched(items, out)
        if items and is_compacted_summary(items[0]):
            out[0].detail["opens"] = True
            asked = next((i for i, p in enumerate(out) if i and p.kind in OPENS), len(items))
            end = next((i for i in range(asked + 1, len(items)) if isinstance(items[i], dict)
                        and items[i].get("role") == "assistant"), len(items))
            for i in range(1, end):
                if out[i].kind not in OPENS and out[i].kind not in TURNS and not out[i].detail.get("expands"):
                    out[i].detail["repeated"] = out[i].kind
                    out[i].kind = Kind.COMPACTION_REPEAT
        return out

    def own_folders(self, env: Optional[Dict[str, str]] = None) -> List[str]:
        """Its folder (CLAUDE_CONFIG_DIR, and ~/.claude) and its settings file, ~/.claude.json."""
        return sorted({config_dir(env), os.path.abspath(os.path.expanduser("~/.claude")),
                       os.path.abspath(os.path.expanduser("~/.claude.json"))})

    memory_folder = r"/\.claude/projects/[^/]+/memory"     # <config>/projects/<the directory's key>/memory

    saves = {"agents": {"where": "every Codex and Claude Code session there reads it, in full, at its start",
                        "user": "an AGENTS.md is a directory's: save it to one"},
             "skill": {"where": "Claude Code sessions there can use it: by its description, or as /name", "user": True},
             "memory": {"where": "your Claude Code sessions there see each memory's line, and read it when it matters",
                        "user": "Claude Code keeps memories per directory: save them to a directory"}}

    def save_files(self, kind: str, directory: Optional[str], made: dict) -> dict:
        """Where it reads each: an AGENTS.md added to the directory's (its default, where no CLAUDE.md is there: else a
        note says so); a skill's SKILL.md in <dir>/.claude/skills/<name>/, or <config>/skills/<name>/ for every
        directory; each memory a file in <config>/projects/<the directory's key>/memory/ -- never over one there -- and
        its line in that folder's MEMORY.md."""
        base, files, note = config_dir(), [], ""
        if kind in self.saves and directory is None and self.saves[kind].get("user") is not True:
            raise SaveError(self.saves[kind]["user"])
        if kind == "agents":
            path = os.path.join(directory, "AGENTS.md")
            had, text = _text_of(path), str(made.get("output") or "").strip() + "\n"
            gap = "" if not had or had.endswith("\n\n") else "\n" if had.endswith("\n") else "\n\n"   # a blank line first
            files.append({"path": path, "action": "append" if had else "create", "text": gap + text})
            where = f"every Codex and Claude Code session in {directory}"
            if any(os.path.exists(os.path.join(directory, n)) for n in ("CLAUDE.md", os.path.join(".claude", "CLAUDE.md"))):
                note = ("This directory has a CLAUDE.md: Claude Code reads that instead of AGENTS.md (its default), so only "
                        "Codex would read this -- unless CLAUDE.md imports it (a line @AGENTS.md).")
        elif kind == "skill":
            name = made["name"]
            path = os.path.join(directory, ".claude", "skills", name, "SKILL.md") if directory is not None \
                else os.path.join(base, "skills", name, "SKILL.md")
            files.append({"path": path, "action": "replace" if os.path.exists(path) else "create",
                          "text": str(made.get("output") or "").strip() + "\n"})
            where = f"/{name} in Claude Code sessions in " + (directory if directory is not None else "any directory")
        elif kind == "memory":
            folder = os.path.join(base, "projects", project_key(directory), "memory")
            index = os.path.join(folder, "MEMORY.md")
            lines = []
            for m in made.get("memories") or []:
                name, n = m["name"], 2
                while os.path.exists(os.path.join(folder, name + ".md")):      # never one already there
                    name, n = f"{m['name']}-{n}", n + 1
                files.append({"path": os.path.join(folder, name + ".md"), "action": "create", "text": memory_file({**m, "name": name})})
                lines.append(memory_line(m, name + ".md"))
            if not lines:
                raise SaveError("the model found nothing worth remembering: there is nothing to save")
            had = _text_of(index)
            files.append({"path": index, "action": "append" if had else "create",
                          "text": ("\n" if had and not had.endswith("\n") else "") + "\n".join(lines) + "\n"})
            where = f"your Claude Code sessions in {directory} (memory folder {folder})"
        else:
            return super().save_files(kind, directory, made)
        return {"files": files, "where": where, "note": note, "home": base}

    def mcp_args(self, name: str, url: str) -> Optional[List[str]]:
        """`--mcp-config`, the server over HTTP."""
        return ["--mcp-config", json.dumps({"mcpServers": {name: {"type": "http", "url": url}}})]

    def edit_guard_args(self, command: str) -> List[str]:
        """`--settings` with a PreToolUse hook on its edit tools (EDIT_TOOLS) running `command`."""
        return ["--settings", json.dumps({"hooks": {"PreToolUse": [{"matcher": EDIT_TOOLS,
                                                                    "hooks": [{"type": "command", "command": command}]}]}})]

    def guard_path(self, given) -> Optional[str]:
        """Its hook's input: the call's `tool_input`, its `file_path` (a notebook's `notebook_path`)."""
        inp = (given or {}).get("tool_input") if isinstance(given, dict) else None
        inp = inp if isinstance(inp, dict) else {}
        return inp.get("file_path") or inp.get("notebook_path") or None

    def guard_refusal(self, why: str) -> str:
        """Its hook's answer that denies the call, with why."""
        return json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                                  "permissionDecisionReason": why}})

    def tool_output(self, text: str) -> Tuple[str, Optional[str], Optional[str]]:
        """A failed command's "Exit code N" before its output, and the note after it that the shell's directory was put
        back, taken off (EXIT_LINE, CWD_NOTE)."""
        text, code = text or "", None
        m = EXIT_LINE.match(text)
        if m:
            code, text = m.group(1), text[m.end():]
        return CWD_NOTE.sub("", text).rstrip("\n") if (m or CWD_NOTE.search(text)) else text, code, None

    def spawned(self, call: ToolCall, output: str) -> Optional[dict]:
        """An Agent (or Task) call's subagent, by the id its result names (AGENT_ID), shown by what it was started for;
        its report comes back as the call's result, or as a note handed back."""
        m = AGENT_ID.search(output or "") if call.name in ("Agent", "Task") else None
        i = call.input if isinstance(call.input, dict) else {}
        return {"id": m.group(1), "name": str(i.get("description") or ""), "later": False} if m else None

    def read_one(self, payload, kind: Optional[str] = None) -> List[Part]:
        """A stored piece read on its own: one stored as a skill's instructions (`kind` SKILL, read so after the Skill
        call that loaded it: `launched`) read as those again where its words alone do not say so -- a skill's bare
        instructions, its name then "" (the call names it)."""
        out = super().read_one(payload)
        if kind == Kind.SKILL and len(out) == 1 and out[0].kind != Kind.SKILL and out[0].detail.get("block") == "text":
            said = note_detail(out[0].text or "", Kind.SKILL) or {}
            said.pop("kind", None)
            out[0].kind, out[0].words = Kind.SKILL, None
            out[0].detail.update(said)
        return out

    def part(self, item) -> Part:
        """One piece read on its own."""
        typed = typed_command(item)
        kind = Kind.USER_COMMAND if typed is not None else kind_of(item)
        role = item.get("role") if isinstance(item, dict) else None
        blocks = blocks_of(item) if isinstance(item, dict) else []
        b = blocks[0] if blocks else {}
        p = Part(kind, role, text_of(item), detail={"block": b.get("type")})
        if p.text is not None and b.get("type") == "text":
            p.cwd = next(iter(CWD.findall(p.text)[-1:]), None)
            found = notices(p.text)
            if found:
                p.detail["notices"] = found
            back = HANDBACK.findall(p.text)
            if back:
                p.detail["handed_back"] = back
        if typed is not None:
            p.words = typed
        elif kind in SAID and b.get("type") == "text":
            p.words = words_of(p.text or "")[1]
        elif b.get("type") == "text" and role != "assistant":
            said = note_detail(p.text or "")
            if said:
                said.pop("kind")
                p.detail.update(said)
            got = loaded(p.text or "")
            if got:
                p.detail["loaded"] = got
        if kind in (Kind.PEER_MESSAGE, Kind.AGENT_REPORT) and "text" in p.detail:   # which, as its tag says
            p.kind = Kind.AGENT_REPORT if "from" in p.detail else Kind.PEER_MESSAGE
        if b.get("type") in ("image", "document"):
            p.attachment = b["type"]
        if b.get("type") in ("tool_use", "server_tool_use"):
            p.tool = tool_call(b)
        elif b.get("type") in ("tool_result", "web_search_tool_result"):
            p.result = ToolResult(b.get("tool_use_id"), bool(b.get("is_error")), output_of(b.get("content")))
            if b.get("type") == "tool_result":
                p.result.task = task_of(p.text)
            shown, p.result.exit, p.result.took = self.tool_output(p.result.output)
            p.result.shown = shown if shown != p.result.output else None
        elif p.kind == Kind.REASONING:
            p.opaque = b.get("type") == "redacted_thinking" or not (b.get("thinking") or "").strip()
            p.detail["thinking"] = b.get("thinking") or b.get("text") or ""
        return p


def split_turn_notes(text: str) -> bool:
    """Whether a message queued in the user's name is one of Claude Code's notes (QUEUED_NOTES), not theirs."""
    return text.lstrip().startswith(QUEUED_NOTES)


def plan_text(parts: List[Part], history: Optional[list] = None) -> Optional[str]:
    """The plan an ExitPlanMode call asks to have approved, where its call does not carry it: the plan file (PLAN_FILE)
    last written -- among `parts` (the answer that asks), else in `history` -- as it is now, else as that write had it;
    at most PLAN_CHARS. None: none written."""
    found = None
    for p in reversed(parts):
        got = p.tool.input if p.tool is not None and isinstance(p.tool.input, dict) else None
        path = got.get("file_path") if got else None
        if isinstance(path, str) and PLAN_FILE.search(path):
            found = (path, got["content"] if isinstance(got.get("content"), str) else None)
            break
    for item in reversed(history or []) if found is None else []:
        found = plan_path(item)
        if found:
            break
    if not found:
        return None
    try:
        with open(found[0], encoding="utf-8", errors="replace") as fh:
            return fh.read(PLAN_CHARS)
    except OSError:
        return found[1][:PLAN_CHARS] if found[1] else None


def label_of(call: Optional[ToolCall]) -> Optional[str]:
    """What a call that started a background task said it was for: its `description` (Bash, Agent, Monitor take one;
    SendMessage, its `summary`), else the start of its command or prompt, else its tool's name."""
    if call is None:
        return None
    given = call.input if isinstance(call.input, dict) else {}
    for k in ("description", "summary", "command", "prompt", "message"):
        if isinstance(given.get(k), str) and given[k].strip():
            return " ".join(given[k].split())[:160]
    return call.name


def plan_path(payload) -> Optional[Tuple[str, Optional[str]]]:
    """(the plan file a stored tool call writes, what it writes there), for the last such call in a piece; None."""
    for b in reversed(blocks_of(payload) if isinstance(payload, dict) else []):
        got = b.get("input") if b.get("type") == "tool_use" else None
        path = got.get("file_path") if isinstance(got, dict) else None
        if isinstance(path, str) and PLAN_FILE.search(path):
            return path, got["content"] if isinstance(got.get("content"), str) else None
    return None


# ---------------------------------------------------------------- its own record of a session

#: Claude Code's record of a session: <its config folder: CLAUDE_CONFIG_DIR, else ~/.claude>/projects/<the session's
#: directory, each character but a letter or a digit made '-'>/<session>.jsonl -- a JSON line per thing as it happens.
#: What is read of it (2.1.310):
#:
#:     {"type": "queue-operation", "operation", "timestamp", "content"}   its queue of what the user writes while it
#:         works: "enqueue" when a message is written; "remove", reason "absorbed_mid_turn", when it goes to the model
#:         with the turn's next call (wrapped: MID_TURN); "dequeue" when the turn ended first and it opens the next
#:         (the first in); any other "remove": taken back; "popAll" when Up takes every message the user wrote back
#:         into the prompt, to edit (its `content` their words, joined) -- taken back too, its notes staying queued.
#:         Its own notes (QUEUED_NOTES) are queued too, in the user's name.
#:     {"type": "user", "origin": {"kind": "human"}, "message"}   a message the user sent between turns: not queued,
#:         sent at once as the next turn's first (a note's origin is of another kind; a "!" command's line has none)
#:     {"type": "assistant", "message"}   the model's answer: a call of ASKS waits on the user; with
#:         "isApiErrorMessage", Claude Code's error once it gave up on a model call (its "apiErrorStatus")
#:     {"type": "user", "message": {content: [tool_result]}}   an asking call's result, the moment it is answered or
#:         dismissed -- dismissed (Esc), INTERRUPTED follows it at once
#:     a user line opening with INTERRUPTED   the user stopped the turn (Esc), which makes no model call
#:     any line with a <task-notification>   a background task ended, written the moment it is made (`notices`)
#:     {"type": "ai-title", "aiTitle", "sessionId"}   its own name for the session, which a small model gave it from the
#:         user's first message (2.1.312); written again, unchanged, each time it rewrites the session's metadata
#:
#: "isSidechain" lines are a subagent's, not the session's.
INTERRUPTED = "[Request interrupted by user"
BUSY_SECONDS = 1.0         # held longer than this: written while a turn ran (one written between turns goes at once)
SETTLE_SECONDS = 1.0       # an asking call's result with nothing after it this long: answered (Esc writes its note at once)
SENT_KEPT = 20             # the newest messages sent as a turn's first, kept to know the user line that records each


def record_dir(config: Optional[str] = None) -> str:
    """Claude Code's config folder: `config`, else CLAUDE_CONFIG_DIR, else ~/.claude."""
    return os.path.abspath(os.path.expanduser(config or os.environ.get("CLAUDE_CONFIG_DIR") or "~/.claude"))


def record_path(session: str, cwd: Optional[str] = None, config: Optional[str] = None) -> Optional[str]:
    """Claude Code's record of `session`, if it has one now: under its directory's folder, else wherever it is."""
    if not session:
        return None
    root = os.path.join(record_dir(config), "projects")
    if cwd:
        path = os.path.join(root, re.sub(r"[^A-Za-z0-9]", "-", cwd), f"{session}.jsonl")
        if os.path.isfile(path):
            return path
    found = glob.glob(os.path.join(glob.escape(root), "*", glob.escape(session) + ".jsonl"))
    return found[0] if found else None


def _content_text(content) -> Optional[str]:
    if isinstance(content, str):
        return content
    if isinstance(content, list):                  # a message with an image: its words
        return "\n".join(b["text"] for b in content if isinstance(b, dict) and isinstance(b.get("text"), str)) or None
    return None


def _strings(value):
    """Every string in a JSON value, at any depth."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)


class Record(Follower):
    """Claude Code's record of a session, followed (record_path's module notes): the user's messages as it queues and
    sends them, what its asking calls came to, its turn interrupted or given up on, its background tasks' ends, and
    its own name for the session. `session`: the session's id (None: any), whose name lines alone are its."""

    def __init__(self, session: Optional[str] = None):
        self.session = session
        self.title: Optional[str] = None          # its name for the session, as last read
        self.queue: List[dict] = []               # [{key, text, at, note}]: not sent yet, in the order queued
        self.sent: List[Tuple[str, float]] = []   # (text, when) of the newest sent as a turn's first
        self.asks: Dict[str, str] = {}            # an asking call's id -> its tool, until its result
        self.results: Dict[str, dict] = {}        # an asking call's id -> {key, at, result, seen}: its result, settling

    def wanted(self, line: bytes) -> bool:
        if any(k in line for k in (b'"queue-operation"', b'"human"', b"<task-notification>", b"isApiErrorMessage",
                                   INTERRUPTED.encode(), b"AskUserQuestion", b"ExitPlanMode", b'"ai-title"')):
            return True
        if self.results and b'"assistant"' in line:
            return True
        return any(c.encode() in line for c in self.asks)

    def take(self, line: bytes, at: str) -> List[Fact]:
        try:
            m = json.loads(line)
        except ValueError:
            return []
        if not isinstance(m, dict):
            return []
        key, when = str(at), seconds(m.get("timestamp"))
        out = self._ended(m, key, when) if b"<task-notification>" in line else []
        if m.get("type") == "queue-operation":
            return out + self._queued(m, key, when)
        if m.get("type") == "ai-title":
            return out + self._titled(m, key)
        if m.get("isSidechain") or m.get("type") not in ("user", "assistant"):
            return out
        message = m.get("message") if isinstance(m.get("message"), dict) else {}
        content = message.get("content")
        blocks = [{"type": "text", "text": content}] if isinstance(content, str) else \
            [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []
        if m["type"] == "assistant":
            out += self._settled("answered")                      # the turn went on past an asking call's result
            for b in blocks:
                if b.get("type") == "tool_use" and b.get("name") in ASKS and b.get("id"):
                    self.asks[b["id"]] = b["name"]
            if m.get("isApiErrorMessage"):
                text = " ".join(str(b.get("text") or "") for b in blocks if b.get("type") == "text").strip()
                status = m.get("apiErrorStatus") if isinstance(m.get("apiErrorStatus"), int) else None
                out.append(Fact(Facts.TURN_STOPPED, key, when, {"how": "error", "error": text or None, "status": status}))
            return out
        for b in blocks:
            if b.get("type") == "tool_result" and b.get("tool_use_id") in self.asks:
                call = b["tool_use_id"]
                del self.asks[call]
                self.results[call] = {"key": f"{key}.{call}", "at": when, "result": output_of(b.get("content")),
                                      "seen": time.time()}
        if any(b.get("type") == "text" and str(b.get("text", "")).startswith(INTERRUPTED) for b in blocks):
            out += self._settled("dismissed")
            out.append(Fact(Facts.TURN_STOPPED, key, when, {"how": "interrupted"}))
        elif isinstance(m.get("origin"), dict) and m["origin"].get("kind") == "human" and not m.get("isMeta"):
            out += self._prompt(_content_text(content), key, when)
        return out

    def due(self, now: float) -> List[Fact]:
        """An asking call's result with nothing after it for SETTLE_SECONDS: answered (dismissed, its note comes at once)."""
        return self._settled("answered", lambda r: now - r["seen"] >= SETTLE_SECONDS)

    def _settled(self, how: str, which=lambda r: True) -> List[Fact]:
        out = []
        for call, r in list(self.results.items()):
            if which(r):
                del self.results[call]
                out.append(Fact(Facts.ASK_SETTLED, r["key"], r["at"], {"call": call, "how": how, "result": r["result"]}))
        return out

    def _queued(self, op: dict, key: str, when: Optional[float]) -> List[Fact]:
        kind, text = op.get("operation"), _content_text(op.get("content"))
        if kind == "enqueue" and text is not None:
            q = {"key": key, "text": text, "at": when, "note": text.lstrip().startswith(QUEUED_NOTES)}
            self.queue.append(q)
            return [] if q["note"] else [Fact(Facts.MESSAGE_QUEUED, key, when, {"queued": key, "text": text,
                                                                                 "words": words_of(text)[1]})]
        if kind == "dequeue" and self.queue:                    # the first in: it opens the next turn
            q = self.queue.pop(0)
            self.sent = (self.sent + [(q["text"], when)])[-SENT_KEPT:]
            held = q["at"] is not None and when is not None and when - q["at"] > BUSY_SECONDS
            return self._sent(q, key, when, "next", held)
        if kind == "popAll":                                    # back in the prompt, to edit: taken back
            back = [q for q in self.queue if not q["note"]]
            self.queue = [q for q in self.queue if q["note"]]
            return [Fact(Facts.MESSAGE_WITHDRAWN, f"{key}.{i}", when, {"queued": q["key"]}) for i, q in enumerate(back)]
        if kind == "remove":
            q = next((q for q in self.queue if q["text"] == text), None)
            if q is None:
                return []
            self.queue.remove(q)
            if op.get("reason") == "absorbed_mid_turn":
                return self._sent(q, key, when, "mid_turn", True)
            return [] if q["note"] else [Fact(Facts.MESSAGE_WITHDRAWN, key, when, {"queued": q["key"]})]
        return []

    @staticmethod
    def _sent(q: dict, key: str, when: Optional[float], how: str, joins: bool) -> List[Fact]:
        if q["note"]:
            return []
        return [Fact(Facts.MESSAGE_SENT, key, when, {"queued": q["key"], "text": q["text"], "words": words_of(q["text"])[1],
                                                      "how": how, "joins": joins, "written": q["at"]})]

    def _prompt(self, text: Optional[str], key: str, when: Optional[float]) -> List[Fact]:
        """A message the user sent between turns -- not one the queue has as dequeued, which Claude Code records again
        as it sends it."""
        if text is None or when is None:
            return []
        if any(t == text and sent is not None and abs(when - sent) <= BUSY_SECONDS for t, sent in self.sent):
            return []
        return [Fact(Facts.MESSAGE_SENT, key, when, {"queued": None, "text": text, "words": words_of(text)[1],
                                                      "how": "prompt", "joins": False, "written": when})]

    def _titled(self, m: dict, key: str) -> List[Fact]:
        """Its name for the session, when it is not the one it last gave: it writes the same name again and again."""
        title = " ".join(str(m.get("aiTitle") or "").split())
        if not title or title == self.title or (self.session and m.get("sessionId") not in (None, self.session)):
            return []
        self.title = title
        return [Fact(Facts.NAMED, key, None, {"text": title, "by": "claude"})]

    @staticmethod
    def _ended(m: dict, key: str, when: Optional[float]) -> List[Fact]:
        """The background tasks a line's notifications say ended (`notices`) -- whether or not a call has carried them;
        not a line of what it sent the model (`api-request`, its blobs), which holds a notification again."""
        if when is None or str(m.get("type") or "").startswith("api-request"):   # when, unknown: perhaps before an
            return []                                                          # agent was resumed
        out, seen = [], set()
        for text in _strings(m):
            for n in notices(text):
                if n["ended"] and n["id"] and n["id"] not in seen:
                    seen.add(n["id"])
                    out.append(Fact(Facts.TASK_ENDED, f"{key}.{n['id']}", when, {"task": n["id"], "kind": None,
                                                                                  "status": n["status"]}))
        return out


__all__ = ["ClaudeCode", "Kind", "blocks_of", "pieces", "without_cache_control", "text_of", "kind_of", "typed_command",
           "words_of", "mid_turn", "notices", "loaded", "note_detail", "launched", "task_of", "is_compacted_summary", "Record",
           "record_path"]
