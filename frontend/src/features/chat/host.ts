// What Chat's React parts call of the page around them (types.ts's ChatHost), made from what the page hands Chat (link.ts):
// how the actor at work is drawn, an actor's face, a Browser's message, a message's words as matched, the icons; the pane showing an
// actor -- its turn picked, its files and commands folded or shown, its view switched, its head in the files' bar; and a
// permission's call and words as the cards show them (asking/Cards.tsx).
import { setFilesTurn, foldSide } from "./files-view";
import { P, type Pane } from "./link";
import type { Ask } from "./asking/ask";
import type { ChatHost } from "./types";
import { chatView, offeredViews, setChatView } from "./views";

/** A message as the user typed it, to match what was sent with what is stored (the server gives the user's words as
 * typed: harness_kit's): "!echo hi" the same as "! echo hi". */
export const typedAs = (text: unknown): string =>
  String(text ?? "")
    .trim()
    .replace(/^!\s*/, "! ");

/** Whether two say the same: their start, as a stored message is clipped. */
export const sameWords = (a: unknown, b: unknown): boolean => typedAs(a).slice(0, 200) === typedAs(b).slice(0, 200);

/** What a permission is for, after "asks to": by the call's shape, as its harness reads it (data.py's `view`). */
const PERMISSION_VERBS: Record<string, string> = {
  shell: "run a command",
  edit: "edit a file",
  write: "write a file",
  patch: "change files",
  read: "read a file",
  search: "search files",
  web: "use the web",
  agent: "start an agent",
  skill: "use a skill",
};
export function permissionVerb(ask: Ask): string {
  const v = (ask.view || {}) as { shape?: string };
  return (v.shape && PERMISSION_VERBS[v.shape]) || `use ${P().callTitle(ask)}`;
}

/** The pane showing the actor keyed `actor`. */
export const paneKeyed = (actor: string): Pane | null =>
  P()
    .panes()
    .find((p) => P().paneKey(p) === actor) || null;

/** The pane's head, for the files' folded bar (side/PaneActs.tsx): with a panel open above the panes, not in a
 * snapshot. */
function paneActs(actor: string): ReturnType<ChatHost["paneActs"]> {
  const page = P(),
    p = paneKeyed(actor);
  if (page.snapshot || !page.topShown() || !p) return null;
  const now = chatView(p).id;
  return {
    views: offeredViews(p)
      .filter((v) => !v.more || v.id === now)
      .map(({ id, name, description, icon }) => ({ id, name, description, icon })),
    current: now,
    details: !!p.details,
    detailsTitle: page.detailsTip,
    minimize: page.canMinimize(p) ? page.minTip : null,
    closeTitle: p.close.title,
    show: (id) => setChatView(p, id),
    toggleDetails: () => page.setDetails(p, !p.details),
    doMinimize: () => page.setChatMin(p, true),
    close: () => p.close.click(),
  };
}

const host: ChatHost = {
  avatarMode: () => P().avatarMode(),
  envelope: (text) => P().envelope(text),
  typedAs,
  sameWords,
  get icons() {
    return P().icons as Record<string, string>;
  },
  get beside() {
    return P().besideKey;
  },
  crewFace: (a, coordinator) => P().crewFace(a, coordinator),
  appWords: (text) => P().appWords(text),
  // a turn picked, the files and commands folded or shown, the view switched, the head: the pane's showing the actor
  foldSide: (actor, fold) => {
    const p = paneKeyed(actor);
    return p ? foldSide(p, fold) : undefined;
  },
  setFilesTurn: (actor, n) => {
    const p = paneKeyed(actor);
    return p ? setFilesTurn(p, n) : Promise.resolve();
  },
  setChatView: (id, channel) => {
    const p = P().paneWith(channel);
    return p ? setChatView(p, id) : undefined;
  },
  paneActs,
  permissionVerb,
  get PermissionCall() {
    return P().PermissionCall;
  },
  refresh: () => P().refresh(),
};
export const CHAT_HOST: ChatHost = Object.freeze(host);
