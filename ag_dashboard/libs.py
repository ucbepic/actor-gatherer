"""The libraries the dashboard vendors that apps' panels may load too, from their own origin (api/apps.py's `Origins`, at
/_ag/lib/<name>...): what two apps share is a library, never one app's code (app_kit/DESIGN.md, "Panels").

    pdfjs/...         pdf.js and its viewer (web/viewer.html), as DocWriter's build puts it in its folder
    marked.min.js     marked, Markdown to HTML
    purify.min.js     DOMPurify, HTML made safe to put in a page

    lib_file(rel)     (bytes, media type) of one of their files, by its path under /_ag/lib/; None: none such

The page's own pdf.js (/vendor/pdfjs/: the Editor's PDF viewer) is the same copy (api/page.py)."""

import mimetypes
import os
from typing import Optional, Tuple

VENDOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor")
PDFJS = os.path.join(VENDOR, "docwriter", "pdfjs")
LIBS = {"pdfjs": PDFJS, "marked.min.js": os.path.join(VENDOR, "marked.min.js"),
        "purify.min.js": os.path.join(VENDOR, "purify.min.js")}
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
