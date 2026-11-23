// What an app's panel is told of what an actor asks, and the media type an intent opens (app-said.ts).
import { describe, expect, it } from "vitest";
import { actorOf, askOf } from "../../core/api/testing";
import { askingSaid, folderOfPath, mediaTypeOf } from "./app-said";

describe("askingSaid", () => {
  const ask = askOf({ kind: "permission", id: "p1", input: { cmd: "ls" }, view: { shell: "ls" }, lines: ["x"], at: 5 });
  it("tells what an actor asks, less what only Chat draws", () => {
    const a = actorOf("c", { status: "asking", asking: ask });
    expect(askingSaid(a)).toEqual({
      ask,
      said: { kind: "permission", id: "p1", at: 5, harness: null, async: false, call: null },
    });
  });
  it("tells a question asked as it goes on working, and nothing while it neither asks nor works so", () => {
    const later = actorOf("c", { status: "running", asking: { ...ask, async: true } });
    expect(askingSaid(later).ask).not.toBeNull();
    expect(askingSaid(actorOf("c", { status: "running", asking: ask }))).toEqual({ ask: null, said: {} });
    expect(askingSaid(actorOf("c", { status: "idle" }))).toEqual({ ask: null, said: {} });
  });
});

describe("mediaTypeOf and folderOfPath", () => {
  it("types a file an intent opens by its extension, text for one not known", () => {
    expect(mediaTypeOf("open-file", { path: "/w/paper.TEX" })).toBe("text/x-tex");
    expect(mediaTypeOf("open-file", { path: "/w/notes.md" })).toBe("text/markdown");
    expect(mediaTypeOf("open-file", { path: "/w/data.xyz" })).toBe("text/plain");
    expect(mediaTypeOf("open-url", { path: "/w/a.md" })).toBeUndefined();
    expect(mediaTypeOf("open-file", {})).toBeUndefined();
  });
  it("finds the folder of the file it opens", () => {
    expect(folderOfPath({ path: "/w/sub/a.md" })).toBe("/w/sub");
    expect(folderOfPath(null)).toBeNull();
  });
});
