// The small faces the list draws and the old page's modules use as nodes (a pane's head, a notification, a message
// between actors): an app's mark and face, an actor's face with no badge, a terminal's mark, a coordinator agent's
// face. The list's own views draw them through their host (Html), the same nodes.
import { L, snap } from "./link";
import { appTitle } from "./tasks";
import type { Actor, AppItem } from "./types";

/** An element made as the page's `el` makes one: its attributes set (none for null or undefined), its children in. */
function make(tag: string, attrs: Record<string, string | null | undefined>, ...kids: (Node | null)[]): HTMLElement {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  for (const kid of kids) if (kid) n.append(kid);
  return n;
}
const markSrc = (o: AppItem) => `/apps/mark/${encodeURIComponent(o.app.name)}.svg`;
const icon = (name: string, size: number) => L.helpers.strokeIcon(L.helpers.ICONS[name], size);

/** An app's mark: small, beside a task's faces. */
export const appMarkOf = (o: AppItem): HTMLElement =>
  o.app.mark
    ? make("img", { class: "t-app", src: markSrc(o), alt: o.app.label, title: appTitle(o), draggable: "false" })
    : make("span", { class: "t-app none", title: o.app.label }, icon("app", 12));

/** An app's face: its mark at an avatar's size, where an actor has its face. */
export const appFace = (o: AppItem): HTMLElement =>
  make(
    "span",
    { class: "logo app-face", title: appTitle(o) },
    o.app.mark ? make("img", { src: markSrc(o), alt: "", draggable: "false" }) : icon("app", 16),
  );

/** Where an avatar's picture is: its own, or a snapshot's copy of it (none there: null). */
export function avatarSrc(name: string | null | undefined): string | null {
  if (!name) return null;
  if (!snap()) return `/avatars/${name}.svg`;
  const svg = (L.page.SNAPSHOT!.avatars || {})[name];
  return svg ? "data:image/svg+xml," + encodeURIComponent(svg) : null;
}

/** An actor's face alone, no harness's badge: its avatar, else its harness's mark. */
export function plainFace(a: Actor): Node {
  const src = avatarSrc(a.avatar);
  return src
    ? make("span", { class: "logo avatar" }, make("img", { src, alt: "", draggable: "false" }))
    : L.helpers.harnessLogo(a.harness);
}

/** A terminal's mark, where an actor's face is. */
export const shellLogo = (): HTMLElement =>
  make("span", { class: "logo shell-logo", "aria-hidden": "true" }, icon("terminal", 18));

/** The gatherer agent's picture (avatars.py's ROLES), before it has one. */
export const MANAGER = "roles/manager";
/** An actor's avatar, small, as the list draws it less its harness's mark: `fallback`, the picture with none. */
export function crewFace(a: Actor | null | undefined, fallback: string | null = null): HTMLElement {
  const src = avatarSrc((a && a.avatar) || fallback);
  return src
    ? make("img", { class: "crew-face", src, alt: "", draggable: "false" })
    : make("span", { class: "crew-face none", "aria-hidden": "true" }, icon("crew", 12));
}
