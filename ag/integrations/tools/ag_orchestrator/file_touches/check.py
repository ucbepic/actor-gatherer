"""What an answer's tool calls did to files, found on disk: the files each read (and which of its
lines), and what each changed -- told by the files themselves, not by what the calls say.

Before the calls run (`before`): every file they name is looked at -- a path an edit or read tool is
given, and every word of a shell command that is a file there, from the directory the command runs
in, with the variables it sets itself and its `cd`s followed (`named`). Once their results are in
(`check`), the same files are looked at again: one whose text differs was changed by the call
naming it (`created`, `modified` with the lines that changed, `deleted`). A file changed that no call
names is one the watcher saw change while they ran (watch.py): it is the calls' too, but not named.
A change to a file in ag's home (AG_HOME, ~/.ag: its databases, its logs) is ag's own -- it writes them
as the calls run, a gatherer's database at every model call -- and is left out, unless a call says it
writes the file: `sqlite3 ~/.ag/.../context.db "SELECT ..."` is not an edit of it.

A read is found by reading the call's output (harness_kit/shell.py), and kept only where the file says so:
a path is kept when it is a file; a line shown as line 12 of a file, when line 12 of the file is that
text -- one that is not (another command's output in the same form, a match of another of the files
searched) is left out. What a call showed of a file it changed itself, or that changed while the
calls ran, is kept unchecked: the file is no longer as the call saw it.

Each touch: {"call_id", "path", "how" (read, hit, created, modified, deleted), "checked" (True: what the
call showed of it is on disk; False: it is not; None: nothing to match), "named" (whether the call
names the file), "detail"}: {"lines": [[start, [text, ...]], ...]} for a read (start None: where in
the file is not known), {"unsplit": True} for one whose lines cannot be told apart, {"image": True};
{"hits": [[n, text], ...]} or {"listed": True} (a search that lists files by name); {"hunks": [{"at",
"old", "new", "above", "below"}]} for a change (at: the line in the file as it is now), {"lines": [...]}
for a file created; any of them {"cut": n}, lines not sent. A call that touched no file gets one
touch with no path, so that it is known to have been checked."""
import difflib
import glob
import os
import re
import shlex
from typing import Dict, Iterable, List, Optional, Tuple

from ag.integrations.tools.ag_connection.ag_client import home
from harness_kit.shell import (EDITS, GLOB, GREP_PATH_LINE, READ_LINE, SHELLS, _expand, _patch_files, _path, _resolve,
                       _shell_text, _simple_commands, shell_changes, shell_reads)

MAX_BYTES = 2 << 20        # the most of a file read: a larger one is told changed by its size and time alone
MAX_NAMED = 64             # the most files an answer's calls name that are looked at
MAX_LINES = 4000           # the most lines of one file sent for one call
LINE_CHARS = 400           # the most of one line sent
MAX_HUNKS = 50             # the most changed places sent for one file
MAX_UNNAMED = 200          # the most files the watcher saw change, unnamed, kept for one answer
CONTEXT = 2                # the lines around a change sent with it
SEARCHES = {"Grep", "Glob"}
DELEGATES = {"Agent", "Task"}   # a call whose subagent runs tools of its own: what they change, it changes


class Look:
    """A file as it was looked at: its size, modification time and birth time (None: the system keeps
    none -- Linux, to Python), and its lines (None: too big to read, or not text). A size of -1: not
    known (lines as last seen, not looked at)."""

    __slots__ = ("size", "mtime", "birth", "lines")

    def __init__(self, size: int, mtime: float, lines: Optional[List[str]], birth: Optional[float] = None):
        self.size, self.mtime, self.lines, self.birth = size, mtime, lines, birth

    def same(self, other: "Look") -> bool:
        if self.lines is not None and other.lines is not None:
            return self.lines == other.lines and (self.size == other.size or -1 in (self.size, other.size))
        return (self.size, self.mtime) == (other.size, other.mtime)


def ags(path: str) -> bool:
    """Whether `path` is in ag's home (AG_HOME, ~/.ag), whose files ag itself writes as the calls run."""
    roots = {home(), os.path.realpath(home())}                       # macOS's /var is /private/var
    return any(path == r or path.startswith(r.rstrip(os.sep) + os.sep) for r in roots)


def look(path: str) -> Optional[Look]:
    """The file at `path` as it is now; None when there is none (or it is not a regular file)."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    if not os.path.isfile(path):
        return None
    lines = None
    if st.st_size <= MAX_BYTES:
        try:
            with open(path, "rb") as fh:
                raw = fh.read(MAX_BYTES + 1)
            if b"\0" not in raw:
                lines = raw.decode("utf-8", errors="replace").split("\n")
                if len(lines) > 1 and lines[-1] == "":           # the last line's newline: no line after it
                    lines.pop()
        except OSError:
            pass
    return Look(st.st_size, st.st_mtime, lines, getattr(st, "st_birthtime", None))


# ------------------------------------------------------------------ the files a call names

def _words(command: str, cwd: Optional[str]) -> Iterable[str]:
    """Every word of a shell command that could be a path, as one from where it is: its variables
    filled in where the command sets them, each `cd` followed, patterns expanded on disk."""
    cmds = _simple_commands(command)
    if cmds is None:                                     # not plain: its words, from where it starts
        try:
            words = shlex.split(command, comments=False)
        except ValueError:
            words = command.split()
        cmds = [(words, [])]
    env = {}
    for words, redirs in cmds:
        if words and all(re.fullmatch(r"[A-Za-z_]\w*=.*", w, re.S) for w in words):
            for w in words:
                k, v = w.split("=", 1)
                env[k] = _expand(v, env)
            continue
        words = [_expand(w, env) for w in words]
        if words[:1] == ["cd"] and len(words) == 2:
            cwd = _path(words[1], cwd)
            continue
        for w in words[1:] + [_expand(t, env) for op, t in redirs if not op.startswith("<")]:
            w = w.split("=", 1)[1] if w.startswith("--") and "=" in w else w      # --file=a.py
            if not w or w.startswith("-") or "\n" in w:
                continue
            p = _path(w, cwd)
            if p is None:
                continue
            if GLOB.search(p) and "**" not in p:
                yield from sorted(glob.glob(p))[:MAX_NAMED]
            else:
                yield p


def named(name: str, inp, cwd: Optional[str]) -> List[str]:
    """The files a call names, absolute: the path an edit or read tool is given (every file of a
    patch), or every word of a shell command that is a file -- or one it says it writes, which may
    not be there yet."""
    out = []
    if isinstance(inp, dict) and name not in SHELLS:
        for k in ("file_path", "notebook_path", "path", "Path"):          # Antigravity's: Path
            if isinstance(inp.get(k), str) and inp[k]:
                out.append(_resolve(inp[k], cwd or ""))
    if name == "apply_patch":
        body = inp if isinstance(inp, str) else (inp or {}).get("input") or (inp or {}).get("patch") or ""
        out += [_resolve(p, cwd or "") for p, _, _ in _patch_files(str(body))]
    if name in SHELLS:
        command, workdir = _shell_text(name, inp)
        here = _resolve(workdir, cwd or "") if workdir else cwd
        out += [p for p in _words(command, here) if os.path.isfile(p)]
        out += [p for p, _, _ in shell_changes(command, here)[0] if not GLOB.search(p)]
    seen, kept = set(), []
    for p in out:
        if p not in seen and os.path.isabs(p):
            seen.add(p)
            kept.append(p)
    return kept


def before(calls: Dict[str, Tuple[str, object]], cwd: Optional[str]) -> Dict[str, Optional[Look]]:
    """The files the calls name, as they are before they run (None: not there): what `check` compares."""
    out: Dict[str, Optional[Look]] = {}
    for name, inp in calls.values():
        for p in named(name, inp, cwd):
            if len(out) >= MAX_NAMED:
                return out
            if p not in out:
                out[p] = look(p)
    return out


# ------------------------------------------------------------------ what a call showed of a file

SHELL_CWD_NOTE = re.compile(r"\n?Shell cwd was reset to [^\n]*\s*$")
CODEX_HEADER = re.compile(r"^(?:Chunk ID: [^\n]*\n)?(?:Wall time: [^\n]*\n)?(?:Process exited with code [^\n]*\n)?"
                          r"(?:Original token count: [^\n]*\n)?Output:\n")


def shell_output(text: str) -> str:
    """A shell call's output as the command printed it: without Claude Code's note that it reset the
    shell's directory, or codex's header (wall time, exit code) before it."""
    text = SHELL_CWD_NOTE.sub("", text or "")
    m = CODEX_HEADER.match(text)
    return text[m.end():] if m else text


def _clip(lines: List[str]) -> Tuple[List[str], int]:
    return [t[:LINE_CHARS] for t in lines[:MAX_LINES]], max(0, len(lines) - MAX_LINES)


def _is(line: Optional[str], shown: str) -> bool:
    """Whether a file's line is the text a call showed of it: the same, or what it showed cut short."""
    if line is None:
        return False
    line = line.rstrip("\r")
    return line == shown or (len(shown) >= 40 and line.startswith(shown.rstrip("…").rstrip()))


def _at(lines: List[str], n: int) -> Optional[str]:
    return lines[n - 1] if 1 <= n <= len(lines) else None


class _Found:
    """What one call showed of the files it read, gathered by file: their runs of lines, their hits."""

    def __init__(self):
        self.order: List[str] = []
        self.reads: Dict[str, dict] = {}
        self.hits: Dict[str, dict] = {}

    def _get(self, table: dict, path: str, empty) -> dict:
        if path not in table:
            table[path] = {"checked": None, **empty}
            if path not in self.order:
                self.order.append(path)
        return table[path]

    def mark(self, t: dict, ok: Optional[bool]) -> None:
        if ok is None:
            return
        t["checked"] = ok if t["checked"] is None else (t["checked"] and ok)

    def lines(self, path: str, start: Optional[int], lines: List[str], ok: Optional[bool]) -> None:
        t = self._get(self.reads, path, {"lines": []})
        t["lines"].append([start, lines])
        self.mark(t, ok)

    def unsplit(self, path: str, **what) -> None:
        t = self._get(self.reads, path, {})
        t.update(what or {"unsplit": True})

    def hit(self, path: str, n: int, text: str, ok: Optional[bool]) -> None:
        t = self._get(self.hits, path, {"hits": []})
        t["hits"].append([n, text[:LINE_CHARS]])
        self.mark(t, ok)

    def listed(self, path: str) -> None:
        self._get(self.hits, path, {"listed": True})["checked"] = True

    def touches(self, call_id: str, names: List[str]) -> List[dict]:
        out = []
        for path in self.order:
            for how, table in (("read", self.reads), ("hit", self.hits)):
                if path not in table:
                    continue
                t = dict(table[path])
                checked = t.pop("checked")
                if "lines" in t:
                    runs, room = [], MAX_LINES
                    for start, lines in t["lines"]:
                        kept, _ = _clip(lines[:room])
                        runs.append([start, kept])
                        room -= len(kept)
                    cut = sum(len(lines) for _, lines in t["lines"]) - sum(len(x) for _, x in runs)
                    t = {"lines": runs, **({"cut": cut} if cut else {})}
                if "hits" in t and len(t["hits"]) > MAX_LINES:
                    t = {"hits": t["hits"][:MAX_LINES], "cut": len(t["hits"]) - MAX_LINES}
                out.append({"call_id": call_id, "path": path, "how": how, "checked": checked,
                            "named": path in names, "detail": t})
        return out


def _reads(name: str, inp, text: str, cwd: Optional[str], was: Dict[str, Optional[Look]], moved: set,
           found: _Found) -> None:
    """What the call showed of files it read, each kept where the file says so (see the module's
    docstring). A file changed while the calls ran (`moved`) is matched as it was before them
    (`was`) and as it is after: the call may have read either."""
    def versions(path: str) -> Tuple[bool, List[List[str]]]:
        """(whether the file is there, or was; its texts to match against: as it is, as it was)"""
        now, then = look(path), was.get(path)
        texts = [v.lines for v in (now, then) if v is not None and v.lines is not None]
        return now is not None or path in moved, texts

    def kept(path: str, start: Optional[int], lines: List[str]) -> None:
        there, texts = versions(path)
        if not there:
            return
        if not texts or not lines:
            found.lines(path, start, lines, None)
            return
        if start is None:                                          # a tail: where it is, from the file's end
            for body in texts:
                at = len(body) - len(lines) + 1
                if at >= 1 and all(_is(body[at - 1 + i], t) for i, t in enumerate(lines)):
                    found.lines(path, at, lines, True)
                    return
            found.lines(path, None, lines, None if path in moved else False)
            return
        ok = any(all(_is(_at(body, start + i), t) for i, t in enumerate(lines)) for body in texts)
        found.lines(path, start, lines, ok or (None if path in moved else False))

    def hit(path: str, n: int, shown: str, sure: bool) -> None:
        there, texts = versions(path)
        if not there:
            return
        if any(_is(_at(body, n), shown) for body in texts):
            found.hit(path, n, shown, True)
        elif sure and (not texts or path in moved):                # nothing to match it against
            found.hit(path, n, shown, None)

    if name == "Read" and isinstance(inp, dict) and inp.get("file_path"):
        path = _resolve(str(inp["file_path"]), cwd or "")
        if text.strip() == "[image]":
            if path in moved or os.path.isfile(path):
                found.unsplit(path, image=True)
            return
        got = [(int(m.group(1)), m.group(2)) for m in map(READ_LINE.match, text.split("\n")) if m]
        runs: List[list] = []
        for n, t in got:
            if runs and runs[-1][0] + len(runs[-1][1]) == n:
                runs[-1][1].append(t)
            else:
                runs.append([n, [t]])
        for start, lines in runs:
            kept(path, start, lines)
        if not runs and (path in moved or os.path.isfile(path)):
            found.unsplit(path)                                    # an empty file, or lines not shown
        return
    if name in SHELLS:
        command, workdir = _shell_text(name, inp)
        here = _resolve(workdir, cwd or "") if workdir else cwd
        reads, _ = shell_reads(command, shell_output(text), here or "")
        for path, how, n, got in reads:
            paths = sorted(glob.glob(path))[:MAX_NAMED] if GLOB.search(path) else [path]
            if GLOB.search(path) and how == "lines" and len(paths) != 1:
                how = "unsplit"                                    # cat *.md: one output of several files
            for p in paths:
                if how == "lines":
                    kept(p, n, got)
                elif how in ("hit", "maybe"):
                    hit(p, n, got, how == "hit")
                elif os.path.isfile(p) or p in moved:
                    found.unsplit(p)
        return
    if name in SEARCHES:
        root = _resolve(str(inp.get("path") or "."), cwd or "") if isinstance(inp, dict) else cwd or ""
        for line in text.split("\n"):
            m = GREP_PATH_LINE.match(line)
            if m:
                hit(_resolve(m.group(1), root), int(m.group(2)), m.group(3), True)
            elif line.strip() and not line.startswith(" "):
                p = _resolve(line.strip(), root)
                if os.path.isfile(p):
                    found.listed(p)


# ------------------------------------------------------------------ what the calls changed

def hunks(old: List[str], new: List[str]) -> List[dict]:
    """Where `new` differs from `old`: each {"at" (its first line in `new`), "old", "new", "above",
    "below" ([[n, text]]: the lines of `new` around it)}."""
    out = []
    ops = difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes()
    for tag, i1, i2, j1, j2 in ops:
        if tag == "equal":
            continue
        if len(out) >= MAX_HUNKS:
            out.append({"at": None, "old": [], "new": [], "above": [], "below": [], "more": True})
            break
        out.append({"at": j1 + 1, "old": _clip(old[i1:i2])[0], "new": _clip(new[j1:j2])[0],
                    "above": [[n + 1, new[n][:LINE_CHARS]] for n in range(max(0, j1 - CONTEXT), j1)],
                    "below": [[n + 1, new[n][:LINE_CHARS]] for n in range(j2, min(len(new), j2 + CONTEXT))]})
    return out


def change(path: str, was: Optional[Look], seen: Optional[List[str]] = None, now: Optional[Look] = None,
           watched: str = "") -> Optional[Tuple[str, dict]]:
    """How a file changed while the calls ran, and the detail sent: (how, detail), or None (it did not).
    `was`: the file before they ran, as looked at (None: not there, or not looked at -- then `seen`, its
    lines when last seen, and `watched`, what the watcher saw of it, tell what there is to tell)."""
    now = look(path) if now is None else now
    if was is None and seen is None:                       # not looked at before: as the watcher saw it
        if now is None:
            return ("deleted", {}) if watched else None
        if watched == "created":
            lines, cut = _clip(now.lines) if now.lines is not None else ([], 0)
            return "created", {"lines": lines, **({"cut": cut} if cut else {})}
        return ("modified", {}) if watched else None
    if was is None and seen is not None:                  # its lines, as last seen in the session
        if now is None:
            return "deleted", {}
        if now.lines is None or now.lines == seen:
            return ("modified", {}) if now.lines is None and watched else None
        return "modified", {"hunks": hunks(seen, now.lines)}
    if now is None:
        return "deleted", {}
    if was.same(now):
        return None
    if was.lines is None or now.lines is None:
        return "modified", {}
    return "modified", {"hunks": hunks(was.lines, now.lines)}


def created(path: str, now: Optional[Look] = None) -> Optional[Tuple[str, dict]]:
    """A file that was not there before the calls ran, if it is now."""
    now = look(path) if now is None else now
    if now is None:
        return None
    lines, cut = _clip(now.lines) if now.lines is not None else ([], 0)
    return "created", {"lines": lines, **({"cut": cut} if cut else {})}


def check(calls: List[Tuple[str, str, object, str, bool]], cwd: Optional[str],
          was: Dict[str, Optional[Look]], watched: Dict[str, str], seen: Optional[Dict[str, List[str]]] = None) -> List[dict]:
    """What an answer's calls did to files: `calls`, [(call id, name, input, result text, error)] --
    those whose results are in; `was`, the files they name as they were before they ran (`before`;
    {}: not looked at); `watched`, {path: created/modified/deleted}, what the watcher saw change while
    they ran; `seen`, files' lines as last seen (a file changed, not looked at before, is told from
    them). Touches, in the order of the calls (see the module's docstring)."""
    seen = seen or {}
    names = {cid: named(name, inp, cwd) for cid, name, inp, _, _ in calls}
    says = {cid: _writes(name, inp, cwd) for cid, name, inp, _, _ in calls}
    changes: Dict[str, Tuple[str, dict]] = {}
    watched = {p: "modified" if how == "created" and p in seen else how for p, how in watched.items()}   # seen before
    for path in list(was) + [p for p in watched if p not in was]:
        got = None
        if path in was:
            got = created(path) if was[path] is None else change(path, was[path])
        if not got and path in watched:                     # not looked at before -- or after it changed:
            how = "modified" if was.get(path) is not None and watched[path] == "created" else watched[path]
            got = change(path, None, seen.get(path), watched=how)   # (a call run as it streamed in): there before,
                                                                     # it was not created
        if got and ags(path) and not any(path in s for s in says.values()):
            continue                                        # ag's own writes (its database, its logs), not the calls'
        if got:
            if got[0] == "modified":
                got[1]["path"] = path                      # for _share; not sent (see below)
            changes[path] = got
    runners = [cid for cid, name, _, _, _ in calls if name in SHELLS or name in EDITS]
    shells = [cid for cid, name, _, _, _ in calls if name in SHELLS or name in DELEGATES]   # may change a file
                                                                                           # it doesn't name
    owners: Dict[str, List[str]] = {}                       # a change's calls: those that say they write it,
    for p in changes:                                       # else those of the runners that name it
        owners[p] = [cid for cid in runners if p in says[cid]] or [cid for cid in runners if p in names[cid]]
    unnamed = [p for p in changes if not owners[p]][:MAX_UNNAMED]
    by_id = {cid: (name, inp) for cid, name, inp, _, _ in calls}
    shares = {p: _share(changes[p], owners[p], by_id, cwd) for p in changes if len(owners[p]) > 1}
    out: List[dict] = []
    for cid, name, inp, text, error in calls:
        mine = []
        if not error:
            found = _Found()
            _reads(name, inp, text or "", cwd, was, set(changes), found)
            mine += found.touches(cid, names[cid])
        for p, (how, detail) in changes.items():
            if cid in owners[p]:
                mine.append({"call_id": cid, "path": p, "how": how, "checked": None, "named": True,
                             "detail": shares[p][cid] if p in shares else detail})
            elif p in unnamed and cid in shells:             # changed while it ran, by no call that names it
                mine.append({"call_id": cid, "path": p, "how": how, "checked": None, "named": False, "detail": detail})
        out += mine or [{"call_id": cid}]
    for t in out:
        if isinstance(t.get("detail"), dict) and "path" in t["detail"]:
            t["detail"] = {k: v for k, v in t["detail"].items() if k != "path"}
    return out


def _says(name: str, inp, path: str, cwd: Optional[str]) -> Optional[List[Tuple[List[str], List[str]]]]:
    """The changes a call says it makes to `path`: [(old lines, new lines)] -- an edit's strings, a
    patch's hunks, a command's text written or replaced; None when it says it changes it but not how
    (`sed -i`, a script), or writes it whole."""
    if name in ("Edit", "MultiEdit") and isinstance(inp, dict):
        edits = [inp] if name == "Edit" else [e for e in inp.get("edits") or [] if isinstance(e, dict)]
        return [(str(e.get("old_string") or "").split("\n"), str(e.get("new_string") or "").split("\n")) for e in edits]
    if name == "apply_patch":
        body = inp if isinstance(inp, str) else (inp or {}).get("input") or (inp or {}).get("patch") or ""
        return [(old, new) for p, how, hunks in _patch_files(str(body)) if _resolve(p, cwd or "") == path
                and how == "update" for old, new in hunks] or None
    if name in SHELLS:
        command, workdir = _shell_text(name, inp)
        here = _resolve(workdir, cwd or "") if workdir else cwd
        out = []
        for p, how, what in shell_changes(command, here)[0]:
            if p == path and how == "pairs":
                out += [(old.split("\n"), new.split("\n")) for old, new in what]
            elif p == path and how == "append":
                out.append(([], what.split("\n")))
        return out or None
    return None


def _share(change: Tuple[str, dict], owners: List[str], calls: Dict[str, Tuple[str, object]],
           cwd: Optional[str]) -> Dict[str, dict]:
    """A change to a file made by several of the calls, shared out: each place it changed goes to the
    calls whose stated change it is (an edit's new text is in it, or its old text was), the places none
    states to those that say they change the file but not how -- or, none of those, to every call. A
    detail per call, with its places alone."""
    how, detail = change
    places = detail.get("hunks")
    if how != "modified" or not places:
        return {cid: detail for cid in owners}
    path = detail.get("path")
    stated = {cid: _says(*calls[cid], path, cwd) if path else None for cid in owners}

    def claims(pairs, h) -> bool:
        new = {t.strip() for t in h["new"] if t.strip()}
        old = {t.strip() for t in h["old"] if t.strip()}
        return any(any(t.strip() in new for t in n if t.strip()) or any(t.strip() in old for t in o if t.strip())
                   for o, n in pairs)
    vague = [cid for cid in owners if stated[cid] is None] or owners
    mine: Dict[str, list] = {cid: [] for cid in owners}
    for h in places:
        by = [cid for cid in owners if stated[cid] and claims(stated[cid], h)] or vague
        for cid in by:
            mine[cid].append(h)
    return {cid: {"hunks": mine[cid]} if mine[cid] else {} for cid in owners}


def _writes(name: str, inp, cwd: Optional[str]) -> set:
    """The files a call says it changes: an edit tool's, or a shell command's that says so (harness_kit/shell.py)."""
    if name in EDITS:
        return set(named(name, inp, cwd))
    if name in SHELLS:
        command, workdir = _shell_text(name, inp)
        here = _resolve(workdir, cwd or "") if workdir else cwd
        return {p for p, _, _ in shell_changes(command, here)[0]}
    return set()
