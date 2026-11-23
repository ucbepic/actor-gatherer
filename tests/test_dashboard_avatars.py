"""Each actor's avatar (ag_dashboard/avatars.py): the pictures in the folder, who is given which and
kept, the open actors of a gatherer in different hues, how each moves at work, and the server serving them."""
import io
import os
import re
import sqlite3
import sys
import tempfile
import threading
import unittest
import unittest.mock
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from ag_dashboard import avatars, server  # noqa: E402
import page_source  # noqa: E402
from ag_dashboard import home as dashboard_home  # noqa: E402

CIRCLE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"{}><circle cx="32" cy="32" r="32"/></svg>'


def actor(channel, created, status="idle"):
    return {"channel": channel, "created": created, "status": status}


class AvatarsBase(unittest.TestCase):
    """A home of the test's own, and a folder of pictures of its own: `pictures` {name: hue}."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = dashboard_home.HOME, avatars.DIR
        dashboard_home.HOME = os.path.join(self.tmp.name, "ag")
        avatars.DIR = os.path.join(self.tmp.name, "avatars")

    def tearDown(self):
        dashboard_home.HOME, avatars.DIR = self.saved
        self.tmp.cleanup()

    def pictures(self, named):
        for name, hue in named.items():
            os.makedirs(os.path.join(avatars.DIR, name.split("/")[0]), exist_ok=True)
            with open(os.path.join(avatars.DIR, name + ".svg"), "w") as fh:
                fh.write(CIRCLE.format(f' data-hue="{hue}"' if hue else ""))

    def given(self, home):
        return {(g["name"], a["channel"]): a["avatar"] for g in home["gatherers"] for a in g["agents"]}


class AvatarsTest(AvatarsBase):
    def test_the_pool_is_every_picture_in_the_folder_by_its_hue(self):
        self.assertEqual(avatars.pictures(), {})                              # no folder: none
        self.pictures({"robot/a-red": "red", "food/pear": "lime", "animal/odd": None})
        for name in ("robot/notes.txt", "robot/Bad Name.svg"):
            with open(os.path.join(avatars.DIR, name), "w") as fh:
                fh.write("x")
        self.assertEqual(avatars.pictures(), {"animal/odd": "animal/odd", "food/pear": "lime", "robot/a-red": "red"})
        self.assertTrue(avatars.path("food/pear").endswith(os.path.join("food", "pear.svg")))
        for name in ("food/none", "../secret", "food/../food/pear", "pear", ""):
            self.assertIsNone(avatars.path(name), name)

    def test_each_actor_is_given_one_of_its_own_and_keeps_it(self):
        self.pictures({f"robot/r{i}": h for i, h in enumerate(["red", "blue", "green", "pink"])})
        home = {"gatherers": [{"name": "g", "agents": [actor("c1", 1), actor("c2", 2)]},
                              {"name": "h", "agents": [actor("c1", 3)]}]}
        first = self.given(avatars.assign(home))
        self.assertEqual(len(set(first.values())), 3)                         # three actors, three pictures
        self.assertEqual(avatars.stored(), first)
        home["gatherers"][0]["agents"].insert(0, actor("c3", 4))
        again = self.given(avatars.assign(home))
        self.assertEqual({k: v for k, v in again.items() if k in first}, first)   # each keeps its own
        self.assertEqual(len(set(again.values())), 4)                         # the new one: the one left
        self.assertEqual(self.given(avatars.assign(home)), again)             # nothing new: nothing changes

    def test_the_open_actors_of_a_gatherer_are_in_different_hues(self):
        self.pictures({"robot/red-1": "red", "robot/red-2": "red", "animal/blue": "blue", "food/green": "green"})
        home = {"gatherers": [{"name": "g", "agents": [actor("c3", 3), actor("c2", 2), actor("c1", 1)]}]}
        hues = avatars.pictures()
        got = self.given(avatars.assign(home))
        self.assertEqual(len({hues[n] for n in got.values()}), 3)
        # a closed actor's hue is free: the new open actor may take it, never an open one's
        home["gatherers"][0]["agents"] = [actor("c4", 4)] + [actor(c, int(c[1]), "closed" if c != "c3" else "idle")
                                                             for c in ("c3", "c2", "c1")]
        new = self.given(avatars.assign(home))[("g", "c4")]
        self.assertNotEqual(hues[new], hues[got[("g", "c3")]])

    def test_once_every_picture_is_held_the_least_recently_given_comes_again(self):
        self.pictures({"robot/a": "red", "robot/b": "blue"})
        home = {"gatherers": [{"name": "g", "agents": [actor("c2", 2, "closed"), actor("c1", 1, "closed")]}]}
        got = self.given(avatars.assign(home))
        home["gatherers"][0]["agents"].insert(0, actor("c3", 3, "closed"))
        newest = got[("g", "c2")]                                             # given first: the least recent
        self.assertEqual(self.given(avatars.assign(home))[("g", "c3")], newest)

    def test_a_picture_taken_out_of_the_folder_is_replaced(self):
        self.pictures({"robot/a": "red", "robot/b": "blue"})
        home = {"gatherers": [{"name": "g", "agents": [actor("c1", 1)]}]}
        had = self.given(avatars.assign(home))[("g", "c1")]
        os.remove(avatars.path(had))
        self.assertEqual(self.given(avatars.attach(home, avatars.stored(), avatars.pictures()))[("g", "c1")], None)
        self.assertEqual(self.given(avatars.assign(home))[("g", "c1")], ({"robot/a", "robot/b"} - {had}).pop())
        os.remove(avatars.path(({"robot/a", "robot/b"} - {had}).pop()))
        os.rmdir(os.path.join(avatars.DIR, "robot"))
        self.assertEqual(self.given(avatars.assign(home))[("g", "c1")], None)   # none left: the harness's mark

    def said(self, text):
        """The pictures' lines, LINES, as `text` (TOML): a new time on it, read again."""
        os.makedirs(avatars.DIR, exist_ok=True)
        p = os.path.join(avatars.DIR, avatars.LINES)
        at = os.stat(p).st_mtime + 1 if os.path.exists(p) else None
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(text)
        if at is not None:
            os.utime(p, (at, at))

    def test_each_actor_carries_its_pictures_hue_motion_and_the_line_it_says(self):
        self.pictures({"robot/plain": "red", "robot/eel-sky": "sky"})
        with open(os.path.join(avatars.DIR, "robot", "fish.svg"), "w") as fh:
            fh.write(CIRCLE.format(' data-hue="sky" data-motion="swim bubbles"'))
        self.said('fish = ["Blub & hi!", """\nRipples in my bowl\nI am circling\ndrop in a word""", "  "]\n'
                  'eel = ["Zap!"]\n')
        pool = avatars.pictures()
        self.assertEqual([avatars.hello(n) for n in ("robot/fish", "robot/eel-sky", "robot/plain")],
                         [["Blub & hi!", "Ripples in my bowl\nI am circling\ndrop in a word"], ["Zap!"], []])   # one in a hue: its name's
        home = {"gatherers": [{"name": "g", "agents": [actor("c1", 1), actor("c2", 2), actor("c3", 3)]}]}
        avatars.attach(home, {("g", "c1"): "robot/fish", ("g", "c2"): "robot/plain", ("g", "c3"): "robot/gone"}, pool, {("g", "c1"): 3})
        got = {a["channel"]: (a["avatar"], a["avatar_hue"], a["avatar_motion"], a["avatar_hello"]) for a in home["gatherers"][0]["agents"]}
        self.assertEqual(got, {"c1": ("robot/fish", "sky", "swim bubbles", "Ripples in my bowl\nI am circling\ndrop in a word"),
                               "c2": ("robot/plain", "red", "", None), "c3": (None, None, None, None)})   # its 3rd of 2: the 2nd

    def test_a_line_changed_in_the_file_is_said_at_once_and_a_slip_keeps_the_last(self):
        self.pictures({"robot/fish": "sky"})
        self.said('fish = ["Blub!"]\n')
        avatars.pictures()
        self.assertEqual(avatars.hello("robot/fish"), ["Blub!"])
        self.said('fish = ["Splash!"]\n')                        # changed: read again
        self.assertEqual(avatars.hello("robot/fish"), ["Splash!"])
        with unittest.mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            self.said('fish = ["Spla\n')                         # a slip mid-edit: as it last read
            self.assertEqual(avatars.hello("robot/fish"), ["Splash!"])
        self.assertIn("does not read", err.getvalue())
        os.remove(os.path.join(avatars.DIR, avatars.LINES))
        self.assertEqual(avatars.hello("robot/fish"), [])         # no file: nothing to say

    def test_each_actor_says_one_line_kept_the_next_another_every_style_in_turn(self):
        self.pictures({f"robot/r{i}": f"h{i}" for i in range(3)})
        said_lines = [f"line {i}" for i in range(avatars.STYLES)]
        self.said("".join(f"r{i} = {said_lines!r}\n".replace("'", '"') for i in range(3)))
        agents = []
        home = lambda: {"gatherers": [{"name": "g", "agents": [dict(a) for a in agents]}]}
        said = []
        for n in range(3 * avatars.STYLES):                       # actors coming one after another
            agents.append(actor(f"c{n}", n))
            said.append(avatars.assign(home())["gatherers"][0]["agents"][-1]["avatar_hello"])
        again = {a["channel"]: a["avatar_hello"] for a in avatars.assign(home())["gatherers"][0]["agents"]}
        self.assertEqual([again[f"c{n}"] for n in range(len(said))], said)   # each keeps its own
        self.assertTrue(all(x != y for x, y in zip(said, said[1:])))         # the next says another
        for r in range(0, len(said), avatars.STYLES):                        # each round, every style once
            self.assertEqual(sorted(said[r:r + avatars.STYLES]), said_lines)

    def test_an_actor_given_its_picture_before_there_were_lines_says_one_fixed_by_it(self):
        self.pictures({"robot/a": "red"})
        self.said('a = ["one", "two", "three", "four"]\n')
        os.makedirs(dashboard_home.HOME)
        conn = sqlite3.connect(os.path.join(dashboard_home.HOME, "dashboard.db"))
        conn.execute("CREATE TABLE avatars (gatherer TEXT NOT NULL, channel TEXT NOT NULL, avatar TEXT NOT NULL, at TEXT NOT NULL, "
                     "PRIMARY KEY (gatherer, channel))")                    # as it was
        conn.execute("INSERT INTO avatars VALUES ('g', 'old', 'robot/a', '2026-10-01T00:00:00+00:00')")
        conn.commit()
        conn.close()
        home = lambda: {"gatherers": [{"name": "g", "agents": [actor("old", 1), actor("new", 2)]}]}
        first = {a["channel"]: a["avatar_hello"] for a in avatars.assign(home())["gatherers"][0]["agents"]}
        self.assertEqual(first["old"], avatars.says("old", ["one", "two", "three", "four"], None))
        self.assertIn(first["new"], ["one", "two", "three", "four"])
        has, said = avatars.kept()                                           # read again: as kept
        self.assertEqual({a["channel"]: a["avatar_hello"] for a in avatars.attach(home(), has, avatars.pictures(), said)["gatherers"][0]["agents"]},
                         first)

    def test_a_bare_picture_is_its_character_without_its_circle(self):
        drawn = b'<svg data-hue="red"><circle cx="32" cy="32" r="32" fill="#fdd"/><circle cx="32" cy="32" r="32" fill="#f00"/></svg>'
        self.assertEqual(avatars.bare(drawn), b'<svg data-hue="red"><circle cx="32" cy="32" r="32" fill="#f00"/></svg>')
        self.assertEqual(avatars.bare(b'<svg><rect/></svg>'), b'<svg><rect/></svg>')    # none: as it is

    def test_the_drawn_avatars_move_as_the_page_and_the_readme_know(self):
        avatars.DIR = self.saved[1]
        pool = avatars.pictures()
        page = page_source.text()
        with open(os.path.join(avatars.DIR, "README.md"), encoding="utf-8") as fh:
            readme = fh.read()
        moves = set(re.findall(r"^\.m-([a-z-]+) \{ --m: b-\1;", page, re.M))
        effects = set(re.findall(r"\.buddy\.f-([a-z-]+)[ :]", page))
        listed = lambda kind: set(re.findall(r"`([a-z]+)`", re.search(rf"^- {kind}: (.*?)(?:^- |\n\n)", readme, re.M | re.S).group(1)))
        self.assertEqual(listed("moves"), moves)
        self.assertEqual(listed("effects"), effects)
        used = set()
        for name in pool:
            words = avatars.motion(name).split()
            self.assertIn(len(words), (1, 2), name)
            self.assertIn(words[0], moves, name)
            self.assertTrue(len(words) == 1 or words[1] in effects, name)
            used.update(words)
        self.assertEqual(used, moves | effects)                              # each drawn, each used
        avatar = ""                                                          # an actor's avatar as the page draws it
        for name in ("avatar.ts", "stage.ts"):                               # (frontend/src/core/page/)
            with open(os.path.join(page_source.SRC, "core", "page", name), encoding="utf-8") as fh:
                avatar += fh.read()
        ink = re.search(r"const HUE_INK\b[^=]*= \{(.*?)\};", avatar, re.S).group(1)
        self.assertEqual(set(re.findall(r"(\w+): \[", ink)), set(pool.values()))   # every hue's words in its color
        main = re.search(r"const HUE_MAIN\b[^=]*= \{(.*?)\};", avatar, re.S).group(1)
        self.assertEqual(set(re.findall(r"(\w+): \"", main)), set(pool.values()))   # and its thought's dots

    def test_the_drawn_avatars_each_say_four_lines_the_last_a_haiku(self):
        avatars.DIR = self.saved[1]
        for name in avatars.pictures():
            said = avatars.hello(name)
            self.assertEqual(len(said), 4, name)
            self.assertTrue(said[1].startswith("Hi, I'm ") and said[2].endswith("Ready when you are."), name)
            self.assertEqual(len(said[3].split("\n")), 3, name)

    def test_the_drawn_avatars_are_in_one_hue_of_the_palette_each(self):
        avatars.DIR = self.saved[1]
        pool = avatars.pictures()
        self.assertGreaterEqual(len(pool), 100)
        hues = {"red", "orange", "yellow", "lime", "green", "teal", "sky", "blue", "purple", "pink", "brown", "gray"}
        self.assertEqual(set(pool.values()), hues)
        for name in pool:
            with open(avatars.path(name), encoding="utf-8") as fh:
                text = fh.read()
            self.assertTrue(text.startswith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"'), name)
            self.assertIsNone(re.search(r"<script|href=|url\(|\bon\w+=", text), name)


class ServerAvatarsTest(AvatarsBase):
    def setUp(self):
        super().setUp()
        self.httpd = server.serve("127.0.0.1", 0)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        super().tearDown()

    def test_a_picture_is_served_with_no_scripts_and_nothing_else_is(self):
        self.pictures({"food/pear": "lime"})
        r = urllib.request.urlopen(self.url + "/avatars/food/pear.svg", timeout=10)
        self.assertEqual(r.headers["Content-Type"], "image/svg+xml")
        self.assertIn("default-src 'none'", r.headers["Content-Security-Policy"])
        self.assertIn(b'data-hue="lime"', r.read())
        bare = urllib.request.urlopen(self.url + "/avatars/food/pear.svg?bare=1", timeout=10)   # its character alone
        self.assertIn("default-src 'none'", bare.headers["Content-Security-Policy"])
        self.assertEqual(bare.read(), CIRCLE.format(' data-hue="lime"').replace('<circle cx="32" cy="32" r="32"/>', "").encode())
        with open(os.path.join(self.tmp.name, "secret.svg"), "w") as fh:
            fh.write("x")
        for path in ("/avatars/food/none.svg", "/avatars/../secret.svg", "/avatars/%2e%2e/secret.svg", "/avatars/food/pear.txt"):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(self.url + path, timeout=10)
            self.assertEqual(caught.exception.code, 404, path)


if __name__ == "__main__":
    unittest.main()
