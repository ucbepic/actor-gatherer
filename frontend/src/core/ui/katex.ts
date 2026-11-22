// KaTeX as tex.ts loads it, a part of the build of its own: its script, its styles (their fonts woff2 only:
// vite.config.ts), and its copy-tex, so a formula copied out of a message is copied as its LaTeX.
import katex from "katex";
import "katex/dist/katex.min.css";
import "katex/contrib/copy-tex";

export default katex;
