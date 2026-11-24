"""Overleaf, for the LaTeX editor: who changed a paper's lines there -- a co-author typing on overleaf.com, or editing
their own Dropbox copy -- when the paper's folder is synced with an Overleaf project (Overleaf's Dropbox sync: the folder
Dropbox/Apps/Overleaf/<project>), and so changes on disk with no actor's name on them.

    Account        the user's Overleaf sign-in: its session cookie, kept in the app's data folder (readable by the user
                   alone), taken from a Chrome window they sign in in (app_kit.signin: any way Overleaf lets them -- a
                   password, Google, their institution); `get` a page of the site as them, SignedOut when it lapsed
    project_root   the folder of a Dropbox-synced project a path is in, and the project's name
    History        a project's history, read through the endpoints Overleaf's own History panel reads (not a
                   published API: they may change): its updates (each version, who made it, when, through what) and
                   a file's diff over them -- each piece of text inserted or deleted with who and when
    attribute      a diff's pieces placed on the lines of the file as it is here: those made by others than the user's
                   own Dropbox (their edits from this machine -- theirs, or their actors', whom ag names itself)

Git (Overleaf's git integration) cannot say this: it makes one commit for whatever changed since the last fetch,
credited to whoever changed it last (checked on a real project: the whole paper, one person's)."""

import difflib
import json
import os
import re
import threading
import time
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
    """A project's history, as the user reads it: its updates (kept FRESH seconds) and files' diffs (by version)."""

    def __init__(self, account: Account):
        self.account = account
        self.lock = threading.Lock()
        self.updates_of: Dict[str, Tuple[float, float, List[dict]]] = {}   # project -> (read at, back to, updates)
        self.diffs: Dict[tuple, list] = {}

    def updates(self, project: str, since: float) -> List[dict]:
        """The project's updates, the latest first, back to `since` (seconds) at least -- each {fromV, toV, meta:
        {users: [{id, first_name, last_name, email}], start_ts, end_ts (ms), origin}, pathnames}."""
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


def person(u: dict) -> dict:
    """Who, as the panel names them."""
    name = " ".join(x for x in (u.get("first_name"), u.get("last_name")) if x) or (u.get("email") or "").split("@")[0]
    return {"id": u.get("id") or "", "name": name or "Someone", "email": u.get("email") or ""}


def _mine_from_here(meta: dict, me: str) -> bool:
    """A piece the user made through their own Dropbox -- from this machine: theirs, or their actors' (ag names those
    itself) -- not one to name here."""
    users = [u.get("id") if isinstance(u, dict) else u for u in meta.get("users") or []]
    return users == [me] and (meta.get("origin") or {}).get("kind") == "dropbox"


def attribute(diff: list, text: str, me: str, since: float) -> List[dict]:
    """The pieces of `diff` made since `since` (seconds) by others than the user's Dropbox (`me`: their id), placed on
    the lines of `text` (the file as it is here) where the line is as Overleaf has it: [{line (1-based), text (the
    line's, here), who: [person], at (seconds), inserted, deleted}], each line once -- who made its latest piece.
    A line that differs here (not synced yet, or edited since) is left out."""
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
    here = text.splitlines(True)
    to_here: Dict[int, int] = {}
    for tag, a1, a2, b1, _ in difflib.SequenceMatcher(None, there, here, autojunk=False).get_opcodes():
        if tag == "equal":
            for k in range(a2 - a1):
                to_here[a1 + k] = b1 + k
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
    lines: Dict[int, dict] = {}
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
            got = lines.setdefault(h, {"line": h + 1, "text": here[h].rstrip("\n")[:LINE_TEXT], "who": who, "at": end,
                                       "inserted": "", "deleted": ""})
            if end >= got["at"]:
                got["who"], got["at"] = who, end
            if n == first:
                got["inserted" if kind == "i" else "deleted"] += piece[:LINE_TEXT]
    return [lines[k] for k in sorted(lines)]


def changes(history: History, project: str, root: str, path: str, text: str, me: str, since: float) -> dict:
    """Who changed `path` (a file under the project's folder `root`) on Overleaf since `since`, placed on `text` (the
    file as it is here): {lines: attribute's, people: [{...person, at, lines}] the latest first, version}."""
    pathname = os.path.relpath(os.path.realpath(path), os.path.realpath(root))
    if pathname.startswith(".."):
        return {"lines": [], "people": [], "version": None}
    ups = history.updates(project, since)
    if not ups:
        return {"lines": [], "people": [], "version": None}
    head = max(u["toV"] for u in ups)
    mine = [u for u in ups if pathname in (u.get("pathnames") or []) and u["meta"]["end_ts"] / 1000 >= since
            and not _mine_from_here(u["meta"], me)]
    if not mine:
        return {"lines": [], "people": [], "version": head}
    lines = attribute(history.diff(project, pathname, min(u["fromV"] for u in mine), head), text, me, since)
    people: Dict[str, dict] = {}
    for line in lines:
        for p in line["who"]:
            got = people.setdefault(p["id"] or p["name"], {**p, "at": 0, "lines": 0})
            got["at"], got["lines"] = max(got["at"], line["at"]), got["lines"] + 1
    return {"lines": lines, "people": sorted(people.values(), key=lambda p: -p["at"]), "version": head}
