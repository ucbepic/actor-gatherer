"""The gatherer guide every context opens with, and a new channel's join: with no build of its
own, in a gatherer where another channel has one, its first user message starts a `join` build
-- the others' tasks ranked against it, their requests marked as seen -- and the read waits for
it, so a new session starts from what the gatherer's other sessions did."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ag.ag_harness  # noqa: E402,F401
from ag.ag_harness import Manager, db_path  # noqa: E402
from ag.ag_harness.store import operations as store  # noqa: E402
from ag.ag_interface import Jobs  # noqa: E402
from ag.ag_policies.proactive_context_manager import ProactiveContextManager, ProactiveContextManagerConfig  # noqa: E402
from ag.ag_policies.proactive_context_manager import layout, tables  # noqa: E402
import codex_items as codex  # noqa: E402
from test_core import PREAMBLE, Base, ScriptedLLM, agent, conversation, user  # noqa: E402
from channels import ch  # noqa: E402

GUIDE_START = "About this context, from the gatherer."
JOINED = layout.JOINED_OPENING.split("\n")[0]


class Inline(Jobs):
    """Jobs run where they are started: each build at once, so a read that waits for its build
    finds it settled. Anything else is not run."""

    def __init__(self, policy):
        self.policy, self.started = policy, []

    def start(self, gatherer_id, properties, job, job_id):
        self.started.append((properties.get("channel"), job))
        if job == "build":
            self.policy.build(gatherer_id, properties, job_id)


class JoinBase(Base):
    def setUp(self):
        super().setUp()
        self.llm = ScriptedLLM()
        # builds only when asked, or on a join
        self.cfg = ProactiveContextManagerConfig(min_context_tokens=0, check_boundaries=False, require_smaller=False,
                                                 sync_seconds=0, parallel_message="P[{channel}]: {text}")
        self.policy = ProactiveContextManager(codex.FORMAT, self.llm, self.cfg)
        self.m = Manager(self.policy)
        self.policy.jobs = self.jobs = Inline(self.policy)
        self.wrapped = codex.CodexItems(self.m)
        self.wrapped.init("w")

    def put(self, items, channel="c1"):
        for item in items:
            self.wrapped.insert("w", item, channel_id=channel)

    def read(self, channel="c1"):
        return self.m.read("w", store.high_water(self.m._conn("w")), properties=ch(channel))

    def texts(self, context):
        return [codex.text(i) for i in context]

    def built(self, channel="c1"):
        """A build of `channel` run directly, ready."""
        conn = self.m._conn("w")
        build = self.policy.build("w", ch(channel), tables.new_build(conn, channel))
        self.assertEqual(build["status"], "ready")
        return build

    def parallel(self, context):
        return [t for t in self.texts(context) if t.startswith("P[")]

    def sections(self, context):
        return "\n".join(t for t in self.texts(context) if t.startswith("# "))


class GuideTest(JoinBase):
    def test_it_comes_first_after_the_harness_s_own_set_up_before_any_build(self):
        self.put(PREAMBLE + [user("my task", 1)])
        texts = self.texts(self.read())
        self.assertTrue(texts[len(PREAMBLE)].startswith(GUIDE_START))
        self.assertEqual(texts[:len(PREAMBLE)], self.texts(PREAMBLE))
        self.assertEqual(texts[len(PREAMBLE) + 1:], ["my task"])

    def test_and_before_the_sections_after_one(self):
        self.put(PREAMBLE + conversation(12))
        self.built()
        self.put([user("next", 50)])
        texts = self.texts(self.read())
        self.assertTrue(texts[len(PREAMBLE)].startswith(GUIDE_START))
        self.assertTrue(texts[len(PREAMBLE) + 1].startswith("# How this history is organised"))
        self.assertEqual(sum(t.startswith(GUIDE_START) for t in texts), 1)

    def test_it_names_every_kind_of_ag_message_and_where_the_history_is(self):
        self.put(PREAMBLE + [user("my task", 1)])
        guide = self.texts(self.read())[len(PREAMBLE)]
        for kind in ("History sections", "Requests made in parallel", "File-change notices",
                     "Messages from a stream", "Left-out notes"):
            self.assertIn(kind, guide)
        self.assertIn(db_path("w"), guide)       # as configured: SQLite's own name for it follows symlinks (macOS: /var is /private/var)
        self.assertIn("`p_channel`", guide)

    def test_the_sections_no_longer_say_where_the_history_is_themselves(self):
        self.assertNotIn("SQLite database", layout.overview(self.cfg))
        self.assertNotIn("SQLite database", layout.overview(self.cfg, joined=True))

    def test_one_made_item_while_its_text_is_the_same(self):
        self.put(PREAMBLE + [user("my task", 1)])
        self.read()
        self.put([agent("ok", 1), user("more", 2)])
        self.read()
        conn = self.m._conn("w")
        self.assertEqual(conn.execute("SELECT count(*) FROM _made_items WHERE name = 'gatherer_guide'").fetchone()[0], 1)

    def test_every_channel_is_sent_the_one_kept(self):
        self.put(PREAMBLE + [user("mine", 1)])
        self.put(PREAMBLE + [user("theirs", 2)], channel="c2")
        self.read()
        self.read("c2")
        conn = self.m._conn("w")
        guide = conn.execute("SELECT made_id FROM _made_items WHERE name = 'gatherer_guide'").fetchall()
        self.assertEqual(len(guide), 1)                                  # the same text, kept once
        for channel in ("c1", "c2"):
            self.assertIn(guide[0][0], [r.made_id for r in store.last_read(conn, ch(channel))["refs"]])

    def test_none_when_configured_off(self):
        self.cfg.gatherer_guide = ""
        self.put(PREAMBLE + [user("my task", 1)])
        self.assertEqual(self.texts(self.read()), self.texts(PREAMBLE) + ["my task"])

    def test_it_counts_toward_the_context_but_not_the_policy_s_own_part(self):
        self.put(PREAMBLE + [user("my task", 1)])
        with_guide = self.policy.read(self.store(), self.request())
        self.cfg.gatherer_guide = ""
        without = self.policy.read(self.store(), self.request())
        self.assertEqual(with_guide.tokens, without.tokens)                  # `own`: the policy's arranging

    def store(self):
        from ag.ag_harness.manager import Store
        return Store(self.m._conn("w"), "w")

    def request(self):
        from ag.ag_interface.policy import Read
        return Read("w", ch("c1"), store.high_water(self.m._conn("w")))


class JoinTest(JoinBase):
    def other_session(self, turns=12):
        """c1 worked for a while and built; its last request came after the build."""
        self.put(PREAMBLE + conversation(turns, prefix="c1 "))
        self.built()

    def test_a_new_channel_starts_from_the_others_work(self):
        self.other_session()
        self.put(PREAMBLE + [user("new work", 100)], channel="c2")
        context = self.read("c2")
        sections = self.sections(context)
        self.assertIn(JOINED, sections)
        self.assertIn("# Related earlier tasks", sections)
        self.assertIn("from parallel channel c1", sections)
        self.assertIn("c1 answer", sections)                                 # their tasks, messages and all
        self.assertIn("## Requests made in parallel sessions", sections)
        self.assertEqual(self.parallel(context), [])                         # before the mark: in the index
        self.assertEqual(self.texts(context)[-1], "new work")                # its own, verbatim
        self.assertEqual(self.jobs.started, [("c2", "build")])
        self.assertEqual(tables.latest_build(self.m._conn("w"), "c2")["reason"], tables.JOIN)

    def test_it_is_adopted_though_it_replaces_nothing_of_the_channel_s_own(self):
        self.other_session()
        self.cfg.require_smaller = True
        self.put(PREAMBLE + [user("new work", 100)], channel="c2")
        self.assertIn(JOINED, self.sections(self.read("c2")))

    def test_it_has_none_of_its_own_earlier_sections(self):
        self.other_session()
        self.put(PREAMBLE + [user("new work", 100)], channel="c2")
        sections = self.sections(self.read("c2"))
        for header in ("# Earlier messages", "# Previous task", "# This task so far"):
            self.assertNotIn(header, sections)

    def test_a_request_to_another_channel_after_the_join_is_shown_in_place(self):
        self.other_session()
        self.put(PREAMBLE + [user("new work", 100)], channel="c2")
        self.read("c2")
        self.put([user("c1 later", 200)])
        self.put([agent("ok", 100), user("more work", 101)], channel="c2")
        texts = self.texts(self.read("c2"))
        self.assertEqual(texts[texts.index("P[c1]: c1 later") + 1], "more work")
        self.assertEqual(sum(t.startswith("P[") for t in texts), 1)

    def test_the_join_stays_in_use_without_another_build(self):
        self.other_session()
        self.put(PREAMBLE + [user("new work", 100)], channel="c2")
        joined = self.read("c2")
        self.put([agent("ok", 100), user("more work", 101)], channel="c2")
        again = self.texts(self.read("c2"))
        self.assertEqual(again[:len(joined)], self.texts(joined))             # a prefix: the context only grew
        self.assertEqual(self.jobs.started, [("c2", "build")])               # no second join

    def test_nothing_to_join_without_another_channel_s_build(self):
        self.put(PREAMBLE + conversation(3, prefix="c1 "))
        self.put(PREAMBLE + [user("new work", 100)], channel="c2")
        context = self.read("c2")
        self.assertEqual(self.jobs.started, [])
        self.assertEqual(self.sections(context), "")
        self.assertEqual(self.parallel(context), ["P[c1]: c1 question 1", "P[c1]: c1 question 2", "P[c1]: c1 question 3"])

    def test_it_joins_at_a_user_message_once_another_has_built(self):
        self.put(PREAMBLE + conversation(12, prefix="c1 "))
        self.put(PREAMBLE + [user("new work", 100)], channel="c2")
        self.read("c2")                                                      # nothing built yet
        self.built()
        self.put([agent("ok", 100), user("more work", 101)], channel="c2")
        self.assertIn(JOINED, self.sections(self.read("c2")))

    def test_not_before_a_user_message(self):
        self.other_session()
        self.put(PREAMBLE, channel="c2")
        self.read("c2")
        self.assertEqual(self.jobs.started, [])

    def test_the_no_channel_pool_s_build_is_still_read_first(self):
        self.put(PREAMBLE + conversation(12, prefix="pool "), channel=None)
        self.built(None)
        self.other_session()
        self.put(PREAMBLE + [user("new work", 100)], channel="c2")
        sections = self.sections(self.read("c2"))
        self.assertEqual(self.jobs.started, [])
        self.assertNotIn(JOINED, sections)

    def test_the_join_saves_no_tasks_and_its_own_build_replaces_it(self):
        self.other_session()
        self.put(PREAMBLE + [user("new work", 100)], channel="c2")
        self.read("c2")
        conn = self.m._conn("w")
        self.assertEqual(tables.load_tasks(conn, "c2"), [])
        self.put([agent("ok", 100)] + conversation(10, prefix="c2 ", start=101), channel="c2")
        own = self.built("c2")
        self.put([user("next", 300)], channel="c2")
        context = self.read("c2")
        self.assertEqual(store.last_read(conn, ch("c2"))["basis"], str(own["build_id"]))
        self.assertNotIn(JOINED, self.sections(context))
        self.assertIn("# Previous task", self.sections(context))

    def small_index(self):
        self.cfg.all_task_tokens, self.cfg.parallel_index_tokens = 1000, 500

    def test_a_long_other_session_is_an_index_not_a_message_per_request(self):
        self.small_index()
        self.other_session(turns=400)
        self.put(PREAMBLE + [user("new work", 1000)], channel="c2")
        context = self.read("c2")
        self.assertEqual(self.parallel(context), [])
        self.assertIn("later requests omitted", self.sections(context))
        self.assertEqual([s for s, j in self.jobs.started], ["c2"])          # one build, adopted: no loop
        read = store.last_read(self.m._conn("w"), ch("c2"))
        self.assertLess(read["est_tokens"], self.cfg.max_context_tokens)

    def test_the_index_has_the_channel_s_unused_request_budget_too(self):
        self.small_index()
        self.other_session(turns=400)
        self.put(PREAMBLE + [user("new work", 1000)], channel="c2")
        index = self.sections(self.read("c2")).split("## Requests made in parallel sessions", 1)[1]
        shown = index.count("(channel c1)")
        tok = self.policy.tokenizer
        line = tok.count("[id 99999] USER: c1 question 999  (channel c1)")
        self.assertGreater(shown * line, self.cfg.parallel_index_tokens)


if __name__ == "__main__":
    unittest.main()
