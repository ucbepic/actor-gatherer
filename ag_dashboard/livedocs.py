"""Files edited in the page's Editor panel, shared as they are edited: each file open there is one document of a
CRDT -- Yjs's, kept here by pycrdt (the Python binding of its Rust port) -- of which every page editing it holds
a copy; and what an actor (or anything else) writes to the file is merged in as it lands, three ways, as version
control merges: the lines only the file changed take its change, and the lines it changed in the conflict zone -- those
the pages edited since the file was opened -- or that the pages changed too, differently, are a conflict: the pages'
kept, the file's shown beside them, for a page to take or not.

    a page opens a file        `LiveDocs.join`: the file's document (made from the file the first time it is
                               opened), every other page's cursor, and then -- through its stream (`Conn.queue`) --
                               the others' edits and cursors, and the disk's changes, as they come
    a page edits               `Room.edit`: its update applied here, and sent on to the other pages; what it changed,
                               put in the conflict zone (`zone`: ranges of the document, moved with each edit, until
                               a page clears it, or the last page goes -- ZONE_GRACE seconds after, a page's stream
                               may come back)
    a page's cursor moves      `Room.aware`: kept (a page that opens the file later is sent it), and sent on
                               (y-protocols' awareness updates, passed through unread)
    the file changes on disk   `Room.check`, every POLL seconds while the file is open: `merge` of the file as last
                               read or written here (`disk`), the document, and the file now; the merged text made
                               the document's (an edit here, sent to every page), and each conflict kept (`Conflict`:
                               where the pages' lines are, moved with each edit, and the file's)
    a page settles a conflict  `Room.settle`: the pages' lines kept, the file's taken in their place, or both -- or
                               lines the page made of the file's in its box (Edit), in place of the pages' (`edited`)
    a page saves               `Room.save`: the document written to the file, in place of it (whoever reads it
                               meanwhile reads all of the old or all of the new) -- the file's own change taken in
                               first, and not saved over where it is a conflict found then; a conflict shown before
                               is settled as the pages' lines. Saved, the zone's lines are still its: a change on disk
                               to them -- an actor rewriting what was typed, a script's write from the file before the
                               save -- is a conflict (`Conflict.zone`), the pages say which
    a page asks first          `Room.hold`: a page holding the file "ask" -- every change on disk asked about, not merged
                               in (`Conflict.asked`: the document keeps its lines; the file's beside them, taken or
                               put back -- Reject writes the document's lines over the file's)
    an actor changes it        `Room.put`: the whole text as the actor wants it (from what it read: `view`) -- "live",
    through an app             its changes in the document at once, marked in its hue (`marks`), and written to the
                               file (its lines only: what the pages typed and did not save stays unsaved); those to
                               the conflict zone's lines held for the pages (a `Conflict` with `agent`, why "zone").
                               Or "propose": none of it in, each change held for the pages to accept or reject (why
                               "approve": its proposals) -- the actor reading the text with its own proposals in
                               (`view`), its next change building on them; accepted, written to the file

A file whose document has changes no one saved stays open after its last page goes (a page opened again finds
them); one with none is closed LINGER seconds after. Only a regular file of UTF-8 text, at most MAX_BYTES, opens,
and only under the root the page names (the actor's working directory). Needs pycrdt: without it (`AVAILABLE`
false) the page does not offer the view.

Any other file the page shows, not edits: `about` says what it is -- an image, a PDF, a sound, a video, or none of
them -- and the page reads its bytes (api/editor.py's /api/edit/raw/...)."""
import base64
import bisect
import difflib
import getpass
import os
import queue
import sqlite3
import stat
import subprocess
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from collections import deque
from typing import Dict, List, Optional, Tuple

from . import data

try:
    from pycrdt import Doc, Text
    AVAILABLE = True
except ImportError:                                 # the page says what to install
    Doc = Text = None
    AVAILABLE = False

POLL = 0.4                  # seconds between looks at each open file
LINGER = 30.0               # seconds a file with nothing unsaved stays open after its last page goes
MAX_BYTES = 2_000_000       # the largest file opened
MAX_ENTRIES = 2000          # the most entries listed of one directory
FINE = 4000                 # changed lines up to this many characters (old and new) are changed by character
RECENT = 1800.0             # seconds an actor's change to a file counts in a listing's `writers`
CREDIT = 3.0                # seconds an actor's recorded change may come before the change on disk it made
ZONE_GRACE = 5.0            # seconds the conflict zone stays after the last page with the file open goes
GONE_CHECK = 5.0            # the most a stream waits before it looks whether its page went
SKIPPED = frozenset({".git", "node_modules", "__pycache__", ".venv", "venv", ".mypy_cache", ".pytest_cache",
                     ".ruff_cache", ".tox", ".DS_Store"})
FILES_MAX = 20000           # the most files Go to file is given of one folder
FILES_S = 2.0               # seconds a folder's walk for them may take
TAKES = ("mine", "theirs", "both", "edited")   # how a conflict is settled (Room.settle)
HOLDS = ("merge", "ask")    # how a page takes the file's changes on disk (Room.hold): merged in, or each asked about
PUTS = ("live", "propose")  # how an actor's change is put in (Room.put): at once, or held for the pages to accept
TEMP = ".ag-edit"           # what a file being saved is written as first, beside it: not listed
ROOT = "text"               # the document's one shared type: the file's text


class DocError(ValueError):
    """What the page is told: why a file cannot be listed, opened or saved."""


class _Changing(Exception):
    """The file changed while it was read: read it again later."""


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _signature(st: os.stat_result) -> tuple:
    return (st.st_mtime_ns, st.st_size, st.st_ino)


def resolve(path: str, root: str) -> str:
    """`path`, with its links followed, if it is under `root` (likewise): what the page may list, open or save."""
    if not path or not root or not os.path.isabs(path) or not os.path.isabs(root):
        raise DocError("an absolute path and the directory it is under, please")
    real, top = os.path.realpath(path), os.path.realpath(root)
    if os.path.commonpath([real, top]) != top:
        raise DocError(f"{path} is not under {root}")
    return real


def create(path: str, root: str, folder: bool = False) -> dict:
    """A new file, empty -- or a folder -- at `path` under `root`, the folders above it made too (the Editor's New file,
    New folder; a name such as "src/a.py" makes `src` as well): refused where anything is already."""
    if not path or not root or not os.path.isabs(path) or not os.path.isabs(root):
        raise DocError("an absolute path and the directory it is under, please")
    name = os.path.basename(path.rstrip("/"))
    if not name or name in (".", "..") or "\0" in path:
        raise DocError("a name, please")
    real = resolve(path.rstrip("/"), root)
    if os.path.lexists(real):
        raise DocError(f"{name} is there already")
    try:
        os.makedirs(os.path.dirname(real), exist_ok=True)
        if folder:
            os.mkdir(real)
        else:
            with open(real, "x", encoding="utf-8"):
                pass
    except FileExistsError:                         # made meanwhile, or a file where a folder above it would go
        raise DocError(f"{name} is there already, or a file is where a folder above it would be") from None
    except NotADirectoryError:
        raise DocError(f"a file is where a folder above {name} would be") from None
    except PermissionError:
        raise DocError(f"{os.path.dirname(real)} may not be written") from None
    return {"path": real, "dir": folder}


def file_list(directory: str, root: str) -> dict:
    """The files under `directory`, as paths from it, for the Editor's Go to file: in a git project, git's list of them
    (those it tracks, and new ones it does not ignore); else a walk, the nearest first, of the folders but those listings
    leave out (SKIPPED), links to folders not followed. At most FILES_MAX of them, the walk at most FILES_S seconds:
    `more`, there were more."""
    real = resolve(directory, root)
    if not os.path.isdir(real):
        raise DocError(f"{directory} is not a directory")
    got = _git_files(real)
    if got is not None:
        got = [f for f in got if not f.endswith(TEMP) and not any(part in SKIPPED for part in f.split("/"))]
        got.sort(key=lambda f: (f.count("/"), f.lower()))
        kept = [f for f in got[:FILES_MAX] if os.path.isfile(os.path.join(real, f))]   # not one deleted since, nor a submodule
        return {"dir": directory, "files": kept, "more": len(got) > FILES_MAX, "git": True}
    found: List[str] = []
    more, until, todo = False, time.monotonic() + FILES_S, deque([""])
    while todo and not more:
        rel = todo.popleft()
        try:
            with os.scandir(os.path.join(real, rel)) as entries:
                for entry in sorted(entries, key=lambda e: e.name.lower()):
                    if entry.name in SKIPPED or entry.name.endswith(TEMP):
                        continue
                    path = f"{rel}/{entry.name}" if rel else entry.name
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            todo.append(path)
                        elif entry.is_file():
                            found.append(path)
                    except OSError:
                        continue
                    if len(found) >= FILES_MAX or time.monotonic() > until:
                        more = True
                        break
        except OSError:                             # unreadable: left out
            continue
    return {"dir": directory, "files": found, "more": more or bool(todo) and len(found) >= FILES_MAX, "git": False}


def _git_files(real: str) -> Optional[List[str]]:
    """git's list of the files under `real`, as paths from it -- those it tracks and the new ones it does not ignore --
    if `real` is in a git work tree; else None."""
    try:
        done = subprocess.run(["git", "-C", real, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                              capture_output=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if done.returncode != 0:
        return None
    return list(dict.fromkeys(f for f in done.stdout.decode("utf-8", "surrogateescape").split("\0") if f))


def read(path: str) -> Tuple[str, tuple]:
    """The file's text and its signature, read between two looks at it that agree."""
    try:
        before = os.stat(path)
    except FileNotFoundError:
        raise DocError(f"{path} does not exist") from None
    if not stat.S_ISREG(before.st_mode):
        raise DocError(f"{path} is not a file")
    if before.st_size > MAX_BYTES:
        raise DocError(f"{path} is too large to edit here ({before.st_size:,} bytes; at most {MAX_BYTES:,})")
    with open(path, "rb") as fh:
        raw = fh.read(MAX_BYTES + 1)
    after = os.stat(path)
    if _signature(before) != _signature(after):
        raise _Changing()
    if len(raw) > MAX_BYTES:
        raise DocError(f"{path} is too large to edit here")
    if b"\0" in raw[:8192]:
        raise DocError(f"{path} is not a text file")
    try:
        return raw.decode("utf-8"), _signature(after)
    except UnicodeDecodeError:
        raise DocError(f"{path} is not UTF-8 text") from None


# What the Editor shows a file as, when not its text (`about`): by its name's ending -- else by its first bytes (MAGIC) --
# and the media type its bytes are served as (`about`'s `type`, the page's /api/edit/raw/...).
VIEWS = {**dict.fromkeys("png jpg jpeg gif webp bmp ico avif svg".split(), "image"), "pdf": "pdf",
         **dict.fromkeys("mp3 wav ogg oga opus flac m4a aac".split(), "audio"),
         **dict.fromkeys("mp4 m4v webm mov ogv".split(), "video")}
TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
         "bmp": "image/bmp", "ico": "image/x-icon", "avif": "image/avif", "svg": "image/svg+xml", "pdf": "application/pdf",
         "mp3": "audio/mpeg", "wav": "audio/wav", "ogg": "audio/ogg", "oga": "audio/ogg", "opus": "audio/ogg",
         "flac": "audio/flac", "m4a": "audio/mp4", "aac": "audio/aac", "mp4": "video/mp4", "m4v": "video/mp4",
         "webm": "video/webm", "mov": "video/quicktime", "ogv": "video/ogg"}
MAGIC = ((b"%PDF-", "pdf"), (b"\x89PNG\r\n\x1a\n", "png"), (b"\xff\xd8\xff", "jpg"), (b"GIF87a", "gif"),
         (b"GIF89a", "gif"))
SNIFF = 8192                # the bytes of a file looked at to tell what it is


def _texty(head: bytes) -> bool:
    """Whether a file's first bytes are text: no NUL, UTF-8 -- but for a character cut at their end."""
    if b"\0" in head:
        return False
    try:
        head.decode("utf-8")
        return True
    except UnicodeDecodeError as exc:
        return len(head) == SNIFF and exc.start > len(head) - 4


def about(path: str, root: str) -> dict:
    """What the Editor opens the file P (under R) as: {path, real (links followed), name, kind, type, size, mtime, text,
    max}. `kind`: "image", "pdf", "audio" or "video" -- by its name's ending, else by its first bytes; one named so whose
    first bytes are text (a Git LFS pointer, a placeholder) is "text" -- or "text" (UTF-8, as far as its first SNIFF
    bytes say), else "file". `type`: the media type its bytes are served as -- text as plain text, never as a page.
    `text`: whether the editor opens it (text, at most MAX_BYTES): an SVG's is too."""
    real = resolve(path, root)
    try:
        st = os.stat(real)
    except FileNotFoundError:
        raise DocError(f"{path} does not exist") from None
    if not stat.S_ISREG(st.st_mode):
        raise DocError(f"{path} is not a file")
    try:
        with open(real, "rb") as fh:
            head = fh.read(SNIFF)
    except PermissionError:
        raise DocError(f"{path} may not be read") from None
    name = os.path.basename(path.rstrip("/")) or os.path.basename(real)
    ext = os.path.splitext(name)[1][1:].lower()
    sniffed = next((x for magic, x in MAGIC if head.startswith(magic)), None) \
        or ("webp" if head[:4] == b"RIFF" and head[8:12] == b"WEBP" else None)
    texty = _texty(head)
    named = VIEWS.get(ext)
    if named and ext != "svg" and texty and head and not sniffed:
        named = None                                # named as one, but text
    kind = named or (VIEWS[sniffed] if sniffed else "text" if texty else "file")
    shown = ext if named else sniffed
    kind_type = TYPES.get(shown or "") if kind != "text" else None
    return {"path": path, "real": real, "name": name, "kind": kind,
            "type": kind_type or ("text/plain; charset=utf-8" if texty else "application/octet-stream"),
            "size": st.st_size, "mtime": st.st_mtime, "text": texty and st.st_size <= MAX_BYTES, "max": MAX_BYTES}


def change(text, new: str) -> None:
    """Make `text` (a pycrdt Text) hold `new`: what differs, line by line -- and within changed lines by character,
    where they are short -- deleted and inserted, the rest left as it is, so what others typed around it stays
    where it was. pycrdt counts positions in UTF-8 bytes."""
    old = str(text)
    if old == new:
        return
    a, b = old.splitlines(keepends=True), new.splitlines(keepends=True)
    starts = [0]                                    # each line's start in old, in bytes
    for line in a:
        starts.append(starts[-1] + len(line.encode("utf-8")))
    ops: List[Tuple[int, int, str]] = []            # (start, end, what replaces it), in bytes of old
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            continue
        was, now = "".join(a[i1:i2]), "".join(b[j1:j2])
        if tag == "replace" and len(was) + len(now) <= FINE:
            for t, k1, k2, l1, l2 in difflib.SequenceMatcher(None, was, now, autojunk=False).get_opcodes():
                if t != "equal":
                    at = starts[i1] + len(was[:k1].encode("utf-8"))
                    ops.append((at, at + len(was[k1:k2].encode("utf-8")), now[l1:l2]))
        else:
            ops.append((starts[i1], starts[i2], now))
    for start, end, put in reversed(ops):           # from the end: each leaves the positions before it as they were
        if end > start:
            del text[start:end]
        if put:
            text.insert(start, put)


def _hunks(base: List[str], new: List[str]) -> List[tuple]:
    """What `new` changed of `base`'s lines: (start, end, its lines there) of each change."""
    return [(i1, i2, new[j1:j2]) for t, i1, i2, j1, j2 in
            difflib.SequenceMatcher(None, base, new, autojunk=False).get_opcodes() if t != "equal"]


def _both(base: List[str], mine: List[str], theirs: List[str]) -> Optional[List[str]]:
    """`base`'s lines with `mine`'s changes and `theirs`', if they change different lines of it (side by side is
    different); None if one changes a line the other does, or both put lines in at the same place."""
    ours, others = _hunks(base, mine), _hunks(base, theirs)
    for a1, a2, _ in ours:
        for b1, b2, _ in others:
            if a1 < b2 and b1 < a2 or a1 == a2 == b1 == b2 or (a1 == a2 and b1 < a1 < b2) or (b1 == b2 and a1 < b1 < a2):
                return None
    out, at = [], 0
    for i1, i2, new in sorted(ours + others, key=lambda h: (h[0], h[1])):
        out += base[at:i1] + new
        at = i2
    return out + base[at:]


def _guarded(a1: int, a2: int, guard) -> bool:
    """Whether `mine`'s lines a1..a2 are in `guard`'s ranges (start, end) -- an empty range, a place between lines:
    whether it is inside one, not at its edge."""
    return any(a1 < g2 and g1 < a2 if a1 < a2 else g1 < a1 < g2 for g1, g2 in guard)


def _meets(a1: int, a2: int, held) -> bool:
    """Whether `mine`'s lines a1..a2 meet any of `held`'s ranges (start, end) -- an empty range: at its edges too."""
    return any(h1 <= a2 and a1 <= h2 if a1 == a2 or h1 == h2 else a1 < h2 and h1 < a2 for h1, h2 in held)


def _theirs_guarded(was: List[str], ours: List[str], others: List[str], at: int, guard) -> bool:
    """Whether a change of `others`' to `was`'s lines is in `guard` -- `mine`'s lines, `ours` from line `at` of it: each
    of `was`'s lines where `ours` has it, after what `ours` changed before it."""
    mine = _hunks(was, ours)
    for i1, i2, _ in _hunks(was, others):
        shift = sum(len(new) - (h2 - h1) for h1, h2, new in mine if h2 <= i1)
        if _guarded(at + i1 + shift, at + i2 + shift, guard):
            return True
    return False


def syncs(o: List[str], a: List[str], b: List[str]) -> List[Tuple[int, int, int, int]]:
    """Where `a` and `b`, each a change of `o`'s lines, both have `o`'s lines as they were: (start, end) of `o`'s,
    and where they start in `a` and in `b` -- in order, the last (the end of all three) empty. What lies between two
    is a place one or both changed."""
    ma = difflib.SequenceMatcher(None, o, a, autojunk=False).get_matching_blocks()
    mb = difflib.SequenceMatcher(None, o, b, autojunk=False).get_matching_blocks()
    out, i, j = [], 0, 0
    while i < len(ma) and j < len(mb):
        (oa, aa, na), (ob, bb, nb) = ma[i], mb[j]
        lo, hi = max(oa, ob), min(oa + na, ob + nb)
        if lo < hi:
            out.append((lo, hi, aa + lo - oa, bb + lo - ob))
        if oa + na < ob + nb:
            i += 1
        else:
            j += 1
    return out + [(len(o), len(o), len(a), len(b))]


def merge(base: str, mine: str, theirs: str, guard: List[Tuple[int, int]] = (),
          held: List[Tuple[int, int]] = ()) -> Tuple[str, List[tuple], int]:
    """Three ways, by line, as version control merges: `base`, and what `mine` and `theirs` each made of it. The
    merged text; each conflict -- lines both changed, differently, or that `theirs` changed among `guard`'s (ranges
    of `mine`'s lines it may not change unasked: the conflict zone), or changed again where `held`'s are (`mine`'s
    lines of the conflicts still open: what `theirs` does there is that conflict's, not merged around it) -- as
    (start, end) of `mine`'s lines kept in the
    merged text (characters), with `base`'s and `theirs`' lines there, and whether it is one for `guard`; and how many
    of `mine`'s changes `theirs` lacks (kept from `mine` alone)."""
    o, a, b = base.splitlines(True), mine.splitlines(True), theirs.splitlines(True)
    out, conflicts, kept, size = [], [], 0, 0
    zo = za = zb = 0
    for lo, hi, sa, sb in syncs(o, a, b):
        was, ours, others = o[zo:lo], a[za:sa], b[zb:sb]
        put, conflict = ours, None
        if others == was or ours == others:         # only mine changed it, or both alike (or neither)
            kept += others == was and ours != was
        elif ours == was:                           # only theirs: taken, but where it may not change mine unasked
            if _theirs_guarded(was, ours, others, za, guard):
                conflict = True
            else:
                put = others
        else:
            both = None if _meets(za, sa, held) else _both(was, ours, others)
            if both is None:                        # both, differently (or a conflict still open): mine kept, a conflict
                conflict = _guarded(za, sa, guard)
            elif _theirs_guarded(was, ours, others, za, guard):
                conflict = True
            else:
                put, kept = both, kept + 1
        if conflict is not None:
            n = sum(map(len, ours))
            conflicts.append((size, size + n, "".join(was), "".join(others), conflict))
        out += put + o[lo:hi]
        size += sum(map(len, put)) + sum(map(len, o[lo:hi]))
        zo, za, zb = hi, sa + hi - lo, sb + hi - lo
    return "".join(out), conflicts, kept


def _utf16(raw: bytes, at: int) -> int:
    """A position in UTF-8 bytes (pycrdt's) as one in UTF-16 units (the page's, JavaScript's)."""
    return len(raw[:at].decode("utf-8", errors="ignore").encode("utf-16-le")) // 2


def writers(directories: List[str], since: float) -> Dict[str, List[dict]]:
    """The actors that changed a file under any of `directories` since `since` (seconds), by the file's path from
    its directory: [{gatherer, channel, at, how}], each actor's latest change, the latest first -- what ag's hook found
    each tool call did on disk (every gatherer's `file_touched` events; an older gatherer's `_touches`, copied there
    once). Read newest first, by the events' type, and only back to `since`: the events are in the order they came
    (copied ones, in theirs, before any that came after)."""
    prefixes = [d.rstrip("/") + "/" for d in set(directories)]
    out: Dict[str, Dict[tuple, dict]] = {}
    names = data.gatherer_names()
    for gatherer in names[:1] if data.paths.merged() else names:        # the home's one database: read once
        conn = data._connect(gatherer)
        if conn is None:
            continue
        try:
            owner = {ch: g for g in names for ch in data.members(conn, g)} if data.paths.merged() else None
            kind = conn.execute("SELECT event_type_id FROM event_types WHERE name = 'file_touched'").fetchone()
            if kind is None:
                continue
            for r in conn.execute(f"SELECT {data.CHANNEL} AS session, inserted_at, payload_json FROM events "
                                  "WHERE event_type_id = ? ORDER BY row_id DESC", (kind[0],)):
                at = data._seconds(r["inserted_at"])
                if at is None or at < since:
                    break
                t = data._json(r["payload_json"]) or {}
                path = t.get("path")
                if t.get("how") not in ("created", "modified", "deleted") or not isinstance(path, str):
                    continue
                mine = gatherer if owner is None else owner.get(r["session"])    # its group's, in the one database
                if mine is None:
                    continue
                for prefix in prefixes:
                    if path.startswith(prefix):
                        key, kept = (mine, r["session"]), out.setdefault(path[len(prefix):], {})
                        if key not in kept or at > kept[key]["at"]:
                            kept[key] = {"gatherer": mine, "channel": r["session"], "at": at, "how": t["how"]}
        except sqlite3.Error:                       # being written, or not ag's: the next listing
            continue
        finally:
            conn.close()
    return {rel: sorted(by.values(), key=lambda w: -w["at"]) for rel, by in out.items()}


def _latest(found: List[dict]) -> List[dict]:
    """Writers, each actor's latest kept, the latest first."""
    kept: Dict[tuple, dict] = {}
    for w in found:
        key = (w["gatherer"], w["channel"])
        if key not in kept or w["at"] > kept[key]["at"]:
            kept[key] = w
    return sorted(kept.values(), key=lambda w: -w["at"])


class Conn:
    """One page's stream of a file: what it is sent (`queue`: (event, value), or None to end), its Yjs client id,
    its last awareness update (its user and cursor), and how it takes the file's changes on disk (`hold`: HOLDS)."""

    def __init__(self, cid: str, client: int, hold: str = "merge"):
        self.id, self.client, self.queue, self.aware, self.hold = cid, client, queue.Queue(), None, hold


class Conflict:
    """Lines the pages and the file on disk both changed, differently, or that the file changed in the conflict zone
    (`zone`), or anywhere while a page asks first (`asked`): the pages' kept in the document -- from `start` to `end`,
    in UTF-8 bytes, moved with each edit (`Room._move`) -- and the file's (`theirs`, over `base`), until a page settles
    it. Or an actor's change not taken in until a page says -- its lines (`theirs`) in place of these: one on a branch
    of its own (`agent`, branches.py's: {gatherer, channel, branch, path, key, approve}), or one put in through an app
    (`agent`: who the app said, with `put` and `why`: "approve", a proposal; "zone", lines the pages are editing)."""

    def __init__(self, start: int, end: int, base: str, theirs: str, zone: bool = False, since: Optional[float] = None,
                 agent: Optional[dict] = None, cid: Optional[str] = None, asked: bool = False):
        self.id, self.at, self.zone, self.agent = cid or uuid.uuid4().hex[:12], time.time(), zone, agent
        self.since = self.at if since is None else since      # when the file first changed these lines, unsettled
        self.start, self.end, self.base, self.theirs, self.asked = start, end, base, theirs, asked


def _put_by(c: Conflict, channel: Optional[str] = None, why: Optional[str] = None) -> bool:
    """Whether `c` is an actor's change put in through an app (Room.put) -- that actor's (`channel`), held why (`why`)."""
    a = c.agent
    return bool(a and a.get("put") and (channel is None or a.get("channel") == channel)
                and (why is None or a.get("why") == why))


class Room:
    """A file open for editing: its document, the pages editing it, and the file as last read or written here."""

    def __init__(self, path: str):
        text, sig = read(path)
        self.path, self.lock = path, threading.RLock()
        self.epoch = uuid.uuid4().hex               # this document: a page that had another (the dashboard restarted)
        self.doc = Doc(allow_multithreading=True)   # starts again from this one
        self.doc[ROOT] = self.text = Text(text)
        self.disk, self.sig = text, sig
        self.missing, self.error, self.dirty = False, "", False
        self.changed: Optional[float] = None        # when the file last changed on disk while open
        self.saved: Optional[float] = None          # when it was last saved from here
        self.zone: List[List[int]] = []            # the conflict zone: [start, end] of the document, in UTF-8 bytes
        self._from_page = False                     # an edit being applied is a page's: put in the zone
        self.conflicts: Dict[str, Conflict] = {}
        self.marks: List[list] = []                 # the lines actors on branches changed: [start, end, gatherer, channel]
        self.conns: Dict[str, Conn] = {}
        self.idle_since: Optional[float] = None     # when its last page went
        self._moves = self.text.observe(self._move)

    def _move(self, event) -> None:
        """Each conflict's lines, the conflict zone and the actors' marks, moved with an edit to the document, any page's
        or this one's (pycrdt's delta, which counts UTF-8 bytes): what is put in a conflict's lines, or at their edges,
        theirs; what is put inside the zone's ranges, or a mark's, not at their edges, theirs. A page's edit is put in
        the zone: what it put in, and where it took something out (an empty range)."""
        if not self.conflicts and not self.zone and not self.marks and not self._from_page:
            return
        at = 0
        for op in event.delta:
            if "retain" in op:
                at += op["retain"]
            elif "insert" in op:
                n = len(op["insert"].encode("utf-8")) if isinstance(op["insert"], str) else 1
                for c in self.conflicts.values():
                    if at < c.start:
                        c.start, c.end = c.start + n, c.end + n
                    elif at <= c.end:
                        c.end += n
                for z in (*self.zone, *self.marks):
                    if at <= z[0]:
                        z[0], z[1] = z[0] + n, z[1] + n
                    elif at < z[1]:
                        z[1] += n
                if self._from_page:
                    self.zone.append([at, at + n])
                at += n
            elif "delete" in op:
                n = op["delete"]
                for c in self.conflicts.values():
                    c.start = c.start if c.start <= at else max(at, c.start - n)
                    c.end = c.end if c.end <= at else max(at, c.end - n)
                for z in (*self.zone, *self.marks):
                    z[0] = z[0] if z[0] <= at else max(at, z[0] - n)
                    z[1] = z[1] if z[1] <= at else max(at, z[1] - n)
                if self._from_page:
                    self.zone.append([at, at])
        if self._from_page:
            self._join_zone()

    def _join_zone(self) -> None:
        """The conflict zone's ranges that meet, one."""
        kept: List[List[int]] = []
        for z in sorted(self.zone):
            if kept and z[0] <= kept[-1][1]:
                kept[-1][1] = max(kept[-1][1], z[1])
            else:
                kept.append(z)
        self.zone = kept

    def _unzone(self, a: int, b: int) -> None:
        """The conflict zone without what it has from `a` to `b` (UTF-8 bytes of the document), an empty range there
        too: lines about to be put in place of others, not left marking the line after them."""
        kept: List[List[int]] = []
        for z0, z1 in self.zone:
            if z1 < a or z0 > b or (z1 == a and z0 < a) or (z0 == b and z1 > b):
                kept.append([z0, z1])
                continue
            if z0 < a:
                kept.append([z0, a])
            if z1 > b:
                kept.append([b, z1])
        self.zone = kept

    @staticmethod
    def _lines(text: str, ranges) -> List[Tuple[int, int]]:
        """Ranges of `text` (UTF-8 bytes) as ranges (start, end) of its lines: each line a range is on, or an empty
        range is at."""
        starts, at = [], 0
        for line in text.splitlines(True):
            starts.append(at)
            at += len(line.encode("utf-8"))
        if not starts:
            return []
        return [(bisect.bisect_right(starts, a) - 1, bisect.bisect_right(starts, max(a, b - 1))) for a, b in ranges]

    def clear_zone(self) -> dict:
        """The conflict zone cleared: its lines the file's to change, as any other."""
        with self.lock:
            self.zone = []
            self._restate()
            return self.state()

    def state(self) -> dict:
        raw = str(self.text).encode("utf-8")
        return {"dirty": self.dirty, "missing": self.missing, "error": self.error, "changed": self.changed,
                "saved": self.saved, "pages": len(self.conns), "now": time.time(),
                "conflicts": [{"id": c.id, "from": _utf16(raw, c.start), "to": _utf16(raw, c.end), "base": c.base,
                               "theirs": c.theirs, "at": c.at, "since": c.since, "zone": c.zone, "agent": c.agent,
                               "asked": c.asked} for c in sorted(self.conflicts.values(), key=lambda c: c.start)],
                "asking": self._asking(),
                "zone": [[_utf16(raw, a), _utf16(raw, b)] for a, b in self.zone],
                "marks": [{"from": _utf16(raw, a), "to": _utf16(raw, b), "gatherer": g, "channel": c}
                          for a, b, g, c in self.marks if b > a]}

    def _send(self, name: str, value, but: Optional[str] = None) -> None:
        for conn in list(self.conns.values()):
            if conn.id != but:
                conn.queue.put((name, value))

    def _restate(self) -> None:
        text = str(self.text)
        raw = text.encode("utf-8")
        for c in list(self.conflicts.values()):     # made the file's by hand: settled
            if raw[c.start:c.end].decode("utf-8", errors="replace") == c.theirs:
                del self.conflicts[c.id]
        self.dirty = text != self.disk
        self._send("state", self.state())

    def _asking(self) -> bool:
        """Whether a page with the file open asks about each change on disk (`hold`), not merging it in."""
        return any(c.hold == "ask" for c in self.conns.values())

    def hold(self, cid: str, how: str) -> dict:
        """How the page `cid` takes the file's changes on disk from now: HOLDS."""
        if how not in HOLDS:
            raise DocError(f"hold {how!r}: {', '.join(HOLDS)}")
        with self.lock:
            conn = self.conns.get(cid)
            if conn is None:
                raise DocError("this page has the file open no more: open it again")
            conn.hold = how
            self._restate()
            return self.state()

    def join(self, cid: str, client: int, hold: str = "merge") -> Conn:
        if hold not in HOLDS:
            raise DocError(f"hold {hold!r}: {', '.join(HOLDS)}")
        with self.lock:
            old = self.conns.pop(cid, None)
            if old is not None:                     # the page's stream again (it reconnected): the old one ends
                old.queue.put(None)
            conn = Conn(cid, client, hold)
            conn.queue.put(("init", {"epoch": self.epoch, "update": b64(self.doc.get_update()),
                                     "sv": b64(self.doc.get_state()), "state": None,
                                     "aware": [b64(c.aware) for c in self.conns.values() if c.aware]}))
            self.conns[cid], self.idle_since = conn, None
            self._restate()
            return conn

    def leave(self, conn: Conn) -> None:
        with self.lock:
            if self.conns.get(conn.id) is not conn:
                return
            del self.conns[conn.id]
            self._send("left", {"client": conn.client})
            self._restate()
            if not self.conns:
                self.idle_since = time.time()

    def edit(self, cid: str, update: bytes) -> dict:
        with self.lock:
            self._from_page = True
            try:
                self.doc.apply_update(update)
            finally:
                self._from_page = False
            self._send("update", {"update": b64(update)}, but=cid)
            self._restate()
            return self.state()

    def aware(self, cid: str, update: bytes) -> None:
        with self.lock:
            conn = self.conns.get(cid)
            if conn is None:
                raise DocError("this page has the file open no more: open it again")
            conn.aware = update
            self._send("aware", {"update": b64(update)}, but=cid)

    def check(self) -> None:
        """Take in the file's change on disk, if it has one."""
        with self.lock:
            try:
                sig = _signature(os.stat(self.path))
            except FileNotFoundError:
                if not self.missing:
                    self.missing = True
                    self._restate()
                return
            if sig == self.sig and not self.missing:
                return
            try:
                text, sig = read(self.path)
            except _Changing:
                return                              # being written: the next look
            except (DocError, OSError) as exc:   # no longer text, or too large: kept as it was here
                self.sig, self.error = sig, str(exc)
                self._restate()
                return
            self.missing, self.error, self.sig = False, "", sig
            if text == self.disk:
                return self._restate()
            mine = str(self.text)
            ours = [c for c in self.conflicts.values() if c.agent is None]     # the disk's (a branch's are branches.py's)
            asking = self._asking()                 # every line guarded: each change asked about
            guard = [(-1, len(mine.splitlines(True)) + 1)] if asking else self._lines(mine, self.zone)
            merged, found, _ = merge(self.disk, mine, text, guard,
                                     self._lines(mine, [(c.start, c.end) for c in ours]))
            if merged != mine:
                before = self.doc.get_state()
                change(self.text, merged)
                self._send("update", {"update": b64(self.doc.get_update(before)), "disk": True})
            raw = merged.encode("utf-8")
            for start, end, was, theirs, zone in found:
                b0 = len(merged[:start].encode("utf-8"))
                b1 = b0 + len(merged[start:end].encode("utf-8"))
                since = time.time()
                for old in [c for c in self.conflicts.values() if c.agent is None]:   # the same lines' conflict
                    if old.start <= b1 and b0 <= old.end:                           # before: this one in its place
                        since = min(since, old.since)
                        del self.conflicts[old.id]
                c = Conflict(b0, b1, was, theirs, zone and not asking, since, asked=asking)
                if raw[b0:b1].decode("utf-8") != theirs:
                    self.conflicts[c.id] = c
            self.disk, self.changed = text, time.time()
            self._restate()

    def settle(self, conflict: str, take: str, text: Optional[str] = None, theirs: Optional[str] = None,
               mine: Optional[str] = None) -> dict:
        """A conflict settled: the pages' lines kept (`mine`), the file's in their place (`theirs`), or the file's
        after them (`both`) -- or `text`, which a page made of the file's lines in its box, in their place (`edited`;
        `theirs` and `mine`: the file's lines and the pages' it began from, as `settling` says)."""
        with self.lock:
            c = self.settling(conflict, take, text, theirs, mine)
            raw = str(self.text).encode("utf-8")
            here = raw[c.start:c.end].decode("utf-8", "replace")
            if _put_by(c, why="approve") and take in ("theirs", "both") and here != c.base:
                raise DocError("these lines changed since it was proposed: reject it, or Edit it in its box")
            # what the file on disk has here now: the file's lines, where it asked; else the document's
            before = (raw[:c.start] + c.theirs.encode("utf-8") + raw[c.end:]).decode("utf-8") if c.asked \
                else raw.decode("utf-8")
            del self.conflicts[c.id]
            self.take(c, take, text)
            if c.asked or _put_by(c):               # the lines it settles as, written to the file
                self._put_disk(before, str(self.text))
            self._restate()
            return self.state()

    def settling(self, conflict: str, take: str, text: Optional[str] = None, theirs: Optional[str] = None,
                 mine: Optional[str] = None) -> Conflict:
        """The conflict `take` may settle. Edited (`text`), only if the file's lines are still those the page began
        from (`theirs`) -- not changed again on disk, or on its branch, meanwhile -- and the pages' lines too (`mine`):
        else the page is to look again, not to put its lines over what it did not see."""
        if take not in TAKES:
            raise DocError(f"take {take!r}: {', '.join(TAKES)}")
        c = self.conflicts.get(conflict)
        if c is None:
            raise DocError("that conflict is settled already")
        if take == "edited":
            if not isinstance(text, str):
                raise DocError("edited: the lines, please")
            if theirs is not None and theirs != c.theirs:
                raise DocError("its lines changed again since you began editing them: look at them again")
            if mine is not None and mine != str(self.text).encode("utf-8")[c.start:c.end].decode("utf-8", "replace"):
                raise DocError("your lines changed since you began editing its: look at them again")
        return c

    def _replace(self, c: Conflict, text: str) -> None:
        """`c`'s lines in the document made `text` -- sent to every page -- the other conflicts where they were (one at
        either edge is not this one's to grow)."""
        start, end, n = c.start, c.end, len(text.encode("utf-8"))
        others = {o.id: (o.start, o.end) for o in self.conflicts.values() if o is not c}
        before = self.doc.get_state()
        if end > start:
            del self.text[start:end]
        if text:
            self.text.insert(start, text)
        c.start, c.end, shift = start, start + n, n - (end - start)
        for o in self.conflicts.values():
            if o.id in others:
                a, b = others[o.id]
                o.start, o.end = (a, b) if b <= start else (a + shift, b + shift) if a >= end else (o.start, o.end)
        self._send("update", {"update": b64(self.doc.get_update(before))})

    def take(self, c: Conflict, take: str, text: Optional[str] = None) -> None:
        """What settling `c` puts in the document: nothing (`mine`), its lines in place of the pages' (`theirs`), or
        after them (`both`), or `text` in place of the pages' (`edited`: the pages' lines now, the conflict zone's) --
        sent to every page."""
        if take == "edited":
            self._unzone(c.start, c.end)
            self._replace(c, text or "")
            self.zone.append([c.start, c.end])
            self._join_zone()
            return
        if take == "mine":
            return
        before = self.doc.get_state()
        if take == "theirs":
            if c.end > c.start:
                del self.text[c.start:c.end]
            if c.theirs:
                self.text.insert(c.start, c.theirs)
        elif c.theirs:
            mine = str(self.text).encode("utf-8")[c.start:c.end]
            self.text.insert(c.end, ("\n" if mine and not mine.endswith(b"\n") else "") + c.theirs)
        self._send("update", {"update": b64(self.doc.get_update(before))})

    def view(self, channel: Optional[str] = None) -> str:
        """The text as the actor `channel` would have it: its proposals (Room.put's) in, each in place of its lines."""
        with self.lock:
            raw = str(self.text).encode("utf-8")
            out, at = [], 0
            if channel:
                for c in sorted((c for c in self.conflicts.values() if _put_by(c, channel, "approve")),
                                key=lambda c: c.start):
                    if c.start < at:                # (they never overlap: one actor's are made together)
                        continue
                    out += [raw[at:c.start], c.theirs.encode("utf-8")]
                    at = c.end
            return b"".join(out + [raw[at:]]).decode("utf-8")

    def put(self, seen: str, wanted: str, by: dict, how: str) -> dict:
        """An actor's change, `wanted` -- the whole text as it wants it -- made of `seen` (what it read: `view`,
        its proposals in, for "propose"), put in as `how` says (PUTS; module doc). Where the text changed meanwhile, its
        change is merged onto it; where they meet, refused. `by`: who it is, as the app says ({gatherer, channel, ...}),
        kept on what is held. -> {landed: lines changed, held: [conflict ids], proposed: [ids], state}."""
        if how not in PUTS:
            raise DocError(f"how {how!r}: {', '.join(PUTS)}")
        if not isinstance(by, dict) or not by.get("channel"):
            raise DocError("who is changing it? (by: {channel, ...})")
        channel = by["channel"]
        with self.lock:
            self.check()                            # the file's own change first
            now = self.view(channel) if how == "propose" else str(self.text)
            if now != seen:
                wanted, found, _ = merge(seen, now, wanted)
                if found:
                    raise DocError("the file changed where you are changing it, since you read it: read it again")
            doc = str(self.text)
            if how == "propose":
                return self._propose(doc, wanted, by)
            lines, want = doc.splitlines(True), wanted.splitlines(True)
            guard = self._lines(doc, self.zone)
            held_at = self._lines(doc, [(c.start, c.end) for c in self.conflicts.values()])
            out: List[str] = []
            spots: List[tuple] = []                 # (landed?, start line, end line in out, base, theirs)
            at = 0
            for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, lines, want, autojunk=False).get_opcodes():
                if tag == "equal":
                    continue
                out += lines[at:i1]
                base, new = lines[i1:i2], want[j1:j2]
                if _guarded(i1, i2, guard) or _meets(i1, i2, held_at):     # lines the pages are editing: theirs to say
                    spots.append((False, len(out), len(out) + len(base), "".join(base), "".join(new)))
                    out += base
                else:
                    spots.append((True, len(out), len(out) + len(new), "".join(base), "".join(new)))
                    out += new
                at = i2
            out += lines[at:]
            landed = "".join(out)
            starts = [0]
            for line in out:
                starts.append(starts[-1] + len(line.encode("utf-8")))
            if landed != doc:
                before = self.doc.get_state()
                change(self.text, landed)
                self._send("update", {"update": b64(self.doc.get_update(before)), "by": channel})
            self.marks = [m for m in self.marks if (m[2], m[3]) != (by.get("gatherer"), channel)]
            held = []
            for ok, a, b, base, theirs in spots:
                if ok:
                    if b > a:                       # what it put in, in its hue
                        self.marks.append([starts[a], starts[b], by.get("gatherer"), channel])
                    continue
                c = Conflict(starts[a], starts[b], base, theirs, True, agent={**by, "put": True, "why": "zone"})
                self.conflicts[c.id] = c
                held.append(c.id)
            if landed != doc:
                self._put_disk(doc, landed)
            self._restate()
            return {"landed": sum(1 for s in spots if s[0]), "held": held, "proposed": [], "state": self.state()}

    def _propose(self, doc: str, wanted: str, by: dict) -> dict:
        """`wanted`, the actor's text, as its proposals: each change from the document, its lines whole -- in place of
        those it had (one alike to one before keeps its id)."""
        channel = by["channel"]
        old = {(c.base, c.theirs, c.start): c for c in self.conflicts.values() if _put_by(c, channel, "approve")}
        lines, want = doc.splitlines(True), wanted.splitlines(True)
        starts = [0]
        for line in lines:
            starts.append(starts[-1] + len(line.encode("utf-8")))
        made = []
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, lines, want, autojunk=False).get_opcodes():
            if tag == "equal":
                continue
            base, theirs = "".join(lines[i1:i2]), "".join(want[j1:j2])
            was = old.pop((base, theirs, starts[i1]), None)
            made.append(was or Conflict(starts[i1], starts[i2], base, theirs, agent={**by, "put": True,
                                                                                     "why": "approve"}))
        for c in old.values():
            del self.conflicts[c.id]
        for c in made:
            self.conflicts[c.id] = c
        self._restate()
        return {"landed": 0, "held": [], "proposed": [c.id for c in made], "state": self.state()}

    def _put_disk(self, before: str, after: str) -> bool:
        """The change from `before` to `after` (the document's) written to the file, onto what it has -- the lines
        the pages typed and did not save left out. False, nothing written, where the change meets those: the next
        save writes it."""
        for _ in range(3):
            merged, found, _ = merge(before, self.disk, after)
            if found:
                return False
            if merged == self.disk:
                return True
            sig = self._write(merged)
            if sig is not None:
                self.disk, self.sig, self.missing = merged, sig, False
                return True
            self.check()                            # changed on disk meanwhile: taken in, and again
        return False

    def save(self) -> dict:
        with self.lock:
            shown = set(self.conflicts)
            for _ in range(3):
                self.check()                        # the file's own change first, merged in
                if set(self.conflicts) - shown:     # where it was edited here too: shown, not saved over
                    raise DocError("The file changed on disk where it was edited here: see the conflicts, then save.")
                text = str(self.text)
                sig = self._write(text)
                if sig is not None:
                    break
            else:
                raise DocError("the file keeps changing on disk: save again in a moment")
            self.disk, self.sig = text, sig
            for c in [c for c in self.conflicts.values() if c.agent is None]:
                del self.conflicts[c.id]            # those shown: settled as the lines kept here (a branch's wait)
            self.missing, self.error, self.saved = False, "", time.time()
            self._restate()
            return self.state()

    def _write(self, text: str) -> Optional[tuple]:
        """`text` written in place of the file; None, and nothing written, if the file changed since it was last
        looked at."""
        try:
            mode = stat.S_IMODE(os.stat(self.path).st_mode)
        except FileNotFoundError:
            mode = 0o644
        fd, temp = tempfile.mkstemp(prefix="." + os.path.basename(self.path) + ".", suffix=TEMP,
                                    dir=os.path.dirname(self.path))
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(text.encode("utf-8"))
            os.chmod(temp, mode)
            try:
                now = _signature(os.stat(self.path))
            except FileNotFoundError:
                now = None
            if now != (None if self.missing else self.sig):
                os.unlink(temp)
                return None
            os.replace(temp, self.path)
        except BaseException:
            if os.path.exists(temp):
                os.unlink(temp)
            raise
        return _signature(os.stat(self.path))


class LiveDocs:
    """Every file open for editing, each looked at on disk every POLL seconds while it is open."""

    def __init__(self, poll: Optional[float] = None):
        self.rooms: Dict[str, Room] = {}
        self.branches = None                        # the actors' branches (branches.py's Branches), when the server has them
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.poll = POLL if poll is None else poll
        self.thread = threading.Thread(target=self._watch, name="live-docs", daemon=True)
        self.thread.start()

    def _room(self, path: str, root: str, create: bool = False) -> Room:
        if not AVAILABLE:
            raise DocError("files shared live need pycrdt: pip install pycrdt")
        real = resolve(path, root)
        with self.lock:
            room = self.rooms.get(real)
            if room is None:
                if not create:
                    raise DocError(f"{path} is not open: open it again")
                for _ in range(5):
                    try:
                        room = self.rooms[real] = Room(real)
                        break
                    except _Changing:
                        time.sleep(0.05)
                else:
                    raise DocError(f"{path} keeps changing on disk: open it again in a moment")
                if self.branches is not None:       # its branches' changes to it, shown in it
                    self.branches.opened(real)
            return room

    def join(self, path: str, root: str, cid: str, client: int, hold: str = "merge") -> Tuple[Room, Conn]:
        if not cid:
            raise DocError("a connection id, please")
        room = self._room(path, root, create=True)
        return room, room.join(cid, client, hold)

    def open_room(self, path: str, root: str) -> Optional[Room]:
        """The file's document, if a page has it open now; else None."""
        if not AVAILABLE:
            return None
        room = self.rooms.get(resolve(path, root))
        return room if room is not None and room.conns else None

    def hold(self, path: str, root: str, cid: str, how: str) -> dict:
        return self._room(path, root).hold(cid, how)

    def state(self, path: str, root: str) -> dict:
        room = self._room(path, root)
        with room.lock:
            return room.state()

    def view(self, path: str, root: str, channel: Optional[str] = None) -> str:
        return self._room(path, root).view(channel)

    def put(self, path: str, root: str, seen: str, wanted: str, by: dict, how: str) -> dict:
        return self._room(path, root).put(seen, wanted, by, how)

    def edit(self, path: str, root: str, cid: str, update: bytes) -> dict:
        return self._room(path, root).edit(cid, update)

    def aware(self, path: str, root: str, cid: str, update: bytes) -> None:
        self._room(path, root).aware(cid, update)

    def save(self, path: str, root: str) -> dict:
        return self._room(path, root).save()

    def settle(self, path: str, root: str, conflict: str, take: str, text: Optional[str] = None,
               theirs: Optional[str] = None, mine: Optional[str] = None) -> dict:
        room = self._room(path, root)
        c = room.conflicts.get(conflict)
        if c is not None and c.agent is not None and c.agent.get("branch") and self.branches is not None:
            return self.branches.settle(room, c, take, text, theirs, mine)   # its branch's base moved on too
        return room.settle(conflict, take, text, theirs, mine)

    def clear_zone(self, path: str, root: str) -> dict:
        return self._room(path, root).clear_zone()

    def listing(self, directory: str, root: str) -> dict:
        """The directory's entries -- folders first, then files, by name -- each with whether pages edit it now,
        whether it has changes no one saved, the actors that changed it lately (`writers`), and the actors whose
        changes to it wait for the reader (`waiting`: [{gatherer, channel}]; `_waiting`) -- a folder's: of the files in
        it, all the way down."""
        real = resolve(directory, root)
        entries, more = [], False
        try:
            with os.scandir(real) as found:
                for entry in found:
                    if entry.name in SKIPPED or entry.name.endswith(TEMP):
                        continue
                    if len(entries) >= MAX_ENTRIES:
                        more = True
                        break
                    try:
                        is_dir, st = entry.is_dir(), entry.stat()
                    except OSError:                 # a link to nothing
                        continue
                    room = self.rooms.get(os.path.realpath(entry.path) if entry.is_symlink() else entry.path)
                    entries.append({"name": entry.name, "dir": is_dir, "size": st.st_size, "mtime": st.st_mtime,
                                    "pages": len(room.conns) if room else 0, "dirty": bool(room and room.dirty),
                                    "conflicts": sum(c.agent is None for c in room.conflicts.values()) if room else 0,
                                    "pending": self.branches.pending(os.path.join(real, entry.name), is_dir)
                                    if self.branches is not None else 0})
        except (FileNotFoundError, NotADirectoryError):
            raise DocError(f"{directory} is not a directory") from None
        except PermissionError:
            raise DocError(f"{directory} may not be read") from None
        found: Dict[str, List[dict]] = {}           # by entry: its own writers, or those of what is in it
        changed = writers([real, os.path.abspath(directory)], time.time() - RECENT)
        for rel, ws in changed.items():
            found.setdefault(rel.split("/")[0], []).extend(ws)
        waiting = self._waiting(real, changed)
        for e in entries:
            e["writers"] = _latest(found.get(e["name"], []))
            held = self.branches.waiting(os.path.join(real, e["name"]), e["dir"]) if e["pending"] else set()
            e["waiting"] = [{"gatherer": g, "channel": c} for g, c in sorted(waiting.get(e["name"], set()) | held)]
        entries.sort(key=lambda e: (not e["dir"], e["name"].lower()))
        return {"dir": directory, "entries": entries, "more": more, "now": time.time(), "user": _user(),
                "home": os.path.expanduser("~")}

    def _waiting(self, real: str, changed: Dict[str, List[dict]]) -> Dict[str, set]:
        """By entry of the directory `real`: the actors (gatherer, channel) with a change to a file open here (it, or
        one in it) that waits for the reader -- one of their branch's, or put in through an app and not taken in yet (a
        proposal, or lines the pages are editing: Room.put); or one to lines the pages changed too, a conflict not
        settled: every actor whose change to the file (`changed`: `writers`, by its path from `real`) is recorded from
        the conflict's start on. (A branch's changes held in files not open: `branches.waiting`.)"""
        top, out = real.rstrip("/") + "/", {}
        for path, room in list(self.rooms.items()):
            if not path.startswith(top):
                continue
            rel = path[len(top):]
            for c in list(room.conflicts.values()):
                if c.agent is not None:
                    whose = [(c.agent.get("gatherer"), c.agent.get("channel"))]
                else:
                    whose = [(w["gatherer"], w["channel"]) for w in changed.get(rel, []) if w["at"] >= c.since - CREDIT]
                out.setdefault(rel.split("/")[0], set()).update(k for k in whose if k[0] and k[1])
        return out

    def _watch(self) -> None:
        while not self.stop.wait(self.poll):
            self.look()

    def look(self) -> None:
        """Each open file looked at: its change on disk taken in; with no page left, its conflict zone cleared, and the
        file closed if nothing in it is unsaved."""
        for real, room in list(self.rooms.items()):
            try:
                room.check()
            except Exception:                       # noqa: BLE001 - the next look; the page keeps what it has
                pass
            with self.lock, room.lock:
                idle = None if room.idle_since is None else time.time() - room.idle_since
                if idle is not None and idle > ZONE_GRACE and room.zone:
                    room.zone = []                  # its pages closed it
                if idle is not None and not room.dirty and idle > LINGER:
                    self.rooms.pop(real, None)

    def close(self) -> None:
        self.stop.set()
        for room in list(self.rooms.values()):
            for conn in list(room.conns.values()):
                conn.queue.put(None)


def _user() -> str:
    try:
        return getpass.getuser()
    except Exception:                               # noqa: BLE001 - no name to give
        return ""
