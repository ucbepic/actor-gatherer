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
from ag.integrations.harnesses.antigravity.setup.launch import session_args  # noqa: E402
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
        with self.assertRaises(harness_kit.InstructionsError):
            AGY.command("s1", instructions="be brief")


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


if __name__ == "__main__":
    unittest.main()
