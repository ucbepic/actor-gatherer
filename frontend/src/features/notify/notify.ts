// WHAT COMES TO WANT THE READER, said as it happens: an app's NOTIFICATION (app_kit's notices.py: sent by its backend's
// Host.notify or its panel's ag.notices.send; data.py's `app_notices`, a gatherer's `apps`), and an actor that comes to
// wait for them (a question, a plan to approve) or stops on an error -- each the same way, from what the homes bring
// (heedHome, as each is taken: what wants the reader worked out by want.ts): a POP-UP in the page's corner (Pops.tsx,
// longer while the pointer is on it; a click opening what it is about, its × putting it away) and, the page not in front
// of the reader, the computer's own notification too (`system`), each once. An app's only where the app asked: "ag" in
// its `show` for the pop-up, "system" for the computer's -- neither, it is only listed (a quiet one); an actor's only
// while the reader keeps actors' pop-ups (`heed.actors`). Nothing for what the reader has in front of them -- its pane or
// panel shown, the page in focus -- nor for what was there as the page loaded (its first home). The computer's needs the
// reader's leave once, in a browser (the desktop app gives it): asked from the settings (Leave.tsx). Both choices kept in
// this browser (HEED_KEY).
//
// An app's notification is listed until the reader looks at the app (features/list/seen.ts: its panel shown, the page in
// front), the app clears it, or the reader dismisses it (its × in a card: dismissNotice). A click on one (a card's, a
// pop-up's, the computer's) shows the app's panel and hands it where the notification said (openNotice: the SDK's
// ag.notices.onOpen).
import { post } from "../../core/api/client";
import { appItem, key } from "../../core/model/keys";
import * as prefs from "../../core/prefs";
import { el } from "../../core/page/dom";
import { ICONS, strokeIcon } from "../../core/page/icons";
import { SNAPSHOT, panes, state } from "../../core/page/state";
import type { AppNotice, PageHome } from "../../core/page/types";
import { drawLeave } from "./Leave";
import { link } from "./link";
import { POP_MOST, popUp } from "./Pops";
import { dropGoneIn, freshOf, saidOf, saidWhere, wanting, type Want } from "./want";

const HEED_KEY = "ag-dashboard-notify";
const heed = (() => {
  const v: Record<"actors" | "system", boolean> = { actors: true, system: true };
  const k = (prefs.json(HEED_KEY) || {}) as Record<string, unknown>;
  for (const n of Object.keys(v) as (keyof typeof v)[]) if (typeof k[n] === "boolean") v[n] = k[n] as boolean;
  return v;
})();
let heedWas: Set<string> | null = null; // what wanted the reader in the last home taken (null: none taken)
const goneNotices = new Set<string>(); // dismissed here: left out of the homes until the server has it so
const pageInFront = () => document.visibilityState === "visible" && document.hasFocus();
const canSay = () => "Notification" in window && Notification.permission === "granted";
const appKey = (gname: string, id: string) => key(gname, appItem(id));

/** Whether the reader has it in front of them: its pane (an actor's) or its panel (an app's) shown, the page in front. */
const inFront = (w: Want) =>
  pageInFront() &&
  (w.a
    ? link.openActors().some((s) => link.isAt(s, w.g.name, (w.a as { channel: string }).channel))
    : panes.apps.some((p) => !p.held && p.instance.id === w.id));
/** What a home brought that wants the reader, and was not there before: popped up, and, the page not in front, said on
 * the computer. */
export function heedHome(): void {
  if (SNAPSHOT || !state.home) return;
  const now = wanting(state.home, (a) => link.status(a), link.seenAt(), appKey),
    was = heedWas;
  heedWas = new Set(now.keys());
  const fresh = freshOf(now, was, heed.actors, inFront);
  for (const [k, w] of fresh.filter(([, w]) => saidWhere(w, "ag")).slice(-POP_MOST)) popUpWant(k, w);
  if (heed.system && !pageInFront() && canSay())
    for (const [k, w] of fresh) if (saidWhere(w, "system")) sayOnComputer(k, w);
}
/** Opened: an actor shown, as a click on its row shows it; an app's panel, where the notification says. */
function openWant(w: Want) {
  if (w.n) return openNotice(w.g.name, w.id as string, w.n);
  link.pick(w.g.name, (w.a as { channel: string }).channel); // as a plain click: where its task is open (features/layout/panes.js's viaTabs)
}
function popUpWant(k: string, w: Want) {
  const [title, line, where] = saidOf(w, link);
  const o = w.a ? null : link.appInfo(w.g.name, w.id as string);
  const face = w.a
    ? link.plainFace(w.a)
    : o
      ? link.appFace(o)
      : el("span", { class: "logo app-face" }, strokeIcon(ICONS.app, 16));
  popUp({
    want: k,
    cls: w.n ? "notified" : (w.why as string),
    title,
    line,
    where,
    tip: w.n ? "Open in app" : "Show this actor",
    face,
    open: () => void openWant(w),
  });
}
function sayOnComputer(k: string, w: Want) {
  const [title, line, where] = saidOf(w, link);
  try {
    const n = new Notification(title, { body: [line, where].filter(Boolean).join("\n"), tag: k });
    n.onclick = () => {
      n.close();
      window.focus();
      const app = (window as unknown as { agApp?: { raise?: () => void } }).agApp;
      if (app && app.raise) app.raise();
      void openWant(w);
    };
  } catch {
    /* this browser says none from a page */
  }
}
/** An app's notification opened: the app's panel shown (selected, as its row's click does) and handed where it said. */
export async function openNotice(gname: string, id: string, n: AppNotice): Promise<void> {
  let o = link.appInfo(gname, id);
  if (!o) {
    await link.readApps(gname, true);
    o = link.appInfo(gname, id);
  }
  if (!o) return link.paneNote("That app is closed");
  await link.selectApp(gname, o);
  const p = panes.apps.find((q) => q.instance.id === id);
  if (p) p.panel.intent("notice", { id: n.id, where: n.where === undefined ? null : n.where });
}
/** One dismissed by the reader: gone from the list at once, and settled on the server (its `app_notice_settled`). */
export async function dismissNotice(gname: string, id: string, n: AppNotice): Promise<void> {
  goneNotices.add(n.id);
  dropGone(state.home);
  link.listChanged();
  try {
    await post("/api/apps/notices/settle", { gatherer: gname, instance: id, which: n.id, by: "user" });
  } catch (err) {
    goneNotices.delete(n.id);
    link.setLive(`Not dismissed: ${(err as Error).message}`);
  }
}
/** A home's notifications without those dismissed here (a home read before the server had it so). */
export const dropGone = (home: PageHome | null): void => dropGoneIn(home, goneNotices);

// The settings' "Notifications": actors' pop-ups on or off, the computer's too or not -- and, in a browser that has not
// given its leave, a button asking for it (Leave.tsx)
function setHeed(what: "actors" | "system", on: boolean, keep = true) {
  heed[what] = on;
  if (keep) prefs.keep(HEED_KEY, heed);
  drawHeed();
}
function drawHeed() {
  for (const b of document.querySelectorAll<HTMLElement>("[data-heed]")) {
    const [what, v] = (b.dataset.heed as string).split(":");
    b.setAttribute("aria-pressed", String(heed[what as "actors" | "system"] === (v === "on")));
  }
  drawLeave(heed.system);
}
/** What this module did as the page's script ran, in that order: page.js runs it once every module is loaded. */
export function start(): void {
  if (!SNAPSHOT) {
    for (const id of ["notify-actors", "notify-system"])
      document.getElementById(id)?.addEventListener("click", (ev) => {
        const b = (ev.target as Element).closest<HTMLElement>("[data-heed]");
        if (!b) return;
        const [what, v] = (b.dataset.heed as string).split(":");
        setHeed(what as "actors" | "system", v === "on");
      });
    drawHeed();
    window.addEventListener("focus", () => {
      if (state.home) link.markSeen(); // the page in front: what its panels show, seen
    });
  }
}
