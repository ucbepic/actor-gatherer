"""Naming an actor from the dashboard: the name kept as a `name` event by "user" (`ag home insert`, naming.py), the
list showing it ahead of the harness's own (data.py), the harness's own store given it (harness_kit's `rename`:
Claude Code's record, codex's app server -- here a fake codex), and Claude Code's /rename typed into the dashboard's
terminal once the session's turn is over (sessions.py's `rename`, `rename_due`)."""
import contextlib
import io
import json
import os
import stat
import sys
import tempfile
import textwrap
import threading
import time
import unittest
import unittest.mock
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import harness_kit  # noqa: E402
from harness_kit.base import follow  # noqa: E402
from harness_kit.claude import ClaudeCode  # noqa: E402
from ag.integrations.tools.ag_orchestrator.records import fact  # noqa: E402
from ag.ag_harness.home.__main__ import main as home_main  # noqa: E402
from ag_dashboard import data, naming, server, sessions  # noqa: E402
from test_dashboard import HomeBase  # noqa: E402
from test_dashboard_sessions import FAKE_AG, SessionsBase  # noqa: E402

# A fake codex: `codex app-server` answers JSON-RPC on its stdin, one message a line, and logs each to $FAKE_CODEX_LOG;
# a thread named "missing" is not found.
FAKE_CODEX = textwrap.dedent("""\
    #!%s
    import json, os, sys
    assert sys.argv[1:] == ["app-server"], sys.argv
    log = open(os.environ["FAKE_CODEX_LOG"], "a")
    for line in sys.stdin:
        m = json.loads(line)
        log.write(json.dumps(m) + "\\n"); log.flush()
        if "id" not in m:
            continue
        if m["method"] == "thread/name/set" and m["params"]["threadId"] == "missing":
            out = {"id": m["id"], "error": {"code": -32600, "message": "no rollout found for thread id missing"}}
        else:
            out = {"id": m["id"], "result": {}}
        print(json.dumps({"method": "remoteControl/status/changed", "params": {}}), flush=True)   # a notice first
        print(json.dumps(out), flush=True)
""") % sys.executable

# The sessions tests' fake ag, with `ag home insert` answering as ag does (its arguments logged all the same).
NAMING_AG = FAKE_AG.replace('''    open(os.environ["FAKE_AG_LOG"] + ".home", "a").write(json.dumps(sys.argv[2:]) + "\\n")
    sys.exit(0)''', '''    open(os.environ["FAKE_AG_LOG"] + ".home", "a").write(json.dumps(sys.argv[2:]) + "\\n")
    if sys.argv[2:3] == ["insert"]:
        print(json.dumps({"rows": [1]}))
    sys.exit(0)''')
assert NAMING_AG != FAKE_AG


class ClaudeRecordTest(unittest.TestCase):
    """Claude Code's record of a session given a name: a custom-title line, as its own /rename writes it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.record = os.path.join(self.tmp.name, "s1.jsonl")
        self.claude = harness_kit.get("claude")

    def lines(self):
        with open(self.record, encoding="utf-8") as fh:
            return fh.read().split("\n")

    def test_a_name_is_a_custom_title_line_as_claude_code_writes_and_finds_it(self):
        with open(self.record, "w") as fh:
            fh.write('{"type":"user"}\n')
        self.assertEqual(self.claude.rename("s1", "  Fix the\nlist  ", self.record), "named in its record")
        self.assertEqual(self.lines(), ['{"type":"user"}', '{"type":"custom-title","customTitle":"Fix the list","sessionId":"s1"}', ""])
        self.claude.rename("s1", "Ünïcode", self.record)          # as typed, not escaped: Claude Code's own search reads it
        self.assertIn('"customTitle":"Ünïcode"', self.lines()[2])

    def test_a_last_line_left_open_is_not_joined(self):
        with open(self.record, "w") as fh:
            fh.write('{"type":"user"}\n{"type":"assistant"')
        self.claude.rename("s1", "x", self.record)
        self.assertEqual(self.lines()[1:], ['{"type":"assistant"', '{"type":"custom-title","customTitle":"x","sessionId":"s1"}', ""])

    def test_no_record_no_name(self):
        for record in (None, os.path.join(self.tmp.name, "none.jsonl")):
            with self.assertRaises(harness_kit.RenameError):
                self.claude.rename("s1", "x", record)

    def test_its_command_is_its_own_rename_on_one_line(self):
        self.assertEqual(self.claude.rename_command(" Fix\n the  list "), "/rename Fix the list")
        self.assertIsNone(self.claude.rename_command("  "))
        self.assertEqual(harness_kit.get("codex").rename_command("Vivaldi's\n poem"), "/rename Vivaldi's poem")
        self.assertIsNone(harness_kit.get("codex").rename_command(""))      # without a name, codex's asks in a dialog


class CodexAppServerTest(unittest.TestCase):
    """Codex's thread named through its app server, as its own /rename names it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        bin_dir = os.path.join(self.tmp.name, "bin")
        os.makedirs(bin_dir)
        fake = os.path.join(bin_dir, "codex")
        with open(fake, "w") as fh:
            fh.write(FAKE_CODEX)
        os.chmod(fake, os.stat(fake).st_mode | stat.S_IXUSR)
        self.log = os.path.join(self.tmp.name, "codex.log")
        self.env = {**os.environ, "PATH": bin_dir + os.pathsep + os.environ.get("PATH", ""), "FAKE_CODEX_LOG": self.log}
        self.codex = harness_kit.get("codex")

    def sent(self):
        with open(self.log) as fh:
            return [json.loads(line) for line in fh]

    def test_initialized_then_the_name_set(self):
        self.assertEqual(self.codex.rename("t1", " Greeting\n thread ", env=self.env), "named in its state")
        self.assertEqual([m["method"] for m in self.sent()], ["initialize", "initialized", "thread/name/set"])
        self.assertEqual(self.sent()[2]["params"], {"threadId": "t1", "name": "Greeting thread"})

    def test_what_it_refuses_and_an_empty_name(self):
        with self.assertRaisesRegex(harness_kit.RenameError, "no rollout found"):
            self.codex.rename("missing", "x", env=self.env)
        with self.assertRaisesRegex(harness_kit.RenameError, "no empty name"):
            self.codex.rename("t1", "  ", env=self.env)
        with self.assertRaisesRegex(harness_kit.RenameError, "could not be run"):
            self.codex.rename("t1", "x", env={**self.env, "PATH": os.path.join(self.tmp.name, "nowhere")})


class InsertTest(HomeBase):
    """`ag home insert`: a reader's events put into a gatherer, as the server's `insert` takes a harness's."""

    def insert(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = home_main(["insert", *args])
        return code, json.loads(out.getvalue().strip().splitlines()[-1])

    def name_event(self, text, channel="c1"):
        return self.insert("g", "--properties", json.dumps({"channel": channel}),
                           "--events", json.dumps([{"type": "name", "payload": {"text": text, "by": "user"}}]))

    def names(self):
        return {a["channel"]: a["name"] for g in data.home([])["gatherers"] for a in g["agents"]}

    def test_a_name_is_an_event_of_the_channel_and_the_list_shows_it(self):
        code, got = self.name_event("Lighthouse")
        self.assertEqual(code, 0)
        self.assertEqual(len(got["rows"]), 1)
        self.assertEqual(self.names()["c1"], {"text": "Lighthouse", "by": "user"})
        self.assertIsNone(self.names()["c2"])

    def test_what_it_refuses(self):
        self.assertEqual(self.insert("nosuch", "--events", "[]")[0], 1)                  # no gatherer made for a typo
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, "ag", "gatherers", "nosuch")))
        self.assertEqual(self.insert("g", "--events", '[{"payload": 1}]'), (1, {"error": "not an event: {'payload': 1}"}))
        self.assertEqual(self.insert("g", "--events", "{}")[0], 1)

    def test_the_reader_s_name_wins_and_taken_back_the_harness_s_shows(self):
        self.insert("g", "--properties", json.dumps({"channel": "c1"}),
                    "--events", json.dumps([{"type": "name", "payload": {"text": "codex's title", "by": "codex"}}]))
        self.assertEqual(self.names()["c1"]["by"], "codex")
        self.name_event("Mine")
        time.sleep(0.01)
        self.insert("g", "--properties", json.dumps({"channel": "c1"}),       # a later title of codex's: the reader's still wins
                    "--events", json.dumps([{"type": "name", "payload": {"text": "codex's new title", "by": "codex"}}]))
        self.assertEqual(self.names()["c1"], {"text": "Mine", "by": "user"})
        self.name_event("")
        self.assertEqual(self.names()["c1"], {"text": "codex's new title", "by": "codex"})

    def test_claude_code_s_own_name_from_its_record_shows_and_the_reader_s_wins(self):
        path = os.path.join(self.tmp.name, "claude", "projects", "-work", "c1.jsonl")
        os.makedirs(os.path.dirname(path))
        title = {"type": "ai-title", "aiTitle": "Lighthouse keeper story", "sessionId": "c1"}
        with open(path, "w") as fh:
            fh.write("".join(json.dumps(line) + "\n" for line in (title, title)))
        facts, _ = follow(path, ClaudeCode().follower(path))                          # as ag's hook records them:
        self.insert("g", "--properties", json.dumps({"channel": "c1"}),               # through the server's insert
                    "--events", json.dumps([fact(f, path) for f in facts]))
        self.assertEqual(self.names()["c1"], {"text": "Lighthouse keeper story", "by": "claude"})
        time.sleep(0.01)
        self.name_event("Mine")
        self.assertEqual(self.names()["c1"], {"text": "Mine", "by": "user"})
        self.name_event("")
        self.assertEqual(self.names()["c1"]["by"], "claude")

    def test_a_session_started_here_with_no_message_yet_shows_its_name(self):
        self.name_event("Before it began", channel="fresh")
        started = [{"session_id": "fresh", "gatherer": "g", "cwd": "/tmp", "harness": "claude", "status": "stopped",
                    "created_at": "2026-10-26T00:00:00+00:00"}]
        agent = next(a for g in data.home(started)["gatherers"] for a in g["agents"] if a["channel"] == "fresh")
        self.assertEqual((agent["events"], agent["name"]), (0, {"text": "Before it began", "by": "user"}))


class DraftedTest(unittest.TestCase):
    def test_what_the_reader_left_unsent_in_the_input_box(self):
        self.assertEqual(sessions.drafted(0, "abc"), 3)
        self.assertEqual(sessions.drafted(3, "\x7f"), 2)
        self.assertEqual(sessions.drafted(3, "\r"), 0)                    # sent
        self.assertEqual(sessions.drafted(3, "\x03"), 0)                  # Ctrl+C empties Claude Code's box
        self.assertEqual(sessions.drafted(0, "\x1b[A\x1b[B\x1bOP"), 0)    # arrows, a function key: no characters
        self.assertEqual(sessions.drafted(0, "\x1b[200~hi\x1b[201~"), 2)  # a paste: its characters
        self.assertEqual(sessions.drafted(0, "hi\rthere"), 5)


@unittest.skipUnless(sessions.TERMINALS, "a terminal needs a Unix pseudo-terminal")
class TerminalRenameTest(SessionsBase):
    """Claude Code's /rename, held for the session's terminal and typed there once its turn is over."""

    def setUp(self):
        super().setUp()
        with open(os.path.join(self.tmp.name, "fake_ag.py"), "w") as fh:
            fh.write(NAMING_AG)

    def typed(self):
        return "".join(x["typed"] for x in self.logged() if "typed" in x)

    def open_terminal(self):
        sid = self.s.create("g", self.work)["session_id"]
        self.s.terminal(sid, 100, 30)
        self.until(lambda: b"fake terminal" in (self.s.output(sid, -1) or (b"",))[0])
        return sid

    def test_held_while_its_turn_runs_then_typed_once(self):
        sid = self.open_terminal()
        self.assertTrue(self.s.rename(sid, "/rename First"))
        self.assertTrue(self.s.rename(sid, "/rename Night watch"))           # in place of the one held
        self.assertEqual(self.s.rename_due([]), [])                           # mid-turn: not idle
        time.sleep(0.3)
        self.assertNotIn("/rename", self.typed())
        self.assertEqual(self.s.rename_due([sid]), [sid])
        self.until(lambda: "/rename Night watch\x1b[201~\r" in self.typed())  # pasted, then Enter
        self.assertNotIn("First", self.typed())
        self.assertEqual(self.s.rename_due([sid]), [])                        # typed once

    def test_not_over_what_the_reader_is_typing_nor_an_answer(self):
        sid = self.open_terminal()
        self.s.type(sid, "half a messa")
        self.s.rename(sid, "/rename X")
        self.assertEqual(self.s.rename_due([sid]), [])                        # their words would go with it
        self.s.type(sid, "ge\r")                                              # sent: the box is empty
        self.assertEqual(self.s.rename_due([sid]), [sid])
        self.s.rename(sid, "/rename Y")
        self.s.terms[sid].answering = True
        self.assertEqual(self.s.rename_due([sid]), [])

    def test_nothing_held_without_its_terminal(self):
        sid = self.s.create("g", self.work)["session_id"]
        self.assertFalse(self.s.rename(sid, "/rename X"))
        self.assertEqual(self.s.renames, {})


class EndpointTest(SessionsBase):
    """POST /api/name: the event, the harness's store, the terminal."""

    def setUp(self):
        super().setUp()
        with open(os.path.join(self.tmp.name, "fake_ag.py"), "w") as fh:
            fh.write(NAMING_AG)
        self.httpd = server.serve("127.0.0.1", 0)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        super().tearDown()

    def post(self, body):
        req = urllib.request.Request(self.url + "/api/name", data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as exc:
            return exc.code, json.load(exc)

    def test_the_event_put_in_by_ag_and_the_record_named(self):
        record = os.path.join(self.tmp.name, "s1.jsonl")
        with open(record, "w") as fh:
            fh.write('{"type":"user"}\n')
        with unittest.mock.patch.object(ClaudeCode, "record_path", lambda self, session, cwd=None, config=None: record):
            code, got = self.post({"gatherer": "g", "channel": "s1", "name": " Night\n watch ", "harness": "claude", "cwd": self.work})
        self.assertEqual((code, got), (200, {"name": "Night watch", "store": "named in its record", "error": None, "terminal": False}))
        insert = self.held()[-1]
        self.assertEqual(insert[:2], ["insert", "g"])
        self.assertEqual(json.loads(insert[insert.index("--properties") + 1]), {"channel": "s1"})
        self.assertEqual(json.loads(insert[insert.index("--events") + 1]),
                         [{"type": "name", "payload": {"text": "Night watch", "by": "user"}}])
        with open(record) as fh:
            self.assertIn('"customTitle":"Night watch"', fh.read())

    def test_a_harness_store_that_fails_still_keeps_the_name_here(self):
        with unittest.mock.patch.object(ClaudeCode, "record_path", lambda self, session, cwd=None, config=None: None):
            code, got = self.post({"gatherer": "g", "channel": "s1", "name": "x", "harness": "claude"})
        self.assertEqual((code, got["store"], got["error"]), (200, None, "Claude Code's record of the session was not found"))
        code, got = self.post({"gatherer": "g", "channel": "s1", "name": "x", "harness": "pi"})
        self.assertEqual((code, got["error"]), (200, "Pi keeps no name ag can set"))          # its rules are its adaptor's
        self.assertEqual(self.post({"gatherer": "g", "name": "x"})[0], 400)                    # which actor?

    @unittest.skipUnless(sessions.TERMINALS, "a terminal needs a Unix pseudo-terminal")
    def test_a_session_in_the_dashboard_s_terminal_is_told_once_idle(self):
        sid = self.httpd.sessions.create("g", self.work)["session_id"]
        self.httpd.sessions.terminal(sid, 100, 30)
        with unittest.mock.patch.object(ClaudeCode, "record_path", lambda self, session, cwd=None, config=None: None):
            code, got = self.post({"gatherer": "g", "channel": sid, "name": "Keeper", "harness": "claude"})
        self.assertEqual((code, got["terminal"]), (200, True))
        json.load(urllib.request.urlopen(self.url + "/api/home", timeout=20))     # a page's home: idle, so it is typed
        self.until(lambda: "/rename Keeper" in "".join(x.get("typed", "") for x in self.logged()))


if __name__ == "__main__":
    unittest.main()
