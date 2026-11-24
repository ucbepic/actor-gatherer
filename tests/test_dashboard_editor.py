"""The files shared live (ag_dashboard/livedocs.py), as the Editor app edits them: each file open one Yjs document
(pycrdt), which every page editing it shares, with the file on disk one more of its editors -- what is written to the
file merged in, around what the pages typed and did not save -- and the Editor app's /api/edit/* on its own origin,
through which its panels share it (app_kit.docs, ag_dashboard/app_docs.py)."""
import base64
import json
import os
import queue
import random
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag_dashboard import livedocs  # noqa: E402

try:
    from pycrdt import Doc, Text
except ImportError:                                 # the view is not offered without it
    Doc = Text = None


def page_of(init: dict):
    """A page's copy of the document, from its stream's `init`."""
    doc = Doc()
    doc.apply_update(base64.b64decode(init["update"]))
    return doc, doc.get("text", type=Text)


def drain(conn) -> list:
    out = []
    while True:
        try:
            out.append(conn.queue.get_nowait())
        except queue.Empty:
            return out


@unittest.skipIf(Doc is None, "pycrdt is not installed")
class ChangeTest(unittest.TestCase):
    """`change`: a text made to hold another, by what differs."""

    def check(self, old, new):
        doc = Doc()
        doc["t"] = text = Text(old)
        livedocs.change(text, new)
        self.assertEqual(str(text), new)

    def test_it_makes_the_text_exactly_the_new_one(self):
        for old, new in [("a😀b\nline two\nline three\n", "a😀b\nline 2 😀\n"), ("x\r\ny\r\n", "x\r\nz\r\ny\r\n"),
                         ("", "new\n"), ("gone\n", ""), ("é\nü\n", "é\nüü\nnew\n"), ("same\n", "same\n")]:
            self.check(old, new)

    def test_random_texts_of_wide_characters(self):
        rng = random.Random(7)
        alphabet = "ab\n😀é "
        for _ in range(500):
            self.check("".join(rng.choice(alphabet) for _ in range(rng.randint(0, 30))),
                       "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 30))))

    def test_lines_left_alone_keep_what_was_typed_in_them(self):
        """A change elsewhere does not touch a line: an edit made in it meanwhile, by another, stays."""
        base = Doc()
        base["text"] = Text("one\ntwo\nthree\n")
        page, disk = Doc(), Doc()
        page.apply_update(base.get_update())
        disk.apply_update(base.get_update())
        page.get("text", type=Text).insert(len("one\ntw"), "(o)")
        livedocs.change(disk.get("text", type=Text), "one\ntwo\nTHREE\n")
        page.apply_update(disk.get_update())
        self.assertEqual(str(page.get("text", type=Text)), "one\ntw(o)o\nTHREE\n")


class MergeTest(unittest.TestCase):
    """`merge`: three ways, by line, as version control merges."""

    BASE = "a\nb\nc\nd\ne\n"

    def check(self, mine, theirs, merged, conflicts=()):
        text, found, _ = livedocs.merge(self.BASE, mine, theirs)
        self.assertEqual(text, merged)
        self.assertEqual([(text[s:e], t) for s, e, _, t, _ in found], list(conflicts))

    def test_changes_to_different_lines_both_kept(self):
        self.check("A\nb\nc\nd\ne\n", "a\nb\nc\nD\ne\n", "A\nb\nc\nD\ne\n")
        self.check("a\nB\nc\nd\ne\n", "a\nb\nC\nd\ne\n", "a\nB\nC\nd\ne\n")     # side by side too

    def test_the_same_change_is_no_conflict(self):
        self.check("a\nX\nc\nd\ne\n", "a\nX\nc\nd\ne\n", "a\nX\nc\nd\ne\n")

    def test_a_line_changed_on_both_sides_differently_is_a_conflict_mine_kept(self):
        self.check("a\nb\nMINE\nd\ne\n", "a\nb\nTHEIRS\nd\ne\n", "a\nb\nMINE\nd\ne\n", [("MINE\n", "THEIRS\n")])
        self.check("a\nb\nMINE\nd\ne\n", "a\nb\nd\ne\n", "a\nb\nMINE\nd\ne\n", [("MINE\n", "")])   # deleted there
        self.check(self.BASE + "mine\n", self.BASE + "theirs\n", self.BASE + "mine\n", [("mine\n", "theirs\n")])

    def test_lines_guarded_are_a_conflict_when_theirs_changes_them(self):
        text, found, _ = livedocs.merge(self.BASE, self.BASE, "a\nB\nc\nd\nE\n", guard=[(1, 2)])
        self.assertEqual(text, "a\nb\nc\nd\nE\n")                       # unguarded: merged
        self.assertEqual([(text[s:e], t, zone) for s, e, _, t, zone in found], [("b\n", "B\n", True)])

    def test_lines_put_in_inside_a_guarded_range_are_a_conflict_at_its_edges_not(self):
        inside = livedocs.merge(self.BASE, self.BASE, "a\nb\nNEW\nc\nd\ne\n", guard=[(1, 3)])
        self.assertEqual(inside[0], self.BASE)
        self.assertEqual([(t, zone) for _, _, _, t, zone in inside[1]], [("NEW\n", True)])
        for theirs in ("a\nNEW\nb\nc\nd\ne\n", "a\nb\nc\nNEW\nd\ne\n"):   # just before it, just after it
            self.assertEqual(livedocs.merge(self.BASE, self.BASE, theirs, guard=[(1, 3)])[:2], (theirs, []))

    def test_a_change_beside_a_guarded_line_mine_changed_merges(self):
        mine = "a\nb\nMINE\nd\ne\n"                                        # mine's line 2, guarded
        text, found, _ = livedocs.merge(self.BASE, mine, "a\nb\nc\nNEW\nd\ne\n", guard=[(2, 3)])
        self.assertEqual((text, found), ("a\nb\nMINE\nNEW\nd\ne\n", []))
        text, found, _ = livedocs.merge(self.BASE, mine, "a\nb\nc\nd\nE\n", guard=[(2, 3)])
        self.assertEqual((text, found), ("a\nb\nMINE\nd\nE\n", []))

    def test_a_guarded_line_is_found_after_lines_mine_put_in_before_it(self):
        mine = "a\nNEW1\nNEW2\nb\nc\nd\ne\n"                              # base's c is mine's line 4, guarded
        text, found, _ = livedocs.merge(self.BASE, mine, "a\nb\nC\nd\ne\n", guard=[(1, 3), (4, 5)])
        self.assertEqual([(text[s:e], t, zone) for s, e, _, t, zone in found], [("c\n", "C\n", True)])

    def test_guarded_lines_are_mine_s_not_base_s(self):
        mine = "TOP\n" + self.BASE                                          # a line put in here: base's line 1 is mine's 2
        text, found, _ = livedocs.merge(self.BASE, mine, "a\nB\nc\nd\ne\n", guard=[(2, 3)])
        self.assertEqual([(text[s:e], t) for s, e, _, t, _ in found], [("b\n", "B\n")])

    def test_it_counts_what_only_mine_has(self):
        self.assertEqual(livedocs.merge(self.BASE, "a\nB\nc\nd\ne\n", self.BASE)[2], 1)
        self.assertEqual(livedocs.merge(self.BASE, self.BASE, "a\nB\nc\nd\ne\n")[2], 0)


@unittest.skipIf(Doc is None, "pycrdt is not installed")
class RoomBase(unittest.TestCase):
    """A file open for editing, and pages' edits of it, by hand."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = os.path.realpath(self.tmp.name)
        self.path = os.path.join(self.root, "notes.py")
        self.write("def f():\n    return 1\n\nx = f()\n")
        self.editors = livedocs.LiveDocs(poll=3600)      # looked at by hand here (`check`)
        self.addCleanup(self.editors.close)

    def write(self, text: str) -> None:
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write(text)
        st = os.stat(self.path)                      # a later mtime: the same second may not tell writes apart
        os.utime(self.path, ns=(st.st_atime_ns, st.st_mtime_ns + random.randint(1, 10**6)))

    def disk(self) -> str:
        with open(self.path, encoding="utf-8") as fh:
            return fh.read()

    def open(self, cid: str, client: int = 1):
        room, conn = self.editors.join(self.path, self.root, cid, client)
        events = drain(conn)
        self.assertEqual(events[0][0], "init")
        doc, text = page_of(events[0][1])
        return room, conn, doc, text

    def type(self, room, cid, doc, at: int, what: str) -> None:
        before = doc.get_state()
        doc.get("text", type=Text).insert(at, what)
        room.edit(cid, doc.get_update(before))

    def edit(self, room, cid, doc, old: str, new: str) -> None:
        """A page's edit: `old`'s first appearance made `new`."""
        text, before = doc.get("text", type=Text), doc.get_state()
        at = len(str(text)[:str(text).index(old)].encode())
        del text[at:at + len(old.encode())]
        text.insert(at, new)
        room.edit(cid, doc.get_update(before))

    def sync(self, conn, doc) -> None:
        """The page's copy, with what it was sent since (another's edits, an actor's, the disk's)."""
        for name, v in drain(conn):
            if name == "update":
                doc.apply_update(base64.b64decode(v["update"]))


class RoomTest(RoomBase):
    """A file open for editing: what pages send, what the disk does, and what is saved."""

    def test_a_page_opens_the_file_as_it_is(self):
        room, conn, doc, text = self.open("p1")
        self.assertEqual(str(text), self.disk())
        self.assertFalse(room.dirty)

    def test_a_page_s_edit_reaches_the_others_and_not_itself(self):
        room, c1, d1, t1 = self.open("p1", 1)
        _, c2, d2, t2 = self.open("p2", 2)
        drain(c1)
        self.type(room, "p1", d1, 0, "# hi\n")
        updates = [v for name, v in drain(c2) if name == "update"]
        self.assertEqual(len(updates), 1)
        d2.apply_update(base64.b64decode(updates[0]["update"]))
        self.assertEqual(str(t2), "# hi\n" + self.disk())
        self.assertFalse([v for name, v in drain(c1) if name == "update"])
        self.assertTrue(room.dirty)

    def test_the_disk_s_change_merges_around_what_was_not_saved(self):
        room, conn, doc, text = self.open("p1")
        self.type(room, "p1", doc, 0, "# typed, not saved\n")
        drain(conn)
        self.write("def f():\n    return 2\n\nx = f()\n")          # an actor's edit, on another line
        room.check()
        updates = [v for name, v in drain(conn) if name == "update"]
        self.assertTrue(updates and updates[0]["disk"])
        for u in updates:
            doc.apply_update(base64.b64decode(u["update"]))
        merged = "# typed, not saved\ndef f():\n    return 2\n\nx = f()\n"
        self.assertEqual(str(text), merged)
        self.assertEqual(str(room.text), merged)
        self.assertTrue(room.dirty)                  # the file has the actor's change, not the typed line
        self.assertIsNotNone(room.changed)
        room.save()
        self.assertEqual(self.disk(), merged)
        self.assertFalse(room.dirty)

    def region(self, room, conflict: dict) -> str:
        """A conflict's lines, as the page finds them: its UTF-16 positions in the document."""
        units = str(room.text).encode("utf-16-le")
        return units[2 * conflict["from"]:2 * conflict["to"]].decode("utf-16-le")

    def test_the_same_lines_changed_on_both_sides_are_a_conflict_not_a_merge(self):
        room, conn, doc, text = self.open("p1")
        self.edit(room, "p1", doc, "return 1", "return 10")             # typed here, not saved
        drain(conn)
        self.write("def f():\n    return 2\n\nx = f()\n")                # the actor's, the same line
        room.check()
        self.assertFalse([v for name, v in drain(conn) if name == "update"])   # nothing merged into the page's line
        self.assertIn("return 10", str(room.text))
        [c] = room.state()["conflicts"]
        self.assertEqual((self.region(room, c), c["theirs"], c["base"]), ("    return 10\n", "    return 2\n", "    return 1\n"))
        self.assertIn("return 2", self.disk())                          # the file is the actor's until a page says
        room.settle(c["id"], "theirs")
        self.assertEqual(str(room.text), self.disk())
        self.assertEqual(room.state()["conflicts"], [])
        self.assertFalse(room.dirty)

    def test_lines_changed_on_one_side_merge_around_a_conflict(self):
        room, conn, doc, text = self.open("p1")
        self.edit(room, "p1", doc, "return 1", "return 10")
        self.write("# top\ndef f():\n    return 2\n\nx = f()\ny = 2\n")  # a line above, the same line, a line below
        room.check()
        self.assertEqual(str(room.text), "# top\ndef f():\n    return 10\n\nx = f()\ny = 2\n")
        self.assertEqual(len(room.conflicts), 1)

    def test_keep_both_and_keep_mine(self):
        room, conn, doc, text = self.open("p1")
        self.type(room, "p1", doc, len(str(text)), "y = 3\n")
        self.write("def f():\n    return 1\n\nx = f()\nz = 9\n")          # both put a line at the end
        room.check()
        [c] = room.state()["conflicts"]
        self.assertEqual((self.region(room, c), c["theirs"]), ("y = 3\n", "z = 9\n"))
        room.settle(c["id"], "both")
        self.assertTrue(str(room.text).endswith("x = f()\ny = 3\nz = 9\n"))
        self.edit(room, "p1", doc, "return 1", "return 3")
        self.write("def f():\n    return 4\n\nx = f()\nz = 9\n")
        room.check()
        [c] = room.state()["conflicts"]
        room.settle(c["id"], "mine")
        self.assertIn("return 3", str(room.text))
        self.assertTrue(room.dirty)                                      # the file has the actor's: a save writes mine
        with self.assertRaisesRegex(livedocs.DocError, "settled already"):
            room.settle(c["id"], "theirs")

    def test_a_conflict_s_lines_move_with_edits_before_them(self):
        room, conn, doc, text = self.open("p1")
        self.edit(room, "p1", doc, "x = f()", "x = f() * 2")
        self.write("def f():\n    return 1\n\nx = g()\n")
        room.check()
        self.type(room, "p1", doc, 0, "# 😀 a wide note above\n")        # wider in UTF-8 than in UTF-16
        self.edit(room, "p1", doc, "* 2", "* 3")                         # and in it
        [c] = room.state()["conflicts"]
        self.assertEqual(self.region(room, c), "x = f() * 3\n")

    def test_a_save_does_not_overwrite_a_conflict_it_just_found(self):
        room, conn, doc, text = self.open("p1")
        self.type(room, "p1", doc, len(str(text)), "y = 3\n")
        self.write("def f():\n    return 1\n\nx = f()\nz = 9\n")    # not looked at before the save
        with self.assertRaisesRegex(livedocs.DocError, "Resolve the conflicts"):
            room.save()
        self.assertTrue(self.disk().endswith("z = 9\n"))               # the actor's line still there
        [c] = room.state()["conflicts"]
        room.settle(c["id"], "both")
        room.save()
        self.assertEqual(self.disk(), "def f():\n    return 1\n\nx = f()\ny = 3\nz = 9\n")

    def test_a_save_keeps_the_lines_of_a_conflict_already_shown(self):
        room, conn, doc, text = self.open("p1")
        self.edit(room, "p1", doc, "return 1", "return 10")
        self.write("def f():\n    return 2\n\nx = f()\n")
        room.check()
        room.save()
        self.assertIn("return 10", self.disk())
        self.assertEqual(room.conflicts, {})

    def test_a_write_from_before_a_save_does_not_undo_it_unasked(self):
        room, conn, doc, text = self.open("p1")
        self.edit(room, "p1", doc, "return 1", "return 5")
        room.save()
        self.write("def f():\n    return 1\n\nx = f() + 1\n")          # a script's: the file before the save, changed
        room.check()
        self.assertEqual(str(room.text), "def f():\n    return 5\n\nx = f() + 1\n")   # its other change merged
        [c] = room.state()["conflicts"]                                  # the saved line: asked about
        self.assertEqual((self.region(room, c), c["theirs"], c["zone"]), ("    return 5\n", "    return 1\n", True))

    def test_undoing_a_save_on_purpose_is_asked_then_taken(self):
        room, conn, doc, text = self.open("p1")
        original = str(text)
        self.edit(room, "p1", doc, "return 1", "return 5")
        room.save()
        self.write(original)                                             # `git checkout` of the file, say
        room.check()
        [c] = room.state()["conflicts"]
        room.settle(c["id"], "theirs")
        self.assertEqual(str(room.text), original)
        self.assertFalse(room.dirty)

    def test_a_change_after_a_save_to_other_lines_merges(self):
        room, conn, doc, text = self.open("p1")
        self.edit(room, "p1", doc, "return 1", "return 5")
        room.save()
        self.write("def f():\n    return 5\n\nx = f() + 1\n")          # read after the save, changed elsewhere
        room.check()
        self.assertEqual(str(room.text), self.disk())
        self.assertEqual(room.conflicts, {})

    def test_an_actor_rewriting_lines_edited_here_is_asked_about(self):
        """Auto-saved as typed, then rewritten by an actor that read them: the lines kept, its rewrite shown."""
        room, conn, doc, text = self.open("p1")
        self.edit(room, "p1", doc, "return 1", "return 5")
        room.save()
        self.edit(room, "p1", doc, "x = f()", "x = f() * 2")              # a second save, of another line
        room.save()
        self.write("def f():\n    return 6\n\nx = f() * 3\n")          # read after both, rewrote both
        room.check()
        found = sorted((self.region(room, c), c["theirs"], c["zone"]) for c in room.state()["conflicts"])
        self.assertEqual(found, [("    return 5\n", "    return 6\n", True), ("x = f() * 2\n", "x = f() * 3\n", True)])

    def zone(self, room) -> list:
        """The conflict zone's text, as the page finds it: its UTF-16 ranges of the document."""
        return [self.region(room, {"from": a, "to": b}) for a, b in room.state()["zone"]]

    def test_the_zone_is_what_the_pages_changed_moved_with_every_edit(self):
        room, conn, doc, text = self.open("p1")
        self.assertEqual(self.zone(room), [])
        self.edit(room, "p1", doc, "return 1", "return 1  # 😀 one")
        self.assertEqual(self.zone(room), ["return 1  # 😀 one"])
        self.write("# a line the actor put on top\ndef f():\n    return 1  # 😀 one\n\nx = f()\n")
        room.check()                                                     # the disk's: not in it, and it moves
        self.assertEqual(self.zone(room), ["return 1  # 😀 one"])
        self.edit(room, "p1", doc, "x = f()\n", "")                        # a line taken out: where it was
        self.assertEqual(len(room.zone), 2)
        self.assertEqual(room.zone[1][0], room.zone[1][1])

    def test_a_line_in_the_zone_changed_by_the_actor_after_a_save_is_asked_about(self):
        room, conn, doc, text = self.open("p1")
        self.edit(room, "p1", doc, "return 1", "return 5")
        room.save()
        room.check()
        self.write("def f():\n    return 6\n\nx = f() + 1\n")          # its line, and another
        room.check()
        self.assertEqual(str(room.text), "def f():\n    return 5\n\nx = f() + 1\n")
        [c] = room.state()["conflicts"]
        self.assertTrue(c["zone"])

    def test_cleared_the_zone_s_lines_are_the_file_s_again(self):
        room, conn, doc, text = self.open("p1")
        self.edit(room, "p1", doc, "return 1", "return 5")
        room.save()
        self.assertEqual(room.clear_zone()["zone"], [])
        self.write("def f():\n    return 6\n\nx = f()\n")
        room.check()
        self.assertEqual(room.conflicts, {})
        self.assertIn("return 6", str(room.text))

    def test_the_actor_s_rewrite_taken_is_not_the_zone_s(self):
        room, conn, doc, text = self.open("p1")
        self.edit(room, "p1", doc, "return 1", "return 5")
        room.save()
        self.write("def f():\n    return 6\n\nx = f()\n")
        room.check()
        [c] = room.state()["conflicts"]
        room.settle(c["id"], "theirs")
        self.write("def f():\n    return 7\n\nx = f()\n")              # the actor again: merged, not asked
        room.check()
        self.assertEqual((room.conflicts, self.disk()), ({}, str(room.text)))

    def test_a_second_actor_s_change_to_a_conflict_s_lines_is_that_conflict_s(self):
        """Two actors: the first rewrote a line edited here (a conflict); the second, reading the file, added to the
        first's rewrite. Not merged around the line kept here: the conflict shows the file's lines as they are now."""
        room, conn, doc, text = self.open("p1")
        self.edit(room, "p1", doc, "return 1", "return 1  # many shapes, I suppose")
        room.save()
        self.write("def f():\n    return 1  # circle\n    # square\n\nx = f()\n")     # the first actor's, in its place
        room.check()
        [first] = room.state()["conflicts"]
        self.write("def f():\n    return 1  # circle\n    # square\n    # kite\n\nx = f()\n")   # the second's, after it
        room.check()
        self.assertEqual(str(room.text), "def f():\n    return 1  # many shapes, I suppose\n\nx = f()\n")
        [c] = room.state()["conflicts"]
        self.assertEqual(c["theirs"], "    return 1  # circle\n    # square\n    # kite\n")
        self.assertEqual((c["since"], c["zone"]), (first["since"], True))
        self.assertGreater(c["at"], first["at"])
        room.settle(c["id"], "theirs")
        self.assertEqual(str(room.text), self.disk())

    def rewritten(self, room, doc):
        """A line edited here, saved, then rewritten by an actor: its conflict."""
        self.edit(room, "p1", doc, "return 1", "return 5")
        room.save()
        self.write("def f():\n    return 6\n\nx = f()\n")
        room.check()
        [c] = room.state()["conflicts"]
        return c

    def test_the_file_s_lines_edited_in_the_box_go_in_place_of_the_page_s(self):
        room, conn, doc, _ = self.open("p1")
        c = self.rewritten(room, doc)
        drain(conn)
        room.settle(c["id"], "edited", "    return 6 + 1\n", theirs="    return 6\n", mine="    return 5\n")
        self.assertTrue([v for name, v in drain(conn) if name == "update"])   # sent to the pages
        self.assertEqual((room.state()["conflicts"], str(room.text)), ([], "def f():\n    return 6 + 1\n\nx = f()\n"))
        self.assertEqual(self.zone(room), ["    return 6 + 1\n"])          # the page's lines now: the zone's
        room.save()
        self.assertEqual(self.disk(), "def f():\n    return 6 + 1\n\nx = f()\n")
        self.write("def f():\n    return 7\n\nx = f()\n")              # the actor again: asked
        room.check()
        self.assertEqual(len(room.conflicts), 1)

    def test_lines_edited_from_what_changed_since_are_refused(self):
        room, conn, doc, _ = self.open("p1")
        c = self.rewritten(room, doc)
        self.write("def f():\n    return 7\n\nx = f()\n")              # the actor again, while the box was open
        room.check()
        [c] = room.state()["conflicts"]
        with self.assertRaisesRegex(livedocs.DocError, "the proposed lines changed"):
            room.settle(c["id"], "edited", "    return 6 + 1\n", theirs="    return 6\n", mine="    return 5\n")
        with self.assertRaisesRegex(livedocs.DocError, "your lines changed"):
            room.settle(c["id"], "edited", "    return 7 + 1\n", theirs="    return 7\n", mine="    return 4\n")
        with self.assertRaisesRegex(livedocs.DocError, "the lines, please"):
            room.settle(c["id"], "edited")
        self.assertEqual(len(room.conflicts), 1)                         # still there, to look at again
        room.settle(c["id"], "edited", "", theirs="    return 7\n", mine="    return 5\n")   # all taken out
        self.assertEqual(str(room.text), "def f():\n\nx = f()\n")

    def test_a_conflict_beside_the_one_edited_stays_on_its_lines(self):
        room, conn, doc, _ = self.open("p1")
        self.edit(room, "p1", doc, "return 1", "return 5")
        self.edit(room, "p1", doc, "x = f()", "x = f() * 5")
        room.save()
        self.write("def f():\n    return 6\n\nx = f() * 6\n")
        room.check()
        first, second = room.state()["conflicts"]
        room.settle(first["id"], "edited", "    return 6\n    # two lines now, 😀\n")
        [second] = room.state()["conflicts"]
        self.assertEqual((self.region(room, second), second["theirs"]), ("x = f() * 5\n", "x = f() * 6\n"))
        self.assertEqual(str(room.text), "def f():\n    return 6\n    # two lines now, 😀\n\nx = f() * 5\n")

    def test_the_zone_goes_once_the_file_s_last_page_closed_it(self):
        room, conn, doc, text = self.open("p1")
        self.edit(room, "p1", doc, "return 1", "return 5")
        room.save()
        room.leave(conn)
        self.editors.look()
        self.assertTrue(room.zone)                                       # its stream may come back: kept a moment
        room.idle_since -= livedocs.ZONE_GRACE + 1
        self.editors.look()
        self.assertEqual(room.zone, [])

    def test_a_save_writes_its_own_file_only_and_keeps_its_mode(self):
        os.chmod(self.path, 0o755)
        room, conn, doc, text = self.open("p1")
        self.type(room, "p1", doc, 0, "#!/bin/sh\n")
        room.save()
        self.assertEqual(os.stat(self.path).st_mode & 0o777, 0o755)
        self.assertEqual(sorted(os.listdir(self.root)), ["notes.py"])   # nothing left beside it
        room.check()                                 # its own write: no change from the disk
        self.assertFalse([v for name, v in drain(conn) if name == "update" and v.get("disk")])

    def test_a_file_deleted_on_disk_is_written_again_by_a_save(self):
        room, conn, doc, text = self.open("p1")
        os.unlink(self.path)
        room.check()
        self.assertTrue(room.missing)
        room.save()
        self.assertEqual(self.disk(), str(text))
        self.assertFalse(room.missing)

    def test_a_page_that_goes_takes_its_cursor_with_it(self):
        room, c1, _, _ = self.open("p1", 11)
        room2, c2, _, _ = self.open("p2", 22)
        room.aware("p1", b"\x01\x02")
        self.assertIn(("aware", {"update": base64.b64encode(b"\x01\x02").decode()}), drain(c2))
        _, c3, _, _ = self.open("p3", 33)                   # a page that comes later is sent the others' cursors
        room.leave(c1)
        self.assertIn(("left", {"client": 11}), drain(c2))

    def test_a_page_s_stream_again_ends_the_old_one(self):
        room, c1, _, _ = self.open("p1")
        _, again, _, _ = self.open("p1")
        self.assertIsNone(c1.queue.get_nowait())
        self.assertIs(room.conns["p1"], again)

    def test_a_file_with_unsaved_changes_stays_open_after_its_pages_go(self):
        room, conn, doc, text = self.open("p1")
        self.type(room, "p1", doc, 0, "# kept\n")
        room.leave(conn)
        clean = os.path.join(self.root, "clean.txt")
        with open(clean, "w") as fh:
            fh.write("x\n")
        other, oc = self.editors.join(clean, self.root, "p2", 2)
        other.leave(oc)
        with mock.patch.object(livedocs, "LINGER", 0.0):
            self.editors.poll = 0.01
            self.editors.stop.set()
            self.editors.thread.join()
            self.editors.stop.clear()
            self.editors.thread = threading.Thread(target=self.editors._watch, daemon=True)
            self.editors.thread.start()
            for _ in range(200):
                if os.path.realpath(clean) not in self.editors.rooms:
                    break
                time.sleep(0.01)
        self.assertNotIn(os.path.realpath(clean), self.editors.rooms)
        self.assertIn(self.path, self.editors.rooms)
        _, again, d2, t2 = self.open("p3")
        self.assertTrue(str(t2).startswith("# kept\n"))

    def test_what_cannot_be_opened(self):
        with open(os.path.join(self.root, "b.bin"), "wb") as fh:
            fh.write(b"\x00\x01\x02")
        with open(os.path.join(self.root, "latin.txt"), "wb") as fh:
            fh.write("café".encode("latin-1"))
        for path, said in [("/etc/hosts", "not under"), (os.path.join(self.root, "b.bin"), "not a text file"),
                           (os.path.join(self.root, "latin.txt"), "not UTF-8"),
                           (os.path.join(self.root, "none.txt"), "does not exist"), (self.root, "not a file"),
                           ("notes.py", "absolute")]:
            with self.assertRaisesRegex(livedocs.DocError, said):
                self.editors.join(path, self.root, "p", 1)
        with mock.patch.object(livedocs, "MAX_BYTES", 10):
            with self.assertRaisesRegex(livedocs.DocError, "too large"):
                self.editors.join(self.path, self.root, "p", 1)

    def test_a_new_file_or_folder_and_the_folders_above_it(self):
        got = livedocs.create(os.path.join(self.root, "new.py"), self.root)
        self.assertEqual(got, {"path": os.path.join(self.root, "new.py"), "dir": False})
        self.assertEqual(os.path.getsize(got["path"]), 0)
        got = livedocs.create(os.path.join(self.root, "pkg", "sub"), self.root, folder=True)
        self.assertTrue(os.path.isdir(got["path"]) and got["dir"])
        got = livedocs.create(os.path.join(self.root, "lib", "deep", "m.py"), self.root)   # "lib/deep/m.py": both made
        self.assertTrue(os.path.isfile(got["path"]))
        self.assertTrue(os.path.isdir(os.path.join(self.root, "lib", "deep")))

    def test_a_new_file_where_one_is_or_outside_the_root_is_refused(self):
        for path, said in [(self.path, "already exists"), (os.path.join(self.root, "pkg") + "/", "a name"),
                           (os.path.join(self.root, "notes.py", "x.py"), "a file is in the way"),
                           ("/etc/new.txt", "not under"), (os.path.join(self.root, ".."), "a name"),
                           (os.path.join(self.root, "..", "out.txt"), "not under"), ("new.txt", "absolute")]:
            if path.endswith("pkg/"):
                os.makedirs(path)
                said = "already exists"
            with self.assertRaisesRegex(livedocs.DocError, said, msg=path):
                livedocs.create(path, self.root)
        with open(self.path) as fh:                                      # what was there: left as it was
            self.assertTrue(fh.read())

    def test_a_link_out_of_the_root_is_refused(self):
        os.symlink("/etc/hosts", os.path.join(self.root, "hosts"))
        with self.assertRaisesRegex(livedocs.DocError, "not under"):
            self.editors.join(os.path.join(self.root, "hosts"), self.root, "p", 1)

    def test_the_listing(self):
        os.makedirs(os.path.join(self.root, "src"))
        os.makedirs(os.path.join(self.root, ".git"))
        os.makedirs(os.path.join(self.root, "node_modules"))
        with open(os.path.join(self.root, "a.txt"), "w") as fh:
            fh.write("a")
        with open(os.path.join(self.root, ".x.py.123" + livedocs.TEMP), "w") as fh:
            fh.write("half written")
        room, conn, doc, text = self.open("p1")
        self.type(room, "p1", doc, 0, "#")
        got = self.editors.listing(self.root, self.root)
        self.assertEqual([e["name"] for e in got["entries"]], ["src", "a.txt", "notes.py"])
        notes = got["entries"][2]
        self.assertEqual((notes["pages"], notes["dirty"]), (1, True))
        self.assertEqual(got["entries"][1]["pages"], 0)
        with self.assertRaisesRegex(livedocs.DocError, "not under"):
            self.editors.listing("/etc", self.root)


@unittest.skipIf(Doc is None, "pycrdt is not installed")
class PutTest(RoomBase):
    """An actor's change put into a file open (Room.put), live or as proposals, and a page that asks about each change
    on disk (Room.hold "ask")."""

    BY = {"gatherer": "g", "channel": "c1", "via": "test"}

    def put(self, room, old: str, new: str, how: str = "live", by=None):
        seen = room.view((by or self.BY)["channel"] if how == "propose" else None)
        self.assertIn(old, seen)
        return room.put(seen, seen.replace(old, new, 1), by or self.BY, how)

    def test_live_it_lands_at_once_in_its_hue_and_on_disk_without_what_was_not_saved(self):
        room, conn, doc, text = self.open("p1")
        self.type(room, "p1", doc, 0, "# typed, not saved\n")
        got = self.put(room, "x = f()", "x = f() + 1")
        self.assertEqual((got["landed"], got["held"], got["proposed"]), (1, [], []))
        self.assertEqual(str(room.text), "# typed, not saved\ndef f():\n    return 1\n\nx = f() + 1\n")
        self.assertEqual(self.disk(), "def f():\n    return 1\n\nx = f() + 1\n")    # its line only
        self.assertTrue(room.dirty)
        marks = room.state()["marks"]
        self.assertEqual([(m["gatherer"], m["channel"]) for m in marks], [("g", "c1")])
        raw = str(room.text)
        self.assertEqual(raw[marks[0]["from"]:marks[0]["to"]], "x = f() + 1\n")
        room.check()                                 # its own write is not a change on disk to merge
        self.assertFalse(room.conflicts)

    def test_live_a_change_to_lines_the_page_is_editing_is_held_for_it(self):
        room, conn, doc, text = self.open("p1")
        self.edit(room, "p1", doc, "return 1", "return 10")                 # in the conflict zone now
        got = self.put(room, "    return 10\n", "    return 100\n")
        self.assertEqual((got["landed"], len(got["held"])), (0, 1))
        c = room.conflicts[got["held"][0]]
        self.assertEqual((c.base, c.theirs, c.zone, c.agent["why"], c.agent["put"]),
                         ("    return 10\n", "    return 100\n", True, "zone", True))
        self.assertIn("return 10\n", str(room.text))
        room.save()                                  # a save leaves it held: it is the actor's, not the disk's
        self.assertIn(c.id, room.conflicts)
        room.settle(c.id, "theirs")
        self.assertIn("    return 100\n", str(room.text))
        self.assertEqual(self.disk(), "def f():\n    return 100\n\nx = f()\n")

    def test_proposed_nothing_changes_until_it_is_accepted_and_the_actor_builds_on_its_own(self):
        room, conn, doc, text = self.open("p1")
        was = self.disk()
        got = self.put(room, "return 1", "return 2", "propose")
        self.assertEqual(len(got["proposed"]), 1)
        self.assertEqual((str(room.text), self.disk()), (was, was))
        c = room.conflicts[got["proposed"][0]]
        self.assertEqual((c.base, c.theirs, c.agent["why"]), ("    return 1\n", "    return 2\n", "approve"))
        self.assertIn("return 2", room.view("c1"))                          # its own, in
        self.assertNotIn("return 2", room.view("c2"))                       # another's, not
        again = self.put(room, "return 2", "return 3", "propose")           # on its own: one proposal still
        self.assertEqual(len(again["proposed"]), 1)
        c = room.conflicts[again["proposed"][0]]
        self.assertEqual((c.base, c.theirs), ("    return 1\n", "    return 3\n"))
        self.put(room, "x = f()", "x = f() * 2", "propose")                 # another place: two
        self.assertEqual(len([c for c in room.conflicts.values() if c.agent]), 2)
        room.settle(c.id, "theirs")
        self.assertEqual(self.disk(), "def f():\n    return 3\n\nx = f()\n")   # the one accepted, written
        rest = next(c for c in room.conflicts.values() if c.agent)
        room.settle(rest.id, "mine")
        self.assertEqual(self.disk(), "def f():\n    return 3\n\nx = f()\n")
        self.assertFalse(room.conflicts)

    def test_a_proposal_over_lines_changed_since_is_not_accepted_as_it_was(self):
        room, conn, doc, text = self.open("p1")
        c = room.conflicts[self.put(room, "return 1", "return 2", "propose")["proposed"][0]]
        self.edit(room, "p1", doc, "return 1", "return 7")
        with self.assertRaisesRegex(livedocs.DocError, "changed since it was proposed"):
            room.settle(c.id, "theirs")
        room.settle(c.id, "mine")

    def test_what_changed_meanwhile_is_merged_onto_and_refused_where_it_meets(self):
        room, conn, doc, text = self.open("p1")
        seen = room.view()
        self.edit(room, "p1", doc, "x = f()", "y = f()")
        room.put(seen, seen.replace("return 1", "return 5"), self.BY, "live")
        self.assertEqual(str(room.text), "def f():\n    return 5\n\ny = f()\n")
        self.sync(conn, doc)
        self.assertEqual(str(text), str(room.text))   # the page has it as it landed
        seen = room.view()
        self.edit(room, "p1", doc, "return 5", "return 6")
        with self.assertRaisesRegex(livedocs.DocError, "read it again"):
            room.put(seen, seen.replace("return 5", "return 9"), self.BY, "live")

    def test_a_page_that_asks_has_each_change_on_disk_asked_about_and_reject_puts_its_lines_back(self):
        room, conn, doc, text = self.open("p1")
        room.hold("p1", "ask")
        self.assertTrue(room.state()["asking"])
        self.write("def f():\n    return 2\n\nx = f()\n")            # not in the zone: still asked about
        room.check()
        (c,) = room.conflicts.values()
        self.assertEqual((c.asked, c.zone, c.agent, c.theirs), (True, False, None, "    return 2\n"))
        self.assertIn("return 1", str(room.text))
        room.settle(c.id, "mine")
        self.assertEqual(self.disk(), "def f():\n    return 1\n\nx = f()\n")    # put back on the file
        self.write("def f():\n    return 3\n\nx = f()\n")
        room.check()
        (c,) = room.conflicts.values()
        room.settle(c.id, "theirs")
        self.assertEqual(str(room.text), "def f():\n    return 3\n\nx = f()\n")
        room.hold("p1", "zone")                      # merged again, as before
        self.write("def f():\n    return 4\n\nx = f()\n")
        room.check()
        self.assertFalse(room.conflicts)
        self.assertIn("return 4", str(room.text))
        with self.assertRaises(livedocs.DocError):
            room.hold("p1", "sometimes")

    def test_a_page_that_never_asks_has_the_zone_merged_and_the_file_s_lines_win_over_unsaved_ones(self):
        room, conn, doc, text = self.open("p1")
        room.hold("p1", "never")
        self.assertEqual((room.state()["hold"], room.state()["asking"]), ("never", False))
        self.edit(room, "p1", doc, "return 1", "return 5")
        room.save()                                                      # in the zone, saved
        self.write("def f():\n    return 6\n\nx = f()\n")              # an actor's rewrite of it: merged in
        room.check()
        self.assertFalse(room.conflicts)
        self.assertEqual(str(room.text), "def f():\n    return 6\n\nx = f()\n")
        self.edit(room, "p1", doc, "x = f()", "x = f() + 1")             # typed, not saved
        self.write("def f():\n    return 6\n\nx = f() * 2\n")          # the same line on disk, differently
        room.check()
        self.assertFalse(room.conflicts)
        self.assertEqual(str(room.text), "def f():\n    return 6\n\nx = f() * 2\n")   # the file's lines taken
        self.sync(conn, doc)
        self.assertEqual(str(text), str(room.text))                      # and sent to the page

    def test_the_strictest_page_s_hold_counts(self):
        room, conn, doc, text = self.open("p1")
        room.hold("p1", "never")
        room2, conn2, doc2, text2 = self.open("p2", client=2)
        self.assertEqual(room.state()["hold"], "zone")                   # p2 opened it as the default: the zone asked about
        self.edit(room, "p1", doc, "return 1", "return 5")
        room.save()
        self.write("def f():\n    return 6\n\nx = f()\n")
        room.check()
        (c,) = room.conflicts.values()
        self.assertTrue(c.zone)
        room.hold("p2", "ask")
        self.assertEqual(room.state()["hold"], "ask")
        room.leave(conn2)
        self.assertEqual(room.state()["hold"], "never")                  # the other page gone: its hold with it


class WritersTest(unittest.TestCase):
    """Who changed each listed file, of the actors: what ag's hook found their tool calls did on disk (`file_touched`)."""

    def setUp(self):
        from datetime import datetime, timezone
        import sqlite3
        from ag_dashboard import home as dashboard_home
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.saved, dashboard_home.HOME = dashboard_home.HOME, os.path.join(self.tmp.name, "home")
        self.addCleanup(setattr, dashboard_home, "HOME", self.saved)
        self.work = os.path.join(os.path.realpath(self.tmp.name), "work")
        os.makedirs(os.path.join(self.work, "src"))
        for name in ("a.py", "b.py", "c.py"):
            with open(os.path.join(self.work, "src", name), "w") as fh:
                fh.write("x = 1\n")
        os.makedirs(os.path.join(dashboard_home.HOME, "gatherers", "g"))
        conn = sqlite3.connect(os.path.join(dashboard_home.HOME, "gatherers", "g", "context.db"))
        conn.executescript("""CREATE TABLE event_types (event_type_id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT);
            CREATE TABLE events (row_id INTEGER PRIMARY KEY, inserted_at TEXT NOT NULL, event_id TEXT, event_type_id INTEGER NOT NULL,
              payload_json TEXT NOT NULL, tokens INTEGER NOT NULL, text TEXT, counted INTEGER, p_channel);
            INSERT INTO event_types (name) VALUES ('user_message'), ('file_touched');""")
        stamp = lambda ago: datetime.fromtimestamp(time.time() - ago, timezone.utc).isoformat()   # noqa: E731
        src = os.path.join(self.work, "src")
        conn.executemany("INSERT INTO events (inserted_at, event_type_id, payload_json, tokens, p_channel) VALUES (?, ?, ?, 0, ?)", [
            (stamp(livedocs.RECENT + 600), 2, json.dumps({"call": "t5", "path": f"{src}/c.py", "how": "modified"}), "c3"),   # too long ago
            (stamp(300), 2, json.dumps({"call": "t1", "path": f"{src}/a.py", "how": "modified"}), "c1"),
            (stamp(60), 2, json.dumps({"call": "t2", "path": f"{src}/a.py", "how": "modified"}), "c1"),       # c1's latest
            (stamp(30), 2, json.dumps({"call": "t3", "path": f"{src}/a.py", "how": "modified"}), "c2"),       # a second actor on it
            (stamp(25), 1, json.dumps({"role": "user", "content": "hi"}), "c1"),                               # not a touch
            (stamp(20), 2, json.dumps({"call": "t4", "path": f"{src}/b.py", "how": "read"}), "c1"),           # a read changes nothing
            (stamp(10), 2, json.dumps({"call": "t6", "path": None, "how": None}), "c1")])                     # a call that touched no file
        conn.commit()
        conn.close()
        self.editors = livedocs.LiveDocs(poll=3600)
        self.addCleanup(self.editors.close)

    def test_a_file_changed_by_two_actors_lists_both_the_latest_first(self):
        got = {e["name"]: e["writers"] for e in self.editors.listing(os.path.join(self.work, "src"), "/")["entries"]}
        self.assertEqual([w["channel"] for w in got["a.py"]], ["c2", "c1"])
        self.assertTrue(all(w["gatherer"] == "g" and w["how"] == "modified" for w in got["a.py"]))
        self.assertGreater(got["a.py"][0]["at"], got["a.py"][1]["at"])
        self.assertEqual(got["b.py"], [])
        self.assertEqual(got["c.py"], [])

    def test_a_folder_lists_who_changed_what_is_in_it(self):
        got = {e["name"]: e["writers"] for e in self.editors.listing(self.work, "/")["entries"]}
        self.assertEqual([w["channel"] for w in got["src"]], ["c2", "c1"])

    def waiting(self, directory):
        return {e["name"]: [w["channel"] for w in e["waiting"]] for e in self.editors.listing(directory, "/")["entries"]}

    def test_nothing_waits_from_the_actors_with_no_file_open(self):
        self.assertEqual(self.waiting(os.path.join(self.work, "src")), {"a.py": [], "b.py": [], "c.py": []})

    @unittest.skipIf(Doc is None, "pycrdt is not installed")
    def test_an_actor_s_proposal_waits_in_its_file_and_its_folder(self):
        room, conn = self.editors.join(os.path.join(self.work, "src", "b.py"), "/", "p1", 1)
        seen = room.view("c9")
        room.put(seen, seen.replace("x = 1", "x = 2"), {"gatherer": "g", "channel": "c9", "via": "test"}, "propose")
        self.assertEqual(self.waiting(os.path.join(self.work, "src")), {"a.py": [], "b.py": ["c9"], "c.py": []})
        self.assertEqual(self.waiting(self.work), {"src": ["c9"]})
        (c,) = room.conflicts.values()
        room.settle(c.id, "theirs")                  # accepted: nothing waits
        self.assertEqual(self.waiting(self.work), {"src": []})

    @unittest.skipIf(Doc is None, "pycrdt is not installed")
    def test_a_conflict_waits_from_the_actors_that_changed_the_file_since_it_began(self):
        room, conn = self.editors.join(os.path.join(self.work, "src", "a.py"), "/", "p1", 1)
        room.conflicts["k"] = livedocs.Conflict(0, 1, "x", "y", since=time.time() - 45)   # c2 changed it 30 s ago, c1 60 s
        self.assertEqual(self.waiting(os.path.join(self.work, "src"))["a.py"], ["c2"])
        room.conflicts["k"].since = time.time() - 90
        self.assertEqual(self.waiting(os.path.join(self.work, "src"))["a.py"], ["c1", "c2"])


@unittest.skipIf(Doc is None, "pycrdt is not installed")
class ServerTest(unittest.TestCase):
    """The pages' side: a file opened by a stream, edited and saved by POSTs, through the dashboard's server -- the
    Editor app's routes, on its own origin (editor.localhost), over the host's shared files."""

    def setUp(self):
        from ag_dashboard import home as dashboard_home, server
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.saved, dashboard_home.HOME = dashboard_home.HOME, os.path.join(self.tmp.name, "home")
        self.addCleanup(setattr, dashboard_home, "HOME", self.saved)
        self.root = os.path.join(os.path.realpath(self.tmp.name), "work")
        os.makedirs(self.root)
        self.path = os.path.join(self.root, "a.md")
        with open(self.path, "w") as fh:
            fh.write("# Title\n\nBody.\n")
        with mock.patch.object(livedocs, "POLL", 0.05):
            self.httpd = server.serve("127.0.0.1", 0, live_updates=False)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"
        self.app = f"latex.localhost:{self.httpd.server_port}"

    def get(self, path: str):
        """A GET of the Editor app's, on its origin: the response."""
        return urllib.request.urlopen(urllib.request.Request(self.url + path, headers={"Host": self.app}), timeout=10)

    def stream(self, conn: str, client: int) -> queue.Queue:
        q = urllib.parse.urlencode({"path": self.path, "root": self.root, "conn": conn, "client": client})
        resp = self.get(f"/api/edit/stream?{q}")
        self.addCleanup(resp.close)
        got = queue.Queue()

        def read():
            name = None
            try:
                for raw in resp:
                    line = raw.decode().rstrip("\n")
                    if line.startswith("event: "):
                        name = line[7:]
                    elif line.startswith("data: "):
                        got.put((name, json.loads(line[6:])))
            except Exception:                        # noqa: BLE001 - closed
                pass
        threading.Thread(target=read, daemon=True).start()
        return got

    def next(self, events: queue.Queue, name: str) -> dict:
        deadline = time.time() + 10
        while time.time() < deadline:
            got, value = events.get(timeout=deadline - time.time())
            if got == name:
                return value
        self.fail(f"no {name}")

    def post(self, path: str, body: dict, own: bool = True):
        """A POST of the Editor's panel (`own`: from its origin, as only its panel's are taken) -> its JSON."""
        headers = {"Content-Type": "application/json", "Host": self.app, **({"Origin": f"http://{self.app}"} if own else {})}
        req = urllib.request.Request(self.url + path, data=json.dumps(body).encode(), headers=headers)
        return json.load(urllib.request.urlopen(req, timeout=10))

    def test_two_pages_share_the_file_and_the_disk_s_changes(self):
        e1, e2 = self.stream("p1", 1), self.stream("p2", 2)
        d1, t1 = page_of(self.next(e1, "init"))
        d2, t2 = page_of(self.next(e2, "init"))
        before = d1.get_state()
        t1.insert(len("# Title\n\n"), "Typed. ")
        state = self.post("/api/edit/update", {"path": self.path, "root": self.root, "conn": "p1",
                                               "update": base64.b64encode(d1.get_update(before)).decode()})
        self.assertTrue(state["dirty"])
        d2.apply_update(base64.b64decode(self.next(e2, "update")["update"]))
        self.assertEqual(str(t2), "# Title\n\nTyped. Body.\n")
        with open(self.path, "a") as fh:                    # an actor's change on disk, merged in as it lands
            fh.write("\nMore.\n")
        for d, e in ((d1, e1), (d2, e2)):
            got = self.next(e, "update")
            self.assertTrue(got["disk"])
            d.apply_update(base64.b64decode(got["update"]))
        self.assertEqual(str(t1), str(t2))
        self.assertEqual(str(t1), "# Title\n\nTyped. Body.\n\nMore.\n")
        saved = self.post("/api/edit/save", {"path": self.path, "root": self.root})
        self.assertFalse(saved["dirty"])
        with open(self.path) as fh:
            self.assertEqual(fh.read(), "# Title\n\nTyped. Body.\n\nMore.\n")
        self.assertTrue(saved["zone"])                                   # what p1 typed: kept after the save
        self.assertEqual(self.post("/api/edit/zone/clear", {"path": self.path, "root": self.root})["zone"], [])

    def test_the_last_keys_saved_with_them_in_one_request(self):
        """A page going (its panel taken away, the page closed) sends its last keys with `save`: one request, which
        outlives it, applies them and saves the file."""
        e1 = self.stream("p1", 1)
        d1, t1 = page_of(self.next(e1, "init"))
        before = d1.get_state()
        t1.insert(len("# Title\n\n"), "Last. ")
        state = self.post("/api/edit/update", {"path": self.path, "root": self.root, "conn": "p1", "save": True,
                                               "update": base64.b64encode(d1.get_update(before)).decode()})
        self.assertFalse(state["dirty"])
        with open(self.path) as fh:
            self.assertEqual(fh.read(), "# Title\n\nLast. Body.\n")

    def test_the_listing_and_what_is_refused(self):
        got = json.load(self.get(f"/api/edit/list?{urllib.parse.urlencode({'dir': self.root, 'root': self.root})}"))
        self.assertEqual([e["name"] for e in got["entries"]], ["a.md"])
        with self.assertRaises(urllib.error.HTTPError) as no:
            self.get(f"/api/edit/list?{urllib.parse.urlencode({'dir': '/etc', 'root': self.root})}")
        self.assertEqual(no.exception.code, 400)
        with self.assertRaises(urllib.error.HTTPError) as no:           # not its panel's own: from another origin
            self.post("/api/edit/save", {"path": self.path, "root": self.root}, own=False)
        self.assertEqual(no.exception.code, 403)
        q = urllib.parse.urlencode({"path": "/etc/hosts", "root": self.root, "conn": "p", "client": 1})
        with self.get(f"/api/edit/stream?{q}") as resp:
            self.assertIn(b"event: failed", resp.read())

    def test_a_new_file_and_folder_made_by_the_page(self):
        made = self.post("/api/edit/create", {"path": os.path.join(self.root, "src", "b.py"), "root": self.root})
        self.assertEqual(made, {"path": os.path.join(self.root, "src", "b.py"), "dir": False})
        self.post("/api/edit/create", {"path": os.path.join(self.root, "docs"), "root": self.root, "dir": True})
        got = json.load(self.get(f"/api/edit/list?{urllib.parse.urlencode({'dir': self.root, 'root': self.root})}"))
        self.assertEqual([e["name"] for e in got["entries"]], ["docs", "src", "a.md"])
        with self.assertRaises(urllib.error.HTTPError) as no:           # there already
            self.post("/api/edit/create", {"path": self.path, "root": self.root})
        self.assertEqual(no.exception.code, 400)
        with self.assertRaises(urllib.error.HTTPError) as no:           # not its panel's own: from another origin
            self.post("/api/edit/create", {"path": os.path.join(self.root, "c.py"), "root": self.root}, own=False)
        self.assertEqual(no.exception.code, 403)
        self.assertFalse(os.path.exists(os.path.join(self.root, "c.py")))

    def test_the_editor_is_served_on_the_app_s_origin_not_the_dashboard_s(self):
        with self.get("/_ag/lib/fileedit/vendor/editor.js") as resp:          # app_kit.fileedit's, the host's library
            self.assertIn(b"agEditor", resp.read())
        with self.assertRaises(urllib.error.HTTPError) as no:
            urllib.request.urlopen(f"{self.url}/vendor/editor.js", timeout=10)
        self.assertEqual(no.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
