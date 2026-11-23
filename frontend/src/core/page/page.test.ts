// The page's shared parts (core/page/): its state in its store, the nodes it builds, what it looks up in its home, an
// actor's avatar as it draws it.
import { afterEach, describe, expect, it } from "vitest";
import { actorOf, agentOf, gathererOf, homeOf, readOf } from "../api/testing";
import { usePage } from "../store/page";
import { avatarMode, bareAvatar, keepAvatarMode } from "./avatar";
import { el, foldMark, signature, statusEl, svgEl } from "./dom";
import * as helpers from "./helpers";
import { gathererNamed, selectedInfo, shellOf, shellPath } from "./home";
import { panes, state } from "./state";
import type { Pane, PageHome } from "./types";

const home: PageHome = homeOf({
  now: 100,
  home_dir: "/Users/me",
  gatherers: [
    gathererOf("g", { agents: [actorOf("c1", { avatar: "fox", avatar_hue: "red", avatar_motion: "bob glow" })] }),
  ],
  shells: [{ id: "shell:1", gatherer: "g", cwd: "/Users/me/src", since: 0, folder: null }],
});

afterEach(() => {
  usePage.setState({ home: null, selected: null, paused: false });
  panes.here = null;
  keepAvatarMode("acting");
});

describe("the page's state", () => {
  it("is its store's, read and set as fields", () => {
    state.selected = ["g", "c1"];
    expect(usePage.getState().selected).toEqual(["g", "c1"]);
    usePage.setState({ paused: true });
    expect(state.paused).toBe(true);
    expect(Object.keys(state)).toEqual(expect.arrayContaining(["home", "selected", "agent", "agentVersion"]));
  });

  it("keeps its own pane's actor's calls on that pane", () => {
    expect(state.agent).toBeNull();
    state.agent = agentOf(); // no pane: dropped
    expect(state.agentVersion).toBe(0);
    panes.here = { agent: null, agentVersion: 0 } as unknown as Pane;
    state.agent = agentOf({ reads: [readOf(1)] });
    state.agentVersion = 2;
    expect(panes.here.agent).toEqual(agentOf({ reads: [readOf(1)] }));
    expect(state.agentVersion).toBe(2);
  });
});

describe("the nodes it builds", () => {
  it("sets class, text, listeners and attributes, and leaves out what is none", () => {
    let pressed = 0;
    const b = el("button", { class: "x", title: "T", hidden: null, onclick: () => pressed++ }, "a", null, el("i"));
    b.click();
    expect(b.outerHTML).toBe('<button class="x" title="T">a<i></i></button>');
    expect(pressed).toBe(1);
    expect(el("span", { text: "<b>" }).innerHTML).toBe("&lt;b&gt;");
    expect(svgEl("path", { d: "M0 0" }).namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(foldMark(true).className).toBe("caret open");
    expect(statusEl("idle", "Idle").outerHTML).toBe('<span class="status idle"><i aria-hidden="true"></i>Idle</span>');
    expect(signature([1, "a"])).toBe('[1,"a"]');
  });

  it("keeps every name the old page's modules import", () => {
    for (const k of ["el", "get", "post", "parseKey", "selectedInfo", "ICONS", "avatarMode", "harnessLogo", "usd"])
      expect(helpers).toHaveProperty(k);
  });
});

describe("what it looks up in its home", () => {
  it("a gatherer, the selected actor, a shell", () => {
    expect(selectedInfo()).toBeNull();
    state.home = home;
    expect(gathererNamed("g")?.agents.length).toBe(1);
    expect(gathererNamed("h")).toBeNull();
    state.selected = ["g", "c1"];
    expect(selectedInfo()?.channel).toBe("c1");
    expect(shellOf("shell:1")?.cwd).toBe("/Users/me/src");
    expect(shellOf("c1")).toBeNull();
    expect(shellPath(home.shells![0])).toBe("~/src");
  });
});

describe("an actor's avatar", () => {
  // drawn by the stage (core/ui/stage: its tests in stage.test.tsx and step.test.ts)
  const fox = home.gatherers[0].agents[0];
  it("its picture alone, and how one at work is drawn: acting, or simple", () => {
    expect(bareAvatar(fox)).toBe("/avatars/fox.svg?bare=1");
    expect(bareAvatar(actorOf("x"))).toBeNull();
    keepAvatarMode("simple");
    expect(avatarMode).toBe("simple");
    keepAvatarMode("acting");
    expect(avatarMode).toBe("acting");
  });
});
