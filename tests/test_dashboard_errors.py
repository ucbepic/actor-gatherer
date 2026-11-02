"""A turn that stopped where ag does not see it (data.py's module doc): model calls that failed, kept on their
reads (`failing`); the harness giving up on them, by Claude Code's record of the session (`stopped`) or, with
none, by time (`given_up`) -- ERROR; and the user's interruption in the terminal -- IDLE."""
import json
import os
import sqlite3
import sys
import time
import unittest
import unittest.mock
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag.ag_harness.store import schema  # noqa: E402
from ag_dashboard import data, live  # noqa: E402
from followed import Followed  # noqa: E402
from test_dashboard_answers import GathererBase, event  # noqa: E402

SESSION = "0e1d2c3b-0000-4000-8000-0000000000e1"


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat()


def zulu(t):
    """A time as Claude Code's record writes it."""
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class ErrorsBase(GathererBase):
    """Gatherer `g` with a read log, and Claude Code's record of the session where its config dir is."""

    def setUp(self):
        super().setUp()
        conn = sqlite3.connect(self.path)
        conn.execute("CREATE TABLE _reads (read_id INTEGER PRIMARY KEY, read_at TEXT NOT NULL, row_id INTEGER, "
                     "p_cwd, p_channel, p_answer_id, p_read_id)")           # with the properties' columns: ag's own adds them
        schema.create(conn)                                                  # the rest of the read log, as ag has it
        conn.commit()
        conn.close()
        self.config = os.path.join(self.tmp.name, "claude-config")
        env = unittest.mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": self.config})
        env.start()
        self.addCleanup(env.stop)
        self.addCleanup(live.wake_at, {})
        self.cwd = "/work/my repo"
        self.record = os.path.join(self.config, "projects", "-work-my-repo", f"{SESSION}.jsonl")
        self.asked = time.time() - 300
        self.add([event("user_message", {"role": "user", "content": [{"type": "text", "text": "hi"}]}, "hi")], channel=SESSION)
        conn = sqlite3.connect(self.path)
        conn.execute("UPDATE events SET inserted_at = ? WHERE p_channel = ?", (iso(self.asked), SESSION))   # stored when asked
        conn.commit()
        conn.close()

    def read(self, at, row=2, status=None, error=None, tokens=None):
        """A read for a model call; one that failed (`status`, `error`), recorded as the hook records it (`call_failed`)."""
        conn = sqlite3.connect(self.path)
        read_id = conn.execute("INSERT INTO _reads (read_at, row_id, real_tokens, p_cwd, p_channel) VALUES (?, ?, ?, ?, ?)",
                               (iso(at), row, tokens, self.cwd, SESSION)).lastrowid
        if status is not None or error is not None:
            conn.execute("INSERT OR IGNORE INTO event_types (name, created_at) VALUES ('call_failed', ?)", (iso(at),))
            conn.execute("INSERT INTO events (inserted_at, event_type_id, payload_json, tokens, p_channel, p_read_id) VALUES "
                         "(?, (SELECT event_type_id FROM event_types WHERE name = 'call_failed'), ?, 1, ?, ?)",
                         (iso(at), json.dumps({"status": status, "error": error}), SESSION, read_id))
        conn.commit()
        conn.close()

    def write(self, line):
        """A line of Claude Code's record, followed into the gatherer as ag's hook does."""
        os.makedirs(os.path.dirname(self.record), exist_ok=True)
        with open(self.record, "a") as fh:
            fh.write(json.dumps(line) + "\n")
        self.follow()

    def follow(self):
        if not hasattr(self, "followed"):
            self.followed = Followed("claude", self.record)
        conn = sqlite3.connect(self.path)
        try:
            self.followed.into(conn, SESSION)
        finally:
            conn.close()

    def actor(self):
        return next(a for g in data.home([])["gatherers"] for a in g["agents"] if a["channel"] == SESSION)

    def failing(self):
        conn = data._connect("g")
        try:
            return data.failing(conn, SESSION)
        finally:
            conn.close()


DNS = "Cannot connect to host api.anthropic.com:443 ssl:default [nodename nor servname provided, or not known]"


class FailingTest(ErrorsBase):
    def test_no_failure_none(self):
        self.assertIsNone(self.failing())
        self.read(time.time() - 20, tokens=900)                              # answered
        self.assertIsNone(self.failing())

    def test_the_run_of_failed_tries_at_the_same_event(self):
        now = time.time()
        self.read(now - 200, row=1, error="an earlier turn's")               # another event's: not this run's
        self.read(now - 30, error=DNS)
        self.read(now - 20, error=DNS)
        self.read(now - 5, status=529, error="overloaded_error: Overloaded")
        got = self.failing()
        self.assertEqual((got["attempts"], got["status"], got["error"], got["retrying"]),
                         (3, 529, "overloaded_error: Overloaded", False))
        self.assertAlmostEqual(got["first"], now - 30, places=3)
        self.assertAlmostEqual(got["at"], now - 5, places=3)

    def test_a_try_under_way_after_them_is_retrying(self):
        now = time.time()
        self.read(now - 20, error=DNS)
        self.read(now - 1)                                                    # no answer yet, the same event
        got = self.failing()
        self.assertEqual((got["attempts"], got["retrying"], got["status"]), (1, True, None))

    def test_a_call_since_that_answered_or_a_new_message_ends_it(self):
        now = time.time()
        self.read(now - 20, error=DNS)
        self.read(now - 1, row=3)                                             # the user wrote again: not a retry
        self.assertIsNone(self.failing())
        self.read(now, row=3, tokens=1200)                                    # and it was answered
        self.assertIsNone(self.failing())

    def test_a_read_log_from_before_failures_were_kept(self):
        conn = sqlite3.connect(self.path)
        conn.executescript("DROP TABLE _reads; CREATE TABLE _reads (read_id INTEGER PRIMARY KEY, read_at TEXT, row_id INTEGER, "
                           "real_tokens INTEGER, p_cwd, p_channel)")
        conn.close()
        self.assertIsNone(self.failing())


class HungUpTest(ErrorsBase):
    """A call the user stopped (Esc) before any of its answer came: Claude Code takes the message back and records nothing
    of it; ag's hook server reports it as hung up (HUNG_UP) -- the turn over, not a failure."""

    def test_the_turn_is_over_and_nothing_failed(self):
        now = time.time()
        self.read(now - 3)                                                    # the call, as ag read for it
        self.assertEqual(self.actor()["status"], data.RUNNING)               # the model answering, as far as ag knows
        self.read(now - 2, row=2, status=data.HUNG_UP, error="the harness hung up before the answer was through")
        a = self.actor()
        self.assertEqual((a["status"], a["turn_over"], a["failing"]), (data.IDLE, True, None))
        self.assertEqual(a["stopped"]["kind"], "interrupted")
        self.assertIsNone(self.failing())

    def test_claude_code_has_the_message_back_only_after_the_key_that_stopped_it(self):
        from ag_dashboard import sessions
        now = time.time()
        self.read(now - 5)
        self.assertFalse(sessions.took_back("g", SESSION, now - 2))             # the call not hung up on
        self.read(now - 1, status=data.HUNG_UP, error="hung up")             # read for after the Esc: ag was reading
        self.assertTrue(sessions.took_back("g", SESSION, now - 2))              # Esc, in this turn
        self.assertFalse(sessions.took_back("g", SESSION, 0.0))                 # something typed since
        self.assertFalse(sessions.took_back("g", SESSION, now - 10))            # a key from an earlier turn
        self.assertFalse(sessions.took_back("nope", SESSION, now))

    def test_a_try_after_it_is_not_a_retry_of_a_failure(self):
        now = time.time()
        self.read(now - 20, status=data.HUNG_UP, error="hung up")
        self.read(now - 1)                                                    # the same event, sent again
        self.assertIsNone(self.failing())
        self.assertEqual(self.actor()["status"], data.RUNNING)


class GivenUpTest(ErrorsBase):
    """No record of Claude Code's to say (here: none written): time does."""

    def test_while_it_tries_again_it_runs_and_is_woken_when_it_would_be_given_up(self):
        at = time.time() - 30
        self.read(at, error=DNS)
        a = self.actor()
        self.assertEqual((a["status"], a["failing"]["attempts"]), (data.RUNNING, 1))
        (woken, when), = live._WAKES.items()
        self.assertEqual(woken, ("g", SESSION))
        self.assertAlmostEqual(when, at + data.GIVE_UP_SECONDS + 1, places=3)

    def test_no_try_for_long_enough_is_given_up(self):
        self.read(time.time() - data.GIVE_UP_SECONDS - 10, error=DNS)
        a = self.actor()
        self.assertEqual((a["status"], a["running"], a["turn_over"]), (data.ERROR, False, True))
        self.assertEqual(a["failing"]["error"], DNS)
        self.assertEqual(live._WAKES, {})

    def test_a_try_under_way_is_not_given_up_however_long(self):
        self.read(time.time() - 1000, error=DNS)
        self.read(time.time() - 900)                                          # a long answer, coming
        self.assertEqual(self.actor()["status"], data.RUNNING)

    def test_with_a_record_an_error_answered_waits_longer(self):
        self.write({"type": "user", "timestamp": zulu(self.asked), "message": {"role": "user", "content": "hi"}})
        self.read(time.time() - data.GIVE_UP_SECONDS - 10, status=429, error="rate_limit_error: slow down")
        self.assertEqual(self.actor()["status"], data.RUNNING)                # a Retry-After may be long: the record would say
        self.read(time.time() - data.GIVE_UP_LONG - 10, row=5, status=429, error="rate_limit_error: slow down")
        self.assertEqual(self.actor()["status"], data.ERROR)

    def test_with_a_record_that_says_nothing_no_answer_is_given_up_in_time(self):
        self.write({"type": "user", "timestamp": zulu(self.asked), "message": {"role": "user", "content": "hi"}})
        self.read(time.time() - data.GIVE_UP_SECONDS - 10, error=DNS)       # Esc while it waited: no word of it
        self.assertEqual(self.actor()["status"], data.ERROR)


class StoppedTest(ErrorsBase):
    """Claude Code's record of the session: what it wrote last, after ag last heard of it."""

    def setUp(self):
        super().setUp()
        self.write({"type": "user", "timestamp": zulu(self.asked), "message": {"role": "user", "content": "hi"}})

    def give_up(self, at):
        self.write({"type": "assistant", "timestamp": zulu(at), "isApiErrorMessage": True, "apiErrorStatus": 500,
                    "error": "server_error", "message": {"role": "assistant", "model": "<synthetic>", "content": [
                        {"type": "text", "text": "API Error: 500 500 Internal Server Error"}]}})
        self.write({"type": "system", "subtype": "turn_duration", "timestamp": zulu(at)})   # its own notes after it

    def test_its_api_error_after_the_last_try_is_given_up_at_once(self):
        now = time.time()
        self.read(now - 4, error=DNS)
        self.give_up(now - 3)
        a = self.actor()
        self.assertEqual((a["status"], a["running"], a["turn_over"]), (data.ERROR, False, True))
        self.assertEqual(a["stopped"], {"kind": "error", "at": unittest.mock.ANY, "status": 500,
                                        "text": "API Error: 500 500 Internal Server Error"})
        self.assertEqual(a["failing"]["error"], DNS)                          # why, as ag's hook server saw it

    def test_an_error_ag_never_saw_counts_too(self):
        self.give_up(time.time())                                             # the hook server unreachable: no read
        a = self.actor()
        self.assertEqual((a["status"], a["failing"]), (data.ERROR, None))

    def test_an_error_before_ag_last_heard_of_it_is_over(self):
        now = time.time()
        self.give_up(now - 60)
        self.read(now - 5, row=3, tokens=800)                                 # the user wrote again, answered
        self.assertEqual(self.actor()["status"], data.RUNNING)

    def test_the_user_s_interruption_is_idle(self):
        self.read(time.time() - 10, tokens=500)
        self.write({"type": "user", "timestamp": zulu(time.time() - 2), "message": {"role": "user", "content": [
            {"type": "text", "text": "[Request interrupted by user]"}]}})
        a = self.actor()
        self.assertEqual((a["status"], a["turn_over"], a["stopped"]["kind"]), (data.IDLE, True, "interrupted"))

    def test_an_interruption_said_before_ag_stored_the_answer_s_end_is_idle(self):
        """agy cancels the step its answer makes as the answer ends, Esc pressed as it came, while ag's hook server
        stores that end -- ms apart, either first: the stop is this call's."""
        now = time.time()
        self.read(now - 10, tokens=500)
        conn = sqlite3.connect(self.path)
        conn.execute("INSERT OR IGNORE INTO event_types (name, created_at) VALUES ('reply_end', ?)", (iso(now),))
        conn.execute("INSERT INTO events (inserted_at, event_type_id, payload_json, tokens, p_channel) VALUES "
                     "(?, (SELECT event_type_id FROM event_types WHERE name = 'reply_end'), ?, 1, ?)",
                     (iso(now - 1), json.dumps({"stop": "STOP"}), SESSION))
        conn.commit()
        conn.close()
        self.write({"type": "user", "timestamp": zulu(now - 1.004), "message": {"role": "user", "content": [
            {"type": "text", "text": "[Request interrupted by user]"}]}})
        a = self.actor()
        self.assertEqual((a["status"], a["turn_over"], a["stopped"]["kind"]), (data.IDLE, True, "interrupted"))

    def said_again(self):
        """The user writes again: ag stores the message as the read begins, and records the read only once its
        context is built (the policy's boundary check, a build) -- here, not yet."""
        self.add([event("user_message", {"role": "user", "content": [{"type": "text", "text": "next"}]}, "next")],
                 channel=SESSION)

    def test_a_new_turn_after_an_interruption_runs_while_its_read_is_built(self):
        self.read(time.time() - 10, tokens=500)
        self.write({"type": "user", "timestamp": zulu(time.time() - 5), "message": {"role": "user", "content": [
            {"type": "text", "text": "[Request interrupted by user]"}]}})
        self.said_again()
        a = self.actor()
        self.assertEqual((a["status"], a["stopped"]), (data.RUNNING, None))     # the stop was the last turn's

    def test_a_new_turn_after_an_error_runs_while_its_read_is_built(self):
        self.read(time.time() - 10, error=DNS)
        self.give_up(time.time() - 5)
        self.said_again()
        self.assertEqual(self.actor()["status"], data.RUNNING)

    def test_a_hang_up_then_a_new_call_runs_while_its_read_is_built(self):
        self.read(time.time() - 10, status=data.HUNG_UP, error="the harness hung up")
        a = self.actor()
        self.assertEqual((a["status"], a["stopped"]["kind"]), (data.IDLE, "interrupted"))    # Esc, as far as ag knows
        self.said_again()                                       # codex hung up to send a question's reply at once
        self.assertEqual(self.actor()["status"], data.RUNNING)

    def test_a_subagent_s_message_or_one_not_yet_whole_tells_nothing(self):
        self.give_up(time.time())
        self.write({"type": "assistant", "isSidechain": True, "timestamp": zulu(time.time()),
                    "message": {"role": "assistant", "content": [{"type": "text", "text": "a subagent's"}]}})
        self.assertEqual(self.actor()["status"], data.ERROR)                  # its own, before
        with open(self.record, "a") as fh:
            fh.write('{"type": "assistant", "timestamp": "')                  # being written: read once it is whole
        self.follow()
        self.assertEqual(self.actor()["status"], data.ERROR)

class WakeTest(unittest.TestCase):
    def test_an_actor_is_rung_once_its_time_comes(self):
        hub = live.Hub()
        rung = []
        hub.ring = lambda gatherer, channel=None, what="": rung.append((gatherer, channel))
        fallback = live.Fallback(hub, seconds=3600)
        self.addCleanup(fallback.close)
        self.addCleanup(live.wake_at, {})
        live.wake_at({("g", "a"): time.time() - 1, ("g", "b"): time.time() + 60})
        fallback.check_records()
        fallback.check_records()
        self.assertEqual(rung, [("g", "a")])                                  # once; b's time is not yet


if __name__ == "__main__":
    unittest.main()
