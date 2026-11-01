"""What an actor at work is doing, for its avatar to act out in the Chat view (page.html's stages): the
kind of call it is making, and how the calls it made ended.

A call's kind is read from what its harness's rules say it does (harness_kit's Action, and its view's Shape), or for a
shell command from the programs it runs:

    read     reading files, listing them, looking at git's history, querying a database
    search   grep, find, glob, the web
    edit     an edit tool; a shell command that only writes files (sed -i, cat > f, mv, a Python
             script that replaces strings in a file); git's commands that change the working tree
    test     a test runner (unittest, pytest, jest, go test, ...)
    run      any other program: a script, a server, an install
    ship     a commit, a push, a pull request opened or merged, a page published
    wait     sleep, a loop that polls, a background task watched
    team     a subagent, a workflow

A shell command that runs several is the first of these it does: test, ship, run, edit, wait, search,
read (`grep x f | head` searches; `sed -i ... && python -m unittest` tests)."""
import os
import re
from typing import List, Optional

from harness_kit import Action, Shape
from harness_kit.shell import _simple_commands, shell_changes

KINDS = ("test", "ship", "run", "edit", "wait", "search", "read")    # most first: what a command of several is
#: A tool call's kind by what it does (harness_kit's Action); a shell command's, by what it runs.
ACTIONS = {Action.READ: "read", Action.SKILL: "read", Action.SEARCH: "search", Action.WEB: "search",
           Action.EDIT: "edit", Action.ASK: "wait", Action.TASK: "wait", Action.DELEGATE: "team", Action.PUBLISH: "ship"}
TEST = re.compile(r"\b(?:unittest|pytest|py\.test|nosetests|tox|jest|vitest|mocha|karma|rspec|phpunit|ctest)\b"
                  r"|\b(?:go|cargo|npm|yarn|pnpm|bun|deno|mix|dotnet|swift|make)\s+(?:run\s+)?test\b")
# what a test run's output says when some failed: unittest's, pytest's, jest's, go's, cargo's
TESTS_FAILED = re.compile(r"^FAILED\b|\bFAILED \(|\b[1-9]\d* (?:failed|errors?)\b|^FAIL\b|^--- FAIL|^not ok\b"
                          r"|test result: FAILED", re.M)
READS = {"cat", "sed", "head", "tail", "less", "more", "nl", "wc", "ls", "tree", "stat", "file", "diff", "cmp", "du",
         "df", "jq", "yq", "sqlite3", "psql", "mysql", "ps", "lsof", "pgrep", "pwd", "which", "whereis", "type",
         "realpath", "readlink", "basename", "dirname", "date", "env", "printenv", "uname", "hexdump", "xxd", "od",
         "strings", "md5", "shasum", "sort", "uniq", "cut", "tr", "awk", "column", "echo", "printf", "id", "whoami"}
SEARCHES = {"grep", "egrep", "fgrep", "rg", "ag", "ack", "find", "fd", "locate", "mdfind", "curl", "wget", "http"}
EDIT_PROGRAMS = {"mv", "cp", "rm", "mkdir", "rmdir", "touch", "ln", "chmod", "chown", "tee", "patch", "truncate",
                 "install", "rsync", "unzip"}
WAITS = {"sleep", "wait"}
NOTHING = {"cd", "export", "set", "unset", "source", ".", "true", "false", ":", "[", "[[", "test", "local", "shift",
           "trap", "pushd", "popd", "alias", "break", "continue", "exit", "return", "read"}
PREFIXES = {"sudo", "env", "time", "nohup", "exec", "command", "builtin", "xargs", "nice"}
KEYWORDS = {"do", "then", "else", "elif", "{", "(", "!", "if", "while", "until", "for", "case", "done", "fi", "esac",
            "}", ")", "in"}
GIT_READS = {"log", "diff", "show", "status", "blame", "branch", "remote", "rev-parse", "ls-files", "describe",
             "shortlog", "reflog", "config", "rev-list", "cat-file", "ls-tree", "merge-base", "name-rev"}
GIT_SHIPS = {"commit", "push", "tag"}
ASSIGNMENT = re.compile(r"[A-Za-z_]\w*=.*", re.S)
PYTHON = re.compile(r"^python[\d.]*$")


def _program(words: List[str]) -> List[str]:
    """A simple command's words from its program on: its variables set before it, a `sudo` or `env`
    before it, and a shell keyword (`do`, `then`) left out."""
    w = list(words)
    if w and w[0].startswith("#"):                    # a comment
        return []
    while w and (ASSIGNMENT.fullmatch(w[0]) or w[0] in PREFIXES or w[0] in KEYWORDS or w[0].startswith("-")):
        if w[0] in ("for", "case"):                   # `for f in a b`: its words name no program
            return []
        w = w[1:]
    return w


def _one(words: List[str], redirs) -> Optional[str]:
    """The kind of one simple command: None for one that does nothing of its own (cd, export)."""
    w = _program(words)
    if not w:
        return "edit" if any(op in (">", ">>", ">|", "&>", "&>>") for op, _ in redirs) else None
    prog = os.path.basename(w[0])
    if prog == "git":
        rest = w[1:]
        while rest and rest[0].startswith("-"):      # its own options: -C <dir>, -c <name=value>, --no-pager
            rest = rest[2:] if rest[0] in ("-C", "-c") else rest[1:]
        sub = rest[0] if rest else ""
        return "read" if sub in GIT_READS else "search" if sub == "grep" else "ship" if sub in GIT_SHIPS else "edit"
    if prog == "gh":
        return "ship" if re.search(r"\b(?:pr (?:create|merge)|release create)\b", " ".join(w[1:3])) else "read"
    if prog in WAITS:
        return "wait"
    if prog in ("sed", "perl") and any(x.startswith("-i") or x.startswith("-pi") for x in w[1:]):
        return "edit"
    writes = any(op in (">", ">>", ">|", "&>", "&>>") and t not in ("/dev/null", "/dev/stdout", "/dev/stderr")
                 for op, t in redirs)
    if prog in SEARCHES:
        return "search"
    if prog in READS:
        return "edit" if writes and prog in ("cat", "echo", "printf") else "read"
    if prog in EDIT_PROGRAMS:
        return "edit"
    if prog in NOTHING:
        return None
    return "run"


def doing(action: Optional[str], view: Optional[dict] = None) -> str:
    """The kind of a call that does `action`, shown as `view` (harness_kit's ToolCall.action and .view; the module doc):
    "run" when nothing tells -- an MCP server's tool, or one its harness's rules do not know."""
    view = view or {}
    if view.get("shape") == Shape.TODO:               # its plan, kept up to date
        return "edit"
    if view.get("shape") != Shape.SHELL:
        return ACTIONS.get(action or "", "run")
    command = str(view.get("command") or "")
    if TEST.search(command):
        return "test"
    cmds = _simple_commands(command)
    if cmds is None:
        return "run"
    kinds = {k for k in (_one(w, r) for w, r in cmds) if k}
    runs = {os.path.basename(_program(w)[0]) for w, r in cmds if _one(w, r) == "run"}
    if kinds <= {"run", "edit", "read", "search"} and runs and all(PYTHON.match(p) for p in runs) \
            and shell_changes(command, "/")[0]:
        return "edit"                                 # a Python script that writes files (its replacements)
    return next((k for k in KINDS if k in kinds), "run")


def ok(kind: str, error: bool, output: str) -> bool:
    """Whether a call of `kind` that ended so went well: not an error, and for tests none failed (a run piped
    through `tail` exits as tail does)."""
    return not error and not (kind == "test" and TESTS_FAILED.search(output or ""))


def summary(calls: List[dict]) -> dict:
    """What an actor's turn is doing, from its calls in order ({id, kind, ended (when its result came, None:
    running; `seq`, the order results came in, apart from that), ok}): {doing: the kind of its newest call running (None: none), last: the kind of its newest
    call, running or not (None: none yet), helpers: its subagents running, ended: its newest call ended
    ({id, kind, ok, at}, None: none), failed: the calls that failed in a row, newest back}."""
    running = [c for c in calls if c["ended"] is None]
    done = [c for c in calls if c["ended"] is not None]
    came = lambda c: (c["ended"], c.get("seq", 0))
    last = max(done, key=came) if done else None
    failed = 0
    for c in sorted(done, key=came, reverse=True):
        if c["ok"]:
            break
        failed += 1
    return {"doing": running[-1]["kind"] if running else None, "last": calls[-1]["kind"] if calls else None,
            "helpers": sum(1 for c in running if c["kind"] == "team"),
            "ended": {"id": last["id"], "kind": last["kind"], "ok": last["ok"], "at": last["ended"]} if last else None,
            "failed": failed}
