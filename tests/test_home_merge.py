"""`ag home merge` (ag/ag_harness/store/merge.py): every gatherer's database made the home's one, the largest copied
whole, the others appended with their row ids moved, every conversation put in its gatherer's group -- and the policy
going on from it as each gatherer did from its own."""
import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
import unittest.mock
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ag.ag_harness import Manager  # noqa: E402
from ag.ag_harness.home import __main__ as home_cli  # noqa: E402
from ag.ag_harness.store import merge, paths  # noqa: E402
from ag.ag_harness.store import operations as store  # noqa: E402
from ag.ag_policies.proactive_context_manager import ProactiveContextManager, tables  # noqa: E402
from ag.ag_policies.proactive_context_manager.events import context_stream  # noqa: E402
import codex_items  # noqa: E402
from channels import ch, on  # noqa: E402
from test_core import PREAMBLE, ScriptedLLM, conversation, user  # noqa: E402


def rows(path, sql, *args):
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return conn.execute(sql, args).fetchall()
    finally:
        conn.close()


class MergeBase(unittest.TestCase):
    """Gatherer `big` (b1, b2: built, and a stream message with no conversation) and `small` (s1: built, one event of
    it taken back by its harness), each in a database of its own."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = paths.TRACE_DIR, paths.AG_HOME
        paths.AG_HOME = os.path.join(self.tmp.name, "ag")
        paths.TRACE_DIR = os.path.join(paths.AG_HOME, "gatherers")
        self.policy = ProactiveContextManager(codex_items.FORMAT, ScriptedLLM(), options={
            "min_context_tokens": 0, "sync_seconds": 0, "require_smaller": False, "parallel_message": "P[{channel}]: {text}"})
        self.m = Manager(self.policy)
        self.items = codex_items.CodexItems(self.m)
        for g, chans in (("big", ("b1", "b2")), ("small", ("s1",))):
            self.m.init(g)
            for c in chans:
                for item in PREAMBLE + conversation(8, prefix=f"{c} "):
                    self.items.insert(g, item, channel_id=c)
                self.policy.build(g, ch(c), tables.new_build(self.m._conn(g), c))
        ids = {t.name: t.id for t in self.m.event_types("big")}
        self.m.insert("big", on(context_stream(ids["context_stream"], "#big", "bob", "big news", 5), None))
        conn = self.m._conn("small")
        self.taken = conn.execute("SELECT max(row_id) FROM events").fetchone()[0]
        with conn:
            conn.execute("INSERT INTO _withdrawn (row_id, withdrawn_at) VALUES (?, '2026-01-01T00:00:00')", (self.taken,))
        self.before = {g: rows(paths.db_path(g), "SELECT row_id, event_id, payload_json FROM events ORDER BY row_id")
                       for g in ("big", "small")}
        self.small_build = tables.latest_build(conn, "s1")
        self.small_tasks = rows(paths.db_path("small"), "SELECT task_index, first_row, last_row FROM tasks "
                                                        "WHERE channel_key = 's1' ORDER BY task_index")
        self.own = {g: paths.db_path(g) for g in ("big", "small")}
        self.m = Manager(self.policy)                         # its connections are to the gatherers' own files

    def tearDown(self):
        paths.TRACE_DIR, paths.AG_HOME = self.saved
        self.tmp.cleanup()

    def merged(self):
        with redirect_stdout(io.StringIO()):
            return merge.merge(append=lambda g, conn, db, offset: self.policy.append(conn, db, offset),
                               say=lambda text: None)


class PlanTest(MergeBase):
    def test_the_largest_is_copied_whole_the_others_appended(self):
        p = merge.plan()
        self.assertEqual((p["target"], p["others"]), ("big", ["small"]))
        self.assertEqual(p["conversations"], {"big": 2, "small": 1})

    def test_a_gatherer_whose_database_was_never_written_has_nothing_to_merge(self):
        os.makedirs(os.path.join(paths.TRACE_DIR, "empty"))
        open(os.path.join(paths.TRACE_DIR, "empty", "context.db"), "w").close()        # made, never written: no tables
        self.assertEqual(merge.gatherers(), ["big", "small"])
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(home_cli.cmd_merge(dry_run=True), 0)
        self.assertNotIn("empty", out.getvalue())
        self.assertEqual(self.merged()["copied"], {"big": len(self.before["big"]), "small": len(self.before["small"])})
        self.assertEqual(os.path.getsize(os.path.join(paths.TRACE_DIR, "empty", "context.db")), 0)   # left as it was

    def test_the_command_says_what_it_would_do_and_does_nothing(self):
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(home_cli.cmd_merge(dry_run=True), 0)
        self.assertIn("copied whole (the largest; its row ids kept): big", out.getvalue())
        self.assertIn("appended: small", out.getvalue())
        self.assertFalse(paths.merged())


class MergeTest(MergeBase):
    def test_every_gatherer_s_events_are_in_the_one_database_and_their_files_as_they_were(self):
        got = self.merged()
        self.assertTrue(paths.merged())
        home = paths.home_db()
        self.assertEqual(got["copied"], {"big": len(self.before["big"]), "small": len(self.before["small"])})
        kept = rows(home, "SELECT row_id, event_id, CASE WHEN p_channel IS NULL THEN NULL ELSE payload_json END "
                          "FROM events WHERE row_id <= ? ORDER BY row_id", self.before["big"][-1][0])
        conversation = {r for r, _, _ in rows(self.own["big"], "SELECT row_id, 0, 0 FROM events WHERE p_channel IS NOT NULL")}
        self.assertEqual(kept, [(r, e, p if r in conversation else None) for r, e, p in self.before["big"]])
        offset = self.before["big"][-1][0]
        small = rows(home, "SELECT row_id, event_id FROM events WHERE row_id > ? AND event_id NOT LIKE 'group:%:merge' "
                           "ORDER BY row_id", offset)
        self.assertEqual(small, [(r + offset, e) for r, e, _ in self.before["small"]])
        for g, path in self.own.items():                                                # left as they were
            self.assertEqual(rows(path, "SELECT row_id, event_id, payload_json FROM events ORDER BY row_id"),
                             self.before[g])

    def test_each_event_keeps_its_type_by_name(self):
        self.merged()
        home, offset = paths.home_db(), self.before["big"][-1][0]
        theirs = rows(self.own["small"], "SELECT e.row_id, t.name FROM events e JOIN event_types t "
                                         "ON t.event_type_id = e.event_type_id ORDER BY e.row_id")
        mine = rows(home, "SELECT e.row_id - ?, t.name FROM events e JOIN event_types t ON t.event_type_id = "
                          "e.event_type_id WHERE e.row_id > ? AND e.event_id NOT LIKE 'group:%:merge' ORDER BY e.row_id",
                    offset, offset)
        self.assertEqual(mine, theirs)

    def test_every_conversation_is_in_its_gatherer_s_group(self):
        got = self.merged()
        self.assertEqual(got["grouped"], 3)
        groups = dict(rows(paths.home_db(), "SELECT e.p_channel, json_extract(e.payload_json, '$.group') FROM events e "
                                            "JOIN event_types t ON t.event_type_id = e.event_type_id WHERE t.name = 'group'"))
        self.assertEqual(groups, {"b1": "big", "b2": "big", "s1": "small"})
        ids = rows(paths.home_db(), "SELECT e.event_id FROM events e JOIN event_types t ON t.event_type_id = "
                                    "e.event_type_id WHERE t.name = 'group'")
        self.assertEqual(len(set(ids)), 3)              # one id each: a read returns an id once, whatever its channel

    def test_a_record_with_no_conversation_names_its_group(self):
        self.merged()
        (raw,) = rows(paths.home_db(), "SELECT payload_json FROM events WHERE p_channel IS NULL")[0]
        self.assertEqual(json.loads(raw)["group"], "big")

    def test_a_session_s_tasks_build_and_taken_back_event_move_with_it(self):
        self.merged()
        offset = self.before["big"][-1][0]
        conn = self.m._conn("small")                                 # the home's one database now
        build = tables.latest_build(conn, "s1")
        for k in ("through_row", "open_from_row", "parallel_mark"):
            self.assertEqual(build[k], self.small_build[k] + offset)
        self.assertEqual(build["status"], "ready")
        self.assertEqual(rows(paths.home_db(), "SELECT task_index, first_row - ?, last_row - ? FROM tasks "
                                               "WHERE channel_key = 's1' ORDER BY task_index", offset, offset),
                         self.small_tasks)
        self.assertNotIn(self.taken + offset, [r.row_id for r in store.rows(conn, 0)])   # still taken back

    def test_a_session_goes_on_from_its_own_history(self):
        self.merged()
        self.items.insert("small", user("small's next request", 900), channel_id="s1")
        said = "\n".join(codex_items.text(i) for i in self.m.read("small", store.high_water(self.m._conn("small")),
                                                                    properties=ch("s1")))
        self.assertIn("small's next request", said)
        self.assertIn("s1 question", said)                           # its own history, as before
        self.assertIn("# Earlier messages", said)                    # from its build, taken up again


class RefusedTest(MergeBase):
    def test_not_twice(self):
        self.merged()
        with self.assertRaises(merge.MergeError):
            merge.merge(say=lambda text: None)

    def test_not_while_the_dashboard_uses_the_home(self):
        os.makedirs(os.path.join(paths.AG_HOME, "dashboard"))
        with open(os.path.join(paths.AG_HOME, "dashboard", "address.json"), "w") as fh:
            json.dump({"pid": os.getpid()}, fh)                      # running: this very process
        with self.assertRaises(merge.MergeError) as said:
            merge.merge(say=lambda text: None)
        self.assertIn("the dashboard", str(said.exception))
        self.assertFalse(os.path.exists(paths.home_db()))


    def test_not_gatherers_of_different_policies(self):
        for g, policy in (("big", "proactive_context_manager"), ("small", "another_policy")):
            with open(os.path.join(paths.TRACE_DIR, g, "gatherer.toml"), "w") as fh:
                fh.write(f'policy = "{policy}"\n')
        err = io.StringIO()
        with redirect_stdout(io.StringIO()), unittest.mock.patch("sys.stderr", err):
            self.assertEqual(home_cli.cmd_merge(dry_run=False), 1)
        self.assertIn("different policies", err.getvalue())
        self.assertFalse(os.path.exists(paths.home_db()))

if __name__ == "__main__":
    unittest.main()
