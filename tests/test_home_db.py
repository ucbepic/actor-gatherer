"""The home's one database (`ag home merge`'s): once `<home>/context.db` exists, every gatherer's database is that one
(ag's paths.merged), and a gatherer is a group of its channels -- those whose latest `group` record names it. The
dashboard lists each gatherer's actors as those of its group."""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ag.ag_harness import Manager  # noqa: E402
from ag.ag_harness.store import paths  # noqa: E402
from ag.ag_policies.proactive_context_manager import ProactiveContextManager  # noqa: E402
from ag_dashboard import data  # noqa: E402
from ag_dashboard import home as dashboard_home  # noqa: E402
import codex_items  # noqa: E402
from channels import ch  # noqa: E402
from replies import insert  # noqa: E402
from test_core import PREAMBLE, ScriptedLLM, conversation  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
