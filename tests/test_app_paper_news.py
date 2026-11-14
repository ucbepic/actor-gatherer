"""Paper news (ag_apps/paper_news/): each weekday's listing of the user's categories read from arXiv's feed, days missed
caught up from its catch-up pages, kept, the user notified as a day comes in, and agents reading them with its tools.
arXiv is the test's: its feed and pages made up here, in their real shapes."""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app_kit  # noqa: E402
from ag_apps.paper_news import feed  # noqa: E402
from ag_apps.paper_news.backend import ASKS_MAX, ASKS_TAKEN, ERROR_RETRY, STALE, WAIT_RETRY, PaperNewsApp  # noqa: E402
from app_kit import Caller, Instance  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOLDER = os.path.join(ROOT, "ag_apps", "paper_news")
NY = ZoneInfo("America/New_York")


def ny(*args) -> float:
    return datetime(*args, tzinfo=NY).timestamp()


def item(pid, title, kind="new", cats=("cs.DB",), authors="Ada Lane, Bo Chen", abstract="We study things."):
    return f"""<item>
      <title>{title}</title>
      <link>https://arxiv.org/abs/{pid}</link>
      <description>arXiv:{pid}v1 Announce Type: {kind}
Abstract: {abstract}</description>
      <guid isPermaLink="false">oai:arXiv.org:{pid}v1</guid>
      {''.join(f'<category>{c}</category>' for c in cats)}
      <pubDate>Tue, 10 Nov 2026 00:00:00 -0500</pubDate>
      <arxiv:announce_type>{kind}</arxiv:announce_type>
      <dc:rights>http://creativecommons.org/licenses/by/4.0/</dc:rights>
      <dc:creator>{authors}</dc:creator>
    </item>"""


def rss(day_stamp="Tue, 10 Nov 2026 00:00:00 -0500", *items):
    return f"""<?xml version='1.0' encoding='UTF-8'?>
<rss xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <channel>
    <title>cs.AI+cs.DB updates on arXiv.org</title>
    <lastBuildDate>Tue, 10 Nov 2026 05:00:06 +0000</lastBuildDate>
    <pubDate>{day_stamp}</pubDate>
    {''.join(items)}
  </channel>
</rss>""".encode()


TUESDAY = rss("Tue, 10 Nov 2026 00:00:00 -0500",
              item("2611.10001", "Learned Indexes for Joins", "new", ("cs.DB", "cs.LG")),
              item("2611.10002", "Agents That Plan &amp; Query", "new", ("cs.AI",), "Mia Ruiz, Tom Ode and Li Wu"),
              item("2611.10003", "Vision for Tables", "cross", ("cs.CV", "cs.DB")),
              item("2611.00004", "An Older Paper, Revised", "replace", ("cs.DB",)))
EMPTY_TUESDAY = rss("Tue, 10 Nov 2026 00:00:00 -0500")


def entry(n, pid, title, cats, primary_name, authors=("Kai Moe",), abstract="An abstract."):
    links = "".join(f'<a href="https://arxiv.org/search/cs?searchtype=author&amp;query={a}">{a}</a>, ' for a in authors)
    rest = "; ".join(f"Other ({c})" for c in cats[1:])
    return f"""<dt>
      <a name='item{n}'>[{n}]</a>
      <a href ="/abs/{pid}" title="Abstract" id="{pid}">
        arXiv:{pid}
      </a>
    </dt>
    <dd>
      <div class='meta'>
        <div class='list-title mathjax'><span class='descriptor'>Title:</span>
          {title}
        </div>
        <div class='list-authors'>{links.rstrip(', ')}</div>
        <div class='list-comments mathjax'><span class='descriptor'>Comments:</span>
          12 pages
        </div>
        <div class='list-subjects'><span class='descriptor'>Subjects:</span>
          <span class="primary-subject">{primary_name} ({cats[0]})</span>{'; ' + rest if rest else ''}
        </div>
        <p class='mathjax'>
          {abstract}
        </p>
      </div>
    </dd>"""


def catchup_page(cat, day_said, new=(), cross=(), replaced=(), shown=None):
    def section(name, entries):
        n = len(entries) if shown is None else shown
        return (f"<dl id='articles'>\n<h3>{name} (showing {n} of {len(entries)} entries)</h3>\n"
                + "".join(entries) + "\n</dl>")
    return f"""<html><body><h1>Catchup results for Something on {day_said}</h1>
{section("New submissions", list(new))}
{section("Cross submissions", list(cross))}
{section("Replacement submissions", list(replaced))}
</body></html>""".encode()


MONDAY_AI = catchup_page("cs.AI", "Mon, 09 Nov 2026",
                         new=[entry(1, "2611.09001", "Reasoning Over Plans", ("cs.AI", "cs.CL"), "Artificial Intelligence")],
                         cross=[entry(2, "2611.09002", "Query Agents", ("cs.DB", "cs.AI"), "Databases")])
MONDAY_DB = catchup_page("cs.DB", "Mon, 09 Nov 2026",
                         new=[entry(1, "2611.09002", "Query Agents", ("cs.DB", "cs.AI"), "Databases")],
                         replaced=[entry(2, "2610.00009", "Old Revised", ("cs.DB",), "Databases")])


class Arxiv:
    """arXiv, the test's: the answer for each URL (bytes, or a FetchError raised), and the URLs asked for."""

    def __init__(self, pages):
        self.pages, self.asked = dict(pages), []

    def __call__(self, url, timeout=None):
        self.asked.append(url)
        got = self.pages.get(url)
        if got is None:
            raise feed.FetchError(f"arXiv answered 404 Not Found for {url}", later=False)
        if isinstance(got, Exception):
            raise got
        return got


RSS_URL = "https://rss.arxiv.org/rss/cs.AI+cs.DB"


def catchup_url(cat, day):
    return f"https://arxiv.org/catchup/{cat}/{day}?abs=True"


class Host(app_kit.Host):
    def __init__(self, folder):
        self._folder, self.notices, self.told = folder, [], []
        self.open = [Instance(id="a" * 16, app="paper_news", gatherer="g1"), Instance(id="b" * 16, app="paper_news", gatherer="g2")]
        self.agents = {}                                   # instance id -> attached channels
        self.sent, self.started, self.busy = [], [], False

    def send_agent(self, instance, channel, text):
        if self.busy:
            raise app_kit.AppError("its terminal can't take a message now", 409)
        assert channel in self.agents.get(instance.id, []), channel
        self.sent.append((channel, text))

    def start_agent(self, instance, text, name=None, harness=None, model=None, folder=None):
        ch = f"ch{len(self.started) + 1}"
        self.started.append((instance.id, name, text))
        self.agents.setdefault(instance.id, []).append(ch)
        self.sent.append((ch, text))
        return ch

    def insert(self, instance, events, channel=None):
        raise AssertionError("Paper news inserts nothing")

    def read(self, instance, types, after=0, channel=None, limit=500):
        return []

    def attached(self, instance):
        return list(self.agents.get(instance.id, []))

    def tell_panel(self, instance, message):
        self.told.append((instance.id, message))

    def folder(self):
        return self._folder

    def instances(self):
        return list(self.open)

    def notify(self, instance, title, text="", key=None, show=("ag",), where=None):
        self.notices.append({"instance": instance.id, "title": title, "text": text, "key": key, "show": tuple(show),
                             "where": where})
        return "n1"


class ParseTest(unittest.TestCase):
    def test_the_feed(self):
        got = feed.parse_rss(TUESDAY)
        self.assertEqual(got.day, "2026-11-10")
        self.assertEqual([(p.id, p.kind, p.version) for p in got.papers],
                         [("2611.10001", "new", 1), ("2611.10002", "new", 1), ("2611.10003", "cross", 1),
                          ("2611.00004", "replace", 1)])
        p = got.papers[1]
        self.assertEqual(p.title, "Agents That Plan & Query")
        self.assertEqual(p.authors, ("Mia Ruiz", "Tom Ode", "Li Wu"))
        self.assertEqual(p.abstract, "We study things.")
        self.assertEqual(got.papers[0].categories, ("cs.DB", "cs.LG"))

    def test_an_empty_feed_still_says_its_day(self):
        got = feed.parse_rss(EMPTY_TUESDAY)
        self.assertEqual((got.day, got.papers), ("2026-11-10", []))
        with self.assertRaises(feed.FetchError):
            feed.parse_rss(b"<html>Rate exceeded.</html")

    def test_a_catch_up_page(self):
        papers, complete = feed.parse_catchup(MONDAY_DB.decode())
        self.assertTrue(complete)
        self.assertEqual([(p.id, p.kind) for p in papers], [("2611.09002", "new"), ("2610.00009", "replace")])
        p = papers[0]
        self.assertEqual((p.title, p.authors, p.categories, p.comments, p.abstract),
                         ("Query Agents", ("Kai Moe",), ("cs.DB", "cs.AI"), "12 pages", "An abstract."))
        _, complete = feed.parse_catchup(catchup_page("cs.AI", "x", new=[entry(1, "2611.1", "A", ("cs.AI",), "AI")],
                                                      shown=0).decode())
        self.assertFalse(complete)

    def test_several_categories_as_one_listing(self):
        ai, _ = feed.parse_catchup(MONDAY_AI.decode())
        db, _ = feed.parse_catchup(MONDAY_DB.decode())
        got = feed.merged([ai, db], ["cs.AI", "cs.DB"])
        self.assertEqual([(p.id, p.kind) for p in got],                 # a cross-list of cs.AI is new in cs.DB
                         [("2611.09001", "new"), ("2611.09002", "new"), ("2610.00009", "replace")])

    def test_listing_days(self):
        self.assertEqual(feed.listing_day(ny(2026, 11, 10, 1, 0)), "2026-11-10")
        self.assertEqual(feed.listing_day(ny(2026, 11, 9, 23, 0)), "2026-11-09")
        self.assertEqual(feed.listing_day(ny(2026, 11, 14, 12, 0)), "2026-11-13")   # Saturday: Friday's
        self.assertEqual(feed.listing_day(ny(2026, 11, 15, 22, 0)), "2026-11-13")   # Sunday night too
        self.assertEqual(feed.next_announced("2026-11-10"), ny(2026, 11, 10, 20, 0))
        self.assertEqual(feed.next_announced("2026-11-13"), ny(2026, 11, 15, 20, 0))  # Friday's: Sunday's
        self.assertEqual(feed.weekdays("2026-11-05", "2026-11-10"), ["2026-11-06", "2026-11-09"])


class AppBase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.now = ny(2026, 11, 10, 0, 16)
        self.arxiv = Arxiv({})
        self.app = PaperNewsApp(fetch=self.arxiv, clock=lambda: self.now, pause=0)
        self.app.manifest = app_kit.load(FOLDER)
        self.host = Host(tmp.name)
        self.app.start(self.host)
        self.addCleanup(self.app.stop)

    def days(self):
        return {d["day"]: d["status"] for d in self.app.store.days()}

    def call(self, tool, **args):
        return self.app.call(self.host.open[0], tool, args, Caller(channel="c1")).content[0]["text"]

    def request(self, method, path, query=None, body=None):
        r = self.app.request(self.host.open[0], method, path, query or {}, json.dumps(body or {}).encode())
        return r.status, json.loads(r.body or b"null")


class RunTest(AppBase):
    def test_first_run_before_the_day_is_out_shows_the_day_before_and_waits(self):
        self.arxiv.pages.update({RSS_URL: EMPTY_TUESDAY, catchup_url("cs.AI", "2026-11-09"): MONDAY_AI,
                                 catchup_url("cs.DB", "2026-11-09"): MONDAY_DB})
        self.assertEqual(self.app.scheduled("listing", self.now), WAIT_RETRY)
        self.assertEqual(self.days(), {"2026-11-09": "got"})
        self.assertEqual(self.app.status["waiting"], "2026-11-10")
        self.assertEqual([p["id"] for p in self.app.store.papers("2026-11-09")],
                         ["2611.09001", "2611.09002", "2610.00009"])
        self.assertEqual([n["instance"] for n in self.host.notices], ["a" * 16, "b" * 16])   # every instance told
        n = self.host.notices[0]
        self.assertEqual((n["title"], n["text"], n["key"], n["show"], n["where"]),
                         ("2 new papers · Mon, Nov 9",
                          "cs.AI 2 · cs.DB 1 · tell it what you work on to see what's for you", "listing", ("ag",),
                          {"day": "2026-11-09"}))
        self.assertIn(("a" * 16, {"news": "days", "day": "2026-11-09"}), self.host.told)
        # the day comes out: kept from the feed, told, done
        self.arxiv.pages[RSS_URL] = TUESDAY
        self.now = ny(2026, 11, 10, 0, 50)
        self.assertIsNone(self.app.scheduled("listing", self.now))
        self.assertEqual(self.days(), {"2026-11-09": "got", "2026-11-10": "got"})
        self.assertIsNone(self.app.status["waiting"])
        self.assertEqual(self.host.notices[-1]["title"], "3 new papers · Tue, Nov 10")
        self.assertTrue(self.host.notices[-1]["text"].startswith("cs.AI 1 · cs.DB 2 · tell it what you work on"))
        asked = len(self.arxiv.asked)
        self.assertIsNone(self.app.scheduled("listing", self.now))          # again: nothing new, nothing told
        self.assertEqual(len(self.host.notices), 4)
        self.assertEqual(len(self.arxiv.asked), asked + 1)                  # the feed alone

    def test_days_missed_are_caught_up_and_a_day_with_nothing_is_kept_so(self):
        self.app.store.put_day("2026-11-05", [], "rss", ["cs.AI", "cs.DB"])        # the app's first day
        thursday = rss("Thu, 12 Nov 2026 00:00:00 -0500", item("2611.12001", "Thursday Paper"))
        self.arxiv.pages.update({RSS_URL: thursday,
                                 catchup_url("cs.AI", "2026-11-06"): catchup_page("cs.AI", "Fri"),   # nothing that day
                                 catchup_url("cs.DB", "2026-11-06"): catchup_page("cs.DB", "Fri"),
                                 catchup_url("cs.AI", "2026-11-09"): MONDAY_AI, catchup_url("cs.DB", "2026-11-09"): MONDAY_DB,
                                 catchup_url("cs.AI", "2026-11-10"): feed.FetchError("arXiv answered 503", later=True)})
        self.now = ny(2026, 11, 12, 7, 0)
        self.assertIsNone(self.app.scheduled("listing", self.now))
        self.assertEqual(self.days(), {"2026-11-05": "got", "2026-11-06": "none", "2026-11-09": "got",
                                       "2026-11-10": "missed", "2026-11-11": "missed", "2026-11-12": "got"})
        self.assertIn("503", self.app.store.day("2026-11-10")["note"])
        self.assertEqual(self.host.notices[-1]["title"], "1 new paper · Thu, Nov 12")
        self.assertIn("1 earlier day caught up", self.host.notices[-1]["text"])
        # a missed day is tried again on the next run
        self.arxiv.pages[catchup_url("cs.AI", "2026-11-10")] = MONDAY_AI
        self.arxiv.pages[catchup_url("cs.DB", "2026-11-10")] = MONDAY_DB
        self.app.scheduled("listing", self.now)
        self.assertEqual(self.days()["2026-11-10"], "got")

    def test_no_listing_by_the_next_announcement_is_a_day_without_one(self):
        self.app.store.put_day("2026-11-09", [], "rss", ["cs.AI", "cs.DB"])
        self.arxiv.pages[RSS_URL] = EMPTY_TUESDAY
        self.now = ny(2026, 11, 10, 19, 0)
        self.assertEqual(self.app.scheduled("listing", self.now), WAIT_RETRY)
        self.now = ny(2026, 11, 10, 20, 30)
        self.assertIsNone(self.app.scheduled("listing", self.now))
        self.assertEqual(self.days()["2026-11-10"], "none")

    def test_arxiv_unreachable_tries_again(self):
        self.arxiv.pages[RSS_URL] = feed.FetchError("arXiv answered 429 Too Many Requests", later=True)
        self.assertEqual(self.app.scheduled("listing", self.now), ERROR_RETRY)
        self.assertIn("429", self.app.status["error"])
        self.arxiv.pages[RSS_URL] = feed.FetchError("arXiv answered 404", later=False)
        self.assertIsNone(self.app.scheduled("listing", self.now))

    def test_a_run_of_its_own_waiting_for_the_day_is_tried_again_until_it_is_done(self):
        waits = []
        self.app._wait_again = waits.append
        self.arxiv.pages.update({RSS_URL: EMPTY_TUESDAY, catchup_url("cs.AI", "2026-11-09"): MONDAY_AI,
                                 catchup_url("cs.DB", "2026-11-09"): MONDAY_DB})
        self.app._fetch_until_done()                     # the first open's, or Fetch now's
        self.assertEqual(waits, [WAIT_RETRY])
        self.arxiv.pages[RSS_URL] = TUESDAY
        self.app._fetch_until_done()
        self.assertEqual(waits, [WAIT_RETRY, None])
        self.app.scheduled("listing", self.now)          # the schedule's own run: it tries again itself
        self.assertEqual(waits, [WAIT_RETRY, None, None])

    def test_the_panel_opening_looks_for_a_day_missing_unless_looked_for_lately(self):
        started = []
        self.app.fetch_later = lambda force=False: started.append(force) or True
        self.request("GET", "state")
        self.assertEqual(started, [False])                    # Tuesday's not kept, never looked for
        self.app.status["checked"] = self.now - 60
        self.request("GET", "state")
        self.assertEqual(started, [False])                    # looked for a minute ago
        self.app.status["checked"] = self.now - 3600
        self.request("GET", "state")
        self.assertEqual(started, [False, False])
        self.app.store.put_day("2026-11-10", [], "rss", ["cs.AI", "cs.DB"])
        self.request("GET", "state")
        self.assertEqual(started, [False, False])             # kept: nothing to look for

    def test_notifications_on_this_computer_too_when_asked(self):
        self.app.store.set(notify_system=True)
        self.app.store.put_day("2026-11-09", [], "rss", ["cs.AI", "cs.DB"])
        self.arxiv.pages[RSS_URL] = TUESDAY
        self.app.scheduled("listing", self.now)
        self.assertEqual(self.host.notices[-1]["show"], ("ag", "system"))


class UseTest(AppBase):
    def setUp(self):
        super().setUp()
        self.app.store.put_day("2026-11-10", feed.merged([feed.parse_rss(TUESDAY).papers], ["cs.AI", "cs.DB"]), "rss",
                               ["cs.AI", "cs.DB"])
        ai, _ = feed.parse_catchup(MONDAY_AI.decode())
        db, _ = feed.parse_catchup(MONDAY_DB.decode())
        self.app.store.put_day("2026-11-09", feed.merged([ai, db], ["cs.AI", "cs.DB"]), "catchup", ["cs.AI", "cs.DB"])

    def test_agents_list_a_day(self):
        got = self.call("list")
        lines = got.splitlines()
        self.assertTrue(lines[0].startswith("arXiv listing of Tue, Nov 10 (cs.AI, cs.DB): 3 papers (2 new, 1 "
                                            "cross-lists), and 1 updated"))
        self.assertEqual(lines[1], "2611.10001 [cs.DB; cs.LG] Learned Indexes for Joins — Ada Lane, Bo Chen")
        self.assertIn("(cross-list) Vision for Tables", lines[3])
        self.assertNotIn("An Older Paper", got)                           # updated ones only when asked
        self.assertIn("Days kept: 2026-11-10 (3), 2026-11-09 (2)", lines[-1])
        self.assertIn("An Older Paper", self.call("list", kind="updated"))
        got = self.call("list", day="2026-11-09", query="query agents")
        self.assertIn("1 match", got.splitlines()[0])
        self.assertIn("2611.09002", got)
        self.assertIn("2611.10002", self.call("list", category="cs.AI"))
        self.assertNotIn("2611.10001", self.call("list", category="cs.AI"))
        self.assertIn("No listing kept for '2026-10-01'", self.call("list", day="2026-10-01"))

    def test_agents_read_a_paper_by_any_spelling_of_its_id(self):
        for pid in ("2611.10002", "2611.10002v1", "arXiv:2611.10002", "https://arxiv.org/abs/2611.10002v1"):
            got = self.call("paper", id=pid)
            self.assertIn("2611.10002v1: Agents That Plan & Query", got)
            self.assertIn("Authors: Mia Ruiz, Tom Ode, Li Wu", got)
            self.assertIn("Abstract: We study things.", got)
        self.assertIn("not in a listing the app has kept", self.call("paper", id="2501.00001"))
        both = self.call("paper", id="2611.10001, 2611.09001")
        self.assertIn("Learned Indexes", both)
        self.assertIn("Reasoning Over Plans", both)

    def test_saved_papers(self):
        self.assertEqual(self.request("POST", "save", body={"id": "2611.10003", "saved": True}), (200, {"ok": True}))
        self.assertEqual(self.request("POST", "save", body={"id": "nope"})[0], 404)
        self.assertIn("· saved by the user", self.call("paper", id="2611.10003"))
        got = self.call("list", day="saved")
        self.assertTrue(got.startswith("The user's saved papers"))
        self.assertIn("Vision for Tables", got)
        status, body = self.request("GET", "saved")
        self.assertEqual([p["id"] for p in body["papers"]], ["2611.10003"])
        self.assertTrue(next(p for p in self.request("GET", "day", {"day": "2026-11-10"})[1]["papers"]
                             if p["id"] == "2611.10003")["saved"])

    def test_the_panel_reads_its_state_days_and_searches(self):
        status, state = self.request("GET", "state")
        self.assertEqual(status, 200)
        self.assertEqual([d["day"] for d in state["days"]], ["2026-11-10", "2026-11-09"])
        tue = state["days"][0]
        self.assertEqual(tue["kinds"], {"new": 2, "cross": 1, "replace": 1})
        self.assertEqual(tue["by_category"], {"cs.AI": {"listed": 1, "updated": 0}, "cs.DB": {"listed": 2, "updated": 1}})
        self.assertEqual(state["status"]["schedule"], ["at 00:15 Mon-Fri (America/New_York)"])
        self.assertEqual(state["status"]["next"], ny(2026, 11, 11, 0, 15))
        _, day = self.request("GET", "day", {"day": "2026-11-10"})
        self.assertEqual(day["day"]["categories"], ["cs.AI", "cs.DB"])
        self.assertEqual([p["kind"] for p in day["papers"]], ["new", "new", "cross", "replace"])
        self.assertEqual(day["papers"][0]["links"]["pdf"], "https://arxiv.org/pdf/2611.10001")
        _, found = self.request("GET", "search", {"q": "QUERY agents"})
        self.assertEqual([(p["id"], p["day"]) for p in found["papers"]], [("2611.10002", "2026-11-10"),
                                                                           ("2611.09002", "2026-11-09")])

    def test_settings(self):
        fetched = []
        self.app.fetch_later = lambda force=False: fetched.append(force) or True
        status, got = self.request("POST", "settings", body={"categories": "cs.CL, stat.ML cs.CL", "replacements": True})
        self.assertEqual(status, 200)
        self.assertEqual(got["settings"], {"categories": ["cs.CL", "stat.ML"], "replacements": True,
                                           "notify_system": False})
        self.assertEqual(fetched, [True])                                # new categories: the day fetched again
        self.request("POST", "settings", body={"notify_system": True})
        self.assertEqual(fetched, [True])
        for bad in ("databases", "cs.AI zz.XY", [], "cs.AI " * 13):
            with self.subTest(bad=bad):
                status, got = self.request("POST", "settings", body={"categories": bad})
                self.assertEqual(status, 400, got)
        self.assertTrue(feed.is_category("hep-th") and feed.is_category("q-bio.NC"))


def paper(n, title=None):
    return feed.Paper(id=f"2611.2{n:04d}", title=title or f"Paper number {n}", authors=("Ana Ito",),
                      abstract="A long abstract. " * 60, categories=("cs.DB",), kind="new")


INPUTS = {"scholar": "https://scholar.google.com/citations?user=abc", "keywords": "learned indexes, query planning",
          "topics": "LLMs for data processing\nquery optimization", "papers": "2611.10001", "notes": "Systems papers."}
PROFILE = {"summary": "Builds systems that use LLMs to process data.", "core_topics": ["LLM-powered data processing"],
           "related_topics": ["agents"], "methods": ["query optimization"], "followed_papers": [],
           "followed_people": [], "keywords": ["learned index"], "not_interested": ["pure theory"],
           "guidance": "Systems papers with evaluations."}


class AgentTest(AppBase):
    """The app's own agent: asked to write the summary of the user's interests, to pick each day's papers, and to
    write the summary again after every FEEDBACK_EVERY words of the user's."""

    def setUp(self):
        super().setUp()
        self.app.store.put_day("2026-11-10", feed.merged([feed.parse_rss(TUESDAY).papers], ["cs.AI", "cs.DB"]), "rss",
                               ["cs.AI", "cs.DB"])

    def agent_call(self, tool, **args):
        return self.app.call(self.host.open[0], tool, args, Caller(channel="ch1"))

    def set_up_interests(self):
        status, got = self.request("POST", "interests", body=INPUTS)
        self.assertEqual(status, 200, got)
        return got

    def test_the_users_interests_start_an_agent_that_writes_the_summary_then_picks_the_day(self):
        got = self.set_up_interests()
        self.assertEqual(got["inputs"]["keywords"], ["learned indexes", "query planning"])
        self.assertEqual(got["inputs"]["topics"], ["LLMs for data processing", "query optimization"])
        self.assertTrue(got["summarizing"])
        (inst, name, text), = self.host.started                  # an agent of its own, started with the ask
        self.assertEqual((inst, name), ("a" * 16, "Paper news"))
        self.assertTrue(text.startswith("(Paper news · Your interests: write a summary of the user's research interests)"))
        self.assertIn("- Their profile: https://scholar.google.com/citations?user=abc", text)
        self.assertIn("  - 2611.10001", text)
        self.assertIn("paper_news_profile", text)
        self.assertEqual(self.app.store.get("agent")["channel"], "ch1")
        self.assertEqual(self.request("GET", "state")[1]["interests"]["agent"], "ch1")
        # the agent saves it: then it is asked to pick from the latest day, in a message of its own
        said = self.agent_call("profile", **PROFILE).content[0]["text"]
        self.assertIn("Saved the summary", said)
        self.assertIsNone(self.app.store.get("summarizing"))
        self.assertEqual(len(self.host.started), 1)               # the same agent, sent the next
        ch, judge = self.host.sent[-1]
        self.assertEqual(ch, "ch1")
        self.assertTrue(judge.startswith("(Paper news · Tue, Nov 10: pick the papers related to the user, of 3 new in cs.AI, cs.DB)"))
        self.assertIn("- Core topics: LLM-powered data processing", judge)
        self.assertIn("[2611.10001] Learned Indexes for Joins (cs.DB; cs.LG)", judge)
        self.assertNotIn("An Older Paper", judge)                 # updated ones not asked about
        self.assertIn('day "2026-11-10"', judge)
        self.assertIsNotNone(self.app.store.judged("2026-11-10")["asked_at"])
        # it picks: saved, the user notified of them
        got = self.agent_call("relevant", day="2026-11-10", picks=[
            {"id": "2611.10001v1", "score": 3, "why": "A learned index, which they follow."},
            {"id": "2611.10002", "score": 1, "why": "Agents that query data."}])
        self.assertEqual(got.content[0]["text"], "Saved 2 picks for 2026-11-10.")
        _, day = self.request("GET", "day", {"day": "2026-11-10"})
        self.assertEqual({p["id"]: p["pick"] for p in day["papers"] if p["pick"]},
                         {"2611.10001": {"score": 3, "why": "A learned index, which they follow."},
                          "2611.10002": {"score": 1, "why": "Agents that query data."}})
        self.assertIsNotNone(day["judged"]["done_at"])
        n = self.host.notices[-1]
        self.assertEqual((n["title"], n["where"]), ("2 papers for you · Tue, Nov 10", {"day": "2026-11-10"}))
        self.assertTrue(n["text"].startswith("Learned Indexes for Joins · Agents That Plan & Query"))
        self.assertEqual(self.request("GET", "state")[1]["days"][0]["judged"]["n"], 2)

    def test_what_the_agent_cant_save(self):
        self.set_up_interests()
        bad = self.agent_call("profile", core_topics="not a list but fine", summary=3)
        self.assertTrue(bad.is_error)
        self.assertTrue(self.agent_call("profile", keywords=["only this"]).is_error)   # no summary nor core topics
        self.assertTrue(self.agent_call("profile", colour="blue").is_error)
        self.agent_call("profile", **PROFILE)
        got = self.agent_call("relevant", day="2026-11-10", picks=[{"id": "2611.99999", "score": 3, "why": "x"}])
        self.assertTrue(got.is_error)
        self.assertIn("not in 2026-11-10's listing: 2611.99999", got.content[0]["text"])
        self.assertTrue(self.agent_call("relevant", day="2026-11-10", picks=[
            {"id": "2611.10001", "score": 5, "why": "x"}]).is_error)
        self.assertTrue(self.agent_call("relevant", day="2026-11-10", picks=[
            {"id": "2611.10001", "score": 2, "why": " "}]).is_error)
        self.assertTrue(self.agent_call("relevant", day="2026-10-01", picks=[]).is_error)
        self.assertIsNone(self.app.store.judged("2026-11-10")["done_at"])            # nothing saved
        self.assertEqual(self.agent_call("relevant", day="2026-11-10", picks=[]).content[0]["text"],
                         "Saved 0 picks for 2026-11-10.")
        read = self.agent_call("profile").content[0]["text"]                         # no fields: read it
        self.assertIn("Keywords: learned indexes, query planning", read)
        self.assertIn("- Research in brief: Builds systems that use LLMs to process data.", read)

    def test_a_new_day_goes_to_the_agent_and_its_picks_to_the_user(self):
        self.set_up_interests()
        self.agent_call("profile", **PROFILE)
        self.agent_call("relevant", day="2026-11-10", picks=[])
        notices = len(self.host.notices)
        wednesday = rss("Wed, 11 Nov 2026 00:00:00 -0500", item("2611.11001", "Wednesday Paper"))
        self.arxiv.pages[RSS_URL] = wednesday
        self.now = ny(2026, 11, 11, 0, 20)
        self.app.scheduled("listing", self.now)
        self.assertTrue(self.host.sent[-1][1].startswith("(Paper news · Wed, Nov 11: pick the papers related to the user, of 1 new"))
        self.assertEqual(len(self.host.notices), notices)       # no notice of the whole day: of the picks, once made

    def test_every_twenty_words_of_feedback_the_summary_is_written_again(self):
        self.set_up_interests()
        self.agent_call("profile", **PROFILE)
        self.app.store.put_day("2026-11-09", [paper(n) for n in range(25)], "rss", ["cs.AI", "cs.DB"])
        self.agent_call("relevant", day="2026-11-09", picks=[{"id": "2611.20000", "score": 2, "why": "Close to it."}])
        self.request("POST", "profile", body={"fields": {"keywords": ["learned index", "cardinality estimation"]}})
        sent = len(self.host.sent)
        for n in range(19):
            status, got = self.request("POST", "feedback", body={"id": f"2611.2{n:04d}", "day": "2026-11-09",
                                                                 "verdict": "not" if n == 0 else "relevant"})
            self.assertEqual(status, 200, got)
        self.assertEqual(got, {"count": 19, "every": 20, "summarizing": False})
        self.request("POST", "feedback", body={"id": "2611.20005", "verdict": None})    # taken back: not counted
        self.assertEqual(self.request("GET", "interests")[1]["feedback"]["count"], 18)
        self.assertEqual(len(self.host.sent), sent)
        for n in (5, 19):
            _, got = self.request("POST", "feedback", body={"id": f"2611.2{n:04d}", "day": "2026-11-09",
                                                            "verdict": "relevant"})
        self.assertEqual(got, {"count": 0, "every": 20, "summarizing": True})
        text = self.host.sent[-1][1]
        self.assertTrue(text.startswith("(Paper news · Your interests: update the summary of the user's interests from their "
                                        "last 20 feedback)"))
        self.assertIn("- not relevant: [2611.20000] Paper number 0 (you picked it: Close to it.)", text)
        self.assertIn("- relevant: [2611.20001] Paper number 1 (you hadn't picked it)", text)
        self.assertIn("The user wrote these fields themselves: Keywords.", text)
        self.assertIn("- Keywords: learned index; cardinality estimation", text)
        # written again: counting starts over; what the user wrote stays theirs
        self.agent_call("profile", **{**PROFILE, "keywords": ["learned index", "cardinality estimation"]})
        _, got = self.request("GET", "interests")
        self.assertEqual(got["feedback"]["count"], 0)
        self.assertEqual(got["profile"]["edited"], ["keywords"])
        self.assertEqual(got["profile"]["by"], "agent")
        self.assertEqual([f["label"] for f in got["fields"]][:2], ["Research in brief", "Core topics"])

    def test_a_message_its_agents_terminal_cant_take_is_sent_again(self):
        self.set_up_interests()
        self.agent_call("profile", **PROFILE)
        self.agent_call("relevant", day="2026-11-10", picks=[])
        self.host.busy = True
        sent = len(self.host.sent)
        status, _ = self.request("POST", "judge", body={"day": "2026-11-10"})
        self.assertEqual(status, 200)
        self.assertEqual(len(self.host.sent), sent)
        self.app._outbox_timer.cancel()
        self.host.busy = False
        self.app._send_later()
        self.assertTrue(self.host.sent[-1][1].startswith("(Paper news · Tue, Nov 10: pick the papers"))

    def asked_to_pick(self):
        """The summary saved, so the agent asked to pick Tuesday: how many messages it was sent by then."""
        self.set_up_interests()
        self.agent_call("profile", **PROFILE)
        self.assertTrue(self.host.sent[-1][1].startswith("(Paper news · Tue, Nov 10: pick the papers"))
        return len(self.host.sent)

    def picks_asked(self):
        return [t for _, t in self.host.sent if t.startswith("(Paper news · Tue, Nov 10: pick the papers")]

    def test_an_ask_to_pick_never_answered_is_asked_again(self):
        self.asked_to_pick()
        self.now += STALE - 60
        self.assertIsNone(self.app.scheduled("picks", self.now))
        self.assertEqual(len(self.picks_asked()), 1)               # not yet: it may still be at it
        self.now += 60
        self.app.scheduled("picks", self.now)
        self.assertEqual(len(self.picks_asked()), 2)               # never answered: asked again
        self.assertEqual(self.app.store.judged("2026-11-10")["asked_at"], self.now)
        self.app.scheduled("picks", self.now + 60)
        self.assertEqual(len(self.picks_asked()), 2)               # and given its time again
        self.agent_call("relevant", day="2026-11-10", picks=[])
        self.now += 2 * STALE
        self.app.scheduled("picks", self.now)
        self.assertEqual(len(self.picks_asked()), 2)               # answered: no more

    def test_no_ask_again_while_its_agent_works_and_only_a_few_it_took_up(self):
        self.asked_to_pick()
        self.now += STALE - 300
        self.agent_call("paper", id="2611.10001")                  # it took the ask up, and is at it
        self.now += 600
        self.app.scheduled("picks", self.now)
        self.assertEqual(len(self.picks_asked()), 1)
        self.now += STALE
        self.app.scheduled("picks", self.now)                      # its turn ended with no picks: asked again
        self.assertEqual(len(self.picks_asked()), 2)
        self.now += 60
        self.agent_call("list")                                    # took that one up too
        for _ in range(4):
            self.now += STALE
            self.app.scheduled("picks", self.now)
        self.assertEqual(len(self.picks_asked()), ASKS_TAKEN)      # then left to the user's "Ask it to pick"
        self.assertEqual(self.request("POST", "judge", body={"day": "2026-11-10"})[0], 200)
        self.assertEqual(len(self.picks_asked()), ASKS_TAKEN + 1)
        self.now += STALE
        self.app.scheduled("picks", self.now)                      # the user's ask: counted afresh
        self.assertEqual(len(self.picks_asked()), ASKS_TAKEN + 2)

    def test_asks_it_never_took_up_go_on_to_a_limit(self):
        self.asked_to_pick()
        for _ in range(ASKS_MAX + 5):
            self.now += STALE
            self.app.scheduled("picks", self.now)
        self.assertEqual(len(self.picks_asked()), ASKS_MAX)

    def test_an_ask_waiting_for_its_terminal_is_not_asked_again(self):
        self.asked_to_pick()
        self.host.busy = True
        self.now += STALE
        self.app.scheduled("picks", self.now)                      # asked again: kept, its terminal busy
        self.now += STALE
        self.app.scheduled("picks", self.now)                      # still kept: not one more
        self.assertEqual([m[2] for m in self.app._outbox], ["judge:2026-11-10"])
        self.app._outbox_timer.cancel()
        self.host.busy = False
        self.app._send_later()
        self.assertEqual(len(self.picks_asked()), 2)

    def test_only_the_newest_day_is_asked_again(self):
        self.asked_to_pick()
        wednesday = rss("Wed, 11 Nov 2026 00:00:00 -0500", item("2611.11001", "Wednesday Paper"))
        self.arxiv.pages[RSS_URL] = wednesday
        self.now = ny(2026, 11, 11, 0, 20)
        self.app.scheduled("listing", self.now)
        self.agent_call("relevant", day="2026-11-11", picks=[])
        self.now += STALE
        sent = len(self.host.sent)
        self.app.scheduled("picks", self.now)
        self.assertEqual(len(self.host.sent), sent)                # Tuesday never answered, but not the newest

    def test_no_ask_again_before_the_agent_was_ever_asked(self):
        self.set_up_interests()
        self.now += STALE
        sent = len(self.host.sent)
        self.app.scheduled("picks", self.now)                      # no summary yet: nothing to pick by
        self.assertEqual(len(self.host.sent), sent)

    def test_its_agent_is_found_on_the_window_it_works_with_now(self):
        self.set_up_interests()
        self.agent_call("profile", **PROFILE)
        self.host.open.pop(0)                                   # its window closed, the agent attached to the other's
        self.host.agents = {"b" * 16: ["ch1"]}
        self.request("POST", "judge", body={"day": "2026-11-10"})
        self.assertEqual(len(self.host.started), 1)             # no new agent: the same one, told
        ch, text = self.host.sent[-1]
        self.assertEqual(ch, "ch1")
        self.assertTrue(text.startswith("(Paper news · Tue, Nov 10: pick the papers"))
        self.assertEqual(self.request("GET", "state")[1]["interests"]["agent"], "ch1")

    def test_what_the_user_tells_it_is_checked(self):
        for bad in ({}, {"scholar": "my page"}, {"keywords": 3}):
            with self.subTest(bad=bad):
                self.assertEqual(self.request("POST", "interests", body=bad)[0], 400)
        self.assertEqual(self.host.started, [])
        self.assertEqual(self.request("POST", "judge", body={"day": "2026-11-10"})[0], 409)   # no summary yet


class ManifestTest(unittest.TestCase):
    def test_it_loads_with_its_schedule_and_tools(self):
        m = app_kit.load(FOLDER)
        self.assertEqual((m.name, m.label, m.instances, m.offer), ("paper_news", "Paper news", "one", "attached"))
        self.assertEqual([t.mcp("paper_news")["name"] for t in m.tools],
                         ["paper_news_list", "paper_news_paper", "paper_news_profile", "paper_news_relevant"])
        from ag_apps.paper_news import interests as it
        props = m.tool("profile").input_schema["properties"]
        self.assertEqual(list(props), list(it.FIELD_NAMES))                     # the summary's fields, as the app's
        self.assertEqual([props[n].get("description") for n in it.FIELD_NAMES], [f[3] for f in it.FIELDS])
        self.assertTrue(m.capabilities.message_agents)
        self.assertEqual(m.asked.when, "(Paper news · ")
        import re
        got = re.match(m.asked.pattern, "(Paper news · Tue, Nov 10: pick the papers related to the user, of 3 new)\n\nThe")
        self.assertEqual(got.groups(), ("pick the papers related to the user, of 3 new", "Tue, Nov 10"))
        self.assertEqual([(s.name, s.at, s.every, s.days, s.timezone) for s in m.schedules],
                         [("listing", ("00:15",), 0, (0, 1, 2, 3, 4), "America/New_York"),
                          ("picks", (), 1800, (), "")])
        self.assertTrue(m.capabilities.notify)
        self.assertTrue(os.path.isfile(os.path.join(FOLDER, m.mark)))


if __name__ == "__main__":
    unittest.main()
