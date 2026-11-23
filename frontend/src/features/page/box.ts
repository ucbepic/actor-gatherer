// The message box as tall as what is typed in it: a line, up to its CSS's most (then scrolling). Measured on a copy of
// it kept out of the page's layout (`boxSizer`), and its height set only when that changes -- in most keys, never. Set
// at every key (to "auto", to measure, then to its height), the whole Chat was laid out twice a key, the conversation a
// moment taller between: in Chrome 155 at a zoom of 110%, the chat and the page's top row flickered at every key.
import { el } from "../../core/page/dom";

const BOX_COPIED = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-transform",
  "tab-size",
  "white-space",
  "overflow-wrap",
  "word-break",
  "box-sizing",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
];
let sizerBox: HTMLTextAreaElement | null = null;
function boxSizer(box: HTMLElement): HTMLTextAreaElement {
  if (!sizerBox || !sizerBox.isConnected) {
    sizerBox = el("textarea", {
      rows: "1",
      tabindex: "-1",
      "aria-hidden": "true",
      style:
        "position: fixed; left: -10000px; top: 0; visibility: hidden; pointer-events: none; contain: layout paint style; " +
        "height: auto; min-height: 0; max-height: none; overflow: hidden; border-style: solid; resize: none",
    });
    document.body.append(sizerBox);
  }
  const cs = getComputedStyle(box);
  for (const k of BOX_COPIED) sizerBox.style.setProperty(k, cs.getPropertyValue(k));
  sizerBox.style.width = `${box.offsetWidth}px`;
  return sizerBox;
}

/** Message box `box` made as tall as what is typed in it. */
export function fitBox(box: HTMLTextAreaElement | null | undefined): void {
  if (!box || !box.isConnected) return;
  const sizer = boxSizer(box);
  sizer.value = box.value;
  const want = `${sizer.scrollHeight + box.offsetHeight - box.clientHeight}px`;
  if (box.style.height !== want) box.style.height = want;
}
