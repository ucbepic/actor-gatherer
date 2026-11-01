"""Actors talking to one another and the gatherer agent (ag_dashboard/coordination.py): the envelope a message goes in,
the gatherer agent's role and instructions as its sessions are run with them, what `ag actors` asks (ag/cli/actors.py)
and how the dashboard answers -- each message typed to its receiver as Chat sends one, here to the fake ag of
test_dashboard_sessions -- and the watches that tell an actor when another's turn is over. The gatherer's actors are
given by the test (`agents`), as data.py would read them; one test reads them from a real gatherer."""
import io
import json
import os
import re
import subprocess
import sys
import time
import unittest
import unittest.mock
from contextlib import redirect_stderr, redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import harness_kit  # noqa: E402
from harness_kit.base import Box  # noqa: E402
from ag.cli import actors as cli  # noqa: E402
from ag_dashboard import branches, browser, coordination, data, docwriter, editor, files, server, sessions  # noqa: E402
from test_dashboard_sessions import FAKE_AG, SessionsBase  # noqa: E402

# the fake ag, also saying who the dashboard told it it is, and where the dashboard is
FAKE = FAKE_AG.replace('"claudecode": os.environ.get("CLAUDECODE")}',
                       '"claudecode": os.environ.get("CLAUDECODE"), "actor": os.environ.get("AG_ACTOR"), '
                       '"dashboard": os.environ.get("AG_DASHBOARD")}')
PAGE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ag_dashboard", "page.html")


def git(cwd, *args):
    return subprocess.run(["git", "-C", cwd, *args], check=True, capture_output=True, text=True).stdout.strip()


def make_repo(path):
    """A git repository at `path`, with a commit of src/a.py: its real path."""
    os.makedirs(os.path.join(path, "src"))
    git(path, "init", "-q", "-b", "main")
    for k, v in (("user.name", "T"), ("user.email", "t@example.com"), ("commit.gpgsign", "false")):
        git(path, "config", k, v)
    with open(os.path.join(path, "src", "a.py"), "w") as fh:
        fh.write("x = 1\n")
    git(path, "add", "-A")
    git(path, "commit", "-qm", "start")
    return os.path.realpath(path)


class EnvelopeTest(unittest.TestCase):
    def test_a_message_is_read_back_as_its_sender_and_its_words(self):
        for sender, text, want in [
                ({"kind": "coordinator"}, "Stop editing page.html.\nWait for B.", {"from": "coordinator", "id": None, "name": None}),
                ({"kind": "actor", "id": "1a2b3c4d-0000", "name": 'Fix "the" editor'}, "I edit x.py", {"from": "actor", "id": "1a2b3c4d-0000",
                                                                                                    "name": 'Fix "the" editor'}),
                ({"kind": "actor", "id": "1a2b3c4d-0000", "name": None}, "hi", {"from": "actor", "id": "1a2b3c4d-0000", "name": None})]:
            got = coordination.opened(coordination.envelope(sender, text))
            self.assertEqual(got, {**want, "text": text.strip()})
        self.assertIsNone(coordination.opened("Message from someone:\n\nno"))
        self.assertIsNone(coordination.opened("Message from the gatherer:\n\nno"))           # no one's: a watch's is news
        news = coordination.update(3, "1a2b3c4d-0000", 'Fix "it"', "its turn is over", "It said last: done.")
        self.assertEqual(coordination.opened(news), {"from": "update", "id": "1a2b3c4d-0000", "name": 'Fix "it"', "watch": 3,
                                                     "how": "its turn is over", "text": "It said last: done."})
        self.assertEqual(coordination.opened(coordination.update(4, "x", None, "it is closed", ""))["how"], "it is closed")
        one_line = " ".join(coordination.envelope({"kind": "actor", "id": "1a2b3c4d", "name": None}, "a\n\nb").split())
        self.assertEqual(coordination.opened(one_line), {"from": "actor", "id": "1a2b3c4d", "name": None, "text": "a b"})
        self.assertIsNone(coordination.opened("just a message"))

    def test_the_page_reads_envelopes_by_the_same_patterns(self):
        with open(PAGE) as fh:
            page = fh.read()
        for name in ("ENVELOPE", "UPDATE"):
            js = re.search(rf"^const {name} = /(.*)/;$", page, re.M).group(1)
            self.assertEqual(js, getattr(coordination, name).pattern, name)

    def test_the_policy_shows_no_envelope_to_the_other_actors(self):
        from ag.ag_policies.proactive_context_manager.config import ProactiveContextManagerConfig
        openings = ProactiveContextManagerConfig().unshared_openings
        for text in (coordination.envelope({"kind": "coordinator"}, "x"), coordination.envelope({"kind": "actor", "id": "a", "name": None}, "x"),
                     coordination.update(1, "a", None, "its turn is over", "")):
            self.assertTrue(text.startswith(openings), text)

    def test_the_answer_it_names_is_a_command_the_receiver_can_run(self):
        text = coordination.envelope({"kind": "actor", "id": "1a2b3c4d-0000", "name": "x"}, "hi")
        self.assertIn('ag actors send 1a2b3c4d-0000 "..."', text.split("\n")[0])
        self.assertIn('ag actors send gatherer "..."', coordination.envelope({"kind": "coordinator"}, "hi").split("\n")[0])


class InstructionsTest(unittest.TestCase):
    def test_each_harness_takes_instructions_for_a_run(self):
        claude, codex = harness_kit.get("claude"), harness_kit.get("codex")
        self.assertEqual(claude.command("s1", instructions="Be the gatherer agent."),
                         ["--append-system-prompt", "Be the gatherer agent.", "--session-id", "s1"])
        self.assertEqual(claude.command("s1", resume=True), ["--resume", "s1"])      # none: nothing added
        got = codex.command("t1", resume=True, instructions='Say "hi"\nthen go.')
        self.assertEqual(got[:2], ["-c", 'developer_instructions="Say \\"hi\\"\\nthen go."'])
        self.assertEqual(got[-2:], ["resume", "t1"])                               # its options before `resume`
        import tomllib
        self.assertEqual(tomllib.loads(got[1])["developer_instructions"], 'Say "hi"\nthen go.')   # `-c` reads TOML

    def test_the_gatherer_agent_is_told_its_gatherer_and_the_commands(self):
        text = coordination.instructions("making_ag")
        self.assertIn('gatherer agent of the gatherer "making_ag"', text)
        for command in ("ag actors send", "ag actors new", "ag actors when", "ag actors who", "ag actors show"):
            self.assertIn(command, text)

    def test_its_instructions_are_a_file_the_homes_own_copy_first(self):
        import tempfile
        from ag_dashboard import home
        with tempfile.TemporaryDirectory() as tmp, unittest.mock.patch.object(home, "HOME", tmp):
            with open(coordination.INSTRUCTIONS) as fh:
                self.assertEqual(coordination.instructions("g"), fh.read().replace("{gatherer}", "g"))
            os.makedirs(os.path.join(tmp, "dashboard"))
            with open(os.path.join(tmp, "dashboard", "gatherer_agent.md"), "w") as fh:
                fh.write("Coordinate {gatherer}.")
            self.assertEqual(coordination.instructions("t1"), "Coordinate t1.")       # read anew: no restart

    def test_every_actor_is_told_of_the_others_and_of_the_gatherer_agent(self):
        from ag.ag_policies.proactive_context_manager.config import ProactiveContextManagerConfig
        guide = ProactiveContextManagerConfig().gatherer_guide
        self.assertIn("`ag actors`", guide)
        self.assertIn('ag actors send gatherer', guide)
        self.assertIn(coordination.FROM_COORDINATOR.split(" (")[0], guide)      # how its messages start
        self.assertIn('"Message from actor <id>"', guide)
        self.assertIn('sandbox_permissions "require_escalated" from the first try', guide)     # Codex's sandbox


class CoordinationBase(SessionsBase):
    """Two actors of gatherer g started here, A and B (headless: each message a line on its fake agent's stdin); the
    gatherer's actors as the test sets them (`status`, `names`), and the coordination, its watches looked at by hand."""

    def setUp(self):
        super().setUp()
        with open(os.path.join(self.tmp.name, "fake_ag.py"), "w") as fh:
            fh.write(FAKE)
        self.a = self.s.create("g", self.work)["session_id"]
        self.b = self.s.create("g", self.work)["session_id"]
        self.status, self.names = {}, {self.a: "Fix the editor", self.b: "Write the docs"}
        self.kept = []
        for target, fake in ((data, "gatherer_actors"), (data, "gatherer_names"), (data, "actors"),
                             (coordination.actions, "record"), (files, "files")):
            p = unittest.mock.patch.object(target, fake, getattr(self, "_" + fake))
            p.start()
            self.addCleanup(p.stop)
        self.crew = coordination.Coordination(self.s, watch=False)

    def _gatherer_actors(self, g, rows):
        return [{"channel": r["session_id"], "session": r, "harness": r["harness"], "cwd": r["cwd"],
                 "status": self.status.get(r["session_id"], data.IDLE), "last": time.time(),
                 "name": {"text": self.names[r["session_id"]]} if r["session_id"] in self.names else None,
                 "last_user_message": None, "recap": None, "role": r.get("role")}
                for r in rows if r["gatherer"] == g]

    def _gatherer_names(self):
        return ["g"]

    def _actors(self, g, channels, rows):
        return [a for a in self._gatherer_actors(g, rows) if a["channel"] in channels]

    def _record(self, gatherer, channel, events, wait=False):
        if events[0]["type"] == "actor_message":        # not each message's chat_sent, which sessions.py keeps
            self.kept.append((gatherer, channel, events))

    def _files(self, g, channel, turn=None, cwd=""):
        return {"turns": [{"text": "write the docs", "replies": [{"kind": "text", "text": "The docs are written."}], "now": None}],
                "files": [{"path": "/w/README.md", "kinds": {"edit"}}, {"path": "/w/notes.md", "kinds": {"read"}}]}

    def messages(self, sid):
        """What the fake agent of the session `sid` was sent."""
        return [x["message"] for x in self.agent_log(sid) if "message" in x]

    def agent_log(self, sid):
        out, mine = [], False
        for x in self.logged() if os.path.exists(self.log) else []:      # each process's argv, then what it was sent
            if "argv" in x:
                mine = sid in x["argv"]
            if mine:
                out.append(x)
        return out


class CoordinationTest(CoordinationBase):
    def test_ids_are_shown_whole_as_codex_actors_started_together_share_their_first_characters(self):
        x, y = "01a180e2-c53a-7d52-bdea-9cbb744b46b6", "01a180e2-c54d-73a3-91f6-6a7567a8d050"     # codex threads, a second apart
        agents = [{"channel": c, "session": {}, "harness": "codex", "cwd": "/w", "status": data.IDLE} for c in (x, y)]
        self.assertEqual([self.crew._view(a)["id"] for a in agents], [x, y])
        self.assertEqual(coordination.opened(coordination.envelope({"kind": "actor", "id": x, "name": None}, "pong"))["id"], x)
        with self.assertRaisesRegex(coordination.CoordinationError, "starts 2 actors' ids"):
            self.crew._find("g", x[:8], agents)
        self.assertEqual(self.crew._find("g", x[:13], agents)["channel"], x)     # any start that names one is taken

    def test_an_actor_lists_the_others_itself_marked(self):
        self.status[self.b] = data.RUNNING
        got = self.crew.list(self.a)
        self.assertEqual(got["gatherer"], "g")
        self.assertEqual({x["channel"]: (x["you"], x["status"], x["name"]) for x in got["actors"]},
                         {self.a: (True, data.IDLE, "Fix the editor"), self.b: (False, data.RUNNING, "Write the docs")})
        self.status[self.b] = data.CLOSED
        self.assertEqual([x["channel"] for x in self.crew.list(self.a)["actors"]], [self.a])     # closed: left out
        self.assertEqual(self.crew.list(self.a)["closed"], 1)
        self.assertEqual(len(self.crew.list(self.a, every=True)["actors"]), 2)

    def test_a_message_its_terminal_cannot_take_now_is_refused_and_not_kept(self):
        busy = sessions.NotAtBox("Claude Code's terminal shows a dialog", Box.HOLDS)
        with unittest.mock.patch.object(self.s, "send", side_effect=busy):
            with self.assertRaisesRegex(sessions.NotAtBox, f"not delivered: actor {self.b[:8]}'s terminal .* try again") as got:
                self.crew.send(self.a, self.b, "rebase please")
        self.assertEqual(got.exception.box, Box.HOLDS)
        self.assertEqual(self.kept, [])                               # not kept as sent

    def test_a_message_reaches_the_actor_named_in_an_envelope_and_is_kept_in_the_senders_channel(self):
        got = self.crew.send(self.a, self.b[:6], "I am changing page.html: leave it to me.")
        self.assertTrue(got["sent"])
        sent = self.until(lambda: self.messages(self.b))
        self.assertEqual(coordination.opened(sent[0]), {"from": "actor", "id": self.a, "name": "Fix the editor",
                                                         "text": "I am changing page.html: leave it to me."})
        (g, channel, events), = self.kept
        self.assertEqual((g, channel, events[0]["type"]), ("g", self.a, "actor_message"))
        self.assertEqual({k: events[0]["payload"][k] for k in ("kind", "to", "to_name", "text")},
                         {"kind": "send", "to": self.b, "to_name": "Write the docs", "text": "I am changing page.html: leave it to me."})

    def test_an_actor_is_found_by_its_name_too_and_a_wrong_one_is_refused(self):
        self.crew.send(self.a, "write the docs", "hi")
        self.until(lambda: self.messages(self.b))
        for ref, why in ((self.a, "that is you"), ("nobody", "no actor nobody"), ("", "which actor")):
            with self.assertRaisesRegex(coordination.CoordinationError, why):
                self.crew.send(self.a, ref, "hi")
        with self.assertRaisesRegex(coordination.CoordinationError, "an empty message"):
            self.crew.send(self.a, self.b, "  ")
        with self.assertRaisesRegex(coordination.CoordinationError, "no actor nobody-at-all"):
            self.crew.list("nobody-at-all")

    def test_a_message_to_the_gatherer_starts_its_gatherer_agent_with_its_instructions(self):
        self.crew.send(self.a, "gatherer", "B and I both edit page.html (a file-change notice); B is " + self.b[:8])
        row = self.crew.coordinator("g")
        self.assertEqual((row["role"], row["cwd"], row["harness"]), (sessions.COORDINATOR, self.work, "claude"))
        log = self.until(lambda: [x for x in self.agent_log(row["session_id"]) if "argv" in x])[0]
        i = log["argv"].index("--append-system-prompt")
        self.assertEqual(log["argv"][i + 1], coordination.instructions("g"))
        self.assertEqual(log["actor"], row["session_id"])                          # who it is, for its own `ag actors`
        sent = self.until(lambda: self.messages(row["session_id"]))
        self.assertEqual(coordination.opened(sent[0])["from"], "actor")
        self.crew.send(self.a, "coordinator", "again")                              # the same one, not another
        self.assertEqual([r["session_id"] for r in self.s.list() if r.get("role")], [row["session_id"]])
        with open(sessions.log_path(row["session_id"])) as fh:                       # its log names them, not writes them
            self.assertIn("'<the instructions of its role>'", fh.read())

    def test_the_gatherer_agents_messages_say_they_are_its(self):
        coordinator = self.crew.ensure("g", self.work)["session_id"]
        self.crew.send(coordinator, self.b, "Stop: A owns page.html until its PR is merged.")
        self.assertEqual(coordination.opened(self.until(lambda: self.messages(self.b))[0])["from"], "coordinator")
        self.assertEqual(self.crew.list(self.a)["actors"][0]["gatherer_agent"], True)    # first in the list
        an_actor = self.until(lambda: [x for x in self.agent_log(self.b) if "argv" in x])[0]
        self.assertNotIn("--append-system-prompt", an_actor["argv"])                # an actor like any other: none
        self.assertEqual(an_actor["actor"], self.b)

    def test_a_new_actor_starts_like_another_with_the_message(self):
        other = os.path.join(self.tmp.name, "other")
        os.makedirs(other)
        c = self.s.create("g", other, permission_mode="acceptEdits")["session_id"]
        self.names[c] = "In other"
        got = self.crew.new(self.a, "Take over the docs: README.md is half done.", like=c[:8])
        new = got["actor"]["channel"]
        row = next(r for r in self.s.list() if r["session_id"] == new)
        self.assertEqual((row["cwd"], row["permission_mode"], row["gatherer"]), (other, "acceptEdits", "g"))
        self.assertEqual(coordination.opened(self.until(lambda: self.messages(new))[0])["text"],
                         "Take over the docs: README.md is half done.")
        self.assertEqual(self.kept[-1][2][0]["payload"]["kind"], "new")

    def test_a_new_docwriter_is_a_docwriters_actor_on_the_folder_started_with_the_message(self):
        if not docwriter.AVAILABLE:
            self.skipTest("pycrdt is not installed")
        dws = docwriter.DocWriters(self.s)
        self.addCleanup(dws.close)
        crew = coordination.Coordination(self.s, watch=False, docwriters=dws)
        paper = os.path.join(self.tmp.name, "paper")
        os.makedirs(paper)
        with unittest.mock.patch.object(dws, "name_actor") as name_actor:
            got = crew.new(self.a, "Tighten the introduction.", cwd=paper, name="Paper", docwriter=True)
        new = got["actor"]["channel"]
        row = next(r for r in self.s.list() if r["session_id"] == new)
        key = json.loads(row["role"])["docwriter"]
        self.assertEqual((row["cwd"], row["harness"], row["gatherer"]), (os.path.realpath(paper), "claude", "g"))
        self.assertEqual(got["docwriter"], {"key": key, "root": os.path.realpath(paper)})
        self.assertEqual(dws.config(key)["channel"], new)
        self.assertTrue(got["actor"]["docwriter"])
        name_actor.assert_called_once_with(key, "Paper")
        self.assertEqual(coordination.opened(self.until(lambda: self.messages(new))[0])["text"], "Tighten the introduction.")
        self.assertEqual(self.kept[-1][2][0]["payload"]["kind"], "new")
        with self.assertRaisesRegex(coordination.CoordinationError, "no DocWriter started: no directory"):
            crew.new(self.a, "Write.", cwd=os.path.join(self.tmp.name, "nope"), docwriter=True)
        with self.assertRaisesRegex(coordination.CoordinationError, "runs no DocWriter"):
            self.crew.new(self.a, "Write.", cwd=paper, docwriter=True)
        self.assertEqual(len(self.s.list()), 3)                 # neither started an actor

    @unittest.skipUnless(browser.available(), "no Chrome here")
    def test_a_new_browser_is_a_browsers_actor_in_the_folder_started_with_the_message(self):
        bs = browser.Browsers(self.s)
        self.addCleanup(bs.close)
        crew = coordination.Coordination(self.s, watch=False, browsers=bs)
        site = os.path.join(self.tmp.name, "site")
        os.makedirs(site)
        with unittest.mock.patch.object(bs, "name_actor") as name_actor:
            got = crew.new(self.a, "Find the conference's deadline.", cwd=site, name="Deadlines", browser=True)
        new = got["actor"]["channel"]
        row = next(r for r in self.s.list() if r["session_id"] == new)
        key = json.loads(row["role"])["browser"]
        self.assertEqual((row["cwd"], row["harness"], row["gatherer"]), (os.path.realpath(site), "claude", "g"))
        self.assertEqual(got["browser"], {"key": key, "root": os.path.realpath(site)})
        self.assertEqual(bs.config(key)["channel"], new)
        self.assertTrue(got["actor"]["browser"])
        name_actor.assert_called_once_with(key, "Deadlines")
        self.assertEqual(coordination.opened(self.until(lambda: self.messages(new))[0])["text"], "Find the conference's deadline.")
        with self.assertRaisesRegex(coordination.CoordinationError, "--browser alone"):
            crew.new(self.a, "Go.", cwd=site, browser=True, docwriter=True)
        with self.assertRaisesRegex(coordination.CoordinationError, "no Browser started: no directory"):
            crew.new(self.a, "Go.", cwd=os.path.join(self.tmp.name, "nope"), browser=True)
        with self.assertRaisesRegex(coordination.CoordinationError, "runs no Browser"):
            self.crew.new(self.a, "Go.", cwd=site, browser=True)
        self.assertEqual(len(self.s.list()), 3)                 # none of those started an actor

    def test_show_says_what_an_actor_was_asked_said_and_changed(self):
        got = self.crew.show(self.a, self.b)
        self.assertEqual((got["asked"], got["said"], got["changed"]), ("write the docs", "The docs are written.", ["/w/README.md"]))


@unittest.skipIf(not docwriter.AVAILABLE, "pycrdt is not installed")      # the Editor, which branches merge into
class BranchTest(CoordinationBase):
    """`ag actors new --branch`: a new actor on a branch of its own, as the page's branch button starts one."""

    def setUp(self):
        super().setUp()
        self.repo = make_repo(os.path.join(self.tmp.name, "repo"))
        self.editors = editor.Editors(poll=3600)
        self.addCleanup(self.editors.close)
        self.branched = branches.Branches(self.editors, self.s, poll=3600)     # looked at by hand: not here
        self.addCleanup(self.branched.close)
        self.crew = coordination.Coordination(self.s, watch=False, branched=self.branched)

    def test_a_new_actor_on_a_branch_works_in_a_worktree_of_the_repository_its_directory_is_in(self):
        c = self.s.create("g", os.path.join(self.repo, "src"), permission_mode="acceptEdits")["session_id"]
        self.names[c] = "In the repo"
        got = self.crew.new(self.a, "Try another layout.", like=c, branch=True, approve=True, name="Layout")
        new = got["actor"]["channel"]
        b = got["branch"]
        self.assertEqual((b["project"], b["approve"]), (self.repo, True))
        self.assertRegex(b["branch"], r"^ag/[0-9a-f]{8}$")
        self.assertEqual(git(b["worktree"], "rev-parse", "--abbrev-ref", "HEAD"), b["branch"])
        row = next(r for r in self.s.list() if r["session_id"] == new)
        self.assertEqual((row["cwd"], row["permission_mode"], row["gatherer"]), (b["worktree"], "acceptEdits", "g"))
        self.assertEqual(got["actor"]["cwd"], b["worktree"])
        kept = self.branched.rows()
        self.assertEqual([(r["session_id"], r["project"], r["approve"]) for r in kept], [(new, self.repo, 1)])
        self.assertEqual([p["path"] for p in branches.projects("g")], [self.repo])     # made one of the gatherer's
        self.assertEqual(coordination.opened(self.until(lambda: self.messages(new))[0])["text"], "Try another layout.")
        self.assertEqual(self.kept[-1][2][0]["payload"]["kind"], "new")
        # one like it, from its worktree: a branch of the same repository, not of the worktree
        self.names[new] = "Layout"
        again = self.crew.new(self.a, "Try a third layout.", like=new, branch=True)
        self.assertEqual((again["branch"]["project"], again["branch"]["approve"]), (self.repo, False))
        self.assertNotEqual(again["branch"]["branch"], b["branch"])
        self.assertEqual([p["path"] for p in branches.projects("g")], [self.repo])

    def test_no_actor_is_started_where_no_branch_can_be_made(self):
        before = len(self.s.list())
        with self.assertRaisesRegex(coordination.CoordinationError, "not in a git repository"):
            self.crew.new(self.a, "Go.", cwd=self.work, branch=True)
        with self.assertRaisesRegex(coordination.CoordinationError, "--docwriter or --branch, not both"):
            self.crew.new(self.a, "Go.", cwd=self.repo, branch=True, docwriter=True)
        with self.assertRaisesRegex(coordination.CoordinationError, "--approve is for an actor on a branch"):
            self.crew.new(self.a, "Go.", cwd=self.repo, approve=True)
        with self.assertRaisesRegex(coordination.CoordinationError, "makes no branches"):
            coordination.Coordination(self.s, watch=False).new(self.a, "Go.", cwd=self.repo, branch=True)
        self.assertEqual((len(self.s.list()), self.branched.rows(), branches.projects("g")), (before, [], []))


class WatchTest(CoordinationBase):
    def setUp(self):
        super().setUp()
        self.coordinator = self.crew.ensure("g", self.work)["session_id"]

    def told(self):
        return [coordination.opened(m) for m in self.messages(self.coordinator)]

    def test_the_watcher_is_told_once_the_actor_it_watches_ends_its_turn(self):
        self.status[self.b] = data.RUNNING
        n = self.crew.when(self.coordinator, self.b, "then tell A to rebase")["watch"]
        self.assertEqual(self.crew.check(), [])                                     # still at work
        self.assertEqual([w["watch"] for w in self.crew.watches(self.coordinator)["watches"]], [n])
        self.status[self.b] = data.IDLE
        self.assertEqual(self.crew.check(), [n])
        got = self.until(self.told)[0]
        self.assertEqual((got["from"], got["id"], got["name"], got["how"], got["watch"]),
                         ("update", self.b, "Write the docs", "its turn is over", n))
        self.assertIn("It said last: The docs are written.", got["text"])
        self.assertIn("Your note: then tell A to rebase", got["text"])
        self.assertEqual(self.crew.check(), [])                                     # once
        self.assertEqual(self.crew.watches(self.coordinator)["watches"], [])

    def test_an_actor_never_seen_at_work_is_over_after_the_grace(self):
        n = self.crew.when(self.coordinator, self.b)["watch"]
        self.assertEqual(self.crew.check(), [])                                     # a message may be on its way to it
        self.assertEqual(self.crew.check(time.time() + coordination.WATCH_GRACE + 1), [n])

    def test_an_actor_waiting_on_the_user_or_on_its_background_work_is_not_done(self):
        n = self.crew.when(self.coordinator, self.b)["watch"]
        later = time.time() + coordination.WATCH_GRACE + 1
        for status in (data.ASKING, data.BACKGROUND):                               # its turn waits; or will be woken
            self.status[self.b] = status
            self.assertEqual(self.crew.check(later), [])
        self.status[self.b] = data.ERROR
        self.assertEqual(self.crew.check(), [n])                                    # seen at work: no grace needed
        self.assertEqual(self.until(self.told)[0]["how"], "its turn stopped on an error")

    def test_a_watcher_whose_box_cannot_take_it_is_told_later_of_the_end_it_missed(self):
        self.status[self.b] = data.RUNNING
        n = self.crew.when(self.coordinator, self.b)["watch"]
        self.crew.check()
        self.status[self.b] = data.IDLE
        busy = sessions.NotAtBox("a dialog has the keys", Box.AWAY)       # its terminal shows a dialog: nothing typed
        with unittest.mock.patch.object(self.s, "send", side_effect=busy):
            self.assertEqual(self.crew.check(), [])
        self.assertEqual([w["watch"] for w in self.crew.watches(self.coordinator)["watches"]], [n])   # still to tell
        self.status[self.b] = data.RUNNING                                    # at work again meanwhile
        self.assertEqual(self.crew.check(), [n])                              # the end it missed, told all the same
        got = self.until(self.told)[0]
        self.assertEqual((got["watch"], got["how"]), (n, "its turn is over"))
        self.assertEqual(self.crew.check(), [])                               # once

    def test_a_watch_is_dropped_by_its_watcher_alone(self):
        n = self.crew.when(self.coordinator, self.b)["watch"]
        with self.assertRaisesRegex(coordination.CoordinationError, f"no watch {n}"):
            self.crew.unwatch(self.a, n)
        self.assertEqual(self.crew.unwatch(self.coordinator, n), {"dropped": n})
        self.assertEqual(self.crew.check(time.time() + 60), [])
        with self.assertRaisesRegex(coordination.CoordinationError, "that is you"):
            self.crew.when(self.b, self.b)


class CommandTest(CoordinationBase):
    """`ag actors` through the dashboard's server, as an actor's shell runs it."""

    def setUp(self):
        super().setUp()
        self.httpd = server.serve("127.0.0.1", 0, live_updates=False)
        self.httpd.crew = self.crew
        import threading
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"

    def run_cli(self, *args, env=None):
        out, err = io.StringIO(), io.StringIO()
        base = {"AG_DASHBOARD": self.url, "CLAUDE_CODE_SESSION_ID": self.a}
        with unittest.mock.patch.dict(os.environ, {**base, **(env or {})}), redirect_stdout(out), redirect_stderr(err):
            for v in ("CODEX_THREAD_ID", "AG_ACTOR"):
                os.environ.pop(v, None)
            code = cli.main(list(args))
        return code, out.getvalue(), err.getvalue()

    def test_an_actor_lists_and_messages_the_others_from_its_shell(self):
        code, out, err = self.run_cli()
        self.assertEqual((code, err), (0, ""))
        self.assertIn(f'{self.a} "Fix the editor" (you) -- idle, claude, in', out)
        self.assertIn("no gatherer agent yet", out)
        code, out, _ = self.run_cli("send", self.b[:8], "hello", "there")
        self.assertEqual(code, 0)
        self.assertIn(f'Sent to actor {self.b} ("Write the docs")', out)
        self.assertEqual(coordination.opened(self.until(lambda: self.messages(self.b))[0])["text"], "hello there")
        code, out, _ = self.run_cli("--json", "list")
        self.assertEqual(json.loads(out)["you"], self.a)

    def test_the_gatherer_agent_starts_a_docwriter_from_its_shell(self):
        if not docwriter.AVAILABLE:
            self.skipTest("pycrdt is not installed")
        paper = os.path.join(self.tmp.name, "paper")
        os.makedirs(paper)
        with unittest.mock.patch.object(docwriter.DocWriters, "_name", lambda *args: None):   # no ag to name it in
            code, out, err = self.run_cli("new", "--docwriter", "--cwd", paper, "Tighten", "the", "introduction.")
        self.assertEqual((code, err), (0, ""))
        self.assertIn("a DocWriter, with your message", out)
        new = re.match(r"Started actor (\S+) ", out).group(1)
        row = next(r for r in self.s.list() if r["session_id"] == new)
        self.assertEqual((json.loads(row["role"]).keys(), row["cwd"]), ({"docwriter"}, os.path.realpath(paper)))
        self.assertEqual(coordination.opened(self.until(lambda: self.messages(new))[0])["text"], "Tighten the introduction.")
        code, out, _ = self.run_cli()
        self.assertIn(f"{new} (a DocWriter) -- idle, claude, in", out)

    @unittest.skipUnless(browser.available(), "no Chrome here")
    def test_the_gatherer_agent_starts_a_browser_from_its_shell(self):
        self.crew.browsers = self.httpd.browsers
        with unittest.mock.patch.object(browser.Browsers, "name_actor"):   # no ag to name it in
            code, out, err = self.run_cli("new", "--browser", "--cwd", self.tmp.name, "Find", "the", "deadline.")
        self.assertEqual((code, err), (0, ""))
        self.assertIn("a Browser, with your message", out)
        new = re.match(r"Started actor (\S+) ", out).group(1)
        row = next(r for r in self.s.list() if r["session_id"] == new)
        self.assertEqual((json.loads(row["role"]).keys(), row["cwd"]), ({"browser"}, os.path.realpath(self.tmp.name)))
        code, out, _ = self.run_cli()
        self.assertIn(f"{new} (a Browser) -- idle, claude, in", out)

    @unittest.skipIf(not docwriter.AVAILABLE, "pycrdt is not installed")
    def test_the_gatherer_agent_starts_an_actor_on_a_branch_from_its_shell(self):
        repo = make_repo(os.path.join(self.tmp.name, "repo"))
        code, out, err = self.run_cli("new", "--branch", "--approve", "--cwd", repo, "Try", "another", "layout.")
        self.assertEqual((code, err), (0, ""))
        new = re.match(r"Started actor (\S+) ", out).group(1)
        b = self.httpd.branches.rows()[0]
        self.assertEqual((b["session_id"], b["project"], b["approve"]), (new, repo, 1))
        self.assertIn(f"in {b['worktree']}) with your message, on its own branch {b['branch']} of {repo}.", out)
        self.assertIn("each change waiting for the user to accept it in the Editor", out)
        self.assertEqual(coordination.opened(self.until(lambda: self.messages(new))[0])["text"], "Try another layout.")
        code, _, err = self.run_cli("new", "--approve", "--cwd", repo, "Go.")
        self.assertEqual(code, 1)
        self.assertIn("--approve is for an actor on a branch", err)

    def test_its_errors_are_said_plainly(self):
        code, _, err = self.run_cli("send", "nobody", "hi")
        self.assertEqual(code, 1)
        self.assertEqual(err.strip(), "ag actors: no actor nobody in the gatherer")
        code, _, err = self.run_cli("list", env={"CLAUDE_CODE_SESSION_ID": ""})
        self.assertIn("which actor asks?", err)
        code, _, err = self.run_cli("list", env={"AG_DASHBOARD": "http://127.0.0.1:1"})
        self.assertIn("no dashboard answers at http://127.0.0.1:1", err)

    def test_a_sandbox_that_blocks_the_dashboard_is_named_with_the_way_around_it(self):
        import errno
        import urllib.error
        refused = urllib.error.URLError(PermissionError(errno.EPERM, "Operation not permitted"))
        with unittest.mock.patch.object(cli.urllib.request, "urlopen", side_effect=refused):
            code, _, err = self.run_cli("list")
        self.assertEqual(code, 1)
        self.assertIn("a sandbox keeps this command from reaching the dashboard", err)
        self.assertIn('sandbox_permissions "require_escalated"', err)

    def test_the_session_the_command_runs_in_is_found_by_its_harness_else_by_the_dashboard(self):
        self.assertEqual(cli.actor_id({"CODEX_THREAD_ID": "t", "AG_ACTOR": "x"}), "t")
        self.assertEqual(cli.actor_id({"AG_ACTOR": "x"}), "x")
        self.assertEqual(cli.actor_id({"AG_ACTOR": "x"}, given="me"), "me")
        self.assertIsNone(cli.actor_id({}))


class AvatarTest(unittest.TestCase):
    def test_the_gatherer_agent_is_always_the_manager_and_no_one_else_is(self):
        import tempfile
        from ag_dashboard import avatars, home
        self.assertNotIn("roles/manager", avatars.pictures())                    # never given out at random
        with tempfile.TemporaryDirectory() as tmp, unittest.mock.patch.object(home, "HOME", tmp):
            got = avatars.assign({"gatherers": [{"name": "g", "agents": [
                {"channel": f"c{i}", "status": "idle", "created": i} for i in range(40)] + [
                {"channel": "boss", "status": "idle", "created": 99, "role": sessions.COORDINATOR}]}]})
        agents = {a["channel"]: a for a in got["gatherers"][0]["agents"]}
        self.assertEqual((agents["boss"]["avatar"], agents["boss"]["avatar_hue"], agents["boss"]["avatar_motion"]),
                         ("roles/manager", "blue", "nod"))
        self.assertIn(agents["boss"]["avatar_hello"], avatars.hello("roles/manager"))
        self.assertEqual(len(avatars.hello("roles/manager")), avatars.STYLES)
        self.assertNotIn("roles/manager", {a["avatar"] for c, a in agents.items() if c != "boss"})

    def test_its_badge_is_not_an_avatars_circle_and_comes_off_as_a_circle_does(self):
        from ag_dashboard import avatars
        with open(avatars.path("roles/manager"), "rb") as fh:
            svg = fh.read()
        self.assertNotRegex(svg, avatars.CIRCLE)                                   # a hexagon, edged in gold
        self.assertRegex(svg, avatars.FRAME)
        self.assertNotIn(b"data-frame", avatars.bare(svg))                          # the owl alone, at work
        self.assertIn(b"<ellipse", avatars.bare(svg))


class RealGathererTest(unittest.TestCase):
    """data.py and files.py on a real gatherer: its gatherer agent named by its role, and the messages an actor sent."""

    def setUp(self):
        from test_dashboard import HomeBase
        self.home = HomeBase("setUp")
        self.home.setUp()
        self.addCleanup(self.home.tearDown)

    def row(self, sid, role=None):
        return {"session_id": sid, "gatherer": "g", "harness": "codex", "cwd": "/w", "permission_mode": "auto",
                "created_at": "2026-10-27T00:00:00+00:00", "turns": 1, "status": "stopped", "last_error": None, "kept": 0,
                "model": None, "started_as": None, "ended": 0, "role": role, "queued": [], "terminal": False,
                "answer": None, "typed": None, "fullscreen": False, "pid": None, "since": None}

    def test_the_gatherer_agent_is_named_by_its_role_and_the_others_as_they_were(self):
        got = {a["channel"]: a for a in data.gatherer_actors("g", [self.row("c1", sessions.COORDINATOR), self.row("new")])}
        self.assertEqual(set(got), {"c1", "c2", "new"})                           # one with no message yet too
        self.assertEqual((got["c1"]["role"], got["c1"]["name"]), (sessions.COORDINATOR, {"text": "Gatherer agent", "by": "dashboard"}))
        self.assertNotIn("role", got["c2"])

    def test_chat_shows_what_an_actor_sent_in_the_turn_it_sent_it(self):
        from replies import insert
        insert(self.home.m, "g", {"channel": "c1"}, [{"type": "actor_message", "id": "actor_message:1",
                                                       "payload": {"kind": "send", "to": "c2", "to_name": "Docs", "text": "hi", "at": 1}}])
        turns = files.files("g", "c1")["turns"]
        self.assertEqual(turns[-1].get("sent"), [{"kind": "send", "to": "c2", "to_name": "Docs", "text": "hi", "at": 1}])
        self.assertTrue(all("sent" not in t for t in turns[:-1]))
        self.assertNotIn("actor_message", [e["type"] for e in data.transcript("g", "c1").get("events", [])])


if __name__ == "__main__":
    unittest.main()
