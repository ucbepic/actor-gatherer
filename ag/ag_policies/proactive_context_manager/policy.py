"""The proactive context manager: earlier history as sections built in the
background, aware of what happens outside the conversation and of the
requests the user makes to the session's other channels.

Three moments, composed from the policies' toolkit -- `read`, `build` (the
analysis), `check` (the boundary verdict and what follows) -- and three
additions in `assemble`. Two, one per outside type (events.py), are confined
to the VERBATIM part of the context (from the running task on; the whole
history before a build):

  * `context_stream` events are shown as a developer message (`message`) at
    their row's place. Pollers run at read time, so a message's row is where
    the model first saw it, and each read's context extends the last one.
  * `environment_update` events whose SUBJECT one of the agent's own tool
    calls in the verbatim part opened before them (by that path: `mentions`)
    get a developer message (`notice`) at their row's place; what the model
    did about it follows, so it is never repeated as news. An update to
    something no tool call named, one the agent made itself (a tool call
    that came in with it could have WRITTEN the subject, `writes`), or a
    second one before the agent opened the subject again since its notice,
    is not shown: better a notice too few than one too many.

The events themselves never reach the model, and neither kind is history for
the build.

The third: each request the user made to another channel since the build in
use (since the start, before one) is a developer message (`parallel_message`)
placed, the first time it is shown, just before this channel's latest user
message -- and kept there after (where the channel's last read had it), so
a later user message does not move it and the context only grows at its end. Requests
before the build's mark are in its index section instead. All three are made items,
remade on every read and never reused as sections.

With no build in use, the requests made before the channel's first row are messages too while
they fit within all_task_tokens + parallel_index_tokens; past that -- a session that started
in a busy gatherer and has not taken up its join -- they are one block, the newest that fit
(`requests_before`), made at the channel's first read without a build and reused after, so
it neither moves nor changes. Those made since the channel's first row are messages, as
after a build's mark.

Every context opens, after the harness's own set-up, with the GATHERER GUIDE
(`gatherer_guide`, `layout.guide`): what ag adds to the context -- the sections, the
parallel requests, notices, stream messages, left-out notes -- and where the full history
is. On every read, with or without a build; one made item, the same while its text is.

Not every channel is shown to the others. One whose latest `role` record (ROLE: the dashboard's, for a gatherer's
gatherer agent) says `private` is seen by no other channel -- neither its requests, as parallel messages or in the
index, nor its tasks, ranked into another's sections -- though it sees theirs (`unseen`). Nor is a message the
actors send one another (`ag actors`, typed into the receiver's conversation as its user's), known by its opening
(`unshared_openings`): it is the receiver's to act on, not a request of the user's (`shared`).

A channel with no build of its own, in a gatherer where another channel has a ready one
(`tables.joinable`), JOINS at its first user message: a `join` build ranks the other
channels' tasks against its request and marks their requests as seen, and the read waits
for it. Its sections are the other channels' requests and related tasks, its own history
all the running task, verbatim -- so a new session starts from what the gatherer's others
did, and their requests before the mark are an index within its budget, not a message each.

All the model gets with a call -- the sections, the pinned rows, the running
task with all of the above among it, the history's preamble, the sections'
overview, and what the harness sends besides the context (its system prompt
and tools, `Read.fixed_tokens`) -- is kept at or under max_context_tokens,
and is what min_context_tokens is checked against. Above it, on any read
(not only at a user message), a build is started -- or the running one
awaited -- and the read waits for it; adopted, it cuts the running task
after its last event when the context would not otherwise fit (`cut_for`):
the running task, condensed, is "This task so far", and only what comes
after it is verbatim. The budgets add up under the limit (the config
refuses them otherwise), every section keeps to its own, and the pinned rows
to keep_pinned_tokens, the newest kept. What still does not fit -- a step
larger than the room the build leaves -- is left out with a note naming its
rows (`stubbed`).

A user message the boundary check finds starts a new task gets its build: the read waits
for it up to build_wait_seconds. One that takes longer is taken up at the turn's next call
(`for_this_turn`), not left for the next user message: the turn itself stays verbatim, so
the switch replaces only the history before it.

Everything below `assemble` is the sections' logic: segmentation, ranking,
builds and their adoption.
"""

import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from ag.ag_interface import LLM, Format, Tokenizer
from ag.ag_policies.tools import boundary, channel, history, ranking, segmentation, summarize
from ag.ag_policies.tools import tasks as tasks_tool

from ag.ag_interface import Ref, Row, event_text, property_column
from ag.ag_interface.policy import Context, Policy, Read, TypeIds
from ag.ag_policies.tools.channel import CHANNEL, channel_of
from ag.ag_policies.tools.cwd import cwd_of, same_place
from ag.ag_policies.tools.options import config_from
from . import layout, tables
from .config import ProactiveContextManagerConfig, within_limit
from .events import CONTEXT_STREAM, ENVIRONMENT_UPDATE, EVENT_TYPES

PARALLEL_REQUEST = "parallel_request"
PARALLEL_BEFORE = "parallel_before"   # with no build: the other channels' requests before the channel began, as one block
CURRENT_REQUEST = "Current request"   # the running task a `limit` build starts at the last user message
LEFT_OUT = "left_out"           # a step stubbed to keep the context within max_context_tokens
GUIDE = "gatherer_guide"        # the guide every context opens with
AGENT_STEP = ("agent_message", "tool_call", "agent_reasoning")   # what an agent step may start with
ROLE = "role"                   # a channel's role, as the dashboard records it: {role, private} (`unseen`)
OPENING_CHARS = 600             # how far into a message its opening is looked for, past a harness's wrapper (`shared`)

# A tool call that could have WRITTEN a file it names. Reading one (cat, head, grep, wc, awk, a script
# that only opens it for reading) does not make a change to it the agent's own: in parallel work the
# change is usually someone else's, landing right after the agent looked (the agent's read is often
# what it was waiting on). Missing such a change costs a wrong answer; a needless notice after the
# agent's own write costs one re-read -- so anything unclear counts as not a write.
WRITE = re.compile(
    r">>?|\btee\b|\bsed\b[^|;&]*\s-i|\bperl\b[^|;&]*\s-[a-z]*i|\b(?:mv|cp|rm|truncate|touch|install|dd)\b"
    r"|apply_patch|\*\*\* (?:Update|Add|Delete) File"
    r"|open\([^)]*,\s*\\?['\"](?:w|a|x|r\+)"
    r"|\.write\(|writelines|write_text\(|to_csv\(|\.dump\(|shutil\.(?:copy|move)")
# `>` alone also matches 2>/dev/null or `x > 5` in a script: a redirect only counts when the file follows it.

# A harness's own file-editing tool (Claude Code's Edit, Write, MultiEdit, NotebookEdit; pi's and
# opencode's edit, write), as a tool call's text shows it: `Name({...})`. It writes the file its path
# argument names, and only that one.
EDIT_TOOL = re.compile(r"(?:Edit|Write|MultiEdit|NotebookEdit|edit|write|multiedit)\(")
EDIT_PATH = re.compile(r'"(?:file_path|notebook_path|filePath|path)"\s*:\s*"((?:[^"\\]|\\.)*)"')


def writes(call_text: str, subject: str, cwd=None) -> bool:
    """Whether a tool call that names `subject` could have written it: a harness's editing tool
    whose path is the subject (`EDIT_TOOL`), a redirect INTO it, an in-place editor, a move/copy/
    remove, an apply_patch, or a script that opens something for writing. Unclear means no."""
    if EDIT_TOOL.match(call_text):
        return any(mentions(path, subject, cwd) for path in EDIT_PATH.findall(call_text))
    for m in WRITE.finditer(call_text):
        if m.group(0).startswith(">"):                      # a redirect: only into the subject itself
            if re.match(r">>?\s*['\"\\]*[^\s'\"\\]*" + re.escape(subject), call_text[m.start():]):
                return True
            continue
        return True
    return False


def shown(timestamp) -> str:
    """A timestamp as it is shown: seconds since the epoch become a UTC date
    and time; anything else is shown as it is."""
    if isinstance(timestamp, (int, float)) and not isinstance(timestamp, bool) and timestamp > 10 ** 9:
        return datetime.fromtimestamp(timestamp, timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    return str(timestamp)


def joined(build: Optional[dict]) -> bool:
    """Whether `build` is a channel's join: its start from the gatherer's other channels."""
    return bool(build) and build.get("reason") == tables.JOIN


def cleaned_of(tasks, turns) -> dict:
    """{events row_id: cleaned text} for the user messages the summaries of `tasks` cleaned -- each
    entry's turn mapped to its user message's row -- taken out of the tasks' retention (they are
    kept in their own table, not with the task's rules)."""
    by_index = {t.index: t for t in turns}
    out = {}
    for task in tasks:
        for c in (task.retention or {}).pop(summarize.CLEANED, None) or []:
            turn = by_index.get(c.get("turn"))
            if turn is not None and task.start_turn <= turn.index <= task.end_turn and c.get("text", "").strip():
                out[turn.first_row] = c["text"]
    return out


def with_cleaned(conn, entries) -> None:
    """Show each user message in `entries` as its cleaned text, where it has one (in place). Its
    row id -- the [id N] the context names it by -- is the original message's."""
    texts = tables.cleaned_texts(conn, [e.row_id for e in entries])
    for e in entries:
        if e.row_id in texts:
            e.text = texts[e.row_id]


CD = re.compile(r"(?<![\w\-])cd\s+\\?['\"]?([^\s;&|'\"\\]+)")


def moved(before: str, cwd) -> bool:
    """Whether a command, up to here (`before`), changed to a directory other than `cwd`: its last
    `cd` goes anywhere else (a relative one too, but `.`)."""
    found = list(CD.finditer(before))
    if not found:
        return False
    target = os.path.expanduser(found[-1].group(1))
    return os.path.normpath(target) != "." and os.path.normpath(target) != os.path.normpath(str(cwd))


PATH_CHAR = r"[\w.\-/~+@%]"                        # what a path is made of, for where one starts


def mentions(text: str, subject: str, cwd=None) -> bool:
    """Whether `text` refers to `subject`: it appears as a whole -- not
    inside another name (`a.py` is not in `data.py` or `a.pyc`) -- and
    the path it ends is that file. Without `cwd`, a longer path ending in
    it counts too (`/w/notes.txt` mentions `notes.txt`). With it, only the
    subject itself (`./a.py` too) or the absolute path `cwd`/subject, and
    the subject itself not after a `cd` elsewhere (`cd /x && cat a.py`)."""
    for m in re.finditer(r"(?<![\w.\-])" + re.escape(subject) + r"(?![\w\-])(?!\.\w)", text):
        start = m.start()
        while start and re.match(PATH_CHAR, text[start - 1]):
            start -= 1
        path = os.path.expanduser(text[start:m.end()])
        if not cwd:
            return True
        if os.path.isabs(path):
            if os.path.normpath(path) == os.path.normpath(os.path.join(str(cwd), subject)):
                return True
        elif os.path.normpath(path) == os.path.normpath(subject) and not moved(text[:start], cwd):
            return True
    return False


class ProactiveContextManager(Policy):
    name = "proactive_context_manager"
    event_types = EVENT_TYPES           # events.py

    def __init__(self, format: Format, llm: LLM, config: Optional[ProactiveContextManagerConfig] = None,
                 tokenizer: Optional[Tokenizer] = None, gatherers=None, jobs=None, log=None,
                 options: Optional[dict] = None):
        self.tokenizer = tokenizer                  # None: the manager's
        self.gatherers, self.jobs = gatherers, jobs         # Gatherers, Jobs (ag.ag_interface.store); jobs None: no background work
        if log is not None:
            self.log = log
        self.format = format
        self.llm = llm
        self.config = config or config_from(ProactiveContextManagerConfig, options, llm)
        # a max_context_tokens of the gatherer's own (or a whole config) wins over a harness's limit
        self.max_given = config is not None or "max_context_tokens" in (options or {})
        self._limited: Dict[int, ProactiveContextManagerConfig] = {}

    @property
    def groups(self):
        return self.config.groups

    # ------------------------------------------------------------ storage

    def init(self, conn) -> None:
        """`tasks`, `_builds` and `_boundaries` (tables.py), if absent."""
        tables.create(conn)

    def failed(self, gatherer_id: str, properties, job: str, job_id: int, error: str) -> None:
        """What a job of this policy leaves behind when it raised in the
        worker: a build is settled `failed`, a check's verdict is "no"."""
        channel_id = channel_of(properties)
        conn = self.gatherers.open(gatherer_id)
        try:
            if job == "build":
                tables.fail_build(conn, job_id, error)
            elif job == "check":
                tables.record_boundary(conn, job_id, False, f"check failed: {error}", channel_id)
        finally:
            conn.close()

    # ------------------------------------------------------------ read time

    @contextmanager
    def within(self, limit: Optional[int]):
        """`self.config` as a harness's own limit makes it (`config.within_limit`), while in
        the block: one read, or one build. Not when the gatherer sets max_context_tokens, or
        none is stated. (A policy is made for each request the server answers, and each job the
        worker runs: no other thread reads its config meanwhile.)"""
        saved = self.config
        if limit and not self.max_given:
            if limit not in self._limited:
                try:
                    self._limited[limit] = within_limit(saved, limit)
                except ValueError as exc:
                    self.log(f"the harness's limit {limit} leaves too little for the budgets ({exc}); "
                             f"max_context_tokens={saved.max_context_tokens} kept")
                    self._limited[limit] = saved
            self.config = self._limited[limit]
        try:
            yield
        finally:
            self.config = saved

    def read(self, conn, read: Read) -> Context:
        """The context for the channel's next model call: the sectioned
        context, with the stream messages of the verbatim part shown where
        they arrived, and a notice for every environment update the
        verbatim part refers to. Within the harness's own limit, when the
        call states one (`within`)."""
        with self.within(read.limit):
            return self.read_within(conn, read)

    def read_within(self, conn, read: Read) -> Context:
        cfg, ch = self.config, channel_of(read)
        types = TypeIds.load(conn)
        rows = history.rows(conn, types, self.groups, ch)
        if not rows:
            return Context()
        at_user = history.opens_turn(rows[-1], types, self.groups)
        latest = tables.build_for(conn, ch)
        last = conn.last_read(channel.of(ch))
        build, made = self.choose(conn, types, rows, latest, last, at_user or self.for_this_turn(latest, rows, types), read)
        items, refs, size, own = self.assemble(conn, rows, build, made, types, read)
        over = size > cfg.max_context_tokens or self.measured_over(last, build, ch)
        if over and not at_user and tables.waiting(latest, last):        # a ready build: taken now, not at the user
            build, made = self.choose(conn, types, rows, latest, last, True, read)
            items, refs, size, own = self.assemble(conn, rows, build, made, types, read)
            over = size > cfg.max_context_tokens or self.measured_over(last, build, ch)
        if at_user or over:
            latest = tables.build_for(conn, ch)
            started = self.start_due(conn, types, read, rows, latest, build, size, over)
            # over the limit, or joining, the read waits for its build however long it takes (up to build_timeout)
            seconds = cfg.build_timeout if (over and started == "build") or started == "join" else cfg.sync_seconds
            if started and seconds > 0 and self.wait(conn, ch, rows[-1].row_id, started, seconds):
                latest = tables.build_for(conn, ch)
                build, made = self.choose(conn, types, rows, latest, last, True, read)
                items, refs, size, own = self.assemble(conn, rows, build, made, types, read)
        if size > cfg.max_context_tokens:                # still over: the steps that do not fit, left out
            items, refs, size, own = self.assemble(conn, rows, build, made, types, read, stub=True)
        if size > cfg.max_context_tokens:
            self.log(f"[{ch}] context {size} tokens, over max_context_tokens={cfg.max_context_tokens}")
        self.last_tokens = own                      # the part of it the policy arranges
        return Context(items, refs, str(build["build_id"]) if build else None, tokens=own,
                       budget=cfg.max_context_tokens)

    def for_this_turn(self, build: Optional[dict], rows, types: TypeIds) -> bool:
        """Whether `build` is a new task's build made at this turn's own user message: its check found
        the new task there, and the read at it went on without it (the build took longer than the read
        waited). It is taken up at the turn's next call, not at the next user message: the sections
        replace only what came before the turn, and the turn itself stays verbatim, as it was."""
        if not build or build.get("reason") != tables.BOUNDARY or build["status"] != "ready":
            return False
        opening = next((r.row_id for r in reversed(rows) if history.opens_turn(r, types, self.groups)), None)
        return opening is not None and build["through_row"] == opening

    def measured_over(self, last: Optional[dict], build: Optional[dict], ch) -> bool:
        """Whether the provider's count of the last call's context (`real_tokens`, reported
        after the call) was over max_context_tokens, and that context is the one this read
        extends: the last read was made from the same build (or, like this one, from none).
        After a build its first call has not been counted yet, so a count from before it
        does not ask for another."""
        if not last or not last.get("real_tokens"):
            return False
        if last.get("basis") != (str(build["build_id"]) if build else None):
            return False
        if last["real_tokens"] <= self.config.max_context_tokens:
            return False
        self.log(f"[{ch}] the last call's context was {last['real_tokens']} tokens by the provider's count "
                 f"(ag counted {last.get('est_tokens')}), over max_context_tokens={self.config.max_context_tokens}")
        return True

    def assemble(self, conn, rows, build: Optional[dict], made: List[int], types: TypeIds,
                 read: Read, stub: bool = False) -> Tuple[list, list, int, int]:
        """(items, refs, tokens, own): the sectioned context -- preamble, the
        gatherer guide (`guide_item`), the section items, the pinned rows of the condensed span (the newest that
        fit keep_pinned_tokens), the running task verbatim (or the whole
        history before a build; after a build that cut the running task,
        only what came after it) -- with every stream message of the
        verbatim part shown in that last, verbatim run, at its row's place,
        and a notice at the place of each environment update of the verbatim
        part whose subject the agent's tool calls before it opened (`notices`). Messages and notices
        are made items; the events are never returned. Then the requests made
        to the other channels (`parallel_requests`): each where it was first
        shown, a new one before this channel's latest user message -- or,
        mid-turn, at the end (`parallel_places`).

        `tokens` is all the model gets with the context, what min_ and
        max_context_tokens are checked against: the context, and what the
        harness sends besides it (`read.fixed_tokens`, its system prompt and
        tools). `own` is the part the policy arranges, logged as the read's
        size: all of it but the harness's, the history's preamble, the guide and the
        sections' fixed overview. With `stub`, over the limit, agent steps of
        the verbatim part are replaced by notes naming their rows (`stubbed`):
        the read's last resort, once it has built what it could."""
        cfg = self.config
        preamble, body = history.arrange(rows, types, self.groups)
        if build is None:
            cut = 0
            pinned, tail = [], body
            made_items = {}
        else:
            cut = build["open_from_row"]
            pinned_ids = types.of(*self.groups.pinned)
            pinned = self.newest_within([r for r in body if r.row_id < cut and r.type.id in pinned_ids],
                                        cfg.keep_pinned_tokens)
            tail = [r for r in body if r.row_id >= cut]
            made_items = conn.made_items(made)
        guide = self.guide_item(conn, channel_of(read))
        before, since = self.requests_before(conn, types, rows, channel_of(read)) if build is None else ([], 0)
        items = ([r.payload for r in preamble] + [g[1] for g in guide] + [b[1] for b in before]
                 + [made_items[m][1] for m in made] + [r.payload for r in pinned])
        refs = ([Ref(row_id=r.row_id) for r in preamble] + [Ref(made_id=g[0]) for g in guide]
                + [Ref(made_id=b[0]) for b in before]
                + [Ref(made_id=m) for m in made] + [Ref(row_id=r.row_id) for r in pinned])
        fixed = self.tokenizer.count(layout.overview(cfg, joined(build))) if made else 0
        tokens = (sum(r.tokens for r in pinned) + sum(made_items[m][2] for m in made) - fixed
                  + sum(b[2] for b in before))
        made_here = (self.shown_messages(conn, types, channel_of(read), cut)
                     + self.notices(conn, types, channel_of(read), cut, preamble + pinned + tail, read.properties))
        entries = list(self.interleave(tail, made_here, types))
        shown = self.parallel_requests(conn, types, channel_of(read), build["parallel_mark"] if build else since)
        tokens += sum(cost[1] if kind == "made" else cost for kind, _, _, cost in entries) + sum(c for _, _, c, _ in shown)
        outside = (sum(r.tokens for r in preamble) + sum(g[2] for g in guide) + fixed
                   + read.fixed_tokens)                                          # the model gets these too
        tokens += outside
        if stub and tokens > cfg.max_context_tokens:
            entries, tokens = self.stubbed(conn, entries, tokens, types, read)
        for kind, row_id, item, cost in entries:
            items.append(item)
            refs.append(Ref(row_id=row_id) if kind == "row" else Ref(made_id=cost[0]))
        if shown:
            places = self.parallel_places(conn, refs, len(refs) - len(entries), rows, types, channel_of(read), shown)
            for at, i in sorted(((at, i) for i, at in enumerate(places)), reverse=True):
                made_id, item, _, _ = shown[i]              # the last first: the earlier places stay put,
                items.insert(at, item)                       # and the oldest at one place comes first
                refs.insert(at, Ref(made_id=made_id))
        return items, refs, tokens, tokens - outside

    def guide_item(self, conn, channel_id) -> List[tuple]:
        """[(made_id, item, tokens)] of the gatherer guide for the channel's reads, or [] with none
        configured. One made item while its text stays the same: the last one made for the channel,
        if it is that text, else a new one."""
        text = layout.guide(self.config, conn.path)
        if not text:
            return []
        item = self.format.make_section(text, GUIDE)
        col = property_column(CHANNEL)
        found = conn.execute(f"SELECT made_id FROM _made_items WHERE name = ? AND ifnull({col}, '') = ? "
                             f"ORDER BY made_id DESC LIMIT 1", (GUIDE, tables.key(channel_id))).fetchone()
        made_id = found[0] if found else None
        if made_id is None or conn.made_items([made_id])[made_id][1] != item:
            made_id = conn.make_item(item, self.tokenizer, properties=channel.of(channel_id), name=GUIDE)
        return [(made_id, item, conn.made_items([made_id])[made_id][2])]

    @staticmethod
    def newest_within(rows: list, budget: int) -> list:
        """The newest of `rows` whose tokens add up to at most `budget`, in order."""
        kept, used = [], 0
        for r in reversed(rows):
            if used + r.tokens > budget:
                break
            kept.append(r)
            used += r.tokens
        return kept[::-1]

    def step_starts(self, rows) -> List[int]:
        """The rows an agent step starts at: an agent event right after a tool output (the context
        events between them aside) -- where a cut keeps every tool call with its output and every
        model reply whole."""
        out, previous = [], None
        for r in rows:
            name = r.type.name
            if name == "context":
                continue
            if name in AGENT_STEP and previous == "tool_output":
                out.append(r.row_id)
            previous = name
        return out

    def stubbed(self, conn, entries: list, tokens: int, types: TypeIds, read: Read) -> Tuple[list, int]:
        """`entries` brought within max_context_tokens, as far as replacing agent steps of the verbatim
        part by notes naming their rows gets there: first each step far larger than its note, largest
        first (a huge tool output); then, if still over, the oldest steps together, by one note,
        until it fits -- the newest step is kept. A step's tool calls go with their outputs, so what
        remains is still a valid conversation; user messages are never replaced."""
        cfg = self.config
        by_row = {r.row_id: r for r in history.rows(conn, types, self.groups, channel_of(read))}
        rows = [(i, rid) for i, (kind, rid, _, _) in enumerate(entries) if kind == "row" and rid in by_row]
        starts = set(self.step_starts([by_row[rid] for _, rid in rows]))
        steps, current = [], None
        for i, rid in rows:
            if history.opens_turn(by_row[rid], types, self.groups):
                current = None
                continue
            if rid in starts or current is None:
                current = []
                steps.append(current)
            current.append(i)
        cost = lambda i: entries[i][3][1] if entries[i][0] == "made" else entries[i][3]
        replaced: Dict[int, Optional[tuple]] = {}

        def stub(indices: List[int]) -> int:
            """Replace the entries at `indices` (consecutive steps) by one note; the tokens it saves."""
            first, last = entries[indices[0]][1], entries[indices[-1]][1]
            size = sum(cost(i) for i in indices)
            calls = [str(event_text(by_row[entries[i][1]]) or "")[:60] for i in indices
                     if entries[i][0] == "row" and by_row[entries[i][1]].type.name == "tool_call"]
            text = (f"[Agent steps were left out here to keep the context within max_context_tokens: "
                    f"{len(indices)} events, {size} tokens"
                    + (f"; their calls: {'; '.join(calls[:3])}{' ...' if len(calls) > 3 else ''}" if calls else "")
                    + f". Read event rows {first}-{last} from the context database, {conn.path}, if you need them.]")
            item = self.format.make_section(text, LEFT_OUT)
            made_id = conn.make_item(item, self.tokenizer, properties=channel.of(channel_of(read)), name=LEFT_OUT,
                                     source=f"rows {first}-{last}")
            note = conn.made_items([made_id])[made_id][2]
            replaced[indices[0]] = ("made", first, item, (made_id, note))
            for i in indices[1:]:
                replaced[i] = None
            return size - note

        note_size = 4 * self.tokenizer.count(f"[Agent steps were left out here ... {conn.path} ...]")
        for step in sorted(steps, key=lambda st: -sum(cost(i) for i in st)):
            if tokens <= cfg.max_context_tokens or sum(cost(i) for i in step) < 5 * note_size:
                break                                    # a note per step only for a step far larger than it
            tokens -= stub(step)
        left = [st for st in steps if st[0] not in replaced]
        if tokens > cfg.max_context_tokens and len(left) > 1:
            run, saved = [], 0
            for st in left[:-1]:                         # the oldest first; the newest step stays
                run.append(st)
                saved = sum(cost(i) for s_ in run for i in s_) - note_size // 4
                if tokens - saved <= cfg.max_context_tokens:
                    break
            run_indices = [i for s_ in run for i in s_]
            if all(b == a + 1 or replaced.get(a + 1, 0) is None for a, b in zip(run_indices, run_indices[1:])):
                tokens -= stub(run_indices)
        return [replaced.get(i, e) for i, e in enumerate(entries) if replaced.get(i, e) is not None], tokens

    def parallel_places(self, conn, refs: list, tail_from: int, rows, types: TypeIds, channel_id,
                        shown: List[tuple]) -> List[int]:
        """Where in the context each of `shown` goes, before any is inserted: where it was in the
        channel's last read (`shown_before`) -- before the row it came before, or, shown last, before
        the first row after the one it came after -- or, that row condensed away, before the first
        row of the verbatim part (`refs[tail_from:]`) after it. A request not shown before goes
        before this channel's latest user message, the call being at it; mid-turn (a step of the
        agent's own after that message), or with none, at the end. Not before the turn's steps: a
        thinking block counts, and the model reads it, only after the history it was written in, so
        a request put before them would leave out all the turn's thinking so far."""
        mine = [r for r in rows if channel_of(r) == channel_id]
        own = [r.row_id for r in mine if history.opens_turn(r, types, self.groups)]
        latest = own[-1] if own else None
        steps = types.of(*self.groups.messages, *self.groups.tools, *self.groups.verbatim)
        if latest is not None and any(r.row_id > latest and r.type.id in steps for r in mine):
            latest = None                                # mid-turn: a new one goes at the end
        before, after = self.shown_before(conn, channel_id)
        places = []
        for _, _, _, row in shown:
            if row in after:                             # shown last: right after the row it followed
                anchor = after[row] + 1
            else:
                anchor = before.get(row, latest)
            at = len(refs) if anchor is None else next(
                (i for i in range(tail_from, len(refs)) if refs[i].row_id is not None and refs[i].row_id >= anchor),
                len(refs))
            places.append(at)
        return places

    def shown_before(self, conn, channel_id) -> Tuple[Dict[int, int], Dict[int, int]]:
        """({request row: the row it came before}, {request row: the row it came after}) for each other
        channel's request the channel's last read showed (its made item's source names the request):
        the second for one shown last, with no row after it (shown mid-turn, at the end). Every request
        since the build's mark is shown on every read, so the last read has each one shown before, in
        its place."""
        last = conn.last_read(channel.of(channel_id))
        refs = last["refs"] if last else []
        made = [r.made_id for r in refs if r.made_id is not None]
        if not made:
            return {}, {}
        sources = dict(conn.execute(f"SELECT made_id, source FROM _made_items WHERE name = ? AND made_id IN "
                                    f"({','.join('?' * len(made))})", [PARALLEL_REQUEST, *made]).fetchall())
        out, waiting, previous = {}, [], None
        for ref in refs:
            if ref.made_id in sources and str(sources[ref.made_id]).startswith("request "):
                waiting.append(int(str(sources[ref.made_id]).split()[1]))
            elif ref.row_id is not None:
                out.update((request, ref.row_id) for request in waiting)
                waiting, previous = [], ref.row_id
        return out, ({request: previous for request in waiting} if previous is not None else {})

    def parallel_requests(self, conn, types: TypeIds, channel_id, after_row: int) -> List[tuple]:
        """(made_id, item, tokens, its row id) for each user message stored in
        another channel after `after_row`, oldest first."""
        out, unseen = [], self.unseen(conn, types)
        for r in conn.rows(after_row, types.of(*self.groups.user), differ=channel.of(channel_id)):
            other = channel_of(r)
            if other is None or other == channel_id or other in unseen or not self.shared(r):
                continue
            text = self.config.parallel_message.format(text=event_text(r) or "", channel=other, db_path=conn.path,
                                                       channel_column=property_column(CHANNEL))
            item = self.format.make_section(text, PARALLEL_REQUEST)
            made_id = conn.make_item(item, self.tokenizer, properties=channel.of(channel_id), name=PARALLEL_REQUEST,
                                     source=f"request {r.row_id}")
            out.append((made_id, item, conn.made_items([made_id])[made_id][2], r.row_id))
        return out

    def requests_before(self, conn, types: TypeIds, rows, channel_id) -> Tuple[List[tuple], int]:
        """With no build in use: ([(made_id, item, tokens)] of one block of the other channels'
        requests made before the channel's first row, or [] when they fit as messages), and the row
        after which `parallel_requests` shows them one by one -- 0, all, without a block.

        As messages they would be at most all_task_tokens + parallel_index_tokens, the budget a
        session that joined gets for them; past it, the block holds the newest that fit it
        (`layout.requests_before`). Made at the first read without a build that needs it and reused
        after (the channel's last read, made without a build, has it), so later reads extend the
        same context."""
        cfg = self.config
        start = next((r.row_id for r in rows if channel_of(r) == channel_id), None)
        if start is None:
            return [], 0
        last = conn.last_read(channel.of(channel_id))
        if last and tables.basis_of(last) is None:
            made = [r.made_id for r in last["refs"] if r.made_id is not None]
            kept = [(m, item, tokens) for m, (name, item, tokens) in conn.made_items(made).items()
                    if name == PARALLEL_BEFORE]
            if kept:
                return kept[:1], start
        unseen = self.unseen(conn, types)
        before = [(c, e) for c, e in history.other_requests(conn, types, self.groups, self.tokenizer, channel_id,
                                                            keep=lambda r: channel_of(r) not in unseen and self.shared(r))
                  if e.row_id < start]
        budget, used = cfg.all_task_tokens + cfg.parallel_index_tokens, 0
        for other, e in before:
            used += self.tokenizer.count(cfg.parallel_message.format(
                text=e.text or "", channel=other, db_path=conn.path, channel_column=property_column(CHANNEL)))
            if used > budget:
                break
        else:
            return [], 0                                  # they fit: each a message, as always
        with_cleaned(conn, [e for _, e in before])
        item = self.format.make_section(layout.requests_before(before, budget, self.tokenizer), PARALLEL_BEFORE)
        made_id = conn.make_item(item, self.tokenizer, properties=channel.of(channel_id), name=PARALLEL_BEFORE,
                                 source=f"requests before {start}")
        return [(made_id, item, conn.made_items([made_id])[made_id][2])], start

    def unseen(self, conn, types: TypeIds) -> set:
        """The channels no other channel is shown: those whose latest ROLE record says `private`."""
        private: Dict[str, bool] = {}
        for r in conn.rows(0, types.of(ROLE)):
            ch = channel_of(r)
            if ch is not None:
                private[ch] = bool(isinstance(r.payload, dict) and r.payload.get("private"))
        return {ch for ch, hidden in private.items() if hidden}

    def shared(self, r: Row) -> bool:
        """Whether another channel's user message is shown to this one as its user's request: not a message the actors
        sent each other, which opens a line with one of `unshared_openings` -- at its start, or past the wrapper its
        harness put round it (a mid-turn note, a paste's tags)."""
        openings = self.config.unshared_openings
        if not openings:
            return True
        head = (event_text(r) or "")[:OPENING_CHARS]
        return not any(line.lstrip().startswith(openings) for line in head.split("\n"))

    def interleave(self, tail, made_here: List[tuple], types: TypeIds) -> List[tuple]:
        """The tail's rows, as ("row", row_id, payload, tokens), and the
        messages and notices made for outside events, together in row
        order: each where its event was stored, which -- the pollers being
        asked at read time -- is where the model first saw it."""
        entries = [("row", r.row_id, r.payload, r.tokens) for r in tail] + list(made_here)
        return sorted(entries, key=lambda e: e[1])

    def outside(self, conn, types: TypeIds, channel_id, cut: int, name: str) -> list:
        """The events of type `name` the channel can see from `cut` on -- the
        verbatim part of the context; those a build has condensed past are
        not looked at -- in row order."""
        return conn.rows(after_row=max(cut - 1, 0), match=channel.of(channel_id), type_ids=types.of(name))

    def shown_messages(self, conn, types: TypeIds, channel_id, cut: int) -> List[tuple]:
        """("made", row_id, item, (made_id, tokens)) for each stream message
        of the verbatim part: a developer message worded by the config,
        stored as a made item so the read log shows what was sent; keyed by
        the event's row id so it sorts into its place in the history."""
        out = []
        for r in self.outside(conn, types, channel_id, cut, CONTEXT_STREAM):
            payload = r.payload if isinstance(r.payload, dict) else {}
            text = self.config.message.format(stream=payload.get("stream", ""), author=payload.get("author", ""),
                                              text=payload.get("text", ""), timestamp=shown(payload.get("timestamp")))
            item = self.format.make_section(text, "context_stream")
            made_id = conn.make_item(item, self.tokenizer, properties=channel.of(channel_id),
                                      name="context_stream", source=f"message {r.row_id}")
            out.append(("made", r.row_id, item, (made_id, conn.made_items([made_id])[made_id][2])))
        return out

    def notices(self, conn, types: TypeIds, channel_id, cut: int, verbatim,
                read_properties=None) -> List[tuple]:
        """("made", row_id, item, (made_id, tokens)): one notice per poll, for
        the environment updates of the verbatim part -- in the read's working
        directory (`cwd`), when both have one -- that the agent should hear
        of. Better one notice too few than one too many, so an update counts
        only when:

          - a tool call of the agent's own before it, in the verbatim part,
            names the subject (`mentions`: the file itself, by its path
            under `cwd` when absolute) -- what a message or a tool's output
            says does not count;
          - for a subject already notified there, a tool call names it again
            after that notice: the agent read it since, so there is a newer
            read to be out of date (without one, the notice it has stands);
          - it is not the agent's own doing: no tool call that came in with
            it (`history.batch_start`: what the agent ran since its previous
            model call, while the change happened) names the subject and
            could have written it (`own_change`) -- nor one that came in with
            the first request after the change's own time (`history.batch_at`),
            for a change reported late: a poller for a directory the agent
            comes back to reports what changed there since it last looked.

        It names them (up to `notice_names`), or counts them. Keyed by the
        first update's row id, so it sorts into its place in the history.
        On the read after the poll, it is the newest thing in the context; on
        later ones it is history, and whatever the model did about it (read
        the file again) comes after it. Each is a made item."""
        updates = self.outside(conn, types, channel_id, cut, ENVIRONMENT_UPDATE)
        if not updates:
            return []
        texts = [(v.row_id, v.type.id, event_text(v)) for v in verbatim]
        calls = types.of("tool_call")
        noticed: Dict[str, Tuple[int, int]] = {}              # subject -> (its last notice's update row, batch start)
        polls: Dict[int, dict] = {}                          # batch start -> {subject: (row id, subject, payload, repeat)}
        for r in updates:
            payload = r.payload if isinstance(r.payload, dict) else {}
            subject = payload.get("subject")
            if not isinstance(subject, str) or not subject or not same_place(r, read_properties):
                continue                                     # another directory's file of that name
            cwd = cwd_of(r) or cwd_of(read_properties)
            start = history.batch_start(conn, channel_id, r.row_id)
            before = noticed.get(subject)
            if before is not None and before[1] == start:    # changed again in the same poll: its latest
                polls[start][subject] = (r.row_id, subject, payload, polls[start][subject][3])
                noticed[subject] = (r.row_id, start)
                continue
            after = before[0] if before else 0
            if not any(after < row < r.row_id and tid in calls and mentions(text, subject, cwd)
                       for row, tid, text in texts):
                continue                                     # not seen, or not again since its notice
            if self.own_change(texts, types, start, r.row_id, subject, cwd):
                continue                                     # the agent's own doing
            stamp = payload.get("timestamp")
            if isinstance(stamp, (int, float)) and not isinstance(stamp, bool) and stamp > 10 ** 9:
                after, through = history.batch_at(conn, channel_id, stamp, r.row_id)
                if self.own_change(texts, types, after, through + 1, subject, cwd):
                    continue                                 # its own, made then, reported late
            polls.setdefault(start, {})[subject] = (r.row_id, subject, payload, before is not None)
            noticed[subject] = (r.row_id, start)
        out = []
        for by_subject in polls.values():
            found = sorted(by_subject.values(), key=lambda f: f[0])
            cfg = self.config
            if len(found) == 1:
                row, subject, payload, repeat = found[0]
                text = cfg.notice.format(**self.notice_fields(subject, payload, repeat))
            elif len(found) <= cfg.notice_names:
                text = cfg.notice_named.format(subjects=", ".join(f[1] for f in found))
            else:
                text = cfg.notice_counted.format(count=len(found))
            item = self.format.make_section(text, "environment_update")
            rows = [f[0] for f in found]
            made_id = conn.make_item(item, self.tokenizer, properties=channel.of(channel_id), name="environment_update",
                                      source="update " + ",".join(map(str, rows)))
            out.append(("made", rows[0], item, (made_id, conn.made_items([made_id])[made_id][2])))
        return out

    def notice_fields(self, subject: str, payload: dict, repeat: bool) -> dict:
        """What a one-file notice is worded from (`notice`): {what}, {subject}, {timestamp}, and
        {repeat}: the config's `notice_repeat` when an earlier change to the same file was already
        notified in the verbatim part (and the agent read the file again since), else ""."""
        return {"what": payload.get("what") or f"{subject} changed", "subject": subject,
                "timestamp": shown(payload.get("timestamp")), "repeat": self.config.notice_repeat if repeat else ""}

    def own_change(self, texts, types: TypeIds, start: int, row_id: int, subject: str, cwd=None) -> bool:
        """Whether the update at `row_id` is the agent's own doing: a tool CALL that came in with it
        (rows after `start`, the channel's last read before it) names the subject and could have
        written it (`writes`). A call that only read the file, or an output that shows it, does not
        hide someone else's change."""
        calls = types.of("tool_call")
        return any(start < row < row_id and tid in calls and mentions(text, subject, cwd) and writes(text, subject, cwd)
                   for row, tid, text in texts)

    # ---- the rest is the sections: segmentation, ranking, builds, adoption

    def choose(self, conn, types: TypeIds, rows, latest, last_read, at_user: bool,
               read: Read) -> Tuple[Optional[dict], List[int]]:
        """(the build in use, its section items' made_ids in order), or
        (None, []). A ready build newer than the last read's is switched to
        when `at_user` -- at a user message, when the context is over
        max_context_tokens, or at a later call of the turn a new task's build was
        made for (`for_this_turn`) -- and laid out then (`adopt`)."""
        if at_user and tables.waiting(latest, last_read):
            made = self.adopt(conn, types, rows, latest, read)
            if made is not None:
                return tables.get_build(conn, latest["build_id"]), made          # its cut as adoption set it
        used = tables.basis_of(last_read)
        if used is None:
            return None, []
        # the messages, notices and parallel requests of the last read are remade each time; only the
        # sections are reused
        made = [r.made_id for r in last_read["refs"] if r.made_id is not None]
        names = conn.made_items(made)
        return tables.get_build(conn, used), [m for m in made
                                              if names[m][0] not in ("context_stream", "environment_update", PARALLEL_REQUEST,
                                                                     PARALLEL_BEFORE, LEFT_OUT, GUIDE)]

    def adopt(self, conn, types: TypeIds, rows, build: dict, read: Read) -> Optional[List[int]]:
        """Lay `build`'s analysis out as sections and store them as made
        items; None (and the build settled `nothing`) if they would not be
        smaller than the history they replace."""
        cfg, tok, groups, ch = self.config, self.tokenizer, self.groups, channel_of(read)
        _, turns = history.split(rows, types, groups, tok)
        with_cleaned(conn, [t.entries[0] for t in turns])
        joining = joined(build)
        if joining:                                  # its own history, all of it, is the running task
            tasks = [self.joined_task(turns, ch)] if turns else []
        else:
            tasks = tasks_tool.locate(tables.tasks_for(conn, ch), turns)
        if not tasks:
            tables.settle(conn, build["build_id"], "nothing", error="no tasks at adoption")
            return None
        foreign, turns_by_channel = self.other_tasks(conn, types, ch)
        turns_by_channel[ch] = turns
        before = tasks[:-2]
        earlier = layout.earlier_messages(before, turns, cfg, tok)
        shown = {id(before[i]) for i in earlier[1]}
        by_key = {(tables.key(t.channel_id), t.task_index): t for t in before + foreign}
        ranked = [by_key[tuple(k)] for k in build["ranking"] if tuple(k) in by_key]
        ranked = [t for t in ranked if id(t) not in shown]
        mark = build["parallel_mark"]
        unseen = self.unseen(conn, types)
        others = [(c, e) for c, e in history.other_requests(conn, types, groups, tok, ch,
                                                            keep=lambda r: channel_of(r) not in unseen and self.shared(r))
                  if e.row_id <= mark]
        with_cleaned(conn, [e for _, e in others])
        sections = layout.build_sections(turns, tasks, ranked, earlier, others, turns_by_channel, ch, cfg, tok,
                                         conn.path, build["through_row"], mark, joined=joining)
        cut = self.cut_for(rows, types, tasks[-1], sections, conn.path, read.fixed_tokens, joining)
        if cut != sections.open_from_row:
            sections = layout.build_sections(turns, tasks, ranked, earlier, others, turns_by_channel, ch, cfg, tok,
                                             conn.path, build["through_row"], mark, cut_row=cut, joined=joining)
        if not joining and len(tasks) < 2 and sections.open_from_row == tasks[-1].first_row:
            tables.settle(conn, build["build_id"], "nothing", error="fewer than two tasks, and no cut inside the one")
            return None
        if sections.open_from_row != build["open_from_row"]:
            tables.set_cut(conn, build["build_id"], sections.open_from_row)
        # compacted: not sent whole again; joined: the sections replace nothing of its own, they add the others' work
        if cfg.require_smaller and build.get("reason") not in (tables.COMPACTION, tables.JOIN):
            why = self.not_smaller(sections, rows, turns, types)
            if why:
                tables.settle(conn, build["build_id"], "nothing", error=why)
                self.log(f"build {build['build_id']} not adopted: {why}")
                return None
        source = f"build {build['build_id']}"
        made = [conn.make_item(self.format.make_section(text, name), tok, properties=channel.of(ch), name=name,
                               source=source)
                for name, text in sections.sections]
        return made

    def cut_for(self, rows, types: TypeIds, running, sections, db_path, fixed_tokens: int = 0,
                joining: bool = False) -> int:
        """Where the verbatim part should start: the running task's start -- or, when the sections, the
        pinned rows and the running task from there, with what the model gets besides them (the
        history's preamble, the harness's `fixed_tokens`), would be over max_context_tokens, after the
        last event: the running task is then all in "This task so far", and only what comes after it
        is verbatim."""
        cfg, tok = self.config, self.tokenizer
        preamble, body = history.arrange(rows, types, self.groups)
        task_rows = [r for r in body if r.row_id >= running.first_row]
        if not task_rows:
            return running.first_row
        overview = tok.count(layout.overview(cfg, joining))
        held = sum(tok.count(text) for _, text in sections.sections) - overview
        pinned_ids = types.of(*self.groups.pinned)
        pinned = self.newest_within([r for r in body if r.row_id < running.first_row and r.type.id in pinned_ids],
                                    cfg.keep_pinned_tokens)
        whole = held + sum(r.tokens for r in pinned) + sum(r.tokens for r in task_rows) \
            + sum(r.tokens for r in preamble) + overview + tok.count(layout.guide(cfg, db_path)) + fixed_tokens
        return running.first_row if whole <= cfg.max_context_tokens else task_rows[-1].row_id + 1

    def not_smaller(self, sections, rows, turns, types: TypeIds) -> Optional[str]:
        pinned = types.of(*self.groups.pinned)
        replaced = sum(r.tokens for r in rows
                       if turns[0].first_row <= r.row_id < sections.open_from_row and r.type.id not in pinned)
        size = sum(self.tokenizer.count(text) for _, text in sections.sections)
        if size >= replaced:
            return f"sections ({size} tokens) not smaller than the history they replace ({replaced})"
        return None

    def start_due(self, conn, types: TypeIds, read: Read, rows, latest, in_use, size: int, over: bool = False) -> str:
        """Start what is due in the background: "build", "check", "join" or "" (the build thresholds) --
        at a user message, or at any read when the context is `over` max_context_tokens: a build then,
        or the one already running ("build", to wait for). A channel with no build at all (`latest`
        None: neither its own nor the no-channel pool's) joins, when another channel has one: a
        `join` build, whatever the context's size, which the read waits for."""
        cfg, ch = self.config, channel_of(read)
        if self.jobs is None:                      # no background work
            return ""
        if latest is None and tables.joinable(conn, ch):
            build_id = tables.claim_build(conn, ch, cfg.build_timeout, tables.JOIN)
            if build_id is None:
                return ""
            try:
                self.jobs.start(read.gatherer_id, channel.of(ch), "build", build_id)
            except OSError as exc:
                tables.fail_build(conn, build_id, f"could not start the worker: {exc}")
                return ""
            return "join"
        if latest and latest["status"] == "running" and time.time() - latest["started_at"] < cfg.build_timeout:
            return "build" if over else ""
        if latest and latest["status"] == "ready" and (not in_use or latest["build_id"] != in_use["build_id"]):
            return ""
        if not over and size < cfg.min_context_tokens and not cfg.build_every_request:
            return ""
        if over or cfg.build_every_request:
            build_id = tables.claim_build(conn, ch, cfg.build_timeout, tables.LIMIT if over else tables.REQUEST)
            if build_id is None:
                return ""
            try:
                self.jobs.start(read.gatherer_id, channel.of(ch), "build", build_id)
            except OSError as exc:
                tables.fail_build(conn, build_id, f"could not start the worker: {exc}")
                return ""
            return "build"
        if not cfg.check_boundaries:
            return ""
        if in_use:
            since_row = in_use["open_from_row"] - 1
        elif latest and latest["status"] in ("failed", "nothing"):
            since_row = latest["through_row"] or 0
        else:
            since_row = 0
        into_task = sum(1 for r in rows if r.row_id > since_row and history.opens_turn(r, types, self.groups))
        # a build a reader asked for, made mid-task, may have moved the running task's start (and so the
        # cooldown's count): the first user message after it is asked about all the same, so a change of
        # topic gets a build of its own -- its ranking made for the new request, not for the old one
        after_asked = bool(in_use) and in_use.get("reason") == tables.ASKED \
            and not tables.checked_since(conn, ch, in_use.get("through_row") or 0)
        if into_task <= cfg.boundary_cooldown and not after_asked:
            return ""
        row_id = rows[-1].row_id
        if not tables.claim_boundary(conn, row_id, ch):
            return ""
        try:
            self.jobs.start(read.gatherer_id, channel.of(ch), "check", row_id)
        except OSError as exc:
            tables.record_boundary(conn, row_id, False, f"could not start the worker: {exc}", ch)
            return ""
        return "check"

    def compacted(self, conn, read: Read) -> str:
        """The harness compacted its own history (Claude Code's /compact, or its own at its limit): build
        now -- a `compaction` build, which closes the running task as one over the limit does, and is
        adopted at the next read whatever its size -- and wait for it, up to build_timeout. What it came
        to: "ready", "failed", "nothing", "timeout"; "" with no background work."""
        with self.within(read.limit):
            cfg, ch = self.config, channel_of(read)
            if self.jobs is None:
                return ""
            build_id = tables.claim_build(conn, ch, cfg.build_timeout, tables.COMPACTION)
            if build_id is None:                    # one is running: let it finish, then build again
                self.wait(conn, ch, read.row_id, "build", cfg.build_timeout)
                build_id = tables.claim_build(conn, ch, cfg.build_timeout, tables.COMPACTION)
            if build_id is None:
                return "timeout"
            try:
                self.jobs.start(read.gatherer_id, channel.of(ch), "build", build_id)
            except OSError as exc:
                tables.fail_build(conn, build_id, f"could not start the worker: {exc}")
                return "failed"
            self.wait(conn, ch, read.row_id, "build", cfg.build_timeout)
            build = tables.get_build(conn, build_id) or {}
            return build.get("status") if build.get("status") in ("ready", "failed", "nothing") else "timeout"

    def requested(self, conn, read: Read, min_messages: int = 0) -> dict:
        """A build a reader asked for from outside any call (the dashboard's History view): an ordinary
        build (reason `asked`), started in the background and not waited for -- once the channel has at
        least `min_messages` user messages since the last its builds went through (since its start,
        before any) -- a join aside: it splits nothing of the channel's own history. Adopted as any build is: at the channel's next user message. What came of it:
        {"started": build_id, "messages": n}; {"running": build_id}, one already is; {"few": n}, only n
        such messages since; {"failed": why}; {} with no background work."""
        cfg, ch = self.config, channel_of(read)
        if self.jobs is None:
            return {}
        latest = tables.latest_build(conn, ch)
        if latest and latest["status"] == "running" and time.time() - latest["started_at"] < cfg.build_timeout:
            return {"running": latest["build_id"]}
        types = TypeIds.load(conn)
        since = conn.execute("SELECT max(through_row) FROM _builds WHERE channel_key = ? AND coalesce(reason, '') != ?",
                             (tables.key(ch), tables.JOIN)).fetchone()[0] or 0
        n = sum(1 for r in history.rows(conn, types, self.groups, ch)
                if r.row_id > since and history.opens_turn(r, types, self.groups))
        if n < min_messages:
            return {"few": n}
        build_id = tables.claim_build(conn, ch, cfg.build_timeout, tables.ASKED)
        if build_id is None:                         # another started one meanwhile
            return {"running": (tables.latest_build(conn, ch) or {}).get("build_id")}
        try:
            self.jobs.start(read.gatherer_id, channel.of(ch), "build", build_id)
        except OSError as exc:
            tables.fail_build(conn, build_id, f"could not start the worker: {exc}")
            return {"failed": str(exc)}
        self.log(f"[{ch}] build {build_id} asked for, {n} user messages since the last")
        return {"started": build_id, "messages": n}

    def wait(self, conn, channel_id, row_id: int, started: str, seconds: float) -> bool:
        """Whether the build the read started (or the one its check found a new task for) is ready
        within `seconds` -- for a check that finds a new task, within build_wait_seconds, if longer:
        the check answers in seconds, the build it starts takes tens of them."""
        begun = time.monotonic()
        deadline = begun + seconds
        started = "build" if started == "join" else started
        while True:
            if started == "check":
                verdict = tables.boundary_verdict(conn, row_id)
                if verdict and verdict["new_task"] is False:
                    return False
                if verdict and verdict["new_task"] is True:
                    started = "build"
                    deadline = max(deadline, begun + self.config.build_wait_seconds)
            if started == "build":
                build = tables.latest_build(conn, channel_id)
                if build and build["status"] == "ready":
                    return True
                if build and build["status"] in ("failed", "nothing"):
                    return False
            if time.monotonic() >= deadline:
                return False
            time.sleep(min(0.1, max(0.0, deadline - time.monotonic())))

    def other_tasks(self, conn, types: TypeIds, channel_id) -> Tuple[List, Dict]:
        found, turns_by_channel, unseen = [], {}, self.unseen(conn, types)
        for other in tables.channels_with_tasks(conn):
            if other == channel_id or other is None or other in unseen:
                continue
            _, turns = history.split(history.rows(conn, types, self.groups, other), types, self.groups, self.tokenizer)
            with_cleaned(conn, [t.entries[0] for t in turns])
            turns_by_channel[other] = turns
            found += tasks_tool.locate(tables.load_tasks(conn, other), turns)
        return found, turns_by_channel

    # ------------------------------------------------------------ the worker's jobs

    def build(self, gatherer_id: str, properties, build_id: int) -> Optional[dict]:
        """The analysis: segmentation, the summaries of the newly finished
        tasks, a ranking of every earlier task. Kept in `tasks` and on the
        build (tables.py). A build started because the context was over
        max_context_tokens (reason `limit`) closes the running task at the
        last user message: what came before is finished and summarised, and
        that message starts the running task (`limit_tasks`). Within the
        limit the channel's harness stated last (`within`)."""
        conn = self.gatherers.open(gatherer_id)
        try:
            last = conn.last_read(channel.of(channel_of(properties)))
        finally:
            conn.close()
        with self.within((last or {}).get("limit_tokens")):
            return self.build_within(gatherer_id, properties, build_id)

    def build_within(self, gatherer_id: str, properties, build_id: int) -> Optional[dict]:
        channel_id = channel_of(properties)
        cfg, tok, groups = self.config, self.tokenizer, self.groups
        conn = self.gatherers.open(gatherer_id)
        try:
            types = TypeIds.load(conn)
            rows = history.rows(conn, types, groups, channel_id)
            through_row = rows[-1].row_id if rows else 0
            mark = conn.high_water()
            preamble, turns = history.split(rows, types, groups, tok)
            reason = (tables.get_build(conn, build_id) or {}).get("reason")
            if reason == tables.JOIN:
                return self.join_build(conn, types, channel_id, turns, build_id, through_row, mark)
            limit = reason in (tables.LIMIT, tables.COMPACTION)
            if limit:
                if not turns:
                    return self.nothing(conn, build_id, through_row, "no turns")
                tasks, failed, fresh = self.limit_tasks(conn, channel_id, turns)
            else:
                # one turn, or one task, is built only when it is over the limit: a cut inside it is then due --
                # all the model gets, with what the harness sends besides it (as its last call stated)
                fixed = (conn.last_read(channel.of(channel_id)) or {}).get("fixed_tokens") or 0
                oversized = sum(r.tokens for r in rows) + fixed > cfg.max_context_tokens
                if len(turns) < 2 and not oversized:
                    return self.nothing(conn, build_id, through_row, "fewer than two turns")
                tasks, failed, fresh = segmentation.update(turns, tables.tasks_for(conn, channel_id), self.llm,
                                                           cfg.segmentation, tok)
            if failed:
                tables.fail_build(conn, build_id, "segmentation: no model call answered", through_row=through_row)
                return None
            for i, t in enumerate(tasks):
                t.channel_id, t.task_index = channel_id, i
            if not limit and len(tasks) < 2 and not (tasks and oversized):
                tables.save_tasks(conn, channel_id, tasks)
                return self.nothing(conn, build_id, through_row, "fewer than two tasks")
            with ThreadPoolExecutor(max_workers=1) as pool:
                summaries = pool.submit(summarize.summarize, fresh, turns, self.llm, cfg.summarizing) if fresh else None
                candidates = list(tasks[:-2])
                if cfg.parallel_related_tasks:
                    candidates += self.other_tasks(conn, types, channel_id)[0]
                ranked = ranking.rank(candidates, ranking.rank_target(turns, cfg.ranking), self.llm, cfg.ranking,
                                      own_channel=channel_id, top_n=len(candidates)) if candidates else []
                if summaries:
                    summaries.result()
            tables.save_cleaned(conn, build_id, cleaned_of(fresh, turns))
            tables.save_tasks(conn, channel_id, tasks)
            tables.settle(conn, build_id, "ready", through_row=through_row, open_from_row=tasks[-1].first_row,
                          ranking=[(tables.key(t.channel_id), t.task_index) for t in ranked], parallel_mark=mark)
            return tables.get_build(conn, build_id)
        finally:
            conn.close()

    def join_build(self, conn, types: TypeIds, channel_id, turns, build_id: int, through_row: int,
                   mark: int) -> Optional[dict]:
        """A channel's join: no segmentation -- its own history is all the running task -- and the
        other channels' tasks ranked against it (when parallel_related_tasks), their requests up to
        `mark` seen. Its tasks are not saved: the channel's first build of its own segments from
        nothing."""
        cfg = self.config
        if not turns:
            return self.nothing(conn, build_id, through_row, "no turns")
        candidates = self.other_tasks(conn, types, channel_id)[0] if cfg.parallel_related_tasks else []
        ranked = ranking.rank(candidates, ranking.rank_target(turns, cfg.ranking), self.llm, cfg.ranking,
                              own_channel=channel_id, top_n=len(candidates)) if candidates else []
        tables.settle(conn, build_id, "ready", through_row=through_row, open_from_row=turns[0].first_row,
                      ranking=[(tables.key(t.channel_id), t.task_index) for t in ranked], parallel_mark=mark)
        return tables.get_build(conn, build_id)

    @staticmethod
    def joined_task(turns, channel_id) -> history.Task:
        """The one task of a channel that joined: all its turns, running."""
        first, last = turns[0], turns[-1]
        task = history.Task(CURRENT_REQUEST, first.user_text.strip()[:200], first.first_row, last.last_row,
                            first.index, last.index)
        task.channel_id = channel_id
        return task

    def limit_tasks(self, conn, channel_id, turns) -> Tuple[List, bool, List]:
        """(the tasks, whether segmentation failed, the tasks to summarise) of a `limit` build: the
        last user message starts the running task, CURRENT_REQUEST, and everything before it is
        finished. Segmentation is given only the turns before it, so it names and describes tasks
        from exactly the turns they cover; the last task it returns -- open in its view -- is closed
        here and summarised with the others it finished. A second limit build in the same turn finds
        the running task already starting there and segments nothing again."""
        last = turns[-1]
        current = history.Task(CURRENT_REQUEST, last.user_text.strip()[:200], last.first_row, last.last_row,
                               last.index, last.index)
        stored = tasks_tool.locate(tables.tasks_for(conn, channel_id), turns)
        if len(turns) == 1:
            return [current], False, []
        if stored and stored[-1].first_row == last.first_row:      # an earlier limit build in this turn
            return stored[:-1] + [current], False, []
        tasks, failed, fresh = segmentation.update(turns[:-1], tables.tasks_for(conn, channel_id), self.llm,
                                                   self.config.segmentation, self.tokenizer)
        if failed:
            return tasks, True, fresh
        if tasks and all(t is not tasks[-1] for t in fresh):
            fresh = fresh + [tasks[-1]]                            # finished now: summarised with the rest
        return tasks + [current], False, fresh

    def nothing(self, conn, build_id: int, through_row: int, why: str) -> None:
        tables.settle(conn, build_id, "nothing", through_row=through_row, error=why)
        self.log(f"no build: {why}")
        return None

    def check(self, gatherer_id: str, properties, row_id: int) -> bool:
        """The boundary tool's verdict on the user message `row_id`, recorded;
        on a yes, a build is claimed and run; no usable answer counts as a
        no. Returns what was decided."""
        channel_id = channel_of(properties)
        cfg, tok, groups = self.config, self.tokenizer, self.groups
        conn = self.gatherers.open(gatherer_id)
        try:
            types = TypeIds.load(conn)
            rows = history.rows(conn, types, groups, channel_id)
            _, turns = history.split(rows, types, groups, tok)
            stored = tasks_tool.locate(tables.tasks_for(conn, channel_id), turns)
            open_from = stored[-1].first_row if stored else (turns[0].first_row if turns else 0)
            open_turns = [t for t in turns if t.first_row >= open_from]
            if len(open_turns) > 1:
                verdict, why = boundary.is_new_task(open_turns, stored[:-1], turns, self.llm, cfg.boundary)
                if verdict is None:
                    verdict, why = False, f"{why}; treated as a continuation"
            else:
                verdict, why = False, "first turn of the open task"
            tables.record_boundary(conn, row_id, verdict, why, channel_id)
            if not verdict:
                return False
            build_id = tables.claim_build(conn, channel_id, cfg.build_timeout, tables.BOUNDARY)
        finally:
            conn.close()
        if build_id is not None:
            self.build(gatherer_id, channel.of(channel_id), build_id)
        return True

    def bulk_loaded(self, conn, gatherer_id: str, properties) -> Any:
        return self.build(gatherer_id, properties, tables.new_build(conn, channel_of(properties)))
