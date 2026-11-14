"""What the user writes to Claude Code while it works (data.py's `typed` and `meanwhile`): read from the queue Claude
Code writes to its own record of the session the moment it changes -- which ag's hook follows, recording what it says
as events (harness_kit.claude's Record; ag's session_files.py, played here by followed.py) -- long before ag stores the
message with the turn's next call; and in the Chat view, part of the turn it was written in."""
import json
import os
import sqlite3
import sys
import tempfile
import time
import unittest
import unittest.mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag_dashboard import data, files  # noqa: E402
from ag_dashboard import home as dashboard_home  # noqa: E402
from followed import Followed, insert, schema  # noqa: E402
from harness_kit import claude as claude_rules  # noqa: E402
from harness_kit.base import Follower, follow  # noqa: E402
from test_dashboard_files import asked, call, note, result, said  # noqa: E402

SESSION = "0e1d2c3b-0000-4000-8000-000000000002"


def stamp(seconds):
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(seconds)) + f".{int(seconds * 1000) % 1000:03d}Z"


def wrapped(text):
    """A message sent mid-turn, as Claude Code wraps it for the model."""
    return ("The user sent a new message while you were working:\n" + text + "\n\nThis is how Claude Code surfaces "
            "messages the user sends mid-turn — within the running turn, often alongside the next tool result, rather "
            "than as a separate conversation turn. Address the message above as you continue this turn.")


class RecordBase(unittest.TestCase):
    """A Claude Code config folder of the test's own, with the session's record in it, followed into a gatherer's
    database (`follow`)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.config = os.path.join(self.tmp.name, "claude-config")
        env = unittest.mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": self.config})
        env.start()
        self.addCleanup(env.stop)
        self.record = os.path.join(self.config, "projects", "-work-repo", f"{SESSION}.jsonl")
        os.makedirs(os.path.dirname(self.record))
        self.now = time.time()
        self.write({"type": "user", "message": {"role": "user", "content": "start"}})
        self.db = schema(sqlite3.connect(":memory:"))
        self.addCleanup(self.db.close)
        self.followed = Followed("claude", self.record)

    def follow(self, conn=None):
        """What the record says since, recorded as the hook records it."""
        self.followed.into(conn or self.db, SESSION)

    def write(self, line, end="\n"):
        with open(self.record, "a") as fh:
            fh.write(json.dumps(line) + end)

    def prompt(self, text, ago=0.0, origin="human", **more):
        """A user line as Claude Code records a message as it sends it (`origin` None: one with none, a "!" command's)."""
        line = {"type": "user", "message": {"role": "user", "content": text}, "timestamp": stamp(self.now - ago),
                "sessionId": SESSION, "promptId": "p1"}
        if origin is not None:
            line["origin"] = {"kind": origin}
        self.write({**line, **more})

    def op(self, operation, text=None, ago=0.0, **more):
        line = {"type": "queue-operation", "operation": operation, "timestamp": stamp(self.now - ago), "sessionId": SESSION}
        if text is not None:
            line["content"] = text
        self.write({**line, **more})


class TypedTest(RecordBase):
    def got(self):
        self.follow()
        return data.typed(self.db, SESSION, now=self.now)

    def typed(self):
        return [(q["text"], q["sent"] is not None) for q in self.got()]

    def test_written_then_sent_mid_turn(self):
        self.assertEqual(self.typed(), [])
        self.op("enqueue", "also do b", ago=5)
        self.assertEqual(self.typed(), [("also do b", False)])            # waiting for the turn's next step
        self.op("remove", "also do b", ago=2, reason="absorbed_mid_turn")
        self.assertEqual(self.typed(), [("also do b", True)])             # sent: ag stores it with that call
        self.assertEqual(claude_rules.record_path(SESSION), self.record)    # found without its directory, too
        self.assertEqual(claude_rules.record_path(SESSION, "/work/repo"), self.record)
        self.assertIsNone(claude_rules.record_path("0e1d2c3b-0000-4000-8000-0000000000ff"))

    def test_one_that_opens_the_next_turn_and_one_taken_back(self):
        self.op("enqueue", "first", ago=4)
        self.op("enqueue", "second", ago=3)
        self.op("dequeue", ago=2)                                           # the turn ended: the first opens the next
        self.assertEqual(self.typed(), [("first", True), ("second", False)])
        self.op("remove", "second", ago=1, reason="cancelled")              # taken back
        self.assertEqual(self.typed(), [("first", True)])

    def test_a_note_queued_as_its_process_closed_is_never_taken_nor_a_message_sent_twice(self):
        # Claude Code's queue is gone with its process: a note queued as it closes (a task it killed) is never taken by
        # the one reopened, so the first in is not what a dequeue takes -- the user line after each says which it took
        # (as Claude Code 2.1.319 wrote it, in a live session)
        self.op("enqueue", "<task-notification>\n<task-id>b1</task-id>\n<status>killed</status>", ago=60)
        self.op("enqueue", "<task-notification>\n<task-id>b2</task-id>", ago=30)     # reopened
        self.op("dequeue", ago=30)
        self.prompt("<task-notification>\n<task-id>b2</task-id>", ago=30, origin="task-notification")
        self.op("enqueue", "show me", ago=10)
        self.op("dequeue", ago=5)                                           # the turn ended: it opens the next
        self.prompt("show me", ago=5)
        self.op("enqueue", "<task-notification>\n<task-id>b3</task-id>", ago=1)
        self.op("dequeue", ago=1)
        self.prompt("<task-notification>\n<task-id>b3</task-id>", ago=1, origin="task-notification")
        self.assertEqual([(q["text"], q["joins"]) for q in self.got()], [("show me", True)])
        [m] = data.meanwhile(self.db, SESSION)
        self.assertEqual(m["text"], "show me")
        self.assertAlmostEqual(m["sent"], self.now - 5, delta=0.002)                # sent when it was, once

    def test_a_message_taken_before_a_note_queued_first_is_sent_once_as_its_line_says(self):
        self.op("enqueue", "<task-notification>\n<task-id>b1</task-id>", ago=8)
        self.op("enqueue", "and b too", ago=6)
        self.op("dequeue", ago=2)                                           # a note waits "later": the message first
        self.prompt("and b too", ago=2)
        self.op("dequeue", ago=1)
        self.prompt("<task-notification>\n<task-id>b1</task-id>", ago=1, origin="task-notification")
        self.assertEqual([(q["text"], q["joins"]) for q in self.got()], [("and b too", True)])
        [m] = data.meanwhile(self.db, SESSION)
        self.assertEqual(m["text"], "and b too")
        self.assertAlmostEqual(m["sent"], self.now - 2, delta=0.002)
        # its event is the user line's, the one ag recorded it by before (as a message sent between turns): read again
        # from the start by a hook with this, an old record's is not stored twice
        lines = []

        class Lines(Follower):
            def take(self, line, at):
                lines.append((json.loads(line), at))
                return []
        follow(self.record, Lines(), 0)
        [key] = [at for m, at in lines if m.get("type") == "user" and m["message"]["content"] == "and b too"]
        self.assertEqual([r[0] for r in self.db.execute("SELECT event_id FROM events WHERE event_id LIKE 'message_sent:%'")],
                         [f"message_sent:{os.path.basename(self.record)}:{key}"])

    def test_pulled_back_into_the_prompt_is_taken_back_and_the_next_sent_is_itself(self):
        # Up while messages wait: Claude Code 2.1.311 writes "popAll" with their words (saved from a live session)
        self.op("enqueue", "<task-notification>\n<task-id>b1</task-id>", ago=6)
        self.op("enqueue", "Actually, also list the files here.", ago=5)
        self.op("popAll", "Actually, also list the files here.", ago=4)
        self.assertEqual(self.typed(), [])                                  # back in the prompt: not pending
        self.op("enqueue", "Make the last line rhyme.", ago=3)
        self.op("dequeue", ago=2)                                           # the note, still queued, is the first in
        self.op("dequeue", ago=1)
        self.assertEqual(self.typed(), [("Make the last line rhyme.", True)])

    def test_sent_from_chat_it_is_pending_until_the_harness_has_it(self):
        chat = lambda text, ago: {"type": "chat_sent", "id": f"chat_sent:{text}",                 # noqa: E731
                                  "payload": {"at": self.now - ago, "text": text}}
        insert(self.db, SESSION, [chat("look at a.py", 3), chat("long ago", data.CHAT_SECONDS + 5)])
        self.assertEqual([(q["text"], q["sent"], q.get("chat")) for q in self.got()], [("look at a.py", None, True)])
        self.op("enqueue", "look at a.py", ago=2)                          # the harness has it: its own entry from now on
        self.assertEqual([(q["text"], q.get("chat")) for q in self.got()], [("look at a.py", None)])
        insert(self.db, SESSION, [chat("and b.py", 1), {"type": "user_message", "id": "u1", "payload": {"text": "and b.py"}}])
        self.assertEqual([q["text"] for q in self.got() if q.get("chat")], ["and b.py"])
        self.db.execute("UPDATE events SET text = 'and b.py' WHERE event_id = 'u1'")      # as ag stores it, its words
        self.assertEqual([q["text"] for q in self.got() if q.get("chat")], [])     # stored as the user's: had

    def test_sent_from_chat_a_command_of_the_harness_s_is_not_pending_and_one_run_with_bang_is_had(self):
        chat = lambda text, ago: {"type": "chat_sent", "id": f"chat_sent:{text}",                 # noqa: E731
                                  "payload": {"at": self.now - ago, "text": text}}
        insert(self.db, SESSION, [chat("/cost", 3), chat("!ls", 2)])       # /cost: run by Claude Code, never sent on
        self.assertEqual([q["text"] for q in self.got() if q.get("chat")], ["!ls"])
        insert(self.db, SESSION, [{"type": "user_message", "id": "u2", "payload": {"text": "<bash-input>ls</bash-input>"}}])
        self.db.execute("UPDATE events SET text = '! ls' WHERE event_id = 'u2'")           # its words, as harness_kit gives them
        self.assertEqual([q["text"] for q in self.got() if q.get("chat")], [])

    def test_long_sent_is_forgotten_and_claude_code_s_own_notes_are_not_the_user_s(self):
        self.op("enqueue", "old", ago=100)
        self.op("dequeue", ago=data.SENT_SECONDS + 5)
        self.op("enqueue", "<task-notification>\n<task-id>b1</task-id>", ago=1)
        self.assertEqual(self.typed(), [])
        # a subagent's report as it hands back, as Claude Code 2.1.310 queues it (saved from a live session)
        self.op("enqueue", '<agent-message from="a6d10bbb09e189a65">\n[Subagent hand-back] The text below is the final report '
                           "of a subagent this session delegated to. ... The report follows:\n  It printed all 100 numbers.\n</agent-message>", ago=1)
        self.op("dequeue", ago=0)
        self.assertEqual(self.typed(), [])

    def test_read_on_from_where_it_was_read_to(self):
        self.op("enqueue", "one", ago=3)
        self.assertEqual(self.typed(), [("one", False)])
        with open(self.record, "a") as fh:                                  # a line still being written
            fh.write('{"type": "queue-operation", "operation": "enq')
        self.assertEqual(self.typed(), [("one", False)])
        with open(self.record, "a") as fh:
            fh.write(f'ueue", "timestamp": "{stamp(self.now)}", "content": "two"}}\n')
        self.assertEqual(self.typed(), [("one", False), ("two", False)])

    def test_held_until_the_turn_ended_is_part_of_it_but_one_written_between_turns_is_not(self):
        self.op("enqueue", "and cook's theorem?", ago=40)
        self.op("enqueue", "and karp's problems?", ago=15)
        self.op("dequeue", ago=1)
        self.op("dequeue", ago=1)                                           # both sent when the turn ended
        self.op("enqueue", "next thing", ago=0.5)
        self.op("dequeue", ago=0.5)                                         # nothing running: sent at once
        self.assertEqual([(q["text"], q["joins"]) for q in self.got()],   # part of the turn, or the next's
                         [("and cook's theorem?", True), ("and karp's problems?", True), ("next thing", False)])
        self.assertEqual([q["text"] for q in data.meanwhile(self.db, SESSION)], ["and cook's theorem?", "and karp's problems?"])

    def test_sent_between_turns_opens_the_next(self):
        self.prompt("look at a.py", ago=3)
        [q] = self.got()
        self.assertEqual((q["text"], q["joins"]), ("look at a.py", False))          # its turn's first
        self.assertAlmostEqual(q["sent"], self.now - 3, delta=0.002)            # sent as Claude Code recorded it

    def test_only_the_user_s_own_and_each_once(self):
        self.prompt("<task-notification>\n<task-id>b1</task-id>", ago=9, origin="task-notification")
        self.prompt("Another Claude session sent a message:\nhi", ago=8, origin="peer")
        self.prompt("<bash-input>echo hi</bash-input>", ago=7, origin=None)      # a "!" command: no model call
        self.prompt("Caveat: the messages below", ago=6, isMeta=True)
        self.prompt("a subagent's task", ago=5, isSidechain=True)
        self.assertEqual(self.typed(), [])
        self.op("enqueue", "and then b", ago=4)
        self.op("dequeue", ago=2)
        self.prompt("and then b", ago=2)                                    # the dequeued one, recorded as it is sent
        self.assertEqual(self.typed(), [("and then b", True)])

    def test_sent_between_turns_long_ago_is_forgotten(self):
        self.prompt("old", ago=data.PROMPT_SECONDS + 5)
        self.prompt("an image", ago=1, message={"role": "user", "content": [{"type": "text", "text": "this one"},
                                                                             {"type": "image", "source": {}}]})
        self.assertEqual(self.typed(), [("this one", True)])

    def test_a_message_sent_mid_turn_unwrapped(self):
        self.assertEqual(claude_rules.mid_turn(wrapped("change g\ntoo")), "change g\ntoo")
        self.assertIsNone(claude_rules.mid_turn("change g"))


class UnstoredTest(unittest.TestCase):
    """The agent's `typed` (data.py's _unstored) leaves out a message that opened a turn once ag has stored a user message
    after it was sent: ag stores a call's messages before the call goes on, so that one is its own, or a later one's."""

    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.conn.executescript("""CREATE TABLE event_types (event_type_id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
            CREATE TABLE events (row_id INTEGER PRIMARY KEY, inserted_at TEXT NOT NULL, event_type_id INTEGER NOT NULL, p_channel);
            INSERT INTO event_types (name) VALUES ('user_message'), ('agent_message');""")
        self.now = time.time()

    def store(self, kind, ago, channel=SESSION):
        tid = self.conn.execute("SELECT event_type_id FROM event_types WHERE name = ?", (kind,)).fetchone()[0]
        self.conn.execute("INSERT INTO events (inserted_at, event_type_id, p_channel) VALUES (?, ?, ?)",
                          (stamp(self.now - ago), tid, channel))

    def left(self, typed):
        return [q["text"] for q in data._unstored(self.conn, SESSION, typed)]

    def test_left_out_once_its_turn_is_stored(self):
        typed = [{"text": "waiting", "at": self.now - 9, "sent": None, "joins": False},
                 {"text": "mid-turn", "at": self.now - 8, "sent": self.now - 7, "joins": True},
                 {"text": "next turn", "at": self.now - 5, "sent": self.now - 5, "joins": False}]
        self.assertEqual(self.left(typed), ["waiting", "mid-turn", "next turn"])             # nothing stored
        self.store("user_message", ago=20)                                                     # the turn before it
        self.store("agent_message", ago=1)                                                     # not a message of the user's
        self.store("user_message", ago=1, channel="another")                                   # another session's
        self.assertEqual(self.left(typed), ["waiting", "mid-turn", "next turn"])
        self.store("user_message", ago=1)                                                      # its own: stored
        self.assertEqual(self.left(typed), ["waiting", "mid-turn"])                            # the rest, by their words (the page)


class TurnTest(RecordBase):
    """In the Chat view, a message written while a turn ran is part of it, under its first message: sent mid-turn, or
    held by Claude Code until the turn ended."""

    def setUp(self):
        super().setUp()
        self.saved, dashboard_home.HOME = dashboard_home.HOME, self.tmp.name
        self.addCleanup(setattr, dashboard_home, "HOME", self.saved)
        os.makedirs(os.path.join(self.tmp.name, "gatherers", "g"))
        conn = sqlite3.connect(os.path.join(self.tmp.name, "gatherers", "g", "context.db"))
        conn.executescript("""CREATE TABLE event_types (event_type_id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
            CREATE TABLE events (row_id INTEGER PRIMARY KEY, inserted_at TEXT NOT NULL, event_id TEXT, event_type_id INTEGER NOT NULL,
              payload_json TEXT NOT NULL, tokens INTEGER NOT NULL, text TEXT, counted INTEGER, p_channel);""")
        for typ, payload in (asked("look at a.py"), call("r1", "Read", {"file_path": "/w/a.py"}), result("r1", "1\tx = 1"),
                             asked(wrapped("and b.py")), call("r2", "Read", {"file_path": "/w/b.py"}), result("r2", "1\ty = 2"),
                             said("Both read."), asked("now c.py"), said("Read."),
                             asked("and d.py?\n"), asked("and e.py?"), said("Both.")):
            got = conn.execute("SELECT event_type_id FROM event_types WHERE name = ?", (typ,)).fetchone()
            tid = got[0] if got else conn.execute("INSERT INTO event_types (name, created_at) VALUES (?, '')", (typ,)).lastrowid
            conn.execute("INSERT INTO events (inserted_at, event_type_id, payload_json, tokens, p_channel) VALUES "
                         "(?, ?, ?, 1, ?)", (stamp(self.now), tid, json.dumps(payload), SESSION))
        conn.commit()
        conn.close()

    def turns(self):
        conn = sqlite3.connect(os.path.join(self.tmp.name, "gatherers", "g", "context.db"))
        try:
            self.follow(conn)
        finally:
            conn.close()
        return [(t["text"], [m["text"] for m in t["more"]]) for t in files.files("g", SESSION, 0, cwd="/w")["turns"]]

    def test_one_turn_with_both_messages_and_both_calls(self):
        got = files.files("g", SESSION, 0, cwd="/w")
        self.assertEqual(self.turns()[:2], [("look at a.py", ["and b.py"]), ("now c.py", [])])
        self.assertEqual(got["turns"][0]["replies"], [{"kind": "text", "text": "Both read.", "after": 2}])   # after both calls
        self.assertEqual([f["path"] for f in got["files"]], ["/w/a.py", "/w/b.py"])

    def test_held_until_the_turn_ended_part_of_it(self):
        self.assertEqual(self.turns()[2:], [("and d.py?\n", []), ("and e.py?", [])])   # its record not read: turns
        self.op("enqueue", "and d.py?", ago=20)
        self.op("enqueue", "and e.py?", ago=10)
        self.op("dequeue", ago=0.5)
        self.op("dequeue", ago=0.5)
        self.assertEqual(self.turns(), [("look at a.py", ["and b.py"]), ("now c.py", ["and d.py?", "and e.py?"])])


class StoppedTest(RecordBase):
    """In the Chat view, a turn that stopped short says how under it, as Claude Code does: interrupted (Esc) -- as the
    note Claude Code sends the model with the next turn says, or its record, before there is one -- or on an error it
    gave up on, as its record says. A turn that ended as turns do says nothing."""

    def setUp(self):
        super().setUp()
        self.saved, dashboard_home.HOME = dashboard_home.HOME, self.tmp.name
        self.addCleanup(setattr, dashboard_home, "HOME", self.saved)
        os.makedirs(os.path.join(self.tmp.name, "gatherers", "g"))
        self.path = os.path.join(self.tmp.name, "gatherers", "g", "context.db")
        conn = sqlite3.connect(self.path)
        conn.executescript("""CREATE TABLE event_types (event_type_id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
            CREATE TABLE events (row_id INTEGER PRIMARY KEY, inserted_at TEXT NOT NULL, event_id TEXT, event_type_id INTEGER NOT NULL,
              payload_json TEXT NOT NULL, tokens INTEGER NOT NULL, text TEXT, counted INTEGER, p_channel);""")
        for ago, (typ, payload) in ((100, asked("look at a.py")), (95, call("r1", "Read", {"file_path": "/w/a.py"})),
                                    (50, result("r1", "Interrupted by user")), (50, note("[Request interrupted by user for tool use]")),
                                    (50, asked("look at b.py instead")), (45, said("Reading b.py.")),
                                    (30, asked("now c.py")), (25, said("Read.")), (20, asked("and d.py")), (15, said("Read d.py."))):
            got = conn.execute("SELECT event_type_id FROM event_types WHERE name = ?", (typ,)).fetchone()
            tid = got[0] if got else conn.execute("INSERT INTO event_types (name, created_at) VALUES (?, '')", (typ,)).lastrowid
            conn.execute("INSERT INTO events (inserted_at, event_type_id, payload_json, tokens, p_channel) VALUES "
                         "(?, ?, ?, 1, ?)", (stamp(self.now - ago), tid, json.dumps(payload), SESSION))
        conn.commit()
        conn.close()

    def stopped(self):
        conn = sqlite3.connect(self.path)
        try:
            self.follow(conn)
        finally:
            conn.close()
        return [(t["text"], t["stopped"]) for t in files.files("g", SESSION, cwd="/w")["turns"]]

    def test_interrupted_as_the_next_turn_tells_the_model(self):
        self.assertEqual(self.stopped(), [("look at a.py", {"kind": "interrupted", "at": None, "text": None, "status": None,
                                                           "reason": None}),
                                          ("look at b.py instead", None), ("now c.py", None), ("and d.py", None)])

    def test_stopped_as_the_record_says(self):
        self.write({"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": "[Request interrupted by user]"}]},
                    "timestamp": stamp(self.now - 90), "sessionId": SESSION})          # the one the conversation says too
        self.write({"type": "assistant", "isApiErrorMessage": True, "apiErrorStatus": 529, "timestamp": stamp(self.now - 28),
                    "message": {"role": "assistant", "content": [{"type": "text", "text": "API Error: 529 Overloaded"}]}})
        self.write({"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": "[Request interrupted by user]"}]},
                    "timestamp": stamp(self.now - 10), "sessionId": SESSION})          # the latest: no turn after it yet
        got = dict(self.stopped())
        self.assertEqual(got["look at a.py"]["kind"], "interrupted")
        self.assertIsNone(got["look at b.py instead"])
        self.assertEqual(dict(got["now c.py"], at=None), {"kind": "error", "at": None, "text": "API Error: 529 Overloaded",
                                                          "status": 529, "reason": None})
        self.assertAlmostEqual(got["now c.py"]["at"], self.now - 28, delta=0.01)    # when, as the record has it
        self.assertEqual(got["and d.py"]["kind"], "interrupted")
        self.assertAlmostEqual(got["and d.py"]["at"], self.now - 10, delta=0.01)


class StoppedWithOneQueuedTest(RecordBase):
    """In the Chat view, a turn stopped by Esc with a message queued, which Claude Code then sends at once: the message is
    part of the turn, as one held until the turn ended is, and the turn, which went on with it, is not said to have
    stopped short -- Claude Code says nothing of the interrupt then. A stop after that, at its end, is said."""

    def setUp(self):
        super().setUp()
        self.saved, dashboard_home.HOME = dashboard_home.HOME, self.tmp.name
        self.addCleanup(setattr, dashboard_home, "HOME", self.saved)
        os.makedirs(os.path.join(self.tmp.name, "gatherers", "g"))
        self.path = os.path.join(self.tmp.name, "gatherers", "g", "context.db")
        conn = sqlite3.connect(self.path)
        conn.executescript("""CREATE TABLE event_types (event_type_id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
            CREATE TABLE events (row_id INTEGER PRIMARY KEY, inserted_at TEXT NOT NULL, event_id TEXT, event_type_id INTEGER NOT NULL,
              payload_json TEXT NOT NULL, tokens INTEGER NOT NULL, text TEXT, counted INTEGER, p_channel);""")
        rejected = ("The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file "
                    "edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to "
                    "tell you how to proceed.")
        for ago, (typ, payload) in ((30, asked("Did you find background agents?")), (20, said("Checking Warp's code first.")),
                                    (20, call("r1", "Bash", {"command": "grep -rn background_task_count app"})),
                                    (20, call("r2", "WebFetch", {"url": "https://example.com", "prompt": "how?"})),
                                    (0.9, result("r1", "app/mod.rs:254: background")), (0.9, result("r2", rejected, error=True)),
                                    (0.9, note("[Request interrupted by user for tool use]")),
                                    (0.9, asked("The open-source project?")), (0.5, said("Looking it up.")),
                                    (0.4, call("r3", "WebSearch", {"query": "background agents"})), (0.3, result("r3", "found")),
                                    (0.2, said("It is Open-Inspect."))):
            got = conn.execute("SELECT event_type_id FROM event_types WHERE name = ?", (typ,)).fetchone()
            tid = got[0] if got else conn.execute("INSERT INTO event_types (name, created_at) VALUES (?, '')", (typ,)).lastrowid
            conn.execute("INSERT INTO events (inserted_at, event_type_id, payload_json, tokens, p_channel) VALUES "
                         "(?, ?, ?, 1, ?)", (stamp(self.now - ago), tid, json.dumps(payload), SESSION))
        conn.commit()
        conn.close()
        self.prompt("Did you find background agents?", ago=30)
        self.op("enqueue", "The open-source project?", ago=18)
        self.op("dequeue", ago=1)                          # as Claude Code wrote it: the dequeue, then the stop just before
        self.interrupted(ago=1.008)
        self.prompt("The open-source project?", ago=0.99)

    def interrupted(self, ago):
        self.write({"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": "[Request interrupted by user for tool use]"}]},
                    "timestamp": stamp(self.now - ago), "sessionId": SESSION})

    def turns(self):
        conn = sqlite3.connect(self.path)
        try:
            self.follow(conn)
        finally:
            conn.close()
        return files.files("g", SESSION, cwd="/w")["turns"]

    def test_one_turn_the_message_in_it_not_stopped(self):
        [turn] = self.turns()
        self.assertEqual((turn["text"], [m["text"] for m in turn["more"]], turn["stopped"], turn["calls"]),
                         ("Did you find background agents?", ["The open-source project?"], None, 3))
        self.assertEqual([r["text"] for r in turn["replies"]],
                         ["Checking Warp's code first.", "Looking it up.", "It is Open-Inspect."])

    def test_stopped_again_at_its_end_it_says_so(self):
        self.interrupted(ago=0.1)                          # Esc as the answer came: no turn after it yet
        [turn] = self.turns()
        self.assertEqual(turn["stopped"]["kind"], "interrupted")
        self.assertAlmostEqual(turn["stopped"]["at"], self.now - 0.1, delta=0.01)


if __name__ == "__main__":
    unittest.main()
