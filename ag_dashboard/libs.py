"""The libraries the dashboard vendors that apps' panels may load too, from their own origin (api/apps.py's `Origins`, at
/_ag/lib/<name>...): what two apps share is a library, never one app's code (app_kit/DESIGN.md, "Panels").

    pdfjs/...         pdf.js and its viewer (web/viewer.html), as DocWriter's build puts it in its folder
    marked.min.js     marked, Markdown to HTML
    purify.min.js     DOMPurify, HTML made safe to put in a page
    fileedit/...      app_kit.fileedit's panel code, for the apps built on it: a folder's files edited live, and
                      vendor/editor.js, CodeMirror and Yjs
    kit.js            app_kit's panel kit (app_kit/js/kit.js): what every panel builds its page with, `agKit`
    kit.css           the kit's colours (app_kit/js/kit.css): the dashboard's theme, light and dark, for every panel

    lib_file(rel)     (bytes, media type) of one of their files, by its path under /_ag/lib/; None: none such

The page's own pdf.js (/vendor/pdfjs/: the Editor's PDF viewer) is the same copy (api/page.py)."""

import mimetypes
import os
from typing import Optional, Tuple

import app_kit.fileedit

VENDOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor")
FILEEDIT = os.path.join(os.path.dirname(os.path.abspath(app_kit.fileedit.__file__)), "panel")
PDFJS = os.path.join(VENDOR, "pdfjs")      # pdf.js's viewer, as DocWriter's build puts it here (assets/src/docwriter)
KIT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(app_kit.fileedit.__file__)), "..", "js"))
LIBS = {"pdfjs": PDFJS, "fileedit": FILEEDIT, "marked.min.js": os.path.join(VENDOR, "marked.min.js"),
        "purify.min.js": os.path.join(VENDOR, "purify.min.js"), "kit.js": os.path.join(KIT, "kit.js"),
        "kit.css": os.path.join(KIT, "kit.css")}
#: What a file is served as, where Python's mimetypes says otherwise or nothing (pdf.js's modules, fonts and maps).
TYPES = {".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
         ".ftl": "text/plain; charset=utf-8", ".bcmap": "application/octet-stream", ".pfb": "application/octet-stream",
         ".woff2": "font/woff2", ".svg": "image/svg+xml", ".wasm": "application/wasm"}


def lib_file(rel: str) -> Optional[Tuple[bytes, str]]:
    name, _, rest = rel.strip("/").partition("/")
    root = LIBS.get(name)
    if root is None:
        return None
    if os.path.isfile(root):
        full = root if not rest else None
    else:
        full = os.path.normpath(os.path.join(root, rest))
        if not full.startswith(root + os.sep):
            full = None
    if not full or not os.path.isfile(full):
        return None
    ext = os.path.splitext(full)[1].lower()
    with open(full, "rb") as fh:
        return fh.read(), TYPES.get(ext) or mimetypes.guess_type(full)[0] or "application/octet-stream"
