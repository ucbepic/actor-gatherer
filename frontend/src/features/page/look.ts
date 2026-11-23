// The page's look, picked in the dashboard's panel and kept in this browser: light, dark or the system's; the actor at
// work acting or simple; Chat's earlier turns as messages only or whole. And the panel itself: opened by its button,
// closed by it again, by a click elsewhere, by Esc, or once a theme is picked.
import * as prefs from "../../core/prefs";
import { avatarMode, keepAvatarMode } from "../../core/page/avatar";
import { link } from "./link";
import { drawPane } from "./main-view";
import { allPanes } from "./pane-view";

const $ = (id: string) => document.getElementById(id) as HTMLElement;
/** The pick a press in `ev` was on: the value of `attr` on the button pressed, if one. */
const picked = (ev: Event, attr: string): HTMLElement | null =>
  (ev.target as Element | null)?.closest<HTMLElement>(`[${attr}]`) ?? null;
/** The buttons of a pick (`data-<name>-pick`) pressed or not as `value` is. */
const pressed = (attr: string, value: string, of: (b: HTMLElement) => string | undefined) => {
  for (const b of document.querySelectorAll<HTMLElement>(`[${attr}]`))
    b.setAttribute("aria-pressed", of(b) === value ? "true" : "false");
};

/** The dashboard's panel opened or closed. */
export function setAbout(open: boolean): void {
  $("about").hidden = !open;
  $("about-btn").setAttribute("aria-expanded", open ? "true" : "false");
}

// Light, dark, or the system's: kept in this browser, the page is dark until one is picked. "system": the system's look,
// followed as it changes (startLook's listener). The page always says which it shows (data-theme), so its stylesheet
// has the dark palette once (core/page/base.css).
const THEME_KEY = "ag-dashboard-theme";
let themePick = "system";
const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
/** The theme picked (`keep`: kept in this browser). */
export function setTheme(pick: string | null | undefined, keep: boolean): void {
  if (pick !== "light" && pick !== "dark") pick = "system";
  themePick = pick;
  document.documentElement.dataset.theme = pick === "system" ? (systemDark() ? "dark" : "light") : pick;
  pressed("data-theme-pick", pick, (b) => b.dataset.themePick);
  if (keep) prefs.setText(THEME_KEY, pick);
  window.dispatchEvent(new Event("ag-theme"));
}

// The actor at work in the Chat view: acting out what it does (the stage), or small with its one motion ("simple");
// kept in this browser, acting until one is picked.
const AVATAR_KEY = "ag-dashboard-avatar";
/** How an actor at work is drawn, picked (`keep`: kept in this browser; `draw`: the Chats drawn again). */
export function setAvatarMode(pick: string | null | undefined, keep: boolean, draw = true): void {
  keepAvatarMode(pick === "simple" ? "simple" : "acting");
  pressed("data-avatar-pick", avatarMode, (b) => b.dataset.avatarPick);
  if (keep) prefs.setText(AVATAR_KEY, avatarMode);
  if (draw) for (const p of allPanes()) if (link.chat.chatView(p).id === "files") drawPane(p);
}

// The Chat's turns before the latest, at first: the user's messages only, a click on one showing the rest ("messages")
// -- all but the latest two the agent answered, the one before them folded once a newer turn has its first answer; or
// each whole, a click on its message folding it. Kept in this browser, messages only until one is picked; a pick starts
// every turn over as it has them.
const EARLIER_KEY = "ag-dashboard-chat-earlier";
/** Chat's earlier turns: "messages" or "whole". */
export let earlierTurns = "messages";
export function setEarlierTurns(pick: string | null | undefined, keep: boolean, draw = true): void {
  earlierTurns = pick === "whole" ? "whole" : "messages";
  link.chat.clearFlips(); // the turns' clicks: Chat's turns (src/features/chat/store.ts)
  pressed("data-earlier-pick", earlierTurns, (b) => b.dataset.earlierPick);
  if (keep) prefs.setText(EARLIER_KEY, earlierTurns);
  if (draw) for (const p of allPanes()) if (link.chat.chatView(p).id === "files") drawPane(p);
}

/** The picks as kept, and the panel's listeners: data.ts's start runs it, in the order the page's script ran them. */
export function startLook(): void {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (themePick === "system") setTheme("system", false);
    else window.dispatchEvent(new Event("ag-theme"));
  });
  setAvatarMode(prefs.text(AVATAR_KEY), false, false);
  $("avatar-mode").addEventListener("click", (ev) => {
    const b = picked(ev, "data-avatar-pick");
    if (b) setAvatarMode(b.dataset.avatarPick, true);
  });
  setEarlierTurns(prefs.text(EARLIER_KEY), false, false);
  $("chat-earlier").addEventListener("click", (ev) => {
    const b = picked(ev, "data-earlier-pick");
    if (b) setEarlierTurns(b.dataset.earlierPick, true);
  });
  setTheme(prefs.text(THEME_KEY) || "dark", false);
  $("theme").addEventListener("click", (ev) => {
    const b = picked(ev, "data-theme-pick");
    if (b) {
      setTheme(b.dataset.themePick, true);
      setAbout(false);
    }
  });
  $("about-btn").addEventListener("click", () => {
    const open = !!$("about").hidden;
    setAbout(open);
    if (open) link.settings.load().catch(() => {});
  });
  $("about-x").addEventListener("click", () => setAbout(false)); // its own ×, as Esc
  document.addEventListener("click", (ev) => {
    if (!(ev.target as Element).closest(".about-wrap, .cfg-file")) setAbout(false);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (link.settings.fileOpen()) {
      link.settings.closeFile();
      return;
    }
    setAbout(false);
  });
}
