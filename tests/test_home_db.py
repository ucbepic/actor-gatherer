"""The home's one database (`ag home merge`'s): once `<home>/context.db` exists, every gatherer's database is that one
(ag's paths.merged), and a gatherer is a group of its channels -- those whose latest `group` record names it. The
dashboard lists each gatherer's actors as those of its group."""
import os
import sys
import json
import sqlite3
import tempfile
import unittest
import unittest.mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ag.ag_harness import Manager  # noqa: E402
from ag.ag_harness.store import paths  # noqa: E402
from ag.ag_policies.proactive_context_manager import ProactiveContextManager  # noqa: E402
from ag_dashboard import app_host, data, history, livedocs  # noqa: E402
import app_kit  # noqa: E402
from ag_dashboard import home as dashboard_home  # noqa: E402
import codex_items  # noqa: E402
from channels import ch  # noqa: E402
from replies import insert  # noqa: E402
from test_core import PREAMBLE, ScriptedLLM, conversation  # noqa: E402
from test_dashboard_app_host import NOTES, insert_here, write_app  # noqa: E402
import test_server  # noqa: E402


class PathsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = paths.TRACE_DIR
        paths.TRACE_DIR = os.path.join(self.tmp.name, "gatherers")

    def tearDown(self):
        paths.TRACE_DIR = self.saved
        self.tmp.cleanup()

    def test_each_gatherer_has_its_own_database_until_the_home_has_one(self):
        self.assertFalse(paths.merged())
        self.assertNotEqual(paths.db_path("a"), paths.db_path("b"))
        open(paths.home_db(), "w").close()
        self.assertTrue(paths.merged())
        self.assertEqual(paths.db_path("a"), paths.home_db())
        self.assertEqual(paths.db_path("b"), paths.home_db())
        self.assertEqual(paths.home_db(), os.path.join(self.tmp.name, "context.db"))


class MergedHomeTest(unittest.TestCase):
    """Gatherers `a` and `b` in the home's one database: c1 and c3 in group a, c2 in group b."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = paths.TRACE_DIR, paths.AG_HOME
        paths.AG_HOME = os.path.join(self.tmp.name, "ag")
        paths.TRACE_DIR = os.path.join(paths.AG_HOME, "gatherers")
        self.saved_home, dashboard_home.HOME = dashboard_home.HOME, paths.AG_HOME
        for g in ("a", "b"):
            os.makedirs(os.path.join(paths.TRACE_DIR, g))
            with open(os.path.join(paths.TRACE_DIR, g, "gatherer.toml"), "w") as fh:
                fh.write('policy = "proactive_context_manager"\n')
        open(paths.home_db(), "w").close()                       # the home's one database
        self.m = Manager(ProactiveContextManager(codex_items.FORMAT, ScriptedLLM(), options={"min_context_tokens": 0}))
        items = codex_items.CodexItems(self.m)
        for gatherer, channel in (("a", "c1"), ("b", "c2"), ("a", "c3")):
            self.m.init(gatherer)
            insert(self.m, gatherer, ch(channel), [{"type": "group", "id": f"group:{channel}:1",
                                                    "payload": {"group": gatherer}}])
            for item in PREAMBLE + conversation(2, prefix=f"{channel} "):
                items.insert(gatherer, item, channel_id=channel)

    def tearDown(self):
        paths.TRACE_DIR, paths.AG_HOME = self.saved
        dashboard_home.HOME = self.saved_home
        self.tmp.cleanup()

    def listed(self, h):
        return {g["name"]: sorted(a["channel"] for a in g["agents"]) for g in h["gatherers"]}

    def test_every_gatherer_s_work_is_in_the_one_database(self):
        self.assertFalse(os.path.exists(os.path.join(paths.TRACE_DIR, "a", "context.db")))
        self.assertFalse(os.path.exists(os.path.join(paths.TRACE_DIR, "b", "context.db")))

    def test_each_gatherer_lists_the_actors_of_its_group(self):
        self.assertEqual(self.listed(data.home([])), {"a": ["c1", "c3"], "b": ["c2"]})

    def test_so_does_a_home_kept_between_reads(self):
        kept = data.Kept()
        self.assertEqual(self.listed(data.home([], kept)), {"a": ["c1", "c3"], "b": ["c2"]})
        kept.changed("a", "c2")                                  # told of another group's channel: not listed under a
        self.assertEqual(self.listed(data.home([], kept)), {"a": ["c1", "c3"], "b": ["c2"]})

    def test_one_gatherer_read_alone(self):
        self.assertEqual(sorted(a["channel"] for a in data.gatherer_actors("b", [])), ["c2"])

    def test_an_actor_whose_group_changed_is_listed_under_its_new_one(self):
        insert(self.m, "a", ch("c3"), [{"type": "group", "id": "group:c3:2", "payload": {"group": "b", "was": "a"}}])
        self.assertEqual(self.listed(data.home([])), {"a": ["c1"], "b": ["c2", "c3"]})


    def test_history_shows_a_gatherer_its_group_s_events_alone(self):
        self.assertEqual({e["channel"] for e in history.outline("a")["events"]}, {"c1", "c3"})
        self.assertEqual({e["channel"] for e in history.outline("b")["events"]}, {"c2"})
        self.assertEqual(set(history.outline("a")["builds"]), {"c1", "c3"})

    def test_history_search_keeps_to_the_group(self):
        self.assertEqual(history.search("a", None, "c2 question")["hits"], [])
        self.assertTrue(history.search("b", None, "c2 question")["hits"])
        self.assertTrue(history.search("a", None, "c3 question")["hits"])


    def test_a_file_s_writers_are_read_once_each_under_its_own_gatherer(self):
        for gatherer, channel, path in (("a", "c1", "/w/one.txt"), ("b", "c2", "/w/two.txt")):
            insert(self.m, gatherer, ch(channel), [{"type": "file_touched", "id": f"touch:{channel}",
                                                    "payload": {"path": path, "how": "modified"}}])
        found = livedocs.writers(["/w"], 0)
        self.assertEqual({rel: [(w["gatherer"], w["channel"]) for w in ws] for rel, ws in found.items()},
                         {"one.txt": [("a", "c1")], "two.txt": [("b", "c2")]})

class MergedAppsTest(MergedHomeTest):
    """Apps in the home's one database: a gatherer's are the instances opened in it."""

    def setUp(self):
        super().setUp()
        apps = os.path.join(self.tmp.name, "apps-src")
        write_app(apps, "notes", NOTES.replace('reads = ["user_message"]', 'reads = ["user_message"]\nnotify = true'))
        for patch in (unittest.mock.patch.dict(os.environ, {app_host.PATH_ENV: apps}),
                      unittest.mock.patch.object(app_kit.finding, "BUILTIN", os.path.join(self.tmp.name, "no-apps"))):
            patch.start()
            self.addCleanup(patch.stop)
        self.hosts = []
        self.folder = tempfile.mkdtemp(dir=self.tmp.name)

    def tearDown(self):
        for h in self.hosts:                                         # closed before the home goes
            h.close()
        super().tearDown()

    def new_host(self):
        h = app_host.AppHost(0, write=insert_here)
        self.hosts.append(h)
        return h

    def test_a_gatherer_has_the_instances_opened_in_it(self):
        host = self.new_host()
        a = host.open("notes", "a", self.folder, {"title": "A's"})
        host.flush()
        again = self.new_host()                                       # read back from the one database
        self.assertEqual([i.id for i in again.instances_of("a")], [a.id])
        self.assertEqual(again.instances_of("b"), [])

    def test_a_gatherer_has_the_notices_of_its_instances(self):
        host = self.new_host()
        a = host.open("notes", "a", self.folder)
        host.notify("notes", a, "A note for a")
        host.flush()
        listed = {g["name"]: g["apps"] for g in data.home([])["gatherers"]}
        self.assertEqual(list(listed["a"]), [a.id])
        self.assertEqual(listed["b"], {})

    def test_an_app_s_context_with_no_channel_names_its_group(self):
        host = self.new_host()
        a = host.open("notes", "a", self.folder)
        host.insert("notes", a, [{"type": "context_stream", "text": "news",
                                  "payload": {"stream": "#x", "author": "bot", "text": "news", "timestamp": 1}}])
        host.flush()
        conn = self.m._conn("a")
        (raw,) = conn.execute("SELECT e.payload_json FROM events e JOIN event_types t ON t.event_type_id = "
                              "e.event_type_id WHERE t.name = 'context_stream'").fetchone()
        self.assertEqual(json.loads(raw)["group"], "a")


class FirstGroupTest(test_server.HomeBase):
    """In the home's one database ag's server puts a `group` record -- the gatherer the conversation was started under --
    before a conversation's first event, so that every conversation there is in a group; never over one it has."""

    def setUp(self):
        super().setUp()
        os.makedirs(paths.TRACE_DIR)
        open(paths.home_db(), "w").close()

    def stored(self):
        conn = sqlite3.connect(paths.home_db())
        try:
            return [(r, c, t, json.loads(p).get("group") if t == "group" else None) for r, c, t, p in conn.execute(
                "SELECT e.row_id, e.p_channel, t.name, e.payload_json FROM events e JOIN event_types t "
                "ON t.event_type_id = e.event_type_id ORDER BY e.row_id")]
        finally:
            conn.close()

    def groups(self):
        return [(c, g) for _, c, t, g in self.stored() if t == "group"]

    def put(self, gatherer, channel, *items):
        return self.ask({"op": "insert", "gatherer": gatherer, "properties": {"channel": channel},
                         "events": test_server.events(*items)})

    def test_a_conversation_starts_in_the_group_of_its_gatherer(self):
        self.put("a", "c1", test_server.DEV, test_server.user("q", 1))
        self.put("b", "c2", test_server.DEV, test_server.user("q", 1))
        self.put("a", "c1", test_server.user("more", 2))
        self.assertEqual(self.groups(), [("c1", "a"), ("c2", "b")])
        ids = [e for (e,) in sqlite3.connect(paths.home_db()).execute(
            "SELECT e.event_id FROM events e JOIN event_types t ON t.event_type_id = e.event_type_id WHERE t.name = 'group'")]
        self.assertEqual(len(set(ids)), 2)              # one id each: a read returns an id once, whatever its channel
        self.assertEqual(next(t for _, c, t, _ in self.stored() if c == "c1"), "group")     # before its first event

    def test_never_over_a_record_it_has(self):
        self.put("a", "c1", test_server.DEV)
        self.ask({"op": "insert", "gatherer": "a", "properties": {"channel": "c1"},
                  "events": [{"type": "group", "id": "group:moved", "payload": {"group": "x", "was": "a"}}]})
        self.put("a", "c1", test_server.user("q", 1))                     # a new process: nothing known of c1
        self.assertEqual(self.groups(), [("c1", "a"), ("c1", "x")])

    def test_none_while_each_gatherer_has_a_database_of_its_own(self):
        os.remove(paths.home_db())
        self.put("a", "c1", test_server.DEV)
        conn = sqlite3.connect(paths.db_path("a"))
        try:
            self.assertEqual(conn.execute("SELECT count(*) FROM event_types WHERE name = 'group'").fetchone()[0], 0)
        finally:
            conn.close()


class MigrationsTest(unittest.TestCase):
    """ag's migrations of a file an older ag wrote find the home's one database: every gatherer's, by any one name."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        for g in ("a", "b"):
            os.makedirs(os.path.join(self.tmp.name, "gatherers", g))
        conn = sqlite3.connect(os.path.join(self.tmp.name, "context.db"))
        conn.execute("CREATE TABLE _read_items (x)")                  # a read log one row per item: due to move
        conn.commit()
        conn.close()

    def test_ag_s_start_moves_the_home_database_once(self):
        from ag.cli import config as cli_config, main as cli
        with unittest.mock.patch.object(cli_config, "home", return_value=self.tmp.name), \
                unittest.mock.patch.object(cli.subprocess, "Popen") as popen:
            cli.migrations(quiet=True)
        self.assertEqual(popen.call_args.args[0][1:], ["-m", "ag.ag_harness.home", "migrate", "a"])

    def test_the_hooks_migration_names_it_once(self):
        from ag.integrations.tools.ag_orchestrator import migrate
        with unittest.mock.patch.object(migrate, "home", return_value=self.tmp.name):
            self.assertEqual(migrate.gatherers(), ["a"])

if __name__ == "__main__":
    unittest.main()
