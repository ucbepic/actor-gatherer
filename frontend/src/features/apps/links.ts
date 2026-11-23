// Links to things in apps, `ag://<app>/<path>[?instance=<id>][#<part>]` (app_kit/links.py, the same rules): an agent
// writes one in a reply as markdown -- `[the To dos page](ag://notes/page/k3p9x2wq)` -- and the page opens it in the app
// (src/features/layout/pane-links.ts, openAppLink): the panel shown, and handed the link (the SDK's `ag.links.onOpen`). An app
// takes only paths of the forms its manifest lists ([[links]]): words, `<name>` for one segment, a last `<name...>` for
// the rest -- the values handed to its panel decoded.

export interface LinkForm {
  form: string;
  about?: string;
  /** FILE_FORM only: a file's path an agent writes with no app named opens in this app (app_kit/links.py) */
  paths?: boolean;
}
/** An `ag://` link read: the app it names, its path (%-encoded, as written), its #part (decoded), the instance named. */
export interface AppHref {
  href: string;
  app: string;
  path: string;
  part: string;
  instance: string;
}
/** A path of one of an app's forms: the form, and its values. */
export interface LinkMatch {
  form: string;
  values: Record<string, string>;
}

const HREF = /^ag:\/\/([a-z][a-z0-9_]{0,23})(?:\/([^?#]*))?(?:\?([^#]*))?(?:#([\s\S]*))?$/;
const WORD = /^[A-Za-z0-9._~-]+$/;
const VALUE = /^<([a-z][a-z0-9_]{0,31})(\.\.\.)?>$/;

const decode = (s: string): string | null => {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

/** An `ag://` link, read; null if `href` isn't one. */
export function parseHref(href: string | null | undefined): AppHref | null {
  const text = String(href ?? "").trim();
  const m = HREF.exec(text);
  if (!m) return null;
  const instance = new URLSearchParams(m[3] || "").get("instance") || "";
  return { href: text, app: m[1], path: m[2] || "", part: decode(m[4] || "") ?? "", instance };
}

/** Whether `href` is a link to something in an app (an `ag:` one, read or not): never a web page's. */
export const isAppHref = (href: string | null | undefined): boolean => /^ag:/i.test(String(href ?? "").trim());

const compiled = new Map<string, { re: RegExp; names: string[] } | null>();
function compile(form: string): { re: RegExp; names: string[] } | null {
  if (compiled.has(form)) return compiled.get(form)!;
  const parts = form.split("/"),
    names: string[] = [],
    out: string[] = [];
  let ok = parts.every((s) => s !== "");
  parts.forEach((s, i) => {
    const v = VALUE.exec(s);
    if (v) {
      ok &&= !names.includes(v[1]) && (!v[2] || i === parts.length - 1);
      names.push(v[1]);
      out.push(v[2] ? "([\\s\\S]+)" : "([^/]+)");
    } else if (WORD.test(s)) out.push(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    else ok = false;
  });
  const got = ok ? { re: new RegExp(`^${out.join("/")}$`), names } : null;
  compiled.set(form, got);
  return got;
}

/** The first of `forms` a path (%-encoded, as in a link) is of, and its values decoded; null: none. */
export function matchPath(forms: LinkForm[] | undefined, path: string): LinkMatch | null {
  for (const f of forms || []) {
    const c = compile(f.form);
    const m = c && c.re.exec(path);
    if (!c || !m) continue;
    const values: Record<string, string> = {};
    const ok = c.names.every((n, i) => {
      const v = decode(m[i + 1]);
      if (!v || v.includes("\u0000")) return false;
      values[n] = v;
      return true;
    });
    if (ok) return { form: f.form, values };
  }
  return null;
}

// A FILE'S PATH, as agents write one in a reply without being told any form -- `[parser.py](src/parser.py#L12)`,
// `[plan](/work/plan.md)`, `file:///work/plan.md`, `/work/plan.md:12` -- opened as a link to it in an app that shows
// files: one whose [[links]] take FILE_FORM (src/features/layout/pane-links.ts's openFileLink). A relative one is from the
// agent's folder. Not one: a link with a scheme (http:, mailto:, ag:), one to a host (//…), an anchor or query alone,
// one from the home folder (~/…: whose, the page can't say).

/** The link form an app takes files by: `file/` and the absolute path after it (its first / left out). */
export const FILE_FORM = "file/<path...>";

export interface FilePath {
  /** decoded; relative to the agent's folder unless it starts with / */
  path: string;
  /** the line, from #L12 or a last :12; 0: none */
  line: number;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const FILE_URL = /^file:\/\/(?:localhost)?(\/[^?#]*)(?:\?[^#]*)?(?:#([\s\S]*))?$/i;
const AT_LINE = /:(\d+)(?::\d+)?$/;

/** The file `href` is a path to, and the line it points at; null: not a file's path. */
export function filePath(href: string | null | undefined): FilePath | null {
  const text = String(href ?? "").trim();
  let raw: string, part: string;
  const url = FILE_URL.exec(text);
  if (url) [raw, part] = [url[1], url[2] || ""];
  else {
    if (!text || SCHEME.test(text) || /^(?:\/\/|[#?~])/.test(text)) return null;
    const hash = text.indexOf("#"),
      bare = hash < 0 ? text : text.slice(0, hash);
    part = hash < 0 ? "" : text.slice(hash + 1);
    raw = bare.split("?")[0];
  }
  let path = decode(raw);
  if (!path || path.includes("\u0000")) return null;
  let line = Number((/^L(\d+)/i.exec(decode(part) ?? "") || [])[1] || 0);
  const at = AT_LINE.exec(path);
  if (at) {
    path = path.slice(0, at.index);
    line ||= Number(at[1]);
  }
  return path ? { path, line } : null;
}

/** `path` from the folder `from` (both absolute: a path starting with / is itself), its . and .. taken out. */
export function joinPath(from: string, path: string): string {
  const out: string[] = [];
  for (const s of (path.startsWith("/") ? path : `${from}/${path}`).split("/")) {
    if (s === "..") out.pop();
    else if (s && s !== ".") out.push(s);
  }
  return `/${out.join("/")}`;
}

/** The link to the file at the absolute `path` (at `line`, if any) in the app `app`, of its FILE_FORM. */
export const fileHref = (app: string, path: string, line = 0): string =>
  `ag://${app}/file/${joinPath("/", path).slice(1).split("/").map(encodeURIComponent).join("/")}` +
  (line > 0 ? `#L${line}` : "");
