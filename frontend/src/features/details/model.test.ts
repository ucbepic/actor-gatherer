// What the Details panel's cards show, worked out (model.ts): a context's runs and the items the types shown let through,
// how it divides, and the latest context with what the next call carries.
import { describe, expect, it } from "vitest";
import { contextOf, itemOf } from "../../core/api/testing";
import { NOT_COUNTED, PREAMBLE } from "../../core/model/items";
import { contextEntries, contextRows, counted, ctxKey, divide, rowKey, tally, typeCounts, withPending } from "./model";
import type { Agent, Context, Item } from "./types";

const item = (over: Partial<Item>): Item => itemOf({ tokens: 1, ...over });

const ctx = (over: Partial<Context> = {}): Context => ({
  ...contextOf(3),
  at: 100,
  tokens: 60,
  items: [
    item({ group: "ag's sections", name: "summary", tokens: 10, made_id: 1, text: "what came before" }),
    item({ name: "user_message", tokens: 20, row_id: 5, text: "hello" }),
    item({ group: "File-change notices", name: "file_change", tokens: 5, made_id: 2, text: "a.py changed" }),
    item({ name: "tool_call", tokens: 25, row_id: 6, text: "ls" }),
  ],
  ...over,
});

const heads = (rows: ReturnType<typeof contextRows>) =>
  rows.map((r) => (r.kind === "head" ? `${r.name}: ${r.text}` : r.kind === "item" ? r.item.name : "note"));

describe("a context's rows", () => {
  it("heads each run of one kind, ag's messages among the history in the run they sit in", () => {
    const rows = contextRows(ctx(), new Set(["user_message", "gatherer"]));
    expect(heads(rows)).toEqual([
      "Summarized history: 1 item and 10 tokens",
      "summary",
      "Recent raw history: 3 items (2 shown) and 50 tokens (25 shown)",
      "user_message",
      "file_change",
    ]);
  });

  it("lists the preamble's parts first, only when chosen; and what ag did not count last", () => {
    const pre = [item({ group: PREAMBLE, name: "system prompt", tokens: 7 })];
    const without = heads(contextRows(ctx({ preamble: pre, not_counted: 60000 }), new Set()));
    expect(without[0]).toBe(
      `${PREAMBLE}: 1 part (0 shown) and 7 tokens (0 shown) · what the harness sent besides its messages`,
    );
    expect(without.slice(-2)).toEqual([`${NOT_COUNTED}: 60,000 tokens`, "note"]);
    const shown = heads(contextRows(ctx({ preamble: pre }), new Set(["preamble"])));
    expect(shown.slice(0, 2)).toEqual([
      `${PREAMBLE}: 1 part and 7 tokens · what the harness sent besides its messages`,
      "system prompt",
    ]);
  });

  it("keys each item by its row, made item or name, counting on the same again; drawn anew when it changes", () => {
    const seen = new Map<string, number>();
    expect(ctxKey({ row_id: 5 }, seen)).toBe("r5");
    expect(ctxKey({ made_id: 2 }, seen)).toBe("m2");
    expect(ctxKey({ group: "Pending", name: "agent_message", at: 9 }, seen)).toBe("Pending:agent_message:9");
    expect(ctxKey({ group: "Pending", name: "agent_message", at: 9 }, seen)).toBe("Pending:agent_message:9#2");
    expect(rowKey("r5", item({ tokens: 3, text: "abc" }))).not.toBe(rowKey("r5", item({ tokens: 3, text: "abcd" })));
  });
});

describe("how a context divides", () => {
  it("adds up by kind, in their order, and by part", () => {
    const { total, kinds } = divide(contextEntries(ctx()));
    expect(total).toBe(60);
    expect(kinds.map((k) => [k.group, k.tokens, k.items])).toEqual([
      ["Recent history", 50, 3],
      ["ag's sections", 10, 1],
    ]);
    expect([...kinds[0].parts.values()].map((p) => [p.label, p.tokens])).toEqual([
      ["User", 20],
      ["Gatherer messages", 5],
      ["Tool call", 25],
    ]);
  });

  it("counts the types for the chips; none when there is nothing to choose", () => {
    expect(typeCounts(ctx())).toEqual({ preamble: 0, gatherer: 2, user_message: 1, tool_call: 1 });
    expect(typeCounts(ctx({ items: [item({ group: "Pending" })] }))).toBeNull();
  });
});

describe("the latest context", () => {
  const agent = { after_read: [item({ name: "agent_message", tokens: 4, group: "Stored since the latest call" })] };
  it("carries what was stored since the latest call, as its recent history", () => {
    const got = withPending(ctx(), agent as unknown as Agent, true)!;
    expect(got.items.at(-1)).toMatchObject({ name: "agent_message", group: "Recent history", position: 4 });
    expect(got.tokens).toBe(64);
  });
  it("leaves an earlier call's as it was", () => {
    expect(withPending(ctx(), agent as unknown as Agent, false)!.items).toHaveLength(4);
  });
});

describe("the counts", () => {
  it("say what the filters leave shown", () => {
    expect(tally(3, 3, 1200, 1200)).toBe("3 items and 1,200 tokens");
    expect(tally(1, 0, 5, 0, "message")).toBe("1 message (0 shown) and 5 tokens (0 shown)");
  });
  it("count each read as ag counted it then, else as stored now", () => {
    const reads = [
      { recorded_tokens: 10, sent_tokens: 4, preamble_tokens: 1, counted_tokens: null as number | null },
      { recorded_tokens: null, sent_tokens: 4, preamble_tokens: 1, counted_tokens: null as number | null },
      { recorded_tokens: null, sent_tokens: null, preamble_tokens: 1, counted_tokens: 0 as number | null },
    ];
    counted(reads);
    expect(reads.map((r) => r.counted_tokens)).toEqual([10, 5, null]);
  });
});
