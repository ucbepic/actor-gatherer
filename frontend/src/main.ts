// The dashboard's page: its script and styles from before its views were rewritten (page.js and styles.ts, modules in
// core/page/ and features/) and, drawn into it, the views rewritten so far (ag_dashboard/DESIGN.md, A4-A6). The bridge
// comes first: the page's modules call it as they start.
import "./bridge";
import "./styles";
import "./page";
import { mountSettings } from "./features/settings/mount";

const page = window.agLegacy;
const cfg = document.getElementById("cfg");
if (page && cfg && !page.snapshot) {
  mountSettings(cfg, { open: () => page.setAbout(true), close: () => page.setAbout(false) });
}
