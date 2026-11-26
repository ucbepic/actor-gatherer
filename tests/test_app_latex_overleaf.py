"""The LaTeX editor's Overleaf part (ag_apps/latex/overleaf.py): who changed a paper's lines on Overleaf -- a diff's pieces
placed on the file as it is here, the user's own Dropbox's left out; a file put in whole (removed and added again) compared
before and after; who changed which file from the changes one by one (not the updates, which merge people); the sign-in
kept, and found lapsed; a Dropbox-synced folder's project found by its name; and the panel's routes (overleaf,
overleaf/link, overleaf/changes) -- against a stand-in for Overleaf's site, here, that answers as its History panel's
endpoints do."""
import http.server
import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.parse
from datetime import datetime, timezone

from ag_apps.latex import overleaf as O
from test_app_latex import ServedBase

ME, CO = "a" * 24, "b" * 24
NOW = time.time()


def meta(user, at, origin=None, last="Lee"):
    u = {"id": user, "first_name": "Pat" if user == CO else "Sam", "last_name": last, "email": f"{user[:3]}@x.edu"}
    return {"users": [u], "start_ts": at * 1000 - 5000, "end_ts": at * 1000, **({"origin": {"kind": origin}} if origin else {})}


def change(user, at, *ops, origin=None):
    """One of Overleaf's changes, as /changes gives it."""
    return {"operations": list(ops), "v2Authors": [user], "authors": [],
            "timestamp": datetime.fromtimestamp(at, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            **({"origin": {"kind": origin}} if origin else {})}


edit = lambda path: {"pathname": path, "textOperation": [3, "x"]}                     # noqa: E731
removed = lambda path: {"pathname": path, "newPathname": ""}                          # noqa: E731
added = lambda path, h="h1": {"pathname": path, "file": {"hash": h, "stringLength": 9}}   # noqa: E731
renamed = lambda path, to: {"pathname": path, "newPathname": to}                      # noqa: E731


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
            (3, "Pat Lee", ["A new sentence."], []),
            (4, "Pat Lee", ["new"], ["old"]),
            (6, "Sam Lee", ["Mine, on overleaf.com."], [])])
        self.assertEqual(got[1]["text"], "Some text new here.")
        self.assertAlmostEqual(got[1]["at"], NOW - 30, places=2)

    def test_a_line_not_as_overleaf_has_it_is_left_out(self):
        diff = [{"u": "one\n"}, {"i": "two\n", "meta": meta(CO, NOW)}, {"u": "three\n"}]
        self.assertEqual(O.attribute(diff, "one\nthree\n", ME, 0), [])                  # not synced here yet
        self.assertEqual(O.attribute(diff, "one\ntwo, then typed here\nthree\n", ME, 0), [])   # changed here since
        self.assertEqual([l["line"] for l in O.attribute(diff, "one\ntwo\nthree\n", ME, 0)], [2])

    def test_a_line_alike_only_by_chance_is_not_taken_for_the_one_changed(self):
        # Overleaf moved on: a new table, its `\centering` the co-author's; here, an older table's `\centering` alone
        diff = [{"u": "\\section{Results}\nWe ran it.\n"},
                {"i": "\\begin{table}\n  \\centering\n  \\caption{New}\n\\end{table}\n", "meta": meta(CO, NOW)},
                {"u": "Done.\n"}]
        here = "\\section{Results}\nWe ran it.\n\\begin{figure}\n  \\centering\n  \\caption{Old}\n\\end{figure}\nDone.\n"
        self.assertEqual(O.attribute(diff, here, ME, 0), [])
        synced = "\\section{Results}\nWe ran it.\n\\begin{table}\n  \\centering\n  \\caption{New}\n\\end{table}\nDone.\n"
        self.assertEqual([l["line"] for l in O.attribute(diff, synced, ME, 0)], [3, 4, 5, 6])   # synced: all four

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
    raw = None                                       # (the first change's version, [change]); None: /changes not served
    page = 2000
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
            key = (q["pathname"], int(q["from"]), int(q["to"]))
            if key not in _Overleaf.diffs:
                return self.reply(404, {})
            return self.reply(200, {"diff": _Overleaf.diffs[key]})
        if url.path.endswith("/changes") and _Overleaf.raw is not None:
            _Overleaf.asked.append(f"changes since {q['since']}")
            first, all_ = _Overleaf.raw
            k = max(0, int(q["since"]) - first)
            return self.reply(200, {"changes": all_[k:k + _Overleaf.page], "hasMore": k + _Overleaf.page < len(all_)})
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
        _Overleaf.diffs[("sec/a.tex", 5, 9)] = _Overleaf.diffs[("sec/a.tex", 7, 9)]
        _Overleaf.raw = (5, [change(ME, NOW - 121, edit("sec/a.tex"), origin="dropbox"),
                             change(ME, NOW - 120, edit("sec/a.tex"), origin="dropbox"),
                             change(CO, NOW - 61, edit("sec/a.tex")), change(CO, NOW - 60, edit("sec/a.tex"))])
        _Overleaf.page = 2000


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


class WhoChangedTest(SiteBase, unittest.TestCase):
    """Who changed which file, from the updates alone."""

    def account(self):
        account = O.Account(tempfile.mkdtemp())
        account._signed_in([{"name": "overleaf_session2", "value": "good"}])
        return account

    def test_without_the_changes_by_the_updates_each_person_s_files_the_user_s_own_dropbox_left_out(self):
        self.site()
        _Overleaf.raw = None
        both = meta(CO, NOW - 30, "dropbox")
        both["users"].append({"id": ME, "first_name": "Sam", "last_name": "Lee", "email": "me@x.edu"})
        _Overleaf.updates = [
            {"fromV": 9, "toV": 10, "pathnames": ["main.tex", "sec/b.tex"], "meta": both},        # both, from Dropbox
            {"fromV": 8, "toV": 9, "pathnames": ["sec/a.tex"], "meta": meta(ME, NOW - 40)},       # the user, on the site
            {"fromV": 7, "toV": 8, "pathnames": ["sec/a.tex"], "meta": meta(CO, NOW - 60)},
            {"fromV": 5, "toV": 7, "pathnames": ["sec/c.tex"], "meta": meta(ME, NOW - 120, "dropbox")},   # from here
            {"fromV": 4, "toV": 5, "pathnames": ["old.tex"], "meta": meta(CO, NOW - 9000)}]               # long ago
        account = O.Account(tempfile.mkdtemp())
        account._signed_in([{"name": "overleaf_session2", "value": "good"}])
        got = O.who_changed(O.History(account), "c" * 24, "/p", ME, NOW - 3600)
        self.assertEqual({path: [p["name"] for p in people] for path, people in got["files"].items()}, {
            "/p/main.tex": ["Pat Lee"], "/p/sec/b.tex": ["Pat Lee"], "/p/sec/a.tex": ["Sam Lee", "Pat Lee"]})
        self.assertEqual([(p["name"], p["path"], p["files"]) for p in got["people"]],
                         [("Pat Lee", "/p/main.tex", 3), ("Sam Lee", "/p/sec/a.tex", 1)])

    def test_without_the_changes_a_file_added_again_or_renamed_counts_too(self):
        self.site()
        _Overleaf.raw = None
        _Overleaf.updates = [{"fromV": 4, "toV": 8, "pathnames": [], "meta": meta(CO, NOW - 30, "dropbox"),
                              "project_ops": [{"add": {"pathname": "sec/a.tex"}, "atV": 5},
                                              {"remove": {"pathname": "sec/a.tex"}, "atV": 4},
                                              {"rename": {"pathname": "b.tex", "newPathname": "c.tex"}, "atV": 6}]}]
        got = O.who_changed(O.History(self.account()), "c" * 24, "/p", ME, NOW - 3600)
        self.assertEqual({path: [p["name"] for p in people] for path, people in got["files"].items()},
                         {"/p/sec/a.tex": ["Pat Lee"], "/p/c.tex": ["Pat Lee"]})

    def test_from_the_changes_each_one_s_own_files_a_file_put_in_whole_included(self):
        self.site()
        # one update merges them all, with both people; each change says who made it
        _Overleaf.updates = [{"fromV": 3, "toV": 16, "pathnames": ["sec/c.tex", "sec/e.tex"],
                              "meta": {**meta(CO, NOW - 10, "dropbox"), "users": [
                                  meta(CO, 0)["users"][0], meta(ME, 0)["users"][0]]}}]
        _Overleaf.raw = (3, [
            change(CO, NOW - 9000, added("sec/d.tex", "d1"), origin="dropbox"),              # 3: before the window
            change(ME, NOW - 60, edit("sec/c.tex"), origin="dropbox"),                        # 4: the user, from here
            change(ME, NOW - 59, removed("main.pdf"), origin="dropbox"),                      # 5, 6: their build's PDF
            change(ME, NOW - 59, added("main.pdf", "p1"), origin="dropbox"),
            change(CO, NOW - 50, removed("sec/a.tex"), origin="dropbox"),                     # 7, 8: put in whole
            change(CO, NOW - 50, added("sec/a.tex", "a1"), origin="dropbox"),
            change(CO, NOW - 40, added("out/backup.tex", "b1"), origin="dropbox"),            # 9: a new file
            change(CO, NOW - 30, renamed("sec/b.tex", "sec/b2.tex")),                         # 10: renamed
            change(CO, NOW - 20, removed("sec/d.tex"), origin="dropbox"),                     # 11, 12: put back as it
            change(CO, NOW - 20, added("sec/d.tex", "d1"), origin="dropbox"),                 #  was: not a change
            change(ME, NOW - 10, edit("sec/e.tex")),                                          # 13: the user, on the site
            change(CO, NOW - 5, removed("old.tex")),                                          # 14: removed: gone
        ])
        got = O.who_changed(O.History(self.account()), "c" * 24, "/p", ME, NOW - 3600)
        self.assertEqual({path: [p["name"] for p in people] for path, people in got["files"].items()}, {
            "/p/sec/a.tex": ["Pat Lee"], "/p/out/backup.tex": ["Pat Lee"], "/p/sec/b2.tex": ["Pat Lee"],
            "/p/sec/e.tex": ["Sam Lee"]})
        self.assertEqual([(p["name"], p["path"], p["files"]) for p in got["people"]],
                         [("Sam Lee", "/p/sec/e.tex", 1), ("Pat Lee", "/p/sec/b2.tex", 3)])
        self.assertAlmostEqual(got["files"]["/p/sec/a.tex"][0]["at"], NOW - 50, places=2)


class ChangesTest(SiteBase, unittest.TestCase):
    """A file's lines credited from its changes one by one: a diff over each run of in-place edits, and each time it was
    put in whole, its texts before and after compared."""

    BEFORE = "\\section{Model}\nWe optimize the cost of each plan over the rounds.\nIt has three parts, each with its cost.\n" \
             "A line that goes away entirely here.\n\\end{itemize}\nThe end of the section, unchanged.\n"
    AFTER = "\\section{Model}\nWe maximize the cost of each plan, over all rounds.\nIt has three parts, each with its cost.\n" \
            "\\end{itemize}\nThe end of the section, unchanged.\nA sentence added at the end of it.\n"

    def setUp(self):
        self.site()
        self.account = O.Account(tempfile.mkdtemp())
        self.account._signed_in([{"name": "overleaf_session2", "value": "good"}])
        self.root = tempfile.mkdtemp()
        self.path = os.path.join(self.root, "a.tex")

    def lines(self, text, since=NOW - 3600):
        got = O.changes(O.History(self.account), "c" * 24, self.root, self.path, text, ME, since)
        return [(l["line"], l["who"][0]["name"], l["inserted"], l["deleted"]) for l in got["lines"]], got

    def test_a_file_put_in_whole_by_another_its_changed_lines_credited_with_their_words(self):
        _Overleaf.updates = [{"fromV": 4, "toV": 6, "pathnames": [], "meta": meta(CO, NOW - 30, "dropbox")}]
        _Overleaf.raw = (4, [change(CO, NOW - 30, removed("a.tex"), origin="dropbox"),
                             change(CO, NOW - 30, added("a.tex", "a2"), origin="dropbox")])
        _Overleaf.diffs = {("a.tex", 4, 4): [{"u": self.BEFORE}], ("a.tex", 6, 6): [{"u": self.AFTER}],
                           ("a.tex", 4, 6): [{"u": self.AFTER}]}     # its diff across: unchanged, naming no one
        got, whole = self.lines(self.AFTER)
        self.assertEqual(got, [
            (2, "Pat Lee", ["maximize", ",", "all"], ["optimize", "the"]),
            (4, "Pat Lee", [], ["A line that goes away entirely here."]),
            (6, "Pat Lee", ["A sentence added at the end of it."], [])])
        self.assertAlmostEqual(whole["lines"][0]["at"], NOW - 30, places=2)
        self.assertEqual([(p["name"], p["lines"]) for p in whole["people"]], [("Pat Lee", 3)])
        # here, a line typed since: not taken for theirs
        self.assertEqual([l[0] for l in self.lines(self.AFTER.replace("over all", "over every"))[0]], [4, 6])
        # put in whole by the user's own Dropbox: none
        _Overleaf.raw = (4, [change(ME, NOW - 30, removed("a.tex"), origin="dropbox"),
                             change(ME, NOW - 30, added("a.tex", "a2"), origin="dropbox")])
        self.assertEqual(self.lines(self.AFTER)[0], [])

    def test_edits_in_place_then_put_in_whole_each_told_and_each_text_read_once(self):
        mid = self.BEFORE.replace("three parts", "four parts")                       # after the edit in place
        first = mid.replace(mid.splitlines(True)[1], self.AFTER.splitlines(True)[1])  # the first put: line 2
        second = self.AFTER.replace("three parts", "four parts")                     # the second: lines 4, 6
        _Overleaf.updates = [{"fromV": 4, "toV": 12, "pathnames": ["a.tex"], "meta": meta(CO, NOW - 10, "dropbox")}]
        _Overleaf.raw = (4, [
            change(CO, NOW - 50, edit("a.tex")),                                    # 4: in place, on the site
            change(CO, NOW - 40, removed("a.tex"), origin="dropbox"),              # 5, 6: put in whole
            change(CO, NOW - 40, added("a.tex", "a2"), origin="dropbox"),
            change(CO, NOW - 20, removed("a.tex"), origin="dropbox"),              # 7, 8: again, nothing between
            change(CO, NOW - 20, added("a.tex", "a3"), origin="dropbox"),
            change(CO, NOW - 15, removed("a.tex"), origin="dropbox"),              # 9, 10: again, its text as Overleaf
            change(CO, NOW - 15, added("a.tex", "a4"), origin="dropbox"),          #  keeps it: binary -- not told
            change(ME, NOW - 10, edit("a.tex"), origin="dropbox")])                # 11: the user's own, from here
        _Overleaf.diffs = {
            ("a.tex", 4, 5): [{"u": self.BEFORE.split("three", 1)[0]}, {"d": "three", "meta": meta(CO, NOW - 50)},
                              {"i": "four", "meta": meta(CO, NOW - 50)}, {"u": self.BEFORE.split("three", 1)[1]}],
            ("a.tex", 5, 5): [{"u": mid}], ("a.tex", 7, 7): [{"u": first}], ("a.tex", 9, 9): [{"u": second}],
            ("a.tex", 11, 11): {"binary": True}}
        got, _ = self.lines(second + "Ours.\n")
        self.assertEqual([(l[0], l[2], l[3]) for l in got], [
            (2, ["maximize", ",", "all"], ["optimize", "the"]),         # the first put in whole (5-7)
            (3, ["four"], ["three"]),                                  # the edit in place, through its diff (4-5)
            (4, [], ["A line that goes away entirely here."]),         # the second (7-9)
            (6, ["A sentence added at the end of it."], [])])          # "Ours." (7): the user's own, left out
        self.assertEqual({l[1] for l in got}, {"Pat Lee"})
        # read once each: the diff 4-5, and the texts at 5, 7 (after the first put, before the second), 9 and 11
        self.assertEqual(len([a for a in _Overleaf.asked if a.endswith("/diff")]), 5)

    def test_a_new_file_from_another_all_its_lines_theirs(self):
        _Overleaf.updates = [{"fromV": 4, "toV": 5, "pathnames": [], "meta": meta(CO, NOW - 30, "dropbox")}]
        _Overleaf.raw = (4, [change(CO, NOW - 30, added("a.tex", "n1"), origin="dropbox")])
        _Overleaf.diffs = {("a.tex", 5, 5): [{"u": self.AFTER}]}
        got, _ = self.lines(self.AFTER)
        self.assertEqual([l[0] for l in got], [1, 2, 3, 4, 5, 6])

    def test_the_changes_read_in_pages_and_then_only_the_new(self):
        _Overleaf.page = 2
        h = O.History(self.account)
        self.assertEqual([v for v, _ in h.changes("c" * 24, 5)], [5, 6, 7, 8])
        self.assertEqual([a for a in _Overleaf.asked if a.startswith("changes")], ["changes since 5", "changes since 7"])
        self.assertEqual([v for v, _ in h.changes("c" * 24, 6)], [6, 7, 8])
        self.assertEqual(len([a for a in _Overleaf.asked if a.startswith("changes")]), 2)     # kept a few seconds
        first, all_ = _Overleaf.raw
        _Overleaf.raw = (first, all_ + [change(CO, NOW, edit("sec/a.tex"))])
        h.changes_of["c" * 24] = (0.0,) + h.changes_of["c" * 24][1:]                         # those seconds past
        self.assertEqual([v for v, _ in h.changes("c" * 24, 6)], [6, 7, 8, 9])
        self.assertEqual([a for a in _Overleaf.asked if a.startswith("changes")][-1], "changes since 9")


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
        got = self.ask(f"overleaf/files?{urllib.parse.urlencode({'since': NOW - 3600})}")
        self.assertEqual(list(got["files"]), [os.path.join(os.path.realpath(self.repo), "sec", "a.tex")])
        self.assertEqual([p["name"] for p in got["people"]], ["Pat Lee"])
        self.assertEqual(self.ask("overleaf/link", {"url": ""})["project"], None)    # back to the folder's own: none
        app.overleaf.sign_out()
        got = self.ask(f"overleaf/changes?{urllib.parse.urlencode({'path': path, 'since': 0})}")
        self.assertEqual(got["lines"], [])


if __name__ == "__main__":
    unittest.main()
