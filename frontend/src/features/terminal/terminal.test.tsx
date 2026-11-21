// The Terminal view's frame (mount.tsx): xterm's node first in it, kept from draw to draw, and the cover saying why the
// terminal does not run (TerminalView.tsx).
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { key } from "../../core/model/keys";
import { drawTerminal } from "./mount";
import type { TermFrame } from "./TerminalView";

const frame = (over: Partial<TermFrame> = {}): TermFrame => ({
  key: key("demo", "c1"),
  none: false,
  running: false,
  held: "",
  readOnly: "",
  exited: null,
  error: "",
  open: () => {},
  ...over,
});
const xtermNode = () => Object.assign(document.createElement("div"), { className: "xterm-host", id: "xterm-host" });
const cover = (n: HTMLElement) => n.querySelector(".xterm-cover");

describe("the Terminal view", () => {
  it("puts the terminal's node first, kept, and says it opens until it runs", () => {
    const host = xtermNode();
    const node = drawTerminal(frame(), host, "Terminal");
    expect(node.matches("div.chat-frame.xterm-frame#chat-list[aria-label='Chat history, Terminal']")).toBe(true);
    expect(node.firstChild).toBe(host);
    expect(cover(node)!.textContent).toBe("Opening the terminal…");
    drawTerminal(frame({ running: true }), host, "Terminal");
    expect([...node.children]).toEqual([host]);
  });

  it("offers to open it again once it ended or failed; not where it cannot be messaged", () => {
    const open = vi.fn();
    const host = xtermNode();
    const node = drawTerminal(frame({ exited: 0, open }), host, "Terminal");
    expect(cover(node)!.querySelector(".desc")!.textContent).toBe("The session's process ended.");
    fireEvent.click(cover(node)!.querySelector("button.primary")!);
    expect(open).toHaveBeenCalled();
    drawTerminal(frame({ error: "no pty" }), host, "Terminal");
    expect(cover(node)!.querySelector(".err")!.textContent).toBe("no pty");
    expect(cover(node)!.querySelector(".desc")!.textContent).toBe("The terminal did not open.");
    drawTerminal(frame({ error: "no pty", held: "Open in another process." }), host, "Terminal");
    expect(cover(node)!.querySelector("button")).toBeNull();
    expect(cover(node)!.querySelector(".desc")!.textContent).toBe("Open in another process.");
  });

  it("drops another session's terminal, and has none where the system has no pseudo-terminals", () => {
    const first = xtermNode(),
      second = xtermNode();
    const node = drawTerminal(frame(), first, "Terminal");
    drawTerminal(frame({ key: key("demo", "c2") }), second, "Terminal");
    expect(node.querySelectorAll(".xterm-host")).toHaveLength(1);
    expect(node.firstChild).toBe(second);
    drawTerminal(frame({ none: true }), null, "Terminal");
    expect(node.querySelector(".xterm-host")).toBeNull();
    expect(node.textContent).toBe("Terminals need a Unix pseudo-terminal, which this system doesn't have.");
  });
});
