"""Codex's own record of a thread, its rollout -- followed by ag's hook, what it says recorded as events
(harness_kit.codex's Rollout; ag's session_files.py, played here by followed.py) -- and what the dashboard makes of it: a turn over, interrupted or
stopped on an error where ag heard nothing; a question asked in its terminal, answered or dismissed there; one asked
as the turn goes on; the plan a Plan-mode turn proposed, which its terminal asks whether to implement; the subagents
and commands it left running -- and the keys that answer each from the page (answers.py), typed into the dashboard's
terminal (sessions.py's `answer`; a message sent while its plan is asked about, POST /api/send). The records' lines
are trimmed from codex 0.164's own, as it wrote them in live runs."""
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import unittest.mock
import urllib.error
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag.ag_harness.store import schema  # noqa: E402
from ag_dashboard import answers, data, files, server, sessions  # noqa: E402
from ag_dashboard import home as dashboard_home  # noqa: E402
from followed import Followed, schema as bare_db  # noqa: E402
from harness_kit import codex as codex_rules  # noqa: E402
from test_dashboard_sessions import SessionsBase  # noqa: E402

THREAD = "01a17625-344f-7ce2-8c1e-dd7931e0e2d3"
FRUIT = {"header": "Fruit", "id": "fruit", "question": "Which fruit do you prefer?",
         "options": [{"label": "Apple", "description": "Select Apple."}, {"label": "Pear", "description": "Select Pear."}]}
DRINK = {"header": "Drink", "id": "drink", "question": "Which drink do you prefer?",
         "options": [{"label": "Tea", "description": "Select Tea."}, {"label": "Coffee", "description": "Select Coffee."}]}


def stamp(at=None):
    return datetime.fromtimestamp(time.time() if at is None else at, timezone.utc).isoformat().replace("+00:00", "Z")


def gatherer_db(path):
    """A gatherer's database as ag makes it, its events kept by channel (`p_channel`)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    schema.create(conn)
    schema.add_properties(conn, ["channel", "answer_id"])
    conn.commit()
    return conn


def put(conn, channel, kind, payload, at=None, read=True):
    """An event of the channel's (and, `read`, a read that answered it); its type made if new."""
    conn.execute("INSERT OR IGNORE INTO event_types (name, created_at) VALUES (?, ?)", (kind, stamp()))
    tid = conn.execute("SELECT event_type_id FROM event_types WHERE name = ?", (kind,)).fetchone()[0]
    conn.execute("INSERT INTO events (inserted_at, event_id, event_type_id, payload_json, tokens, p_channel) VALUES (?, ?, ?, ?, 1, ?)",
                 (stamp(at), f"e{time.time_ns()}", tid, json.dumps(payload), channel))
    if read:
        conn.execute("INSERT INTO _reads (read_at, row_id, p_channel) VALUES (?, last_insert_rowid(), ?)", (stamp(at), channel))
    conn.commit()


def called(conn, channel, at=None):
    """A codex call of the channel, as its hook records it (`model_call`): which harness the channel runs on."""
    put(conn, channel, "model_call", {"kind": "turn", "harness": "codex", "version": "0.164.0"}, at, read=False)


def pending(conn, channel, kind, payload, at=None):
    """The channel's answer no call has carried back, this one event of it, as ag's hook records it: its part
    (`reply_part`) and its end (`reply_end`, codex's `completed`) -- a new answer each time."""
    answer = f"resp_{time.time_ns()}"
    for typ, got in (("reply_part", {"type": kind, "payload": payload}), ("reply_end", {"stop": "completed"})):
        conn.execute("INSERT OR IGNORE INTO event_types (name, created_at) VALUES (?, ?)", (typ, stamp()))
        conn.execute("INSERT INTO events (inserted_at, event_id, event_type_id, payload_json, tokens, p_channel, p_answer_id) "
                     "VALUES (?, ?, (SELECT event_type_id FROM event_types WHERE name = ?), ?, 1, ?, ?)",
                     (stamp(at), f"{answer}:{typ}", typ, json.dumps(got), channel, answer))
    conn.commit()


def line(kind, payload, at=None):
    return {"timestamp": stamp(at), "type": kind, "payload": payload}


def started(turn, mode="default", at=None):
    return line("event_msg", {"type": "task_started", "turn_id": turn, "collaboration_mode_kind": mode}, at)


def complete(turn, error=None, at=None):
    return line("event_msg", {"type": "task_complete", "turn_id": turn, "last_agent_message": None if error else "done",
                              **({"error": error} if error else {})}, at)


def aborted(turn, at=None):
    return line("event_msg", {"type": "turn_aborted", "turn_id": turn, "reason": "interrupted"}, at)


def asked(call, questions, name=codex_rules.ASK, at=None):
    return line("response_item", {"type": "function_call", "status": "completed", "name": name, "call_id": call,
                                  "arguments": json.dumps({"questions": questions})}, at)


def output(call, text, at=None):
    return line("response_item", {"type": "function_call_output", "call_id": call, "output": text}, at)


def user(text, at=None):
    return line("response_item", {"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]}, at)


def item(turn, it, at=None):
    return line("event_msg", {"type": "item_completed", "thread_id": THREAD, "turn_id": turn, "item": it}, at)


class RolloutBase(unittest.TestCase):
    """A CODEX_HOME of the test's own, with the thread's record in it -- each line written followed into a gatherer's
    database (`db`), as the hook records them."""
    db = None

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.codex = os.path.join(self.tmp.name, "codex")
        env = unittest.mock.patch.dict(os.environ, {"CODEX_HOME": self.codex})
        env.start()
        self.addCleanup(env.stop)
        self.path = self.record_for(THREAD)
        self.followed = Followed("codex", self.path)
        if self.db is None:
            self.db = bare_db(sqlite3.connect(":memory:"))
            self.addCleanup(self.db.close)

    def record_for(self, thread):
        d = os.path.join(self.codex, "sessions", "2026", "10", "25")
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, f"rollout-2026-10-25T19-58-32-{thread}.jsonl")
        open(path, "a").close()
        return path

    def write(self, *lines, path=None):
        with open(path or self.path, "a") as fh:
            for x in lines:
                fh.write(json.dumps(x, separators=(",", ":")) + "\n")
        if path in (None, self.path):
            self.followed.into(self.db, THREAD)

    def rec(self):
        return data.record_of(self.db, THREAD)

    def tasks(self, kind):
        return [(t["id"], t["label"]) for t in self.rec().tasks() if t["kind"] == kind]


class RecordTest(RolloutBase):
    def test_found_by_the_thread_alone_and_none_for_another(self):
        self.assertEqual(codex_rules.record_path(THREAD), self.path)
        self.assertIsNone(codex_rules.record_path("01a17625-0000-0000-0000-000000000000"))

    def test_a_turn_over_interrupted_or_given_up(self):
        t0 = time.time() - 60
        self.write(started("t1", at=t0))
        self.assertIsNone(self.rec().stopped(None))                 # it goes on
        self.write(complete("t1", at=t0 + 5))
        self.assertEqual(self.rec().stopped(t0)["kind"], "over")
        self.assertIsNone(self.rec().stopped(t0 + 10))              # ended before ag last heard of it
        self.write(started("t2", at=t0 + 20), aborted("t2", at=t0 + 25))
        self.assertEqual(self.rec().stopped(t0 + 20)["kind"], "interrupted")
        self.write(started("t3", at=t0 + 30), complete("t3", at=t0 + 40, error={
            "message": "unexpected status 502 Bad Gateway: ag's hook server got no answer",
            "codex_error_info": {"http_connection_failed": {"http_status_code": 502}}}))
        got = self.rec().stopped(t0 + 30)
        self.assertEqual((got["kind"], got["status"], got["text"][:22]), ("error", 502, "unexpected status 502 "))

    def test_a_question_answered_or_dismissed_in_its_terminal(self):
        self.write(started("t1", "plan"), asked("c1", [FRUIT]))
        self.assertIsNone(self.rec().settled("c1"))
        self.write(output("c1", '{"answers":{"fruit":{"answers":["Pear"]}}}'))
        self.assertEqual(self.rec().settled("c1"), "answered")
        self.assertEqual(self.rec().result("c1"), '{"answers":{"fruit":{"answers":["Pear"]}}}')
        self.write(asked("c2", [DRINK]), output("c2", "aborted by user after 13.4s"), aborted("t1"))
        self.assertEqual(self.rec().settled("c2"), "dismissed")
        self.write(started("t2", "plan"), asked("c3", [DRINK]), aborted("t2"))   # its turn ended with no output
        self.assertEqual(self.rec().settled("c3"), "dismissed")
        self.assertIsNone(self.rec().settled("c-unknown"))

    def test_a_question_asked_as_it_works_until_replied_to_or_its_turn_ends(self):
        self.write(started("t1"), asked("a1", [{"title": "Fruit preference", "options": ["Apple", "Pear"]},
                                               {"title": "Drink preference", "options": ["Tea", "Coffee"]}], codex_rules.ASK_ASYNC),
                   output("a1", '{"accepted":true}'))
        got = self.rec().open_question()
        self.assertEqual((got["call"], len(got["questions"])), ("a1", 2))
        self.assertIsNone(self.rec().result("a1"))                  # accepted is no answer
        self.write(user(codex_rules.REPLY + '\n[{"answer":"mango please","question":"Fruit preference","questionItemId":'
                        '"[\\"request_user_input_async\\",\\"a1\\",0]"}]\n</send_user_message_question_reply>'))
        self.assertEqual(self.rec().open_question()["call"], "a1")   # the second, skipped: still open
        self.write(complete("t1"))
        self.assertIsNone(self.rec().open_question())                 # its turn over: no longer answerable
        self.write(started("t2"), asked("a2", [{"title": "Fruit preference", "options": ["Apple", "Pear"]}], codex_rules.ASK_ASYNC))
        self.write(user(codex_rules.REPLY + '\n[{"answer":"Pear","question":"Fruit preference","questionItemId":'
                        '"[\\"request_user_input_async\\",\\"a2\\",0]"}]\n</send_user_message_question_reply>'))
        self.assertIsNone(self.rec().open_question())                 # every question replied to
        self.assertIn('"answer":"Pear"', self.rec().result("a2"))

    def test_a_proposed_plan_until_the_next_turn_and_what_that_opened_with(self):
        self.write(started("t1", "plan"), item("t1", {"type": "Plan", "text": "1. Create hello.txt.\n"}))
        self.assertIsNone(self.rec().offer())                          # not until its turn completes
        self.write(complete("t1"))
        self.assertEqual(self.rec().offer()["text"], "1. Create hello.txt.\n")
        self.write(started("t2"), line("response_item", {"type": "message", "role": "developer",
                                                         "content": [{"type": "input_text", "text": "<collaboration_mode>"}]}),
                   user("<environment_context>"), user("Implement the plan."))
        self.assertIsNone(self.rec().offer())
        self.assertEqual(self.rec().result("plan:t1"), "Implement the plan.")
        self.write(started("t3", "plan"), aborted("t3"))
        self.assertIsNone(self.rec().offer())                          # no plan in it: none asked about

    def test_subagents_and_commands_left_running_until_they_end(self):
        self.write(started("t1"),
                   item("t1", {"type": "SubAgentActivity", "kind": "started", "agent_thread_id": "sub1", "agent_path": "/root/sleep_then_ok"}),
                   line("response_item", {"type": "custom_tool_call", "name": "exec", "call_id": "x1",
                                          "input": 'const r = await tools.exec_command({cmd:"sleep 50; echo bgdone > bg.txt",yield_time_ms:250});'}),
                   line("response_item", {"type": "custom_tool_call_output", "call_id": "x1", "output": [
                       {"type": "input_text", "text": "Script completed\nOutput:\n"},
                       {"type": "input_text", "text": '{"chunk_id":"eb9cd7","session_id":36309,"output":""}'}]}),
                   line("response_item", {"type": "custom_tool_call", "name": "exec", "call_id": "x2",
                                          "input": 'await tools.exec_command({cmd:"ls"});'}),
                   line("response_item", {"type": "custom_tool_call_output", "call_id": "x2", "output": [
                       {"type": "input_text", "text": '{"session_id":555,"exit_code":0,"output":"a"}'}]}),   # done at once
                   complete("t1"))
        self.assertEqual(self.tasks("agent"), [("sub1", "/root/sleep_then_ok")])
        self.assertEqual(self.tasks("command"), [("36309", "sleep 50; echo bgdone > bg.txt")])
        self.write(item("t1", {"type": "SubAgentActivity", "kind": "completed", "agent_thread_id": "sub1"}),
                   item("t1", {"type": "CommandExecution", "process_id": "36309", "status": "completed", "exit_code": 0}))
        self.assertEqual(self.rec().tasks(), [])


def codex_ask(*questions, asynchronous=False):
    return data.ask_view({"kind": "question", "call": "call_1", "at": time.time() - 5, "questions": list(questions),
                          "async": asynchronous}, "codex")


CODEX_PLAN = {"kind": "plan", "harness": "codex", "call": "plan:t1", "at": time.time() - 5, "plan": "1. Do it"}


class KeysTest(unittest.TestCase):
    """The keys, as typed live into codex 0.164's dialogs -- and what it then recorded (its words, from those runs)."""

    def test_an_option_by_its_number_and_one_s_own_words_as_a_note_on_none_of_the_above(self):
        choice = {"answers": [{"options": [1]}, {"text": "green tea"}]}
        a = codex_ask(FRUIT, DRINK)
        self.assertEqual(answers.keys(a, choice), ["2", "\x1b[B", "\x1b[B", "\t", "green tea", "\r"])
        self.assertEqual(answers.expected(a, choice), ['"Pear"', '"user_note: green tea"'])
        self.assertTrue(answers.recorded('{"answers":{"drink":{"answers":["None of the above","user_note: green tea"]},'
                                         '"fruit":{"answers":["Pear"]}}}', answers.expected(a, choice)))
        self.assertFalse(answers.recorded('{"answers":{"fruit":{"answers":["Apple"]}}}', answers.expected(codex_ask(FRUIT), {"answers": [{"options": [1]}]})))
        self.assertEqual(answers.summary(a, choice), "Which fruit do you prefer? → Pear · Which drink do you prefer? → green tea")

    def test_one_asked_as_it_works_opened_first_and_each_sent_with_enter(self):
        a = codex_ask({"title": "Fruit preference", "options": ["Apple", "Pear"]},
                      {"title": "Drink preference", "options": ["Tea", "Coffee"]}, asynchronous=True)
        choice = {"answers": [{"text": "mango please"}, {"options": [0]}]}
        self.assertEqual(answers.keys(a, choice), ["\x1b[1;2D", "3", "mango please", "\r", "1", "\r"])
        self.assertEqual(answers.expected(a, choice), ['"answer":"mango please"', '"answer":"Tea"'])

    def test_a_plan_implemented_or_planned_on(self):
        self.assertEqual(answers.keys(CODEX_PLAN, {"plan": "implement"}), ["1"])
        self.assertEqual(answers.keys(CODEX_PLAN, {"plan": "change", "text": " say goodbye "}), ["3", "say goodbye", "\r"])
        self.assertEqual(answers.expected(CODEX_PLAN, {"plan": "implement"}), ["Implement the plan."])
        self.assertEqual(answers.summary(CODEX_PLAN, {"plan": "implement"}), "Implement the plan")
        for choice in ({"plan": "auto"}, {"plan": "manual"}, {"plan": "change", "text": ""}, {"plan": "change", "text": "a\nb"}):
            with self.assertRaises(answers.AnswerError, msg=choice):         # Claude Code's choices are not codex's
                answers.keys(CODEX_PLAN, choice)


class StatusBase(RolloutBase):
    """Gatherer `g` holding a codex thread's events, its pending answer, and the thread's record, followed into it."""

    def setUp(self):
        self.tmp_home = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp_home.cleanup)
        self.saved, dashboard_home.HOME = dashboard_home.HOME, os.path.join(self.tmp_home.name, "ag")
        self.addCleanup(setattr, dashboard_home, "HOME", self.saved)
        os.makedirs(os.path.join(dashboard_home.HOME, "gatherers", "g"))
        self.conn = self.db = gatherer_db(os.path.join(dashboard_home.HOME, "gatherers", "g", "context.db"))
        self.addCleanup(self.conn.close)
        super().setUp()
        called(self.conn, THREAD, at=time.time() - 121)
        put(self.conn, THREAD, "user_message", {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "ask me"}]},
            at=time.time() - 120)

    def pend(self, kind, payload, at=None):
        pending(self.conn, THREAD, kind, payload, at)

    def actor(self, started=()):
        return next(a for g in data.home(list(started))["gatherers"] for a in g["agents"] if a["channel"] == THREAD)


class StatusTest(StatusBase):
    def test_a_question_waits_for_them_until_its_record_says_answered_or_dismissed(self):
        self.write(started("t1", "plan"), asked("call_q", [FRUIT]))
        self.pend("tool_call", {"type": "function_call", "name": "request_user_input", "call_id": "call_q",
                                "arguments": json.dumps({"questions": [FRUIT]})})
        a = self.actor()
        self.assertEqual((a["harness"], a["status"], a["asking"]["harness"], a["asking"]["call"]), ("codex", data.ASKING, "codex", "call_q"))
        self.assertEqual(a["asking"]["questions"][0]["options"][1], {"label": "Pear", "description": "Select Pear."})
        self.assertEqual(data.asking_of("g", THREAD)["call"], "call_q")
        self.write(output("call_q", '{"answers":{"fruit":{"answers":["Pear"]}}}'))
        self.assertEqual((self.actor()["status"], self.actor()["asking"]), (data.RUNNING, None))    # answered: it goes on
        self.write(started("t2", "plan"), asked("call_r", [DRINK]))
        self.pend("tool_call", {"type": "function_call", "name": "request_user_input", "call_id": "call_r",
                                "arguments": json.dumps({"questions": [DRINK]})})
        self.assertEqual(self.actor()["status"], data.ASKING)
        self.write(output("call_r", "aborted by user after 3.0s"), aborted("t2"))
        a = self.actor()
        self.assertEqual((a["status"], a["turn_over"], a["asking"], a["stopped"]["kind"]), (data.IDLE, True, None, "interrupted"))
        self.assertIsNone(data.asking_of("g", THREAD))

    def test_a_turn_given_up_on_is_an_error_at_once_and_one_completed_is_over(self):
        t0 = time.time() - 30
        self.write(started("t1", at=t0))
        self.pend("tool_call", {"type": "function_call", "name": "exec", "call_id": "x"}, at=t0 + 1)
        self.assertEqual(self.actor()["status"], data.RUNNING)
        self.write(complete("t1", at=t0 + 20, error={"message": "stream disconnected before completion",
                                                      "codex_error_info": {"response_stream_disconnected": {"http_status_code": 500}}}))
        a = self.actor()
        self.assertEqual((a["status"], a["stopped"]["status"], a["stopped"]["text"]), (data.ERROR, 500, "stream disconnected before completion"))
        self.write(started("t2", at=t0 + 22), complete("t2", at=t0 + 25))
        self.pend("tool_call", {"type": "function_call", "name": "exec", "call_id": "y"}, at=t0 + 23)
        self.assertEqual((self.actor()["status"], self.actor()["stopped"]), (data.IDLE, None))

    def test_a_question_asked_as_it_works_is_shown_while_it_runs(self):
        self.write(started("t1"), asked("a1", [{"title": "Fruit preference", "options": ["Apple", "Pear"]}], codex_rules.ASK_ASYNC))
        self.pend("tool_call", {"type": "function_call", "name": "sleep", "call_id": "z"})
        a = self.actor()
        self.assertEqual((a["status"], a["asking"]["async"], a["asking"]["questions"][0]["question"]), (data.RUNNING, True, "Fruit preference"))

    def test_what_it_left_running_keeps_it_in_the_background(self):
        self.write(started("t1"), item("t1", {"type": "SubAgentActivity", "kind": "started", "agent_thread_id": "sub1",
                                              "agent_path": "/root/sleep_then_ok"}), complete("t1"))
        self.pend("agent_message", {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "started"}]})
        a = self.actor()
        self.assertEqual((a["status"], [(t["kind"], t["label"]) for t in a["background"]]), (data.BACKGROUND, [("agent", "/root/sleep_then_ok")]))
        self.write(item("t1", {"type": "SubAgentActivity", "kind": "completed", "agent_thread_id": "sub1"}))
        self.assertEqual((self.actor()["status"], self.actor()["background"]), (data.IDLE, []))

    def test_a_proposed_plan_is_asked_about_only_where_the_dashboard_s_terminal_asks_it(self):
        t0 = time.time() - 60
        self.write(started("t1", "plan", at=t0), item("t1", {"type": "Plan", "text": "1. Create hello.txt."}, at=t0 + 2),
                   complete("t1", at=t0 + 3))
        self.pend("agent_message", {"type": "message", "role": "assistant", "content": [
            {"type": "output_text", "text": "<proposed_plan>\n1. Create hello.txt.\n</proposed_plan>"}]}, at=t0 + 2)
        self.assertEqual((self.actor()["status"], self.actor()["asking"]), (data.IDLE, None))   # no terminal of the dashboard's
        self.assertEqual(data.asking_of("g", THREAD)["call"], "plan:t1")
        row = {"session_id": THREAD, "gatherer": "g", "cwd": "/w", "harness": "codex", "status": "terminal", "terminal": True,
               "since": t0 - 100, "typed": t0 - 50, "pid": 42, "created_at": stamp(t0 - 100), "kept": 0, "ended": 0}
        a = self.actor([row])
        self.assertEqual((a["status"], a["asking"]["kind"], a["asking"]["plan"]), (data.ASKING, "plan", "1. Create hello.txt."))
        self.assertEqual(self.actor([dict(row, typed=t0 + 10)])["status"], data.IDLE)       # keys since: Esc, perhaps
        self.assertEqual(self.actor([dict(row, since=t0 + 10)])["status"], data.IDLE)       # opened since: not asked there
        self.write(started("t2", at=t0 + 30), user("Implement the plan.", at=t0 + 30))
        self.assertIsNone(self.actor([row])["asking"])


class TurnsTest(StatusBase):
    """The Chat view's turns (files.py): codex's answers to what it asked as it worked are the user's, sent while the turn
    that asked runs -- part of it, as a message Claude Code sends mid-turn is, not turns of their own."""

    def test_its_answers_as_it_works_are_part_of_the_turn_that_asked(self):
        said = lambda role, text: {"type": "message", "role": role, "content": [
            {"type": "input_text" if role == "user" else "output_text", "text": text}]}
        replies = [codex_rules.REPLY + '\n[{"answer":"' + a + '","question":"' + q + '","questionItemId":'
                   '"[\\"request_user_input_async\\",\\"a1\\",' + str(i) + ']"}]\n</send_user_message_question_reply>'
                   for i, (q, a) in enumerate((("Which fruit?", "mango please"), ("Which drink?", "Coffee")))]
        put(self.conn, THREAD, "agent_message", said("assistant", "Asked; waiting."))
        for r in replies:
            self.assertTrue(codex_rules.replies(r))
            put(self.conn, THREAD, "user_message", said("user", r))
        put(self.conn, THREAD, "agent_message", said("assistant", "Mango and coffee."))
        put(self.conn, THREAD, "user_message", said("user", "thanks"))
        got = files.files("g", THREAD)
        self.assertEqual([t["text"] for t in got["turns"]], ["ask me", "thanks"])
        self.assertEqual([m["text"] for m in got["turns"][0]["more"]],                # as the answers they are
                         ["Which fruit? → mango please", "Which drink? → Coffee"])
        self.assertEqual({m["kind"] for m in got["turns"][0]["more"]}, {"ask_reply"})
        self.assertFalse(codex_rules.replies("ask me"))

    def test_each_subagent_s_report_under_the_turn_that_started_it(self):
        """codex hands a subagent's report back as another agent's message (FINAL_ANSWER), with whatever call comes
        next -- perhaps a later turn's, perhaps none yet: until then its own record has what it answered."""
        said = lambda role, text: {"type": "message", "role": role, "content": [
            {"type": "input_text" if role == "user" else "output_text", "text": text}]}
        spawn = lambda call, name: {"type": "function_call", "name": "spawn_agent", "namespace": "collaboration", "call_id": call,
                                    "arguments": json.dumps({"task_name": name, "fork_turns": "all", "message": "gAAAAABq3t3y"})}
        report = lambda sender, text, kind="FINAL_ANSWER": {
            "type": "agent_message", "author": sender, "recipient": "/root",
            "content": [{"type": "input_text", "text": f"Message Type: {kind}\nTask name: /root\nSender: {sender}\nPayload:\n{text}"}]}
        put(self.conn, THREAD, "tool_call", spawn("c1", "count_a"))
        put(self.conn, THREAD, "tool_output", {"type": "function_call_output", "call_id": "c1", "output": '{"task_name":"/root/count_a"}'})
        put(self.conn, THREAD, "tool_call", spawn("c2", "count_b"))
        put(self.conn, THREAD, "tool_output", {"type": "function_call_output", "call_id": "c2", "output": '{"task_name":"/root/count_b"}'})
        put(self.conn, THREAD, "agent_message", said("assistant", "Started two subagents."))
        put(self.conn, THREAD, "user_message", said("user", "and now?"))
        put(self.conn, THREAD, "context", report("/root/count_a", "1, 2, 3"))           # handed back with this turn's call
        put(self.conn, THREAD, "context", report("/root/count_a", "", "MESSAGE"))       # its words encrypted: nothing to show
        put(self.conn, THREAD, "agent_message", said("assistant", "One is done."))
        sub = "01a17693-0439-7fb2-8a7b-42fbf610de7d"                                  # count_b: ended, not handed back yet
        self.write(started("s1"), line("event_msg", {"type": "task_complete", "turn_id": "s1", "last_agent_message": "1, 2, 3, 4"}),
                   path=self.record_for(sub))                                         # its own record, its turn over
        self.write(started("t1"), item("t1", {"type": "SubAgentActivity", "kind": "started", "agent_thread_id": sub,
                                              "agent_path": "/root/count_b"}),
                   item("t1", {"type": "SubAgentActivity", "kind": "completed", "agent_thread_id": sub}))
        got = files.files("g", THREAD)
        self.assertEqual([t["text"] for t in got["turns"]], ["ask me", "and now?"])
        first = [(r["kind"], r.get("name"), r.get("text")) for r in got["turns"][0]["replies"]]
        self.assertEqual(first, [("text", None, "Started two subagents."), ("report", "count_a", "1, 2, 3"),
                                 ("report", "count_b", "1, 2, 3, 4")])
        self.assertEqual([r["text"] for r in got["turns"][1]["replies"]], ["One is done."])
        self.assertEqual([c["text"] for c in files.files("g", THREAD, turn=0)["commands"]], ["Agent count_a", "Agent count_b"])
        note = data.parts("agent_message", json.dumps(report("/root/x", "done")), None, harness="codex")   # stored before codex's were context
        self.assertEqual([p["kind"] for p in note], ["note"])


class TypedTest(SessionsBase):
    """The keys typed into the dashboard's codex terminal (the fake ag echoes each read)."""

    def test_refused_where_its_terminal_opened_after_it_asked(self):
        sid = self.s.create("g", self.work, harness="codex")["session_id"]
        self.s.terminal(sid, 100, 30)
        self.until(lambda: "fake terminal" in self.s.output(sid, -1)[0].decode("utf-8", "replace"))
        with self.assertRaisesRegex(sessions.SessionError, "opened after it asked"):
            self.s.answer(sid, dict(CODEX_PLAN, at=time.time() - 60), {"plan": "implement"})
        self.s.answer(sid, dict(CODEX_PLAN, at=time.time()), {"plan": "implement"})
        self.until(lambda: [x["typed"] for x in self.logged() if "typed" in x] == ["1"])


@unittest.skipUnless(sessions.TERMINALS, "a terminal needs a Unix pseudo-terminal")
class SendTest(SessionsBase, RolloutBase):
    """A message from any view while codex's terminal asks: what to change of a plan, or refused for a question."""

    def setUp(self):
        RolloutBase.setUp(self)
        SessionsBase.setUp(self)
        self.addCleanup(SessionsBase.tearDown, self)
        self.httpd = server.serve("127.0.0.1", 0)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"

    def tearDown(self):
        pass                                          # SessionsBase's, as a cleanup: after the server's

    def post(self, path, body):
        req = urllib.request.Request(self.url + path, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as exc:
            return exc.code, json.load(exc)

    def typed(self):
        return [x["typed"] for x in self.logged() if "typed" in x]

    def gatherer(self, sid, answer):
        conn = gatherer_db(os.path.join(dashboard_home.HOME, "gatherers", "g", "context.db"))
        called(conn, sid)
        put(conn, sid, "user_message", {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hi"}]})
        pending(conn, sid, *answer)
        Followed("codex", self.record_for(sid)).into(conn, sid)       # its record, as the hook follows it
        conn.close()

    def test_a_message_while_its_plan_is_asked_about_is_what_to_change(self):
        sid = self.post("/api/sessions", {"gatherer": "g", "cwd": self.work, "harness": "codex"})[1]["session_id"]
        self.post("/api/terminal", {"session_id": sid, "cols": 100, "rows": 30})
        self.until(lambda: os.path.exists(self.log) and self.logged())
        time.sleep(0.3)
        path = self.record_for(sid)
        self.write(started("t1", "plan"), item("t1", {"type": "Plan", "text": "1. Do it"}), complete("t1"), path=path)
        self.gatherer(sid, ("agent_message", {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "plan"}]}))
        code, got = self.post("/api/send", {"session_id": sid, "text": "make step 2\nsay goodbye"})
        self.assertEqual(code, 200, got)
        self.until(lambda: self.typed() == ["3", "make step 2 say goodbye", "\r"])          # "No, stay in Plan mode" first

    def test_a_message_while_it_waits_on_a_question_there_is_refused(self):
        sid = self.post("/api/sessions", {"gatherer": "g", "cwd": self.work, "harness": "codex"})[1]["session_id"]
        self.post("/api/terminal", {"session_id": sid, "cols": 100, "rows": 30})
        self.until(lambda: os.path.exists(self.log) and self.logged())
        time.sleep(0.3)
        self.write(started("t1", "plan"), asked("q", [FRUIT]), path=self.record_for(sid))   # codex's rollout: it asks
        self.gatherer(sid, ("tool_call", {"type": "function_call", "name": "request_user_input", "call_id": "q",
                                          "arguments": json.dumps({"questions": [FRUIT]})}))
        code, got = self.post("/api/send", {"session_id": sid, "text": "2 more things"})
        self.assertEqual((code, "waits on its question" in got.get("error", "")), (400, True))
        time.sleep(0.3)
        self.assertEqual(self.typed(), [])                                                  # nothing typed into its dialog


if __name__ == "__main__":
    unittest.main()
