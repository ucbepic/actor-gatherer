// The monitor: every actor of the gatherers not hidden, a column for each group of the list that has any, side by side,
// Saved and Closed folded to a strip until opened, each column's fold kept in this browser -- and in each, a card for
// each actor (Monitor.tsx, from monitor-model.ts's model). What its turn did is read from the server (monitor.py) for the
// cards in view, again when the actor changes (monSig), at most every MON_GAP ms. A card is drawn again only where it
// changed, so an actor at work goes on as it was (its stage, its glyphs: on the page's clock).
import { get } from "../../core/api/client";
import { key } from "../../core/model/keys";
import * as prefs from "../../core/prefs";
import { L, S, snap } from "./link";
import { CTX, listView } from "./list";
import { LIST_HOST } from "./list-host";
import { listMode, leaveFull } from "./modes";
import { drawMonitor, forget } from "./modes-mount";
import type { MonitorHost } from "./Monitor";
import { buildMonitor, type MonData } from "./monitor-model";
import { statusOf } from "./seen";
import type { Actor } from "./types";

const MON_FOLD_KEY = "ag-dashboard-monitor-folded",
  MON_GAP = 1000,
  MON_BATCH = 24;
const monFolded = new Set((prefs.list(MON_FOLD_KEY) as string[] | null) || ["Saved", "Closed"]);
const mon = {
  got: new Map<string, { sig: string; data: MonData | null }>(),
  visible: new Set<string>(),
  timer: undefined as ReturnType<typeof setTimeout> | undefined,
  busy: false,
  last: -Infinity,
  seen: null as IntersectionObserver | null,
  old: false, // the server started before the monitor was, and has no /api/monitor
};
const monSig = (a: Actor) => `${a.last}|${a.events}|${statusOf(a)[0]}`;
/** Left: nothing in view; what was read stays, for coming back. */
export function monForget(): void {
  forget(document.getElementById("monitor")!);
  if (mon.seen) mon.seen.disconnect();
  mon.seen = null;
  mon.visible.clear();
}
function foldSection(name: string) {
  if (monFolded.has(name)) monFolded.delete(name);
  else monFolded.add(name);
  prefs.keep(MON_FOLD_KEY, [...monFolded]);
  renderMonitor();
}
// what the monitor calls of the page (Monitor.tsx's MonitorHost): made once, so its cards are drawn again only when what
// they show changes
let monHost: MonitorHost | null = null;
const MON_HOST = (): MonitorHost =>
  (monHost ??= {
    ...LIST_HOST,
    ctx: CTX,
    folderIcon: L.helpers.ICONS.folder,
    observe: (n) => {
      if (mon.seen) mon.seen.observe(n);
    },
    unobserve: (n, k) => {
      if (mon.seen) mon.seen.unobserve(n);
      mon.visible.delete(k);
    },
    foldSection,
    show: (g, a, ev) => {
      leaveFull();
      void L.panes.pick(g.name, a.channel, ev);
    },
    showBeside: (g, a, ev) => {
      if (L.helpers.MAC && ev.ctrlKey && !snap()) leaveFull();
      L.panes.pickBeside(g.name, a.channel, ev);
    },
    avatarMode: () => L.helpers.avatarMode,
    permissionVerb: (asking) => L.chat.permissionVerb(asking),
    taskKind: (k) => (L.chat.TASK_KINDS[k as string] || k) as string,
    fileKinds: L.files.FILE_KINDS,
  });
export function renderMonitor(): void {
  if (listMode !== "full" || !S().home) return;
  if (!snap() && !mon.seen && "IntersectionObserver" in window)
    mon.seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const k = (e.target as HTMLElement).dataset.key!;
          if (e.isIntersecting) mon.visible.add(k);
          else mon.visible.delete(k);
        }
        monFetch();
      },
      { rootMargin: "200px 0px" }, // the page's: each column scrolls on its own
    );
  drawMonitor(
    document.getElementById("monitor")!,
    buildMonitor(CTX, listView(), { folded: monFolded, got: mon.got, old: mon.old, avatarMode: L.helpers.avatarMode }),
    MON_HOST(),
  );
  monFetch();
}
// What each card in view shows of its actor's turn, read for those changed since (MON_BATCH at a time).
function monFetch(soon = 150) {
  if (snap() || listMode !== "full" || mon.timer || mon.busy) return;
  mon.timer = setTimeout(monLoad, Math.max(soon, MON_GAP - (performance.now() - mon.last)));
}
async function monLoad() {
  mon.timer = undefined;
  const home = S().home;
  if (listMode !== "full" || !home) return;
  const stale: { k: string; sig: string; ask: [string, string, string | null] }[] = [];
  for (const g of home.gatherers)
    for (const a of g.agents) {
      const k = key(g.name, a.channel),
        had = mon.got.get(k);
      if (mon.visible.has(k) && (!had || had.sig !== monSig(a)))
        stale.push({ k, sig: monSig(a), ask: [g.name, a.channel, a.cwd || null] });
    }
  if (!stale.length) return;
  const batch = stale.slice(0, MON_BATCH);
  mon.busy = true;
  mon.last = performance.now();
  try {
    const got = await get<{ actors: MonData[] }>(
      `/api/monitor?actors=${L.history.enc(JSON.stringify(batch.map((b) => b.ask)))}`,
    );
    batch.forEach((b, i) => {
      const d = (got.actors || [])[i];
      mon.got.set(b.k, { sig: b.sig, data: d && !d.error ? d : null });
    });
    mon.old = false;
  } catch (e) {
    if (/: 404$/.test((e as Error).message)) mon.old = true;
    for (const b of batch) mon.got.set(b.k, { sig: b.sig, data: (mon.got.get(b.k) || { data: null }).data || null }); // tried again once it changes
  } finally {
    mon.busy = false;
  }
  renderMonitor();
  if (stale.length > batch.length) monFetch(0);
}
