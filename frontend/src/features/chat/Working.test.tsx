// How a turn stopped short, in its harness's own words (harness_kit's `stopped_says`, in core/ui/harness-info.json, which
// test_dashboard_esc.py checks are harness_kit's): each harness's, and plain ones for a harness that says none its own.
// The cases test_dashboard_esc.py ran on the old page's stoppedLine.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { actorOf, homeOf } from "../../core/api/testing";
import type { HarnessInfo, Home } from "../../core/api/types";
import type { Actor, Stopped } from "./types";
import { stoppedLine } from "./Working";

const HARNESS_INFO = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../../core/ui/harness-info.json"), "utf8"),
) as Record<string, HarnessInfo>;
const HOME: Home = homeOf({ harness_info: HARNESS_INFO, harness_default: "claude" });

const line = (info: Partial<Actor>, stopped: Stopped | null, latest: boolean) => {
  const got = stoppedLine(HOME, actorOf("c", info), { stopped }, latest);
  return got && [got.cls, `${got.lead} ${got.said}`];
};

describe("stoppedLine", () => {
  it("says it in each harness's words", () => {
    const claude = { harness: "claude", status: "idle" },
      codex = { harness: "codex", status: "idle" };
    const interrupted = { kind: "interrupted" },
      error = { kind: "error", text: "stream disconnected", status: null };
    expect([
      line(claude, interrupted, false),
      line(codex, interrupted, false),
      line(codex, { ...interrupted, reason: "budget_limited" }, false),
      line(codex, error, false),
      line(claude, { kind: "error", text: null, status: 529 }, false),
      line({ ...claude, status: "error" }, error, true), // the actor's error note says it
      line(claude, null, true),
      line({ harness: null, status: "idle" }, interrupted, false), // from before it was recorded
      line({ harness: "antigravity", status: "idle" }, interrupted, false),
    ]).toEqual([
      ["fl-stopped", "⎿ Interrupted · What should Claude do instead?"],
      ["fl-stopped", "■ Conversation interrupted"],
      ["fl-stopped error", "■ Goal budget reached - the turn was stopped."],
      ["fl-stopped error", "■ stream disconnected"],
      ["fl-stopped error", "⎿ API Error: 529"],
      null,
      null,
      ["fl-stopped", "⎿ Interrupted · What should Claude do instead?"],
      ["fl-stopped", "⎿ Interrupted"],
    ]);
  });

  it("says plain words with no home, or a harness it does not know", () => {
    expect(stoppedLine(null, actorOf("c", { harness: "x" }), { stopped: { kind: "error" } }, false)).toEqual({
      cls: "fl-stopped error",
      lead: "⎿",
      said: "Error",
    });
    expect(line({ harness: "nope" }, { kind: "interrupted", reason: "budget_limited" }, false)).toEqual([
      "fl-stopped",
      "⎿ Interrupted",
    ]);
  });
});
