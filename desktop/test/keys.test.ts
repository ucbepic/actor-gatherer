// desktop/src/keys.ts: a browser's own keys on a Browser's native page, and Chrome's zoom steps.
import assert from "node:assert/strict";
import { test } from "node:test";
import { browserKey, zoomStep, ZOOMS } from "../src/keys.ts";

const press = (key: string, mods: Partial<{ meta: boolean; control: boolean; shift: boolean; alt: boolean }> = {}, type = "keyDown") =>
  ({ type, key, meta: false, control: false, shift: false, alt: false, ...mods });

test("a Mac's Cmd keys are the browser's: tabs, history, address, reload, zoom", () => {
  const cmd = (key: string, more = {}) => browserKey(press(key, { meta: true, ...more }), true);
  assert.equal(cmd("t"), "newTab");
  assert.equal(cmd("T", { shift: true }), "reopenTab");
  assert.equal(cmd("w"), "closeTab");
  assert.equal(cmd("1"), "tab:1");
  assert.equal(cmd("8"), "tab:8");
  assert.equal(cmd("9"), "tab:last");
  assert.equal(cmd("["), "back");
  assert.equal(cmd("]"), "forward");
  assert.equal(cmd("{", { shift: true }), "prevTab");
  assert.equal(cmd("}", { shift: true }), "nextTab");
  assert.equal(cmd("ArrowRight", { alt: true }), "nextTab");
  assert.equal(cmd("l"), "address");
  assert.equal(cmd("r"), "reload");
  assert.equal(cmd("R", { shift: true }), "hard-reload");
  assert.equal(cmd("="), "zoom:1");
  assert.equal(cmd("+", { shift: true }), "zoom:1");
  assert.equal(cmd("-"), "zoom:-1");
  assert.equal(cmd("0"), "zoom:0");
  assert.equal(browserKey(press("Tab", { control: true }), true), "nextTab");
  assert.equal(browserKey(press("Tab", { control: true, shift: true }), true), "prevTab");
});

test("the page's own keys stay the page's", () => {
  for (const k of [press("t"), press("w", { control: true }), press("c", { meta: true }), press("v", { meta: true }),
    press("f", { meta: true }), press("a", { meta: true }), press("z", { meta: true, shift: true }), press("t", { meta: true }, "keyUp"),
    press("ArrowLeft", { meta: true })])
    assert.equal(browserKey(k, true), null, JSON.stringify(k));
});

test("elsewhere it is Ctrl, not Cmd", () => {
  assert.equal(browserKey(press("t", { control: true }), false), "newTab");
  assert.equal(browserKey(press("t", { meta: true }), false), null);
});

test("zoom goes by Chrome's steps, and stops at its ends", () => {
  assert.equal(zoomStep(1, 1), 1.1);
  assert.equal(zoomStep(1, -1), 0.9);
  assert.equal(zoomStep(1.25, 0), 1);
  assert.equal(zoomStep(1.05, 1), 1.1);
  assert.equal(zoomStep(1.05, -1), 1);
  assert.equal(zoomStep(5, 1), 5);
  assert.equal(zoomStep(ZOOMS[0], -1), ZOOMS[0]);
});
