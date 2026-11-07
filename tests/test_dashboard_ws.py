"""The page's streams over one WebSocket (ag_dashboard/api/ws.py): opened and closed by URL on it, each its route as a
GET would run it, letting go of what it holds once its page lets it go or the socket goes; only the dashboard's own page
may open one; the server's stop ends it."""
import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
from collections import deque

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from wsproto import ConnectionType, WSConnection  # noqa: E402
from wsproto.events import (AcceptConnection, CloseConnection, Ping, RejectConnection, Request,  # noqa: E402
                            TextMessage)

from ag_dashboard import server  # noqa: E402
from ag_dashboard.api import ws  # noqa: E402
from test_dashboard import HomeBase  # noqa: E402
from test_dashboard_app_host import insert_here  # noqa: E402
from test_dashboard_app import until, waiting  # noqa: E402


class Socket:
    """A page's WebSocket to /api/ws, by hand: its messages read one at a time, each (stream id, event name, data)."""

    def __init__(self, port: int, origin=None, host=None):
        host = host or f"127.0.0.1:{port}"
        origin = f"http://{host}" if origin is None else origin
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=10)
        self.ws = WSConnection(ConnectionType.CLIENT)
        extra = [(b"origin", origin.encode())] if origin else []
        self.sock.sendall(self.ws.send(Request(host=host, target="/api/ws", extra_headers=extra)))
        self.got, self.text, self.closed = deque(), "", None
        self.accepted = self._wait_for(lambda: self.accepted is not None, accepted=None)

    def _wait_for(self, done, accepted="unset"):
        if accepted != "unset":
            self.accepted = accepted
        while not done():
            data = self.sock.recv(1 << 20)
            self.ws.receive_data(data or None)
            for ev in self.ws.events():
                if isinstance(ev, AcceptConnection):
                    self.accepted = True
                elif isinstance(ev, RejectConnection):
                    self.accepted, self.status = False, ev.status_code
                elif isinstance(ev, TextMessage):
                    self.text += ev.data
                    if ev.message_finished:
                        self.got.append(tuple(self.text.split("\n", 2)))
                        self.text = ""
                elif isinstance(ev, Ping):
                    self.sock.sendall(self.ws.send(ev.response()))
                elif isinstance(ev, CloseConnection):
                    self.closed = ev.code
                    return self.accepted
            if not data:
                self.closed = self.closed or -1
                return self.accepted
        return self.accepted

    def next(self):
        """The next message, or None once the socket closed."""
        self._wait_for(lambda: self.got or self.closed is not None)
        return self.got.popleft() if self.got else None

    def until(self, sid: str, name: str):
        """Messages up to the first `name` of stream `sid` (that one returned); None if the socket closed first."""
        while (got := self.next()) is not None:
            if got[0] == sid and got[1] == name:
                return got
        return None

    def until_all(self, *wanted) -> bool:
        """Messages up to the first of each (stream, name) in `wanted`, in whatever order the streams send them (each
        its own, side by side); whether all came before the socket closed."""
        left = set(wanted)
        while left and (got := self.next()) is not None:
            left.discard(got[:2])
        return not left

    def say(self, value: dict):
        self.sock.sendall(self.ws.send(TextMessage(data=json.dumps(value))))

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


class StreamsOverOneSocketTest(HomeBase):
    def setUp(self):
        super().setUp()
        self.httpd = server.serve("127.0.0.1", 0, live_updates=False)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)
        self.port = self.httpd.server_port
        self.work = tempfile.mkdtemp(dir=self.tmp.name)

    def socket(self, **kw) -> Socket:
        s = Socket(self.port, **kw)
        self.addCleanup(s.close)
        return s

    def page(self) -> Socket:
        s = self.socket()
        self.assertTrue(s.accepted)
        self.assertEqual(s.next(), ("0", "hello", ""))
        return s

    def post(self, path, body):
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("POST", path, json.dumps(body), {"Content-Type": "application/json"})
        r = conn.getresponse()
        return r.status, json.loads(r.read())

    def test_streams_come_on_it_by_url_each_let_go_as_its_page_closes_it(self):
        s = self.page()
        s.say({"open": "1", "url": "/api/stream?gatherer=g&channel=c1"})
        self.assertEqual(s.next(), ("1", "!open", ""))
        names = {s.next()[1], s.next()[1]}
        self.assertEqual(names, {"home", "agent"})
        self.assertTrue(until(lambda: len(self.httpd.hub.watches) == 1))
        h = self.httpd.app_host                             # an app's panel's stream: the Preview's (one ag comes with)
        h._write_fn = insert_here
        self.addCleanup(h.flush)
        i = h.open("preview", "g", self.work)
        s.say({"open": "2", "url": f"/api/apps/stream?app=preview&gatherer=g&instance={i.id}"})
        self.assertIsNotNone(s.until("2", "!open"))
        self.assertTrue(until(lambda: h.subs))
        s.say({"close": "1"})                               # the one let go: the other still open
        self.assertTrue(until(lambda: not self.httpd.hub.watches, 2))
        self.assertTrue(until(lambda: not waiting("next_events", "api/stream.py"), 2))
        self.assertEqual(len(h.subs), 1)

    def test_an_event_s_data_comes_as_the_route_sends_it(self):
        s = self.page()
        s.say({"open": "a", "url": "/api/stream"})
        _, name, data = s.until("a", "home")
        self.assertEqual(json.loads(data)["gatherers"][0]["name"], "g")

    def test_the_socket_going_lets_go_of_every_stream_on_it(self):
        code, sh = self.post("/api/shells", {"gatherer": "g", "cwd": self.work})
        self.assertEqual(code, 200, sh)
        path = os.path.join(self.work, "a.txt")
        with open(path, "w") as fh:
            fh.write("hello\n")
        s = self.page()
        s.say({"open": "1", "url": "/api/stream?gatherer=g&channel=c1"})
        s.say({"open": "2", "url": f"/api/terminal?session_id={sh['id']}"})
        s.say({"open": "3", "url": f"/api/edit/stream?path={path}&root={self.work}&conn=c1&client=7"})
        self.assertTrue(s.until_all(("2", "out"), ("3", "init")))       # either first: the editor's may come before
        room = next(iter(self.httpd.editors.rooms.values()))
        self.assertEqual(list(room.conns), ["c1"])
        s.close()
        self.assertTrue(until(lambda: not self.httpd.hub.watches, 3))
        self.assertTrue(until(lambda: not room.conns, 3))
        self.assertTrue(until(lambda: not waiting("output", "ag_dashboard/sessions.py"), 3))

    def test_a_stream_that_ends_says_so(self):
        code, sh = self.post("/api/shells", {"gatherer": "g", "cwd": self.work})
        self.assertEqual(code, 200, sh)
        s = self.page()
        s.say({"open": "t", "url": f"/api/terminal?session_id={sh['id']}"})
        self.assertIsNotNone(s.until("t", "out"))
        self.post("/api/terminal/input", {"session_id": sh["id"], "data": "exit\r"})
        self.assertIsNotNone(s.until("t", "exit"))
        self.assertIsNotNone(s.until("t", "!end"))

    def test_what_is_not_a_stream_is_refused(self):
        s = self.page()
        s.say({"open": "1", "url": "/api/home"})
        self.assertEqual(s.next(), ("1", "!fail", "404"))
        s.say({"open": "2", "url": "/browser/w/nope/stream"})   # a stream's path, refused by its route
        self.assertEqual(s.until("2", "!fail")[2], "404")
        s.say({"open": "3", "url": "/api/stream"})               # the socket still works
        self.assertIsNotNone(s.until("3", "home"))

    def test_only_the_dashboard_s_own_page_may_open_one(self):
        self.assertFalse(self.socket(origin="https://example.com").accepted)
        self.assertFalse(self.socket(origin="").accepted)                    # no origin: not a page's
        self.assertFalse(self.socket(host="attacker.example:80").accepted)   # a name rebound to this host
        self.assertTrue(self.socket(host=f"localhost:{self.port}").accepted)

    def test_the_server_s_stop_ends_it(self):
        s = self.page()
        s.say({"open": "1", "url": "/api/stream"})
        self.assertIsNotNone(s.until("1", "home"))
        start = time.time()
        self.httpd.shutdown()
        self.assertLess(time.time() - start, server.STOP_SECONDS + 0.5)
        while s.next() is not None:                           # read to its close, not timed out
            pass
        self.assertEqual(self.httpd.hub.watches, set())

    def test_its_events_are_read_as_eventsource_reads_them(self):
        raw = (b": keepalive\n\nevent: out\ndata: {\"a\": 1}\n\nretry: 10\n\ndata: x\ndata: y\n\n"
               b"event: two\ndata:no space\n\nevent: none\n\n")
        self.assertEqual(list(ws.events(raw)), [("out", '{"a": 1}'), ("message", "x\ny"), ("two", "no space")])


if __name__ == "__main__":
    unittest.main()
