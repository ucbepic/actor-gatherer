// A browser's own keys and zoom steps, as Chrome has them, for the Browser's native pages (browsers.ts), and the app's
// menu: kept apart from Electron so the unit tests can load them.
import type { BaseWindow, MenuItemConstructorOptions } from "electron";

/** A key as Electron's before-input-event gives it. */
export type KeyInput = { type: string; key: string; meta: boolean; control: boolean; shift: boolean; alt: boolean };

/** Chrome's zoom steps (Cmd+= / Cmd+- go from one to the next). */
export const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
/** The zoom a step from `now` takes the page to: in (1), out (-1), back to 100% (0). */
export function zoomStep(now: number, step: number): number {
  if (step === 0) return 1;
  if (step > 0) return ZOOMS.find((z) => z > now + 0.001) ?? ZOOMS[ZOOMS.length - 1];
  return [...ZOOMS].reverse().find((z) => z < now - 0.001) ?? ZOOMS[0];
}

/** What a key on a page means to a browser (Chrome's keys on a Mac; Ctrl for Cmd elsewhere), or null for the page's
 * own: the zoom keys the app does itself ("zoom:<step>"); the rest go to ag, whose Browser does them on its tabs
 * (core.py's `browser_key`). */
export function browserKey(input: KeyInput, mac: boolean = process.platform === "darwin"): string | null {
  if (input.type !== "keyDown") return null;
  const cmd = mac ? input.meta && !input.control : input.control && !input.meta;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  if (input.control && !input.meta && !input.alt && key === "Tab") return input.shift ? "prevTab" : "nextTab";
  if (!cmd) return null;
  if (input.alt) {
    if (key === "ArrowRight") return "nextTab";
    if (key === "ArrowLeft") return "prevTab";
    return null;
  }
  if (input.shift) {
    if (key === "t") return "reopenTab";
    if (key === "r") return "hard-reload";
    if (key === "[" || key === "{") return "prevTab";
    if (key === "]" || key === "}") return "nextTab";
    if (key === "=" || key === "+") return "zoom:1";
    return null;
  }
  if (/^[1-8]$/.test(key)) return `tab:${key}`;
  const keys: Record<string, string> = { t: "newTab", w: "closeTab", "9": "tab:last", "[": "back", "]": "forward",
    l: "address", r: "reload", "=": "zoom:1", "+": "zoom:1", "-": "zoom:-1", "0": "zoom:0" };
  return keys[key] ?? null;
}

/** A key of the app's menu the dashboard's page does: a new screen tab, the one shown closed. */
export type TabKey = "newTab" | "closeTab";
/** The app's menu (main.ts): Electron's own but for File -- New Tab (Cmd+T) and Close Tab (Cmd+W), the dashboard's screen
 * tabs, done by the page (`page`, with the window the key was pressed in), and Close Window on Shift+Cmd+W, as in Chrome
 * -- so Cmd+W closes a tab, not the window. Ctrl for Cmd off a Mac. A Browser panel's native page keeps them for its own
 * tabs (browsers.ts: its keys never reach the menu). */
export function appMenu(mac: boolean, page: (key: TabKey, win: BaseWindow | undefined) => void): MenuItemConstructorOptions[] {
  const file: MenuItemConstructorOptions[] = [
    { label: "New Tab", accelerator: "CmdOrCtrl+T", click: (_item, win) => page("newTab", win) },
    { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: (_item, win) => page("closeTab", win) },
    { type: "separator" },
    { role: "close", label: "Close Window", accelerator: "Shift+CmdOrCtrl+W" },
    ...(mac ? [] : ([{ type: "separator" }, { role: "quit" }] as MenuItemConstructorOptions[])),
  ];
  const window: MenuItemConstructorOptions[] = mac
    ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
    : [{ role: "minimize" }];
  return [
    ...(mac ? ([{ role: "appMenu" }] as MenuItemConstructorOptions[]) : []),
    { label: "File", submenu: file },
    { role: "editMenu" },
    { role: "viewMenu" },
    { label: "Window", submenu: window },
  ];
}
