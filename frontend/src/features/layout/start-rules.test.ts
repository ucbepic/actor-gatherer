// What starts where (start-rules.ts): a new actor's directory, the folders a box offers, what a start button names, the
// apps that open with an agent of their own.
import { describe, expect, it } from "vitest";
import { actorOf, appListedOf, sessionOf } from "../../core/api/testing";
import {
  byLabel,
  cwdOf,
  folderPicks,
  foldersOf,
  lastPart,
  opensWithAgent,
  shortDir,
  startCwd,
  startKind,
  withAgentChosen,
} from "./start-rules";
import type { Actor, AppManifest } from "./types";

const actor = (channel: string, cwd: string | null, last: number, session: string | null = null): Actor =>
  actorOf(channel, { cwd, last, ...(session ? { session: sessionOf({ cwd: session }) } : {}) });

describe("directories", () => {
  it("an actor's: its own, else its session's", () => {
    expect(cwdOf(actor("a", "/w/a", 1))).toBe("/w/a");
    expect(cwdOf(actor("a", null, 1, "/w/s"))).toBe("/w/s");
    expect(cwdOf(actor("a", null, 1))).toBe("");
  });
  it("a new actor's: the latest active actor's that has one", () => {
    const g = { agents: [actor("a", "/w/a", 5), actor("b", null, 9), actor("c", "/w/c", 7)] };
    expect(startCwd(g)).toBe("/w/c");
    expect(startCwd({ agents: [] })).toBe("");
  });
  it("the folders its actors work in, newest first, each once, from the home folder; up to five a click away", () => {
    const g = { agents: [actor("a", "/h/x", 1), actor("b", "/h/y", 3), actor("c", "/h/x", 2)] };
    expect(foldersOf(g, "/h")).toEqual(["~/y", "~/x"]);
    expect(folderPicks(["~/x"], "~/x")).toEqual([]);
    expect(folderPicks(["~/x"], "~/y")).toEqual(["~/x"]);
    expect(folderPicks(["1", "2", "3", "4", "5", "6"], "1")).toEqual(["1", "2", "3", "4", "5"]);
    expect(lastPart("~/work/repo/")).toBe("repo");
  });
  it("a long directory by its last two folders", () => {
    expect(shortDir("/Users/someone/workspace/projects/deep/repo")).toBe("…/deep/repo");
    expect(shortDir("~/w/repo")).toBe("~/w/repo");
    expect(shortDir(null)).toBe("");
  });
});

describe("start buttons", () => {
  it("say a terminal, an app with its agent on a harness, or an actor on a harness", () => {
    expect(startKind("shell")).toEqual({ kind: "shell" });
    expect(startKind("app:docwriter:h1")).toEqual({ kind: "app", app: "docwriter", harness: "h1" });
    expect(startKind("app:docwriter:h:2")).toEqual({ kind: "app", app: "docwriter", harness: "h:2" });
    expect(startKind("h1")).toEqual({ kind: "actor", harness: "h1" });
  });
  it("open an app with its agent as the reader chose, where a harness can give it its tools", () => {
    // opened with its agent unless the reader said not (app_settings.py), where it offers one
    const app = (over: Partial<AppManifest>): AppManifest =>
      appListedOf("x", { label: "X", opens_with_agent: true, ...over });
    const offered = { offered: true, name: "X agent" };
    expect(withAgentChosen(app({ agent: offered }))).toBe(true);
    expect(withAgentChosen(app({ agent: offered, opens_with_agent: false }))).toBe(false);
    expect(withAgentChosen(app({}))).toBe(false);
    expect(opensWithAgent(app({ agent: offered }), [])).toBe(false);
    expect(opensWithAgent(app({ agent: offered }), ["h1"])).toBe(true);
    expect([app({ label: "b" }), app({ label: "a" })].sort(byLabel).map((a) => a.label)).toEqual(["a", "b"]);
  });
});
