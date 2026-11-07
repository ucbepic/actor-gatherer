"""DocWriter as an app (ag_apps/docwriter/; app_kit/DESIGN.md step 8): its documents shared between its pages (pycrdt,
kept unread), the file on disk folded in by one page, DocWriter's own routes, its records, its guard on the agent's own
edits -- through the dashboard as its host, its tool gateway (only an attached agent gets its tools, instructions and
guard), an actor started with it, its older actors adopted, what it kept in the dashboard's own database copied once,
and its panel built from the DocWriter its submodule pins."""
import base64
import glob
import http.client
import importlib.util
import json
import os
import queue
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import tomllib
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag_dashboard import app_agents, app_host, coordination, libs, server, sessions, tool_gateway  # noqa: E402
from app_kit import Caller  # noqa: E402
from test_dashboard import HomeBase  # noqa: E402
from test_dashboard_app_host import insert_here  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "ag_apps", "docwriter")
PANEL = os.path.join(APP, "panel")
GUARD = os.path.join(ROOT, "ag_dashboard", "app_guard.py")


def load(name: str):
    """A module of the app's, by its file, as a package of its own (its backend imports its core relatively)."""
    pkg = "docwriter_under_test"
    if pkg not in sys.modules:
        spec = importlib.util.spec_from_file_location(pkg, os.path.join(APP, "__init__.py"),
                                                      submodule_search_locations=[APP])
        sys.modules[pkg] = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(sys.modules[pkg])
    full = f"{pkg}.{name}"
    if full not in sys.modules:
        spec = importlib.util.spec_from_file_location(full, os.path.join(APP, f"{name}.py"))
        sys.modules[full] = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(sys.modules[full])
    return sys.modules[full]


core = load("core")

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


class Folder(unittest.TestCase):
    """A folder to write in, and the app's own database (core.DB_PATH) in a place of the test's."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = os.path.join(os.path.realpath(self.tmp.name), "work")
        os.makedirs(self.root)
        self.write("draft.md", "# Title\n\nBody.\n")
        saved = core.DB_PATH, core.CONFIG
        core.DB_PATH = os.path.join(self.tmp.name, "data", "docwriter.db")
        core.CONFIG = os.path.join(self.tmp.name, "config.toml")
        self.addCleanup(lambda: setattr(core, "DB_PATH", saved[0]) or setattr(core, "CONFIG", saved[1]))

    def write(self, name: str, text: str) -> str:
        path = os.path.join(self.root, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            fh.write(text)
        return path

    def read(self, name: str) -> str:
        with open(os.path.join(self.root, name)) as fh:
            return fh.read()


class PathTest(Folder):
    """`inside` and `tab_id`: a path of the folder, never out of it, links and all."""

    def test_paths_out_of_the_folder_are_refused(self):
        self.assertEqual(core.inside(self.root, "draft.md"), os.path.join(self.root, "draft.md"))
        for bad in ("../x", "/etc/passwd", "a/../../x"):
            with self.assertRaises(core.DocWriterError):
                core.inside(self.root, bad)
        os.symlink("/etc", os.path.join(self.root, "out"))
        with self.assertRaises(core.DocWriterError):
            core.inside(self.root, "out/passwd")

    def test_a_tab_is_named_by_its_path_in_the_folder(self):
        self.assertEqual(core.tab_id(self.root, os.path.join(self.root, "d", "x.md")), "d/x.md")
        self.assertEqual(core.tab_id(self.root, "d/./x.md"), "d/x.md")
        for bad in ("", "../x", "/tmp/x"):
            with self.assertRaises(core.DocWriterError):
                core.tab_id(self.root, bad)


def sink(cid: str):
    got = queue.Queue()
    return core._Sink(cid, got.put), got


@unittest.skipIf(Doc is None, "pycrdt is not installed")
class RoomTest(Folder):
    """A file's document as the pages share it: seeded once, edits passed on, the disk folded in by one page."""

    def test_the_first_page_seeds_and_edits_reach_the_others(self):
        room = core.Room(os.path.join(self.root, "draft.md"))
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
        room = core.Room(os.path.join(self.root, "draft.md"))
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

    def test_the_document_outlives_the_page(self):
        path = os.path.join(self.root, "draft.md")
        room = core.Room(path)
        s1, _ = sink("p1")
        room.join(s1)
        doc = Doc()
        doc["comments"] = comments = Map()
        comments["t1"] = "kept"
        room.edit("p1", doc.get_update())
        room.save("p1", "# Title\n\nBody.\n")
        room.persist()
        again = core.Room(path)
        s2, _ = sink("p2")
        init = again.join(s2)
        self.assertNotIn("seed", init)
        back = Doc()
        back.apply_update(base64.b64decode(init["update"]))
        self.assertEqual(dict(back.get("comments", type=Map)), {"t1": "kept"})


class Kept(Folder):
    """A DocWriter of the folder, as the backend keeps one the host opened: what it tells its panels and records."""

    def setUp(self):
        super().setUp()
        if not core.AVAILABLE:
            self.skipTest("pycrdt is not installed")
        self.told, self.recorded = queue.Queue(), []
        self.dws = core.DocWriters(lambda key, m: self.told.put((key, m)),
                                   lambda key, kind, payload: self.recorded.append((key, kind, payload)))
        self.addCleanup(self.dws.close)
        self.key = "ab" * 8
        self.dws.keep(self.key, self.root, "g", "c1")

    def api(self, method, route, q=None, body=None):
        return self.dws.api(self.key, method, route, q or {}, body)


class DocWritersTest(Kept):
    """DocWriter's own routes, what it keeps, its pages, its records, the guard on the agent's own edit tools."""

    def test_each_docwriter_has_its_own_tabs_and_its_folder_s_settings(self):
        other = "cd" * 8
        self.dws.keep(other, self.root, "g", "c2")
        self.api("POST", "tabs", body={"id": "draft.md"})
        self.assertEqual(self.dws.api(other, "GET", "tabs", {}, None)[1]["order"], [])   # its tabs, not the folder's
        self.assertEqual(self.dws.config(self.key)["root"], self.root)
        self.assertEqual(self.dws.config(self.key)["channel"], "c1")
        with self.assertRaises(core.DocWriterError):
            self.dws.config("0" * 16)
        self.dws.keep("ef" * 8, self.root, "g")
        self.assertIn("No actor works with this DocWriter", self.dws.config("ef" * 8)["error"])
        self.dws.attach("ef" * 8, "c3")
        self.assertEqual(self.dws.config("ef" * 8)["channel"], "c3")

    def test_tabs_open_rename_close(self):
        self.assertEqual(self.api("POST", "tabs", body={"id": "draft.md"})[1]["active"], "draft.md")
        self.assertEqual(self.api("POST", "tabs", body={"id": "new/notes.md", "activate": False})[1],
                         {"order": ["draft.md", "new/notes.md"], "active": "draft.md", "tabs": ["draft.md", "new/notes.md"]})
        self.assertEqual(self.read("new/notes.md"), "")
        self.api("PATCH", "tabs", body={"id": "new/notes.md", "newId": "notes.md"})
        self.assertTrue(os.path.exists(os.path.join(self.root, "notes.md")))
        self.assertEqual(self.api("DELETE", "tabs", q={"id": "draft.md"})[1]["active"], "notes.md")
        with self.assertRaises(core.DocWriterError):
            self.api("POST", "tabs", body={"id": "../out.md"})

    def test_files_settings_and_what_is_kept(self):
        os.makedirs(os.path.join(self.root, ".git"))
        self.write("d/x.tex", "")
        names = [e["name"] for e in self.api("GET", "files", q={"path": ""})[1]["entries"]]
        self.assertEqual(names, ["d", "draft.md"])           # folders first, .git left out
        self.api("PUT", "document", body={"meta": {"rules": [{"text": "No em dashes."}], "agentSettings": {"agency": "aggressive"}}})
        meta = self.api("GET", "document", q={"tab": "draft.md"})[1]
        self.assertEqual((meta["content"], meta["meta"]["rules"], meta["meta"]["agentSettings"]["agency"]),
                         ("# Title\n\nBody.\n", [{"text": "No em dashes."}], "aggressive"))
        self.dws.kv_set(self.key, {"last_seen:draft.md": "seen", "tabs-like": "x"})
        self.assertEqual(core.kv_get(self.key, ["last_seen:draft.md"]), {"last_seen:draft.md": "seen"})   # per actor
        self.assertEqual(core.kv_get(self.root, ["tabs-like"]), {"tabs-like": "x"})                      # per folder
        self.assertTrue(os.path.isfile(core.DB_PATH))                                                     # its own

    def test_a_page_is_told_what_concerns_it_and_let_go_once_gone(self):
        self.dws.join_page(self.key, "p1")
        self.api("PUT", "hooks", body={"hooks": [{"id": "h", "event": "Stop", "command": "printf built > {{stem}}.out",
                                                  "output": "{{stem}}.out"}]})
        self.dws._run_hook(self.root, "h", "paper.tex")
        key, m = self.told.get(timeout=5)
        self.assertEqual((key, m["to"], m["name"]), (self.key, "p1", "live"))
        self.assertEqual(m["value"]["data"]["path"], os.path.join(self.root, "paper.out"))
        joined = self.dws.join_doc(self.key, "p1", "draft.md")
        self.assertIn("seed", joined)
        self.assertTrue(self.dws.alive(self.key, "p1"))
        with mock.patch.object(core, "PAGE_GONE", 0):
            self.dws.sweep()                                  # not heard from: let go
        self.assertFalse(self.dws.alive(self.key, "p1"))
        with self.assertRaises(core.DocWriterError):
            self.dws.join_doc(self.key, "p1", "draft.md")     # it joins again first

    def test_what_the_author_does_is_recorded(self):
        self.dws.record(self.key, "proposal_resolved", {"file": "draft.md", "outcome": "accepted"})
        self.assertEqual(self.recorded, [(self.key, "proposal_resolved",
                                          {"file": "draft.md", "outcome": "accepted", "by": "user", "via": "docwriter"})])
        with self.assertRaises(core.DocWriterError):
            self.dws.record(self.key, "something_else", {})

    def test_the_agent_s_own_edit_tools_are_refused_on_an_open_document(self):
        self.api("POST", "tabs", body={"id": "draft.md"})
        self.assertIn("docwriter_edit_doc", self.dws.guard(self.key, os.path.join(self.root, "draft.md")))
        self.assertIsNone(self.dws.guard(self.key, os.path.join(self.root, "other.md")))
        self.assertIsNone(self.dws.guard(self.key, ".docwriter/agent/scratch/notes.md"))
        self.assertIsNone(self.dws.guard(self.key, "/etc/hosts"))

    def test_the_page_s_file_calls_stay_in_the_folder(self):
        self.assertEqual(self.dws.fs(self.key, {"op": "read", "path": "draft.md"}), {"text": "# Title\n\nBody.\n"})
        self.dws.fs(self.key, {"op": "write", "path": ".docwriter/agent/scratch/n.md", "text": "note"})
        self.assertEqual(self.read(".docwriter/agent/scratch/n.md"), "note")
        with self.assertRaises(core.DocWriterError):
            self.dws.fs(self.key, {"op": "read", "path": "/etc/hosts"})


class Hosted(HomeBase):
    """DocWriter as the dashboard hosts it: an AppHost on the test's home (gatherer `g`), a folder to write in."""

    def setUp(self):
        super().setUp()
        self.root = os.path.join(os.path.realpath(self.tmp.name), "work")
        os.makedirs(self.root)
        with open(os.path.join(self.root, "draft.md"), "w") as fh:
            fh.write("# Title\n\nBody.\n")
        self.host = self.new_host()
        if "docwriter" not in self.host.apps:
            self.skipTest("DocWriter's panel is not built")
        if not core.AVAILABLE:
            self.skipTest("pycrdt is not installed")

    def new_host(self):
        h = app_host.AppHost(0, write=insert_here)
        self.addCleanup(h.close)
        self.hosts = getattr(self, "hosts", []) + [h]
        return h

    def tearDown(self):
        for h in getattr(self, "hosts", []):                # what they write, written while the home is the test's
            h.flush()
        super().tearDown()

    def request(self, inst, method, path, body=None, query=None):
        r = self.host.request("docwriter", inst, method, path, dict(query or {}),
                              json.dumps(body).encode() if body is not None else b"")
        return r.status, (json.loads(r.body) if r.body[:1] in (b"{", b"[") else r.body)


class AppTest(Hosted):
    def test_an_instance_is_a_docwriter_on_its_folder_its_agent_attached(self):
        m = self.host.apps["docwriter"].manifest
        self.assertEqual((m.instances, m.offer, m.agent.start), ("many", "attached", True))
        self.assertEqual({t.name for t in m.tools}, {"edit_doc", "read_doc", "write_doc", "comment_doc",
                                                     "reply_to_comment", "list_threads"})
        self.assertTrue(all(t.handled_by == "panel" for t in m.tools))
        i = self.host.open("docwriter", "g", self.root)
        self.assertEqual(i.title, "work")
        self.assertNotEqual(self.host.open("docwriter", "g", self.root).id, i.id)     # many: another, the same folder
        self.host.attach("g", i.id, "c1")
        status, cfg = self.request(i, "GET", "dw")
        self.assertEqual((status, cfg["root"], cfg["channel"], cfg["gatherer"]), (200, self.root, "c1", "g"))
        self.assertEqual(self.request(i, "POST", "page/join", {"conn": "p1"})[0], 200)
        status, joined = self.request(i, "POST", "doc/join", {"conn": "p1", "tab": "draft.md"})
        self.assertEqual((status, joined["seed"]), (200, "# Title\n\nBody.\n"))
        self.assertEqual(self.request(i, "POST", "doc/join", {"conn": "p1", "tab": "../out.md"})[0], 400)
        status, page = self.request(i, "GET", "preview")
        self.assertEqual(status, 200)
        self.assertIn(b"DocWriter preview", page)

    def test_the_author_s_records_are_its_events_in_the_agent_s_channel_never_in_a_context(self):
        i = self.host.open("docwriter", "g", self.root)
        self.host.attach("g", i.id, "c1")
        self.request(i, "POST", "record", {"type": "comment", "payload": {"file": "draft.md", "text": "why?"}})
        self.host.flush()
        got = self.host.read("docwriter", i, ["docwriter.comment"])
        self.assertEqual([(e["properties"]["channel"], e["payload"]["text"], e["payload"]["via"]) for e in got],
                         [("c1", "why?", "docwriter")])
        self.assertNotIn("docwriter.comment", core.__dict__)  # (a record: no policy groups it)
        types = {t.name for t in self.host.apps["docwriter"].manifest.event_types()}
        self.assertEqual(types, {"docwriter.proposal_resolved", "docwriter.comment", "docwriter.reply",
                                 "docwriter.doc_settings"})

    def test_its_guard_refuses_an_attached_agent_s_own_edit_of_an_open_document(self):
        i = self.host.open("docwriter", "g", self.root)
        self.host.attach("g", i.id, "c1")
        self.request(i, "POST", "api/tabs", {"id": "draft.md"})
        why = self.host.guard("g", "c1", os.path.join(self.root, "draft.md"))
        self.assertIn("docwriter_edit_doc", why)
        self.assertIsNone(self.host.guard("g", "c2", os.path.join(self.root, "draft.md")))   # not attached: not its
        self.assertIsNone(self.host.guard("g", "c1", os.path.join(self.root, "notes.md")))

    def test_an_older_docwriter_s_actor_is_adopted_and_what_it_kept_copied_once(self):
        key = "12" * 8
        old = os.path.join(os.path.dirname(os.path.dirname(self.host.data_folder("docwriter"))), "..", "dashboard.db")
        old = os.path.normpath(old)
        conn = sqlite3.connect(old)
        conn.executescript("""CREATE TABLE docwriter_docs (path TEXT PRIMARY KEY, state BLOB NOT NULL, disk TEXT, at REAL NOT NULL);
            CREATE TABLE docwriter_kv (scope TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (scope, name));""")
        conn.execute("INSERT INTO docwriter_kv VALUES (?, 'tabs', ?)", (key, json.dumps({"order": ["draft.md"], "active": "draft.md"})))
        conn.execute("INSERT INTO docwriter_kv VALUES ('*', 'tools', '[]')")
        conn.commit()
        conn.close()
        again = self.new_host()                           # its backend started anew: the old database read once
        backend = again.backend("docwriter")
        i = again.adopt("docwriter", "g", key, self.root, "c1")
        self.assertEqual((i.id, i.folder, again.agents_of(i)), (key, self.root, ["c1"]))
        self.assertEqual(again.adopt("docwriter", "g", key, self.root, "c1").id, key)          # once
        status, tabs = self.request_on(again, i, "GET", "api/tabs")
        self.assertEqual((status, tabs["order"]), (200, ["draft.md"]))      # what it kept, here now
        mod = sys.modules[type(backend).__module__.rsplit(".", 1)[0] + ".core"]
        self.assertEqual(mod.kv_get("*", ["tools"]), {"tools": None})        # the old tool list: not copied
        rows = [{"session_id": "c1", "gatherer": "g", "cwd": self.root, "role": json.dumps({"docwriter": key})},
                {"session_id": "c9", "gatherer": "g", "cwd": self.root, "role": json.dumps({"browser": "34" * 8})}]
        with mock.patch.object(again, "adopt", wraps=again.adopt) as adopted:
            app_agents.adopt_all(type("S", (), {"list": lambda self: rows})(), again)
        self.assertEqual([c.args[:3] for c in adopted.call_args_list], [("docwriter", "g", key)])   # the Browser's: not an app yet

    def request_on(self, h, inst, method, path, body=None):
        r = h.request("docwriter", inst, method, path, {}, json.dumps(body).encode() if body is not None else b"")
        return r.status, json.loads(r.body)


class GatewayTest(Hosted):
    """Only an agent attached to a DocWriter is given its tools, its instructions and its guard."""

    def setUp(self):
        super().setUp()
        self.saved = tool_gateway.HOST, tool_gateway.ORIGIN
        tool_gateway.HOST, tool_gateway.ORIGIN = self.host, "http://127.0.0.1:4999"
        self.addCleanup(lambda: setattr(tool_gateway, "HOST", self.saved[0]) or setattr(tool_gateway, "ORIGIN", self.saved[1]))
        self.inst = self.host.open("docwriter", "g", self.root)
        self.host.attach("g", self.inst.id, "c1")

    def test_its_tools_and_instructions_for_its_agent_alone(self):
        mine = {t["name"] for t in tool_gateway.tools("g", ("c1",))}
        other = {t["name"] for t in tool_gateway.tools("g", ("c2",))}
        self.assertIn("docwriter_edit_doc", mine)
        self.assertNotIn("docwriter_edit_doc", other)
        self.assertNotIn("DocWriter", tool_gateway.instructions("g", channels=("c1",)))   # its own: the agent's instructions

    def test_claude_code_gets_the_tools_the_instructions_and_the_guard(self):
        s = {"session_id": "c1", "gatherer": "g", "harness": "claude", "cwd": self.root,
             "role": app_agents.role("docwriter", self.inst.id)}
        args = tool_gateway.launch_args(s)
        cfg = json.loads(args[args.index("--mcp-config") + 1])
        self.assertTrue(cfg["mcpServers"]["ag-apps"]["url"].endswith("/mcp/c1"))
        self.assertIn("You are the agent of DocWriter", args[args.index("--append-system-prompt") + 1])
        hook = json.loads(args[args.index("--settings") + 1])["hooks"]["PreToolUse"][0]
        self.assertEqual(hook["matcher"], "Edit|Write|MultiEdit|NotebookEdit")
        self.assertIn("app_guard.py", hook["hooks"][0]["command"])
        self.assertIn("/api/apps/guard?gatherer=g&channel=c1", hook["hooks"][0]["command"])
        self.assertEqual(sessions.extra_args(s), args)                     # what its harness is started with
        other = tool_gateway.launch_args({"session_id": "c2", "gatherer": "g", "harness": "claude", "cwd": self.root})
        self.assertNotIn("--append-system-prompt", other)                  # not attached: none of it
        self.assertNotIn("--settings", other)

    def test_codex_gets_them_as_its_config(self):
        self.host.attach("g", self.inst.id, "c3")
        args = tool_gateway.launch_args({"session_id": "c3", "gatherer": "g", "harness": "codex", "cwd": self.root})
        parsed = {}
        for one in [args[i + 1] for i, a in enumerate(args) if a == "-c"]:
            parsed.update(tomllib.loads(one))
        self.assertTrue(parsed["mcp_servers"]["ag-apps"]["url"].endswith("/mcp/c3"))
        self.assertIn("You are the agent of DocWriter", parsed["developer_instructions"])


class GuardScriptTest(unittest.TestCase):
    def test_the_guard_asks_the_dashboard_and_refuses_as_the_harness_has_it(self):
        """The guard as Claude Code's hook runs it: the path from the hook's input, asked of the dashboard, and the
        refusal in the hook's own words; a path not asked about, or a dashboard it cannot reach, lets the edit go."""
        from http.server import BaseHTTPRequestHandler, HTTPServer
        asked = []

        class Guard(BaseHTTPRequestHandler):
            def do_POST(self):
                path = json.loads(self.rfile.read(int(self.headers["Content-Length"])))["path"]
                asked.append((self.path, path))
                body = json.dumps({"deny": "open in DocWriter" if path.endswith("draft.md") else None}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass
        srv = __import__("http.server").server.HTTPServer(("127.0.0.1", 0), Guard)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.shutdown)
        url = f"http://127.0.0.1:{srv.server_port}/api/apps/guard?gatherer=g&channel=c1"

        def run(given, where=url):
            return subprocess.run([sys.executable, GUARD, where, "claude"], input=json.dumps(given),
                                  capture_output=True, text=True, timeout=30)
        got = run({"tool_name": "Edit", "tool_input": {"file_path": "/w/draft.md"}})
        self.assertEqual(json.loads(got.stdout)["hookSpecificOutput"]["permissionDecisionReason"], "open in DocWriter")
        self.assertEqual(run({"tool_name": "Write", "tool_input": {"file_path": "/w/notes.md"}}).stdout, "")
        self.assertEqual(asked[0], ("/api/apps/guard?gatherer=g&channel=c1", "/w/draft.md"))
        gone = run({"tool_input": {"file_path": "/w/draft.md"}}, "http://127.0.0.1:9/guard")
        self.assertEqual((gone.returncode, gone.stdout), (0, ""))


class StartTest(Hosted):
    """A new DocWriter and its actor, from the page's menu or the gatherer agent's `ag actors new --docwriter`."""

    def setUp(self):
        super().setUp()
        self.started = sessions.Sessions()
        self.addCleanup(self.started.close)

    def test_its_actor_is_a_session_on_its_folder_attached_to_it_and_named(self):
        named = queue.Queue()
        with mock.patch.object(app_agents, "NAME_WAIT", 0), \
                mock.patch.object(app_agents.naming, "record", lambda g, c, n: named.put((g, c, n))):
            s, inst = app_agents.start(self.started, self.host, "docwriter", "g", self.root, "claude")
            self.assertEqual(named.get(timeout=5), ("g", s["session_id"], "DocWriter · work"))
        self.assertEqual((json.loads(s["role"]), s["cwd"]), ({"app": "docwriter", "key": inst.id}, self.root))
        self.assertEqual(self.host.agents_of(inst), [s["session_id"]])
        self.assertEqual(app_agents.role_of(s), ("docwriter", inst.id))
        self.assertTrue(sessions.known_role(s["role"]))
        with self.assertRaises(Exception):
            app_agents.start(self.started, self.host, "docwriter", "g", os.path.join(self.root, "nope"), "claude")

    def test_the_gatherer_agent_starts_one(self):
        saved = tool_gateway.HOST
        tool_gateway.HOST = self.host
        self.addCleanup(setattr, tool_gateway, "HOST", saved)
        crew = coordination.Coordination(self.started, watch=False)
        self.assertIn("docwriter", coordination._starters())
        with mock.patch.object(app_agents, "_name", lambda *a: None):
            row, made = crew._new_with_app("docwriter", "g", self.root, "claude", None, "The paper")
        self.assertEqual((made["root"], json.loads(row["role"])["app"]), (self.root, "docwriter"))


class PanelTest(unittest.TestCase):
    """The built page (ag_apps/docwriter/panel/, with the dashboard's shared pdf.js): every file its pages load is
    there, git keeps all of it, and it is built from the DocWriter its submodule pins."""

    ATTR = re.compile(r'''(?:src|href)="(?![a-z]+:|#)([^"?#]+)"''')

    def setUp(self):
        if not os.path.isfile(os.path.join(PANEL, "index.html")):
            self.skipTest("DocWriter's page is not built")

    def test_every_file_the_pages_load_is_there(self):
        for page in ("index.html", "preview.html"):
            with open(os.path.join(PANEL, page), encoding="utf-8") as fh:
                loaded = self.ATTR.findall(fh.read())
            self.assertIn("/_ag/app.js", loaded) if page == "index.html" else None   # the SDK, from the host
            for ref in loaded:
                if ref.startswith("/_ag/"):
                    continue
                self.assertTrue(os.path.isfile(os.path.join(PANEL, ref.lstrip("/"))), f"{page}: {ref}")
        self.assertTrue(os.path.isfile(os.path.join(libs.PDFJS, "web", "viewer.html")))
        scripts = "".join(open(f, encoding="utf-8").read() for f in glob.glob(os.path.join(PANEL, "assets", "*.js")))
        self.assertIn("/_ag/lib/pdfjs/", scripts)                       # pdf.js: the dashboard's shared copy
        self.assertNotIn("/docwriter/w/", scripts)

    def test_git_keeps_all_of_it(self):
        if shutil.which("git") is None or subprocess.run(["git", "-C", PANEL, "rev-parse"], capture_output=True).returncode:
            self.skipTest("not a git checkout")
        for where in (PANEL, libs.PDFJS):
            left = subprocess.run(["git", "-C", where, "ls-files", "--others", "--ignored", "--exclude-standard", "."],
                                  capture_output=True, text=True, check=True).stdout.split()
            self.assertEqual(left, [], where)

    def test_it_is_built_from_the_docwriter_its_submodule_pins(self):
        if shutil.which("git") is None or subprocess.run(["git", "-C", PANEL, "rev-parse"], capture_output=True).returncode:
            self.skipTest("not a git checkout")
        staged = subprocess.run(["git", "-C", ROOT, "ls-files", "--stage", "--", "assets/src/docwriter/upstream"],
                                capture_output=True, text=True, check=True).stdout.split()
        self.assertEqual(staged[:1], ["160000"])
        with open(os.path.join(PANEL, "LICENSE"), encoding="utf-8") as fh:
            built = re.match(r"DocWriter \(github\.com/docwriter-org/docwriter at ([0-9a-f]{40})\)", fh.readline())
        self.assertIsNotNone(built)
        self.assertEqual(built.group(1), staged[1])

    def test_its_tools_are_the_ones_its_page_answers(self):
        with open(os.path.join(APP, "tools.json")) as fh:
            tools = json.load(fh)
        self.assertEqual([t["name"] for t in tools], ["edit_doc", "read_doc", "write_doc", "comment_doc",
                                                      "reply_to_comment", "list_threads"])
        self.assertTrue(all(t["handled_by"] == "panel" and t["input_schema"]["type"] == "object" for t in tools))


class ServedTest(Hosted):
    """Its panel and its backend on its own origin, its mark from the dashboard's, a new one from the page's menu."""

    def setUp(self):
        super().setUp()
        self.httpd = server.serve("127.0.0.1", 0, live_updates=False)
        self.httpd.app_host._write_fn = insert_here
        self.hosts.append(self.httpd.app_host)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)
        self.port = self.httpd.server_port

    def get(self, host, path, method="GET", body=None, origin=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        headers = {"Host": f"{host}:{self.port}", **({"Origin": origin} if origin else {}),
                   **({"Content-Type": "application/json"} if body is not None else {})}
        conn.request(method, path, json.dumps(body) if body is not None else None, headers)
        r = conn.getresponse()
        raw = r.read()
        conn.close()
        return r.status, dict((k.lower(), v) for k, v in r.getheaders()), raw

    def test_its_page_and_its_backend_on_its_own_origin(self):
        inst = self.httpd.app_host.open("docwriter", "g", self.root)
        status, _, page = self.get("docwriter.localhost", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"/_ag/app.js", page)
        status, _, raw = self.get("docwriter.localhost", f"/api/w/g/{inst.id}/dw")      # its instance in the path
        self.assertEqual((status, json.loads(raw)["root"]), (200, self.root))
        status, _, raw = self.get("docwriter.localhost", f"/api/dw?gatherer=g&instance={inst.id}")   # or the query
        self.assertEqual(status, 200)
        origin = f"http://docwriter.localhost:{self.port}"
        status, _, _ = self.get("docwriter.localhost", f"/api/w/g/{inst.id}/page/join", "POST", {"conn": "p1"}, origin)
        self.assertEqual(status, 200)
        status, _, _ = self.get("docwriter.localhost", f"/api/w/g/{inst.id}/page/join", "POST", {"conn": "p1"},
                                "http://evil.localhost")
        self.assertEqual(status, 403)                                                   # only its own panel writes
        status, headers, svg = self.get("127.0.0.1", "/apps/mark/docwriter.svg")
        self.assertEqual((status, headers["content-type"]), (200, "image/svg+xml"))
        self.assertIn(b"#7C3AED", svg)
        self.assertEqual(self.get("127.0.0.1", "/apps/mark/nope.svg")[0], 404)

    def test_a_new_one_and_its_actor_from_the_page_s_menu(self):
        with mock.patch.object(app_agents, "_name", lambda *a: None):
            status, _, raw = self.get("127.0.0.1", "/api/apps/start", "POST",
                                      {"app": "docwriter", "gatherer": "g", "cwd": self.root, "harness": "claude"})
        got = json.loads(raw)
        self.assertEqual(status, 200, got)
        self.assertEqual(json.loads(got["session"]["role"]), {"app": "docwriter", "key": got["instance"]["id"]})
        self.assertEqual(self.httpd.app_host.agents_of(self.httpd.app_host.instance("g", got["instance"]["id"])),
                         [got["session"]["session_id"]])


if __name__ == "__main__":
    unittest.main()
