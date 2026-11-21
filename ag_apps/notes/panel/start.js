// The panel, started (by notes.js, its entry): connected to the dashboard (app_kit's SDK), the page's editor made
// (editor.js: its own listeners on the lines, first), each module's listeners set
// -- in the order the panel has always set them: a key the picked lines take is one the line's own handler left, and
// the like -- then the notebook read, the batches heard meanwhile applied, the page the reader left open shown again,
// and the actors followed.
import { SPECIAL } from "./helpers.js";
import { ag, current, pages, setAg, setBook, setCurrent, setReady, store } from "./state.js";
import { kidsOf, reindex } from "./model.js";
import { wireSend } from "./send.js";
import { early, heard, wireOthers } from "./others.js";
import { app, drawSide, narrow, opened, wireSidebar } from "./sidebar.js";
import { drawPage, wirePage } from "./page.js";
import { wireTyping } from "./typing.js";
import { wirePopups } from "./popups.js";
import { wireSpelling } from "./spelling.js";
import { wireGutter } from "./gutter.js";
import { wirePicked } from "./picked.js";
import { wireTitle } from "./title.js";
import { wirePaste } from "./paste.js";
import { wireTables } from "./tables.js";
import { wirePictures } from "./pictures.js";
import { takeActors } from "./actors.js";
import { drawSent } from "./convo.js";
import { goLink, linked, wireLinks } from "./links.js";
import { startView } from "./editor.js";

export async function start() {
  setAg(await AgApp.connect());
  startView();
  wireSend();
  wireOthers();
  wireSidebar();
  wirePage();
  wireTyping();
  wirePopups();
  wireSpelling();
  wireGutter();
  wirePicked();
  wireTitle();
  wirePaste();
  wireTables();
  wirePictures();
  wireLinks();
  let got;
  try { got = await (await ag.api("state")).json(); } catch { got = { version: 0, pages: [] }; }
  if (!got || !Array.isArray(got.pages)) got = { version: 0, pages: [] };
  setBook(got);
  reindex();
  setReady(true);
  for (const m of early.splice(0)) heard(m);
  const kept = store.get("page", null);
  setCurrent(SPECIAL.includes(kept) ? kept : kept && pages.has(kept) && !pages.get(kept).deleted ? kept : (kidsOf(null)[0] || {}).id || null);
  takeActors(ag.actors.current);
  ag.actors.on(takeActors);
  setInterval(() => { if (!document.hidden) drawSent(); }, 30_000);   // "Working · 4m": kept current
  for (let p = pages.get(current); p && p.parent; p = pages.get(p.parent)) opened.add(p.parent);
  if (narrow()) app.classList.remove("side-on");
  drawSide();
  drawPage();
  if (linked) goLink(linked);
  document.body.dataset.ready = "1";
}
