// An app's actor and a message an app wrote, as the page reads them (asked.ts).
import { describe, expect, it } from "vitest";
import { askedIn, askedOfIn, roleOf, wroteIn, type AskingApp } from "./asked";

const notes: AskingApp = {
  name: "notes",
  label: "Notes",
  mark: true,
  asked: {
    when: "(From my Notes",
    pattern: "^\\(From my Notes, page (.*?), block (\\w+)\\. *\\)\\s*(.*)$",
    otherwise: "A line",
  },
};
const words: AskingApp = { name: "doc", label: "Doc", asked: { when: "[doc]", pattern: "\\[doc\\] (.*)" } };
const broken: AskingApp = { name: "bad", label: "Bad", asked: { when: "[bad]", pattern: "(" } };

describe("an app's actor", () => {
  it("is known by its session's role, in either form", () => {
    expect(roleOf('{"app": "docwriter", "key": "i1"}')).toEqual({ app: "docwriter", key: "i1" });
    expect(roleOf('{"docwriter": "i2"}')).toEqual({ app: "docwriter", key: "i2" });
    expect(roleOf('{"a": "1", "b": "2"}')).toBeNull();
    expect(roleOf("{not json")).toBeNull();
    expect(roleOf("coordinator")).toBeNull();
    expect(roleOf(null)).toBeNull();
  });
});

describe("a message an app wrote", () => {
  it("is known by its words, and says what in the app it is about", () => {
    const text = "(From my Notes, page Plans, block abc.) water the plants";
    const got = wroteIn([words, notes], text);
    expect(got?.app.name).toBe("notes");
    expect(got?.m?.slice(1)).toEqual(["Plans", "abc", "water the plants"]);
    expect(askedOfIn([notes], text)).toEqual({ app: "notes", item: "water the plants" });
    expect(askedOfIn([words], "[doc] hello")).toBeNull(); // no third group
    expect(wroteIn([notes], "plain")).toBeNull();
    expect(wroteIn([notes], 3)).toBeNull();
  });

  it("is shown in the list by the user's words, else the app's `otherwise`, else as it is", () => {
    expect(askedIn([words], "[doc] hello")).toBe("hello");
    expect(askedIn([notes], "(From my Notes, but not as its pattern says")).toBe("A line");
    expect(askedIn([words], "just words")).toBe("just words");
    expect(askedIn([words], null)).toBeNull();
    expect(askedIn([broken, words], "[bad] [doc] x")).toBe("x"); // a pattern that does not compile: the next app
  });
});
