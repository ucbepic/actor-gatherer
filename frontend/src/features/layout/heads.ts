// The panes' HEADS: their top row -- each pane's head -- as tall as the tallest of them, so the rule under it runs straight
// across: each says how tall it is by itself (`tops`), and all are given the tallest (--top-h). Not where the page is a
// phone's, its panes one under the other. A head put in its Chat view's bar (the Editor open) is hidden, of no height.
// Each head says whose pane it is (drawWho); a line over the panes for a moment says why nothing opened (paneNote).
import { isShell } from "../../core/model/keys";
import { tildePath } from "../../core/ui/highlight";
import { L, panes, state } from "./link";
import { allPanes } from "./open";
import type { Pane } from "./types";

/** A phone's width: nothing placed, the panes one under another. */
export const NARROW = matchMedia("(max-width: 760px)");
const tops = new Map<unknown, number>();
/** Pane `who`'s head as tall as `height` (null: gone): the top row as tall as the tallest. */
export function topRow(who: unknown, height: number | null): void {
  if (height === null) tops.delete(who);
  else tops.set(who, height);
  const tallest = NARROW.matches ? 0 : Math.ceil(Math.max(0, ...tops.values())) + 1; // and the rule under it
  if (tallest === panes.top) return;
  panes.top = tallest;
  document.documentElement.style.setProperty("--top-h", `${tallest}px`);
}
/** Pane `who`'s head `node` (this page's own: "here") watched for its height. */
export function watchTop(node: HTMLElement, who: Pane | string): void {
  const watch = new ResizeObserver(() => {
    if (node.isConnected) topRow(who, node.getBoundingClientRect().height);
  });
  watch.observe(node);
  if (typeof who === "object") who.watch = watch;
}
/** At a phone's width and back: the top row measured again. */
export function startHeads(): void {
  NARROW.addEventListener("change", () => {
    panes.top = null;
    topRow("here", tops.get("here") || 0);
  });
}

/** A pane's head (none given: every pane's): whose it is, as the list has the actor -- its avatar, its name or what it
 * was last asked. This page's own, alone, has none. */
export function drawWho(p?: Pane): void {
  if (!p) {
    for (const q of allPanes()) drawWho(q);
    return;
  }
  if (p === panes.here && !panes.others.length) return;
  const el = L.helpers.el;
  const sh = p.c && isShell(p.c) ? shellOf(p.c) : null;
  if (sh) {
    const sig = JSON.stringify([p.g, p.c, sh, state.home?.home_dir]);
    if (sig === p.drawn.who) return;
    p.drawn.who = sig;
    p.who.replaceChildren(L.list.shellLogo(), el("span", { class: "tx", text: shellPath(sh) }));
    p.who.title = `Terminal · ${sh.gatherer}\n${sh.cwd}`;
    return;
  }
  const info = L.paneView.paneInfo(p);
  const sig = JSON.stringify([
    p.g,
    p.c,
    info && [info.avatar, info.harness, info.last_user_message, info.name && info.name.text],
  ]);
  if (sig === p.drawn.who) return;
  p.drawn.who = sig;
  const named = info?.name?.text;
  p.who.replaceChildren(
    ...(info
      ? [
          L.appActors.actorLogo(info),
          el("span", { class: "tx", text: named || info.last_user_message || info.channel }),
        ]
      : []),
  );
  p.who.title = info
    ? [named, info.last_user_message, `${L.helpers.harnessName(info.harness)} · ${p.g} · ${info.channel}`]
        .filter(Boolean)
        .join("\n")
    : "";
}
/** A shell of the home, by its id; where it runs, from the home folder. */
export const shellOf = (c: string) => (isShell(c) && state.home?.shells?.find((s) => s.id === c)) || null;
export const shellPath = (s: { cwd: string }): string => tildePath(s.cwd, state.home?.home_dir);

/** A line over the panes for a moment: why nothing opened. */
export function paneNote(text: string): void {
  const n = L.helpers.el("div", { class: "pane-note", role: "status", text });
  document.getElementById("panes")!.append(n);
  if (document.querySelector(".work.placed")) n.style.top = `${panes.here.node.offsetTop + 12}px`; // over the actors' panes
  setTimeout(() => n.remove(), 3500);
}
