"""The History view's data (page.html: the History view): a gatherer's history laid out to be looked
through and picked from -- each event, light, and the tasks ag has segmented it into -- searched; and
what the reader picks, rendered as one transcript, to export, or to give the Gatherer's model to
summarize, or to write memories, an AGENTS.md or a skill from -- and those saved where Claude Code reads
them:

    outline(gatherer, channel, after)    the events after row `after` (every channel's, or one's): each
                                         one's row, channel, type, size, time and first PREVIEW
                                         characters; the tasks ag has segmented them into, and each
                                         channel's latest build
    build(gatherer, channel)             ag asked to build the channel's history again, in its background
                                         worker, once there is enough new (BUILD_MESSAGES)
    event(gatherer, row_id)              one event, as the transcript shows it: a tool call, opened
    search(gatherer, channel, q)         the events whose words hold `q`, each with the words around it
    render(gatherer, rows, clip)         those events as one Markdown transcript, by actor, task and turn
    export(gatherer, rows, fmt)          that, whole, or the events as JSON: a file to save
    start(gatherer, kind, rows, ask)     the Gatherer's model asked, in the background, for one of KINDS
                                         made from them -- and what the reader asked of it: its record,
                                         `running` until the model's answer is in it
    extracts(gatherer), delete(id)       the records, newest first; one removed (stopped, if it runs)
    save(id, target, dir, version)       a record's files written where Claude Code reads them (TARGETS):
                                         without `version`, only the plan -- each file, what it gets --
                                         and its version, which writing it then must match

The model is ag's own ([policies.llm]), asked through ag's command (`ag home complete`) as the
dashboard runs ag for everything else, never imported: the call is logged with the Gatherer's
others, and put to the gatherer -- and to the actor, when every row picked is one actor's. A record
is a file in <home>/dashboard/extracts/; nothing here writes to a gatherer's database.

A record is saved where a harness reads it -- an AGENTS.md, a skill, memories -- as the harness says, its paths and
formats its own (harness_kit's `saves` and `save_files`: Claude Code's, so far); this module checks the record, the
directory and the reader's go-ahead (`plan`, `save`)."""

import hashlib
import json
import os
import re
import signal
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import harness_kit

from . import data, files, home, sessions

CHANNEL = data.CHANNEL
PREVIEW = 300               # the characters of an event's words the outline carries
OUTLINE_ITEMS = 5000        # the most events `outline` returns at once (`more`: there are others)
SEARCH_HITS = 2000          # the most events `search` returns
SNIPPET = 90                # the characters `search` keeps on either side of a match
MAX_ROWS = 200_000          # the most rows one request may pick
MAX_ASK = 4000              # the longest the reader's own instructions may be

#: What an event's parts keep, rendered for the model (`render`'s clip): a message's words, a tool's
#: input, its output, the agent's thinking, a note (the harness's system text, ag's notices) -- each cut
#: in the middle past it. TIGHT when the history is too long for one call that way; None keeps all.
CLIP = {"text": 12000, "input": 1500, "output": 2000, "thinking": 1000, "note": 400}
TIGHT = {"text": 6000, "input": 400, "output": 400, "thinking": 0, "note": 150}
#: The longest transcript one call is given (about 125K tokens): a longer pick is refused.
PROMPT_CHARS = 500_000
TIMEOUT = 900               # seconds the model has to answer

HISTORY = """You are given part of the history of one or more coding-agent sessions: what the \
user asked, what the agent said and did -- its tool calls and their output, clipped -- in order, by \
session, task and turn."""

#: kind -> (its name, the system message its call has).
KINDS = {
    "summary": ("Summary", HISTORY + """

Write a summary of it for the user, in Markdown. Lead with what was asked and where it ended up. Then, \
as far as the history shows them: what was done and how; the decisions made, and why; what was found \
or learned; the files, commands and systems involved, by name; what is unfinished or failed, and the \
open questions. Be specific -- names, numbers, paths -- and brief. Say only what the history supports; \
never invent."""),
    "memory": ("Memory", HISTORY + """

From it, write MEMORIES for future agent sessions -- each one fact a new agent needs to work the way \
this user wants, without this history. Keep only what outlives the work shown:
- `user`: who the user is -- their role, what they know, how they like to work;
- `feedback`: how the user wants things done or not done -- corrections, and approaches they confirmed;
- `project`: facts about the project and its environment that the code does not show -- goals, \
constraints, decisions and why, where things are, which commands and tools work;
- `reference`: pointers to outside resources -- a URL, a dashboard, a ticket, a document.
Leave out what was done once and is finished, what the code or its git history already records, and \
what only this work needed. One fact per memory; several facts, several memories. Fewer, sharper \
memories beat many: none at all when the history establishes nothing worth remembering.

Return ONLY a JSON array, no prose and no code fence -- [] when there is nothing:

[{"name": "<a short slug: lowercase words joined by hyphens>",
  "title": "<a few words naming it>",
  "description": "<one line: what it is and when it matters -- what decides whether a future agent reads it>",
  "type": "user" | "feedback" | "project" | "reference",
  "body": "<the fact, in Markdown, stated plainly; for feedback and project, followed by a **Why:** line \
(the reason the history gives) and a **How to apply:** line>"}]

Say only what the history supports; never invent."""),
    "agents": ("AGENTS.md", HISTORY + """

From it, write an AGENTS.md: the standing instructions coding agents (Claude Code, Codex, ...) read at the \
start of EVERY session in this project -- so every line costs every session, and must earn its place. Keep only what outlives \
the work shown and applies again and again:
- how to build, run and test, with the exact commands that worked;
- the project's conventions: layout, naming, style, the tools and libraries to use;
- rules the user set: what to always do, what never to do, and how they want to work;
- pitfalls to avoid, each with what to do instead.
Leave out what was done once and is finished, what only this work needed, and anything an agent can \
see at a glance from the code.

Return ONLY the file's Markdown: short sections by topic (`## Commands`, `## Conventions`, ...), each \
instruction one bullet, written as an instruction ("Run tests with `make test`", "Never edit \
generated files in `dist/`"), with its reason where the history gives one. No title, no preamble, no \
closing remarks. Say only what the history supports; when it establishes nothing worth keeping, say so \
in one line."""),
    "skill": ("Skill", HISTORY + """

From it, write an Agent Skill: the reusable procedure the history shows -- how the work was done, made \
general enough to do again -- so that an agent that loads the skill can do it without this history. \
Return ONLY the content of its SKILL.md, starting with its front matter:

---
name: <lowercase words joined by hyphens, at most 64 characters>
description: <what the skill does and when to use it -- the requests and situations that should bring \
it in -- at most 1024 characters>
---

# <Title>

and then its body, in Markdown: when to use it; what to have or check first; the steps, in order, with \
the exact commands, files and settings that worked; how to tell it worked; and the pitfalls the history \
ran into, with what fixed them. Keep what generalizes, and drop this occasion's particulars unless \
they are the point (a fixed path, a required flag). Say only what the history supports."""),
}


class HistoryError(ValueError):
    pass


# ---------------------------------------------------------------- the outline, and search

def _call_label(payload: Optional[str], text: Optional[str], cwd: str, harness: Optional[str]) -> str:
    """A tool call in a line, as the Files view names it: its own description, else its command, else its tool
    and what it worked on; "" when the event holds no call. `harness`: its channel's (data.py's `_harness`)."""
    labels = [files._label(p, cwd) for p in data.parts("tool_call", payload, text, chars=None, harness=harness)
              if p.get("kind") == "call"]
    return "; ".join(x for x in labels if x)[:PREVIEW]


def _preview(text: Optional[str], payload: Optional[str]) -> str:
    words = text if text else data.readable(payload)
    return " ".join((words or "").split())[:PREVIEW]


def _tasks(conn, channel: Optional[str]) -> List[dict]:
    if "tasks" not in data._tables(conn):
        return []
    where, args = ("WHERE channel_key = ?", (channel,)) if channel is not None else ("", ())
    return [{"channel": r["channel_key"], "index": r["task_index"], "name": r["name"], "description": r["description"],
             "first_row": r["first_row"], "last_row": r["last_row"], "tokens": r["tokens"]}
            for r in conn.execute(f"SELECT channel_key, task_index, name, description, first_row, last_row, tokens "
                                  f"FROM tasks {where} ORDER BY channel_key, task_index", args)]


#: The user messages a channel needs since its last build before the History view asks ag for another
#: (`build`): fewer, and they and their answers stay the running task as they are.
BUILD_MESSAGES = 10


def _builds(conn, channel: Optional[str]) -> Dict[str, dict]:
    """Each channel's latest build of its own history -- {build_id, status, reason, started, finished, error}
    -- and how many user messages it has after the last row those went through (`since`). A join is not one:
    it ranks the other channels' tasks, and splits nothing of the channel's own."""
    tables = data._tables(conn)
    where, args = (f"WHERE ifnull(e.{CHANNEL}, '') = ?", (channel,)) if channel is not None else (f"WHERE e.{CHANNEL} IS NOT NULL", ())
    cols = data._columns(conn, "_builds") if "_builds" in tables else set()
    own = "WHERE coalesce(reason, '') != 'join'" if "reason" in cols else ""
    through = dict(conn.execute(f"SELECT channel_key, max(through_row) FROM _builds {own} GROUP BY channel_key")) \
        if "_builds" in tables else {}
    out: Dict[str, dict] = {}
    for ch, row_id in conn.execute(
            f"SELECT e.{CHANNEL}, e.row_id FROM events e JOIN event_types t ON t.event_type_id = e.event_type_id "
            f"{where} AND t.name = 'user_message'", args):
        o = out.setdefault(ch, {"since": 0})
        o["since"] += row_id > (through.get(ch) or 0)
    if "_builds" in tables:
        for r in conn.execute(f"SELECT channel_key, build_id, status, started_at, finished_at, error"
                              f"{', reason' if 'reason' in cols else ''} FROM _builds WHERE build_id IN "
                              f"(SELECT max(build_id) FROM _builds {own} GROUP BY channel_key)"):
            if r["channel_key"] in out:
                out[r["channel_key"]].update(build_id=r["build_id"], status=r["status"], started=data._seconds(r["started_at"]),
                                             finished=data._seconds(r["finished_at"]), error=r["error"],
                                             reason=r["reason"] if "reason" in cols else None)
    return out


def outline(gatherer: str, channel: Optional[str] = None, after: int = 0) -> dict:
    """The gatherer's events after row `after` -- the channel's only, when one is named -- oldest first,
    at most OUTLINE_ITEMS of them (`more`: there are others after): each one's row, channel, type,
    size, time and the first PREVIEW characters of its words -- a user message's as ag cleaned it, where it has; a
    tool call's, what it is for (`_call_label`),
    its input left for when it is opened; every task ag has made of them; and each channel's latest build
    (`_builds`)."""
    conn = data._connect(gatherer)
    if conn is None:
        return {"error": f"no database for gatherer {gatherer!r}"}
    try:
        if not data._channels_kept(conn):
            return dict(data.NOTHING_YET)
        where, args = f"e.row_id > ? AND e.{CHANNEL} IS NOT NULL AND {data.NOT_RECORD}", [after]
        if channel is not None:
            where, args = where + f" AND ifnull(e.{CHANNEL}, '') = ?", args + [channel]
        # a user message as ag stored it cleaned -- the harness's wrapper around it taken off -- where it has
        cleaned = "cleaned_messages" in data._tables(conn)
        words = "coalesce(c.text, e.text)" if cleaned else "e.text"
        rows = conn.execute(
            f"SELECT e.row_id, e.{CHANNEL} AS ch, t.name AS type, e.tokens, e.inserted_at, substr({words}, 1, {PREVIEW * 2}) AS text, "
            f"CASE WHEN e.text IS NULL OR e.text = '' OR t.name = 'tool_call' THEN e.payload_json END AS payload FROM events e "
            f"LEFT JOIN event_types t ON t.event_type_id = e.event_type_id "
            f"{'LEFT JOIN cleaned_messages c ON c.row_id = e.row_id' if cleaned else ''} WHERE {where} ORDER BY e.row_id LIMIT ?",
            (*args, OUTLINE_ITEMS + 1)).fetchall()
        cwd = {}
        if "p_cwd" in data._columns(conn, "_reads") and CHANNEL in data._columns(conn, "_reads"):
            cwd = dict(conn.execute(f"SELECT {CHANNEL}, p_cwd FROM _reads WHERE read_id IN "
                                    f"(SELECT max(read_id) FROM _reads WHERE p_cwd IS NOT NULL GROUP BY {CHANNEL})"))
        harnesses = {ch: data._harness(conn, ch) for ch in {r["ch"] for r in rows[:OUTLINE_ITEMS] if r["type"] == "tool_call"}}
        events = [{"row_id": r["row_id"], "channel": r["ch"], "type": r["type"] or "?", "tokens": r["tokens"] or 0,
                   "at": data._seconds(r["inserted_at"]),
                   "text": (_call_label(r["payload"], r["text"], cwd.get(r["ch"]) or "", harnesses.get(r["ch"]))
                            if r["type"] == "tool_call" else "")
                   or _preview(harness_kit.words(r["text"])[1] if r["type"] == "user_message" and r["text"] else r["text"],
                               r["payload"])}
                  for r in rows[:OUTLINE_ITEMS]]
        return {"events": events, "tasks": _tasks(conn, channel), "builds": _builds(conn, channel),
                "more": len(rows) > OUTLINE_ITEMS}
    finally:
        conn.close()


def event(gatherer: str, row_id: int) -> dict:
    """One event as the transcript shows it -- {row_id, type, parts} (data.parts, each text clipped at TEXT_CHARS):
    a tool call opened in the list, its input whole where its stored text is cut."""
    conn = data._connect(gatherer)
    if conn is None:
        return {"error": f"no database for gatherer {gatherer!r}"}
    try:
        r = conn.execute("SELECT e.row_id, t.name AS type, e.text, e.payload_json FROM events e "
                         "LEFT JOIN event_types t ON t.event_type_id = e.event_type_id WHERE e.row_id = ?", (row_id,)).fetchone()
        if r is None:
            return {"error": f"no event {row_id}"}
        return {"row_id": r["row_id"], "type": r["type"], "parts": data.parts(r["type"] or "?", r["payload_json"], r["text"])}
    finally:
        conn.close()


def search(gatherer: str, channel: Optional[str], q: str) -> dict:
    """The events -- the channel's only, when one is named -- whose words hold `q` (any case), oldest
    first, at most SEARCH_HITS (`more`: there are others): each one's row and the words around its
    first match."""
    q = (q or "").strip()
    if not q:
        return {"hits": [], "more": False}
    conn = data._connect(gatherer)
    if conn is None:
        return {"error": f"no database for gatherer {gatherer!r}"}
    try:
        if not data._channels_kept(conn):
            return {"hits": [], "more": False}
        like = "%" + re.sub(r"([\\%_])", r"\\\1", q) + "%"
        words = "CASE WHEN e.text IS NULL OR e.text = '' THEN e.payload_json ELSE e.text END"
        where, args = f"e.{CHANNEL} IS NOT NULL AND {data.NOT_RECORD} AND {words} LIKE ? ESCAPE '\\'", [like]
        if channel is not None:
            where, args = where + f" AND ifnull(e.{CHANNEL}, '') = ?", args + [channel]
        rows = conn.execute(f"SELECT e.row_id, e.text, e.payload_json FROM events e WHERE {where} ORDER BY e.row_id LIMIT ?",
                            (*args, SEARCH_HITS + 1)).fetchall()
        hits = []
        for r in rows[:SEARCH_HITS]:
            words = r["text"] if r["text"] else data.readable(r["payload_json"]) or r["payload_json"] or ""
            at = words.lower().find(q.lower())
            if at < 0:                           # the match is in the payload's JSON, not its words
                words, at = r["payload_json"] or "", (r["payload_json"] or "").lower().find(q.lower())
            start, end = max(0, at - SNIPPET), at + len(q) + SNIPPET
            near = words[start:end].replace("\\n", " ").replace("\\t", " ")    # a call's JSON: its escapes, as spaces
            snippet = ("…" if start else "") + " ".join(near.split()) + ("…" if end < len(words) else "")
            hits.append({"row_id": r["row_id"], "snippet": snippet})
        return {"hits": hits, "more": len(rows) > SEARCH_HITS}
    finally:
        conn.close()


# ---------------------------------------------------------------- the picked history, as one transcript

def _rows(rows) -> List[int]:
    """The rows picked, sorted, each once: given each as a number, or a run of them as [first, last]."""
    got, n = set(), 0
    for r in rows if isinstance(rows, list) else []:
        try:
            a, b = (int(r[0]), int(r[1])) if isinstance(r, list) and len(r) == 2 else (int(r), int(r))
        except (TypeError, ValueError):
            raise HistoryError("rows are the events' row numbers, or [first, last] runs of them") from None
        n += max(0, b - a + 1)
        if n > MAX_ROWS:                         # before a run is counted out, however long it says it is
            raise HistoryError(f"at most {MAX_ROWS:,} events at once")
        got.update(range(a, b + 1))
    if not got:
        raise HistoryError("nothing picked: pick some of the history first")
    return sorted(got)


def _fetch(conn, rows: List[int]) -> list:
    """The events with these rows that belong to a channel, as stored, oldest first."""
    got = []
    for i in range(0, len(rows), 900):                       # SQLite's limit on the ?s of one statement
        chunk = rows[i:i + 900]
        got += conn.execute(
            f"SELECT e.row_id, e.{CHANNEL} AS ch, t.name AS type, e.tokens, e.text, e.payload_json, e.inserted_at "
            f"FROM events e LEFT JOIN event_types t ON t.event_type_id = e.event_type_id "
            f"WHERE e.row_id IN ({', '.join('?' * len(chunk))}) AND e.{CHANNEL} IS NOT NULL", chunk).fetchall()
    return sorted(got, key=lambda r: r["row_id"])


def _cut(text: str, n: Optional[int]) -> str:
    """`text` at most `n` characters, its middle left out (None: all of it)."""
    if n is None or len(text) <= n:
        return text
    if n <= 0:
        return ""
    head = n * 3 // 4
    return f"{text[:head]}\n… [{len(text) - n:,} characters left out] …\n{text[len(text) - (n - head):]}"


def _fenced(text: str) -> str:
    """`text` as a code block, its fence longer than any run of backticks in it."""
    run = max((len(m) for m in re.findall(r"`+", text)), default=0)
    fence = "`" * max(3, run + 1)
    return f"{fence}\n{text}\n{fence}"


def _input(value, n: Optional[int]) -> str:
    if isinstance(value, dict) and isinstance(value.get("command"), str):
        words = value["command"]
    elif isinstance(value, str):
        words = value
    else:
        words = json.dumps(value, ensure_ascii=False, indent=1)
    return _cut(words, n)


def _part(p: dict, clip: Optional[dict]) -> str:
    n = (lambda k: None if clip is None else clip[k])        # noqa: E731
    kind = p["kind"]
    if kind == "text" and p.get("role") in ("user", "assistant"):
        return f"**{'User' if p['role'] == 'user' else 'Assistant'}:**\n\n{_cut(p['text'], n('text'))}"
    if kind == "call":
        return f"**Tool call** `{p.get('name') or 'tool'}`:\n\n{_fenced(_input(p.get('input'), n('input')))}"
    if kind == "result":
        out = _cut(p.get("text") or "", n("output"))
        return f"**Tool output{' (error)' if p.get('error') else ''}:**\n\n{_fenced(out) if out.strip() else '(none)'}"
    if kind == "thinking":
        words = _cut((p.get("text") or "").strip(), n("thinking"))
        return f"*Thinking:* {words}" if words else ""
    words = _cut((p.get("text") or "").strip(), n("note"))     # a note, or the harness's system text
    return f"> [{p.get('name') or 'system'}] " + words.replace("\n", "\n> ") if words else ""


def render(gatherer: str, rows, clip: Optional[dict] = CLIP) -> Tuple[str, dict]:
    """The events `rows` of the gatherer as one Markdown transcript, oldest first: each actor's under
    its heading, and in it, each task's (as ag has segmented the history, where it has) and each turn's
    -- a user message and all that answered it, numbered as in the whole history -- each event's parts
    clipped as `clip` says (CLIP; None: whole). With what it holds: {messages, turns, channels, dirs (the
    actors' working directories), tokens}."""
    rows = _rows(rows)
    conn = data._connect(gatherer)
    if conn is None:
        raise HistoryError(f"no database for gatherer {gatherer!r}")
    try:
        if not data._channels_kept(conn):
            raise HistoryError("nothing stored yet in this gatherer")
        picked = _fetch(conn, rows)
        if not picked:
            raise HistoryError("none of the rows picked is in this gatherer")
        order: Dict[str, int] = {}                           # each actor where its first picked event is
        for r in picked:
            order.setdefault(r["ch"], len(order))
        picked.sort(key=lambda r: (order[r["ch"]], r["row_id"]))
        user_rows = {ch: [x[0] for x in conn.execute(
            f"SELECT e.row_id FROM events e JOIN event_types t ON t.event_type_id = e.event_type_id "
            f"WHERE ifnull(e.{CHANNEL}, '') = ? AND t.name = 'user_message' ORDER BY e.row_id", (ch,))] for ch in order}
        tasks = {ch: _tasks(conn, ch) for ch in order}
        cwd = {}
        if CHANNEL in data._columns(conn, "_reads") and "p_cwd" in data._columns(conn, "_reads"):
            for ch in order:
                got = conn.execute(f"SELECT p_cwd FROM _reads WHERE ifnull({CHANNEL}, '') = ? AND p_cwd IS NOT NULL "
                                   "ORDER BY read_id DESC LIMIT 1", (ch,)).fetchone()
                cwd[ch] = got[0] if got else None
    finally:
        conn.close()
    out, turns, now = [], set(), {"ch": None, "task": None, "turn": None}
    for r in picked:
        ch = r["ch"]
        if ch != now["ch"]:
            now.update(ch=ch, task=None, turn=None)
            out.append(f"# Session {ch}" + (f" (in {cwd[ch]})" if cwd.get(ch) else ""))
        ts = tasks[ch]
        task = next((t for i, t in enumerate(ts) if t["first_row"] <= r["row_id"]
                     and (r["row_id"] <= t["last_row"] or i == len(ts) - 1)), None)
        if task is not None and task is not now["task"]:
            now["task"] = task
            out.append(f"## Task {task['index'] + 1}: {task['name']}" + (f"\n\n{task['description']}" if task.get("description") else ""))
        n = sum(1 for u in user_rows[ch] if u <= r["row_id"])            # the turn: user messages up to here
        if n != now["turn"]:
            now["turn"] = n
            turns.add((ch, n))
            stamp = data._seconds(r["inserted_at"])
            when = datetime.fromtimestamp(stamp, timezone.utc).strftime("%Y-%m-%d %H:%M UTC") if stamp else ""
            out.append(f"### Turn {n}" + (f" ({when})" if when else "") if n else "### Before the first message")
        words = [w for w in (_part(p, clip) for p in data.parts(r["type"] or "?", r["payload_json"], r["text"], chars=None)) if w]
        out += words
    about = {"messages": len(picked), "turns": len(turns), "channels": list(order),
             "dirs": list(dict.fromkeys(cwd[ch] for ch in order if cwd.get(ch))),
             "tokens": sum(r["tokens"] or 0 for r in picked)}
    return "\n\n".join(out) + "\n", about


def export(gatherer: str, rows, fmt: str = "md") -> dict:
    """The events `rows` as a file to save: {name, text} -- the transcript `render` makes, whole
    ("md"), or each event as stored, its payload parsed ("json")."""
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    if fmt == "json":
        rows = _rows(rows)
        conn = data._connect(gatherer)
        if conn is None:
            raise HistoryError(f"no database for gatherer {gatherer!r}")
        try:
            got = _fetch(conn, rows)
        finally:
            conn.close()
        events = []
        for r in got:
            try:
                payload = json.loads(r["payload_json"]) if r["payload_json"] else None
            except ValueError:
                payload = r["payload_json"]
            events.append({"row_id": r["row_id"], "channel": r["ch"], "type": r["type"], "at": r["inserted_at"],
                           "tokens": r["tokens"], "text": r["text"], "payload": payload})
        return {"name": f"history-{gatherer}-{stamp}.json",
                "text": json.dumps({"gatherer": gatherer, "events": events}, ensure_ascii=False, indent=1)}
    if fmt != "md":
        raise HistoryError("a format of md or json")
    text, _ = render(gatherer, rows, None)
    return {"name": f"history-{gatherer}-{stamp}.md", "text": text}


def build(gatherer: str, channel: str) -> dict:
    """ag asked to build the channel's history (`ag home build`, the channel named as its property): an
    ordinary build, in ag's background worker, adopted at the channel's next user message -- once it has
    BUILD_MESSAGES user messages since its last. What ag says came of it: {started},
    {running}, {few}, {failed} or {}."""
    if not channel:
        raise HistoryError("which actor's history to build")
    try:
        done = subprocess.run([*sessions.ag_command(), "home", "build", gatherer, "--properties",
                               json.dumps({"channel": channel}), "--min-messages", str(BUILD_MESSAGES)],
                              env=sessions.agent_env(), capture_output=True,
                              text=True, timeout=60, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError, sessions.SessionError) as exc:
        raise HistoryError(f"could not run ag: {exc}") from None
    try:
        return json.loads(done.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise HistoryError((done.stderr or done.stdout).strip()[-300:] or f"ag home build exited {done.returncode}") from None


# ---------------------------------------------------------------- the model's extracts, as jobs

def extracts_dir() -> str:
    return os.path.join(home.HOME, "dashboard", "extracts")


_ID = re.compile(r"[0-9a-f]{12}")
_lock = threading.Lock()
_procs: Dict[str, subprocess.Popen] = {}       # each running job's `ag home complete`, by its record's id


def _path(rid: str) -> str:
    if not _ID.fullmatch(rid or ""):
        raise HistoryError("no such extract")
    return os.path.join(extracts_dir(), rid + ".json")


def _save(rec: dict) -> None:
    os.makedirs(extracts_dir(), exist_ok=True)
    tmp = _path(rec["id"]) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(rec, fh)
    os.replace(tmp, _path(rec["id"]))


def _ranges(rows: List[int]) -> List[List[int]]:
    """Sorted rows as [first, last] runs of consecutive ones: a record's picks, kept small."""
    out: List[List[int]] = []
    for r in rows:
        if out and r == out[-1][1] + 1:
            out[-1][1] = r
        else:
            out.append([r, r])
    return out


def start(gatherer: str, kind: str, rows, ask: str = "") -> dict:
    """The Gatherer's model asked for `kind` (KINDS) of the events `rows`, with what the reader asked of
    it (`ask`), in the background: the record, `running` until the answer -- or the error -- is in it.
    Refused when the transcript is too long for one call even clipped tightly (TIGHT)."""
    if kind not in KINDS:
        raise HistoryError(f"one of {', '.join(KINDS)}")
    ask = (ask or "").strip()
    if len(ask) > MAX_ASK:
        raise HistoryError(f"instructions of at most {MAX_ASK:,} characters")
    rows = _rows(rows)
    text, about = render(gatherer, rows)
    if len(text) > PROMPT_CHARS:
        text, about = render(gatherer, rows, TIGHT)
    if len(text) > PROMPT_CHARS:
        raise HistoryError(f"too much for one call: {len(text) // 4:,} tokens or so, even with tool output cut short "
                           f"(at most {PROMPT_CHARS // 4:,}); pick less")
    name, system = KINDS[kind]
    prompt = (f"Make the {name if kind == 'agents' else name.lower()} the system message asks for, from the history below."
              + (f"\n\nWhat the user asks of it -- follow it where it differs from the system message:\n\n{ask}" if ask else "")
              + f"\n\n# The history\n\n{text}")
    rec = {"id": uuid.uuid4().hex[:12], "gatherer": gatherer, "kind": kind, "ask": ask, "status": "running",
           "created": time.time(), "finished": None, "rows": _ranges(rows), **about, "prompt_tokens": len(prompt) // 4,
           "server": os.getpid(), "model": "", "output": "", "error": ""}
    _save(rec)
    threading.Thread(target=_run, args=(dict(rec), system, prompt), daemon=True).start()
    return rec


def _run(rec: dict, system: str, prompt: str) -> None:
    """The job: `ag home complete` with the prompt on its input, its answer put in the record -- unless
    the record was deleted meanwhile."""
    job = {"gatherer": rec["gatherer"], "job": "dashboard-" + rec["kind"], "id": rec["id"],
           "properties": {"channel": rec["channels"][0]} if len(rec["channels"]) == 1 else {}}
    out, err = "", ""
    try:
        argv = [*sessions.ag_command(), "home", "complete", "--purpose", "dashboard-" + rec["kind"],
                "--system", system, "--timeout", str(TIMEOUT), "--json"]
        proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                env={**sessions.agent_env(), "AG_JOB": json.dumps(job)}, start_new_session=True)
        with _lock:
            _procs[rec["id"]] = proc
        try:
            out, err = proc.communicate(prompt, timeout=TIMEOUT + 60)
        except subprocess.TimeoutExpired:
            _kill(proc)
            out, err = proc.communicate()
            err = f"no answer within {TIMEOUT}s"
        try:
            answer = json.loads(out.strip().splitlines()[-1]) if out.strip() else {}
        except ValueError:
            answer = {}
        rec["model"] = answer.get("model") or ""
        rec["output"] = answer.get("text") or ""
        rec["error"] = answer.get("error") or ("" if rec["output"] else (err.strip()[-600:] or
                                                                          f"ag exited {proc.returncode}"))
        if proc.returncode and proc.returncode < 0:
            rec["error"] = "stopped"
    except (OSError, sessions.SessionError) as exc:
        rec["error"] = f"could not run ag: {exc}"
    finally:
        with _lock:
            _procs.pop(rec["id"], None)
    if rec["kind"] == "memory" and not rec["error"]:
        try:
            rec["memories"] = memories(rec["output"])
        except HistoryError as exc:
            rec["error"] = str(exc)
    rec["status"] = "failed" if rec["error"] else "done"
    rec["finished"] = time.time()
    with _lock:
        if os.path.exists(_path(rec["id"])):     # not deleted meanwhile
            _save(rec)


def _kill(proc: subprocess.Popen) -> None:
    """The job's process and every one it started (the model's CLI): its own session's group."""
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (OSError, AttributeError):
        try:
            proc.kill()
        except OSError:
            pass


def extracts(gatherer: str) -> List[dict]:
    """The gatherer's records, newest first. One left `running` by a dashboard that no longer runs, or
    for longer than its call may take, is shown failed: no one will finish it."""
    folder = extracts_dir()
    out = []
    for name in os.listdir(folder) if os.path.isdir(folder) else []:
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(folder, name), encoding="utf-8") as fh:
                rec = json.load(fh)
        except (OSError, ValueError):
            continue
        if not isinstance(rec, dict) or rec.get("gatherer") != gatherer:
            continue
        gone = rec.get("server") != os.getpid() and not home.alive(rec.get("server"))
        if rec.get("status") == "running" and (gone or time.time() - (rec.get("created") or 0) > TIMEOUT + 120):
            rec.update(status="failed", error="the dashboard stopped before the model answered")
        out.append(rec)
    out.sort(key=lambda r: r.get("created") or 0, reverse=True)
    return out


def delete(rid: str) -> dict:
    """The record removed, and its job stopped if it runs: {id}."""
    path = _path(rid)
    with _lock:
        proc = _procs.get(rid)
        if os.path.exists(path):
            os.remove(path)
    if proc is not None:
        _kill(proc)
    return {"id": rid}


# ---------------------------------------------------------------- saved where a harness reads it

#: Where a record can be saved: one directory's sessions, or every session of this user.
TARGETS = ("dir", "user")
MEMORY_TYPES = ("user", "feedback", "project", "reference")
_SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


def _slug(text: str, most: int = 64) -> str:
    return "-".join(re.findall(r"[a-z0-9]+", (text or "").lower()))[:most].strip("-")


def memories(output: str) -> List[dict]:
    """The model's memories (KINDS["memory"]), checked: [{name, title, description, type, body}], each
    name a slug, unique. Raises HistoryError when the answer is not that list."""
    text = (output or "").strip()
    fenced = re.fullmatch(r"```[a-z]*\n(.*)\n```", text, re.S)
    try:
        got = json.loads(fenced.group(1) if fenced else text)
    except ValueError:
        raise HistoryError("the model's answer was not the list of memories asked for: try again") from None
    if not isinstance(got, list):
        raise HistoryError("the model's answer was not the list of memories asked for: try again")
    out, names = [], set()
    for m in got:
        if not isinstance(m, dict) or not str(m.get("body") or "").strip():
            continue
        title = " ".join(str(m.get("title") or m.get("name") or "memory").split())[:80]
        name = _slug(str(m.get("name") or "")) or _slug(title) or "memory"
        base, n = name, 2
        while name in names:
            name, n = f"{base}-{n}", n + 1
        names.add(name)
        kind = str(m.get("type") or "").strip().lower()
        out.append({"name": name, "title": title, "description": " ".join(str(m.get("description") or title).split()),
                    "type": kind if kind in MEMORY_TYPES else "project", "body": str(m["body"]).strip()})
    return out


def _record(rid: str) -> dict:
    try:
        with open(_path(rid), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        raise HistoryError("no such extract") from None


def _read(path: str) -> Optional[str]:
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except FileNotFoundError:
        return None
    except (OSError, UnicodeDecodeError) as exc:
        raise HistoryError(f"cannot read {path}: {exc}") from None


def _skill_name(output: str) -> str:
    m = re.match(r"\s*---\n(.*?)\n---", output or "", re.S)
    found = re.search(r"^name:\s*[\"']?([^\"'\n]+?)[\"']?\s*$", m.group(1), re.M) if m else None
    name = _slug(found.group(1)) if found else ""
    if not name:
        raise HistoryError("the skill has no name in its front matter: try again")
    return name


def plan(rid: str, target: str, directory: str = "", harness: Optional[str] = None) -> dict:
    """What saving record `rid` at `target` (TARGETS) where `harness` (else harness_kit's DEFAULT) reads it writes, as it
    would be written now -- its harness's to say (harness_kit's `saves`, `save_files`): {files: [{path, action (create /
    append / replace), text (what the file gets: all of it, or what is added at its end)}], where, note (what may keep
    it from being read, or ""), home (the harness's folder, for every directory), harness, version}. `directory` is the
    directory a "dir" target is; it must exist."""
    rec = _record(rid)
    if rec.get("status") != "done":
        raise HistoryError("only a finished extract can be saved")
    h = harness_kit.get(harness or harness_kit.DEFAULT)
    if h is None:
        raise HistoryError(f"no harness {harness!r}")
    kind = "agents" if rec.get("kind") == "claude" else rec.get("kind")       # "claude": one made as a CLAUDE.md, before
    if kind not in h.saves:
        raise HistoryError(f"a {kind} is not saved where {h.label} reads it: download it instead")
    if target not in TARGETS:
        raise HistoryError(f"a target of {' or '.join(TARGETS)}")
    if target == "user" and h.saves[kind].get("user") is not True:
        raise HistoryError(str(h.saves[kind].get("user") or f"a {kind} is a directory's: save it to one"))
    if target == "dir":
        directory = os.path.expanduser((directory or "").strip())
        if not os.path.isabs(directory):
            raise HistoryError("a directory's full path, please")
        if not os.path.isdir(directory):
            raise HistoryError(f"no directory {directory}")
        directory = os.path.realpath(directory)
    made = {"output": rec.get("output") or "", "memories": rec.get("memories") or []}
    if kind == "skill":
        made["name"] = _skill_name(rec.get("output") or "")
    try:
        got = h.save_files(kind, directory if target == "dir" else None, made)
    except harness_kit.SaveError as exc:
        raise HistoryError(str(exc)) from None
    files = got["files"]
    version = _hash(json.dumps([h.name, files, [_read(f["path"]) for f in files]]))
    return {"files": files, "where": got["where"], "note": got.get("note") or "", "home": got.get("home"),
            "harness": h.name, "version": version}


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def save(rid: str, target: str, directory: str = "", version: str = "", harness: Optional[str] = None) -> dict:
    """Record `rid` saved at `target` where `harness` reads it -- what `plan` says, when it still says what the reader saw
    (`version`): {saved: [paths], where}. Without `version`, the plan alone. Each file is written whole
    to a file beside it, then put in place; the record keeps where it was saved."""
    got = plan(rid, target, directory, harness)
    if not version:
        return got
    if version != got["version"]:
        raise HistoryError("what would be written changed since the preview (a file changed): preview it again")
    for f in got["files"]:
        os.makedirs(os.path.dirname(f["path"]), exist_ok=True)
        whole = ((_read(f["path"]) or "") + f["text"]) if f["action"] == "append" else f["text"]
        tmp = f["path"] + ".ag-dashboard"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(whole)
        os.replace(tmp, f["path"])
    saved = [f["path"] for f in got["files"]]
    with _lock:
        rec = _record(rid)
        rec["saved"] = rec.get("saved", []) + [{"at": time.time(), "where": got["where"], "paths": saved}]
        _save(rec)
    return {"saved": saved, "where": got["where"]}
