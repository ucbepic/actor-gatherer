// The list's derivations from the home: statuses and groups, messages between actors, folders, tasks, gatherers.
import { describe, expect, it } from "vitest";
import { appNoticesOf, noticeOf, sessionOf } from "../../core/api/testing";
import { askedOf, crewLine, envelope } from "./envelope";
import {
  aloneFolds,
  aloneShut,
  crewAt,
  crewPlace,
  gathererCounts,
  insideOf,
  isHidden,
  placedIn,
  placeOf,
  staleNames,
  titleOf,
  totals,
} from "./groups";
import { appStatusOf, closeHow, discardable, groupOf, savedAs, statusOf } from "./status";
import {
  taskActors,
  taskItems,
  taskLead,
  taskName,
  taskOf,
  taskStatus,
  taskWhat,
  withTasks,
  itemFolder,
  keptAs,
} from "./tasks";
import { boxGroups, closedSays, folderOf, folderPath, folderTally, GF, kidFolders, shownClosed, within } from "./tree";
import { actor, app, ctxOf, gatherer } from "./testing";

describe("an actor's status and group", () => {
  const g = gatherer("g", []);
  it("says what the page started first, then a turn opened ahead, then what the server decided", () => {
    const ctx = ctxOf({ gatherers: [g] }, { opened: ["c2"], seenAt: { "g\u0000c1": 100, "g\u0000c2": 100 } });
    expect(statusOf(ctx, actor("g", "c1", { session: sessionOf({ status: "starting" }), status: "asking" }))).toEqual([
      "building",
      "Starting",
    ]);
    expect(statusOf(ctx, actor("g", "c1", { session: sessionOf({ status: "idle", queued: ["hi"] }) }))).toEqual([
      "running",
      "Running",
    ]);
    expect(statusOf(ctx, actor("g", "c1", { session: sessionOf({ status: "failed" }) }))).toEqual(["failed", "Failed"]);
    expect(statusOf(ctx, actor("g", "c2", { status: "idle" }))).toEqual(["running", "Running"]);
    expect(statusOf(ctx, actor("g", "c1", { status: "asking" }))).toEqual(["asking", "Waiting for you"]);
    expect(statusOf(ctx, actor("g", "c1", { status: "error" }))).toEqual(["error", "Error"]);
    expect(statusOf(ctx, actor("g", "c1", { building: true }))).toEqual(["building", "Building"]);
    expect(statusOf(ctx, actor("g", "c1", { status: "running" }))).toEqual(["running", "Running"]);
    expect(statusOf(ctx, actor("g", "c1", { status: undefined, running: true }))).toEqual(["running", "Running"]);
    expect(statusOf(ctx, actor("g", "c1", { status: "background" }))).toEqual(["background", "Background"]);
    expect(statusOf(ctx, actor("g", "c1", { status: "closed" }))).toEqual(["closed", "Closed"]);
    expect(statusOf(ctx, actor("g", "c1"))).toEqual(["idle", "Idle"]);
  });
  it("is finished when it did something since the reader last looked", () => {
    const a = actor("g", "c1", { last: 300, status: "closed" });
    expect(statusOf(ctxOf({ gatherers: [g] }, { seenAt: { "g\u0000c1": 200 } }), a)).toEqual(["finished", "Finished"]);
    expect(statusOf(ctxOf({ gatherers: [gatherer("g", [a])] }), a)).toEqual(["closed", "Closed"]);
  });
  it("puts a closed actor saved in Saved, by its channel or the one it was started as", () => {
    const a = actor("g", "c1", { status: "closed", session: sessionOf({ started_as: "old" }) });
    const ctx = ctxOf({ gatherers: [gatherer("g", [a])], saved: { g: { old: "2026-01-01" } } });
    expect(savedAs(ctx, "g", a)).toBe("old");
    expect(groupOf(ctx, ctx.home.gatherers[0], a)).toBe("Saved");
    expect(groupOf(ctx, ctx.home.gatherers[0], { ...a, status: "idle" })).toBe("Idle"); // open: by its status
    expect(groupOf(ctx, ctx.home.gatherers[0], { ...a, status: "error" })).toBe("Error");
  });
  it("closes a session the page runs, discards one that never started, and does neither in a snapshot", () => {
    const ctx = ctxOf({ gatherers: [g] });
    expect(closeHow(ctx, actor("g", "c", { session: sessionOf({ pid: 4 }) }))).toBe("close");
    expect(closeHow(ctx, actor("g", "c", { session: sessionOf({ status: "failed" }) }))).toBe("discard");
    expect(discardable(ctx, actor("g", "c", { session: sessionOf({ status: "failed" }), events: 3 }))).toBe(false);
    expect(closeHow(ctx, actor("g", "c"))).toBe(null);
    expect(
      closeHow(ctxOf({ gatherers: [g] }, { snapshot: true }), actor("g", "c", { session: sessionOf({ pid: 4 }) })),
    ).toBe(null);
  });
  it("marks an app with a notification the reader has not seen", () => {
    const ctx = ctxOf(
      {
        gatherers: [
          gatherer("g", [], { apps: { i1: appNoticesOf({ last: 50, notices: [noticeOf({ title: "a" })] }) } }),
        ],
      },
      { seenAt: { "g\u0000app:i1": 40 } },
    );
    expect(appStatusOf(ctx, "g", "i1")).toEqual(["notified", "Notification"]);
    expect(appStatusOf({ ...ctx, seenAt: { "g\u0000app:i1": 50 } }, "g", "i1")).toBe(null);
  });
});

describe("a message from another actor", () => {
  it("is read as who it is from and its words, in a line", () => {
    const env = envelope(
      'Message from actor 1a2b3c4d-0000, "Fix it" (answer it with: ag actors send 1a2b3c4d-0000 "..."):\n\nhi',
    );
    expect(env).toEqual({ from: "actor", id: "1a2b3c4d-0000", name: "Fix it", text: "hi" });
    expect(crewLine(env!)).toBe("From Fix it: hi");
    const crew = envelope('Message from the coordinator agent over "g/Figures":\n\ngo');
    expect(crewLine(crew!)).toBe("From the Figures coordinator: go");
    const news = envelope(
      "Update (you asked with `ag actors when`, watch 3): actor 1a2b3c4d-0000 is done: its turn is over.",
    );
    expect(crewLine(news!)).toBe("Actor 1a2b3c4d is done: its turn is over");
    expect(askedOf("just words")).toBe("just words");
    expect(askedOf("")).toBe(null);
  });
});

describe("folders", () => {
  const a1 = actor("g", "a1", { created: 1 }),
    a2 = actor("g", "a2", { created: 2 }),
    a3 = actor("g", "a3", { status: "closed", last: 10 }),
    a4 = actor("g", "a4", { status: "closed", last: 20 });
  const g = gatherer("g", [a1, a2, a3, a4]);
  const folders = [
    { id: 1, parent: null, name: "Top" },
    { id: 2, parent: 1, name: "Inner" },
    { id: 3, parent: 9, name: "Orphan" }, // its parent gone: at the top
  ];
  const ctx = ctxOf({
    gatherers: [g],
    folders: { g: { folders, filed: { a1: 2, a3: 1, gone: 5 } } },
    shells: [{ id: "shell:1", gatherer: "g", cwd: "/w", since: 0, folder: null }],
  });
  it("files each actor in one folder, or at its gatherer's top", () => {
    expect(folderOf(ctx, "g", a1)).toBe(2);
    expect(folderOf(ctx, "g", a2)).toBe(null);
    expect(kidFolders(ctx, "g", null).map((f) => f.id)).toEqual([1, 3]);
    expect(within(ctx, "g", 2, 1)).toBe(true);
    expect(within(ctx, "g", 1, 2)).toBe(false);
    expect(folderPath(ctx, "g", 2)).toBe("Top / Inner");
  });
  it("counts what a folder holds, its folders' too", () => {
    expect(folderTally(ctx, g, 1)).toMatchObject({ open: 1, closed: 1, idle: 1, saved: 0 });
  });
  it("lists a box's open actors newest first, then its terminals, saved and closed ones latest first", () => {
    const top = boxGroups(ctx, g, null);
    expect(top.map(([name, list]) => [name, list.map((x) => ("channel" in x ? x.channel : x.id))])).toEqual([
      ["Open", ["a2"]],
      ["Terminals", ["shell:1"]],
      ["Closed", ["a4"]],
    ]);
    const kept = ctxOf({ ...ctx.home, saved: { g: { a4: "x" } } });
    expect(boxGroups(kept, g, null).map(([name]) => name)).toEqual(["Open", "Terminals", "Saved"]);
  });
  it("shows a closed folder in its parent's closed line until something in it is used again", () => {
    const shut = [{ id: 1, parent: null, name: "Done", closed: "1970-01-01T00:16:40Z" }]; // at 1000
    const b1 = actor("g", "b1", { status: "closed", last: 900 });
    const g2 = gatherer("g", [b1]);
    const c = ctxOf({ gatherers: [g2], folders: { g: { folders: shut, filed: { b1: 1 } } } });
    expect(shownClosed(c, g2, shut[0])).toBe(true);
    expect(closedSays(c, g2, null, 0)).toBe("1 closed");
    expect(boxGroups(c, g2, null).map(([name]) => name)).toEqual(["Closed"]); // its line, for the folder alone
    const used = { ...b1, status: "idle", last: 1100 };
    expect(shownClosed(ctxOf({ ...c.home, gatherers: [gatherer("g", [used])] }), gatherer("g", [used]), shut[0])).toBe(
      false,
    );
    const empty = ctxOf({ gatherers: [gatherer("g", [])], folders: { g: { folders: shut, filed: {} } } });
    expect(closedSays(empty, gatherer("g", []), null, 0)).toBe("1 closed folder");
  });
});

describe("tasks", () => {
  const lead = actor("g", "l", { status: "asking", last: 5 }),
    other = actor("g", "o", { status: "running", last: 9 }),
    shut = actor("g", "s", { status: "closed", last: 99 });
  const g = gatherer("g", [lead, other, shut]);
  const tasks = {
    g: {
      tasks: [
        { id: 7, name: null },
        { id: 8, name: "Named" },
      ],
      tasked: { l: 7, o: 7, s: 7, "app:i1": 7, "app:i2": 8 },
    },
  };
  const ctx = ctxOf({ gatherers: [g], tasks }, { apps: { g: [app("g", "i1"), app("g", "i2", { title: "Shop" })] } });
  it("leads by the actor most pressing, the latest first among equals; closed ones never lead", () => {
    expect(taskOf(ctx, "g", other)).toBe(7);
    expect(taskActors(ctx, g, 7).map((a) => a.channel)).toEqual(["l", "o"]);
    expect(taskLead(ctx, g, 7)?.channel).toBe("l");
    expect(taskStatus(ctx, g, 7)).toEqual(["asking", "Waiting for you"]);
    expect(taskItems(ctx, g, 7)).toEqual(["l", "o", "s", "app:i1"]);
    expect(taskWhat(ctx, g, 7)).toBe("3 actors, 1 app");
  });
  it("names a task by the reader's name, its lead's, else its first app's", () => {
    expect(taskName(ctx, g, { id: 8, name: "Named" })).toBe("Named");
    expect(taskName(ctx, g, { id: 8, name: null })).toBe("Notepad · Shop");
    expect(taskName(ctx, g, { id: 7, name: null })).toBe("No message yet");
  });
  it("says a notification of its apps over its lead's state, unless that is more pressing", () => {
    const told = ctxOf(
      {
        gatherers: [
          gatherer("g", [actor("g", "x", { status: "running" })], { apps: { i1: appNoticesOf({ last: 50 }) } }),
        ],
        tasks: { g: { tasks: [{ id: 1, name: null }], tasked: { x: 1, "app:i1": 1 } } },
      },
      { apps: { g: [app("g", "i1")] } },
    );
    expect(taskStatus(told, told.home.gatherers[0], 1)).toEqual(["notified", "Notification"]);
  });
  it("drags a task whole, and keeps an item as the server knows it", () => {
    expect(withTasks(ctx, g, ["o"])).toEqual(["l", "o", "s", "app:i1"]);
    expect(itemFolder(ctx, g, "app:i1")).toBe(null);
    expect(keptAs(ctx, g, "o")).toBe("o");
  });
});

describe("gatherers", () => {
  const old = gatherer("old", [actor("old", "a")], { last: 1 });
  const kept = gatherer("kept", [actor("kept", "b")], { last: 1 });
  const hid = gatherer("hid", [actor("hid", "c")], { last: 8 * 86400 });
  const alone = gatherer("self:z", [actor("self:z", "z", { status: "closed", last: 7 })], {
    alone: true,
    last: 8 * 86400,
  });
  const ctx = ctxOf({
    gatherers: [old, kept, hid, alone],
    now: 1 + 8 * 86400,
    hiding: { kept: "shown", hid: "hidden" },
    titles: { kept: "Kept one" },
  });
  it("hides those the reader hid and those inactive for a week, unless kept in view", () => {
    expect([old, kept, hid, alone].map((g) => isHidden(ctx, g))).toEqual([true, false, true, false]);
    expect(staleNames(ctx)).toEqual(["old", "kept"]);
    expect(titleOf(ctx, kept)).toBe("Kept one");
    expect(titleOf(ctx, alone)).toBe("On its own");
  });
  it("lists an actor on its own closed in a line at the list's end", () => {
    expect(aloneShut(ctx, alone)).toBe(true);
    expect(aloneFolds(ctx, [alone]).map(([name, gs]) => [name, gs.length])).toEqual([["Closed", 1]]);
  });
  it("places a group inside another's folder, never in a ring nor in a hidden one", () => {
    const a = gatherer("a", []),
      b = gatherer("b", []),
      c = gatherer("c", []);
    const places = { b: { in: "a", folder: 4 }, c: { in: "a", folder: null }, a: { in: "x", folder: null } };
    const p = ctxOf({ gatherers: [a, b, c], places, merged: true, folders: { a: { folders: [], filed: {} } } });
    expect(placeOf(p, "b")).toEqual({ in: "a", folder: null }); // its folder gone: the top
    expect(placeOf(p, "a")).toBe(null); // in a group not there
    expect(insideOf(p, "b", "a")).toBe(true);
    expect(placedIn(p, "a", null).map((g) => g.name)).toEqual(["b", "c"]);
    const ring = ctxOf({
      gatherers: [a, b],
      places: { a: { in: "b", folder: null }, b: { in: "a", folder: null } },
      merged: true,
    });
    expect(placeOf(ring, "a")).toBe(null);
    expect(placeOf(ctxOf({ ...p.home, merged: false }), "b")).toBe(null); // one database per group: none
  });
  it("finds the coordinator agent over a node, and names the node", () => {
    const crew = actor("g", "k", { role: "coordinator", over: "folder:3" });
    const g = gatherer("g", [crew]);
    const c = ctxOf({
      gatherers: [g],
      folders: { g: { folders: [{ id: 3, parent: null, name: "Figs" }], filed: {} } },
    });
    expect(crewAt(c, "folder:3")[1]).toBe(crew);
    expect(crewAt(c, "all")).toEqual([null, null]);
    expect(crewPlace(c, "folder:3", g)).toBe("Figs");
    expect(crewPlace(c, "all")).toBe("everything");
    expect(crewPlace(c, "groups:1")).toBe("a folder of groups");
    expect(GF).toBe("/");
  });
  it("counts what each group's actors do, and every shown group's in the top bar (a coordinator at rest not)", () => {
    const g = gatherer("g", [
      actor("g", "1", { status: "asking" }),
      actor("g", "2", { status: "running" }),
      actor("g", "3", { status: "idle", role: "coordinator" }),
      actor("g", "4", { status: "idle" }),
    ]);
    const c = ctxOf({ gatherers: [g] });
    expect(gathererCounts(c, g)).toEqual({ of: 4, asking: 1, error: 0, notified: 0, running: 1 });
    expect(totals(c, [g])).toMatchObject({ asking: 1, running: 1, idle: 1 });
  });
});
