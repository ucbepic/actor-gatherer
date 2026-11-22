// Markdown in React: the same HTML in the same boxes as the page's markdown(), its code blocks' folding kept.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { HarnessInfo } from "../api/types";
import { useDashboard } from "../store";
import { codeClick, codeFolded, fence } from "./highlight/fence";
import { Markdown } from "./Markdown";
import { markdown } from "./md";
import { loadTex, texLoaded } from "./tex";
import { loadVendored } from "./testing";

const HARNESS_INFO = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "harness-info.json"), "utf8")) as Record<
  string,
  HarnessInfo
>;
const CODE = "a\n".repeat(8) + "a";

beforeAll(() => {
  loadVendored();
  useDashboard.getState().setHome({ home: "/h", now: 0, gatherers: [], harness_info: HARNESS_INFO });
  document.addEventListener("click", codeClick);
});
afterAll(() => document.removeEventListener("click", codeClick));
afterEach(() => {
  cleanup();
  codeFolded.clear();
});

describe("Markdown", () => {
  it("draws what markdown() draws", () => {
    const texts: [string, boolean][] = [
      ["# Hi\n\nSome *text*, `code` and a [link](https://example.com).", false],
      ['<b>raw</b> <img src=x onerror="alert(1)">\n\n| a | b |\n|---|---|\n| 1 | 2 |', false],
      ["```python\ndef f():\n    return 1\n```\n\n```\n" + CODE + "\n```", false],
      ["Here.\n\n<proposed_plan>\n## Plan\n- a\n</proposed_plan>\n\nSay if it should change.", false],
      ["<proposed_plan>\n1. Create hello.txt.\n2. Wri", false],
      ["a report\nwritten as lines", true],
    ];
    for (const [text, breaks] of texts) {
      const { container, unmount } = render(<Markdown text={text} breaks={breaks} />);
      expect(container.innerHTML).toBe(markdown(text, breaks).outerHTML);
      unmount();
    }
  });

  it("draws a block folded before folded, and keeps a click's folding while its text is the same", () => {
    codeFolded.add(fence(CODE).fold!);
    const text = "Look:\n\n```\n" + CODE + "\n```";
    const { container, rerender } = render(<Markdown text={text} />);
    const box = container.querySelector(".code-box")!;
    expect(box.className).toBe("code-box folded");
    fireEvent.click(box.querySelector(".code-fold")!);
    rerender(<Markdown text={text} />);
    expect(container.querySelector(".code-box")).toBe(box);
    expect(box.className).toBe("code-box");
    fireEvent.click(box.querySelector(".code-fold")!);
    rerender(<Markdown text={text + "\n\nMore."} />);
    expect(container.querySelector(".code-box")!.className).toBe("code-box folded");
  });

  it("shows math as written until KaTeX loads, then draws it as markdown() does", async () => {
    const text = "Area: $\\pi r^2$, or\n\n$$\n\\pi r^2\n$$";
    expect(texLoaded()).toBeUndefined();
    const { container } = render(<Markdown text={text} />);
    expect([...container.querySelectorAll(".md-tex")].map((n) => n.textContent)).toEqual([
      "$\\pi r^2$",
      "$$\n\\pi r^2\n$$",
    ]);
    await act(() => loadTex());
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.innerHTML).toBe(markdown(text).outerHTML);
  });

  it("without marked and DOMPurify, shows the text as it is", async () => {
    vi.resetModules();
    const { marked, DOMPurify } = window;
    delete window.marked;
    try {
      const fresh = await import("./Markdown");
      const { container } = render(<fresh.Markdown text="# *a*" />);
      expect(container.innerHTML).toBe('<div class="md" style="white-space: pre-wrap;"># *a*</div>');
    } finally {
      Object.assign(window, { marked, DOMPurify });
    }
  });
});
