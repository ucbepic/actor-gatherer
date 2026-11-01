"""The files a session worked on, one turn at a time: for each file, the calls that touched it,
each with what it did -- the lines it read (by the Read tool, or by a shell command that only
prints part of a file: `sed -n`, `cat`, `head`, `tail`, `nl`, `grep -n`), the matches it found, or
what it changed, at the lines where: by an edit tool, or by a shell command whose change can be
read from it (`cat > F <<EOF`, `tee`, `sed -i`, a Python script that replaces constant strings in a
file and writes it back).

A codex code-mode call (`exec`: a script that calls the other tools) is read as the calls its script
makes (commands.opened_script), each in the list of commands and touching files as itself would.

A turn is what follows one of the user's messages, up to the next -- not counting one written while
the turn ran (Claude Code sent it mid-turn, or held it until the turn ended), which is part of it. Each call is read from the
event's parts (data.parts), so whichever harness wrote it; only the tools' names differ.

Where ag's hook server checked a call against the disk as it ran (`file_touched` events, recorded by
ag/integrations/tools/ag_orchestrator/file_touches/), that is what is shown of it: the files it read, kept where the
file says so, each marked checked (what the call showed of it is on disk) or not; what it changed,
at the lines the file itself says; and the files that changed while it ran, which it doesn't name.
A change it found to a file in ag's home (the databases and logs ag writes as calls run) is left out
unless the call says it writes the file -- as the hook server now does itself, for what it kept before.
What git changed (a pull, a merge, a checkout, a new work tree: `_git`) is told apart from the call's own
changes: the files changed by a call that ran git, and by any other call as one ran git, in any session.

Any other call (one from before the hook checked calls) is read from what the model saw alone
(harness_kit/shell.py): a Read's lines carry their numbers, but an edit carries only the text it
replaced. An edit is placed by finding that text among the lines seen of the file so far in the
session (earlier turns too); one that is not found is listed apart. The files themselves are never
read here: they show what the agent saw then, not what is there now."""
import base64
import binascii
import difflib
import json
import os
import re
import tempfile
import threading
import time
from typing import Dict, List, Optional

import harness_kit
from harness_kit import Kind, Shape, ToolCall

from . import data, work
from . import home as paths
from harness_kit.shell import (  # noqa: F401 - python_changes: tested here
    GLOB, GREP_PATH_LINE, READ_LINE, _patch_files, _resolve, python_changes, runs_git, shell_changes, shell_reads,
    worktrees_added)

MAX_ROWS = 4000            # the most lines one file shows in a turn
HELD_SECONDS = 30          # a message held until its turn ended: stored this close to when Claude Code sent it
LINE_CHARS = 400           # the most of one line's text sent
COMMAND_OUTPUT = 4000      # the most of a command's output sent
CONTEXT = 2                # the lines known around a change shown with it
LATELY = 600.0             # seconds: a session's changes this recent count as where it works now, besides its latest turn's
GIT_WINDOW = 600.0         # seconds: how long ag's watcher keeps a change it saw (file_touches/watch.py's KEEP_SECONDS) --
                           # a call of another session's stored this close to one running git may have been found to
                           # make git's changes
SAME_ANSWER = 1.0          # seconds: calls of one session stored this close were made in one answer, run side by side
def _view(part: dict) -> dict:
    """How a call is shown, as its harness's rules read it (data.parts' `view`: harness_kit's ToolCall.view); {} where
    no rules read it."""
    v = part.get("view")
    return v if isinstance(v, dict) else {}


def _command(part: dict) -> tuple:
    """A shell call's command and the directory it runs in (None: the session's), as its harness's rules read it; ("",
    None) for any other call."""
    v = _view(part)
    if v.get("shape") != Shape.SHELL:
        return "", None
    return str(v.get("command") or ""), v["cwd"] if isinstance(v.get("cwd"), str) and v["cwd"] else None


def _shown(result: Optional[dict]) -> str:
    """A call's output as it printed it: its harness's own lines about the run taken off (data.parts' `shown`)."""
    result = result or {}
    return str(result.get("shown", result.get("text")) or "")


def _unsplit(shell: bool, text: str) -> dict:
    """A file a call read whose lines can't be told apart from the rest of its output (`cat a; cat b`),
    or one a Read showed no numbered lines of: the call's whole output (`text`, as it printed it), said to be that."""
    text = (text or "").rstrip("\n")
    if not text:
        return {"t": "note", "text": "read, but the output was empty"}
    note = ("the command's whole output: this file's lines are in it, but which ones can't be told apart from the rest"
            if shell else "the call's whole output: it shows none of the file's lines by number")
    return {"t": "output", "note": note, "lines": text.split("\n")}


def _temporary_roots() -> tuple:
    roots = set()
    for r in ("/tmp", "/private/tmp", "/var/tmp", "/var/folders", tempfile.gettempdir(), os.environ.get("TMPDIR") or ""):
        if r:                                                          # macOS's /tmp is /private/tmp: named
            roots |= {os.path.normpath(r), os.path.realpath(r)}        # either way, on any system
    return tuple(sorted(roots))


TEMPORARY = _temporary_roots()   # the temporary folders: /tmp, macOS's per-user /var/folders/..., $TMPDIR


def _harness_folders() -> tuple:
    """Every harness's own folders and files (harness_kit's `own_folders`), as given and resolved."""
    return tuple(sorted({p for h in harness_kit.HARNESSES.values() for f in h.own_folders()
                         for p in (os.path.abspath(f), os.path.realpath(f))}))


# the harnesses' own folders -- the sessions' transcripts, plans, memory -- and their settings files
HARNESS_FOLDERS = _harness_folders()


def _under(path: str, roots) -> bool:
    return any(path == r or path.startswith(r.rstrip("/") + "/") for r in roots)


def ags(path: str) -> bool:
    """Whether `path` is in ag's home (AG_HOME, ~/.ag), whose files ag itself writes as calls run: its
    databases at every model call, its logs."""
    return _under(path, {paths.HOME, os.path.realpath(paths.HOME)})


def says_writes(part: dict, cwd: str) -> set:
    """The files a call says it changes, as its harness's rules show it (its view): a write's or an edit's file, a
    patch's, or a shell command's that says so."""
    v = _view(part)
    shape = v.get("shape")
    if shape == Shape.SHELL:
        command, workdir = _command(part)
        return {p for p, _, _ in shell_changes(command, _resolve(workdir, cwd) if workdir else cwd)[0]}
    if shape in (Shape.WRITE, Shape.EDIT):
        return {_resolve(v["path"], cwd)} if isinstance(v.get("path"), str) and v["path"] else set()
    if shape == Shape.PATCH:
        return {_resolve(p, cwd) for p, _, _ in _patch_files(str(v.get("patch") or ""))}
    return set()


def temporary(path: str) -> bool:
    """Whether `path` is in a temporary folder: a scratchpad's, a test's -- not the work itself."""
    return _under(path, TEMPORARY)



# ------------------------------------------------------------------ a file's lines, as known

class Sheet:
    """A file's lines by number, as far as they were seen in the session, kept current through the
    changes made to it: each {text}."""

    def __init__(self):
        self.rows: Dict[int, dict] = {}

    def text(self, n: int) -> Optional[str]:
        r = self.rows.get(n)
        return None if r is None else r["text"]

    def replace(self, at: int, old: List[str], new: List[str]) -> None:
        """Lines at..at+len(old)-1 replaced by `new`; the lines after moved along."""
        shift, end = len(new) - len(old), at + len(old)
        rows = {n if n < at else n + shift: r for n, r in self.rows.items() if n < at or n >= end}
        for i, t in enumerate(new):
            rows[at + i] = {"text": t}
        self.rows = rows


def place(known: Sheet, old: str, new: str):
    """Where `old` is among the lines known of a file: (first line, the whole lines it lies in, those
    lines with `new` in its place), or None when it is not there in full."""
    if not old:
        return None
    k = old.count("\n") + 1
    head = old.split("\n")[0]
    for a in sorted(known.rows):
        first = known.rows[a]["text"]
        if head not in first:
            continue
        span = [known.text(a + i) for i in range(k)]
        if any(t is None for t in span):
            continue
        joined = "\n".join(span)
        i = joined.find(old)
        if i < 0 or i > len(span[0]) or i + len(old) < len(joined) - len(span[-1]):
            continue
        return a, span, (joined[:i] + new + joined[i + len(old):]).split("\n")
    return None


# ------------------------------------------------------------------ the session, turn by turn

#: What the agent said and did: shown though a call that carried it was hung up on (`_events`).
AGENTS_OWN = ("agent_message", "agent_reasoning", "tool_call", "tool_output")


def _events(conn, channel: str, stops: List[dict] = ()):
    """The channel's events, oldest first, then what it has pending: (row_id, type, at, parts, said) -- parts unclipped,
    the lines of a long read all there; `said`, a user message's (kind, words) as its harness's rules read them when
    it was stored (its `kind` and `words` properties), else None: read here, from its parts. Not the user's message the
    harness took back (Esc before any of its answer came), nor what came with it (`_withdrawn`; data.py's
    `withdrawn_reads`): a call hung up on withdraws all it stored -- the turns before it, sent with it, among them, and
    the agent's own (AGENTS_OWN) -- but the harness keeps all that, and all of the call where the answer had begun, its
    record saying the turn was interrupted after (`stops`). A skill's instructions (its `kind` SKILL) carry in their note
    part the call that loaded them (`loaded_by`: its `call_id` property), which names the skill where they don't."""
    columns = data._columns(conn, "events")
    said = "e.p_kind, e.p_words" if {"p_kind", "p_words"} <= columns else "NULL AS p_kind, NULL AS p_words"
    said += ", e.p_call_id" if "p_call_id" in columns else ", NULL AS p_call_id"
    tables, kept = data._tables(conn), ""
    if "_withdrawn" in tables:
        back = data.withdrawn_reads(conn, channel, tables, [s["at"] for s in stops if s["kind"] == "interrupted"])
        taken = " OR ".join(f"(w.read_id = {int(r)} AND w.row_id >= {int(w['said_row'])})"
                            for r, w in back.items() if w["said"] and not w["kept"])
        own = ", ".join(f"'{t}'" for t in AGENTS_OWN)
        kept = (f" AND (t.name IN ({own}) OR e.row_id NOT IN (SELECT w.row_id FROM _withdrawn w WHERE w.read_id IS NULL"
                + (f" OR {taken}" if taken else "") + "))")
    rows = conn.execute(
        f"SELECT e.row_id, t.name AS type, e.text, e.payload_json, e.inserted_at, {said} FROM events e "
        f"LEFT JOIN event_types t ON t.event_type_id = e.event_type_id WHERE ifnull(e.{data.CHANNEL}, '') = ? "
        f"AND {data.NOT_RECORD}{kept} ORDER BY e.row_id", (channel,)).fetchall()
    harness = data._harness(conn, channel)
    for r in rows:
        parts = data.parts(r["type"] or "?", r["payload_json"], r["text"], None, harness, r["p_kind"])
        if r["p_kind"] == Kind.SKILL and r["p_call_id"]:
            for p in parts:
                if p["kind"] == "note":
                    p["loaded_by"] = r["p_call_id"]
        yield (r["row_id"], r["type"] or "?", data._seconds(r["inserted_at"]), parts,
               (r["p_kind"], r["p_words"]) if r["p_kind"] and r["p_words"] is not None else None)
    for r in data.replies(conn, channel):
        yield None, r["type"], data._seconds(r["received_at"]), data.parts(r["type"], r["payload_json"], r["text"], None, harness), None


def _touches(conn, channel: str) -> Dict[str, List[dict]]:
    """What the hook server found each of the session's calls did to files, by call id (none: the
    call was not checked): [{path (None: it touched none), how, checked, named, detail}] -- as it recorded them
    (`file_touched`; an older gatherer's `_touches` copied there once)."""
    out: Dict[str, List[dict]] = {}
    flag = lambda v: None if v is None else int(bool(v))          # noqa: E731 - 1, 0 or None, as the page reads them
    for (raw,) in conn.execute(f"SELECT e.payload_json FROM events e JOIN event_types t ON {data.BY_CHANNEL} "
                               f"WHERE ifnull(e.{data.CHANNEL}, '') = ? AND t.name = 'file_touched' ORDER BY e.row_id",
                               (channel,)):
        t = data._json(raw) or {}
        if t.get("call"):
            out.setdefault(t["call"], []).append({"path": t.get("path"), "how": t.get("how"), "checked": flag(t.get("checked")),
                                                  "named": flag(t.get("named")),
                                                  "detail": t["detail"] if isinstance(t.get("detail"), dict) else {}})
    return out


def _sent(conn, channel: str) -> List[tuple]:
    """The messages the session sent other actors of its gatherer (`ag actors send`, `new`), as the dashboard kept them
    (coordination.py's `actor_message`), oldest first: [(row_id, {kind, to, to_name, text, at})]."""
    out = []
    for row_id, raw in conn.execute(f"SELECT e.row_id, e.payload_json FROM events e JOIN event_types t ON {data.BY_CHANNEL} "
                                    f"WHERE ifnull(e.{data.CHANNEL}, '') = ? AND t.name = 'actor_message' ORDER BY e.row_id",
                                    (channel,)):
        m = data._json(raw) or {}
        if isinstance(m.get("text"), str):
            out.append((row_id, {k: m.get(k) for k in ("kind", "to", "to_name", "text", "at")}))
    return out


_GIT: Dict[str, tuple] = {}   # a gatherer's database -> (the last row read, what git did up to it: `_git`'s)
_GIT_LOCK = threading.Lock()


def _git(conn) -> dict:
    """What git did to files in any of the gatherer's sessions, as ag's hook found it: {calls: {id: (when stored,
    session)} -- the calls that ran git so as to change a checkout's files (`runs_git`: a pull, a merge, a checkout,
    `git worktree add` ...); changed: {path: [(when, session, call, how)]} -- the files they changed, and how (created,
    modified, deleted); trees: [{root, call, at}] -- the work trees `git worktree add` made, each told by the `.git` file
    it writes at the root ("gitdir: <repository>/.git/worktrees/<name>"), which the hook found a call (`call`: the one
    that made it, or one running then, of any session) created, recorded at `at`}. Kept, and read on from the last row
    read: a gatherer's calls and what they did to files are many, the ones that ran git a few."""
    types = dict(conn.execute("SELECT name, event_type_id FROM event_types WHERE name IN ('tool_call', 'file_touched')"))
    if "file_touched" not in types:
        return {"calls": {}, "changed": {}, "trees": []}
    path = next((r[2] for r in conn.execute("PRAGMA database_list") if r[1] == "main"), "")
    top = conn.execute("SELECT max(row_id) FROM events").fetchone()[0] or 0
    with _GIT_LOCK:
        last, got = _GIT.get(path, (0, None))
        if got is None or top < last:                # not read before, or not the database read before: made again since
            last, got = 0, {"calls": {}, "changed": {}, "trees": []}
        if top == last:
            return got
        call, touch = types.get("tool_call", -1), types["file_touched"]
        harnesses: Dict[str, Optional[str]] = {}         # each channel's harness, as its calls recorded it
        of = lambda key: f"CASE WHEN event_type_id = {touch} THEN json_extract(payload_json, '$.{key}') END"   # noqa: E731
        for typ, session, inserted, raw, cid, at_path, how, gitdir in conn.execute(
                f"SELECT event_type_id, p_channel, inserted_at, CASE WHEN event_type_id = ? THEN payload_json END, {of('call')}, "
                f"{of('path')}, {of('how')}, CASE WHEN event_type_id = ? AND payload_json LIKE '%gitdir: %' THEN payload_json END "
                "FROM events WHERE event_type_id IN (?, ?) AND row_id > ? AND row_id <= ? "
                "AND (event_type_id = ? OR text IS NULL OR text LIKE '%git%') ORDER BY row_id",
                (call, touch, call, touch, last, top, touch)):
            at, session = data._seconds(inserted), session or ""
            if typ == call:                          # a call: whether it ran git, read by its channel's harness's rules
                if session not in harnesses:
                    harnesses[session] = data._harness(conn, session)
                for part in data.parts("tool_call", raw, None, None, harnesses[session]):
                    ran = [part] + list(part.get("calls") or [])                   # a script's calls, each
                    if part.get("kind") == "call" and part.get("id") and any(runs_git(_command(q)[0]) for q in ran):
                        got["calls"][part["id"]] = (at, session)
                continue
            if cid in got["calls"] and how in ("created", "modified", "deleted") and isinstance(at_path, str):
                got["changed"].setdefault(at_path, []).append((at, session, cid, how))
            t = data._json(gitdir) if gitdir else None
            lines = t["detail"].get("lines") if isinstance(t, dict) and isinstance(t.get("detail"), dict) else None
            if lines and how == "created" and cid and isinstance(at_path, str) and at_path.endswith("/.git") \
                    and str(lines[0]).startswith("gitdir: "):
                got["trees"].append({"root": at_path[:-len("/.git")], "call": cid, "at": at})
        _GIT[path] = (top, got)
        return got


TOUCH_KINDS = {"read": "read", "hit": "hit", "created": "write", "modified": "edit", "deleted": "delete"}
STOPS_READ = 1000          # the newest of a session's turns stopped short, as its record says, read


def _stops(conn, channel: str) -> List[dict]:
    """How the session's turns stopped short, as its harness's own record said as it was written (`turn_stopped`, as
    data.Record.stopped reads the newest): [{kind: "interrupted" (Esc) or "error" (it gave up on a model call), at,
    text: the error's words, status: its HTTP status, reason: why codex aborted it ("interrupted", "budget_limited")}],
    oldest first. Not the turns that ended as they do."""
    out = []
    for _, f in data._facts(conn, channel, ("turn_stopped",), STOPS_READ):
        if f.get("how") in ("interrupted", "error") and isinstance(f.get("at"), (int, float)):
            out.append({"kind": f["how"], "at": f["at"], "text": data._clip(f.get("error"), data.ERROR_CHARS) or None,
                        "status": f.get("status") if isinstance(f.get("status"), int) else None,
                        "reason": f.get("reason") if isinstance(f.get("reason"), str) else None})
    return out


def _interrupted(part: dict) -> bool:
    """Whether a note of the harness's in the conversation is its note that the user stopped the turn (Esc), sent with
    the next, as its rules read it (INTERRUPT: Claude Code's "[Request interrupted by user]", codex's <turn_aborted>)."""
    return (part.get("said") or {}).get("kind") == Kind.INTERRUPT


def _turn_starts(evs: list, held: List[dict]) -> tuple:
    """Where the session's turns start, of its events (`_events`'): ([(index, row_id, at, text, kind)], more) -- `more`,
    what the user wrote while a turn ran, by the turn's number: [{row_id, at, text, kind}]. A message written while a turn
    ran is part of it, not a turn of its own: one Claude Code sent mid-turn (wrapped), or held until the turn ended and
    sent then, as its record says (`held`, data.py's `meanwhile`: matched by its words, stored as it was sent -- taken
    out of it as matched); and codex's answers to what it asked as it worked (ASK_REPLY), which it sends as the user's
    while the turn runs."""
    starts, more = [], {}
    for i, (row_id, typ, at, parts, stored) in enumerate(evs):
        said = [p["text"] for p in parts if p["kind"] == "text" and p.get("role") == "user"]
        if said and typ == "user_message":
            kind, text = stored or harness_kit.words(said[0])   # the user's words, its harness's wrapper off
            meanwhile = kind in (Kind.MID_TURN, Kind.ASK_REPLY)
            if not meanwhile and at is not None:
                q = next((q for q in held if q["text"].strip() == said[0].strip() and abs(at - q["sent"]) <= HELD_SECONDS), None)
                if q is not None:
                    held.remove(q)
                    meanwhile = True
            if meanwhile and starts:
                more.setdefault(len(starts) - 1, []).append({"row_id": row_id, "at": at, "text": text.rstrip(), "kind": kind})
            else:
                starts.append((i, row_id, at, text, kind))
    return starts, more


def _runs(numbered: List[tuple]) -> List[tuple]:
    """Numbered lines [(n, text)] as runs of consecutive lines: [(start, [text, ...])]."""
    runs: List[tuple] = []
    for n, t in numbered:
        if runs and runs[-1][0] + len(runs[-1][1]) == n:
            runs[-1][1].append(t)
        else:
            runs.append((n, [t]))
    return runs


class _Turn:
    def __init__(self, n, row_id, at, text):
        self.head = {"n": n, "row_id": row_id, "at": at, "text": text, "replies": [], "now": None, "more": [],
                     "last": None, "end": None, "stopped": None,   # end: its last event's time
                     "calls": 0}                                   # as many as `commands` lists
        self.acts: Dict[str, dict] = {}              # its calls, by id, for what it is doing (work.summary)
        self.skill: Optional[list] = None            # its last call counted, a Skill's: [the skill asked, loaded yet]
        self.files: Dict[str, dict] = {}
        self.commands: List[dict] = []
        self.order: List[str] = []
        self.current: Optional[dict] = None              # the call being read, as `commands` lists it
        self.went_on: Optional[float] = None             # when a message written as it ran last joined it (ag stored it)
        self.at_call: Optional[float] = None             # when it was made (its sources' `at`)

    def file(self, path: str) -> dict:
        f = self.files.get(path)
        if f is None:
            f = self.files[path] = {"path": path, "sources": [], "kinds": set(), "git": set(), "created": False}
            self.order.append(path)
        return f

    def source(self, f: dict, via: str, kind: str, call: dict, error: bool, git: bool = False) -> int:
        """A call that touched `f`: the same call again (a read and a hit, five replacements) is one -- what git did as it
        ran (`git`) one apart, its kinds the file's `git`, not its `kinds`."""
        last = f["sources"][-1] if f["sources"] else None
        f["git" if git else "kinds"].add(kind)
        if self.current is not None and f["path"] not in self.current["files"]:
            self.current["files"].append(f["path"])
        if last and last["call"] is call and bool(last.get("git")) == git:
            last["kinds"] = sorted(set(last["kinds"]) | {kind})
            return len(f["sources"]) - 1
        f["sources"].append({"via": via, "kind": kind, "kinds": [kind], "error": error, "call": call, "blocks": [],
                             "at": self.at_call, **({"git": True} if git else {})})
        return len(f["sources"]) - 1

    def checked(self, f: dict, src: int, checked: Optional[bool], named: bool) -> None:
        """What the disk said of call `src`'s use of `f`: its lines there (True), not (False), not
        matched (None); `named`: the call names the file (else it changed while the call ran)."""
        s = f["sources"][src]
        if checked is not None:
            s["checked"] = checked if s.get("checked") is None else s["checked"] and checked
        else:
            s.setdefault("checked", None)
        if not named:
            s["unnamed"] = True

    @staticmethod
    def block(f: dict, src: int, b: dict) -> None:
        """What call `src` did to `f`: lines it read, matches it found, a change; matches gathered in one."""
        blocks = f["sources"][src]["blocks"]
        if b["t"] == "hits" and blocks and blocks[-1]["t"] == "hits":
            blocks[-1]["rows"] += b["rows"]
        else:
            blocks.append(b)


def _label(part: dict, cwd: str) -> str:
    """A call in a line, as its harness's rules show it (its view): a script's calls; its own description; a shell
    command's line; a subagent by its name; a question by what it asks; a skill loaded; the harness's own line for it;
    else its tool and what it worked on."""
    v, name = _view(part), part.get("name") or ""
    inp = part.get("input") if isinstance(part.get("input"), dict) else {}
    shape = v.get("shape")
    if part.get("calls"):                            # a script, as the calls it makes
        return " · ".join(_label(c, cwd) or c.get("name") or "" for c in part["calls"])[:200]
    if shape == Shape.SCRIPT:                        # a script that calls no tool: its first line
        first = next((x.strip() for x in str(v.get("code") or "").split("\n") if x.strip()), "")
        return f"Script {first}".strip()[:200]
    said = v.get("description") or inp.get("description")
    if isinstance(said, str) and said.strip():
        return said.strip()[:200]
    if shape == Shape.SHELL:
        return re.sub(r"^cd \S+ && ", "", _command(part)[0].strip().split("\n")[0])[:200]
    if shape == Shape.AGENT and v.get("name"):
        return f"Agent {v['name']}"[:200]
    if shape == Shape.ASK and v.get("arg"):
        return f"Ask: {v['arg']}"[:200]
    if shape == Shape.SKILL and v.get("name"):
        return f"Load skill {v['name']}{' ' + v['args'] if str(v.get('args') or '').strip() else ''}"[:200]
    if isinstance(v.get("label"), str) and v["label"]:
        return v["label"][:200]
    path = v.get("path") if shape in (Shape.READ, Shape.WRITE, Shape.EDIT) else inp.get("file_path") or inp.get("notebook_path")
    target = path if isinstance(path, str) and path else v.get("pattern") or v.get("query") or v.get("url") \
        or inp.get("pattern") or inp.get("query") or inp.get("url") or inp.get("skill") or inp.get("prompt") or ""
    if isinstance(target, str) and target == path:
        target = short_path(target, cwd)
    elif isinstance(target, str) and cwd and target.startswith(cwd.rstrip("/") + "/"):
        target = target[len(cwd.rstrip("/")) + 1:]
    return f"{tool_name(name)} {target if isinstance(target, str) else ''}".strip()[:200]


MCP_TOOL = re.compile(r"^mcp__([^_]+(?:_[^_]+)*)__(.+)$")                # an MCP server's tool: mcp__<server>__<tool>
# where a harness keeps its memory of a directory (harness_kit's `memory_folder`), and a file in it
MEMORY = re.compile("|".join(f"(?:{h.memory_folder})(?P<in{i}>/.*)?$" for i, h in enumerate(harness_kit.HARNESSES.values())
                             if h.memory_folder) or r"(?!)")


def tool_name(name: str) -> str:
    """A tool's name as read: an MCP server's as "server · tool"."""
    m = MCP_TOOL.match(name or "")
    return f"{m.group(1)} · {m.group(2)}" if m else name


def short_path(path: str, cwd: str) -> str:
    """A file's path in a call's line: from the session's directory; a file of a harness's memory of a directory as
    memory/<file>; else from the home folder (~), or whole."""
    if cwd and path.startswith(cwd.rstrip("/") + "/"):
        return path[len(cwd.rstrip("/")) + 1:]
    m = MEMORY.search(path)
    if m:
        return "memory" + next((v for v in m.groupdict().values() if v), "")
    home = os.path.expanduser("~")
    return "~" + path[len(home):] if path.startswith(home + "/") else path


def _opened(rules, part: dict, result: Optional[dict]) -> List[tuple]:
    """[(call, its result)]: a script's calls (codex's code mode), each with its own result, as its harness's rules
    split them (`script_results`) and the hook server checked them -- the last also with what the script printed
    (`printed`), shown as its output; any other call as it is."""
    inner, printed = rules.script_results(ToolCall(part.get("id"), part.get("name") or "", part.get("input")),
                                          None if result is None else (result.get("text") or "", bool(result.get("error")))) \
        if part.get("calls") and rules is not None else ([], "")
    if not inner:
        return [(part, result)]
    views = list(part.get("calls") or [])
    out = []
    for n, (iid, name, inp, got) in enumerate(inner, 1):
        own = views[n - 1] if n - 1 < len(views) else {}
        q = {k: v for k, v in part.items() if k != "calls"}
        q.update(id=iid, name=name, input=inp, view=own.get("view") or {}, action=own.get("action"))
        r = None if got is None else {k: v for k, v in dict(result, text=got[0], error=got[1],
                                                               printed=printed if n == len(inner) else got[0]).items()
                                      if k not in ("shown", "exit", "took")}       # the script's, not this call's
        out.append((q, r))
    return out


def _call_view(part: dict) -> dict:
    """A call as its source shows it: its tool, its input and its view (data.parts'), clipped."""
    return {"name": part.get("name"), "input": data._clip(part.get("input"), COMMAND_OUTPUT),
            "view": data._clip(_view(part), COMMAND_OUTPUT)}


# ------------------------------------------------------------------ the harness's notes, as the conversation shows them


def _json(text) -> Optional[dict]:
    """A tool's result that is a JSON object, as one; None for any other."""
    try:
        got = json.loads(text) if isinstance(text, str) else None
    except ValueError:
        return None
    return got if isinstance(got, dict) else None


NOTES = {Kind.SKILL: "skill", Kind.AGENT_REPORT: "report", Kind.PEER_MESSAGE: "peer", Kind.LOCAL_COMMAND: "command",
         Kind.COMMAND_OUTPUT: "printed"}
#: What a note's kind says that Chat shows (Part.detail), read by its harness's rules: one they read no more of (Claude
#: Code's <local-command-stdout>, its COMMAND_OUTPUT with no `text`) is not shown as one.
NEEDS = {"skill": ("instructions",), "report": ("text",), "peer": ("text",), "command": ("name",), "printed": ("text",)}


def _note(part: dict, loaded_by: Optional[dict] = None) -> Optional[dict]:
    """What a note of the harness's in the conversation is (`part`, as data.parts gives it), as the Chat view shows it --
    by its Kind and what that kind says, as its harness's rules read it (`said`: harness_kit's Part); None for a note
    of another kind:
        {kind: "skill", name, args, text}   a skill's instructions, loaded by the Skill tool or the user's /name -- or,
                                            stored as a skill's (`_events`), loaded by `loaded_by`, the Skill call
                                            ({} where it is not known), named by it where its instructions don't
        {kind: "report", from, text}        another session's message: a subagent's report as it hands back (codex's
                                            FINAL_ANSWER from another of its agents, `from` its agent path)
        {kind: "peer", name, text}          another session's message: one another Claude session sent this one
        {kind: "command", name}             a command the user ran that Claude Code runs itself (/context, /mcp): not
                                            shown, only matched with what was sent from the page
        {kind: "printed", text}             what a command the user ran with ! printed"""
    read = part.get("said") or {}
    kind, said = NOTES.get(read.get("kind")), read.get("detail") or {}
    if kind is None or not set(NEEDS[kind]) <= set(said):        # its rules read no more of it than its kind
        return None
    text = lambda k: str(said.get(k) or "")                     # noqa: E731
    if kind == "skill":
        inp = (loaded_by or {}).get("input") if isinstance((loaded_by or {}).get("input"), dict) else {}
        return {"kind": kind, "name": text("name") or str(inp.get("skill") or ""),
                "args": text("args") or str(inp.get("args") or ""), "text": text("instructions")}
    if kind == "report":
        return {"kind": kind, "from": text("from"), "text": text("text")}
    if kind == "peer":
        return {"kind": kind, "name": text("name"), "text": text("text")}
    if kind == "command":
        return {"kind": kind, "name": text("name")}
    if kind == "printed":
        return {"kind": kind, "text": text("text")[:COMMAND_OUTPUT]}
    return None


def _loaded(part: dict) -> List[tuple]:
    """The files a note of the harness's gives the agent the lines of, as its rules read it (Part.detail's `loaded`):
    [(path, [(n, line)], how)]."""
    return [tuple(x) for x in ((part.get("said") or {}).get("detail") or {}).get("loaded") or []]


def _changed(blocks: List[dict]) -> Optional[List[int]]:
    """The lines a call's changes to a file added and removed, [added, removed], counted as a diff counts them (the
    lines an edit's old and new text share left out); None when it made no change that can be counted: a read, a
    search, a file written whole over lines not seen."""
    added = removed = 0
    counted = False
    for b in blocks:
        if b["t"] == "diff":
            for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, b["old"], b["new"], autojunk=False).get_opcodes():
                if op != "equal":
                    removed, added = removed + i2 - i1, added + j2 - j1
            counted = True
        elif b["t"] == "append" or b["t"] == "write" and b.get("created"):
            ends = not b.get("cut") and b["lines"][-1:] == [""]     # its last newline: the end of a line, not one
            added += len(b["lines"]) + b.get("cut", 0) - ends
            counted = True
    return [added, removed] if counted else None


def _plus(a: Optional[List[int]], b: Optional[List[int]]) -> Optional[List[int]]:
    """Two counts of lines [added, removed] together; None for neither."""
    return a if b is None else b if a is None else [a[0] + b[0], a[1] + b[1]]


def files(gatherer: str, channel: str, turn: Optional[int] = None, cwd: str = "") -> dict:
    """The session's turns ({n, row_id, at, text, more, replies, now, last, work}: what the user asked, and what they wrote while it
    ran ({row_id, at, text}: sent mid-turn, or held until it ended; data.py's `meanwhile`) -- part of it, not a turn of its own; what the agent
    said back and thought, in order -- each {kind: "text", text} or {kind: "thinking", texts} (a run of
    thinking between two replies, its readable words: none when encrypted), and among them a subagent's report
    handed back (`_note`): {kind: "report", name (what the subagent was started for, else ""), text}; `ran`, the commands the user ran that Claude Code runs itself (/context,
    /mcp: not shown, but what was sent from the page is matched with them); `output`, what a command the user
    ran with ! printed, when it is one; what it was doing
    last -- {kind: "thinking"}, {kind: "call", id, text} (a call with no result yet), or None; and its latest
    call while nothing readable was said or thought after it -- {id, text, call, running, error, output} -- or
    None; and what its calls are doing and how they ended, work.summary's; `stopped`, how it stopped short -- interrupted
    (Esc), as the note the harness sent with the next turn says or its own record (`_stops`), or on an error it gave up
    on, as its record says: {kind, at (None: not known), text, status}, as data.py's actor's `stopped` -- or None, as
    for a turn that went on after the stop with a message written as it ran (Esc with one queued sends it at once);
    `calls`, as many as its list of calls below has), and for turn `turn` (None: the latest) the files it worked on, in
    the order first touched, each
        {path, kinds (read, edit, write, hit), created, changed (the lines its changes added and removed, [added,
         removed]: `_changed`; None for none counted),
         sources: [{via, kind, kinds, error, call, blocks, changed}]: the calls that touched it, in order, each
         with what it did to it -- blocks of {t: "lines", start (None: not known), lines} (read),
         {t: "hits", rows: [[n, text]]}, {t: "diff", at (None: not found), old, new, above, below
         ([[n, text]]: known lines around it)}, {t: "write", lines, created}, {t: "append", lines},
         {t: "image", row_id, id} (fetched by `image`), {t: "note", text}}; `call` None for a file Claude Code
         gave the agent the lines of itself (`_loaded`: one the user @-mentioned, a CLAUDE.md, its memory)
    `sent`, when it messaged other actors in it (`_sent`): [{kind, to, to_name, text, at}];
    and every call it made, in order: {text, error, running, call, output, files (the paths it touched), did (each
    one's kinds, by path), changed (the lines its changes added and removed, as above)} -- a skill
    loaded with them, as its Skill call, its instructions its output, or as a call of its own when the user typed its /name.
    Each source has `at`, when its call was made (None for what was not a call).
    A source the hook server checked on disk also has `checked` (True: what the call showed of the file
    is on disk; False: it is not; None: nothing to match), and `unnamed` when the file changed while
    the call ran but the call doesn't name it; its kinds may be "delete" too. A change git made as the call
    ran (`by_git`) is a source of its own with `git` true, its kinds the file's `git`, not its `kinds`, its
    lines not in the file's nor the command's `changed`, and the command's `git` ({path: kinds}) rather than
    its `did`. A file in a temporary folder (`temporary`) has `temporary` true.
    Relative paths in shell commands are taken from `cwd` (the session's directory). `home`: the
    user's home folder, which the page shows as ~."""
    conn = data._connect(gatherer)
    if conn is None:
        return {"error": f"no database for gatherer {gatherer!r}"}
    try:
        stops = _stops(conn, channel)
        evs = list(_events(conn, channel, stops))
        touched = _touches(conn, channel)
        sent = _sent(conn, channel)
        git = _git(conn) if touched else {"calls": {}, "changed": {}, "trees": []}   # what git did, in any session
        held = data.meanwhile(conn, channel)          # sent when a turn ended, written while it ran (the record's)
        reports = data.record_of(conn, channel).reports()   # what each subagent answered, as its own record had it
        rules = harness_kit.get(data._harness(conn, channel) or harness_kit.DEFAULT)    # its harness's rules
    finally:
        conn.close()
    known: Dict[str, Sheet] = {}                     # each file's lines as last seen, over the whole session
    calls: Dict[str, dict] = {}                      # a call waiting for its result, by id
    mine: set = set()                                # the work trees the session's calls make (`git worktree add`)
    turns: List[_Turn] = []
    want = None

    def knows(path) -> Sheet:
        return known.setdefault(path, Sheet())

    def change(rec, view, via: str, path: str, old: Optional[str], new: str, whole: bool, error: bool) -> None:
        """One change to a file, by an edit tool or a shell command: the whole new text (`whole`), or
        `old` replaced by `new`, placed among its lines seen so far (`at`: None when not found), with
        CONTEXT lines of what is known around it."""
        k = knows(path)
        src = f = None
        if rec:
            f = rec.file(path)
            src = rec.source(f, via, "write" if whole else "edit", view, error)
        if error:
            return
        if whole:
            lines = new.split("\n")
            if rec:
                f["created"] = f["created"] or not k.rows
                rec.block(f, src, {"t": "write", "lines": [l[:LINE_CHARS] for l in lines[:MAX_ROWS]],
                                   "cut": max(0, len(lines) - MAX_ROWS), "created": not k.rows})
            known[path] = Sheet()
            known[path].rows = {i + 1: {"text": t} for i, t in enumerate(lines)}
            return
        spot = place(k, old, new)
        if spot is None:
            if rec:
                rec.block(f, src, {"t": "diff", "at": None, "old": old[:COMMAND_OUTPUT].split("\n"),
                                   "new": new[:COMMAND_OUTPUT].split("\n")})
            return
        at, before, after = spot
        if rec:
            above = [[n, k.text(n)] for n in range(at - CONTEXT, at) if k.text(n) is not None]
            below = [[n + len(after) - len(before), k.text(n)] for n in range(at + len(before), at + len(before) + CONTEXT)
                     if k.text(n) is not None]
            rec.block(f, src, {"t": "diff", "at": at, "old": before, "new": after, "above": above, "below": below})
        k.replace(at, before, after)

    def by_git(part: dict, path: str, how: str, named, says, ran: bool) -> Optional[str]:
        """Whether git made the change (`how`: created, modified, deleted) ag's hook found call `part` made to `path`,
        not the call itself (unless it says it writes the file: `says`): "ran" -- the call ran git so as to change a
        checkout's files (`ran`: a pull, a merge, a checkout, `git worktree add` ...), or was found to create the `.git`
        of a new work tree the file is in; "meanwhile" -- the call doesn't name the file, and git made that change as the
        call ran, in another call: of this session, stored with it (SAME_ANSWER), of another, within the watcher's window
        (GIT_WINDOW) -- or, the file created, it is in a work tree made then, by no call of this session's (a checkout
        only creates); None: neither (`git`, `mine`)."""
        at, cid = part.get("_at"), part.get("id")
        near = lambda when, session: at is not None and when is not None \
            and abs(at - when) <= (SAME_ANSWER if session == channel else GIT_WINDOW)    # noqa: E731
        if ran or any(cid == w["call"] and _under(path, (w["root"],)) for w in git["trees"]):
            whose = "ran"
        elif named == 0 and (any(c != cid and h == how and near(when, s) for when, s, c, h in git["changed"].get(path, ()))
                             or how == "created" and any(_under(path, (w["root"],)) and w["root"] not in mine
                                                         and near(w["at"], None) for w in git["trees"])):
            whose = "meanwhile"
        else:
            return None
        return None if says(path) else whose

    def from_disk(rec, view, via: str, part: dict, result: dict, rows: List[dict], error: bool) -> None:
        """A call as the hook server found it on disk (`_touches`): the files it read and changed."""
        said = []                                           # the files the call says it writes, once asked
        ran = runs_git(_command(part)[0])

        def says(path: str) -> bool:
            if not said:
                said.append(says_writes(part, cwd))
            return path in said[0]

        for r in rows:
            path, how, d = r["path"], r["how"], r["detail"]
            if path is None or how not in TOUCH_KINDS:
                continue
            if how == "read":                               # what is known of the file, for calls not checked
                for start, lines in d.get("lines") or []:
                    for i, line in enumerate(lines if start is not None else []):
                        knows(path).rows[start + i] = {"text": line}
            elif how == "created" and not d.get("cut"):
                known[path] = Sheet()
                known[path].rows = {i + 1: {"text": t} for i, t in enumerate(d.get("lines") or [])}
            elif how in ("modified", "deleted"):
                known.pop(path, None)
            changing = how in ("created", "modified", "deleted")
            if changing and ags(path) and not says(path):
                continue                                    # ag's own write: kept before the hook server left them out
            if not rec:
                continue
            gits = by_git(part, path, how, r["named"], says, ran) if changing else None
            f = rec.file(path)
            src = rec.source(f, via, TOUCH_KINDS[how], view, error, bool(gits))
            unnamed = changing and r["named"] == 0
            rec.checked(f, src, None if r["checked"] is None else bool(r["checked"]), not unnamed)
            if gits == "meanwhile":
                rec.block(f, src, {"t": "note", "text": "changed by git as this ran, in another call; this call doesn't name it"})
            elif unnamed:
                rec.block(f, src, {"t": "note", "text": "changed while this ran; the call doesn't name it"})
            if how == "read":
                if d.get("image") and result.get("row_id") is not None:
                    rec.block(f, src, {"t": "image", "row_id": result["row_id"], "id": part.get("id")})
                elif d.get("unsplit"):
                    rec.block(f, src, _unsplit(_view(part).get("shape") == Shape.SHELL, _shown(result)))
                for start, lines in d.get("lines") or []:
                    rec.block(f, src, {"t": "lines", "start": start, "lines": lines})
            elif how == "hit":
                if d.get("listed"):
                    rec.block(f, src, {"t": "note", "text": "listed by name"})
                if d.get("hits"):
                    rec.block(f, src, {"t": "hits", "rows": d["hits"]})
            elif how == "created":
                f["created"] = f["created"] or not gits
                rec.block(f, src, {"t": "write", "lines": d.get("lines") or [], "cut": d.get("cut", 0), "created": True})
            elif how == "modified":
                for h in d.get("hunks") or []:
                    if h.get("more"):
                        rec.block(f, src, {"t": "note", "text": "changed in more places, not shown"})
                    else:
                        rec.block(f, src, {"t": "diff", "at": h.get("at"), "old": h.get("old") or [], "new": h.get("new") or [],
                                           "above": h.get("above") or [], "below": h.get("below") or []})
                if not d.get("hunks"):
                    rec.block(f, src, {"t": "note", "text": "changed; at which lines isn't known (it wasn't seen before, "
                                                            "or isn't text)"})
            else:
                rec.block(f, src, {"t": "note", "text": "deleted"})

    def loaded(t: Optional[_Turn], part: dict) -> None:
        """A file Claude Code gave the agent the lines of in a note (`_loaded`): read, at its line numbers."""
        path = part["path"]
        for n, line in part["rows"]:
            knows(path).rows[n] = {"text": line}
        rec = t if t is not None and t is want else None
        if rec:
            rec.current = None                                  # no call of the agent's
            f = rec.file(path)
            src = rec.source(f, part["via"], "read", None, False)
            for start, lines in _runs(part["rows"]):
                rec.block(f, src, {"t": "lines", "start": start, "lines": lines})

    def skilled(t: Optional[_Turn], n: dict) -> None:
        """A skill Claude Code loaded (`_note`), among the turn's calls: the Skill call that loaded it, its instructions
        as its output; else, the user having typed its /name, a call of its own."""
        if t is not None:                                       # counted as `commands` lists it, in every turn
            asked = t.skill[0] if t.skill and not t.skill[1] else ""
            if asked and (asked == n["name"] or asked.endswith(":" + n["name"])):
                t.skill[1] = True
            else:
                t.head["calls"] += 1
                t.skill = [n["name"], True]
        rec = t if t is not None and t is want else None
        if rec is None:
            return
        rec.current = None
        last = rec.commands[-1] if rec.commands else None
        v = ((last or {}).get("call") or {}).get("view") or {}
        asked = str(v.get("name") or "") if v.get("shape") == Shape.SKILL else ""
        if asked and (asked == n["name"] or asked.endswith(":" + n["name"])) and not last.get("loaded"):
            last.update(output=n["text"][:COMMAND_OUTPUT], loaded=True)
            return
        rec.commands.append({"text": f"Load skill {n['name']}{' ' + n['args'] if n['args'] else ''}"[:200], "error": False,
                             "running": False, "call": {"name": "skill", "input": {"skill": n["name"], "args": n["args"]},
                                                        "view": {"shape": Shape.SKILL, "title": "Skill", "name": n["name"],
                                                                 "args": n["args"]}},
                             "output": n["text"][:COMMAND_OUTPUT], "files": [], "loaded": True})

    def apply(t: Optional[_Turn], part: dict, result: Optional[dict]) -> None:
        name, v = part.get("name") or "", _view(part)
        shape = v.get("shape")
        error = bool(result and result.get("error"))
        text, shown = (result or {}).get("text") or "", _shown(result)
        if t is not None and shape != Shape.TODO:                  # counted as `commands` lists it, in every turn
            t.head["calls"] += 1
            t.skill = [str(v.get("name") or ""), False] if shape == Shape.SKILL else None
        rec = t if t is not None and t is want else None          # only the asked-for turn is kept in full
        view = _call_view(part) if rec else None
        if rec:                                                 # every call, in order, with the files it touched
            rec.current = None if shape == Shape.TODO else {
                "text": _label(part, cwd), "error": error, "running": result is None, "call": view,
                "output": (result or {}).get("printed", shown)[:COMMAND_OUTPUT], "exit": (result or {}).get("exit"),
                "took": (result or {}).get("took"), "files": []}
            if rec.current:
                rec.commands.append(rec.current)
        rows = touched.get(part.get("id")) if part.get("id") and result is not None else None
        if rows is not None:                                    # checked on disk as it ran: as found there
            desc = v.get("description") if isinstance(v.get("description"), str) else ""
            command = _command(part)[0]
            via = desc.strip()[:200] or (re.sub(r"^cd \S+ && ", "", command.split("\n")[0])[:200] if command else name)
            from_disk(rec, view, via, part, result, rows, error)
            return
        if shape == Shape.READ and isinstance(v.get("path"), str) and v["path"]:
            path = _resolve(v["path"], cwd)
            got = [] if error else [(int(m.group(1)), m.group(2)) for m in map(READ_LINE.match, text.split("\n")) if m]
            for n, line in got:
                knows(path).rows[n] = {"text": line}
            if rec:
                f = rec.file(path)
                image = text.strip() == "[image]"
                src = rec.source(f, name, "read", view, error)       # an image is read like any file: its content an image
                if image and result.get("row_id") is not None:
                    rec.block(f, src, {"t": "image", "row_id": result["row_id"], "id": part.get("id")})
                for start, lines in _runs(got):
                    rec.block(f, src, {"t": "lines", "start": start, "lines": lines})
            return
        if shape in (Shape.WRITE, Shape.EDIT, Shape.PATCH):
            edits = []                                              # (path, old, new, whole file?)
            if shape == Shape.WRITE:
                edits.append((v.get("path"), None, str(v.get("content") or ""), True))
            elif shape == Shape.EDIT:
                for e in v.get("edits") or []:
                    edits.append((v.get("path"), str(e.get("old") or ""), str(e.get("new") or ""), False))
            else:                                                   # a patch: each file's hunks
                for path, how, hunks in _patch_files(str(v.get("patch") or "")):
                    if how == "add":
                        edits.append((path, None, "\n".join(l for _, new in hunks for l in new), True))
                    else:
                        for old, new in hunks:
                            edits.append((path, "\n".join(old), "\n".join(new), False))
            for path, old, new, whole in edits:
                if isinstance(path, str) and path:
                    change(rec, view, name, _resolve(path, cwd), old, new, whole, error)
            return
        if shape == Shape.SHELL:
            command, workdir = _command(part)
            here = _resolve(workdir, cwd) if workdir else cwd
            found, _ = shell_reads(command, "" if error else shown, here)
            changes, _ = shell_changes(command, here)
            found = [x for x in found if not GLOB.search(x[0])]      # a pattern: which files, not known here
            changes = [c for c in changes if not GLOB.search(c[0])]
            for path, how, n, got in found:
                if how == "lines" and n is not None:
                    for i, line in enumerate(got):
                        knows(path).rows[n + i] = {"text": line}
                elif how == "hit" and n not in knows(path).rows:  # a match is its whole line
                    knows(path).rows[n] = {"text": got}
            desc = v.get("description") if isinstance(v.get("description"), str) else ""
            via = desc or re.sub(r"^cd \S+ && ", "", command.split("\n")[0])[:200]
            for path, how, what in changes:
                if how == "write":
                    change(rec, view, via, path, None, what, True, error)
                elif how == "pairs":
                    for old, new in what:
                        change(rec, view, via, path, old, new, False, error)
                else:                                       # added to, or changed in a way the command doesn't say
                    if rec:
                        f = rec.file(path)
                        src = rec.source(f, via, "edit", view, error)
                        rec.block(f, src, {"t": "append", "lines": what[:COMMAND_OUTPUT].split("\n")} if how == "append"
                                  else {"t": "note", "text": f"changed by {what}, which doesn't say which lines"})
                    if how == "changed" and not error:
                        known.pop(path, None)               # its lines are no longer known
            if rec:
                noted = set()
                for path, how, n, got in found:
                    f = rec.file(path)
                    if how == "hit":
                        rec.block(f, rec.source(f, via, "hit", view, error), {"t": "hits", "rows": [[n, got[:LINE_CHARS]]]})
                    elif how == "maybe":                    # searched with others: whose each match is, not known
                        src = rec.source(f, via, "hit", view, error)
                        if path not in noted:
                            noted.add(path)
                            rec.block(f, src, {"t": "note", "text": "searched one after another with other files: "
                                                                    "which of the matches are this file's can't be told apart"})
                    else:
                        src = rec.source(f, via, "read", view, error)
                        if how == "lines":                  # start None: where in the file is not known
                            rec.block(f, src, {"t": "lines", "start": n, "lines": got})
                        else:
                            rec.block(f, src, _unsplit(True, shown))
            return
        if shape == Shape.SEARCH and rec is None:
            return
        if shape == Shape.SEARCH:
            root = _resolve(str(v.get("path") or "."), cwd)
            via = f"{name} {v.get('pattern') or ''}"
            for line in text.split("\n") if not error else []:
                m = GREP_PATH_LINE.match(line)
                if m:
                    p = _resolve(m.group(1), root)
                    f = rec.file(p)
                    src = rec.source(f, via, "hit", view, error)
                    rec.block(f, src, {"t": "hits", "rows": [[int(m.group(2)), m.group(3)[:LINE_CHARS]]]})
                elif line.strip().startswith("/") and " " not in line.strip():
                    f = rec.file(_resolve(line.strip(), root))
                    rec.block(f, rec.source(f, via, "hit", view, error),
                              {"t": "note", "text": "listed by name"})
            return

    # the turns, first: which one is wanted
    starts, more = _turn_starts(evs, held)
    heads = [_Turn(n, row_id, at, t) for n, (i, row_id, at, t, kind) in enumerate(starts)]
    for h, start in zip(heads, starts):
        h.head["kind"] = start[4]
    for n, got in more.items():
        heads[n].head["more"] = got
    for row_id, m in sent:                           # what it sent other actors: in the turn it was sent in
        n = next((n for n in range(len(starts) - 1, -1, -1) if starts[n][1] is not None and starts[n][1] <= row_id), None)
        if n is not None:
            heads[n].head.setdefault("sent", []).append(m)
    joined = {m["row_id"] for got in more.values() for m in got}
    pick = len(heads) - 1 if turn is None or not heads else max(0, min(turn, len(heads) - 1))
    want = heads[pick] if heads else None
    # then every call, in order, each with its result, keeping what is known of each file
    begins = {i: heads[n] for n, (i, *_rest) in enumerate(starts)}
    # Claude Code's notes stored just before a user's message came with it (ag stores them ahead of it): the files they
    # give the agent are that turn's
    ahead, nxt = [None] * len(evs), None
    for i in range(len(evs) - 1, -1, -1):
        if i in begins:
            nxt = begins[i]
        elif any(p["kind"] != "note" for p in evs[i][3]):
            nxt = None
        ahead[i] = nxt
    cur: Optional[_Turn] = None
    order: List[tuple] = []                          # (turn, call part), in the order called
    results: Dict[str, dict] = {}
    agents: Dict[str, str] = {}                      # a subagent's id: what it was started for (its call's description)
    spawned: Dict[str, dict] = {}                    # a codex subagent's path: the turn that started it, its report there
    for i, (row_id, typ, at, parts, _said) in enumerate(evs):
        cur = begins.get(i, cur)
        if row_id in joined and cur is not None:     # it went on, with a message written as it ran: not stopped short by
            cur.head["stopped"] = None               # a stop before -- Esc sends a message queued at once, and Claude
            cur.went_on = at                         # Code says nothing of the interrupt then
        head = cur.head if cur is not None else {"replies": [], "now": None, "last": None}   # before the first message: kept nowhere
        acts = cur.acts if cur is not None else {}
        if at and (head.get("end") or 0) < at:
            head["end"] = at
        for p in parts:
            if p["kind"] == "call":
                p["_at"] = at                            # when it was made: its sources' `at`
                order.append((cur, p))
                if p.get("id"):
                    calls[p["id"]] = p
                label = _label(p, cwd)
                head["now"] = {"kind": "call", "id": p.get("id"), "text": label}
                head["last"] = {"id": p.get("id"), "text": label, "call": _call_view(p), "running": True, "error": False, "output": ""}
                acts[p.get("id") or f"#{len(acts)}"] = {"id": p.get("id"), "kind": work.doing(p.get("action"), _view(p)),
                                                         "ended": None, "ok": True}
            elif p["kind"] == "result" and p.get("id"):
                results[p["id"]] = dict(p, row_id=row_id)      # where it is stored: its image is fetched from there
                if p["id"] in acts and acts[p["id"]]["ended"] is None:
                    a = acts[p["id"]]
                    a.update(ended=at or 0, seq=len(results), ok=work.ok(a["kind"], bool(p.get("error")), p.get("text") or ""))
                if (head["now"] or {}).get("id") == p["id"]:
                    head["now"] = None
                if (head["last"] or {}).get("id") == p["id"]:
                    head["last"].update(running=False, error=bool(p.get("error")), output=_shown(p)[:COMMAND_OUTPUT],
                                        exit=p.get("exit"), took=p.get("took"))
                started = calls.get(p["id"]) or {}
                made = rules.spawned(ToolCall(started.get("id"), started.get("name") or "", started.get("input")),
                                     p.get("text") or "") if started and rules is not None else None
                if made and made.get("id"):                  # a subagent it started: what its report is shown by
                    agents[made["id"]] = made.get("name") or ""
                    if made.get("later"):                    # its report handed back with a later call: where it started
                        spawned[made["id"]] = {"head": head, "given": False}
            elif p["kind"] == "text" and p.get("role") == "assistant" and p["text"].strip():
                head["replies"].append({"kind": "text", "text": p["text"]})
                head["now"] = head["last"] = None
            elif p["kind"] == "thinking":                    # a run of thinking between two replies: one, its words gathered
                said = head["replies"]
                if not said or said[-1]["kind"] != "thinking":
                    said.append({"kind": "thinking", "texts": []})
                if p["text"].strip():
                    said[-1]["texts"].append(p["text"])
                    head["last"] = None                      # shown after the call: the call is no longer the last
                head["now"] = {"kind": "thinking"}
            elif p["kind"] == "note":                        # Claude Code's own: a report, a message, a skill loaded, a ! command's output
                n = _note(p, calls.get(p["loaded_by"]) or {} if p.get("loaded_by") else None)
                if n is None:
                    if _interrupted(p):                     # stopped (Esc), as its next turn told the model
                        head["stopped"] = {"kind": "interrupted", "at": None, "text": None, "status": None, "reason": None}
                elif n["kind"] == "report":
                    by = n.pop("from")
                    n["name"] = agents.get(by, "")
                    start = spawned.get(by)
                    if start is None:
                        head["replies"].append(n)
                    elif not start["given"]:                 # codex's, handed back with a later call: where it started
                        start["given"] = True
                        start["head"]["replies"].append(n)
                elif n["kind"] == "peer" and n["text"]:      # (codex's between its agents: by the sender's task name)
                    head["replies"].append(dict(n, name=agents.get(n["name"], n["name"])))
                elif n["kind"] == "skill":                   # among the calls, not the conversation (skilled)
                    order.append((cur, n))
                    if ((head["last"] or {}).get("call") or {}).get("name") == "Skill":
                        head["last"]["output"] = n["text"][:COMMAND_OUTPUT]
                elif n["kind"] == "command":
                    head.setdefault("ran", []).append(n["name"])
                else:
                    head["output"] = n["text"]               # what a ! command printed: under it
                for path, rows, how in _loaded(p):
                    order.append((ahead[i] or cur, {"kind": "loaded", "path": path, "rows": rows, "via": how}))
    if any(not x["given"] for x in spawned.values()):    # ended, its report not handed back yet: from its own record
        for path, x in spawned.items():
            said = reports.get(path) if not x["given"] else None
            if said:
                x["head"]["replies"].append({"kind": "report", "name": agents.get(path, ""), "text": said})
    for p in calls.values():                         # the work trees the session's calls make
        command, workdir = _command(p)
        for tree in worktrees_added(command, _resolve(workdir, cwd) if workdir else cwd) if "worktree" in command else []:
            mine.update((tree, os.path.realpath(tree)))
    for t, p in order:
        if t is not None:
            t.at_call = p.get("_at")
        if p["kind"] == "loaded":
            loaded(t, p)
        elif p["kind"] == "skill":
            skilled(t, p)
        else:                                        # a codex script: the calls it makes
            for q, r in _opened(rules, p, results.get(p.get("id")) if p.get("id") else None):
                apply(t, q, r)
    for s in stops:                                  # the record's, by when: in the turn it fell in, where the conversation doesn't say
        h = next((h for h in reversed(heads) if (h.head["at"] or 0) <= s["at"]), None)
        if h is not None and h.head["stopped"] is None and not (h.went_on and s["at"] < h.went_on):
            h.head["stopped"] = s
    for h in heads:                                  # its newest call, while nothing readable was said or thought after it
        h.head["work"] = dict(work.summary(list(h.acts.values())), **({} if h.head["last"] else {"last": None}))
    out = {"turns": [h.head for h in heads], "turn": pick if heads else None, "files": [], "commands": [],
           "home": os.path.expanduser("~")}
    if want is None:
        return out
    by_call = {id(c["call"]): c for c in want.commands if c.get("call") is not None}
    for path in want.order:
        f = want.files[path]
        for src in f["sources"]:                     # the lines each change added and removed: by call, file, command
            src["changed"] = _changed(src["blocks"])
            if not src.get("git"):                   # (git's not counted: not the agent's)
                f["changed"] = _plus(f.get("changed"), src["changed"])
            c = by_call.get(id(src["call"])) if src["call"] is not None else None
            if c is not None:                        # and what each command did to each of its files, and git as it ran
                if not src.get("git"):
                    c["changed"] = _plus(c.get("changed"), src["changed"])
                did = c.setdefault("git" if src.get("git") else "did", {})
                did[path] = sorted(set(did.get(path, [])) | set(src["kinds"]))
        room = MAX_ROWS                              # the most lines one file shows, over all its calls
        for src in f["sources"]:
            for b in src["blocks"]:
                key = "rows" if b["t"] == "hits" else "lines" if b["t"] in ("lines", "append", "output") else None
                if key:
                    b["cut"] = max(0, len(b[key]) - room)
                    b[key] = [x[:LINE_CHARS] if isinstance(x, str) else x for x in b[key][:room]]
                    room = max(0, room - len(b[key]))
        out["files"].append({"path": path, "kinds": sorted(f["kinds"]), "git": sorted(f["git"]), "created": f["created"],
                             "changed": f.get("changed"), "temporary": temporary(path), "sources": f["sources"]})
    out["commands"] = want.commands
    return out


IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}



CHANGED_KINDS = {"edit", "write", "delete"}


def changes(gatherer: str, channel: str, path: str, since: float, cwd: str = "") -> dict:
    """What the session did to the file `path` since `since` (seconds): {path, changes, home}, `changes` the calls
    that wrote, edited or deleted it since then, the oldest first -- each a source of `files`' ({via, kinds, error,
    call, blocks, changed, checked, at}) with its turn's `turn` (n) and `asked` (what the user asked in it). The
    file is the same by its path as given or followed through links (/tmp, /private/tmp)."""
    got = files(gatherer, channel, None, cwd)
    if "error" in got:
        return got
    same = {os.path.abspath(path), os.path.realpath(path)}
    out: List[dict] = []
    for t in got["turns"]:
        if (t.get("end") or t.get("at") or 0) < since:
            continue                                 # over before then
        those = got if t["n"] == got["turn"] else files(gatherer, channel, t["n"], cwd)
        for f in those.get("files", []):
            if f["path"] not in same and os.path.realpath(f["path"]) not in same:
                continue
            out += [dict(src, turn=t["n"], asked=t["text"]) for src in f["sources"]
                    if CHANGED_KINDS & set(src["kinds"]) and (src.get("at") or 0) >= since]
    return {"path": path, "changes": out, "home": got.get("home")}

def lately_changed(gatherer: str, channel: str, cwd: str = "", within: float = LATELY) -> List[str]:
    """The files the session changed lately -- in its latest turn that changed any, and in the last `within` seconds --
    as ag's hook found its calls did (`file_touched`: created, modified or deleted), the first changed first. Not
    counted: what a file changed while a command ran but no call names (`named` false: a pull's files, another
    session's writes meanwhile); what a git command changed (a checkout of a file, a pull: `runs_git`), but for the
    files the command writes itself (`> log`); nor, unless under the session's directory `cwd`, what is in a temporary
    folder, ag's home or a harness's own (HARNESS_FOLDERS) -- none of it the session's work."""
    conn = data._connect(gatherer)
    if conn is None:
        return []
    try:
        evs = list(_events(conn, channel))
        held = data.meanwhile(conn, channel)
        kind = conn.execute("SELECT event_type_id FROM event_types WHERE name = 'file_touched'").fetchone()
        touches = conn.execute(f"SELECT row_id, inserted_at, payload_json FROM events WHERE event_type_id = ? "
                               f"AND ifnull({data.CHANNEL}, '') = ? ORDER BY row_id", (kind[0], channel)).fetchall() if kind else []
    finally:
        conn.close()
    both = lambda p: {os.path.normpath(p), os.path.realpath(p)}   # noqa: E731 - /tmp is /private/tmp, on macOS
    git: Dict[str, set] = {}                         # a call that ran git: the files it names itself
    for _, _, _, parts, _ in evs:
        for p in parts:
            if p["kind"] != "call":
                continue
            ran = [p] + list(p.get("calls") or [])         # a script's calls, each
            if any(runs_git(_command(q)[0]) for q in ran):
                git[p["id"]] = {q for c in ran for w in says_writes(c, cwd) for q in both(w)}
    mine = both(cwd) if cwd else set()
    kept = []                                        # (row_id, at, path)
    for row_id, inserted_at, raw in touches:
        t = data._json(raw) or {}
        path = t.get("path")
        if t.get("how") not in ("created", "modified", "deleted") or not isinstance(path, str) or not os.path.isabs(path) \
                or t.get("named") == 0:                     # 0 or false: not named; None: not known
            continue
        path = os.path.normpath(path)
        if t.get("call") in git and not both(path) & git[t["call"]]:
            continue
        if _under(path, mine) or not (temporary(path) or ags(path) or _under(path, HARNESS_FOLDERS)):
            kept.append((row_id, data._seconds(inserted_at), path))
    if not kept:
        return []
    begun = max((s[1] for s in _turn_starts(evs, held)[0] if s[1] < kept[-1][0]), default=0)   # the latest change's turn
    since = time.time() - within
    return list(dict.fromkeys(p for row_id, at, p in kept if row_id > begun or (at or 0) >= since))


def image(gatherer: str, row_id: int, call_id: str) -> Optional[tuple]:
    """The image a call's result holds, as stored in event `row_id`: (media type, bytes), or None.
    Claude Code's {"type": "image", "source": {"media_type", "data"}}, or codex's input_image with a
    data URL."""
    conn = data._connect(gatherer)
    if conn is None:
        return None
    try:
        row = conn.execute("SELECT payload_json FROM events WHERE row_id = ?", (row_id,)).fetchone()
    finally:
        conn.close()
    try:
        payload = json.loads(row["payload_json"]) if row else None
    except (TypeError, ValueError):
        return None

    def found(value, inside: bool):
        if isinstance(value, list):
            for v in value:
                got = found(v, inside)
                if got:
                    return got
        elif isinstance(value, dict):
            mine = inside or value.get("tool_use_id") == call_id or value.get("call_id") == call_id
            src = value.get("source")
            if mine and value.get("type") == "image" and isinstance(src, dict) and src.get("type") == "base64":
                return src.get("media_type"), src.get("data")
            url = value.get("image_url")
            if mine and value.get("type") == "input_image" and isinstance(url, str) and url.startswith("data:"):
                head, _, body = url.partition(",")
                return head[5:].split(";")[0], body
            for v in value.values():
                if isinstance(v, (list, dict)):
                    got = found(v, mine)
                    if got:
                        return got
        return None

    got = found(payload, False)
    if not got or got[0] not in IMAGE_TYPES or not isinstance(got[1], str):
        return None
    try:
        return got[0], base64.b64decode(got[1], validate=False)
    except (ValueError, binascii.Error):
        return None
