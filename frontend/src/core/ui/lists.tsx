// What the dashboard's long lists share -- Chat's turns (features/chat/Turns.tsx) and History's rows
// (features/history/HistoryView.tsx), each laid out by react-virtuoso: how much of a list is on the page, and, for
// jsdom's tests, which lay nothing out, the sizes it takes in place of measuring them.
import type { ReactNode } from "react";
import { VirtuosoMockContext, type VirtuosoMockContextValue } from "react-virtuoso";

/** How far above and below what is in sight a list puts its items on the page. The browser's find reads only what is
 * there: a few screens each way, so an ordinary conversation or history is there whole, and a long one around where
 * the reader is. */
export const OVERSCAN_PX = 4000;

/** What a list takes its box's and each item's height to be in place of measuring them: none on the page (it
 * measures); jsdom's tests set them. */
export const sizesForTests: { now: VirtuosoMockContextValue | undefined } = { now: undefined };

/** A list's sizes: measured, or the tests' (`sizesForTests`). */
export function Measured({ children }: { children: ReactNode }) {
  return <VirtuosoMockContext value={sizesForTests.now}>{children}</VirtuosoMockContext>;
}
