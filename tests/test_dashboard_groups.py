"""Moving actors and folders from one group to another (ag_dashboard/groups.py), in the home's one database: a `group`
record in each moved actor's channel, then the dashboard's own rows of them under the group's name."""
import os
import sqlite3
import sys
import unittest
import unittest.mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ag.ag_harness.store import paths  # noqa: E402
from ag_dashboard import actions, data, folders, groups, saved, sessions, tasks  # noqa: E402
from channels import ch  # noqa: E402
from replies import insert  # noqa: E402
import test_home_db  # noqa: E402


class GroupsTest(unittest.TestCase):
    """Groups `a` (c1, c3) and `b` (c2) in the home's one database; records put in by ag as the dashboard would."""

    def setUp(self):
        test_home_db.MergedHomeTest.setUp(self)
        self.addCleanup(test_home_db.MergedHomeTest.tearDown, self)
        self.recorded = []
        record = unittest.mock.patch.object(actions, "record", side_effect=self.record)
        record.start()
        self.addCleanup(record.stop)

    def record(self, gatherer, channel, events, wait=False):
        self.recorded.append((gatherer, channel, events))
        insert(self.m, gatherer, ch(channel), events)

    def members(self, group):
        conn = data._connect(group)
        try:
            return sorted(data.members(conn, group))
        finally:
            conn.close()

    def rows(self, table):
        conn = sqlite3.connect(sessions.db_path())
        try:
            return sorted(conn.execute(f"SELECT gatherer, channel FROM {table}"))
        finally:
            conn.close()

    def test_a_plan_says_who_moves_and_changes_nothing(self):
        got = groups.plan("a", "b", ["c1"])
        self.assertEqual(got["actors"], ["c1"])
        self.assertEqual((got["before"], got["after"]), ({"a": 2, "b": 1}, {"a": 1, "b": 2}))
        self.assertEqual((self.members("a"), self.members("b")), (["c1", "c3"], ["c2"]))
        self.assertEqual(self.recorded, [])

    def test_an_actor_moved_is_in_its_new_group_with_its_rows(self):
        saved.choose("a", "c1", True)
        into = folders.make("b", "Inbox")
        groups.move("a", "b", ["c1"], into=into)
        self.assertEqual((self.members("a"), self.members("b")), (["c3"], ["c1", "c2"]))
        [(_, channel, [event])] = self.recorded
        self.assertEqual((channel, event["type"]), ("c1", "group"))
        self.assertEqual({k: event["payload"][k] for k in ("group", "was")}, {"group": "b", "was": "a"})
        self.assertIn("c1", event["id"])                          # a read returns an id once, whatever its channel
        self.assertEqual(self.rows("saved"), [("b", "c1")])
        self.assertEqual(folders.of("b")["filed"], {"c1": into})
        self.assertEqual(folders.of("a")["filed"], {})

    def test_a_folder_moves_with_its_folders_and_every_actor_in_them(self):
        top = folders.make("a", "Work")
        inner = folders.make("a", "Inner", top)
        folders.file("a", ["c1"], top)
        folders.file("a", ["c3"], inner)
        got = groups.move("a", "b", folder=top)
        self.assertEqual(got["actors"], ["c1", "c3"])
        self.assertEqual((self.members("a"), self.members("b")), ([], ["c1", "c2", "c3"]))
        self.assertEqual(folders.of("a"), {"folders": [], "filed": {}})
        moved = {f["name"]: f.get("parent") for f in folders.of("b")["folders"]}
        self.assertEqual(moved, {"Work": None, "Inner": top})
        self.assertEqual(folders.of("b")["filed"], {"c1": top, "c3": inner})

    def test_a_task_moves_whole(self):
        task = tasks.add("a", "c1", ["c3"])
        got = groups.move("a", "b", ["c1"])
        self.assertEqual(got["actors"], ["c1", "c3"])
        self.assertEqual(self.members("a"), [])
        self.assertEqual(tasks.stored()["b"]["tasked"], {"c1": task, "c3": task})
        self.assertNotIn("a", tasks.stored())

    def test_nothing_of_the_dashboard_s_changes_when_ag_did_not_take_the_record(self):
        saved.choose("a", "c1", True)
        with unittest.mock.patch.object(actions, "record"):           # ag kept nothing
            with self.assertRaises(groups.GroupError):
                groups.move("a", "b", ["c1"])
        self.assertEqual(self.rows("saved"), [("a", "c1")])

    def test_a_folder_named_as_one_where_it_would_go_is_refused_before_anything(self):
        work = folders.make("a", "Work")
        folders.make("b", "work")
        with self.assertRaises(groups.GroupError):
            groups.move("a", "b", folder=work)
        self.assertEqual((self.recorded, self.members("a")), ([], ["c1", "c3"]))

    def test_refused_for_no_such_group_or_its_own(self):
        for to in ("a", "nowhere"):
            with self.assertRaises(groups.GroupError):
                groups.plan("a", to, ["c1"])

    def test_refused_with_a_database_per_gatherer(self):
        os.remove(paths.home_db())
        with self.assertRaises(groups.GroupError):
            groups.plan("a", "b", ["c1"])


if __name__ == "__main__":
    unittest.main()
