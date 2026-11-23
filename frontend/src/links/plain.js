// The old page's plain-JS modules the layout takes (src/links/layout.ts), each a module's namespace, as they are: plain JS
// has no types for the layout's link to be checked against, so their shapes are what features/layout/link.ts says the
// layout reads of them (plain.d.ts). Each goes from here as its module becomes TypeScript, imported by layout.ts itself,
// its part of the link then checked.
export * as chat from "../features/chat/chat";
export * as views from "../features/chat/views";
export * as mini from "../features/chat/mini-history";
