// The page's own way of building nodes, and the small parts it builds with it everywhere.
import { ago } from "../format";

/** What `el` sets on a node: its class, its text, a listener for each `on<event>`, any other attribute (none left out
 * for null or undefined). */
export type Attrs = Record<string, unknown>;
/** A child `el` puts in: a node or a text; none left out. */
export type Kid = Node | string | null | undefined;

/** A node: `tag`, with `attrs`, holding `kids`. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...kids: Kid[]
): HTMLElementTagNameMap[K];
export function el(tag: string, attrs?: Attrs, ...kids: Kid[]): HTMLElement;
export function el(tag: string, attrs: Attrs = {}, ...kids: Kid[]): HTMLElement {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v as string;
    else if (k === "text") n.textContent = v as string;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v as EventListener);
    else if (v !== undefined && v !== null) n.setAttribute(k, v as string);
  }
  for (const kid of kids) if (kid !== null && kid !== undefined) n.append(kid as Node | string);
  return n;
}

/** An SVG node: `tag`, with `attrs`. */
export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Attrs): SVGElementTagNameMap[K];
export function svgEl(tag: string, attrs?: Attrs): SVGElement;
export function svgEl(tag: string, attrs: Attrs = {}): SVGElement {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v as string);
  return n;
}

/** What a value is, as one text: drawn again only when it changes. */
export const signature = (value: unknown): string => JSON.stringify(value);

/** " (… <what> Ns ago)", counting: the time `t` (the server's seconds) set every second (core/ui/clocks.ts, by
 * `data-ago`); hidden from screen readers, so a status line holding it is not read out again each second. */
export const agoEl = (what: string, t: number | null | undefined): HTMLSpanElement =>
  el("span", { "aria-hidden": "true" }, ` (${what} `, el("span", { "data-ago": t || "", text: ago(t ?? null) }), ")");

/** A status's dot and word. */
export const statusEl = (cls: string, label: Kid): HTMLSpanElement =>
  el("span", { class: "status " + cls }, el("i", { "aria-hidden": "true" }), label);

/** A fold's mark: the chevron every fold shows (core/page/base.css), turned down while open. Its character stays for
 * its words ("▸ 2 closed"), the chevron drawn over it. */
export const foldMark = (open: boolean): HTMLSpanElement =>
  el("span", { class: open ? "caret open" : "caret", "aria-hidden": "true" }, open ? "▾" : "▸");

const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
/** A Mac (or an iPhone or iPad): ⌘ in place of Ctrl. */
export const MAC = /mac|iphone|ipad/i.test((nav.userAgentData && nav.userAgentData.platform) || nav.platform || "");
/** The key that opens a thing beside the one shown. */
export const BESIDE_KEY = MAC ? "⌘" : "Ctrl";
