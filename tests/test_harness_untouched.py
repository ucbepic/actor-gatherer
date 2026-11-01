"""A new harness, the dashboard untouched (harness_kit/DESIGN.md): the dashboard's code names no harness -- what it knows
of one it reads through harness_kit -- and a harness registered from outside (a toy one, here) is listed, started and
drawn by the dashboard as it is, with nothing of the dashboard changed for it."""
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import textwrap
import tokenize
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import harness_kit  # noqa: E402

DASHBOARD = os.path.join(ROOT, "ag_dashboard")
NAMES = set(harness_kit.HARNESSES) | {"agy"}                      # agy: Antigravity's command
LONG = sorted(n for n in NAMES if len(n) >= 5)                    # named in any text; a short one ("pi") only whole
LABELS = sorted({h.label for h in harness_kit.HARNESSES.values() if h.label})
IN_TEXT = re.compile(r"(?i:%s)|\b(?:%s)\b" % ("|".join(LONG), "|".join(map(re.escape, LABELS))))
IDENT = re.compile(r"(?i)(?:^|_)(?:%s)(?:_|$)" % "|".join(sorted(NAMES - {"pi"})))   # codex_rules, _claude_status, AGY_HEAD
MODULE = re.compile(r"harness_kit\.(?:%s)\b|from harness_kit import [^\n#]*\b(?:%s)\b" % ("|".join(NAMES), "|".join(NAMES)))

#: What the dashboard's code may still say that names a harness, and why it is not a harness's rule: (file, the words).
ALLOWED = {
    ("data.py", '"codex"'): "the Gatherer model's providers (codex/..., claude-code/...): a model, not a session's harness",
    ("data.py", '"claude-code"'): "the same",
    ("settings.py", '"name a model, e.g. claude-code/sonnet or gemini/gemini-3.8-flash"'): "a Gatherer model's name, as an example",
    ("page.html", '"No model set: every Gatherer call fails until one is. A coding agent on its own login (claude-code/'):
        "the same, in Settings",
    ("history.py", '"""\n\nFrom it, write an AGENTS.md: the standing instructions coding agents (Claude Code, Codex'):
        "what the Gatherer's model is asked for: who reads an AGENTS.md",
    ("history.py", '"claude"'): "a History record's kind (a CLAUDE.md, made before AGENTS.md), not a harness",
    ("page.html", '"claude"'): "the same",
    ("page.html", "claude"): "the same (HIST_KINDS.claude)",
    ("page.html", '"CLAUDE.md"'): "the same: its file's name",
}


def _said(text: str) -> bool:
    return text in NAMES or bool(IN_TEXT.search(text))


def python_names(path: str) -> list:
    """Where a dashboard module's code names a harness: a string (not a docstring) that is one's name, or holds its
    label or a long name; an identifier with a harness's name for a part; an import of a harness's module. Comments
    and docstrings say what they like."""
    with open(path, encoding="utf-8") as fh:
        src = fh.read()
    out, prev = [], tokenize.NEWLINE
    for t in tokenize.generate_tokens(io.StringIO(src).readline):
        if t.type in (tokenize.COMMENT, tokenize.NL):
            continue
        if t.type == tokenize.STRING and prev not in (tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT):
            body = re.sub(r"^[A-Za-z]*('''|\"\"\"|'|\")|('''|\"\"\"|'|\")$", "", t.string)
            if _said(body):
                out.append((t.start[0], t.string[:100]))
        elif t.type == getattr(tokenize, "FSTRING_MIDDLE", -1) and _said(t.string):
            out.append((t.start[0], t.string[:100]))
        elif t.type == tokenize.NAME and IDENT.search(t.string):
            out.append((t.start[0], t.string))
        prev = t.type
    out += [(i, line.strip()[:100]) for i, line in enumerate(src.split("\n"), 1)
            if MODULE.search(line) and not line.lstrip().startswith("#")]
    return out


LITERAL = re.compile(r'"(?:[^"\\\n]|\\.)*"|\'(?:[^\'\\\n]|\\.)*\'|`(?:[^`\\\n]|\\.)*`')


def page_names(path: str) -> list:
    """The same for the page's script, line by line: comments (a line's own, or after ` // `) say what they like."""
    out, inside = [], False
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().split("\n")
    for i, line in enumerate(lines, 1):
        inside = (inside or "<script" in line) and "</script>" not in line
        if not inside or line.strip().startswith(("//", "/*", "*")):
            continue
        code = re.split(r"\s//\s", re.sub(r"/\*.*?\*/", "", line))[0]
        out += [(i, m.group(0)[:100]) for m in LITERAL.finditer(code) if _said(m.group(0)[1:-1])]
        out += [(i, m.group(0)) for m in re.finditer(r"[A-Za-z_$][\w$]*", LITERAL.sub('""', code)) if IDENT.search(m.group(0))]
    return out


class DashboardNamesNoHarnessTest(unittest.TestCase):
    def test_the_dashboard_s_code_names_no_harness(self):
        found = []
        for name in sorted(os.listdir(DASHBOARD)):
            path = os.path.join(DASHBOARD, name)
            got = python_names(path) if name.endswith(".py") else page_names(path) if name == "page.html" else []
            found += [f"{name}:{line}: {what}" for line, what in got
                      if not any(f == name and what.startswith(words) for f, words in ALLOWED)]
        self.assertEqual(found, [], "a harness's rule in the dashboard: put it in its harness_kit class, and read it "
                                    "through a generic field (harness_kit/DESIGN.md)")

    def test_it_would_be_found(self):
        """The checks themselves: what the old dashboard had is found; what is only words about one is not."""
        with tempfile.TemporaryDirectory() as tmp:
            mod = os.path.join(tmp, "m.py")
            with open(mod, "w") as fh:
                fh.write('"""Claude Code\'s, codex\'s."""\nfrom harness_kit import claude as claude_rules\n'
                         'if h == "codex":  # Claude Code\n    x = CODEX_HEAD\n    y = f"{a} Claude Code {b}"\n'
                         'z = "-pi"\nw = "pi"\n')
            self.assertEqual([line for line, _ in python_names(mod)], [2, 2, 3, 4, 5, 7, 2])
            page = os.path.join(tmp, "page.html")
            with open(page, "w") as fh:
                fh.write('<script>\n// codex\'s\nconst x = h === "codex" ? 1 : 2;   // Codex\nconst AGY_HEAD = 1;\n'
                         'const u = "http://x" + (h === "codex");\nconst v = `Or tell ${who} what`;  // not Claude\n'
                         'const w = `Or tell Claude what`;\n</script>\n')
            self.assertEqual([line for line, _ in page_names(page)], [3, 4, 5, 7])


#: A harness of the test's own, registered before the dashboard loads -- as one in a package of its own would be --
#: then listed, started headless (a fake ag stands in for it) and drawn, all by the dashboard as it is.
TOY = textwrap.dedent(r'''
    import json, os, sqlite3, sys, time
    sys.path.insert(0, sys.argv[1])
    import harness_kit
    from harness_kit import Action, Harness, Kind, Part, Shape, ToolCall, ToolResult

    class Toy(Harness):
        """Its messages are {say}, {ask}, {look, id} (a read) and {run, id} (a shell command), {saw, id} a result."""
        name, label = "toy", "Toy"
        headless = "turn"
        session_env = ("TOY_SESSION",)
        memory_folder = r"/\.toy/memory/([^/]+)"

        def own_folders(self, env=None):
            return [os.path.join(os.environ["TOY_TMP"], ".toy")]

        def command(self, session, resume=False, model=None, permission_mode=None, fullscreen=True, instructions=None):
            return ["--session", session, *(["--resume"] if resume else [])]

        def headless_args(self, session, resume=False, model=None, permission_mode=None, instructions=None, extra=()):
            return ["run", "--session", session, *(["--resume"] if resume else []), "-"]

        def headless_event(self, event):
            return {"ended": True, "error": event.get("why")} if event.get("kind") == "done" else None

        def items(self, history):
            return list(history)

        def read(self, items):
            out = []
            for x in items:
                if "say" in x:
                    out.append(Part(Kind.AGENT, "assistant", x["say"]))
                elif "ask" in x:
                    out.append(Part(Kind.USER, "user", x["ask"], words=x["ask"]))
                elif "look" in x:
                    out.append(Part(Kind.TOOL_CALL, "assistant", tool=ToolCall(x["id"], "look", {"file": x["look"]}, Action.READ,
                                    [x["look"]], view={"shape": Shape.READ, "title": "Look", "path": x["look"]})))
                elif "run" in x:
                    out.append(Part(Kind.TOOL_CALL, "assistant", tool=ToolCall(x["id"], "run", {"line": x["run"]}, Action.SHELL,
                                    view={"shape": Shape.SHELL, "title": "Run", "command": x["run"]})))
                elif "saw" in x:
                    out.append(Part(Kind.TOOL_RESULT, "user", x["saw"], result=ToolResult(x["id"], False, x["saw"])))
                else:
                    out.append(Part(Kind.OTHER))
            return out

    harness_kit.register(Toy())
    from ag_dashboard import data, files, home, sessions          # only now: as it loads with the harness there

    tmp = os.environ["TOY_TMP"]
    home.HOME = os.path.join(tmp, "ag")
    cli = os.path.join(tmp, "toy-cli")
    with open(cli, "w") as fh:
        fh.write("#!/bin/sh\n")
    os.chmod(cli, 0o755)
    os.makedirs(home.HOME, exist_ok=True)
    with open(os.path.join(home.HOME, "config.toml"), "w") as fh:
        fh.write(f'[dashboard]\nchat = "headless"\n\n[cli.harnesses.toy]\ncommand = ["{cli}"]\n')
    out = {"listed": {"runnable": "toy" in sessions.HARNESSES, "available": sessions.available(),
                      "info": {k: data.harness_info()["toy"][k] for k in ("label", "runs")}},
           "own": {"folder": os.path.join(tmp, ".toy") in files.HARNESS_FOLDERS, "env": "TOY_SESSION" in sessions.PARENT_SESSION,
                   "memory": files.short_path("/x/.toy/memory/long-key/notes.md", "/w")}}

    s = sessions.Sessions()                                      # started: headless, a turn by the fake ag
    sid = s.create("g", tmp, harness="toy")["session_id"]
    s.send(sid, "hello")
    row = lambda: next(x for x in s.list() if x["session_id"] == sid)
    end = time.time() + 15
    while time.time() < end and not (row()["turns"] == 1 and row()["pid"] is None):
        time.sleep(0.05)
    with open(os.environ["FAKE_AG_LOG"]) as fh:
        run = json.loads(fh.readline())
    out["started"] = {"argv": run["argv"], "stdin": run["stdin"], "turns": row()["turns"], "status": row()["status"],
                      "error": row()["last_error"]}
    s.close()

    db = os.path.join(home.HOME, "gatherers", "g", "context.db")   # drawn: its events, as its hook would store them
    os.makedirs(os.path.dirname(db), exist_ok=True)
    conn = sqlite3.connect(db)
    conn.executescript("""CREATE TABLE IF NOT EXISTS event_types (event_type_id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (row_id INTEGER PRIMARY KEY, inserted_at TEXT NOT NULL, event_id TEXT, event_type_id INTEGER NOT NULL,
          payload_json TEXT NOT NULL, tokens INTEGER NOT NULL, text TEXT, counted INTEGER, p_channel);""")
    for typ, payload in [("model_call", {"kind": "turn", "harness": "toy"}), ("user_message", {"ask": "what is in a.py?"}),
                         ("tool_call", {"look": "/w/a.py", "id": "l1"}), ("tool_output", {"saw": "x = 1", "id": "l1"}),
                         ("tool_call", {"run": "ls /w", "id": "r1"}), ("tool_output", {"saw": "a.py", "id": "r1"}),
                         ("agent_message", {"say": "It sets x."})]:
        got = conn.execute("SELECT event_type_id FROM event_types WHERE name = ?", (typ,)).fetchone()
        tid = got[0] if got else conn.execute("INSERT INTO event_types (name, created_at) VALUES (?, '')", (typ,)).lastrowid
        conn.execute("INSERT INTO events (inserted_at, event_type_id, payload_json, tokens, p_channel) VALUES "
                     "('2026-11-01 08:00:00', ?, ?, 1, 'toy-1')", (tid, json.dumps(payload)))
    conn.commit()
    conn.close()
    parts = [p for typ, x in [("user_message", {"ask": "q"}), ("tool_call", {"look": "/w/a.py", "id": "l1"}),
                              ("tool_output", {"saw": "x = 1", "id": "l1"}), ("agent_message", {"say": "It sets x."})]
             for p in data.parts(typ, json.dumps(x), None, harness="toy")]
    chat = files.files("g", "toy-1", cwd="/w")
    out["drawn"] = {"parts": [{k: p.get(k) for k in ("kind", "role", "text", "name", "view")} for p in parts],
                    "commands": [{k: c.get(k) for k in ("text", "output")} for c in chat["commands"]],
                    "files": [f["path"] for f in chat["files"]]}
    print(json.dumps(out))
''')

#: The fake `ag ... toy run`: its arguments and the message logged, a reply, the turn's end.
FAKE_AG = textwrap.dedent('''
    import json, os, sys
    message = sys.stdin.read()
    with open(os.environ["FAKE_AG_LOG"], "a") as log:
        log.write(json.dumps({"argv": sys.argv[1:], "stdin": message}) + "\\n")
    print(json.dumps({"kind": "say", "text": "hi"}), flush=True)
    print(json.dumps({"kind": "done"}), flush=True)
''')


class ToyHarnessTest(unittest.TestCase):
    def test_a_harness_from_outside_is_listed_started_and_drawn(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = os.path.realpath(tmp)
            for name, text in (("toy.py", TOY), ("fake_ag.py", FAKE_AG)):
                with open(os.path.join(tmp, name), "w") as fh:
                    fh.write(text)
            env = {k: v for k, v in os.environ.items() if k not in ("AG_ACTOR", "AG_DASHBOARD", "ANTHROPIC_BASE_URL")}
            env.update({"TOY_TMP": tmp, "FAKE_AG_LOG": os.path.join(tmp, "fake.log"),
                        "AG_COMMAND": f"{sys.executable} {os.path.join(tmp, 'fake_ag.py')}"})
            got = subprocess.run([sys.executable, os.path.join(tmp, "toy.py"), ROOT], capture_output=True, text=True,
                                 env=env, timeout=120, cwd=tmp)
            self.assertEqual(got.returncode, 0, got.stderr[-3000:])
            out = json.loads(got.stdout.strip().split("\n")[-1])
            sid = out["started"]["argv"][out["started"]["argv"].index("--session") + 1]
        self.assertEqual(out["listed"], {"runnable": True, "available": ["toy"], "info": {"label": "Toy", "runs": True}})
        self.assertEqual(out["own"], {"folder": True, "env": True, "memory": "memory/notes.md"})
        self.assertEqual(out["started"], {"argv": ["--gatherer", "g", "toy", "run", "--session", sid, "-"], "stdin": "hello",
                                          "turns": 1, "status": "stopped", "error": None})
        self.assertEqual(out["drawn"]["parts"], [
            {"kind": "text", "role": "user", "text": "q", "name": None, "view": None},
            {"kind": "call", "role": None, "text": None, "name": "look", "view": {"shape": "read", "title": "Look", "path": "/w/a.py"}},
            {"kind": "result", "role": None, "text": "x = 1", "name": None, "view": None},
            {"kind": "text", "role": "assistant", "text": "It sets x.", "name": None, "view": None}])
        self.assertEqual(out["drawn"]["commands"], [{"text": "look a.py", "output": "x = 1"},   # by its name
                                                     {"text": "ls /w", "output": "a.py"}])
        self.assertEqual(out["drawn"]["files"], ["/w/a.py"])


if __name__ == "__main__":
    unittest.main()
