// Markdown as the page draws a message, and a harness's reply block in it: codex's plan, the text between
// <proposed_plan> and </proposed_plan>, each tag on a line of its own as codex's Plan mode writes them; a tag named in a
// sentence is only words.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { homeOf } from "../api/testing";
import type { HarnessInfo } from "../api/types";
import { useDashboard } from "../store";
import { codeFolded, fence } from "./highlight/fence";
import { markdown, splitReply, unplanned } from "./md";
import { loadVendored } from "./testing";

/** The harnesses' reply blocks as harness_kit has them (tests/test_dashboard_plan.py checks that they are). */
const HARNESS_INFO = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "harness-info.json"), "utf8")) as Record<
  string,
  HarnessInfo
>;

beforeAll(() => {
  loadVendored();
  useDashboard.getState().setHome(homeOf({ harness_info: HARNESS_INFO }));
});
afterEach(() => codeFolded.clear());

/** A text as markdown() splits it: [before, the plan, after] or null; and its summary line. */
const run = (t: string) => {
  const r = splitReply(t);
  return [r && [r.before, r.inner, r.after], unplanned(t)];
};

describe("a harness's reply block", () => {
  it("is a plan as codex writes it, with words around it", () => {
    const [parts, summary] = run(
      "Here it is.\n\n<proposed_plan>\n## Plan\n- a\n</proposed_plan>\n\nSay if it should change.",
    );
    expect(parts).toEqual(["Here it is.", "## Plan\n- a", "Say if it should change."]);
    expect(summary).toBe("Here it is.\n\n## Plan\n- a\n\nSay if it should change.");
  });

  it("runs to the end while it is still streaming", () => {
    const [parts] = run("<proposed_plan>\n1. Create hello.txt.\n2. Wri");
    expect(parts).toEqual(["", "1. Create hello.txt.\n2. Wri", ""]);
  });

  it("is not a tag named in a sentence", () => {
    // an answer about codex (2026-10-26, dce93434): its list cut off at "so `", the rest drawn as a plan
    const text = "- **Codex:** so `<proposed_plan>` arrives as its own `plan` item.\n- raw `<proposed_plan>` text;";
    expect(run(text)).toEqual([null, text]);
  });

  it("is drawn as a card headed as the harness heads it, what is around it as it is", () => {
    const box = markdown("Here.\n\n<proposed_plan>\n## Plan\n- a\n</proposed_plan>");
    expect(box.className).toBe("md");
    expect([...box.children].map((n) => n.className)).toEqual(["md", "proposed-plan"]);
    const card = box.children[1];
    expect(card.children[0].outerHTML).toBe('<div class="pp-head">Proposed plan</div>');
    expect(card.children[1].innerHTML).toBe("<h2>Plan</h2>\n<ul>\n<li>a</li>\n</ul>\n");
  });
});

describe("markdown", () => {
  it("draws a message's markdown in a box of its own", () => {
    expect(markdown("# Hi\n\nSome *text*, `code`.").outerHTML).toBe(
      '<div class="md"><h1>Hi</h1>\n<p>Some <em>text</em>, <code>code</code>.</p>\n</div>',
    );
  });

  it("shows raw HTML as the agent wrote it, and opens links apart", () => {
    const box = markdown('<b>bold</b> <img src=x onerror="alert(1)"> [a](https://example.com)');
    expect(box.querySelector("b, img")).toBeNull();
    expect(box.textContent).toContain('<b>bold</b> <img src=x onerror="alert(1)">');
    expect(box.querySelector("a")!.outerHTML).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">a</a>',
    );
  });

  it("colours a fenced block, and keeps each line break of text written as lines", () => {
    expect(markdown("```python\nx = 1\n```").innerHTML).toBe(
      `<div class="code-box">${fence("x = 1", "python").inner}</div>\n`,
    );
    expect(markdown("a\nb").innerHTML).toBe("<p>a\nb</p>\n");
    expect(markdown("a\nb", true).innerHTML).toBe("<p>a<br>b</p>\n");
  });

  it("draws a block folded by a click folded again", () => {
    const text = "a\n".repeat(8) + "a";
    codeFolded.add(fence(text).fold!);
    const box = markdown("```\n" + text + "\n```").querySelector(".code-box")!;
    expect(box.className).toBe("code-box folded");
    expect(box.querySelector(".code-fold")!.textContent).toBe("Unfold");
  });

  it("without marked and DOMPurify, shows the text as it is", async () => {
    vi.resetModules();
    const { marked, DOMPurify } = window;
    delete window.marked;
    try {
      const fresh = await import("./md");
      expect(fresh.markdown("# *a*").outerHTML).toBe('<div class="md" style="white-space: pre-wrap;"># *a*</div>');
      expect(fresh.markdownHtml("# *a*")).toBeNull();
    } finally {
      Object.assign(window, { marked, DOMPurify });
    }
  });
});

describe("a link in a message", () => {
  const link = (md: string) => markdown(md).querySelector("a");

  it("to a web page opens apart", () => {
    const a = link("See [the docs](https://example.org/a).");
    expect(a?.getAttribute("href")).toBe("https://example.org/a");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.classList.contains("ag-link")).toBe(false);
  });

  it("to something in an app is kept, marked with its app's mark, for the page to open", () => {
    const a = link("Added to [your To dos](ag://notes/page/k3p9x2wq#b8k2).");
    expect(a?.getAttribute("href")).toBe("ag://notes/page/k3p9x2wq#b8k2");
    expect(a?.classList.contains("ag-link")).toBe(true);
    expect(a?.dataset.app).toBe("notes");
    expect(a?.getAttribute("style")).toBe('--ag-mark: url("/apps/mark/notes.svg")');
    expect(a?.hasAttribute("target")).toBe(false);
  });

  it("to a file -- a path, or file:// -- is kept, marked for the page to open in an app that shows files", () => {
    for (const href of ["src/parser.py#L12", "/work/plan.md", "./a.txt", "../b/c.md:3", "file:///work/plan.md"]) {
      const a = link(`See [it](${href}).`);
      expect(a?.getAttribute("href")).toBe(href);
      expect(a?.hasAttribute("data-path")).toBe(true);
      expect(a?.hasAttribute("target")).toBe(false);
    }
    for (const href of ["https://example.org/a", "#top", "mailto:a@b.org", "//example.org/x"])
      expect(link(`[x](${href})`)?.hasAttribute("data-path")).toBe(false);
  });

  it("of any other scheme is dropped, as before", () => {
    expect(link("[x](javascript:alert(1))")?.hasAttribute("href")).toBe(false);
    expect(link("[x](page:k3p9x2wq)")?.hasAttribute("href")).toBe(false);
    expect(link('[x](ag://Notes"onclick=1/x)')?.classList.contains("ag-link")).toBe(false);
  });
});
