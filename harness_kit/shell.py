"""What a call says it did to files, read from the call alone: the files a shell command reads
(by a command that only prints part of a file: `sed -n`, `cat`, `head`, `tail`, `nl`, `grep -n`)
and which of its output lines are each one's; the files it changes, and how, when the command
says (`cat > F <<EOF`, `tee`, `sed -i`, a Python script that replaces constant strings in a file
and writes it back); and the files a codex patch adds, changes or deletes. A codex code-mode call
(`exec`: a JavaScript script that calls the other tools, `tools.exec_command({cmd: ...})`) is read as
the calls its script makes, where it writes their arguments out (`opened_script`).

Read, not run: what a command reads or writes is told from its words, the way a reader of it
would. Words the command fills in itself are filled in (`S=/tmp/x; cat $S/a`), as is `cd`; a
path that still holds a variable is not a path known, and is left out. The hook server reads calls
this way as each call's result arrives, before it checks what was found against the disk
(ag/integrations/tools/ag_orchestrator/file_touches/check.py); the dashboard's Chat view reads
those it did not check the same way. One copy, for both: harness_kit imports nothing of ag."""
import ast
import fnmatch
import os
import re
import shlex
from typing import Any, Dict, List, Optional, Tuple

READ_LINE = re.compile(r"^\s*(\d+)(?:\t|→)(.*)$")              # a Read result's line: "12\ttext"
GREP_LINE = re.compile(r"^(\d+)[:-](.*)$")                       # grep -n on one file: "12:text"
GREP_PATH_LINE = re.compile(r"^([^\s:][^:]*):(\d+)[:-](.*)$")    # grep -n on several: "a/b.py:12:text"
SED_RANGE = re.compile(r"^(\d+)(?:,(\d+|\$))?p$")
GLOB = re.compile(r"[*?[]")


# ------------------------------------------------------------------ shell commands that read files

def _segments(command: str):
    """A shell command's simple commands, in order, each its words and the operator after it
    ("&&", ";", "|", ...); None when it is not plain enough to read (substitutions, heredocs)."""
    if any(s in command for s in ("$(", "`", "<<", "<(")):
        return None
    try:
        lex = shlex.shlex(command, posix=True, punctuation_chars=";&|")
        lex.whitespace_split = True
        lex.commenters = ""
        words = list(lex)
    except ValueError:
        return None
    segs, cur = [], []
    for w in words:
        if w and set(w) <= set(";&|"):
            segs.append((cur, w))
            cur = []
        else:
            cur.append(w)
    segs.append((cur, ""))
    return [(w, op) for w, op in segs if w]


def _resolve(path: str, cwd: str) -> str:
    path = os.path.expanduser(path)
    return os.path.normpath(path if os.path.isabs(path) or not cwd else os.path.join(cwd, path))


VARIABLE = re.compile(r"\$(?:\{(\w+)\}|(\w+))")
ASSIGNMENT = re.compile(r"[A-Za-z_]\w*=.*", re.S)


def _expand(word: str, env: Dict[str, str]) -> str:
    """`word` with the variables the command set itself (`env`) filled in; any other left as it is."""
    return VARIABLE.sub(lambda m: env.get(m.group(1) or m.group(2), m.group(0)), word)


def _path(word: str, cwd: Optional[str]) -> Optional[str]:
    """`word` as an absolute path, from `cwd` (None: not known, "": none given -- left relative); None
    when it is not known: it still holds a variable, or it is relative to a directory not known.
    Asked before it is resolved, which would make `$S/../x` plain `x`."""
    if "$" in word or (cwd is None and not os.path.isabs(os.path.expanduser(word))):
        return None
    return _resolve(word, cwd or "")


def _among(path: str, named: List[str]) -> bool:
    """Whether `path` is one of the paths a search was given, inside one (a folder), or matches one
    (a pattern the shell expanded: `src/*.py`)."""
    return any(path == p or path.startswith(p.rstrip("/") + "/") or (GLOB.search(p) and fnmatch.fnmatchcase(path, p))
               for p in named)


def _read_command(words: List[str]):
    """What a simple command reads: {"kind": "range", path, start, count (None: to its end)},
    {"kind": "numbered", path} (output lines carry their numbers), {"kind": "tail", path, count},
    {"kind": "grep", paths, numbered, single}, or None."""
    cmd, args = words[0], words[1:]
    opts = [a for a in args if a.startswith("-") and a != "-"]
    files = [a for a in args if not a.startswith("-")]
    if cmd == "sed" and "-n" in args:
        rest = [a for a in args if a != "-n"]
        if len(rest) == 2 and not rest[1].startswith("-"):
            m = SED_RANGE.match(rest[0])
            if m:
                a = int(m.group(1))
                b = m.group(2)
                count = 1 if b is None else None if b == "$" else int(b) - a + 1
                return {"kind": "range", "path": rest[1], "start": a, "count": count if count is None or count > 0 else 0}
    if cmd == "cat" and len(files) == 1:
        if not opts:
            return {"kind": "range", "path": files[0], "start": 1, "count": None}
        if opts in (["-n"],):
            return {"kind": "numbered", "path": files[0]}
    if cmd == "nl" and len(files) == 1 and all(o in ("-ba", "-b", "a") for o in opts + files[:-1]):
        return {"kind": "numbered", "path": files[-1]}
    if cmd in ("head", "tail"):
        n, rest, i = 10, [], 0
        while i < len(args):
            a = args[i]
            if a == "-n" and i + 1 < len(args) and args[i + 1].lstrip("+").isdigit():
                n = int(args[i + 1].lstrip("+")); i += 2; continue
            if re.fullmatch(r"-n?\d+", a):
                n = int(re.sub(r"\D", "", a)); i += 1; continue
            if a.startswith("-"):
                return None
            rest.append(a); i += 1
        if len(rest) == 1:
            if cmd == "head":
                return {"kind": "range", "path": rest[0], "start": 1, "count": n}
            return {"kind": "tail", "path": rest[0], "count": n}
    if cmd in ("grep", "rg", "egrep"):
        numbered = cmd == "rg" or any("n" in o[1:] for o in opts if not o.startswith("--")) or "--line-number" in opts
        pattern_given = any(o in ("-e", "-f") for o in opts)
        paths = files if pattern_given else files[1:]
        recursive = cmd == "rg" or "--recursive" in opts or any(c in o[1:] for o in opts if not o.startswith("--") for c in "rR")
        single = len(paths) == 1 and not recursive and not GLOB.search(paths[0])
        return {"kind": "grep", "paths": paths, "numbered": numbered, "single": single}
    return None


def _head_count(words: List[str]) -> Optional[int]:
    """`head -N`, `head -n N`, `head`: how many lines it keeps; None when it is not a plain head."""
    if words[0] != "head":
        return None
    args = words[1:]
    if not args:
        return 10
    if len(args) == 1 and re.fullmatch(r"-n?\d+", args[0]):
        return int(re.sub(r"\D", "", args[0]))
    if len(args) == 2 and args[0] == "-n" and args[1].isdigit():
        return int(args[1])
    return None


def _units(segs, cwd: str):
    """A command's pipelines, in order, each what its output is: {"read": what it reads (_read_command,
    its paths resolved -- None: not known), "size": its lines when known, "form": a pattern its every
    line has (a numbered grep's, cat -n's), "cap": at most this many, "cwd": the directory it ran in};
    and whether any did more than read. Searches of one file each, one after another, are one part:
    their lines have the same form, and which are whose cannot be told from it (`group`)."""
    units, other, i, env = [], False, 0, {}
    while i < len(segs):
        pipe = [segs[i][0]]
        while segs[i][1] == "|" and i + 1 < len(segs):
            i += 1
            pipe.append(segs[i][0])
        i += 1
        words = pipe[0]
        if words[0] == "export":
            words = words[1:] or ["export"]
        if len(pipe) == 1 and all(ASSIGNMENT.fullmatch(w) for w in words):   # S=/tmp/x: the command's own
            for w in words:
                k, v = w.split("=", 1)
                env[k] = _expand(v, env)
            continue
        words = [_expand(w, env) for w in words]
        if words[0] == "cd" and len(words) == 2 and len(pipe) == 1:
            cwd = _path(words[1], cwd)
            continue
        heads = [_head_count(w) for w in pipe[1:]]
        cap = heads[0] if len(heads) == 1 and heads[0] is not None else None
        plain = len(pipe) == 1 or cap is not None
        r = _read_command(words)
        u = {"read": None, "size": None, "form": None, "cap": cap, "cwd": cwd}
        if r and r["kind"] == "grep":
            r = dict(r, paths=[_path(x, cwd) for x in r["paths"]] or [cwd])
        elif r:
            r = dict(r, path=_path(r["path"], cwd))
        if words[0] == "echo" and len(pipe) == 1 and not any(w.startswith("-") for w in words[1:2]):
            u["size"] = 1
        elif r is None or not plain or r["kind"] == "grep":
            other = True
            if r and r["kind"] == "grep" and r["numbered"]:          # filtered on: its lines still have their form
                u["form"], u["read"] = "grep", r
        else:
            u["read"] = r
            if r["kind"] == "numbered":
                u["form"] = "numbered"
            elif r["kind"] == "range" and r["count"] is not None:
                u["size"] = r["count"] if cap is None else min(r["count"], cap)
            elif r["kind"] == "range" and cap is not None:            # cat F | head -N
                u["read"]["count"] = u["size"] = cap
            elif r["kind"] == "tail":
                u["size"] = r["count"]
        last = units[-1] if units else None
        if last and _one_file_search(last) and _one_file_search(u):
            last["read"] = dict(last["read"], paths=last["read"]["paths"] + u["read"]["paths"], group=True)
            last["cap"] = None
            continue
        units.append(u)
    return units, other


def _one_file_search(u: dict) -> bool:
    return u["form"] == "grep" and u["read"]["single"]


NUMBERED_LINE = re.compile(r"^\s*\d+\t")


def _fits(u: dict, line: str) -> bool:
    if u["form"] == "numbered":
        return bool(NUMBERED_LINE.match(line))
    if u["form"] == "grep":
        return bool(GREP_PATH_LINE.match(line) or (GREP_LINE.match(line) and u["read"]["single"]))
    return False


def shell_reads(command: str, output: str, cwd: str):
    """What a shell command read, from its output: [(path, "lines", start, lines)] for its parts that
    print a file (start None: where in it is not known), [(path, "hit", n, text)] for numbered search
    matches, [(path, "maybe", n, text)] for a match of one of several files searched one after
    another (its line is in the output once for each of them: whose it is, is not known),
    [(path, "unsplit", None, [])] for a read whose lines cannot be told apart from the rest; and
    whether the command did anything but read. A path may be a pattern (`*.md`): what the shell
    made of it is not known here.
    Its output is shared out among its parts from the front while each one's size is known (sed -n
    A,Bp prints B-A+1 lines, echo one) or its lines have a form of their own (grep -n's "12:", cat -n's),
    then the same from the back; a part of unknown size between the two cannot be told apart. A
    search's match is kept only for a path the search was given (or inside one): a line of another
    command's output may have the same form ("Sat Oct 24 18:12:34")."""
    segs = _segments(command)
    if segs is None:
        return [], True
    units, other = _units(segs, cwd)
    out = output.split("\n") if output else []
    while out and out[-1] == "":
        out.pop()
    spans: Dict[int, tuple] = {}

    def take(u, lines, frm, back):
        """How many lines `u` takes at `frm` (forward) or ending at `frm` (backward); None: unknown."""
        if u["size"] is not None:
            return u["size"]
        if u["form"]:
            n = 0
            while n < (u["cap"] or 10 ** 9):
                k = frm + n if not back else frm - 1 - n
                if k < 0 or k >= len(lines) or not _fits(u, lines[k]):
                    break
                n += 1
            return n
        return None

    pos, front = 0, 0
    for idx, u in enumerate(units):
        n = take(u, out, pos, False)
        if n is None:
            break
        if idx == len(units) - 1 and u["size"] is not None:     # the last: what is left, at most its size
            n = min(n, len(out) - pos)
        spans[idx] = (pos, pos + n)
        pos += n
        front = idx + 1
    if front < len(units):
        end = len(out)
        for idx in range(len(units) - 1, front - 1, -1):
            u = units[idx]
            n = take(u, out, end, True)
            if n is None:
                if idx == front:                                  # the only one left: all between
                    spans[idx] = (pos, end)
                break
            spans[idx] = (max(pos, end - n), end)
            end -= n
    found = []
    for idx, u in enumerate(units):
        r = u["read"]
        if not r:
            continue
        if r["kind"] == "grep":
            named = r["paths"]
            if idx not in spans or None in named:                 # a path not known: whose its matches are isn't
                continue
            for t in out[spans[idx][0]:spans[idx][1]]:
                m = GREP_LINE.match(t)
                if m and r["single"]:
                    for p in named:
                        found.append((p, "maybe" if r.get("group") else "hit", int(m.group(1)), m.group(2)))
                    continue
                m = GREP_PATH_LINE.match(t)
                if m and u["cwd"] is not None:
                    p = _resolve(m.group(1), u["cwd"])
                    if _among(p, named):
                        found.append((p, "hit", int(m.group(2)), m.group(3)))
            continue
        if r["path"] is None:
            continue
        if idx not in spans:
            found.append((r["path"], "unsplit", None, []))
            continue
        lines = out[spans[idx][0]:spans[idx][1]]
        if r["kind"] == "numbered":
            for t in lines:
                m = re.match(r"^\s*(\d+)\t(.*)$", t)
                if m:
                    found.append((r["path"], "lines", int(m.group(1)), [m.group(2)]))
        elif r["kind"] == "tail":
            found.append((r["path"], "lines", None, lines))
        else:
            found.append((r["path"], "lines", r["start"], lines[:r["count"]] if r.get("count") else lines))
    return found, other


# ------------------------------------------------------------------ shell commands that change files

HEREDOC = re.compile(r"<<(-?)\s*(['\"]?)([A-Za-z_][\w.-]*)\2")
REDIRECT_TO = {">", ">>", ">|", "&>", "&>>"}
NOT_A_FILE = {"/dev/null", "/dev/stdout", "/dev/stderr"}


def _heredocs(command: str):
    """The command with each heredoc's body taken out and its `<<EOF` made `<< \\x00N`, and the bodies."""
    lines, bodies, out, waiting = command.split("\n"), [], [], []
    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        found = list(HEREDOC.finditer(line))
        for m in reversed(found):
            line = line[:m.start()] + f"<< \x00{len(bodies) + found.index(m)}" + line[m.end():]
        out.append(line)
        for m in found:
            body = []
            while i < len(lines) and (lines[i].lstrip("\t") if m.group(1) else lines[i]) != m.group(3):
                body.append(lines[i])
                i += 1
            i += 1                                       # the delimiter
            bodies.append("\n".join(body))
    return out, bodies


def _simple_commands(command: str):
    """A shell command's simple commands, in order: (words, redirections [(op, target)]), heredoc
    bodies standing as their text; None when it cannot be read."""
    lines, bodies = _heredocs(command)
    words, buf = [], ""
    for line in lines:                                   # a line is a command, unless a quote runs on
        buf = buf + "\n" + line if buf else line
        try:
            lex = shlex.shlex(buf, posix=True, punctuation_chars=";&|<>")
            lex.whitespace_split = True
            lex.commenters = ""
            got = list(lex)
        except ValueError:
            continue
        words += got + [";"]
        buf = ""
    if buf:
        return None
    cmds, cur, redirs, k = [], [], [], 0
    while k < len(words):
        w = words[k]
        if w and set(w) <= set(";&|"):
            if cur or redirs:
                cmds.append((cur, redirs))
            cur, redirs = [], []
        elif w and set(w) <= set("<>&|") and k + 1 < len(words):
            fd = None
            if cur and cur[-1].isdigit() and re.search(rf"(?<![\w-]){cur[-1]}{re.escape(w)}", command):
                fd = cur.pop()                           # 2>file: the fd is not an argument
            t = words[k + 1]
            if t.startswith("\x00") and t[1:].isdigit():
                t = bodies[int(t[1:])]
            if fd not in ("2",):                         # stderr: a log, not what the command wrote
                redirs.append((w, t))
            k += 1
        else:
            cur.append(w)
        k += 1
    if cur or redirs:
        cmds.append((cur, redirs))
    return cmds


def shell_changes(command: str, cwd: str):
    """What a shell command changed: [(path, how, what)] -- "write" (what: the whole new text),
    "append" (what: the text added at its end), "pairs" (what: [(old, new)], from a Python script's
    replacements), "changed" (what: how it was changed, not which lines) -- and whether that is all it
    did: a script, or a command that also ran something else, is a command as well. A path may be a
    pattern (`sed -i ... *.py`): what the shell made of it is not known here; one that is not known
    at all (a variable the command did not set) is left out."""
    cmds = _simple_commands(command)
    if cmds is None:
        return [], False
    out, pure, env = [], True, {}

    for words, redirs in cmds:
        if words and all(ASSIGNMENT.fullmatch(w) for w in words):   # S=/tmp/x
            for w in words:
                k, v = w.split("=", 1)
                env[k] = _expand(v, env)
            continue
        words = [_expand(w, env) for w in words]
        redirs = [(op, t if op in ("<<", "<<-") else _expand(t, env)) for op, t in redirs]
        stdin = next((t for op, t in redirs if op in ("<<", "<<-")), None)
        to = [(op, _path(t, cwd)) for op, t in redirs if op in REDIRECT_TO and t not in NOT_A_FILE
              and not t.startswith("&") and not t.isdigit()]
        cmd = os.path.basename(words[0]) if words else ""
        if cmd == "cd" and len(words) == 2:
            cwd = _path(words[1], cwd)
            continue
        if cmd in ("echo", "printf", "true", ":") and not to:   # prints a line: nothing else
            continue
        if cmd in ("cat", "tee") or (cmd in ("echo", "printf") and to):
            args = [w for w in words[1:] if not w.startswith("-")]
            append = "-a" in words[1:] or any(op.endswith(">>") for op, _ in to)
            if cmd == "tee":
                to += [(">", _path(a, cwd)) for a in args]
                text = stdin
            elif cmd == "cat":
                text = stdin if not args else None
            else:
                text = " ".join(args) if cmd == "echo" else None
            if not to:
                pure = False
            for _, path in to:
                out.append((path, "changed", " ".join(words)) if text is None else (path, "append" if append else "write", text))
            continue
        if cmd == "sed" and any(w == "--in-place" or re.fullmatch(r"-[a-zA-Z]*i\S*", w) for w in words[1:]):
            rest, script, k = words[1:], None, 0
            files_ = []
            while k < len(rest):
                w = rest[k]
                if w == "":                                  # BSD sed's `-i ''`: no backup's suffix
                    k += 1
                    continue
                if w in ("-e", "--expression", "-f"):
                    script = rest[k + 1] if k + 1 < len(rest) else None
                    k += 2
                    continue
                if w.startswith("-"):
                    k += 1
                    continue
                if script is None:
                    script = w
                else:
                    files_.append(w)
                k += 1
            for f in files_:
                out.append((_path(f, cwd), "changed", f"sed -i {script or ''}".strip()))
            continue
        pure = False
        if re.fullmatch(r"python[\d.]*", cmd):
            code = stdin if stdin is not None and (len(words) == 1 or words[-1] == "-") else None
            if "-c" in words[:-1]:
                code = words[words.index("-c") + 1]
            if code is not None:
                for path, pairs in python_changes(code, cwd):
                    out.append((path, "pairs", pairs) if pairs else (path, "changed", "a Python script"))
        for _, path in to:                               # git diff > x.patch, ... > log
            out.append((path, "changed", " ".join(words)[:200]))
    out = [c for c in out if c[0] is not None]       # a path not known: left out
    return out, pure and bool(out)


# git's commands that change a checkout's files (`git worktree list`, `git stash list` among them: changing nothing, no harm)
GIT_CHANGES = frozenset({"pull", "merge", "checkout", "switch", "reset", "rebase", "stash", "cherry-pick", "revert",
                         "restore", "clone", "am", "apply", "worktree", "rm", "mv", "clean", "submodule"})
GIT_TAKES = frozenset({"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"})   # its options with a value


def runs_git(command: str) -> bool:
    """Whether a shell command runs git so as to change a checkout's files: a pull, a merge, a checkout ... (GIT_CHANGES),
    `gh pr checkout` too -- the files git writes then are the repository's, not the command's own work."""
    for words, _ in _simple_commands(command) or []:
        words = [w.strip("()") for w in words]           # (cd x && git pull)
        while words and (ASSIGNMENT.fullmatch(words[0]) or words[0] in ("env", "command", "time", "nohup")):
            words = words[1:]                            # GIT_EDITOR=true git merge ...
        cmd = os.path.basename(words[0]) if words else ""
        if cmd == "gh" and words[1:3] in (["pr", "checkout"], ["repo", "clone"]):
            return True
        if cmd != "git":
            continue
        k = 1
        while k < len(words) and words[k].startswith("-"):
            k += 2 if words[k] in GIT_TAKES else 1      # git -C <path> pull
        if k < len(words) and words[k] in GIT_CHANGES:
            return True
    return False


WORKTREE_TAKES = frozenset({"-b", "-B", "--reason"})   # `git worktree add`'s options with a value


def worktrees_added(command: str, cwd: str) -> List[str]:
    """The work trees a shell command makes with `git worktree add <path>`: their paths, from where it runs (its `cd`s
    and git's -C followed, the variables it sets filled in) -- the files git checks out there are the repository's,
    not the command's own work. One not known (a variable it didn't set) is left out."""
    out, env = [], {}
    for words, _ in _simple_commands(command) or []:
        words = [w.strip("()") for w in words]           # (cd x && git worktree add ...)
        if words and all(ASSIGNMENT.fullmatch(w) for w in words):   # WT=../x
            for w in words:
                k, v = w.split("=", 1)
                env[k] = _expand(v, env)
            continue
        while words and (ASSIGNMENT.fullmatch(words[0]) or words[0] in ("env", "command", "time", "nohup")):
            words = words[1:]
        words = [_expand(w, env) for w in words]
        cmd = os.path.basename(words[0]) if words else ""
        if cmd == "cd" and len(words) == 2:
            cwd = _path(words[1], cwd)
            continue
        if cmd != "git":
            continue
        k, here = 1, cwd
        while k < len(words) and words[k].startswith("-"):
            if words[k] == "-C" and k + 1 < len(words):
                here = _path(words[k + 1], here)
            k += 2 if words[k] in GIT_TAKES else 1
        if words[k:k + 2] != ["worktree", "add"]:
            continue
        k += 2
        while k < len(words) and words[k].startswith("-"):
            k += 2 if words[k] in WORKTREE_TAKES else 1
        path = _path(words[k], here) if k < len(words) else None
        if path:
            out.append(path)
    return out


def _fold(node, env):
    """A Python expression's value when it is made of string constants: a str, or a list/tuple of them
    (nested); None otherwise."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name):
        return env.get(node.id)
    if isinstance(node, ast.BinOp):
        a, b = _fold(node.left, env), _fold(node.right, env)
        if isinstance(a, str) and isinstance(b, str):
            return a + b if isinstance(node.op, ast.Add) else os.path.join(a, b) if isinstance(node.op, ast.Div) else None
        return None
    if isinstance(node, (ast.List, ast.Tuple)):
        items = [_fold(e, env) for e in node.elts]
        return None if any(i is None for i in items) else tuple(items)
    if isinstance(node, ast.Call):
        f = ast.unparse(node.func)
        args = [_fold(a, env) for a in node.args]
        if args and all(isinstance(a, str) for a in args):
            if f in ("Path", "pathlib.Path", "PurePath", "os.path.join"):
                return os.path.join(*args)
            if f == "os.path.expanduser":
                return os.path.expanduser(args[0])
        if isinstance(node.func, ast.Attribute) and node.func.attr in ("expanduser", "resolve") and not node.args:
            return _fold(node.func.value, env)
    return None


WRITE_MODE = re.compile(r"[wax]")


class _Script:
    """A Python script read without running it: the files it writes, and the replacements (made of
    string constants) it made in the text it wrote to each."""

    def __init__(self, cwd: str):
        self.cwd, self.env, self.helpers = cwd, {}, {}
        self.pending: List[tuple] = []
        self.out: Dict[str, List[tuple]] = {}

    def target(self, path) -> None:
        if not isinstance(path, str):
            return
        path = _path(path, self.cwd)
        if path is None:
            return
        self.out.setdefault(path, []).extend(self.pending)
        self.pending = []

    def body(self, stmts) -> None:
        for st in stmts:
            self.stmt(st)

    def stmt(self, st) -> None:
        if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)):
            self.helper(st)
            return
        if isinstance(st, ast.ClassDef):
            return
        if isinstance(st, ast.For):
            self.calls(st.iter)
            pairs = _fold(st.iter, self.env)
            names = [e.id for e in st.target.elts] if isinstance(st.target, ast.Tuple) and all(
                isinstance(e, ast.Name) for e in st.target.elts) else [st.target.id] if isinstance(st.target, ast.Name) else []
            if isinstance(pairs, tuple) and names:
                for item in pairs:                          # for old, new in reps: each pair, in turn
                    item = item if len(names) > 1 else (item,)
                    if isinstance(item, tuple) and len(item) == len(names):
                        self.env.update(zip(names, item))
                        self.body(st.body)
            else:
                for n in names:
                    self.env.pop(n, None)
                self.body(st.body)
            self.body(st.orelse)
            return
        if isinstance(st, (ast.With, ast.AsyncWith)):
            for item in st.items:
                self.calls(item.context_expr)
                if isinstance(item.optional_vars, ast.Name):
                    self.env.pop(item.optional_vars.id, None)
            self.body(st.body)
            return
        if isinstance(st, (ast.If, ast.While, ast.Try)):
            self.calls(getattr(st, "test", None))
            for part in ("body", "orelse", "finalbody"):
                self.body(getattr(st, part, []))
            for h in getattr(st, "handlers", []):
                self.body(h.body)
            return
        self.calls(st)
        if isinstance(st, ast.Assign):
            value = _fold(st.value, self.env)
            for t in st.targets:
                if isinstance(t, ast.Name):
                    self.env[t.id] = value
                elif isinstance(t, ast.Tuple) and isinstance(value, tuple) and len(value) == len(t.elts):
                    for e, v in zip(t.elts, value):
                        if isinstance(e, ast.Name):
                            self.env[e.id] = v
            for t in st.targets:
                for n in ast.walk(t):
                    if isinstance(n, ast.Name) and self.env.get(n.id) is None:
                        self.env.pop(n.id, None)

    def calls(self, node) -> None:
        """The calls in `node`, innermost first: what they replace, and what they write."""
        if node is None or isinstance(node, (ast.Lambda, ast.FunctionDef)):
            return
        for child in ast.iter_child_nodes(node):
            self.calls(child)
        if not isinstance(node, ast.Call):
            return
        f, args = node.func, node.args
        if isinstance(f, ast.Attribute) and f.attr == "replace" and len(args) >= 2:
            a, b = _fold(args[0], self.env), _fold(args[1], self.env)
            if isinstance(a, str) and isinstance(b, str) and a != b:
                self.pending.append((a, b))
        elif isinstance(f, ast.Name) and f.id == "open" and args:
            mode = args[1] if len(args) > 1 else next((k.value for k in node.keywords if k.arg == "mode"), None)
            mode = _fold(mode, self.env) if mode is not None else "r"
            if isinstance(mode, str) and WRITE_MODE.search(mode):
                self.target(_fold(args[0], self.env))
        elif isinstance(f, ast.Attribute) and f.attr in ("write_text", "write_bytes"):
            self.target(_fold(f.value, self.env))
        elif ast.unparse(f) in ("shutil.copy", "shutil.copyfile", "shutil.copy2", "shutil.move", "os.rename", "os.replace") \
                and len(args) == 2:
            self.target(_fold(args[1], self.env))
        elif isinstance(f, ast.Name) and f.id in self.helpers:
            h, given = self.helpers[f.id], {}
            for i, a in enumerate(args):
                if i < len(h["params"]):
                    given[h["params"][i]] = _fold(a, self.env)
            for k in node.keywords:
                given[k.arg] = _fold(k.value, self.env)
            for old, new in h["replaces"]:
                a, b = given.get(old, self.env.get(old)), given.get(new, self.env.get(new))
                if isinstance(a, str) and isinstance(b, str) and a != b:
                    self.pending.append((a, b))
            for w in h["writes"]:
                self.target(given[w] if w in given else self.env.get(w))

    def helper(self, fn) -> None:
        """A function the script defines: which of its names it replaces with which, and writes to."""
        h = {"params": [a.arg for a in fn.args.args], "replaces": [], "writes": []}
        for n in ast.walk(fn):
            if not isinstance(n, ast.Call):
                continue
            f, args = n.func, n.args
            if isinstance(f, ast.Attribute) and f.attr == "replace" and len(args) >= 2 \
                    and all(isinstance(a, ast.Name) for a in args[:2]):
                h["replaces"].append((args[0].id, args[1].id))
            elif isinstance(f, ast.Name) and f.id == "open" and len(args) > 1 and isinstance(args[0], ast.Name) \
                    and isinstance(args[1], ast.Constant) and WRITE_MODE.search(str(args[1].value)):
                h["writes"].append(args[0].id)
        self.helpers[fn.name] = h


def python_changes(code: str, cwd: str) -> List[tuple]:
    """The files a Python script writes, each with the replacements it made in it: [(path, [(old, new)])].
    Read, not run: a replacement counts when its two strings are constants (or names, lists and helper
    functions made of them), and goes to the next file the script writes -- or, when it writes one
    file only, to that one."""
    try:
        tree = ast.parse(code)
    except (SyntaxError, ValueError):
        return []
    s = _Script(cwd)
    s.body(tree.body)
    if s.pending and len(s.out) == 1:
        next(iter(s.out.values())).extend(s.pending)
    return list(s.out.items())


def _patch_files(text: str):
    """A codex apply_patch's files: [(path, "add"/"update"/"delete", hunks)], each hunk (old, new) lines."""
    out, cur, hunk = [], None, None
    for line in text.split("\n"):
        m = re.match(r"^\*\*\* (Add|Update|Delete) File: (.+)$", line)
        if m:
            cur = [m.group(2).strip(), m.group(1).lower(), []]
            out.append(cur)
            hunk = None
            continue
        if cur is None or line.startswith("*** "):
            continue
        if line.startswith("@@"):
            hunk = ([], [])
            cur[2].append(hunk)
            continue
        if hunk is None:
            hunk = ([], [])
            cur[2].append(hunk)
        if line.startswith("+"):
            hunk[1].append(line[1:])
        elif line.startswith("-"):
            hunk[0].append(line[1:])
        elif line.startswith(" ") or line == "":
            hunk[0].append(line[1:]); hunk[1].append(line[1:])
    return out


# ------------------------------------------------------------------ codex's code mode: the calls a script makes

CODE_MODE = "exec"          # codex's code-mode tool: a JavaScript script, which calls the others as `tools.<name>(...)`
TOOL_AT = re.compile(r"tools\s*\.\s*([A-Za-z_$][\w$]*)\s*\(")
PRINT_AT = re.compile(r"text\s*\(")
BOUND = re.compile(r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+tools\s*\.")
KEY = re.compile(r"[A-Za-z_$][\w$]*|\d+")
NUMBER = re.compile(r"-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")
WORDS = {"true": True, "false": False, "null": None, "undefined": None}
ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}
SCRIPT_HEAD = re.compile(r"^Script (completed|failed|terminated|error|running)[^\n]*\n(?:Wall time[^\n]*\n)?"
                         r"(?:Output:\n\n?)?")


class _NotLiteral(Exception):
    """An argument a script does not write out: a variable, an expression, a template with ${...}."""


def _skip(s: str, i: int) -> int:
    """Where the string at s[i] (', " or `) ends -- a template's ${...} skipped whole -- read loosely:
    for finding the code around it, not its value."""
    q, i = s[i], i + 1
    while i < len(s):
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if c == q or (c == "\n" and q != "`"):
            return i + 1
        if q == "`" and s.startswith("${", i):
            depth, i = 1, i + 2
            while i < len(s) and depth:
                if s[i] in "'\"`":
                    i = _skip(s, i)
                    continue
                depth += {"{": 1, "}": -1}.get(s[i], 0)
                i += 1
            continue
        i += 1
    return i


def _code(s: str):
    """Each position of a script that is code, not in a string or a comment, in order."""
    i = 0
    while i < len(s):
        if s[i] in "'\"`":
            i = _skip(s, i)
        elif s.startswith("//", i):
            j = s.find("\n", i)
            i = len(s) if j < 0 else j
        elif s.startswith("/*", i):
            j = s.find("*/", i + 2)
            i = len(s) if j < 0 else j + 2
        else:
            yield i
            i += 1


def _space(s: str, i: int) -> int:
    """Past the spaces and comments at s[i]."""
    while i < len(s):
        if s[i].isspace():
            i += 1
        elif s.startswith("//", i):
            j = s.find("\n", i)
            i = len(s) if j < 0 else j
        elif s.startswith("/*", i):
            j = s.find("*/", i + 2)
            i = len(s) if j < 0 else j + 2
        else:
            break
    return i


def _string(s: str, i: int) -> Tuple[str, int]:
    """The string at s[i] (', " or `) as JavaScript reads it, and where it ends; a template with ${...}
    in it is not a literal."""
    q, i, out = s[i], i + 1, []
    while i < len(s):
        c = s[i]
        if c == q:
            text = "".join(out)
            try:                                         # a pair of \u escapes: the one character they are
                return text.encode("utf-16", "surrogatepass").decode("utf-16"), i + 1
            except UnicodeError:
                return text, i + 1
        if c == "\\" and i + 1 < len(s):
            e = s[i + 1]
            if e == "u" and s[i + 2:i + 3] == "{":
                end = s.index("}", i + 3)
                out.append(chr(int(s[i + 3:end], 16)))
                i = end + 1
            elif e in "ux":
                n = 4 if e == "u" else 2
                out.append(chr(int(s[i + 2:i + 2 + n], 16)))
                i += 2 + n
            elif e in "\r\n":                                  # a line continued
                i += 3 if s.startswith("\r\n", i + 1) else 2
            else:
                out.append(ESCAPES.get(e, e))
                i += 2
            continue
        if q == "`" and s.startswith("${", i) or c == "\n" and q != "`":
            raise _NotLiteral
        out.append(c)
        i += 1
    raise _NotLiteral


def _literal(s: str, i: int) -> Tuple[Any, int]:
    """The value written at s[i] -- a string, a number, true/false/null, or an array or object of them
    -- and where it ends; anything else is not a literal."""
    i = _space(s, i)
    c = s[i:i + 1]
    if c in ("'", '"', "`"):
        return _string(s, i)
    if c in ("{", "["):
        close, out, i = "}" if c == "{" else "]", {} if c == "{" else [], i + 1
        while True:
            i = _space(s, i)
            if s[i:i + 1] == close:
                return out, i + 1
            if c == "[":
                value, i = _literal(s, i)
                out.append(value)
            else:
                if s[i:i + 1] in ("'", '"'):
                    key, i = _string(s, i)
                else:
                    m = KEY.match(s, i)
                    if not m:
                        raise _NotLiteral                  # a spread, a computed key
                    key, i = m.group(0), m.end()
                i = _space(s, i)
                if s[i:i + 1] != ":":
                    raise _NotLiteral                      # {cmd}: a variable's value; a method
                out[key], i = _literal(s, i + 1)
            i = _space(s, i)
            if s[i:i + 1] == ",":
                i += 1
            elif s[i:i + 1] != close:
                raise _NotLiteral                          # an expression: "a" + b
    m = NUMBER.match(s, i)
    if m:
        number = float(m.group(0))
        return int(number) if number.is_integer() and "." not in m.group(0) else number, m.end()
    m = KEY.match(s, i)
    if m and m.group(0) in WORDS:
        return WORDS[m.group(0)], m.end()
    raise _NotLiteral


def _after(s: str, i: int) -> bool:
    """Whether s[i] starts a name of its own: not the end of a longer one, or a property (`x.tools`)."""
    return i == 0 or not (s[i - 1].isalnum() or s[i - 1] in "_$.")


def script_calls(script: str) -> List[Tuple[str, Any]]:
    """The tools a codex code-mode script calls (`tools.<name>(...)`), in the order written: (name, its
    argument -- a string, or an object of literals), the argument None where the script does not write it
    out (a variable, an expression, a template with ${...}). A call in a loop is listed once."""
    s, out = script if isinstance(script, str) else "", []
    for i in _code(s):
        m = TOOL_AT.match(s, i)
        if not m or not _after(s, i):
            continue
        try:
            arg, end = _literal(s, m.end())
            if s[_space(s, end):_space(s, end) + 1] not in (")", ","):
                raise _NotLiteral                          # "cat " + name
        except (_NotLiteral, ValueError, IndexError, OverflowError):
            arg = None
        out.append((m.group(1), arg))
    return out


def _inside(s: str, i: int) -> str:
    """What is between the parenthesis at s[i] and the one that closes it."""
    depth, j = 0, i
    while j < len(s):
        c = s[j]
        if c in "'\"`":
            j = _skip(s, j)
            continue
        depth += {"(": 1, ")": -1}.get(c, 0)
        if depth == 0:
            return s[i + 1:j]
        j += 1
    return s[i + 1:]


def script_prints_result(script: str) -> bool:
    """Whether a script prints its call's output and nothing else: one `text(...)`, of `r.output` (`r` the
    call's result: `const r = await tools.exec_command(...)`) or `(await tools.exec_command(...)).output`.
    What it printed is then the command's own output."""
    s = script if isinstance(script, str) else ""
    bound = {m.group(1) for m in BOUND.finditer(s)}
    said = []
    for i in _code(s):
        m = PRINT_AT.match(s, i)
        if m and _after(s, i):
            said.append(_inside(s, m.end() - 1).strip())
    if len(said) != 1:
        return False
    m = re.fullmatch(r"([A-Za-z_$][\w$]*)\.output", said[0])
    return bool(m and m.group(1) in bound or re.fullmatch(r"\(\s*await\s+tools\s*\.[\s\S]*\)\s*\)\.output", said[0]))


def script_output(text: str) -> Tuple[str, Optional[str]]:
    """What a code-mode script printed, without codex's head before it, and how the script ended:
    "completed", "failed" (failed, terminated, an error), "running" (it yielded, still at work), or None
    when the text has no head."""
    m = SCRIPT_HEAD.match(text or "")
    if not m:
        return text or "", None
    how = m.group(1)
    return text[m.end():], "completed" if how == "completed" else "running" if how == "running" else "failed"


def opened_script(call_id: str, script: str, result: Optional[Tuple[str, bool]] = None) -> List[tuple]:
    """A code-mode call as the calls its script makes, each a call of its own: [(id, name, input, result)]
    -- one call keeps the script's id, several are each `<id>#<n>`; none found: []. `result`, the script's
    (text, failed), gives each its own: to a lone call whose output is all the script printed, that
    output; to any other, "" -- what it showed of files then not known; failed when the script failed."""
    calls = script_calls(script)
    if not calls:
        return []
    text, how = script_output(result[0]) if result else ("", None)
    failed = bool(result and (result[1] or how == "failed"))
    whole = len(calls) == 1 and how == "completed" and script_prints_result(script)
    return [(call_id if len(calls) == 1 else f"{call_id}#{n}", name, arg,
             None if result is None else (text if whole else "", failed))
            for n, (name, arg) in enumerate(calls, 1)]
