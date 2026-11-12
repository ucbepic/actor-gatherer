"""What a gatherer kept of a harness's sessions before ag's hooks recorded it as events (harness_kit/DESIGN.md, steps
3-5), copied into records once (step 6), so that a reader of the gatherer (the dashboard) reads records alone. Run
as a program -- the dashboard runs it for a gatherer that still has the old tables (ag_dashboard/migrating.py):

    python -m ag.integrations.tools.ag_orchestrator.migrate [<gatherer> ...]     every gatherer's, or these

It asks ag's server for what the old tables kept (its `old_tables`) and inserts the records they stand for (its
`insert`, each at the time the table kept), then says it is done (its `migrated`), so a gatherer is copied once:

    _recaps        recap          {text}                   a channel's, unless it has a `recap` record
    _names         name           {text, by}               a channel's, unless it has a `name` record
    _touches       file_touched   as the hook records one (file_touches' `touched`): the same id, never stored twice
    _pending       reply_part, and its answer's reply_end  a channel's, unless it has a `reply_part` record
    _reads.error   call_failed    {status, error}          by its read, as the hook records one (`failed:<read_id>`)
    _reads.answered_at  reply_end  {}                      a channel's newest answer, when it came: its latest
                                                           activity (`read:<read_id>`, its answer: no parts)
    a channel with no `model_call`:
                   harness        {harness}                the harness its first pieces' shapes tell (`shape_of`:
                                                           pi's and opencode's too), where they tell one

Each in the channel the table named; the tables stay as they were. One line of JSON per gatherer on stdout,
{"gatherer", "copied": {record type: how many}} -- `null` when it was copied before -- or {"gatherer", "error"}; exit
1 when any failed.
"""

import asyncio
import json
import os
import sys
from collections import defaultdict
from typing import Dict, Iterable, List, Optional, Tuple

from harness_kit.codex import SHAPES as CODEX_SHAPES

from ag.integrations.tools.ag_connection.ag_client import AgClient, home
from .adaptor import CHANNEL
from .file_touches import touched
from .records import HARNESS, MODEL_CALL, NAME, RECAP, RECORDS, REPLY_PART, call_failed, reply_end, reply_parts

DONE = "records"            # the copy's name in the gatherer (the server's `migrated`)
SHAPE_READ = 60             # the first pieces of a channel looked at for its harness's shape
BATCH = 500                 # the most events sent in one `insert`
PART_PROPERTIES = ("kind", "words", "action", "call_id")   # a pending event's own properties, kept on its part


def records(old: dict) -> List[Tuple[str, dict, Optional[str]]]:
    """(channel, the record, when) for each thing the old tables kept (`old`: the server's `old_tables`, by CHANNEL: its
    `groups` each channel, with the types among RECORDS it has) that the gatherer has no record of (module doc)."""
    has = {g["value"]: set(g.get("types") or ()) for g in old.get("groups") or []}
    out: List[Tuple[str, dict, Optional[str]]] = []
    for r in old.get("recaps") or []:
        if r.get("session") and RECAP not in has.get(r["session"], ()):
            out.append((r["session"], {"type": RECAP, "id": f"recap:_recaps:{r['recap_id']}", "payload": {"text": r["text"]}},
                        r.get("made_at")))
    for r in old.get("names") or []:
        if r.get("session") and NAME not in has.get(r["session"], ()):
            out.append((r["session"], {"type": NAME, "id": f"name:_names:{r['session']}:{r['by']}",
                                       "payload": {"text": r["text"], "by": r["by"]}}, r.get("named_at")))
    flag = lambda v: None if v is None else bool(v)          # noqa: E731 - as the table keeps them: 1, 0, NULL
    for t in old.get("touches") or []:
        if t.get("session") and t.get("call_id"):
            out.append((t["session"], touched({**t, "checked": flag(t.get("checked")), "named": flag(t.get("named")),
                                               "detail": t.get("detail") or {}}), t.get("at")))
    answers: Dict[Tuple[str, str], List[dict]] = defaultdict(list)
    for p in old.get("pending") or []:
        channel = (p.get("properties") or {}).get(CHANNEL)
        if channel and REPLY_PART not in has.get(channel, ()):
            answers[(channel, p.get("answer") or f"_pending:{p['pending_id']}")].append(p)
    for (channel, answer), rows in answers.items():
        events = [{"type": p["type"], "payload": p["payload"], "text": p.get("text"),
                   "properties": {k: v for k, v in (p.get("properties") or {}).items() if k in PART_PROPERTIES}}
                  for p in rows]
        out += [(channel, part, p.get("received_at")) for part, p in zip(reply_parts(answer, events), rows)]
        if rows[-1].get("stop") != "streaming":       # ended, why (or not said); one still streaming has no end
            out.append((channel, reply_end(answer, rows[-1].get("stop")), rows[-1].get("received_at")))
    for f in old.get("failed") or []:
        channel = (f.get("properties") or {}).get(CHANNEL)
        if channel:
            out.append((channel, call_failed(f["read_id"], f.get("status"), f["error"]), f.get("read_at")))
    for a in old.get("answered") or []:
        channel = (a.get("properties") or {}).get(CHANNEL)
        if channel and REPLY_PART not in has.get(channel, ()):
            out.append((channel, reply_end(f"read:{a['read_id']}", None, a["read_id"]), a.get("answered_at")))
    for g in old.get("groups") or []:                  # each channel, and what it has
        if not {MODEL_CALL, HARNESS} & set(g.get("types") or ()):
            name = shape_of(g.get("payloads") or [])
            if name:
                out.append((g["value"], {"type": HARNESS, "id": f"harness:{g['value']}", "payload": {"harness": name}},
                            g.get("first")))
    return out


def shape_of(payloads: Iterable) -> Optional[str]:
    """The harness a session ran on, as its pieces' shapes tell -- for a channel from before ag's hooks recorded each
    call's harness (`model_call`): codex's Responses items, Claude Code's Anthropic message pieces, pi's messages,
    opencode's {info, parts} messages; None when none of them shows."""
    for p in payloads:
        if not isinstance(p, dict):
            continue
        if "info" in p and ("parts" in p or "sessionID" in (p.get("info") or {})) or "sessionID" in p:
            return "opencode"
        if p.get("type") in CODEX_SHAPES and ("role" in p or "call_id" in p or "summary" in p or "id" in p):
            return "codex"
        blocks = [c for c in p.get("content") or [] if isinstance(c, dict)] if isinstance(p.get("content"), list) else []
        kinds = {c.get("type") for c in blocks}
        if kinds & {"input_text", "output_text"}:
            return "codex"
        if "api" in p or p.get("role") == "toolResult" or kinds & {"toolCall"}:
            return "pi"
        if kinds & {"tool_use", "tool_result", "redacted_thinking"} or p.get("role") == "system":
            return "claude"
    return None


async def migrate(client, gatherer: str) -> Optional[Dict[str, int]]:
    """The gatherer's old tables copied into records through ag's server (`client`, an AgClient): {record type: how
    many}; None when they were copied before. Raises RuntimeError with the server's word when it refuses."""
    old = await client.request("old_tables", {"gatherer": gatherer, "by": CHANNEL, "types": [*RECORDS, HARNESS],
                                              "first": SHAPE_READ})
    if not isinstance(old, dict) or old.get("error"):
        raise RuntimeError(f"old_tables: {old.get('error') if isinstance(old, dict) else old!r}")
    if not old or old.get("migrated"):                # no database, or copied before
        return None
    by_channel: Dict[str, List[dict]] = defaultdict(list)
    counts: Dict[str, int] = defaultdict(int)
    for channel, event, at in records(old):
        by_channel[channel].append({**event, "at": at or None})
        counts[event["type"]] += 1
    for channel, events in by_channel.items():
        for i in range(0, len(events), BATCH):
            got = await client.request("insert", {"gatherer": gatherer, "properties": {CHANNEL: channel},
                                                  "events": events[i:i + BATCH]})
            if not isinstance(got, dict) or got.get("error"):
                raise RuntimeError(f"insert: {got.get('error') if isinstance(got, dict) else got!r}")
    got = await client.request("migrated", {"gatherer": gatherer, "name": DONE})
    if not isinstance(got, dict) or got.get("error"):
        raise RuntimeError(f"migrated: {got.get('error') if isinstance(got, dict) else got!r}")
    return dict(counts)


def gatherers() -> List[str]:
    """Every gatherer of the home with a database -- in the home's one database (`ag home merge`'s), one name for it:
    every gatherer's is that one."""
    root = os.path.join(home(), "gatherers")
    if os.path.isfile(os.path.join(home(), "context.db")):
        listed = sorted(os.listdir(root)) if os.path.isdir(root) else []
        return listed[:1]
    return sorted(n for n in os.listdir(root) if os.path.isfile(os.path.join(root, n, "context.db"))) \
        if os.path.isdir(root) else []


async def main(names: List[str]) -> int:
    client, failed = AgClient("migrate"), 0
    try:
        for name in names or gatherers():
            if name not in gatherers():                  # asked of the server, a name would make a gatherer
                print(json.dumps({"gatherer": name, "error": f"no database for gatherer {name}"}), flush=True)
                failed += 1
                continue
            try:
                print(json.dumps({"gatherer": name, "copied": await migrate(client, name)}), flush=True)
            except Exception as exc:  # noqa: BLE001 - one gatherer's failure is said, the others go on
                print(json.dumps({"gatherer": name, "error": str(exc)}), flush=True)
                failed += 1
    finally:
        await client.stop()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
