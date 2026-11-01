"""The dashboard's History view (ag_dashboard/history.py): a gatherer's history, light, with its tasks;
searched; the events picked rendered as one transcript and exported; and the Gatherer's model asked for
a summary, a memory or a skill of them -- through `ag home complete`, which asks it as a policy does."""
import io
import json
import os
import sqlite3
import sys
import tempfile
import time
import unittest
import unittest.mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag_dashboard import history  # noqa: E402
from harness_kit import claude as claude_rules  # noqa: E402
from ag_dashboard import home as dashboard_home  # noqa: E402


def said(role, text):
    return {"role": role, "content": [{"type": "text", "text": text}]}


EVENTS = [   # (channel, type, payload, text)
    ("c1", "context", said("system", "You are Claude Code."), None),
    ("c1", "user_message", said("user", "deploy the site"), "deploy the site"),
    ("c1", "tool_call", {"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "Bash",
                                                           "input": {"command": "make deploy"}}]}, None),
    ("c1", "tool_output", {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1",
                                                        "content": "deployed ```fenced``` ok"}]}, None),
    ("c1", "agent_message", said("assistant", "Deployed with make deploy."), "Deployed with make deploy."),
    ("c2", "user_message", said("user", "what is the weather"), "what is the weather"),
    ("c1", "user_message", said("user", "now roll it back"), "now roll it back"),
    ("c1", "agent_message", said("assistant", "Rolled back."), "Rolled back."),
]


class HistoryBase(unittest.TestCase):
    """Gatherer g: actor c1 in two turns, ag's two tasks over them; actor c2 with one message."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.saved, dashboard_home.HOME = dashboard_home.HOME, self.tmp.name
        self.addCleanup(setattr, dashboard_home, "HOME", self.saved)
        os.makedirs(os.path.join(self.tmp.name, "gatherers", "g"))
        conn = sqlite3.connect(os.path.join(self.tmp.name, "gatherers", "g", "context.db"))
        conn.executescript("""CREATE TABLE event_types (event_type_id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
            CREATE TABLE events (row_id INTEGER PRIMARY KEY, inserted_at TEXT NOT NULL, event_id TEXT, event_type_id INTEGER NOT NULL,
              payload_json TEXT NOT NULL, tokens INTEGER NOT NULL, text TEXT, counted INTEGER, p_channel);
            CREATE TABLE tasks (channel_key TEXT NOT NULL, task_index INTEGER NOT NULL, name TEXT NOT NULL, description TEXT,
              first_row INTEGER NOT NULL, last_row INTEGER NOT NULL, tokens INTEGER, retention_json TEXT,
              PRIMARY KEY (channel_key, task_index));""")
        types = {}
        for ch, typ, payload, text in EVENTS:
            if typ not in types:
                types[typ] = conn.execute("INSERT INTO event_types (name, created_at) VALUES (?, '')", (typ,)).lastrowid
            conn.execute("INSERT INTO events (inserted_at, event_type_id, payload_json, tokens, text, p_channel) "
                         "VALUES ('2026-10-24T10:00:00+00:00', ?, ?, 5, ?, ?)", (types[typ], json.dumps(payload), text, ch))
        conn.executemany("INSERT INTO tasks VALUES ('c1', ?, ?, ?, ?, ?, 10, '{}')",
                         [(0, "Deploy", "Deploying the site", 1, 5), (1, "Roll back", "Undoing it", 7, 8)])
        conn.commit()
        conn.close()


class HistoryTest(HistoryBase):
    def test_the_outline_is_every_event_light_with_its_tasks(self):
        got = history.outline("g")
        self.assertEqual([e["row_id"] for e in got["events"]], list(range(1, 9)))
        self.assertEqual(got["events"][1], {"row_id": 2, "channel": "c1", "type": "user_message", "tokens": 5,
                                            "at": got["events"][1]["at"], "text": "deploy the site"})
        conn = sqlite3.connect(os.path.join(self.tmp.name, "gatherers", "g", "context.db"))
        conn.executescript("CREATE TABLE cleaned_messages (row_id INTEGER PRIMARY KEY, text TEXT NOT NULL, build_id INTEGER);"
                           "INSERT INTO cleaned_messages VALUES (2, 'deploy it', 1);")
        conn.commit()
        conn.close()
        self.assertEqual(history.outline("g")["events"][1]["text"], "deploy it")   # a request as ag cleaned it
        self.assertEqual([t["name"] for t in got["tasks"]], ["Deploy", "Roll back"])
        self.assertEqual(got["events"][2]["text"], "make deploy")             # a call: what it is for (a shell call with no description: its command), not its JSON
        mine = history.outline("g", "c1", after=4)
        self.assertEqual([e["row_id"] for e in mine["events"]], [5, 7, 8])
        self.assertEqual({e["channel"] for e in mine["events"]}, {"c1"})
        self.assertFalse(mine["more"])
        self.assertIn("error", history.outline("nope"))

    def test_each_actor_s_build_and_its_messages_since(self):
        builds = history.outline("g")["builds"]
        self.assertEqual(builds, {"c1": {"since": 2}, "c2": {"since": 1}})      # no builds: every user message
        conn = sqlite3.connect(os.path.join(self.tmp.name, "gatherers", "g", "context.db"))
        conn.executescript("""CREATE TABLE _builds (build_id INTEGER PRIMARY KEY, channel_key TEXT, status TEXT, started_at REAL,
            finished_at REAL, through_row INTEGER, open_from_row INTEGER, ranking_json TEXT, parallel_mark INTEGER, error TEXT, reason TEXT);
            INSERT INTO _builds VALUES (1, 'c1', 'ready', 1, 2, 5, 2, '[]', 0, NULL, 'asked');
            INSERT INTO _builds VALUES (2, 'c1', 'ready', 3, 4, 8, 8, '[]', 0, NULL, 'join');""")   # a join: not counted
        conn.commit()
        conn.close()
        got = history.outline("g", "c1")["builds"]["c1"]
        self.assertEqual((got["since"], got["status"], got["reason"], got["build_id"]), (1, "ready", "asked", 1))

    def test_a_build_is_ag_s_to_start(self):
        class Done:
            returncode, stdout, stderr = 0, '{"few": 4}\n', ""
        with unittest.mock.patch.object(history.subprocess, "run", return_value=Done()) as run, \
                unittest.mock.patch.object(history.sessions, "ag_command", return_value=["ag"]):
            self.assertEqual(history.build("g", "c1"), {"few": 4})
        self.assertEqual(run.call_args[0][0], ["ag", "home", "build", "g", "--properties", '{"channel": "c1"}', "--min-messages", "10"])
        with self.assertRaises(history.HistoryError):
            history.build("g", "")

    def test_one_event_as_the_transcript_shows_it(self):
        got = history.event("g", 3)
        self.assertEqual([{k: p[k] for k in ("kind", "id", "name", "input")} for p in got["parts"]],
                         [{"kind": "call", "id": "t1", "name": "Bash", "input": {"command": "make deploy"}}])
        self.assertEqual(got["parts"][0]["view"]["command"], "make deploy")                 # as its harness shows it
        self.assertIn("error", history.event("g", 99))

    def test_search_finds_words_and_what_only_the_payload_holds(self):
        hits = history.search("g", None, "ROLL")["hits"]
        self.assertEqual([h["row_id"] for h in hits], [7, 8])                 # any case: "roll it back", "Rolled back."
        self.assertIn("roll it back", hits[0]["snippet"])
        self.assertEqual([h["row_id"] for h in history.search("g", "c1", "make deploy")["hits"]], [3, 5])   # 3: in its input
        self.assertEqual(history.search("g", "c2", "deploy")["hits"], [])
        self.assertEqual(history.search("g", None, "100%")["hits"], [])        # % is a character, not a wildcard

    def test_the_picked_events_as_one_transcript(self):
        text, about = history.render("g", [[2, 5], 6, 8])
        self.assertEqual(about, {"messages": 6, "turns": 3, "channels": ["c1", "c2"], "dirs": [], "tokens": 30})
        self.assertLess(text.index("# Session c1"), text.index("## Task 1: Deploy"))
        self.assertLess(text.index("### Turn 1"), text.index("**User:**\n\ndeploy the site"))
        self.assertIn("**Tool call** `Bash`:\n\n```\nmake deploy\n```", text)
        self.assertIn("````\ndeployed ```fenced``` ok\n````", text)           # a fence longer than the output's own
        self.assertIn("## Task 2: Roll back\n\nUndoing it\n\n### Turn 2", text)
        self.assertLess(text.index("Rolled back."), text.index("# Session c2"))  # an actor's events together
        with self.assertRaises(history.HistoryError):
            history.render("g", [])
        with self.assertRaises(history.HistoryError):
            history.render("g", [[1, 10 ** 9]])

    def test_long_parts_are_cut_in_the_middle(self):
        cut = history._cut("a" * 50 + "b" * 50, 20)
        self.assertTrue(cut.startswith("a" * 15) and cut.endswith("b" * 5))
        self.assertIn("80 characters left out", cut)
        self.assertEqual(history._cut("short", None), "short")

    def test_export_as_markdown_or_as_the_events_stored(self):
        md = history.export("g", [1, 2], "md")
        self.assertTrue(md["name"].endswith(".md"))
        self.assertIn("You are Claude Code.", md["text"])
        js = json.loads(history.export("g", [[1, 2]], "json")["text"])
        self.assertEqual([e["type"] for e in js["events"]], ["context", "user_message"])
        self.assertEqual(js["events"][1]["payload"]["content"][0]["text"], "deploy the site")

    def test_the_model_is_asked_in_the_background_and_its_answer_kept(self):
        seen = {}

        class Done:
            returncode = 0

            def __init__(self, argv, **kw):
                seen["argv"], seen["env"] = argv, kw["env"]

            def communicate(self, prompt, timeout=None):
                seen["prompt"] = prompt
                mems = [{"name": "deploy", "title": "Deploy", "description": "how", "type": "project", "body": "make deploy"}]
                return json.dumps({"text": json.dumps(mems), "model": "m/x", "error": ""}), ""

        with unittest.mock.patch.object(history.subprocess, "Popen", Done), \
                unittest.mock.patch.object(history.sessions, "ag_command", return_value=["ag"]):
            rec = history.start("g", "memory", [[1, 5]], "only the commands")
            self.assertEqual(rec["status"], "running")
            for _ in range(100):
                done = history.extracts("g")[0]
                if done["status"] != "running":
                    break
                time.sleep(0.02)
        self.assertEqual((done["status"], done["model"], [m["name"] for m in done["memories"]]), ("done", "m/x", ["deploy"]))
        self.assertEqual(done["rows"], [[1, 5]])
        self.assertEqual(seen["argv"][:3], ["ag", "home", "complete"])
        self.assertIn("MEMORIES", seen["argv"][seen["argv"].index("--system") + 1])
        self.assertIn("only the commands", seen["prompt"])
        self.assertIn("make deploy", seen["prompt"])
        self.assertEqual(json.loads(seen["env"]["AG_JOB"])["properties"], {"channel": "c1"})   # one actor's: put to it
        history.delete(done["id"])
        self.assertEqual(history.extracts("g"), [])
        with self.assertRaises(history.HistoryError):
            history.start("g", "poem", [1])
        with self.assertRaises(history.HistoryError):
            history.delete("../../x")

    def test_a_failed_call_says_why_and_one_no_dashboard_runs_is_shown_failed(self):
        class Failed:
            returncode = 1

            def __init__(self, argv, **kw):
                pass

            def communicate(self, prompt, timeout=None):
                return json.dumps({"text": "", "model": "", "error": "no model: set [policies.llm] model"}), ""

        with unittest.mock.patch.object(history.subprocess, "Popen", Failed), \
                unittest.mock.patch.object(history.sessions, "ag_command", return_value=["ag"]):
            rec = history.start("g", "summary", [2])
            for _ in range(100):
                done = history.extracts("g")[0]
                if done["status"] != "running":
                    break
                time.sleep(0.02)
        self.assertEqual((done["status"], done["error"]), ("failed", "no model: set [policies.llm] model"))
        history._save({**rec, "id": "0123456789ab", "server": 2 ** 22 + 12345})       # a dashboard long gone
        orphan = next(r for r in history.extracts("g") if r["id"] == "0123456789ab")
        self.assertEqual(orphan["status"], "failed")


class SaveTest(HistoryBase):
    """A finished record saved where Claude Code reads it, in a Claude Code folder of the test's own."""

    def setUp(self):
        super().setUp()
        self.claude = os.path.join(self.tmp.name, "claude-config")
        self.work = os.path.join(self.tmp.name, "work")
        os.makedirs(self.work)
        env = unittest.mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": self.claude})
        env.start()
        self.addCleanup(env.stop)

    def record(self, kind, output, **more):
        rec = {"id": f"{len(os.listdir(history.extracts_dir())) if os.path.isdir(history.extracts_dir()) else 0:012x}",
               "gatherer": "g", "kind": kind, "status": "done", "output": output, "created": time.time(), **more}
        history._save(rec)
        return rec["id"]

    def read(self, path):
        with open(path, encoding="utf-8") as fh:
            return fh.read()

    def test_memories_are_checked_and_named_once_each(self):
        got = history.memories('```json\n[{"name": "Use Make!", "title": "Deploy", "description": "how to deploy", '
                               '"type": "feedback", "body": "make deploy"}, {"name": "use-make", "body": "again", "type": "x"}, '
                               '{"name": "empty", "body": " "}]\n```')
        self.assertEqual([(m["name"], m["type"]) for m in got], [("use-make", "feedback"), ("use-make-2", "project")])
        self.assertEqual(history.memories("[]"), [])
        with self.assertRaises(history.HistoryError):
            history.memories("Here are your memories: ...")

    def test_an_agents_md_is_added_to_the_end_of_the_one_there(self):
        rid = self.record("agents", "## Commands\n- Run `make test`.")
        with open(os.path.join(self.work, "AGENTS.md"), "w") as fh:
            fh.write("# Mine\nkeep this\n")
        p = history.save(rid, "dir", self.work)                     # no version: the plan, nothing written
        self.assertEqual([(f["path"], f["action"]) for f in p["files"]], [(os.path.join(os.path.realpath(self.work), "AGENTS.md"), "append")])
        self.assertEqual((self.read(os.path.join(self.work, "AGENTS.md")), p["note"]), ("# Mine\nkeep this\n", ""))
        history.save(rid, "dir", self.work, p["version"])
        self.assertEqual(self.read(os.path.join(self.work, "AGENTS.md")), "# Mine\nkeep this\n\n## Commands\n- Run `make test`.\n")
        self.assertEqual(len(history._record(rid)["saved"]), 1)
        with open(os.path.join(self.work, "CLAUDE.md"), "w") as fh:            # Claude Code reads that one instead
            fh.write("# Theirs\n")
        self.assertIn("CLAUDE.md", history.save(rid, "dir", self.work)["note"])
        with self.assertRaises(history.HistoryError):
            history.save(rid, "user")                                          # a directory's only
        old = self.record("claude", "x")                                       # one made as a CLAUDE.md: saved as one now
        self.assertEqual(os.path.basename(history.save(old, "dir", self.work)["files"][0]["path"]), "AGENTS.md")

    def test_a_skill_goes_in_its_own_folder_and_a_change_since_the_preview_is_refused(self):
        rid = self.record("skill", "---\nname: Deploy Site\ndescription: deploy it\n---\n\n# Deploy\n1. make deploy")
        p = history.save(rid, "user")
        path = os.path.join(self.claude, "skills", "deploy-site", "SKILL.md")
        self.assertEqual((p["files"][0]["path"], p["files"][0]["action"]), (path, "create"))
        os.makedirs(os.path.dirname(path))
        with open(path, "w") as fh:
            fh.write("someone else's")
        with self.assertRaises(history.HistoryError):
            history.save(rid, "user", "", p["version"])              # the file appeared since the preview
        again = history.save(rid, "user")
        self.assertEqual(again["files"][0]["action"], "replace")
        history.save(rid, "user", "", again["version"])
        self.assertTrue(self.read(path).startswith("---\nname: Deploy Site"))
        self.assertEqual(history.save(rid, "dir", self.work)["files"][0]["path"],
                         os.path.join(os.path.realpath(self.work), ".claude", "skills", "deploy-site", "SKILL.md"))

    def test_memories_go_to_the_directory_s_memory_folder_and_its_index(self):
        mems = [{"name": "deploy", "title": "Deploy", "description": "how to deploy", "type": "project", "body": "make deploy"}]
        rid = self.record("memory", json.dumps(mems), memories=mems)
        folder = os.path.join(self.claude, "projects", claude_rules.project_key(self.work), "memory")
        self.assertTrue(claude_rules.project_key(self.work).startswith("-"))
        self.assertNotIn("/", claude_rules.project_key(self.work))
        os.makedirs(folder)
        with open(os.path.join(folder, "deploy.md"), "w") as fh:
            fh.write("an older memory")
        with open(os.path.join(folder, "MEMORY.md"), "w") as fh:
            fh.write("- [Older](deploy.md) — an older memory")
        p = history.save(rid, "dir", self.work)
        self.assertEqual([(os.path.basename(f["path"]), f["action"]) for f in p["files"]], [("deploy-2.md", "create"), ("MEMORY.md", "append")])
        history.save(rid, "dir", self.work, p["version"])
        self.assertEqual(self.read(os.path.join(folder, "deploy.md")), "an older memory")           # never overwritten
        self.assertIn('name: "deploy-2"\ndescription: "how to deploy"\nmetadata:\n  type: project\n---\n\nmake deploy', self.read(os.path.join(folder, "deploy-2.md")))
        self.assertEqual(self.read(os.path.join(folder, "MEMORY.md")),
                         "- [Older](deploy.md) — an older memory\n- [Deploy](deploy-2.md) — how to deploy\n")

    def test_what_cannot_be_saved(self):
        for kind, target, where in (("summary", "dir", self.work), ("memory", "user", ""), ("agents", "dir", "relative/dir"),
                                    ("agents", "dir", os.path.join(self.work, "nope")), ("agents", "elsewhere", self.work)):
            with self.subTest(kind=kind, target=target, where=where), self.assertRaises(history.HistoryError):
                history.save(self.record(kind, "[]" if kind == "memory" else "x", memories=[{"name": "a"}]), target, where)
        with self.assertRaises(history.HistoryError):
            history.save(self.record("agents", "x", status="running"), "dir", self.work)
        with self.assertRaises(history.HistoryError):
            history.save(self.record("skill", "no front matter"), "dir", self.work)


class ServerTest(HistoryBase):
    def test_the_server_answers_the_view(self):
        import threading
        import urllib.request
        from ag_dashboard import server
        httpd = server.serve("127.0.0.1", 0, live_updates=False)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        url = f"http://127.0.0.1:{httpd.server_port}"
        get = lambda path: json.load(urllib.request.urlopen(url + path, timeout=10))  # noqa: E731
        self.assertEqual(len(get("/api/outline?gatherer=g")["events"]), 8)
        self.assertEqual(len(get("/api/outline?gatherer=g&channel=c2")["events"]), 1)
        self.assertEqual([h["row_id"] for h in get("/api/search?gatherer=g&q=weather")["hits"]], [6])
        self.assertEqual(get("/api/extracts?gatherer=g"), [])
        post = urllib.request.Request(url + "/api/history/export", method="POST", headers={"Content-Type": "application/json"},
                                      data=json.dumps({"gatherer": "g", "rows": [[6, 6]], "format": "md"}).encode())
        self.assertIn("what is the weather", json.load(urllib.request.urlopen(post, timeout=10))["text"])
        bad = urllib.request.Request(url + "/api/history/extract", method="POST", headers={"Content-Type": "application/json"},
                                     data=json.dumps({"gatherer": "g", "rows": [], "kind": "summary"}).encode())
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(bad, timeout=10)
        self.assertEqual(caught.exception.code, 400)


class CompleteTest(unittest.TestCase):
    """`ag home complete`: the Gatherer's model asked once, the prompt on stdin."""

    def setUp(self):
        from ag.ag_harness.home import Home
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.h = Home(self.tmp.name)

    def run_it(self, stdin, *args, llm=None):
        from ag.ag_harness.home import __main__ as cli
        out, err = io.StringIO(), io.StringIO()
        with unittest.mock.patch.object(sys, "stdin", io.StringIO(stdin)), unittest.mock.patch.object(sys, "stdout", out), \
                unittest.mock.patch.object(sys, "stderr", err), unittest.mock.patch.object(self.h, "llm", return_value=llm), \
                unittest.mock.patch.object(self.h, "model", return_value="m/x"):
            code = cli.cmd_complete(self.h, *args)
        return code, out.getvalue(), err.getvalue()

    def test_the_answer_or_why_there_is_none(self):
        class Echo:
            def complete(self, prompt, *, system, model, effort, timeout, purpose):
                self.asked = (prompt, system, model, effort, purpose)
                return "answer to " + prompt

        llm = Echo()
        code, out, _ = self.run_it("the prompt", "ask", "be brief", "", 30, True, llm=llm)
        self.assertEqual((code, json.loads(out)), (0, {"text": "answer to the prompt", "model": "m/x", "error": ""}))
        self.assertEqual(llm.asked, ("the prompt", "be brief", "m/x", "", "ask"))
        code, out, err = self.run_it("  ", "ask", "", "", 30, False, llm=llm)
        self.assertEqual((code, out), (1, ""))
        self.assertIn("no prompt", err)

        class Silent:
            def complete(self, prompt, **kw):
                return ""

        code, out, _ = self.run_it("x", "ask", "", "", 30, True, llm=Silent())
        self.assertEqual((code, json.loads(out)["error"]), (1, "the model answered nothing"))


if __name__ == "__main__":
    unittest.main()
