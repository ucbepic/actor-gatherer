// Chat's data: the views the stream sends, kept by actor; a turn's files fetched once, and the latest turn's again only
// when a view says the turns moved on -- one fetch at a time, one more after it for all that asked meanwhile.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../../core/api/query";
import { currentOf, turnOf } from "../../core/api/testing";
import { KEPT_ACTORS, stampOf, turnsOf, useChatData, viewOf, viewOrNone, viewSeq } from "./data";
import { filesSeq, keptFiles, loadFiles, type FilesOf } from "./files";
import type { ChatView, FilesData, Turn } from "./types";

const turn = (n: number, over: Partial<Turn> = {}): Turn =>
  turnOf(n, { text: `t${n}`, row_id: 10 * n, end: n, ...over });
const view = (turns: Turn[]): ChatView => ({
  turns,
  opening: null,
  current: currentOf({ state: "done", turn: turns.length - 1 }),
  waiting: [],
  taken_back: null,
  version: [],
});
const files = (turns: Turn[]): FilesData => ({ turns, turn: turns.length - 1, files: [], commands: [], home: "/h" });

let served: Turn[], fetched: string[], hold: (() => void)[];

beforeEach(() => {
  queryClient.clear();
  served = [turn(0)];
  fetched = [];
  hold = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetched.push(url);
      const now = files(served);
      await new Promise<void>((done) => hold.push(done));
      return new Response(JSON.stringify(now));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

/** Every fetch under way answered, and what followed them. */
async function answer() {
  for (let i = 0; i < 5; i++) {
    for (const done of hold.splice(0)) done();
    await new Promise((r) => setTimeout(r, 0));
  }
}

let actors = 0;
const latest = (): FilesOf => ({ gatherer: "g", channel: `c${++actors}`, turn: null, cwd: "/w" });

describe("the views", () => {
  it("keeps each actor's latest view, and which it is", () => {
    const take = useChatData.getState().take;
    take("g\0a", view([turn(0)]));
    const first = viewSeq("g\0a");
    take("g\0a", view([turn(0), turn(1)]));
    expect(viewOf("g\0a")?.turns).toHaveLength(2);
    expect(viewSeq("g\0a")).toBeGreaterThan(first);
    expect(viewSeq("g\0none")).toBe(0);
  });

  it("keeps the actors shown lately, the one shown last last", () => {
    const take = useChatData.getState().take;
    for (let i = 0; i <= KEPT_ACTORS; i++) take(`g\0k${i}`, view([]));
    expect(viewOf("g\0k0")).toBeNull();
    expect(useChatData.getState().views.size).toBe(KEPT_ACTORS);
    expect([...useChatData.getState().views.keys()].pop()).toBe(`g\0k${KEPT_ACTORS}`);
  });

  it("takes a view the server could not make as none", () => {
    expect(viewOrNone({ error: "locked" })).toBeNull();
    expect(viewOrNone(view([]))).not.toBeNull();
  });

  it("has the turns from the view, or before one came from the files", () => {
    expect(turnsOf("g\0nobody", files([turn(0), turn(1)]))).toHaveLength(2);
    useChatData.getState().take("g\0v", view([turn(0)]));
    expect(turnsOf("g\0v", files([turn(0), turn(1)]))).toHaveLength(1);
  });

  it("stamps turns by how far the latest has got", () => {
    expect(stampOf([])).toBe("0");
    expect(stampOf([turn(0)])).toBe(stampOf([turn(0)]));
    expect(stampOf([turn(0)])).not.toBe(stampOf([turn(0, { end: 7 })]));
    expect(stampOf([turn(0)])).not.toBe(stampOf([turn(0, { calls: 1 })]));
    expect(stampOf([turn(0)])).not.toBe(stampOf([turn(0), turn(1)]));
  });
});

describe("a turn's files", () => {
  it("fetches them once, then has them as kept", async () => {
    const f = latest();
    const got = loadFiles(f);
    await answer();
    expect((await got).turns).toHaveLength(1);
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toBe("/api/files?gatherer=g&channel=" + f.channel + "&cwd=%2Fw");
    await loadFiles(f);
    await loadFiles(f, { stamp: stampOf([turn(0)]) }); // the view as the files: nothing moved on
    expect(fetched).toHaveLength(1);
    expect(keptFiles(f)?.turns).toHaveLength(1);
  });

  it("fetches the latest turn's again once a view says the turns moved on, and only then", async () => {
    const f = latest();
    loadFiles(f);
    await answer();
    served = [turn(0), turn(1)];
    const moved = stampOf(served);
    const again = loadFiles(f, { stamp: moved });
    await answer();
    expect((await again).turns).toHaveLength(2);
    await loadFiles(f, { stamp: moved });
    expect(fetched).toHaveLength(2);
  });

  it("fetches an earlier turn's once, by its row", async () => {
    const f: FilesOf = { ...latest(), turn: 0, row: 0 };
    loadFiles(f);
    await answer();
    await loadFiles(f, { stamp: "anything" });
    expect(fetched).toEqual([`/api/files?gatherer=g&channel=${f.channel}&turn=0&cwd=%2Fw`]);
    loadFiles({ ...f, row: 99 }); // another turn at that index now
    await answer();
    expect(fetched).toHaveLength(2);
  });

  it("fetches each time when asked fresh (the page not streaming)", async () => {
    const f = latest();
    loadFiles(f);
    await answer();
    loadFiles(f, { fresh: true });
    await answer();
    expect(fetched).toHaveLength(2);
  });

  it("fetches one at a time, and once more after it for all that asked meanwhile", async () => {
    const f = latest();
    const first = loadFiles(f, { fresh: true });
    const a = loadFiles(f, { fresh: true }),
      b = loadFiles(f, { fresh: true });
    expect(fetched).toHaveLength(1);
    served = [turn(0), turn(1)];
    await answer();
    expect((await first).turns).toHaveLength(1);
    expect((await a).turns).toHaveLength(2);
    expect(await b).toBe(await a);
    expect(fetched).toHaveLength(2);
  });

  it("numbers the data, the same for the same data fetched again", async () => {
    const f = latest();
    const one = loadFiles(f);
    await answer();
    const two = loadFiles(f, { fresh: true });
    await answer();
    expect(filesSeq(await two)).toBe(filesSeq(await one)); // unchanged: the object kept
    served = [turn(0, { calls: 2 })];
    const three = loadFiles(f, { fresh: true });
    await answer();
    expect(filesSeq(await three)).not.toBe(filesSeq(await one));
    expect(filesSeq(null)).toBe(0);
  });

  it("says no database as no turns, and fails on another error", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "no database for gatherer 'g'" })));
    expect((await loadFiles(latest())).turns).toEqual([]);
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    await expect(loadFiles(latest())).rejects.toThrow("500");
  });
});
