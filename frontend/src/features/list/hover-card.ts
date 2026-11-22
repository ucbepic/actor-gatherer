// THE HOVER CARD an actor shows while hovered, in the rail or the list (or in focus from the keys): its avatar and name,
// its gatherer and harness, its directory, its status, when it last did something and its size, what it was last asked
// (under its name, if it has one), its recap, what runs in the background, its branch -- a task's, an app's, a folder's
// and a gatherer's too (Card.tsx draws it). Beside the rail or the list (card-place.ts), level with the actor, inside
// the window; the pointer passes through it (but a live card's: cardLive). It waits a moment the first time
// (HOVER_WAIT), then follows the pointer from actor to actor at once; none over an actor's own buttons, which say what
// they do. Kept by where it came from and the actor's key (data-card): the rail or the list drawn again under it, the
// card is said again from the new data, at the actor's new place. Where there is no hovering (a touch screen), the
// actor's title says it instead.
import { parse as parseKey } from "../../core/model/keys";
import { appInfo } from "./apps";
import { cardPlace } from "./card-place";
import type { CardEdit, CardHost, CardWhat } from "./CardParts";
import {
  deleteFolder,
  dropFolderClosing,
  folderById,
  folderClosing,
  nameFolder,
  pressClose,
  reopenFolder,
  setFolderClosing,
  closeFolder,
  showFolder,
} from "./folders";
import { L, S, snap } from "./link";
import { collapsed, CTX, keepTitle, renderAgents, setHidden, tabAt, titleOf } from "./list";
import { LIST_HOST } from "./list-host";
import { listMode, railAt, railDrill, sameAt } from "./modes";
import { drawCard, drawingNow } from "./modes-mount";
import { itemNamed, nameItem } from "./naming";
import { addInfo, addItems, isAppItem, takeOut, APP_ITEM } from "./task-acts";
import { appTitle, taskById, taskName } from "./tasks";
import { tidyName } from "./folder-edits";

export const HOVERS = matchMedia("(hover: hover)");
const HOVER_WAIT = 250,
  CARD_ON_THE_WAY = 250;
type From = "rail" | "agents";
export const hover = {
  from: null as From | null,
  key: null as string | null,
  shown: false,
  timer: undefined as ReturnType<typeof setTimeout> | undefined,
  node: null as HTMLElement | null,
  keys: false,
};
const HOVER_FROM: Record<From, () => boolean> = {
  rail: () => listMode === "folded",
  agents: () => listMode === "list",
};
function hoverTo(from: From | null, k: string | null) {
  clearTimeout(hover.timer);
  if (!k) {
    hover.timer = setTimeout(cardLetGo, cardLive() ? 300 : 120);
    return;
  }
  if (k === hover.key && from === hover.from && hover.shown) return;
  const go = () => {
    hover.from = from;
    hover.key = k;
    hover.shown = true;
    cardDraw();
  };
  // a live card shown: the pointer, on its way to it, may cross another item -- switched only once it lingers there
  // (CARD_ON_THE_WAY), the card's own pointerenter keeping it
  if (hover.shown && cardLive()) hover.timer = setTimeout(go, CARD_ON_THE_WAY);
  else if (hover.shown) go();
  else hover.timer = setTimeout(go, HOVER_WAIT);
}
// Put away -- by a click on what it says, too: the rows and tiles under a pointer at rest stay the same elements as
// they are drawn again, so no card comes back over what the click opened until the pointer moves
export function cardHide(): void {
  clearTimeout(hover.timer);
  hover.from = null;
  hover.key = null;
  hover.shown = false;
  cardEdit = null;
  dropFolderClosing("card");
  if (hover.node) hover.node.hidden = true;
}
// A LIVE card -- a folder's or a gatherer's, in the rail; a task's or an app's -- is one to use, not only read: the
// pointer may go onto it, and it stays while the pointer, a menu opened from it, or its name box is on it, or something
// starts (cardLetGo); its buttons do what the list's do on the folder's line or the gatherer's row, its name box names
// there (cardEdit), and a click on one of its actors shows it.
const cardLive = () => !!hover.node && !hover.node.hidden && hover.node.classList.contains("live");
function cardLetGo() {
  const card = hover.node!;
  if (cardLive() && S().starting) {
    hover.timer = setTimeout(cardLetGo, 300); // what it started: its answer, first
    return;
  }
  const P = L.panes;
  if (
    cardLive() &&
    (card.matches(":hover") ||
      ((cardEdit || folderClosing) && card.contains(document.activeElement)) ||
      (P.rowPop.el && card.contains(P.popButton())) ||
      card.querySelector('[aria-haspopup="menu"][aria-expanded="true"]')) // its menu (Menus.tsx's) open
  )
    return;
  cardHide();
}
// a menu opened from the card closed: the card let go of too, once the pointer is not on it
export function cardRelease(): void {
  if (cardLive() && !hover.node!.matches(":hover")) hoverTo(hover.from, null);
}
export function cardDraw(): void {
  const box = hover.from && document.getElementById(hover.from);
  const at = box && [...box.querySelectorAll<HTMLElement>("[data-card]")].find((n) => n.dataset.card === hover.key);
  const { group: gname, id: channel } = parseKey(hover.key);
  const g = S().home!.gatherers.find((x) => x.name === gname),
    a = g && g.agents.find((x) => x.channel === channel);
  const c = channel || "";
  const f = g && !a && /^folder:\d+$/.test(c) ? folderById(g.name, Number(c.slice(7))) : null;
  const t = g && !a && /^task:\d+$/.test(c) ? taskById(CTX, g.name, Number(c.slice(5))) : null;
  const o = g && !a && isAppItem(c) ? appInfo(g.name, c.slice(APP_ITEM.length)) : null;
  const top = !!g && !a && c === "gatherer:";
  if (!box || !at || !g || !(a || f || t || o || top) || !HOVER_FROM[hover.from!]()) {
    cardHide();
    return;
  }
  if (!hover.node) {
    // (floats: over a native page, it covers it -- apps/native.ts)
    hover.node = Object.assign(document.createElement("div"), { className: "actor-card floats", id: "actor-card" });
    hover.node.setAttribute("role", "tooltip");
    hover.node.addEventListener("pointerenter", () => clearTimeout(hover.timer));
    hover.node.addEventListener("pointerleave", () => {
      if (cardLive()) hoverTo(hover.from, null);
    });
    document.body.append(hover.node);
  }
  // a task's: in the list too -- but one shown by the keys (a row in focus) only read, the pointer passing through it:
  // its buttons are the pointer's, and one put over the panels (focus given back to the row, Esc closing a menu) would
  // take the next click meant for what is under it
  const card = hover.node,
    live = !snap() && !hover.keys && (!!t || !!o || (hover.from === "rail" && (!!f || top)));
  card.classList.toggle("live", live);
  card.setAttribute("role", live ? "group" : "tooltip");
  if (live)
    card.setAttribute(
      "aria-label",
      t
        ? `The task ${taskName(CTX, g, t)}`
        : o
          ? `The app ${appTitle(o)}`
          : f
            ? `The folder ${f.name}`
            : `The group ${titleOf(g)}`,
    );
  else card.removeAttribute("aria-label");
  if (cardOpen.key !== hover.key) cardOpen = { key: hover.key, ids: new Set() }; // another card: its tree as it starts
  const asking =
    !!f && !!folderClosing && folderClosing.from === "card" && folderClosing.g === g.name && folderClosing.id === f.id;
  const what: CardWhat = t
    ? { kind: "task", g, t }
    : o
      ? { kind: "app", g, o }
      : f
        ? { kind: "folder", g, f, live, opened: cardOpen.ids, asking, here: sameAt(railAt, { g: g.name, f: f.id }) }
        : top
          ? { kind: "gatherer", g, here: sameAt(railAt, { g: g.name, f: null }), folded: collapsed.has(g.name) }
          : {
              kind: "actor",
              g,
              a: a!,
              shown: hover.from === "agents" && L.panes.isAt(L.panes.focusedActor(), g.name, a!.channel),
            };
  drawCard(
    card,
    { what, edit: cardEdit && cardEdit.g === g.name && cardEdit.key === hover.key ? cardEdit : null },
    CARD_HOST(),
  );
  card.hidden = false;
  (at.querySelector(":scope > :is(.a-main, .r-main)") || at).setAttribute("aria-describedby", "actor-card"); // a row's: its main button's
  const p = cardPlace(
    at.getBoundingClientRect(),
    box.getBoundingClientRect(),
    card.offsetWidth,
    card.offsetHeight,
    { width: innerWidth, height: innerHeight },
    hover.from === "rail",
  );
  card.style.left = `${p.left}px`;
  card.style.top = `${p.top}px`;
}
// What is in a card (Card.tsx, CardFolder.tsx): an actor's, a task's and an app's -- live in the list and the rail:
// their items each a button, an app's notifications -- a folder's (live in the rail: its buttons as its line's in the
// list, its tree opened in place by a click, `cardOpen`, for as long as the card shows that folder) and a gatherer's.
// What a press on it does is the page's (CARD_HOST).
let cardOpen = { key: null as string | null, ids: new Set<number>() };
// The card's name box: a folder named or made (`cardEdit`: {g, id -- null, made in `parent` -- parent}), the gatherer
// renamed ({g, gatherer: true}), or a task or an app ({g, item}: naming.ts's itemNamed), as the list's own box does,
// which is out of sight with the list folded -- in the card it was opened in only (its `key`), each a box of its own
// (`n`). Enter, or leaving it, keeps what is typed; Esc, or nothing typed, leaves it. One a draw takes away (the card is
// another's now: modes-mount.tsx's drawingNow) is not left by the reader: kept, for the card again.
let cardEdit: (CardEdit & { key: string | null }) | null = null,
  cardEdits = 0;
function editInCard(edit: Omit<CardEdit, "n" | "value">) {
  const g = S().home!.gatherers.find((x) => x.name === edit.g);
  const item = edit.item && g ? itemNamed(g, edit.item) : null;
  if (edit.item && !item) return;
  cardEdit = {
    ...edit,
    n: ++cardEdits,
    key: hover.key,
    ...(item ? { kind: item[0], auto: item[3] } : {}),
    value: item
      ? item[2]
      : edit.gatherer
        ? g
          ? titleOf(g)
          : edit.g
        : edit.id !== null && edit.id !== undefined
          ? (folderById(edit.g, edit.id) || { name: "" }).name || ""
          : "",
  };
  cardDraw(); // its box focused as it opens, all of it selected
}
function endCardEdit(keep: boolean) {
  const e = cardEdit;
  if (!e) return;
  cardEdit = null;
  if (keep && e.item) void nameItem(e.g, e.item, e.value);
  else if (keep && e.gatherer) {
    const g = S().home!.gatherers.find((x) => x.name === e.g),
      text = tidyName(e.value, Infinity);
    if (g && text !== titleOf(g)) void keepTitle(e.g, text);
  } else if (keep) nameFolder(e.g, e.id ?? null, e.parent ?? null, e.value);
  if (hover.node && !hover.node.hidden) cardDraw();
}
// what a card calls of the page (Card.tsx's CardHost)
let cardHost: CardHost | null = null;
const CARD_HOST = (): CardHost =>
  (cardHost ??= {
    ...LIST_HOST,
    ctx: CTX,
    tabAt,
    cwdOf: (a) => L.panes.cwdOf(a),
    tilde: (p) => L.code.tildePath(p, S().home!.home_dir),
    actorLogo: (a) => L.appActors.actorLogo(a),
    cardHide,
    takeOut: (gname, k) => void takeOut(gname, k),
    openNotice: (gname, id, n) => L.notify.openNotice(gname, id, n),
    dismissNotice: (gname, id, n) => L.notify.dismissNotice(gname, id, n),
    adds: addInfo,
    addMenu: addItems,
    addClosed: cardRelease,
    startInfo: (which, g, f) => L.panes.cardStart(which, g, f),
    startPress: (which, g, f, button) => L.panes.cardStartPress(which, g, f, button),
    editIn: editInCard,
    editEnd: endCardEdit,
    editTyped: (v) => {
      if (cardEdit) cardEdit.value = v;
    },
    editBlur: (e) => {
      if (!drawingNow() && document.hasFocus() && cardEdit === e) endCardEdit(true);
    },
    deleteFolder: (gname, id) => void deleteFolder(gname, id),
    reopenFolder: (gname, id) => void reopenFolder(gname, id),
    setHidden: (g, hide) => void setHidden(g, hide),
    railDrill,
    pressClose: (g, f) => pressClose(g, f, "card", cardDraw),
    openInRail: (gname, id) => {
      showFolder(gname, id, true);
      renderAgents();
    },
    treeToggle: (id) => {
      if (cardOpen.ids.has(id)) cardOpen.ids.delete(id);
      else cardOpen.ids.add(id);
      cardDraw();
    },
    closeGo: (g, f) => {
      cardHide();
      setFolderClosing(null);
      void closeFolder(g, f);
    },
    closeCancel: () => {
      dropFolderClosing("card");
      cardDraw();
    },
    // the focus gone from its question (a click elsewhere): taken back, the card let go of once the pointer is off it
    askOut: (ev) => {
      if (drawingNow() || (ev.relatedTarget && hover.node && hover.node.contains(ev.relatedTarget as Node))) return;
      setTimeout(() => {
        if (
          !folderClosing ||
          folderClosing.from !== "card" ||
          (hover.node && hover.node.contains(document.activeElement))
        )
          return;
        dropFolderClosing("card");
        if (cardLive() && !hover.node!.matches(":hover")) cardHide();
        else cardDraw();
      }, 0);
    },
  });
// What this module did as the page's script ran: the list's and the rail's rows hovered, or in focus from the keys
export function start(): void {
  for (const from of Object.keys(HOVER_FROM) as From[]) {
    const box = document.getElementById(from)!;
    box.addEventListener("pointerover", (ev) => {
      if (ev.pointerType === "touch") return;
      hover.keys = false;
      const t = ev.target as Element;
      const at = t.closest<HTMLElement>("[data-card]");
      hoverTo(from, at && !t.closest(".save-btn, .close-btn, .branchline, .f-acts, .pick") ? at.dataset.card! : null);
    });
    box.addEventListener("pointerleave", () => hoverTo(from, null));
    box.addEventListener("focusin", (ev) => {
      // a row's or a tile's main button, or a name, in focus from the keys
      const t = ev.target as HTMLElement;
      const at = t.closest<HTMLElement>("[data-card]");
      const main = at && (t === at || (t.parentElement === at && t.matches(".a-main, .r-main")));
      if (main && t.matches(":focus-visible")) {
        hover.shown = true;
        hover.keys = true;
        hoverTo(from, at!.dataset.card!);
      }
    });
    box.addEventListener("focusout", () => hoverTo(from, null));
    box.addEventListener(
      "scroll",
      () => {
        if (hover.shown && hover.from === from) cardDraw();
      },
      true,
    ); // kept level with its actor
  }
  addEventListener("resize", () => {
    if (hover.shown) cardDraw();
  });
}
