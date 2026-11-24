"""The LaTeX editor's Overleaf part (ag_apps/latex/overleaf.py): who changed a paper's lines on Overleaf -- a diff's pieces
placed on the file as it is here, the user's own Dropbox's left out; the sign-in kept, and found lapsed; a Dropbox-synced
folder's project found by its name; and the panel's routes (overleaf, overleaf/link, overleaf/changes) -- against a
stand-in for Overleaf's site, here, that answers as its History panel's endpoints do."""
import http.server
import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.parse

from ag_apps.latex import overleaf as O
from test_app_latex import ServedBase

ME, CO = "a" * 24, "b" * 24
NOW = time.time()


def meta(user, at, origin=None, last="Lee"):
    u = {"id": user, "first_name": "Pat" if user == CO else "Sam", "last_name": last, "email": f"{user[:3]}@x.edu"}
    return {"users": [u], "start_ts": at * 1000 - 5000, "end_ts": at * 1000, **({"origin": {"kind": origin}} if origin else {})}


class AttributeTest(unittest.TestCase):
    """A diff's pieces, on the file's lines here."""

    def test_others_pieces_are_on_their_lines_here_and_the_user_s_own_dropbox_s_are_not(self):
        diff = [{"u": "\\section{One}\n"},
                {"i": "A new sentence.\n", "meta": meta(CO, NOW - 60)},                       # a co-author, on Overleaf
                {"u": "Some text "}, {"d": "old", "meta": meta(CO, NOW - 30, "dropbox")},     # theirs, from their Dropbox
                {"i": "new", "meta": meta(CO, NOW - 30, "dropbox")}, {"u": " here.\n"},
                {"i": "Mine, from this machine.\n", "meta": meta(ME, NOW - 20, "dropbox")},   # the user's own Dropbox: left
                {"i": "Mine, on overleaf.com.\n", "meta": meta(ME, NOW - 10)},                # the user on the site: kept
                {"i": "Long ago.\n", "meta": meta(CO, NOW - 9000)}]                           # before the window
        here = "% a line added here first\n\\section{One}\nA new sentence.\nSome text new here.\n" \
               "Mine, from this machine.\nMine, on overleaf.com.\nLong ago.\n"
        got = O.attribute(diff, here, ME, NOW - 3600)
        self.assertEqual([(l["line"], l["who"][0]["name"], l["inserted"], l["deleted"]) for l in got], [
            (3, "Pat Lee", "A new sentence.\n", ""),
            (4, "Pat Lee", "new", "old"),
            (6, "Sam Lee", "Mine, on overleaf.com.\n", "")])
        self.assertEqual(got[1]["text"], "Some text new here.")
        self.assertAlmostEqual(got[1]["at"], NOW - 30, places=2)

    def test_a_line_not_as_overleaf_has_it_is_left_out(self):
        diff = [{"u": "one\n"}, {"i": "two\n", "meta": meta(CO, NOW)}, {"u": "three\n"}]
        self.assertEqual(O.attribute(diff, "one\nthree\n", ME, 0), [])                  # not synced here yet
        self.assertEqual(O.attribute(diff, "one\ntwo, then typed here\nthree\n", ME, 0), [])   # changed here since
        self.assertEqual([l["line"] for l in O.attribute(diff, "one\ntwo\nthree\n", ME, 0)], [2])

    def test_the_folder_of_a_dropbox_synced_project(self):
        top = tempfile.mkdtemp()
        paper = os.path.join(top, "Dropbox", "Apps", "Overleaf", "my paper")
        os.makedirs(os.path.join(paper, "sec"))
        self.assertEqual(O.project_root(os.path.join(paper, "sec", "a.tex")), (os.path.realpath(paper), "my paper"))
        self.assertIsNone(O.project_root(top))


class _Overleaf(http.server.BaseHTTPRequestHandler):
    """Overleaf's endpoints, as the History panel reads them: a session that is the user's, or a visitor's."""
    updates = []
    diffs = {}
    asked = []

    def do_GET(self):                                # noqa: N802
        url = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(url.query))
        _Overleaf.asked.append(url.path)
        if "overleaf_session2=good" not in (self.headers.get("Cookie") or ""):
            if url.path == "/project":               # a visitor: sent to sign in
                self.send_response(302)
                self.send_header("Location", "/login")
                self.end_headers()
                return
            return self.reply(403, {"message": "restricted"})
        if url.path == "/login":
            return self.reply(200, "<html>sign in</html>", "text/html")
        if url.path == "/project":
            return self.reply(200, f'<meta name="ol-user_id" content="{ME}"><meta name="ol-usersEmail" content="me@x.edu">',
                              "text/html")
        if url.path == "/user/projects":
            return self.reply(200, {"projects": [{"_id": "c" * 24, "name": "paper"}, {"_id": "d" * 24, "name": "other"}]})
        if url.path.endswith("/updates"):
            return self.reply(200, {"updates": _Overleaf.updates})
        if url.path.endswith("/diff"):
            return self.reply(200, {"diff": _Overleaf.diffs[(q["pathname"], int(q["from"]), int(q["to"]))]})
        self.reply(404, {})

    def reply(self, status, body, kind="application/json"):
        raw = (json.dumps(body) if kind == "application/json" else body).encode()
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *a):
        pass


class SiteBase:
    def site(self, module=O):
        """The stand-in, serving; `module` (overleaf.py, as the host loaded it for the backend, or as imported here)
        asking it in place of Overleaf."""
        self.ol = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Overleaf)
        threading.Thread(target=self.ol.serve_forever, daemon=True).start()
        self.addCleanup(self.ol.shutdown)
        was = module.SITE
        module.SITE = f"http://127.0.0.1:{self.ol.server_port}"
        self.addCleanup(setattr, module, "SITE", was)
        _Overleaf.asked = []
        _Overleaf.updates = [{"fromV": 7, "toV": 9, "pathnames": ["sec/a.tex"], "meta": meta(CO, NOW - 60)},
                             {"fromV": 5, "toV": 7, "pathnames": ["sec/a.tex"], "meta": meta(ME, NOW - 120, "dropbox")}]
        _Overleaf.diffs = {("sec/a.tex", 7, 9): [{"u": "one\n"}, {"i": "two\n", "meta": meta(CO, NOW - 60)},
                                                 {"u": "three\n"}]}


class AccountTest(SiteBase, unittest.TestCase):
    def setUp(self):
        self.site()
        self.account = O.Account(tempfile.mkdtemp())

    def test_the_sign_in_is_kept_once_the_session_is_a_user_s_and_found_lapsed(self):
        self.assertIsNone(self.account._signed_in([{"name": "overleaf_session2", "value": "visitor"}]))
        self.assertIsNone(self.account.kept())
        who = self.account._signed_in([{"name": "overleaf_session2", "value": "good"}])
        self.assertEqual(who, {"user_id": ME, "email": "me@x.edu"})
        self.assertEqual(self.account.view()["signed_in"], {"email": "me@x.edu", "user_id": ME})
        self.assertEqual(os.stat(self.account.path).st_mode & 0o777, 0o600)       # the user's alone
        self.assertEqual(self.account.find("paper")["id"], "c" * 24)
        self.assertEqual(self.account.find("Paper")["id"], "c" * 24)
        self.assertIsNone(self.account.find("none"))
        with open(self.account.path, "w") as fh:     # it lapsed
            json.dump({"cookie": "stale"}, fh)
        self.account._projects = (0.0, [])
        with self.assertRaises(O.SignedOut):
            self.account.projects()
        self.account.sign_out()
        self.assertIsNone(self.account.view()["signed_in"])

    def test_a_file_s_lines_credited_through_the_history(self):
        self.account._signed_in([{"name": "overleaf_session2", "value": "good"}])
        h = O.History(self.account)
        root = tempfile.mkdtemp()
        os.makedirs(os.path.join(root, "sec"))
        got = O.changes(h, "c" * 24, root, os.path.join(root, "sec", "a.tex"), "one\ntwo\nthree\n", ME, NOW - 3600)
        self.assertEqual([(l["line"], l["who"][0]["name"]) for l in got["lines"]], [(2, "Pat Lee")])
        self.assertEqual([(p["name"], p["lines"]) for p in got["people"]], [("Pat Lee", 1)])
        self.assertEqual(got["version"], 9)
        n = len(_Overleaf.asked)
        O.changes(h, "c" * 24, root, os.path.join(root, "sec", "a.tex"), "one\ntwo\nthree\n", ME, NOW - 3600)
        self.assertEqual(len(_Overleaf.asked), n)    # kept a few seconds: not asked again
        self.assertEqual(O.changes(h, "c" * 24, root, os.path.join(root, "b.tex"), "x\n", ME, NOW - 3600)["lines"], [])


class RoutesTest(SiteBase, ServedBase):
    """The panel's routes, through the dashboard."""

    def setUp(self):
        super().setUp()
        self.site(sys.modules[type(self.h.backend("latex").overleaf).__module__])
        self.q = f"gatherer=g&instance={self.inst.id}"
        self.own = f"http://latex.localhost:{self.port}"

    def ask(self, path, body=None):
        status, _, raw = self.at_app(f"/api/{path}{'&' if '?' in path else '?'}{self.q}", "POST" if body is not None else "GET",
                                     json.dumps(body) if body is not None else None, origin=self.own)
        self.assertEqual(status, 200, raw)
        return json.loads(raw)

    def test_signed_out_then_a_project_linked_and_a_file_s_lines_credited(self):
        got = self.ask("overleaf")
        self.assertEqual((got["signed_in"], got["project"], got["synced"]), (None, None, None))
        app = self.h.backend("latex")
        app.overleaf._signed_in([{"name": "overleaf_session2", "value": "good"}])
        self.assertIn("isn't an Overleaf project", json.loads(self.at_app(
            f"/api/overleaf/link?{self.q}", "POST", json.dumps({"url": "https://example.com/x"}), origin=self.own)[2])["error"])
        got = self.ask("overleaf/link", {"url": f"https://www.overleaf.com/project/{'c' * 24}"})
        self.assertEqual((got["project"]["name"], got["project"]["how"]), ("paper", "set"))
        os.makedirs(os.path.join(self.repo, "sec"), exist_ok=True)
        path = os.path.join(self.repo, "sec", "a.tex")
        with open(path, "w") as fh:
            fh.write("one\ntwo\nthree\n")
        got = self.ask(f"overleaf/changes?{urllib.parse.urlencode({'path': path, 'since': NOW - 3600})}")
        self.assertEqual([(l["line"], l["text"], l["who"][0]["name"]) for l in got["lines"]], [(2, "two", "Pat Lee")])
        self.assertEqual(self.ask("overleaf/link", {"url": ""})["project"], None)    # back to the folder's own: none
        app.overleaf.sign_out()
        got = self.ask(f"overleaf/changes?{urllib.parse.urlencode({'path': path, 'since': 0})}")
        self.assertEqual(got["lines"], [])


if __name__ == "__main__":
    unittest.main()
