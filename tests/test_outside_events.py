"""The proactive context manager's outside events: stream messages shown
where they arrived and a notice for an environment update to a file the
agent's own tool calls in the verbatim part opened."""

import json
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ag.ag_harness  # noqa: E402
from ag.ag_harness import Manager  # noqa: E402
from ag.ag_harness.store import operations as store  # noqa: E402
import codex_items as codex  # noqa: E402
from ag.ag_policies.proactive_context_manager.events import context_stream, environment_update  # noqa: E402
from ag.ag_policies.proactive_context_manager import tables  # noqa: E402
from ag.ag_policies.proactive_context_manager import ProactiveContextManager, ProactiveContextManagerConfig  # noqa: E402
from ag.ag_policies.proactive_context_manager.config import REMEMBER_MANY, REMEMBER_ONE  # noqa: E402
from ag.ag_harness.store import operations as store  # noqa: E402
from test_core import PREAMBLE, Base, ScriptedLLM, agent, call, conversation, output, user  # noqa: E402
from channels import ch, on  # noqa: E402


def opened(names, n):
    """The agent's own tool call reading `names`, and its output: what makes a file seen."""
    return [{"type": "function_call", "id": f"fco_{n}", "call_id": f"co{n}", "name": "exec_command",
             "arguments": json.dumps({"cmd": "cat " + names})},
            {"type": "function_call_output", "id": f"fcoo_{n}", "call_id": f"co{n}", "output": "..."}]


def developer(text, n):
    return {"type": "message", "role": "developer", "id": f"dev{n}",
            "content": [{"type": "input_text", "text": text}]}


class OutsideBase(Base):
    def setUp(self):
        super().setUp()
        self.llm = ScriptedLLM()
        self.cfg = ProactiveContextManagerConfig(min_context_tokens=0, build_every_request=True, require_smaller=False, sync_seconds=0,
                               message="@{stream} {author}: {text}", notice="Notice: {what} (at {timestamp}).",
                               notice_named="Notice: changed: {subjects}.", notice_counted="Notice: {count} changed.",
                               gatherer_guide="")
        self.policy = ProactiveContextManager(codex.FORMAT, self.llm, self.cfg)
        self.m = Manager(self.policy)
        self.wrapped = codex.CodexItems(self.m)
        self.wrapped.init("w")
        self.gatherer = "w"
        self.ids = {t.name: t.id for t in self.m.event_types("w")}

    def put(self, items, channel="c1"):
        for item in items:
            self.wrapped.insert("w", item, channel_id=channel)

    def post(self, text, ts, author="alice", stream="#analytics", channel="c1"):
        return self.m.insert("w", on(context_stream(self.ids["context_stream"], stream, author, text, ts), channel))

    def change(self, subject, ts, what=None, channel="c1"):
        return self.m.insert("w", on(environment_update(self.ids["environment_update"], subject,
                                                     what or f"File {subject} was changed on disk", ts, "files"), channel))

    def read(self, channel="c1"):
        return self.m.read("w", store.high_water(self.m._conn("w")), properties=ch(channel))

    def run_build(self, gatherer, channel_id):
        return self.policy.build(gatherer, ch(channel_id), tables.new_build(self.m._conn(gatherer), channel_id))

    def texts(self, context):
        return [codex.text(i) for i in context]

    def shown(self, context):
        return [t for t in self.texts(context) if t.startswith("@")]

    def notices(self, context):
        return [t for t in self.texts(context) if t.startswith("Notice:")]


class TypesTest(OutsideBase):
    def test_eight_types_the_two_outside_ones_then_reasoning(self):
        types = self.m.event_types("w")
        self.assertEqual([(t.name, t.id) for t in types][5:],
                         [("environment_update", 6), ("context_stream", 7), ("agent_reasoning", 8)])

    def test_the_events(self):
        e = environment_update(6, "a.py", "File a.py was changed on disk", 1700000000, "files")
        self.assertEqual((e.type_id, e.payload, e.id),
                         (6, {"subject": "a.py", "what": "File a.py was changed on disk", "timestamp": 1700000000,
                              "source": "files"}, "environment_update:files:a.py@1700000000"))
        e = context_stream(7, "#ops", "bob", "hi", 1700000000.5)
        self.assertEqual((e.type_id, e.payload, e.id),
                         (7, {"stream": "#ops", "author": "bob", "text": "hi", "timestamp": 1700000000.5},
                          "context_stream:#ops:1700000000.5"))
        self.assertIsNotNone(self.change("a.py", 1))
        self.assertIsNone(self.change("a.py", 1))              # seen twice: stored once
        self.assertIsNotNone(self.post("hi", 1))
        self.assertIsNone(self.post("hi", 1))

    def test_registered_and_ROLES(self):
        from ag.ag_harness.home import TEMPLATE                                  # the catalog names it
        self.assertIn('class = "ag.ag_policies.proactive_context_manager:ProactiveContextManager"', TEMPLATE)
        from ag.ag_policies.proactive_context_manager.events import CONTEXT_STREAM, ENVIRONMENT_UPDATE             # the policy's own
        self.assertEqual((ENVIRONMENT_UPDATE, CONTEXT_STREAM), ("environment_update", "context_stream"))


class StreamTest(OutsideBase):
    def test_a_message_is_shown_at_its_place(self):
        self.put(PREAMBLE + [user("what was Q2 revenue?", 1), agent("which region?", 1), user("just the number", 2)])
        self.post("APAC only this week", 10)                     # polled at the read, after the request
        context = self.read()
        texts = self.texts(context)
        self.assertEqual(texts[-3:], ["which region?", "just the number", "@#analytics alice: APAC only this week"])
        self.assertEqual((context[-1]["type"], context[-1]["name"]), ("ag", "context_stream"))
        self.assertFalse(any(isinstance(i, dict) and "stream" in i for i in context))
        conn = self.m._conn("w")
        last = store.last_read(conn, ch("c1"))
        made = [r.made_id for r in last["refs"] if r.made_id is not None]
        self.assertEqual([store.made_items(conn, made)[m][0] for m in made], ["context_stream"])

    def test_a_backlog_before_the_conversation_comes_first(self):
        self.post("morning", 1)
        self.put(PREAMBLE + [user("q", 1)])
        texts = self.texts(self.read())
        self.assertEqual(texts[len(PREAMBLE):], ["@#analytics alice: morning", "q"])

    def test_the_default_wording(self):
        self.cfg.message = ProactiveContextManagerConfig().message
        self.put(PREAMBLE + [user("q", 1)])
        self.post("hello", 1790284011.49)
        self.assertEqual(self.texts(self.read())[-1],
                         "Message in #analytics from alice at 2026-09-24 21:06:51 UTC: hello")


class NoticeTest(OutsideBase):
    def test_a_referenced_update_becomes_a_notice_at_its_place(self):
        self.put(PREAMBLE + [user("look at /w/a.py", 1)] + opened("/w/a.py", 1) + [agent("done", 1)])
        self.change("/w/a.py", 42)
        self.put([user("and now?", 2)])
        context = self.read()
        texts = self.texts(context)
        self.assertEqual(texts[-3:], ["done", "Notice: File /w/a.py was changed on disk (at 42).", "and now?"])
        self.assertEqual((context[-2]["type"], context[-2]["name"]), ("ag", "environment_update"))
        self.assertFalse(any(isinstance(i, dict) and "subject" in i for i in context))
        conn = self.m._conn("w")
        last = store.last_read(conn, ch("c1"))
        made = [r.made_id for r in last["refs"] if r.made_id is not None]
        self.assertEqual([store.made_items(conn, made)[m][0] for m in made], ["environment_update"])

    def test_an_unreferenced_update_adds_nothing(self):
        self.put(PREAMBLE + [user("look at /w/a.py", 1)] + opened("/w/a.py", 1) + [agent("ok", 1)])
        self.change("/w/other.py", 1)
        self.change("db-primary", 2, what="Service db-primary was restarted")
        context = self.read()
        self.assertEqual(self.notices(context), [])
        self.assertEqual(self.texts(context)[-1], "ok")

    def test_one_notice_per_poll_naming_what_changed(self):
        self.put(PREAMBLE + [user("edit /w/a.py; watch db-primary", 1)] + opened("/w/a.py db-primary", 1) + [agent("ok", 1)])
        self.change("/w/a.py", 10)
        self.change("db-primary", 11, what="Service db-primary was restarted")
        self.change("/w/a.py", 12)                                         # the same one again: named once
        self.assertEqual(self.notices(self.read()), ["Notice: changed: db-primary, /w/a.py."])

    def test_one_update_keeps_its_own_wording(self):
        self.put(PREAMBLE + [user("watch db-primary", 1)] + opened("db-primary", 1) + [agent("ok", 1)])
        self.change("db-primary", 11, what="Service db-primary was restarted")
        self.assertEqual(self.notices(self.read()), ["Notice: Service db-primary was restarted (at 11)."])

    def test_more_than_five_are_counted(self):
        names = [f"f{i}.py" for i in range(6)]
        self.put(PREAMBLE + [user("look at them", 1)] + opened(" ".join(names), 1) + [agent("ok", 1)])
        for i, name in enumerate(names[:5]):
            self.change(name, i)
        self.assertEqual(self.notices(self.read()), ["Notice: changed: f0.py, f1.py, f2.py, f3.py, f4.py."])
        self.put([user("and now?", 2)] + opened(" ".join(names), 2))      # read again: news again
        self.read()
        for i, name in enumerate(names):
            self.change(name, 10 + i)
        self.assertEqual(self.notices(self.read()), ["Notice: changed: f0.py, f1.py, f2.py, f3.py, f4.py.",
                                                     "Notice: 6 changed."])       # one per poll, in place

    def test_the_default_wordings_for_several(self):
        self.cfg.notice_named, self.cfg.notice_counted = ProactiveContextManagerConfig().notice_named, ProactiveContextManagerConfig().notice_counted
        self.cfg.notice_names = 1
        self.put(PREAMBLE + [user("look at a.py and b.py", 1)] + opened("a.py b.py", 1) + [agent("ok", 1)])
        self.change("a.py", 1)
        self.change("b.py", 2)
        self.assertEqual(self.texts(self.read())[-1],
                         "2 files in your working directory were changed on disk after you last read them. What you "
                         "read from them before is now out of date. Before giving any answer, or writing anything, "
                         "that relies on one of them, read it again." + REMEMBER_MANY)
        self.cfg.notice_names = 5
        self.assertEqual(self.texts(self.read())[-1],
                         "These files in your working directory were changed on disk after you last read them: a.py, "
                         "b.py. What you read from them before is now out of date. Before giving any answer, or "
                         "writing anything, that relies on their contents, read them again." + REMEMBER_MANY)

    def test_a_notice_is_news_once_and_history_after(self):
        """The loop this fixes: the notice used to come last on every read,
        asking for yet another read after the model had read the file again."""
        self.put(PREAMBLE + [user("read notes.txt", 1)] + opened("notes.txt", 1) + [agent("it says X", 1)])
        self.change("notes.txt", 5)
        first = self.texts(self.read())
        self.assertEqual(first[-1], "Notice: File notes.txt was changed on disk (at 5).")   # the news
        self.put([{"type": "function_call", "id": "fc9", "call_id": "c9", "name": "exec_command",
                   "arguments": '{"cmd": "cat notes.txt"}'},
                  {"type": "function_call_output", "id": "fco9", "call_id": "c9", "output": "Y"}])
        second = self.texts(self.read())
        self.assertEqual(second[:len(first)], first)                     # it stayed where it was
        self.assertEqual(self.notices(self.read()), ["Notice: File notes.txt was changed on disk (at 5)."])
        self.assertNotIn("Notice", second[-1])                           # the re-read is the latest thing

    def test_the_agent_s_own_write_is_no_notice(self):
        """A change found by the poll of the request that brought in a tool
        call naming the file happened while the agent's tools ran: its own."""
        self.put(PREAMBLE + [user("add a line to notes.txt", 1)])
        self.read()
        self.put([{"type": "function_call", "id": "fc9", "call_id": "c9", "name": "exec_command",
                   "arguments": '{"cmd": "echo z >> notes.txt"}'},
                  {"type": "function_call_output", "id": "fco9", "call_id": "c9", "output": ""}])
        self.change("notes.txt", 5)                                       # what that request's poll finds
        self.assertEqual(self.notices(self.read()), [])
        self.put([agent("done", 1), user("thanks", 2)])
        self.assertEqual(self.notices(self.read()), [])                  # nor later

    def test_a_change_while_the_agent_did_something_else_is_a_notice(self):
        self.put(PREAMBLE + [user("read notes.txt", 1)] + opened("notes.txt", 1) + [agent("ok", 1), user("now run the tests", 2)])
        self.read()
        self.put([{"type": "function_call", "id": "fc9", "call_id": "c9", "name": "exec_command",
                   "arguments": '{"cmd": "pytest"}'},
                  {"type": "function_call_output", "id": "fco9", "call_id": "c9", "output": "ok"}])
        self.change("notes.txt", 5)                                       # someone else, meanwhile
        self.assertEqual(self.notices(self.read()), ["Notice: File notes.txt was changed on disk (at 5)."])

    def test_an_earlier_tool_call_naming_the_file_does_not_hide_a_later_change(self):
        self.put(PREAMBLE + [user("q", 1), {"type": "function_call", "id": "fc8", "call_id": "c8",
                                             "name": "exec_command", "arguments": '{"cmd": "cat notes.txt"}'},
                             {"type": "function_call_output", "id": "fco8", "call_id": "c8", "output": "alpha"}])
        self.read()
        self.put([agent("it says alpha", 1)])
        self.change("notes.txt", 5)                                       # changed after, not by that call
        self.assertEqual(self.notices(self.read()), ["Notice: File notes.txt was changed on disk (at 5)."])

    def test_an_update_is_for_reads_in_its_directory(self):
        """The file poller names files relative to its directory: notes.txt
        in /b is not the notes.txt a read in /a has seen."""
        from dataclasses import replace
        self.put(PREAMBLE + [user("read notes.txt", 1)] + opened("notes.txt", 1) + [agent("ok", 1)])
        in_dir = lambda cwd, ts: self.m.insert("w", replace(                          # noqa: E731
            environment_update(self.ids["environment_update"], "notes.txt", "File notes.txt was changed on disk",
                               ts, "files"), properties={"cwd": cwd}))
        in_dir("/b", 1)
        read = lambda **p: self.m.read("w", store.high_water(self.m._conn("w")), properties=dict(ch("c1"), **p))  # noqa: E731
        self.assertEqual(self.notices(read(cwd="/a")), [])                          # another directory's
        self.assertEqual(self.notices(read(cwd="/b/")), ["Notice: File notes.txt was changed on disk (at 1)."])
        self.assertEqual(self.notices(read()), ["Notice: File notes.txt was changed on disk (at 1)."])   # no cwd: any

    def test_an_update_before_any_mention_is_no_notice(self):
        self.put(PREAMBLE + [user("q", 1), agent("ok", 1)])
        self.change("notes.txt", 1)
        self.put([user("now read notes.txt", 2)])                        # named only after it changed
        self.assertEqual(self.notices(self.read()), [])

    def test_the_default_wording(self):
        self.cfg.notice = ProactiveContextManagerConfig().notice
        self.put(PREAMBLE + [user("look at notes.txt", 1)] + opened("notes.txt", 1) + [agent("ok", 1)])
        self.change("notes.txt", 1790284011.49)
        self.assertEqual(self.texts(self.read())[-1],
                         "File notes.txt was changed on disk at 2026-09-24 21:06:51 UTC, after you last read it. What "
                         "you read from it before is now out of date. Before giving any answer, or writing anything, "
                         "that relies on its contents, read the file again." + REMEMBER_ONE)

    def test_the_match_is_the_subject_as_a_whole(self):
        from ag.ag_policies.proactive_context_manager.policy import mentions
        self.assertTrue(mentions("cat /w/notes.txt", "notes.txt"))
        self.assertFalse(mentions("open data.py", "a.py"))
        self.assertFalse(mentions("a.pyc is stale", "a.py"))
        self.put(PREAMBLE + [user("look at data.py", 1)] + opened("data.py", 1) + [agent("ok", 1)])
        self.change("a.py", 1)
        self.assertEqual(self.notices(self.read()), [])
        self.put([user("and a.py?", 2)] + opened("/w/a.py", 2))
        self.change("a.py", 2)
        self.assertEqual(self.notices(self.read()), ["Notice: File a.py was changed on disk (at 2)."])

    def test_only_the_agent_s_own_tool_calls_count_as_seeing_it(self):
        """build_ag: a session saw page.html only in `git status` output, and the user and a pinned
        instruction can name files the agent never opened: no notice for any of them."""
        self.put(PREAMBLE + conversation(2))
        self.put([developer("Always keep /w/rules.md in mind.", 1), user("what about notes.txt?", 3)])
        self.put([{"type": "function_call", "id": "fc8", "call_id": "c8", "name": "exec_command",
                   "arguments": '{"cmd": "git status --short"}'},
                  {"type": "function_call_output", "id": "fco8", "call_id": "c8", "output": " M ag/page.html"},
                  agent("notes.txt and ag/page.html", 3)])
        for name in ("/w/rules.md", "notes.txt", "ag/page.html"):
            self.change(name, 5)
        self.assertEqual(self.notices(self.read()), [])
        self.put(opened("ag/page.html", 4))
        self.change("ag/page.html", 6)
        self.assertEqual(self.notices(self.read()), ["Notice: File ag/page.html was changed on disk (at 6)."])

    def in_dir(self, subject, ts, cwd="/w/proj"):
        from dataclasses import replace
        return self.m.insert("w", replace(environment_update(
            self.ids["environment_update"], subject, f"File {subject} was changed on disk", ts, "files"),
            properties=dict(ch("c1"), cwd=cwd)))

    def test_an_absolute_path_counts_only_under_the_update_s_directory(self):
        """build_ag: the agent edited page.html in another worktree; the poller watched its own."""
        self.put(PREAMBLE + [user("q", 1)] + opened("/w/other/ag/page.html", 1) + [agent("ok", 1)])
        self.in_dir("ag/page.html", 1)
        self.assertEqual(self.notices(self.read()), [])
        self.put([user("and this one?", 2)] + opened("/w/proj/ag/page.html", 2))
        self.in_dir("ag/page.html", 2)
        self.assertEqual(self.notices(self.read()), ["Notice: File ag/page.html was changed on disk (at 2)."])

    def test_a_relative_path_is_the_file_itself(self):
        from ag.ag_policies.proactive_context_manager.policy import mentions
        self.assertTrue(mentions("cat ./a.py", "a.py", "/w"))
        self.assertTrue(mentions('Read({"file_path": "/w/a.py"})', "a.py", "/w"))
        self.assertTrue(mentions("cat /w/./src/a.py", "src/a.py", "/w/"))
        self.assertFalse(mentions("cat src/a.py", "a.py", "/w"))
        self.assertFalse(mentions("cat /x/a.py", "a.py", "/w"))
        self.assertTrue(mentions("cat src/a.py", "a.py"))                 # no directory known: as before
        self.assertTrue(mentions("cat a.py /x/a.py", "a.py", "/w"))
        self.assertFalse(mentions("cd /x && wc -l a.py", "a.py", "/w"))     # build_ag: another worktree's file
        self.assertFalse(mentions("cd src; cat a.py", "a.py", "/w"))
        self.assertTrue(mentions("cd /w && cat a.py", "a.py", "/w"))
        self.assertTrue(mentions('Bash({"command": "cd \\"/w\\" && cat a.py"})', "a.py", "/w"))
        self.assertTrue(mentions("cd /x && cat /w/a.py", "a.py", "/w"))

    def test_a_change_reported_late_is_still_the_agent_s_own(self):
        """making_ag: the session came back to /home/sep, whose poller had last looked minutes before,
        and it reported the agent's own Edit of a file under it -- made while it worked elsewhere."""
        import time
        for edit, expected in ((True, []), (False, ["Notice: File proj/a.py was changed on disk (at {})."])):
            with self.subTest(edit=edit):
                self.setUp()
                self.put(PREAMBLE + [user("fix /w/proj/a.py", 1)] + opened("/w/proj/a.py", 1))
                self.read()
                if edit:
                    self.put([{"type": "function_call", "id": "fe", "call_id": "ce", "name": "Edit",
                               "arguments": json.dumps({"file_path": "/w/proj/a.py", "old_string": "a", "new_string": "b"})},
                              {"type": "function_call_output", "id": "feo", "call_id": "ce", "output": "ok"}])
                when = time.time()                                       # the file changes here
                time.sleep(0.01)
                self.read()
                self.put([agent("done", 1), user("next", 2)])
                self.read()
                self.in_dir("proj/a.py", when, cwd="/w")                 # reported now, by /w's poller
                from ag.ag_policies.proactive_context_manager.policy import shown
                self.assertEqual(self.notices(self.read()), [e.format(shown(when)) for e in expected])

    def test_no_second_notice_until_the_agent_reads_it_again(self):
        self.put(PREAMBLE + [user("read notes.txt", 1)] + opened("notes.txt", 1) + [agent("X", 1)])
        self.change("notes.txt", 5)
        self.assertEqual(self.notices(self.read()), ["Notice: File notes.txt was changed on disk (at 5)."])
        self.put([agent("ok", 2), user("go on", 3)])
        self.change("notes.txt", 6)                                       # not read since: the notice stands
        self.assertEqual(self.notices(self.read()), ["Notice: File notes.txt was changed on disk (at 5)."])
        self.put(opened("notes.txt", 4))
        self.change("notes.txt", 7)                                       # read again, then changed: news
        self.assertEqual(self.notices(self.read()), ["Notice: File notes.txt was changed on disk (at 5).",
                                                     "Notice: File notes.txt was changed on disk (at 7)."])

    def test_after_a_build_only_what_is_left_counts(self):
        self.put(PREAMBLE + [user("read /w/a.py", 1)] + opened("/w/a.py", 1) + [agent("ok", 1)])
        self.change("/w/a.py", 1)
        self.put(conversation(12, start=2))
        self.run_build("w", "c1")
        self.put([user("next", 50)])
        self.change("/w/a.py", 2)                                         # its reading was condensed away
        self.assertEqual(self.notices(self.read()), [])
        self.put(opened("/w/a.py", 51))
        self.change("/w/a.py", 3)                                         # the earlier notice is gone: a first one
        self.assertEqual(self.notices(self.read()), ["Notice: File /w/a.py was changed on disk (at 3)."])

    def test_a_shown_message_does_not_count_as_a_reference(self):
        self.put(PREAMBLE + [user("q", 1), agent("ok", 1)])
        self.post("someone touched a.py", 1)                     # the stream names it; the conversation does not
        self.change("a.py", 2)
        context = self.read()
        self.assertEqual(self.shown(context), ["@#analytics alice: someone touched a.py"])
        self.assertEqual(self.notices(context), [])


class BothTest(OutsideBase):
    def test_messages_and_notices_in_place(self):
        self.put(PREAMBLE + [user("read notes.txt", 1)] + opened("notes.txt", 1) + [agent("it says X", 1)])
        self.post("the numbers changed, by the way", 10)
        self.change("notes.txt", 11)
        self.put([user("so what was it?", 2)])
        texts = self.texts(self.read())
        self.assertEqual(texts[-4:], ["it says X", "@#analytics alice: the numbers changed, by the way",
                                      "Notice: File notes.txt was changed on disk (at 11).", "so what was it?"])

    def test_each_context_extends_the_last(self):
        self.put(PREAMBLE + [user("q", 1)])
        self.post("first", 1)
        before = self.read()
        self.put([agent("a", 1), user("q2", 2)])
        self.post("second", 2)
        after = self.read()
        self.assertEqual(self.texts(after)[:len(before)], self.texts(before))   # a prefix: nothing moved
        self.assertEqual(self.texts(after)[len(before):], ["a", "q2", "@#analytics alice: second"])

    def test_remade_on_every_read_and_never_condensed(self):
        self.put(PREAMBLE + [user("read notes.txt", 1)] + opened("notes.txt", 1))
        self.post("hi", 1)
        self.change("notes.txt", 2)
        for _ in range(2):
            context = self.read()
            self.assertEqual((self.shown(context), self.notices(context)),
                             (["@#analytics alice: hi"], ["Notice: File notes.txt was changed on disk (at 2)."]))
        conn = self.m._conn("w")
        self.assertEqual(conn.execute("SELECT count(*) FROM _made_items").fetchone()[0], 2)   # the same text, kept once
        reads = [r for (r,) in conn.execute("SELECT read_id FROM _reads ORDER BY read_id")]
        made = [[m for _, m in store.read_items(conn, r) if m is not None] for r in reads]
        self.assertEqual(len(made[-1]), 2)
        self.assertEqual(made[-1], made[-2])                             # both reads name them


class AfterABuildTest(OutsideBase):
    def test_only_the_verbatim_part_is_looked_at(self):
        self.put(PREAMBLE + conversation(6))
        self.post("old", 1)                                      # will be condensed past
        self.change("/w/old.py", 1)
        self.put([user("open /w/old.py and /w/new.py", 7), agent("ok", 7)])
        self.put(conversation(5, start=8))
        self.run_build("w", "c1")
        self.put(opened("/w/old.py /w/new.py", 49) + [user("go on with /w/old.py and /w/new.py", 50)])
        self.post("new", 2)
        self.change("/w/new.py", 2)
        context = self.read()
        texts = self.texts(context)
        self.assertTrue(any(t.startswith("# Previous task") for t in texts))   # the build was adopted
        self.assertEqual(self.shown(context), ["@#analytics alice: new"])
        self.assertEqual(self.notices(context), ["Notice: File /w/new.py was changed on disk (at 2)."])
        build = tables.latest_build(self.m._conn("w"), "c1")
        conn = self.m._conn("w")
        self.assertLess(store.locate(conn, ch("c1"), "context_stream:#analytics:1"), build["open_from_row"])
        self.assertLess(store.locate(conn, ch("c1"), "environment_update:files:/w/old.py@1"), build["open_from_row"])

    def test_the_sections_are_reused_and_the_rest_remade(self):
        self.put(PREAMBLE + conversation(12))
        self.run_build("w", "c1")
        self.put([user("q about /w/a.py", 50)] + opened("/w/a.py", 50))
        first = self.read()
        self.post("later", 3)
        self.change("/w/a.py", 3)
        second = self.read()
        self.assertEqual([i for i in first if codex.text(i).startswith("# ")],
                         [i for i in second if codex.text(i).startswith("# ")])
        self.assertEqual((self.shown(first), self.notices(first)), ([], []))
        self.assertEqual((self.shown(second), self.notices(second)),
                         (["@#analytics alice: later"], ["Notice: File /w/a.py was changed on disk (at 3)."]))

    def test_outside_events_are_not_history_for_the_build(self):
        self.put(PREAMBLE + conversation(6))
        self.post("chatter", 1)
        self.change("secret.py", 1)
        self.put(conversation(6, start=7))
        self.run_build("w", "c1")
        sent = "\n".join(str(p) for p in self.llm.prompts)
        self.assertNotIn("chatter", sent)
        self.assertNotIn("secret.py", sent)


class CleaningLLM(ScriptedLLM):
    """Summarizes each task by cleaning its user messages: drops the "WRAP: " a template put in front."""

    def complete(self, prompt, *, system=None, model, effort, timeout, purpose):
        if purpose == "summarize":
            self.calls.append(purpose)
            self.prompts.append(prompt)
            turns = re.findall(r"^### turn (\d+)\nUSER: (.*)$", prompt, re.M)
            return json.dumps({"cleaned_user_messages": [{"turn": int(n), "text": t.replace("WRAP: ", "")}
                                                         for n, t in turns]})
        return super().complete(prompt, system=system, model=model, effort=effort, timeout=timeout, purpose=purpose)


class CleanedMessagesTest(OutsideBase):
    """The summarize call cleans a finished task's user messages; the sections show them cleaned,
    named by the original messages' row ids, and say so; the running task stays verbatim."""

    def setUp(self):
        super().setUp()
        self.llm = CleaningLLM()
        self.policy = ProactiveContextManager(codex.FORMAT, self.llm, self.cfg)
        self.m = Manager(self.policy)
        self.wrapped = codex.CodexItems(self.m)
        self.wrapped.init("w")

    def test_the_sections_show_the_cleaned_messages_by_their_original_ids(self):
        items = []
        for n in range(1, 13):
            items += [user(f"WRAP: question {n}", n), agent(f"answer {n}", n)]
        self.put(PREAMBLE + items)
        self.run_build("w", "c1")
        self.put([user("WRAP: the new one", 50)])
        context = self.read()
        sections = "\n".join(t for t in self.texts(context) if t.startswith("# "))
        conn = self.m._conn("w")
        row1 = store.locate(conn, ch("c1"), "u1")
        self.assertIn(f"[id {row1}] USER: question 1\n", sections)              # cleaned, under the original id
        self.assertNotIn("WRAP: question", sections)
        self.assertIn("PRUNED", sections)                                       # the overview says so
        self.assertIn("cleaned_messages", sections)
        self.assertEqual(self.texts(context)[-1], "WRAP: the new one")          # the running task: verbatim
        stored = dict(conn.execute("SELECT row_id, text FROM cleaned_messages").fetchall())
        self.assertEqual(stored[row1], "question 1")
        self.assertEqual(store.rows_by_id(conn, [row1])[row1].event_id, "u1")  # keyed by the original's row
        retention = [r for (r,) in conn.execute("SELECT retention_json FROM tasks")]
        self.assertTrue(retention and all("cleaned_user_messages" not in r for r in retention))

    def test_a_message_without_a_cleaned_text_is_shown_as_it_is(self):
        self.llm = ScriptedLLM()                                                # summaries clean nothing
        self.policy.llm = self.llm
        items = []
        for n in range(1, 13):
            items += [user(f"WRAP: question {n}", n), agent(f"answer {n}", n)]
        self.put(PREAMBLE + items)
        self.run_build("w", "c1")
        self.put([user("next", 50)])
        sections = "\n".join(t for t in self.texts(self.read()) if t.startswith("# "))
        self.assertIn("USER: WRAP: question 1\n", sections)
