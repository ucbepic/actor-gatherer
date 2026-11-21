// An actor's pane: its head -- whose it is, its view's controls, its × -- and its main view under it. The page's own pane
// is index.html's (#pane-here: its parts by id, which the page's tests and the reader's own views know it by); each pane
// beside it is made here, the same by class, in the same page: no frame, no second copy of the page (ag_dashboard/
// DESIGN.md, A6). What each shows is the old page's to draw (features/page/main-view.js's renderPane), for the actor and
// view the pane is given.

/** A pane's parts, as the page draws into them. */
export interface PaneParts {
  node: HTMLElement;
  /** its top: the head, in the page's top row (as tall as the tallest head) */
  top: HTMLElement;
  head: HTMLElement;
  /** whose it is: its actor's face and name */
  who: HTMLElement;
  /** its view's controls (features/chat/Controls.tsx), or a shell's Terminate */
  controls: HTMLElement;
  close: HTMLButtonElement;
  /** its view */
  main: HTMLElement;
}

const X =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';

const part = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), { className: cls });

/** The page's own pane's parts (index.html's). */
export function herePane(): PaneParts {
  const $ = (id: string) => document.getElementById(id)!;
  return {
    node: $("pane-here"),
    top: $("pane-here").querySelector<HTMLElement>(":scope > .pane-top")!,
    head: $("pane-head"),
    who: $("pane-who"),
    controls: $("controls"),
    close: $("pane-close") as HTMLButtonElement,
    main: $("main"),
  };
}

/** A new pane's parts, as the page's own is made (by class), its view "Loading…" till it is drawn. */
export function newPane(): PaneParts {
  const node = part("section", "pane"),
    top = part("div", "pane-top"),
    head = part("div", "pane-head"),
    who = part("span", "pane-who"),
    controls = part("div", "controls"),
    close = part("button", "pane-close"),
    main = part("main", "pane-main");
  close.type = "button";
  close.title = "Close this pane";
  close.setAttribute("aria-label", close.title);
  close.innerHTML = X;
  const empty = part("div", "empty");
  empty.textContent = "Loading…";
  main.append(empty);
  head.append(who, controls, close);
  top.append(head);
  node.append(top, main);
  return { node, top, head, who, controls, close, main };
}
