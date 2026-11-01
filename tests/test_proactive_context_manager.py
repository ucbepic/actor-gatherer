"""The proactive context manager: the sectioned context, with every request the user
made to another channel since the build in use shown where it arrived: right before
the user message this channel is working on, or, mid-turn, after the turn's latest step."""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ag.ag_harness  # noqa: E402,F401
from ag.ag_harness import Manager  # noqa: E402
import codex_items as codex  # noqa: E402
from ag.ag_policies.proactive_context_manager.events import environment_update  # noqa: E402
from ag.ag_policies.proactive_context_manager import tables  # noqa: E402
from ag.ag_policies.proactive_context_manager import ProactiveContextManager, ProactiveContextManagerConfig  # noqa: E402
from ag.ag_harness.store import operations as store  # noqa: E402
from test_core import PREAMBLE, Base, ScriptedLLM, agent, call, conversation, note, output, user  # noqa: E402
from channels import ch, on  # noqa: E402

KNOBS = dict(min_context_tokens=0, build_every_request=True, require_smaller=False, sync_seconds=0)


class ParallelBase(Base):
    def setUp(self):
        super().setUp()
        self.llm = ScriptedLLM()
        self.cfg = ProactiveContextManagerConfig(parallel_message="P[{channel}]: {text}", **KNOBS)
        self.policy = ProactiveContextManager(codex.FORMAT, self.llm, self.cfg)
        self.m = Manager(self.policy)
        self.wrapped = codex.CodexItems(self.m)
        self.wrapped.init("w")

    def put(self, items, channel="c1"):
        for item in items:
            self.wrapped.insert("w", item, channel_id=channel)

    def read(self, channel="c1"):
        return self.m.read("w", store.high_water(self.m._conn("w")), properties=ch(channel))

    def texts(self, context):
        return [codex.text(i) for i in context]

    def parallel(self, context):
        return [t for t in self.texts(context) if t.startswith("P[")]


class ShownTest(ParallelBase):
    def test_another_channel_s_request_comes_right_before_the_latest_user_message(self):
        self.put(PREAMBLE + [user("their task", 2)], channel="c2")
        self.put(PREAMBLE + [user("my task", 1)])
        texts = self.texts(self.read())
        self.assertEqual(texts[texts.index("P[c2]: their task") + 1], "my task")

    def test_mid_turn_it_comes_after_the_turn_s_latest_step(self):
        self.put(PREAMBLE + [user("my task", 1), call(1), output(1)])
        self.put(PREAMBLE + [user("their task", 2)], channel="c2")
        texts = self.texts(self.read())
        self.assertEqual(texts[-1], "P[c2]: their task")              # after the output, not before the turn
        self.assertLess(texts.index("my task"), texts.index("P[c2]: their task"))

    def test_the_harness_s_own_notes_after_the_message_are_not_a_turn_begun(self):
        self.put(PREAMBLE + [user("their task", 2)], channel="c2")
        self.put(PREAMBLE + [user("my task", 1), note(1)])
        texts = self.texts(self.read())
        self.assertEqual(texts[texts.index("P[c2]: their task") + 1], "my task")

    def test_nothing_new_comes_before_the_turn_s_steps(self):
        self.put(PREAMBLE + [user("my task", 1), call(1)])
        first = self.texts(self.read())
        self.put(PREAMBLE + [user("their task", 2)], channel="c2")
        self.put([output(1)])
        second = self.texts(self.read())
        self.assertEqual(second[:len(first)], first)                  # what the turn's thinking was written after

    def test_several_in_the_order_they_arrived_from_every_other_channel(self):
        self.put(PREAMBLE + [user("my task", 1)])
        self.put(PREAMBLE + [user("first", 2)], channel="c2")
        self.put(PREAMBLE + [user("second", 3)], channel="c3")
        self.put([user("third", 4)], channel="c2")
        texts = self.texts(self.read())
        at = texts.index("my task")
        self.assertEqual(texts[at - 3:at], ["P[c2]: first", "P[c3]: second", "P[c2]: third"])

    def test_the_channel_s_own_requests_are_not_shown_as_parallel(self):
        self.put(PREAMBLE + conversation(3))
        self.assertEqual(self.parallel(self.read()), [])

    def test_a_request_that_arrives_mid_turn_is_shown_on_the_next_call(self):
        self.put(PREAMBLE + [user("my task", 1), call(1)])
        first = self.read()
        self.put(PREAMBLE + [user("their task", 2)], channel="c2")
        self.put([output(1)])
        second = self.texts(self.read())
        self.assertEqual(self.parallel(first), [])
        self.assertEqual(second[-1], "P[c2]: their task")

    def test_it_moves_to_the_next_user_message(self):
        self.put(PREAMBLE + [user("my task", 1), call(1), output(1), agent("done", 1)])
        self.put(PREAMBLE + [user("their task", 2)], channel="c2")
        self.put([user("my next task", 3)])
        texts = self.texts(self.read())
        self.assertEqual(texts.count("P[c2]: their task"), 1)
        self.assertEqual(texts[texts.index("P[c2]: their task") + 1], "my next task")

    def test_once_shown_it_stays_where_it_was(self):
        self.put(PREAMBLE + [user("their task", 2)], channel="c2")
        self.put(PREAMBLE + [user("my task", 1)])
        first = self.texts(self.read())
        self.put([call(1), output(1), agent("done", 1), user("my next task", 3)])
        second = self.texts(self.read())
        self.assertEqual(second[:len(first)], first)                 # a prefix: nothing moved
        self.assertEqual(second[second.index("P[c2]: their task") + 1], "my task")

    def test_once_shown_mid_turn_it_stays_where_it_was(self):
        self.put(PREAMBLE + [user("my task", 1), call(1), output(1)])
        self.put(PREAMBLE + [user("their task", 2)], channel="c2")
        first = self.texts(self.read())
        again = self.texts(self.read())                              # the same call again: nothing after it yet
        self.put([agent("done", 1), user("my next task", 3)])
        second = self.texts(self.read())
        self.assertEqual(again, first)
        self.assertEqual(second[:len(first)], first)                 # a prefix: nothing moved
        self.assertEqual(second[len(first):], ["done", "my next task"])

    def test_a_new_one_goes_before_the_latest_and_the_old_ones_stay(self):
        self.put(PREAMBLE + [user("first", 2)], channel="c2")
        self.put(PREAMBLE + [user("my task", 1)])
        self.read()
        self.put([call(1), output(1), agent("done", 1), user("my next task", 3)])
        self.put([user("second", 4)], channel="c2")
        texts = self.texts(self.read())
        self.assertEqual(texts[texts.index("P[c2]: first") + 1], "my task")
        self.assertEqual(texts[texts.index("P[c2]: second") + 1], "my next task")
        self.assertEqual(self.parallel(self.read()), ["P[c2]: first", "P[c2]: second"])

    def test_each_channel_has_its_own_places(self):
        self.put(PREAMBLE + [user("my task", 1)])
        self.put(PREAMBLE + [user("their task", 2)], channel="c2")
        self.read()                                                  # c1 is shown c2's request
        self.put(PREAMBLE + [user("c3 task", 5)], channel="c3")
        self.put([agent("ok", 1), user("my next task", 3)])
        texts = self.texts(self.read())
        self.assertEqual(texts[texts.index("P[c2]: their task") + 1], "my task")
        self.assertEqual(texts[texts.index("P[c3]: c3 task") + 1], "my next task")
        three = self.texts(self.read("c3"))                          # c3 is shown both, before its own
        at = three.index("c3 task")
        self.assertEqual(three[at - 3:at], ["P[c1]: my task", "P[c2]: their task", "P[c1]: my next task"])

    def test_remade_on_every_read_not_reused(self):
        self.put(PREAMBLE + [user("my task", 1)])
        self.put(PREAMBLE + [user("their task", 2)], channel="c2")
        self.read()
        self.put([call(1), output(1)])
        self.assertEqual(self.parallel(self.read()), ["P[c2]: their task"])

    def test_the_default_wording(self):
        self.policy = ProactiveContextManager(codex.FORMAT, self.llm, ProactiveContextManagerConfig(**KNOBS))
        self.m = Manager(self.policy)
        self.wrapped = codex.CodexItems(self.m)
        self.wrapped.init("w")
        self.put(PREAMBLE + [user("my task", 1)])
        self.put(PREAMBLE + [user("their task", 2)], channel="c2")
        shown = [t for t in self.texts(self.read()) if t.startswith("The user sent this to another session")]
        self.assertEqual(len(shown), 1)
        self.assertTrue(shown[0].startswith("The user sent this to another session working in parallel with you:\n"
                                            "their task\n\nThis is how the gatherer shows you what the user asks "
                                            "its other sessions, where it arrived in your conversation. It is "
                                            "not addressed to you: do not answer it or take it up, and carry on with "
                                            "your own task. "))
        self.assertTrue(shown[0].endswith(os.path.join("w", "context.db") + ", table events, where p_channel = 'c2'."))


class BuildTest(ParallelBase):
    def run_build(self, channel_id="c1"):
        return self.policy.build("w", ch(channel_id), tables.new_build(self.m._conn("w"), channel_id))

    def test_after_a_build_only_the_requests_since_it_are_shown_in_place(self):
        self.put(PREAMBLE + conversation(12))
        self.put(PREAMBLE + [user("before the build", 100)], channel="c2")
        self.run_build()
        self.put([user("after the build", 101)], channel="c2")
        self.put([user("my next task", 50)])
        context = self.read()
        texts = self.texts(context)
        self.assertEqual(self.parallel(context), ["P[c2]: after the build"])
        self.assertEqual(texts[texts.index("P[c2]: after the build") + 1], "my next task")
        sections = "\n".join(t for t in texts if t.startswith("# "))
        self.assertIn("before the build", sections)             # the index carries it, as before
        self.assertNotIn("# Recent requests made in a parallel session", sections)


    def test_shown_before_a_message_a_build_condensed_it_comes_first_in_the_verbatim_part(self):
        self.put(PREAMBLE + conversation(12))
        self.run_build()
        self.put([user("my task", 50)])
        self.put(PREAMBLE + [user("their task", 100)], channel="c2")
        self.read()                                                  # shown before "my task"
        self.put([agent("ok", 50)])
        conn = self.m._conn("w")
        last = store.last_read(conn, ch("c1"))["read_id"]
        conn.execute("UPDATE _read_items SET row_id = 3 WHERE read_id = ? AND row_id = "
                     "(SELECT max(row_id) FROM _read_items WHERE read_id = ?)", (last, last))
        conn.commit()                                                # as if it had come before a row condensed away
        texts = self.texts(self.read())
        last_section = max(i for i, t in enumerate(texts) if t.startswith("# "))
        self.assertEqual(texts.index("P[c2]: their task"), last_section + 1)   # the verbatim part's first
        self.assertEqual(self.parallel(self.read()), ["P[c2]: their task"])


class WordingTest(ParallelBase):
    def build_and_read(self, policy):
        self.policy = policy
        self.m = Manager(policy)
        self.wrapped = codex.CodexItems(self.m)
        self.wrapped.init("w")
        self.put(PREAMBLE + conversation(12))
        self.put(PREAMBLE + [user("their task", 100)], channel="c2")
        policy.build("w", ch("c1"), tables.new_build(self.m._conn("w"), "c1"))
        self.put([user("after the build", 101)], channel="c2")
        self.put([user("my next task", 50)])
        return "\n".join(self.texts(self.read()))

    def test_the_parallel_requests_are_the_same_user_s_tasks_not_this_agent_s_own_work(self):
        text = self.build_and_read(ProactiveContextManager(codex.FORMAT, ScriptedLLM(),
                                                 ProactiveContextManagerConfig(**KNOBS)))
        self.assertNotIn("OWN WORK", text.upper())
        self.assertIn("They are tasks given by the same\n   user, on the same material. A definition, convention, "
                      "correction or exclusion the\n   user stated there applies to THIS work", text)

class BeforeItBeganTest(ParallelBase):
    """With no build in use, the other channels' requests made before this one began are messages
    only while they fit the budget a joined session gets for them; past it, one block of the newest."""

    BLOCK = "# Requests made in parallel sessions before this one"

    def setUp(self):
        super().setUp()
        self.cfg = ProactiveContextManagerConfig(parallel_message="P[{channel}]: {text}", all_task_tokens=200,
                                                 parallel_index_tokens=100, **KNOBS)
        self.policy = ProactiveContextManager(codex.FORMAT, self.llm, self.cfg)
        self.m = Manager(self.policy)
        self.wrapped = codex.CodexItems(self.m)
        self.wrapped.init("w")

    def earlier(self, count):
        self.put(PREAMBLE + [user(f"earlier request number {n}", 100 + n) for n in range(count)], channel="c2")

    def blocks(self, context):
        return [t for t in self.texts(context) if t.startswith(self.BLOCK)]

    def test_within_the_budget_they_stay_messages(self):
        self.earlier(3)
        self.put(PREAMBLE + [user("my task", 1)])
        context = self.read()
        self.assertEqual(self.blocks(context), [])
        self.assertEqual(len(self.parallel(context)), 3)

    def test_past_it_they_are_one_block_of_the_newest_before_the_session(self):
        self.earlier(60)
        self.put(PREAMBLE + [user("my task", 1)])
        context = self.read()
        texts = self.texts(context)
        [block] = self.blocks(context)
        self.assertEqual(self.parallel(context), [])
        self.assertIn("earlier request number 59", block)                # the newest kept
        self.assertNotIn("earlier request number 0 ", block + " ")
        self.assertRegex(block, r"\[\d+ earlier requests left out: ids \d+-\d+ — read them from the `events` table\]")
        self.assertLess(texts.index(block), texts.index("my task"))
        self.assertLessEqual(self.policy.tokenizer.count(block), 300)       # all_task_tokens + parallel_index_tokens

    def test_requests_made_since_it_began_are_still_messages(self):
        self.earlier(60)
        self.put(PREAMBLE + [user("my task", 1), call(1)])
        self.read()
        self.put([user("a later request", 300)], channel="c2")
        self.put([output(1)])
        context = self.read()
        self.assertEqual(len(self.blocks(context)), 1)
        self.assertEqual(self.parallel(context), ["P[c2]: a later request"])
        self.assertEqual(self.texts(context)[-1], "P[c2]: a later request")   # mid-turn: at the end

    def test_the_block_is_made_once_and_stays_where_it_was(self):
        self.earlier(60)
        self.put(PREAMBLE + [user("my task", 1)])
        first = self.texts(self.read())
        self.put([call(1), output(1), agent("done", 1)])
        self.put([user("a later request", 300)], channel="c2")
        self.put([user("my next task", 2)])
        second = self.texts(self.read())
        self.assertEqual(second[:len(first)], first)                     # a prefix: nothing moved or changed
        made = self.m._conn("w").execute("SELECT count(*) FROM _made_items WHERE name = 'parallel_before'").fetchone()
        self.assertEqual(made[0], 1)


class OwnChangeTest(ParallelBase):
    """A change counts as the agent's own only when a call that came in with it could have WRITTEN
    the file; a read of it (any tool row naming it) no longer hides it."""

    def setUp(self):
        super().setUp()
        self.cfg = ProactiveContextManagerConfig(parallel_message="P[{channel}]: {text}", notice="Notice: {what} (at {timestamp}).",
                                       **KNOBS)
        self.policy = ProactiveContextManager(codex.FORMAT, self.llm, self.cfg)
        self.m = Manager(self.policy)
        self.wrapped = codex.CodexItems(self.m)
        self.wrapped.init("w")
        self.ids = {t.name: t.id for t in self.m.event_types("w")}

    def ran(self, cmd, n=9, out=""):
        self.put([{"type": "function_call", "id": f"fc{n}", "call_id": f"c{n}", "name": "exec_command",
                   "arguments": json.dumps({"cmd": cmd})},
                  {"type": "function_call_output", "id": f"fco{n}", "call_id": f"c{n}", "output": out}])

    def change(self, subject, ts):
        self.m.insert("w", on(environment_update(self.ids["environment_update"], subject,
                                                 f"File {subject} was changed on disk", ts, "files"), "c1"))

    def notices(self, context):
        return [t for t in self.texts(context) if t.startswith("Notice:")]

    def notice_after(self, cmd, out=""):
        self.put(PREAMBLE + [user("what is in salaries.csv?", 1)])
        self.read()
        self.ran(cmd, out=out)
        self.change("salaries.csv", 5)                                    # what that request's poll finds
        return self.notices(self.read())

    def test_someone_else_s_change_right_after_the_agent_read_it_is_a_notice(self):
        # s08: the launcher rewrote the row 0.1 s after the agent's cat; the broader test took it for the agent's own
        self.assertEqual(self.notice_after("cat salaries.csv", "Japan,42180,2025"),
                         ["Notice: File salaries.csv was changed on disk (at 5)."])

    def test_a_read_only_script_does_not_hide_it_either(self):
        self.assertEqual(len(self.notice_after(
            "python3 -c \"import csv; rows = list(csv.reader(open('salaries.csv'))); print(len(rows) > 1)\"")), 1)

    def test_the_agent_s_own_writes_are_still_no_notice(self):
        for cmd in ("sed -i 's/Japan,42180/Japan,47152/' salaries.csv", "echo x >> salaries.csv",
                    "python3 -c \"open('salaries.csv', 'w').write(data)\"", "mv tmp.csv salaries.csv"):
            with self.subTest(cmd=cmd):
                self.setUp()
                self.assertEqual(self.notice_after(cmd), [])

    def test_the_default_notice_says_to_reread_before_relying_on_it(self):
        self.cfg = ProactiveContextManagerConfig(**KNOBS)
        self.policy = ProactiveContextManager(codex.FORMAT, self.llm, self.cfg)
        self.m = Manager(self.policy)
        self.wrapped = codex.CodexItems(self.m)
        self.wrapped.init("w")
        self.ids = {t.name: t.id for t in self.m.event_types("w")}
        self.put(PREAMBLE + [user("what is in salaries.csv?", 1)])
        self.read()
        self.ran("cat salaries.csv", out="Japan,42180,2025")
        self.change("salaries.csv", 1791216595)
        [notice] = [t for t in self.texts(self.read()) if "changed on disk" in t]
        self.assertEqual(notice, "File salaries.csv was changed on disk at 2026-10-05 16:09:55 UTC, after you last read "
                                 "it. What you read from it before is now out of date. Before giving any answer, or "
                                 "writing anything, that relies on its contents, read the file again. Remember this for later "
                                 "too: until you have read the file again, any answer or work, in this turn or a later "
                                 "one, that uses its contents must start by re-reading it.")

    def test_a_second_change_to_the_same_file_says_it_is_new(self):
        self.cfg = ProactiveContextManagerConfig(notice="Notice: {what}.{repeat}", notice_repeat=" NEW.", **KNOBS)
        self.policy = ProactiveContextManager(codex.FORMAT, self.llm, self.cfg)
        self.m = Manager(self.policy)
        self.wrapped = codex.CodexItems(self.m)
        self.wrapped.init("w")
        self.ids = {t.name: t.id for t in self.m.event_types("w")}
        self.put(PREAMBLE + [user("what is in salaries.csv?", 1)])
        self.read()
        self.ran("cat salaries.csv", n=8, out="Japan,42180,2025")
        self.change("salaries.csv", 5)
        self.assertEqual(self.notices(self.read()), ["Notice: File salaries.csv was changed on disk."])
        self.ran("cat salaries.csv", n=9, out="Japan,47152,2025")
        self.change("salaries.csv", 6)
        self.assertEqual(self.notices(self.read()), ["Notice: File salaries.csv was changed on disk.",
                                                     "Notice: File salaries.csv was changed on disk. NEW."])

    def test_the_default_repeat_sentence(self):
        self.assertIn("{repeat}", ProactiveContextManagerConfig().notice)
        self.assertTrue(ProactiveContextManagerConfig().notice_repeat.startswith(" This is a new change that just happened"))

    def edited(self, name, args, n=9):
        self.put([{"type": "function_call", "id": f"fc{n}", "call_id": f"c{n}", "name": name, "arguments": json.dumps(args)},
                  {"type": "function_call_output", "id": f"fco{n}", "call_id": f"c{n}", "output": "ok"}])

    def test_a_harness_s_own_editing_tool_on_the_file_is_the_agent_s_own(self):
        # making_ag: Claude Code's Edit of call_ag.py was taken for someone else's change
        for name, args in (("Edit", {"file_path": "salaries.csv", "old_string": "a", "new_string": "b"}),
                           ("Write", {"file_path": "salaries.csv", "content": "x"}),
                           ("MultiEdit", {"file_path": "salaries.csv", "edits": []}),
                           ("edit", {"path": "salaries.csv", "edits": [{"oldText": "a", "newText": "b"}]}),
                           ("write", {"filePath": "salaries.csv", "content": "x"})):
            with self.subTest(name=name):
                self.setUp()
                self.put(PREAMBLE + [user("fix salaries.csv", 1)])
                self.read()
                self.ran("cat salaries.csv", n=8)
                self.edited(name, args)
                self.change("salaries.csv", 5)
                self.assertEqual(self.notices(self.read()), [])

    def test_an_editing_tool_on_another_file_does_not_hide_the_change(self):
        self.put(PREAMBLE + [user("fix notes.md", 1)])
        self.read()
        self.ran("cat salaries.csv", n=8)
        self.edited("Write", {"file_path": "notes.md", "content": "see salaries.csv"})
        self.change("salaries.csv", 5)
        self.assertEqual(self.notices(self.read()), ["Notice: File salaries.csv was changed on disk (at 5)."])

    def test_apply_patch_on_the_file_is_the_agent_s_own(self):
        self.put(PREAMBLE + [user("fix salaries.csv", 1)])
        self.read()
        self.put([{"type": "custom_tool_call", "id": "ct9", "call_id": "c9", "name": "apply_patch",
                   "input": "*** Begin Patch\n*** Update File: salaries.csv\n@@\n-a\n+b\n*** End Patch"},
                  {"type": "custom_tool_call_output", "id": "cto9", "call_id": "c9", "output": "Done"}])
        self.change("salaries.csv", 5)
        self.assertEqual(self.notices(self.read()), [])

if __name__ == "__main__":
    unittest.main()
