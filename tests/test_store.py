"""The store through the manager: init and event types (name,
properties), insert, locate, the type filter, text, read before any build.

The payloads below are shaped like codex's, but only as test data: the
package treats them as opaque.
"""

import json
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import ag.ag_harness  # noqa: E402
from ag.ag_harness import Event, EventType, Manager  # noqa: E402
import codex_items as codex  # noqa: E402
from ag.ag_interface import LLM, Context, Policy, Property, Ref  # noqa: E402
from ag.ag_policies.tools.groups import CONTEXT, TOOL_CALL, TOOL_OUTPUT, USER_MESSAGE  # noqa: E402
from ag.ag_policies.proactive_context_manager import ProactiveContextManager, ProactiveContextManagerConfig, events  # noqa: E402

NO_GUIDE = ProactiveContextManagerConfig(gatherer_guide="")     # the store's reads, without the policy's guide
from ag.ag_harness.store import operations as store  # noqa: E402
from ag.ag_harness.store import paths, schema  # noqa: E402
from channels import ch, on  # noqa: E402

# The policy's types (events.EVENT_TYPES, ids 1..6 in every gatherer it runs).
USER = events.USER_MESSAGE_TYPE                                        # id 1
CALL = events.TOOL_CALL_TYPE                                           # id 3
OUT = events.TOOL_OUTPUT_TYPE                                          # id 4
TYPES = (USER, CALL, OUT)
POLICY_TYPES = [(1, "user_message"), (2, "agent_message"), (3, "tool_call"), (4, "tool_output"), (5, "context"),
                (6, "environment_update"), (7, "context_stream"), (8, "agent_reasoning")]

A = {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "yes"}]}
B = {"type": "function_call", "name": "exec_command", "arguments": "{}", "call_id": "c1"}


class NoLLM(LLM):
    def complete(self, prompt, **kw):
        raise AssertionError("the store tests never call a model")


def ev(payload, id=None, type_id=1, tokens=None):
    return Event(type_id, payload, id=id, tokens=tokens)


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = paths.TRACE_DIR
        paths.TRACE_DIR = os.path.join(self.tmp.name, "traces")
        self.m = Manager(ProactiveContextManager(codex.FORMAT, NoLLM(), NO_GUIDE))
        self.m.init("s", TYPES)

    def tearDown(self):
        paths.TRACE_DIR = self.saved
        self.tmp.cleanup()

    def insert(self, event, channel_id=None, gatherer="s"):
        return self.m.insert(gatherer, on(event, channel_id))

    def read(self, channel_id=None, gatherer="s", row_id=None):
        """A read in response to `row_id`, else the last event stored."""
        if row_id is None:
            row_id = store.high_water(self.m._conn(gatherer)) if os.path.exists(
                ag.ag_harness.db_path(gatherer)) else 0
        return [i for i in self.m.read(gatherer, row_id, properties=ch(channel_id))   # the other channels' requests
                if not (isinstance(i, dict) and i.get("type") == "ag" and i.get("name") == "parallel_request")]  # aside: the store is tested

    def query(self, sql, gatherer="s"):
        conn = sqlite3.connect(ag.ag_harness.db_path(gatherer))
        conn.row_factory = sqlite3.Row
        try:
            return [dict(r) for r in conn.execute(sql)]
        finally:
            conn.close()

    def rows(self, gatherer="s"):
        return self.query("SELECT e.*, t.name FROM events e "
                          "JOIN event_types t USING (event_type_id) ORDER BY row_id", gatherer)

    def types(self, gatherer="s"):
        return [(t["event_type_id"], t["name"]) for t in self.query(
            "SELECT event_type_id, name FROM event_types ORDER BY event_type_id", gatherer)]


class InitTest(StoreTest):
    def test_creates_the_database_and_directory(self):
        self.assertTrue(os.path.isfile(ag.ag_harness.db_path("s")))
        self.assertEqual(self.rows(), [])
        tables = {r["name"] for r in self.query("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertTrue({"event_types", "events", "tasks", "_reads", "_read_items", "_contexts", "_stays", "_made_items",
                         "_made_folded", "_builds", "_boundaries"} <= tables)     # the read log as every ag keeps it,
        self.assertNotIn("items", tables)                                       # till migrate.py moves it to stays

    def test_defines_the_policys_types_in_order(self):
        self.assertEqual(self.types(), POLICY_TYPES)
        listed = self.m.event_types("s")
        self.assertEqual(listed, list(events.EVENT_TYPES))
        self.assertEqual([t.id for t in listed], [1, 2, 3, 4, 5, 6, 7, 8])    # carrying their ids

    def test_a_later_definition_adds_the_properties_the_first_lacked(self):
        self.assertEqual(self.m.add_event_type("s", EventType("agent_message")), 2)
        self.assertEqual(self.m.event_types("s")[1].properties, events.AGENT_MESSAGE_TYPE.properties)   # kept
        tid = self.m.add_event_type("s", EventType("bare"))
        self.assertEqual(self.m.add_event_type("s", EventType("bare", (Property("lane"),))), tid)
        self.assertEqual(self.m.event_types("s")[-1].properties, (Property("lane"),))

    def test_idempotent_keeps_history_and_ids(self):
        self.insert(ev(A, "u1"))
        self.m.init("s", TYPES)
        self.m.init("s")                                             # no types: nothing removed
        self.assertEqual([r["event_id"] for r in self.rows()], ["u1"])
        self.assertEqual([t[0] for t in self.types()], [1, 2, 3, 4, 5, 6, 7, 8])

    def test_a_type_defined_again_keeps_what_it_was_first_defined_with(self):
        self.m.init("s", [EventType("user_message"), EventType("new")])
        self.assertEqual(self.types()[0], (1, "user_message"))
        self.assertEqual(self.types()[8], (9, "new"))

    def test_a_gatherer_has_the_policys_types_at_least(self):
        self.m.init("bare")
        self.assertEqual(self.m.event_types("bare"), list(events.EVENT_TYPES))
        self.assertEqual(self.m.event_types("never-created"), [])

    def test_gatherers_are_separate_files(self):
        self.m.init("b", [CALL])
        self.insert(ev(A, "u1"))
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.rows("b"), [])
        self.assertEqual([t.id for t in self.m.event_types("b")], [1, 2, 3, 4, 5, 6, 7, 8])

    def test_a_database_from_before_events_is_refused(self):
        path = ag.ag_harness.db_path("old")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        conn = sqlite3.connect(path)
        conn.execute("CREATE TABLE items (row_id INTEGER PRIMARY KEY, item_json TEXT)")
        conn.commit()
        conn.close()
        with self.assertRaises(schema.OutdatedDatabase):
            self.m.init("old")

    def test_cli(self):
        import io
        from contextlib import redirect_stdout
        from ag.ag_harness.__main__ import main
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(main(["init", "cli", "--type", "user.message", "--type", "notice"]), 0)
        self.assertEqual(out.getvalue().strip(), ag.ag_harness.db_path("cli"))
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(main(["add-type", "cli", "agent.tool_call:thread!,user"]), 0)
            self.assertEqual(main(["add-type", "cli", "notice"]), 0)          # again: same id
        self.assertEqual(out.getvalue().split(), ["3", "2"])
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(main(["event-types", "cli"]), 0)
        self.assertEqual(out.getvalue().splitlines(),
                         ["1\tuser.message\t-", "2\tnotice\t-", "3\tagent.tool_call\tthread!,user"])
        self.assertEqual(main(["event-types", "never"]), 1)


class EventTypeTest(StoreTest):
    """Types are the gatherer's: defined at init, added later, referenced by
    id from every event."""

    def test_adding_a_type_returns_its_id(self):
        self.assertEqual(self.m.add_event_type("s", EventType("notice")), 9)
        self.assertEqual(self.m.add_event_type("s", EventType("another")), 10)
        self.assertEqual(self.types()[8:], [(9, "notice"), (10, "another")])
        self.assertEqual(self.m.event_types("s")[-1].id, 10)

    def test_adding_a_known_name_is_the_same_type(self):
        self.assertEqual(self.m.add_event_type("s", USER), 1)
        self.assertEqual(self.m.add_event_type("s", EventType("user_message")), 1)
        self.assertEqual(self.types()[0], (1, "user_message"))

    def test_a_type_can_be_anything_the_caller_names(self):
        self.m.add_event_type("s", EventType("robot.reasoning"))
        self.m.add_event_type("s", EventType("blank"))
        self.assertEqual(self.types()[8:], [(9, "robot.reasoning"), (10, "blank")])

    def test_a_nameless_type_is_refused(self):
        for bad in (EventType(""), "user.message", None):
            with self.assertRaises(TypeError, msg=repr(bad)):
                self.m.add_event_type("s", bad)
        self.assertEqual(len(self.types()), 8)

    def test_every_event_points_at_one_of_the_gatherers_types(self):
        self.insert(ev(A, "1", type_id=1))
        self.insert(ev(B, "2", type_id=3))
        rows = self.rows()
        self.assertEqual([(r["event_type_id"], r["name"]) for r in rows], [(1, "user_message"), (3, "tool_call")])

    def test_an_unknown_type_id_is_refused_and_stores_nothing(self):
        with self.assertRaises(LookupError):
            self.insert(ev(A, "1", type_id=99))
        self.assertEqual(self.rows(), [])
        self.assertIsNotNone(self.insert(ev(A, "1", type_id=1)))          # the gatherer still works

    def test_the_type_id_must_be_an_int(self):
        for bad in (None, "1", "user.message", USER, 1.0, True):
            with self.assertRaises(TypeError, msg=repr(bad)):
                self.insert(ev(A, type_id=bad))
        with self.assertRaises(TypeError):
            self.insert(A)                                                  # not an Event at all
        self.assertEqual(self.rows(), [])

    def test_the_database_enforces_it_too(self):
        conn = sqlite3.connect(ag.ag_harness.db_path("s"))
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("INSERT INTO events (inserted_at, p_channel, event_id, event_type_id, payload_json, tokens) "
                             "VALUES ('t', NULL, 'x', 999, '{}', 1)")
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("INSERT INTO events (inserted_at, p_channel, event_id, payload_json, tokens) "
                             "VALUES ('t', NULL, 'y', '{}', 1)")
        finally:
            conn.close()

    def test_a_type_added_later_takes_events_at_once(self):
        type_id = self.m.add_event_type("s", EventType("notice"))
        self.assertIsNotNone(self.insert(ev({"n": 1}, "n1", type_id=type_id)))
        self.assertEqual(self.rows()[0]["name"], "notice")

    def test_the_types_are_shared_across_channels(self):
        self.insert(ev(A, "1"), channel_id="c1")
        self.insert(ev(A, "1"), channel_id="c2")
        self.insert(ev(A, "1"))
        self.assertEqual(len(self.types()), 8)
        self.assertEqual({r["event_type_id"] for r in self.rows()}, {1})

    def test_bulk_load_needs_the_types_too(self):
        with self.assertRaises(LookupError):
            self.m.bulk_load("s", [ev(A, "1"), ev(B, "2", type_id=42)], properties=ch(None))
        self.assertEqual(self.rows(), [])                                  # one transaction: nothing stored

    def test_rows_by_type(self):
        self.insert(ev(A, "1", type_id=1))
        self.insert(ev(B, "2", type_id=3))
        self.insert(ev({"output": "x"}, "3", type_id=4))
        self.insert(ev(A, "4", type_id=1), channel_id="c1")
        conn = self.m._conn("s")
        ids = lambda rows: [r.row_id for r in rows]  # noqa: E731
        self.assertEqual(ids(store.rows(conn, match=ch("c1"))), [1, 2, 3, 4])
        self.assertEqual(ids(store.rows(conn, match=ch("c1"), type_ids={1})), [1, 4])
        self.assertEqual(ids(store.rows(conn, match=ch("c1"), type_ids=(3, 4))), [2, 3])
        self.assertEqual(ids(store.rows(conn, match=ch("c1"), type_ids=frozenset())), [])
        self.assertEqual(ids(store.rows(conn, match=ch(None), type_ids={1})), [1])
        self.assertEqual(ids(store.rows(conn, differ=ch(None), type_ids={1})), [4])
        self.assertEqual(ids(store.rows(conn, differ=ch(None), type_ids={3})), [])
        row = store.rows(conn, match=ch(None), type_ids={1})[0]
        self.assertEqual((row.type.id, row.type.name, row.type.name), (1, "user_message", "user_message"))


class TextTest(StoreTest):
    """An event's text, wherever a policy needs it: the text it was given, else its payload as JSON."""

    def row(self, payload, type_id):
        types = {t.id: t for t in self.m.event_types("s")}
        return store.Row(1, None, types[type_id], payload, 0)

    def test_the_payload_as_json_whatever_its_type(self):
        tid = self.m.add_event_type("s", EventType("notice"))
        for payload, type_id in ((A, 1), (B, 3), ({"output": "done"}, 4), ({"content": "x"}, tid)):
            self.assertEqual(store.text(self.row(payload, type_id)), json.dumps(payload, ensure_ascii=False))

    def test_any_json_value_and_its_characters_as_they_are(self):
        self.assertEqual(store.text(self.row("plain", 1)), '"plain"')
        self.assertEqual(store.text(self.row([1, None], 1)), "[1, null]")
        self.assertEqual(store.text(self.row({"t": "café ✓"}, 1)), '{"t": "café ✓"}')

    def test_the_text_given_comes_first(self):
        types = {t.id: t for t in self.m.event_types("s")}
        self.assertEqual(store.text(store.Row(1, None, types[1], A, 0, {}, "what was said")), "what was said")
        self.assertEqual(store.text(store.Row(1, None, types[1], A, 0, {}, "")), "")       # empty is a text

    def test_stored_counted_and_read_back(self):
        payload = {"type": "message", "id": "msg_" + "x" * 200, "content": [{"type": "input_text", "text": "hi"}]}
        self.insert(Event(1, payload, id="a", text="hi"))
        self.insert(Event(1, payload, id="b"))                                    # no text: the JSON stands in
        self.insert(Event(1, payload, id="c", text="hi", tokens=7))               # the caller's count wins
        got = {r["event_id"]: r for r in self.rows()}
        self.assertEqual((got["a"]["text"], got["b"]["text"]), ("hi", None))
        self.assertEqual(got["a"]["tokens"], self.m.tokenizer.count("hi"))
        self.assertEqual(got["b"]["tokens"], self.m.tokenizer.count(json.dumps(payload, sort_keys=True, ensure_ascii=False)))
        self.assertEqual(got["c"]["tokens"], 7)
        rows = {r.event_id: r for r in store.rows(self.m._conn("s"))}
        self.assertEqual((rows["a"].text, store.text(rows["a"])), ("hi", "hi"))
        self.assertIsNone(rows["b"].text)
        self.assertEqual(json.loads(store.text(rows["b"])), payload)                # the payload as JSON
        self.assertEqual(rows["a"].payload, payload)                             # the payload, as given

    def test_a_file_from_before_text_gets_the_column(self):
        path = ag.ag_harness.db_path("s")
        conn = sqlite3.connect(path)
        conn.execute("ALTER TABLE events DROP COLUMN text")
        conn.commit(); conn.close()
        self.m = Manager(ProactiveContextManager(codex.FORMAT, NoLLM(), NO_GUIDE))
        self.insert(Event(1, A, id="a", text="said"))
        self.assertEqual([r["text"] for r in self.rows()], ["said"])

class InsertTest(StoreTest):
    def test_returns_the_row_id_then_none_for_a_duplicate(self):
        first = self.insert(ev(A, "m1"))
        self.assertIsInstance(first, int)
        self.assertIsNone(self.insert(ev(A, "m1")))
        self.assertEqual(self.insert(ev(B, "f1", type_id=3)), first + 1)

    def test_stores_what_it_was_given(self):
        self.insert(ev(A, "m1"), channel_id="c")
        row, = self.rows()
        self.assertEqual((row["p_channel"], row["event_id"], row["event_type_id"]), ("c", "m1", 1))
        self.assertEqual(json.loads(row["payload_json"]), A)
        self.assertTrue(row["inserted_at"])

    def test_payloads_are_stored_verbatim_whatever_their_shape(self):
        shapes = [A, "a bare string", 42, ["a", {"b": None}], {"no": "id field"}]
        for x in shapes:
            self.insert(ev(x))
        self.assertEqual([json.loads(r["payload_json"]) for r in self.rows()], shapes)

    def test_the_same_words_twice_under_different_ids_are_two_rows(self):
        self.insert(ev(A, "m1"))
        self.insert(ev(A, "m2"))
        self.assertEqual([r["event_id"] for r in self.rows()], ["m1", "m2"])

    def test_without_an_id_every_insert_is_a_new_row(self):
        first = self.insert(ev(A))
        second = self.insert(ev(A))                           # identical content
        self.assertEqual(second, first + 1)
        self.assertIsNotNone(self.insert(ev(A, "")))          # empty id = none
        rows = self.rows()
        self.assertEqual(len(rows), 3)
        self.assertEqual({r["event_id"] for r in rows}, {None})

    def test_content_is_never_read_for_identity(self):
        self.insert(ev({"a": 1}, "x"))
        self.assertIsNotNone(self.insert(ev({"a": 1}, "y")))
        self.assertIsNone(self.insert(ev({"completely": "different"}, "x")))

    def test_duplicates_are_per_channel(self):
        self.assertIsNotNone(self.insert(ev(A, "m1")))
        self.assertIsNotNone(self.insert(ev(A, "m1"), channel_id="c1"))
        self.assertIsNotNone(self.insert(ev(A, "m1"), channel_id="c2"))
        self.assertIsNone(self.insert(ev(A, "m1"), channel_id="c1"))
        self.assertEqual([r["p_channel"] for r in self.rows()], [None, "c1", "c2"])

    def test_the_first_wins(self):
        self.insert(ev(A, "m1"))
        self.assertIsNone(self.insert(ev(B, "m1", type_id=3)))
        row, = self.rows()
        self.assertEqual((json.loads(row["payload_json"]), row["name"]), (A, "user_message"))

    def test_order_is_insertion_order(self):
        payloads = [{"n": n} for n in range(50)]
        for p in payloads:
            self.insert(ev(p))
        self.assertEqual([json.loads(r["payload_json"]) for r in self.rows()], payloads)

    def test_not_serializable_stores_nothing(self):
        with self.assertRaises(TypeError):
            self.insert(ev({"x": object()}))
        self.assertEqual(self.rows(), [])
        self.assertIsNotNone(self.insert(ev(A)))          # and the gatherer still works

    def test_tokens_stated_or_counted(self):
        self.insert(ev(A, "a"))
        self.insert(ev(B, "b", type_id=3, tokens=0))
        counted, stated = self.rows()
        self.assertGreater(counted["tokens"], 0)
        self.assertEqual(stated["tokens"], 0)

    def test_committed_for_other_readers_at_once(self):
        self.insert(ev(A, "m1"))
        other = sqlite3.connect(ag.ag_harness.db_path("s"))
        try:
            self.assertEqual(other.execute("SELECT count(*) FROM events").fetchone()[0], 1)
        finally:
            other.close()


def item(n):
    # A real user message: one that opens a turn. Payloads that open no turn
    # are the PREAMBLE, and a channel with rows of its own leaves the pool's
    # preamble out (builder/context.py, `arrange`); these tests are about the
    # store's visibility rules, not that.
    return {"type": "message", "role": "user", "content": [{"type": "input_text", "text": f"q {n}"}]}


class ReadTest(StoreTest):
    """Before any build, read is the channel's history: its own events and
    the no-channel pool, once each, in order."""

    def put(self, x, channel_id=None, id=None):
        return self.insert(ev(x, id), channel_id=channel_id)

    def test_returns_payloads_in_insertion_order(self):
        payloads = [item(n) for n in range(20)]
        for x in payloads:
            self.put(x, "c1")
        self.assertEqual(self.read("c1"), payloads)

    def test_payloads_come_back_verbatim_whatever_their_shape(self):
        shapes = [item(1), "text", 3, [1, {"a": None}], {"nested": {"deep": [True, 1.5]}}]
        for x in shapes:
            self.put(x, "c1")
        self.assertEqual(self.read("c1"), shapes)

    def test_duplicates_are_returned_once(self):
        self.put(item(1), "c1", "a")
        self.put(item(1), "c1", "a")
        self.assertEqual(self.read("c1"), [item(1)])

    def test_events_without_an_id_are_each_returned(self):
        self.put(item(2), "c1")
        self.put(item(2), "c1")
        self.put(item(2))                  # and one in the no-channel pool
        self.assertEqual(self.read("c1"), [item(2)] * 3)
        self.assertEqual(self.read(None), [item(2)])

    def test_id_less_rows_keep_their_place_among_id_rows(self):
        self.put(item(0), None, "a")
        self.put(item(1), "c1")
        self.put(item(0), "c1", "a")       # re-sent: already seen as "a"
        self.put(item(2), "c1", "b")
        self.put(item(3), "c1")
        self.assertEqual(self.read("c1"), [item(0), item(1), item(2), item(3)])

    def test_channels_never_see_each_other(self):
        self.put(item(1), "c1")
        self.put(item(2), "c2")
        self.put(item(3), "c1")
        self.assertEqual(self.read("c1"), [item(1), item(3)])
        self.assertEqual(self.read("c2"), [item(2)])

    def test_no_channel_events_are_seen_by_every_channel(self):
        self.put(item(0))                  # e.g. bulk-loaded
        self.put(item(1), "c1")
        self.put(item(2), "c2")
        self.assertEqual(self.read("c1"), [item(0), item(1)])
        self.assertEqual(self.read("c2"), [item(0), item(2)])
        self.assertEqual(self.read(None), [item(0)])

    def test_an_event_in_both_pools_is_returned_once_at_its_first_position(self):
        loaded = [item(n) for n in range(3)]
        for n, x in enumerate(loaded):
            self.put(x, None, f"id{n}")
        for n, x in enumerate(loaded):
            self.put(x, "c1", f"id{n}")
        self.put(item(3), "c1", "id3")
        self.assertEqual(self.read("c1"), loaded + [item(3)])
        self.assertEqual(len(self.rows()), 7)             # both pools really do hold a copy

    def test_order_is_across_both_pools(self):
        self.put(item(1), "c1")
        self.put(item(2))
        self.put(item(3), "c1")
        self.assertEqual(self.read("c1"), [item(1), item(2), item(3)])

    def test_empty_channel_and_missing_gatherer(self):
        self.assertEqual(self.read("nobody"), [])
        self.put(item(0))
        self.assertEqual(self.read("nobody"), [item(0)])
        self.assertEqual(self.read("c1", gatherer="never-created"), [])
        self.assertFalse(os.path.exists(ag.ag_harness.db_path("never-created")))

    def test_every_read_is_logged_with_its_event_and_nothing_else_is_written(self):
        self.put(item(0))
        self.put(item(1), "c1")
        before = self.query("SELECT count(*) AS n, max(row_id) AS top FROM events")
        self.read("c1", row_id=2)
        self.read(None, row_id=1)
        self.assertEqual(self.query("SELECT count(*) AS n, max(row_id) AS top FROM events"), before)
        reads = self.query("SELECT read_id, p_channel, row_id, manager, basis FROM _reads ORDER BY read_id")
        self.assertEqual([(r["p_channel"], r["row_id"], r["manager"], r["basis"]) for r in reads],
                         [("c1", 2, "proactive_context_manager", None), (None, 1, "proactive_context_manager", None)])
        first = self.query(f"SELECT row_id, made_id FROM _read_items WHERE read_id = {reads[0]['read_id']} "
                           "ORDER BY position")
        self.assertEqual([(r["row_id"], r["made_id"]) for r in first], [(1, None), (2, None)])

    def test_locate_finds_a_stored_events_row_as_the_channel_sees_it(self):
        self.assertIsNone(self.m.locate("s", "a", properties=ch("c1")))
        self.assertIsNone(self.m.locate("never-created", "a", properties=ch("c1")))
        self.assertIsNone(self.m.locate("s", "", properties=ch("c1")))
        self.put(item(0), None, "a")                                      # pool: row 1
        self.put(item(1), "c1", "b")                                      # c1: row 2
        self.put(item(0), "c1", "a")                                      # c1's own copy: row 3
        self.put(item(2), "c2", "c")                                      # c2: row 4
        self.assertEqual(self.m.locate("s", "a", properties=ch("c1")), 1)     # the pool's, seen first
        self.assertEqual(self.m.locate("s", "b", properties=ch("c1")), 2)
        self.assertEqual(self.m.locate("s", "c", properties=ch("c1")), None)  # another channel's
        self.assertEqual(self.m.locate("s", "c", properties=ch("c2")), 4)
        self.assertEqual(self.m.locate("s", "a", properties=ch(None)), 1)
        self.assertEqual(self.m.locate("s", "b", properties=ch(None)), None)
        # what insert reports as a duplicate, locate finds
        self.assertIsNone(self.put(item(1), "c1", "b"))
        self.assertEqual(self.m.locate("s", "b", properties=ch("c1")), 2)

    def test_reading_back_what_it_returned_changes_nothing(self):
        # The hook inserts the request it sent, which after a rewrite IS read's
        # output. With nothing synthesised, that must be a no-op.
        for n in range(5):
            self.put(item(n), "c1", f"id{n}")
        context = self.read("c1")
        for n, x in enumerate(context):
            self.assertIsNone(self.put(x, "c1", f"id{n}"))
        self.assertEqual(self.read("c1"), context)


class Declared(Policy):
    """A policy whose types declare properties the harness knows nothing of:
    `note` may carry a `lane` and must carry a `user`; `tick` carries none."""
    name = "declared"
    event_types = (EventType("note", (Property("lane", identifies=True), Property("user", required=True))), EventType("tick"))

    def read(self, conn, read):
        rows = conn.rows(match=read.properties)
        return Context([r.payload for r in rows], [Ref(row_id=r.row_id) for r in rows])


class PropertiesTest(unittest.TestCase):
    """Properties: a column for each one the policy's types declare, what an
    insert may carry, and the filters on them."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = paths.TRACE_DIR
        paths.TRACE_DIR = os.path.join(self.tmp.name, "traces")
        self.m = Manager(Declared())
        self.m.init("p")
        self.note, self.tick = (t.id for t in self.m.event_types("p"))
        self.conn = self.m._conn("p")

    def tearDown(self):
        paths.TRACE_DIR = self.saved
        self.tmp.cleanup()

    def put(self, payload, id=None, **properties):
        return self.m.insert("p", Event(self.note, payload, id=id, properties=properties))

    def test_the_columns_are_the_declared_properties(self):
        for table in schema.PROPERTY_TABLES:
            columns = [r[1] for r in self.conn.execute(f"PRAGMA table_info({table})")]
            self.assertEqual([c for c in columns if c.startswith("p_")], ["p_lane", "p_user"], table)
        self.assertEqual(self.m.event_types("p")[0].properties, (Property("lane", identifies=True), Property("user", True)))

    def test_what_an_insert_may_carry(self):
        with self.assertRaisesRegex(ValueError, "requires the property 'user'"):
            self.put(1, lane="a")
        with self.assertRaisesRegex(ValueError, "declares no property 'mood'"):
            self.put(1, user="u", mood="x")
        with self.assertRaisesRegex(ValueError, "declares no property 'user'"):
            self.m.insert("p", Event(self.tick, 1, properties={"user": "u"}))
        with self.assertRaisesRegex(TypeError, "a string or a number"):
            self.put(1, user=["u"])
        self.assertEqual(self.put(1, user="u"), 1)                       # lane unset: NULL
        self.assertEqual(self.m.insert("p", Event(self.tick, 2)), 2)
        self.assertEqual(self.conn.execute("SELECT p_lane, p_user FROM events ORDER BY row_id").fetchall(),
                         [(None, "u"), (None, None)])

    def test_an_event_is_its_id_and_its_identifying_properties(self):
        self.assertIsNotNone(self.put(1, "e", user="u", lane="a"))
        self.assertIsNone(self.put(1, "e", user="u", lane="a"))           # the same event
        self.assertIsNotNone(self.put(1, "e", user="u", lane="b"))         # lane identifies it
        self.assertIsNotNone(self.put(1, "e", user="u"))                  # lane unset is a value of its own
        self.assertIsNone(self.put(1, "e", user="u", lane=None))
        self.assertIsNone(self.put(1, "e", user="v", lane="a"))           # user only describes it: the same event
        self.assertEqual(self.conn.execute("SELECT p_user FROM events WHERE p_lane = 'a'").fetchall(), [("u",)])
        self.assertEqual(self.m.locate("p", "e", properties={"lane": "a", "user": "v"}), 1)   # found by its identity

    def test_the_identity_is_what_any_type_declares(self):
        self.m.add_event_type("p", EventType("mark", (Property("lane"),)))          # lane plainly: still identifying
        self.assertEqual(schema.identifying_names(self.conn), ["lane"])
        self.m.add_event_type("p", EventType("tag", (Property("user", identifies=True),)))
        self.assertEqual(schema.identifying_names(self.conn), ["lane", "user"])
        self.assertIsNotNone(self.put(1, "e", user="u", lane="a"))
        self.assertIsNotNone(self.put(1, "e", user="v", lane="a"))           # now user identifies it too

    def test_a_type_declared_again_as_identifying_becomes_so(self):
        self.m.add_event_type("p", EventType("mark", (Property("topic"),)))
        self.assertEqual(schema.identifying_names(self.conn), ["lane"])
        self.m.add_event_type("p", EventType("mark", (Property("topic", identifies=True),)))
        self.assertEqual(schema.identifying_names(self.conn), ["lane", "topic"])

    def test_a_database_holding_one_event_twice_by_a_new_identity_is_refused(self):
        self.m.add_event_type("p", EventType("mark", (Property("topic"),)))
        tid = {t.name: t.id for t in self.m.event_types("p")}["mark"]
        self.m.insert("p", Event(tid, 1, id="x", properties={"topic": "a"}))
        self.m.insert("p", Event(tid, 1, id="x", properties={"topic": "a"}))
        self.conn.execute("DROP INDEX events_id")                            # as an older file was indexed
        self.conn.execute("INSERT INTO events (inserted_at, event_id, event_type_id, payload_json, tokens, p_topic) "
                          "VALUES ('t', 'x', ?, '1', 1, 'b')", (tid,))
        self.conn.commit()
        with self.assertRaisesRegex(schema.OutdatedDatabase, "delete the gatherer"):
            self.m.add_event_type("p", EventType("again", (Property("lane"),)))

    def test_the_filters(self):
        self.put("a1", "1", user="u", lane="a")
        self.put("b1", "2", user="u", lane="b")
        self.put("x", "3", user="u")                                      # no lane: every lane's
        self.put("a2", "4", user="v", lane="a")
        payloads = lambda **f: [r.payload for r in store.rows(self.conn, **f)]
        self.assertEqual(payloads(match={"lane": "a"}), ["a1", "x", "a2"])
        self.assertEqual(payloads(match={"lane": "a"}, unset_matches=False), ["a1", "a2"])
        self.assertEqual(payloads(match={"lane": None}), ["x"])
        self.assertEqual(payloads(match={"lane": "a", "user": "u"}), ["a1", "x"])
        self.assertEqual(payloads(differ={"lane": "a"}), ["b1"])          # set, and not a
        self.assertEqual(payloads(match={"user": "u"}, differ={"lane": "b"}), ["a1"])
        self.assertEqual(payloads(match={"mood": "x"}), ["a1", "b1", "x", "a2"])   # no such column: unset everywhere
        self.assertEqual(payloads(differ={"mood": "x"}), [])
        self.assertEqual(store.rows(self.conn, match={"lane": "a"})[0].properties, {"lane": "a", "user": "u"})
        self.assertEqual(store.rows(self.conn, match={"lane": None})[0].properties, {"user": "u"})

    def test_reads_and_lookups_see_their_properties_and_the_unset(self):
        self.put("x", "1", user="u")
        self.put("a", "2", user="u", lane="a")
        self.assertEqual(self.m.read("p", 2, properties={"lane": "a", "user": "u"}), ["x", "a"])
        self.assertEqual(self.m.locate("p", "1", properties={"lane": "a", "user": "u"}), 1)
        self.assertIsNone(self.m.locate("p", "2", properties={"lane": "b", "user": "u"}))
        self.assertIsNone(self.m.locate("p", "2", properties={"user": "u"}))   # lane not given: unset
        last = store.last_read(self.conn, {"lane": "a", "user": "u"})
        self.assertEqual(last["row_id"], 2)
        self.assertEqual(store.last_read(self.conn, {"lane": "a"})["row_id"], 2)   # user not given: any
        self.assertEqual(store.last_read(self.conn)["row_id"], 2)
        self.assertIsNone(store.last_read(self.conn, {"lane": "b"}))
        self.assertIsNone(store.last_read(self.conn, {"lane": "a", "user": None}))   # None: unset
        self.assertEqual(self.conn.execute("SELECT p_lane, p_user FROM _reads").fetchall(), [("a", "u")])

    def test_made_items_carry_the_read_s_properties(self):
        made = store.make_item(self.conn, "m", self.m.tokenizer, properties={"lane": "a"}, name="n")
        self.assertEqual(self.conn.execute("SELECT p_lane FROM _made_items WHERE made_id = ?", (made,)).fetchone(),
                         ("a",))
        with self.assertRaisesRegex(ValueError, "no property 'mood'"):
            store.make_item(self.conn, "m", self.m.tokenizer, properties={"mood": "x"})

    def test_a_type_added_later_adds_its_properties(self):
        self.put(1, "e", user="u")
        tid = self.m.add_event_type("p", EventType("tag", (Property("topic", identifies=True),)))
        self.assertIn("p_topic", [r[1] for r in self.conn.execute("PRAGMA table_info(events)")])
        self.assertIsNotNone(self.m.insert("p", Event(tid, 1, id="e", properties={"topic": "t"})))
        self.assertIsNone(self.m.insert("p", Event(tid, 1, id="e", properties={"topic": "t"})))   # the index covers it
        with self.assertRaises(TypeError):
            self.m.add_event_type("p", EventType("bad", (Property("not a name"),)))

    def test_a_poller_s_events_carry_only_the_properties_it_declares(self):
        class Clock:
            name, outputs, properties = "clock", ("tick",), ()

            def __init__(self, given):
                self.given = given

            def poll(self, since, types):
                tick = next(t.id for t in types if t.name == "tick")
                return [Event(tick, "t", id=f"t{i}", properties=p) for i, p in enumerate(self.given)]

        self.m.set_pollers([Clock([{}, {"user": "u"}])])
        self.put("q", "1", user="u")
        self.m.read("p", 1, properties={"user": "u"})
        self.assertEqual(self.conn.execute("SELECT event_id FROM events WHERE event_id LIKE 't%'").fetchall(),
                         [("t0",)])                                   # the undeclared property: dropped


if __name__ == "__main__":
    unittest.main()
