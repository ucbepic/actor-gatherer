// An actor on a branch (branch-model.ts): what a folder has checked out, where a branch goes, its changes waiting, a
// source's name, where sources are suggested from.
import { describe, expect, it } from "vitest";
import { actorDirs, branchOf, branchRoute, branchWaiting, checkedOut, projectName } from "./branch-model";
import type { Branch } from "./types";

const branch: Branch = {
  gatherer: "g",
  channel: "c1",
  branch: "ag/c1",
  worktree: "/h/wt/c1",
  project: "/h/repo",
  started_on: "main",
  start: "abcdef123456",
  onto: { head: "abc1234", branch: "main" },
  held: { "a.tex": { n: 2 }, "b.tex": { n: 1 } },
};

describe("branch-model", () => {
  it("finds an actor's branch and counts its changes waiting", () => {
    expect(branchOf([branch], "g", "c1")).toBe(branch);
    expect(branchOf([branch], "g", "c2")).toBeNull();
    expect(branchOf(undefined, "g", "c1")).toBeNull();
    expect(branchWaiting(branch)).toBe(3);
  });
  it("says what a folder has checked out", () => {
    expect(checkedOut({ head: "abc", branch: "main" })).toBe("main");
    expect(checkedOut({ head: "abc", branch: null })).toBe("abc (no branch)");
    expect(checkedOut(null)).toBe("?");
  });
  it("says where a branch came from and where its changes go", () => {
    expect(branchRoute(branch, "/h")).toBe(
      "Branch ag/c1 in ~/wt/c1, from main at abcdef1.\nMerges into ~/repo (on main). Lines you're editing or also changed wait for you.",
    );
    expect(branchRoute({ ...branch, approve: true }, "/h")).toContain("(on main) after you approve each change.");
  });
  it("names a source by its GitHub repository, else its folder's name", () => {
    expect(projectName({ path: "/h/repo", name: "repo", github: "o/repo" })).toBe("o/repo");
    expect(projectName({ path: "/h/repo", name: "repo" })).toBe("repo");
  });
  it("suggests sources from where the actors work, latest first, then the dashboard's own folder", () => {
    const g = {
      agents: [
        { channel: "a", cwd: "/w/a", last: 1 },
        { channel: "b", cwd: "/w/b", last: 2 },
        { channel: "c", last: 3 },
      ],
    };
    expect(actorDirs(g, "/w/dash")).toEqual(["/w/b", "/w/a", "/w/dash"]);
    expect(actorDirs(g, "/w/a")).toEqual(["/w/b", "/w/a"]);
  });
});
