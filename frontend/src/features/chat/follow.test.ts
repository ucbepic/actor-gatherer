// The conversation kept at its end as its box changes size: only when the reader had it there, and not when the page
// put it elsewhere, nor when it comes back to the page.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { END_PX, followEnd, placed } from "./follow";

// jsdom lays nothing out: each box's sizes set by hand, and its size changes told by hand
let told: ((seen: ResizeObserverEntry[]) => void) | null = null;
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: (seen: ResizeObserverEntry[]) => void) {
        told = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterAll(() => vi.unstubAllGlobals());

type Box = HTMLDivElement & { sized: (h: number, all?: number) => void; scrolled: (top: number) => void };
function box(): Box {
  const n = document.createElement("div") as Box;
  let h = 500,
    all = 2000;
  Object.defineProperty(n, "clientHeight", { get: () => h });
  Object.defineProperty(n, "scrollHeight", { get: () => all });
  n.sized = (to, content = all) => {
    h = to;
    all = content;
    told!([{ target: n } as unknown as ResizeObserverEntry]);
  };
  n.scrolled = (top) => {
    n.scrollTop = top;
    n.dispatchEvent(new Event("scroll"));
  };
  document.body.append(n);
  followEnd(n);
  return n;
}

let n: Box;
beforeEach(() => {
  document.body.innerHTML = "";
  n = box();
});

describe("followEnd", () => {
  it("keeps a box read to its end at its end as it gets shorter or narrower", () => {
    n.scrolled(1500); // at its end
    n.sized(300);
    expect(n.scrollTop).toBe(2000);
    n.sized(300, 2600); // narrower: the same turns, taller
    expect(n.scrollTop).toBe(2600);
  });

  it("counts a reader near the end as at it", () => {
    n.scrolled(1500 - END_PX + 1);
    n.sized(300);
    expect(n.scrollTop).toBe(2000);
  });

  it("leaves a box read further up where the reader has it", () => {
    n.scrolled(400);
    n.sized(300);
    expect(n.scrollTop).toBe(400);
  });

  it("leaves where the page put it, though it sent no scroll", () => {
    n.scrolled(1500);
    n.scrollTop = 400; // a message kept in place (keepTurn), a turn picked brought to its top
    placed(n);
    n.sized(300);
    expect(n.scrollTop).toBe(400);
  });

  it("puts a box hidden at its end back at its end when shown", () => {
    n.scrolled(1500);
    n.sized(0, 0); // a file shown beside it, in a narrow window
    n.scrollTop = 0;
    n.sized(500, 2000);
    expect(n.scrollTop).toBe(2000);
  });

  it("leaves a box back on the page where the page puts it", () => {
    n.scrolled(1500);
    n.remove(); // another actor shown
    n.sized(0, 0);
    document.body.append(n);
    n.scrollTop = 300; // the page's place for it
    n.sized(400, 2000);
    expect(n.scrollTop).toBe(300);
  });
});
