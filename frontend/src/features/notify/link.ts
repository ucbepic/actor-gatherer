// WHAT THE NOTIFICATIONS TAKE FROM THE PAGE AROUND THEM (notify.ts): the list's actors, apps and what the reader has
// seen, the panes, the apps' host, the page's live state -- which a feature's TypeScript may not import
// (ag_dashboard/DESIGN.md's Rules). src/links/notify.ts hands them over as the page starts, before any module starts.
import type { At, PageActor } from "../../core/page/types";
import type { Words } from "./want";

/** An open app instance, as the list has it. */
export interface NoticeApp {
  app: { label?: string };
  name?: string;
  title?: string;
}

export interface NotifyLink extends Words {
  appInfo(gname: string, id: string): NoticeApp | null;
  /** the page's live state said (features/page/data.ts's setLive) */
  setLive(text: string): void;
  /** an actor's status class (features/list/seen.ts) */
  status(a: PageActor): string;
  /** when the reader last looked at each item, by its key; what the page shows, seen */
  seenAt(): Readonly<Record<string, number>>;
  markSeen(): void;
  /** an actor's face, an app instance's (features/list/faces.ts) */
  plainFace(a: PageActor): Node;
  appFace(o: NoticeApp): Node;
  /** a gatherer's apps read again; an app's panel shown, as a click on its row (features/list/) */
  readApps(gname: string, now: boolean): Promise<void>;
  selectApp(gname: string, o: NoticeApp): Promise<void>;
  /** the list drawn again, and the hover card if shown */
  listChanged(): void;
  /** the actors open in panes; one shown as a plain click on its row; a note in the page (features/layout/panes.js) */
  openActors(): At[];
  isAt(sel: At | null | undefined, g: string, c: string): boolean;
  pick(g: string, c: string): void;
  paneNote(text: string): void;
}

export let link: NotifyLink = null as unknown as NotifyLink;
export function setNotifyLink(l: NotifyLink): void {
  link = l;
}
