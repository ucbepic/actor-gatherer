"""What an actor at work is doing, for its avatar to act out (ag_dashboard/work.py): each call's kind, from its
tool or the programs its shell command runs, and how a turn's calls ended."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import harness_kit  # noqa: E402
from ag_dashboard import work  # noqa: E402


def shell(command):
    return work.doing(harness_kit.Action.SHELL, {"shape": "shell", "command": command})


def tool(harness, name, inp=None):
    """A call of `harness`'s tool `name`, as its rules read it: its kind."""
    if harness == "claude":
        item = {"role": "assistant", "content": [{"type": "tool_use", "id": "t", "name": name, "input": inp or {}}]}
    elif harness == "codex":
        item = {"type": "function_call", "call_id": "t", "name": name, "arguments": "{}"}
    else:
        item = {"role": "model", "parts": [{"functionCall": {"id": "t", "name": name, "args": inp or {}}}]}
    [p] = harness_kit.get(harness).read_one(item)
    return work.doing(p.tool.action, p.tool.view)


class DoingTest(unittest.TestCase):

    def test_tools(self):
        self.assertEqual([tool("claude", n) for n in ("Read", "Grep", "WebFetch", "Edit", "Agent", "Monitor", "TodoWrite",
                                                      "Artifact", "mcp__x__y")],
                         ["read", "search", "search", "edit", "team", "wait", "edit", "ship", "run"])
        self.assertEqual([tool("codex", n) for n in ("apply_patch", "spawn_agent", "update_plan", "view_image", "web_search")],
                         ["edit", "team", "edit", "read", "search"])
        self.assertEqual([tool("antigravity", n) for n in ("read_file", "edit_file", "invoke_subagent", "search_web")],
                         ["read", "edit", "team", "search"])
        self.assertEqual(tool("antigravity", "run_command", {"CommandLine": "npm test"}), "test")   # its shell, read so
        self.assertEqual(work.doing(None, None), "run")                     # no rules read it (pi's, opencode's)

    def test_shell_commands_by_what_they_run(self):
        self.assertEqual(shell("cd /r && sed -n 1,80p a.py && git log --oneline -3"), "read")
        self.assertEqual(shell("git -C /r --no-pager diff --stat"), "read")
        self.assertEqual(shell("grep -rn x src | head -3"), "search")
        self.assertEqual(shell("sed -i '' 's/a/b/' a.py && git diff"), "edit")
        self.assertEqual(shell("cat > notes.md <<'EOF'\n# notes\nEOF"), "edit")
        self.assertEqual(shell("python3 - <<'EOF'\np = 'a.py'\ns = open(p).read().replace('a', 'b')\nopen(p, 'w').write(s)\nEOF"),
                         "edit")                                            # a script that only writes a file
        self.assertEqual(shell("cd tests && PYTHONPATH=.. python -m unittest test_x 2>&1 | tail -3"), "test")
        self.assertEqual(shell("npm test"), "test")
        self.assertEqual(shell("git add -A && git commit -qm x && git push -u origin b"), "ship")
        self.assertEqual(shell("gh pr create --fill"), "ship")
        self.assertEqual(shell("gh pr view 5"), "read")
        self.assertEqual(shell("sleep 20; gh pr checks 75"), "wait")
        self.assertEqual(shell("S=/tmp/x; node $S/driver.mjs 9222 steps.json"), "run")
        self.assertEqual(shell("export A=1; # a note\ncd /r"), "run")      # nothing of its own: nothing tells

    def test_how_a_call_went(self):
        self.assertTrue(work.ok("test", False, "Ran 3 tests in 0.1s\n\nOK"))
        self.assertFalse(work.ok("test", False, "Ran 3 tests\n\nFAILED (failures=1)"))
        self.assertFalse(work.ok("test", False, "=== 2 failed, 9 passed in 1.2s ==="))
        self.assertTrue(work.ok("read", False, "FAILED (this is only text)"))   # only a test run's words count
        self.assertFalse(work.ok("read", True, ""))


class SummaryTest(unittest.TestCase):

    def test_the_newest_running_the_newest_ended_and_the_failures_in_a_row(self):
        calls = [{"id": "a", "kind": "edit", "ended": 1, "ok": True}, {"id": "b", "kind": "test", "ended": 3, "ok": False},
                 {"id": "c", "kind": "team", "ended": None, "ok": True}, {"id": "d", "kind": "read", "ended": 4, "ok": False},
                 {"id": "e", "kind": "team", "ended": None, "ok": True}]
        self.assertEqual(work.summary(calls), {"doing": "team", "last": "team", "helpers": 2,
                                               "ended": {"id": "d", "kind": "read", "ok": False, "at": 4}, "failed": 2})
        self.assertEqual(work.summary([]), {"doing": None, "last": None, "helpers": 0, "ended": None, "failed": 0})


if __name__ == "__main__":
    unittest.main()
