"""DocWriter in the dashboard (ag_dashboard/docwriter.py, mcp.py): its documents shared between pages (pycrdt, kept
unread), the file on disk folded in by one page, DocWriter's own routes, the actor's tools relayed to a page through the
MCP server, what a DocWriter actor is started with, and the server's /docwriter/w/<key>/ routes."""
import base64
import glob
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import tomllib
import unittest
import urllib.error
import urllib.parse
import urllib.request
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag_dashboard import docwriter, home as dashboard_home, mcp, sessions  # noqa: E402

try:
    from pycrdt import Doc, Map
except ImportError:                                 # DocWriter is not offered without it
    Doc = Map = None


def drain(q: queue.Queue) -> list:
    out = []
    while True:
        try:
            out.append(q.get_nowait())
        except queue.Empty:
            return out


class McpTest(unittest.TestCase):
    """mcp.py: MCP's JSON-RPC over POST, as Claude Code and codex call a server's tools."""

    TOOLS = [{"name": "edit_doc", "description": "d", "inputSchema": {"type": "object"}}]

    def call(self, message, call=None):
        return mcp.handle(json.dumps(message).encode(), self.TOOLS, call or (lambda n, a: mcp.result(f"{n} {a}")))

    def test_initialize_lists_and_calls(self):
        status, got = self.call({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}})
        self.assertEqual((status, got["result"]["protocolVersion"], got["result"]["serverInfo"]["name"]),
                         (200, "2025-03-26", "docwriter-doc"))
        self.assertEqual(self.call({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})[1]["result"]["tools"], self.TOOLS)
        got = self.call({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "edit_doc", "arguments": {"a": 1}}})[1]
        self.assertEqual(got["result"], {"content": [{"type": "text", "text": "edit_doc {'a': 1}"}]})

    def test_notifications_get_no_answer_and_errors_are_the_model_s(self):
        self.assertEqual(self.call({"jsonrpc": "2.0", "method": "notifications/initialized"}), (202, None))
        self.assertEqual(self.call({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "nope"}})[1]["error"]["code"], -32602)
        self.assertEqual(self.call({"jsonrpc": "2.0", "id": 5, "method": "what"})[1]["error"]["code"], -32601)

        def broken(name, args):
            raise RuntimeError("no page")
        got = self.call({"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": "edit_doc"}}, broken)[1]["result"]
        self.assertTrue(got["isError"])
        self.assertIn("no page", got["content"][0]["text"])
        self.assertEqual(mcp.handle(b"{", self.TOOLS, None)[0], 400)

    def test_a_batch_is_answered_by_the_list_of_its_answers(self):
        status, got = self.call([{"jsonrpc": "2.0", "id": 1, "method": "ping"}, {"jsonrpc": "2.0", "method": "notifications/x"}])
        self.assertEqual((status, got), (200, [{"jsonrpc": "2.0", "id": 1, "result": {}}]))


class Home(unittest.TestCase):
    """A dashboard home of its own, and a folder to write in."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.saved, dashboard_home.HOME = dashboard_home.HOME, os.path.join(self.tmp.name, "home")
        self.addCleanup(setattr, dashboard_home, "HOME", self.saved)
        self.root = os.path.join(os.path.realpath(self.tmp.name), "work")
        os.makedirs(self.root)
        self.write("draft.md", "# Title\n\nBody.\n")

    def write(self, name: str, text: str) -> str:
        path = os.path.join(self.root, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            fh.write(text)
        return path

    def read(self, name: str) -> str:
        with open(os.path.join(self.root, name)) as fh:
            return fh.read()


class PathTest(Home):
    """`inside` and `tab_id`: a path of the folder, never out of it, links and all."""

    def test_paths_out_of_the_folder_are_refused(self):
        self.assertEqual(docwriter.inside(self.root, "draft.md"), os.path.join(self.root, "draft.md"))
        for bad in ("../x", "/etc/passwd", "a/../../x"):
            with self.assertRaises(docwriter.DocWriterError):
                docwriter.inside(self.root, bad)
        os.symlink("/etc", os.path.join(self.root, "out"))
        with self.assertRaises(docwriter.DocWriterError):
            docwriter.inside(self.root, "out/passwd")

    def test_a_tab_is_named_by_its_path_in_the_folder(self):
        self.assertEqual(docwriter.tab_id(self.root, os.path.join(self.root, "d", "x.md")), "d/x.md")
        self.assertEqual(docwriter.tab_id(self.root, "d/./x.md"), "d/x.md")
        for bad in ("", "../x", "/tmp/x"):
            with self.assertRaises(docwriter.DocWriterError):
                docwriter.tab_id(self.root, bad)


def sink(cid: str):
    got = queue.Queue()
    return docwriter._Sink(cid, got.put), got


@unittest.skipIf(Doc is None, "pycrdt is not installed")
class RoomTest(Home):
    """A file's document as the pages share it: seeded once, edits passed on, the disk folded in by one page."""

    def test_the_first_page_seeds_and_edits_reach_the_others(self):
        room = docwriter.Room(os.path.join(self.root, "draft.md"))
        s1, q1 = sink("p1")
        s2, q2 = sink("p2")
        first, second = room.join(s1), room.join(s2)
        self.assertEqual(first["seed"], "# Title\n\nBody.\n")
        self.assertNotIn("seed", second)                      # one page seeds it: two would seed it twice
        doc = Doc()
        doc["comments"] = comments = Map()
        comments["t1"] = "a thread"
        room.edit("p1", doc.get_update())
        self.assertEqual(drain(q1), [])
        (kind, value), = drain(q2)
        self.assertEqual(kind, "update")
        other = Doc()
        other.apply_update(base64.b64decode(value["update"]))
        self.assertEqual(dict(other.get("comments", type=Map)), {"t1": "a thread"})

    def test_a_change_on_disk_goes_to_one_page_and_a_save_waits_for_it(self):
        room = docwriter.Room(os.path.join(self.root, "draft.md"))
        s1, q1 = sink("p1")
        s2, q2 = sink("p2")
        room.join(s1)
        room.join(s2)
        room.edit("p1", Doc().get_update())
        drain(q2)
        self.assertEqual(room.save("p1", "# Title\n\nTyped.\n"), {"saved": True})
        self.assertEqual(self.read("draft.md"), "# Title\n\nTyped.\n")
        time.sleep(0.01)
        self.write("draft.md", "# Title\n\nAn actor's.\n")
        room.check()
        told = drain(q1) + drain(q2)
        self.assertEqual(told, [("external", {"text": "# Title\n\nAn actor's.\n"})])   # to one page only
        self.write("draft.md", "# Title\n\nAgain.\n")
        self.assertEqual(room.save("p1", "# Title\n\nMine.\n"), {"saved": False, "changed": True})
        self.assertEqual(self.read("draft.md"), "# Title\n\nAgain.\n")          # not written over
        self.assertEqual(drain(q1), [("external", {"text": "# Title\n\nAgain.\n"})])

    def test_the_document_outlives_the_page(self):
        path = os.path.join(self.root, "draft.md")
        room = docwriter.Room(path)
        s1, _ = sink("p1")
        room.join(s1)
        doc = Doc()
        doc["comments"] = comments = Map()
        comments["t1"] = "kept"
        room.edit("p1", doc.get_update())
        room.save("p1", "# Title\n\nBody.\n")
        room.persist()
        again = docwriter.Room(path)
        s2, _ = sink("p2")
        init = again.join(s2)
        self.assertNotIn("seed", init)
        self.assertNotIn("external", init)
        back = Doc()
        back.apply_update(base64.b64decode(init["update"]))
        self.assertEqual(dict(back.get("comments", type=Map)), {"t1": "kept"})
        self.write("draft.md", "changed while closed\n")
        s3, _ = sink("p3")
        self.assertEqual(docwriter.Room(path).join(s3)["external"], "changed while closed\n")


class Started(Home):
    """A DocWriter of the folder, its actor a session made by `create` (no process started)."""

    def setUp(self):
        super().setUp()
        self.started = sessions.Sessions()
        self.dws = docwriter.DocWriters(self.started)
        self.addCleanup(self.dws.close)
        if not docwriter.AVAILABLE:
            self.skipTest("pycrdt is not installed")
        self.cfg = self.dws.create("g", self.root, "claude")
        self.key = self.cfg["key"]

    def api(self, method, route, q=None, body=None):
        return self.dws.api(self.key, method, route, q or {}, body)


class DocWritersTest(Started):
    """DocWriter's own routes, its actor, what it keeps, the guard on the actor's own edit tools."""

    def test_each_docwriter_is_its_own_actor_s_with_its_own_tabs(self):
        other = self.dws.create("g", self.root, "codex")       # the same folder and gatherer: another DocWriter
        self.assertNotEqual(other["key"], self.key)
        self.assertNotEqual(other["channel"], self.cfg["channel"])
        for cfg, harness in ((self.cfg, "claude"), (other, "codex")):
            s = next(x for x in self.started.list() if x["session_id"] == cfg["channel"])
            self.assertEqual((json.loads(s["role"]), s["cwd"], s["harness"]), ({"docwriter": cfg["key"]}, self.root, harness))
        self.api("POST", "tabs", body={"id": "draft.md"})
        self.assertEqual(self.dws.api(other["key"], "GET", "tabs", {}, None)[1]["order"], [])   # its tabs, not the folder's
        self.assertIsNone(self.dws.guard(other["key"], os.path.join(self.root, "draft.md")))
        self.assertEqual(self.dws.config(self.key)["root"], self.root)
        with self.assertRaises(docwriter.DocWriterError):
            self.dws.config("0" * 16)
        with self.assertRaises(docwriter.DocWriterError):
            self.dws.create("g", os.path.join(self.root, "nope"))

    def test_tabs_open_rename_close(self):
        self.assertEqual(self.api("POST", "tabs", body={"id": "draft.md"})[1]["active"], "draft.md")
        self.assertEqual(self.api("POST", "tabs", body={"id": "new/notes.md", "activate": False})[1],
                         {"order": ["draft.md", "new/notes.md"], "active": "draft.md", "tabs": ["draft.md", "new/notes.md"]})
        self.assertEqual(self.read("new/notes.md"), "")       # made, empty
        self.api("PATCH", "tabs", body={"id": "new/notes.md", "newId": "notes.md"})
        self.assertTrue(os.path.exists(os.path.join(self.root, "notes.md")))
        os.unlink(os.path.join(self.root, "notes.md"))
        got = self.api("GET", "tabs")[1]
        self.assertEqual((got["order"], got["missing"]), (["draft.md", "notes.md"], ["notes.md"]))
        self.assertEqual(self.api("DELETE", "tabs", q={"id": "draft.md"})[1]["active"], "notes.md")
        with self.assertRaises(docwriter.DocWriterError):
            self.api("POST", "tabs", body={"id": "../out.md"})

    def test_files_settings_and_what_is_kept(self):
        os.makedirs(os.path.join(self.root, ".git"))
        self.write("d/x.tex", "")
        names = [e["name"] for e in self.api("GET", "files", q={"path": ""})[1]["entries"]]
        self.assertEqual(names, ["d", "draft.md"])           # folders first, .git left out
        self.assertEqual(self.api("POST", "files", body={"path": "draft.md", "content": "eA==", "encoding": "base64"})[0], 409)
        self.api("PATCH", "files", body={"from": "d", "to": "e"})
        self.assertTrue(os.path.exists(os.path.join(self.root, "e", "x.tex")))
        self.api("PUT", "document", body={"meta": {"rules": [{"text": "No em dashes."}], "agentSettings": {"agency": "aggressive"}}})
        meta = self.api("GET", "document", q={"tab": "draft.md"})[1]
        self.assertEqual((meta["content"], meta["meta"]["rules"], meta["meta"]["agentSettings"]["agency"]),
                         ("# Title\n\nBody.\n", [{"text": "No em dashes."}], "aggressive"))
        self.dws.kv_set(self.key, {"last_seen:draft.md": "seen", "tabs-like": "x"})
        self.assertEqual(self.dws.kv(self.key, ["last_seen:draft.md", "tabs-like"]), {"last_seen:draft.md": "seen", "tabs-like": "x"})
        self.assertEqual(docwriter.kv_get(self.key, ["last_seen:draft.md"]), {"last_seen:draft.md": "seen"})   # per actor
        self.assertEqual(docwriter.kv_get(self.root, ["tabs-like"]), {"tabs-like": "x"})                      # per folder
        self.api("DELETE", "session")                         # "New session": what the agent saw, forgotten
        self.assertEqual(self.dws.kv(self.key, ["last_seen:draft.md"]), {"last_seen:draft.md": None})

    def test_hooks_run_in_the_folder_and_a_built_preview_is_announced(self):
        page, leave = self.dws.join_page(self.key, "p1")
        self.addCleanup(leave)
        self.api("PUT", "hooks", body={"hooks": [{"id": "h", "event": "Stop", "command": "printf built > {{stem}}.out", "output": "{{stem}}.out"}]})
        self.assertTrue(os.path.exists(os.path.join(self.root, ".docwriter", "hooks.json")))   # where DocWriter keeps them
        entry = self.dws._run_hook(self.root, "h", "paper.tex")["entry"]
        self.assertEqual((entry["status"], entry["exitCode"]), ("done", 0))
        self.assertEqual(self.read("paper.out"), "built")
        self.assertIn(("live", {"event": "preview_ready", "data": {"path": os.path.join(self.root, "paper.out")}}), drain(page.queue))
        self.write("paper.tex", "")                       # no PDF beside it: the hook's output, as it names it
        self.assertEqual(self.dws._preview_match(self.root, "paper.tex"), os.path.join(self.root, "paper.out"))
        self.write("paper.pdf", "%PDF")
        self.assertEqual(self.dws._preview_match(self.root, "paper.tex"), os.path.join(self.root, "paper.pdf"))
        self.assertEqual(docwriter.fill("x {{file}} {{stem}}", "a/b.tex"), "x a/b.tex a/b")

    def test_the_actor_s_own_edit_tools_are_refused_on_an_open_document(self):
        self.api("POST", "tabs", body={"id": "draft.md"})
        self.assertIn("edit_doc", self.dws.guard(self.key, os.path.join(self.root, "draft.md")))
        self.assertIsNone(self.dws.guard(self.key, os.path.join(self.root, "other.md")))
        self.assertIsNone(self.dws.guard(self.key, ".docwriter/agent/scratch/notes.md"))
        self.assertIsNone(self.dws.guard(self.key, "/etc/hosts"))

    def test_a_tool_call_goes_to_the_page_last_open_and_back(self):
        with mock.patch.object(docwriter, "PAGE_WAIT", 0.05):
            none = self.dws.tools.call(self.key, "read_doc", {})
        self.assertTrue(none["isError"])                     # no page, none came: told to open DocWriter
        self.assertIn("not open in the dashboard", none["content"][0]["text"])
        old, leave_old = self.dws.join_page(self.key, "p1")
        page, leave = self.dws.join_page(self.key, "p2")
        self.addCleanup(leave)
        self.addCleanup(leave_old)

        def answer():
            kind, call = page.queue.get(timeout=5)
            self.dws.tools.answered(call["id"], mcp.result(f"read {call['arguments']['file_path']}"))
        threading.Thread(target=answer, daemon=True).start()
        self.assertEqual(self.dws.tools.call(self.key, "read_doc", {"file_path": "draft.md"}), mcp.result("read draft.md"))
        self.assertEqual(drain(old.queue), [])
        with mock.patch.object(docwriter, "TOOL_WAIT", 0.05):
            self.assertTrue(self.dws.tools.call(self.key, "read_doc", {})["isError"])   # no answer in time

    def test_a_call_made_before_any_page_has_it_open_waits_for_one(self):
        leaves = []
        self.addCleanup(lambda: [leave() for leave in leaves])

        def open_page():                                     # as the dashboard's page opens it, the actor at work
            page, leave = self.dws.join_page(self.key, "p1")
            leaves.append(leave)
            kind, call = page.queue.get(timeout=5)
            self.dws.tools.answered(call["id"], mcp.result(f"read {call['arguments']['file_path']}"))
        threading.Timer(0.3, open_page).start()
        self.assertEqual(self.dws.tools.call(self.key, "read_doc", {"file_path": "draft.md"}), mcp.result("read draft.md"))

    def test_its_actor_is_named_once_by_the_name_given_else_by_its_folder(self):
        named = queue.Queue()
        with mock.patch.object(docwriter, "NAME_WAIT", 0), \
                mock.patch.object(docwriter.naming, "record", lambda g, channel, name: named.put((g, channel, name))):
            self.dws.name_actor(self.key, "The paper")
            self.assertEqual(named.get(timeout=5), ("g", self.cfg["channel"], "The paper"))
            self.dws.name_actor(self.key)                    # named already: not again
            other = self.dws.create("g", self.root, "claude")
            self.dws.name_actor(other["key"])
            self.assertEqual(named.get(timeout=5), ("g", other["channel"], "DocWriter · work"))
            self.assertTrue(named.empty())

    def test_a_call_whose_page_goes_before_answering_fails_at_once(self):
        page, leave = self.dws.join_page(self.key, "p1")
        threading.Timer(0.3, leave).start()                  # the page closed, the call unanswered
        started = time.time()
        got = self.dws.tools.call(self.key, "edit_doc", {"file_path": "draft.md"})
        self.assertTrue(got["isError"])
        self.assertIn("closed before it answered edit_doc", got["content"][0]["text"])
        self.assertLess(time.time() - started, 3)            # not TOOL_WAIT

    def test_the_page_s_file_calls_stay_in_the_folder(self):
        self.assertEqual(self.dws.fs(self.key, {"op": "read", "path": "draft.md"}), {"text": "# Title\n\nBody.\n"})
        self.dws.fs(self.key, {"op": "write", "path": ".docwriter/agent/scratch/n.md", "text": "note"})
        self.assertEqual(self.read(".docwriter/agent/scratch/n.md"), "note")
        self.assertEqual(self.dws.fs(self.key, {"op": "exists", "path": "nope.md"}), {"exists": False})
        with self.assertRaises(docwriter.DocWriterError):
            self.dws.fs(self.key, {"op": "read", "path": "/etc/hosts"})


class LaunchTest(Home):
    """What a DocWriter actor's harness is started with: its tools (the MCP server), its instructions, its guard."""

    def test_claude_code_gets_the_tools_the_instructions_and_the_guard(self):
        s = {"role": json.dumps({"docwriter": "ab" * 8}), "harness": "claude", "cwd": self.root}
        args = docwriter.launch_args(s)
        cfg = json.loads(args[args.index("--mcp-config") + 1])
        self.assertTrue(cfg["mcpServers"]["docwriter-doc"]["url"].endswith(f"/docwriter/w/{'ab' * 8}/mcp"))
        self.assertIn(self.root, args[args.index("--append-system-prompt") + 1])
        hook = json.loads(args[args.index("--settings") + 1])["hooks"]["PreToolUse"][0]
        self.assertEqual(hook["matcher"], "Edit|Write|MultiEdit|NotebookEdit")
        self.assertIn("docwriter_guard.py", hook["hooks"][0]["command"])
        self.assertEqual(sessions.extra_args(s), args)

    def test_codex_gets_them_as_its_config(self):
        args = docwriter.launch_args({"role": json.dumps({"docwriter": "cd" * 8}), "harness": "codex", "cwd": self.root})
        settings = [args[i + 1] for i, a in enumerate(args) if a == "-c"]
        self.assertEqual(len(settings), 2)
        parsed = {}
        for one in settings:                                # each one TOML, as codex reads `-c key=value`
            parsed.update(tomllib.loads(one))
        self.assertTrue(parsed["mcp_servers"]["docwriter-doc"]["url"].endswith("/mcp"))
        self.assertIn(self.root, parsed["developer_instructions"])

    def test_the_guard_asks_the_dashboard_and_refuses_as_the_harness_has_it(self):
        """The guard as Claude Code's hook runs it: the path from the hook's input, asked of the dashboard, and the
        refusal in the hook's own words; a path not asked about, or a dashboard it cannot reach, lets the edit go."""
        from http.server import BaseHTTPRequestHandler, HTTPServer
        asked = []

        class Guard(BaseHTTPRequestHandler):
            def do_POST(self):
                path = json.loads(self.rfile.read(int(self.headers["Content-Length"])))["path"]
                asked.append(path)
                body = json.dumps({"deny": "open in DocWriter: use edit_doc" if path.endswith("draft.md") else None}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass
        server = HTTPServer(("127.0.0.1", 0), Guard)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_port}/guard"

        def run(given, where=url):
            return subprocess.run([sys.executable, docwriter.GUARD, where, "claude"], input=json.dumps(given),
                                  capture_output=True, text=True, timeout=30)
        got = run({"tool_name": "Edit", "tool_input": {"file_path": "/w/draft.md", "old_string": "a", "new_string": "b"}})
        self.assertEqual(json.loads(got.stdout)["hookSpecificOutput"],
                         {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                          "permissionDecisionReason": "open in DocWriter: use edit_doc"})
        self.assertEqual(run({"tool_name": "Write", "tool_input": {"file_path": "/w/notes.md"}}).stdout, "")
        self.assertEqual(run({"tool_name": "Edit", "tool_input": {}}).stdout, "")          # no path: not asked
        self.assertEqual(asked, ["/w/draft.md", "/w/notes.md"])
        gone = run({"tool_input": {"file_path": "/w/draft.md"}}, "http://127.0.0.1:9/guard")
        self.assertEqual((gone.returncode, gone.stdout), (0, ""))                          # unreachable: the edit goes

    def test_any_other_session_gets_nothing_more(self):
        for role in (None, "", "null", json.dumps({"docwriter": "not a key"})):
            self.assertEqual(docwriter.launch_args({"role": role, "harness": "claude"}), [])
            self.assertEqual(sessions.extra_args({"role": role}), [])


@unittest.skipIf(Doc is None, "pycrdt is not installed")
class VendorTest(unittest.TestCase):
    """The built page (vendor/docwriter/): every file its pages and pdf.js's viewer load is there, and git keeps all of
    it -- the repo's .gitignore leaves out folders named build/, and pdf.js's scripts are in one."""

    PAGES = ("index.html", "preview.html", "pdfjs/web/viewer.html")
    SCRIPTS = ("assets/*.js", "pdfjs/web/viewer.mjs")
    OPTIONAL = {"pdfjs/web/debugger.mjs"}          # pdf.js's debugger, loaded only with its pdfBug option: not kept
    ATTR = re.compile(r'''(?:src|href)="(?![a-z]+:|#|/)([^"?#]+)"''')
    STRING = re.compile(r'''["'`](\.\.?/[\w./-]+\.(?:mjs|js|css|json|wasm))["'`]''')

    def setUp(self):
        if not os.path.isfile(os.path.join(docwriter.VENDOR, "index.html")):
            self.skipTest("DocWriter's page is not built")

    def loaded(self) -> set:
        """What the pages and scripts load, by path in vendor/docwriter/."""
        out = set()
        files = [(f, self.ATTR) for f in self.PAGES] + \
            [(os.path.relpath(f, docwriter.VENDOR), self.STRING)
             for g in self.SCRIPTS for f in glob.glob(os.path.join(docwriter.VENDOR, g))]
        for f, pattern in files:
            with open(os.path.join(docwriter.VENDOR, f), encoding="utf-8") as fh:
                text = fh.read()
            out |= {os.path.normpath(os.path.join(os.path.dirname(f), r)) for r in pattern.findall(text)}
        return out - self.OPTIONAL

    def test_every_file_the_pages_load_is_there(self):
        loaded = self.loaded()
        self.assertIn(os.path.normpath("pdfjs/build/pdf.worker.mjs"), loaded)    # the viewer's own, found
        self.assertEqual(sorted(f for f in loaded if not os.path.isfile(os.path.join(docwriter.VENDOR, f))), [])

    def test_git_keeps_all_of_it(self):
        if shutil.which("git") is None or subprocess.run(["git", "-C", docwriter.VENDOR, "rev-parse"],
                                                         capture_output=True).returncode:
            self.skipTest("not a git checkout")
        left = subprocess.run(["git", "-C", docwriter.VENDOR, "ls-files", "--others", "--ignored", "--exclude-standard",
                               "."], capture_output=True, text=True, check=True).stdout.split()
        self.assertEqual(left, [])

    def test_it_is_built_from_the_docwriter_its_submodule_pins(self):
        """The commit of DocWriter the page was built from (its LICENSE, build.mjs) is the one git records for the
        submodule (assets/src/docwriter/upstream): a pin moved without a build, or a build from another commit, fails."""
        if shutil.which("git") is None or subprocess.run(["git", "-C", docwriter.VENDOR, "rev-parse"],
                                                         capture_output=True).returncode:
            self.skipTest("not a git checkout")
        top = subprocess.run(["git", "-C", docwriter.VENDOR, "rev-parse", "--show-toplevel"], capture_output=True,
                             text=True, check=True).stdout.strip()
        staged = subprocess.run(["git", "-C", top, "ls-files", "--stage", "--", "assets/src/docwriter/upstream"],
                                capture_output=True, text=True, check=True).stdout.split()
        self.assertEqual(staged[:1], ["160000"])                  # a submodule's entry: mode, commit, stage, path
        with open(os.path.join(docwriter.VENDOR, "LICENSE"), encoding="utf-8") as fh:
            built = re.match(r"DocWriter \(github\.com/docwriter-org/docwriter at ([0-9a-f]{40})\)", fh.readline())
        self.assertIsNotNone(built)
        self.assertEqual(built.group(1), staged[1])


class ServerTest(Home):
    """The page's side, through the dashboard's server: its one stream, a document shared, the actor's MCP server."""

    def setUp(self):
        super().setUp()
        from ag_dashboard import server
        with mock.patch.object(docwriter, "POLL", 0.05):
            self.httpd = server.serve("127.0.0.1", 0, live_updates=False)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"
        self.key = self.post("/api/docwriter", {"gatherer": "g", "cwd": self.root})["key"]
        self.base = f"{self.url}/docwriter/w/{self.key}"

    def post(self, url: str, body, method: str = "POST", headers=None):
        req = urllib.request.Request(url if url.startswith("http") else self.url + url, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", **(headers or {})}, method=method)
        with urllib.request.urlopen(req, timeout=10) as res:
            raw = res.read()
        return json.loads(raw) if raw else None

    def stream(self, conn: str) -> queue.Queue:
        resp = urllib.request.urlopen(f"{self.base}/stream?conn={conn}", timeout=10)
        self.addCleanup(resp.close)
        got = queue.Queue()

        def read():
            name = None
            try:
                for raw in resp:
                    line = raw.decode().rstrip("\n")
                    if line.startswith("event: "):
                        name = line[7:]
                    elif line.startswith("data: "):
                        got.put((name, json.loads(line[6:])))
            except Exception:                        # noqa: BLE001 - closed
                pass
        threading.Thread(target=read, daemon=True).start()
        return got

    def next(self, events: queue.Queue, name: str) -> dict:
        deadline = time.time() + 10
        while time.time() < deadline:
            got, value = events.get(timeout=deadline - time.time())
            if got == name:
                return value
        self.fail(f"no {name}")

    def test_the_page_its_settings_and_its_routes(self):
        with urllib.request.urlopen(f"{self.base}/", timeout=10) as res:
            self.assertIn(b"__dwBase", res.read())         # the built page (vendor/docwriter/)
        self.assertEqual(json.load(urllib.request.urlopen(f"{self.base}/dw", timeout=10))["root"], self.root)
        self.assertEqual(self.post(f"{self.base}/api/tabs", {"id": "draft.md"})["order"], ["draft.md"])
        self.post(f"{self.base}/api/session", {"theme": "dark"}, method="PUT")
        self.assertEqual(json.load(urllib.request.urlopen(f"{self.base}/api/session", timeout=10))["theme"], "dark")
        with self.assertRaises(urllib.error.HTTPError) as got:  # another site's page: refused
            self.post(f"{self.base}/api/session", {}, method="DELETE", headers={"Origin": "http://evil.example"})
        self.assertEqual(got.exception.code, 403)

    def test_two_pages_share_a_document_over_their_streams(self):
        e1, e2 = self.stream("p1"), self.stream("p2")
        time.sleep(0.2)
        init1 = self.post(f"{self.base}/doc/join", {"conn": "p1", "tab": "draft.md"})
        init2 = self.post(f"{self.base}/doc/join", {"conn": "p2", "tab": "draft.md"})
        self.assertEqual((init1.get("seed"), "seed" in init2), ("# Title\n\nBody.\n", False))
        doc = Doc()
        doc["comments"] = comments = Map()
        comments["t1"] = "x"
        self.post(f"{self.base}/doc/update", {"conn": "p1", "tab": "draft.md", "update": base64.b64encode(doc.get_update()).decode()})
        got = self.next(e2, "doc")
        self.assertEqual((got["tab"], got["type"]), ("draft.md", "update"))
        self.assertEqual(self.post(f"{self.base}/doc/save", {"conn": "p1", "tab": "draft.md", "text": "Saved.\n"}), {"saved": True})
        self.assertEqual(self.read("draft.md"), "Saved.\n")
        time.sleep(0.05)
        self.write("draft.md", "On disk.\n")
        got = self.next(e2, "doc")                         # the page that joined last folds it in
        self.assertEqual((got["type"], got["text"]), ("external", "On disk.\n"))
        self.assertTrue(e1.empty())

    def test_the_actor_s_mcp_calls_reach_the_page_and_its_answer_comes_back(self):
        events = self.stream("p1")
        time.sleep(0.2)
        tools = [{"name": "read_doc", "description": "Read.", "inputSchema": {"type": "object"}}]
        self.post(f"{self.base}/tools/list", {"tools": tools})
        listed = self.post(f"{self.base}/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        self.assertEqual(listed["result"]["tools"], tools)

        def page():
            call = self.next(events, "call")
            self.post(f"{self.base}/tools/result", {"id": call["id"], "result": mcp.result("the text")})
        threading.Thread(target=page, daemon=True).start()
        got = self.post(f"{self.base}/mcp", {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                                             "params": {"name": "read_doc", "arguments": {"file_path": "draft.md"}}})
        self.assertEqual(got["result"], mcp.result("the text"))
        self.post(f"{self.base}/api/tabs", {"id": "draft.md"})
        self.assertIsNotNone(self.post(f"{self.base}/guard", {"path": os.path.join(self.root, "draft.md")})["deny"])


if __name__ == "__main__":
    unittest.main()
