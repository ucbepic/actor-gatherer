// A minimized pane's card (CardBody.tsx), opened from its lines (Lines.tsx): the page's, one at a time, for the pane whose
// lines are hovered, made from that pane's data, and put over what is above the pane, where there is room. Hovered a
// moment, a line opens it (focused, at once); the pointer off the line and the card a moment, it shuts. Esc closes it from
// anywhere on the page, the message box too -- open, it is what the reader is looking at -- back on its line if the focus
// was in it. Drawn again with its pane (`drawn`), anchored to the line of the same kind, its scroll kept (at its end:
// kept there). A line drawn anew between the pointer coming onto it and the card opening (a view came meanwhile) is
// found again in its pane by its kind.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";
import { inkOf } from "../../../core/ui/stage/model";
import { loadFiles } from "../files";
import { P, type Pane } from "../link";
import type { Command, Turn } from "../types";
import { CardBody, type CardData } from "./CardBody";
import { miniOf, openAt, miniData, type KeyedActor } from "./parts";

/** The line the card is open for, by its pane and kind: drawn hot. */
export const useHot = create<{ pane: Pane | null; kind: string | null }>()(() => ({ pane: null, kind: null }));

let card: { node: HTMLDivElement; root: Root } | null = null;
let anchor: HTMLElement | null = null,
  kind = "now",
  info: KeyedActor | null = null,
  pane: Pane | null = null,
  forKey: string | null = null;
let timer = 0,
  shutAt = 0,
  hush = false;
/** What the reader opened in it (earlier turns, a command, a reply), for the actor it is open for. */
const opened = new Set<string>();
/** An earlier turn's commands, as Chat's files and commands have them (files.ts: fetched once, kept by the turn):
 * "<actor> <n>" -> the list, or its fetch under way. */
const fetched = new Map<string, readonly Command[] | Promise<unknown>>();

const isOpen = (): boolean => !!card && card.node.isConnected;
const linesIn = (p: Pane): HTMLElement[] => [...p.main.querySelectorAll<HTMLElement>(".chat.mini .mh-row")];

function onKey(ev: KeyboardEvent): void {
  if (ev.key !== "Escape" || !isOpen()) return;
  ev.preventDefault();
  ev.stopPropagation();
  const a = anchor,
    inside = card!.node.contains(document.activeElement);
  shut();
  if (inside && a && a.isConnected) {
    hush = true; // back on its line, closed
    a.focus({ preventScroll: true });
    hush = false;
  }
}

function shut(): void {
  clearTimeout(timer);
  clearTimeout(shutAt);
  document.removeEventListener("keydown", onKey, true);
  if (card) {
    card.root.unmount();
    card.node.remove();
  }
  card = null;
  anchor = null;
  useHot.setState({ pane: null, kind: null });
}

function hover(r: HTMLElement): void {
  clearTimeout(shutAt);
  if (isOpen()) {
    open(r, false); // open: another line's at once
    return;
  }
  clearTimeout(timer);
  const from = P().paneAt(r); // (its pane, should the line be drawn anew meanwhile)
  timer = window.setTimeout(() => open(r, true, from), 140);
}

function leave(): void {
  clearTimeout(timer);
  clearTimeout(shutAt);
  shutAt = window.setTimeout(shut, 260);
}

function open(r: HTMLElement, grow: boolean, from: Pane | null = null): void {
  if (hush) return;
  if (!r.isConnected) {
    // drawn anew since the pointer came onto it (a view came meanwhile, before the browser's own mouseenter on the new
    // one): its pane's line of its kind there now
    const k = r.dataset.kind;
    const now = from && from.main ? linesIn(from).find((x) => x.dataset.kind === k) : null;
    if (!now) return;
    r = now;
  }
  clearTimeout(shutAt);
  const page = P(),
    p = page.paneAt(r),
    k = page.paneKey(p);
  if (!p || !k) return;
  if (forKey !== k) {
    opened.clear();
    forKey = k;
    info = null;
  }
  const again = isOpen() && kind === r.dataset.kind && pane === p;
  anchor = r;
  kind = r.dataset.kind || "now";
  pane = p;
  useHot.setState({ pane: p, kind });
  if (!info) info = page.paneInfo(p);
  if (!isOpen()) {
    const node = document.createElement("div");
    node.className = "mh-card floats";
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-label", "The conversation");
    node.addEventListener("mouseenter", () => clearTimeout(shutAt));
    node.addEventListener("mouseleave", leave);
    document.body.append(node);
    document.addEventListener("keydown", onKey, true);
    card = { node, root: createRoot(node) };
  }
  place(); // placed first: its scroll kept, or set, at the size it has
  fill(again); // open for this line already (the pointer back on it, the line drawn again under it): its scroll kept,
  // not grown in again
  if (grow && !again) {
    card!.node.classList.remove("grow");
    void card!.node.offsetWidth;
    card!.node.classList.add("grow");
  }
  if (!again) aim();
}

/** The pane drawn again: the card, if open, with it -- anchored to the new line, its scroll kept (at its end: kept
 * there). The lines are on the page once the pane's card has put them there, by the end of this task. */
function drawn(p: Pane, a: KeyedActor): void {
  if (p !== pane) return; // (another pane's lines)
  info = a;
  if (!isOpen()) return;
  if (P().paneKey(p) !== forKey) {
    shut();
    return;
  }
  queueMicrotask(() => {
    if (!isOpen()) return;
    const lines = linesIn(p);
    const now = lines.find((x) => x.dataset.kind === kind) || lines[lines.length - 1];
    if (!now || !P().chatMin(p)) {
      shut();
      return;
    }
    anchor = now;
    useHot.setState({ pane: p, kind: now.dataset.kind || kind });
    place(); // (first: its scroll kept at the size it has)
    fill(true);
  });
}

/** Over the pane, rising from its lines: at least 420px wide, as tall as its content up to 640px or the room above it. */
function place(): void {
  if (!anchor || !card) return;
  const box = anchor.closest(".mini-hist"),
    strip = anchor.closest(".chat.mini");
  if (!box || !strip) return;
  const h = box.getBoundingClientRect(),
    s = strip.getBoundingClientRect(),
    W = window.innerWidth,
    H = window.innerHeight;
  const w = Math.min(W - 24, Math.max(420, Math.min(640, h.width + 80)));
  const left = Math.min(Math.max(12, h.left - 6), W - w - 12),
    top = s.top;
  Object.assign(card.node.style, {
    width: `${w}px`,
    left: `${left}px`,
    bottom: `${H - top + 8}px`,
    maxHeight: `${Math.min(640, Math.max(200, top - 56))}px`,
  });
  card.node.style.setProperty("--ox", `${anchor.getBoundingClientRect().left - left + 20}px`);
}

/** Opened at its end; from the user's line, at their last message. */
function aim(): void {
  const body = card && card.node.querySelector<HTMLElement>(".mh-body");
  if (!body) return;
  body.scrollTop = body.scrollHeight;
  if (kind === "you") {
    const y = [...body.querySelectorAll<HTMLElement>(".mh-you")].pop();
    if (y) body.scrollTop = y.offsetTop - 8;
  }
}

/** An earlier turn's commands fetched, once: the card drawn again once they come. */
function fetchTurn(p: Pane, a: KeyedActor, t: Turn, k: string): void {
  if (fetched.has(k)) return;
  const cwd = (a && (a.cwd || (a.session as { cwd?: string } | null)?.cwd)) || "";
  fetched.set(
    k,
    loadFiles({ gatherer: p.g!, channel: p.c!, turn: t.n, row: t.row_id ?? null, cwd }).then(
      (got) => {
        fetched.set(k, got.commands || []);
        if (isOpen()) fill(true);
      },
      () => fetched.delete(k),
    ),
  );
}

/** The card drawn now; `update`, its scroll kept (at its end: kept there). */
function fill(update: boolean): void {
  const p = pane;
  const a: KeyedActor | null = info || (p && P().paneInfo(p));
  if (!card || !p || !a) return;
  const old = card.node.querySelector<HTMLElement>(".mh-body");
  const atEnd = !old || old.scrollHeight - old.scrollTop - old.clientHeight < 8,
    top = old ? old.scrollTop : 0;
  const actor = P().paneKey(p) || "";
  const d: CardData = {
    actor,
    info: a,
    mini: miniOf(p, a, !!a.running),
    harnessName: P().harnessName(a.harness),
    opened,
    fetched,
    paths: { cwd: P().paneInfo(p)?.cwd || "", home: miniData(p)?.home || "" },
    toggle: (key, on) => {
      if (on) opened.add(key);
      else opened.delete(key);
      fill(true);
    },
    fetchTurn: (t) => fetchTurn(p, a, t, `${actor} ${t.n}`),
    openAt: (n, side) => {
      shut();
      openAt(p, n, side);
    },
  };
  const { node, root } = card;
  flushSync(() => root.render(createElement(CardBody, { d })));
  const hue = inkOf(a);
  if (hue) node.style.setProperty("--mh-ink", hue);
  else node.style.removeProperty("--mh-ink");
  const body = node.querySelector<HTMLElement>(".mh-body");
  if (update && body) body.scrollTop = atEnd ? body.scrollHeight : top;
}

if (typeof window !== "undefined")
  window.addEventListener("resize", () => {
    if (isOpen()) place();
  });

/** The card, as the lines and the layout call it. */
export const miniCard = { hover, leave, open, shut, drawn, isOpen };
