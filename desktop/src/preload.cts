// In the app's dashboard page (desktop/DESIGN.md, "A tab in its pane"): tells the page it is in the app, and takes from
// the page where each native page goes -- the page works it out from what its apps' panels report (app_kit's
// ag.native: frontend/src/features/apps/native.ts), each frame: where the panel's element is in the window, the page it
// asks shown there, whether something covers it, and whose it is (its app) -- so the app keeps that page over it, or,
// while something is over it (a native page would hide it), a still picture of the page in its place ("ag:still"),
// handed back to the page for the panel to draw. The panel says once it is drawn ("ag:still-drawn"), so the page is
// hidden only with its picture in its place.
//
// It also lets the page ask the spellchecker of the user's system (the one drawing the red underline under a word in a
// text box) about a word: whether it is misspelled, and its fixes (app_kit's ag.spelling, for apps' panels: a word
// clicked in a Notes line), and add one to the user's dictionary.
import { contextBridge, ipcRenderer, webFrame } from "electron";

type Stage = { x: number; y: number; w: number; h: number; target: string; covered: boolean; app?: string; key?: string };
type Still = { target: string; url: string | null };

const stills = new Set<(still: Still) => void>();
ipcRenderer.on("ag:still", (_event, still: Still) => {
  for (const cb of stills) {
    try {
      cb(still);
    } catch {
      // (the page's own trouble)
    }
  }
});

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const WORD_MAX = 100; // characters: longer is no word
const FIXES = 8; // the spellchecker's guesses given, at most
const aWord = (v: unknown) => (typeof v === "string" ? v.trim() : "");

contextBridge.exposeInMainWorld("agApp", {
  native: true,
  focusDashboard: () => ipcRenderer.send("ag:focus"), // the keys back to the dashboard from a native page
  raise: () => ipcRenderer.send("ag:raise"), // the window brought to the front (a notification of the page's clicked)
  place: (stages: unknown) => {
    const list: Stage[] = (Array.isArray(stages) ? stages : []).filter((s) => s && typeof s === "object").map((s) => ({
      x: num(s.x), y: num(s.y), w: num(s.w), h: num(s.h), target: String(s.target || ""), covered: !!s.covered,
      ...(typeof s.app === "string" ? { app: s.app } : {}), ...(typeof s.key === "string" ? { key: s.key } : {}),
    }));
    ipcRenderer.send("ag:stages", list);
  },
  onStill: (cb: (still: Still) => void) => {
    if (typeof cb === "function") stills.add(cb);
  },
  stillDrawn: (target: unknown) => ipcRenderer.send("ag:still-drawn", String(target || "")),
  spelling: (word: unknown) => {
    const w = aWord(word);
    if (!w || w.length > WORD_MAX || /\s/.test(w)) return null;
    const misspelled = webFrame.isWordMisspelled(w);
    return { misspelled, suggestions: misspelled ? webFrame.getWordSuggestions(w).slice(0, FIXES) : [] };
  },
  learn: (word: unknown) => ipcRenderer.send("ag:learn", aWord(word)),
});
