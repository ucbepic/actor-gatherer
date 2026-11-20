// Small stroke glyphs for DOM code outside React (features/*), drawn like StrokeIcon (Icon.tsx) and the old page's
// strokeIcon: a 16x16 box, in the colour of the text around it. A button's "×" or "+" as one of these, never the
// character, so every one is the same size and weight whatever the button's font.
export const PATHS = {
  x: "M4.5 4.5l7 7M11.5 4.5l-7 7",
  plus: "M8 3.25v9.5M3.25 8h9.5",
  chevron: "M6 3.5 10.5 8 6 12.5",
} as const;

export type Glyph = keyof typeof PATHS;

export function glyph(name: Glyph, size = 14): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [k, v] of Object.entries({
    viewBox: "0 0 16 16",
    width: String(size),
    height: String(size),
    "aria-hidden": "true",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    class: `glyph glyph-${name}`,
  }))
    svg.setAttribute(k, v);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", PATHS[name]);
  svg.append(path);
  return svg;
}
