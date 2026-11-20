// The page's data fetched on demand, cached by what it is of (TanStack Query; ag_dashboard/DESIGN.md, "The stack"): one
// client for the page, each feature its own keys. What the server pushes on the stream is the store's (core/store); a
// query's data is fetched once and kept until what the stream says makes it stale -- not fetched again at every message
// of the stream, nor on a timer, nor as the window gets the focus back.
import { QueryClient } from "@tanstack/react-query";

/** How long a query no view reads is kept: an actor shown again a while later is drawn at once from it. */
export const KEPT_MS = 30 * 60_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity, // fresh until the feature says otherwise (from what the stream says)
      gcTime: KEPT_MS,
      retry: false, // the page says a failed load, and the stream's next change loads it again
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});
