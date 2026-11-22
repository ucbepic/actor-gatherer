// LaTeX in a message (tex.ts), as markdown draws it: what is math and what stays words, TeX's own characters kept from
// markdown, KaTeX's drawing kept whole through DOMPurify, a formula it can't read left as written, and a box drawn
// before KaTeX loaded drawn again once it has.
import katex from "katex";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { markdown, markdownHtml, texWaiting } from "./md";
import { loadTex, texLoaded } from "./tex";
import { loadVendored } from "./testing";

beforeAll(() => loadVendored());

/** Each formula drawn in `md`'s box: its TeX (KaTeX's annotation of it) and whether it is displayed. */
const formulas = (md: string, breaks = false) =>
  [...markdown(md, breaks).querySelectorAll(".katex")].map((k) => [
    k.querySelector("annotation")!.textContent,
    !!k.closest(".katex-display"),
  ]);

describe("before KaTeX loads", () => {
  it("shows the math as written, and draws it once KaTeX has loaded", async () => {
    expect(texLoaded()).toBeUndefined();
    const box = markdown("Area: $\\pi r^2$.");
    const shown = box.querySelector(".md-tex")!;
    expect(shown.textContent).toBe("$\\pi r^2$");
    expect(shown.getAttribute("data-tex")).toBe("\\pi r^2");
    expect(texWaiting(box.innerHTML)).toBe(true);
    await loadTex();
    expect(box.querySelector(".md-tex")!.hasAttribute("data-tex")).toBe(false);
    expect(box.querySelector(".katex annotation")!.textContent).toBe("\\pi r^2");
    expect(box.textContent).toMatch(/^Area: /);
  });
});

describe("math in a message", () => {
  beforeAll(() => loadTex());

  it("is found between each pair of delimiters, in a line or displayed", () => {
    expect(formulas("Let $x^2$ and \\(a+b\\) be.")).toEqual([
      ["x^2", false],
      ["a+b", false],
    ]);
    expect(formulas("So:\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nand \\[ e^{i\\pi} = -1 \\]")).toEqual([
      ["\\int_0^1 x\\,dx", true],
      ["e^{i\\pi} = -1", true],
    ]);
    expect(formulas("```math\na^2 + b^2 = c^2\n```")).toEqual([["a^2 + b^2 = c^2", true]]);
    expect(formulas("then $$x = 1$$ holds")).toEqual([["x = 1", true]]); // displayed, in its sentence
  });

  it("is not a price, a shell variable, code, or a dollar escaped", () => {
    for (const md of [
      "It costs $5 and $10 a month.",
      "Between $5-$10.",
      "US$5 or US$6.",
      "Run echo $HOME and $PATH.",
      "Set `$x$` and `$PATH`.",
      "```\nprice=$5$\n```",
      "Not \\$x\\$ here.",
      "A lone $ sign, and $ spaced $.",
      "About $5 per hour, or $40 for a day; it reads its seed from `$SEED`.",
      "It was $40 a day, 2$ a night.",
    ])
      expect([md, markdown(md).querySelector(".md-tex")]).toEqual([md, null]);
  });

  it("starting with a number is math with something of TeX's in it", () => {
    expect(formulas("So $2 + 2 = 4$ and $5 \\cdot 3$ and $3x$.")).toEqual([
      ["2 + 2 = 4", false],
      ["5 \\cdot 3", false],
      ["3x", false],
    ]);
  });

  it("keeps TeX's own characters from markdown", () => {
    const box = markdown("$a_1 * b_2 * c_3$ and $\\{x\\}$");
    expect(box.querySelector("em, strong")).toBeNull();
    expect(formulas("$a_1 * b_2 * c_3$ and $\\{x\\}$")).toEqual([
      ["a_1 * b_2 * c_3", false],
      ["\\{x\\}", false],
    ]);
    expect(formulas("\\[\n\\begin{aligned} a &= b \\\\\n+ c &= d \\end{aligned}\n\\]")).toEqual([
      ["\\begin{aligned} a &= b \\\\\n+ c &= d \\end{aligned}", true],
    ]);
  });

  it("displayed on lines of its own is set apart from the paragraph before it", () => {
    const box = markdown("The sum:\n$$\n\\sum_{i=1}^n i\n$$\nwhich is $n(n+1)/2$.");
    expect([...box.children].map((n) => n.tagName + "." + n.className)).toEqual([
      "P.",
      "DIV.md-tex md-tex-display",
      "P.",
    ]);
  });

  it("is not a formula with a blank line in it, nor one still streaming", () => {
    expect(markdown("$$\na\n\nb\n$$").querySelector(".md-tex")).toBeNull();
    expect(markdown("Next:\n\n$$\n\\sum_{i=1}^").querySelector(".md-tex")).toBeNull();
  });

  it("is drawn as KaTeX draws it, through DOMPurify whole", () => {
    for (const [tex, displayMode] of [
      ["\\sqrt{x^2+1}", false],
      ["\\overrightarrow{AB} \\cdot \\mathbf{n}", true],
      ["\\color{red} a < b \\text{ and } c > d", false],
    ] as const) {
      const t = document.createElement("template");
      t.innerHTML = katex.renderToString(tex, { displayMode, strict: "ignore" });
      const md = displayMode ? `$$\n${tex}\n$$` : `$${tex}$`;
      expect(markdown(md).querySelector(".md-tex")!.innerHTML).toBe(t.innerHTML);
    }
  });

  it("has what papers' LaTeX has and KaTeX doesn't, drawn as near as it can", () => {
    for (const [md, like] of [
      ["$\\textsc{Merge}(A, B)$", "\\textrm{Merge}(A, B)"],
      ["$\\textsl{a}$", "\\textit{a}"],
      ["$\\ensuremath{x}$", "x"],
      ["$\\mathds{1}$", "\\mathbb{1}"],
    ]) {
      const drawn = markdown(md).querySelector(".katex-html")!.innerHTML;
      expect([md, drawn]).toEqual([md, markdown(`$${like}$`).querySelector(".katex-html")!.innerHTML]);
    }
    // a formula's own definitions are its own
    expect(formulas("$\\gdef\\Foo{\\mathbb{F}} \\Foo$ then $\\Foo$")[0]).toEqual([
      "\\gdef\\Foo{\\mathbb{F}} \\Foo",
      false,
    ]);
    expect(markdown("$\\gdef\\Foo{\\mathbb{F}} \\Foo$ then $\\Foo$").querySelectorAll(".md-tex-error")).toHaveLength(1);
  });

  it("KaTeX can't read stays as written, with the reason", () => {
    const shown = markdown("See $\\nosuchmacro{x}$.").querySelector(".md-tex")!;
    expect(shown.className).toBe("md-tex md-tex-error");
    expect(shown.textContent).toBe("$\\nosuchmacro{x}$");
    expect(shown.getAttribute("title")).toBe("Not drawn as LaTeX: Undefined control sequence: \\nosuchmacro");
  });

  it("names no link, class or file: what would is left as written, with the reason", () => {
    for (const md of [
      "$\\href{javascript:alert(1)}{x}$",
      "$\\url{https://example.com}$",
      "\\(\\htmlClass{x}{y}\\)",
      "$\\includegraphics{/etc/passwd}$",
    ]) {
      const box = markdown(md);
      expect([md, box.querySelector("a, img, .katex")]).toEqual([md, null]);
      expect(box.querySelector(".md-tex-error")!.getAttribute("title")).toMatch(/is left out of a message's math$/);
    }
  });

  it("is found in text written as lines too", () => {
    expect(formulas("a line\n$x$ on the next", true)).toEqual([["x", false]]);
    expect(markdownHtml("a line\n$x$ on the next", true)).toContain("<br>");
  });
});

describe("KaTeX that can't load", () => {
  it("leaves math as written, and throws nothing", async () => {
    // a page open from before the dashboard built itself anew: KaTeX's part of the build gone
    vi.resetModules();
    vi.doMock("./katex", () => {
      throw new Error("Failed to fetch dynamically imported module");
    });
    try {
      const fresh = await import("./tex");
      await expect(fresh.loadTex()).resolves.toBeUndefined();
      expect(fresh.texLoaded()).toBeUndefined();
    } finally {
      vi.doUnmock("./katex");
    }
  });
});
