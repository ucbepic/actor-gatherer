// Manage groups and a move's question, Radix's dialogs: their rows from manage-model.ts, the switches, a new folder's box,
// and the question's button in focus once there is one to press.
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildManage } from "./manage-model";
import type { DialogsHost, MoveAsk } from "./ManageGroups";
import { drawListDialogs } from "./modes-mount";
import { actor, ctxOf, gatherer } from "./testing";

const span = () => document.createElement("span");
function hostOf(home: Parameters<typeof ctxOf>[0]): DialogsHost {
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};
  const base: Record<string, unknown> = {
    snapshot: false,
    ctx: ctxOf(home),
    icon: span,
    avatarSrc: () => null,
    harnessLogo: span,
  };
  return new Proxy(base, {
    get: (t, k: string) => (k === "calls" ? calls : k in t ? t[k] : (calls[k] ??= vi.fn())),
  }) as unknown as DialogsHost;
}
const calls = (host: DialogsHost) => (host as unknown as { calls: Record<string, ReturnType<typeof vi.fn>> }).calls;

describe("Manage groups", () => {
  const lab = gatherer("lab", [actor("lab", "l1", { name: { text: "Lab one", by: "user" } })]);
  const demo = gatherer("demo", [
    actor("demo", "d1", { name: { text: "Parser", by: "user" } }),
    actor("demo", "d2", { status: "closed" }),
    actor("demo", "crew", { role: "coordinator" }),
  ]);
  const home = {
    gatherers: [demo, lab],
    merged: true,
    folders: { demo: { folders: [{ id: 5, parent: null, name: "Work" }], filed: { d1: 5 } } },
    places: { lab: { in: "demo", folder: 5 } },
  };
  const view = { folded: new Set<string>(), naming: null, inTask: () => false };

  it("lists each group, its folders and actors set in by depth, the closed counted", () => {
    const rows = buildManage(ctxOf(home), view);
    expect(rows.map((r) => [r.kind, r.key, r.depth])).toEqual([
      ["group", "demo", 0],
      ["folder", "demo/folder:5", 1],
      ["group", "lab", 2], // placed in Work: its own group there
      ["actor", "lab/l1", 3],
      ["actor", "demo/d1", 2],
      ["shut", "demo//shut", 1],
    ]);
    const folded = buildManage(ctxOf(home), { ...view, folded: new Set(["f:demo:5"]) });
    expect(folded.map((r) => r.key)).toEqual(["demo", "demo/folder:5", "demo//shut"]);
  });

  it("draws its rows with their switches; a switch pressed asks, a row's button names a new folder in it", () => {
    const host = hostOf(home);
    const rows = buildManage(ctxOf(home), view);
    drawListDialogs({ manage: { rows, naming: null }, move: null }, host);
    const panel = document.querySelector("dialog.mg-dialog")!;
    expect(panel.querySelector("h3")?.textContent).toBe("Manage groups");
    const row = (text: string) =>
      [...panel.querySelectorAll(".mg-row")].find((r) => r.querySelector(".mg-name")?.textContent?.includes(text))!;
    expect([...row("Work").querySelectorAll(".mg-opt")].map((b) => [b.textContent, b.className])).toEqual([
      ["demo", "mg-opt on"],
      ["Own group", "mg-opt"],
    ]);
    expect(row("lab").className).toBe("mg-row group defines");
    expect([...row("lab").querySelectorAll(".mg-opt.on")].map((b) => b.textContent)).toEqual(["Own group"]);
    fireEvent.click([...row("Work").querySelectorAll(".mg-opt")][1]);
    expect(calls(host).askOwn).toHaveBeenCalledWith(demo, home.folders.demo.folders[0]);
    fireEvent.click(row("Work").querySelector(".mg-add")!);
    expect(calls(host).startNaming).toHaveBeenCalledWith(demo, 5, "f:demo:5");
    // the box drawn in its row, focused; drawn again, the same box
    const naming = { n: 1, value: "" };
    const with_ = buildManage(ctxOf(home), { ...view, naming: { g: "demo", parent: 5 } });
    drawListDialogs({ manage: { rows: with_, naming }, move: null }, host);
    const box = panel.querySelector<HTMLInputElement>(".mg-input")!;
    expect(document.activeElement).toBe(box);
    drawListDialogs({ manage: { rows: with_, naming }, move: null }, host);
    expect(panel.querySelector(".mg-input")).toBe(box);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(calls(host).endNaming).toHaveBeenCalledWith(true);
    drawListDialogs({ manage: null, move: null }, host);
    expect(document.querySelector("dialog.mg-dialog")).toBeNull();
  });

  it("a move's question: its lines and names, its button in focus once worked out", () => {
    const host = hostOf(home);
    const ask: MoveAsk = {
      label: "Move",
      busy: false,
      title: "Move?",
      lines: [],
      names: null,
      note: "Working…",
      go: null,
      goLabel: "",
    };
    drawListDialogs({ manage: null, move: ask }, host);
    const dialog = document.querySelector("dialog.mv-dialog")!;
    expect(dialog.querySelector(".mv-note")?.textContent).toBe("Working…");
    expect(dialog.querySelector("button[type=submit]")).toBeNull();
    const go = vi.fn();
    drawListDialogs(
      {
        manage: null,
        move: { ...ask, note: "", lines: ["It moves."], names: { shown: ["a", "b"], more: 1 }, go, goLabel: "Move" },
      },
      host,
    );
    expect([...dialog.querySelectorAll(".mv-names li")].map((l) => l.textContent)).toEqual(["a", "b", "and 1 more"]);
    const submit = dialog.querySelector<HTMLButtonElement>("button[type=submit]")!;
    expect(document.activeElement).toBe(submit);
    fireEvent.submit(dialog.querySelector("form")!);
    expect(go).toHaveBeenCalled();
    fireEvent.click(dialog.querySelector(".row button")!);
    expect(calls(host).moveClose).toHaveBeenCalled();
    drawListDialogs({ manage: null, move: null }, host);
  });
});
