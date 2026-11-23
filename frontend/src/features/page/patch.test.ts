// A pane's view put in place, keeping what is the same (patch.ts).
import { describe, expect, it } from "vitest";
import { patch, type Built } from "./patch";

const html = (s: string): HTMLElement => {
  const box = document.createElement("div");
  box.innerHTML = s;
  return box.firstElementChild as HTMLElement;
};

describe("a view patched in place", () => {
  it("keeps each node that is the same, replaces those that are not, adds and removes at the end", () => {
    const parent = document.createElement("div");
    parent.append(html("<p>a</p>"), html("<p>b</p>"), html("<p>c</p>"));
    const [a, b] = [...parent.children];
    patch(parent, [html("<p>a</p>"), html("<p>B</p>")]);
    expect(parent.innerHTML).toBe("<p>a</p><p>B</p>");
    expect(parent.children[0]).toBe(a); // the same: kept
    expect(parent.children[1]).not.toBe(b);
    patch(parent, [html("<p>a</p>"), html("<p>B</p>"), document.createTextNode("x")]);
    expect(parent.innerHTML).toBe("<p>a</p><p>B</p>x");
    expect(parent.children[0]).toBe(a);
  });

  it("patches inside a node marked data-morph, keeps one marked data-sig while its signature is", () => {
    const parent = document.createElement("div");
    parent.append(html('<div data-morph=""><span>1</span><i>2</i></div>'), html('<textarea data-sig="s1"></textarea>'));
    const [frame, box] = [...parent.children] as HTMLElement[];
    const span = frame.firstElementChild;
    (box as HTMLTextAreaElement).value = "typed";
    patch(parent, [
      html('<div data-morph=""><span>1</span><i>3</i></div>'),
      html('<textarea data-sig="s1"></textarea>'),
    ]);
    expect(parent.children[0]).toBe(frame);
    expect(frame.firstElementChild).toBe(span);
    expect(frame.innerHTML).toBe("<span>1</span><i>3</i>");
    expect(parent.children[1]).toBe(box); // whatever was typed in it
    patch(parent, [frame, html('<textarea data-sig="s2"></textarea>')]);
    expect(parent.children[1]).not.toBe(box);
  });

  it("puts in a frame's children held apart, and draws whole a node that moved", () => {
    const parent = document.createElement("div");
    const frame = html('<div data-morph=""></div>') as HTMLElement & Built;
    frame.kids = [html("<b>k</b>")];
    patch(parent, [frame]);
    expect(parent.innerHTML).toBe('<div data-morph=""><b>k</b></div>');
    expect(frame.kids).toBeNull();
    const [x, y] = [html("<p>x</p>"), html("<p>y</p>")];
    parent.replaceChildren(x, y);
    patch(parent, [y, x]);
    expect([...parent.children]).toEqual([y, x]);
  });
});
