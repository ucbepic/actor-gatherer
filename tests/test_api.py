"""The module-level API: exports, the contract, a policy under a Manager, paths."""

import inspect
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import ag.ag_harness  # noqa: E402
import codex_items as codex  # noqa: E402
from ag.ag_harness import Manager  # noqa: E402
from ag.ag_policies.proactive_context_manager import ProactiveContextManager, ProactiveContextManagerConfig  # noqa: E402
from ag.ag_harness.store import paths  # noqa: E402
from ag.ag_interface import LLM, ContextManager, Event, EventType, Property  # noqa: E402
from ag.ag_policies.tools.groups import USER_MESSAGE  # noqa: E402
from ag.ag_interface import Context, Policy  # noqa: E402
from channels import CHANNEL, ch, on  # noqa: E402


class ApiTest(unittest.TestCase):
    def test_exports(self):
        self.assertEqual(ag.ag_harness.__all__,
                         ["ContextManager", "Event", "EventType", "Format", "AgFormat", "FORMAT", "AG", "is_ag",
                          "LLM", "Poller", "Tokenizer",
                          "Manager", "Policy", "Read", "Context", "TypeIds", "db_path"])
        from ag import ag_interface                                         # the contract defines no event type
        for name in ("TYPES", "USER_MESSAGE", "ENVIRONMENT_UPDATE_TYPE", "context_stream"):
            self.assertFalse(hasattr(ag_interface, name), name)

    def test_signatures(self):
        def params(f):
            return [p for p in inspect.signature(f).parameters if p != "self"]
        self.assertEqual(params(Manager.init), ["gatherer_id", "event_types"])
        self.assertEqual(params(Manager.add_event_type), ["gatherer_id", "event_type"])
        self.assertEqual(params(Manager.insert), ["gatherer_id", "event"])
        self.assertEqual(params(Manager.locate), ["gatherer_id", "event_id", "properties"])
        self.assertEqual(params(Manager.read), ["gatherer_id", "row_id", "properties"])
        self.assertEqual(params(Manager.event_types), ["gatherer_id"])

    def test_db_path(self):
        gatherers = os.path.join(paths.AG_HOME, "gatherers")                     # ~/.ag/gatherers, or AG_HOME's
        self.assertEqual(paths.TRACE_DIR, gatherers)
        saved = paths.TRACE_DIR, paths.AG_HOME
        with tempfile.TemporaryDirectory() as tmp:                               # a home with a database per gatherer:
            paths.AG_HOME = os.path.join(tmp, "ag")                              # not the reader's, which may be merged
            paths.TRACE_DIR = os.path.join(paths.AG_HOME, "gatherers")
            try:
                self.assertEqual(ag.ag_harness.db_path("a/b c"), os.path.join(paths.TRACE_DIR, "a_b_c", "context.db"))
                self.assertEqual(ag.ag_harness.db_path(""), os.path.join(paths.TRACE_DIR, "unknown", "context.db"))
            finally:
                paths.TRACE_DIR, paths.AG_HOME = saved

    def test_logs_follow_the_gatherers(self):
        saved = paths.TRACE_DIR
        try:
            paths.TRACE_DIR = os.path.join("/elsewhere", "gatherers")                # as the store's tests do
            self.assertEqual(paths.worker_log("s"), "/elsewhere/logs/gatherers/s/worker.log")
            self.assertEqual(paths.server_log("a/b"), "/elsewhere/logs/gatherers/a_b/server.log")
        finally:
            paths.TRACE_DIR = saved

    def test_events(self):
        t = EventType("user.message")
        self.assertEqual(EventType("user.message"), t)          # a value
        self.assertEqual(EventType("x"), EventType("x", ()))
        self.assertNotEqual(EventType("x", (Property("c"),)), EventType("x"))   # its properties are part of it
        self.assertIsNone(t.id)
        self.assertEqual(EventType("user.message", id=4), t)                  # the id is not identity
        e = Event(4, {"a": 1})
        self.assertEqual((e.type_id, e.payload, e.id, e.tokens, e.properties), (4, {"a": 1}, None, None, {}))
        with self.assertRaises(Exception):
            t.name = "other"                                                  # frozen


class Recorder(ContextManager):
    """A second implementation: a type table per gatherer; reads newest first."""
    name = "recorder"

    def __init__(self):
        self.seen, self.types = {}, {}

    def init(self, gatherer_id, event_types=()):
        for t in event_types:
            self.add_event_type(gatherer_id, t)

    def add_event_type(self, gatherer_id, event_type):
        table = self.types.setdefault(gatherer_id, {})
        if event_type.name not in table:
            table[event_type.name] = EventType(event_type.name, event_type.properties, id=len(table) + 1)
        return table[event_type.name].id

    def insert(self, gatherer_id, event):
        key = (gatherer_id, event.properties.get(CHANNEL))
        self.seen.setdefault(key, []).append(event)
        return len(self.seen[key])

    def locate(self, gatherer_id, event_id, *, properties=None):
        for n, e in enumerate(self.seen.get((gatherer_id, (properties or {}).get(CHANNEL)), []), 1):
            if e.id == event_id:
                return n
        return None

    def read(self, gatherer_id, row_id, *, properties=None):
        return [e.payload for e in reversed(self.seen.get((gatherer_id, (properties or {}).get(CHANNEL)), [])[:row_id])]

    def event_types(self, gatherer_id):
        return list(self.types.get(gatherer_id, {}).values())


class RecorderPolicy(Policy):
    """A second policy, over the real store: the history newest first, up to
    the event the read responds to. Keeps no tables of its own."""
    name = "recorder"

    def read(self, conn, read):
        from ag.ag_harness.store import operations as store
        rows = [r for r in store.rows(conn, match=read.properties) if r.row_id <= read.row_id]
        return Context([r.payload for r in reversed(rows)],
                       [store.Ref(row_id=r.row_id) for r in reversed(rows)], basis="newest-first")


class ContractTest(unittest.TestCase):
    def test_cannot_be_instantiated(self):
        with self.assertRaises(TypeError):
            ContextManager()

    def test_abstract_methods(self):
        self.assertEqual(ContextManager.__abstractmethods__, {"insert", "locate", "read", "event_types", "add_event_type"})

        class OnlyInsert(ContextManager):
            def insert(self, gatherer_id, event):
                return None

        with self.assertRaises(TypeError):
            OnlyInsert()

    def test_init_defaults_to_nothing(self):
        class Minimal(Recorder):
            init = ContextManager.init

        self.assertIsNone(Minimal().init("s"))
        self.assertIsNone(Minimal().init("s", [EventType("x")]))

    def test_the_interface_imports_nothing_from_the_package(self):
        import ast
        import ag.ag_interface.context_manager as mod
        import ag.ag_interface.event as ev
        for module, allowed in ((mod, {"abc", "typing", "event"}), (ev, {"dataclasses", "re", "typing"})):
            tree = ast.parse(open(module.__file__).read())
            imported = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
            imported |= {a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
            self.assertEqual(imported, allowed, module.__name__)
            outside = [n for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.level > 1]
            self.assertEqual(outside, [], module.__name__)

    def test_the_manager_matches_the_contract(self):
        for method in ("init", "add_event_type", "insert", "locate", "read", "event_types"):
            self.assertEqual(inspect.signature(getattr(Manager, method)),
                             inspect.signature(getattr(ContextManager, method)), method)

    def test_tokenizer_is_abstract_and_pluggable(self):
        from ag.ag_harness import Tokenizer
        from ag.ag_tools.tokenizers import Tiktoken
        with self.assertRaises(TypeError):
            Tokenizer()
        self.assertGreater(Tiktoken().count("hello world"), 0)
        self.assertEqual(Tiktoken().count(""), 0)

        class Fixed(Tokenizer):
            def count(self, text):
                return 7

        self.assertEqual(Manager(ProactiveContextManager(codex.FORMAT, None, tokenizer=Fixed())).tokenizer.count("anything"), 7)

    def test_litellm_tokenizer_if_installed(self):
        from ag.ag_tools.tokenizers import LiteLLM, Tiktoken
        try:
            import litellm  # noqa: F401
        except ImportError:
            self.skipTest("litellm not installed")
        text = "Could you calculate the average of the total runs scored by all strikers?"
        lite = LiteLLM("gemini/gemini-3.8-flash")
        self.assertEqual(lite.count(""), 0)
        self.assertEqual(lite.count(text), Tiktoken().count(text))   # o200k_base for Gemini


class NoLLM(LLM):
    def complete(self, prompt, **kw):
        return ""


class ManagerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = paths.TRACE_DIR
        paths.TRACE_DIR = self.tmp.name

    def tearDown(self):
        paths.TRACE_DIR = self.saved
        self.tmp.cleanup()

    def test_any_policy_runs_under_a_manager(self):
        m = Manager(RecorderPolicy())                                    # no registry: the policy itself
        t = EventType("t", (Property(CHANNEL),))
        m.init("s", [t])
        m.insert("s", on(Event(1, {"a": 1}, id="a"), "c"))
        m.insert("s", on(Event(1, {"b": 2}, id="b"), "c"))
        self.assertEqual(m.read("s", 2, properties=ch("c")), [{"b": 2}, {"a": 1}])
        self.assertEqual(m.read("s", 1, properties=ch("c")), [{"a": 1}])            # this one uses the event
        self.assertEqual(m.locate("s", "b", properties=ch("c")), 2)
        self.assertEqual(m.event_types("s"), [t])
        self.assertEqual(m.event_types("s")[0].id, 1)

    def test_the_manager_gives_the_policy_what_it_was_not_given(self):
        m = Manager(ProactiveContextManager(codex.FORMAT, NoLLM(), ProactiveContextManagerConfig(gatherer_guide="")))
        self.assertIs(m.policy.tokenizer, m.tokenizer)                   # the tokenizer events are counted with
        self.assertIsNotNone(m.policy.gatherers)                             # and a way to open a gatherer's store
        t = EventType("mine")
        m.init("s", [t])                                                 # after the policy's eight
        self.assertEqual(m.add_event_type("s", EventType("notice")), 10)
        row = m.insert("s", on(Event(1, {"a": 1}, id="1"), "c"))   # 1 = user_message
        self.assertEqual(row, 1)
        self.assertEqual(m.read("s", row, properties=ch("c")), [{"a": 1}])
        self.assertEqual([x.id for x in m.event_types("s")], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

    def test_a_codex_item_reaches_the_manager_as_its_event(self):
        rec = Recorder()
        m = codex.CodexItems(rec)
        m.init("s")
        item = {"type": "function_call", "id": "fc_1", "name": "exec_command"}
        m.insert("s", item, channel_id="c")
        e, = rec.seen[("s", "c")]
        self.assertEqual((e.type_id, e.payload, e.id, e.tokens),
                         (rec.types["s"]["tool_call"].id, item, "fc_1", None))


if __name__ == "__main__":
    unittest.main()
