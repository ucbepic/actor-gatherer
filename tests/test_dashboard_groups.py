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
from replies import insert  # noqa: E402
import test_home_db  # noqa: E402


class GroupsTest(unittest.TestCase):
    """Groups `a` (c1, c3) and `b` (c2) in the home's one database; records put in by ag as the dashboard would."""

    def setUp(self):
        test_home_db.MergedHomeTest.setUp(self)
        self.addCleanup(test_home_db.MergedHomeTest.tearDown, self)
        self.recorded = []
        put = unittest.mock.patch.object(actions, "insert", side_effect=self.insert)
        put.start()
        self.addCleanup(put.stop)

    def insert(self, gatherer, events):
        """actions.insert, in this process: each event in the channel its own properties name."""
        self.recorded.append((gatherer, events))
        insert(self.m, gatherer, {}, events)
        return [None] * len(events)

    def events(self, kind):
        return [e for _, events in self.recorded for e in events if e["type"] == kind]

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
        self.assertEqual((got["actors"], got["folder"]), (["c1"], None))
        self.assertEqual((got["before"], got["after"]), ({"a": 2, "b": 1}, {"a": 1, "b": 2}))
        self.assertEqual((self.members("a"), self.members("b")), (["c1", "c3"], ["c2"]))
        self.assertEqual(self.events("group"), [])

    def test_a_move_is_one_call_to_ag(self):
        work = folders.make("a", "Work")
        folders.file("a", ["c1", "c3"], work)
        self.recorded.clear()
        groups.move("a", "b", folder=work)
        self.assertEqual(len(self.recorded), 1)

    def test_an_actor_moved_is_in_its_new_group_with_its_rows(self):
        saved.choose("a", "c1", True)
        into = folders.make("b", "Inbox")
        groups.move("a", "b", ["c1"], into=into)
        self.assertEqual((self.members("a"), self.members("b")), (["c3"], ["c1", "c2"]))
        [event] = [e for e in self.events("group") if e["payload"]["was"] == "a"]
        self.assertEqual(event["properties"], {"channel": "c1"})
        self.assertEqual({k: event["payload"][k] for k in ("group", "was", "folder")}, {"group": "b", "was": "a", "folder": into})
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
        with unittest.mock.patch.object(actions, "insert", side_effect=RuntimeError("no")):     # ag kept nothing
            with self.assertRaises(groups.GroupError):
                groups.move("a", "b", ["c1"])
        self.assertEqual(self.rows("saved"), [("a", "c1")])

    def test_a_folder_named_as_one_where_it_would_go_is_refused_before_anything(self):
        work = folders.make("a", "Work")
        folders.make("b", "work")
        with self.assertRaises(groups.GroupError):
            groups.move("a", "b", folder=work)
        self.assertEqual((self.events("group"), self.members("a")), ([], ["c1", "c3"]))

    def test_an_app_does_not_move_between_groups(self):
        work = folders.make("a", "Work")
        folders.file("a", ["c1", "app:x1"], work)
        with self.assertRaises(groups.GroupError):
            groups.move("a", "b", folder=work)
        self.assertEqual(self.members("a"), ["c1", "c3"])

    def test_refused_for_no_such_group_or_its_own(self):
        for to in ("a", "nowhere"):
            with self.assertRaises(groups.GroupError):
                groups.plan("a", to, ["c1"])

    def test_refused_with_a_database_per_gatherer(self):
        os.remove(paths.home_db())
        with self.assertRaises(groups.GroupError):
            groups.plan("a", "b", ["c1"])



class FoldersInHomeTest(GroupsTest):
    """The folder tree kept in the home's one database (folders.py), as `folder` and `group` records."""

    test_a_plan_says_who_moves_and_changes_nothing = test_a_move_is_one_call_to_ag = None     # GroupsTest's, run there
    test_an_actor_moved_is_in_its_new_group_with_its_rows = test_a_folder_moves_with_its_folders_and_every_actor_in_them = None
    test_a_task_moves_whole = test_nothing_of_the_dashboard_s_changes_when_ag_did_not_take_the_record = None
    test_a_folder_named_as_one_where_it_would_go_is_refused_before_anything = None
    test_refused_for_no_such_group_or_its_own = test_refused_with_a_database_per_gatherer = None
    test_an_app_does_not_move_between_groups = None

    def kept_in_dashboard_db(self):
        if not os.path.exists(sessions.db_path()):
            return 0, 0
        conn = sqlite3.connect(sessions.db_path())
        try:
            if not folders._has(conn, "folders"):
                return 0, 0
            return tuple(conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in ("folders", "filed"))
        finally:
            conn.close()

    def test_the_tree_is_kept_as_records_not_in_dashboard_db(self):
        work = folders.make("a", "Work")
        inner = folders.make("a", "Inner", work)
        folders.file("a", ["c1"], inner)
        folders.rename("a", work, "Jobs")
        self.assertEqual(folders.of("a"), {"folders": [{"id": inner, "parent": work, "name": "Inner", "closed": None},
                                                       {"id": work, "parent": None, "name": "Jobs", "closed": None}],
                                           "filed": {"c1": inner}})
        self.assertEqual(folders.of("b"), {"folders": [], "filed": {}})
        self.assertEqual(self.kept_in_dashboard_db(), (0, 0))
        self.assertEqual([e["payload"]["name"] for e in self.events("folder")], ["Work", "Inner", "Jobs"])

    def test_filing_an_actor_keeps_its_group(self):
        work = folders.make("a", "Work")
        folders.file("a", ["c1"], work)
        [event] = self.events("group")
        self.assertEqual(event["payload"], {"group": "a", "was": "a", "folder": work})   # no move: nothing rebuilt
        self.assertEqual(self.members("a"), ["c1", "c3"])
        folders.file("a", ["c1"], None)
        self.assertEqual(self.events("group")[-1]["payload"]["folder"], None)
        self.assertEqual(folders.of("a")["filed"], {})

    def test_a_folder_deleted_moves_its_actors_up_and_its_id_is_not_used_again(self):
        work = folders.make("a", "Work")
        inner = folders.make("a", "Inner", work)
        folders.file("a", ["c1"], inner)
        folders.delete("a", inner)
        self.assertEqual(folders.of("a"), {"folders": [{"id": work, "parent": None, "name": "Work", "closed": None}],
                                           "filed": {"c1": work}})
        self.assertGreater(folders.make("a", "Next"), inner)

    def test_an_app_in_a_folder_is_no_conversation(self):
        work = folders.make("a", "Work")
        folders.file("a", ["app:x1"], work)
        self.assertEqual(folders.of("a")["filed"], {"app:x1": work})
        self.assertEqual(self.members("a"), ["c1", "c3"])                 # not one of the group's channels
        self.assertEqual([e["payload"] for e in self.events("filed")], [{"item": "app:x1", "group": "a", "folder": work}])
        self.assertNotIn("properties", self.events("filed")[0])
        folders.file("a", ["app:x1"], None)
        self.assertEqual(folders.of("a")["filed"], {})

    def test_a_folder_closed_and_reopened(self):
        work = folders.make("a", "Work")
        folders.mark("a", work, True)
        self.assertIsNotNone(folders.of("a")["folders"][0]["closed"])
        folders.reopen("a", work)
        self.assertIsNone(folders.of("a")["folders"][0]["closed"])

    def test_nothing_is_kept_when_ag_does_not_take_a_change(self):
        work = folders.make("a", "Work")
        with unittest.mock.patch.object(actions, "insert", side_effect=RuntimeError("no")):
            with self.assertRaises(folders.FolderError):
                folders.rename("a", work, "Jobs")
            with self.assertRaises(folders.FolderError):
                folders.make("a", "Other")
        self.assertEqual([f["name"] for f in folders.of("a")["folders"]], ["Work"])

    def test_dashboard_db_s_folders_come_in_once(self):
        with unittest.mock.patch.object(folders.sessions.home, "merged", return_value=False):    # before the merge
            work = folders.make("a", "Work")
            other = folders.make("b", "Other")
            folders.file("a", ["c1"], work)
            folders.file("b", ["c2"], other)
            folders.file("a", ["c3"], work)
        insert(self.m, "b", {}, [{"type": "group", "id": "group:c3:moved", "properties": {"channel": "c3"},
                                  "payload": {"group": "b", "was": "a"}}])          # moved to b since: left as it is
        self.assertEqual(folders.of("a"), {"folders": [{"id": work, "parent": None, "name": "Work", "closed": None}],
                                           "filed": {"c1": work}})
        self.assertEqual(folders.of("b")["filed"], {"c2": other})
        self.assertEqual(self.kept_in_dashboard_db(), (2, 3))                     # left as they were
        copied = len(self.recorded)
        folders._copied.clear()
        folders.stored()
        self.assertEqual(len(self.recorded), copied)                                # once


if __name__ == "__main__":
    unittest.main()
