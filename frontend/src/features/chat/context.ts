// What every part of the turn list draws from: the feed of this draw and the old page's host (types.ts), and the folds
// (store.ts) and the side panel's state as the frame read them (ChatMain.tsx).
import { createContext, useContext } from "react";
import type { Folds } from "./store";
import { inkOf } from "../../core/ui/stage/model";
import type { Actor, ChatFeed, ChatHost } from "./types";

export interface Chat {
  feed: ChatFeed;
  host: ChatHost;
  folds: Folds;
  /** the files and commands folded to their bar (side/store.ts) */
  sideFolded: boolean;
}

export const ChatContext = createContext<Chat | null>(null);

export function useChat(): Chat {
  const chat = useContext(ChatContext);
  if (!chat) throw new Error("the turn list draws inside its ChatContext (mount.tsx)");
  return chat;
}

/** The actor's words in its hue (core/ui/stage's inkOf), as React takes a style. */
export const inkStyle = (a: Actor): { color: string } | undefined => {
  const ink = inkOf(a);
  return ink ? { color: ink } : undefined;
};
