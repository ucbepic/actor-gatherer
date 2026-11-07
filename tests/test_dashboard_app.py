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
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag_dashboard import app, models, server  # noqa: E402
from test_dashboard import HomeBase  # noqa: E402
from test_dashboard_app_host import insert_here  # noqa: E402


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

    def __init__(self, port, path):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=10)
        self.sock.sendall(f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".encode())
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
        self.assertGreater(len(listed), 100)
        for methods, path, doc in listed:
            self.assertTrue(doc, f"{methods} {path} has no docstring")
        paths = {p for _, p, _ in listed}
        for path in ("/api/home", "/api/stream", "/api/terminal", "/api/edit/stream", "/api/apps/stream",
                     "/browser/w/{key}/stream", "/api/apps/start", "/api/send", "/api/actors/{op:path}"):
            self.assertIn(path, paths)

    def test_the_command_lists_them(self):
        from ag_dashboard.__main__ import main
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(main(["--routes"]), 0)
        lines = out.getvalue().splitlines()
        self.assertEqual(len(lines), len(app.routes()))
        self.assertRegex(next(x for x in lines if " /api/home " in x), r"^GET +/api/home +data\.home\(\)")

    def test_its_schema_can_be_made(self):
        schema = app.create().openapi()                  # what B2 generates the page's types from
        self.assertIn("/api/home", schema["paths"])
        self.assertEqual(schema["paths"]["/api/read"]["get"]["parameters"][1]["schema"]["type"], "integer")

    def test_the_query_is_read_as_the_page_s(self):
        self.assertEqual(app.first_values(b"a=1&b=&a=2&c=%20x"), b"a=1&c=+x")


class StreamsTest(HomeBase):
    def setUp(self):
        super().setUp()
        self.httpd = server.serve("127.0.0.1", 0, live_updates=False)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)
        self.port = self.httpd.server_port
        self.work = tempfile.mkdtemp(dir=self.tmp.name)

    def open(self, path):
        s = Stream(self.port, path)
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
        self.assertEqual({s.event(), s.event()}, {"home", "agent"})
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
        s = self.open(f"/api/edit/stream?path={path}&root={self.work}&conn=c1&client=7")
        self.assertEqual(s.event(), "init")
        room = next(iter(self.httpd.editors.rooms.values()))
        self.assertEqual(list(room.conns), ["c1"])
        s.close()
        self.assertTrue(until(lambda: not room.conns, 2))
        self.assertTrue(until(lambda: not waiting("_taken", "api/common.py"), 2))

    def app_stream(self) -> str:
        """The stream of an app's panel: the Preview's (an app that comes with ag), of this test's folder."""
        h = self.httpd.app_host
        h._write_fn = insert_here
        self.hosts.append(h)
        return f"/api/apps/stream?app=preview&gatherer=g&instance={h.open('preview', 'g', self.work).id}"

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


class ModelsTest(HomeBase):
    """Each model takes the answer it describes and gives it back as it was: it changes nothing of the JSON."""

    def same(self, model, value):
        got = model.model_validate(value).model_dump(exclude_unset=True)
        self.assertEqual(json.dumps(got, sort_keys=True), json.dumps(value, sort_keys=True))

    def test_the_models_describe_the_answers_as_they_are(self):
        from ag_dashboard import data, files
        httpd = server.serve("127.0.0.1", 0, live_updates=False)
        self.addCleanup(httpd.server_close)
        self.same(models.Home, httpd.home_view())
        self.same(models.Agent, data.agent("g", "c1"))
        self.same(models.Agent, data.agent("nope", "c1"))            # {error}
        self.same(models.Transcript, data.transcript("g", "c1"))
        self.same(models.History, data.history("g", "c1", 1))
        self.same(models.Files, files.files("g", "c1"))


if __name__ == "__main__":
    unittest.main()
