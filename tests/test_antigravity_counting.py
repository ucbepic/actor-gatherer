"""Gemini's own counts of Antigravity's calls (ag/integrations/harnesses/antigravity/ag_orchestrator/counting.py, on the
shared counter, ag/integrations/tools/ag_orchestrator/counting.py), against a stand-in for Gemini's
models/<model>:countTokens whose every count is known: each part costs what its content says, and 2 more; a thought
signature costs nothing to it, though the call itself is charged a token per 8 of its characters (`own_count`), as
Gemini's calls are charged for them; a function response is refused without its call right before it, and a function call
without its signature, as Gemini refuses them. agy sends a function response in the model's role, as here. Without
the key, the calls' own counts are differenced. And the hook: counted before sending near the budget, counted after."""
import asyncio
import json
import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from aiohttp import web
    from aiohttp.test_utils import TestServer
except ImportError:
    web = None

from ag.integrations.harnesses.antigravity.adaptor import to_events as agy  # noqa: E402
from ag.integrations.harnesses.antigravity.adaptor.adaptor import AntigravityAdaptor  # noqa: E402
from ag.integrations.harnesses.antigravity.adaptor.to_messages import ag_message  # noqa: E402
from ag.integrations.harnesses.antigravity.ag_orchestrator import context_manager as agy_ag  # noqa: E402
from ag.integrations.harnesses.antigravity.ag_orchestrator import counting  # noqa: E402
from ag.integrations.harnesses.antigravity.ag_orchestrator.counting import Counter, signature_chars  # noqa: E402
from ag.integrations.harnesses.codex.ag_orchestrator.ag_clients import AgClients  # noqa: E402

MODEL = "gemini-4-argon"
PATH = f"/v1beta/models/{MODEL}:streamGenerateContent"
SYSTEM = ("<user_information>\nCommand Working Directory: /work/here\n"
          "Conversation ID: 73dbf702-17a8-4782-a076-b522c70d64ff\n</user_information>")
TOOLS = [{"functionDeclarations": [{"name": "read_file", "description": "Reads a file."}]}]


def part_cost(p) -> int:
    if "functionCall" in p:
        return 3 + len(json.dumps(p["functionCall"].get("args") or {})) // 4      # its signature: nothing
    if "functionResponse" in p:
        return 2 + len(json.dumps(p["functionResponse"].get("response") or {})) // 4
    return 1 + len(p.get("text") or "") // 4


def cost(content) -> int:
    """The stand-in's price of a content, its framing (2) with it."""
    return 2 + sum(part_cost(p) for p in content.get("parts") or [])


def price(req) -> int:
    """The stand-in endpoint's count of a generateContentRequest; a ValueError for what Gemini refuses."""
    contents, last = req["contents"], None
    for c in contents:
        for p in c.get("parts") or []:
            if "functionResponse" in p and not (last and ("functionCall" in json.dumps(last)
                                                         or "functionResponse" in json.dumps(last))):
                raise ValueError("Please ensure that function response turn comes immediately after a function call turn.")
            if "functionCall" in p and "thoughtSignature" not in p and not (last and "functionCall" in json.dumps(last)):
                raise ValueError("Function call is missing a thought_signature in functionCall parts.")
        last = c
    system = req.get("systemInstruction")
    return 10 + (len(system["parts"][0]["text"]) // 4 if system else 0) \
        + (len(json.dumps(req["tools"])) // 4 if req.get("tools") else 0) + sum(cost(c) for c in contents)


SIG_CHARS = 8            # signature characters a token is, in what a call is charged (the stand-in's)


def own_count(body) -> int:
    """What the call itself reports: the endpoint's count, and its signatures."""
    return price(body) + sum(signature_chars(c) for c in body["contents"]) // SIG_CHARS


def signed_at_first(chars) -> int:
    """A signature's cost before any call's own count: at the measured rate."""
    return round(chars * counting.SIGNATURE_RATE)


def user(text):
    return {"role": "user", "parts": [{"text": f"<USER_REQUEST>\n{text}\n</USER_REQUEST>"}]}


def model(**part):
    return {"role": "model", "parts": [part]}


def turn():
    """A request; the model's thought, words and two calls (the first with its signature); their responses, in the
    model's role as agy sends them; its reply; the next request."""
    return [user("What is in a.txt and b.txt?"),
            model(text="**Reading both**\n\nI will read the two files.", thought=True),
            model(text="Reading them."),
            model(functionCall={"id": "c1", "name": "read_file", "args": {"Path": "/work/here/a.txt"}},
                  thoughtSignature="EqEDCp4D" * 500),
            model(functionCall={"id": "c2", "name": "read_file", "args": {"Path": "/work/here/b.txt"}}),
            model(functionResponse={"id": "c1", "name": "read_file", "response": {"output": "alpha " * 40}}),
            model(functionResponse={"id": "c2", "name": "read_file", "response": {"output": "beta " * 30}}),
            model(text="a.txt says alpha, b.txt says beta."),
            user("Thanks.")]


def body_of(contents):
    return {"contents": contents, "systemInstruction": {"parts": [{"text": SYSTEM}]}, "tools": TOOLS,
            "generationConfig": {"thinkingConfig": {"includeThoughts": True}}}


class Client:
    def __init__(self):
        self.asked = []

    async def request(self, op, body=None, timeout=None):
        if op == "insert":
            return {"rows": []}
        self.asked.append((op, body))
        return {}


@unittest.skipIf(web is None, "the hook server needs aiohttp")
class Base(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.asked, self.unknown_models = [], set()

        async def count_tokens(req):
            body = await req.json()
            name = req.match_info["model"]
            self.asked.append((dict(req.headers), name, body))
            if name in self.unknown_models:
                return web.json_response({"error": {"code": 404, "status": "NOT_FOUND",
                                                     "message": f"models/{name} is not found for API version v1beta"}},
                                         status=404)
            try:
                return web.json_response({"totalTokens": price(body["generateContentRequest"])})
            except ValueError as exc:
                return web.json_response({"error": {"code": 400, "message": str(exc)}}, status=400)

        app = web.Application()
        app.router.add_post("/v1beta/models/{model}:countTokens", count_tokens)
        self.upstream = TestServer(app)
        await self.upstream.start_server()
        self.url = str(self.upstream.make_url("")).rstrip("/")
        self.request = SimpleNamespace(path=PATH, upstream=self.url, headers={"x-goog-api-key": "k", "Accept": "*/*"})

    async def asyncTearDown(self):
        await self.upstream.close()

    async def run_call(self, counter, items, sent=None, ag_items=(), read_id=1, preamble=()):
        client = Client()
        sent = items if sent is None else sent
        out = {"events": agy.to_events(items), "ag_items": list(ag_items), "read_id": read_id, "basis": None}
        counter.sent("g", "c", out, sent, list(preamble))
        counter.start(self.request, client, "g", {"channel": "c"}, body_of(items), items, sent, out)
        await counter.close()
        return client, client.asked[0][1] if client.asked else None


class CounterTest(Base):
    async def test_every_event_counted_and_with_the_preamble_the_whole_request(self):
        items = turn()
        _, sent = await self.run_call(Counter(AntigravityAdaptor()), items)
        self.assertEqual(set(sent["counts"]), {e["id"] for e in agy.to_events(items)})       # thoughts too
        preamble = {p["name"]: p["tokens"] for p in sent["preamble_counts"]}
        self.assertEqual(preamble, {"systemInstruction": len(SYSTEM) // 4, "tools": len(json.dumps(TOOLS)) // 4})
        self.assertEqual(sum(sent["counts"].values()) + sum(preamble.values()),
                         price(body_of(items)) - 10 + signed_at_first(4000))   # all but the count's own; the signature

    async def test_an_item_s_count_is_what_it_costs_its_signature_nothing(self):
        items = turn()
        _, sent = await self.run_call(Counter(AntigravityAdaptor()), items)
        ids = [e["id"] for e in agy.to_events(items)]
        out = items[5]
        cut = model(functionResponse={"id": "c1", "name": "read_file", "response": {"output": "x"}})
        self.assertEqual(sent["counts"][ids[5]], cost(out) - cost(cut) + 1)
        self.assertEqual(sent["counts"][ids[1]], cost(items[1]))              # a thought, as text
        self.assertEqual(sent["counts"][ids[0]], cost(items[0]))
        self.assertEqual(sent["counts"]["c1"] + sent["counts"]["c2"] + sent["counts"][ids[5]] + sent["counts"][ids[6]],
                         sum(cost(c) for c in items[3:7]) + signed_at_first(4000))   # the calls: what is left

    async def test_a_model_s_thought_words_calls_and_responses_are_one_step(self):
        counter = Counter(AntigravityAdaptor())
        items = turn()
        kinds = [e["type"] for e in agy.to_events(items)]
        self.assertEqual(counter.steps_of(items, kinds), [(0, 1), (1, 7), (7, 9)])

    async def test_what_was_counted_is_not_counted_again(self):
        counter, items = Counter(AntigravityAdaptor()), turn()
        await self.run_call(counter, items)
        more = items + [model(text="Anything else?"), user("No.")]
        _, sent = await self.run_call(counter, more, read_id=2)
        self.assertEqual(set(sent["counts"]), {e["id"] for e in agy.to_events(more[-2:])})

    async def test_ag_s_own_items_once_per_text_as_they_are_sent(self):
        counter = Counter(AntigravityAdaptor())
        _, sent = await self.run_call(counter, turn(), ag_items=[(7, "SUMMARY of earlier tasks")])
        self.assertEqual(sent["made"], {"7": cost(ag_message("SUMMARY of earlier tasks"))})
        before = len(self.asked)
        _, sent = await self.run_call(counter, turn(), ag_items=[(8, "SUMMARY of earlier tasks")], read_id=2)
        self.assertEqual(sent["made"], {"8": cost(ag_message("SUMMARY of earlier tasks"))})
        self.assertFalse(any("SUMMARY" in json.dumps(b) for _, _, b in self.asked[before:]))

    async def test_counted_where_agy_s_calls_go_with_its_key(self):
        await self.run_call(Counter(AntigravityAdaptor()), turn())
        headers, name, body = self.asked[0]
        self.assertEqual((name, headers.get("x-goog-api-key")), (MODEL, "k"))
        self.assertEqual(sorted(body["generateContentRequest"]), ["contents", "model", "systemInstruction", "tools"])
        self.assertEqual(body["generateContentRequest"]["model"], f"models/{MODEL}")

    async def test_without_a_key_nothing_is_asked(self):
        self.request.headers = {"Accept": "*/*"}
        client, sent = await self.run_call(Counter(AntigravityAdaptor()), turn())
        self.assertEqual((self.asked, client.asked), ([], []))

    async def test_a_model_the_endpoint_does_not_know_is_not_asked_for_again(self):
        self.unknown_models.add("gemini-reserve")
        self.request.path = "/v1beta/models/gemini-reserve:streamGenerateContent"
        counter, items = Counter(AntigravityAdaptor()), turn()
        await self.run_call(counter, items)
        asked = len(self.asked)
        self.assertFalse(counter.can_count(self.request, body_of(items)))
        self.assertTrue(counter.can_count(SimpleNamespace(path=PATH, upstream=self.url, headers={"x-goog-api-key": "k"}),
                                          body_of(items)))
        await self.run_call(counter, items, read_id=2)
        self.assertEqual(len(self.asked), asked)


class SignatureTest(Base):
    """What the endpoint does not count, the call's own count does: the thought signatures, at a rate a character."""

    async def call(self, counter, items, read_id=1, uncounted=None):
        client = Client()
        out = {"events": agy.to_events(items), "ag_items": [], "read_id": read_id, "basis": None, "uncounted": uncounted}
        counter.sent("g", "c", out, items, [])
        counter.start(self.request, client, "g", {"channel": "c"}, body_of(items), items, items, out)
        counter.reported(self.request, client, "g", "c", read_id, own_count(body_of(items)), body_of(items))
        await counter.close()
        await counter.close()
        return [b for op, b in client.asked if op == "counted"]

    async def test_a_call_s_own_count_prices_its_signatures_and_its_signed_call_again(self):
        counter = Counter(AntigravityAdaptor())
        steps, again = await self.call(counter, turn())
        self.assertEqual(counter.channel("g", "c").rate, 1 / SIG_CHARS)              # 500 tokens over 4,000 characters
        self.assertEqual(set(again["counts"]), {"c1"})                                # the signed call alone
        self.assertEqual(again["counts"]["c1"] - steps["counts"]["c1"], 4000 // SIG_CHARS - signed_at_first(4000))

    async def test_the_count_before_sending_takes_the_signatures_at_the_rate(self):
        counter, body = Counter(AntigravityAdaptor()), body_of(turn())
        self.assertEqual(await counter.exact("g", "c", self.request, body), price(body) + signed_at_first(4000))
        counter.channel("g", "c").rate = 1 / SIG_CHARS
        self.assertEqual(await counter.exact("g", "c", self.request, body), price(body) + 4000 // SIG_CHARS)

    async def test_started_again_old_signatures_set_the_rate_but_are_costed_to_no_new_one(self):
        items = turn() + [model(functionCall={"id": "c3", "name": "read_file", "args": {"Path": "/work/here/c.txt"}},
                                thoughtSignature="Zm9v" * 500),
                          model(functionResponse={"id": "c3", "name": "read_file", "response": {"output": "gamma"}}),
                          user("And c.txt?")]
        new = [e["id"] for e in agy.to_events(items[-3:])]
        counter = Counter(AntigravityAdaptor())                 # a new process: turn() was counted by the last one
        steps, again = await self.call(counter, items, read_id=2, uncounted=new)
        self.assertEqual(counter.channel("g", "c").rate, 1 / SIG_CHARS)              # 750 over all 6,000 characters
        self.assertNotIn("c1", steps["counts"])
        self.assertEqual(again["counts"], {"c3": steps["counts"]["c3"] - signed_at_first(2000) + 2000 // SIG_CHARS})

    async def test_too_few_signature_characters_to_learn_from_leave_the_rate_as_it_was(self):
        items = [user("hi"), model(functionCall={"id": "c9", "name": "read_file", "args": {"Path": "/a"}},
                                   thoughtSignature="Zm9v" * 100),
                 model(functionResponse={"id": "c9", "name": "read_file", "response": {"output": "a"}})]
        counter = Counter(AntigravityAdaptor())
        counted = await self.call(counter, items)
        self.assertIsNone(counter.channel("g", "c").rate)
        self.assertEqual(len(counted), 1)                       # the steps' counts, the signature at the measured rate


class DifferencedTest(unittest.TestCase):
    """No key: the calls' own counts, differenced."""

    def setUp(self):
        self.counter = Counter(AntigravityAdaptor())
        self.request = SimpleNamespace(path=PATH, upstream="https://generativelanguage.googleapis.com", headers={})
        self.client = Client()

    def call(self, items, read_id, tokens, preamble=()):
        out = {"events": agy.to_events(items), "ag_items": [], "read_id": read_id, "basis": None}
        self.counter.sent("g", "c", out, items, list(preamble))

        async def go():
            self.counter.reported(self.request, self.client, "g", "c", read_id, tokens, body_of(items))
            await self.counter.close()
        asyncio.run(go())
        got = [b for op, b in self.client.asked if op == "counted"]
        self.client.asked.clear()
        return got[-1] if got else None

    def test_the_next_call_s_new_items_are_what_the_counts_differ_by(self):
        items, preamble = turn(), [{"name": "systemInstruction", "text": SYSTEM}]
        got = self.call(items[:1], 1, 1000, preamble=preamble)
        self.assertEqual(sum(got["counts"].values()) + sum(p["tokens"] for p in got["preamble_counts"]), 1000)
        got = self.call(items, 2, 1300, preamble=preamble)
        self.assertEqual(set(got["counts"]), {e["id"] for e in agy.to_events(items[1:])})
        self.assertEqual(sum(got["counts"].values()), 300)


@unittest.skipIf(web is None, "the hook server needs aiohttp")
class HookTest(Base):
    """The hook: counted before sending once near the budget, read again when over; counted after."""

    def hook(self, server, **options):
        hook = agy_ag.AntigravityContextManager(ag_clients=AgClients(lambda g: server), log=lambda g, l: None,
                                                files="off", **options)
        hook.sessions = None                              # no record to follow here
        return hook

    def server(self, tokens, budget=100000):
        class Server:
            def __init__(self):
                self.asked = []

            async def request(self, op, body=None, timeout=None):
                if op == "insert":
                    return {"rows": []}
                self.asked.append((op, body))
                if op != "rewrite":
                    return {}
                reads = sum(1 for o, _ in self.asked if o == "rewrite")
                ctx = [{"type": "ag", "name": "earlier", "text": "SUMMARY", "made_id": 3}] + \
                    [{"type": e["type"], "id": e["id"], "payload": e["payload"]} for e in body["events"]]
                return {"context": ctx, "note": "ok", "read_id": reads, "basis": None, "tokens": tokens // 2,
                        "budget": budget, "sent_tokens": tokens}

            async def stop(self):
                pass
        return Server()

    def req(self):
        return SimpleNamespace(method="POST", path=PATH, label="g", upstream=self.url, limit=None, state={}, run=None,
                               headers={"x-goog-api-key": "k"}, body=body_of(turn()))

    async def go(self, hook, req):
        got = await hook(req)
        await asyncio.gather(*list(hook.under_way), return_exceptions=True)
        await hook.counter.close()
        return got

    async def test_the_call_is_sent_then_counted(self):
        server = self.server(tokens=100)
        got = await self.go(self.hook(server), self.req())
        self.assertEqual(got["contents"][0], ag_message("SUMMARY"))
        self.assertEqual([op for op, _ in server.asked], ["rewrite", "counted"])
        counted = server.asked[1][1]
        self.assertEqual(counted["made"], {"3": cost(ag_message("SUMMARY"))})
        self.assertEqual(counted["properties"], {"channel": "73dbf702-17a8-4782-a076-b522c70d64ff"})
        self.assertEqual(len(counted["counts"]), len(turn()))

    async def test_near_the_budget_it_is_counted_first_and_over_it_read_again(self):
        req = self.req()
        whole = price(dict(body_of([ag_message("SUMMARY")] + turn()), model=f"models/{MODEL}"))
        server = self.server(tokens=whole, budget=whole - 5)             # ag's count at the budget's edge
        await self.go(self.hook(server, count="check"), req)
        self.assertEqual([op for op, _ in server.asked], ["rewrite", "measured", "rewrite"])
        self.assertEqual(server.asked[1][1]["tokens"], whole + signed_at_first(4000))   # with the signature
        self.assertEqual(req.state["ag_read"], ("g", 2))

    async def test_far_under_the_budget_nothing_is_counted_before_sending(self):
        server = self.server(tokens=100)
        await self.go(self.hook(server, count="check"), self.req())
        self.assertEqual(self.asked, [])
        self.assertEqual([op for op, _ in server.asked], ["rewrite"])

    async def test_the_call_s_own_count_prices_the_signatures(self):
        server = self.server(tokens=100)
        hook, req = self.hook(server), self.req()
        got = await self.go(hook, req)
        await hook.measured(req, own_count(dict(body_of(turn()), contents=got["contents"])))
        await hook.counter.close()
        await hook.counter.close()
        again = [b for op, b in server.asked if op == "counted"][-1]
        self.assertEqual(hook.counter.channel("g", "73dbf702-17a8-4782-a076-b522c70d64ff").rate, 1 / SIG_CHARS)
        self.assertEqual(set(again["counts"]), {"c1"})

    async def test_counting_off(self):
        server = self.server(tokens=10 ** 6, budget=10)
        await self.go(self.hook(server, count="off"), self.req())
        self.assertEqual(self.asked, [])
        self.assertEqual([op for op, _ in server.asked], ["rewrite"])


if __name__ == "__main__":
    unittest.main()
