// The Details panel drawn by its mount (mount.tsx), as the page draws it for an actor: its parts, the chips and items of
// the context, a read picked on the size chart; and its parts as nodes, for the reader's own views.
import { act, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../../core/api/query";
import { actorOf, buildOf, contextOf, harnessInfoOf, homeOf, itemOf, readOf, usageOf } from "../../core/api/testing";
import { useShown } from "../../core/model/items";
import { key } from "../../core/model/keys";
import { contextItemNode, detailsShown, drawDetails, typeChipsNode } from "./mount";
import { contextKey, usePicked } from "./store";
import type { Agent, Context, DetailsFeed, Read } from "./types";

const ACTOR = key("demo", "c1");

const read = (read_id: number, at: number): Read => ({ ...readOf(read_id, { at }), counted_tokens: 1000 * read_id });

const agent = (): Agent => ({
  gatherer: "demo",
  channel: "c1",
  harness: "claude",
  reads: [read(1, 100), read(2, 200)],
  pending: [],
  typed: [],
  after_read: [],
  usage: usageOf({
    entries: [{ group: "Recent history", name: "user_message", tokens: 30, items: 2 }],
    tokens: 30,
    calls: 2,
  }),
  tasks: [],
  builds: [buildOf(1, { status: "failed", started: 10, finished: 20, error: "no model", reason: "asked" })],
  checks: [],
  rebuilds: 0,
  llm: { by_purpose: [], total: { calls: 0, tokens_in: 0, tokens_out: 0, errors: 0, cost: 0, unpriced: 0 }, calls: [] },
  llm_attributed_by_time: 0,
});

const context = (read_id: number, text: string): Context =>
  contextOf(read_id, {
    at: 100 * read_id,
    tokens: 30,
    items: [
      itemOf({ group: "Recent history", name: "user_message", tokens: 10, row_id: 1, text }),
      itemOf({ group: "Recent history", name: "tool_call", tokens: 20, row_id: 2, text: "ls" }),
    ],
  });

const feed = (over: Partial<DetailsFeed> = {}): DetailsFeed => ({
  key: ACTOR,
  info: actorOf("c1", { harness: "claude", cwd: "/w" }),
  agent: agent(),
  home: homeOf({ harness_info: { claude: harnessInfoOf({ label: "Claude Code", runs: true }) } }),
  snapshot: false,
  views: [{ id: "messages", name: "Messages", description: "One row each." }],
  current: "files",
  now: 1000,
  ...over,
});

function drawn(f: DetailsFeed = feed(), showView = vi.fn()) {
  queryClient.setQueryData(contextKey("demo", 2), context(2, "the latest"));
  detailsShown([f.key]);
  const node = drawDetails(f, { showView });
  document.body.append(node);
  return { node, showView };
}

afterEach(() => {
  document.body.replaceChildren();
  queryClient.clear();
  usePicked.setState({ picks: {} });
  useShown.setState({ types: new Set(["user_message", "agent_message", "gatherer"]) });
  vi.unstubAllGlobals();
});

describe("the Details panel", () => {
  it("is one panel: the other views, the facts, then the actor, its context and the Gatherer's work", () => {
    const { node, showView } = drawn();
    expect(node.matches("aside.drawer[role=complementary][aria-label=Details]")).toBe(true);
    expect(node.querySelector(".drawer-head h2")!.textContent).toBe("Details");
    expect([...node.querySelectorAll(".drawer-part > h4")].map((h) => h.firstChild!.textContent)).toEqual([
      "Actor",
      "Context",
      "Gatherer",
    ]);
    expect([...node.querySelectorAll(".facts dt")].map((d) => d.textContent)).toEqual([
      "Harness",
      "Gatherer",
      "Channel",
      "Directory",
      "Chat",
    ]);
    expect(node.querySelector(".facts")!.textContent).toContain("Claude Code");
    fireEvent.click(node.querySelector(".more-views button")!);
    expect(showView).toHaveBeenCalledWith("messages");
    expect(node.querySelector("#details-gatherer .desc-cell")!.textContent).toBe("no model");
  });

  it("says why there is nothing to show for an actor with no calls", () => {
    const { node } = drawn(feed({ agent: { error: "no database for gatherer 'demo'" } }));
    expect(node.querySelector(".empty")!.textContent).toBe("no database for gatherer 'demo'");
    expect(drawn(feed({ agent: null })).node.querySelector(".empty")!.textContent).toBe("No data for this actor.");
  });

  it("lists the latest context's items the types shown let through, and the chips change them", () => {
    const { node } = drawn();
    expect(node.querySelector("#details-context h3")!.textContent).toBe("Context right now");
    const names = () => [...node.querySelectorAll(".ctx details.item .kind")].map((n) => n.textContent);
    expect(names()).toEqual(["user_message"]);
    const chip = [...node.querySelectorAll<HTMLButtonElement>(".filters .chip")].find((b) =>
      b.textContent!.startsWith("Tool call"),
    )!;
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(names()).toEqual(["user_message", "tool_call"]);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows an item's whole text once it is opened, and keeps it open as the panel is drawn again", async () => {
    const { node } = drawn();
    const row = node.querySelector<HTMLDetailsElement>(".ctx details.item")!;
    expect(row.querySelector("pre")).toBeNull();
    row.open = true;
    fireEvent(row, new Event("toggle"));
    await waitFor(() => expect(row.querySelector("pre")!.textContent).toBe("the latest"));
    drawDetails(feed(), { showView: vi.fn() });
    expect(node.querySelector(".ctx details.item")).toBe(row);
    expect(row.open).toBe(true);
  });

  it("shows the context of a read picked on the size chart, fetched first, and goes back to the latest", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(url);
      return new Response(JSON.stringify(context(1, "the first")));
    });
    const { node } = drawn();
    await act(async () => {
      fireEvent.click(node.querySelector("#size-chart rect")!); // the nearest read: the first, in a box with no size
    });
    await waitFor(() => expect(node.querySelector("#details-context h3")!.textContent).toBe("Context at read 1"));
    expect(fetched).toEqual(["/api/context?gatherer=demo&read_id=1"]);
    expect(node.querySelector(".ctx details.item .preview")!.textContent).toBe("the first");
    await act(async () => {
      fireEvent.click(node.querySelector(".card-title button")!);
    });
    await waitFor(() => expect(node.querySelector("#details-context h3")!.textContent).toBe("Context right now"));
    // another actor shown in its place: the pick let go of
    usePicked.getState().pick(ACTOR, 1);
    detailsShown([key("demo", "c2")]);
    expect(usePicked.getState().picks).toEqual({});
  });
});

describe("its parts as nodes", () => {
  it("draws an item's row, whole once opened, in a node of its own", async () => {
    const row = contextItemNode(
      itemOf({ group: "Recent history", name: "agent_message", tokens: 3, text: "", clipped: 0 }),
    );
    expect(row.matches("details.item")).toBe(true);
    expect(row.querySelector(".preview.none")!.textContent).toBe("no text");
    row.open = true;
    fireEvent(row, new Event("toggle"));
    await waitFor(() => expect(row.querySelector("pre")!.textContent).toBe("(no text)"));
  });

  it("draws the chips, a click on one changing the types shown", () => {
    const chips = typeChipsNode(null);
    expect(chips.matches(".filters[role=group]")).toBe(true);
    expect(chips.getAttribute("aria-label")).toBe("Message types shown");
    const user = [...chips.querySelectorAll("button")].find((b) => b.textContent === "User")!;
    document.body.append(chips);
    fireEvent.click(user);
    expect(useShown.getState().types.has("user_message")).toBe(false);
  });
});
