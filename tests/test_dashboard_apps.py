"""The apps behind one list (ag_dashboard/DESIGN.md, rule 3): only apps.py, the apps' own modules and their routers
name an app (DocWriter, the Browser) -- the rest of the dashboard's server asks what it needs of one through apps.py
-- and each app in apps.APPS gives what that code asks."""
import io
import json
import os
import re
import sys
import tempfile
import tokenize
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from ag_dashboard import apps, mcp, sessions  # noqa: E402

DASHBOARD = os.path.join(ROOT, "ag_dashboard")
OWN = {"apps.py", "docwriter.py", "docwriter_guard.py", "browser.py", "browser_video.py", "api/docwriter.py",
       "api/browser.py"}                                          # the apps' own: they may name them
NAMES = sorted({w.lower() for a in apps.APPS for w in (a.name, a.label)})
SAID = re.compile("(?i)" + "|".join(map(re.escape, NAMES)))        # in any text, and any part of a name: DocWriters

#: What the dashboard's code may still say that names an app, and why it is not about one: (file, words of the line
#: where it is found).
ALLOWED = {
    ("__main__.py", "webbrowser"): "Python's module that opens the page in the user's web browser",
    ("__main__.py", "the browser"): "the user's web browser, which `ag dashboard` opens the page in",
    ("__main__.py", "open a browser"): "the same",
    ("libs.py", '"docwriter", "pdfjs"'): "pdf.js, which the Editor and apps' panels show a PDF in: DocWriter's build "
                                         "puts it in its folder (vendor/docwriter/)",
}


def python_names(path: str) -> list:
    """Where a module's code names an app: (line, what, the line's text) of a string (not a docstring), or an
    f-string's text, that holds one's name, and of an identifier that does. Comments and docstrings say what they
    like."""
    with open(path, encoding="utf-8") as fh:
        src = fh.read()
    lines = src.split("\n")
    out, prev = [], tokenize.NEWLINE
    for t in tokenize.generate_tokens(io.StringIO(src).readline):
        if t.type in (tokenize.COMMENT, tokenize.NL):
            continue
        found = None
        if t.type == tokenize.STRING and prev not in (tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT):
            body = re.sub(r"^[A-Za-z]*('''|\"\"\"|'|\")|('''|\"\"\"|'|\")$", "", t.string)
            found = t.string[:100] if SAID.search(body) else None
        elif t.type == getattr(tokenize, "FSTRING_MIDDLE", -1) and SAID.search(t.string):
            found = t.string[:100]
        elif t.type == tokenize.NAME and SAID.search(t.string):
            found = t.string
        if found is not None:
            out.append((t.start[0], found, lines[t.start[0] - 1].strip()))
        prev = t.type
    return out


def modules() -> list:
    """The dashboard's modules, and its server's routers (api/), as paths from ag_dashboard/."""
    return sorted(n for n in os.listdir(DASHBOARD) if n.endswith(".py")) + \
        sorted("api/" + n for n in os.listdir(os.path.join(DASHBOARD, "api")) if n.endswith(".py"))


def _allowed(name: str, text: str) -> bool:
    return any(f == name and words in text for f, words in ALLOWED)


class OnlyTheAppsNameAnAppTest(unittest.TestCase):
    def test_the_dashboard_s_code_names_no_app_but_the_apps_own(self):
        found = []
        for name in modules():
            if name not in OWN:
                found += [f"{name}:{line}: {what}" for line, what, text in python_names(os.path.join(DASHBOARD, name))
                          if not _allowed(name, text)]
        self.assertEqual(found, [], "an app named outside its own code: ask it through apps.py's App instead "
                                    "(ag_dashboard/DESIGN.md, rule 3)")

    def test_every_allowance_is_still_needed(self):
        used = set()
        for name in modules():
            if name not in OWN:
                used |= {(f, words) for _, _, text in python_names(os.path.join(DASHBOARD, name))
                         for f, words in ALLOWED if f == name and words in text}
        self.assertEqual(set(ALLOWED) - used, set())

    def test_it_would_be_found(self):
        """The check itself: what the dashboard had is found; what is only words about one is not."""
        with tempfile.TemporaryDirectory() as tmp:
            mod = os.path.join(tmp, "m.py")
            with open(mod, "w") as fh:
                fh.write('"""A DocWriter\'s, a Browser\'s."""\nfrom . import browser as bw, docwriter\n'
                         'if role.get("docwriter"):  # a DocWriter\'s\n    x = srv.browsers.compose(row, text)\n'
                         '    y = f"{a} no DocWriter started {b}"\nz = "/browser/w/"\nw = "a page"\n')
            self.assertEqual([line for line, _, _ in python_names(mod)], [2, 2, 3, 4, 5, 6])


class EveryAppGivesTheInterfaceTest(unittest.TestCase):
    """What the shared code asks of an app (apps.py's `App`), each app gives."""

    def test_its_name_says_where_it_is(self):
        self.assertEqual([a.name for a in apps.APPS], ["docwriter", "browser"])
        for a in apps.APPS:
            self.assertIs(apps.named(a.name), a)
            self.assertIs(apps.under(f"/{a.name}/w/0123456789abcdef/mcp"), a)
            self.assertTrue(a.label and issubclass(a.error, ValueError))
            self.assertIn(a.name, a.home_fields)
            self.assertTrue(any(getattr(r, "path", "").startswith(a.path()) for r in a.router().routes))
        self.assertIsNone(apps.named("nope"))
        self.assertIsNone(apps.under("/api/home"))

    def test_a_session_s_role_names_its_app(self):
        """{"<name>": key}: the session is that app's actor -- a role sessions.py takes, found by apps.py's `of` -- and
        no other's; an actor like any other's role is no app's."""
        for a in apps.APPS:
            s = {"role": json.dumps({a.name: "0123456789abcdef"}), "harness": "claude", "cwd": "/w"}
            self.assertTrue(sessions.known_role(s["role"]))
            self.assertIs(apps.of(s), a)
            self.assertEqual([b.name for b in apps.APPS if b.key_of(s) is not None], [a.name])
        for role in (None, "coordinator", json.dumps({"nope": "0123456789abcdef"})):
            self.assertIsNone(apps.of({"role": role}))
            self.assertEqual(sessions.extra_args({"role": role, "harness": "claude"}), [])
        self.assertFalse(sessions.known_role(json.dumps({"nope": "0123456789abcdef"})))

    def test_its_actor_waits_for_its_tools_where_its_harness_is_given_them(self):
        """apps.py's `tools_of`: the endpoint of the app's MCP server (/<name>/w/<key>/mcp) for its actor, where its
        harness takes an MCP server's tools; [] for any other session, and for a harness given none (agy)."""
        for a in apps.APPS:
            role = json.dumps({a.name: "0123456789abcdef"})
            self.assertEqual(apps.tools_of({"role": role, "harness": "claude", "cwd": "/w"}),
                             [f"{a.name}/0123456789abcdef"])
            self.assertEqual(apps.tools_of({"role": role, "harness": "antigravity", "cwd": "/w"}), [])
        for role in (None, "coordinator"):
            self.assertEqual(apps.tools_of({"role": role, "harness": "claude", "cwd": "/w"}), [])


class ListedTest(unittest.TestCase):
    """mcp.py keeps when each endpoint last answered `tools/list` (`listed`), for a first message to wait on."""

    def call(self, method, at, id_=1):
        return mcp.handle(json.dumps({"jsonrpc": "2.0", "id": id_, "method": method}).encode(), [], lambda n, a: {},
                          at=at)

    def test_a_list_is_kept_by_its_endpoint(self):
        at = mcp.endpoint("listedtest", "0123456789abcdef")
        self.assertIsNone(mcp.listed(at))
        before = time.time()
        self.call("initialize", at)
        self.call("ping", at)
        self.assertIsNone(mcp.listed(at))                    # only a list of its tools counts
        self.assertEqual(self.call("tools/list", at), (200, {"jsonrpc": "2.0", "id": 1, "result": {"tools": []}}))
        self.assertGreaterEqual(mcp.listed(at), before)
        self.assertIsNone(mcp.listed(mcp.endpoint("listedtest", "fedcba9876543210")))     # another endpoint's: not
        batch = json.dumps([{"jsonrpc": "2.0", "id": 2, "method": "tools/list"}]).encode()
        mcp.handle(batch, [], lambda n, a: {}, at="listedbatch/0123456789abcdef")    # in a batch, too
        self.assertIsNotNone(mcp.listed("listedbatch/0123456789abcdef"))
        self.call("tools/list", None)                         # a server that names no endpoint: none kept
        self.assertNotIn(None, mcp._listed)


if __name__ == "__main__":
    unittest.main()
