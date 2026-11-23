// The old page's modules still plain JS that the Chat, History and Terminal links read (chat.ts, history.ts,
// terminal.ts): handed on as they are, typed in chat-page.d.ts -- TypeScript does not read plain JS. Each line goes as
// its module moves to TypeScript, and its link imports it directly.
export * as top from "../features/layout/top";
export * as layout from "../features/layout/panes";
