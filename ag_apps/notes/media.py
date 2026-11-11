"""The Notes app's pictures (notebook.py, PICTURES): the files they are kept in, and what Figma gives of a frame.

    Files(folder)               the pictures, kept in a folder of the app's data, each named by its contents' hash and
                                its kind -- so one kept twice is one file, and a block copied to another gatherer's
                                notebook still finds it
      .keep(data)               a picture kept: {file, w, h}; MediaError for what is not one
      .path(file)               where one is, or None
    sniff(data)                 a picture's kind and size, read from its own header: ("png", w, h), or None
    Figma(folder, fetch?)       Figma's side of a figma block
      .token() / .set_token(t)  the user's personal access token, kept in the folder (none: only public files)
      .who()                    whose token it is
      .snapshot(url, mod?)      a picture of the frame or board a link names, and its name: {title, data?, mod}
    figma_title(url)            a name for a file, from its link

Standard library only."""
import hashlib
import json
import os
import re
import struct
import threading
import urllib.error
import urllib.parse
import urllib.request
from typing import Callable, Dict, Optional, Tuple

#: the kinds of picture kept, by the file name's ending
KINDS = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml"}
MAX_IMAGE = 25_000_000


class MediaError(ValueError):
    """What can't be done with a picture, as the user or an agent is told it."""


# ---------------------------------------------------------------- what a picture is


def sniff(data: bytes) -> Optional[Tuple[str, int, int]]:
    """A picture's kind (KINDS) and its size in pixels (0 where it doesn't say), from its header; None: not one."""
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        w, h = struct.unpack(">II", data[16:24])
        return "png", w, h
    if data[:6] in (b"GIF87a", b"GIF89a") and len(data) >= 10:
        w, h = struct.unpack("<HH", data[6:10])
        return "gif", w, h
    if data[:3] == b"\xff\xd8\xff":
        return "jpg", *_jpeg_size(data)
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", *_webp_size(data)
    head = data[:2048].lstrip()
    if head.startswith(b"\xef\xbb\xbf"):
        head = head[3:]
    if re.match(rb"^(?:<\?xml[^>]*>\s*)?(?:<!--.*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]", head, re.S | re.I):
        return "svg", *_svg_size(data[:8192])
    return None


def _jpeg_size(data: bytes) -> Tuple[int, int]:
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        size = struct.unpack(">H", data[i + 2:i + 4])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        i += 2 + size
    return 0, 0


def _webp_size(data: bytes) -> Tuple[int, int]:
    kind = data[12:16]
    if kind == b"VP8 " and len(data) >= 30:
        w, h = struct.unpack("<HH", data[26:30])
        return w & 0x3FFF, h & 0x3FFF
    if kind == b"VP8L" and len(data) >= 25:
        bits = int.from_bytes(data[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if kind == b"VP8X" and len(data) >= 30:
        return int.from_bytes(data[24:27], "little") + 1, int.from_bytes(data[27:30], "little") + 1
    return 0, 0


def _svg_size(head: bytes) -> Tuple[int, int]:
    tag = re.search(rb"<svg\b[^>]*>", head, re.S | re.I)
    if not tag:
        return 0, 0
    attrs = tag.group(0).decode("utf-8", "replace")

    def num(name: str) -> int:
        m = re.search(rf'\s{name}\s*=\s*["\']\s*([\d.]+)\s*(?:px)?\s*["\']', attrs)
        return int(float(m.group(1))) if m else 0
    w, h = num("width"), num("height")
    if not (w and h):
        box = re.search(r'viewBox\s*=\s*["\']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)', attrs)
        if box:
            w, h = int(float(box.group(1))), int(float(box.group(2)))
    return w, h


# ---------------------------------------------------------------- the files


class Files:
    def __init__(self, folder: str):
        self.folder = folder

    def keep(self, data: bytes) -> Dict[str, object]:
        if not data:
            raise MediaError("no picture: the file is empty")
        if len(data) > MAX_IMAGE:
            raise MediaError(f"{len(data) / 1e6:.0f} MB is too large for a picture in the notes (at most "
                             f"{MAX_IMAGE / 1e6:.0f} MB)")
        got = sniff(data)
        if got is None:
            raise MediaError("not a picture Notes can show: PNG, JPEG, GIF, WebP or SVG")
        kind, w, h = got
        name = f"{hashlib.sha256(data).hexdigest()[:16]}.{kind}"
        path = os.path.join(self.folder, name)
        if not os.path.isfile(path):
            os.makedirs(self.folder, exist_ok=True)
            tmp = f"{path}.{os.getpid()}.{threading.get_ident()}.tmp"
            with open(tmp, "wb") as fh:
                fh.write(data)
            os.replace(tmp, path)
        out: Dict[str, object] = {"file": name}
        if w and h:
            out.update(w=w, h=h)
        return out

    def path(self, name: str) -> Optional[str]:
        if not isinstance(name, str) or not re.match(r"^[a-f0-9]{16}\.(?:png|jpg|gif|webp|svg)$", name):
            return None
        path = os.path.join(self.folder, name)
        return path if os.path.isfile(path) else None


# ---------------------------------------------------------------- Figma

_PARTS = re.compile(r"^https://(?:www\.)?figma\.com/(design|file|board|proto|slides|deck)/([A-Za-z0-9]{6,64})"
                    r"(?:/([^/?#]*))?")


def figma_parts(url: str) -> Tuple[str, str, str, str]:
    """A Figma link's kind (design, board, ...), its file's key, the node it points at (as the API names it, "12:34";
    "" for none) and the file's name in it ("" if it has none)."""
    m = _PARTS.match(url or "")
    if not m:
        raise MediaError("not a link to a Figma file: https://www.figma.com/design/..., /board/..., /proto/...")
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
    node = (q.get("node-id") or q.get("node_id") or [""])[0].replace("-", ":")
    return m.group(1), m.group(2), node, urllib.parse.unquote(m.group(3) or "")


def figma_title(url: str) -> str:
    """A name for a Figma file from its link alone: the file's name in it, its dashes made spaces."""
    try:
        name = figma_parts(url)[3]
    except MediaError:
        return ""
    return re.sub(r"\s+", " ", name.replace("-", " ")).strip()[:300]


#: (url, headers) -> (status, body); urllib's by default (a test gives its own)
Fetch = Callable[[str, Dict[str, str]], Tuple[int, bytes]]
API = "https://api.figma.com/v1"


def _fetch(url: str, headers: Dict[str, str]) -> Tuple[int, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": "ag-notes", **headers})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:          # noqa: S310 (https only: the callers' links)
            return r.status, r.read(MAX_IMAGE + 1)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(64_000) if exc.fp else b""
    except (urllib.error.URLError, OSError) as exc:
        raise MediaError(f"Figma can't be reached: {getattr(exc, 'reason', exc)}") from None


class Figma:
    def __init__(self, folder: str, fetch: Optional[Fetch] = None):
        self.file = os.path.join(folder, "figma.json")
        self.fetch = fetch or _fetch
        self.lock = threading.Lock()

    # -- the token

    def token(self) -> str:
        try:
            with open(self.file, encoding="utf-8") as fh:
                return str(json.load(fh).get("token") or "")
        except (OSError, ValueError, AttributeError):
            return ""

    def set_token(self, token: str) -> Dict[str, str]:
        """The user's token kept (checked with Figma first: whose it is), or forgotten (`token` "")."""
        token = (token or "").strip()
        if not token:
            with self.lock:
                try:
                    os.remove(self.file)
                except OSError:
                    pass
            return {}
        me = self._me(token)
        with self.lock:
            os.makedirs(os.path.dirname(self.file), exist_ok=True)
            tmp = f"{self.file}.{os.getpid()}.tmp"
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump({"token": token, "who": me}, fh)
            os.replace(tmp, self.file)
        return {"who": me}

    def who(self) -> str:
        try:
            with open(self.file, encoding="utf-8") as fh:
                return str(json.load(fh).get("who") or "")
        except (OSError, ValueError, AttributeError):
            return ""

    def _me(self, token: str) -> str:
        status, body = self.fetch(f"{API}/me", {"X-Figma-Token": token})
        if status in (401, 403):
            raise MediaError("Figma refused that token: make one in Figma's Settings, Security, Personal access tokens")
        if status != 200:
            raise MediaError(f"Figma answered {status}")
        got = _json(body)
        return str(got.get("handle") or got.get("email") or "")

    # -- a picture of a frame

    def snapshot(self, url: str, mod: str = "") -> Dict[str, object]:
        """A picture of what a link shows -- its node, or the file's own cover -- and its name: {title, mod, data}.
        `mod` the file's last change when the picture held was made: unchanged since, no `data`. With the user's
        token, any file they can open; without, a public one's cover only (Figma's oEmbed)."""
        kind, key, node, _ = figma_parts(url)
        token = self.token()
        if not token:
            return self._public(url)
        head = {"X-Figma-Token": token}
        if node:
            status, body = self.fetch(f"{API}/files/{key}/nodes?ids={urllib.parse.quote(node)}&depth=1", head)
        else:
            status, body = self.fetch(f"{API}/files/{key}?depth=1", head)
        self._ok(status, body)
        got = _json(body)
        title = str(got.get("name") or "")
        if node:
            doc = ((got.get("nodes") or {}).get(node) or {}).get("document") or {}
            if not doc:
                raise MediaError("that frame isn't in the file any more")
            title = str(doc.get("name") or title)
        changed = str(got.get("lastModified") or "")
        if changed and changed == mod:
            return {"title": title[:300], "mod": changed}
        if node:
            status, body = self.fetch(f"{API}/images/{key}?ids={urllib.parse.quote(node)}&format=png&scale=2", head)
            self._ok(status, body)
            where = (_json(body).get("images") or {}).get(node)
        else:
            where = got.get("thumbnailUrl")
        if not where:
            raise MediaError("Figma made no picture of it (an empty frame?)")
        return {"title": title[:300], "mod": changed, "data": self._picture(str(where))}

    def _public(self, url: str) -> Dict[str, object]:
        status, body = self.fetch(f"https://www.figma.com/api/oembed?url={urllib.parse.quote(url, safe='')}", {})
        if status in (401, 403, 404):
            raise MediaError("the file isn't public: add a Figma token for a snapshot of it")
        if status != 200:
            raise MediaError(f"Figma answered {status}")
        got = _json(body)
        where = got.get("thumbnail_url")
        if not where:
            raise MediaError("Figma gave no picture of it")
        return {"title": str(got.get("title") or "")[:300], "mod": "", "data": self._picture(str(where))}

    def _picture(self, where: str) -> bytes:
        if not where.startswith("https://"):
            raise MediaError("Figma's picture isn't on https")
        status, body = self.fetch(where, {})
        if status != 200 or not body:
            raise MediaError(f"Figma's picture didn't come ({status})")
        if len(body) > MAX_IMAGE:
            raise MediaError("Figma's picture is too large")
        return body

    @staticmethod
    def _ok(status: int, body: bytes) -> None:
        if status == 200:
            return
        said = str(_json(body).get("err") or _json(body).get("message") or "")
        if status in (401, 403):
            raise MediaError("Figma won't show that file to this token" + (f": {said}" if said else ""))
        if status == 404:
            raise MediaError("Figma has no such file")
        if status == 429:
            raise MediaError("Figma asks to wait: too many requests")
        raise MediaError(f"Figma answered {status}" + (f": {said}" if said else ""))


def _json(body: bytes) -> dict:
    try:
        got = json.loads(body or b"{}")
    except ValueError:
        return {}
    return got if isinstance(got, dict) else {}
