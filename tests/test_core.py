"""The policy's core, against a scripted model: segmentation, ranking,
sections, budgets, channels, adoption and the background build's lifecycle."""

import json
import os
import re
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import ag.ag_harness  # noqa: E402
import codex_items as codex  # noqa: E402
from ag.ag_interface import LLM  # noqa: E402
from ag.ag_policies.tools.groups import AGENT_MESSAGE, CONTEXT, TOOL_CALL, USER_MESSAGE  # noqa: E402
from ag.ag_harness.store import paths  # noqa: E402
from ag.ag_harness import Manager  # noqa: E402
from ag.ag_policies.proactive_context_manager import ProactiveContextManager, ProactiveContextManagerConfig  # noqa: E402
from ag.ag_tools.tokenizers import Tiktoken  # noqa: E402
from ag.ag_policies.tools import render  # noqa: E402
from ag.ag_policies.tools.history import Entry, Task, Turn  # noqa: E402
from ag.ag_policies.tools import ranking as rank  # noqa: E402
from ag.ag_harness.store import operations as store  # noqa: E402
from ag.ag_policies.proactive_context_manager import layout, tables  # noqa: E402
from ag.ag_tools import worker  # noqa: E402
from ag.ag_interface import Jobs  # noqa: E402


class Recording(Jobs):
    """Jobs that start nothing: each start handed to `record`."""

    def __init__(self, record=lambda *a: None):
        self.record = record

    def start(self, gatherer_id, properties, job, job_id):
        self.record(gatherer_id, properties.get(CHANNEL), job, job_id)
from ag.ag_policies.tools import segmentation as segment  # noqa: E402
from ag.ag_policies.tools import summarize  # noqa: E402
from channels import CHANNEL, ch, on  # noqa: E402


class ScriptedLLM(LLM):
    """Segments every window into tasks of `per_task` turns, splits oversized
    tasks in half, reverses rankings, and records every call."""

    def __init__(self, per_task=2, fail=False, retention=None, new_task=False):
        self.per_task, self.fail, self.retention = per_task, fail, retention or {}
        self.new_task, self.calls, self.prompts = new_task, [], []

    def complete(self, prompt, *, system=None, model, effort, timeout, purpose):
        self.calls.append(purpose)
        self.prompts.append(prompt)
        if self.fail:
            return ""
        if purpose == "boundary":
            return json.dumps({"new_task": self.new_task, "why": "scripted"})
        if purpose in ("segment", "subdivide"):
            first = int(re.search(r"(?:start at turn|starts at turn) (\d+)", prompt).group(1))
            last = int(re.search(r"(?:end at turn|ends at turn) (\d+)", prompt).group(1))
            size = self.per_task if purpose == "segment" else max(1, (last - first + 1) // 2)
            tasks, s = [], first
            while s <= last:
                e = min(last, s + size - 1)
                tasks.append({"name": f"task {s}-{e}", "description": f"turns {s} to {e}",
                              "start_turn": s, "end_turn": e})
                s = e + 1
            return json.dumps({"tasks": tasks})
        if purpose == "summarize":
            return json.dumps(self.retention)
        if purpose == "rank":
            ids = [int(n) for n in re.findall(r"^- id (\d+):", prompt, re.M)]
            return json.dumps({"ranking": list(reversed(ids))})
        return ""


def user(text, n):
    return {"type": "message", "role": "user", "id": f"u{n}",
            "content": [{"type": "input_text", "text": text}]}


def agent(text, n):
    return {"type": "message", "role": "assistant", "id": f"a{n}",
            "content": [{"type": "output_text", "text": text}]}


def call(n):
    return {"type": "function_call", "id": f"fc{n}", "call_id": f"c{n}",
            "name": "exec_command", "arguments": json.dumps({"cmd": f"step {n}"})}


def output(n):
    return {"type": "function_call_output", "id": f"fco{n}", "call_id": f"c{n}", "output": f"out {n}"}


PREAMBLE = [{"type": "message", "role": "developer", "id": "dev",
             "content": [{"type": "input_text", "text": "You are Codex."}]},
            {"type": "message", "role": "user", "id": "env",
             "content": [{"type": "input_text", "text": "<environment_context>cwd</environment_context>"}]}]


def conversation(turns, prefix="", start=1):
    items = []
    for n in range(start, start + turns):
        items += [user(f"{prefix}question {n}", f"{prefix}{n}"), call(f"{prefix}{n}"),
                  output(f"{prefix}{n}"), agent(f"{prefix}answer {n}", f"{prefix}{n}")]
    return items


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = paths.TRACE_DIR
        paths.TRACE_DIR = os.path.join(self.tmp.name, "traces")
        self.llm = ScriptedLLM()
        # The test histories are tiny: every build is due, none is refused. No gatherer guide: these
        # tests are of the history the context is made from (the guide's own are in test_join.py).
        self.cfg = ProactiveContextManagerConfig(min_context_tokens=0, build_every_request=True, require_smaller=False,
                                      sync_seconds=0, gatherer_guide="")
        self.policy = ProactiveContextManager(codex.FORMAT, self.llm, self.cfg)
        self.m = Manager(self.policy)
        self.m.init("s")

    def tearDown(self):
        paths.TRACE_DIR = self.saved
        self.tmp.cleanup()

    def run_build(self, gatherer, channel_id):
        """The analysis, as the worker would run it for a claimed build."""
        return self.policy.build(gatherer, ch(channel_id), tables.new_build(self.m._conn(gatherer), channel_id))

    def put(self, items, channel="c1"):
        wrapped = codex.CodexItems(self.m)
        for item in items:
            wrapped.insert("s", item, channel_id=channel)

    def read(self, channel="c1"):
        """A read in response to the last event stored in the gatherer."""
        from ag.ag_harness.store import operations
        return self.m.read("s", operations.high_water(self.m._conn("s")), properties=ch(channel))

    def texts(self, context):
        return [codex.text(i) for i in context]


def big_output(n, words=60):
    return {"type": "function_call_output", "id": f"fco{n}", "call_id": f"c{n}",
            "output": " ".join(f"line{n}-{i}" for i in range(words))}


def note(n, text="<environment_context>cwd</environment_context>"):
    """Context the harness adds mid-session (a pinned row once condensed past)."""
    return {"type": "message", "role": "user", "id": f"env{n}", "content": [{"type": "input_text", "text": text}]}


SMALL = dict(min_context_tokens=0, require_smaller=False, sync_seconds=0, max_context_tokens=3000,
             all_task_tokens=400, parallel_index_tokens=200, keep_temporal_relevant_tokens=200,
             keep_task_relevant_tokens=200, keep_previous_task_tokens=300, keep_so_far_tokens=300,
             keep_pinned_tokens=200, build_timeout=0.3, gatherer_guide="")


def long_turn(steps, start=1, words=60):
    """One user request and `steps` tool calls, each with a sizeable output."""
    items = [user("refactor the parser", f"L{start}")]
    for n in range(start, start + steps):
        items += [call(f"L{n}"), big_output(f"L{n}", words)]
    return items


class StrictMaxTest(Base):
    """max_context_tokens is a limit: the session's context -- sections, pinned rows, the running
    task -- is kept at or under it, by a build at any read and a cut inside the running task."""

    def setUp(self):
        super().setUp()
        self.cfg = ProactiveContextManagerConfig(**SMALL)
        self.policy = ProactiveContextManager(codex.FORMAT, self.llm, self.cfg)
        self.m = Manager(self.policy)
        self.m.init("s")

    def test_budgets_that_do_not_fit_the_limit_are_refused(self):
        with self.assertRaises(ValueError) as caught:
            ProactiveContextManagerConfig(max_context_tokens=100000)
        self.assertIn("leaves no headroom", str(caught.exception))
        self.assertEqual(ProactiveContextManagerConfig().section_budgets, 100000)

    def test_a_min_at_or_above_the_limit_is_refused(self):
        with self.assertRaises(ValueError) as caught:              # the boundary checks could never run
            ProactiveContextManagerConfig(**{**SMALL, "min_context_tokens": SMALL["max_context_tokens"]})
        self.assertIn("never check whether a user message starts a new task", str(caught.exception))

    def test_a_read_over_the_limit_mid_turn_starts_a_build_and_waits_for_it(self):
        spawned, waited = [], []
        self.policy.jobs = Recording(lambda s, c, job, job_id: spawned.append(job))
        wait = self.policy.wait
        self.policy.wait = lambda conn, ch_, row, started, seconds: waited.append(seconds) or wait(conn, ch_, row,
                                                                                                started, seconds)
        self.put(PREAMBLE + long_turn(40))                   # ends on a tool output, not a user message
        self.read()
        self.assertEqual(spawned, ["build"])
        self.assertLessEqual(self.policy.last_tokens, self.cfg.max_context_tokens)   # meanwhile, steps left out
        self.assertEqual(waited, [self.cfg.build_timeout])   # strict: as long as a build may take

    def test_a_build_cuts_the_running_task_whole_and_the_context_fits(self):
        self.put(PREAMBLE + long_turn(40))
        self.assertIsNotNone(self.run_build("s", "c1"))       # one turn, over the limit: built
        context = self.read()
        self.assertLessEqual(self.policy.last_tokens, self.cfg.max_context_tokens)
        conn = self.m._conn("s")
        last = store.rows(conn, match=ch("c1"))[-1].row_id
        self.assertEqual(tables.latest_build(conn, "c1")["open_from_row"], last + 1)   # after its last event
        self.assertFalse(any(i.get("type") in ("function_call", "function_call_output") for i in context))
        names = {n for n, *_ in store.made_items(conn, [r.made_id for r in store.last_read(conn, ch("c1"))["refs"]
                                                        if r.made_id is not None]).values()}
        self.assertIn("so_far", names)                       # the running task, condensed
        self.assertTrue(any("refactor the parser" in str(t) for t in self.texts(context)))
        self.put([call("N1"), output("N1")])                 # what comes after the cut: verbatim
        context = self.read()
        self.assertEqual([i.get("call_id") for i in context if i.get("type") in ("function_call",
                                                                                 "function_call_output")],
                         ["cN1", "cN1"])
        self.assertLessEqual(self.policy.last_tokens, self.cfg.max_context_tokens)

    def test_a_running_task_that_fits_is_not_cut(self):
        self.put(PREAMBLE + conversation(8) + long_turn(3, start=50))
        self.run_build("s", "c1")
        self.put([user("next request", 99)])
        context = self.read()
        conn = self.m._conn("s")
        build = tables.latest_build(conn, "c1")
        first = store.rows_by_id(conn, [build["open_from_row"]])[build["open_from_row"]]
        self.assertEqual(first.type.name, "user_message")    # the running task's start: verbatim as before
        self.assertIn("next request", self.texts(context))

    def test_a_running_task_that_fits_by_ag_s_count_but_not_the_provider_s_is_cut(self):
        self.put(PREAMBLE + conversation(8) + long_turn(3, start=50))       # as above: fits by ag's count
        self.read()
        conn = self.m._conn("s")
        before = store.last_read(conn, ch("c1"))
        self.m.record_real_tokens("s", before["read_id"], int(before["sent_tokens"] * 1.45))   # Gemini-like: more
        self.run_build("s", "c1")
        self.put([user("next request", 99)])
        self.read()
        conn = self.m._conn("s")
        last = store.rows(conn, match=ch("c1"))[-1].row_id
        self.assertEqual(tables.latest_build(conn, "c1")["open_from_row"], last + 1)   # cut, as the provider counts
        after = store.last_read(conn, ch("c1"))
        self.assertLessEqual(int(after["sent_tokens"] * 1.45), self.cfg.max_context_tokens)

    def test_the_provider_s_drift_is_its_count_over_ag_s_within_bounds(self):
        drift = ProactiveContextManager.drift_of
        self.assertEqual(drift(None), 1.0)
        self.assertEqual(drift({"real_tokens": None, "sent_tokens": 100}), 1.0)      # not counted yet
        self.assertEqual(drift({"real_tokens": 90, "sent_tokens": 100}), 1.0)        # the provider counted less
        self.assertAlmostEqual(drift({"real_tokens": 120, "sent_tokens": 100}), 1.2)
        self.assertEqual(drift({"real_tokens": 900, "sent_tokens": 100}), 1.5)       # not a tokenizer's: capped
        self.policy.drift = 1.2
        self.assertEqual(self.policy.by_provider(1000), 1200)

    def test_pinned_rows_keep_the_newest_within_their_budget(self):
        items = PREAMBLE + [user("q", 1)]
        for n in range(1, 25):
            items += [call(n), output(n), note(n, f"<environment_context>cwd {n} {'x ' * 20}</environment_context>")]
        self.put(items + long_turn(30, start=100))
        self.run_build("s", "c1")
        self.read()
        conn = self.m._conn("s")
        cut = tables.latest_build(conn, "c1")["open_from_row"]
        refs = [r.row_id for r in store.last_read(conn, ch("c1"))["refs"] if r.row_id is not None]
        rows = store.rows_by_id(conn, refs)
        pinned = [rows[r] for r in refs if r < cut and rows[r].type.name == "context" and r > 2]
        self.assertLessEqual(sum(r.tokens for r in pinned), self.cfg.keep_pinned_tokens)
        self.assertTrue(pinned and "cwd 24" in str(pinned[-1].payload))          # the newest kept

    def test_a_step_too_large_for_the_limit_is_left_out_with_a_note(self):
        self.put(PREAMBLE + [user("read the log", 1), call(1), big_output(1, words=4000)])
        self.read()
        self.assertLessEqual(self.policy.last_tokens, self.cfg.max_context_tokens)
        context = self.read()
        self.assertTrue(any("left out here to keep the context" in str(t) for t in self.texts(context)))
        self.assertFalse(any(i.get("type") in ("function_call", "function_call_output") for i in context))

    def test_every_section_is_within_its_budget(self):
        from ag.ag_policies.tools.history import Task
        cfg, tok = self.cfg, self.policy.tokenizer
        self.put(PREAMBLE + conversation(12, prefix="long " * 40))
        conn = self.m._conn("s")
        rows = store.rows(conn, match=ch("c1"))
        from ag.ag_policies.tools import history
        from ag.ag_interface.policy import TypeIds
        from ag.ag_harness.store.gatherer import Store
        types = TypeIds.load(Store(conn, "s"))
        _, turns = history.split([r for r in rows], types, self.policy.groups, tok)
        tasks = [Task(f"t{i}", "d", turns[i].first_row, turns[i].last_row, i + 1, i + 1, channel_id="c1")
                 for i in range(len(turns))]
        sections = layout.build_sections(turns, tasks, tasks[:-2], layout.earlier_messages(tasks[:-2], turns, cfg, tok),
                                         [], {"c1": turns}, "c1", cfg, tok, None, rows[-1].row_id, 0,
                                         cut_row=turns[-1].entries[2].row_id)
        budget = {"requests": cfg.all_task_tokens + cfg.parallel_index_tokens, "earlier": cfg.keep_temporal_relevant_tokens,
                  "related": cfg.keep_task_relevant_tokens, "previous": cfg.keep_previous_task_tokens,
                  "so_far": cfg.keep_so_far_tokens}
        fixed = tok.count(layout.overview(cfg, None) + "\n\n")
        for name, text in sections.sections:
            self.assertLessEqual(tok.count(text) - (fixed if name == "requests" else 0), budget[name], name)


class LimitBuildTest(Base):
    """A build started because the context was over max_context_tokens (reason `limit`) closes the
    running task at the last user message: what came before is a finished, summarised task, and
    that message starts the running task."""

    STANDING = {"carry_forward": [{"applies_to": "joining catalogue to companies", "spec": "use feed_tag = callsign"}]}

    def setUp(self):
        super().setUp()
        self.llm = ScriptedLLM(per_task=100, retention=self.STANDING)      # one task for the whole session
        self.cfg = ProactiveContextManagerConfig(**SMALL)
        self.policy = ProactiveContextManager(codex.FORMAT, self.llm, self.cfg)
        self.m = Manager(self.policy)
        self.m.init("s")

    def build(self, reason):
        return self.policy.build("s", ch("c1"), tables.new_build(self.m._conn("s"), "c1", reason))

    def tasks(self):
        return tables.load_tasks(self.m._conn("s"), "c1")

    def first_row_of(self, text):
        return self.m._conn("s").execute("SELECT min(row_id) FROM events WHERE text = ?", (text,)).fetchone()[0]

    def test_a_limit_build_closes_the_running_task_at_the_last_user_message(self):
        self.put(PREAMBLE + conversation(6) + [user("the last request", 99), call(99), output(99)])
        build = self.build(tables.LIMIT)
        start = self.first_row_of("the last request")
        self.assertEqual(build["open_from_row"], start)
        tasks = self.tasks()
        self.assertEqual([t.name for t in tasks], ["task 1-6", "Current request"])     # named from turns 1-6 alone
        self.assertEqual(tasks[-1].first_row, start)
        self.assertEqual(tasks[0].retention["carry_forward"], self.STANDING["carry_forward"])   # the finished part, summarised
        segments = [p for p, c in zip(self.llm.prompts, self.llm.calls) if c == "segment"]
        self.assertTrue(segments and all("end at turn 6." in p for p in segments))       # never shown the last turn
        self.put([agent("done", 99), user("and then?", 100)])                          # the next request: adopted
        texts = self.texts(self.read())
        previous = next(t for t in texts if t.startswith("# Previous task"))
        self.assertIn("standing: joining catalogue to companies — use feed_tag = callsign", previous)
        self.assertIn("the last request", texts)                                       # verbatim, from there on
        self.assertFalse(any(t.startswith("# This task so far") for t in texts))

    def test_a_second_limit_build_in_the_same_turn_segments_nothing(self):
        self.put(PREAMBLE + conversation(6) + [user("the last request", 99), call(99), output(99)])
        self.build(tables.LIMIT)
        segments = self.llm.calls.count("segment")
        self.put([call(98), output(98)])
        build = self.build(tables.LIMIT)
        self.assertEqual(self.llm.calls.count("segment"), segments)
        self.assertEqual([t.name for t in self.tasks()], ["task 1-6", "Current request"])
        self.assertEqual(build["open_from_row"], self.first_row_of("the last request"))

    def test_a_limit_build_on_one_long_turn_is_one_running_task(self):
        self.put(PREAMBLE + long_turn(5))
        build = self.build(tables.LIMIT)
        self.assertEqual([t.name for t in self.tasks()], ["Current request"])
        self.assertNotIn("segment", self.llm.calls)
        self.assertEqual(build["open_from_row"], self.first_row_of("refactor the parser"))

    def test_a_boundary_build_segments_every_turn_as_before(self):
        self.put(PREAMBLE + conversation(6) + [user("the last request", 99), call(99), output(99)])
        self.assertIsNone(self.build(tables.BOUNDARY))                                  # one task: nothing, as before
        self.assertEqual([t.name for t in self.tasks()], ["task 1-7"])                 # segmentation's grouping kept,
        segments = [p for p, c in zip(self.llm.prompts, self.llm.calls) if c == "segment"]   # the last turn included
        self.assertTrue(segments and all("end at turn 7." in p for p in segments))

    def test_a_database_without_the_reason_column_gets_it(self):
        conn = self.m._conn("s")
        with conn:
            conn.execute("DROP TABLE _builds")
            conn.execute("CREATE TABLE _builds (build_id INTEGER PRIMARY KEY, channel_key TEXT NOT NULL, "
                         "status TEXT NOT NULL, started_at REAL NOT NULL, finished_at REAL, through_row INTEGER, "
                         "open_from_row INTEGER, ranking_json TEXT, parallel_mark INTEGER, error TEXT)")
            conn.execute("INSERT INTO _builds (channel_key, status, started_at) VALUES ('c1', 'ready', 1)")
        tables.create(conn)
        self.assertIsNone(tables.latest_build(conn, "c1")["reason"])                   # an old build: not a limit one
        self.assertEqual(tables.get_build(conn, tables.new_build(conn, "c1", tables.LIMIT))["reason"], "limit")


class ParsingTest(unittest.TestCase):
    def test_parse_tasks(self):
        text = '```json\n{"tasks": [{"name": "b", "start_turn": 3, "end_turn": 4},' \
               '{"name": "a", "start_turn": 1, "end_turn": 2}, {"name": "x", "start_turn": 9, "end_turn": 9},' \
               '{"start_turn": "?"}]}\n```'
        found = segment.parse_tasks(text, 1, 4)
        self.assertEqual([t["name"] for t in found], ["a", "b"])
        self.assertEqual(segment.parse_tasks("not json", 1, 4), [])

    def test_a_draft_before_the_answer_is_passed_over(self):
        """What gemini-3.8-flash answered in a benchmark run: a fenced draft
        without turns, then the answer."""
        text = ('```json\n{"tasks": [{"name": "A", "description": "a"}, {"name": "B", "description": "b"}]}\n```\n\n\n'
                '{"tasks": [{"name": "A", "description": "a", "start_turn": 1, "end_turn": 14},'
                ' {"name": "B", "description": "b", "start_turn": 15, "end_turn": 22}]}')
        found = segment.parse_tasks(text, 1, 22)
        self.assertEqual([(t["name"], t["start_turn"], t["end_turn"]) for t in found], [("A", 1, 14), ("B", 15, 22)])

    def test_contiguity_is_forced(self):
        out = segment._contiguous([{"name": "a", "start_turn": 2, "end_turn": 3},
                                   {"name": "b", "start_turn": 6, "end_turn": 7}], 1, 7)
        self.assertEqual([(t["start_turn"], t["end_turn"]) for t in out], [(1, 3), (4, 7)])

    def test_json_after_prose_with_braces(self):
        from ag.ag_policies.tools.answers import find_object
        text = 'My plan: group {a, b} first.\n```json\n{"tasks": [{"title": "x", ' \
               '"summary": "y", "start_turn": 1, "end_turn": 2}]}\n```'
        self.assertEqual(find_object(text, "tasks")["tasks"][0]["title"], "x")
        self.assertIsNone(find_object("no json {here", "tasks"))
        found = segment.parse_tasks(text, 1, 2)
        self.assertEqual((found[0]["name"], found[0]["description"]), ("x", "y"))

    def test_parse_ranking(self):
        self.assertEqual(rank.parse_ranking('{"ranking": [3, {"id": 1}, 3, 99, "x"]}', 4), [2, 0])
        self.assertEqual(rank.parse_ranking("", 4), [])

    def test_parse_retention(self):
        r = summarize.parse_retention('{"terminology": [{"applies_to": "net", "spec": "after tax"},'
                                   '{"applies_to": "", "spec": "dropped"}]}')
        self.assertEqual(r["terminology"], [{"applies_to": "net", "spec": "after tax"}])
        self.assertEqual(r["metadata"], [])
        self.assertEqual(r["cleaned_user_messages"], [])

    def test_parse_cleaned_user_messages(self):
        r = summarize.parse_retention('{"object_handling": [], "cleaned_user_messages": ['
                                   '{"turn": 3, "text": "third"}, {"turn": "2", "text": "second"},'
                                   '{"turn": "x", "text": "no turn"}, {"turn": 4}]}')
        self.assertEqual(r["cleaned_user_messages"], [{"turn": 2, "text": "second"}, {"turn": 3, "text": "third"}])
        only = summarize.parse_retention('{"cleaned_user_messages": [{"turn": 1, "text": "a"}]}')
        self.assertEqual((only["cleaned_user_messages"], only["object_handling"]), ([{"turn": 1, "text": "a"}], []))

    def test_merge_continuations(self):
        a = Task("same", "short", 1, 10, 1, 2, 5)
        b = Task("same", "a longer description", 11, 20, 3, 4, 7)
        merged = segment.merge_continuations([a, b])
        self.assertEqual(len(merged), 1)
        self.assertEqual((merged[0].end_turn, merged[0].last_row, merged[0].tokens,
                          merged[0].description), (4, 20, 12, "a longer description"))


class FitTest(unittest.TestCase):
    def entries(self):
        out, row = [], 1
        for n in range(30):
            for role, text in ((USER_MESSAGE, f"question {n} " * 20),
                               (TOOL_CALL, f"call {n} " * 40),
                               (AGENT_MESSAGE, f"answer {n} " * 20)):
                out.append(Entry(row, role, text, {}, 0, is_user=role == USER_MESSAGE,
                                 is_message=role in (USER_MESSAGE, AGENT_MESSAGE), is_tool=role == TOOL_CALL))
                row += 1
        return out

    def test_under_budget_is_whole(self):
        entries = self.entries()[:3]
        self.assertNotIn("omitted", render.fit("## t", entries, 10 ** 6, Tiktoken()))

    def test_over_budget_trims_the_middle_and_keeps_order(self):
        entries = self.entries()
        tok = Tiktoken()
        text = render.fit("## t", entries, 800, tok)
        self.assertLessEqual(tok.count(text), 800)
        self.assertIn("omitted", text)
        ids = [int(x) for x in re.findall(r"\[id (\d+)\]", text)]
        self.assertEqual(ids, sorted(ids))
        self.assertIn("[id 1]", text)                    # the first user message
        self.assertIn(f"[id {entries[-3].row_id}]", text)  # the last one
        self.assertTrue(text.startswith("## t"))


class CharCount(ag.ag_harness.Tokenizer):
    """A tokenizer that is easy to check: one token per character."""
    def count(self, text):
        return len(text)


class TokenizerTest(Base):
    def test_the_given_tokenizer_counts_items_and_budgets(self):
        m = Manager(ProactiveContextManager(codex.FORMAT, self.llm, self.cfg, tokenizer=CharCount()))
        self.assertIsInstance(m.tokenizer, CharCount)
        m.init("s")
        wrapped = codex.CodexItems(m)
        item = user("hello", 1)
        wrapped.insert("s", item, channel_id="c1")
        conn = m.store("s")
        stored = conn.execute("SELECT tokens, text FROM events").fetchone()
        self.assertEqual(stored, (len("hello"), "hello"))      # its text, counted by CharCount, not tiktoken
        # budgets use it too: a 40-character budget in characters keeps far less
        long = agent("a" * 200, 1)
        wrapped.insert("s", long, channel_id="c1")
        from ag.ag_policies.tools import render
        from ag.ag_policies.tools.history import turns as load
        from ag.ag_interface.policy import TypeIds
        _, turns = load(conn, TypeIds.load(conn), m.policy.groups, m.tokenizer, "c1")
        self.assertEqual(turns[0].entries[1].tokens, len("a" * 200))   # its text's, not its JSON's
        self.assertIn("omitted", render.fit("## t", turns[0].entries, 40, m.tokenizer))

    def test_the_manager_gives_tiktoken_when_none_is_given(self):
        self.assertIsNone(ProactiveContextManager(codex.FORMAT, self.llm).tokenizer)          # a policy has none of its own
        self.assertIsInstance(Manager(ProactiveContextManager(codex.FORMAT, self.llm)).policy.tokenizer, Tiktoken)


class BulkLoadTest(Base):
    def records(self, items):
        wrapped = codex.CodexItems(self.m)
        return [wrapped.event("s", i) for i in items]

    def test_stores_everything_and_builds_once(self):
        items = PREAMBLE + conversation(12)
        sections = self.m.bulk_load("s", self.records(items), properties=ch("c1"))
        self.assertIsNotNone(sections)
        conn = self.m._conn("s")
        self.assertEqual(conn.execute("SELECT count(*) FROM events").fetchone()[0], len(items))
        self.assertEqual(tables.latest_build(conn, "c1")["status"], "ready")
        self.assertEqual(self.llm.calls.count("segment"), 1)          # the whole history in one window
        self.assertEqual(len(tables.load_tasks(conn, "c1")), 6)

    def test_the_last_task_is_not_summarized_the_rest_are(self):
        self.llm.retention = {"terminology": [{"applies_to": "x", "spec": "y"}]}
        self.m.bulk_load("s", self.records(PREAMBLE + conversation(12)), properties=ch("c1"))
        tasks = tables.load_tasks(self.m._conn("s"), "c1")
        self.assertEqual(self.llm.calls.count("summarize"), len(tasks) - 1)
        self.assertTrue(all(t.retention["terminology"] for t in tasks[:-1]))
        self.assertEqual(tasks[-1].retention, {})

    def test_the_next_user_message_reads_the_built_context(self):
        self.m.bulk_load("s", self.records(PREAMBLE + conversation(12)), properties=ch("c1"))
        self.put([user("question 13", 13)])
        texts = self.texts(self.read())
        self.assertTrue(any(t.startswith("# Previous task") for t in texts))
        self.assertEqual(texts[-1], "question 13")

    def test_rerun_stores_nothing_new(self):
        items = PREAMBLE + conversation(8)
        self.m.bulk_load("s", self.records(items), properties=ch("c1"))
        self.m.bulk_load("s", self.records(items), properties=ch("c1"))
        self.assertEqual(self.m._conn("s").execute("SELECT count(*) FROM events").fetchone()[0], len(items))

    def test_through_the_codex_adapter(self):
        wrapped = codex.CodexItems(self.m)
        items = PREAMBLE + conversation(8)
        self.assertIsNotNone(wrapped.bulk_load("s", items, channel_id="c1"))
        rows = self.m._conn("s").execute("SELECT t.name, e.event_id, e.tokens FROM events e JOIN event_types t USING (event_type_id) ORDER BY e.row_id").fetchall()
        self.assertEqual(rows[2][:2], ("user_message", "u1"))
        self.assertTrue(all(r[2] > 0 for r in rows))


class ReadBeforeBuildTest(Base):
    def test_no_build_reads_like_the_baseline(self):
        items = PREAMBLE + conversation(3)
        self.put(items)
        self.assertEqual(self.read(), items)

    def test_missing_gatherer_is_empty(self):
        self.assertEqual(self.m.read("nope", 1, properties=ch("c1")), [])


class BuildTest(Base):
    def build(self, turns=12, channel="c1"):
        self.put(PREAMBLE + conversation(turns), channel)
        return self.run_build("s", channel_id=channel)

    def test_tasks_cover_every_turn_in_order(self):
        self.build(12)
        tasks = tables.load_tasks(self.m._conn("s"), "c1")
        self.assertEqual(len(tasks), 6)
        self.assertEqual([t.name for t in tasks][:2], ["task 1-2", "task 3-4"])
        firsts = [t.first_row for t in tasks]
        self.assertEqual(firsts, sorted(firsts))

    def test_sections_and_verbatim_tail(self):
        self.build(12)
        self.put([user("question 13", 13)])
        context = self.read()
        texts = self.texts(context)
        self.assertEqual(context[:2], PREAMBLE)
        sections = [t for t in texts if t.startswith("# ")]
        headers = [t.split("\n", 1)[0] for t in sections]
        self.assertEqual(headers[0], "# How this history is organised")
        self.assertIn("# Every earlier request", sections[0])
        self.assertEqual(headers[-1], "# Previous task")
        self.assertIn("# Earlier messages", headers)
        # the running task (turns 11-12) and the new message are verbatim, after the sections
        self.assertEqual(texts[-1], "question 13")
        self.assertIn("question 11", texts)
        self.assertNotIn("question 3", texts)            # only inside sections now
        previous = next(t for t in sections if t.startswith("# Previous task"))
        self.assertIn("task 9-10", previous)
        self.assertIn("[tool call]", previous)           # full detail
        earlier = next(t for t in sections if t.startswith("# Earlier messages"))
        self.assertNotIn("[tool call]", earlier)         # messages only

    def test_every_earlier_request_stops_before_what_is_reproduced(self):
        self.cfg.keep_temporal_relevant_tokens = 10 ** 6   # every earlier task fits
        self.build(12)
        self.put([user("question 13", 13)])
        first = self.texts(self.read())[2]
        self.assertNotIn("question 1", first.split("# Every earlier request", 1)[1])

    def test_related_tasks_come_from_ranking_within_budget(self):
        self.cfg.keep_temporal_relevant_tokens = 0          # nothing in earlier messages
        self.build(12)
        self.put([user("question 13", 13)])
        texts = self.texts(self.read())
        related = next(t for t in texts if t.startswith("# Related earlier tasks"))
        self.assertIn("rank", self.llm.calls)
        self.assertIn("task 1-2", related)
        names = re.findall(r"^## (task \d+-\d+)", related, re.M)
        self.assertEqual(names, sorted(names, key=lambda n: int(n.split()[1].split("-")[0])))

    def test_retention_lines_are_shown(self):
        self.llm.retention = {"terminology": [{"applies_to": "net", "spec": "after tax"}]}
        self.build(8)
        self.put([user("next", 99)])
        previous = next(t for t in self.texts(self.read())
                        if t.startswith("# Previous task"))
        self.assertIn("term: net — after tax", previous)

    def test_oversized_task_is_subdivided(self):
        self.llm.per_task = 8
        self.cfg.task_chunk_tokens = 20
        self.build(8)
        self.assertIn("subdivide", self.llm.calls)
        self.assertGreater(len(tables.load_tasks(self.m._conn("s"), "c1")), 1)

    def test_only_finished_tasks_are_summarized(self):
        self.build(8)                                        # 4 tasks: 3 finished + the open one
        self.assertEqual(self.llm.calls.count("summarize"), 3)
        self.put(conversation(4, start=9))
        self.llm.calls.clear()
        self.run_build("s", channel_id="c1")                 # re-segments from the old open task: 3 new, 2 finished
        self.assertEqual(self.llm.calls.count("summarize"), 2)

    def test_rebuild_keeps_finished_tasks_and_resegments_the_open_one(self):
        self.build(8)
        before = [t.name for t in tables.load_tasks(self.m._conn("s"), "c1")]
        self.put(conversation(4, start=9))
        self.llm.calls.clear()
        self.run_build("s", channel_id="c1")
        after = [t.name for t in tables.load_tasks(self.m._conn("s"), "c1")]
        self.assertEqual(after[:len(before) - 1], before[:-1])
        self.assertEqual(len(after), 6)

    def test_a_build_no_smaller_than_the_history_is_refused_at_adoption(self):
        self.cfg.require_smaller = True
        self.assertIsNotNone(self.build(4))                # the analysis itself is fine
        self.assertEqual(tables.latest_build(self.m._conn("s"), "c1")["status"], "ready")
        self.put([user("next", 99)])
        self.assertFalse(any(t.startswith("# ") for t in self.texts(self.read())))   # tiny turns: the overview alone is bigger
        build = tables.latest_build(self.m._conn("s"), "c1")
        self.assertEqual(build["status"], "nothing")       # the policy settled it when it laid it out
        self.assertIn("not smaller", build["error"])
        self.assertIsNotNone(build["through_row"])         # what the analysis recorded stays

    def test_a_long_enough_history_is_built(self):
        self.cfg.require_smaller = True
        # What shrinks in a real gatherer is tool activity: earlier tasks keep
        # their messages and drop it.
        long = [dict(x, output="row\n" * 3000) if x.get("type") == "function_call_output" else x
                for x in conversation(12)]
        self.put(PREAMBLE + long)
        self.assertIsNotNone(self.run_build("s", channel_id="c1"))

    def test_too_little_history_builds_nothing(self):
        self.put(PREAMBLE + conversation(1))
        self.assertIsNone(self.run_build("s", channel_id="c1"))
        self.assertEqual(tables.latest_build(self.m._conn("s"), "c1")["status"], "nothing")

    def test_model_unavailable_fails_instead_of_storing_placeholders(self):
        self.llm.fail = True
        self.assertIsNone(self.build(8))
        build = tables.latest_build(self.m._conn("s"), "c1")
        self.assertEqual(build["status"], "failed")
        self.assertEqual(tables.load_tasks(self.m._conn("s"), "c1"), [])
        self.put([user("next", 99)])
        self.assertEqual(len(self.read()), len(PREAMBLE) + 8 * 4 + 1)


class OverlapTest(Base):
    """Summaries and the ranking run at the same time."""

    def test_rank_is_asked_while_summaries_are_pending(self):
        import threading
        ranked = threading.Event()
        rank_seen_by_summary = []

        class Slow(ScriptedLLM):
            def complete(self, prompt, **kw):
                if kw["purpose"] == "summarize":
                    rank_seen_by_summary.append(ranked.wait(5))   # sequential: times out, False
                answer = super().complete(prompt, **kw)
                if kw["purpose"] == "rank":
                    ranked.set()
                return answer

        self.llm = self.policy.llm = Slow(per_task=1)                   # 9 turns -> 9 tasks, 8 to summarize
        self.cfg.keep_temporal_relevant_tokens = 0                  # so every earlier task is ranked
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        t0 = time.monotonic()
        sections = self.run_build("s", "c1")
        self.assertIsNotNone(sections)
        self.assertLess(time.monotonic() - t0, 4)
        self.assertEqual(self.llm.calls.count("summarize"), 8)
        self.assertTrue(all(rank_seen_by_summary))                 # every summary saw rank arrive
        tasks = tables.load_tasks(self.m._conn("s"), "c1")
        self.assertTrue(all(t.retention for t in tasks[:-1]))      # summaries stored all the same
        self.assertEqual(tasks[-1].retention, {})


class PoolTest(Base):
    """A history bulk-loaded into the no-channel pool is every later channel's
    past: its build and tasks are inherited, its preamble gives way to the
    channel's own."""

    OWN_PREAMBLE = [{"type": "message", "role": "developer", "id": "dev-c1",
                     "content": [{"type": "input_text", "text": "You are Codex, live."}]},
                    {"type": "message", "role": "user", "id": "env-c1",
                     "content": [{"type": "input_text", "text": "<environment_context>ws</environment_context>"}]}]

    def test_a_channel_reads_the_pools_build_with_its_own_preamble_first(self):
        wrapped = codex.CodexItems(self.m)
        self.assertIsNotNone(wrapped.bulk_load("s", PREAMBLE + conversation(8), channel_id=None))
        self.put(self.OWN_PREAMBLE + [user("fresh question", 50)])
        texts = self.texts(self.read())
        self.assertEqual(texts[:2], ["You are Codex, live.", "<environment_context>ws</environment_context>"])
        self.assertNotIn("You are Codex.", texts)                       # the pool's preamble
        self.assertNotIn("<environment_context>cwd</environment_context>", texts)
        self.assertTrue(texts[2].startswith("# "))                      # then the sections
        self.assertTrue(any(t.startswith("# Previous task") for t in texts))
        self.assertEqual(texts[-1], "fresh question")
        conn = self.m._conn("s")
        pool_build = tables.latest_build(conn, None)
        self.assertEqual(int(store.last_read(conn, ch("c1"))["basis"]), pool_build["build_id"])
        self.assertIsNone(tables.latest_build(conn, "c1"))

    def test_without_a_build_the_pool_is_the_channels_history_behind_its_preamble(self):
        self.put(PREAMBLE + conversation(2), channel=None)
        self.put(self.OWN_PREAMBLE + [user("q", 50)])
        texts = self.texts(self.read())
        self.assertEqual(texts[:3], ["You are Codex, live.", "<environment_context>ws</environment_context>",
                                     "question 1"])
        self.assertEqual(texts[-1], "q")
        self.assertNotIn("You are Codex.", texts)

    def test_the_channels_first_build_continues_from_the_pools_tasks(self):
        wrapped = codex.CodexItems(self.m)
        wrapped.bulk_load("s", PREAMBLE + conversation(8), channel_id=None)
        pool_tasks = len(tables.load_tasks(self.m._conn("s"), None))
        self.llm.calls.clear()
        self.put(self.OWN_PREAMBLE + [user("fresh question", 50), agent("a", 50), user("more", 51)])
        self.assertIsNotNone(self.run_build("s", "c1"))
        self.assertEqual(self.llm.calls.count("segment"), 1)            # only the open task, not all 8 turns
        own = tables.load_tasks(self.m._conn("s"), "c1")
        self.assertGreaterEqual(len(own), pool_tasks)
        self.assertEqual([t.name for t in own[:pool_tasks - 1]],
                         [t.name for t in tables.load_tasks(self.m._conn("s"), None)][:pool_tasks - 1])
        texts = self.texts(self.read())
        self.assertEqual(texts[0], "You are Codex, live.")
        self.assertEqual(texts[-1], "more")

    def test_describe_and_reads(self):
        from ag.ag_policies.proactive_context_manager import report
        wrapped = codex.CodexItems(self.m)
        wrapped.bulk_load("s", PREAMBLE + conversation(8), channel_id=None)
        d = report.describe(self.m.store("s"), None)
        self.assertEqual(d["events"], len(PREAMBLE) + 8 * 4)
        self.assertEqual((d["build"]["status"], d["build"]["sections"]), ("ready", []))   # analysed, not yet laid out
        self.assertGreater(d["build"]["ranked"], 0)
        self.put(self.OWN_PREAMBLE + [user("q", 50)])
        self.read()                                                   # c1 adopts the pool's build: sections made
        d = report.describe(self.m.store("s"), "c1")
        self.assertEqual(d["events"], len(PREAMBLE) + 8 * 4 + 3)
        self.assertTrue(d["build"]["sections"] and all(x["tokens"] > 0 for x in d["build"]["sections"]))
        self.assertEqual(d["context_tokens"], d["build"]["sections_tokens"] + d["build"]["tail_tokens"])
        r = report.reads(self.m.store("s"), "c1")
        self.assertEqual(len(r), 1)
        self.assertEqual(r[0]["made_items"], len(d["build"]["sections"]))
        self.assertGreater(r[0]["tokens"], d["build"]["sections_tokens"])


class SwitchTest(Base):
    def test_switched_to_only_at_a_user_message(self):
        self.put(PREAMBLE + conversation(8))
        self.put([user("question 9", 9)])
        self.run_build("s", channel_id="c1")
        self.put([call(9)])                               # mid-turn: not adopted yet
        mid = self.read()
        self.assertFalse(any(codex.text(i).startswith("# ") for i in mid))
        self.put([output(9), agent("answer 9", 9), user("question 10", 10)])
        after = self.read()
        self.assertTrue(any(codex.text(i).startswith("# Previous task") for i in after))

    def test_a_new_task_build_too_slow_for_its_message_is_taken_up_at_the_next_call(self):
        self.put(PREAMBLE + conversation(8) + [user("fresh start", 50)])
        self.assertFalse(any(t.startswith("# ") for t in self.texts(self.read())))   # went on without it
        conn = self.m._conn("s")
        self.policy.build("s", ch("c1"), tables.new_build(conn, "c1", tables.BOUNDARY))
        self.put([call(50), output(50)])
        texts = self.texts(self.read())                   # mid-turn, its own turn: taken up now
        self.assertTrue(any(t.startswith("# Previous task") for t in texts))
        self.assertIn("fresh start", texts)               # the turn itself stays verbatim
        self.assertIn("out 50", texts)
        build_id = tables.latest_build(conn, "c1")["build_id"]
        self.assertEqual(int(store.last_read(conn, ch("c1"))["basis"]), build_id)

    def test_a_new_task_build_for_an_earlier_turn_waits_for_a_user_message(self):
        self.put(PREAMBLE + conversation(8) + [user("question 9", 9)])
        self.policy.build("s", ch("c1"), tables.new_build(self.m._conn("s"), "c1", tables.BOUNDARY))
        self.put([output(9), agent("answer 9", 9), user("question 10", 10), call(10)])
        self.assertFalse(any(t.startswith("# ") for t in self.texts(self.read())))
        self.put([output(10), agent("answer 10", 10), user("question 11", 11)])
        self.assertTrue(any(t.startswith("# Previous task") for t in self.texts(self.read())))

    def test_the_build_in_use_holds_mid_turn(self):
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        self.run_build("s", channel_id="c1")
        first = self.read()
        self.put([call(50), output(50)])
        second = self.read()
        self.assertEqual(second[:len(first)], first)       # same prefix mid-turn

    def test_the_build_in_use_holds_mid_turn_for_a_read_with_a_cwd(self):
        # a harness that states its working directory reads with it; the channel's last read is
        # found whatever its cwd, so the build stays in use between user messages
        from ag.ag_harness.store import operations
        with_cwd = {**ch("c1"), "cwd": "/w"}
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        self.run_build("s", channel_id="c1")
        first = self.m.read("s", operations.high_water(self.m._conn("s")), properties=with_cwd)
        self.put([call(50), output(50)])
        second = self.m.read("s", operations.high_water(self.m._conn("s")), properties=with_cwd)
        self.assertTrue(any(codex.text(i).startswith("# Previous task") for i in second))
        self.assertEqual(second[:len(first)], first)
        bases = self.m._conn("s").execute("SELECT basis FROM _reads ORDER BY read_id").fetchall()
        self.assertEqual(bases, [("1",), ("1",)])


class TextTest(Base):
    """The sections show what the adaptor says an event reads as -- not its payload's JSON."""

    def test_the_sections_render_each_event_s_text(self):
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        self.run_build("s", channel_id="c1")
        sections = "\n".join(codex.text(i) for i in self.read() if isinstance(i, dict) and i.get("type") == "ag")
        self.assertRegex(sections, r"\[id \d+\] USER: question 1\n")          # the request's words
        self.assertIn("answer 7", sections)
        for bookkeeping in ('"input_text"', '"role":', '"id": "u1"', '"content": ['):
            self.assertNotIn(bookkeeping, sections)

    def test_an_event_without_text_shows_its_payload(self):
        from ag.ag_harness.store import operations as store
        self.put(PREAMBLE + [user("q", 1)])
        conn = self.m._conn("s")
        conn.execute("UPDATE events SET text = NULL")                  # as an adaptor that gives none
        conn.commit()
        row = next(r for r in store.rows(conn) if r.event_id == "u1")
        self.assertEqual(json.loads(store.text(row)), row.payload)


class ReadLogTest(Base):
    """Every read is logged: which stored rows and which made items it returned."""

    def log(self):
        conn = self.m._conn("s")
        reads = conn.execute("SELECT read_id, manager, basis FROM _reads ORDER BY read_id").fetchall()
        items = {rid: conn.execute("SELECT row_id, made_id FROM _read_items WHERE read_id = ? "
                                   "ORDER BY position", (rid,)).fetchall() for rid, _, _ in reads}
        return reads, items

    def test_a_read_without_a_build_logs_every_row(self):
        self.put(PREAMBLE + conversation(3))
        context = self.read()
        reads, items = self.log()
        self.assertEqual([(m, b) for _, m, b in reads], [("proactive_context_manager", None)])
        self.assertEqual(len(items[reads[0][0]]), len(context))
        self.assertTrue(all(r is not None and m is None for r, m in items[reads[0][0]]))

    def test_condensations_are_made_items_returned_exactly(self):
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        self.run_build("s", channel_id="c1")
        context = self.read()
        reads, items = self.log()
        rid, _, basis = reads[-1]
        self.assertIsNotNone(basis)
        conn = self.m._conn("s")
        for (row_id, made_id), item in zip(items[rid], context):
            if made_id is not None:
                stored = json.loads(conn.execute("SELECT item_json FROM _made_items WHERE made_id = ?",
                                                 (made_id,)).fetchone()[0])
                self.assertEqual(stored, item)
                self.assertEqual(item["type"], "ag")                          # the policy's own message
                self.assertIn(item["name"], ("requests", "earlier", "related", "previous", "so_far"))
            else:
                stored = json.loads(conn.execute("SELECT payload_json FROM events WHERE row_id = ?",
                                                 (row_id,)).fetchone()[0])
                self.assertEqual(stored, item)

    def test_mid_turn_reads_reuse_the_same_made_items(self):
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        self.run_build("s", channel_id="c1")
        self.read()
        self.put([call(50), output(50)])
        self.read()
        reads, items = self.log()
        made = [[m for _, m in items[rid] if m is not None] for rid, _, _ in reads]
        self.assertEqual(made[0], made[1])
        self.assertEqual(reads[0][2], reads[1][2])           # same basis
        conn = self.m._conn("s")
        self.assertEqual(conn.execute("SELECT count(*) FROM _made_items").fetchone()[0], len(made[0]))

    def test_a_new_build_is_switched_to_at_the_next_user_message(self):
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        self.run_build("s", channel_id="c1")
        self.read()
        self.put([agent("a", 50)] + conversation(4, start=60))
        self.run_build("s", channel_id="c1")
        self.put([call(70)])
        self.read()                     # mid-turn: old basis
        self.put([output(70), user("next", 71)])
        self.read()                     # user message: new basis
        reads, _ = self.log()
        self.assertEqual(reads[0][2], reads[1][2])
        self.assertNotEqual(reads[1][2], reads[2][2])


class ParallelTest(Base):
    def test_other_channels_requests_are_in_the_index_and_since_shown_in_place(self):
        self.put(PREAMBLE + conversation(3, prefix="other ", start=1), "c2")
        self.put(PREAMBLE + conversation(8))
        self.run_build("s", channel_id="c1")
        self.put([user("other late question", "late")], "c2")    # after the build
        self.put([user("mine", 99)])
        texts = self.texts(self.read())
        index = texts[2]
        self.assertIn("## Requests made in parallel sessions", index)
        self.assertIn("other question 1", index)
        self.assertNotIn("other late question", index)
        late = [t for t in texts if "other late question" in t]
        self.assertEqual(len(late), 1)                       # shown once, in place: a parallel request
        self.assertNotIn("other question 1", late[0])
        # never another channel's items verbatim
        self.assertFalse(any(i.get("id", "").startswith("uother") for i in
                             self.read() if isinstance(i, dict)))

    def test_delta_is_frozen_at_adoption(self):
        self.put(PREAMBLE + conversation(8))
        self.put([user("mine", 99)])
        self.run_build("s", channel_id="c1")
        self.read()                         # adopted, no delta
        self.put([user("other says", "o1")], "c2")
        self.assertFalse(any(t.startswith("# Recent requests") for t in
                             self.texts(self.read())))

    def test_other_channels_tasks_can_be_ranked_in(self):
        self.cfg.keep_temporal_relevant_tokens = 0
        self.put(PREAMBLE + conversation(6, prefix="other "), "c2")
        self.run_build("s", channel_id="c2")
        self.put(PREAMBLE + conversation(8))
        self.run_build("s", channel_id="c1")
        self.put([user("mine", 99)])
        related = next(t for t in self.texts(self.read())
                       if t.startswith("# Related earlier tasks"))
        self.assertIn("from parallel channel c2", related)
        self.assertIn("other question", related)

    def test_channels_do_not_share_tasks_or_sections(self):
        self.put(PREAMBLE + conversation(8), "c2")
        self.run_build("s", channel_id="c2")
        self.put(PREAMBLE + conversation(3))
        self.assertEqual(tables.load_tasks(self.m._conn("s"), "c1"), [])
        self.assertFalse(any(t.startswith("# ") for t in self.texts(self.read())))


class PrivateTest(Base):
    """A channel its `role` record makes private (the dashboard's gatherer agent) is shown to no other channel; nor is a
    message the actors sent one another (`unshared_openings`)."""

    def private(self, channel):
        from replies import insert
        insert(self.m, "s", ch(channel), [{"type": "role", "id": f"role:{channel}", "payload": {"role": "coordinator", "private": True}}])

    def test_a_private_channel_is_shown_to_no_other_and_sees_theirs(self):
        self.cfg.keep_temporal_relevant_tokens = 0
        self.private("c2")
        self.put(PREAMBLE + conversation(6, prefix="secret "), "c2")
        self.run_build("s", channel_id="c2")
        self.put(PREAMBLE + conversation(8))
        self.run_build("s", channel_id="c1")
        self.put([user("secret late question", "late")], "c2")      # after c1's build: a parallel request, were it shown
        self.put([user("mine", 99)])
        mine = "\n".join(self.texts(self.read()))
        self.assertNotIn("secret", mine)                           # not its requests, in the index or in place; nor its tasks
        self.put([user("what do the others do?", "q2")], "c2")
        self.assertIn("question 1", "\n".join(self.texts(self.read("c2"))))     # it sees c1's

    def test_messages_the_actors_send_one_another_are_not_shown_to_the_others(self):
        self.put(PREAMBLE + conversation(3))
        self.put([user('Message from the gatherer agent (answer it with: ag actors send gatherer "..."):\n\nStop editing x.py.', "g1"),
                  user("<pasted_content id=\"ab12\">\nMessage from actor 1a2b3c4d (answer it with: ag actors send 1a2b3c4d \"...\"):\n\n"
                       "I own x.py\n</pasted_content id=\"ab12\">", "g2"),
                  user("an ordinary request", "u1")], "c2")
        self.put([user("mine", 99)])
        mine = "\n".join(self.texts(self.read()))
        self.assertIn("an ordinary request", mine)
        self.assertNotIn("Stop editing x.py", mine)
        self.assertNotIn("I own x.py", mine)
        self.cfg.unshared_openings = ()                             # none: every one shown
        self.put([user("mine again", 98)])
        self.assertIn("Stop editing x.py", "\n".join(self.texts(self.read())))


class BackgroundTest(Base):
    def test_no_factory_never_spawns(self):
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        self.read()
        self.assertIsNone(tables.latest_build(self.m._conn("s"), "c1"))

    def test_read_claims_once_and_spawns(self):
        spawned = []
        self.policy.jobs = Recording(lambda s, c, job, job_id: spawned.append((s, c, job)))
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        self.read()
        self.read()                     # already running
        self.assertEqual(spawned, [("s", "c1", "build")])
        self.assertEqual(tables.latest_build(self.m._conn("s"), "c1")["status"], "running")

    def test_a_refused_build_is_tried_again_at_the_next_user_message(self):
        spawned = []
        self.policy.jobs = Recording(lambda s, c, job, job_id: spawned.append(job))
        self.put(PREAMBLE + conversation(8))
        conn = self.m._conn("s")
        tables.settle(conn, tables.new_build(conn, "c1"), "nothing", through_row=conn.execute(
            "SELECT max(row_id) FROM events").fetchone()[0], error="too small")
        self.put([user("a little more", 90)])
        self.read()
        self.assertEqual(spawned, ["build"])                    # the whole context is still over max

    def test_below_threshold_does_not_spawn(self):
        self.policy.jobs, self.cfg.min_context_tokens = Recording(), 10 ** 9
        self.cfg.max_context_tokens, self.cfg.build_every_request = 10 ** 9, False
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        self.read()
        self.assertIsNone(tables.latest_build(self.m._conn("s"), "c1"))
        self.assertEqual(self.m._conn("s").execute("SELECT count(*) FROM _boundaries").fetchone()[0], 0)

    def test_the_real_worker_builds(self):
        # A factory module the worker imports, returning a manager on this
        # temp directory with the scripted model.
        mod = os.path.join(self.tmp.name, "factory_mod.py")
        with open(mod, "w") as fh:
            fh.write(f"""
import sys; sys.path.insert(0, {os.path.dirname(os.path.abspath(__file__))!r})
sys.path.insert(0, {os.path.dirname(os.path.dirname(os.path.abspath(__file__)))!r})
from ag.ag_harness.store import paths
paths.TRACE_DIR = {paths.TRACE_DIR!r}
import codex_items as codex
from ag.ag_policies.proactive_context_manager import ProactiveContextManager, ProactiveContextManagerConfig
from test_core import ScriptedLLM
from ag.ag_harness import Manager
def make():
    return Manager(ProactiveContextManager(codex.FORMAT, ScriptedLLM(new_task=True),
                        ProactiveContextManagerConfig(min_context_tokens=0, build_every_request=True, require_smaller=False,
                                                      gatherer_guide="")))
""")
        self.policy.jobs = worker.WorkerJobs("factory_mod:make", [self.tmp.name], log=paths.worker_log)
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        self.read()
        conn = self.m._conn("s")
        for _ in range(100):
            if tables.latest_build(conn, "c1")["status"] != "running":
                break
            time.sleep(0.1)
        build = tables.latest_build(conn, "c1")
        self.assertEqual(build["status"], "ready", build.get("error"))
        self.put([user("next", 51)])
        self.assertTrue(any(t.startswith("# Previous task") for t in self.texts(self.read())))


class RequestedTest(Base):
    """A build a reader asks for from outside any call (the dashboard's History view)."""

    def setUp(self):
        super().setUp()
        self.spawned = []
        self.policy.jobs = Recording(lambda s, c, job, job_id: self.spawned.append((job, job_id)))

    def ask(self, n=10):
        return self.m.requested("s", properties=ch("c1"), min_messages=n)

    def test_started_once_there_are_enough_user_messages_since_the_last(self):
        self.put(PREAMBLE + conversation(9))                       # 9 user messages (their answers not counted)
        self.assertEqual(self.ask(), {"few": 9})
        self.assertEqual(self.spawned, [])
        self.put(conversation(1, start=10))
        got = self.ask()
        self.assertEqual((got["messages"], self.spawned), (10, [("build", got["started"])]))
        build = tables.latest_build(self.m._conn("s"), "c1")
        self.assertEqual((build["status"], build["reason"]), ("running", tables.ASKED))
        self.assertEqual(self.ask(), {"running": got["started"]})          # not twice
        self.policy.build("s", ch("c1"), got["started"])                    # as the worker runs it: an ordinary build
        self.assertEqual(tables.latest_build(self.m._conn("s"), "c1")["status"], "ready")
        self.assertEqual(self.ask(), {"few": 0})                            # counted from what it went through
        self.put(conversation(3, start=11))
        self.assertEqual(self.ask(), {"few": 3})

    def test_it_is_adopted_at_the_next_user_message_not_before(self):
        self.put(PREAMBLE + conversation(6))
        self.read()
        self.policy.jobs = None                                             # no build of the read's own
        before = store.last_read(self.m._conn("s"), ch("c1"))["basis"]
        self.policy.jobs = Recording(lambda *a: None)
        build_id = self.ask(0)["started"]
        self.policy.build("s", ch("c1"), build_id)
        self.policy.jobs = None
        self.put([call(60), output(60)])                                    # mid-turn: the context it had
        self.read()
        self.assertEqual(store.last_read(self.m._conn("s"), ch("c1"))["basis"], before)
        self.put([agent("a", 60), user("next", 61)])
        self.read()
        self.assertEqual(store.last_read(self.m._conn("s"), ch("c1"))["basis"], str(build_id))

    def test_a_join_splits_nothing_so_its_messages_still_count(self):
        self.put(PREAMBLE + conversation(12))
        conn = self.m._conn("s")
        tables.settle(conn, tables.claim_build(conn, "c1", 60, tables.JOIN), "ready", through_row=store.high_water(conn))
        self.assertEqual(self.ask()["messages"], 12)

    def test_nothing_without_background_work(self):
        self.policy.jobs = None
        self.put(PREAMBLE + conversation(6))
        self.assertEqual(self.ask(), {})


class BoundaryTest(Base):
    """The middle band: between the thresholds a read asks, in the background,
    whether the user message starts a new task, and builds on a yes."""

    def setUp(self):
        super().setUp()
        self.cfg.max_context_tokens, self.cfg.build_every_request = 10 ** 9, False
        self.cfg.boundary_cooldown = 2
        self.cfg.build_timeout = 0.3        # a read over the limit waits for its build: not on a job that never runs
        self.spawned = []
        self.policy.jobs = Recording(lambda s, c, job, job_id: self.spawned.append({job: job_id}))

    def check(self, row_id):
        """The boundary check, as the worker would run it: the policy's `check`."""
        return self.policy.check("s", ch("c1"), row_id)

    def last_row(self):
        return self.m._conn("s").execute("SELECT max(row_id) FROM events").fetchone()[0]

    def verdict(self, row_id):
        v = tables.boundary_verdict(self.m._conn("s"), row_id)
        return None if v is None else (v["new_task"], v["why"])

    def test_parse_verdict(self):
        from ag.ag_policies.tools.boundary import parse_verdict
        self.assertIs(parse_verdict('{"new_task": true, "why": "x"}'), True)
        self.assertIs(parse_verdict('Sure.\n{"new_task": "false"}'), False)
        self.assertIsNone(parse_verdict("no json here"))
        self.assertIsNone(parse_verdict('{"new_task": "maybe"}'))
        self.assertIsNone(parse_verdict(""))

    def test_between_thresholds_a_check_is_spawned_once_per_message(self):
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        self.read()
        self.read()                         # same message: not asked twice
        self.assertEqual(self.spawned, [{"check": self.last_row()}])
        self.assertIsNone(tables.latest_build(self.m._conn("s"), "c1"))
        self.put([call(50), output(50), agent("a", 50)])
        self.read()                         # mid-turn: nothing
        self.assertEqual(len(self.spawned), 1)
        self.put([user("q", 51)])
        self.read()
        self.assertEqual(self.spawned[-1], {"check": self.last_row()})

    def test_cooldown_holds_the_first_messages_of_an_open_task(self):
        self.put(PREAMBLE + conversation(1) + [user("q", 50)])    # 2nd user message: within cooldown
        self.read()
        self.assertEqual(self.spawned, [])
        self.put([agent("a", 50), user("q", 51)])                  # 3rd: asked
        self.read()
        self.assertEqual(len(self.spawned), 1)

    def test_thresholds_measure_the_whole_returned_context(self):
        # With a build in use, what the model gets is the condensation messages + the open
        # task + the history's preamble (and what the harness sends besides it: none here):
        # that size, not the new history, is what the bands see.
        recording, self.policy.jobs = self.policy.jobs, None       # no background work until the bands are set
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        self.run_build("s", "c1")
        self.read()                         # switches to the build
        self.put([agent("a", 50), user("q", 51), agent("a", 51), user("q", 52)])
        conn = self.m._conn("s")
        build = tables.latest_build(conn, "c1")
        made_ids = [r.made_id for r in store.last_read(conn, ch("c1"))["refs"] if r.made_id is not None]
        made = sum(t for _, _, t in store.made_items(conn, made_ids).values())
        rows = store.rows(conn, match=ch("c1"))
        tail = sum(r.tokens for r in rows if r.row_id >= build["open_from_row"])
        preamble = sum(r.tokens for r in rows if r.event_id in {e["id"] for e in PREAMBLE})
        size = made + tail + preamble          # all the model gets: the overview and the preamble too
        self.assertGreater(made, 0)
        self.policy.jobs, self.cfg.min_context_tokens = recording, size + 1
        self.read()
        self.assertEqual(self.spawned, [])                         # under min: nothing
        self.cfg.min_context_tokens, self.cfg.max_context_tokens = size, size + 1
        self.read()
        self.assertEqual(sorted(self.spawned[-1]), ["check"])            # in between: a check
        self.put([agent("a", 52), user("q", 53)])
        self.cfg.max_context_tokens = size
        self.read()
        self.assertEqual(sorted(self.spawned[-1]), ["build"])      # at max: a build

    def test_the_first_message_after_an_asked_build_is_checked_within_the_cooldown(self):
        for reason, asked in ((tables.ASKED, True), (tables.DIRECT, False)):
            with self.subTest(reason=reason):
                self.setUp()
                self.put(PREAMBLE + conversation(5))               # tasks 1-2, 3-4, and 5 running
                conn = self.m._conn("s")
                self.policy.build("s", ch("c1"), tables.claim_build(conn, "c1", 60, reason))
                self.put([user("q", 51)])                          # the running task's 2nd: within the cooldown
                self.read()                                        # the build taken up here
                self.assertEqual(store.last_read(conn, ch("c1"))["basis"], str(tables.latest_build(conn, "c1")["build_id"]))
                self.assertEqual(self.spawned, [{"check": self.last_row()}] if asked else [])

    def test_checks_are_off_when_disabled(self):
        self.cfg.check_boundaries = False
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        self.read()
        self.assertEqual(self.spawned, [])

    def test_above_max_builds_without_asking(self):
        self.cfg.max_context_tokens = 1
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        self.read()
        self.assertEqual(self.spawned, [{"build": 1}])

    def test_a_continuation_is_recorded_and_nothing_is_built(self):
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        self.assertFalse(self.check(self.last_row()))
        self.assertEqual(self.verdict(self.last_row()), (False, "scripted"))
        self.assertIsNone(tables.latest_build(self.m._conn("s"), "c1"))
        self.assertEqual(self.llm.calls, ["boundary"])
        # the prompt shows the open task's requests, numbered, the new one last (an event's text: the adaptor's)
        self.assertIn("\n[9] q\n", self.llm.prompts[0])
        self.assertIn("\n[1] question 1\n", self.llm.prompts[0])
        self.assertNotIn('"input_text"', self.llm.prompts[0])          # no payload JSON

    def test_a_new_task_builds_with_the_new_message_verbatim(self):
        self.llm.new_task = True
        self.put(PREAMBLE + conversation(8) + [user("fresh start", 50)])
        self.assertTrue(self.check(self.last_row()))
        self.assertEqual(self.verdict(self.last_row()), (True, "scripted"))
        conn = self.m._conn("s")
        build = tables.latest_build(conn, "c1")
        self.assertEqual(build["status"], "ready", build.get("error"))
        self.assertEqual(build["open_from_row"], self.last_row())
        texts = self.texts(self.read())
        self.assertTrue(any(t.startswith("# Previous task") for t in texts))
        self.assertIn("fresh start", texts[-1])

    def test_the_prompt_shows_the_finished_tasks_and_the_open_one(self):
        # A build has cut 9 turns into tasks of 2, the 9th alone: that one is
        # the open task. Two more turns arrive, then the message to judge.
        self.policy.jobs = None
        self.put(PREAMBLE + conversation(8) + [user("ninth", 50)])
        self.run_build("s", "c1")
        self.put([agent("a", 50), user("tenth", 51), agent("a", 51), user("eleventh", 52)])
        self.check(self.last_row())
        prompt = self.llm.prompts[-1]
        self.assertIn("# The task before it\n\n## task 7-8", prompt)
        self.assertIn("# The task before that\n\n## task 5-6", prompt)
        self.assertNotIn("task 3-4", prompt)                          # only boundary_tasks_shown
        self.assertIn("\n[1] ninth\n", prompt)                     # the open task starts at turn 9
        self.assertIn("\n[3] eleventh\n", prompt)
        self.assertNotRegex(prompt, r'\[\d+\] question 8')             # a finished task's

    def test_a_failed_model_reads_as_a_continuation(self):
        self.llm.fail = True
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        # the tool reports that it has no verdict ...
        from ag.ag_interface.policy import TypeIds
        from ag.ag_policies.tools import boundary, history
        conn = self.m.store("s")
        _, turns = history.turns(conn, TypeIds.load(conn), self.policy.groups, self.policy.tokenizer, "c1")
        verdict, why = boundary.is_new_task(turns, [], turns, self.llm, self.cfg.boundary)
        self.assertIsNone(verdict)
        self.assertIn("no usable verdict", why)
        # ... and the policy decides that means a continuation
        self.assertFalse(self.check(self.last_row()))
        self.assertEqual(self.verdict(self.last_row())[0], False)
        self.assertIn("treated as a continuation", self.verdict(self.last_row())[1])
        self.assertIsNone(tables.latest_build(self.m._conn("s"), "c1"))

    def factory(self, new_task=True):
        """A module the worker imports: a manager on this temp directory with
        the scripted model."""
        mod = os.path.join(self.tmp.name, "factory_mod.py")
        with open(mod, "w") as fh:
            fh.write(f"""
import sys; sys.path.insert(0, {os.path.dirname(os.path.abspath(__file__))!r})
sys.path.insert(0, {os.path.dirname(os.path.dirname(os.path.abspath(__file__)))!r})
from ag.ag_harness.store import paths
paths.TRACE_DIR = {paths.TRACE_DIR!r}
import codex_items as codex
from ag.ag_policies.proactive_context_manager import ProactiveContextManager, ProactiveContextManagerConfig
from test_core import ScriptedLLM
from ag.ag_harness import Manager
def make():
    return Manager(ProactiveContextManager(codex.FORMAT, ScriptedLLM(new_task={new_task!r}),
                        ProactiveContextManagerConfig(min_context_tokens=0, build_every_request=True, require_smaller=False,
                                                      gatherer_guide="")))
""")
        self.policy.jobs = worker.WorkerJobs("factory_mod:make", [self.tmp.name], log=paths.worker_log)

    def test_a_read_waits_for_a_new_task_build_and_switches_at_once(self):
        self.factory(new_task=True)
        self.cfg.sync_seconds = 30
        self.put(PREAMBLE + conversation(8) + [user("fresh start", 50)])
        texts = self.texts(self.read())
        self.assertTrue(any(t.startswith("# Previous task") for t in texts))   # this very read
        self.assertIn("fresh start", texts[-1])
        self.assertEqual(tables.latest_build(self.m._conn("s"), "c1")["status"], "ready")
        self.assertEqual(int(store.last_read(self.m._conn("s"), ch("c1"))["basis"]), 1)

    def test_a_continuation_returns_before_the_deadline(self):
        self.factory(new_task=False)
        self.cfg.sync_seconds = 30
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        t0 = time.monotonic()
        texts = self.texts(self.read())
        self.assertLess(time.monotonic() - t0, 25)
        self.assertFalse(any(t.startswith("# ") for t in texts))
        self.assertEqual(self.verdict(self.last_row()), (False, "scripted"))
        self.assertIsNone(tables.latest_build(self.m._conn("s"), "c1"))

    def test_a_new_task_s_build_is_waited_for_longer_than_its_check(self):
        # the check answers at once; the build is ready 0.4 s later, past sync_seconds
        self.cfg.sync_seconds, self.cfg.build_wait_seconds = 0.1, 2.0
        t0 = time.monotonic()
        ready = lambda conn, ch: {"status": "ready" if time.monotonic() - t0 > 0.4 else "running"}
        with mock.patch.object(tables, "boundary_verdict", lambda conn, row: {"new_task": True}), \
                mock.patch.object(tables, "latest_build", ready):
            self.assertTrue(self.policy.wait(None, "c1", 1, "check", self.cfg.sync_seconds))
            self.assertGreater(time.monotonic() - t0, 0.4)
            self.cfg.build_wait_seconds = 0.2                       # one slower than that is not waited for
            t0 = time.monotonic()
            self.assertFalse(self.policy.wait(None, "c1", 1, "check", self.cfg.sync_seconds))
            self.assertLess(time.monotonic() - t0, 0.4)
        no = lambda conn, row: {"new_task": False}
        with mock.patch.object(tables, "boundary_verdict", no):    # a continuation: no longer wait
            t0 = time.monotonic()
            self.assertFalse(self.policy.wait(None, "c1", 1, "check", 5))
            self.assertLess(time.monotonic() - t0, 0.2)

    def test_past_the_deadline_the_worker_finishes_in_the_background(self):
        self.factory(new_task=True)
        self.cfg.sync_seconds = 0.01
        self.put(PREAMBLE + conversation(8) + [user("fresh start", 50)])
        texts = self.texts(self.read())
        self.assertFalse(any(t.startswith("# ") for t in texts))    # too slow: the old context
        conn = self.m._conn("s")
        for _ in range(300):
            build = tables.latest_build(conn, "c1")
            if build and build["status"] != "running":
                break
            time.sleep(0.1)
        self.assertEqual(build["status"], "ready", build.get("error"))
        self.put([agent("a", 50), user("next", 51)])
        texts = self.texts(self.read())
        self.assertTrue(any(t.startswith("# Previous task") for t in texts))

    def test_the_real_worker_checks(self):
        mod = os.path.join(self.tmp.name, "factory_mod.py")
        with open(mod, "w") as fh:
            fh.write(f"""
import sys; sys.path.insert(0, {os.path.dirname(os.path.abspath(__file__))!r})
sys.path.insert(0, {os.path.dirname(os.path.dirname(os.path.abspath(__file__)))!r})
from ag.ag_harness.store import paths
paths.TRACE_DIR = {paths.TRACE_DIR!r}
import codex_items as codex
from ag.ag_policies.proactive_context_manager import ProactiveContextManager, ProactiveContextManagerConfig
from test_core import ScriptedLLM
from ag.ag_harness import Manager
def make():
    return Manager(ProactiveContextManager(codex.FORMAT, ScriptedLLM(new_task=True),
                        ProactiveContextManagerConfig(min_context_tokens=0, build_every_request=True, require_smaller=False,
                                                      gatherer_guide="")))
""")
        self.policy.jobs = worker.WorkerJobs("factory_mod:make", [self.tmp.name], log=paths.worker_log)
        self.put(PREAMBLE + conversation(8) + [user("q", 50)])
        self.read()
        conn = self.m._conn("s")
        build = None
        for _ in range(200):
            build = tables.latest_build(conn, "c1")
            if build and build["status"] != "running":
                break
            time.sleep(0.1)
        self.assertEqual(self.verdict(self.last_row()), (True, "scripted"))
        self.assertIsNotNone(build)
        self.assertEqual(build["status"], "ready", build.get("error"))


if __name__ == "__main__":
    unittest.main()
