"""Moving actors and folders from one group to another (ag_dashboard/groups.py), in the home's one database: a `group`
record in each moved actor's channel, then the dashboard's own rows of them under the group's name."""
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import unittest.mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ag.ag_harness.store import paths  # noqa: E402
import app_kit  # noqa: E402
from ag_dashboard import actions, app_agents, app_host, data, folders, groups, naming, saved, sessions, tasks, titles, tool_gateway  # noqa: E402
from replies import insert  # noqa: E402
from test_dashboard_app_host import NOTES, insert_here, write_app  # noqa: E402
import test_home_db  # noqa: E402

REAL_INSERT = actions.insert                                      # GroupsTest's tests have it run here instead


class GroupsTest(unittest.TestCase):
    """Groups `a` (c1, c3) and `b` (c2) in the home's one database; records put in by ag as the dashboard would."""

    def setUp(self):
        test_home_db.MergedHomeTest.setUp(self)
        self.addCleanup(test_home_db.MergedHomeTest.tearDown, self)
        self.recorded = []
        for patch in (unittest.mock.patch.object(actions, "insert", side_effect=self.insert),
                      unittest.mock.patch.object(tool_gateway, "HOST", None)):           # no apps run here
            patch.start()
            self.addCleanup(patch.stop)

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

    def made(self, name):
        """sessions.new_gatherer, as `ag new` makes a group here: its config."""
        os.makedirs(os.path.join(paths.TRACE_DIR, name))
        with open(os.path.join(paths.TRACE_DIR, name, "gatherer.toml"), "w") as fh:
            fh.write('policy = "proactive_context_manager"\n')
        return {"name": name}

    def test_a_folder_outside_every_group_is_a_group_of_its_own(self):
        work = folders.make("a", "Work: notes")
        inner = folders.make("a", "Inner", work)
        folders.file("a", ["c1"], work)
        folders.file("a", ["c3"], inner)
        with unittest.mock.patch.object(groups.sessions, "new_gatherer", side_effect=self.made):
            got = groups.split("a", work)
        self.assertEqual(got, {"group": "Work_notes", "actors": ["c1", "c3"], "apps": [], "from": "a"})
        self.assertEqual(titles.stored()["Work_notes"], "Work: notes")          # named as the folder was
        self.assertEqual((self.members("a"), self.members("Work_notes")), ([], ["c1", "c3"]))
        self.assertEqual(folders.of("Work_notes"), {"folders": [{"id": inner, "parent": None, "name": "Inner", "closed": None}],
                                                    "filed": {"c3": inner}})   # the folder gone, what was in it at the top
        self.assertEqual(folders.of("a"), {"folders": [], "filed": {}})
        [moved] = [e for e in self.events("group") if e["payload"]["group"] != e["payload"]["was"]
                   and e["properties"]["channel"] == "c1"]
        self.assertEqual(moved["payload"]["group"], "Work_notes")

    def test_a_new_group_s_name_is_one_no_group_has(self):
        self.assertEqual(groups._group_name("b"), "b_2")
        self.assertEqual(groups._group_name("  ***  "), "group")

    def test_an_app_moves_only_where_its_host_runs(self):
        work = folders.make("a", "Work")
        folders.file("a", ["c1", "app:x1"], work)
        with unittest.mock.patch.object(groups.sessions, "new_gatherer", side_effect=self.made) as made:
            with self.assertRaises(groups.GroupError):
                groups.split("a", work)
            with self.assertRaises(groups.GroupError):
                groups.move("a", "b", folder=work)
        made.assert_not_called()
        self.assertEqual(self.members("a"), ["c1", "c3"])

    def test_an_actor_on_its_own_is_a_group_of_one(self):
        saved.choose("a", "c1", True)
        work = folders.make("a", "Work")
        folders.file("a", ["c1"], work)
        self.recorded.clear()
        self.assertEqual(groups.alone("a", "c1"), {"group": "self:c1", "actors": ["c1"], "apps": [], "from": "a"})
        [(via, [event])] = self.recorded                                   # one call to ag, as the group it leaves
        self.assertEqual((via, event["properties"]), ("a", {"channel": "c1"}))
        self.assertEqual({k: event["payload"][k] for k in ("group", "was", "folder")}, {"group": "self:c1", "was": "a", "folder": None})
        self.assertEqual((self.members("a"), self.members("self:c1")), (["c3"], ["c1"]))
        self.assertEqual(self.rows("saved"), [("self:c1", "c1")])
        self.assertEqual(folders.of("a")["filed"], {})                     # out of its folder too
        self.assertEqual(data.alone_names(), ["self:c1"])
        listed = {g["name"]: (g.get("alone", False), [a["channel"] for a in g["agents"]]) for g in data.home([])["gatherers"]}
        self.assertEqual(listed["self:c1"], (True, ["c1"]))
        self.assertEqual(listed["a"], (False, ["c3"]))

    def test_an_actor_on_its_own_runs_under_the_group_it_left_and_comes_back(self):
        groups.alone("a", "c1")
        self.assertEqual(groups.launch_group("c1", "self:c1"), "a")         # ag runs it in a group of the home
        self.assertEqual(groups.launch_group("c3", "a"), "a")
        groups.move("self:c1", "b", ["c1"])
        self.assertEqual((self.members("b"), data.alone_names()), (["c1", "c2"], []))

    def test_an_actor_is_not_taken_out_with_others_of_its_task_nor_the_coordinator(self):
        tasks.add("a", "c1", ["c3"])
        with self.assertRaises(groups.GroupError):
            groups.alone("a", "c1")
        with unittest.mock.patch.object(groups.sessions, "stored", return_value=[{"session_id": "c3", "role": "coordinator"}]):
            with self.assertRaises(groups.GroupError):
                groups.alone("a", "c3")
        with self.assertRaises(groups.GroupError):
            groups.alone("a", "c2")                                         # b's, not a's
        self.assertEqual(self.members("a"), ["c1", "c3"])

    def test_what_is_written_of_an_actor_on_its_own_goes_through_ag_as_the_group_it_left(self):
        """ag keeps a config for the home's groups, and would make one -- a gatherer -- for `self:<channel>`."""
        groups.alone("a", "c1")
        self.assertEqual((groups.runs_under("self:c1"), groups.runs_under("b")), ("a", "b"))
        ran = []

        def run(argv, **kw):
            ran.append(argv[argv.index("insert") + 1])
            return subprocess.CompletedProcess(argv, 0, stdout='{"rows": [1]}', stderr="")
        with unittest.mock.patch.object(subprocess, "run", side_effect=run), \
                unittest.mock.patch.object(actions, "ENABLED", True):
            REAL_INSERT("self:c1", [])
            actions.record("self:c1", "c1", [{"type": "chat_sent", "payload": {}}], wait=True)
            naming.record("self:c1", "c1", "Alone")
        self.assertEqual(ran, ["a", "a", "a"])
        host = app_host.AppHost(0, write=lambda g, *rest: ran.append(g))
        self.addCleanup(host.close)
        host._write_one(("self:c1", {}, [{"type": "app_attached"}], []))
        self.assertEqual(ran[-1], "a")

    def sessions_here(self):
        started = sessions.Sessions()
        self.addCleanup(started.close)
        return started

    def test_an_actor_started_on_its_own_is_one_before_its_first_call(self):
        """Its record is in before ag's first of the conversation, which ag writes only when it has none: so its first
        call is built with its own context alone, and it is listed on its own from the start."""
        started = self.sessions_here()
        s = groups.start_alone(started, "b", self.tmp.name, "claude")
        sid = s["session_id"]
        self.assertEqual((s["gatherer"], s["cwd"], s["harness"]), ("self:" + sid, os.path.abspath(self.tmp.name), "claude"))
        [(via, [event])] = self.recorded                                   # one call to ag, as the group it runs under
        self.assertEqual((via, event["properties"]), ("b", {"channel": sid}))
        self.assertEqual(event["payload"], {"group": "self:" + sid, "under": "b", "name": "", "folder": None})
        self.assertNotIn("was", event["payload"])                          # from no group: told of no move
        self.assertEqual((self.members("self:" + sid), self.members("b")), ([sid], ["c2"]))
        self.assertEqual(groups.launch_group(sid, "self:" + sid), "b")    # ag runs it in the group it was started under
        listed = {g["name"]: (g.get("alone", False), sorted(a["channel"] for a in g["agents"]))
                  for g in data.home(started.list())["gatherers"]}
        self.assertEqual(listed["self:" + sid], (True, [sid]))
        self.assertEqual(listed["b"], (False, ["c2"]))

    def test_listed_on_its_own_while_its_record_is_still_being_written(self):
        started = self.sessions_here()
        sid = started.create("a", self.tmp.name, harness="claude", alone=True)["session_id"]
        listed = {g["name"]: (g.get("alone", False), sorted(a["channel"] for a in g["agents"]))
                  for g in data.home(started.list())["gatherers"]}
        self.assertEqual(listed["self:" + sid], (True, [sid]))
        self.assertEqual(listed["a"], (False, ["c1", "c3"]))

    def test_forgotten_before_its_first_message_it_is_listed_nowhere(self):
        started = self.sessions_here()
        sid = groups.start_alone(started, "a", self.tmp.name, "claude")["session_id"]
        started.discard(sid)
        self.assertEqual(data.alone_names(), ["self:" + sid])              # its record stays: ag keeps every event
        self.assertNotIn("self:" + sid, [g["name"] for g in data.home(started.list())["gatherers"]])

    def test_not_started_on_its_own_when_ag_does_not_take_its_record(self):
        started = self.sessions_here()
        with unittest.mock.patch.object(actions, "insert", side_effect=RuntimeError("no")):
            with self.assertRaises(groups.GroupError):
                groups.start_alone(started, "a", self.tmp.name, "claude")
        self.assertEqual(started.list(), [])

    def test_not_started_on_its_own_on_a_harness_that_names_its_session_at_its_first_call(self):
        started = self.sessions_here()
        for harness in ("codex", "antigravity"):
            with self.assertRaisesRegex(groups.GroupError, "names its session only at its first call"):
                groups.start_alone(started, "a", self.tmp.name, harness)
        for under in ("nowhere", "self:c1"):
            with self.assertRaises(groups.GroupError):
                groups.start_alone(started, under, self.tmp.name, "claude")
        self.assertEqual((started.list(), self.recorded), ([], []))

    def test_refused_for_no_such_group_or_its_own(self):
        for to in ("a", "nowhere"):
            with self.assertRaises(groups.GroupError):
                groups.plan("a", to, ["c1"])

    def test_refused_with_a_database_per_gatherer(self):
        os.remove(paths.home_db())
        with self.assertRaises(groups.GroupError):
            groups.plan("a", "b", ["c1"])
        started = self.sessions_here()
        with self.assertRaises(groups.GroupError):
            groups.start_alone(started, "a", self.tmp.name, "claude")
        self.assertEqual(started.list(), [])



class FoldersInHomeTest(GroupsTest):
    """The folder tree kept in the home's one database (folders.py), as `folder` and `group` records."""

    test_a_plan_says_who_moves_and_changes_nothing = test_a_move_is_one_call_to_ag = None     # GroupsTest's, run there
    test_an_actor_moved_is_in_its_new_group_with_its_rows = test_a_folder_moves_with_its_folders_and_every_actor_in_them = None
    test_a_task_moves_whole = test_nothing_of_the_dashboard_s_changes_when_ag_did_not_take_the_record = None
    test_a_folder_named_as_one_where_it_would_go_is_refused_before_anything = None
    test_refused_for_no_such_group_or_its_own = test_refused_with_a_database_per_gatherer = None
    test_a_folder_outside_every_group_is_a_group_of_its_own = test_a_new_group_s_name_is_one_no_group_has = None
    test_an_app_does_not_move_between_groups = None
    test_an_actor_on_its_own_is_a_group_of_one = test_an_actor_on_its_own_runs_under_the_group_it_left_and_comes_back = None
    test_an_actor_is_not_taken_out_with_others_of_its_task_nor_the_coordinator = None

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


class GroupAppsTest(GroupsTest):
    """Apps of a task or a folder that moves: `pages` (many instances) goes with it, `board` (one per group) stays;
    `news` (one per group too) goes with its own agent, an actor it started."""

    def setUp(self):
        super().setUp()
        src = os.path.join(self.tmp.name, "apps-src")
        for name, mode in (("pages", "many"), ("board", "one"), ("news", "one")):
            write_app(src, name, NOTES.replace("notes", name).replace('instances = "per-folder"', f'instances = "{mode}"'))
        for patch in (unittest.mock.patch.dict(os.environ, {app_host.PATH_ENV: src}),
                      unittest.mock.patch.object(app_kit.finding, "BUILTIN", os.path.join(self.tmp.name, "no-apps"))):
            patch.start()
            self.addCleanup(patch.stop)
        self.host = app_host.AppHost(0, write=insert_here)
        self.addCleanup(self.host.close)
        placed = unittest.mock.patch.object(tool_gateway, "HOST", self.host)
        placed.start()
        self.addCleanup(placed.stop)
        self.folder = tempfile.mkdtemp(dir=self.tmp.name)

    def test_a_group_read_first_after_a_change_has_it_though_its_record_is_still_being_written(self):
        """In the one database a group's first read (`_load`) reads every group's app records: what the host let go of
        just before -- an agent detached, an instance closed -- whose record its writer has not written yet, stays let
        go (each write slowed here: on a slow machine, as on CI, the read came first and brought them back)."""
        host = app_host.AppHost(0, write=lambda *a: (time.sleep(0.2), insert_here(*a)))
        self.addCleanup(host.close)
        page = host.open("pages", "a", self.folder)
        shut = host.open("pages", "a", self.folder)
        for c in ("c1", "c3"):
            host.attach("a", page.id, c)
        host.flush()
        host.detach("a", page.id, "c3")
        host.close_instance("a", shut.id)
        self.assertEqual(host.instances_of("b"), [])                                  # b's first read: every record
        self.assertEqual(host.agents_of(host.instance("a", page.id)), ["c1"])
        self.assertEqual([i.id for i in host.instances_of("a")], [page.id])

    def test_an_app_of_a_task_that_moves_goes_with_it_and_its_actors_keep_it(self):
        page = self.host.open("pages", "a", self.folder)
        for c in ("c1", "c3"):
            self.host.attach("a", page.id, c)                             # c3: using it, in no task with it
        tasks.add("a", "c1", ["app:" + page.id])
        work = folders.make("a", "Work")
        folders.file("a", ["c1", "app:" + page.id], work)
        plan = groups.plan("a", "b", ["c1"])
        self.assertEqual((plan["actors"], [x["id"] for x in plan["apps"]]), (["c1"], [page.id]))
        self.assertEqual(groups.move("a", "b", folder=work)["apps"], [page.id])
        self.assertEqual([i.id for i in self.host.instances_of("b")], [page.id])     # listed and reached in b
        self.assertEqual(self.host.instances_of("a"), [])
        self.assertEqual([i.id for i in self.host.attached_to("b", "c1")], [page.id])
        self.assertEqual(self.host.agents_of(self.host.instance("b", page.id)), ["c1"])   # c3, staying, let go
        self.assertEqual(folders.of("b")["filed"].get("app:" + page.id), work)        # still in its folder
        self.assertEqual(tasks.stored()["b"]["tasked"]["app:" + page.id], tasks.stored()["b"]["tasked"]["c1"])
        self.host.flush()
        again = app_host.AppHost(0, write=insert_here)                    # read back from the one database
        self.addCleanup(again.close)
        self.assertEqual([i.id for i in again.instances_of("b")], [page.id])
        self.assertEqual(again.agents_of(again.instance("b", page.id)), ["c1"])

    def test_a_group_s_only_one_of_an_app_stays_and_a_move_taking_it_is_refused(self):
        board = self.host.open("board", "a", self.folder)
        tasks.add("a", "c1", ["app:" + board.id])
        with self.assertRaisesRegex(groups.GroupError, "the group's only one"):
            groups.plan("a", "b", ["c1"])
        with self.assertRaises(groups.GroupError):
            groups.move("a", "b", ["c1"])
        self.assertEqual((self.members("a"), [i.id for i in self.host.instances_of("a")]), (["c1", "c3"], [board.id]))

    def test_an_actor_that_moves_or_goes_alone_lets_go_of_the_apps_that_stay(self):
        page = self.host.open("pages", "a", self.folder)
        for c in ("c1", "c3"):
            self.host.attach("a", page.id, c)
        groups.move("a", "b", ["c1"])
        self.assertEqual(self.host.agents_of(page), ["c3"])
        self.assertEqual(self.host.attached_to("b", "c1"), [])
        groups.alone("a", "c3")
        self.assertEqual(self.host.agents_of(page), [])
        self.assertEqual([i.id for i in self.host.instances_of("a")], [page.id])     # the app stays where it was

    def started(self, channel, gatherer, inst):
        """`channel`, of `gatherer`, made the agent the app of `inst` started: its role names it, and it is attached."""
        conn = sqlite3.connect(sessions.db_path())
        try:
            with conn:
                conn.execute(sessions.SCHEMA)
                conn.execute("INSERT INTO sessions (session_id, gatherer, harness, cwd, permission_mode, created_at, "
                             "status, role) VALUES (?, ?, 'claude', '/', 'auto', 'now', 'idle', ?)",
                             (channel, gatherer, app_agents.role(inst.app, inst.id)))
        finally:
            conn.close()
        self.host.attach(gatherer, inst.id, channel)

    def role(self, channel):
        return next(app_agents.role_of(s) for s in sessions.stored() if s["session_id"] == channel)

    def test_an_app_s_own_agent_and_its_window_go_together_whichever_is_dragged(self):
        news = self.host.open("news", "a", self.folder)
        self.started("c1", "a", news)                                     # in no task with it
        for dragged in (["c1"], ["app:" + news.id]):
            plan = groups.plan("a", "b", dragged)
            self.assertEqual((plan["actors"], [x["id"] for x in plan["apps"]]), (["c1"], [news.id]))
            self.assertNotIn("joins", plan["apps"][0])                    # b has no news of its own
        board = self.host.open("board", "a", self.folder)                # one per group, with no agent of its own
        with self.assertRaisesRegex(groups.GroupError, "the group's only one"):
            groups.plan("a", "b", ["app:" + board.id])
        got = groups.move("a", "b", ["app:" + news.id])
        self.assertEqual((got["actors"], got["apps"], got["joined"]), (["c1"], [news.id], {}))
        self.assertEqual([i.id for i in self.host.instances_of("b")], [news.id])
        self.assertEqual(self.host.agents_of(self.host.instance("b", news.id)), ["c1"])
        self.assertEqual([i.id for i in self.host.instances_of("a")], [board.id])

    def test_into_a_group_with_its_own_one_the_window_closes_and_its_agent_works_with_that_one(self):
        news, theirs = self.host.open("news", "a", self.folder), self.host.open("news", "b", self.folder)
        self.started("c1", "a", news)
        tasks.add("a", "c1", ["app:" + news.id])
        [said] = groups.plan("a", "b", ["c1"])["apps"]
        self.assertEqual(said["joins"]["id"], theirs.id)
        got = groups.move("a", "b", ["c1"])
        self.assertEqual((got["apps"], got["joined"]), ([], {news.id: theirs.id}))
        self.assertEqual(self.host.instances_of("a"), [])                # closed: b's is the one
        self.assertEqual([i.id for i in self.host.instances_of("b")], [theirs.id])
        self.assertEqual(self.host.agents_of(theirs), ["c1"])
        self.assertEqual(self.role("c1"), ("news", theirs.id))           # not the closed one, made again at a start
        b = tasks.stored()["b"]["tasked"]
        self.assertEqual(b["c1"], b["app:" + theirs.id])
        self.assertNotIn("app:" + news.id, {**tasks.stored().get("a", {}).get("tasked", {}), **b})
        self.host.flush()
        again = app_host.AppHost(0, write=insert_here)                    # read back from the one database
        self.addCleanup(again.close)
        self.assertEqual([i.id for i in again.instances_of("b")], [theirs.id])
        self.assertEqual(again.agents_of(again.instance("b", theirs.id)), ["c1"])

    def test_an_app_s_agent_goes_on_its_own_with_its_window_and_its_task_s_apps_and_comes_back(self):
        news, page = self.host.open("news", "a", self.folder), self.host.open("pages", "a", self.folder)
        self.started("c1", "a", news)
        tasks.add("a", "c1", ["app:" + page.id])
        self.host.attach("a", page.id, "c1")
        got = groups.alone("a", "c1")
        self.assertEqual((got["group"], got["actors"], sorted(got["apps"])), ("self:c1", ["c1"], sorted([news.id, page.id])))
        self.assertEqual(sorted(i.id for i in self.host.instances_of("self:c1")), sorted([news.id, page.id]))
        self.assertEqual(self.host.agents_of(news), ["c1"])
        self.assertEqual(self.host.instances_of("a"), [])
        self.assertEqual(tasks.stored()["self:c1"]["tasked"]["app:" + page.id], tasks.stored()["self:c1"]["tasked"]["c1"])
        self.host.flush()                                                 # its records written as the group it left:
        self.assertEqual(sorted(os.listdir(paths.TRACE_DIR)), ["a", "b"])  # no gatherer made for its group of one
        groups.move("self:c1", "b", ["c1"])
        self.assertEqual(sorted(i.id for i in self.host.instances_of("b")), sorted([news.id, page.id]))
        self.assertEqual(data.alone_names(), [])

    def test_an_actor_on_its_own_is_not_one_with_an_actor_in_its_task_nor_a_window_it_can_t_take(self):
        board = self.host.open("board", "a", self.folder)
        tasks.add("a", "c1", ["app:" + board.id])
        with self.assertRaisesRegex(groups.GroupError, "the group's only one"):
            groups.alone("a", "c1")
        self.assertEqual((self.members("a"), [i.id for i in self.host.instances_of("a")]), (["c1", "c3"], [board.id]))

