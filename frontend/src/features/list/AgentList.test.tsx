// The list in React, drawn by its mount from a view-model, with a host standing in for the page: what it draws, what a
// press calls, and that a row stays the same element -- in focus -- as the list is drawn again.
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ListHost } from "./host";
import { buildList } from "./model";
import { drawList } from "./mount";
import { actor, app, ctxOf, gatherer, viewOf } from "./testing";
import type { ListHome } from "./types";

const span = (cls: string) => Object.assign(document.createElement("span"), { className: cls });
/** A host with every call recorded (`calls`), building plain nodes where the page builds its own. */
function hostOf(more: Partial<ListHost> = {}): ListHost {
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};
  const base: Partial<ListHost> = {
    snapshot: false,
    hovers: () => true,
    besideKey: "⌘",
    harnessName: () => "Harness",
    ago: () => "1m ago",
    nameNote: () => "",
    taskKind: (k) => k || "",
    shellPath: (s) => s.cwd,
    avatarSrc: (name) => (name ? `/avatars/${name}.svg` : null),
    head: () => [Object.assign(document.createElement("h2"), { textContent: "Agents" })],
    startMenu: () => ({
      key: "start:g",
      busy: false,
      off: false,
      title: "New in g",
      label: "New in g",
      head: "New in g",
      items: [{ text: "Claude Code", run: () => {} }],
    }),
    gathererMore: () => ({ head: "g", items: [{ text: "Hide", run: () => {} }] }),
    gfActs: () => [],
    newForm: () => document.createElement("form"),
    formAt: () => "",
    branch: () => null,
    harnessLogo: () => span("logo"),
    appFace: () => span("logo app-face"),
    appMark: () => span("t-app"),
    icon: () => span("icon"),
    saveIcon: () => span("bookmark"),
    hideIcon: () => span("hide"),
    closeIcon: () => span("x"),
    crew: () => null,
    adds: () => null,
    addMenu: () => null,
    renaming: () => null,
    folderEditing: () => null,
    closeAsk: () => ({ said: "closes it", where: "g" }),
    ...more,
  };
  return new Proxy(base, {
    get: (t, k: string) => (k === "calls" ? calls : k in t ? t[k as keyof ListHost] : (calls[k] ??= vi.fn())),
  }) as ListHost;
}
const calls = (host: ListHost) => (host as unknown as { calls: Record<string, ReturnType<typeof vi.fn>> }).calls;

let box: HTMLElement;
afterEach(() => box?.remove());
function draw(home: Partial<ListHome> & { gatherers: ListHome["gatherers"] }, host: ListHost, view = viewOf()) {
  box ??= document.createElement("aside");
  if (!box.isConnected) document.body.append(box);
  drawList(box, buildList(ctxOf(home, { apps: { g: [app("g", "i1", { title: "Shop" })] } }), view), host);
  return box;
}

describe("the list in React", () => {
  const a1 = actor("g", "a1", { name: { text: "Parser" }, created: 2 }),
    a2 = actor("g", "a2", { last_user_message: "fix it", created: 1, status: "running" });
  const home = { gatherers: [gatherer("g", [a1, a2])] };

  it("draws the head, a gatherer's row with its counts and buttons, and its rows each a box of buttons", () => {
    const host = hostOf();
    const aside = draw(home, host);
    expect(aside.querySelector(".aside-head h2")?.textContent).toBe("Agents");
    expect(aside.querySelector(".gatherer-row .gname")?.textContent).toBe("g");
    expect(aside.querySelector(".gatherer-row .count")?.textContent).toBe("1"); // one running
    expect([...aside.querySelectorAll(".g-acts > *")].map((n) => n.className)).toEqual([
      "act start new-actor new-more",
      "act row-more",
    ]);
    const rows = [...aside.querySelectorAll("div.agent")];
    expect(rows.map((r) => r.getAttribute("data-key"))).toEqual(["g/a1", "g/a2", "g/app:i1"]);
    expect(rows.map((r) => r.querySelector(":scope > button.a-main .name")?.className)).toEqual([
      "name",
      "name unnamed",
      "name",
    ]);
    expect(rows[1].querySelector(":scope > .a-main > .dot")?.getAttribute("aria-label")).toBe("Running");
    // its own buttons beside its main one, real buttons each with its name: none inside another
    expect(rows[0].querySelector(":scope > .a-acts > button.save-btn")?.getAttribute("aria-label")).toBe(
      "Save for later",
    );
    expect(aside.querySelectorAll("button button, [role=button]")).toHaveLength(0);
  });

  it("a gatherer's " + " opens its menu, Radix's: an item chosen runs with the button it hangs from", () => {
    const run = vi.fn();
    const host = hostOf({
      startMenu: () => ({
        key: "start:g",
        busy: false,
        off: false,
        title: "New in g",
        label: "New in g",
        head: "New in g",
        sub: "~/w",
        items: [{ text: "Codex", run }],
      }),
    });
    const aside = draw(home, host);
    const plus = aside.querySelector<HTMLButtonElement>(".g-acts .new-actor")!;
    expect(plus.getAttribute("data-pop")).toBe("start:g");
    fireEvent.keyDown(plus, { key: "Enter" });
    const menu = document.querySelector(".row-menu[role=menu]")!;
    expect(menu.querySelector(".hd")?.textContent).toBe("New in g~/w");
    expect(calls(host).startOpening).toHaveBeenCalled();
    fireEvent.click(menu.querySelector("[role=menuitem]")!);
    expect(run).toHaveBeenCalledWith(plus);
    expect(document.querySelector(".row-menu[role=menu]")).toBeNull();
  });

  it("calls the page for a press: a row shows its actor, its bookmark saves it, its caret folds its gatherer", () => {
    const host = hostOf();
    const aside = draw(home, host);
    fireEvent.click(aside.querySelector('[data-key="g/a1"] > .a-main')!);
    expect(calls(host).pick).toHaveBeenCalledWith("g", "a1", expect.anything());
    fireEvent.click(aside.querySelector('[data-key="g/a1"] .save-btn')!);
    expect(calls(host).setSaved).toHaveBeenCalledWith("g", a1, true);
    expect(calls(host).pick).toHaveBeenCalledTimes(1); // its own button: not the row's
    fireEvent.click(aside.querySelector('[data-key="g/a1"] > .a-main')!, { shiftKey: true });
    expect(calls(host).togglePick).toHaveBeenCalledWith(home.gatherers[0], a1);
    fireEvent.click(aside.querySelector(".gatherer-row .name")!);
    expect(calls(host).toggleGatherer).toHaveBeenCalledWith("g");
  });

  it("keeps each row the same element as the list is drawn again: in focus, it stays so", () => {
    const host = hostOf();
    const aside = draw(home, host);
    const row = aside.querySelector<HTMLElement>('[data-key="g/a2"]')!;
    const main = row.querySelector<HTMLElement>(":scope > .a-main")!;
    main.focus();
    const later = { gatherers: [gatherer("g", [a1, { ...a2, status: "idle" }])] };
    draw(later, host);
    expect(aside.querySelector('[data-key="g/a2"]')).toBe(row);
    expect(document.activeElement).toBe(main);
    expect(main.querySelector(":scope > .dot")?.getAttribute("aria-label")).toBe("Idle");
  });

  it("names a row in a box in its place, its main part a div then; the box typed in and ended through the page", () => {
    let value = "Parser";
    const host = hostOf({
      renaming: () => ({ value, placeholder: "Name this actor", label: "This actor's name" }),
      nameTyped: (v: string) => void (value = v),
    });
    const aside = draw(home, host, viewOf({ renaming: { g: "g", c: "a1" } }));
    const box = aside.querySelector<HTMLInputElement>(
      'div.agent.renaming[data-key="g/a1"] > div.a-main input.name-box',
    )!;
    expect(box.value).toBe("Parser");
    fireEvent.input(box, { target: { value: "Lexer" } });
    expect(value).toBe("Lexer");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(calls(host).endRename).toHaveBeenCalledWith(true);
  });

  it("folds a box's closed actors under a line, and opens them", () => {
    const shut = actor("g", "s", { status: "closed" });
    const host = hostOf();
    const aside = draw({ gatherers: [gatherer("g", [a1, shut])] }, host);
    const fold = aside.querySelector<HTMLElement>(".fold-line")!;
    expect(fold.textContent).toBe("▸ 1 closed");
    expect(aside.querySelector('[data-key="g/s"]')).toBeNull();
    fireEvent.click(fold);
    expect(calls(host).toggleFold).toHaveBeenCalledWith("Closed", "g");
    draw(
      { gatherers: [gatherer("g", [a1, shut])] },
      host,
      viewOf({ foldOpen: { Closed: new Set(["g"]), Saved: new Set(), Terminals: new Set() } }),
    );
    expect(aside.querySelector(".fold-line")?.textContent).toBe("▾ 1 closed");
    expect(aside.querySelector('[data-key="g/s"]')).not.toBeNull();
  });
});
