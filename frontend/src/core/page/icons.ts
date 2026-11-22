// The page's icons, drawn as nodes: each a path in a 16x16 box (ICONS, by strokeIcon), and a few drawn whole.
import { svgEl } from "./dom";

/** An eye with a stroke through it: hide. */
export function hideIcon(): SVGSVGElement {
  const svg = svgEl("svg", {
    viewBox: "0 0 16 16",
    width: 14,
    height: 14,
    "aria-hidden": "true",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1.5,
    "stroke-linecap": "round",
  });
  svg.append(
    svgEl("path", { d: "M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" }),
    svgEl("circle", { cx: 8, cy: 8, r: 2 }),
    svgEl("line", { x1: 2.5, y1: 13.5, x2: 13.5, y2: 2.5 }),
  );
  return svg;
}
/** An icon drawn as a stroke: `d`, an SVG path in a 16x16 box. */
export function strokeIcon(d: string, size = 15): SVGSVGElement {
  const svg = svgEl("svg", {
    viewBox: "0 0 16 16",
    width: size,
    height: size,
    "aria-hidden": "true",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1.4,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  svg.append(svgEl("path", { d }));
  return svg;
}
/** The page's icons: each an SVG path in a 16x16 box, drawn as a stroke (strokeIcon). */
export const ICONS: Readonly<Record<string, string>> = {
  bubble:
    "M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5.5A1.5 1.5 0 0 1 12 11H7l-3 2.5V11a1.5 1.5 0 0 1-1.5-1.5z",
  // the gatherer agent: one that the others hang from
  crew:
    "M8 2.25a1.75 1.75 0 1 1 0 3.5a1.75 1.75 0 1 1 0-3.5zM3.25 10.25a1.75 1.75 0 1 1 0 3.5a1.75 1.75 0 1 1 0-3.5z" +
    "M12.75 10.25a1.75 1.75 0 1 1 0 3.5a1.75 1.75 0 1 1 0-3.5zM7 5.5l-2.6 4.9M9 5.5l2.6 4.9",
  terminal:
    "M3.25 2.75h9.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5z" +
    "M4.5 6.25l2 1.75-2 1.75M8.25 10.25h3.25",
  history: "M2.6 8a5.4 5.4 0 1 0 1.58-3.82M2.4 2.6v2.6H5M8 5.2v3l2 1.3",
  list: "M5.75 4h7.75M5.75 8h7.75M5.75 12h7.75M2.5 4h.01M2.5 8h.01M2.5 12h.01",
  page: "M4.25 1.75h5l3 3v9a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5v-11.5a.5.5 0 0 1 .5-.5zM9 1.75v3.25h3.25M5.75 8.25h4.5M5.75 11h4.5",
  layers: "M8 2.25l6 3-6 3-6-3zM2 8l6 3 6-3M2 10.75l6 3 6-3",
  // a group of its own (inside another group's folder): two side by side
  group:
    "M5.75 3.5a1.75 1.75 0 1 1 0 3.5a1.75 1.75 0 1 1 0-3.5zM10.25 3.5a1.75 1.75 0 1 1 0 3.5a1.75 1.75 0 1 1 0-3.5zM2.5 12.5c0-1.9 1.4-3.25 3.25-3.25S9 10.6 9 12.5M7 12.5c0-1.9 1.4-3.25 3.25-3.25s3.25 1.35 3.25 3.25",
  // an actor on its own: one, in a ring of its own
  alone:
    "M8 4.5a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3zM5.5 11.5c0-1.4 1.1-2.4 2.5-2.4s2.5 1 2.5 2.4M8 1.75a6.25 6.25 0 1 1 0 12.5a6.25 6.25 0 1 1 0-12.5z",
  // an app (app_kit's): four tiles
  app:
    "M3.5 2.5h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1zM9.5 2.5h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3" +
    "a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1zM3.5 8.5h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1zM9.5 8.5h3" +
    "a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z",
  info: "M8 1.75a6.25 6.25 0 1 1 0 12.5a6.25 6.25 0 1 1 0-12.5zM8 7.25v3.75M8 4.9h.01", // Details: about this actor
  sidebar:
    "M3.25 2.75h9.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5zM6.25 2.75v10.5",
  pulse: "M1.5 8.5h2.75l1.75-4.25 2.5 7.5 2-5.5 1.25 2.25h2.75", // what runs in the background: alive
  code: "M5.25 4.75L2 8l3.25 3.25M10.75 4.75L14 8l-3.25 3.25M9.25 2.75l-2.5 10.5", // the Editor: a file's code
  quill: "M13.5 2.5c-4.75.25-8 3.5-9 8.75L2.75 13.5M4.6 10.4h3.15c2.4-1.1 4.25-3.6 5.75-7.9M6.2 7.4h3.3", // DocWriter: writing
  folderUp:
    "M1.75 4a1 1 0 0 1 1-1h3.4l1.5 1.6h5.6a1 1 0 0 1 1 1v6.65a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1zM8 11.1V7.1M6.3 8.8 8 7.1l1.7 1.7", // the folder above
  folder: "M1.75 4a1 1 0 0 1 1-1h3.4l1.5 1.6h5.6a1 1 0 0 1 1 1v6.65a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z", // a folder of actors
  folderOpen:
    "M1.75 12V4a1 1 0 0 1 1-1h3.4l1.5 1.6h4.6a1 1 0 0 1 1 1v1.2M1.75 12l1.7-4.7a1 1 0 0 1 .94-.66h9.1a.6.6 0 0 1 .56.8l-1.6 4.4a1 1 0 0 1-.94.66H2.75a1 1 0 0 1-1-1z", // one opened
  folderNew:
    "M1.75 4a1 1 0 0 1 1-1h3.4l1.5 1.6h5.6a1 1 0 0 1 1 1v6.65a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1zM8 7.1v4M6 9.1h4", // one made
  pencil: "M10.6 2.6l2.8 2.8-7.9 7.9-3.4.6.6-3.4zM9.1 4.1l2.8 2.8", // renamed
  bin: "M2.75 4.25h10.5M6.25 4.25v-1.5h3.5v1.5M4.1 4.25l.65 8.6a1 1 0 0 0 1 .9h4.5a1 1 0 0 0 1-.9l.65-8.6M6.6 6.75v4.5M9.4 6.75v4.5", // deleted
  power: "M8 1.75v5.5M4.6 3.9a5.25 5.25 0 1 0 6.8 0", // a shell terminated
  chevron: "M6 3.5 10.5 8 6 12.5", // more, folded: turned down once shown
  wrap: "M2 3.5h12M2 7.5h9.25a2.25 2.25 0 0 1 0 4.5H8.5M10 10.5 8.5 12 10 13.5M2 11.5h3.5", // long lines wrapped
  branch:
    "M4.5 2.5v8.5M3 12.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M10 4.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0" +
    "M11.5 6c0 3.25-7 2.25-7 5", // an actor on a branch of its own
  agent:
    "M4.75 5.25h6.5A1.75 1.75 0 0 1 13 7v4.5a1.75 1.75 0 0 1-1.75 1.75h-6.5A1.75 1.75 0 0 1 3 11.5V7a1.75 1.75 0 0 1 1.75-1.75z" +
    "M8 2.5v2.75M6.25 8.25v1.5M9.75 8.25v1.5M1.25 8.5v2.5M14.75 8.5v2.5", // a new actor: an agent's head
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01", // more of them, in a drop-down
  globe:
    "M8 1.75a6.25 6.25 0 1 0 0 12.5a6.25 6.25 0 1 0 0-12.5zM1.75 8h12.5M8 1.75c1.75 1.75 2.6 3.9 2.6 6.25S9.75 12.5 8 14.25" +
    "M8 1.75C6.25 3.5 5.4 5.65 5.4 8s.85 4.5 2.6 6.25", // a Browser
  pointer: "M3.25 2.25l9.5 4.6-4.05 1.35-1.7 4.3z", // pick an element
  area: "M2.5 5V2.5H5M11 2.5h2.5V5M13.5 11v2.5H11M5 13.5H2.5V11M7 2.5h2M7 13.5h2M2.5 7v2M13.5 7v2", // pick an area
  back: "M9.75 3.5 5.25 8l4.5 4.5",
  forward: "M6.25 3.5 10.75 8l-4.5 4.5",
  up: "M8 13.25V3M3.75 7.25 8 3l4.25 4.25", // the rail: the folder it is in
  home: "M2.25 7.25 8 2.5l5.75 4.75M3.75 6v7.25h3.1V9.75h2.3v3.5h3.1V6", // the rail's root: every gatherer
  reload: "M13.25 8a5.25 5.25 0 1 1-1.54-3.71M13.25 2.5v3h-3",
  plus: "M8 3.25v9.5M3.25 8h9.5",
  x: "M4.5 4.5l7 7M11.5 4.5l-7 7", // close: every ×, never the character
  play: "M5 3.25v9.5L12.75 8z", // run: the Editor's preview
  minimize: "M4 5.5 8 9.5l4-4M3 12.75h10", // the chat minimized under the Editor: down to a line
  restore: "M4 10.5 8 6.5l4 4M3 3.25h10", // and shown again: up from it
  move: "M8 2v12M2 8h12M6 4l2-2 2 2M6 12l2 2 2-2M4 6 2 8l2 2M12 6l2 2-2 2", // a pane moved, dragged by it: four ways
  takeOut: "M9 2.75h3.25v10.5H9M10.25 8H3m2.5-2.75L2.75 8l2.75 2.75", // out of its task: an arrow leaving a box
};
/** A circled cross: end the dashboard's own idle agent for a session, which then shows Closed. */
export function closeIcon(): SVGSVGElement {
  const svg = svgEl("svg", {
    viewBox: "0 0 16 16",
    width: 12,
    height: 12,
    "aria-hidden": "true",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1.5,
    "stroke-linecap": "round",
  });
  svg.append(
    svgEl("circle", { cx: 8, cy: 8, r: 6 }),
    svgEl("line", { x1: 5.8, y1: 5.8, x2: 10.2, y2: 10.2 }),
    svgEl("line", { x1: 10.2, y1: 5.8, x2: 5.8, y2: 10.2 }),
  );
  return svg;
}
/** A bookmark: the actor saved for later (filled), or to be. */
export function saveIcon(on: boolean): SVGSVGElement {
  const svg = svgEl("svg", {
    viewBox: "0 0 16 16",
    width: 12,
    height: 12,
    "aria-hidden": "true",
    fill: on ? "currentColor" : "none",
    stroke: "currentColor",
    "stroke-width": 1.5,
    "stroke-linejoin": "round",
  });
  svg.append(svgEl("path", { d: "M4.25 2.25h7.5v11.5L8 11l-3.75 2.75z" }));
  return svg;
}
/** The white check at a done avatar's corner. */
export function doneCheck(): SVGSVGElement {
  const ok = svgEl("svg", { viewBox: "0 0 10 10", "aria-hidden": "true" });
  ok.append(
    svgEl("path", {
      d: "M2.2 5.2L4.2 7.1L7.9 3.1",
      fill: "none",
      stroke: "#fff",
      "stroke-width": "1.6",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  );
  return ok;
}
