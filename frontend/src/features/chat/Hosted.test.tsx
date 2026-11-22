// The old page's nodes the turn list draws as React's own.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Html } from "./Hosted";

afterEach(cleanup);

const node = (html: string) => {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.firstChild!;
};

describe("Html", () => {
  it("draws the old page's node as React's own: the same element, attributes and contents", () => {
    for (const html of [
      '<div class="cv err"><pre class="out">a &amp; <b>b</b></pre><button type="button" data-copy="x">Copy</button></div>',
      '<img class="crew-face" src="/avatars/a.svg" alt="" draggable="false">',
      '<span class="crew-face none" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M1 1"></path></svg></span>',
      '<span class="cmdline"><span class="sh-t"><span class="hl-fn">ls</span></span></span>',
    ]) {
      const { container, unmount } = render(<Html node={node(html)} />);
      expect(container.childNodes.length).toBe(1);
      expect(container.firstChild!.isEqualNode(node(html))).toBe(true); // attributes in any order: an image's src last
      unmount();
    }
  });

  it("takes a style as React does, and a text as it is", () => {
    const { container } = render(
      <>
        <Html node={node('<span style="color: red; --x: 1px">s</span>')} />
        <Html node="plain &" />
        <Html node={null} />
      </>,
    );
    expect(container.innerHTML).toBe('<span style="color: red; --x: 1px;">s</span>plain &amp;');
  });
});
