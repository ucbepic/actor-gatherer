"""The tool calls and results in a harness's messages, read by the harness's own rules (harness_kit's `read`, its
parts' `tool` and `result`): the harness given, else whichever harness's rules find calls or results among them. A
call is a ToolCall -- its name, input, what it does and how it is shown (its `view`), which is what the file checks
go by; a result its output as the call printed it (the harness's own lines about the run taken off: `shown`). A
call that runs a script calling other tools (codex's code mode) is one call to its harness, but its script makes
others: `opened` reads them out of it (the harness's `script_results`), for what they do to files."""
from typing import Dict, List, Optional, Tuple

import harness_kit
from harness_kit import MODELS, Harness, ToolCall


def _parts(harness: Harness, items) -> list:
    return harness.read(harness.items([x for x in items or [] if isinstance(x, dict)]))


def reader(items, harness: Optional[Harness] = None) -> Optional[Harness]:
    """The harness whose rules read `items`: `harness`, else the first of harness_kit's whose rules find a tool call
    or a result among them; None: none does."""
    if harness is not None:
        return harness
    for h in harness_kit.HARNESSES.values():
        try:
            if any(p.tool is not None or p.result is not None for p in _parts(h, items)):
                return h
        except Exception:  # noqa: BLE001 - rules that trip on another harness's items do not read them
            continue
    return None


def calls_in(items, harness: Optional[Harness] = None) -> Dict[str, ToolCall]:
    """The tool calls among the messages (or an answer's items), by id, as the harness's rules read them -- the agent's
    own, not a tool the provider ran (`server`: Claude Code's web search)."""
    h = reader(items, harness)
    return {p.tool.id: p.tool for p in _parts(h, items) if p.tool is not None and p.tool.id and not p.tool.server} \
        if h is not None else {}


def results_in(items, harness: Optional[Harness] = None) -> Dict[str, Tuple[str, bool]]:
    """The tool results among the messages, by their call's id: (its output as the call printed it -- the harness's
    own lines about the run taken off --, whether it failed)."""
    h = reader(items, harness)
    return {p.result.call_id: (p.result.output if p.result.shown is None else p.result.shown, p.result.error)
            for p in _parts(h, items) if p.result is not None and p.result.call_id} if h is not None else {}


def opened(calls: Dict[str, ToolCall], results: Optional[Dict[str, Tuple[str, bool]]] = None,
           harness: Optional[Harness] = None):
    """(calls, results): those given, each script among the calls (one whose `calls` its rules read: codex's code
    mode) in place of the calls it makes (the harness's `script_results`: by the script's id, or `<id>#<n>` for
    several), and each of those with its own result, where the script's came in. A script whose calls can't be found,
    or no harness's rules to split it, stays as it is."""
    out_calls, out_results = {}, dict(results or {})
    for cid, call in calls.items():
        inner = harness.script_results(call, out_results.get(cid))[0] if call.calls and harness is not None else []
        if not inner:
            out_calls[cid] = call
            continue
        out_results.pop(cid, None)
        for n, (iid, name, inp, result) in enumerate(inner):
            own = call.calls[n] if n < len(call.calls) else ToolCall(None, name, inp)
            out_calls[iid] = ToolCall(iid, name, inp, own.action, view=own.view)
            if result is not None:
                out_results[iid] = result
    return out_calls, out_results


def last_results(items, harness: Optional[Harness] = None) -> List[str]:
    """The ids of the results the messages end with -- after the last thing the model said (its words, its reasoning,
    a call): those of the calls its last answer made."""
    h = reader(items, harness)
    ids: List[str] = []
    for p in reversed(_parts(h, items) if h is not None else []):
        if p.kind in MODELS:
            break
        if p.result is not None and p.result.call_id:
            ids.append(p.result.call_id)
    return ids[::-1]
