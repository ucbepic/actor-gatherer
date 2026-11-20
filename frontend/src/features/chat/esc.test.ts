// Esc in Chat, and a message the harness took back (esc.ts): when the page may type Esc into an actor's terminal, when
// the message taken back is still in the harness's box untouched, and how it is put in Chat's message box and taken out
// again. (These were tests/test_dashboard_esc.py's EscTest, on the old page's code.)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { change, chatOf, useActors } from "./actors";
import { useChatData } from "./data";
import { drafts, keepDraft } from "./drafts";
import { canInterrupt, interrupt, refill, untouched } from "./esc";
import { chatView } from "./testing";
import type { Actor } from "./types";

const A = "g\u0000s";
const TAKEN = { text: "and the columns?", at: 100.0, since: 50.0 };

function actor(
  status = "running",
  { terminal = true, starting = false, taken = null as typeof TAKEN | null, stopped_at = null as number | null } = {},
): Actor {
  return {
    channel: "s",
    status,
    taken_back: taken,
    session: { session_id: "s", terminal, status: starting ? "starting" : "terminal", stopped_at },
  };
}

let posted: unknown[];
// the page's own message box for the actor (not React's): what it shows, as the page puts it there
let box: string;
const boxed = (t: string) => {
  box = t;
};
const put = (info: Actor) => {
  refill(A, info, boxed);
  return [box, drafts()[A] || ""];
};
const type = (t: string) => {
  box = t;
  keepDraft(A, t);
};
/** A reload: the box and the drafts as a new page has them -- what was put kept in the tab, as drafts are. */
const reload = () => {
  box = "";
  sessionStorage.removeItem("ag-dashboard-drafts");
  keepDraft(A, "");
};

beforeEach(() => {
  sessionStorage.clear();
  useActors.setState({ all: new Map() });
  useChatData.setState({ views: new Map() });
  keepDraft(A, "");
  box = "";
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      posted.push([url, JSON.parse(String(init.body))]);
      return new Response("{}", { status: 200 });
    }),
  );
});

describe("Esc", () => {
  it("goes only to an actor at work in a terminal the dashboard runs", () => {
    expect(
      [
        actor("running"),
        actor("asking"),
        actor("idle"), // a build of its context: still idle
        { ...actor("idle"), building: true } as Actor,
        actor("running", { terminal: false }), // no terminal of the dashboard's
        actor("running", { starting: true }), // starting: Esc is "No" to trust
      ].map((a) => canInterrupt(A, a)),
    ).toEqual([true, true, false, false, false, false]);
    // its message sent, not yet stored: the view has the turn opening
    useChatData.getState().take(A, {
      ...chatView([]),
      opening: { text: "hi", began: 1, seen: true },
      current: { state: "opening", turn: "opening" },
    });
    expect(canInterrupt(A, actor("idle"))).toBe(true);
    // or a message sent from here into its terminal, pending
    useChatData.setState({ views: new Map() });
    change(A, () => ({ sends: [{ cid: "p1", text: "hi", at: 1, ran: true }] }));
    expect(canInterrupt(A, actor("idle"))).toBe(true);
  });

  it("is sent once a second", () => {
    const say = vi.fn();
    expect(interrupt(A, actor("running"), say)).toBe(true);
    expect(posted).toEqual([["/api/terminal/input", { session_id: "s", data: "\u001b" }]]);
    expect(interrupt(A, actor("running"), say)).toBe(false);
    expect(interrupt(A, actor("idle"), say)).toBe(false);
    expect(posted.length).toBe(1);
    expect(chatOf(A).interrupting).not.toBeNull();
  });
});

describe("the message taken back", () => {
  it("is untouched while the stop key is the last typed, after the call before", () => {
    expect(
      [
        actor("running", { taken: TAKEN, stopped_at: 60.0 }),
        actor("running", { taken: TAKEN, stopped_at: null }),
        actor("running", { taken: TAKEN, stopped_at: 40.0 }),
        actor("running", { stopped_at: 60.0 }),
      ].map((a) => untouched(A, a)),
    ).toEqual([true, false, false, false]);
  });

  it("is put in the message box once, and not again once cleared, nor after a reload", () => {
    const there = actor("idle", { taken: TAKEN, stopped_at: 60.0 });
    expect(put(there)).toEqual(["and the columns?", "and the columns?"]);
    type("");
    expect(put(there)).toEqual(["", ""]); // cleared: not put back
    reload();
    expect(put(there)).toEqual(["", ""]); // nor after a reload
  });

  it("is taken out once sent or changed in the terminal", () => {
    const there = actor("idle", { taken: TAKEN, stopped_at: 60.0 }),
      gone = actor("idle");
    expect(put(there)).toEqual(["and the columns?", "and the columns?"]);
    expect(put(gone)).toEqual(["", ""]);
  });

  it("is left as it is once changed here, and not put over something written", () => {
    const there = actor("idle", { taken: TAKEN, stopped_at: 60.0 }),
      gone = actor("idle");
    put(there);
    type("and the rows?");
    expect(put(gone)).toEqual(["and the rows?", "and the rows?"]);
    sessionStorage.clear();
    keepDraft(A, "");
    type("my draft");
    expect(put(there)).toEqual(["my draft", "my draft"]);
  });

  it("is not put where it is not in the harness's box", () => {
    expect(put(actor("idle", { taken: TAKEN, stopped_at: null }))).toEqual(["", ""]);
  });
});
