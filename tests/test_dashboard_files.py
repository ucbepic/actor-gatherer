"""The dashboard's Files view (ag_dashboard/files.py): a turn's files, each with the lines the
agent saw -- by Read, or by a shell command that only prints part of a file -- and its edits
in place among them, by an edit tool or by a shell command whose change can be read from it."""
import json
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag_dashboard import data, files  # noqa: E402
from ag_dashboard import home as dashboard_home  # noqa: E402

words = lambda replies: [{k: v for k, v in r.items() if k != "after"} for r in replies]   # what they say, not where


class ShellReadsTest(unittest.TestCase):
    """What a shell command read, told from its output."""

    def test_reads_are_split_out_of_one_output(self):
        found, other = files.shell_reads("sed -n 3,4p a.py; grep -n x b.py | head -3; sed -n 10,11p c.py",
                                         "L3\nL4\n5:x\n9:xx\nL10\nL11", "/w")
        self.assertEqual(found, [("/w/a.py", "lines", 3, ["L3", "L4"]), ("/w/b.py", "hit", 5, "x"),
                                 ("/w/b.py", "hit", 9, "xx"), ("/w/c.py", "lines", 10, ["L10", "L11"])])
        self.assertTrue(other)                                   # a search is not only reading

    def test_cd_sets_the_directory_and_a_command_of_unknown_size_is_split_from_the_back(self):
        found, other = files.shell_reads("cd /r && git status --short; cat d.txt | head -2; sed -n 1,2p e.py",
                                         " M f\n?? g\nd1\nd2\ne1\ne2", "/w")
        self.assertEqual(found, [("/r/d.txt", "lines", 1, ["d1", "d2"]), ("/r/e.py", "lines", 1, ["e1", "e2"])])
        self.assertTrue(other)

    def test_a_read_between_two_of_unknown_size_is_not_guessed(self):
        found, _ = files.shell_reads("ls; cat a.py; git log", "x\ny\nz", "/w")
        self.assertEqual(found, [("/w/a.py", "unsplit", None, [])])

    def test_numbered_and_recursive_searches(self):
        self.assertEqual(files.shell_reads("cat -n a.py", "     7\tseven", "/w")[0], [("/w/a.py", "lines", 7, ["seven"])])
        self.assertEqual(files.shell_reads("grep -rn foo src", "src/a.py:3:foo", "/w")[0], [("/w/src/a.py", "hit", 3, "foo")])
        only_reads = files.shell_reads("sed -n 1p a.py", "one", "/w")
        self.assertEqual(only_reads, ([("/w/a.py", "lines", 1, ["one"])], False))

    def test_what_cannot_be_read_plainly_is_left_as_a_command(self):
        self.assertEqual(files.shell_reads("cat $(ls)", "x", "/w"), ([], True))
        self.assertEqual(files.shell_reads("python3 - <<'EOF'\nprint(1)\nEOF", "1", "/w"), ([], True))


class ShellChangesTest(unittest.TestCase):
    """What a shell command changed, read from the command."""

    def test_git_changing_a_checkout_s_files_is_told(self):
        for command in ("git pull -q origin main", "cd /r && git status; git merge origin/main 2>&1 | tail -2",
                        "git -C ../wt checkout -- a.py", "GIT_EDITOR=true git rebase --continue", "(cd /r && git stash pop)",
                        "git worktree add -b x ../x origin/main", "gh pr checkout 12"):
            self.assertTrue(files.runs_git(command), command)
        for command in ("git status --short", "git log --oneline -5 > log.txt", "git commit -qm 'x'", "git diff | cat",
                        "echo git pull", "gh pr view 12", "cat > notes.md <<'EOF'\ngit pull\nEOF"):
            self.assertFalse(files.runs_git(command), command)

    def test_the_work_trees_git_worktree_add_makes_are_told(self):
        self.assertEqual(files.worktrees_added("cd /r && git worktree add -q -b x ../wt origin/main && cd ../wt && git log", "/w"),
                         ["/wt"])
        self.assertEqual(files.worktrees_added("git -C /r worktree add --reason 'a b' -B y wt2; WT=/tmp/x; git worktree add $WT",
                                               "/w"), ["/r/wt2", "/tmp/x"])
        for command in ("git worktree list", "git worktree remove ../wt", "echo git worktree add x", "git worktree add $NOT_SET"):
            self.assertEqual(files.worktrees_added(command, "/w"), [], command)

    def test_a_heredoc_or_echo_into_a_file_writes_it(self):
        self.assertEqual(files.shell_changes("cat > n.txt <<'EOF'\nhello\nworld\nEOF", "/w"),
                         ([("/w/n.txt", "write", "hello\nworld")], True))
        self.assertEqual(files.shell_changes("cd sub && cat >> log <<EOF\nmore\nEOF\necho done", "/w"),
                         ([("/w/sub/log", "append", "more")], True))
        self.assertEqual(files.shell_changes("S=/tmp/x; echo 1 > $S/id", "/w"), ([("/tmp/x/id", "write", "1")], True))
        self.assertEqual(files.shell_changes("ls 2>err.log >/dev/null", "/w"), ([], False))   # stderr, and nowhere

    def test_sed_in_place_changes_files_it_cannot_say_where(self):
        self.assertEqual(files.shell_changes("sed -i 's/a/b/' x.py y.py && git diff", "/w"),
                         ([("/w/x.py", "changed", "sed -i s/a/b/"), ("/w/y.py", "changed", "sed -i s/a/b/")], False))

    def test_a_python_script_s_replacements_go_to_the_file_it_writes(self):
        script = """cd /r && python3 - <<'EOF'
p = "a/b.py"; s = open(p).read()
def sub(old, new):
    global s
    s = s.replace(old, new)
sub("x = 1", "x = 2")
for o, n in [("foo", "bar"), (\"\"\"two
lines\"\"\", "one")]:
    s = s.replace(o, n)
open(p, "w").write(s)
from pathlib import Path
Path("c.txt").write_text("hi")
EOF"""
        self.assertEqual(files.shell_changes(script, "/w"), ([
            ("/r/a/b.py", "pairs", [("x = 1", "x = 2"), ("foo", "bar"), ("two\nlines", "one")]),
            ("/r/c.txt", "changed", "a Python script")], False))
        self.assertEqual(files.python_changes("s = open('a').read().replace(x, 'y')\nopen('a', 'w').write(s)", "/w"),
                         [("/w/a", [])])                    # a replacement not made of constants: changed, lines unknown


def call(cid, name, inp):
    return ("tool_call", {"role": "assistant", "content": [{"type": "tool_use", "id": cid, "name": name, "input": inp}]})


def result(cid, text, error=False):
    return ("tool_output", {"role": "user", "content": [{"type": "tool_result", "tool_use_id": cid, "is_error": error, "content": text}]})


def said(text):
    return ("agent_message", {"role": "assistant", "content": [{"type": "text", "text": text}]})


def thought(text):
    return ("agent_reasoning", {"role": "assistant", "content": [{"type": "thinking", "thinking": text, "signature": "s"}]})


def asked(text):
    return ("user_message", {"role": "user", "content": [{"type": "text", "text": text}]})


def note(text, role="user"):
    """A note of Claude Code's own, stored as ag's Claude adaptor stores it: context."""
    return ("context", {"role": role, "content": [{"type": "text", "text": text}]})


# As codex 0.164 wrote it live: its code-mode script (`exec`), and what the call gave back
SCRIPT = ("const r = await tools.exec_command({cmd:\"printf 'one\\\\n' > notes.txt && printf 'two\\\\n' > notes.txt "
          "&& cat notes.txt\",max_output_tokens:1000});\ntext(r.output);\n")
SCRIPT_OUT = [{"type": "input_text", "text": "Script completed\nWall time 0.1 seconds\nOutput:\n"}, {"type": "input_text", "text": "two\n"}]


class FilesTest(unittest.TestCase):
    """A session of two turns, in a gatherer database of the test's own."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.saved, dashboard_home.HOME = dashboard_home.HOME, self.tmp.name
        self.addCleanup(setattr, dashboard_home, "HOME", self.saved)
        os.makedirs(os.path.join(self.tmp.name, "gatherers", "g"))
        self.db = os.path.join(self.tmp.name, "gatherers", "g", "context.db")
        conn = sqlite3.connect(self.db)
        conn.executescript("""CREATE TABLE event_types (event_type_id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
            CREATE TABLE events (row_id INTEGER PRIMARY KEY, inserted_at TEXT NOT NULL, event_id TEXT, event_type_id INTEGER NOT NULL,
              payload_json TEXT NOT NULL, tokens INTEGER NOT NULL, text TEXT, counted INTEGER, p_channel);""")
        conn.close()
        self.add(("model_call", {"kind": "turn", "harness": "claude"}))       # its hook recorded its call, and the harness
        self.add(
            asked("look at a.py"),
            thought("Read it first."), thought(""),
            call("r1", "Read", {"file_path": "/w/a.py"}), result("r1", "1\tdef f():\n2\t    return 1\n3\t\n4\tdef g():\n5\t    return 2"),
            said("It returns 1."),
            asked("change g"),
            call("b1", "Bash", {"command": "sed -n 4,5p a.py", "description": "Show g"}), result("b1", "def g():\n    return 2"),
            call("e1", "Edit", {"file_path": "/w/a.py", "old_string": "    return 2", "new_string": "    return 3\n    # three"}),
            result("e1", "The file /w/a.py has been updated successfully."),
            call("e2", "Edit", {"file_path": "/w/b.py", "old_string": "x = 1", "new_string": "x = 2"}), result("e2", "ok"),
            call("w1", "Write", {"file_path": "/w/new.py", "content": "print(1)\n"}), result("w1", "created"),
            call("t1", "Bash", {"command": "python3 -m unittest", "description": "Run the tests"}), result("t1", "FAILED", True),
            call("p1", "Bash", {"command": "python3 - <<'EOF'\np = 'a.py'\ns = open(p).read().replace('    # three', '    # 3')\n"
                                           "open(p, 'w').write(s)\nEOF", "description": "Shorten the comment"}), result("p1", ""),
            call("c1", "Bash", {"command": "cat > notes.md <<'EOF'\n# notes\nEOF", "description": "Write notes"}), result("c1", ""),
            call("i1", "Read", {"file_path": "/w/shot.png"}),
            ("tool_output", {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "i1", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo="}}]}]}),
        )

    def add(self, *events, channel="c1", at="2026-10-24 08:00:00"):
        """Events of `channel`, after those there (written at `at`)."""
        conn = sqlite3.connect(self.db)
        for typ, payload in events:
            got = conn.execute("SELECT event_type_id FROM event_types WHERE name = ?", (typ,)).fetchone()
            tid = got[0] if got else conn.execute("INSERT INTO event_types (name, created_at) VALUES (?, '')", (typ,)).lastrowid
            conn.execute("INSERT INTO events (inserted_at, event_type_id, payload_json, tokens, p_channel) VALUES "
                         "(?, ?, ?, 1, ?)", (at, tid, json.dumps(payload), channel))
        conn.commit()
        conn.close()

    def test_a_codex_script_is_the_calls_it_makes(self):
        self.add(("model_call", {"kind": "turn", "harness": "codex"}), asked("make notes"),           # a codex thread
                 ("tool_call", {"type": "custom_tool_call", "call_id": "x1", "name": "exec", "input": SCRIPT}),
                 ("tool_output", {"type": "custom_tool_call_output", "call_id": "x1", "output": SCRIPT_OUT}), channel="cx")
        got = files.files("g", "cx", cwd="/w")
        self.add(asked("the same, run directly"),
                 ("tool_call", {"type": "function_call", "call_id": "f1", "name": "exec_command", "arguments": json.dumps(
                     {"cmd": "printf 'one\\n' > notes.txt && printf 'two\\n' > notes.txt && cat notes.txt"})}),
                 ("tool_output", {"type": "function_call_output", "call_id": "f1", "output": "two\n"}), channel="cx")
        direct = files.files("g", "cx", cwd="/w")
        self.assertEqual([f["path"] for f in got["files"]], ["/w/notes.txt"])
        blocks = lambda g: [b for f in g["files"] for s in f["sources"] for b in s["blocks"]]
        self.assertEqual(blocks(got), blocks(direct))                      # read as its call would be on its own
        (one,), (other,) = got["commands"], direct["commands"]
        self.assertEqual({k: one[k] for k in ("text", "output", "files")}, {k: other[k] for k in ("text", "output", "files")})
        self.assertEqual(one["output"], "two\n")                          # what it printed, without codex's head
        part, = [p for p in data.parts("tool_call", json.dumps({"type": "custom_tool_call", "call_id": "x1", "name": "exec",
                                                                "input": SCRIPT}), None, harness="codex") if p["kind"] == "call"]
        self.assertEqual([c["name"] for c in part["calls"]], ["exec_command"])  # the Chat view titles it by its call

    def test_the_turns_and_the_latest_by_default(self):
        got = files.files("g", "c1", cwd="/w")
        self.assertEqual([t["text"] for t in got["turns"]], ["look at a.py", "change g"])
        self.assertEqual(got["turn"], 1)
        self.assertEqual([t["replies"] for t in got["turns"]],              # what the agent thought and said back
                         [[{"kind": "thinking", "texts": ["Read it first."], "after": 0},
                           {"kind": "text", "text": "It returns 1.", "after": 1}], []])
        self.assertEqual([t["now"] for t in got["turns"]], [None, None])    # done: nothing under way
        self.assertEqual([f["path"] for f in got["files"]], ["/w/a.py", "/w/b.py", "/w/new.py", "/w/notes.md", "/w/shot.png"])
        self.assertIn("error", files.files("nope", "c1"))

    def test_each_reply_says_how_many_of_its_turn_s_calls_came_before_it(self):
        # the order the agent spoke and worked in, which the turns' replies and their commands, listed apart, lose
        self.add(asked("fix it"), said("Looking first."),
                 call("x1", "Bash", {"command": "ls", "description": "List"}), result("x1", "a.py"),
                 thought("Odd."), call("x2", "Bash", {"command": "cat a.py", "description": "Show a.py"}), result("x2", "x = 1"),
                 said("Found it."), call("x3", "Edit", {"file_path": "/w/a.py", "old_string": "x = 1", "new_string": "x = 2"}),
                 result("x3", "ok"), said("Fixed."))
        got = files.files("g", "c1", cwd="/w")
        t = got["turns"][-1]
        self.assertEqual([(r["kind"], r["after"]) for r in t["replies"]],
                         [("text", 0), ("thinking", 1), ("text", 2), ("text", 3)])
        self.assertEqual([c["text"] for c in got["commands"]], ["List", "Show a.py", "Edit a.py"])   # the 1st, 2nd and 3rd
        earlier = files.files("g", "c1", 0, cwd="/w")["turns"][0]["replies"]                  # an earlier turn's, the same
        self.assertEqual([r["after"] for r in earlier], [0, 1])

    def test_a_turn_ends_at_its_last_event(self):
        self.add(asked("and now?"), at="2026-10-24 09:00:00")
        self.add(said("Thinking it over."), at="2026-10-24 09:00:20")
        self.add(said("Done."), at="2026-10-24 09:01:05")
        t = files.files("g", "c1")["turns"][-1]
        self.assertEqual(t["end"] - t["at"], 65)                         # how long it took: its message to its last word

    def test_what_it_changed_of_a_file_since_a_time(self):
        self.add(asked("fix b"), at="2026-10-24 09:00:00")
        self.add(call("e1", "Edit", {"file_path": "/w/b.py", "old_string": "x = 1", "new_string": "x = 2"}), at="2026-10-24 09:00:10")
        self.add(result("e1", "ok"), at="2026-10-24 09:00:11")
        self.add(call("e2", "Edit", {"file_path": "/w/b.py", "old_string": "x = 2", "new_string": "x = 3"}), at="2026-10-24 09:05:00")
        self.add(result("e2", "ok"), at="2026-10-24 09:05:01")
        self.add(call("r1", "Read", {"file_path": "/w/b.py"}), at="2026-10-24 09:06:00")
        self.add(result("r1", "x = 3"), at="2026-10-24 09:06:01")
        since = data._seconds("2026-10-24 09:01:00")
        got = files.changes("g", "c1", "/w/b.py", since, cwd="/w")["changes"]
        self.assertEqual([c["call"]["input"]["new_string"] for c in got], ["x = 3"])   # the edit since then; not the read
        self.assertEqual((got[0]["asked"], got[0]["at"]), ("fix b", data._seconds("2026-10-24 09:05:00")))
        both = files.changes("g", "c1", "/w/b.py", data._seconds("2026-10-24 08:59:00"), cwd="/w")["changes"]
        self.assertEqual([c["call"]["input"]["new_string"] for c in both], ["x = 2", "x = 3"])
        self.assertEqual(files.changes("g", "c1", "/w/b.py", data._seconds("2026-10-24 09:10:00"), cwd="/w")["changes"], [])

    def test_what_the_agent_is_doing_while_its_turn_runs(self):
        self.add(asked("and now?"), thought(""))
        self.assertEqual(words(files.files("g", "c1")["turns"][-1]["replies"]), [{"kind": "thinking", "texts": []}])   # encrypted
        self.assertEqual(files.files("g", "c1")["turns"][-1]["now"], {"kind": "thinking"})
        self.add(call("b9", "Bash", {"command": "make", "description": "Build it"}))
        self.assertEqual(files.files("g", "c1")["turns"][-1]["now"], {"kind": "call", "id": "b9", "text": "Build it"})
        self.add(result("b9", "ok"))
        self.assertIsNone(files.files("g", "c1")["turns"][-1]["now"])        # its result in: the model's turn again

    def test_the_latest_call_is_kept_while_nothing_readable_follows_it(self):
        got = files.files("g", "c1", cwd="/w")["turns"]
        self.assertIsNone(got[0]["last"])                                   # a reply after its call
        self.assertEqual({k: got[1]["last"][k] for k in ("id", "running", "error")}, {"id": "i1", "running": False, "error": False})
        self.add(asked("and now?"), thought(""), call("b9", "Bash", {"command": "make", "description": "Build it"}))
        last = files.files("g", "c1")["turns"][-1]["last"]
        self.assertEqual((last["text"], last["running"], last["call"]["input"]["command"]), ("Build it", True, "make"))
        self.add(result("b9", "make: *** failed", True), thought(""))        # encrypted thinking: nothing to show after it
        last = files.files("g", "c1")["turns"][-1]["last"]
        self.assertEqual((last["running"], last["error"], last["output"]), (False, True, "make: *** failed"))
        self.add(thought("Try again."))                                     # thinking shown after it: no longer the last
        self.assertIsNone(files.files("g", "c1")["turns"][-1]["last"])
        self.add(call("b10", "Bash", {"command": "make"}), result("b10", "ok"), said("Built."))
        self.assertIsNone(files.files("g", "c1")["turns"][-1]["last"])     # a reply after it

    def test_what_its_calls_are_doing_and_how_they_ended(self):
        work = files.files("g", "c1")["turns"][-1]["work"]                  # the edits, the failed tests, then the reads
        self.assertEqual((work["doing"], work["last"], work["failed"]), (None, "read", 0))
        self.assertEqual({k: work["ended"][k] for k in ("id", "kind", "ok")}, {"id": "i1", "kind": "read", "ok": True})
        self.add(asked("again"), call("t2", "Bash", {"command": "cd tests && python -m unittest"}))
        work = files.files("g", "c1")["turns"][-1]["work"]
        self.assertEqual((work["doing"], work["last"], work["ended"]), ("test", "test", None))
        self.add(result("t2", "Ran 3 tests\n\nFAILED (failures=1)"))       # exits 0 through a pipe, all the same failed
        work = files.files("g", "c1")["turns"][-1]["work"]
        self.assertEqual((work["doing"], work["last"], work["ended"]["ok"], work["failed"]), (None, "test", False, 1))
        self.add(call("g1", "Grep", {"pattern": "x"}), result("g1", "nothing", True), call("a1", "Agent", {"prompt": "p"}),
                 call("a2", "Agent", {"prompt": "q"}))
        work = files.files("g", "c1")["turns"][-1]["work"]
        self.assertEqual((work["doing"], work["helpers"], work["failed"]), ("team", 2, 2))
        self.add(result("a1", "done"), said("Both helpers are working."))
        work = files.files("g", "c1")["turns"][-1]["work"]
        self.assertEqual((work["doing"], work["last"], work["failed"]), ("team", None, 0))   # a reply after: no last call

    def test_a_read_shows_its_lines_at_their_numbers(self):
        a = files.files("g", "c1", 0)["files"][0]
        self.assertEqual(a["kinds"], ["read"])
        self.assertEqual(a["sources"][0]["blocks"][0]["start"], 1)
        self.assertEqual(a["sources"][0]["blocks"][0]["lines"][:2], ["def f():", "    return 1"])

    def test_each_call_shows_what_it_did_to_the_file(self):
        got = files.files("g", "c1", 1, cwd="/w")
        a = got["files"][0]
        self.assertEqual(a["kinds"], ["edit", "read"])
        read, edit, script = a["sources"]
        self.assertEqual(read["via"], "Show g")                     # a command's own description names it
        self.assertEqual(read["blocks"], [{"t": "lines", "start": 4, "lines": ["def g():", "    return 2"], "cut": 0}])
        self.assertEqual(edit["blocks"], [{"t": "diff", "at": 5, "old": ["    return 2"], "new": ["    return 3", "    # three"],
                                           "above": [[3, ""], [4, "def g():"]], "below": []}])
        self.assertEqual([(b["at"], b["old"], b["new"]) for b in script["blocks"]],   # placed after the edit before it
                         [(6, ["    # three"], ["    # 3"])])
        b = got["files"][1]                                         # never seen: where in it is not known
        self.assertEqual([(x["at"], x["new"]) for x in b["sources"][0]["blocks"]], [(None, ["x = 2"])])
        new = got["files"][2]
        self.assertTrue(new["created"])
        self.assertEqual(new["sources"][0]["blocks"][0]["lines"], ["print(1)", ""])

    def test_a_shell_command_s_changes_show_on_its_files_not_as_commands(self):
        got = files.files("g", "c1", 1, cwd="/w")
        a = got["files"][0]
        self.assertEqual([s["via"] for s in a["sources"]], ["Show g", "Edit", "Shorten the comment"])
        notes = got["files"][3]
        self.assertEqual((notes["kinds"], notes["created"], notes["sources"][0]["blocks"][0]["lines"]), (["write"], True, ["# notes"]))

    def test_an_image_read_is_shown_from_where_it_is_stored(self):
        shot = files.files("g", "c1", 1, cwd="/w")["files"][4]
        self.assertEqual(shot["kinds"], ["read"])                       # an image is read like any file
        b = shot["sources"][0]["blocks"][0]
        self.assertEqual((b["t"], b["id"]), ("image", "i1"))
        self.assertEqual(files.image("g", b["row_id"], "i1"), ("image/png", b"\x89PNG\r\n\x1a\n"))
        self.assertIsNone(files.image("g", b["row_id"], "other"))       # another call's: not this one

    TOUCHED = [("b1", "/w/a.py", "read", 0, 1, {"lines": [[4, ["def g():", "    return 2"]]]}),
               ("e2", "/w/b.py", "modified", None, 1, {"hunks": [{"at": 7, "old": ["x = 1"], "new": ["x = 2"],
                                                                  "above": [[6, "y = 0"]], "below": []}]}),
               ("p1", "/w/a.py", "modified", None, 1, {}),
               ("p1", "/w/out.txt", "created", None, 0, {"lines": ["made"]}),
               ("t1", None, None, None, None, None)]

    def test_a_call_checked_on_disk_as_its_hook_records_it(self):
        self.add(*[("file_touched", {"call": call_id, "path": path, "how": how, "checked": None if checked is None else bool(checked),
                                     "named": None if named is None else bool(named), "detail": detail or {}})
                   for call_id, path, how, checked, named, detail in self.TOUCHED])
        self.found_there()

    def found_there(self):
        got = files.files("g", "c1", 1, cwd="/w")
        by = {f["path"]: f for f in got["files"]}
        read, edit, script = by["/w/a.py"]["sources"]
        self.assertEqual((read["checked"], read["blocks"][0]["start"]), (False, 4))      # not as on disk
        self.assertEqual(script["blocks"][0]["t"], "note")                               # changed, lines unknown
        diff, = by["/w/b.py"]["sources"][0]["blocks"]
        self.assertEqual((diff["at"], diff["new"]), (7, ["x = 2"]))                     # where the file says
        out = by["/w/out.txt"]
        self.assertEqual((out["kinds"], out["created"], out["sources"][0].get("unnamed")), (["write"], True, True))
        self.assertEqual(out["sources"][0]["blocks"][0]["text"], "changed while this ran; the call doesn't name it")
        self.assertIn(("Run the tests", []), [(c["text"], c["files"]) for c in got["commands"]])

    def test_a_change_found_in_ag_s_home_is_left_out_unless_the_call_says_it_writes_it(self):
        db, notes = os.path.join(self.tmp.name, "gatherers", "g", "context.db"), os.path.join(self.tmp.name, "notes.txt")
        self.add(asked("look it up"), call("q1", "Bash", {"command": f"sqlite3 {db} 'SELECT 1'", "description": "Query"}),
                 result("q1", "1"), call("n1", "Bash", {"command": f"echo hi > {notes}", "description": "Note"}), result("n1", ""))
        self.add(*[("file_touched", {"call": call_id, "path": path, "how": "modified", "checked": None, "named": True,
                                     "detail": {}}) for call_id, path in [("q1", db), ("n1", notes)]])   # as the hook records them
        got = files.files("g", "c1", 2, cwd="/w")
        self.assertEqual([f["path"] for f in got["files"]], [notes])        # the query's: ag's own write
        self.assertEqual([(c["text"], c["files"]) for c in got["commands"]], [("Query", []), ("Note", [notes])])
        self.assertEqual(got["home"], os.path.expanduser("~"))

    def touched(self, *rows, channel="c1", at="2026-10-24 08:00:00"):
        """What ag's hook found calls did on disk: (call, path, how, named, detail)."""
        self.add(*[("file_touched", {"call": c, "path": path, "how": how, "checked": None, "named": named, "detail": detail or {}})
                   for c, path, how, named, detail in rows], channel=channel, at=at)

    @staticmethod
    def kinds(got):
        """Each file's kinds, its own and git's."""
        return {f["path"]: (f["kinds"], f["git"]) for f in got["files"]}

    def test_what_git_changes_as_a_call_runs_it_is_told_apart_from_the_call_s_own(self):
        self.add(asked("make two work trees, pull and undo"),
                 call("k1", "Bash", {"command": "cd /r && git worktree add -q -b x ../wt origin/main && grep -n f ../wt/a.py",
                                     "description": "Make the work tree"}), result("k1", "1:def f():"),
                 call("k2", "Bash", {"command": "git worktree add ../wt2 && echo hi > ../wt2/notes.txt", "description": "Another"}),
                 result("k2", ""), call("k3", "Bash", {"command": "git pull -q", "description": "Pull"}), result("k3", ""),
                 call("k4", "Bash", {"command": "git checkout -- b.py", "description": "Undo"}), result("k4", ""))
        self.touched(("k1", "/wt/a.py", "created", True, {"lines": ["def f():"]}), ("k1", "/wt/a.py", "hit", True, {"hits": [[1, "def f():"]]}),
                     ("k1", "/wt/b.py", "created", False, None),
                     ("k2", "/wt2/.git", "created", False, {"lines": ["gitdir: /r/.git/worktrees/wt2"]}),
                     ("k2", "/wt2/c.py", "created", False, None), ("k2", "/wt2/notes.txt", "created", True, {"lines": ["hi"]}),
                     ("k3", "/w/a.py", "modified", False, {"hunks": [{"at": 2, "old": ["x = 1"], "new": ["x = 2"]}]}),
                     ("k3", "/w/new.md", "created", False, {"lines": ["# new"]}), ("k4", "/w/b.py", "modified", True, {}))
        got = files.files("g", "c1", 2, cwd="/w")
        self.assertEqual(self.kinds(got), {
            "/wt/a.py": (["hit"], ["write"]), "/wt/b.py": ([], ["write"]), "/wt2/.git": ([], ["write"]), "/wt2/c.py": ([], ["write"]),
            "/wt2/notes.txt": (["write"], []), "/w/a.py": ([], ["edit"]), "/w/new.md": ([], ["write"]), "/w/b.py": ([], ["edit"])})
        a = next(f for f in got["files"] if f["path"] == "/wt/a.py")
        self.assertEqual([(s["kinds"], s.get("git")) for s in a["sources"]], [(["write"], True), (["hit"], None)])   # as recorded
        self.assertEqual([(f["path"], f["created"], f["changed"]) for f in got["files"] if f["path"] in ("/wt/b.py", "/w/a.py")],
                         [("/wt/b.py", False, None), ("/w/a.py", False, None)])     # not the agent's: neither created nor counted
        self.assertEqual([(c["text"], c.get("did"), sorted(c.get("git") or {}), c.get("changed")) for c in got["commands"]], [
            ("Make the work tree", {"/wt/a.py": ["hit"]}, ["/wt/a.py", "/wt/b.py"], None),
            ("Another", {"/wt2/notes.txt": ["write"]}, ["/wt2/.git", "/wt2/c.py"], [1, 0]),
            ("Pull", None, ["/w/a.py", "/w/new.md"], None), ("Undo", None, ["/w/b.py"], None)])
        self.add(asked("draw it"), call("k5", "Bash", {"command": "python3 draw.py", "description": "Draw"}), result("k5", ""),
                 at="2026-10-24 08:02:00")                  # the session's later work, where its git wrote: its own
        self.touched(("k5", "/wt/out.svg", "created", False, None), ("k5", "/w/a.py", "modified", False, {}), at="2026-10-24 08:02:00")
        self.assertEqual(self.kinds(files.files("g", "c1", 3, cwd="/w")), {"/wt/out.svg": (["write"], []), "/w/a.py": (["edit"], [])})
        self.assertEqual([(s["turn"], s.get("git")) for s in files.changes("g", "c1", "/w/a.py", 0, cwd="/w")["changes"]
                          if s["turn"] >= 2], [(2, True), (3, None)])   # the Editor's: every change, git's too

    def test_what_git_changes_as_another_session_s_calls_run_is_git_s(self):
        self.add(asked("make a work tree and pull"), call("k1", "Bash", {"command": "git worktree add ../wt", "description": "Make it"}),
                 result("k1", ""), call("k2", "Bash", {"command": "git pull", "description": "Pull"}), result("k2", ""))
        self.touched(("k1", "/wt/a.py", "created", False, None),    # its `.git` found by another session's call alone
                     ("k2", "/w/x.py", "modified", False, {}), ("k2", "/w/y.py", "modified", False, {}))
        for ch, cid, at in (("c2", "o1", "2026-10-24 08:00:00"), ("c3", "o2", "2026-10-24 08:05:00"), ("c4", "o3", "2026-10-24 09:00:00")):
            self.add(("model_call", {"kind": "turn", "harness": "claude"}), asked("run the tests"),
                     call(cid, "Bash", {"command": "python3 -m unittest > out.log", "description": "Run the tests"}),
                     result(cid, "OK"), channel=ch, at=at)
        self.touched(("o1", "/wt/.git", "created", False, {"lines": ["gitdir: /r/.git/worktrees/wt"]}),
                     ("o1", "/wt/a.py", "created", False, None), ("o1", "/w/out.log", "created", True, None),
                     ("o1", "/w/x.py", "modified", False, {}), channel="c2")
        self.touched(("o2", "/wt/a.py", "created", False, None), ("o2", "/w/x.py", "modified", False, {}),
                     ("o2", "/w/out.log", "modified", True, None),
                     ("o2", "/wt/b.py", "modified", False, {}),    # in the new work tree, but changed, not made: an edit's
                     ("o2", "/w/y.py", "deleted", False, None),    # the file git changed, but not as git did
                     channel="c3", at="2026-10-24 08:05:00")
        self.touched(("o3", "/wt/late.py", "created", False, None), ("o3", "/w/x.py", "modified", False, {}),
                     channel="c4", at="2026-10-24 09:00:00")
        self.assertEqual(self.kinds(files.files("g", "c1", 2, cwd="/w")), {"/wt/a.py": ([], ["write"]), "/w/x.py": ([], ["edit"]),
                                                                           "/w/y.py": ([], ["edit"])})
        got = files.files("g", "c2", 0, cwd="/w")
        self.assertEqual(self.kinds(got), {"/wt/.git": ([], ["write"]), "/wt/a.py": ([], ["write"]), "/w/out.log": (["write"], []),
                                           "/w/x.py": ([], ["edit"])})
        x = next(f for f in got["files"] if f["path"] == "/w/x.py")
        self.assertEqual(x["sources"][0]["blocks"][0]["text"], "changed by git as this ran, in another call; this call doesn't name it")
        self.assertEqual(self.kinds(files.files("g", "c3", 0, cwd="/w")), {"/wt/a.py": ([], ["write"]), "/w/x.py": ([], ["edit"]),
                                                                           "/w/out.log": (["edit"], []), "/wt/b.py": (["edit"], []),
                                                                           "/w/y.py": (["delete"], [])})
        self.assertEqual(self.kinds(files.files("g", "c4", 0, cwd="/w")),   # an hour on: its own
                         {"/wt/late.py": (["write"], []), "/w/x.py": (["edit"], [])})

    def test_matches_of_files_searched_one_after_another_are_not_guessed(self):
        self.add(asked("find them"), call("g1", "Bash", {"command": "grep -n f a.py; grep -n x b.py"}), result("g1", "1:def f():\n7:x = 1"))
        got = files.files("g", "c1", 2, cwd="/w")
        for f in got["files"]:
            self.assertEqual([b["t"] for b in f["sources"][0]["blocks"]], ["note"])

    def test_files_read_one_after_another_in_one_output_show_all_of_it_said_so(self):
        self.add(asked("read both"), call("u1", "Bash", {"command": "cat a.py && cat b.py"}),
                 result("u1", "def f():\n    return 1\nx = 1\nShell cwd was reset to /r"),
                 call("u2", "Bash", {"command": "cat c.py; cat d.py"}), result("u2", "def c():\n    pass\n"),
                 call("u3", "Bash", {"command": "cat e.py; cat f.py"}), result("u3", "\n"))
        got = files.files("g", "c1", 2, cwd="/w")
        by = {f["path"]: f["sources"][0]["blocks"] for f in got["files"]}
        for path in ("/w/a.py", "/w/b.py"):                             # which lines are whose: not known
            out, = by[path]
            self.assertEqual((out["t"], out["lines"]), ("output", ["def f():", "    return 1", "x = 1"]))
            self.assertIn("can't be told apart", out["note"])
        self.assertEqual(by["/w/e.py"], [{"t": "note", "text": "read, but the output was empty"}])
        self.add(*[("file_touched", {"call": "u2", "path": path, "how": "read", "checked": None, "named": True,   # checked on
                                     "detail": {"unsplit": True}}) for path in ("/w/c.py", "/w/d.py")])         # disk: the same
        got = files.files("g", "c1", 2, cwd="/w")
        by = {f["path"]: f["sources"][0]["blocks"] for f in got["files"]}
        self.assertEqual([(b["t"], b["lines"]) for b in by["/w/d.py"]], [("output", ["def c():", "    pass"])])

    def test_files_in_temporary_folders_are_marked_and_every_command_is_listed(self):
        tmp = os.path.join(files.TEMPORARY[0], "scratch", "x.txt")
        self.add(asked("scratch"), call("s1", "Bash", {"command": f"cat {tmp}", "description": "Read scratch"}), result("s1", "hi"),
                 call("s2", "Bash", {"command": f"cat {tmp}; sed -n 1p a.py", "description": "Both"}), result("s2", "hi\ndef f():"))
        got = files.files("g", "c1", 2, cwd="/w")
        self.assertEqual({f["path"]: f["temporary"] for f in got["files"]}, {tmp: True, "/w/a.py": False})
        self.assertEqual([c["text"] for c in got["commands"]], ["Read scratch", "Both"])
        self.assertTrue(files.temporary("/tmp/x") and files.temporary("/private/tmp/x") and not files.temporary("/tmpx/y"))

    def test_every_call_is_listed_in_order_with_its_files(self):
        cmds = files.files("g", "c1", 1, cwd="/w")["commands"]
        self.assertEqual([(c["text"], c["error"], c["files"]) for c in cmds], [
            ("Show g", False, ["/w/a.py"]), ("Edit a.py", False, ["/w/a.py"]), ("Edit b.py", False, ["/w/b.py"]),
            ("Write new.py", False, ["/w/new.py"]), ("Run the tests", True, []),
            ("Shorten the comment", False, ["/w/a.py"]), ("Write notes", False, ["/w/notes.md"]),
            ("Read shot.png", False, ["/w/shot.png"])])

    def test_each_change_counts_the_lines_it_added_and_removed_and_each_command_says_what_it_did_to_each_file(self):
        got = files.files("g", "c1", 1, cwd="/w")
        self.assertEqual([(c["text"], c.get("did"), c.get("changed")) for c in got["commands"]], [
            ("Show g", {"/w/a.py": ["read"]}, None), ("Edit a.py", {"/w/a.py": ["edit"]}, [2, 1]),
            ("Edit b.py", {"/w/b.py": ["edit"]}, [1, 1]), ("Write new.py", {"/w/new.py": ["write"]}, [1, 0]),
            ("Run the tests", None, None), ("Shorten the comment", {"/w/a.py": ["edit"]}, [1, 1]),
            ("Write notes", {"/w/notes.md": ["write"]}, [1, 0]), ("Read shot.png", {"/w/shot.png": ["read"]}, None)])
        a = got["files"][0]
        self.assertEqual([s["changed"] for s in a["sources"]], [None, [2, 1], [1, 1]])   # counted as a diff: "return" changed
        self.assertEqual(a["changed"], [3, 2])
        self.assertIsNone(got["files"][4]["changed"])                                    # only read

    # Claude Code's own notes, as Claude Code 2.1.310 sends them (saved from a live session) and ag stores them
    SKILL = "Base directory for this skill: /w/.claude/skills/greet\n\n# Greeting\n\nReply with exactly: \"Ahoy, <name>!\"\n\n\nARGUMENTS: {}"

    def test_a_message_s_words_as_kept_when_it_was_stored(self):
        conn = sqlite3.connect(self.db)                  # a gatherer whose events carry what the rules read of them
        conn.executescript("ALTER TABLE events ADD COLUMN p_kind; ALTER TABLE events ADD COLUMN p_words;")
        conn.close()
        self.add(asked("<command-message>deploy</command-message>\n<command-name>/deploy</command-name>"))
        conn = sqlite3.connect(self.db)
        conn.execute("UPDATE events SET p_kind = 'user_command', p_words = '/deploy now' WHERE row_id = (SELECT max(row_id) FROM events)")
        conn.commit()
        conn.close()
        last = files.files("g", "c1", cwd="/w")["turns"][-1]
        self.assertEqual((last["text"], last["kind"]), ("/deploy now", "user_command"))     # as kept, not read again

    def test_claude_code_s_notes_show_among_the_messages(self):
        handback = ('Another Claude session sent a message:\n<agent-message from="ab81">\n[Subagent hand-back] The text below is the '
                    "final report of a subagent ... The report follows:\n  Ran ls.\n  \n  - a.py\n</agent-message>\n\nThat \"other Claude session\" ...")
        self.add(asked("Greet Alice. Use the greet skill."),
                 call("k1", "Skill", {"skill": "greet", "args": "Alice"}), result("k1", "Launching skill: greet"),
                 note(self.SKILL.format("Alice")), said("Ahoy, Alice!"),
                 asked("<command-message>greet</command-message>\n<command-name>/greet</command-name>\n<command-args>Bob</command-args>\n"),
                 note(self.SKILL.format("Bob")), said("Ahoy, Bob!"),
                 asked("<bash-input>echo hi</bash-input>\n"), note("<bash-stdout>hi</bash-stdout><bash-stderr></bash-stderr>"),
                 said("It printed hi."),
                 asked("Count the files with a subagent."),
                 call("a1", "Agent", {"description": "List files", "prompt": "Run ls", "subagent_type": "general-purpose"}),
                 result("a1", "Async agent launched successfully.\nagentId: ab81 (internal ID - do not mention to user.)"),
                 said("It runs in the background."), note(handback), said("There is 1 file."),
                 note("<command-name>/context</command-name>\n            <command-message>context</command-message>\n"
                      "            <command-args></command-args>\n"),
                 note("<local-command-stdout> \x1b[1mContext Usage\x1b[22m\n⛀ ⛁</local-command-stdout>"),
                 note("## Context Usage\n\n**Model:** claude-haiku-5-5\n"),
                 note("<local-command-stdout>Login successful</local-command-stdout>"))
        turns = files.files("g", "c1", cwd="/w")["turns"][2:]
        self.assertEqual([t["text"][:16] for t in turns], ["Greet Alice. Use", "/greet Bob", "! echo hi", "Count the files "])
        self.assertEqual([t["kind"] for t in turns], ["user", "user_command", "user_command", "user"])   # as typed
        alice, bob, bang, count = [words(t["replies"]) for t in turns]
        self.assertEqual((alice, bob), ([{"kind": "text", "text": "Ahoy, Alice!"}], [{"kind": "text", "text": "Ahoy, Bob!"}]))
        instructions = "# Greeting\n\nReply with exactly: \"Ahoy, <name>!\""             # a skill loaded: among the commands
        self.assertEqual([(c["text"], c["output"]) for c in files.files("g", "c1", 2, cwd="/w")["commands"]],
                         [("Load skill greet Alice", instructions)])           # its Skill call
        self.assertEqual([(c["text"], c["output"]) for c in files.files("g", "c1", 3, cwd="/w")["commands"]],
                         [("Load skill greet Bob", instructions)])             # the user's /greet: a call of its own
        self.assertEqual((turns[2]["output"], bang), ("hi", [{"kind": "text", "text": "It printed hi."}]))
        self.assertEqual(count[1], {"kind": "report", "name": "List files", "text": "Ran ls.\n\n- a.py"})
        self.assertEqual(len(count), 3)                                     # /context and /login run: not shown
        self.assertEqual(turns[3]["ran"], ["/context"])                     # only matched with what the page sent

    def test_a_bundled_skill_loaded_bare_shows_with_its_skill_call(self):
        conn = sqlite3.connect(self.db)              # a gatherer whose events carry what the rules read of them
        conn.executescript("ALTER TABLE events ADD COLUMN p_kind; ALTER TABLE events ADD COLUMN p_words; "
                           "ALTER TABLE events ADD COLUMN p_call_id;")
        conn.close()
        self.add(asked("Draw the pipeline."), call("k1", "Skill", {"skill": "artifact-diagramming"}),
                 result("k1", "Launching skill: artifact-diagramming"),
                 note("Draw as the engineer who has to live with the decision.\n\nARGUMENTS: a map"), said("Drawn."))
        conn = sqlite3.connect(self.db)              # as ag's Claude adaptor stores it: a skill's, loaded by k1
        conn.execute("UPDATE events SET p_kind = 'skill', p_call_id = 'k1' WHERE row_id = (SELECT max(row_id) - 1 FROM events)")
        conn.commit()
        conn.close()
        got = files.files("g", "c1", cwd="/w")
        self.assertEqual(got["turns"][-1]["text"], "Draw the pipeline.")         # not a turn of the user's own
        self.assertEqual(words(got["turns"][-1]["replies"]), [{"kind": "text", "text": "Drawn."}])
        self.assertEqual([(c["text"], c["output"]) for c in got["commands"]],
                         [("Load skill artifact-diagramming", "Draw as the engineer who has to live with the decision.")])

    def test_a_turn_counts_its_calls_as_its_commands_list_them(self):
        self.add(asked("Greet Alice, then list the files."),
                 call("k1", "Skill", {"skill": "greet", "args": "Alice"}), result("k1", "Launching skill: greet"),
                 note(self.SKILL.format("Alice")),                          # with its Skill call: one command
                 call("t1", "TodoWrite", {"todos": []}), result("t1", "ok"),  # a to-do list: none
                 call("b1", "Bash", {"command": "ls", "description": "List the files"}), result("b1", "a.py"),
                 said("There is a.py."),
                 asked("<command-message>greet</command-message>\n<command-name>/greet</command-name>\n<command-args>Bob</command-args>\n"),
                 note(self.SKILL.format("Bob")), said("Ahoy, Bob!"))          # the user's /greet: a command of its own
        turns = files.files("g", "c1", cwd="/w")["turns"]
        self.assertEqual([t["calls"] for t in turns[2:]], [2, 1])
        for t in turns:
            self.assertEqual(t["calls"], len(files.files("g", "c1", t["n"], cwd="/w")["commands"]))

    def test_another_session_s_message_shows_among_the_messages_by_its_sender(self):
        peer = ('Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/cc-socks/81007.sock" '
                'from-name="ucbepic-actor-gatherer-6c" from-mode="prompting">\nYour branch predates #108.\n\nMerge main.\n'
                "</cross-session-message>\n\nThis came from another Claude session \u2014 not typed by your user ...")
        self.add(asked("Build the hamster."), said("Building it."), note(peer), said("The other session is right."))
        replies = files.files("g", "c1", cwd="/w")["turns"][-1]["replies"]
        self.assertEqual(words(replies), [{"kind": "text", "text": "Building it."},
                                   {"kind": "peer", "name": "ucbepic-actor-gatherer-6c", "text": "Your branch predates #108.\n\nMerge main."},
                                   {"kind": "text", "text": "The other session is right."}])

    def test_long_messages_are_sent_whole(self):
        long = lambda what: f"{what} " + "word " * 3000 + "the end."      # over 15,000 characters: as long replies run
        midturn = ("The user sent a new message while you were working:\n" + long("Also") + "\n\nThis is how Claude Code "
                   "surfaces messages the user sends mid-turn — within the running turn, often alongside the next tool result, "
                   "rather than as a separate conversation turn. Address the message above as you continue this turn.")
        self.add(asked(long("Read this")), thought(long("Thinking")), call("b8", "Bash", {"command": "ls"}),
                 result("b8", "a.py"), asked(midturn), said(long("Here")))
        turn = files.files("g", "c1", cwd="/w")["turns"][-1]
        got = [turn["text"], *(m["text"] for m in turn["more"]), *turn["replies"][0]["texts"], turn["replies"][1]["text"]]
        self.assertEqual([len(t) for t in got], [len(long(w)) for w in ("Read this", "Also", "Thinking", "Here")])
        self.assertEqual(got, [long(w) for w in ("Read this", "Also", "Thinking", "Here")])

    def test_files_claude_code_gives_the_agent_are_read_in_the_turn(self):
        start = ("<system-reminder>\nCodebase and user instructions are shown below.\n\nContents of /w/CLAUDE.md (project instructions, "
                 "checked into the codebase):\n\n# Project\n\nBe brief.\n\nContents of /h/.claude/projects/-w/memory/MEMORY.md (user's "
                 "auto-memory, persists across conversations):\n\n- [Color](color.md) — teal\n</system-reminder>")
        mention = ('Called the Read tool with the following input: {"file_path":"/w/facts.txt"}\nResult of calling the Read tool:\n'
                   "1\tThe number is 42.\n2\t\n\n# Environment\nYou have been invoked in the following environment: ...")
        self.add(note(start), note(mention, "system"), asked("@facts.txt What is the number?"), said("42."),
                 asked("Read sub/notes.txt"), call("n1", "Read", {"file_path": "/w/sub/notes.txt"}), result("n1", "1\tThursday."),
                 note("<system-reminder>\nContents of /w/sub/CLAUDE.md:\n\n# Notes\n\nQuote them.\n</system-reminder>"), said("Thursday."))
        got = files.files("g", "c1", 2, cwd="/w")                           # the message they came with
        by = {f["path"]: f for f in got["files"]}
        self.assertEqual(list(by), ["/w/CLAUDE.md", "/h/.claude/projects/-w/memory/MEMORY.md", "/w/facts.txt"])
        self.assertEqual(by["/w/facts.txt"]["sources"][0]["blocks"], [{"t": "lines", "start": 1, "lines": ["The number is 42.", ""], "cut": 0}])
        self.assertEqual((by["/w/CLAUDE.md"]["kinds"], by["/w/CLAUDE.md"]["sources"][0]["call"]), (["read"], None))
        self.assertEqual(by["/w/CLAUDE.md"]["sources"][0]["blocks"][0]["lines"], ["# Project", "", "Be brief."])
        self.assertEqual(got["commands"], [])                               # none of the agent's calls
        got = files.files("g", "c1", 3, cwd="/w")
        self.assertEqual([(f["path"], f["sources"][-1]["via"]) for f in got["files"]],
                         [("/w/sub/notes.txt", "Read"), ("/w/sub/CLAUDE.md", "loaded into the context by Claude Code")])

    def test_a_call_s_line_names_mcp_tools_and_memory_files_as_read(self):
        self.add(asked("add them"), call("t1", "ToolSearch", {"query": "select:mcp__calc__add", "max_results": 1}),
                 ("tool_output", {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1",
                                                               "content": [{"type": "tool_reference", "tool_name": "mcp__calc__add"}]}]}),
                 call("m1", "mcp__calc__add", {"a": 2, "b": 3}), result("m1", "5"),
                 call("w1", "Write", {"file_path": os.path.expanduser("~/.claude/projects/-w/memory/food.md"), "content": "ramen"}),
                 result("w1", "ok"), call("r1", "Read", {"file_path": os.path.expanduser("~/notes/todo.md")}), result("r1", "1\tx"))
        cmds = files.files("g", "c1", 2, cwd="/w")["commands"]
        self.assertEqual([(c["text"], c["output"]) for c in cmds], [("Load calc · add", "Loaded mcp__calc__add"), ("calc · add", "5"),
                                                                    ("Write memory/food.md", "ok"), ("Read ~/notes/todo.md", "1\tx")])


if __name__ == "__main__":
    unittest.main()
