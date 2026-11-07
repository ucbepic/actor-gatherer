"""The context manager's home (`ag.ag_harness.home`): the registry of
policies and pollers in config.toml, plugins, and each gatherer's config.

Every test runs in a home of its own in a temporary directory; the real
~/.ag is never touched."""

import os
import sqlite3
import sys
import tempfile
import textwrap
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag.ag_harness import FORMAT, Manager  # noqa: E402
from ag.ag_harness import home as ag_home  # noqa: E402
import codex_items as codex  # noqa: E402
from ag.ag_harness.home import ConfigError, Home  # noqa: E402
from ag.ag_harness.home.__main__ import main as cli  # noqa: E402
from ag.ag_pollers import FileChangePoller  # noqa: E402
from ag.ag_harness.store import paths  # noqa: E402

TICKETS = '''
from ag.ag_interface import Event, Poller


class TicketPoller(Poller):
    outputs = ("context_stream",)

    def __init__(self, ticket, cwd=""):
        self.ticket, self.cwd = ticket, cwd
        self.name = f"tickets:{ticket}"

    def poll(self, since, types):
        type_id = next((t.id for t in types if t.name == "context_stream"), None)   # its own type, by name
        if type_id is None:
            return []
        return [Event(type_id, {"stream": f"ticket {self.ticket}", "author": "pat", "text": "use the APAC numbers",
                                "timestamp": 1790000000}, id=f"context_stream:ticket {self.ticket}:1790000000")]
'''

MINE = '''
from ag.ag_interface.policy import Context, Policy
from ag.ag_policies.proactive_context_manager.events import EVENT_TYPES
from ag.ag_harness.store import operations as store
from channels import ch, on  # noqa: E402


class Everything(Policy):
    """Returns every row it can see: a policy of the user's own."""
    name = "everything"
    event_types = EVENT_TYPES

    def __init__(self, format, options):
        self.format, self.options = format, options

    def read(self, conn, read):
        rows = store.rows(conn, match=read.properties)
        return Context([r.payload for r in rows], [], None)
'''


class HomeBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self.tmp.name, "ag")
        self.saved = paths.TRACE_DIR, paths.AG_HOME
        paths.AG_HOME, paths.TRACE_DIR = self.root, os.path.join(self.root, "gatherers")
        ag_home._HOMES.clear()
        self.h = Home(self.root)

    def tearDown(self):
        paths.TRACE_DIR, paths.AG_HOME = self.saved
        ag_home._HOMES.clear()
        self.tmp.cleanup()

    def config(self, extra: str, replace: bool = False) -> None:
        """config.toml: the template plus `extra`, or `extra` alone."""
        self.h.ensure()
        with open(self.h.config_path, "w" if replace else "a") as fh:
            fh.write("\n" + textwrap.dedent(extra))

    def plugin(self, name: str, source: str) -> None:
        self.h.ensure()
        with open(os.path.join(self.h.plugins, name), "w") as fh:
            fh.write(source)


class RegistryTest(HomeBase):
    def test_a_new_home_lists_every_built_in(self):
        self.h.ensure()
        self.assertTrue(os.path.isdir(self.h.plugins))
        policies = self.h.policies()
        self.assertEqual(sorted(policies), ["proactive_context_manager"])
        self.assertEqual(self.h.default_pollers(), ["file_changes"])                  # a policy has none
        self.assertEqual(list(self.h.pollers()), ["file_changes"])
        self.assertEqual(self.h.default_policy(), "proactive_context_manager")
        self.assertEqual(self.h.problems(), [])

    def test_plugins_and_variants(self):
        self.plugin("tickets.py", TICKETS)
        self.plugin("mine.py", MINE)
        self.config('''
            [pollers.available.tickets]
            file = "tickets.py"
            class = "TicketPoller"
            args = { ticket = "4123", cwd = "{cwd}" }

            [policies.available.pcm_small]
            class = "ag.ag_policies.proactive_context_manager:ProactiveContextManager"
            options = { min_context_tokens = 5 }

            [policies.available.mine]
            file = "mine.py"
            class = "Everything"
            options = { depth = 2 }
        ''')
        self.assertEqual(self.h.problems(), [])
        policies, pollers = self.h.policies(), self.h.pollers()
        self.assertEqual((policies["pcm_small"].origin, policies["mine"].origin),
                         ("ag.ag_policies.proactive_context_manager:ProactiveContextManager", "mine.py:Everything"))
        poller = self.h.build_poller(pollers["tickets"], "s", "/w")
        self.assertEqual((type(poller).__name__, poller.ticket, poller.cwd), ("TicketPoller", "4123", "/w"))
        self.assertEqual(poller.id, "tickets")                                   # its name in the catalog
        self.assertIsNone(self.h.build_poller(pollers["tickets"], "s", None))   # needs a cwd the request lacks
        small = self.h.build_policy(policies["pcm_small"], {})
        self.assertEqual((small.name, small.config.min_context_tokens), ("proactive_context_manager", 5))
        self.assertEqual((small.jobs.factory, small.jobs.paths[-1]), ("ag.ag_harness.home:manager", self.h.plugins))
        self.assertIsNotNone(small.tokenizer)                                        # given by the home
        mine = self.h.build_policy(policies["mine"], {"depth": 3})
        self.assertEqual((mine.name, mine.options), ("everything", {"depth": 3}))   # the gatherer's options win

    def test_a_poller_without_outputs_is_refused(self):
        self.plugin("silent.py", "from ag.ag_interface import Poller\n\n"
                    "class Silent(Poller):\n    def poll(self, since, types):\n        return []\n")
        self.config('''
            [pollers.available.silent]
            file = "silent.py"
            class = "Silent"
        ''')
        self.assertIn("declares no outputs", "\n".join(self.h.problems()))

    def test_problems_are_named(self):
        self.config('''
            [pollers]
            default = ["file_changes", "missing"]

            [pollers.available.file_changes]
            class = "ag.ag_pollers.file_changes:FileChangePoller"
            args = { root = "{cwd}" }

            [pollers.available.ghost]
            file = "nope.py"
            class = "Ghost"

            [pollers.available.odd]
            class = "ag.ag_pollers:NoSuchPoller"

            [policies.available.pcm]
            class = "ag.ag_policies.proactive_context_manager:ProactiveContextManager"
        ''', replace=True)
        problems = "\n".join(self.h.problems())
        self.assertIn("nope.py does not exist", problems)
        self.assertIn("no NoSuchPoller in ag.ag_pollers", problems)
        self.assertIn("[pollers] default names missing", problems)

    def test_a_policy_names_no_pollers(self):
        self.config('''
            [policies.available.pcm]
            class = "ag.ag_policies.proactive_context_manager:ProactiveContextManager"
            pollers = ["file_changes"]
        ''', replace=True)
        with self.assertRaisesRegex(ConfigError, "a policy has none"):
            self.h.policies()

    def test_a_new_gatherer_gets_the_default_pollers_whatever_its_policy(self):
        self.config('''
            [policies]
            default = "proactive_context_manager"
            [policies.available.proactive_context_manager]
            class = "ag.ag_policies.proactive_context_manager:ProactiveContextManager"
            [pollers]
            default = ["file_changes"]
            [pollers.available.file_changes]
            class = "ag.ag_pollers.file_changes:FileChangePoller"
            args = { root = "{cwd}" }
        ''', replace=True)
        cfg = self.h.gatherer("fresh")
        self.assertEqual((cfg.policy, cfg.pollers), ("proactive_context_manager", ["file_changes"]))   # not filtered by the policy

    def test_bad_options_are_refused(self):
        self.config('''
            [policies.available.pcm]
            class = "ag.ag_policies.proactive_context_manager:ProactiveContextManager"
            options = { no_such_field = 1 }
        ''', replace=True)
        with self.assertRaises(ConfigError) as caught:
            self.h.build_policy(self.h.policies()["pcm"], {})
        self.assertIn("bad options", str(caught.exception))


class GathererTest(HomeBase):
    def test_a_gatherer_config_is_made_from_the_defaults_the_first_time(self):
        cfg = self.h.gatherer("demo")
        self.assertEqual(cfg.path, os.path.join(self.root, "gatherers", "demo", "gatherer.toml"))
        self.assertEqual((cfg.policy, cfg.pollers, cfg.options), ("proactive_context_manager", ["file_changes"], {}))
        with open(cfg.path, "a") as fh:
            fh.write("min_context_tokens = 7\n")                          # under [options]
        self.assertEqual(self.h.gatherer("demo").options, {"min_context_tokens": 7})
        manager = self.h.manager("demo")
        self.assertIsInstance(manager, Manager)
        self.assertEqual(manager.policy.config.min_context_tokens, 7)
        self.assertIs(manager.policy.format, FORMAT)                         # ag messages, whatever the harness
        with self.assertRaises(ConfigError):
            self.h.gatherer("never", create=False)

    def test_pollers_follow_the_gatherer_file(self):
        self.plugin("tickets.py", TICKETS)
        self.config('''
            [pollers.available.tickets]
            file = "tickets.py"
            class = "TicketPoller"
            args = { ticket = "9" }
        ''')
        first = self.h.gatherer_pollers("demo", "/w")
        self.assertEqual([type(p) for p in first], [FileChangePoller])
        self.assertIs(self.h.gatherer_pollers("demo", "/w"), first)             # not remade while nothing changed
        cfg = self.h.gatherer("demo")
        cfg.pollers = ["file_changes", "tickets"]
        self.h.write_gatherer(cfg)
        os.utime(cfg.path, (os.path.getmtime(cfg.path) + 5,) * 2)
        self.assertEqual([type(p).__name__ for p in self.h.gatherer_pollers("demo", "/w")],
                         ["FileChangePoller", "TicketPoller"])
        cfg.pollers = ["nobody"]
        self.h.write_gatherer(cfg)
        os.utime(cfg.path, (os.path.getmtime(cfg.path) + 10,) * 2)
        with self.assertRaises(ConfigError):
            self.h.gatherer_pollers("demo", "/w")

    def test_a_gatherer_keeps_its_policy(self):
        manager = codex.CodexItems(self.h.manager("demo"))
        manager.init("demo")
        manager.insert("demo", {"type": "message", "role": "user", "id": "u1",
                                "content": [{"type": "input_text", "text": "q"}]}, channel_id="t")
        manager.read("demo", 1, channel_id="t")                            # read with the default
        self.plugin("mine.py", MINE)                                       # a policy of another name
        self.config('''
            [policies.available.other]
            file = "mine.py"
            class = "Everything"
        ''')
        cfg = self.h.gatherer("demo")
        cfg.policy = "other"
        self.h.write_gatherer(cfg)
        with self.assertRaises(ConfigError) as caught:
            self.h.manager("demo")
        self.assertIn("keeps its policy", str(caught.exception))
        cfg.policy = "proactive_context_manager"                             # back: fine
        self.h.write_gatherer(cfg)
        self.h.manager("demo")

    def test_the_module_functions(self):
        self.assertIsInstance(ag_home.manager("s1"), Manager)
        self.assertEqual([type(p) for p in ag_home.pollers("s1", "/w")], [FileChangePoller])


class PluginEndToEndTest(HomeBase):
    """A user's own poller, registered in config.toml and chosen by a
    gatherer, feeds the policy through the manager."""

    def test_a_plugin_poller_s_message_reaches_the_context(self):
        self.plugin("tickets.py", TICKETS)
        self.config('''
            [pollers.available.tickets]
            file = "tickets.py"
            class = "TicketPoller"
            args = { ticket = "4123" }
        ''')
        self.assertEqual(cli(["new", "demo", "--policy", "proactive_context_manager", "--poller", "tickets"]), 0)
        manager = codex.CodexItems(ag_home.manager("demo"))
        manager.set_pollers(ag_home.pollers("demo", None))
        manager.init("demo")
        row = manager.insert("demo", {"type": "message", "role": "user", "id": "u1",
                                      "content": [{"type": "input_text", "text": "which numbers?"}]}, channel_id="t")
        texts = [t for t in (codex.text(i) for i in manager.read("demo", row, channel_id="t"))
                 if not t.startswith("About this context, from the gatherer.")]               # the gatherer guide
        self.assertEqual(texts[0], "which numbers?")
        self.assertIn("Message in ticket 4123 from pat", texts[1])
        conn = sqlite3.connect(paths.db_path("demo"))
        self.assertEqual(conn.execute("SELECT p_channel FROM events WHERE event_id LIKE 'context_stream:%'")
                         .fetchall(), [(None,)])                              # in the pool: every thread's
        conn.close()


class AppPollerTest(HomeBase):
    """An app's pollers (its manifest's [[pollers]], app_kit's): entries of ag's own catalog, as `<app>.<name>`, built
    as any is and checked against the policy as any is; run by a gatherer that names them, or its app in `apps`."""

    def setUp(self):
        super().setUp()
        folder = os.path.join(self.root, "apps", "tickets_app")
        os.makedirs(folder)
        with open(os.path.join(folder, "app.toml"), "w") as fh:
            fh.write(textwrap.dedent('''
                name = "tickets_app"
                label = "Tickets"
                version = "1"

                [[pollers]]
                name = "inbox"
                file = "inbox.py"
                class = "TicketPoller"
                args = { ticket = "77" }
            '''))
        with open(os.path.join(folder, "inbox.py"), "w") as fh:
            fh.write(TICKETS)

    def run_with(self, line: str):
        cfg = self.h.gatherer("demo")
        with open(cfg.path) as fh:
            text = fh.read()
        with open(cfg.path, "w") as fh:                                     # before [options]: a top-level key
            fh.write(line + "\n" + text)
        os.utime(cfg.path, (os.path.getmtime(cfg.path) + 5,) * 2)
        return [type(p).__name__ for p in self.h.gatherer_pollers("demo", "/w")]

    def test_an_app_s_poller_is_in_the_catalog_under_its_app_s_name(self):
        self.h.ensure()
        spec = self.h.pollers()["tickets_app.inbox"]
        self.assertEqual((spec.cls, spec.args), ("TicketPoller", {"ticket": "77"}))
        self.assertEqual(spec.file, os.path.join(self.root, "apps", "tickets_app", "inbox.py"))
        self.assertEqual(self.h.problems(), [])

    def test_a_gatherer_runs_it_once_its_app_is_on_there_or_it_names_it(self):
        self.h.ensure()
        self.assertEqual([type(p).__name__ for p in self.h.gatherer_pollers("demo", "/w")], ["FileChangePoller"])
        self.assertEqual(self.run_with('apps = ["tickets_app"]'), ["FileChangePoller", "TicketPoller"])
        cfg = self.h.gatherer("demo")
        self.assertEqual(cfg.apps, ["tickets_app"])
        self.h.write_gatherer(cfg)                                            # written back: `apps` kept
        self.assertEqual(self.h.gatherer("demo").apps, ["tickets_app"])
        cfg.apps, cfg.pollers = None, ["tickets_app.inbox"]
        self.h.write_gatherer(cfg)
        os.utime(cfg.path, (os.path.getmtime(cfg.path) + 10,) * 2)
        self.assertEqual([type(p).__name__ for p in self.h.gatherer_pollers("demo", "/w")], ["TicketPoller"])

    def test_its_message_reaches_the_context_as_any_poller_s(self):
        self.assertEqual(cli(["new", "demo", "--policy", "proactive_context_manager", "--poller", "tickets_app.inbox"]), 0)
        manager = codex.CodexItems(ag_home.manager("demo"))
        manager.set_pollers(ag_home.pollers("demo", None))
        manager.init("demo")
        row = manager.insert("demo", {"type": "message", "role": "user", "id": "u1",
                                      "content": [{"type": "input_text", "text": "which numbers?"}]}, channel_id="t")
        texts = [t for t in (codex.text(i) for i in manager.read("demo", row, channel_id="t"))
                 if not t.startswith("About this context, from the gatherer.")]
        self.assertIn("Message in ticket 77 from pat", texts[1])


class CliTest(HomeBase):
    def test_list_show_new(self):
        from contextlib import redirect_stdout
        from io import StringIO
        out = StringIO()
        with redirect_stdout(out):
            self.assertEqual(cli(["list"]), 0)
        self.assertIn("proactive_context_manager", out.getvalue())
        self.assertIn("no problems", out.getvalue())
        with redirect_stdout(StringIO()):
            self.assertEqual(cli(["new", "demo", "--policy", "proactive_context_manager"]), 0)
            self.assertEqual(cli(["new", "demo"]), 1)                          # exists
            self.assertEqual(cli(["new", "x", "--policy", "nope"]), 1)
            self.assertEqual(cli(["new", "y", "--poller", "nope"]), 1)
        out = StringIO()
        with redirect_stdout(out):
            self.assertEqual(cli(["show", "demo"]), 0)
        self.assertIn("policy:  proactive_context_manager", out.getvalue())


    def test_gatherers(self):
        from contextlib import redirect_stdout
        from io import StringIO
        out = StringIO()
        with redirect_stdout(out):
            self.assertEqual(cli(["gatherers"]), 0)
        self.assertIn("no gatherers", out.getvalue())
        with redirect_stdout(StringIO()):
            self.assertEqual(cli(["new", "quiet", "--policy", "proactive_context_manager", "--no-pollers"]), 0)
        busy = codex.CodexItems(self.h.manager("busy"))
        busy.init("busy")
        for n, thread in ((1, "t1"), (2, "t2"), (3, "t1")):
            busy.insert("busy", {"type": "message", "role": "user", "id": f"u{n}",
                                 "content": [{"type": "input_text", "text": "q"}]}, channel_id=thread)
        out = StringIO()
        with redirect_stdout(out):
            self.assertEqual(cli(["gatherers"]), 0)
        lines = out.getvalue().splitlines()
        self.assertTrue(lines[1].lstrip().startswith("busy"))                 # the latest activity first
        self.assertIn("3 events", lines[1])
        self.assertIn("channel 2", lines[1])                                  # two threads
        self.assertIn("quiet", lines[2])
        self.assertIn("proactive_context_manager", lines[2])
        self.assertIn("no database yet", lines[2])


class LlmProblemTest(HomeBase):
    def test_a_codex_model_needs_the_codex_sdk(self):
        import importlib.util
        from unittest import mock
        with mock.patch.dict(os.environ, {"AG_LLM_MODEL": "codex/gpt-6-sol"}):
            with mock.patch.object(importlib.util, "find_spec", return_value=None):
                self.assertIn("pip install openai-codex", self.h.llm_problem())
            with mock.patch.object(importlib.util, "find_spec", return_value=object()):
                self.assertEqual(self.h.llm_problem(), "")
        for model in ("claude-code/sonnet", "gemini/gemini-3.8-flash", ""):
            with mock.patch.dict(os.environ, {"AG_LLM_MODEL": model}):
                with mock.patch.object(importlib.util, "find_spec", return_value=None):
                    self.assertEqual(self.h.llm_problem(), "", model)

if __name__ == "__main__":
    unittest.main()
