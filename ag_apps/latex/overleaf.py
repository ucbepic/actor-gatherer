"""Overleaf, for the LaTeX editor: who changed a paper's lines there -- a co-author typing on overleaf.com, or editing
their own Dropbox copy -- when the paper's folder is synced with an Overleaf project (Overleaf's Dropbox sync: the folder
Dropbox/Apps/Overleaf/<project>), and so changes on disk with no actor's name on them.

    Account        the user's Overleaf sign-in: its session cookie, kept in the app's data folder (readable by the user
                   alone), taken from a Chrome window they sign in in (app_kit.signin: any way Overleaf lets them -- a
                   password, Google, their institution); `get` a page of the site as them, SignedOut when it lapsed
    project_root   the folder of a Dropbox-synced project a path is in, and the project's name
    History        a project's history, read through the endpoints Overleaf's own History panel reads (not a
                   published API: they may change): its updates (versions close in time merged, with everyone who
                   made them), its changes (each version alone: who made it, and what it did to which file), a file's
                   diff over versions -- each piece of text inserted or deleted with who and when -- and its text at
                   one
    attribute      a diff's pieces placed on the lines of the file as it is here: those made by others than the user's
                   own Dropbox (their edits from this machine -- theirs, or their actors', whom ag names itself)
    replaced       the same for a file put in whole: a Dropbox copy saved whole (an editor, or an agent, writing the
                   file anew) reaches Overleaf as the file removed and added again, which its diff shows as unchanged,
                   naming no one -- its lines compared here, before and after, and the changed ones credited

Git (Overleaf's git integration) cannot say this: it makes one commit for whatever changed since the last fetch,
credited to whoever changed it last (checked on a real project: the whole paper, one person's)."""

import difflib
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, List, Optional, Tuple

from app_kit import signin

SITE = "https://www.overleaf.com"
COOKIE = "overleaf_session2"
AGENT = "ag-latex-editor"
TIMEOUT = 20.0              # seconds a request to Overleaf is waited for
FRESH = 10.0                # seconds a project's updates are kept before they are asked for again
PROJECTS_FRESH = 300.0      # seconds the user's projects (to find one by name) are kept
PAGES = 6                   # the most pages of updates read back for one window (each at least 40 versions)
CHANGE_PAGES = 5            # the most pages of changes read for one window (each up to 2000)
TEXTS = 400                 # the most files' texts at a version kept (a version's text never changes)
AT_ONCE = 6                 # texts asked for at once
LINE_TEXT = 300             # the most characters of a piece's text kept for its line
DROPBOX_TOP = re.compile(r"/Apps/Overleaf/([^/]+)")


class SignedOut(Exception):
    """Overleaf no longer takes the sign-in kept (it lapsed, or the user signed out there): to be signed in again."""


class OverleafError(Exception):
    """Overleaf answered, but not as expected: what it said."""


def _quote(path: str) -> str:
    return urllib.parse.quote(path, safe="/")


def project_root(path: str) -> Optional[Tuple[str, str]]:
    """(the project's folder, its name) when `path` is in a folder Overleaf's Dropbox sync keeps
    (…/Dropbox/Apps/Overleaf/<name>/…); None, not."""
    real = os.path.realpath(path)
    m = DROPBOX_TOP.search(real)
    if not m:
        return None
    return real[:m.end()], m.group(1)


class Account:
    """The user's Overleaf sign-in, kept in `folder` (overleaf.json: {cookie, user_id, email, at}) -- and the window
    they sign in in, while it is open (`signing`), its profile kept beside it (so Overleaf may remember them)."""

    def __init__(self, folder: str):
        self.folder = folder
        self.path = os.path.join(folder, "overleaf.json")
        self.profile = os.path.join(folder, "overleaf-signin")
        self.lock = threading.Lock()
        self.signing: Optional[signin.SignIn] = None
        self._projects: Tuple[float, List[dict]] = (0.0, [])

    # -- the sign-in kept

    def kept(self) -> Optional[dict]:
        try:
            with open(self.path) as fh:
                got = json.load(fh)
        except (OSError, ValueError):
            return None
        return got if isinstance(got, dict) and got.get("cookie") else None

    def _keep(self, got: dict) -> None:
        os.makedirs(self.folder, exist_ok=True)
        fd = os.open(self.path + ".new", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh:
            json.dump(got, fh)
        os.replace(self.path + ".new", self.path)

    def sign_out(self) -> None:
        """The sign-in forgotten here (Overleaf's session itself left as it is)."""
        with self.lock:
            self._projects = (0.0, [])
            try:
                os.remove(self.path)
            except FileNotFoundError:
                pass

    # -- signing in

    def sign_in(self) -> dict:
        """A Chrome window opened on Overleaf's sign-in (one at a time): the session taken from it once the user is
        in, and kept. -> its view."""
        with self.lock:
            if self.signing is not None and self.signing.state == "open":
                return self.signing.view()
            self.signing = signin.SignIn(f"{SITE}/login", self.profile, self._signed_in, domain="overleaf.com")
        try:
            self.signing.start()
        except signin.SignInError as exc:
            self.signing.state, self.signing.error = "failed", str(exc)
        return self.signing.view()

    def _signed_in(self, cookies: List[dict]) -> Optional[dict]:
        """SignIn's check: the window's session, if Overleaf takes it as a user's -- kept, and the user's."""
        value = next((c.get("value") for c in cookies if c.get("name") == COOKIE and c.get("value")), None)
        if not value:
            return None
        who = self.whoami(value)
        if who is None:
            return None                             # a visitor's session: not signed in yet
        got = {"cookie": value, **who, "at": time.time()}
        with self.lock:
            self._keep(got)
            self._projects = (0.0, [])
        return who

    def cancel(self) -> None:
        with self.lock:
            s = self.signing
        if s is not None:
            s.close()

    def view(self) -> dict:
        """What the panel is told: who is signed in (None: no one), and the window, while signing in."""
        kept = self.kept()
        s = self.signing
        return {"signed_in": {"email": kept.get("email", ""), "user_id": kept.get("user_id", "")} if kept else None,
                "signing": s.view() if s is not None and s.state != "done" else None}

    # -- the site, as the user

    def get(self, path: str, accept: str = "application/json", cookie: Optional[str] = None):
        """A page of Overleaf, as the user: (its content type, its body). SignedOut, it took us for a visitor."""
        if cookie is None:
            kept = self.kept()
            if kept is None:
                raise SignedOut("not signed in to Overleaf")
            cookie = kept["cookie"]
        req = urllib.request.Request(SITE + path, headers={"Cookie": f"{COOKIE}={cookie}", "Accept": accept,
                                                           "User-Agent": AGENT})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                if "/login" in urllib.parse.urlparse(r.geturl()).path:
                    raise SignedOut("Overleaf asked to sign in again")
                return r.headers.get("content-type") or "", r.read()
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise SignedOut(f"Overleaf refused ({exc.code})") from None
            raise OverleafError(f"Overleaf answered {exc.code} for {path.split('?')[0]}") from None
        except (urllib.error.URLError, OSError) as exc:
            raise OverleafError(f"Overleaf could not be reached: {getattr(exc, 'reason', exc)}") from None

    def json(self, path: str):
        kind, body = self.get(path)
        if "json" not in kind:
            raise SignedOut("Overleaf did not answer as for a signed-in user")
        return json.loads(body)

    def whoami(self, cookie: str) -> Optional[dict]:
        """{user_id, email} of the user the session is of -- None, a visitor's -- from Overleaf's projects page."""
        try:
            kind, body = self.get("/project", "text/html", cookie=cookie)
        except (SignedOut, OverleafError):
            return None
        page = body.decode("utf-8", "replace")
        found = {k: re.search(rf'<meta\s+name="{k}"[^>]*content="([^"]*)"', page) for k in ("ol-user_id", "ol-usersEmail")}
        if not found["ol-user_id"]:
            return None
        return {"user_id": found["ol-user_id"].group(1),
                "email": found["ol-usersEmail"].group(1) if found["ol-usersEmail"] else ""}

    def projects(self) -> List[dict]:
        """The user's projects: [{id, name}] (kept PROJECTS_FRESH seconds)."""
        at, got = self._projects
        if time.time() - at < PROJECTS_FRESH and got:
            return got
        got = [{"id": p.get("_id") or p.get("id"), "name": p.get("name") or ""}
               for p in self.json("/user/projects").get("projects", [])]
        self._projects = (time.time(), got)
        return got

    def find(self, name: str) -> Optional[dict]:
        """The user's project called `name` (as its Dropbox folder is) -- one only, else None."""
        ps = self.projects()
        same = [p for p in ps if p["name"] == name] or [p for p in ps if p["name"].lower() == name.lower()]
        return same[0] if len(same) == 1 else None


class History:
    """A project's history, as the user reads it: its updates (kept FRESH seconds), its changes (from a version on: the
    new ones asked for, past FRESH seconds), files' diffs (by version) and texts (by version)."""

    def __init__(self, account: Account):
        self.account = account
        self.lock = threading.Lock()
        self.updates_of: Dict[str, Tuple[float, float, List[dict]]] = {}   # project -> (read at, back to, updates)
        self.changes_of: Dict[str, Tuple[float, int, List[dict]]] = {}     # project -> (read at, from version, changes)
        self.diffs: Dict[tuple, list] = {}
        self.texts: Dict[tuple, Optional[str]] = {}
        self.reading = threading.Lock()             # one window's texts read at a time: a second ask finds them kept

    def updates(self, project: str, since: float) -> List[dict]:
        """The project's updates, the latest first, back to `since` (seconds) at least -- each {fromV, toV, meta:
        {users: [{id, first_name, last_name, email}], start_ts, end_ts (ms), origin}, pathnames, project_ops}:
        the changes of a while merged, with everyone who made any of them."""
        with self.lock:
            at, back, got = self.updates_of.get(project, (0.0, 0.0, []))
        if time.time() - at < FRESH and back <= since:
            return got
        got, before = [], None
        for _ in range(PAGES):
            page = self.account.json(f"/project/{project}/updates?min_count=40"
                                     + (f"&before={before}" if before else ""))
            got += page.get("updates", [])
            before = page.get("nextBeforeTimestamp")
            if not before or not got or got[-1]["meta"]["end_ts"] / 1000 < since:
                break
        with self.lock:
            self.updates_of[project] = (time.time(), since, got)
        return got

    def changes(self, project: str, start: int) -> List[Tuple[int, dict]]:
        """The project's changes from version `start` to its latest, the oldest first, each with its version (the one
        it was made on: it made the next) -- each {operations: [{pathname, textOperation | file (added) | newPathname
        ("" removed, else renamed)}], v2Authors: [user id], timestamp (ISO), origin}: one by one, each with who made
        it. Those kept from an earlier ask are not asked for again (a version's change never changes): only the new."""
        with self.lock:
            at, first, got = self.changes_of.get(project, (0.0, 0, []))
        if not got or first > start:
            first, got, at = start, [], 0.0
        if time.time() - at >= FRESH:
            new: List[dict] = []
            for _ in range(CHANGE_PAGES):
                page = self.account.json(f"/project/{project}/changes?since={first + len(got) + len(new)}")
                new += page.get("changes") or []
                if not page.get("hasMore") or not page.get("changes"):
                    break
            got = got + new
            if start > first:                        # what this window no longer needs, let go
                got, first = got[start - first:], start
            with self.lock:
                self.changes_of[project] = (time.time(), first, got)
        return [(first + k, c) for k, c in enumerate(got) if first + k >= start]

    def diff(self, project: str, pathname: str, start: int, end: int) -> list:
        """The file's diff from version `start` to `end`: [{u | i | d: text, meta?}] in its order."""
        key = (project, pathname, start, end)
        with self.lock:
            if key in self.diffs:
                return self.diffs[key]
        got = self.account.json(f"/project/{project}/diff?pathname={urllib.parse.quote(pathname)}"
                                f"&from={start}&to={end}").get("diff", [])
        with self.lock:
            if len(self.diffs) > 200:
                self.diffs.clear()
            self.diffs[key] = got
        return got

    def text(self, project: str, pathname: str, version: int) -> Optional[str]:
        """The file's text at `version` (its diff from it to itself), None: Overleaf had none then, or not as text (it
        keeps some versions of a text file as binary: {"binary": true}), or said nothing."""
        key = (project, pathname, version)
        with self.lock:
            if key in self.texts:
                return self.texts[key]
        try:
            got = self.account.json(f"/project/{project}/diff?pathname={urllib.parse.quote(pathname)}"
                                    f"&from={version}&to={version}").get("diff", [])
        except OverleafError:
            return None
        text = ("".join(str(part.get("u", "")) + str(part.get("i", "")) for part in got)
                if isinstance(got, list) and all(isinstance(part, dict) for part in got) else None)
        with self.lock:
            while len(self.texts) >= TEXTS:
                self.texts.pop(next(iter(self.texts)))          # the oldest kept
            self.texts[key] = text
        return text

    def texts_at(self, project: str, pathname: str, versions) -> Dict[int, Optional[str]]:
        """The file's text at each of `versions`, AT_ONCE asked for at a time."""
        versions = sorted(set(versions))
        with self.reading:
            if len(versions) <= 1:
                return {v: self.text(project, pathname, v) for v in versions}
            with ThreadPoolExecutor(min(AT_ONCE, len(versions))) as pool:
                return dict(zip(versions, pool.map(lambda v: self.text(project, pathname, v), versions)))


def person(u: dict) -> dict:
    """Who, as the panel names them."""
    name = " ".join(x for x in (u.get("first_name"), u.get("last_name")) if x) or (u.get("email") or "").split("@")[0]
    return {"id": u.get("id") or "", "name": name or "Someone", "email": u.get("email") or ""}


def _mine_from_here(meta: dict, me: str) -> bool:
    """A piece the user made through their own Dropbox -- from this machine: theirs, or their actors' (ag names those
    itself) -- not one to name here."""
    users = [u.get("id") if isinstance(u, dict) else u for u in meta.get("users") or []]
    return users == [me] and (meta.get("origin") or {}).get("kind") == "dropbox"


SURE_RUN = 3                # lines alike in a row: where they are in one text is where they are in the other
SURE_LINE = 20              # characters a line alone must have (stripped) to be placed by itself, if no other is like it:
                            # a sentence, not boilerplate (`\centering`, `\toprule`, `\end{table}`)


def _same_lines(there: List[str], here: List[str]) -> Dict[int, int]:
    """Overleaf's line -> the same line here: in a run of SURE_RUN alike, or a line like no other in either text (and
    not a short one) -- never a lone `\\centering`, `}` or blank line that only happens to be alike."""
    count_there, count_here = {}, {}
    for line in there:
        count_there[line] = count_there.get(line, 0) + 1
    for line in here:
        count_here[line] = count_here.get(line, 0) + 1
    got: Dict[int, int] = {}
    for tag, a1, a2, b1, _ in difflib.SequenceMatcher(None, there, here, autojunk=False).get_opcodes():
        if tag != "equal":
            continue
        for k in range(a2 - a1):
            line = there[a1 + k]
            if a2 - a1 >= SURE_RUN or (count_there[line] == 1 and count_here.get(line) == 1
                                         and len(line.strip()) >= SURE_LINE):
                got[a1 + k] = b1 + k
    return got


class _Lines:
    """Lines of the file here (`text`) credited to who changed them on Overleaf: each once -- who made its latest piece
    -- with the pieces begun on it, inserted and deleted."""

    def __init__(self, text: str):
        self.here = text.splitlines(True)
        self.got: Dict[int, dict] = {}

    def credit(self, h: int, who: List[dict], end: float, inserted: List[str] = (), deleted: List[str] = ()) -> None:
        got = self.got.setdefault(h, {"line": h + 1, "text": self.here[h].rstrip("\n")[:LINE_TEXT], "who": who,
                                      "at": end, "inserted": [], "deleted": []})
        if end >= got["at"]:
            got["who"], got["at"] = who, end
        got["inserted"] += [x.strip()[:LINE_TEXT] for x in inserted if x.strip()]
        got["deleted"] += [x.strip()[:LINE_TEXT] for x in deleted if x.strip()]

    def list(self) -> List[dict]:
        return [self.got[k] for k in sorted(self.got)]


def _attribute(lines: _Lines, diff: list, me: str, since: float) -> None:
    """attribute's, into `lines`."""
    overleaf, pieces, at = [], [], 0
    for part in diff:
        if "u" in part:
            overleaf.append(part["u"])
            at += len(part["u"])
        elif "i" in part:
            pieces.append(("i", at, at + len(part["i"]), part["i"], part.get("meta") or {}))
            overleaf.append(part["i"])
            at += len(part["i"])
        elif "d" in part:
            pieces.append(("d", at, at, part["d"], part.get("meta") or {}))
    theirs = "".join(overleaf)
    there = theirs.splitlines(True)
    to_here = _same_lines(there, lines.here)
    starts = [0]
    for line in there:
        starts.append(starts[-1] + len(line))

    def line_at(pos: int) -> int:
        lo, hi = 0, len(there) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if starts[mid] <= pos:
                lo = mid
            else:
                hi = mid - 1
        return max(lo, 0)
    for kind, a, b, piece, meta in pieces:
        end = (meta.get("end_ts") or 0) / 1000
        if end < since or _mine_from_here(meta, me) or not there:
            continue
        who = [person(u) for u in meta.get("users") or [] if isinstance(u, dict)] or [person({})]
        first = line_at(a)
        last = line_at(max(a, b - 1)) if kind == "i" else first
        for n in range(first, last + 1):
            h = to_here.get(n)
            if h is None:
                continue
            said = [piece] if n == first else []
            lines.credit(h, who, end, said if kind == "i" else [], said if kind == "d" else [])


def attribute(diff: list, text: str, me: str, since: float) -> List[dict]:
    """The pieces of `diff` made since `since` (seconds) by others than the user's Dropbox (`me`: their id), placed on
    the lines of `text` (the file as it is here) where the line is as Overleaf has it (_same_lines): [{line
    (1-based), text (the line's, here), who: [person], at (seconds), inserted, deleted (the pieces begun on it, each
    stripped)}], each line once -- who made its latest piece.
    A line that differs here (not synced yet, or edited since) is left out."""
    lines = _Lines(text)
    _attribute(lines, diff, me, since)
    return lines.list()


_WORD = re.compile(r"\s+|\w+|[^\w\s]")


def _words(old: str, new: str) -> Tuple[List[str], List[str]]:
    """(inserted, deleted): the runs of words a line's `new` text has in place of its `old` one."""
    a, b = _WORD.findall(old), _WORD.findall(new)
    ins, dels = [], []
    for tag, a1, a2, b1, b2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag in ("replace", "insert"):
            ins.append("".join(b[b1:b2]))
        if tag in ("replace", "delete"):
            dels.append("".join(a[a1:a2]))
    return ins, dels


def _replaced(lines: _Lines, before: str, after: str, who: List[dict], end: float) -> None:
    """A file put in whole (Overleaf keeps it as removed and added again, its diff naming no one): the lines `after`
    differs from `before` in credited to `who` -- each placed on the line here where it is as `after` has it
    (_same_lines), with the words it has in place of the old line's; lines gone, said on the line after them."""
    old, new = before.splitlines(True), after.splitlines(True)
    if not new:
        return
    to_here = _same_lines(new, lines.here)
    for tag, a1, a2, b1, b2 in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
        if tag == "equal":
            continue
        if tag == "delete":
            h = to_here.get(min(b1, len(new) - 1))
            if h is not None:
                lines.credit(h, who, end, [], ["".join(old[a1:a2])])
            continue
        for k in range(b2 - b1):
            h = to_here.get(b1 + k)
            if h is None:
                continue
            was = old[a1 + k] if tag == "replace" and a1 + k < a2 else ""
            ins, dels = _words(was, new[b1 + k])
            if tag == "replace" and k == b2 - b1 - 1 and a2 - a1 > b2 - b1:    # more lines went than came
                dels.append("".join(old[a1 + k + 1:a2]))
            lines.credit(h, who, end, ins, dels)


# ---- the changes, one by one

def _when(change: dict) -> float:
    """A change's time, in seconds."""
    try:
        return datetime.fromisoformat(str(change.get("timestamp") or "").replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _authors(change: dict) -> List[str]:
    return [str(a) for a in change.get("v2Authors") or change.get("authors") or [] if a]


def _mine_change(change: dict, me: str) -> bool:
    """A change the user made through their own Dropbox -- from this machine (as _mine_from_here)."""
    return _authors(change) == [me] and (change.get("origin") or {}).get("kind") == "dropbox"


def _names(updates: List[dict]) -> Dict[str, dict]:
    """Each user id the updates name -> who they are (person)."""
    got = {}
    for u in updates:
        for user in (u.get("meta") or {}).get("users") or []:
            if isinstance(user, dict) and user.get("id"):
                got[user["id"]] = person(user)
    return got


def _who(change: dict, names: Dict[str, dict]) -> List[dict]:
    return [names.get(a) or {"id": a, "name": "Someone", "email": ""} for a in _authors(change)] or [person({})]


def _start(updates: List[dict], since: float) -> Optional[int]:
    """The version the window begins at: that of the oldest update that ended in it (None: none did)."""
    got = [u["fromV"] for u in updates if (u.get("meta") or {}).get("end_ts", 0) / 1000 >= since]
    return min(got) if got else None


def _changed(change: dict, added: Dict[str, str]) -> List[str]:
    """The files a change changed: edited, added (again, with what it had not: the same file put back unchanged is
    not a change), or renamed to -- not removed (gone, here as there). `added`: each file's text last added (its
    hash), kept as the changes are read in their order."""
    got = []
    for op in change.get("operations") or []:
        path, to = op.get("pathname"), op.get("newPathname")
        if not path:
            continue
        if "textOperation" in op:
            got.append(path)
        elif "file" in op:
            h = (op.get("file") or {}).get("hash")
            if not h or added.get(path) != h:
                got.append(path)
            added[path] = h
        elif to:
            got.append(to)
    return got


def _file_history(changes: List[Tuple[int, dict]], pathname: str, me: str, since: float):
    """The file's changes in the window by others than the user's own Dropbox, as there is to read of them: (runs:
    [(from, to)] versions over which its text was edited in place by one of them -- a diff each, its pieces naming
    who; puts: [(before (the version its old text is at; None: there was none), after, change)], it put in whole)."""
    runs, puts = [], []
    run = None                  # [the version its in-place edits began at, one of them by another in the window]
    gone = None                 # the version its text was at as it was removed, for an add after
    put = None                  # the version its text was at as it was last added, while nothing has changed it since
    added: Dict[str, str] = {}

    def close(v):
        nonlocal run
        if run is not None and run[1]:
            runs.append((run[0], v))
        run = None
    v = None
    for v, c in changes:
        theirs = _when(c) >= since and not _mine_change(c, me)
        for op in c.get("operations") or []:
            path, to = op.get("pathname"), op.get("newPathname")
            if path == pathname and "textOperation" in op:
                if run is None:
                    run = [v, False]
                run[1] = run[1] or theirs
                put = None
            elif path == pathname and to is not None:          # removed, or renamed away
                close(v)
                gone = (put if put is not None else v) if to == "" else None   # the same text: read once
                put = None
            elif path == pathname and "file" in op:            # added (again)
                close(v)
                h = (op.get("file") or {}).get("hash")
                if theirs and (not h or added.get(path) != h):
                    puts.append((gone, v + 1, c))
                added[path] = h
                gone, put = None, v + 1
            elif to == pathname:                               # renamed to it: what it had before, not here to read
                close(v)
                gone = put = None
    if v is not None:
        close(v + 1)
    return runs, puts


def changes(history: History, project: str, root: str, path: str, text: str, me: str, since: float) -> dict:
    """Who changed `path` (a file under the project's folder `root`) on Overleaf since `since`, placed on `text` (the
    file as it is here): {lines: attribute's, people: [{...person, at, lines}] the latest first, version}.
    From the project's changes, one by one: its in-place edits through a diff over each run of them, and each time it
    was put in whole (_replaced) by comparing its texts before and after -- or, if Overleaf will not give its changes,
    from its updates' (in-place edits only)."""
    pathname = os.path.relpath(os.path.realpath(path), os.path.realpath(root))
    if pathname.startswith(".."):
        return {"lines": [], "people": [], "version": None}
    ups = history.updates(project, since)
    if not ups:
        return {"lines": [], "people": [], "version": None}
    head = max(u["toV"] for u in ups)
    start = _start(ups, since)
    if start is None:
        return {"lines": [], "people": [], "version": head}
    lines = _Lines(text)
    try:
        chs = history.changes(project, start)
    except OverleafError:
        chs = None
    if chs is None:
        mine = [u for u in ups if pathname in (u.get("pathnames") or []) and u["meta"]["end_ts"] / 1000 >= since
                and not _mine_from_here(u["meta"], me)]
        if mine:
            _attribute(lines, history.diff(project, pathname, min(u["fromV"] for u in mine), head), me, since)
    else:
        head = max(head, chs[-1][0] + 1) if chs else head
        runs, puts = _file_history(chs, pathname, me, since)
        for a, b in runs:
            _attribute(lines, history.diff(project, pathname, a, b), me, since)
        if puts:
            names = _names(ups)
            texts = history.texts_at(project, pathname, [v for before, after, _ in puts
                                                         for v in (before, after) if v is not None])
            for before, after, c in puts:
                was = "" if before is None else texts.get(before)          # none before: a new file, all of it theirs
                if was is not None and texts.get(after) is not None:      # either not as text: not to be told
                    _replaced(lines, was, texts[after], _who(c, names), _when(c))
    got = lines.list()
    people: Dict[str, dict] = {}
    for line in got:
        for p in line["who"]:
            one = people.setdefault(p["id"] or p["name"], {**p, "at": 0, "lines": 0})
            one["at"], one["lines"] = max(one["at"], line["at"]), one["lines"] + 1
    return {"lines": got, "people": sorted(people.values(), key=lambda p: -p["at"]), "version": head}


def who_changed(history: History, project: str, root: str, me: str, since: float) -> dict:
    """Who changed which of the project's files on Overleaf since `since`: {files: {path here: [{...person, at}] the
    latest first}, people: [{...person, at, path (the file of their latest change), files (how many)}] the latest
    first} -- the user themself only for what they did on overleaf.com, not through their own Dropbox (from this
    machine). A file changed is one edited, added (put in whole: Dropbox's sync of a copy saved whole), or renamed to.
    From the project's changes, one by one, each with who made it -- no diffs. If Overleaf will not give them, from
    its updates: those merge the changes of a while, so each person of one counts for each of its files."""
    files: Dict[str, Dict[str, dict]] = {}

    def credit(pathname: str, p: dict, end: float) -> None:
        got = files.setdefault(os.path.join(root, pathname), {})
        key = p["id"] or p["name"]
        if key not in got or got[key]["at"] < end:
            got[key] = {**p, "at": end}
    ups = history.updates(project, since)
    start = _start(ups, since)
    try:
        chs = history.changes(project, start) if start is not None else []
    except OverleafError:
        chs = None
    if chs is not None:
        names, added = _names(ups), {}
        for _, c in chs:
            paths = _changed(c, added)
            end = _when(c)
            if end < since or _mine_change(c, me):
                continue
            for p in _who(c, names):
                for pathname in paths:
                    credit(pathname, p, end)
    else:
        for u in ups:
            meta = u.get("meta") or {}
            end = (meta.get("end_ts") or 0) / 1000
            if end < since:
                continue
            here = (meta.get("origin") or {}).get("kind") == "dropbox"
            users = [x for x in meta.get("users") or [] if isinstance(x, dict)] or [{}]
            paths = list(u.get("pathnames") or [])
            for op in u.get("project_ops") or []:          # a file added (again) or renamed: its name, not in pathnames
                to = (op.get("add") or {}).get("pathname") or (op.get("rename") or {}).get("newPathname")
                if to and to not in paths:
                    paths.append(to)
            for user in users:
                if here and user.get("id") == me:
                    continue
                for pathname in paths:
                    credit(pathname, person(user), end)
    people: Dict[str, dict] = {}
    for path, by in files.items():
        for key, p in by.items():
            got = people.setdefault(key, {**p, "at": 0, "path": path, "files": 0})
            got["files"] += 1
            if p["at"] > got["at"]:
                got["at"], got["path"] = p["at"], path
    return {"files": {path: sorted(by.values(), key=lambda p: -p["at"]) for path, by in files.items()},
            "people": sorted(people.values(), key=lambda p: -p["at"])}
