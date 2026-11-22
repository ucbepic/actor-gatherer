// A SCREEN TAB'S APP PANELS KEPT READY. Left, a tab keeps its tasks (tabs.ts); the page closed their panels and made them
// anew when the tab was shown again: each app's frame loaded again, the Browser's waiting for its page's picture -- the
// tab coming back a moment after the rest. Now the panel of an app whose task a tab not shown holds is held out of sight
// instead (features/layout/panes.js's keepForTab), as one is while its agent is at work, and shown as it is when that
// tab is. Here, which of the panels so kept go: each kept for a tab -- the tab not shown holding its task now (none: its
// task closed, its tab closed, or the task in the tab shown and not wanted there) -- and at most `max` tabs' panels kept,
// those of the tabs left latest; a tab never left here (kept at a reload) counts as left first.

/** A panel kept: its instance, and the tab not shown holding its task now (null: none). */
export interface Kept {
  id: string;
  tab: string | null;
}

/** The kept panels that go (their instances): those no tab not shown holds, then those of the tabs left before the
 * `max` left latest (`leftAt`: each tab's place in the order tabs were left, the latest highest). */
export function keptToDrop(kept: Kept[], leftAt: ReadonlyMap<string, number>, max: number): string[] {
  const drop = kept.filter((k) => !k.tab).map((k) => k.id);
  const tabs = [...new Set(kept.map((k) => k.tab).filter((t): t is string => !!t))];
  tabs.sort((a, b) => (leftAt.get(b) ?? 0) - (leftAt.get(a) ?? 0));
  const leftLatest = new Set(tabs.slice(0, Math.max(0, max)));
  for (const k of kept) if (k.tab && !leftLatest.has(k.tab)) drop.push(k.id);
  return drop;
}

/** The tab not shown (of `tabs`, `current` the one shown) holding task `task`, its keys read as they are now (`canon`:
 * a lone item since put in a task, the task's); null: none. */
export function tabHolding(
  tabs: readonly { id: string; tasks: readonly string[] }[],
  current: string,
  task: string | null,
  canon: (k: string) => string | null = (k) => k,
): string | null {
  if (!task) return null;
  const t = tabs.find((x) => x.id !== current && x.tasks.some((k) => canon(k) === task));
  return t ? t.id : null;
}
