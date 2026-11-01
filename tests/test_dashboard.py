"""`ag dashboard` (ag_dashboard): what it reads from a home -- its gatherers and agents,
one agent over time, what a read held, the Gatherer's own model calls -- and the page,
served on localhost or written with its data inside it."""
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import unittest.mock
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag.ag_harness import Manager  # noqa: E402
from ag.ag_harness.store import operations as store  # noqa: E402
from ag.ag_harness.store import paths  # noqa: E402
from ag.ag_policies.proactive_context_manager import ProactiveContextManager  # noqa: E402
from ag.ag_policies.proactive_context_manager import tables  # noqa: E402
from ag_dashboard import data, server  # noqa: E402
from ag_dashboard import home as dashboard_home  # noqa: E402
from channels import ch  # noqa: E402
from test_core import PREAMBLE, ScriptedLLM, agent, conversation, long_turn, user  # noqa: E402
import codex_items  # noqa: E402
from replies import answered, insert, turn  # noqa: E402
from ag.integrations.tools.ag_orchestrator import records  # noqa: E402
from ag.integrations.tools.ag_orchestrator.migrate import shape_of  # noqa: E402


class HomeBase(unittest.TestCase):
    """A home of the test's own, with gatherer `g`: agent c1 with a history, reads (one
    with the provider's count and the harness's limit) and a build; agent c2 with events only."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = paths.TRACE_DIR, paths.AG_HOME
        paths.AG_HOME = os.path.join(self.tmp.name, "ag")
        paths.TRACE_DIR = os.path.join(paths.AG_HOME, "gatherers")
        self.saved_home, dashboard_home.HOME = dashboard_home.HOME, paths.AG_HOME   # the dashboard reads the same home
        os.makedirs(os.path.join(paths.TRACE_DIR, "g"))
        with open(os.path.join(paths.TRACE_DIR, "g", "gatherer.toml"), "w") as fh:
            fh.write('policy = "proactive_context_manager"\n')
        self.policy = ProactiveContextManager(codex_items.FORMAT, ScriptedLLM(),
                                              options={"min_context_tokens": 0, "sync_seconds": 0, "require_smaller": False})
        self.m = Manager(self.policy)
        self.m.init("g")
        items = codex_items.CodexItems(self.m)
        turn(self.m, "g", ch("c1"), "codex")                                 # its hook recorded its call, and the harness
        turn(self.m, "g", ch("c2"), "codex")
        for item in PREAMBLE + conversation(4) + long_turn(2, start=50):
            items.insert("g", item, channel_id="c1")
        self.reads = []
        for limit in (None, 244800):
            ctx, read_id = self.m._context("g", store.high_water(self.m._conn("g")), ch("c1"), limit)
            self.reads.append(read_id)
        self.m.record_real_tokens("g", self.reads[0], 9999)
        self.build_id = tables.new_build(self.m._conn("g"), "c1")
        self.policy.build("g", ch("c1"), self.build_id)
        items.insert("g", user("the next request", 90), channel_id="c1")   # a new turn: the build is taken
        self.reads.append(self.m._context("g", store.high_water(self.m._conn("g")), ch("c1"), 244800)[1])
        items.insert("g", PREAMBLE[0], channel_id="c2")

    def tearDown(self):
        paths.TRACE_DIR, paths.AG_HOME = self.saved
        dashboard_home.HOME = self.saved_home
        self.tmp.cleanup()

    def log_call(self, name, **record):
        os.makedirs(os.path.join(paths.AG_HOME, "logs", "llm"), exist_ok=True)
        with open(os.path.join(paths.AG_HOME, "logs", "llm", name), "w") as fh:
            json.dump(record, fh)


class DataTest(HomeBase):
    def test_the_home_lists_each_gatherer_s_agents_with_their_state(self):
        h = data.home()
        (g,) = h["gatherers"]
        self.assertEqual((g["name"], g["policy"]), ("g", "proactive_context_manager"))
        agents = {a["channel"]: a for a in g["agents"]}
        self.assertEqual(set(agents), {"c1", "c2"})
        c1 = agents["c1"]
        self.assertEqual((c1["reads"], c1["limit_tokens"], c1["harness"]), (3, 244800, "codex"))
        self.assertEqual(c1["last_user_message"], "the next request")        # what it was last asked
        self.assertIsNone(c1["recap"])
        insert(self.m, "g", ch("c1"), [records.recap("An older recap.")])
        insert(self.m, "g", ch("c1"), [records.recap("Counting rows; next, the columns.")])
        c1 = next(a for a in data.home()["gatherers"][0]["agents"] if a["channel"] == "c1")
        self.assertEqual(c1["recap"]["text"], "Counting rows; next, the columns.")   # its newest recap
        self.assertTrue(c1["recap"]["at"])
        self.assertEqual(c1["last_user_message"], "the next request")        # a recap is not a message
        self.assertIsNone(c1["name"])
        insert(self.m, "g", ch("c1"), [records.name("Count rows", "codex")])
        time.sleep(0.002)
        insert(self.m, "g", ch("c1"), [records.name("Count the rows", "codex")])
        c1 = next(a for a in data.home()["gatherers"][0]["agents"] if a["channel"] == "c1")
        self.assertEqual(c1["name"], {"text": "Count the rows", "by": "codex"})   # the newest it was given
        time.sleep(0.002)
        insert(self.m, "g", ch("c1"), [records.name("Rows", "user")])
        time.sleep(0.002)
        insert(self.m, "g", ch("c1"), [records.name("Count rows again", "codex")])
        c1 = next(a for a in data.home()["gatherers"][0]["agents"] if a["channel"] == "c1")
        self.assertEqual(c1["name"], {"text": "Rows", "by": "user"})              # the user's, over a newer one
        self.assertTrue(c1["running"])                      # read just now
        self.assertFalse(agents["c2"]["running"] and agents["c2"]["reads"])
        created = [a["created"] for a in g["agents"]]                      # in place: newest created first,
        self.assertEqual(created, sorted(created, reverse=True))          # whatever happened since
        self.assertEqual(g["created"], min(created))

    def test_the_home_reads_every_event_a_fixed_number_of_times_however_many_agents(self):
        """Each agent's events found by ag's index on the channel, not by a scan of them all: by the bare column,
        a home of 64 agents in a 425 MB file took 2 s, every update."""
        def scans():
            run, connect = [], data._connect

            def traced(gatherer):
                conn = connect(gatherer)
                if conn is not None:
                    conn.set_trace_callback(run.append)
                return conn
            with unittest.mock.patch.object(data, "_connect", traced):
                data.home()
            conn = sqlite3.connect(paths.db_path("g"))
            try:
                return sum(any(d.split(" USING")[0] in ("SCAN events", "SCAN e", "SCAN e2")
                               for *_, d in conn.execute("EXPLAIN QUERY PLAN " + sql))
                           for sql in run if sql.lstrip().upper().startswith("SELECT"))
            finally:
                conn.close()
        two = scans()
        items = codex_items.CodexItems(self.m)
        for c in ("c3", "c4", "c5"):
            items.insert("g", PREAMBLE[0], channel_id=c)
        self.assertEqual(scans(), two)

    def test_an_agent_over_time(self):
        a = data.agent("g", "c1", [])
        self.assertEqual([r["read_id"] for r in a["reads"]], self.reads)
        first, second, third = a["reads"]
        self.assertEqual((first["real_tokens"], first["limit_tokens"], second["limit_tokens"]), (9999, None, 244800))
        self.assertTrue(all(r["est_tokens"] and r["sent_tokens"] >= r["est_tokens"] for r in a["reads"]))
        self.assertEqual([r["rebuild"] for r in a["reads"]], [False, False, True])   # the third took the build
        self.assertEqual(a["rebuilds"], 1)
        self.assertEqual(a["builds"][0]["build_id"], self.build_id)
        self.assertGreaterEqual(len(a["tasks"]), 2)
        self.assertEqual(third["tasks"], sum(1 for t in a["tasks"] if t["started"] <= third["at"]))
        self.assertTrue(all(t["started"] for t in a["tasks"]))

    def test_every_call_s_tokens_added_up_by_kind(self):
        a = data.agent("g", "c1", [])
        u = a["usage"]
        self.assertEqual(u["tokens"], sum(r["sent_tokens"] for r in a["reads"]))    # each message once per call
        self.assertEqual(u["calls"], 3)
        self.assertEqual(u["real_tokens"], 9999)
        groups = {e["group"] for e in u["entries"]}
        self.assertTrue({"Recent history", "Kept from before the cut", "ag's sections"} <= groups)

    def test_a_call_s_count_is_as_ag_kept_it_then(self):
        before = data.agent("g", "c1", [])["reads"]
        conn = sqlite3.connect(paths.db_path("g"))
        kept = dict(conn.execute("SELECT read_id, sent_tokens FROM _reads WHERE p_channel = 'c1'"))
        conn.execute("UPDATE events SET tokens = 0, counted = 1 WHERE p_channel = 'c1'")   # sizes set since
        conn.commit()
        conn.close()
        after = data.agent("g", "c1", [])["reads"]
        self.assertEqual([r["recorded_tokens"] for r in after], [kept[r["read_id"]] for r in after])
        self.assertEqual([r["recorded_tokens"] for r in after], [r["recorded_tokens"] for r in before])
        self.assertTrue(all(r["recorded_tokens"] for r in after))
        self.assertLess(after[-1]["sent_tokens"], before[-1]["sent_tokens"])               # the breakdown, as now

    def test_a_file_from_before_reads_had_sizes_still_has_ag_s_count(self):
        conn = sqlite3.connect(paths.db_path("g"))
        conn.executescript("ALTER TABLE _reads DROP COLUMN est_tokens; ALTER TABLE _reads DROP COLUMN real_tokens; "
                           "ALTER TABLE _reads DROP COLUMN limit_tokens;")
        conn.close()
        reads = data.agent("g", "c1", [])["reads"]
        self.assertTrue(all(r["sent_tokens"] > 0 and r["est_tokens"] is None and r["real_tokens"] is None for r in reads))
        conn = sqlite3.connect(paths.db_path("g"))
        conn.executescript("ALTER TABLE _reads DROP COLUMN sent_tokens;")
        conn.close()
        reads = data.agent("g", "c1", [])["reads"]
        self.assertTrue(all(r["recorded_tokens"] is None and r["sent_tokens"] > 0 for r in reads))   # not kept: now's
        c1 = next(a for a in data.home()["gatherers"][0]["agents"] if a["channel"] == "c1")
        self.assertEqual((c1["reads"], c1["real_tokens"]), (3, None))
        self.assertGreater(c1["sent_tokens"], 0)

    def test_what_a_read_held(self):
        r = data.read("g", self.reads[-1])
        groups = {g["group"]: g for g in r["groups"]}
        self.assertIsNotNone(r["cut"])                           # made from the build: the history was cut
        self.assertIn("Recent history", groups)
        self.assertIn("Kept from before the cut", groups)         # the preamble
        self.assertIn("ag's sections", groups)                   # the build's sections
        self.assertEqual(sum(g["tokens"] for g in r["groups"]),
                         data.agent("g", "c1", [])["reads"][-1]["sent_tokens"])   # what the chart plots

    def test_the_context_item_by_item(self):
        c = data.context("g", self.reads[-1])
        self.assertEqual([i["position"] for i in c["items"]], list(range(len(c["items"]))))     # in order
        self.assertEqual(c["tokens"], data.agent("g", "c1", [])["reads"][-1]["sent_tokens"])
        groups = [i["group"] for i in c["items"]]
        self.assertIn("ag's sections", groups)
        self.assertTrue(all(i["text"] for i in c["items"] if i["group"] == "ag's sections"))   # the section's text
        self.assertEqual(c["basis"], str(self.build_id))
        old = data.TEXT_CHARS
        data.TEXT_CHARS = 5
        try:
            clipped = data.context("g", self.reads[-1])["items"]
        finally:
            data.TEXT_CHARS = old
        self.assertTrue(all(len(i["text"]) <= 5 for i in clipped) and any(i["clipped"] for i in clipped))

    def test_a_pending_answer_is_the_agent_s_latest_activity(self):
        c1 = lambda: next(a for a in data.home()["gatherers"][0]["agents"] if a["channel"] == "c1")   # noqa: E731
        before = c1()["last"]
        time.sleep(0.01)
        reply = {"role": "assistant", "content": [{"type": "text", "text": "Done."}]}
        answered(self.m, "g", {"channel": "c1"}, [{"type": "agent_message", "payload": reply, "text": "Done."}], "msg_1")
        self.assertGreater(c1()["last"], before)                                  # the turn's answer: something new to look at
        self.assertEqual(next(a for a in data.home()["gatherers"][0]["agents"] if a["channel"] == "c2")["last"],
                         next(a for a in data.home()["gatherers"][0]["agents"] if a["channel"] == "c2")["last_event"])

    def test_a_side_call_storing_the_reply_is_no_activity_of_the_agent_s(self):
        """Claude Code's recap, or prompt suggestion, stores the conversation's events -- the reply that ended
        the turn among them, which was pending -- minutes after it came. The agent's latest activity stays
        when the reply came (kept on its read), so a reader who has looked since does not see it Finished
        again; nor does its status change."""
        c1 = lambda: next(a for a in data.home()["gatherers"][0]["agents"] if a["channel"] == "c1")   # noqa: E731
        reply = agent("Done.", 91)
        answered(self.m, "g", {"channel": "c1"}, [{"type": "message", "payload": reply, "text": "Done."}],
                 "msg_1", "end_turn", read_id=self.reads[-1])
        before = c1()
        time.sleep(0.01)
        codex_items.CodexItems(self.m).insert("g", reply, channel_id="c1")      # the side call: stored, so no longer pending
        after = c1()
        self.assertGreater(after["last_event"], before["last"])
        self.assertEqual((after["last"], after["status"], after["turn_over"]),     # when the reply came
                         (before["last"], before["status"], before["turn_over"]))

    def test_the_pending_answer_follows_the_latest_context(self):
        self.assertEqual(data.agent("g", "c1", [])["pending"], [])                 # the last call carried all of it
        reply = {"role": "assistant", "content": [{"type": "text", "text": "There are 42 rows."}]}
        answered(self.m, "g", {"channel": "c1"}, [{"type": "agent_message", "payload": reply, "text": "There are 42 rows."},
                                                   {"type": "agent_reasoning", "payload": {"content": [
                                                       {"type": "thinking", "thinking": "count them"}]}}], "msg_1")   # no text: its words
        got = data.agent("g", "c1", [])["pending"]
        self.assertEqual([(i["group"], i["name"], i["text"]) for i in got],
                         [("Pending", "agent_message", "There are 42 rows."), ("Pending", "agent_reasoning", "count them")])
        self.assertGreater(got[0]["tokens"], 0)
        self.assertEqual(data.agent("g", "c2", [])["pending"], [])                 # another channel's: not this one's
        codex_items.CodexItems(self.m).insert("g", agent("There are 42 rows.", 92), channel_id="c1")   # the next call carried it
        self.assertEqual(data.agent("g", "c1", [])["pending"], [])

    def test_what_came_after_the_latest_read_follows_it(self):
        self.assertEqual(data.agent("g", "c1", [])["after_read"], [])           # the latest read has all of it
        reply = {"role": "assistant", "content": [{"type": "text", "text": "Checking."}]}
        answered(self.m, "g", {"channel": "c1"}, [{"type": "agent_message", "payload": reply, "text": "Checking."}], "msg_1")
        self.assertEqual([i["text"] for i in data.agent("g", "c1", [])["after_read"]], ["Checking."])   # pending alone
        items = codex_items.CodexItems(self.m)
        items.insert("g", agent("All done.", 91), channel_id="c1")             # a side call stored the answer, logged no read
        got = data.agent("g", "c1", [])
        self.assertEqual(got["pending"], [])
        after = got["after_read"]
        self.assertEqual([i["group"] for i in after], [data.AFTER_READ])
        self.assertIn("All done.", after[0]["text"])
        self.assertGreater(after[0]["row_id"], got["reads"][-1]["row_id"])
        answered(self.m, "g", {"channel": "c1"}, [{"type": "agent_message", "payload": reply, "text": "Next."}], "msg_2")
        self.assertEqual([i["group"] for i in data.agent("g", "c1", [])["after_read"]],
                         [data.AFTER_READ, data.PENDING])                       # by time: the stored one, then pending
        self.assertEqual(data.agent("g", "c2", [])["after_read"], [])           # another channel's: not this one's
        items.insert("g", agent("Next.", 93), channel_id="c1")                  # the next call carried it
        self.reads.append(self.m._context("g", store.high_water(self.m._conn("g")), ch("c1"), 244800)[1])
        self.assertEqual(data.agent("g", "c1", [])["after_read"], [])           # a new read: in its context now

    def test_a_stretch_of_the_agent_s_own_history(self):
        tasks = data.agent("g", "c1", [])["tasks"]
        first = tasks[0]
        h = data.history("g", "c1", first["first_row"], first["last_row"])
        rows = [i["row_id"] for i in h["items"]]
        self.assertEqual((rows[0], rows[-1]), (first["first_row"], first["last_row"]))
        self.assertEqual(rows, sorted(rows))
        since = data.history("g", "c1", tasks[-1]["last_row"] + 1)                 # after the last task: to the end
        self.assertTrue(all(i["row_id"] > tasks[-1]["last_row"] for i in since["items"]))
        self.assertEqual(data.history("g", "c2", 1)["items"][0]["name"], "context")   # only the channel's own
        reply = {"role": "assistant", "content": [{"type": "text", "text": "Done."}]}
        answered(self.m, "g", {"channel": "c1"}, [{"type": "agent_message", "payload": reply, "text": "Done."}], "msg_2")
        self.assertEqual(data.history("g", "c1", tasks[-1]["last_row"] + 1)["items"][-1]["text"], "Done.")   # to the end: the pending answer last
        self.assertNotIn("Done.", [i["text"] for i in data.history("g", "c1", first["first_row"], first["last_row"])["items"]])

    def test_the_conversation_as_the_transcript_shows_it(self):
        everything = data.transcript("g", "c1")
        rows = [i["row_id"] for i in everything["items"]]
        self.assertEqual(rows, sorted(rows))
        self.assertTrue(all(i["parts"] for i in everything["items"]))
        self.assertFalse(everything["earlier"])
        self.assertTrue(everything["newest"])
        with unittest.mock.patch.object(data, "TRANSCRIPT_ITEMS", 3):
            newest = data.transcript("g", "c1")                                 # the newest few, and earlier ones said
            self.assertEqual([i["row_id"] for i in newest["items"]], rows[-3:])
            self.assertTrue(newest["earlier"])
            before = data.transcript("g", "c1", before=rows[-3])
            self.assertEqual([i["row_id"] for i in before["items"]], rows[-6:-3])
            self.assertFalse(before["newest"])
            after = data.transcript("g", "c1", after=rows[0])                  # a page after a row: not the newest yet
            self.assertEqual([i["row_id"] for i in after["items"]], rows[1:4])
            self.assertFalse(after["newest"])
        reply = {"role": "assistant", "content": [{"type": "text", "text": "Done."}]}
        answered(self.m, "g", {"channel": "c1"}, [{"type": "agent_message", "payload": reply, "text": "Done."}], "msg_2")
        since = data.transcript("g", "c1", after=rows[-1])                      # nothing stored since: the pending answer
        self.assertEqual(since["items"], [{"row_id": None, "type": "agent_message", "at": since["items"][0]["at"],
                                           "parts": [{"kind": "text", "role": "assistant", "text": "Done."}]}])
        self.assertNotIn(None, [i["row_id"] for i in data.transcript("g", "c1", before=rows[-1])["items"]])
        self.assertIn("error", data.transcript("nope", "c1"))

    def test_the_gatherer_s_calls_go_to_the_agent_by_job_or_by_time(self):
        build = data.agent("g", "c1", [])["builds"][0]
        self.log_call("1-a-1-summarize.json", purpose="summarize", model="openai/gpt-4o-mini",
                      started="2000-01-01T00:00:00+00:00", usage={"prompt_tokens": 1000, "completion_tokens": 100},
                      seconds=1.0, error=None, job={"gatherer": "g", "job": "build", "id": 1, "properties": {"channel": "c1"}})
        self.log_call("2-b-1-rank.json", purpose="rank", model="codex/gpt-5.5", seconds=2.0, error=None,
                      started=time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(build["started"])),
                      usage={"input_tokens": 50, "output_tokens": 5})
        self.log_call("3-c-1-rank.json", purpose="rank", model="codex/gpt-5.5", seconds=2.0, error="boom",
                      started="2000-01-01T00:00:00+00:00", usage={})          # no job, outside every build
        llm = data.agent("g", "c1")["llm"]
        by = {p["purpose"]: p for p in llm["by_purpose"]}
        self.assertEqual((by["summarize"]["calls"], by["rank"]["calls"]), (1, 1))
        self.assertEqual((by["rank"]["tokens_in"], by["rank"]["unpriced"]), (50, 1))   # a CLI model: no price
        self.assertEqual(data.agent("g", "c2")["llm"]["total"]["calls"], 0)


class ReadableTest(unittest.TestCase):
    def test_the_words_of_an_event_ag_keeps_no_text_for(self):
        pi = {"api": "x", "role": "assistant", "content": [{"type": "thinking", "thinking": "Plan it."},
                                                             {"type": "text", "text": ""}]}
        self.assertEqual(data.readable(json.dumps(pi)), "Plan it.")
        self.assertEqual(data.readable(json.dumps({"role": "assistant", "content": [{"type": "text", "text": ""}]})), "")
        codex = {"type": "reasoning", "summary": [{"type": "summary_text", "text": "Checking."}], "encrypted_content": "zz"}
        self.assertEqual(data.readable(json.dumps(codex)), "Checking.")
        self.assertEqual(data.readable('{"a": 1}'), '{"a": 1}')                 # no blocks: the payload itself


def drawn(*args, **kw):
    """data.parts, less how each call is shown and what its result's harness said of the run (their own tests)."""
    return [{k: v for k, v in p.items() if k not in ("action", "view", "shown", "exit", "took")} for p in data.parts(*args, **kw)]


class PartsTest(unittest.TestCase):
    """Each harness's events as the transcript's parts, read by its channel's harness's rules: the same parts whoever
    wrote them."""

    def test_claude_code_s_blocks(self):
        call = {"role": "assistant", "content": [{"type": "thinking", "thinking": "Look first.", "signature": "s"},
                                                 {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "ls"}}]}
        self.assertEqual(drawn("tool_call", json.dumps(call), None, harness="claude"),
                         [{"kind": "thinking", "text": "Look first."},
                          {"kind": "call", "id": "t1", "name": "Bash", "input": {"command": "ls"}}])
        out = {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "is_error": True,
                                            "content": [{"type": "text", "text": "no such file"}, {"type": "image"}]}]}
        self.assertEqual(drawn("tool_output", json.dumps(out), None, harness="claude"),
                         [{"kind": "result", "id": "t1", "error": True, "text": "no such file\n[image]"}])
        said = {"role": "assistant", "content": [{"type": "text", "text": "**Done.**"}]}
        self.assertEqual(drawn("agent_message", json.dumps(said), None, harness="claude"), [{"kind": "text", "role": "assistant", "text": "**Done.**"}])
        system = {"role": "system", "content": [{"type": "text", "text": "env"}]}
        self.assertEqual(drawn("context", json.dumps(system), "env", harness="claude"),     # as its rules read it
                         [{"kind": "note", "name": "context", "text": "env", "said": {"kind": "environment", "detail": {}}}])

    def test_codex_s_items(self):
        call = {"type": "function_call", "name": "shell", "arguments": json.dumps({"command": ["ls"]}), "call_id": "c1"}
        self.assertEqual(drawn("tool_call", json.dumps(call), None, harness="codex"),
                         [{"kind": "call", "id": "c1", "name": "shell", "input": {"command": ["ls"]}}])
        out = {"type": "function_call_output", "call_id": "c1", "output": "a\nb"}
        self.assertEqual(drawn("tool_output", json.dumps(out), None, harness="codex"), [{"kind": "result", "id": "c1", "error": False, "text": "a\nb"}])
        patch = {"type": "custom_tool_call", "name": "apply_patch", "input": "*** Begin Patch", "call_id": "c2"}
        self.assertEqual(drawn("tool_call", json.dumps(patch), None, harness="codex")[0]["input"], "*** Begin Patch")
        said = {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Done."}]}
        self.assertEqual(drawn("agent_message", json.dumps(said), None, harness="codex"), [{"kind": "text", "role": "assistant", "text": "Done."}])
        hidden = {"type": "reasoning", "summary": [], "encrypted_content": "zz"}
        self.assertEqual(drawn("agent_reasoning", json.dumps(hidden), None, harness="codex"), [{"kind": "thinking", "text": ""}])

    def test_the_same_view_for_every_harness_from_what_its_rules_read(self):
        image = {"role": "user", "content": [{"type": "image", "source": {"type": "base64", "data": "x"}}]}
        self.assertEqual(drawn("user_message", json.dumps(image), None, harness="claude"),      # Part.attachment
                         [{"kind": "note", "name": "image", "text": "[image]"}])
        script = {"type": "custom_tool_call", "call_id": "x1", "name": "exec",
                  "input": 'await tools.exec_command({cmd: "ls"}); await tools.apply_patch("*** Begin Patch")'}
        self.assertEqual([(c["name"], c["input"], c["view"]["shape"]) for c in           # ToolCall.calls, each as shown
                          data.parts("tool_call", json.dumps(script), None, harness="codex")[0]["calls"]],
                         [("exec_command", {"cmd": "ls"}, "shell"), ("apply_patch", "*** Begin Patch", "patch")])
        thought = {"role": "model", "parts": [{"text": "hmm", "thought": True}]}
        self.assertEqual(drawn("agent_reasoning", json.dumps(thought), None, harness="antigravity"),
                         [{"kind": "thinking", "text": "hmm"}])
        # a row stored as the user's under older rules is the harness's own once its rules say so
        withheld = {"role": "user", "content": [{"type": "text", "text": "Your response above was stopped by a safety "
                    "classifier — this is not a tool or API error. The rest of it was withheld, and tool calls in it that had "
                    "not finished did not run. Do not produce that content again, even reworded."}]}
        got = drawn("user_message", json.dumps(withheld), None, harness="claude")
        self.assertEqual((got[0]["kind"], got[0]["said"]["kind"]), ("note", "retry_note"))

    def test_each_call_shown_by_its_shape_and_each_result_less_its_harness_s_lines(self):
        claude = {"role": "assistant", "content": [{"type": "tool_use", "id": "t", "name": "Edit", "input": {
            "file_path": "/w/a.py", "old_string": "x", "new_string": "y"}}]}
        [call] = data.parts("tool_call", json.dumps(claude), None, harness="claude")
        self.assertEqual((call["action"], call["view"]), ("edit", {"shape": "edit", "title": "Update", "path": "/w/a.py",
                                                                  "all": False, "edits": [{"old": "x", "new": "y"}]}))
        agy = {"role": "model", "parts": [{"functionCall": {"id": "t", "name": "edit_file", "args": {
            "Path": "/w/a.py", "Target": "x", "Replacement": "y"}}}]}
        self.assertEqual(data.parts("tool_call", json.dumps(agy), None, harness="antigravity")[0]["view"],
                         {"shape": "edit", "title": "Update", "path": "/w/a.py", "edits": [{"old": "x", "new": "y"}]})
        failed = {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t", "is_error": True, "content":
                  "Exit code 2\nls: x: No such file\nShell cwd was reset to /w"}]}
        [r] = data.parts("tool_output", json.dumps(failed), None, harness="claude")
        self.assertEqual((r["shown"], r["exit"]), ("ls: x: No such file", "2"))
        ran = {"type": "function_call_output", "call_id": "c", "output": "Wall time: 0.2 seconds\nProcess exited with code 0\n"
                                                                        "Output:\nhi\n"}
        [r] = data.parts("tool_output", json.dumps(ran), None, harness="codex")
        self.assertEqual((r["shown"], r["exit"], r["took"]), ("hi\n", "0", "0.2 seconds"))

    def test_a_note_says_what_its_rules_read_of_it(self):
        report = {"type": "agent_message", "author": "/root/count_a", "content": [{"type": "input_text",
                  "text": "Message Type: FINAL_ANSWER\nTask name: count\nSender: /root/count_a\nPayload:\n391"}]}
        said = data.parts("context", json.dumps(report), None, harness="codex")[0].get("said")
        self.assertEqual(said, {"kind": "agent_report", "detail": {"between": True, "from": "/root/count_a", "text": "391"}})
        bare = {"role": "user", "content": [{"type": "text", "text": "Draw it plainly.\n\nARGUMENTS: a bar chart"}]}
        self.assertEqual(data.parts("context", json.dumps(bare), None, harness="claude")[0]["said"]["kind"], "user")
        said = data.parts("context", json.dumps(bare), None, harness="claude", kind="skill")[0]["said"]   # as stored
        self.assertEqual(said, {"kind": "skill", "detail": {"name": "", "args": "a bar chart", "instructions": "Draw it plainly."}})
        skill = {"role": "user", "content": [{"type": "text", "text": "Base directory for this skill: /s/greet\n\nSay hi."}]}
        self.assertEqual(data.parts("context", json.dumps(skill), None)[0]["said"]["kind"], "skill")   # its harness not known

    def test_an_unknown_shape_shows_its_words_and_long_text_is_clipped(self):
        self.assertEqual(data.parts("user_message", json.dumps({"info": {}, "text": "x"}), "hello"),
                         [{"kind": "text", "role": "user", "text": "hello"}])
        long = {"role": "assistant", "content": [{"type": "tool_use", "id": "t", "name": "Write",
                                                  "input": {"content": "x" * (data.TEXT_CHARS + 10)}}]}
        got = data.parts("tool_call", json.dumps(long), None)[0]["input"]["content"]
        self.assertTrue(got.startswith("x" * data.TEXT_CHARS) and got.endswith("(10 more characters)"))


class HarnessTest(unittest.TestCase):
    """Which harness an agent from before its hook recorded its calls ran on, from its events' shape: what copying an
    older gatherer's tables into records records (migrate.py's `shape_of`)."""

    def test_each_harness_s_events(self):
        user = {"role": "user", "content": [{"type": "text", "text": "hi"}]}       # pi and Claude Code alike
        cases = {
            "codex": [{"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hi"}]}],
            "claude": [user, {"role": "assistant", "content": [{"type": "tool_use", "id": "t", "name": "Bash", "input": {}}]}],
            "pi": [user, {"role": "assistant", "api": "google-generative-ai", "content": [{"type": "toolCall", "name": "read"}]}],
            "opencode": [{"info": {"role": "user", "sessionID": "ses_1"}, "parts": []}],
        }
        for harness, payloads in cases.items():
            self.assertEqual(shape_of(payloads), harness, harness)
        self.assertIsNone(shape_of([user]))                 # a lone user message tells nothing


class PageTest(HomeBase):
    def test_a_snapshot_stands_alone(self):
        text = server.page(data.snapshot())
        self.assertNotIn("/*SNAPSHOT*/null", text)
        embedded = text.split("const SNAPSHOT = ", 1)[1].split(";\n", 1)[0]
        snap = json.loads(embedded.replace("<\\/", "</"))
        self.assertIn("g\u0000c1", snap["agents"])
        self.assertIn(f"g\u0000{self.reads[-1]}", snap["reads"])     # the last read's contents, inside
        self.assertIn(f"g\u0000{self.reads[-1]}", snap["contexts"])

    def test_the_page_carries_its_markdown_libraries(self):
        text = server.page()
        self.assertNotIn("<!--VENDOR-->", text)
        self.assertIn("marked v15", text)
        self.assertIn("DOMPurify", text)
        self.assertEqual(text.count("<script>"), 6)          # the two libraries, xterm.js and its fit and WebGL add-ons, then the page's own
        self.assertIn(".xterm-helper-textarea", text)                       # xterm.js's stylesheet

    def test_a_snapshot_has_no_terminal(self):
        text = server.page(data.snapshot())
        self.assertEqual(text.count("<script>"), 3)
        self.assertNotIn(".xterm-helper-textarea", text)

    def test_a_snapshot_cannot_close_its_script(self):
        text = server.page({"home": {"x": "</script><script>alert(1)</script>"}})
        self.assertEqual(text.count("</script>"), server.page({}).count("</script>"))

    def test_each_harness_as_harness_kit_describes_it_and_the_page_names_none(self):
        import harness_kit
        info = data.home()["harness_info"]
        self.assertEqual(set(info), set(harness_kit.HARNESSES))
        self.assertEqual(info["codex"]["label"], "Codex")
        self.assertTrue(info["claude"]["mark"].startswith("<svg"))
        self.assertEqual([n for n, i in info.items() if i["runs"]], harness_kit.runnable())
        self.assertFalse(info["codex"]["fullscreen"])
        self.assertEqual(info["claude"]["stopped"]["lead"], "⎿")
        snap = server.page(data.snapshot()).split("const SNAPSHOT = ", 1)[1].split(";\n", 1)[0]
        self.assertIn("harness_info", json.loads(snap.replace("<\\/", "</"))["home"])       # a snapshot's, too
        with open(server.PAGE, encoding="utf-8") as fh:
            page = fh.read()
        for gone in ("const HARNESS =", "BADGES", "ANTIGRAVITY_ARCH", "CHAT_HARNESSES", "STOPPED_SAYS", '!== "codex"'):
            self.assertNotIn(gone, page)                  # each harness's look and screen: harness_kit's

    def test_the_server_answers_the_page_and_its_data(self):
        httpd = server.serve("127.0.0.1", 0)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        url = f"http://127.0.0.1:{httpd.server_port}"
        get = lambda path: urllib.request.urlopen(url + path, timeout=10)  # noqa: E731
        self.assertIn("ag dashboard", get("/").read().decode())
        self.assertEqual(json.load(get("/api/home"))["gatherers"][0]["name"], "g")
        self.assertEqual(len(json.load(get("/api/agent?gatherer=g&channel=c1"))["reads"]), 3)
        self.assertTrue(json.load(get(f"/api/read?gatherer=g&read_id={self.reads[0]}"))["groups"])
        self.assertTrue(json.load(get(f"/api/context?gatherer=g&read_id={self.reads[0]}"))["items"])
        self.assertTrue(json.load(get("/api/history?gatherer=g&channel=c1&from=1&to=5"))["items"])
        self.assertTrue(json.load(get("/api/transcript?gatherer=g&channel=c1"))["items"])
        self.assertTrue(json.load(get("/api/transcript?gatherer=g&channel=c1&after=1"))["items"])
        self.assertIn("turns", json.load(get("/api/files?gatherer=g&channel=c1")))
        with self.assertRaises(urllib.error.HTTPError) as caught:
            get("/api/read?gatherer=g&read_id=x")
        self.assertEqual(caught.exception.code, 404)


class CommandTest(HomeBase):
    def test_out_writes_the_page_and_a_bad_argument_is_refused(self):
        from ag.cli import main
        out = os.path.join(self.tmp.name, "d.html")
        with unittest.mock.patch.dict(os.environ, {"AG_HOME": paths.AG_HOME}):       # ag's home: the test's
            self.assertEqual(main.dashboard(["--out", out]), 0)
        with open(out) as fh:
            self.assertIn('"g\\u0000c1"', fh.read())
        with unittest.mock.patch("sys.stderr"):
            self.assertEqual(main.dashboard(["--bogus"]), 2)

    def test_ag_alone_starts_the_dashboard_opened_in_the_browser(self):
        from ag.cli import main
        with unittest.mock.patch.dict(os.environ, {"AG_HOME": paths.AG_HOME}), \
                unittest.mock.patch("ag_dashboard.__main__.main", return_value=0) as started:
            self.assertEqual(main.main([]), 0)
            self.assertEqual(main.main(["dashboard", "--no-open"]), 0)
        self.assertEqual(started.call_args_list[0].args[0], ["--home", paths.AG_HOME, "--open"])
        self.assertEqual(started.call_args_list[1].args[0], ["--home", paths.AG_HOME, "--open", "--no-open"])

    def run_dashboard(self, *args):
        """ag_dashboard's main on this home, its server stopped at once: (its exit code, the URLs it opened)."""
        from ag_dashboard.__main__ import main as dashboard_main
        with unittest.mock.patch.dict(os.environ, {"DISPLAY": ":0"}), unittest.mock.patch("sys.stderr"), \
                unittest.mock.patch.object(server.Server, "serve_forever", side_effect=KeyboardInterrupt), \
                unittest.mock.patch("webbrowser.open", return_value=True) as opened:
            code = dashboard_main(["--home", paths.AG_HOME, *args])
        return code, [c.args[0] for c in opened.call_args_list]

    def test_open_opens_the_page_once_it_listens_and_only_then(self):
        code, urls = self.run_dashboard("--port", "0", "--open")
        self.assertEqual(code, 0)
        self.assertRegex(urls[0], r"^http://127\.0\.0\.1:\d+/$")
        self.assertEqual(self.run_dashboard("--port", "0"), (0, []))

    def test_open_on_a_port_taken_opens_the_dashboard_there_if_it_is_this_homes(self):
        httpd = server.serve("127.0.0.1", 0, live_updates=False)          # this home's, running already
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        port = httpd.server_port
        self.assertEqual(self.run_dashboard("--port", str(port), "--open"), (0, [f"http://127.0.0.1:{port}/"]))
        import http.server
        other = http.server.HTTPServer(("127.0.0.1", 0), http.server.BaseHTTPRequestHandler)   # not a dashboard
        threading.Thread(target=other.serve_forever, daemon=True).start()
        self.addCleanup(other.server_close)
        self.addCleanup(other.shutdown)
        self.assertEqual(self.run_dashboard("--port", str(other.server_port), "--open"), (1, []))


class SeparateTest(unittest.TestCase):
    def test_the_dashboard_imports_nothing_of_ag(self):
        import ast
        import ag_dashboard
        root = os.path.dirname(ag_dashboard.__file__)
        for name in os.listdir(root):
            if name.endswith(".py"):
                with open(os.path.join(root, name)) as fh:
                    tree = ast.parse(fh.read())
                for node in ast.walk(tree):
                    mods = [a.name for a in node.names] if isinstance(node, ast.Import) else \
                        [node.module or ""] if isinstance(node, ast.ImportFrom) and not node.level else []
                    for m in mods:
                        self.assertNotEqual(m.split(".")[0], "ag", f"{name} imports {m}")


if __name__ == "__main__":
    unittest.main()
