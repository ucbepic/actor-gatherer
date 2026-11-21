// Each of the dashboard's colours a panel's stylesheets read is one the host gives it (theme-vars.ts): one left out
// falls back to the panel's light value, and stays light in the dark theme.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_VARS } from "./theme-vars";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const names = (css: string, re: RegExp) => new Set([...css.matchAll(re)].map((m) => m[1]));
const list = (dir: string) => {
  try {
    return readdirSync(path.join(ROOT, dir));
  } catch {
    return [];
  }
};

describe("the theme's colours given to the apps' panels", () => {
  it("include every one of the dashboard's a panel reads and does not set itself", () => {
    const dashboard = names(read("frontend/src/core/page/base.css"), /(--[\w-]+)\s*:/g);
    const panels = [...list("ag_apps").map((app) => `ag_apps/${app}/panel`), "app_kit/fileedit/panel"];
    const missing: string[] = [];
    let sheets = 0;
    for (const dir of panels) {
      // a panel's stylesheets, loaded together: what one sets, the others read
      const css = list(dir)
        .filter((f) => f.endsWith(".css"))
        .map((f) => read(`${dir}/${f}`))
        .join("\n");
      if (!css) continue;
      sheets++;
      const own = names(css, /(--[\w-]+)\s*:/g);
      for (const v of names(css, /var\((--[\w-]+)/g))
        if (dashboard.has(v) && !own.has(v) && !THEME_VARS.includes(v)) missing.push(`${dir}: ${v}`);
    }
    expect(sheets).toBeGreaterThan(3);
    expect(missing).toEqual([]);
  });
});

// The kit's colours (app_kit/js/kit.css, linked before each panel's own stylesheets): each one given, light and dark,
// as the dashboard has it -- so a panel reads var(--ink) with no fallback, and is drawn right before the host's colours
// come. A declaration block's custom properties, by name.
const decls = (block: string) =>
  new Map(
    [...block.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
const blockOf = (css: string, selector: string) => {
  const at = `\n${css}`.indexOf(`\n${selector} {`); // (the rule's, at a line's start)
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};

describe("the kit's colours", () => {
  const base = read("frontend/src/core/page/base.css");
  const kit = read("app_kit/js/kit.css");
  const light = decls(blockOf(base, ":root")),
    dark = decls(blockOf(base, ':root[data-theme="dark"]'));

  it("are the dashboard's, light and dark, every one the host gives a panel", () => {
    const kitLight = decls(blockOf(kit, ":root")),
      kitDark = decls(blockOf(kit, ':root[data-ag-theme="dark"]'));
    for (const v of THEME_VARS) {
      expect(kitLight.get(v), v).toBe(light.get(v));
      expect(kitDark.get(v), v).toBe(dark.get(v)); // (one the dark theme leaves as it is: in neither)
    }
    expect([...kitLight.keys()].sort()).toEqual(THEME_VARS.filter((v) => light.has(v)).sort());
  });

  it("leave no panel a fallback of its own for one of them", () => {
    const panels = [...list("ag_apps").map((app) => `ag_apps/${app}/panel`), "app_kit/fileedit/panel"];
    const own: string[] = [];
    for (const dir of panels)
      for (const f of list(dir).filter((f) => f.endsWith(".css")))
        for (const m of read(`${dir}/${f}`).matchAll(/var\((--[\w-]+)\s*,/g))
          if (THEME_VARS.includes(m[1])) own.push(`${dir}/${f}: ${m[1]}`);
    expect(own).toEqual([]);
  });
});
