"""The Editor's preview (ag_dashboard/preview.py): each git project's command, which the Execute button runs in the
checkout of the file open and whose result shows beside the file -- kept in dashboard.db, set by the reader or an actor
(`ag preview`, ag/cli/preview.py), an actor's command run only once the reader lets it -- and the server's
/api/preview/*, /preview/<token>/<path> through which the page and the actors reach it."""
import io
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag_dashboard import home as dashboard_home, preview  # noqa: E402

GIT_ENV = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}


def git(cwd, *args):
    subprocess.run(["git", "-C", cwd, *args], check=True, capture_output=True, env={**os.environ, **GIT_ENV})


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Base(unittest.TestCase):
    """A scratch home, and a git project in it: `self.repo`, with plot.py (it writes out.svg) committed."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = os.path.realpath(self.tmp.name)
        self.saved, dashboard_home.HOME = dashboard_home.HOME, os.path.join(root, "home")
        self.addCleanup(setattr, dashboard_home, "HOME", self.saved)
        self.repo = os.path.join(root, "proj")
        os.makedirs(os.path.join(self.repo, "src"))
        self.plot = os.path.join(self.repo, "src", "plot.py")
        with open(self.plot, "w") as fh:
            fh.write("import sys\nprint('drawing', sys.argv[1:])\nopen('out.svg', 'w').write('<svg xmlns=\"http://www.w3.org/2000/svg\"/>')\n")
        git(self.repo, "init", "-q")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-qm", "init")
        self.runs = preview.Runs(env=lambda: dict(os.environ))
        self.addCleanup(self.runs.close)


class TableTest(Base):
    def test_a_worktree_shares_its_repository_s_preview_and_runs_in_its_own_checkout(self):
        self.assertEqual(preview.place(self.plot), (self.repo, self.repo))
        wt = os.path.join(os.path.realpath(self.tmp.name), "proj-worktrees", "b")
        git(self.repo, "worktree", "add", "-q", "-b", "b", wt)
        self.assertEqual(preview.place(os.path.join(wt, "src", "plot.py")), (self.repo, wt))
        plain = os.path.join(os.path.realpath(self.tmp.name), "plain")
        os.makedirs(plain)
        self.assertEqual(preview.place(plain), (plain, plain))         # in no repository: the folder itself
        with self.assertRaises(preview.PreviewError):
            preview.place(os.path.join(plain, "nowhere", "x.py"))

    def test_an_actor_s_command_waits_for_the_reader_and_theirs_never_does(self):
        self.assertIsNone(preview.get(self.repo))
        row = preview.put(self.repo, "make", "", by="actor-1")
        self.assertTrue(row["needs_ok"])
        preview.allow(self.repo, "make")
        self.assertFalse(preview.get(self.repo)["needs_ok"])
        self.assertFalse(preview.put(self.repo, "make", "out.png", by="actor-2")["needs_ok"])   # the same command: let run
        self.assertTrue(preview.put(self.repo, "make all", "", by="actor-2")["needs_ok"])       # another: asked again
        self.assertFalse(preview.put(self.repo, "make clean", "", by=preview.READER)["needs_ok"])
        self.assertFalse(preview.put(self.repo, "", "index.html", by="actor-1")["needs_ok"])    # nothing to run
        preview.allow(self.repo, "rm -rf /")                         # only the command that is set is let run
        self.assertNotEqual(preview.get(self.repo)["allowed"], "rm -rf /")
        with self.assertRaises(preview.PreviewError):
            preview.put(self.repo, " ", "")
        preview.clear(self.repo)
        self.assertIsNone(preview.get(self.repo))

    def test_the_file_open_is_named_in_the_checkout_quoted_for_the_shell(self):
        spaced = os.path.join(self.repo, "my file.py")
        self.assertEqual(preview.expand("python3 {file} > {stem}.txt", spaced, self.repo, quote=True),
                         "python3 'my file.py' > 'my file'.txt")
        self.assertEqual(preview.expand("{dir}/{name} {stem}.pdf", self.plot, self.repo), "src/plot.py src/plot.pdf")
        self.assertEqual(preview.expand("make", None, self.repo), "make")
        with self.assertRaisesRegex(preview.PreviewError, "open a file first"):
            preview.expand("python3 {file}", None, self.repo)
        with self.assertRaises(preview.PreviewError):
            preview.expand("{file}", "/etc/hosts", self.repo)

    def test_a_guess_by_the_file_open_else_by_the_project(self):
        self.assertEqual(preview.guess(self.plot, self.repo), {"command": "python3 {file}", "show": ""})
        self.assertEqual(preview.guess("/x/paper.tex", self.repo)["show"], "{stem}.pdf")
        self.assertIn("-synctex=1", preview.guess("/x/paper.tex", self.repo)["command"])
        self.assertEqual(preview.guess("/x/index.html", self.repo), {"command": "", "show": "{file}"})
        with open(os.path.join(self.repo, "package.json"), "w") as fh:
            json.dump({"scripts": {"dev": "vite"}}, fh)
        self.assertEqual(preview.guess("/x/App.jsx", self.repo), {"command": "npm run dev", "show": "http://localhost:5173"})
        self.assertEqual(preview.guess(None, os.path.join(self.repo, "src")), {"command": "", "show": ""})


class RunTest(Base):
    def run_now(self, command, show="", file=None, by=preview.READER, wait=20):
        r = self.runs.start(self.repo, self.repo, command, show, file, by)
        self.runs.wait(r, wait)
        return r

    def test_a_command_runs_in_the_checkout_and_shows_the_file_it_made(self):
        w, leave = self.runs.watch(self.repo)
        self.addCleanup(leave)
        r = self.run_now("python3 {file} --fast", "out.svg", self.plot)
        self.assertEqual((r.state, r.code), ("done", 0))
        self.assertIn("drawing ['--fast']", r.text())
        shows = r.view()["shows"]
        self.assertEqual((shows["rel"], shows["kind"], shows["exists"]), ("out.svg", "svg", True))
        seen = []
        while not w.queue.empty():
            seen.append(w.queue.get())
        self.assertEqual([n for n, _ in seen][0], "run")
        self.assertEqual(seen[-1][1]["state"], "done")
        self.assertIn("drawing", "".join(v["text"] for n, v in seen if n == "out"))
        body, kind = self.runs.file(self.runs.token(self.repo), "out.svg")
        self.assertEqual(kind, "image/svg+xml; charset=utf-8")
        with self.assertRaises(PermissionError):
            self.runs.file(self.runs.token(self.repo), "../home/dashboard.db")
        with self.assertRaises(FileNotFoundError):
            self.runs.file("0" * 16, "out.svg")

    def test_a_failure_says_its_exit_code_and_a_page_joining_later_gets_the_output_kept(self):
        r = self.run_now("echo half; exit 3")
        self.assertEqual((r.state, r.code), ("failed", 3))
        w, leave = self.runs.watch(self.plot)
        self.addCleanup(leave)
        self.assertEqual(w.queue.get_nowait()[1]["id"], r.id)
        name, out = w.queue.get_nowait()
        self.assertEqual((name, out["text"], out["reset"]), ("out", "half\n", True))

    def test_a_long_command_is_stopped_and_a_new_run_stops_the_one_before(self):
        with mock.patch.object(preview, "TIMEOUT", 0.5):
            r = self.run_now("sleep 30", wait=8)
        self.assertEqual(r.state, "timed out")
        first = self.runs.start(self.repo, self.repo, "sleep 30", "", None)
        w, leave = self.runs.watch(self.repo)
        self.addCleanup(leave)
        second = self.run_now("echo next")
        self.assertEqual((first.state, second.state), ("stopped", "done"))
        ids = []
        while not w.queue.empty():
            ids.append(w.queue.get()[1]["id"])
        later = ids[ids.index(second.id):]
        self.assertNotIn(first.id, later)        # the first's end, once the second has begun: not news

    def test_a_server_is_ready_once_its_url_answers_and_is_stopped_with_what_it_started(self):
        port = free_port()
        r = self.runs.start(self.repo, self.repo, f"sh -c 'sleep 0.5; exec python3 -m http.server {port} --bind 127.0.0.1'",
                            f"http://127.0.0.1:{port}/", None)
        self.runs.wait(r, 20)
        self.assertEqual(r.state, "ready")
        self.assertTrue(r.view()["server"])
        urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=5).close()
        self.runs.stop(self.repo)
        self.assertEqual(r.state, "stopped")
        with self.assertRaises(OSError):
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2).close()

    def test_a_server_no_page_watches_is_stopped_after_a_while(self):
        port = free_port()
        r = self.runs.start(self.repo, self.repo, f"exec python3 -m http.server {port} --bind 127.0.0.1",
                            f"http://127.0.0.1:{port}/", None)
        self.runs.wait(r, 20)
        r.unwatched = time.time() - preview.IDLE - 1
        with mock.patch.object(preview, "IDLE", 0.2):
            idle = preview.Runs(env=lambda: dict(os.environ))
            idle.runs = self.runs.runs
            deadline = time.time() + 15
            while not r.over.is_set() and time.time() < deadline:
                time.sleep(0.1)
            idle.closed.set()
        self.assertEqual(r.state, "stopped")

    def test_nothing_to_run_shows_what_it_shows_as_it_is(self):
        r = self.run_now("", "src/plot.py")
        self.assertEqual((r.state, r.view()["shows"]["kind"]), ("done", "text"))
        with self.assertRaises(preview.PreviewError):
            self.runs.start(self.repo, self.repo, "", "../elsewhere.html", None)


class SyncTeXTest(Base):
    """SyncTeX between a PDF the preview shows and its source, both ways (preview.py's `synctex`)."""

    def test_a_line_to_its_place_in_the_pdf_and_back(self):
        import shutil
        if not (shutil.which("pdflatex") and shutil.which("synctex")):
            self.skipTest("no pdflatex and synctex here")
        tex = os.path.join(self.repo, "paper.tex")
        with open(tex, "w") as fh:
            fh.write("\\documentclass{article}\n\\begin{document}\nFirst page.\n\\newpage\nSecond page, its own line.\n\\end{document}\n")
        subprocess.run(["pdflatex", "-synctex=1", "-interaction=nonstopmode", "paper.tex"], cwd=self.repo,
                       capture_output=True, timeout=120, stdin=subprocess.DEVNULL)
        there = preview.synctex(self.repo, {"pdf": "paper.pdf", "mode": "forward", "file": tex, "line": 5})
        self.assertTrue(there["ok"], there)
        self.assertEqual(there["page"], 2)
        back = preview.synctex(self.repo, {"pdf": "paper.pdf", "page": 2, "x": there["h"] + 5, "y": there["v"] - 2})
        self.assertEqual((back["ok"], back["file"], back["line"]), (True, "paper.tex", 5))
        os.remove(os.path.join(self.repo, "paper.synctex.gz"))
        self.assertEqual(preview.synctex(self.repo, {"pdf": "paper.pdf", "page": 1, "x": 100, "y": 100}),
                         {"ok": False, "reason": "no-synctex"})
        with self.assertRaises(preview.PreviewError):
            preview.synctex(self.repo, {"pdf": "../elsewhere.pdf", "page": 1, "x": 1, "y": 1})


class ServerTest(Base):
    """The page's and the actors' side, through the dashboard's server."""

    def setUp(self):
        super().setUp()
        from ag_dashboard import server
        self.httpd = server.serve("127.0.0.1", 0, live_updates=False)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"

    def post(self, op, body):
        req = urllib.request.Request(f"{self.url}/api/preview/{op}", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
        try:
            return json.load(urllib.request.urlopen(req, timeout=30))
        except urllib.error.HTTPError as exc:
            return {"status": exc.code, **json.load(exc)}

    def test_the_reader_sets_and_runs_it_and_the_page_gets_what_it_shows(self):
        about = json.load(urllib.request.urlopen(f"{self.url}/api/preview?path={urllib.parse.quote(self.plot)}"))
        self.assertEqual((about["preview"], about["guess"]["command"]), (None, "python3 {file}"))
        self.post("set", {"path": self.plot, "command": "python3 {file}", "show": "out.svg"})
        got = self.post("run", {"path": self.plot, "file": self.plot, "wait": 20})
        self.assertEqual(got["run"]["state"], "done")
        self.assertIn("drawing", got["output"])
        resp = urllib.request.urlopen(f"{self.url}/preview/{got['token']}/out.svg")
        self.assertIn("sandbox", resp.headers["Content-Security-Policy"])      # its own origin: no call to the API
        self.assertTrue(resp.read().startswith(b"<svg"))
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(f"{self.url}/preview/{got['token']}/..%2F..%2Fhome%2Fdashboard.db")
        self.assertEqual(caught.exception.code, 403)

    def test_an_actor_s_command_runs_only_once_the_reader_lets_it(self):
        self.post("set", {"path": self.repo, "command": "echo from-actor", "actor": "actor-1"})
        refused = self.post("run", {"path": self.repo, "actor": "actor-1", "wait": 5})
        self.assertEqual(refused["status"], 400)
        self.assertIn("the user has not let this command run yet", refused["error"])
        self.assertEqual(self.post("run", {"path": self.repo, "wait": 5})["status"], 400)          # the page: asked first
        self.assertEqual(self.post("run", {"path": self.repo, "ok": "echo other", "wait": 5})["status"], 400)
        self.assertEqual(self.post("run", {"path": self.repo, "ok": "echo from-actor", "wait": 10})["output"], "from-actor\n")
        again = self.post("run", {"path": self.repo, "actor": "actor-1", "wait": 10})              # let run: it may now
        self.assertEqual((again["run"]["state"], again["run"]["by"]), ("done", "actor-1"))
        shell = self.post("set", {"path": self.repo, "command": "echo shell", "actor": ""})       # a shell not an actor's
        self.assertEqual((shell["preview"]["set_by"], shell["preview"]["needs_ok"]), ("cli", True))

    def test_a_pdf_s_viewer_is_served_from_pdf_js_and_nothing_beside_it(self):
        if not os.path.isfile(os.path.join(preview.PDFJS, "web", "viewer.html")):
            self.skipTest("pdf.js (DocWriter's build) is not here")
        about = json.load(urllib.request.urlopen(f"{self.url}/api/preview?path={urllib.parse.quote(self.repo)}"))
        self.assertTrue(about["pdfjs"])
        for path, kind in (("web/viewer.html", "text/html"), ("build/pdf.mjs", "text/javascript"),
                           ("build/pdf.worker.mjs", "text/javascript")):
            resp = urllib.request.urlopen(f"{self.url}/vendor/pdfjs/{path}")
            self.assertTrue(resp.headers["Content-Type"].startswith(kind), path)
        for outside in ("..%2Findex.html", "..%2F..%2Feditor.js", "nothing.js"):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(f"{self.url}/vendor/pdfjs/{outside}")
            self.assertEqual(caught.exception.code, 404, outside)

    def test_a_page_watching_hears_an_actor_set_it(self):
        resp = urllib.request.urlopen(f"{self.url}/api/preview/stream?path={urllib.parse.quote(self.repo)}", timeout=10)
        self.addCleanup(resp.close)
        self.post("set", {"path": self.plot, "command": "make", "actor": "actor-1"})
        name = None
        for raw in resp:
            line = raw.decode().rstrip("\n")
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: ") and name == "preview":
                self.assertEqual(json.loads(line[6:])["command"], "make")
                return
        self.fail("no preview event")


class CommandTest(ServerTest):
    """`ag preview` in an actor's shell."""

    def run_cli(self, *args, env=None):
        from ag.cli import preview as cli
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, {"AG_DASHBOARD": self.url, "CLAUDE_CODE_SESSION_ID": "actor-1", **(env or {})}), \
                redirect_stdout(out), redirect_stderr(err):
            for v in ("CODEX_THREAD_ID", "AG_ACTOR"):
                os.environ.pop(v, None)
            code = cli.main(["--repo", self.repo, *args])
        return code, out.getvalue(), err.getvalue()

    def test_an_actor_sets_shows_and_runs_it(self):
        code, out, _ = self.run_cli()
        self.assertEqual(code, 0)
        self.assertIn("No preview is set for", out)
        code, out, _ = self.run_cli("set", "python3", "{file}", "--show", "out.svg")
        self.assertEqual(code, 0)
        self.assertIn("runs:   python3 {file}", out)
        self.assertIn("set by you", out)
        self.assertIn("The user has not let this command run yet", out)
        code, _, err = self.run_cli("run", "--file", self.plot)
        self.assertEqual(code, 1)
        self.assertIn("the user has not let this command run yet", err)
        preview.allow(self.repo, "python3 {file}")
        code, out, _ = self.run_cli("run", "--file", self.plot, "--wait", "20")
        self.assertEqual(code, 0)
        self.assertIn("done", out)
        self.assertIn(f"It shows {os.path.join(self.repo, 'out.svg')}.", out)
        self.assertIn("drawing []", out)
        code, out, _ = self.run_cli("clear")
        self.assertIn("is cleared", out)

    def test_every_actor_is_told_of_it(self):
        from ag.ag_policies.proactive_context_manager.config import ProactiveContextManagerConfig
        guide = ProactiveContextManagerConfig().gatherer_guide
        self.assertIn("`ag preview set", guide)
        self.assertIn("Execute", guide)


if __name__ == "__main__":
    unittest.main()
