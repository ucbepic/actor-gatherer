"""The antigravity harness: Antigravity's CLI (agy) on its Gemini API route -- its calls and contents as harness_kit
reads them (harness_kit/antigravity.py), its contents as the context manager's events and back (adaptor/), a Gemini
stream's answer as the hook server reads it (trace.py's `gemini_response`), and the launcher's arguments. The shapes
are agy 1.4.12's, from a live run, trimmed."""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import harness_kit  # noqa: E402
from harness_kit import Action, CallKind, Kind  # noqa: E402
from ag.cli.launch import LaunchError  # noqa: E402
from ag.integrations.harnesses.antigravity.adaptor.adaptor import AntigravityAdaptor  # noqa: E402
from ag.integrations.harnesses.antigravity.adaptor.to_messages import ag_message  # noqa: E402
from ag.integrations.harnesses.antigravity.setup.launch import instructions_of, session_args  # noqa: E402
from ag.integrations.tools.hook_server.trace import response_of, streamed_of  # noqa: E402

AGY = harness_kit.get("antigravity")
CONVERSATION = "73dbf702-17a8-4782-a076-b522c70d64ff"
SYSTEM = ("<identity>\nYou are Antigravity.\n</identity>\n<user_information>\nThe USER's OS version is linux.\n"
          "Command Working Directory: /work/here\nConversation ID: " + CONVERSATION + "\n</user_information>")
TURN_PATH = "/v1beta/models/gemini-3.1-pro-preview:streamGenerateContent?alt=sse"
USER = {"role": "user", "parts": [{"text": "<USER_REQUEST>\nCreate hello.txt\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\n"
                                           "The current local time is: 2026-10-30T21:11:42-04:00.\n</ADDITIONAL_METADATA>"}]}
CALL = {"role": "model", "parts": [{"functionCall": {"args": {"Content": "hi", "Path": "/work/here/hello.txt"},
                                                     "id": "call_1047612", "name": "write_file"},
                                    "thoughtSignature": "EqEDCp4D"}]}
RESULT = {"role": "model", "parts": [{"functionResponse": {"id": "call_1047612", "name": "write_file",
                                                           "response": {"output": "Created file."}}}]}
DENIED = {"role": "model", "parts": [{"functionResponse": {"id": "call_2476", "name": "run_command",
                                                           "response": {"error": "permission check failed"}}}]}
NOTICE = {"role": "user", "parts": [{"text": "The following is a <SYSTEM_MESSAGE> not actually sent by the user. It is "
                                             "provided by the system as important information to pay attention to.\n\n"
                                             "<SYSTEM_MESSAGE>\n[Message] sender=system\n</SYSTEM_MESSAGE>"}]}


def body(contents, system=SYSTEM):
    return {"contents": contents, "systemInstruction": {"parts": [{"text": system}]}, "tools": []}


class CallTest(unittest.TestCase):
    def test_a_turn_names_its_conversation_and_directory(self):
        call = AGY.call("POST", TURN_PATH, {}, body([USER]))
        self.assertEqual((call.kind, call.session, call.cwd), (CallKind.TURN, CONVERSATION, "/work/here"))
        self.assertEqual(call.detail["model"], "gemini-3.1-pro-preview")

    def test_the_title_call_names_none(self):
        call = AGY.call("POST", "/v1beta/models/gemini-3.1-flash-lite-preview:streamGenerateContent?alt=sse", {},
                        body([USER], "You are a conversation title generator. The message provided is ..."))
        self.assertEqual((call.kind, call.session), (CallKind.TITLE, None))

    def test_not_a_model_call(self):
        self.assertIsNone(AGY.call("GET", "/v1beta/models", {}, None))
        self.assertIsNone(AGY.call("POST", "/v1beta/models/x:countTokens", {}, body([USER])))
        self.assertIsNone(AGY.call("POST", TURN_PATH, {}, {"systemInstruction": {}}))


class ReadTest(unittest.TestCase):
    def test_each_part_read(self):
        parts = AGY.read(AGY.items([USER, CALL, RESULT, DENIED, NOTICE]))
        self.assertEqual([p.kind for p in parts],
                         [Kind.USER, Kind.TOOL_CALL, Kind.TOOL_RESULT, Kind.TOOL_RESULT, Kind.ENVIRONMENT])
        self.assertEqual(parts[0].words, "Create hello.txt")
        self.assertEqual((parts[1].tool.id, parts[1].tool.action, parts[1].tool.paths),
                         ("call_1047612", Action.EDIT, ["/work/here/hello.txt"]))
        self.assertEqual((parts[2].result.call_id, parts[2].result.error), ("call_1047612", False))
        self.assertTrue(parts[3].result.error)

    def test_a_content_of_several_parts_split(self):
        both = {"role": "model", "parts": [{"text": "thinking", "thought": True}, {"text": "done"}]}
        items = AGY.items([both])
        self.assertEqual(items, [{"role": "model", "parts": [{"text": "thinking", "thought": True}]},
                                 {"role": "model", "parts": [{"text": "done"}]}])
        self.assertEqual([p.kind for p in AGY.read(items)], [Kind.REASONING, Kind.AGENT])

    def test_words_unwrapped_by_any_harness(self):
        self.assertEqual(harness_kit.words(USER["parts"][0]["text"]), (Kind.USER, "Create hello.txt"))

    def test_command(self):
        self.assertEqual(AGY.command("s1", resume=True, model="m", permission_mode="acceptEdits"),
                         ["--model", "m", "--mode", "accept-edits", "--conversation", "s1"])
        self.assertEqual(AGY.command("s1", instructions="be brief"), ["--append-system-prompt", "be brief"])


class AdaptorTest(unittest.TestCase):
    def test_events_and_back(self):
        adaptor = AntigravityAdaptor()
        events = adaptor.to_events([USER, CALL, RESULT, NOTICE])
        self.assertEqual([e["type"] for e in events], ["user_message", "tool_call", "tool_output", "context"])
        self.assertEqual([e["id"] for e in events[1:3]], ["call_1047612", "call_1047612:result"])
        self.assertTrue(events[0]["id"].startswith("sha256:"))
        self.assertEqual(events[0]["properties"], {"kind": Kind.USER, "words": "Create hello.txt"})
        self.assertEqual(events[1]["text"], 'write_file({"Content": "hi", "Path": "/work/here/hello.txt"})')
        context = [{"type": e["type"], "payload": e["payload"]} for e in events] + [{"type": "ag", "text": "note"}]
        self.assertEqual(adaptor.to_messages(context, None), [USER, CALL, RESULT, NOTICE, ag_message("note")])
        self.assertEqual(adaptor.to_events([ag_message("note")])[0]["type"], "context")   # read as agy's own


def sse(*chunks):
    return "".join("data: " + json.dumps(c) + "\r\n\r\n" for c in chunks).encode()


def chunk(*parts, finish=None, usage=None):
    out = {"candidates": [{"content": {"role": "model", "parts": list(parts)}, "index": 0}], "responseId": "r1"}
    if finish:
        out["candidates"][0]["finishReason"] = finish
    if usage:
        out["usageMetadata"] = usage
    return out


class GeminiAnswerTest(unittest.TestCase):
    STREAM = sse(chunk({"text": "**Plan", "thought": True}), chunk({"text": "ning**", "thought": True}),
                 chunk({"text": "Hel"}), chunk({"text": "lo", "thoughtSignature": "sig"}),
                 chunk({"functionCall": {"name": "read_file", "args": {"Path": "/a"}, "id": "c1"}}),
                 chunk({"text": ""}, finish="STOP", usage={"promptTokenCount": 100, "cachedContentTokenCount": 60,
                                                           "candidatesTokenCount": 7, "thoughtsTokenCount": 3,
                                                           "totalTokenCount": 110}))

    def test_parts_put_together(self):
        got = response_of(self.STREAM)
        self.assertEqual((got["response_id"], got["status"], got["error"]), ("r1", "STOP", None))
        self.assertEqual([i["parts"][0] for i in got["output_items"]],
                         [{"text": "**Planning**", "thought": True}, {"text": "Hello", "thoughtSignature": "sig"},
                          {"functionCall": {"name": "read_file", "args": {"Path": "/a"}, "id": "c1"}}])
        self.assertEqual((got["token_usage"]["input_tokens"], got["token_usage"]["cached_input_tokens"],
                          got["token_usage"]["output_tokens"]), (100, 60, 10))

    def test_while_streaming_the_last_part_may_still_grow(self):
        got = streamed_of(sse(chunk({"text": "a", "thought": True}), chunk({"text": "He"})))
        self.assertEqual([i["parts"][0] for i in got["output_items"]], [{"text": "a", "thought": True}])

    def test_an_error_body(self):
        got = response_of(json.dumps({"error": {"code": 400, "message": "API key not valid"}}).encode())
        self.assertEqual(got["error"]["message"], "API key not valid")
        self.assertEqual(got["output_items"], [])


class LaunchArgsTest(unittest.TestCase):
    def test_the_gemini_route_set(self):
        args, session = session_args(["-p", "hi"])
        self.assertEqual(args, ["--settings", '{"modelProvider": "gemini"}', "-p", "hi"])
        self.assertIsNone(session)

    def test_settings_kept_and_conversation_claimed(self):
        args, session = session_args(["--settings", '{"theme": "dark"}', "--conversation", CONVERSATION])
        self.assertEqual(json.loads(args[1]), {"theme": "dark", "modelProvider": "gemini"})
        self.assertEqual((args[2:], session), (["--conversation", CONVERSATION], CONVERSATION))

    def test_another_provider_refused(self):
        with self.assertRaises(LaunchError):
            session_args(['--settings={"modelProvider": "cloudcode"}'])



# ---- what a live run of agy 1.4.12 sent (trimmed): a question, a background command, a subagent, a compaction

PARENT = CONVERSATION
CHILD = "483a8f62-a915-44c3-aa25-f0022e60ea6b"
SUB_SYSTEM = (SYSTEM.replace(CONVERSATION, CHILD) + '\n<subagent_reminder>\nYou are running as a subagent, invoked by a '
              f'caller agent (name: "parent", id: "{PARENT}"). You MUST use send_message to communicate all results.'
              '\n</subagent_reminder>')
ASK = {"role": "model", "parts": [{"functionCall": {"name": "ask_question", "id": "call_356537", "args": {"questions": [
    {"is_multi_select": False, "question": "Which color do you like?", "options": ["(Recommended) Red", "Blue"]},
    {"is_multi_select": True, "question": "Which pets do you have?", "options": ["(Recommended) Cat", "Dog", "Fish"]}]}}}]}
ANSWERED = {"role": "model", "parts": [{"functionResponse": {"id": "call_356537", "name": "ask_question", "response": {
    "output": "Created At: 2026-10-31T16:35:06-07:00\nCompleted At: 2026-10-31T16:35:33-07:00\nA1: Blue\nA2: (Recommended) Cat, Fish"}}}]}
RUN = {"role": "model", "parts": [{"functionCall": {"name": "run_command", "id": "call_9", "args": {
    "CommandLine": "sleep 25", "WaitMsBeforeAsync": 100, "toolSummary": "Wait 25 s"}}}]}
TASK = f"{PARENT}/task-18"
BACKGROUNDED = {"role": "model", "parts": [{"functionResponse": {"id": "call_9", "name": "run_command", "response": {
    "output": f"Created At: 2026-10-31T16:36:58-07:00\nTool is running as a background task with task id: {TASK}\n"
              "Task Description: sleep 25\nTask logs are available at: file:///home/u/.gemini/antigravity-cli/brain/"
              f"{PARENT}/.system_generated/tasks/task-18.log\nYOU MUST TAKE ONE OF THE FOLLOWING TWO ACTIONS"}}}]}


def system_message(sender, content):
    return {"role": "user", "parts": [{"text": "The following is a <SYSTEM_MESSAGE> not actually sent by the user. It is "
                                               "provided by the system as important information to pay attention to.\n\n"
                                               f"<SYSTEM_MESSAGE>\n[Message] timestamp=2026-10-31T23:37:36Z sender={sender} "
                                               f"priority=MESSAGE_PRIORITY_HIGH content={content}\n</SYSTEM_MESSAGE>"}]}


FINISHED = system_message(TASK, f'Task id "{TASK}" finished with result:\nCommand exited with code 0.\n\nNo output.')
INVOKE = {"role": "model", "parts": [{"functionCall": {"name": "invoke_subagent", "id": "call_243119", "args": {
    "Role": "Math Calculator", "TypeName": "self", "Prompt": "Calculate 17 times 23."}}}]}
SPAWNED = {"role": "model", "parts": [{"functionResponse": {"id": "call_243119", "name": "invoke_subagent", "response": {
    "output": 'Created At: x\nCompleted At: x\nCreated the following subagent:\n{\n  "conversationId":  "' + CHILD
              + '",\n  "logAbsoluteUri":  "file:///home/u/.gemini/antigravity-cli/brain/' + CHILD
              + '/.system_generated/logs/transcript.jsonl",\n  "workspaceUris":  [\n    "file:///work/here"\n  ]\n}\nThe s'}}}]}
REPORT = system_message(CHILD, "The numerical answer is 391.")
SUMMARY_PROMPT = {"role": "user", "parts": [{"text": "You have been working on the task described above but have not yet "
                                                     "completed\nit. Write a continuation summary that will allow you ..."}]}
COMPACT = {"role": "user", "parts": [{"text": "<USER_REQUEST>\n/compact\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nx\n"
                                              "</ADDITIONAL_METADATA>"}]}
SUMMARY = {"role": "user", "parts": [{"text": "<CONTEXT_SUMMARY>\nThe following is a summary of the conversation ..."}]}


class SubagentAndCompactionCallTest(unittest.TestCase):
    def test_a_subagent_is_its_callers(self):
        call = AGY.call("POST", TURN_PATH, {}, body([REPORT], SUB_SYSTEM))
        self.assertEqual((call.kind, call.session, call.detail["agent"]), (CallKind.SUBAGENT, PARENT, CHILD))

    def test_a_compaction_asks_last(self):
        call = AGY.call("POST", TURN_PATH, {}, body([USER, COMPACT, SUMMARY_PROMPT]))
        self.assertEqual((call.kind, call.session), (CallKind.COMPACTION, CONVERSATION))
        self.assertEqual((call.history, call.own), ([USER, COMPACT], [SUMMARY_PROMPT]))


class OwnTextTest(unittest.TestCase):
    def test_what_each_is(self):
        parts = AGY.read(AGY.items([SUMMARY, COMPACT, FINISHED, REPORT, NOTICE]))
        self.assertEqual([p.kind for p in parts], [Kind.COMPACTION_SUMMARY, Kind.USER_COMMAND, Kind.TASK_NOTICE,
                                                   Kind.AGENT_REPORT, Kind.ENVIRONMENT])
        self.assertEqual(parts[1].words, "/compact")
        self.assertEqual(parts[2].detail["notices"], [{"id": TASK, "status": "completed", "event": None, "ended": True,
                                                       "waiting": False}])
        self.assertEqual(parts[3].detail, {"from": CHILD, "text": "The numerical answer is 391."})

    def test_a_question_and_the_tasks_results_start(self):
        parts = AGY.read(AGY.items([ASK, BACKGROUNDED, SPAWNED]))
        self.assertEqual(parts[0].tool.ask["questions"][1],
                         {"id": None, "header": "", "question": "Which pets do you have?", "multiSelect": True,
                          "options": [{"label": "(Recommended) Cat", "description": ""},
                                      {"label": "Dog", "description": ""}, {"label": "Fish", "description": ""}]})
        self.assertEqual((parts[1].result.task["id"], parts[1].result.task["kind"], parts[1].result.task["label"]),
                         (TASK, "command", "sleep 25"))
        self.assertTrue(parts[1].result.task["output"].endswith("/tasks/task-18.log"))
        self.assertEqual((parts[2].result.task["id"], parts[2].result.task["kind"]), (CHILD, "agent"))

    def test_the_summary_is_not_stored(self):
        events = AntigravityAdaptor().to_events([SUMMARY, USER])
        self.assertEqual([e["type"] for e in events], ["user_message"])


class DerivedTest(unittest.TestCase):
    def facts(self, parts, history=None):
        return [(f.type, f.key, f.data) for f in AGY.derived(AGY.read(AGY.items(parts)), 1.0, history)]

    def test_asked_then_answered(self):
        asked = self.facts([ASK])
        self.assertEqual([(t, k) for t, k, _ in asked], [("asked", "call_356537")])
        self.assertEqual(asked[0][2]["kind"], "question")
        got = self.facts([ASK, ANSWERED])
        self.assertEqual(got[1][:2], ("ask_settled", "call_356537"))
        self.assertEqual(got[1][2]["how"], "answered")
        self.assertIn("A1: Blue", got[1][2]["result"])

    def test_a_background_command_starts_and_ends(self):
        got = self.facts([RUN, BACKGROUNDED, FINISHED])
        self.assertEqual([(t, d["task"]) for t, _, d in got], [("task_started", TASK), ("task_ended", TASK)])
        self.assertEqual((got[0][2]["kind"], got[1][2]["status"]), ("command", "completed"))

    def test_a_subagent_starts_and_speaks(self):
        got = self.facts([INVOKE, SPAWNED, REPORT])
        self.assertEqual([(t, d["task"]) for t, _, d in got], [("task_started", CHILD), ("task_activity", CHILD)])
        self.assertEqual(got[0][2]["label"], "Math Calculator")

    def test_where_a_calls_new_pieces_begin(self):
        from harness_kit.antigravity import answer_start
        items = AGY.items([USER, ASK, ANSWERED, NOTICE])
        self.assertEqual(answer_start(items), 1)
        self.assertEqual(answer_start(AGY.items([USER])), 0)


class AnswerTest(unittest.TestCase):
    ASKED = AGY.read(AGY.items([ASK]))[0].tool.ask

    def test_keys(self):
        keys = AGY.answer_keys(self.ASKED, {"answers": [{"options": [1]}, {"options": [0, 2]}]})
        self.assertEqual(keys, ["\x1b[B", "\r", " ", "\x1b[B", "\x1b[B", " ", "\r"])
        self.assertEqual(AGY.answer_expected(self.ASKED, {"answers": [{"options": [1]}, {"options": [0, 2]}]}),
                         ["A1: Blue", "A2: (Recommended) Cat, Fish"])

    def test_several_then_more_go_on_with_next_and_own_words_are_written_in(self):
        ask = {"kind": "question", "questions": list(reversed(self.ASKED["questions"]))}
        keys = AGY.answer_keys(ask, {"answers": [{"options": [1]}, {"text": "Green"}]})
        self.assertEqual(keys, ["\x1b[B", " ", "\x1b[C", "\x1b[B", "\x1b[B", "\r", "Green", "\r"])
        self.assertEqual(AGY.answer_expected(ask, {"answers": [{"options": [1]}, {"text": "Green"}]}),
                         ["A1: Dog", "A2: Green"])


def agy_screen(box_row, cursor=True):
    """agy's screen as its message box shows (its prompt row between two rules), the cursor in it or hidden."""
    from harness_kit.screen import Screen
    screen = Screen(60, 8)
    rule_ = "─" * 60
    rows = ["  Antigravity CLI 1.4.12", "> earlier message", "  answer", rule_, box_row, rule_, "? for shortcuts"]
    screen.feed(("\r\n".join(rows) + f"\x1b[5;{len(box_row) + 1}H" + ("" if cursor else "\x1b[?25l")).encode())
    return screen


class BoxTest(unittest.TestCase):
    def test_its_message_box(self):
        self.assertEqual(AGY.box(agy_screen(">")), harness_kit.Box.EMPTY)
        self.assertEqual(AGY.box(agy_screen("> half a messa")), harness_kit.Box.HOLDS)
        self.assertEqual(AGY.box(agy_screen(">", cursor=False)), harness_kit.Box.AWAY)     # a dialog has the keys


def varint(n):
    out = b""
    while True:
        b, n = n & 0x7f, n >> 7
        out += bytes([b | (0x80 if n else 0)])
        if not n:
            return out


def pb(*fields):
    """A protobuf message of (number, value) fields: an int a varint, bytes or str length-delimited."""
    out = b""
    for n, v in fields:
        if isinstance(v, int):
            out += varint(n << 3) + varint(v)
        else:
            v = v.encode() if isinstance(v, str) else v
            out += varint(n << 3 | 2) + varint(len(v)) + v
    return out


class RecordTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.dir = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.dir, "conversations"))
        self.db = os.path.join(self.dir, "conversations", f"{CONVERSATION}.db")
        import sqlite3
        conn = sqlite3.connect(self.db)
        conn.execute("CREATE TABLE steps (idx integer PRIMARY KEY, step_type integer, status integer, step_payload blob)")
        error = pb((1, 17), (5, pb((1, pb((1, 1793490285), (2, 0))))),
                   (24, pb((3, pb((2, "agent executor error: Error 400, Message: API key not valid., Details: [map]"),
                                  (7, 400))))))
        conn.executemany("INSERT INTO steps VALUES (?, ?, ?, ?)",
                         [(0, 14, 3, pb((1, 14))), (1, 17, 3, error), (2, 15, 2, pb((1, 15)))])
        conn.commit()
        conn.close()

    def test_a_turn_given_up_and_where_to_read_on(self):
        rec = AGY.follower(self.db)
        facts, offset = rec.read_on(self.db, 0)
        self.assertEqual([(f.type, f.data["how"], f.data["status"]) for f in facts], [("turn_stopped", "error", 400)])
        self.assertEqual(facts[0].data["error"], "agent executor error: Error 400, Message: API key not valid.")
        self.assertEqual(facts[0].at, 1793490285)
        self.assertEqual(offset, 2)                        # step 2 still runs: read again from there
        self.assertEqual(rec.read_on(self.db, offset), ([], 2))

    def test_a_step_the_user_stopped_as_it_was_stopped(self):
        import sqlite3
        conn = sqlite3.connect(self.db)                  # Esc: the tool call its answer made canceled as it came
        conn.execute("UPDATE steps SET status = 3 WHERE idx = 2")
        conn.executemany("INSERT INTO steps VALUES (?, ?, ?, ?)", [
            (3, 132, 6, pb((1, 132), (5, pb((1, pb((1, 1793581139), (2, 449931000))),
                                            (8, pb((1, 1793581140), (2, 150518000))))))),
            (4, 15, 12, pb((1, 15), (5, pb((1, pb((1, 1793581150)),)))))])            # no completed_at: when made
        conn.commit()
        conn.close()
        facts, offset = AGY.follower(self.db).read_on(self.db, 2)
        self.assertEqual([(f.type, f.key, f.data["how"]) for f in facts],
                         [("turn_stopped", "step3.interrupted", "interrupted"), ("turn_stopped", "step4.interrupted", "interrupted")])
        self.assertAlmostEqual(facts[0].at, 1793581140.150518)    # completed_at, not created_at
        self.assertEqual(facts[1].at, 1793581150)
        self.assertEqual(offset, 5)

    def test_its_name(self):
        rec = AGY.follower(self.db)
        os.makedirs(os.path.join(self.dir, "annotations"))
        with open(os.path.join(self.dir, "annotations", f"{CONVERSATION}.pbtxt"), "w") as fh:
            fh.write('title:"Capture \\"one\\""\n')
        facts, _ = rec.read_on(self.db, 3)
        self.assertEqual([(f.type, f.data) for f in facts], [("name", {"text": 'Capture "one"', "by": "antigravity"})])

    def test_found_by_the_conversation(self):
        self.assertEqual(AGY.record_path(CONVERSATION, config=self.dir), self.db)
        self.assertIsNone(AGY.record_path("0" * 36, config=self.dir))

    def test_renamed_where_it_keeps_its_name(self):
        home = os.path.dirname(os.path.dirname(self.dir))
        base = os.path.join(self.dir, "home", ".gemini", "antigravity-cli")
        os.makedirs(os.path.join(base, "conversations"))
        open(os.path.join(base, "conversations", f"{CONVERSATION}.db"), "w").close()
        AGY.rename(CONVERSATION, "New  name", env={"HOME": os.path.join(self.dir, "home")})
        with open(os.path.join(base, "annotations", f"{CONVERSATION}.pbtxt")) as fh:
            self.assertEqual(fh.read(), 'title:"New name"\n')
        with self.assertRaises(harness_kit.RenameError):
            AGY.rename("0" * 36, "x", env={"HOME": os.path.join(self.dir, "home")})
        self.assertEqual(AGY.rename_command("New\nname"), "/rename New name")
        del home


class InstructionsTest(unittest.TestCase):
    def test_taken_out_of_agys_arguments(self):
        self.assertEqual(instructions_of(["--append-system-prompt", "be brief", "--model", "m"]), ("be brief", ["--model", "m"]))
        self.assertEqual(instructions_of(["--model", "m"]), (None, ["--model", "m"]))
        self.assertEqual(instructions_of(["--", "--append-system-prompt", "x"]), (None, ["--", "--append-system-prompt", "x"]))

    def test_kept_by_the_run_and_read_by_the_hook(self):
        import tempfile
        from ag.integrations.harnesses.antigravity.ag_orchestrator import told as read
        from ag.integrations.harnesses.antigravity.setup import told
        home = tempfile.mkdtemp()
        self.assertEqual(told.path(home, "1"), read.path(home, "1"))          # each side's copy of where it is
        told.keep(home, "12345", "be brief")
        reader = read.Told(home)
        self.assertEqual((reader.of("12345"), reader.of("999"), reader.of(None)), ("be brief", None, None))
        told.keep(home, str(os.getpid()), "mine")
        told.tidy(home)                                   # 12345 is no process of this test: gone; ours stays
        self.assertEqual((reader.of("12345"), reader.of(str(os.getpid()))), (None, "mine"))


class FakeClient:
    """A gatherer's server client: each request kept; a rewrite answered with its events, an `ag` note first."""

    def __init__(self, gatherer):
        self.gatherer, self.requests, self.records = gatherer, [], []

    async def request(self, op, body=None):
        if op == "insert":
            self.records += [dict(e, channel=body["properties"]["channel"]) for e in body["events"]]
            return {"rows": []}
        self.requests.append((op, body))
        return {"context": [{"type": "ag", "name": "earlier", "text": "MANAGED"}]
                + [{"type": e["type"], "id": e["id"], "payload": e["payload"]} for e in body["events"]],
                "note": f"{len(body['events'])} items in"}

    async def stop(self):
        pass


class HookTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        from ag.integrations.harnesses.antigravity.ag_orchestrator import context_manager as agy_ag
        from ag.integrations.harnesses.codex.ag_orchestrator.ag_clients import AgClients
        self.home = tempfile.mkdtemp()
        self.clients = {}

        def made(gatherer):
            self.clients[gatherer] = FakeClient(gatherer)
            return self.clients[gatherer]
        self.hook = agy_ag.AntigravityContextManager(ag_clients=AgClients(made), log=lambda g, l: None, files="off",
                                                     home=self.home)
        self.hook.sessions = None                         # no record to follow here

    def call(self, contents, system=SYSTEM, run=None):
        import asyncio
        from types import SimpleNamespace
        request = SimpleNamespace(method="POST", path=TURN_PATH, label="g", headers={}, run=run, state={},
                                  body=body(contents, system))

        async def go():
            got = await self.hook(request)
            await asyncio.gather(*list(self.hook.under_way), return_exceptions=True)
            return got
        return asyncio.run(go()), request

    def test_a_subagent_goes_through_as_it_is_on_its_callers_session(self):
        got, request = self.call([REPORT], SUB_SYSTEM)
        self.assertIsNone(got)
        self.assertEqual(self.clients["g"].requests, [])                     # no rewrite: its own conversation
        self.assertEqual([(r["type"], r["channel"]) for r in self.clients["g"].records], [("model_call", PARENT)])

    def test_a_compaction_builds_and_asks_last(self):
        got, _ = self.call([USER, COMPACT, SUMMARY_PROMPT])
        op, sent = self.clients["g"].requests[0]
        self.assertEqual(op, "compaction")
        self.assertEqual(got["contents"][-1], SUMMARY_PROMPT)
        self.assertEqual(got["contents"][0]["parts"][0]["text"].count("MANAGED"), 1)

    def test_a_runs_instructions_after_the_system_instruction(self):
        from ag.integrations.harnesses.antigravity.setup import told
        told.keep(self.home, "77", "You coordinate the actors.")
        got, _ = self.call([USER], run="77")
        self.assertEqual(got["systemInstruction"]["parts"][-1], {"text": "\n\nYou coordinate the actors."})
        got, _ = self.call([USER], run="78")
        self.assertNotIn("You coordinate", json.dumps(got["systemInstruction"]))

    def test_what_a_calls_new_pieces_say_is_recorded(self):
        self.call([USER, RUN, BACKGROUNDED, FINISHED])
        self.assertEqual([r["type"] for r in self.clients["g"].records if r["type"].startswith("task")],
                         ["task_started", "task_ended"])



class DashboardTest(unittest.TestCase):
    """What the dashboard makes of agy's events: Chat's parts, its notes and command labels, what it answers with."""

    def test_its_calls_and_results_drawn(self):
        from ag_dashboard import data
        [call] = data.parts("tool_call", json.dumps(RUN), None, harness="antigravity")
        self.assertEqual({k: call[k] for k in ("kind", "id", "name", "input")},
                         {"kind": "call", "id": "call_9", "name": "run_command", "input": RUN["parts"][0]["functionCall"]["args"]})
        self.assertEqual((call["action"], call["view"]["shape"], call["view"]["title"]), ("shell", "shell", "Bash"))
        got = data.parts("tool_output", json.dumps(BACKGROUNDED), None, harness="antigravity")
        self.assertEqual((got[0]["kind"], got[0]["id"], got[0]["error"]), ("result", "call_9", False))
        thought = {"role": "model", "parts": [{"text": "hmm", "thought": True}]}
        self.assertEqual(data.parts("agent_reasoning", json.dumps(thought), None, harness="antigravity"),
                         [{"kind": "thinking", "text": "hmm"}])

    def test_a_subagents_message_a_report_and_its_calls_labelled(self):
        from ag_dashboard import data, files
        note = lambda event: data.parts("context", json.dumps(event), None, None, "antigravity")[0]   # noqa: E731
        self.assertEqual(files._note(note(REPORT)), {"kind": "report", "from": CHILD, "text": "The numerical answer is 391."})
        self.assertIsNone(files._note(note(FINISHED)))                                # a task's notice: no report
        call = lambda event: data.parts("tool_call", json.dumps(event), None, None, "antigravity")[0]   # noqa: E731
        self.assertEqual(files._label(call(INVOKE), ""), "Agent Math Calculator")
        self.assertEqual(files._label(call(ASK), ""), "Ask: Which color do you like? + 1 more")

    def test_what_it_asks_is_answered_by_its_own_dialog(self):
        from ag_dashboard import answers, data
        ask = data.ask_view({"kind": "question", "call": "c", **AGY.read(AGY.items([ASK]))[0].tool.ask}, "antigravity")
        self.assertEqual(ask["harness"], "antigravity")
        self.assertEqual(answers.expected(ask, {"answers": [{"options": [1]}, {"options": [0]}]}),
                         ["A1: Blue", "A2: (Recommended) Cat"])
        self.assertFalse(harness_kit.get("antigravity").record_ends_turns)   # its record's stops read as Claude Code's


if __name__ == "__main__":
    unittest.main()
