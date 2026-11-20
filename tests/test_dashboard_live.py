"""The dashboard, live: a stream (`/api/stream`) sends the home and the selected agent at once,
then again each time they change -- woken by ag's notifications (live.Listener), or, without
them, by a check of the files (live.Fallback)."""
import json
import os
import socket
import sqlite3
import sys
import threading
import time
import unittest
import unittest.mock
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag.ag_harness.store import operations as store  # noqa: E402
from ag_dashboard import data, live, server  # noqa: E402
from channels import ch  # noqa: E402
from test_core import user  # noqa: E402
from test_dashboard import HomeBase  # noqa: E402
import codex_items  # noqa: E402
from replies import answered  # noqa: E402


class Events:
    """A stream's server-sent events, read as they come."""

    def __init__(self, port, query):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=10)
        self.sock.sendall(f"GET /api/stream{query} HTTP/1.1\r\nHost: x\r\n\r\n".encode())
        self.fp = self.sock.makefile("rb")
        head = []
        while (line := self.fp.readline().decode().rstrip("\r\n")):
            head.append(line)
        assert " 200 " in head[0] and "content-type: text/event-stream" in [h.lower() for h in head], head

    def next(self, timeout=5.0):
        """(name, value) of the next event, skipping comments; None if none comes in `timeout`. (Sent in chunks: each
        chunk's size, and the line ending it, is no line of an event.)"""
        self.sock.settimeout(timeout)
        name, payload = None, []
        try:
            while True:
                line = self.fp.readline().decode()
                if not line:
                    return None
                line = line.rstrip("\n")
                if line.startswith("event: "):
                    name = line[7:]
                elif line.startswith("data: "):
                    payload.append(line[6:])
                elif line == "" and name:
                    return name, json.loads("\n".join(payload))
        except (socket.timeout, OSError):
            return None

    def until(self, test, timeout=5.0):
        """The first event `test` accepts, within `timeout`; None if none."""
        end = time.time() + timeout
        while time.time() < end:
            got = self.next(max(0.1, end - time.time()))
            if got and test(*got):
                return got
        return None

    def close(self):
        self.fp.close()
        self.sock.close()


class HubTest(unittest.TestCase):
    def test_a_change_wakes_the_streams_it_concerns(self):
        hub = live.Hub()
        c1, c2, other, none = hub.watch("g", "c1"), hub.watch("g", "c2"), hub.watch("h", "c1"), hub.watch(None, None)
        for w in (c1, c2, other, none):
            self.assertEqual(w.take(), (True, True, set()))    # a new stream: both at once
        hub.ring("g", "c1", "events")
        self.assertEqual([w.take()[:2] for w in (c1, c2, other, none)],
                         [(True, True), (True, False), (True, False), (True, False)])
        hub.ring("g", None, "events")                          # no channel: every channel of g
        self.assertEqual([w.take()[1] for w in (c1, c2, other)], [True, True, False])
        hub.ring(None)                                         # no gatherer: every one
        self.assertEqual([w.take()[1] for w in (c1, c2, other)], [True, True, True])
        hub.drop(c1)
        hub.ring("g", "c1")
        self.assertFalse(c1.wake.is_set())

    def test_a_stream_s_other_actors_are_woken_by_their_own_changes(self):
        hub = live.Hub()
        w = hub.watch("g", "c1", [("g", "c2"), ("my gatherer", "c1")])
        self.assertEqual(w.take(), (True, True, {0, 1}))       # a new stream: all at once
        hub.ring("g", "c2", "events")
        self.assertEqual(w.take(), (True, False, {0}))
        hub.ring("my_gatherer", "c1")                          # its directory: my_gatherer
        self.assertEqual(w.take(), (True, False, {1}))
        hub.ring("g", None)                                    # no channel: every channel of g
        self.assertEqual(w.take(), (True, True, {0}))

    def test_a_gatherer_named_as_ag_was_given_it(self):
        hub = live.Hub()
        w = hub.watch("my_gatherer", "c1")
        w.take()
        hub.ring("my gatherer", "c1")                          # its directory: my_gatherer
        self.assertTrue(w.take()[1])

    def test_a_logged_call_resets_the_call_log_cache(self):
        hub, told = live.Hub(), []
        hub.on_llm = lambda: told.append(1)
        hub.ring("g", "c1", "llm")
        hub.ring("g", "c1", "events")
        self.assertEqual(told, [1])


    def test_a_change_is_counted_and_told_of_its_actor(self):
        hub, told = live.Hub(), []
        hub.on_change = lambda g, c, what, row: told.append((g, c))
        hub.ring("my gatherer", "c1", "events")
        self.assertEqual((hub.version, told), (1, [("my_gatherer", "c1")]))
        hub.ring(None, what="list")                            # the list's own: no actor to read again
        hub.ring(None, None, "llm")                            # the call log: not the home's, not counted
        self.assertEqual((hub.version, told), (2, [("my_gatherer", "c1")]))
        hub.ring("my_gatherer", what="file")                   # its files: what ag told of just now
        self.assertEqual((hub.version, told), (3, [("my_gatherer", "c1")]))
        hub.heard["my_gatherer"] -= live.HEARD_SECONDS         # ag told of nothing lately: a change it did not tell of
        hub.ring("my_gatherer", what="file")
        hub.ring("h", what="file")
        self.assertEqual(told[1:], [("my_gatherer", None), ("h", None)])


class ListenerTest(HomeBase):
    def test_ag_s_notifications_ring_the_hub_and_its_socket_goes_with_it(self):
        hub = live.Hub()
        listener = live.Listener(hub)
        self.addCleanup(listener.close)
        self.assertTrue(listener.ok)
        self.assertTrue(os.path.exists(listener.path))
        w = hub.watch("g", "c1")
        w.take()
        codex_items.CodexItems(self.m).insert("g", user("one more", 91), channel_id="c1")   # ag notifies
        self.assertTrue(w.wake.wait(2))
        self.assertEqual(w.take()[:2], (True, True))
        listener.close()
        self.assertFalse(os.path.exists(listener.path))


class FallbackTest(HomeBase):
    def test_a_write_with_no_notification_is_found_by_the_files(self):
        hub = live.Hub()
        fallback = live.Fallback(hub, seconds=3600)            # checked by hand
        self.addCleanup(fallback.close)
        w = hub.watch("g", "c1")
        w.take()
        fallback.check()
        self.assertEqual(w.take()[:2], (False, False))         # nothing changed
        self.m._conn("g").execute("UPDATE events SET tokens = tokens + 1 WHERE row_id = 1")
        self.m._conn("g").commit()
        fallback.check()
        self.assertEqual(w.take()[:2], (True, True))
        os.makedirs(os.path.join(self.tmp.name, "ag", "logs", "llm"), exist_ok=True)   # the call log
        fallback.check()
        self.assertEqual(w.take()[:2], (True, True))


class KeptTest(HomeBase):
    """The home's agents kept between its reads (data.py's `Kept`): read again only for the channels told of."""

    def setUp(self):
        super().setUp()
        self.kept, self.done = data.Kept(), []
        self.read = unittest.mock.patch.object(data, "_agents", wraps=data._agents)
        self.agents = self.read.start()
        self.addCleanup(self.read.stop)

    def home(self):
        got = data.home([], self.kept)
        self.done += [c.args[2] if len(c.args) > 2 else None for c in self.agents.call_args_list]
        whole = data.home([])                                  # the same as all read again
        self.agents.reset_mock()
        self.assertEqual([g["agents"] for g in got["gatherers"]], [g["agents"] for g in whole["gatherers"]])
        return got

    def asked(self):
        """What `Kept` read since: [None (every channel) or the channels]."""
        got, self.done = self.done, []
        return got

    def test_read_whole_then_only_the_channels_told_of(self):
        self.home()
        self.assertEqual(self.asked(), [None])
        self.home()
        self.assertEqual(self.asked(), [])                     # nothing changed: all as kept
        codex_items.CodexItems(self.m).insert("g", user("one more", 94), channel_id="c2")
        self.kept.changed("g", "c2")
        got = self.home()
        self.assertEqual(self.asked(), [{"c2"}])
        self.assertEqual(next(a for a in got["gatherers"][0]["agents"] if a["channel"] == "c2")["last_user_message"],
                         "one more")
        codex_items.CodexItems(self.m).insert("g", user("for a new one", 95), channel_id="c3")
        self.kept.changed("g", "c3")                           # one not read before
        got = self.home()
        self.assertEqual(self.asked(), [{"c3"}])
        self.assertEqual({a["channel"] for a in got["gatherers"][0]["agents"]}, {"c1", "c2", "c3"})

    def test_read_whole_when_told_of_no_channel_or_of_no_gatherer(self):
        self.home()
        self.asked()
        self.kept.changed("g", None)
        self.home()
        self.kept.changed(None, None)
        self.home()
        self.assertEqual(self.asked(), [None, None])

    def test_read_whole_in_the_background_after_a_while(self):
        done = threading.Event()
        self.kept.refreshed = lambda g: done.set()
        data.home([], self.kept)
        codex_items.CodexItems(self.m).insert("g", user("not told of", 96), channel_id="c2")   # a notification lost
        self.kept.read["g"] -= data.FULL_SECONDS
        said = lambda: next(a for a in data.home([], self.kept)["gatherers"][0]["agents"]   # noqa: E731
                            if a["channel"] == "c2")["last_user_message"]
        self.assertNotEqual(said(), "not told of")               # at once, as kept: the whole read in the background
        self.assertTrue(done.wait(5))
        self.assertEqual(said(), "not told of")
        self.home()                                              # the same as all read again

    def test_a_channel_read_since_the_background_read_began_is_kept(self):
        data.home([], self.kept)
        mine, other = self.kept.kept["g"]["c1"], self.kept.kept["g"]["c2"]
        self.kept.at["g"]["c1"] = time.time() + 60               # read after it began
        self.kept._refresh("g")
        self.assertIs(self.kept.kept["g"]["c1"], mine)
        self.assertIsNot(self.kept.kept["g"]["c2"], other)        # the others: as it read them

    def test_a_count_read_again_for_the_read_s_channel_a_session_opened_for_its_own(self):
        self.home()
        self.asked()
        self.m.record_real_tokens("g", self.reads[0], 12345)    # ag's "counts": the read named, not its channel
        self.kept.changed("g", None, "counts", self.reads[0])
        self.home()
        self.assertEqual(self.asked(), [{"c1"}])
        conn = self.m._conn("g")
        conn.execute("INSERT INTO _open (session, pid, pid_started, opened_at, opened_by, yields) "
                     "VALUES ('c2', 1, 1, '2026-10-29T00:00:00+00:00', 'call', 0)")
        conn.commit()
        self.kept.changed("g", None, "open")                   # ag's "open": no session named
        self.home()
        self.kept.changed("g", None, "open")                   # nothing changed in it since
        self.home()
        self.assertEqual(self.asked(), [{"c2"}])
        self.kept.changed("g", None, "events")                 # a write that named no channel: all of it
        self.home()
        self.assertEqual(self.asked(), [None])

    def test_a_reader_waits_for_a_channel_being_read_again(self):
        data.home([], self.kept)
        codex_items.CodexItems(self.m).insert("g", user("being read", 97), channel_id="c2")
        self.kept.changed("g", "c2")
        reading, go = threading.Event(), threading.Event()
        read = data._agents

        def slow(conn, now, only=None):
            if only:
                reading.set()
                go.wait(5)
            return read(conn, now, only)
        self.read.stop()
        with unittest.mock.patch.object(data, "_agents", slow):
            first = threading.Thread(target=data.home, args=([], self.kept))
            first.start()
            self.assertTrue(reading.wait(5))                    # the first reads c2 again: the second waits for it
            got = []
            second = threading.Thread(target=lambda: got.append(data.home([], self.kept)))
            second.start()
            time.sleep(0.2)
            self.assertEqual(got, [])
            go.set()
            first.join(5), second.join(5)
        self.read.start()
        self.assertEqual(next(a for a in got[0]["gatherers"][0]["agents"] if a["channel"] == "c2")["last_user_message"],
                         "being read")

    def test_the_copies_are_the_caller_s(self):
        got = data.home([], self.kept)
        got["gatherers"][0]["agents"][0]["status"] = "changed"
        self.assertNotEqual(data.home([], self.kept)["gatherers"][0]["agents"][0]["status"], "changed")


class StreamTest(HomeBase):
    def start(self, live_updates=True):
        httpd = server.serve("127.0.0.1", 0, live_updates)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.serving(httpd)                               # stopped before the home goes
        return httpd

    def open(self, httpd, query):
        events = Events(httpd.server_port, query)
        self.addCleanup(events.close)
        return events

    def test_chat_the_agent_and_home_at_once_then_each_change_as_it_is_stored(self):
        httpd = self.start()
        s = self.open(httpd, "?gatherer=g&channel=c1")
        first = [s.next()[0], s.next()[0], s.next()[0]]
        self.assertEqual(first, ["chat", "agent", "home"])     # Chat first: an actor just picked waits for no other read
        top = store.high_water(self.m._conn("g"))
        self.m._context("g", top, ch("c1"))                    # a read: a new call on the chart
        got = s.until(lambda name, a: name == "agent" and len(a["reads"]) == 4, 2)
        self.assertIsNotNone(got)
        answered(self.m, "g", ch("c1"), [{"type": "agent_message", "payload": {"x": 1}, "text": "Done."}], "a1")
        got = s.until(lambda name, a: name == "agent" and a["pending"], 2)
        self.assertEqual(got[1]["pending"][-1]["text"], "Done.")

    def test_chat_comes_while_the_home_is_still_being_read(self):
        httpd = self.start()
        go, real = threading.Event(), httpd.home_view
        httpd.home_view = lambda *a: go.wait(5) and real(*a)            # a slow read of the home
        self.addCleanup(go.set)
        s = self.open(httpd, "?gatherer=g&channel=c1")
        self.assertEqual(s.next(2)[0], "chat")                          # while the home is still being read
        self.assertEqual(s.next(2)[0], "agent")
        self.assertFalse(go.is_set())
        go.set()
        self.assertEqual(s.next(2)[0], "home")

    def test_a_pane_s_actor_comes_while_the_home_is_still_being_read(self):
        """A pane opened beside the actor shown (a task's other actors): its Chat waits for no read of the whole home."""
        httpd = self.start()
        go, real = threading.Event(), httpd.home_view
        httpd.home_view = lambda *a: go.wait(5) and real(*a)            # a slow read of the home
        self.addCleanup(go.set)
        also = urllib.parse.quote(json.dumps([["g", "c2"]]))
        s = self.open(httpd, f"?gatherer=g&channel=c1&also={also}")
        self.assertEqual([s.next(2)[0] for _ in range(3)], ["chat", "agent", "actor"])   # while the home is still read
        self.assertFalse(go.is_set())
        go.set()
        self.assertEqual(s.next(2)[0], "home")

    def test_chat_s_view_at_once_then_as_a_message_is_stored(self):
        httpd = self.start()
        s = self.open(httpd, "?gatherer=g&channel=c1")
        first = s.until(lambda name, v: name == "chat", 2)
        self.assertIsNotNone(first)
        self.assertEqual(set(first[1]), {"turns", "opening", "current", "waiting", "taken_back", "version"})
        n = len(first[1]["turns"])
        codex_items.CodexItems(self.m).insert("g", user("one more", 93), channel_id="c1")
        got = s.until(lambda name, v: name == "chat" and len(v["turns"]) == n + 1, 2)
        self.assertIsNotNone(got)
        self.assertEqual(got[1]["turns"][-1]["text"], "one more")
        self.assertEqual(got[1]["current"]["turn"], got[1]["turns"][-1]["n"])

    def test_chat_s_view_of_an_actor_with_no_gatherer_yet_is_its_sends(self):
        from ag_dashboard import chat_view
        self.assertEqual(chat_view.of("none-yet", "c9")["current"]["state"], "idle")
        sent = {"sent": [{"cid": "p1", "text": "hello", "at": 100.0}, {"cid": "p2", "text": "and", "at": 101.0}]}
        got = chat_view.of("none-yet", "c9", sent, now=103.0)
        self.assertEqual((got["turns"], got["current"]["state"], got["opening"]["cid"], got["opening"]["unseen"]),
                         ([], "opening", "p1", False))
        self.assertEqual([(w["cid"], w["how"]) for w in got["waiting"]], [("p2", "chat")])
        self.assertTrue(chat_view.of("none-yet", "c9", sent, now=200.0)["opening"]["unseen"])

    def test_another_channel_s_change_sends_its_agent_nothing(self):
        httpd = self.start()
        s = self.open(httpd, "?gatherer=g&channel=c1")
        s.next(), s.next(), s.next()                             # home, agent, chat
        codex_items.CodexItems(self.m).insert("g", user("for c2", 92), channel_id="c2")
        got = s.until(lambda name, v: True, 1)
        self.assertIn(got and got[0], ("home", None))           # the home may change; c1 does not
        self.assertIsNone(s.until(lambda name, v: name == "agent", 0.5))

    def test_one_stream_for_a_page_s_panes_sends_each_actor_tagged(self):
        httpd = self.start()
        also = urllib.parse.quote(json.dumps([["g", "c2"], ["g", "nope"], "not a pair", ["", "c1"]]))
        s = self.open(httpd, f"?gatherer=g&channel=c1&also={also}")
        got = [s.next() for _ in range(5)]                     # home, the actor picked, its Chat, and each other, at once
        self.assertEqual(sorted(n for n, _ in got), ["actor", "actor", "agent", "chat", "home"])
        actors = {v["channel"]: v for n, v in got if n == "actor"}
        self.assertEqual(set(actors), {"c2", "nope"})          # what is not a [gatherer, channel] is left out
        self.assertEqual(actors["c2"]["gatherer"], "g")
        self.assertIn("reads", actors["c2"]["agent"])
        codex_items.CodexItems(self.m).insert("g", user("for c2", 93), channel_id="c2")
        self.m._context("g", store.high_water(self.m._conn("g")), ch("c2"))   # a read: a new call on c2's chart
        got = s.until(lambda name, v: name in ("actor", "agent"), 3)
        self.assertEqual((got[0], got[1]["channel"]), ("actor", "c2"))   # c2's change: c2's, not c1's
        self.assertEqual(len(got[1]["agent"]["reads"]), 1)
        self.assertIsNone(s.until(lambda name, v: name == "agent", 0.5))

    def test_one_read_of_the_home_for_every_stream_a_change_wakes(self):
        httpd = self.start()
        streams = [self.open(httpd, "") for _ in range(3)]
        for s in streams:
            self.assertEqual(s.next()[0], "home")
        with unittest.mock.patch.object(data, "home", wraps=data.home) as home:
            self.m._conn("g").execute("UPDATE events SET inserted_at = '2030-01-01T00:00:00+00:00' "   # nothing told of it:
                                      "WHERE row_id = (SELECT max(row_id) FROM events)")
            self.m._conn("g").commit()
            httpd.hub.ring("g", None, "events")                # rung by hand
            for s in streams:
                self.assertIsNotNone(s.until(lambda name, v: name == "home", 3))
            self.assertEqual(home.call_count, 1)

    def test_a_page_s_home_from_what_is_kept(self):
        httpd = self.start()
        get = lambda: json.loads(urllib.request.urlopen(f"http://127.0.0.1:{httpd.server_port}/api/home").read())   # noqa: E731
        self.assertEqual(get()["gatherers"][0]["name"], "g")
        with unittest.mock.patch.object(data, "_agents", wraps=data._agents) as read:
            got = get()
        self.assertEqual([c.args[2:] for c in read.call_args_list], [])   # nothing read again: nothing changed
        self.assertEqual({a["channel"] for a in got["gatherers"][0]["agents"]}, {"c1", "c2"})

    def test_a_page_opened_later_reads_the_home_again(self):
        httpd = self.start()
        self.assertEqual(self.open(httpd, "").next()[0], "home")
        with unittest.mock.patch.object(server, "SHARED_SECONDS", 0.2), \
                unittest.mock.patch.object(data, "home", wraps=data.home) as home:
            time.sleep(0.3)                                    # nothing rung since: too old all the same
            self.assertEqual(self.open(httpd, "").next()[0], "home")
            self.assertEqual(home.call_count, 1)

    def test_a_stream_with_no_agent_sends_the_home(self):
        httpd = self.start()
        s = self.open(httpd, "")
        name, home = s.next()
        self.assertEqual((name, home["gatherers"][0]["name"]), ("home", "g"))

    def test_a_home_not_read_for_a_locked_database_leaves_the_stream_up(self):
        httpd = self.start()
        s = self.open(httpd, "")
        self.assertEqual(s.next()[0], "home")
        real, calls = type(httpd).read_home, []

        def first_locked(srv):
            calls.append(1)
            if len(calls) == 1:
                raise sqlite3.OperationalError("database is locked")
            return real(srv)
        with unittest.mock.patch.object(type(httpd), "read_home", first_locked), \
                unittest.mock.patch.object(server, "SHARED_SECONDS", 0):
            httpd.hub.ring("g", None, "events")
            end = time.time() + 3
            while not calls and time.time() < end:          # read, and not read for the lock
                time.sleep(0.05)
            self.m._conn("g").execute("UPDATE events SET inserted_at = '2030-01-01T00:00:00+00:00' "   # a change since
                                      "WHERE row_id = (SELECT max(row_id) FROM events)")
            self.m._conn("g").commit()
            httpd.hub.ring("g", None, "events")
            name, home = s.next(3)                          # the stream still up: the next event is the home read again
        self.assertEqual((name, len(calls)), ("home", 2))

    def test_a_closed_page_s_stream_is_let_go(self):
        httpd = self.start()
        s = self.open(httpd, "?gatherer=g&channel=c1")
        s.next(), s.next()
        self.assertEqual(len(httpd.hub.watches), 1)
        s.close()
        end = time.time() + 5
        while httpd.hub.watches and time.time() < end:          # found at its next write
            httpd.hub.ring("g", "c1")
            time.sleep(0.1)
        self.assertEqual(len(httpd.hub.watches), 0)

    def test_a_dashboard_killed_or_hung_up_on_removes_its_socket(self):
        import signal
        import subprocess
        folder = os.path.join(self.tmp.name, "ag", "listeners")
        repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        for sig in (signal.SIGTERM, signal.SIGHUP):
            proc = subprocess.Popen([sys.executable, "-m", "ag_dashboard", "--home", os.path.join(self.tmp.name, "ag"),
                                     "--port", "0"], cwd=repo, stderr=subprocess.PIPE, text=True)
            self.assertIn("live from ag's notifications", proc.stderr.readline())    # up, its socket bound
            self.assertEqual(len(os.listdir(folder)), 1)
            proc.send_signal(sig)
            self.assertEqual(proc.wait(10), 0, sig)
            proc.stderr.close()
            self.assertEqual(os.listdir(folder), [], sig)

    def test_closing_the_server_removes_its_socket(self):
        httpd = server.serve("127.0.0.1", 0)
        path = httpd.listener.path
        self.assertTrue(os.path.exists(path))
        httpd.server_close()
        self.assertFalse(os.path.exists(path))


if __name__ == "__main__":
    unittest.main()
