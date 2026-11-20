import { PATHS, type Glyph } from "./glyphs";

// An icon drawn as a stroke, in the colour of the text around it: `d`, an SVG path in a 16x16 box -- the same SVG as the
// old page's strokeIcon (src/core/page/helpers.js), whose paths (ICONS) it hands the views it hosts.
export function StrokeIcon({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

/** One of the small glyphs (glyphs.ts) -- a button's × or + -- as glyph() draws it outside React. */
export function GlyphIcon({ name, size = 14 }: { name: Glyph; size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`glyph glyph-${name}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
