"""What a harness is: the facts about an agent harness that hold whatever reads them -- how it shapes its
model calls, which of the text it sends is its own, what each of its tools does. Standard library only:
nothing here knows of ag, of its gatherer or its policies.

A harness module reads what the harness sends at three levels:

    1. the model call     `call(method, path, headers, body)`: what one request is (`Call`) -- the
                          session's own turn, a subagent's, one of the harness's side calls -- or None
                          when it is no model call at all
    2. its pieces         `items(history)`: the conversation as pieces, each one thing said; and
                          `read(items)`: each piece as a `Part`, of a `Kind` -- the user's words, the
                          model's, the harness's own notes of each kind
    3. its tool calls     filled in by `read`, on the part: a `ToolCall` (its tool, its input, the
                          `Action` it takes, the files it names, what it asks the user) or a
                          `ToolResult` (its call, its words, the background task it started or ended)

A subclass mostly lists its rules (its tables of openings, whole texts and tools); the functions that
apply them are its own where its format needs them. `checked_with` is the harness's version the rules
were read from: a newer one may word things differently.

Besides what it sends, a harness writes its own record of each session, a line per thing as it happens --
much of it what no model call ever carries: a message typed while the agent works, a question answered or
dismissed in its terminal, Esc, a call given up on. `record_path` finds it; a `Follower` reads it as it grows,
each line it cares about giving `Fact`s (`follow`).
"""

import json
import os
import zlib
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


class Kind:
    """What a piece of a conversation is. The first four are the user's own words; AGENT, REASONING,
    TOOL_CALL and TOOL_RESULT the model's turn; every other is the harness's own text, sent in the
    model's conversation -- in the user's name, or a system message."""
    USER = "user"                        # the user's words
    USER_COMMAND = "user_command"        # a command the user typed: `!ls` (its shell), `/greet Bob` (a prompt it expands)
    MID_TURN = "mid_turn"                # the user's words, written while the turn ran and sent into it
    ASK_REPLY = "ask_reply"              # the user's answers to what the harness asked as the turn went on
    AGENT = "agent"                      # the model's words
    REASONING = "reasoning"              # the model's own reasoning: its words, or an opaque blob
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    ENVIRONMENT = "environment"          # the harness's notes on where and how the agent works: reminders,
                                         # instructions files, its environment, the tools it adds
    COMMAND_PROMPT = "command_prompt"    # the prompt a command the user typed expands to
    LOCAL_COMMAND = "local_command"      # a command the user ran that the harness runs itself (/context, /mcp)
    COMMAND_OUTPUT = "command_output"    # what such a command, or one run with `!`, printed
    ATTACHMENT_NOTE = "attachment_note"  # the harness's note on an attachment (an image shrunk to fit)
    INTERRUPT = "interrupt"              # its note that the user stopped the turn
    SKILL = "skill"                      # a skill's instructions, loaded
    AGENT_REPORT = "agent_report"        # a subagent's report, handed back
    PEER_MESSAGE = "peer_message"        # a message from another session or agent
    TASK_NOTICE = "task_notice"          # its notice that a background task ended, or did something
    RETRY_NOTE = "retry_note"            # its note after a response that went wrong, sending the model back to it
    HOOK_FEEDBACK = "hook_feedback"      # a hook's reason for not letting the turn end
    TOOL_NOTICE = "tool_notice"          # its note that tools were loaded, added or removed
    COMPACTION_SUMMARY = "compaction_summary"   # its summary of a compacted conversation
    COMPACTION_REPEAT = "compaction_repeat"     # what it sends again with that summary: its notes, files restored
    OTHER = "other"                      # anything else of its own


#: The kinds that are the user's own words.
USERS = frozenset({Kind.USER, Kind.USER_COMMAND, Kind.MID_TURN, Kind.ASK_REPLY})
#: The kinds that are the model's turn.
MODELS = frozenset({Kind.AGENT, Kind.REASONING, Kind.TOOL_CALL})


class CallKind:
    """What one model call is."""
    TURN = "turn"                        # the session's own turn
    SUBAGENT = "subagent"                # a subagent's: a conversation of its own
    SUGGESTION = "suggestion"            # a prompt suggestion: what the user might type next
    RECAP = "recap"                      # a recap of the session, for a user coming back
    TITLE = "title"                      # a title for the session
    COMPACTION = "compaction"            # the harness compacting its history: its summary asked for
    OTHER = "other"                      # any other side call of the harness's own


class Action:
    """What a tool call does."""
    READ = "read"                        # reads a file
    EDIT = "edit"                        # changes or writes files
    SHELL = "shell"                      # runs a shell command
    SEARCH = "search"                    # searches files, or lists them
    WEB = "web"                          # searches or fetches the web
    SKILL = "skill"                      # loads a skill
    DELEGATE = "delegate"                # starts or messages a subagent
    ASK = "ask"                          # asks the user, the turn waiting on the answer
    TASK = "task"                        # watches, waits on or stops a background task
    OTHER = "other"


@dataclass
class Call:
    """One model call: what it is (`kind`, a CallKind), the session it belongs to (None: none said), the
    working directory it states, the harness's version (None: not said), and where its conversation splits
    from the call's own messages -- `history`, the conversation so far; `own`, what the call adds to it to
    ask for what it is for (a suggestion's prompt, a compaction's instruction; [] for a turn)."""
    kind: str
    session: Optional[str] = None
    cwd: Optional[str] = None
    version: Optional[str] = None
    history: list = field(default_factory=list)
    own: list = field(default_factory=list)
    detail: Dict[str, Any] = field(default_factory=dict)   # what the harness says of it besides


@dataclass
class ToolCall:
    """A tool call: its id, its tool, its input (an object; or a string, as the harness gave it), what it
    does (`action`, an Action), the files it names, and -- when it asks the user and the turn waits --
    what it asks (`ask`: {kind: "question", questions: [{id, header, question, multiSelect, options:
    [{label, description}]}]} or {kind: "plan", plan: its text, None when the call carries none})."""
    id: Optional[str]
    name: str
    input: Any = None
    action: str = Action.OTHER
    paths: List[str] = field(default_factory=list)
    ask: Optional[dict] = None


@dataclass
class ToolResult:
    """A tool's result: its call's id, whether it is an error, its words as a reader sees them, and -- when
    it says a background task started, resumed or was stopped -- that task (`task`: {id, kind (command,
    agent, monitor, workflow), how: "started" or "stopped", output: the file it writes to, label: what it
    is for, when the result says})."""
    call_id: Optional[str]
    error: bool = False
    output: str = ""
    task: Optional[dict] = None


@dataclass
class Part:
    """One piece of a conversation, read: its `kind` (a Kind), the role it was sent in, `text` -- what the
    model reads of it (None: nothing to read, such as encrypted reasoning) -- and `words`, the user's own
    words in it, unwrapped (USERS: "! ls", "/greet Bob", a message sent mid-turn), else None. A tool call or
    result has `tool` or `result`; a piece that states the agent's working directory, `cwd`; `opaque`, an
    opaque blob (encrypted reasoning). `detail` holds what a kind says besides:

        SKILL            name, args, instructions; call, the id of the tool call that loaded it (Claude Code's Skill)
        AGENT_REPORT     from (the subagent's id or path), text (its report)
        PEER_MESSAGE     name (who sent it), text
        LOCAL_COMMAND    name: the command as typed ("/context")
        COMMAND_OUTPUT   text: what it printed
        TASK_NOTICE      notices: [{id, status, event, ended, waiting}]
        any kind         loaded: [(path, [(n, line)], how)], files whose lines the note gives the agent
    """
    kind: str
    role: Optional[str] = None
    text: Optional[str] = None
    words: Optional[str] = None
    tool: Optional[ToolCall] = None
    result: Optional[ToolResult] = None
    cwd: Optional[str] = None
    opaque: bool = False
    detail: Dict[str, Any] = field(default_factory=dict)


class RenameError(ValueError):
    """A name the harness's own store could not be given (`Harness.rename`): why, in a few words."""


class AnswerError(ValueError):
    """A choice that does not answer what the harness asks (`Harness.answer_keys`): why, in a few words."""


class InstructionsError(ValueError):
    """Instructions the harness cannot be given for a run (`Harness.instruction_args`): why, in a few words."""


def picked(ask: dict, choice: dict) -> List[dict]:
    """Each question of a question `ask` with what `choice` picked for it: {question, multi, count (its options),
    places (the picked options', from 0), labels (theirs), text (the reader's own answer, or None)}. `choice`:
    {"answers": [one per question: {"options": [places], "text": the reader's own words, or None}]}. Raises
    AnswerError where it does not fit."""
    questions = ask.get("questions") or []
    answers = choice.get("answers")
    if not questions or not isinstance(answers, list) or len(answers) != len(questions):
        raise AnswerError(f"an answer for each of the {len(questions)} questions, please")
    out = []
    for q, a in zip(questions, answers):
        a = a if isinstance(a, dict) else {}
        q = {**q, "question": q.get("question") or q.get("title")}      # codex's async one: {title, options: [label]}
        labels = [(o.get("label") or "") if isinstance(o, dict) else str(o) for o in q.get("options") or []]
        places = a.get("options") or []
        text = a.get("text") if isinstance(a.get("text"), str) and a["text"].strip() else None
        if not all(isinstance(i, int) and 0 <= i < len(labels) for i in places) or len(set(places)) != len(places):
            raise AnswerError(f"no such option for {q.get('question')!r}")
        if text is not None and (q.get("multiSelect") or places):
            raise AnswerError(f"your own answer to {q.get('question')!r} is the answer: no option with it")
        if text is not None and ("\r" in text or "\n" in text or "\x1b" in text):
            raise AnswerError("your own answer on one line, please")
        if text is None and not places:
            raise AnswerError(f"nothing picked for {q.get('question')!r}")
        if not q.get("multiSelect") and len(places) > 1:
            raise AnswerError(f"one option for {q.get('question')!r}")
        out.append({"question": q.get("question") or "", "multi": bool(q.get("multiSelect")), "count": len(labels),
                    "places": sorted(places), "labels": [labels[i] for i in sorted(places)], "text": text})
    return out


def one_line(text) -> str:
    """The reader's own words for a plan, on one line."""
    text = text if isinstance(text, str) else ""
    if not text.strip() or any(c in text for c in "\r\n\x1b"):
        raise AnswerError("what to change, on one line, please")
    return text.strip()


class Box:
    """What a message typed into the harness's terminal now would go into, as its screen shows (`Harness.box`)."""
    EMPTY = "empty"      # its message box, empty and with the keys: the message goes in, and Enter sends it
    HOLDS = "holds"      # its message box has the keys but holds something not sent: the message would join it
    AWAY = "away"        # something else has the keys -- a dialog, a menu, a question, a permission asked: Enter
                         # would pick in it, and the message be lost


def rule(line: str) -> bool:
    """A row of a screen that is one of a message box's rules: "─" across it, a label in it or not."""
    line = line.strip()
    return len(line) >= 20 and line.count("─") >= 0.8 * len(line)


def typed_in(screen, first: int, last: int, start: int = 0) -> str:
    """What is typed in rows `first`..`last` of `screen` (harness_kit.screen's), from column `start` of the first: a
    box's placeholder, drawn faint, left out."""
    out = []
    for r in range(max(0, first), min(last, screen.rows - 1) + 1):
        out += [ch for ch, st in screen.cells(r)[start if r == first else 0:] if not st.faint]
        out.append("\n")
    return "".join(out).replace("\xa0", " ")


class Harness(ABC):
    """One harness's rules. Subclasses implement `items` and `read`; `call` says what a request
    is (None by default: the harness's calls not known). `name` is how ag and the dashboard name it,
    `label` how a person does, `checked_with` the harness's version the rules were read from."""
    name: str = ""
    label: str = ""
    checked_with: str = ""

    # ---- level 1: one model call

    def call(self, method: str, path: str, headers, body) -> Optional[Call]:
        """What the request is, or None: not a model call this harness's rules know."""
        return None

    def title(self, reply: List[Part]) -> Optional[str]:
        """A title call's answer, as the title it gives: the reply's words, by default."""
        return _said(reply)

    def recap(self, reply: List[Part]) -> Optional[str]:
        """A recap call's answer, as the recap it gives: the reply's words, by default."""
        return _said(reply)

    # ---- levels 2 and 3: its pieces, and the tool calls among them

    @abstractmethod
    def items(self, history: list) -> list:
        """The conversation as pieces, in order: each one thing said, as the harness sent it."""

    @abstractmethod
    def read(self, items: list) -> List[Part]:
        """Each piece read, one Part per piece, in order. The whole list, because what a piece is may
        depend on its neighbours."""

    def read_one(self, payload) -> List[Part]:
        """A stored piece read on its own (its neighbours not known): one Part per piece it splits into."""
        return self.read(self.items([payload]))

    def words(self, text: str) -> tuple:
        """(the Kind, the user's words as they typed them) of the text of a message in the user's name -- the harness's
        wrappers around them taken off. By default, the text as it is."""
        return Kind.USER, text

    # ---- a session's name, as the harness keeps it

    def rename_command(self, name: str) -> Optional[str]:
        """What to submit in the harness's terminal, while the session runs there and its turn is over, to give it
        `name` -- so the running harness holds it too, and keeps it in its own records (Claude Code's and codex's
        `/rename`); None: it has no command that takes the name as typed (`rename` alone, then)."""
        return None

    def rename(self, session: str, name: str, record: Optional[str] = None, env: Optional[Dict[str, str]] = None) -> str:
        """The session given `name` in the harness's own store, where its list of sessions to resume, and its next
        run, read it: `record`, the session's own file, for a harness that keeps the name there; `env`, the
        environment the harness runs in. What was done, in a few words. Raises RenameError where it cannot."""
        raise RenameError(f"{self.label or self.name or 'this harness'} keeps no name ag can set")

    # ---- run in a terminal: started, and what it asks there answered

    def command(self, session: str, resume: bool = False, model: Optional[str] = None,
                permission_mode: Optional[str] = None, fullscreen: bool = True,
                instructions: Optional[str] = None) -> List[str]:
        """Its own arguments for `session` run in a terminal, after its name on ag's command line (`ag ... <name>`):
        `resume`, a session it has had before; `model`, None its own default; `permission_mode`, what it may do
        unasked ("auto", "acceptEdits", "plan", "bypassPermissions", as Claude Code names them); `fullscreen`, its
        full-screen interface where it has another; `instructions`, added to its own system prompt for this run
        (`instruction_args`). The message it starts with goes after them, after `--`."""
        raise NotImplementedError(f"{self.label or self.name or 'this harness'} is not run in a terminal here")

    def first_prompt(self, text: str) -> List[str]:
        """Its own arguments that start a session in its terminal with `text` as the first message, after `command`'s:
        by default after `--`, so the message is never read as an option."""
        return ["--", text]

    def instruction_args(self, text: str) -> List[str]:
        """Its own options that add `text` to the instructions it gives its model, for one run -- given again on each
        run, as the harness keeps none of it with the session. Raises InstructionsError where it takes none."""
        raise InstructionsError(f"{self.label or self.name or 'this harness'} takes no instructions ag can add")

    def models(self, env: Optional[Dict[str, str]] = None) -> dict:
        """The models a new session can run on, as the harness lists them: {"models": [{slug, name, description}],
        "default": the one its config names, if any}. None listed by default: it runs its own default."""
        return {"models": [], "default": None}

    def answer_keys(self, ask: dict, choice: dict) -> List[str]:
        """The keys that answer `ask` -- what it asks in its terminal ({kind: "question", questions} or {kind:
        "plan"}, as an `asked` event has it) -- with `choice` (`picked`'s; a plan's {"plan": how, "text"}), each typed
        on its own into the dialog as it first shows. Raises AnswerError where the choice does not fit."""
        raise AnswerError(f"{self.label or self.name or 'this harness'} can't be answered from here")

    def answer_expected(self, ask: dict, choice: dict) -> List[str]:
        """What the harness records as the answer once it has `choice`: each of these strings, somewhere in it."""
        return []

    def box(self, screen) -> Optional[str]:
        """Where a message typed into its terminal now would go, as `screen` -- harness_kit.screen's Screen, fed what
        the terminal printed -- shows it: a Box. None by default: the harness does not say (typed in, as it is)."""
        return None

    def answer_summary(self, ask: dict, choice: dict) -> str:
        """The answer in a line: "Which color? → Blue · Which pets? → Cat, Fish"."""
        return " · ".join(f"{p['question']} → {p['text'].strip() if p['text'] is not None else ', '.join(p['labels'])}"
                          for p in picked(ask, choice))

    # ---- what its calls and answers say happened, besides the conversation

    #: Whether what it asks in its terminal is in its own record of each session (its follower's `asked`): then its
    #: answers' asking calls are not read for it again.
    asks_recorded = False

    def derived(self, parts: List["Part"], at: float, history: Optional[list] = None) -> List["Fact"]:
        """The facts pieces of a call or an answer say (`parts`, read; `history`, the conversation they came with, its
        pieces as the harness sent them) -- what it asks the user, a background task its tool's result says started,
        resumed or was stopped, a task's notice -- each keyed by the harness's own ids, so the same piece read again
        is the same fact; `at`, when they were seen. None by default."""
        return []

    # ---- its own record of a session

    def record_path(self, session: str, cwd: Optional[str] = None, config: Optional[str] = None) -> Optional[str]:
        """The file the harness keeps its record of `session` in, if there is one now: `cwd`, where the session runs;
        `config`, the harness's own folder for this session (None: as the environment, or the harness, has it).
        None by default: no record known."""
        return None

    def follower(self, path: str) -> Optional["Follower"]:
        """A reader of the record at `path`, from its start (None by default: no record known)."""
        return None


class Facts:
    """What a harness's record says happened, besides what its model calls carry -- and what its calls and answers say
    of it besides the conversation (`Harness.derived`): each fact's type, the event it becomes in the gatherer. Each
    fact's data:

        message_queued     queued (its key), text (as the harness keeps it), words (as the user typed it): a message
                           written while the agent works, held until it can be sent
        message_sent       queued (the key of the message_queued it was; None: sent at once, between turns), text,
                           words, how ("mid_turn": into the turn that ran; "next": as the next turn's first, once the
                           turn ended; "prompt": at once, between turns), joins (part of the turn it was written in),
                           written (when it was written)
        message_withdrawn  queued: taken back before it was sent
        asked              call (its tool call's id, or "plan:<turn>"), kind ("question" or "plan"), questions or
                           plan, async (the turn goes on while it asks), turn: what the harness asks the user in its
                           terminal -- from its record where no model call says so, else from the answer that asks
        ask_settled        call, how ("answered" or "dismissed"), result (what the harness recorded as its answer;
                           None: none, or not known yet): it no longer waits on it
        turn_stopped       how ("over", "interrupted": Esc; "error": it gave up on a model call), error, status (the
                           error's HTTP status), turn
        task_started       task, kind ("agent", "command", "monitor", "workflow"), label, output (the file it writes
                           to), how ("started", "resumed"): a background task it went on without
        task_ended         task, kind, status (as its notice says: "completed", "failed", "killed", "stopped"), report
                           (what an agent answered, once known)
        task_activity      task, event (a monitor's, or an agent waiting on its own background work; None: its output
                           grew): a sign that a background task lives
        name               text, by (the harness's name): the harness's own name for the session, as it made it --
                           the same event a proxy hook records of a title the harness asked for (records.py's `name`)
    """
    MESSAGE_QUEUED = "message_queued"
    MESSAGE_SENT = "message_sent"
    MESSAGE_WITHDRAWN = "message_withdrawn"
    ASKED = "asked"
    ASK_SETTLED = "ask_settled"
    TURN_STOPPED = "turn_stopped"
    TASK_STARTED = "task_started"
    TASK_ENDED = "task_ended"
    TASK_ACTIVITY = "task_activity"
    NAMED = "name"
    ALL = (MESSAGE_QUEUED, MESSAGE_SENT, MESSAGE_WITHDRAWN, ASKED, ASK_SETTLED, TURN_STOPPED, TASK_STARTED, TASK_ENDED,
           TASK_ACTIVITY, NAMED)


@dataclass
class Fact:
    """One thing a harness's record says happened: its `type` (of Facts), `key` -- what makes it the same fact when
    the record is read again: the line that says it, by its place in the file and its bytes (`follow`) -- `at`, when it
    happened as the record says (seconds since the epoch; None: not said), and `data`, as Facts has it."""
    type: str
    key: str
    at: Optional[float]
    data: Dict[str, Any] = field(default_factory=dict)


class Follower:
    """A harness's record of one session, read as it grows: `take` each line it `wanted`, in order -- what it keeps
    between lines (a queue, the questions open) its own -- and `due`, what is known only once time has passed with
    no line to say otherwise. A subclass gives `take`, and `wanted` where most lines are not worth parsing.

    A record that is not a file of lines (agy's, a database whose rows change in place) is read by the follower
    itself: it gives `read_on`, `stamp` and `anew`, and says it is one (`database`), so its reads go off the hook's
    loop."""

    #: Whether its record is a database it reads itself (`read_on`), not a file of lines.
    database = False

    def stamp(self, path: str) -> Optional[Tuple[int, int, int]]:
        """What tells the record changed since it was last read: (inode, size, mtime in ns) of its file; None when it
        is not there. The third is when it was last written."""
        try:
            st = os.stat(path)
        except OSError:
            return None
        return st.st_ino, st.st_size, st.st_mtime_ns

    def anew(self, now: Tuple[int, int, int], seen: Tuple[int, int, int], offset: int) -> bool:
        """Whether the record was written anew since it was `seen` (`stamp`'s), so to be read again from its start:
        another file at its path, or a shorter one than was read (`offset`)."""
        return now[0] != seen[0] or now[1] < offset

    def read_on(self, path: str, offset: int) -> Tuple[List["Fact"], int]:
        """(its facts past `offset`, where the next read goes on from): its whole lines (`follow`), by default."""
        return follow(path, self, offset)

    def wanted(self, line: bytes) -> bool:
        return True

    def take(self, line: bytes, at: str) -> List[Fact]:
        """The facts `line` says; `at` names the line (`follow`), the key of each fact it gives."""
        return []

    def due(self, now: float) -> List[Fact]:
        """The facts that came due by `now` (time.time())."""
        return []


CHUNK = 1 << 22                 # a record is read this much at a time


def follow(path: str, follower: Follower, offset: int = 0) -> Tuple[List[Fact], int]:
    """(the facts of every whole line of `path` past `offset`, where the next read goes on from): a line still being
    written is read with the next. A line longer than CHUNK is skipped (no line worth reading is that long). Each line
    is named by its place in the file and a checksum of its bytes ("<offset>.<crc32>"): read again, the same line is
    the same; a file written anew has other lines at the same places."""
    facts: List[Fact] = []
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as fh:
            fh.seek(offset)
            while offset < size:
                chunk = fh.read(min(CHUNK, size - offset))
                end = chunk.rfind(b"\n") + 1
                if not end:
                    if len(chunk) < CHUNK:
                        break                                   # a line still being written
                    end = len(chunk)                            # a line longer than CHUNK: not one to read
                at = offset
                for line in chunk[:end].split(b"\n")[:-1]:
                    if line.strip() and follower.wanted(line):
                        facts += follower.take(line, f"{at}.{zlib.crc32(line):08x}")
                    at += len(line) + 1
                offset += end
                fh.seek(offset)
    except OSError:
        pass
    return facts, offset


def seconds(stamp) -> Optional[float]:
    """An ISO 8601 time as a record writes it ("2026-10-26T12:00:00.000Z"), in seconds since the epoch; None if not one."""
    try:
        got = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return None
    return (got if got.tzinfo else got.replace(tzinfo=timezone.utc)).timestamp()


def _said(reply: List[Part]) -> Optional[str]:
    text = "\n".join(p.text or "" for p in reply if p.kind == Kind.AGENT).strip()
    return text or None


def output_of(value) -> str:
    """A tool result's words, as a reader sees them: a string, or the text of its blocks ("[image]" for an image,
    "Loaded <tool>" for a tool a tool search loaded)."""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        words = []
        for b in value:
            if isinstance(b, str):
                words.append(b)
            elif isinstance(b, dict):
                if isinstance(b.get("text"), str):
                    words.append(b["text"])
                elif b.get("type") in ("image", "input_image"):
                    words.append("[image]")
                elif b.get("type") == "tool_reference" and b.get("tool_name"):    # tool search: a tool loaded
                    words.append(f"Loaded {b['tool_name']}")
        return "\n".join(words)
    if isinstance(value, dict):
        for k in ("output", "content", "text"):
            if k in value:
                return output_of(value[k])
    return "" if value is None else json.dumps(value, ensure_ascii=False)
