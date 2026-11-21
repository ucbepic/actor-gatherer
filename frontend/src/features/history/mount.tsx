// The History view (ag_dashboard/DESIGN.md, A5) in its frame (core/ui/frame.tsx), for the actor the page hands it: its
// outline as kept (data.ts), drawn again as it comes -- "Loading…" until what the actor had when opened is in.
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../core/api/query";
import { viewFrame } from "../../core/ui/frame";
import { parse } from "../../core/model/keys";
import { loadOutline, outlineKey, outlineOf } from "./data";
import { History, type HistFeed } from "./HistoryView";
import { showing } from "./store";
import type { Outline } from "./tree";

/** What the page hands the view: the actor, and what it draws with of the page. */
export type HistPage = Omit<HistFeed, "h"> & { actor: string };

function Kept({ page }: { page: HistPage }) {
  const h = useQuery(
    { queryKey: outlineKey(page.actor), queryFn: () => outlineOf(page.actor) as Outline, enabled: false },
    queryClient,
  ).data;
  if (!h || !h.loaded) return <div className="h-note">Loading…</div>;
  return <History feed={{ ...page, h }} more={() => loadOutline(page.actor)} />;
}

/** The view's frame for `page.actor`, drawn now: its node, for the page to put where it goes. */
export function drawHistory(page: HistPage, name: string): HTMLDivElement {
  showing(page.actor, parse(page.actor).group);
  return viewFrame("history", "hist", name, <Kept key={page.actor} page={page} />);
}

/** What the page's draws compare of the actor's outline, to draw again when it changes (the reader's own views). */
export function outlineSignature(actor: string | null) {
  const h = outlineOf(actor);
  return h
    ? [h.key, h.last, h.events.length, h.tasks.length, h.error, h.loaded, h.more, JSON.stringify(h.builds)]
    : null;
}
