// The Messages view drawn by its mount, and the history feed it lists (events.ts).
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { historyItemOf } from "../../core/api/testing";
import { useShown } from "../../core/model/items";
import { key } from "../../core/model/keys";
import { eventsOf, loadEvents, useEvents } from "./events";
import { drawMessages } from "./mount";
import type { HistoryItem } from "./types";

const ACTOR = key("demo", "c1");
const item = (row_id: number | null, name: string, text = name): HistoryItem =>
  historyItemOf({ group: "Pending", name, tokens: 2, row_id, text });

afterEach(() => {
  useShown.setState({ types: new Set(["user_message", "agent_message", "gatherer"]) });
  useEvents.setState({ feed: null });
  vi.unstubAllGlobals();
});

describe("the Messages view", () => {
  it("lists the events of the types shown, counted, each row kept while it is the same", () => {
    const items = [item(1, "user_message"), item(2, "tool_call"), item(3, "agent_message")];
    const node = drawMessages(
      { key: ACTOR, items, pending: [item(null, "agent_message")], queued: [], noneYet: "None." },
      "Messages",
    );
    expect(node.matches("div.chat-frame.ctx#chat-list")).toBe(true);
    expect(node.querySelector(".run")!.textContent).toBe("Messages4 messages (3 shown) and 8 tokens (6 shown)");
    const rows = () => [...node.querySelectorAll("details.item")];
    const first = rows()[0];
    expect(rows().map((r) => r.querySelector(".kind")!.textContent)).toEqual([
      "user_message",
      "agent_message",
      "agent_message",
    ]);
    useShown.getState().toggle("tool_call");
    drawMessages({ key: ACTOR, items, pending: [], queued: [], noneYet: "None." }, "Messages");
    expect(rows().map((r) => r.querySelector(".kind")!.textContent)).toEqual([
      "user_message",
      "tool_call",
      "agent_message",
    ]);
    expect(rows()[0]).toBe(first);
  });

  it("says there is nothing yet, or what waits", () => {
    const node = drawMessages({ key: ACTOR, items: [], pending: [], queued: [], noneYet: "None." }, "Messages");
    expect(node.querySelector(".desc")!.textContent).toBe("None.");
    drawMessages({ key: ACTOR, items: [], pending: [], queued: ["later"], noneYet: "None." }, "Messages");
    expect(node.querySelector(".desc")).toBeNull();
    expect(node.querySelector(".queued")!.textContent).toBe("Waiting for the turn to end: later");
    fireEvent.click(node);
  });
});

describe("the history feed", () => {
  it("adds only the rows after the last kept, and replaces what is pending", async () => {
    const pages = [
      { items: [item(1, "user_message"), item(2, "agent_message"), item(null, "agent_message", "p1")] },
      { items: [item(2, "agent_message"), item(3, "user_message"), item(null, "agent_message", "p2")] },
    ];
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify(pages[asked.length - 1]));
    });
    await loadEvents(ACTOR);
    await loadEvents(ACTOR);
    const f = eventsOf(ACTOR)!;
    expect(f.items.map((i) => i.row_id)).toEqual([1, 2, 3]);
    expect(f.pending.map((i) => i.text)).toEqual(["p2"]);
    expect(asked).toEqual([
      "/api/history?gatherer=demo&channel=c1&from=1",
      "/api/history?gatherer=demo&channel=c1&from=3",
    ]);
  });
});
