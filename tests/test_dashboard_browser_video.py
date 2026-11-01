"""A Browser's screen as video (ag_dashboard/browser_video.py): what a page watching is sent -- every chunk from a key
frame on, in order; a new key frame once it falls behind -- how the capture learns the window's bars and falls back to
the JPEG frames, and, where a Chrome is installed, the whole of it against a real one: the tab captured, H.264 at the
view's size, a click's change as a small chunk, the video following the tab shown, and turned off by the config."""
import json
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ag_dashboard import browser, browser_video, sessions  # noqa: E402
from test_dashboard_browser import Home  # noqa: E402


def chunk(t: str, n: int = 0, **more) -> dict:
    return {"t": t, "ts": n, "d": "AAAA", **more}


class ViewerTest(unittest.TestCase):
    """What a page watching a Browser is sent of its video."""

    def take(self, v: browser.Viewer) -> list:
        return [(name, value["t"], value["ts"]) for name, value in (v.take(0.01) or []) if name == "video"]

    def test_a_page_gets_every_chunk_from_a_key_frame_on_in_order(self):
        v = browser.Viewer(video=True)
        self.assertTrue(v.give(chunk=chunk("delta", 1)))      # no key frame yet: nothing it could draw
        self.assertEqual(self.take(v), [])
        v.give(chunk=chunk("key", 2))
        v.give(chunk=chunk("delta", 3))
        v.give(chunk=chunk("delta", 4))
        self.assertEqual(self.take(v), [("video", "key", 2), ("video", "delta", 3), ("video", "delta", 4)])
        v.give(chunk=chunk("delta", 5))
        v.give(chunk=chunk("key", 6))                          # a key frame: what was waiting before it is of no use
        self.assertEqual(self.take(v), [("video", "key", 6)])

    def test_a_page_too_far_behind_waits_for_a_new_key_frame(self):
        v = browser.Viewer(video=True)
        v.give(chunk=chunk("key", 0))
        wanted = [v.give(chunk=chunk("delta", n)) for n in range(1, browser_video.KEEP_CHUNKS + 1)]
        self.assertEqual(wanted.count(False), 1)               # the backlog dropped, once: a key frame asked for
        self.assertEqual(self.take(v), [])
        v.give(chunk=chunk("delta", 999))
        self.assertEqual(self.take(v), [])
        v.give(chunk=chunk("key", 1000))
        self.assertEqual(self.take(v), [("video", "key", 1000)])


class BrowserVideoTest(Home):
    """The Browser's part: chunks to the pages that decode video only, a page behind asking a key frame, the tab's
    title while its capture starts not taken for its own."""

    def setUp(self):
        super().setUp()
        self.bs = browser.Browsers(sessions.Sessions())
        self.addCleanup(self.bs.close)
        self.b = browser.Browser(self.bs, "0123456789abcdef", {"gatherer": "g", "root": self.root, "session_id": "s"})

    def test_chunks_go_to_the_pages_that_decode_video_only(self):
        video, jpeg = browser.Viewer(video=True), browser.Viewer(video=False)
        self.b.viewers += [video, jpeg]
        self.b._chunk(chunk("key", 1, codec="avc1.640033", w=200, h=100))
        self.assertEqual([n for n, _ in video.take(0.01)], ["video"])
        self.assertEqual(jpeg.take(0.01), [])

    def test_a_page_behind_asks_a_key_frame(self):
        asked = []
        self.b.video.key = lambda: asked.append(1)
        v = browser.Viewer(video=True)
        self.b.viewers.append(v)
        self.b._chunk(chunk("key", 0))
        for n in range(browser_video.KEEP_CHUNKS + 1):
            self.b._chunk(chunk("delta", n + 1))
        self.assertEqual(asked, [1])

    def test_the_capture_extension_is_written_to_the_home(self):
        path = browser_video.extension_dir(self.tmp.name)
        with open(os.path.join(path, "manifest.json")) as fh:
            manifest = json.load(fh)
        self.assertEqual(sorted(manifest["permissions"]), ["activeTab", "tabCapture"])   # nothing more
        self.assertTrue(all(os.path.exists(os.path.join(path, f)) for f in ("worker.js", "capture.html", "capture.js")))


class CaptureTest(unittest.TestCase):
    """The capture's bookkeeping, no Chrome: what it learns from the frames' size, and its falling back."""

    def setUp(self):
        self.jobs, self.changed = [], []
        self.c = browser_video.Capture(lambda i: None, "/nowhere", self.jobs.append, lambda: self.changed.append(1))
        self.c.tab, self.c.view = object(), (100, 50, 2.0)

    def test_a_frame_short_of_the_view_grows_the_window_by_what_it_lacks(self):
        got = self.c.got(json.dumps({"t": "key", "ts": 1, "d": "AA", "codec": "avc1.640033", "w": 200, "h": 88}))
        self.assertEqual(got["w"], 200)                        # still shown: the top of the page, where it is
        self.assertTrue(self.c.ok)
        self.assertEqual(self.c.extra, 6)                      # (100 - 88) / 2: the "sharing this tab" bar
        self.assertEqual(self.jobs, [self.c._refit])
        self.assertEqual(self.changed, [1])                    # the video came: the JPEG frames to stop
        self.c.got(json.dumps({"t": "key", "ts": 2, "d": "AA", "codec": "avc1.640033", "w": 200, "h": 100}))
        self.assertEqual((self.c.extra, len(self.jobs)), (6, 1))

    def test_a_capture_failing_falls_back_and_is_given_up_on_that_tab_after_some(self):
        self.c.cdp = None
        tab, other = object(), object()
        for n in range(browser_video.GIVE_UP):
            self.assertTrue(self.c.usable(tab))
            self.c.tab = tab
            self.assertIsNone(self.c.got(json.dumps({"error": "encoder: broken"})))
        self.assertFalse(self.c.usable(tab))
        self.assertTrue(self.c.usable(other))                  # another tab: tried
        self.assertEqual(len(self.changed), browser_video.GIVE_UP)
        self.assertEqual(self.c.why, "encoder: broken")
        self.c.retry()                                         # the tab went to another page: tried again
        self.assertTrue(self.c.usable(tab))


@unittest.skipUnless(browser.available(), "no Chrome here")
class VideoChromeTest(Home):
    """Against a real Chrome, the dashboard's own: the tab captured and encoded, as a page watching gets it."""

    def setUp(self):
        super().setUp()
        self.bs = browser.Browsers(sessions.Sessions())
        self.addCleanup(self.bs.close)
        self.cfg = self.bs.create("g", self.root, "claude")
        self.b = self.bs.get(self.cfg["key"])

    def watch(self, v: browser.Viewer, until, secs: float = 15.0) -> list:
        got, end = [], time.time() + secs
        while time.time() < end:
            got += v.take(0.05) or []
            if until(got):
                break
        return got

    def keys(self, got: list) -> list:
        return [(c["w"], c["h"]) for name, c in got if name == "video" and c["t"] == "key"]

    def test_the_screen_comes_as_video_at_the_view_s_size_and_a_click_as_a_small_chunk(self):
        self.b.live()
        self.b.resize(800, 600, 2.0)
        self.bs.call(self.cfg["key"], "navigate", {"url": os.path.join(self.root, "index.html")})
        v = self.b.join(video=True)
        self.addCleanup(self.b.leave, v)
        got = self.watch(v, lambda g: (1600, 1200) in self.keys(g))
        self.assertIn((1600, 1200), self.keys(got), got[-3:])  # the page at its size, 2x (its window fitted to it)
        self.assertEqual(next(c for n, c in got if n == "video")["t"], "key")
        end = time.time() + 5
        while time.time() < end and not (self.b.state()["video"] and self.b.tab().cast is None):
            time.sleep(0.05)
        self.assertTrue(self.b.state()["video"])
        self.assertIsNone(self.b.tab().cast)                   # every page watching decodes video: no JPEG frames
        self.b.input([{"type": "mouse", "kind": "mousePressed", "x": 30, "y": 30, "button": "left", "buttons": 1, "clickCount": 1},
                      {"type": "mouse", "kind": "mouseReleased", "x": 30, "y": 30, "button": "left", "clickCount": 1}])
        self.bs.call(self.cfg["key"], "type", {"ref": self.ref("textbox \"Email\""), "text": "me@example.com"})
        got = self.watch(v, lambda g: any(n == "video" and c["t"] == "delta" for n, c in g), 5)
        deltas = [c for n, c in got if n == "video" and c["t"] == "delta"]
        self.assertTrue(deltas)
        self.assertLess(len(deltas[0]["d"]), 100_000)          # what changed, not the whole screen again
        jpeg = self.b.join(video=False)                        # a page that can't decode video: JPEG frames for it
        self.addCleanup(self.b.leave, jpeg)
        got = self.watch(jpeg, lambda g: any(n == "frame" for n, _ in g), 10)
        self.assertIn("frame", [n for n, _ in got])

    def ref(self, starts: str) -> str:
        outline = self.bs.call(self.cfg["key"], "snapshot", {})["content"][0]["text"]
        line = next(x for x in outline.splitlines() if starts in x)
        return line.split("[", 1)[1].split("]", 1)[0]

    def test_the_video_follows_the_tab_shown_and_its_navigations(self):
        self.b.live()
        self.b.resize(700, 500, 1.0)
        v = self.b.join(video=True)
        self.addCleanup(self.b.leave, v)
        self.assertTrue(self.keys(self.watch(v, lambda g: bool(self.keys(g)))), self.b.video.why)
        first = self.b.video.tab
        t0 = time.time()
        opened = self.bs.call(self.cfg["key"], "tabs", {"action": "new", "url": os.path.join(self.root, "two.html")})
        self.assertFalse(opened.get("isError"), f"{opened} after {time.time() - t0:.1f}s")
        got = self.watch(v, lambda g: bool(self.keys(g)) and self.b.video.tab is self.b.tab() is not first)
        why = (f"video on {self.b.video.tab and self.b.video.tab.url}, "
               f"failed {self.b.video.failed} ({self.b.video.why}), tabs {[t.url for t in self.b.tabs]} shown {self.b.active}")
        self.assertIsNot(self.b.video.tab, first, why)
        self.assertIs(self.b.video.tab, self.b.tab(), why)
        self.assertTrue(self.keys(got))
        self.bs.call(self.cfg["key"], "navigate", {"url": os.path.join(self.root, "index.html")})
        got = self.watch(v, lambda g: any(n == "video" for n, _ in g), 5)
        self.assertTrue([n for n, _ in got if n == "video"])  # still captured after the tab went to another page

    def test_the_view_grown_or_shrunk_the_video_comes_at_its_new_size(self):
        self.b.live()
        self.b.resize(700, 500, 2.0)
        v = self.b.join(video=True)
        self.addCleanup(self.b.leave, v)
        self.assertIn((1400, 1000), self.keys(self.watch(v, lambda g: (1400, 1000) in self.keys(g))))
        for w, h in ((900, 650), (600, 450)):            # wider (a capture grows no bigger than it began), narrower
            self.b.resize(w, h, 2.0)
            got = self.watch(v, lambda g: (w * 2, h * 2) in self.keys(g), 10)
            self.assertIn((w * 2, h * 2), self.keys(got), self.b.video.why)

    def test_a_page_that_keeps_its_own_title_is_captured_all_the_same(self):
        self.write("mine.html", """<!doctype html><title>My doc - Docs</title><h1>a page keeping its title</h1>
<script>const mine = document.title; new MutationObserver(() => { if (document.title !== mine) document.title = mine; })
  .observe(document.querySelector('title'), { childList: true, characterData: true, subtree: true });</script>""")
        self.b.live()
        self.b.resize(700, 500, 1.0)
        self.bs.call(self.cfg["key"], "navigate", {"url": os.path.join(self.root, "mine.html")})
        v = self.b.join(video=True)
        self.addCleanup(self.b.leave, v)
        got = self.watch(v, lambda g: bool(self.keys(g)))
        self.assertTrue(self.keys(got), self.b.video.why)
        self.assertEqual(self.b.tab().title, "My doc - Docs")

    def test_the_config_turns_it_off(self):
        self.config('[dashboard]\nbrowser_video = false\n')
        self.b.live()
        v = self.b.join(video=True)
        self.addCleanup(self.b.leave, v)
        got = self.watch(v, lambda g: any(n == "frame" for n, _ in g), 10)
        time.sleep(1)
        got += v.take(0.05) or []
        self.assertIn("frame", [n for n, _ in got])
        self.assertNotIn("video", [n for n, _ in got])


if __name__ == "__main__":
    unittest.main()
