// The stage's pictures (model.ts): what shows over any character -- a thought, a bang, a cloud, stars, confetti, a
// question, a check or a cross at the corner -- and each tool it acts out with, behind and before the character. SVG
// markup, in the stage's box (viewBox -8 -14 102 82, the character 64 units square at 0, 0).

const star = (k: number) => `<path class="star s${k}" d="M0 -2.6L.7 -.7L2.6 0L.7 .7L0 2.6L-.7 .7L-2.6 0L-.7 -.7Z"/>`;
const CONFETTI: [number, number, string][] = [
  [-24, -14, "#22c55e"],
  [-16, -24, "#fbbf24"],
  [-6, -28, "#f472b6"],
  [6, -27, "#38bdf8"],
  [16, -24, "#a78bfa"],
  [24, -15, "#f97316"],
  [-28, -4, "#38bdf8"],
  [28, -5, "#22c55e"],
];
const CLOUD: [number, number, number][] = [
  [61, -1.8, 4],
  [66.2, -5, 5],
  [71.4, -1.8, 4],
  [66.2, -0.6, 4.6],
];

/** What shows over the character, each shown by the stage's classes. */
export const OVER = `
    <g class="ov o-think"><circle class="tb tb1" cx="50.5" cy="9.6" r="1.5"/><circle class="tb tb2" cx="55" cy="4.6" r="2.3"/>
      <g class="tb tb3">${CLOUD.map(([x, y, r]) => `<circle class="te" cx="${x}" cy="${y}" r="${r}"/>`).join("")}
        ${CLOUD.map(([x, y, r]) => `<circle class="tf" cx="${x}" cy="${y}" r="${r}"/>`).join("")}
        <g class="td"><circle cx="62.6" cy="-2.6" r="1.3"/><circle cx="66.2" cy="-2.6" r="1.3"/><circle cx="69.8" cy="-2.6" r="1.3"/></g></g></g>
    <g class="ov o-bang"><text x="54" y="6" font-size="15" font-weight="800" fill="#ef4444" font-family="system-ui, sans-serif">!</text></g>
    <g class="ov o-cloud"><g transform="translate(0 -9)"><path d="M22 6C22 2.5 25.5 1 28 2.8C29.5 -.6 35.5 -.6 37 2.8C39.5 1 43 2.6 42.5 6C45 6.6 45 10.6 42 10.6H22.5C19.5 10.6 19 6.8 22 6Z" fill="#78716c"/>
      <path d="M29 8.6l2.4 -3l1.4 1.8l2.4 -3" stroke="#fde68a" stroke-width="1.1" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></g>
    <g class="ov o-stars"><g transform="translate(32 2)">${star(1)}${star(2)}${star(3)}</g></g>
    <g class="ov o-confetti"><g transform="translate(32 16)">${CONFETTI.map(
      ([dx, dy, c], i) =>
        `<rect class="cf" x="-1" y="-1.6" width="2" height="3.2" rx=".5" ` +
        `fill="${c}" style="--dx:${dx}px;--dy:${dy}px;animation-delay:calc(var(--r) - ${i * 40}ms)"/>`,
    ).join("")}</g></g>
    <g class="ov o-q"><g transform="translate(57 1)"><circle class="qb" r="6.5"/><text class="qt" x="-2.6" y="3.2">?</text></g></g>
    <g class="ov o-check" transform="translate(86 2)"><g class="bd"><circle r="7" fill="#22a55a"/><path d="M-3.3 .2L-1 2.6L3.4 -2.2" stroke="#fff" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></g>
    <g class="ov o-cross" transform="translate(86 2)"><g class="bd"><circle r="7" fill="#ef4444"/><path d="M-2.6 -2.6L2.6 2.6M2.6 -2.6L-2.6 2.6" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/></g></g>`;

const ROWS = [10, 16.5, 23]; // the checklist's lines
const gear = (
  cls: string,
  x: number,
  y: number,
  r: number,
) => `<g transform="translate(${x} ${y})"><g class="gear ${cls}">
    <circle r="${r}" stroke-width="${r * 0.55}" stroke-dasharray="${(r * 0.5).toFixed(2)} ${(r * 0.42).toFixed(2)}"/>
    <circle r="${r * 0.72}" style="fill: var(--metal)"/><circle r="${r * 0.28}" style="fill: var(--surface)"/></g></g>`;

/** A tool: what goes behind the character, and before it. */
export interface Prop {
  back?: string;
  front?: string;
}

// each of work.py's kinds, and thinking alone: its tool, behind and before the character
const PROPS: Record<string, (src: string, n: number) => Prop> = {
  think: () => ({}),
  read: () => ({
    front: `<g class="prop">
      <path d="M17 46.5Q24.5 44.5 32 47Q39.5 44.5 47 46.5V58.8Q39.5 56.8 32 59.3Q24.5 56.8 17 58.8Z" fill="#3b6cf6"/>
      <path d="M18.5 46Q25 44.2 32 46.4V57.6Q25 55.4 18.5 57.2Z" fill="#fff"/><path d="M45.5 46Q39 44.2 32 46.4V57.6Q39 55.4 45.5 57.2Z" fill="#fff"/>
      <path d="M21 49.2h7.5M21 51.7h7.5M21 54.2h5.5M35.5 49.2h7.5M35.5 51.7h7.5M35.5 54.2h5.5" stroke="#b9ad9f" stroke-width=".9" stroke-linecap="round"/>
      <path class="flip" d="M45.5 46Q39 44.2 32 46.4V57.6Q39 55.4 45.5 57.2Z" fill="#efeae1"/></g>`,
  }),
  search: () => ({
    front: `<g class="prop"><g transform="translate(66 38)"><g class="mag">
      <path d="M5.8 5.8L12.6 12.6" stroke="#8b5a2b" stroke-width="3.6" stroke-linecap="round"/>
      <circle r="8.2" fill="rgba(186, 230, 253, .45)" stroke="#64748b" stroke-width="2.4"/>
      <path class="glint" d="M-4.8 -2.2A5.2 5.2 0 0 1 -1.8 -5.3" stroke="#fff" stroke-width="1.7" fill="none" stroke-linecap="round"/></g></g></g>`,
  }),
  edit: () => ({
    back: `<g class="prop"><g transform="rotate(5 63 49)"><rect class="paper" x="51" y="38" width="24" height="22" rx="1.6"/>
        <path class="ln l1" d="M55 43.5h16"/><path class="ln l2" d="M55 48h16"/><path class="ln l3" d="M55 52.5h11"/></g></g>`,
    front: `<g class="prop"><g transform="translate(55.5 42.8)"><g class="pen"><g transform="rotate(250)">
        <path d="M0 0L5 -2V2Z" fill="#f1d3a6"/><path d="M0 0L1.9 -.76V.76Z" fill="#3a2a2a"/>
        <rect x="5" y="-2" width="10" height="4" fill="#fbbf24"/><path d="M5 0H15" stroke="#f59e0b" stroke-width=".8"/>
        <rect x="15" y="-2" width="1.6" height="4" fill="#a8a29e"/><rect x="16.6" y="-2" width="2.8" height="4" rx="1" fill="#f9a8d4"/></g></g></g></g>`,
  }),
  test: () => ({
    front: `<g class="prop"><g transform="translate(60 21)">
      <rect x="0" y="2" width="24" height="30" rx="2.5" fill="#b9824f"/><rect x="2.5" y="5" width="19" height="25" rx="1" fill="#fff"/>
      <rect x="7" y="0" width="10" height="5" rx="1.5" fill="#94a3b8"/>
      ${ROWS.map(
        (
          y,
          i,
        ) => `<rect x="5" y="${y - 2.2}" width="4.4" height="4.4" rx=".8" fill="none" stroke="#94a3b8" stroke-width=".9"/>
        <path d="M11.5 ${y}h7.5" stroke="#cbd5e1" stroke-width="1.4" stroke-linecap="round"/><path class="tk tk${i}" d="M5.7 ${y}l1.4 1.4l2.5 -2.8"/>`,
      ).join("")}
      <path class="tx" d="M5.6 ${ROWS[1] - 1.6}l3.2 3.2M8.8 ${ROWS[1] - 1.6}l-3.2 3.2" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/></g></g>`,
  }),
  run: () => ({ back: `<g class="prop">${gear("g1", 69, 31, 8)}${gear("g2", 81.5, 43, 5.4)}</g>` }),
  ship: () => ({
    front: `<g class="prop"><g transform="translate(62 43)"><g class="parcel">
      <rect width="18" height="14" rx="1.5" fill="#d6a86c"/><path d="M0 4.5H18" stroke="#b07d3e" stroke-width="1"/><rect x="7.5" width="3" height="14" fill="#f3e1c4"/></g>
      <path class="arrow" d="M9 -4v-8M5.5 -8.5L9 -12L12.5 -8.5" stroke="#22a55a" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></g>`,
  }),
  wait: () => ({
    front: `<g class="prop"><g transform="translate(74 45)"><g class="hg">
      <rect class="wood" x="-6.5" y="-13" width="13" height="2.4" rx="1.2"/><rect class="wood" x="-6.5" y="10.6" width="13" height="2.4" rx="1.2"/>
      <path class="glass" d="M-4.6 -10.6H4.6C4.6 -4.5 1.1 -2.2 1.1 0C1.1 2.2 4.6 4.5 4.6 10.6H-4.6C-4.6 4.5 -1.1 2.2 -1.1 0C-1.1 -2.2 -4.6 -4.5 -4.6 -10.6Z"/>
      <path class="sand st" d="M-3.6 -9.2H3.6C3.6 -5 .8 -2.6 0 -.6C-.8 -2.6 -3.6 -5 -3.6 -9.2Z"/><path class="stream" d="M0 -.6V9"/>
      <path class="sand sb" d="M-3.9 10.4Q0 3.2 3.9 10.4Z"/></g></g></g>`,
  }),
  team: (src, n) => ({
    front: `<g class="prop">${(
      [
        [65, 50],
        [78, 53],
        [91, 50],
      ] as const
    )
      .slice(0, n)
      .map(
        ([x, y], k) =>
          `<g transform="translate(${x} ${y})"><g class="mini m${k}"><image href="${src}" x="-10" y="-10" width="20" height="20"/></g></g>`,
      )
      .join("")}</g>`,
  }),
};

/** The tool of a look (one of work.py's kinds; "team1".."team3", that many little copies of the character, `src`). */
export const propsOf = (look: string, src: string): Prop =>
  look.startsWith("team") ? PROPS.team(src, +look.slice(4) || 1) : (PROPS[look] || PROPS.think)(src, 0);

/** A hand in the actor's hue, its wrist at 0, 0: its fingers and thumb, each a line. */
const HAND = [
  [-3.4, -8, -4.9, -14.6],
  [-1.1, -9, -1.6, -16.6],
  [1.3, -9, 1.7, -16.2],
  [3.4, -7.6, 4.8, -13.4],
  [-3.8, -4.6, -8.4, -8.2],
];
export const hand = (cls: string, w: number, r: number) =>
  `<g class="${cls}">${HAND.map(
    ([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${w}"/>`,
  ).join("")}<circle cy="-5.6" r="${r}" stroke="none"/></g>`;
