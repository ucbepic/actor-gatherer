"""The hook server's model trace: every model call as the MODEL saw it -- the body forwarded
upstream, after the hook changed it -- and what the model answered, in the layout of codex's
rollout trace (CODEX_ROLLOUT_TRACE_ROOT), so the two can be read side by side:

    <root>/trace-<trace id>/manifest.json
                            trace.jsonl       one event per line: {schema_version, seq,
                                              wall_time_unix_ms, rollout_id, thread_id, payload}
                            payloads/<n>.json each request and response, whole

The events take codex's names: rollout_started; for each model call inference_started (its
request, `request_payload`) and inference_completed (its answer, `response_payload`: response_id,
token_usage in codex's keys, output_items); rollout_ended when the server stops. A model call is a
POST with a JSON object body; each event also says the request's number (the --log-dir file's),
its URL label, whether the hook changed it, and the thread its thread header names, if any
(the hook server's --thread-header). The answer is read from the
relayed bytes: a Responses API stream's `response.completed` (or failed / incomplete) event, an
Anthropic Messages API stream (its content blocks put together from their deltas, its usage from
`message_start` and `message_delta`), a Gemini API stream (`streamGenerateContent?alt=sse`: its parts
put together from their chunks, each a content of its own, as Antigravity sends them back), or any of
these APIs' JSON body; anything else is kept as text.
While an answer still streams, `streamed_of` reads the parts of it that are complete.
"""

import itertools
import json
import os
import time
import uuid
from typing import Any, Optional

SCHEMA_VERSION = 1
FINAL_EVENTS = ("response.completed", "response.failed", "response.incomplete")


def _ms() -> int:
    return int(time.time() * 1000)


def token_usage(usage: Optional[dict]) -> Optional[dict]:
    """A Responses API `usage` in codex's trace keys."""
    if not isinstance(usage, dict):
        return None
    inp = (usage.get("input_tokens_details") or {})
    out = (usage.get("output_tokens_details") or {})
    return {"input_tokens": usage.get("input_tokens"), "cached_input_tokens": inp.get("cached_tokens") or 0,
            "cache_write_input_tokens": inp.get("cache_write_tokens") or 0,
            "output_tokens": usage.get("output_tokens"),
            "reasoning_output_tokens": out.get("reasoning_tokens") or 0, "total_tokens": usage.get("total_tokens")}


def anthropic_usage(usage: Optional[dict]) -> Optional[dict]:
    """An Anthropic Messages API `usage` in codex's trace keys: input tokens counted with the cached
    and the cache-written ones, as the Responses API counts them."""
    if not isinstance(usage, dict):
        return None
    cached, written = usage.get("cache_read_input_tokens") or 0, usage.get("cache_creation_input_tokens") or 0
    inp = (usage.get("input_tokens") or 0) + cached + written
    out = usage.get("output_tokens") or 0
    return {"input_tokens": inp, "cached_input_tokens": cached, "cache_write_input_tokens": written,
            "output_tokens": out, "reasoning_output_tokens": 0, "total_tokens": inp + out}


def anthropic_response(events: list, ended: bool = False) -> Optional[dict]:
    """The answer an Anthropic Messages API stream's events make, or None if they are not one:
    {response_id, status (the stop reason), token_usage, output_items (the content blocks)} --
    with `ended`, only the blocks that have ended (`content_block_stop`), of a stream still going."""
    start = next((e for e in events if e.get("type") == "message_start"), None)
    if start is None:
        return None
    message = start.get("message") or {}
    usage = dict(message.get("usage") or {})
    blocks, partial, stop, error, stopped = {}, {}, None, None, set()
    for e in events:
        kind = e.get("type")
        if kind == "content_block_start":
            blocks[e.get("index")] = dict(e.get("content_block") or {})
        elif kind == "content_block_stop":
            stopped.add(e.get("index"))
        elif kind == "content_block_delta":
            b, d = blocks.setdefault(e.get("index"), {}), e.get("delta") or {}
            if d.get("type") == "text_delta":
                b["text"] = b.get("text", "") + (d.get("text") or "")
            elif d.get("type") == "thinking_delta":
                b["thinking"] = b.get("thinking", "") + (d.get("thinking") or "")
            elif d.get("type") == "signature_delta":
                b["signature"] = b.get("signature", "") + (d.get("signature") or "")
            elif d.get("type") == "input_json_delta":
                partial[e.get("index")] = partial.get(e.get("index"), "") + (d.get("partial_json") or "")
        elif kind == "message_delta":
            stop = (e.get("delta") or {}).get("stop_reason") or stop
            usage.update({k: v for k, v in (e.get("usage") or {}).items() if v is not None})
        elif kind == "error":
            error = e.get("error")
    for i, raw in partial.items():
        try:
            blocks[i]["input"] = json.loads(raw) if raw else {}
        except ValueError:
            blocks[i]["input"] = raw
    return {"response_id": message.get("id"), "status": stop or message.get("stop_reason"),
            "token_usage": anthropic_usage(usage), "error": error,
            "output_items": [blocks[i] for i in sorted(blocks) if not ended or i in stopped]}


def gemini_usage(usage: Optional[dict]) -> Optional[dict]:
    """A Gemini API `usageMetadata` in codex's trace keys: its prompt counted with the cached part (as it counts it),
    its output with its thoughts."""
    if not isinstance(usage, dict):
        return None
    inp, cached = usage.get("promptTokenCount") or 0, usage.get("cachedContentTokenCount") or 0
    thoughts = usage.get("thoughtsTokenCount") or 0
    out = (usage.get("candidatesTokenCount") or 0) + thoughts
    return {"input_tokens": inp, "cached_input_tokens": cached, "cache_write_input_tokens": 0, "output_tokens": out,
            "reasoning_output_tokens": thoughts, "total_tokens": usage.get("totalTokenCount") or inp + out}


def gemini_response(events: list, ended: bool = False) -> Optional[dict]:
    """The answer a Gemini API stream's chunks make (`candidates`, `usageMetadata`), or None if they are not one:
    {response_id, status (the finish reason), token_usage, output_items, error}. Each output item is a content of one
    part, `{"role": "model", "parts": [part]}` -- a text's chunks joined while they stay text of one kind (thought or
    not), a function call whole, a thought signature kept on the part it came with. With `ended`, only the parts that
    are complete: all of them once the stream says why it finished, else all but the last, which may still grow."""
    events = [e for e in events if "type" not in e]                 # Anthropic's and Responses' events have one
    chunks = [e for e in events if isinstance(e.get("candidates"), list) or isinstance(e.get("usageMetadata"), dict)]
    error = next((e["error"] for e in events if isinstance(e.get("error"), dict)), None)
    if not chunks and error is None:
        return None
    parts, finish, usage, rid = [], None, None, None
    for e in chunks:
        rid = e.get("responseId") or rid
        usage = e.get("usageMetadata") or usage
        candidate = e["candidates"][0] if e.get("candidates") and isinstance(e["candidates"][0], dict) else {}
        finish = candidate.get("finishReason") or finish
        for p in (candidate.get("content") or {}).get("parts") or []:
            if not isinstance(p, dict) or p == {"text": ""}:          # the last chunk's, with its finish reason
                continue
            last = parts[-1] if parts else None
            if (last is not None and "text" in p and "text" in last and "functionCall" not in last
                    and bool(p.get("thought")) == bool(last.get("thought")) and "thoughtSignature" not in last):
                last["text"] += p["text"]
                if "thoughtSignature" in p:
                    last["thoughtSignature"] = p["thoughtSignature"]
            elif last is not None and set(p) == {"text", "thoughtSignature"} and not p["text"]:
                last["thoughtSignature"] = p["thoughtSignature"]      # a signature on its own: the part before's
            else:
                parts.append(dict(p))
    if ended and finish is None and error is None:
        parts = parts[:-1]
    return {"response_id": rid, "status": finish, "token_usage": gemini_usage(usage), "error": error,
            "output_items": [{"role": "model", "parts": [p]} for p in parts]}


def _events(text: str) -> list:
    """A stream's events: each `data:` line that is a JSON object."""
    events = []
    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        try:
            event = json.loads(line[5:].strip())
        except ValueError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events


def streamed_of(raw: bytes) -> dict:
    """The parts of an answer still streaming that are complete, from the bytes relayed so far:
    {response_id, output_items} -- an Anthropic Messages stream's content blocks that have ended, a
    Gemini stream's parts that are (`gemini_response`), a Responses stream's output items that are done
    (`response.output_item.done`), its id from `response.created`. No items: none is complete yet, or
    the bytes are no stream of these."""
    events = _events(raw.decode("utf-8", errors="replace"))
    found = anthropic_response(events, ended=True) or gemini_response(events, ended=True)
    if found is not None:
        return {"response_id": found["response_id"], "output_items": found["output_items"]}
    made =next((e["response"] for e in events if e.get("type") == "response.created"
                 and isinstance(e.get("response"), dict)), {})
    return {"response_id": made.get("id"), "output_items": [
        e["item"] for e in events if e.get("type") == "response.output_item.done" and isinstance(e.get("item"), dict)]}


def response_of(raw: bytes) -> dict:
    """The model's answer from the bytes relayed back: {response_id, status, token_usage,
    output_items, error} from a Responses, Anthropic Messages or Gemini stream or JSON body; {text}
    when it is none of these."""
    text = raw.decode("utf-8", errors="replace")
    final, items, events = None, [], _events(text)
    for event in events:
        if event.get("type") in FINAL_EVENTS and isinstance(event.get("response"), dict):
            final = event["response"]
        elif event.get("type") == "response.output_item.done" and isinstance(event.get("item"), dict):
            items.append(event["item"])
    found = anthropic_response(events) or gemini_response(events)
    if found is not None:
        return found
    if final is None:
        try:
            body = json.loads(text)
        except ValueError:
            body = None
        if isinstance(body, dict) and isinstance(body.get("candidates"), list):     # a Gemini API body
            return gemini_response([body])
        if isinstance(body, dict) and body.get("type") == "message":          # an Anthropic Messages body
            return {"response_id": body.get("id"), "status": body.get("stop_reason"),
                    "token_usage": anthropic_usage(body.get("usage")), "output_items": body.get("content") or [],
                    "error": None}
        if isinstance(body, dict) and body.get("type") == "error":            # an Anthropic error body
            return {"response_id": None, "status": None, "token_usage": None, "output_items": [],
                    "error": body.get("error")}
        if isinstance(body, dict):
            final = body.get("response") if isinstance(body.get("response"), dict) else body
    if final is None:
        return {"response_id": None, "status": None, "token_usage": None,
                "output_items": items, "text": text if not items else None}
    return {"response_id": final.get("id"), "status": final.get("status"),
            "token_usage": token_usage(final.get("usage")),
            "output_items": final.get("output") or items, "error": final.get("error")}


class ModelTrace:
    """One trace, for the hook server's lifetime, under `root`."""

    def __init__(self, root: str):
        self.trace_id = str(uuid.uuid4())
        self.dir = os.path.join(root, f"trace-{self.trace_id}")
        os.makedirs(os.path.join(self.dir, "payloads"), exist_ok=True)
        self._seq, self._payload = itertools.count(1), itertools.count(1)
        with open(os.path.join(self.dir, "manifest.json"), "w", encoding="utf-8") as fh:
            json.dump({"schema_version": SCHEMA_VERSION, "trace_id": self.trace_id, "source": "hook_server",
                       "started_at_unix_ms": _ms(), "raw_event_log": "trace.jsonl", "payloads_dir": "payloads"},
                      fh, indent=2)
        self._event({"type": "rollout_started", "trace_id": self.trace_id})
        self.closed = False

    def _event(self, payload: dict, thread_id: Optional[str] = None) -> None:
        line = {"schema_version": SCHEMA_VERSION, "seq": next(self._seq), "wall_time_unix_ms": _ms(),
                "rollout_id": self.trace_id, "thread_id": thread_id, "payload": payload}
        with open(os.path.join(self.dir, "trace.jsonl"), "a", encoding="utf-8") as fh:
            fh.write(json.dumps(line, ensure_ascii=False) + "\n")

    def _save(self, obj: Any, kind: str) -> dict:
        n = next(self._payload)
        with open(os.path.join(self.dir, "payloads", f"{n}.json"), "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False)
        return {"raw_payload_id": f"raw_payload:{n}", "kind": {"type": kind}, "path": f"payloads/{n}.json"}

    def started(self, number: int, path: str, label: Optional[str], thread_id: Optional[str],
                body: dict, hooked: bool) -> str:
        """Record a model call's request (what is forwarded); its call id."""
        call_id = str(uuid.uuid4())
        self._event({"type": "inference_started", "inference_call_id": call_id, "request_number": number,
                     "path": path, "label": label, "thread_id": thread_id, "model": body.get("model"),
                     "hooked": hooked, "request_payload": self._save(body, "inference_request")}, thread_id)
        return call_id

    def completed(self, call_id: str, thread_id: Optional[str], http_status: Optional[int], raw: bytes,
                  seconds: float, error: Optional[str] = None) -> None:
        """Record the answer to call `call_id`, from the bytes relayed back."""
        response = response_of(raw)
        self._event({"type": "inference_completed", "inference_call_id": call_id,
                     "response_id": response.get("response_id"), "http_status": http_status,
                     "seconds": round(seconds, 3), "error": error,
                     "response_payload": self._save(response, "inference_response")}, thread_id)

    def close(self) -> None:
        if not self.closed:
            self.closed = True
            self._event({"type": "rollout_ended", "status": "completed"})
