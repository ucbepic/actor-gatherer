// What the page's modules share, under one name (the old page's helpers): building nodes (dom.ts) and its icons
// (icons.ts); each harness as the home describes it (harness.ts); an actor's avatar and how one at work is drawn
// (avatar.ts; the stage: core/ui/stage); what the page looks up in its home (home.ts); its routes (core/api/client.ts);
// and, from the rest of core/, the times and counts (core/format.ts), the items' keys (core/model/keys.ts) and types
// (core/model/items.ts), and what a session the page started is doing (core/model/session.ts). Each module imports what
// it needs from its own place; the old page's modules import it all from here.
export { BESIDE_KEY, MAC, agoEl, el, foldMark, signature, statusEl, svgEl } from "./dom";
export { ICONS, closeIcon, doneCheck, hideIcon, saveIcon, strokeIcon } from "./icons";
export { harnessBadge, harnessInfo, harnessLogo, harnessName, hasChat, runnableNames, runsHere } from "./harness";
export { HUE_MAIN, avatarMode, bareAvatar, keepAvatarMode, restDelay } from "./avatar";
export { closable, gathererNamed, selectedInfo, shellOf, shellPath } from "./home";
export { get, post } from "../api/client";
export { ago, axisTime, clock, compact, full, lasting, span, usd } from "../format";
export { isShell, key, parse as parseKey, taskId, taskNumber } from "../model/keys";
export { sessionStatus } from "../model/session";
// the items' types and groups (core/model/items.ts): the page's other modules import them from here
export { GATHERER, HISTORY, INLINE, OTHER_TYPE, PREAMBLE_TYPE, TYPES, color, itemType } from "../model/items";
