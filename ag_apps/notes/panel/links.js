// Notes: links to the notes.
// A link to a page clicked in Chat, or in another app (`ag://notes/page/<id>#<block id>`, app.toml's [[links]]): the
// page opened, and the line it names, if it names one, scrolled to and flashed. One before the notebook is read: once
// it is.
import { ag, pages, ready } from "./state.js";
import { box, openPage } from "./page.js";
import { say } from "./actors.js";

export let linked = null;
export function goLink(l) {
  const id = l && l.values && l.values.id, p = id && pages.get(id);
  if (!p) return say("That page isn't in these notes any more", true);
  openPage(id);
  const n = l.part && box.querySelector(`.blk[data-id="${CSS.escape(l.part)}"]`);
  if (!n) return;
  n.scrollIntoView({ block: "center" });
  n.classList.remove("flash"); void n.offsetWidth; n.classList.add("flash");
}

export function wireLinks() {
  ag.links.onOpen((l) => { if (ready) goLink(l); else linked = l; });
}
