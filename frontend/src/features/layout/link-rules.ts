// Which links clicked in an actor's pane the page opens itself, worked out apart from the page (pure; Vitest:
// link-rules.test.ts).

/** A link to a web page outside this dashboard (`href` read from the page at `base`): its whole address; "" for any other
 * (a link to this dashboard, mailto:, file:, one that is no address). */
export function webLink(href: string, base: string): string {
  try {
    const u = new URL(href, base);
    return /^https?:$/.test(u.protocol) && u.origin !== new URL(base).origin ? u.href : "";
  } catch {
    return "";
  }
}
/** A plain click: the main button, no key held (none given: one the page makes, as plain). */
export const plainClick = (
  ev:
    { button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } | null | undefined,
): boolean => !ev || (!ev.button && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey);
