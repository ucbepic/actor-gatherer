// Which links clicked in a pane the page opens itself (link-rules.ts).
import { describe, expect, it } from "vitest";
import { plainClick, webLink } from "./link-rules";

describe("link-rules", () => {
  const base = "http://127.0.0.1:4200/";
  it("takes a web page outside this dashboard, whole", () => {
    expect(webLink("https://example.com/a?b#c", base)).toBe("https://example.com/a?b#c");
    expect(webLink("http://example.com", base)).toBe("http://example.com/");
  });
  it("leaves this dashboard's own, other schemes, and what is no address", () => {
    expect(webLink("/api/image?x", base)).toBe("");
    expect(webLink("http://127.0.0.1:4200/x", base)).toBe("");
    expect(webLink("mailto:a@b.c", base)).toBe("");
    expect(webLink("file:///etc/hosts", base)).toBe("");
    expect(webLink("http://[", base)).toBe("");
  });
  it("counts a click plain with no key held and the main button (none: the page's own)", () => {
    expect(plainClick(null)).toBe(true);
    expect(plainClick({ button: 0 })).toBe(true);
    expect(plainClick({ button: 1 })).toBe(false);
    for (const k of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) expect(plainClick({ [k]: true })).toBe(false);
  });
});
