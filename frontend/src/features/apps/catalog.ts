// THE APPS PAGE, as the page around it uses it (features/apps/apps-page.js draws it in a tab's box; features/list/seen.js
// asks an agent's requests): the page in React (catalog/AppsPage.tsx), its state in a store (catalog/store.ts), its
// dialogs in a root of their own on the page (catalog/Dialogs.tsx), so an agent's request is asked even with the Apps
// page not shown.
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import "./catalog.css";
import { AppsPage } from "./catalog/AppsPage";
import { Dialogs } from "./catalog/Dialogs";
import { askedByAgent, closeDialog, reload, select, useCatalog } from "./catalog/store";
import type { PageHooks } from "./catalog/types";

export { askedByAgent };
export type { AgentRequest, Broken, Catalog, CatalogApp, OnTask, PageHooks } from "./catalog/types";

// the page's root: in a host of its own in the tab's box, which the page around it empties for another page (a new
// tab's) and hands back -- the host put back in it then, the root as it was
let page: { box: HTMLElement; host: HTMLElement; root: Root } | null = null;
let dialogs: Root | null = null;

/** The page drawn into `box` (the work area's box for a tab showing nothing), its apps read again. */
export function draw(box: HTMLElement, hooks: PageHooks): void {
  box.classList.add("ap");
  if (page?.box !== box) {
    page?.root.unmount();
    const host = Object.assign(document.createElement("div"), { className: "ap-host" });
    page = { box, host, root: createRoot(host) };
    page.root.render(createElement(AppsPage));
    useCatalog.setState({ q: "", sel: null, note: "", allTools: false });
  }
  if (page.host.parentElement !== box) box.replaceChildren(page.host);
  useCatalog.setState({ hooks });
  if (!dialogs) {
    const host = Object.assign(document.createElement("div"), { className: "ap-dialogs" });
    document.body.append(host);
    dialogs = createRoot(host);
    dialogs.render(createElement(Dialogs));
  }
  void reload(true);
}

// Esc on the page shown: its details closed (a dialog or a menu open closes itself first: Radix's)
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape" || ev.defaultPrevented || !page?.box.isConnected || !page.box.classList.contains("ap"))
    return;
  if (closeDialog()) return;
  if (useCatalog.getState().sel) select(null);
});
