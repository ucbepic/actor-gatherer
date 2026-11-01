"""harness_kit: each harness's rules, apart from ag -- what its calls are, what each piece of its conversation is,
what its tools do."""
import ast
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import harness_kit  # noqa: E402
from harness_kit import Action, CallKind, Kind  # noqa: E402
from harness_kit.claude import RETRY_NOTES  # noqa: E402

CLAUDE, CODEX = harness_kit.get("claude"), harness_kit.get("codex")


def user(text):
    return {"role": "user", "content": [{"type": "text", "text": text}]}


def said(text):
    return {"role": "assistant", "content": [{"type": "text", "text": text}]}


def item(role, text):
    return {"type": "message", "role": role, "content": [
        {"type": "input_text" if role == "user" else "output_text", "text": text}]}


class SeparateTest(unittest.TestCase):
    def test_it_imports_nothing_but_the_standard_library_and_itself(self):
        root = os.path.dirname(harness_kit.__file__)
        for name in os.listdir(root):
            if not name.endswith(".py"):
                continue
            with open(os.path.join(root, name)) as fh:
                tree = ast.parse(fh.read())
            for node in ast.walk(tree):
                mods = [a.name for a in node.names] if isinstance(node, ast.Import) else \
                    [node.module or ""] if isinstance(node, ast.ImportFrom) and not node.level else []
                for m in mods:
                    self.assertNotIn(m.split(".")[0], ("ag", "ag_dashboard"), f"{name} imports {m}")
                    self.assertIn(m.split(".")[0], sys.stdlib_module_names, f"{name} imports {m}")


class ClaudeCodeTest(unittest.TestCase):
    def kinds(self, *messages):
        return [(p.kind, p.words) for p in CLAUDE.read(CLAUDE.items(list(messages)))]

    def test_the_user_s_words_as_they_typed_them(self):
        wrapped = ("The user sent a new message while you were working:\nalso b\n\nThis is how Claude Code surfaces "
                   "messages the user sends mid-turn — within the running turn.")
        self.assertEqual(self.kinds(user("hi"), user("<bash-input>ls -la</bash-input>"), user(wrapped),
                                    user('a <pasted_content id="5">long</pasted_content id="5"> b')),
                         [(Kind.USER, "hi"), (Kind.USER_COMMAND, "! ls -la"), (Kind.MID_TURN, "also b"),
                          (Kind.USER, "a\n\nlong\n\nb")])

    def test_a_typed_command_is_the_user_s_and_its_prompt_claude_code_s(self):
        typed = user("<command-message>greet</command-message>\n<command-name>/greet</command-name>\n"
                     "<command-args>Bob</command-args>")
        self.assertEqual(self.kinds(typed, user("Say hi to Bob."), said("Hi Bob")),
                         [(Kind.USER_COMMAND, "/greet Bob"), (Kind.COMMAND_PROMPT, None), (Kind.AGENT, None)])

    def test_its_own_notes_each_of_its_kind(self):
        notes = {"<system-reminder>x</system-reminder>": Kind.ENVIRONMENT,
                 "[Request interrupted by user]": Kind.INTERRUPT,
                 "Base directory for this skill: /s/greet\n\nSay hi.": Kind.SKILL,
                 "<bash-stdout>a\n</bash-stdout><bash-stderr></bash-stderr>": Kind.COMMAND_OUTPUT,
                 "<command-name>/context</command-name>\n<command-message>context</command-message>": Kind.LOCAL_COMMAND,
                 "[Image: original 1400x2400, displayed at 1167x2000.]": Kind.ATTACHMENT_NOTE,
                 "Stop hook feedback:\nnot yet": Kind.HOOK_FEEDBACK,
                 "Tool loaded.": Kind.TOOL_NOTICE, RETRY_NOTES[0]: Kind.RETRY_NOTE}
        for text, kind in notes.items():
            self.assertEqual(self.kinds(user(text)), [(kind, None)], text)
        report = user('Another Claude session sent a message:\n<agent-message from="a1b2">\n[Subagent hand-back] The '
                      'report follows:\n  Done.\n</agent-message>')
        peer = user('Another Claude session sent a message:\n<cross-session-message from="uds:/s" from-name="other">\n'
                    'hello\n</cross-session-message>')
        got = CLAUDE.read(CLAUDE.items([report, peer]))
        self.assertEqual([(p.kind, p.detail.get("from") or p.detail.get("name"), p.detail["text"]) for p in got],
                         [(Kind.AGENT_REPORT, "a1b2", "Done."), (Kind.PEER_MESSAGE, "other", "hello")])
        skill, = CLAUDE.read(CLAUDE.items([user("Base directory for this skill: /s/greet\n\nSay hi.\n\nARGUMENTS: Bob")]))
        self.assertEqual((skill.detail["name"], skill.detail["args"], skill.detail["instructions"]), ("greet", "Bob", "Say hi."))
        system, = CLAUDE.read(CLAUDE.items([{"role": "system", "content": "<task-notification><task-id>t1</task-id>"
                                                                          "<status>completed</status></task-notification>"}]))
        self.assertEqual((system.kind, system.detail["notices"][0]["id"], system.detail["notices"][0]["ended"]),
                         (Kind.TASK_NOTICE, "t1", True))

    # as Claude Code 2.1.314 sends them: the Skill tool's results, then each skill's instructions after them all, bare
    # for a bundled skill with no files of its own (artifact-diagramming), opened by the base directory for one on disk
    @staticmethod
    def skills(*loads):
        return {"role": "assistant", "content": [
            {"type": "tool_use", "id": f"t{i}", "name": "Skill", "input": {"skill": name}} for i, name in enumerate(loads)]}

    @staticmethod
    def results(*texts):
        return {"role": "user", "content": [{"type": "tool_result", "tool_use_id": f"t{i}", "content": text}
                                            for i, text in enumerate(texts)]}

    def test_a_skill_the_skill_tool_loads_bare_is_claude_code_s(self):
        message = self.results("Quickstart: 3 types.", "Launching skill: artifact-diagramming")
        message["content"].append({"type": "text", "text": "Draw as the engineer ...\n\n## What to draw\n\nARGUMENTS: a map"})
        got = CLAUDE.read(CLAUDE.items([user("Draw it."), self.skills("Artifact", "artifact-diagramming"), message]))
        self.assertEqual([(p.kind, p.words) for p in got], [(Kind.USER, "Draw it."), (Kind.TOOL_CALL, None),
                                                            (Kind.TOOL_CALL, None), (Kind.TOOL_RESULT, None),
                                                            (Kind.TOOL_RESULT, None), (Kind.SKILL, None)])
        self.assertEqual({k: got[-1].detail[k] for k in ("name", "args", "instructions", "call")},
                         {"name": "artifact-diagramming", "args": "a map",
                          "instructions": "Draw as the engineer ...\n\n## What to draw", "call": "t1"})
        self.assertEqual(harness_kit.claude.note_detail(got[-1].text, Kind.SKILL),       # read again, stored as a skill's
                         {"kind": Kind.SKILL, "name": "", "args": "a map", "instructions": "Draw as the engineer ...\n\n## What to draw"})
        self.assertIsNone(harness_kit.claude.note_detail(got[-1].text))                  # its words alone don't say so

    def test_skills_loaded_together_each_in_the_order_of_their_results(self):
        message = self.results("Launching skill: keybindings-help", "Launching skill: greet", "Launching skill: draw")
        message["content"] += [{"type": "text", "text": "# Keybindings\n\nEdit ~/.claude/keybindings.json."},
                               {"type": "text", "text": "<system-reminder>a note</system-reminder>"},
                               {"type": "text", "text": "Base directory for this skill: /w/.claude/skills/greet\n\nSay hi."},
                               {"type": "text", "text": "(Re-invocation of /draw — the skill instructions were previously "
                                                        "loaded; the arguments or dynamic output below are new.)"},
                               {"type": "text", "text": "Skill /draw is already loaded above; instructions unchanged."}]
        got = CLAUDE.read(CLAUDE.items([self.skills("keybindings-help", "greet", "draw"), message]))[6:]
        self.assertEqual([(p.kind, p.detail.get("name"), p.detail.get("call")) for p in got],
                         [(Kind.SKILL, "keybindings-help", "t0"), (Kind.ENVIRONMENT, None, None),
                          (Kind.SKILL, "greet", "t1"), (Kind.OTHER, None, None), (Kind.SKILL, "draw", "t2")])

    def test_the_user_s_words_after_a_skill_loads_are_theirs(self):
        wrapped = ("The user sent a new message while you were working:\nalso b\n\nThis is how Claude Code surfaces "
                   "messages the user sends mid-turn — within the running turn.")
        for after, kinds in (([user(wrapped)], [(Kind.MID_TURN, "also b")]),          # written while it loaded
                             ([user("[Request interrupted by user]"), user("stop that")],  # stopped, then asked anew
                              [(Kind.INTERRUPT, None), (Kind.USER, "stop that")]),
                             ([user("hi again")], [(Kind.USER, "hi again")])):     # a turn with no answer, joined to the next
            message = self.results("Launching skill: draw")
            message["content"] += [{"type": "text", "text": "Draw it well."}] + [b for m in after for b in m["content"]]
            got = CLAUDE.read(CLAUDE.items([self.skills("draw"), message]))
            self.assertEqual([(p.kind, p.words) for p in got[2:]], [(Kind.SKILL, None)] + kinds)
        got = CLAUDE.read(CLAUDE.items([self.skills("draw"), self.results("Launching skill: draw"), said("Drawn."),
                                        user("Draw it well.")]))             # a message of its own, after the agent's: theirs
        self.assertEqual((got[-1].kind, got[-1].words), (Kind.USER, "Draw it well."))
        message = self.results("error: Unknown skill: draw")                 # no skill loaded: what follows is theirs
        message["content"][0]["is_error"] = True
        message["content"].append({"type": "text", "text": "Draw it well."})
        self.assertEqual(CLAUDE.read(CLAUDE.items([self.skills("draw"), message]))[-1].kind, Kind.USER)

    def test_a_compacted_history_s_summary_and_what_it_sends_again(self):
        summary = user("This session is being continued from a previous conversation that ran out of context. ...")
        got = CLAUDE.read(CLAUDE.items([summary, user("<system-reminder>env</system-reminder>"), user("go on"),
                                        user("<system-reminder>late</system-reminder>"), said("ok")]))
        self.assertEqual([p.kind for p in got], [Kind.COMPACTION_SUMMARY, Kind.COMPACTION_REPEAT, Kind.USER,
                                                 Kind.COMPACTION_REPEAT, Kind.AGENT])
        self.assertTrue(got[0].detail["opens"])

    def test_tool_calls_say_what_they_do_and_results_the_tasks_they_start(self):
        call = {"role": "assistant", "content": [
            {"type": "tool_use", "id": "t1", "name": "Edit", "input": {"file_path": "/a.py", "old_string": "x"}},
            {"type": "tool_use", "id": "t2", "name": "AskUserQuestion", "input": {"questions": [
                {"question": "Which?", "header": "Pick", "options": [{"label": "A"}, {"label": "B"}]}]}},
            {"type": "tool_use", "id": "t3", "name": "ExitPlanMode", "input": {}}]}
        result = {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "t4", "content": "Command running in background with ID: b77. "
                                                                     "Output is being written to: /tmp/b77.output"},
            {"type": "tool_result", "tool_use_id": "t5", "content": "Successfully stopped task: b77"}]}
        edit, ask, plan, started, stopped = CLAUDE.read(CLAUDE.items([call, result]))
        self.assertEqual((edit.tool.action, edit.tool.paths, edit.tool.ask), (Action.EDIT, ["/a.py"], None))
        self.assertEqual((ask.tool.action, ask.tool.ask["kind"], [o["label"] for o in ask.tool.ask["questions"][0]["options"]]),
                         (Action.ASK, "question", ["A", "B"]))
        self.assertEqual(plan.tool.ask, {"kind": "plan", "plan": None})          # the plan is in its file, not the call
        self.assertEqual((started.result.task["kind"], started.result.task["how"], started.result.task["output"]),
                         ("command", "started", "/tmp/b77.output"))
        self.assertEqual((stopped.result.task["id"], stopped.result.task["how"]), ("b77", "stopped"))

    def test_what_each_call_is(self):
        tools = [{"name": "Read"}]
        turn = {"messages": [user("hi")], "tools": tools}
        call = CLAUDE.call("POST", "/v1/messages", {"X-Claude-Code-Session-Id": "s1", "User-Agent": "claude-cli/2.1.310 (x)"}, turn)
        self.assertEqual((call.kind, call.session, call.version), (CallKind.TURN, "s1", "2.1.310"))
        recap = {"messages": [user("hi"), said("ok"), user("The user stepped away and is coming back. Recap.")], "tools": tools}
        call = CLAUDE.call("POST", "/v1/messages", {}, recap)
        self.assertEqual((call.kind, len(call.history), len(call.own)), (CallKind.RECAP, 2, 1))
        compact = {"messages": [user("hi"), said("ok"), user("CRITICAL: Respond with TEXT ONLY. Summarize.")], "tools": tools}
        self.assertEqual(CLAUDE.call("POST", "/v1/messages", {}, compact).kind, CallKind.COMPACTION)
        self.assertEqual(CLAUDE.call("POST", "/v1/messages", {"X-Claude-Code-Agent-Id": "a"}, turn).kind, CallKind.SUBAGENT)
        self.assertEqual(CLAUDE.call("POST", "/v1/messages", {}, {"messages": [user("title?")]}).kind, CallKind.OTHER)
        self.assertIsNone(CLAUDE.call("GET", "/v1/models", {}, None))


class CodexTest(unittest.TestCase):
    def test_its_own_context_its_replies_and_its_agents_messages(self):
        reply = item("user", '<send_user_message_question_reply>\n[{"answer":"mango","question":"Which fruit?",'
                             '"questionItemId":"[\\"request_user_input_async\\",\\"c1\\",0]"}]\n</send_user_message_question_reply>')
        report = {"type": "agent_message", "author": "/root/a", "content": [{"type": "input_text", "text":
                  "Message Type: FINAL_ANSWER\nTask name: a\nSender: /root/a\nPayload:\nDone."}]}
        got = CODEX.read([item("user", "<environment_context><cwd>/w</cwd></environment_context>"), item("user", "hi"),
                          reply, report, item("user", "<turn_aborted>x</turn_aborted>")])
        self.assertEqual([(p.kind, p.words) for p in got],
                         [(Kind.ENVIRONMENT, None), (Kind.USER, "hi"), (Kind.ASK_REPLY, "Which fruit? → mango"),
                          (Kind.AGENT_REPORT, None), (Kind.INTERRUPT, None)])
        self.assertEqual((got[0].cwd, got[3].detail["from"], got[3].detail["text"]), ("/w", "/root/a", "Done."))
        # 0.164 sends its note that the turn was stopped as the developer's: still its note, by its marker
        aborted = {"type": "message", "role": "developer", "content": [{"type": "input_text", "text":
                   "<turn_aborted>\nThe previous turn was interrupted on purpose.\n</turn_aborted>"}]}
        instructions = {"type": "message", "role": "developer", "content": [{"type": "input_text", "text": "You are Codex."}]}
        self.assertEqual([p.kind for p in CODEX.read([aborted, instructions])], [Kind.INTERRUPT, Kind.ENVIRONMENT])

    def test_after_a_compaction_what_came_before_is_sent_again(self):
        got = CODEX.read([item("user", "kept"), {"type": "compaction", "encrypted_content": "x"}, item("user", "new")])
        self.assertEqual([p.kind for p in got], [Kind.COMPACTION_REPEAT, Kind.COMPACTION_SUMMARY, Kind.USER])

    def test_its_calls_and_side_calls(self):
        ask = {"type": "function_call", "call_id": "c1", "name": "request_user_input",
               "arguments": '{"questions": [{"id": "q", "question": "Which?", "options": [{"label": "A"}]}]}'}
        call, = CODEX.read([ask])
        self.assertEqual((call.tool.id, call.tool.action, call.tool.ask["questions"][0]["question"]), ("c1", Action.ASK, "Which?"))
        body = {"input": [item("user", "hi")]}
        title = CODEX.call("POST", "/v1/responses", {"x-codex-turn-metadata": '{"thread_source": "thread_title"}',
                                                     "thread-id": "t1", "user-agent": "codex_cli_rs/0.164.0"}, body)
        self.assertEqual((title.kind, title.session, title.version), (CallKind.TITLE, "t1", "0.164.0"))
        self.assertEqual(CODEX.title(CODEX.read([item("assistant", '{"title": "Fix  the tests"}')])), "Fix the tests")
        self.assertEqual(CODEX.recap(CODEX.read([item("assistant", '{"summary": "Did x.", "next_action": "Do y."}')])),
                         "Did x.\n\nNext: Do y.")
        turn = CODEX.call("POST", "/v1/responses", {"x-codex-turn-metadata": '{"thread_source": "user"}',
                                                    "user-agent": "codex-tui/0.164.0 (Mac OS 15.7.9; arm64) xterm-256color "
                                                                  "(codex-tui; 0.164.0)"}, body)
        self.assertEqual((turn.kind, turn.version), (CallKind.TURN, "0.164.0"))    # its terminal's User-Agent


class DerivedTest(unittest.TestCase):
    """What an answer's and a call's pieces say besides the conversation (`derived`), keyed by the harness's own ids."""

    def facts(self, *messages, history=None):
        return [(f.type, f.key, f.data) for f in CLAUDE.derived(CLAUDE.read(CLAUDE.items(list(messages))), 100.0, history)]

    def test_what_an_answer_asks_and_what_its_result_says_of_it(self):
        ask = {"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "AskUserQuestion", "input": {
            "questions": [{"question": "Which?", "header": "Pick", "options": [{"label": "A"}, {"label": "B"}]}]}}]}
        [(typ, key, data)] = self.facts(ask)
        self.assertEqual((typ, key, data["call"], data["kind"], data["async"]), ("asked", "t1", "t1", "question", False))
        self.assertEqual([o["label"] for o in data["questions"][0]["options"]], ["A", "B"])
        answered = {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": 'User has answered: "Which?"="B"'}]}
        # Esc, as Claude Code 2.1.311 sends it on (saved from a live session): the call rejected, and its note
        dismissed = {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "is_error": True,
                                                  "content": "The user doesn't want to proceed with this tool use. The tool "
                                                             "use was rejected (eg. if it was a file edit, the new_string was "
                                                             "NOT written to the file). STOP what you are doing and wait for "
                                                             "the user to tell you how to proceed."},
                                                 {"type": "text", "text": "[Request interrupted by user for tool use]"}]}
        self.assertEqual([(t, d["how"]) for t, _, d in self.facts(ask, answered) if t == "ask_settled"], [("ask_settled", "answered")])
        self.assertEqual([(t, d["how"]) for t, _, d in self.facts(ask, dismissed) if t == "ask_settled"], [("ask_settled", "dismissed")])

    def test_a_plan_sent_back_with_what_to_change_is_answered(self):
        # "Tell Claude what to change", as Claude Code 2.1.311 sends it on (saved from a live session): rejected, no note,
        # and its turn goes on with the reader's words
        ask = {"role": "assistant", "content": [{"type": "tool_use", "id": "t2", "name": "ExitPlanMode", "input": {}}]}
        change = {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t2", "is_error": True,
                                               "content": "The user doesn't want to proceed with this tool use. The tool use "
                                                          "was rejected (eg. if it was a file edit, the new_string was NOT "
                                                          "written to the file). To tell you how to proceed, the user said:\n"
                                                          "Append the word ciao instead of bye"}]}
        [(_, _, data)] = [f for f in self.facts(ask, change) if f[0] == "ask_settled"]
        self.assertEqual(data["how"], "answered")
        self.assertIn("ciao", data["result"])

    def test_a_plan_s_text_from_the_file_it_wrote(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, ".claude", "plans", "p.md")
            os.makedirs(os.path.dirname(path))
            with open(path, "w") as fh:
                fh.write("## Plan\n1. Do it")
            wrote = {"role": "assistant", "content": [{"type": "tool_use", "id": "w1", "name": "Write",
                                                       "input": {"file_path": path, "content": "draft"}}]}
            ask = {"role": "assistant", "content": [{"type": "tool_use", "id": "t9", "name": "ExitPlanMode", "input": {}}]}
            [(_, _, data)] = self.facts(ask, history=[wrote, {"role": "user", "content": "ok"}])
            self.assertEqual((data["kind"], data["plan"]), ("plan", "## Plan\n1. Do it"))     # as it is now
            os.remove(path)
            [(_, _, data)] = self.facts(ask, history=[wrote])
            self.assertEqual(data["plan"], "draft")                                            # as that write had it

    def test_tasks_started_stopped_noticed_and_handed_back(self):
        calls = {"role": "assistant", "content": [
            {"type": "tool_use", "id": "c1", "name": "Bash", "input": {"command": "sleep 99", "description": "Wait a while",
                                                                        "run_in_background": True}},
            {"type": "tool_use", "id": "c2", "name": "TaskStop", "input": {"task_id": "b2"}}]}
        results = {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "c1", "content": "Command running in background with ID: b1. "
                                                                     "Output is being written to: /tmp/b1.output"},
            {"type": "tool_result", "tool_use_id": "c2", "content": "Successfully stopped task: b2"},
            {"type": "text", "text": "<task-notification>\n<task-id>b3</task-id>\n<status>completed</status>\n</task-notification>"},
            {"type": "text", "text": "<task-notification>\n<task-id>m1</task-id>\n<event>line 4 matched</event>\n</task-notification>"}]}
        got = self.facts(calls, results)
        self.assertEqual([(t, k, d) for t, k, d in got if t == "task_started"],
                         [("task_started", "b1.c1", {"task": "b1", "kind": "command", "how": "started", "label": "Wait a while",
                                                     "output": "/tmp/b1.output"})])
        self.assertEqual({(d["task"], d["status"]) for t, _, d in got if t == "task_ended"}, {("b2", "stopped"), ("b3", "completed")})
        self.assertEqual([(d["task"], d["event"]) for t, _, d in got if t == "task_activity"], [("m1", "line 4 matched")])
        self.assertEqual(self.facts(calls, results), got)                      # read again: the same facts, the same keys
        self.assertEqual(CODEX.derived(CODEX.read([item("assistant", "hi")]), 1.0), [])   # codex's are in its record


class RunTest(unittest.TestCase):
    """Each harness started in a terminal (`command`), as the dashboard starts it."""

    def test_claude_code_s_options(self):
        self.assertEqual(CLAUDE.command("s1", permission_mode="auto", model="sonnet"),
                         ["--permission-mode", "auto", "--model", "sonnet", "--session-id", "s1"])
        self.assertEqual(CLAUDE.command("s1", resume=True, permission_mode="plan"), ["--permission-mode", "plan", "--resume", "s1"])
        self.assertEqual(CLAUDE.models(), {"models": [], "default": None})                               # its own default

    def test_codex_s_options(self):
        self.assertEqual(CODEX.command("t1", permission_mode="auto", model="gpt-x", fullscreen=False),
                         ["-m", "gpt-x", "--approve-for-me", "--no-alt-screen"])
        self.assertEqual(CODEX.command("t1", resume=True, permission_mode="manual"), ["resume", "t1"])     # it asks


class LookTest(unittest.TestCase):
    """What a reader of a harness's sessions shows of it, and how its terminal behaves: each harness's own, so the
    dashboard names none of them."""

    def test_every_harness_has_a_name_for_a_person_and_a_mark(self):
        import xml.etree.ElementTree as ET
        self.assertEqual(list(harness_kit.HARNESSES), ["claude", "codex", "antigravity", "pi", "opencode"])
        for name, h in harness_kit.HARNESSES.items():
            self.assertEqual(h.name, name)
            self.assertTrue(h.label, name)
            root = ET.fromstring(h.mark())                       # an SVG, whole
            self.assertEqual(root.tag, "{http://www.w3.org/2000/svg}svg", name)
            self.assertEqual(root.get("viewBox"), "0 0 24 24", name)
        self.assertEqual(harness_kit.DEFAULT, "claude")

    def test_the_harnesses_a_session_starts_on_say_how_to_run_them(self):
        self.assertEqual(harness_kit.runnable(), ["claude", "codex", "antigravity"])
        self.assertFalse(harness_kit.get("pi").runs_in_terminal)                       # its rules are its adaptor's
        self.assertEqual(harness_kit.get("pi").read_one({"role": "user", "content": "hi"})[0].kind, Kind.OTHER)

    def test_each_terminal_s_screen_its_ids_and_its_esc(self):
        agy = harness_kit.get("antigravity")
        self.assertEqual((CLAUDE.fullscreen, CODEX.fullscreen, agy.fullscreen), (True, False, True))
        self.assertEqual(CLAUDE.screen_env(False), {"CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN": "1"})
        self.assertEqual(CLAUDE.screen_env(True), {"CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN": None})   # unset
        self.assertEqual(CODEX.screen_env(False), {})                  # its own option says it (`command`)
        self.assertEqual([h.picks_session_id for h in (CLAUDE, CODEX, agy)], [False, True, True])
        self.assertEqual([h.esc_takes_back for h in (CLAUDE, CODEX, agy)], [True, False, False])

    def test_how_its_terminal_says_a_turn_stopped_short(self):
        self.assertEqual(CLAUDE.stopped_says["error_status"].format(status=529), "API Error: 529")
        self.assertEqual(CODEX.stopped_says["reasons"]["budget_limited"], "Goal budget reached - the turn was stopped.")
        for h in harness_kit.HARNESSES.values():
            self.assertTrue({"lead", "interrupted", "error"} <= set(h.stopped_says), h.name)


class ReadOneTest(unittest.TestCase):
    """A stored piece read on its own, with all a reader draws from it -- whichever harness's."""

    def test_an_attachment_a_script_s_calls_and_a_kind_its_neighbours_decided(self):
        [img] = CLAUDE.read_one({"role": "user", "content": [{"type": "image", "source": {}}]})
        self.assertEqual((img.attachment, img.text), ("image", "[image]"))
        [doc] = CLAUDE.read_one({"role": "user", "content": [{"type": "document", "source": {}}]})
        self.assertEqual(doc.attachment, "document")
        [script] = CODEX.read_one({"type": "custom_tool_call", "call_id": "x", "name": "exec",
                                   "input": 'await tools.exec_command({cmd: "ls"}); await tools.view_image(p)'})
        self.assertEqual([(c.name, c.input, c.action) for c in script.tool.calls],
                         [("exec_command", {"cmd": "ls"}, Action.SHELL), ("view_image", None, Action.READ)])
        bare = {"role": "user", "content": [{"type": "text", "text": "Draw it plainly."}]}
        self.assertEqual(CLAUDE.read_one(bare)[0].kind, Kind.USER)                        # alone: the user's words
        [skill] = CLAUDE.read_one(bare, Kind.SKILL)                                       # stored as a skill's
        self.assertEqual((skill.kind, skill.words, skill.detail["instructions"]), (Kind.SKILL, None, "Draw it plainly."))
        self.assertEqual(CODEX.read_one({"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hi"}]},
                                        Kind.SKILL)[0].kind, Kind.USER)                   # a harness whose neighbours decide none


class WordsTest(unittest.TestCase):
    def test_a_message_s_words_whichever_harness_s_wrapper(self):
        self.assertEqual(harness_kit.words("<bash-input>ls</bash-input>"), (Kind.USER_COMMAND, "! ls"))


if __name__ == "__main__":
    unittest.main()
