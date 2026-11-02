"""The provider's count of each call's context: every read is logged with the
policy's own count (`_reads.est_tokens`); the call's input tokens, reported
after it, are recorded against the read (`_reads.real_tokens`), through the
hook server for a proxy harness or with the next `rewrite` for an in-process
one; and a call over max_context_tokens by that count starts a build, beside
the policy's own estimate."""
import asyncio
import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from aiohttp import web
    from aiohttp.test_utils import TestClient, TestServer
except ImportError:
    web = None

from ag.ag_harness import home as ag_home  # noqa: E402
from ag.ag_harness.server import serve  # noqa: E402
from ag.ag_harness.server.__main__ import server_for  # noqa: E402
from ag.ag_harness.store import operations as store  # noqa: E402
from ag.ag_harness.store import paths, schema  # noqa: E402
from ag.ag_policies.proactive_context_manager import ProactiveContextManager, ProactiveContextManagerConfig  # noqa: E402
from ag.ag_policies.proactive_context_manager import tables  # noqa: E402
from ag.ag_harness import Manager  # noqa: E402
from ag.integrations.harnesses.codex.adaptor import to_events as codex  # noqa: E402
from ag.integrations.tools.ag_orchestrator.call_ag import call_ag, keep_read, report_measured  # noqa: E402
from channels import ch  # noqa: E402
from test_core import PREAMBLE, SMALL, Recording, ScriptedLLM, conversation, long_turn  # noqa: E402
import codex_items  # noqa: E402

if web is not None:
    from ag.integrations.harnesses.codex.ag_orchestrator import context_manager as codex_ag  # noqa: E402
    from ag.integrations.tools.hook_server import hook_server  # noqa: E402

DEV = {"type": "message", "role": "developer", "content": [{"type": "input_text", "text": "instructions"}]}


def user(text, n):
    return {"type": "message", "role": "user", "id": f"u{n}", "content": [{"type": "input_text", "text": text}]}


def sse(input_tokens):
    """A Responses stream whose final event reports `input_tokens` (cached ones included)."""
    done = {"type": "response.completed", "response": {"id": "r1", "status": "completed", "output": [],
                                                       "usage": {"input_tokens": input_tokens, "output_tokens": 5,
                                                                 "input_tokens_details": {"cached_tokens": 7}}}}
    return (b'event: response.created\ndata: {"type": "response.created"}\n\n'
            b"event: response.completed\ndata: " + json.dumps(done).encode() + b"\n\n")


class HomeBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self.tmp.name, "ag")
        self.saved = paths.TRACE_DIR, paths.AG_HOME
        paths.AG_HOME, paths.TRACE_DIR = self.root, os.path.join(self.root, "gatherers")
        ag_home._HOMES.clear()

    def tearDown(self):
        paths.TRACE_DIR, paths.AG_HOME = self.saved
        ag_home._HOMES.clear()
        self.tmp.cleanup()

    def ask(self, *requests):
        out = io.StringIO()
        serve(server_for(), [json.dumps(dict(r, id=i)) for i, r in enumerate(requests, 1)], out)
        answers = [json.loads(line) for line in out.getvalue().splitlines()]
        return sorted(answers, key=lambda a: a["id"])        # as asked: each comes out as it is ready

    def reads(self, gatherer="s"):
        conn = sqlite3.connect(paths.db_path(gatherer))
        try:
            return conn.execute("SELECT read_id, est_tokens, real_tokens FROM _reads ORDER BY read_id").fetchall()
        finally:
            conn.close()


class ReadLogTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = sqlite3.connect(os.path.join(self.tmp.name, "g.db"))
        schema.create(self.conn)

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def test_a_read_has_its_estimate_and_later_its_real_count(self):
        read_id = store.record_read(self.conn, None, [], manager="m", est_tokens=1200)
        self.assertEqual((store.last_read(self.conn)["est_tokens"], store.last_read(self.conn)["real_tokens"]),
                         (1200, None))
        self.assertTrue(store.record_real_tokens(self.conn, read_id, 2900))
        self.assertEqual(store.last_read(self.conn)["real_tokens"], 2900)
        self.assertFalse(store.record_real_tokens(self.conn, read_id + 1, 10))   # no such read

    def test_a_file_from_before_reads_had_sizes_gets_the_columns(self):
        old = sqlite3.connect(os.path.join(self.tmp.name, "old.db"))
        old.execute("CREATE TABLE _reads (read_id INTEGER PRIMARY KEY, read_at TEXT NOT NULL, row_id INTEGER, "
                    "manager TEXT, basis TEXT)")
        old.execute("INSERT INTO _reads (read_at, manager) VALUES ('t', 'm')")
        schema.create(old)
        self.assertEqual(store.last_read(old)["real_tokens"], None)
        self.assertTrue(store.record_real_tokens(old, 1, 5))
        old.close()


class ServerTest(HomeBase):
    def test_a_rewrite_names_its_read_and_a_measured_is_recorded_against_it(self):
        first, measured = self.ask(
            {"op": "rewrite", "gatherer": "s", "events": codex.to_events([DEV, user("q", 1)])},
            {"op": "measured", "gatherer": "s", "read_id": 1, "tokens": 4321})
        self.assertIsInstance(first["read_id"], int)
        self.assertEqual(measured["recorded"], True)
        (read_id, est, real), = self.reads()
        self.assertEqual((read_id, real), (first["read_id"], 4321))
        self.assertGreater(est, 0)                             # the policy's own count, beside it

    def test_a_measured_sent_with_the_next_rewrite_is_recorded_before_its_read(self):
        first, = self.ask({"op": "rewrite", "gatherer": "s", "events": codex.to_events([DEV, user("q", 1)])})
        second, = self.ask({"op": "rewrite", "gatherer": "s",
                            "events": codex.to_events([DEV, user("q", 1), user("more", 2)]),
                            "measured": {"read_id": first["read_id"], "tokens": 999}})
        self.assertEqual([r[2] for r in self.reads()], [999, None])
        self.assertEqual(second["read_id"], first["read_id"] + 1)

    def test_a_size_that_is_not_one_is_refused_or_ignored(self):
        bad, ok = self.ask({"op": "measured", "gatherer": "s", "read_id": 1, "tokens": "many"},
                           {"op": "rewrite", "gatherer": "s", "events": codex.to_events([DEV, user("q", 1)]),
                            "measured": {"read_id": True, "tokens": 5}})
        self.assertIn("error", bad)
        self.assertIsNotNone(ok["context"])                    # the call goes on; nothing recorded
        self.assertEqual([r[2] for r in self.reads()], [None])


class MeasuredOverTest(unittest.TestCase):
    """A read whose last call was over max_context_tokens by the provider's count starts a
    build, as one over by the policy's own count does -- once per build."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = paths.TRACE_DIR
        paths.TRACE_DIR = os.path.join(self.tmp.name, "traces")
        self.cfg = ProactiveContextManagerConfig(**SMALL)
        self.policy = ProactiveContextManager(codex_items.FORMAT, ScriptedLLM(), self.cfg)
        self.m = Manager(self.policy)
        self.m.init("s")
        self.spawned = []
        self.policy.jobs = Recording(lambda s, c, job, job_id: self.spawned.append(job))
        self.items = codex_items.CodexItems(self.m)

    def tearDown(self):
        paths.TRACE_DIR = self.saved
        self.tmp.cleanup()

    def put(self, items):
        for item in items:
            self.items.insert("s", item, channel_id="c1")

    def read(self):
        conn = self.m._conn("s")
        return self.m._context("s", store.high_water(conn), ch("c1"))

    def test_under_by_its_own_count_but_over_by_the_provider_s_a_build_starts(self):
        self.put(PREAMBLE + long_turn(3))                   # small: well under the limit by the policy's count
        ctx, read_id = self.read()
        self.assertLess(ctx.tokens, self.cfg.max_context_tokens)
        self.assertEqual(self.spawned, [])
        self.m.record_real_tokens("s", read_id, self.cfg.max_context_tokens + 1)   # the provider counted more
        self.put(long_turn(1, start=10)[1:])                # the next step, mid-turn
        self.read()
        self.assertEqual(self.spawned, ["build"])
        build = tables.latest_build(self.m._conn("s"), "c1")
        self.assertEqual(build["reason"], tables.LIMIT)

    def test_under_by_both_counts_but_over_as_the_provider_would_count_the_next_a_build_starts(self):
        self.put(PREAMBLE + long_turn(6))
        _, read_id = self.read()
        sent = store.last_read(self.m._conn("s"), ch("c1"))["sent_tokens"]
        self.m.record_real_tokens("s", read_id, int(sent * 1.3))          # under the limit, 30% over ag's count
        self.assertLess(int(sent * 1.3), self.cfg.max_context_tokens)
        self.put(long_turn(2, start=10)[1:])                # the next steps: ag's count still under the limit ...
        self.read()
        self.assertEqual(self.spawned, ["build"])           # ... the provider's, by the same 30%, over it
        self.assertEqual(tables.latest_build(self.m._conn("s"), "c1")["reason"], tables.LIMIT)
        now = store.last_read(self.m._conn("s"), ch("c1"))["sent_tokens"]
        self.assertLessEqual(int(now * 1.3), self.cfg.max_context_tokens)   # meanwhile, left out to fit as it counts

    def test_a_count_under_the_limit_starts_nothing(self):
        self.put(PREAMBLE + long_turn(3))
        _, read_id = self.read()
        self.m.record_real_tokens("s", read_id, self.cfg.max_context_tokens - 1)
        self.put(long_turn(1, start=10)[1:])
        self.read()
        self.assertEqual(self.spawned, [])

    def test_a_count_from_before_the_build_in_use_asks_for_no_other(self):
        self.put(PREAMBLE + conversation(8) + long_turn(3, start=50))   # turns enough for a build to condense
        _, read_id = self.read()
        self.m.record_real_tokens("s", read_id, self.cfg.max_context_tokens + 1)
        build_id = tables.new_build(self.m._conn("s"), "c1")
        self.policy.build("s", ch("c1"), build_id)          # a build is ready, made since that call
        self.assertEqual(tables.latest_build(self.m._conn("s"), "c1")["status"], "ready")
        self.put(long_turn(1, start=60)[1:])
        ctx, _ = self.read()
        self.assertEqual(ctx.basis, str(build_id))          # the ready build is taken ...
        self.assertEqual(self.spawned, [])                  # ... and no other is started for the old count


@unittest.skipIf(web is None, "the hook server needs aiohttp")
class ProxyTest(unittest.IsolatedAsyncioTestCase):
    """The codex hook behind the real hook server, the real context manager server behind
    it: the call's input tokens, from the answer, end up on the read its context came from."""

    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = os.environ.get("AG_HOME")
        os.environ["AG_HOME"] = self.home = os.path.join(self.tmp.name, "ag")
        self.tokens = [5000]

        async def upstream(request):
            await request.read()
            resp = web.StreamResponse(headers={"Content-Type": "text/event-stream"})
            await resp.prepare(request)
            for frame in sse(self.tokens[0]).split(b"\n\n")[:-1]:
                await resp.write(frame + b"\n\n")
            await resp.write_eof()
            return resp

        app = web.Application()
        app.router.add_route("*", "/{tail:.*}", upstream)
        self.upstream = TestServer(app)
        await self.upstream.start_server()
        self.client = TestClient(TestServer(hook_server.make_app(
            str(self.upstream.make_url("")).rstrip("/"), codex_ag.CodexContextManager(log=lambda g, line: None))))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        await self.upstream.close()
        if self.saved is None:
            os.environ.pop("AG_HOME", None)
        else:
            os.environ["AG_HOME"] = self.saved
        self.tmp.cleanup()

    def reads(self):
        conn = sqlite3.connect(os.path.join(self.home, "gatherers", "t1", "context.db"))
        try:
            return conn.execute("SELECT est_tokens, real_tokens FROM _reads ORDER BY read_id").fetchall()
        finally:
            conn.close()

    async def call(self, items):
        resp = await self.client.post("/v1/responses", json={"model": "m", "input": items, "stream": True},
                                      headers={"thread-id": "t1"})
        return await resp.read()

    async def test_each_call_s_input_tokens_are_recorded_against_its_read(self):
        await self.call([DEV, user("q", 1)])
        self.tokens[0] = 7300
        await self.call([DEV, user("q", 1), user("more", 2)])
        reads = self.reads()
        self.assertEqual([real for _, real in reads], [5000, 7300])   # recorded before codex saw the end
        self.assertTrue(all(est and est < real for est, real in reads))


class HelpersTest(unittest.TestCase):
    def test_a_read_kept_on_the_request_is_reported_once_the_answer_is_back(self):
        sent = []

        class Client:
            async def request(self, op, body):
                sent.append((op, body))
                return {}

        class Clients:
            def client(self, gatherer):
                return Client()

        class Req:
            state = {}

        req = Req()
        keep_read(req, "g", {"read_id": 3})
        asyncio.run(report_measured(Clients(), req, 1234))
        asyncio.run(report_measured(Clients(), req, None))            # no count: nothing sent
        self.assertEqual(sent, [("measured", {"gatherer": "g", "read_id": 3, "tokens": 1234})])


if __name__ == "__main__":
    unittest.main()
