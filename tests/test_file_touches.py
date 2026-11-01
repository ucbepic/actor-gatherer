"""What a session's tool calls did to files, found on disk as they run (ag/integrations/tools/
file_touches/): the command parser's reading of a call, the checks against the disk, the watcher
(on the system the tests run on: FSEvents on macOS, inotify on Linux), the store, and the whole of
it through the Claude Code and codex hooks, on real files in a folder of the test's own."""
import asyncio
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag.integrations.tools.ag_orchestrator.file_touches import Files, check as ck, watch  # noqa: E402
from ag.integrations.tools.ag_orchestrator.file_touches.calls import calls_in, last_results, results_in  # noqa: E402
from ag.integrations.tools.ag_orchestrator.file_touches.calls import opened  # noqa: E402
import harness_kit  # noqa: E402
from harness_kit.claude import tool_call  # noqa: E402
from harness_kit.shell import (  # noqa: E402
    opened_script, script_calls, script_output, script_prints_result, shell_changes, shell_reads)

# As codex 0.164 wrote it live: its code-mode script (`exec`), and what the call gave back
SCRIPT = ("const r = await tools.exec_command({cmd:\"printf 'one\\\\n' > notes.txt && printf 'two\\\\n' > notes.txt "
          "&& cat notes.txt\",max_output_tokens:1000});\ntext(r.output);\n")
SCRIPT_OUT = [{"type": "input_text", "text": "Script completed\nWall time 0.1 seconds\nOutput:\n"}, {"type": "input_text", "text": "two\n"}]


class CommandsTest(unittest.TestCase):
    """A call read from its words and output alone: what was found wrong in real sessions."""

    def test_a_line_of_another_command_s_output_is_not_a_search_match(self):
        found, _ = shell_reads("grep -n foo a.py; date", "3:foo\nSat Oct 24 18:12:34 2026", "/r")
        self.assertEqual(found, [("/r/a.py", "hit", 3, "foo")])
        found, _ = shell_reads("grep -n x src/*.py | head -5; ps -o lstart", "src/a.py:3:x\n78938 Sat Oct 24 18:12:34", "/r")
        self.assertEqual(found, [("/r/src/a.py", "hit", 3, "x")])       # a path the pattern matches, only
        self.assertEqual(shell_reads("grep -rn x src --include=*.py", "(eval):1: no matches found", "/r")[0], [])
        self.assertEqual(shell_reads("grep -n x a.py; sqlite3 db 'select 1'", "1|user_message|2026-10-24T21:43:20", "/r")[0], [])

    def test_searches_of_one_file_each_cannot_be_told_apart(self):
        found, _ = shell_reads("grep -n foo a.py; grep -n bar b.py", "3:foo\n12:bar", "/r")
        self.assertEqual(found, [("/r/a.py", "maybe", 3, "foo"), ("/r/b.py", "maybe", 3, "foo"),
                                 ("/r/a.py", "maybe", 12, "bar"), ("/r/b.py", "maybe", 12, "bar")])

    def test_a_search_s_paths_are_from_where_it_ran(self):
        found, _ = shell_reads("cd sub && grep -n foo a.py b.py", "a.py:3:foo\nb.py:9:foo", "/r")
        self.assertEqual(found, [("/r/sub/a.py", "hit", 3, "foo"), ("/r/sub/b.py", "hit", 9, "foo")])

    def test_a_path_with_a_variable_the_command_does_not_set_is_not_known(self):
        self.assertEqual(shell_reads("cat $T/../log.txt", "hello", "/r")[0], [])          # not /r/log.txt
        self.assertEqual(shell_reads("S=/tmp/x; cat $S/../log.txt", "hello", "/r")[0], [("/tmp/log.txt", "lines", 1, ["hello"])])
        self.assertEqual(shell_changes("echo 1 > $Q/../x; S=/s; echo 2 > $S/y", "/r")[0], [("/s/y", "write", "2")])
        self.assertEqual(shell_changes("cd $D && echo 1 > x", "/r")[0], [])               # in a directory not known

    def test_bsd_sed_s_empty_backup_suffix_is_not_its_script(self):
        self.assertEqual(shell_changes("sed -i '' 's/a/b/' conf.toml", "/r")[0], [("/r/conf.toml", "changed", "sed -i s/a/b/")])


def write(path, text):
    with open(path, "w") as fh:
        fh.write(text)


def sh(command, cwd):
    return subprocess.run(["/bin/sh", "-c", command], cwd=cwd, capture_output=True, text=True).stdout


class CheckTest(unittest.TestCase):
    """An answer's calls checked against real files."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.d = os.path.realpath(self.tmp.name)
        write(self.p("a.py"), "x = 1\nfoo()\ny = 2\n")
        write(self.p("b.py"), "bar()\nz = 3\n")

    def p(self, name):
        return os.path.join(self.d, name)

    def run_calls(self, *calls, change=None, watched=None):
        """The calls' named files looked at, `change` run (what the calls do), the calls' commands run for
        their output, then checked: {(call id, file name, how): touch}."""
        read = {cid: tool_call({"type": "tool_use", "id": cid, "name": name, "input": inp}) for cid, name, inp in calls}
        was = ck.before(read, self.d)                       # each call as Claude Code's rules read it
        if change:
            change()
        entries = [(cid, read[cid], sh(inp["command"], self.d) if name == "Bash" else inp.get("_out", ""), False)
                   for cid, name, inp in calls]
        got = ck.check(entries, self.d, was, watched or {})
        return {(t["call_id"], os.path.basename(t["path"]) if t.get("path") else None, t.get("how")): t for t in got}

    def test_each_match_is_kept_for_the_file_whose_line_it_is(self):
        got = self.run_calls(("c", "Bash", {"command": "grep -n foo a.py; grep -n bar b.py; date"}))
        self.assertEqual(set(got), {("c", "a.py", "hit"), ("c", "b.py", "hit")})
        self.assertEqual((got["c", "a.py", "hit"]["detail"], got["c", "a.py", "hit"]["checked"]), ({"hits": [[2, "foo()"]]}, True))
        self.assertEqual(got["c", "b.py", "hit"]["detail"], {"hits": [[1, "bar()"]]})

    def test_a_read_is_checked_and_a_tail_found_where_it_is(self):
        got = self.run_calls(("r", "Bash", {"command": "sed -n 1,2p a.py"}), ("t", "Bash", {"command": "tail -n 1 a.py"}),
                             ("n", "Read", {"file_path": self.p("b.py"), "_out": "1\tbar()\n2\tz = 9"}))
        self.assertEqual((got["r", "a.py", "read"]["detail"], got["r", "a.py", "read"]["checked"]),
                         ({"lines": [[1, ["x = 1", "foo()"]]]}, True))
        self.assertEqual(got["t", "a.py", "read"]["detail"], {"lines": [[3, ["y = 2"]]]})   # not "where unknown"
        self.assertIs(got["n", "b.py", "read"]["checked"], False)              # its line 2 is not on disk

    def test_a_path_that_is_no_file_is_left_out(self):
        got = self.run_calls(("c", "Read", {"file_path": self.p("gone.py"), "_out": "1\tx"}))
        self.assertEqual(list(got), [("c", None, None)])                       # checked, and it touched none

    def test_a_change_goes_to_the_call_that_says_it_makes_it_at_its_lines(self):
        def change():
            write(self.p("b.py"), "bar()\nz = 4\n")
            write(self.p("new.txt"), "hi\n")
            os.remove(self.p("a.py"))
        got = self.run_calls(("r", "Bash", {"command": "cat b.py"}),
                             ("w", "Bash", {"command": "sed -i.bak 's/3/4/' b.py && echo hi > new.txt && rm a.py"}),
                             change=change)
        hunk, = got["w", "b.py", "modified"]["detail"]["hunks"]
        self.assertEqual((hunk["at"], hunk["old"], hunk["new"], hunk["above"]), (2, ["z = 3"], ["z = 4"], [[1, "bar()"]]))
        self.assertEqual(got["w", "new.txt", "created"]["detail"], {"lines": ["hi"]})
        self.assertIn(("w", "a.py", "deleted"), got)
        self.assertNotIn(("r", "b.py", "modified"), got)                     # it only names it
        self.assertIs(got["r", "b.py", "read"]["checked"], True)              # as it was before the change

    def test_a_file_no_call_names_changed_while_they_ran_is_a_command_s_unnamed(self):
        write(self.p("out.txt"), "made\n")
        got = self.run_calls(("s", "Bash", {"command": "make"}), ("e", "Edit", {"file_path": self.p("a.py")}),
                             watched={self.p("out.txt"): "created"})
        self.assertEqual((got["s", "out.txt", "created"]["named"], got["s", "out.txt", "created"]["detail"]),
                         (False, {"lines": ["made"]}))
        self.assertNotIn(("e", "out.txt", "created"), got)                     # an edit changes its own file only

    def test_ag_s_own_writes_in_its_home_are_not_a_call_s_change(self):
        home = os.path.join(self.d, "aghome")
        os.makedirs(home)
        db, notes = os.path.join(home, "context.db"), os.path.join(home, "notes.txt")
        write(db, "rows\n")
        write(notes, "old\n")
        saved = os.environ.get("AG_HOME")
        os.environ["AG_HOME"] = home
        self.addCleanup(lambda: os.environ.pop("AG_HOME") if saved is None else os.environ.__setitem__("AG_HOME", saved))

        def change():                                                          # ag writes its database as the calls run
            write(db, "rows\nmore rows\n")
            write(notes, "new\n")
        got = self.run_calls(("q", "Bash", {"command": f"sqlite3 {db} 'SELECT 1' || true"}),
                             ("w", "Bash", {"command": f"echo new > {notes}"}), change=change, watched={db: "modified"})
        self.assertEqual({k for k in got if k[1] == "context.db"}, set())       # a query names it: not an edit of it
        self.assertIn(("w", "notes.txt", "modified"), got)                     # a command that says it writes there: is

    def test_the_messages_calls_and_results_whichever_harness(self):
        claude = [{"role": "user", "content": "go"},
                  {"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "ls"}}]},
                  {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": [{"type": "text", "text": "a"}]}]}]
        seen = lambda calls: {i: (c.name, c.input, c.view["shape"], c.view.get("command")) for i, c in calls.items()}  # noqa: E731
        self.assertEqual((seen(calls_in(claude)), results_in(claude), last_results(claude)),
                         ({"t1": ("Bash", {"command": "ls"}, "shell", "ls")}, {"t1": ("a", False)}, ["t1"]))
        codex = [{"type": "function_call", "call_id": "c1", "name": "exec_command", "arguments": '{"cmd": "ls"}'},
                 {"type": "function_call_output", "call_id": "c1", "output": "a"}]
        self.assertEqual((seen(calls_in(codex)), results_in(codex), last_results(codex)),     # its harness's, unnamed
                         ({"c1": ("exec_command", {"cmd": "ls"}, "shell", "ls")}, {"c1": ("a", False)}, ["c1"]))
        ran = [{"type": "function_call", "call_id": "c1", "name": "exec_command", "arguments": '{"cmd": "ls"}'},
               {"type": "function_call_output", "call_id": "c1",
                "output": "Chunk ID: 1\nWall time: 0.1 seconds\nProcess exited with code 0\nOutput:\nx\n"}]
        self.assertEqual(results_in(ran), {"c1": ("x\n", False)})               # as the command printed it
        said = [{"role": "assistant", "content": [{"type": "tool_use", "id": "t", "name": "Bash", "input": {"command": "ls"}}]},
                {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t", "content": "x\nShell cwd was reset to /r"}]}]
        self.assertEqual(results_in(said, harness_kit.get("claude")), {"t": ("x", False)})


def until(test, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        got = test()
        if got:
            return got
        time.sleep(0.02)
    return test()


class WatchTest(unittest.TestCase):
    """The watcher on the system the tests run on."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.d = os.path.realpath(self.tmp.name)
        os.makedirs(os.path.join(self.d, ".git"))
        os.makedirs(os.path.join(self.d, "src"))
        self.w = watch.Watcher()
        self.addCleanup(self.w.close)
        self.w.watch(self.d)
        if self.w._backend() is None:
            self.skipTest("no watcher on this system")
        self.assertEqual(until(lambda: self.w.status.get(self.d) == "watched" and self.w.status[self.d]), "watched")
        time.sleep(0.2)

    def test_what_changed_and_how_it_came_out(self):
        t0 = time.time()
        write(os.path.join(self.d, "src", "new.py"), "x\n")
        write(os.path.join(self.d, ".git", "index"), "x")                       # under a hidden directory: left out
        write(os.path.join(self.d, "tmp.txt"), "x")
        os.remove(os.path.join(self.d, "tmp.txt"))                                # made and gone: left out
        os.makedirs(os.path.join(self.d, "made", "deep"))                        # a directory made while watched
        write(os.path.join(self.d, "made", "deep", "f.txt"), "x")
        new, deep = os.path.join(self.d, "src", "new.py"), os.path.join(self.d, "made", "deep", "f.txt")
        got = until(lambda: (lambda b: b if new in b and deep in b else None)(self.w.between(t0, time.time())))
        self.assertEqual(got, {new: "created", deep: "created"})
        time.sleep(0.1)
        t1 = time.time()
        with open(new, "a") as fh:
            fh.write("y\n")
        os.rename(os.path.join(self.d, "made", "deep", "f.txt"), os.path.join(self.d, "src", "g.txt"))
        g = os.path.join(self.d, "src", "g.txt")
        got = until(lambda: (lambda b: b if len(b) == 2 else None)(self.w.between(t1, time.time())))
        self.assertEqual(got.get(new), "modified")                  # though FSEvents may say created
        self.assertIn(got.get(g), ("created", "modified"))          # moved in: by inotify created; by its birth not
        self.assertNotIn(deep, got)                                 # gone: not reported (see `between`)

    def test_a_change_reported_late_from_before_the_window_is_not_in_it(self):
        old = os.path.join(self.d, "old.txt")
        write(old, "x")
        time.sleep(0.2)
        t0 = time.time()
        self.w.report(old, "created")                               # as FSEvents may: late
        self.assertEqual(self.w.between(t0, time.time()), {})

    @unittest.skipUnless(sys.platform.startswith("linux"), "inotify's walk: Linux")
    def test_a_tree_too_big_is_not_watched(self):
        saved, watch.MAX_DIRS = watch.MAX_DIRS, 3
        self.addCleanup(setattr, watch, "MAX_DIRS", saved)
        big = os.path.join(self.d, "src")
        for i in range(5):
            os.makedirs(os.path.join(big, f"d{i}"))
        w = watch.Watcher()
        self.addCleanup(w.close)
        w.watch(big)
        self.assertTrue(until(lambda: w.status[os.path.realpath(big)].startswith("too big")))


class Server:
    """The context manager's server, as the hooks see it: answers what it is asked, recording it."""

    def __init__(self):
        self.asked = []

    async def request(self, op, body=None, timeout=None):
        touched = [e for e in (body or {}).get("events") or [] if e.get("type") == "file_touched"] if op == "insert" else []
        if touched:                                    # what the hook records of each call, as the touches it found
            assert body.get("lane") == "records" and all(e["properties"]["call_id"] == e["payload"]["call"] for e in touched)
            self.asked.append(("touches", {"session": body["properties"]["channel"], "touches": [
                {"call_id": e["payload"]["call"], **{k: e["payload"][k] for k in ("path", "how", "checked", "named", "detail")}}
                for e in touched]}))
            return {"rows": [1] * len(touched)}
        if op == "insert":                             # the hook's other records (its model calls): not what is checked here
            return {"rows": [None] * len(body["events"])}
        self.asked.append((op, body))
        if op == "rewrite":
            return {"context": body["events"], "note": "ok", "read_id": len(self.asked), "basis": None}
        return {}

    async def stop(self):
        pass


class HookTest(unittest.TestCase):
    """Two calls of a session through each hook: the answer's calls run between them, on real files."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.d = os.path.realpath(self.tmp.name)
        write(os.path.join(self.d, "a.py"), "x = 1\nfoo()\n")
        write(os.path.join(self.d, "b.py"), "z = 3\n")
        script = "p = 'b.py'; s = open(p).read(); open(p, 'w').write(s.replace('z = 3', 'z = 4'))"
        self.commands = ["grep -n foo a.py; date", f"{sys.executable} -c \"{script}\""]

    def session(self, hook, first, answer, second):
        """`first` through the hook, `answer` back, its commands run, then `second` (with their results)."""
        from ag.integrations.tools.ag_connection.ag_client import AgClient  # noqa: F401 - the hooks' own import
        from ag.integrations.tools.hook_server.trace import response_of

        def req(body, headers):
            return SimpleNamespace(method="POST", path=body.pop("_path"), label="g", limit=None, state={}, upstream=None,
                                   headers=headers, body=body)

        async def go():
            r1 = req(first, self.headers)
            await hook(r1)
            await asyncio.sleep(0.1)                     # the model, before its answer begins to come back
            r1.answer_started = time.time()
            got = response_of(answer)
            await hook.before_end(r1, 200, got)
            await hook.answered(r1, 200, got)
            outputs = [sh(c, self.d) for c in self.commands]
            await hook(req(second(outputs), self.headers))
            await hook.close()
        asyncio.run(go())

    def touches(self, server):
        sent = [b for op, b in server.asked if op == "touches"]
        self.assertEqual(len(sent), 1)
        return {(t["call_id"], os.path.basename(t["path"]), t["how"]): t for t in sent[0]["touches"]}

    def test_claude_code(self):
        from ag.integrations.harnesses.claude.ag_orchestrator import context_manager as claude_ag
        from ag.integrations.harnesses.codex.ag_orchestrator.ag_clients import AgClients
        server = Server()
        hook = claude_ag.ClaudeContextManager(ag_clients=AgClients(lambda g: server), log=lambda g, l: None, count="off")
        self.headers = {"X-Claude-Code-Session-Id": "s"}
        ask = {"role": "user", "content": [{"type": "text", "text": f"Primary working directory: {self.d}"},
                                           {"type": "text", "text": "fix it"}]}
        uses = [{"type": "tool_use", "id": f"t{i}", "name": "Bash", "input": {"command": c}} for i, c in enumerate(self.commands)]
        events = [{"type": "message_start", "message": {"id": "m1", "role": "assistant", "content": [], "usage": {}}}]
        for i, u in enumerate(uses):
            events += [{"type": "content_block_start", "index": i, "content_block": dict(u, input={})},
                       {"type": "content_block_delta", "index": i, "delta": {"type": "input_json_delta",
                                                                              "partial_json": json.dumps(u["input"])}},
                       {"type": "content_block_stop", "index": i}]
        events += [{"type": "message_delta", "delta": {"stop_reason": "tool_use"}}, {"type": "message_stop"}]
        answer = "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events).encode()
        body = lambda messages: {"_path": "/v1/messages", "model": "m", "tools": [{"name": "Bash"}], "messages": messages}  # noqa: E731
        self.session(hook, body([ask]), answer, lambda outs: body([ask, {"role": "assistant", "content": uses}, {
            "role": "user", "content": [{"type": "tool_result", "tool_use_id": u["id"], "content": o}
                                        for u, o in zip(uses, outs)]}]))
        got = self.touches(server)
        self.assertEqual(set(got), {("t0", "a.py", "hit"), ("t1", "b.py", "modified")})
        self.assertEqual(got["t0", "a.py", "hit"]["detail"], {"hits": [[2, "foo()"]]})
        self.assertEqual(got["t1", "b.py", "modified"]["detail"]["hunks"][0]["new"], ["z = 4"])

    def test_codex(self):
        from ag.integrations.harnesses.codex.ag_orchestrator import context_manager as codex_ag
        from ag.integrations.harnesses.codex.ag_orchestrator.ag_clients import AgClients
        server = Server()
        hook = codex_ag.CodexContextManager(ag_clients=AgClients(lambda g: server), log=lambda g, l: None)
        self.headers = {"session-id": "th"}
        ask = {"type": "message", "role": "user", "content": [{"type": "input_text", "text": f"<environment_context><cwd>{self.d}</cwd></environment_context>"}]}
        fcs = [{"type": "function_call", "call_id": f"c{i}", "name": "exec_command", "arguments": json.dumps({"cmd": c})}
               for i, c in enumerate(self.commands)]
        events = [{"type": "response.output_item.done", "item": f} for f in fcs] + \
                 [{"type": "response.completed", "response": {"id": "r1", "status": "completed", "output": fcs}}]
        answer = "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events).encode()
        body = lambda items: {"_path": "/v1/responses", "model": "m", "input": items}  # noqa: E731
        self.session(hook, body([ask]), answer, lambda outs: body([ask] + fcs + [
            {"type": "function_call_output", "call_id": f["call_id"], "output": f"Wall time: 0.1 seconds\nOutput:\n{o}"}
            for f, o in zip(fcs, outs)]))
        got = self.touches(server)
        self.assertEqual(set(got), {("c0", "a.py", "hit"), ("c1", "b.py", "modified")})

    def test_off(self):
        from ag.integrations.harnesses.claude.ag_orchestrator import context_manager as claude_ag
        from ag.integrations.harnesses.codex.ag_orchestrator.ag_clients import AgClients
        hook = claude_ag.ClaudeContextManager(ag_clients=AgClients(lambda g: Server()), log=lambda g, l: None, files="off")
        self.assertIsNone(hook.files)
        with self.assertRaises(ValueError):
            claude_ag.ClaudeContextManager(ag_clients=AgClients(lambda g: Server()), files="maybe")


class CodeModeTest(unittest.TestCase):
    """Codex's code mode: one `exec` call whose JavaScript script makes the calls that touch files."""

    def test_the_calls_a_script_makes_and_what_it_writes_out(self):
        self.assertEqual(script_calls(SCRIPT), [("exec_command", {"cmd": "printf 'one\\n' > notes.txt && printf 'two\\n' > "
                                                                       "notes.txt && cat notes.txt", "max_output_tokens": 1000})])
        patch = '// @exec: {"yield_time_ms": 10000}\nawait tools.apply_patch(`*** Begin Patch\n*** Add File: a.txt\n+hi \\`x\\`\n*** End Patch`);'
        self.assertEqual(script_calls(patch), [("apply_patch", "*** Begin Patch\n*** Add File: a.txt\n+hi `x`\n*** End Patch")])
        many = ('for (const f of ["a", "b"]) { const r = await tools.exec_command({cmd: "cat " + f}); text(r.output); }\n'
                "await tools.exec_command({ 'cmd': 'sed -n 1,5p x.py', workdir: '/w', tty: false, n: 1.5e3, list: [1, 'a'] });")
        self.assertEqual(script_calls(many), [("exec_command", None), ("exec_command", {"cmd": "sed -n 1,5p x.py", "workdir": "/w",
                                                                                       "tty": False, "n": 1500.0, "list": [1, "a"]})])
        tricky = ('const cmd = "ls"; await tools.exec_command({cmd}); mytools.exec_command({cmd: "no"});\n'
                  '// tools.exec_command({cmd: "a comment"})\nconst s = "tools.exec_command({cmd: 1})"; await tools.exec_command(`ls ${d}`);'
                  'await tools.exec_command("echo \\u00e9\\uD83D\\uDE00");')
        self.assertEqual(script_calls(tricky), [("exec_command", None), ("exec_command", None), ("exec_command", "echo \u00e9\U0001F600")])
        self.assertEqual(script_calls("text(1)"), [])

    def test_a_lone_call_whose_output_is_all_the_script_printed_has_it_as_its_own(self):
        self.assertTrue(script_prints_result(SCRIPT))
        self.assertTrue(script_prints_result('text((await tools.exec_command({cmd: "ls"})).output)'))
        self.assertFalse(script_prints_result('const r = await tools.exec_command({cmd: "ls"}); text("files:"); text(r.output)'))
        self.assertFalse(script_prints_result('const r = await tools.exec_command({cmd: "ls"}); text(r.output.trim())'))
        self.assertEqual(script_output("Script completed\nWall time 0.1 seconds\nOutput:\n\ntwo\n"), ("two\n", "completed"))
        self.assertEqual(script_output("Script failed\nWall time 0.1 seconds\nOutput:\n\nError: x")[1], "failed")
        self.assertEqual(script_output("plain"), ("plain", None))
        done = ("Script completed\nWall time 0.1 seconds\nOutput:\ntwo\n", False)
        (cid, name, inp, got), = opened_script("c1", SCRIPT, done)
        self.assertEqual((cid, name, inp["cmd"].split(" > ")[0], got), ("c1", "exec_command", "printf 'one\\n'", ("two\n", False)))
        two = opened_script("c2", 'await tools.exec_command({cmd: "ls"});\nawait tools.exec_command({cmd: "pwd"});', done)
        self.assertEqual([(i, r) for i, _, _, r in two], [("c2#1", ("", False)), ("c2#2", ("", False))])   # whose output: not known
        failed = opened_script("c3", SCRIPT, ("Script failed\nWall time 0.1 seconds\nOutput:\n\nError: x", False))
        self.assertEqual(failed[0][3], ("", True))
        self.assertEqual(opened_script("c4", SCRIPT), [("c4", "exec_command", script_calls(SCRIPT)[0][1], None)])
        self.assertEqual(opened_script("c5", "text(1)", done), [])

    def test_a_script_in_a_turn_is_its_calls(self):
        items = [{"type": "custom_tool_call", "call_id": "c1", "name": "exec", "input": SCRIPT},
                 {"type": "custom_tool_call_output", "call_id": "c1", "output": SCRIPT_OUT},
                 {"type": "function_call", "call_id": "f1", "name": "exec_command", "arguments": json.dumps({"cmd": "ls"})},
                 {"type": "function_call_output", "call_id": "f1", "output": "a"}]
        calls, results = opened(calls_in(items), results_in(items), harness_kit.get("codex"))
        self.assertEqual({k: (v.name, v.view["shape"]) for k, v in calls.items()},
                         {"c1": ("exec_command", "shell"), "f1": ("exec_command", "shell")})
        self.assertEqual(results["c1"], ("two\n", False))                    # the output under codex's head
        self.assertEqual(results["f1"], ("a", False))

    def test_a_file_a_script_creates_and_changes_is_found_on_disk(self):
        server = Server()
        files = Files(SimpleNamespace(client=lambda g: server), log=lambda g, l: None, watcher=None)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        d = os.path.realpath(tmp.name)
        call = {"type": "custom_tool_call", "call_id": "c1", "name": "exec", "input": SCRIPT}

        async def go():
            files.started("g", "s", d, [call])
            sh("printf 'one\\n' > notes.txt && printf 'two\\n' > notes.txt && cat notes.txt", d)
            files.arrived("g", "s", d, [call, {"type": "custom_tool_call_output", "call_id": "c1", "output": SCRIPT_OUT}])
            await files.close()
        asyncio.run(go())
        (op, body), = server.asked
        got = {(t["call_id"], os.path.basename(t["path"]), t["how"]) for t in body["touches"] if t.get("path")}
        self.assertIn(("c1", "notes.txt", "created"), got)


class FilesTrackerTest(unittest.TestCase):
    def test_a_call_run_as_the_answer_streamed_in_and_another_in_the_same_file(self):
        """As Claude Code did live: its Edit ran before the answer ended (before the look at its file),
        then a sed in the same answer changed another line of the file."""
        server = Server()
        files = Files(SimpleNamespace(client=lambda g: server), log=lambda g, l: None, watcher=None)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        d = os.path.realpath(tmp.name)
        f = os.path.join(d, "shapes.py")
        write(f, "def area(w, h):\n    return w * h\n\n\ndef perimeter(w, h):\n    return 2 * (w + h)\n")
        files.seen[f] = ["def area(w, h):", "    return w * h", "", "", "def perimeter(w, h):", "    return 2 * (w + h)"]
        edit = {"type": "tool_use", "id": "e", "name": "Edit", "input": {"file_path": f, "old_string": "return w * h",
                                                                           "new_string": "return h * w"}}
        sed = {"type": "tool_use", "id": "s", "name": "Bash", "input": {"command": "sed -i.bak 's/2 \\* (w + h)/(w + h) * 2/' shapes.py"}}

        async def go():
            began = time.time() - 0.5
            time.sleep(0.05)
            with open(f) as fh:
                text = fh.read()
            write(f, text.replace("return w * h", "return h * w"))                 # the Edit, as the answer streams in
            files.started("g", "c", d, [{"role": "assistant", "content": [edit, sed]}],   # the answer's end, as the
                          since=began)                                                 # hook gives it: looked at
            sh("sed -i.bak 's/2 \\* (w + h)/(w + h) * 2/' shapes.py", d)          # Claude Code runs the sed
            files.arrived("g", "c", d, [{"role": "assistant", "content": [edit, sed]}, {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "e", "content": "ok"}, {"type": "tool_result", "tool_use_id": "s", "content": ""}]}])
            await files.close()
        asyncio.run(go())
        (op, body), = server.asked
        got = {(t["call_id"], os.path.basename(t["path"])): t["detail"] for t in body["touches"] if t.get("path")}
        self.assertEqual([(h["at"], h["new"]) for h in got["e", "shapes.py"]["hunks"]], [(2, ["    return h * w"])])
        self.assertEqual([(h["at"], h["new"]) for h in got["s", "shapes.py"]["hunks"]], [(6, ["    return (w + h) * 2"])])

    def test_results_that_come_before_their_answer_s_end_are_checked_against_it(self):
        """As codex did live: it runs a call as soon as the answer streams it, and its next call (the results)
        comes while the hook is still at the answer's end. The results wait for that answer; a file the NEXT
        answer's call creates is that call's, not the one before's (as it was: it took the earlier window)."""

        class Watched:                               # what the watcher reported, each change at its time
            def __init__(self):
                self.changes = []

            def watch(self, cwd):
                pass

            def between(self, t0, t1):
                return {p: how for when, p, how in self.changes if t0 <= when <= t1}

            def close(self):
                pass

        server, seen = Server(), Watched()
        files = Files(SimpleNamespace(client=lambda g: server), log=lambda g, l: None, watcher=seen)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        d = os.path.realpath(tmp.name)
        shell = lambda cid, cmd: {"type": "function_call", "call_id": cid, "name": "exec_command", "arguments": json.dumps({"cmd": cmd})}
        out = lambda cid: {"type": "function_call_output", "call_id": cid, "output": "Process exited with code 0"}
        b, c = shell("b1", "printf 'x' > x.txt"), shell("c1", "printf 'y' > y.txt")

        async def go():
            began = time.time()
            sh("printf 'x' > x.txt", d)                                      # b1, run as answer B streamed it in
            seen.changes.append((began + 0.01, os.path.join(d, "x.txt"), "created"))
            files.arrived("g", "s", d, [b, out("b1")])                       # its results, before B's end
            arrived = time.time()
            seen.changes.append((arrived + 0.5, os.path.join(d, "y.txt"), "created"))   # c1, answer C's, later
            files.started("g", "s", d, [b], since=began)                     # B's end, at last
            await asyncio.sleep(0.6)
            sh("printf 'y' > y.txt", d)
            files.arrived("g", "s", d, [b, out("b1"), c, out("c1")])         # C's results, again before its end
            files.started("g", "s", d, [c], since=arrived + 0.4)
            await files.close()
        asyncio.run(go())
        got = {(t["call_id"], os.path.basename(t["path"]), t["how"]) for _, body in server.asked for t in body["touches"]
               if t.get("path")}
        self.assertIn(("b1", "x.txt", "created"), got)
        self.assertIn(("c1", "y.txt", "created"), got)
        self.assertNotIn("y.txt", {p for cid, p, how in got if cid == "b1"})

    def test_a_call_whose_answer_was_not_seen_end_is_checked_for_what_it_read(self):
        server = Server()
        files = Files(SimpleNamespace(client=lambda g: server), log=lambda g, l: None, watcher=None)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        d = os.path.realpath(tmp.name)
        write(os.path.join(d, "a.py"), "x\n")
        messages = [{"role": "assistant", "content": [{"type": "tool_use", "id": "t", "name": "Read",
                                                       "input": {"file_path": os.path.join(d, "a.py")}}]},
                    {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t", "content": "1\tx"}]}]

        async def go():
            files.arrived("g", "s", d, messages)
            await files.close()
        asyncio.run(go())
        (op, body), = server.asked
        self.assertEqual([(t["how"], t["checked"]) for t in body["touches"]], [("read", True)])


if __name__ == "__main__":
    unittest.main()
