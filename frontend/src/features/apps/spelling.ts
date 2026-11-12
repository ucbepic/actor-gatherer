// The system's spellchecker, for apps' panels (app_kit's ag.spelling): in the desktop app, the one underlining
// misspelled words in text boxes, asked through the app's preload (desktop/src/preload.cts). Any app may ask: it says
// only whether a word is misspelled, and its fixes. A word goes into the user's dictionary only as they click: a click
// in a panel is the page's too, for the few seconds the browser counts one.
import { desktop } from "./native";

export const SPELLING_OPS = new Set(["spelling.check", "spelling.learn"]);

/** Whether a panel can ask (told in its hello). */
export const spellingOn = (): boolean => !!desktop()?.spelling;

export function toSpelling(m: Record<string, unknown>): unknown {
  const d = desktop();
  if (m.op === "spelling.check") return d?.spelling ? d.spelling(String(m.word || "")) : null;
  if (!d?.learn) throw new Error("spelling.learn: only in the desktop app");
  if (!navigator.userActivation?.isActive) throw new Error("spelling.learn: only as the user clicks");
  d.learn(String(m.word || ""));
  return true;
}
