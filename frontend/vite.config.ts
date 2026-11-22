// The dashboard's front end (ag_dashboard/DESIGN.md). Its build goes to ag_dashboard/static/, which the server serves
// and the Python package ships; `vite` alone serves it in development, the dashboard's own routes passed through to
// the dashboard at AG_DASHBOARD_URL (default: the one ag runs, http://127.0.0.1:4200).
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";

const dashboard = process.env.AG_DASHBOARD_URL || "http://127.0.0.1:4200";
const VENDOR = ["marked.min.js", "purify.min.js", "xterm.js", "addon-fit.js", "addon-webgl.js"];

/** In development, the vendored scripts the dashboard puts where index.html says <!--VENDOR--> (server.py's page()). */
const vendorInDev: Plugin = {
  name: "ag-vendor-in-dev",
  apply: "serve",
  transformIndexHtml: (html) =>
    html.replace(
      "<!--VENDOR-->",
      VENDOR.map((f) => `<script src="/vendor/${f}"></script>`).join("\n") +
        '\n<link rel="stylesheet" href="/vendor/xterm.css">',
    ),
};

/** KaTeX's styles (core/ui/katex.ts) naming its fonts as woff2 only: every browser the page runs in reads woff2, so the
 * woff and ttf copies they also name (40 more files) are left out of the build. Before Vite's own CSS step, which
 * builds in each file a stylesheet names. */
const katexWoff2: Plugin = {
  name: "ag-katex-woff2",
  enforce: "pre",
  transform(code, id) {
    if (!/[\\/]katex[\\/]dist[\\/]katex(\.min)?\.css$/.test(id)) return null;
    return { code: code.replace(/,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g, ""), map: null };
  },
};

export default defineConfig({
  plugins: [react(), vendorInDev, katexWoff2],
  build: { outDir: "../ag_dashboard/static", emptyOutDir: true },
  server: {
    host: "127.0.0.1", // as the dashboard's own address
    proxy: Object.fromEntries(
      // the Host kept as the page's, as the dashboard's own-page check (server.py's own_page) expects
      [
        "/api",
        "/avatars",
        "/icons",
        "/manifest.webmanifest",
        "/vendor",
        "/views",
        "/preview",
        "/browser",
        "/docwriter",
      ].map((p) => [
        p,
        { target: dashboard, changeOrigin: false, ws: true }, // ws: the page's streams' socket, /api/ws
      ]),
    ),
  },
  test: { include: ["src/**/*.test.{ts,tsx}"], environment: "jsdom", passWithNoTests: true },
});
