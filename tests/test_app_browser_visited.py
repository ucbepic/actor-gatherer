"""The address bar's suggestions (ag_apps/browser/visited.py): the pages the Browsers went to, kept in the app's
database -- which are kept, how they are ranked for what is typed, forgotten, dropped past KEEP, started from the
Browsers' Chrome's own history once -- and, against a real Chrome, every page a tab opens kept, typed when the user
opened it from the address bar, its title once it has one."""
import os
import sqlite3
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ag_apps.browser import backend, visited  # noqa: E402
from ag_apps.browser import core as browser  # noqa: E402
from test_app_browser import ChromeBase, Home  # noqa: E402

DAY = 86400.0


def memory() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", isolation_level=None)
    conn.executescript(visited.SCHEMA)
    return conn


def urls(pages):
    return [p["url"] for p in pages]


class KeptTest(unittest.TestCase):
    def setUp(self):
        self.conn = memory()
        self.addCleanup(self.conn.close)

    def rows(self):
        return {r[0]: r[1:] for r in self.conn.execute("SELECT url, title, visits, typed FROM visited")}

    def test_only_web_pages_with_no_password_in_them(self):
        for url in ("https://example.com/", "http://localhost:4200/x?y=1"):
            self.assertTrue(visited.keepable(url), url)
        for url in ("about:blank", "file:///etc/hosts", "chrome://settings", "data:text/html,hi", "javascript:1",
                    "https://me:secret@example.com/", "https://me@example.com/", "https://", "",
                    "https://example.com/" + "a" * visited.LONGEST):
            self.assertFalse(visited.keepable(url), url)
        visited.visit(self.conn, "file:///tmp/a.html")
        visited.visit(self.conn, "https://me:secret@example.com/")
        self.assertEqual(self.rows(), {})

    def test_each_opening_counted_typed_apart_and_its_title_kept(self):
        visited.visit(self.conn, "https://example.com/", "Example", at=1.0)
        visited.visit(self.conn, "https://example.com/", "", typed=True, at=2.0)   # no title: the one it had kept
        visited.retitle(self.conn, "https://example.com/", "Example Domain")
        visited.retitle(self.conn, "https://example.com/", "")
        visited.retitle(self.conn, "https://example.com/", "example.com/")              # Chrome's name for it, untitled
        self.assertEqual(self.rows(), {"https://example.com/": ("Example Domain", 2, 1)})
        self.assertEqual(self.conn.execute("SELECT last FROM visited").fetchone()[0], 2.0)
        visited.forget(self.conn, "https://example.com/")
        self.assertEqual(self.rows(), {})

    def test_the_ones_opened_longest_ago_dropped_past_keep(self):
        with mock.patch.object(visited, "KEEP", 3):
            for i in range(5):
                visited.visit(self.conn, f"https://example.com/{i}", at=float(i))
        self.assertEqual(sorted(self.rows()), [f"https://example.com/{i}" for i in (2, 3, 4)])


class SuggestTest(unittest.TestCase):
    def setUp(self):
        self.conn = memory()
        self.addCleanup(self.conn.close)
        self.now = 100 * DAY

    def visit(self, url, title="", times=1, typed=0, ago=0.0):
        for i in range(times):
            visited.visit(self.conn, url, title, typed=i < typed, at=self.now - ago)

    def suggest(self, q):
        return urls(visited.suggest(self.conn, q, now=self.now))

    def test_an_address_starting_with_what_is_typed_first_a_site_s_own_page_before_its_others(self):
        self.visit("https://github.com/ucbepic/actor-gatherer/pulls", "Pull requests", times=5)
        self.visit("https://github.com/", "GitHub")
        self.visit("https://docs.example.com/git-guide", "A git guide", times=9)
        self.visit("https://www.gitlab.com/", "GitLab", ago=60.0)
        self.assertEqual(self.suggest("git"), ["https://github.com/", "https://www.gitlab.com/",
                                               "https://github.com/ucbepic/actor-gatherer/pulls",
                                               "https://docs.example.com/git-guide"])
        self.assertEqual(self.suggest("https://git")[:2], ["https://github.com/", "https://www.gitlab.com/"])
        self.assertEqual(self.suggest("www.gitl"), ["https://www.gitlab.com/"])

    def test_a_word_of_the_title_or_address_before_one_found_inside_a_word(self):
        self.visit("https://a.example/1", "Blueprints", times=10)
        self.visit("https://b.example/2", "Print shop")
        self.assertEqual(self.suggest("print"), ["https://b.example/2", "https://a.example/1"])

    def test_every_word_typed_and_the_more_often_typed_and_lately_opened_first(self):
        self.visit("https://news.example/today", "Today's news", times=3)
        self.visit("https://news.example/sports", "Sports news", times=3, typed=2)
        self.visit("https://news.example/old", "Old news", times=30, ago=120 * DAY)
        self.assertEqual(self.suggest("news.example"), ["https://news.example/sports", "https://news.example/today",
                                                        "https://news.example/old"])
        self.assertEqual(self.suggest("news sports"), ["https://news.example/sports"])
        self.assertEqual(self.suggest("   "), [])
        self.assertEqual(self.suggest("nothing-like-it"), [])

    def test_at_most_shown_and_what_is_typed_taken_as_text(self):
        for i in range(20):
            self.visit(f"https://example.com/{i}", f"Page {i}")
        self.assertEqual(len(self.suggest("example")), visited.SHOWN)
        self.visit("https://example.com/100%_off", "Sale")
        self.assertEqual(self.suggest("100%_"), ["https://example.com/100%_off"])
        self.assertEqual(self.suggest("%"), ["https://example.com/100%_off"])


class SeedTest(Home):
    """The Browsers' Chrome's own history, added once."""

    def chrome_history(self, rows):
        profile = os.path.join(browser.HOME, "dashboard", "browser")
        os.makedirs(os.path.join(profile, "Default"))
        conn = sqlite3.connect(os.path.join(profile, "Default", "History"))
        conn.execute("CREATE TABLE urls (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, "
                     "visit_count INTEGER DEFAULT 0, typed_count INTEGER DEFAULT 0, last_visit_time INTEGER NOT NULL, "
                     "hidden INTEGER DEFAULT 0)")
        for url, title, visits, typed, at, hidden in rows:
            when = int((at + visited.CHROME_EPOCH) * 1e6)
            conn.execute("INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) VALUES "
                         "(?, ?, ?, ?, ?, ?)", (url, title, visits, typed, when, hidden))
        conn.commit()
        conn.close()
        return profile

    def kept(self):
        return {r["url"]: (r["title"], r["visits"], r["typed"], round(r["last"]))
                for r in browser.in_db(lambda c: c.execute("SELECT * FROM visited").fetchall())}

    def test_its_web_pages_added_once_what_is_here_winning(self):
        browser.in_db(lambda c: visited.visit(c, "https://example.com/", "Mine", at=5.0))
        profile = self.chrome_history([
            ("https://example.com/", "Theirs", 9, 9, 1_000.0, 0),
            ("https://figma.com/files", "Figma", 4, 1, 1_700_000_000.0, 0),
            ("https://accounts.example/redirect", "", 1, 0, 1_700_000_001.0, 1),     # hidden: a step of a redirect
            ("chrome://newtab/", "New Tab", 3, 0, 1_700_000_002.0, 0)])
        backend._seed(profile)
        self.assertEqual(self.kept(), {"https://example.com/": ("Mine", 1, 0, 5),
                                       "https://figma.com/files": ("Figma", 4, 1, 1_700_000_000)})
        browser.in_db(lambda c: visited.forget(c, "https://figma.com/files"))
        backend._seed(profile)                                                      # once only
        self.assertNotIn("https://figma.com/files", self.kept())

    def test_no_history_is_no_trouble(self):
        backend._seed(os.path.join(browser.HOME, "dashboard", "browser"))
        self.assertEqual(self.kept(), {})


class RouteTest(Home):
    """backend.py's `visited`: for every Browser, no instance named."""

    def test_the_suggestions_asked_and_one_forgotten(self):
        app = backend.BrowserApp()
        browser.in_db(lambda c: visited.visit(c, "https://example.com/a", "A page"))
        got = app.request(None, "GET", "visited", {"q": "exa"}, b"")
        self.assertEqual(got.status, 200)
        self.assertIn(b'"url": "https://example.com/a"', got.body)
        self.assertEqual(app.request(None, "POST", "visited", {}, b'{"forget": "https://example.com/a"}').status, 200)
        self.assertEqual(app.request(None, "GET", "visited", {"q": "exa"}, b"").body, b'{"pages": []}')


@unittest.skipUnless(browser.available(), "no Chrome here")
class VisitedChromeTest(ChromeBase):
    """Every page a tab opens, kept: the user's typed ones as typed, the agent's not; a page's own move to another
    address (history.pushState) too, but not one to a part of the same page."""

    def kept(self, url):
        row = browser.in_db(lambda c: c.execute("SELECT title, visits, typed FROM visited WHERE url = ?",
                                                (url,)).fetchone())
        return tuple(row) if row else None

    def test_each_page_opened_kept_typed_by_the_user_and_titled(self):
        one = self.serve("one.html", "<!doctype html><title>Page one</title><a id=go href='two.html'>two</a>"
                                     "<script>function moved() { history.pushState({}, '', 'three'); }"
                                     "function part() { location.hash = 'below'; }</script>")
        two = one.replace("one.html", "two.html")
        self.write("two.html", "<!doctype html><title>Page two</title>")
        self.b.navigate(one)                                         # the user, in the address bar
        self.assertTrue(self.until(lambda: self.kept(one) == ("Page one", 1, 1), 5), self.kept(one))
        self.js("document.getElementById('go').click()")             # a link: opened, not typed
        self.assertTrue(self.until(lambda: self.kept(two) == ("Page two", 1, 0), 5), self.kept(two))
        self.text("navigate", url=one)                               # the agent's
        self.assertTrue(self.until(lambda: (self.kept(one) or (0, 0))[1] == 2, 5), self.kept(one))
        self.assertEqual(self.kept(one)[2], 1)
        self.js("moved()")
        three = one.replace("one.html", "three")
        self.assertTrue(self.until(lambda: self.kept(three) is not None, 5))
        self.js("part()")
        time.sleep(0.5)
        self.assertIsNone(self.kept(three + "#below"))
        self.assertEqual(urls(browser.in_db(lambda c: visited.suggest(c, "localhost")))[:1], [one])

    def test_words_typed_are_searched_for_not_kept_as_typed(self):
        page = self.serve("search.html", "<!doctype html><title>Results</title>")
        with mock.patch.object(browser, "SEARCH", page + "?q="):
            self.b.navigate("tau bench paper")                       # the user, in the address bar
        found = page + "?q=tau+bench+paper"
        self.assertTrue(self.until(lambda: self.kept(found) == ("Results", 1, 0), 5), self.kept(found))
        self.assertEqual(self.b.tab().url, found)


if __name__ == "__main__":
    unittest.main()
