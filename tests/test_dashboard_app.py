"""The dashboard's FastAPI app (ag_dashboard/app.py, api/): every route says what it answers; a stream lets go of what it
holds -- and its thread -- as soon as its page goes, and ends when the server stops; the query is read as the page's;
the models describe the main answers without changing them."""
import http.client
import io
import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.parse
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pydantic import TypeAdapter, ValidationError  # noqa: E402

from ag.ag_harness.store import paths  # noqa: E402
from ag_dashboard import app, models, server  # noqa: E402
from ag_dashboard import home as dashboard_home  # noqa: E402
from test_dashboard import HomeBase  # noqa: E402
from test_dashboard_app_host import insert_here  # noqa: E402
import web_home  # noqa: E402


def waiting(name: str, where: str) -> bool:
    """Whether a thread is in the function `name` of a file ending in `where` now."""
    for frame in sys._current_frames().values():
        while frame is not None:
            if frame.f_code.co_name == name and frame.f_code.co_filename.endswith(where):
                return True
            frame = frame.f_back
    return False


def until(test, seconds=3.0) -> bool:
    end = time.time() + seconds
    while time.time() < end:
        if test():
            return True
        time.sleep(0.05)
    return test()


class Stream:
    """A stream opened by hand: its first lines read, then closed as a page that goes closes it."""

    def __init__(self, port, path, host="127.0.0.1"):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=10)
        self.sock.sendall(f"GET {path} HTTP/1.1\r\nHost: {host}\r\n\r\n".encode())
        self.fp = self.sock.makefile("rb")
        self.head = []
        while (line := self.fp.readline().decode().rstrip("\r\n")):
            self.head.append(line)

    def event(self) -> str:
        """The next event's name."""
        while True:
            line = self.fp.readline().decode()
            if not line:
                return ""
            if line.startswith("event: "):
                return line[7:].strip()

    def rest(self) -> bytes:
        """All the rest, until the server ends it."""
        return self.fp.read()

    def close(self):
        self.fp.close()
        self.sock.close()


class RoutesTest(unittest.TestCase):
    def test_every_route_says_what_it_answers(self):
        listed = app.routes()
        self.assertGreater(len(listed), 80)             # (the apps' own routes are on their own origins)
        for methods, path, doc in listed:
            self.assertTrue(doc, f"{methods} {path} has no docstring")
        paths = {p for _, p, _ in listed}
        for path in ("/api/home", "/api/stream", "/api/terminal", "/api/apps/stream",
                     "/api/desktop", "/api/apps/start", "/api/send", "/api/actors/{op:path}"):
            self.assertIn(path, paths)
        self.assertFalse([p for p in paths if p.startswith("/api/edit/")])   # the Editor app's, on its own origin

    def test_the_command_lists_them(self):
        from ag_dashboard.__main__ import main
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(main(["--routes"]), 0)
        lines = out.getvalue().splitlines()
        self.assertEqual(len(lines), len(app.routes()))
        self.assertRegex(next(x for x in lines if " /api/home " in x), r"^GET +/api/home +data\.home\(\)")

    def test_its_schema_can_be_made(self):
        schema = app.schema()                            # what the page's types are generated from (B2)
        self.assertIn("/api/home", schema["paths"])
        self.assertEqual(schema["paths"]["/api/read"]["get"]["parameters"][1]["schema"]["type"], "integer")
        out = io.StringIO()
        from ag_dashboard.__main__ import main
        with redirect_stdout(out):
            self.assertEqual(main(["--openapi"]), 0)
        self.assertEqual(json.loads(out.getvalue()), json.loads(json.dumps(schema)))

    def test_the_query_is_read_as_the_page_s(self):
        self.assertEqual(app.first_values(b"a=1&b=&a=2&c=%20x"), b"a=1&c=+x")


class StreamsTest(HomeBase):
    def setUp(self):
        super().setUp()
        self.httpd = server.serve("127.0.0.1", 0, live_updates=False)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.serving(self.httpd)                          # stopped before the home goes
        self.port = self.httpd.server_port
        self.work = tempfile.mkdtemp(dir=self.tmp.name)

    def open(self, path, host="127.0.0.1"):
        s = Stream(self.port, path, host)
        self.addCleanup(s.close)
        self.assertIn(" 200 ", s.head[0])
        return s

    def post(self, path, body):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("POST", path, json.dumps(body), {"Content-Type": "application/json"})
        r = conn.getresponse()
        return r.status, json.loads(r.read())

    def test_the_home_stream_lets_go_of_its_watch_and_its_thread_once_its_page_goes(self):
        s = self.open("/api/stream?gatherer=g&channel=c1")
        self.assertEqual([s.event(), s.event(), s.event()], ["chat", "agent", "home"])
        self.assertTrue(until(lambda: waiting("next_events", "api/stream.py")))   # waits, in a thread, for a change
        self.assertEqual(len(self.httpd.hub.watches), 1)
        s.close()
        self.assertTrue(until(lambda: not self.httpd.hub.watches, 2))           # at once: not at its next write
        self.assertTrue(until(lambda: not waiting("next_events", "api/stream.py"), 2))

    def test_a_terminal_stream_lets_go_of_its_thread_once_its_page_goes(self):
        code, sh = self.post("/api/shells", {"gatherer": "g", "cwd": self.work})
        self.assertEqual(code, 200, sh)
        s = self.open(f"/api/terminal?session_id={sh['id']}")
        self.assertEqual(s.event(), "out")
        self.assertTrue(until(lambda: waiting("output", "ag_dashboard/sessions.py")))
        s.close()
        self.assertTrue(until(lambda: not waiting("output", "ag_dashboard/sessions.py"), 3))

    def test_an_editor_stream_leaves_its_file_once_its_page_goes(self):
        path = os.path.join(self.work, "a.txt")
        with open(path, "w") as fh:
            fh.write("hello\n")
        s = self.open(f"/api/edit/stream?path={path}&root={self.work}&conn=c1&client=7",   # the Editor app's
                      host=f"files.localhost:{self.port}")
        self.assertEqual(s.event(), "init")
        room = next(iter(self.httpd.docs.rooms.values()))
        self.assertEqual(list(room.conns), ["c1"])
        s.close()
        self.assertTrue(until(lambda: not room.conns, 2))
        self.assertTrue(until(lambda: not waiting("take", "ag_dashboard/app_docs.py"), 2))

    def app_stream(self) -> str:
        """The stream of an app's panel: the Editor's (an app that comes with ag)."""
        h = self.httpd.app_host
        h._write_fn = insert_here
        self.hosts.append(h)
        return f"/api/apps/stream?app=files&gatherer=g&instance={h.open('files', 'g', self.work).id}"

    def test_an_app_s_stream_lets_go_of_its_subscription_once_its_page_goes(self):
        s = self.open(self.app_stream())
        self.assertTrue(until(lambda: self.httpd.app_host.subs))
        s.close()
        self.assertTrue(until(lambda: not self.httpd.app_host.subs, 2))
        self.assertTrue(until(lambda: not waiting("_taken", "api/common.py"), 2))

    def test_the_server_s_stop_ends_its_streams(self):
        streams = [self.open("/api/stream"), self.open(self.app_stream())]
        self.assertEqual(streams[0].event(), "home")
        start = time.time()
        self.httpd.shutdown()
        self.assertLess(time.time() - start, server.STOP_SECONDS)   # not kept waiting for them
        for s in streams:
            s.sock.settimeout(5)
            s.rest()                                    # each ended: read to its end, not timed out
        self.assertEqual(self.httpd.hub.watches, set())
        self.assertEqual(self.httpd.app_host.subs, [])


#: The GET routes whose answers the page reads, each checked against the model it declares (its `response_model`).
DESCRIBED = ("/api/home", "/api/agent", "/api/files", "/api/transcript", "/api/history", "/api/context", "/api/outline",
             "/api/search", "/api/event", "/api/extracts", "/api/monitor", "/api/settings", "/api/apps",
             "/api/apps/catalog", "/api/apps/updates", "/api/stream")


def declared(path: str):
    """The model the GET route `path` declares it answers (its `response_model`)."""
    return next(r.response_model for router in app.ROUTERS for r in router.routes
                if getattr(r, "path", None) == path and "GET" in (getattr(r, "methods", None) or ()))


class Described:
    """What checks a dashboard's answers against the models: each route's own, requested of the server it serves."""

    def same(self, model, value) -> None:
        """`model` takes `value` -- a field it says is always there that `value` lacks, or one of another type, fails
        it -- and gives it back as it was (its keys, their order aside; not a number made a float)."""
        adapter = TypeAdapter(model)
        got = adapter.dump_python(adapter.validate_python(value), exclude_unset=True, by_alias=True, mode="json")
        self.assertEqual(json.dumps(got, sort_keys=True), json.dumps(value, sort_keys=True))

    def get(self, path: str):
        """GET `path` of the served dashboard: its JSON, checked against its route's model."""
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=30)
        try:
            conn.request("GET", path)
            r = conn.getresponse()
            body = r.read()
        finally:
            conn.close()
        self.assertEqual(r.status, 200, body[:300])
        value = json.loads(body)
        with self.subTest(path=path):
            self.same(declared(path.split("?")[0]), value)
        return value

    def stream(self, query: str) -> dict:
        """The stream's first events -- `chat`, `agent`, `home` -- each checked as its event's field of the stream's model."""
        s = Stream(self.httpd.server_port, "/api/stream?" + query)
        got, name = {}, None
        try:
            while len(got) < 3:
                line = s.fp.readline().decode()
                if line.startswith("event: "):
                    name = line[7:].strip()
                elif line.startswith("data: ") and name:
                    got[name] = json.loads(line[6:])
        finally:
            s.close()
        for name, value in got.items():
            with self.subTest(event=name):
                self.same(declared("/api/stream"), {name: value})
        return got

    def check_every_route(self, gatherer: str) -> None:
        """Every route the page reads, for each of the gatherer's actors; and their {error}, of a gatherer with none."""
        q = urllib.parse.quote
        home = self.get("/api/home")
        actors = next(g for g in home["gatherers"] if g["name"] == gatherer)["agents"]
        self.assertTrue(actors)
        read = turned = False
        for a in actors:
            at = f"gatherer={gatherer}&channel={q(a['channel'])}"
            agent = self.get(f"/api/agent?{at}")
            if agent["reads"]:
                read = True
                self.get(f"/api/context?gatherer={gatherer}&read_id={agent['reads'][-1]['read_id']}")
            files = self.get(f"/api/files?{at}")
            if files["turns"]:
                turned = True
                self.get(f"/api/files?{at}&turn=0")
            self.get(f"/api/transcript?{at}")
            self.get(f"/api/history?{at}&from=1")
            self.get(f"/api/outline?{at}")
            self.get(f"/api/search?{at}&q=the")
            self.get(f"/api/monitor?actors={q(json.dumps([[gatherer, a['channel'], a['cwd']]]))}")
            self.assertEqual(set(self.stream(at)), {"chat", "agent", "home"})
        self.assertTrue(read and turned)                 # a call's context, and a turn's files, among them
        self.get(f"/api/event?gatherer={gatherer}&row_id=1")
        self.get(f"/api/extracts?gatherer={gatherer}")
        for path in ("/api/agent", "/api/files", "/api/transcript", "/api/history", "/api/outline"):
            self.assertIn("error", self.get(f"{path}?gatherer=nope&channel=c1&from=1"))
        self.get("/api/settings")
        self.get(f"/api/apps?gatherer={gatherer}")
        self.get("/api/apps")
        catalog = self.get("/api/apps/catalog")
        self.assertTrue(catalog["installed"])


class ModelsTest(Described, HomeBase):
    """Each model takes the answers it describes, as the server sends them, and gives each back as it was: it changes
    nothing of the JSON, and every field it says is always there is."""

    def setUp(self):
        super().setUp()
        self.httpd = server.serve("127.0.0.1", 0, live_updates=False)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.serving(self.httpd)

    def test_the_models_describe_the_answers_as_they_are(self):
        self.check_every_route("g")

    def test_an_answer_short_of_a_field_said_to_be_there_fails(self):
        home = json.loads(json.dumps(self.httpd.home_view()))
        self.same(models.Home, home)

        def actor(h):
            return h["gatherers"][0]["agents"][0]
        for change in (lambda h: actor(h).pop("status"),                  # a field always there, left out
                       lambda h: actor(h).update(events="three"),         # of another type
                       lambda h: actor(h).update(name={"by": "user"}),    # a field of a field's, left out
                       lambda h: h.pop("app_groups")):
            broken = json.loads(json.dumps(home))
            change(broken)
            with self.assertRaises(ValidationError):
                models.Home.model_validate(broken)

    def test_each_route_the_page_reads_declares_its_model(self):
        for path in DESCRIBED:
            self.assertIsNotNone(declared(path), path)
        schema = app.schema()
        agent = schema["paths"]["/api/agent"]["get"]["responses"]
        self.assertEqual(list(agent), ["200"])           # not FastAPI's 422: a request it finds invalid is a 404 here
        self.assertEqual({x["$ref"] for x in agent["200"]["content"]["application/json"]["schema"]["anyOf"]},
                         {"#/components/schemas/Agent", "#/components/schemas/Failed"})
        self.assertNotIn("HTTPValidationError", schema["components"]["schemas"])
        events = schema["paths"]["/api/stream"]["get"]["responses"]["200"]["content"]
        self.assertEqual(events, {"text/event-stream": {"schema": {"$ref": "#/components/schemas/Stream"}}})


class WebHomeModelsTest(Described, unittest.TestCase):
    """The same on the browser tests' home (tests/web_home.py): a Claude Code and a Codex actor, each the conversation of
    its harness's newest recorded session, with a recap and a name."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        saved = paths.AG_HOME, paths.TRACE_DIR, dashboard_home.HOME
        self.addCleanup(tmp.cleanup)
        self.addCleanup(lambda: (setattr(paths, "AG_HOME", saved[0]), setattr(paths, "TRACE_DIR", saved[1]),
                                 setattr(dashboard_home, "HOME", saved[2])))
        with redirect_stdout(io.StringIO()):
            web_home.build(os.path.join(tmp.name, "ag"))
        self.httpd = server.serve("127.0.0.1", 0, live_updates=False)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (self.httpd.shutdown(), self.httpd.server_close()))   # before the home goes

    def test_the_models_describe_the_answers_as_they_are(self):
        self.check_every_route(web_home.GATHERER)


if __name__ == "__main__":
    unittest.main()
