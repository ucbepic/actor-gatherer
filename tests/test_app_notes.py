"""The Notes app (ag_apps/notes/): each gatherer's notebook -- pages of blocks, kept in a file of the app's data folder
-- changed by ops from its panel and by agents' tools, which read and write it as markdown; each change told to the
open panels in order. The notebook and the markdown are tested directly (notebook.py), the tools and the panel's routes
through the backend with a host of the test's; the panel in the browser (frontend/e2e/notes.spec.ts)."""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app_kit  # noqa: E402
from ag_apps.notes import notebook as nb  # noqa: E402
from ag_apps.notes.backend import NotesApp  # noqa: E402
from app_kit import Caller, Instance  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOLDER = os.path.join(ROOT, "ag_apps", "notes")


def block(i, type="text", text="", **kw):
    return {"id": i, "type": type, "text": text, **kw}


class ManifestTest(unittest.TestCase):
    def test_it_loads_as_an_app_every_agent_is_offered(self):
        m = app_kit.load(FOLDER)
        self.assertEqual((m.name, m.label, m.instances, m.offer), ("notes", "Notes", "one", "always"))
        self.assertEqual([t.mcp("notes")["name"] for t in m.tools],
                         ["notes_read", "notes_add", "notes_change", "notes_report"])
        self.assertEqual(m.backend.python, "backend:NotesApp")
        self.assertTrue(os.path.isfile(os.path.join(FOLDER, m.mark)))
        self.assertTrue(os.path.isfile(os.path.join(FOLDER, "panel", "index.html")))
        self.assertIn("notes_read", m.instructions)
        self.assertIn("notes_report", m.instructions)
        self.assertIn("write it on the page itself with notes_add", m.instructions)     # a report is not on the page
        self.assertTrue(m.capabilities.actors and m.capabilities.message_actors)

    def test_a_line_it_sent_is_read_back_as_the_users_words_and_its_page(self):
        import re
        m = app_kit.load(FOLDER)
        for text, words, page in (
                ('(From my Notes, page "Report (week)", block abc12345. When you\'re done, report back there with '
                 'notes_report, in one to three lines.)\n\nAdd CSV export\n\nDates in ISO.',
                 "Add CSV export\n\nDates in ISO.", "Report (week)"),
                ('(A reply in my Notes, page "Say \\"hi\\"", block abc12345. Report back there with notes_report when '
                 'you\'re done.)\n\nAlso the date', "Also the date", 'Say \\"hi\\"'),
                ('(From my Notes, page "P", block abc12345.) Two lines, made one', "Two lines, made one", "P")):
            with self.subTest(text=text):
                self.assertIn(m.asked.when, text)                                  # (the list's copy: lines made one)
                self.assertEqual(re.match(m.asked.pattern, text).groups(), (words, page, "abc12345"))

    def test_lines_sent_together_are_read_back_as_one_message_about_each_of_them(self):
        import re
        m = app_kit.load(FOLDER)
        text = ('(From my Notes, page "Ship", blocks abc12345, def67890, ghi24680: the lines below, in that order. When '
                'you\'re done, report back on each with notes_report, in one to three lines.)\n\n- [ ] Fix the parser\n'
                '- [ ] Add CSV export\n  - dates in ISO\n\nOne branch for both.')
        self.assertIn(m.asked.when, text)
        self.assertEqual(re.match(m.asked.pattern, text).groups(),
                         ("- [ ] Fix the parser\n- [ ] Add CSV export\n  - dates in ISO\n\nOne branch for both.", "Ship",
                          "abc12345, def67890, ghi24680"))
        self.assertIn("blocks", m.instructions)                                    # agents told what it means


class BookBase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "g.json")
        self.book = nb.Notebook(self.path)

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def page(self, pid="pagepage", title="Plans", blocks=(), parent=None):
        self.book.apply([{"op": "page.new", "page": {"id": pid, "title": title, "parent": parent},
                          "blocks": list(blocks)}])
        return self.book.page(pid)


class NotebookTest(BookBase):
    def test_ops_change_it_in_order_each_batch_a_version_kept_in_its_file(self):
        self.page(blocks=[block("aaaaaa01", text="one")])
        v, done = self.book.apply([
            {"op": "block.put", "page": "pagepage", "block": block("aaaaaa02", "todo", "two")},
            {"op": "block.put", "page": "pagepage", "block": block("aaaaaa03", "h2", "zero"), "after": ""},
            {"op": "block.move", "page": "pagepage", "block": "aaaaaa01", "after": "aaaaaa02"},
            {"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa02", "checked": True}},
        ])
        self.assertEqual(v, 2)
        self.assertEqual([b["id"] for b in self.book.page("pagepage")["blocks"]], ["aaaaaa03", "aaaaaa02", "aaaaaa01"])
        self.assertEqual(done[2], {"op": "block.move", "page": "pagepage", "block": "aaaaaa01", "after": "aaaaaa02"})
        self.assertEqual(done[3]["block"], {"id": "aaaaaa02", "type": "todo", "text": "two", "checked": True,
                                            "indent": 0})
        again = nb.Notebook(self.path)                       # read back from its file
        self.assertEqual(again.state(), self.book.state())
        self.assertEqual(again.version, 2)

    def test_an_op_on_a_page_or_block_not_there_is_skipped_and_one_that_is_not_an_op_undoes_its_batch(self):
        self.page(blocks=[block("aaaaaa01", text="one")])
        v, done = self.book.apply([{"op": "block.delete", "page": "pagepage", "block": "zzzzzz99"},
                                   {"op": "block.put", "page": "gonegone", "block": block("aaaaaa02")}])
        self.assertEqual((v, done), (1, []))                 # nothing changed: no new version
        with self.assertRaises(nb.NotebookError):
            self.book.apply([{"op": "block.put", "page": "pagepage", "block": block("aaaaaa02", text="kept?")},
                             {"op": "block.put", "page": "pagepage", "block": block("aaaaaa03", "table")}])
        self.assertEqual([b["id"] for b in self.book.page("pagepage")["blocks"]], ["aaaaaa01"])
        for bad in ({"op": "page.new", "page": {"id": "Not An Id"}}, {"op": "page.fly", "page": "pagepage"},
                    {"op": "block.put", "page": "pagepage", "block": {"id": "x"}}, "nope"):
            with self.subTest(bad=bad), self.assertRaises(nb.NotebookError):
                self.book.apply([bad])

    def test_a_page_goes_into_the_trash_with_its_subpages_and_comes_back_with_them(self):
        self.page("toptop01", "Top")
        self.page("kidkid01", "Kid", parent="toptop01")
        self.page("kidkid02", "Gone before", parent="toptop01")
        self.book.apply([{"op": "page.delete", "page": "kidkid02"}])
        _, done = self.book.apply([{"op": "page.delete", "page": "toptop01"}])
        self.assertEqual(done[0]["pages"], ["toptop01", "kidkid01"])
        self.assertIsNone(self.book.page("Kid"))
        self.assertIn("In the trash", self.book.outline())
        _, done = self.book.apply([{"op": "page.restore", "page": "toptop01"}])
        self.assertEqual(done[0]["pages"], ["toptop01", "kidkid01"])
        self.assertIsNotNone(self.book.page("Kid"))
        self.assertIsNone(self.book.page("Gone before"))    # it went in on its own: it stays there
        with self.assertRaises(nb.NotebookError):            # only what is in the trash goes for good
            self.book.apply([{"op": "page.purge", "page": "toptop01"}])
        _, done = self.book.apply([{"op": "page.restore", "page": "kidkid02"}])
        self.assertEqual(self.book._get("kidkid02")["parent"], "toptop01")
        self.book.apply([{"op": "page.delete", "page": "toptop01"}, {"op": "page.purge", "page": "toptop01"}])
        self.assertEqual(self.book.state()["pages"], [])

    def test_a_page_never_goes_under_itself(self):
        self.page("toptop01", "Top")
        self.page("kidkid01", "Kid", parent="toptop01")
        with self.assertRaises(nb.NotebookError):
            self.book.apply([{"op": "page.set", "page": "toptop01", "parent": "kidkid01"}])
        self.book.apply([{"op": "page.set", "page": "kidkid01", "parent": None, "title": "  Free \n kid ",
                          "icon": "🐣"}])
        p = self.book.page("kidkid01")
        self.assertEqual((p["parent"], p["title"], p["icon"]), (None, "Free kid", "🐣"))

    def test_a_block_is_kept_clean(self):
        self.page(blocks=[block("aaaaaa01", "quote", '<b>a</b><img src=x onerror="go()"><script>bad()</script>'
                                '<a href="javascript:go()">j</a><a href="https://ok.org" onclick="x">ok</a>',
                                indent=9),
                          block("aaaaaa02", "h1", "x", indent=3, checked=True),
                          block("aaaaaa03", "code", "a <b> & c")])
        a, h, c = self.book.page("pagepage")["blocks"]
        self.assertEqual(a["text"], '<b>a</b>j<a href="https://ok.org">ok</a>')
        self.assertEqual(a["indent"], nb.MAX_INDENT)
        self.assertEqual((h["indent"], h["checked"]), (0, False))     # a heading is never set in, nor ticked
        self.assertEqual(c["text"], "a <b> & c")                       # code is kept as it is typed

    def test_a_page_is_found_by_its_id_its_title_or_the_start_of_one(self):
        self.page("aaaaaa01", "Groceries")
        self.page("aaaaaa02", "Reading list")
        self.assertEqual(self.book.page("aaaaaa02")["title"], "Reading list")
        self.assertEqual(self.book.page("groceries")["id"], "aaaaaa01")
        self.assertEqual(self.book.page("read")["id"], "aaaaaa02")
        self.assertIsNone(self.book.page("nothing"))

    def test_an_unreadable_file_is_kept_aside_not_written_over(self):
        with open(self.path, "w") as fh:
            fh.write("{not json")
        book = nb.Notebook(self.path)
        self.assertEqual(book.state(), {"version": 0, "pages": []})
        self.assertTrue([f for f in os.listdir(self.dir) if f.startswith("g.json.unreadable-")])


class PageLinkTest(BookBase):
    """A line's link to another page: `<a href="page:<id>">`, `[title](page:<id>)` as markdown, read with the title the
    page has now."""

    def test_a_link_to_a_page_is_kept_by_its_id_and_nothing_else_like_it(self):
        self.page(blocks=[block("aaaaaa01", "text", '<a href="page:chatpage">Chat</a> <a href="page:Chat">t</a> '
                                '<a href="page:abc">s</a> <a href="page:chatpage?x=1">q</a> '
                                '<a href="pages:chatpage">p</a>')])
        self.assertEqual(self.book.page("pagepage")["blocks"][0]["text"], '<a href="page:chatpage">Chat</a> t s q p')
        self.assertEqual(nb.inline_html("see [Chat](page:chatpage) and [x](page:No Id)"),
                         'see <a href="page:chatpage">Chat</a> and [x](page:No Id)')
        self.assertEqual(nb.inline_markdown('<a href="page:chatpage">Chat</a>'), "[Chat](page:chatpage)")

    def test_an_agent_reads_a_link_with_the_title_its_page_has_now(self):
        self.page("chatpage", "Chat")
        self.page("pagepage", "To dos", [block("aaaaaa01", "bullet", 'see <a href="page:chatpage">Chat</a>'),
                                         block("aaaaaa02", "bullet", '<a href="page:gonepage">Old page</a>')])
        self.book.apply([{"op": "page.set", "page": "chatpage", "title": "Chat view"}])
        md = self.book.markdown(self.book.page("pagepage"))
        self.assertIn("[aaaaaa01] - see [Chat view](page:chatpage)", md)
        self.assertIn("[aaaaaa02] - [Old page](page:gonepage)", md)       # a page gone: the words it was linked with
        self.book.apply([{"op": "page.delete", "page": "chatpage"}])
        self.assertIn("[Chat view (in the trash)](page:chatpage)", self.book.markdown(self.book.page("pagepage")))

    def test_a_link_an_agent_writes_by_a_pages_title_is_made_one_by_its_id(self):
        self.page("chatpage", "Chat")
        self.page("pagepage", "To dos")
        self.assertEqual(self.book.page_links("[a](page:chatpage) [b](page:chat) [c](page: Cha)"),
                         "[Chat](page:chatpage) [Chat](page:chatpage) [Chat](page:chatpage)")    # its title kept
        with self.assertRaisesRegex(nb.NotebookError, "no page 'Nope' to link to"):
            self.book.page_links("[x](page:Nope)")


class SentTest(BookBase):
    """A block sent to an agent says who it went to and when; its thread holds the user's replies and the agent's
    reports."""

    def put(self, **given):
        self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa01", **given}}])
        return self.book.page("pagepage")["blocks"][0]

    def test_a_block_says_who_it_went_to_and_keeps_it_as_it_is_typed_in_and_retyped(self):
        self.page(blocks=[block("aaaaaa01", "todo", "ship it")])
        b = self.put(calls=[{"to": "1f2e3d4c-aaaa-bbbb", "sent": 1700000000}], work=True)
        self.assertEqual(b["calls"], [{"to": "1f2e3d4c-aaaa-bbbb", "sent": 1700000000.0}])
        self.assertFalse({"to", "sent", "extra"} & set(b))
        b = self.put(calls=[{"to": "1f2e3d4c-aaaa-bbbb", "sent": 1700000000, "extra": "in <b>ISO</b><script>"}])
        self.assertEqual(b["calls"][0]["extra"], "in <b>ISO</b>")
        self.put(text="ship it now")
        b = self.put(type="bullet")
        self.assertEqual((b["type"], b["text"], b["calls"][0]["to"]), ("bullet", "ship it now", "1f2e3d4c-aaaa-bbbb"))
        for bad in ({"calls": [{"to": "no spaces here"}]}, {"calls": [{"to": 7}]}, {"calls": "chan-1"},
                    {"calls": [{"to": "abc123", "sent": "now"}]}, {"calls": [{"to": "abc123", "dropped": "now"}]},
                    {"calls": [{"to": "abc123", "extra": 7}]}, {"calls": ["abc123"]}):
            with self.subTest(bad=bad), self.assertRaises(nb.NotebookError):
                self.put(**bad)

    def test_a_line_goes_to_several_agents_one_call_each_and_is_taken_back_from_one(self):
        self.page(blocks=[block("aaaaaa01", "todo", "ship it")])
        b = self.put(calls=[{"to": "chan-1", "sent": 1700000000}, {"to": "chan-2", "sent": 1700000100, "extra": "x"},
                            {"to": "chan-1", "sent": 1700000200}], work=True)
        self.assertEqual([(c["to"], c["sent"]) for c in b["calls"]],                 # one call an agent: the last
                         [("chan-2", 1700000100.0), ("chan-1", 1700000200.0)])
        b = self.put(calls=[{"to": "chan-2", "sent": 1700000100, "dropped": 1700000300}, {"to": "chan-1",
                                                                                           "sent": 1700000200}])
        self.assertEqual([c["to"] for c in nb.on_it(b)], ["chan-1"])
        self.assertEqual(b["calls"][0]["dropped"], 1700000300.0)
        self.assertTrue(nb.is_work(b))
        b = self.put(calls=[{"to": "chan-2", "sent": 1700000100, "dropped": 1700000300},
                            {"to": "chan-1", "sent": 1700000200, "dropped": 1700000400}])
        self.assertEqual(nb.on_it(b), [])
        self.assertTrue(nb.is_work(b))                                                # taken back from all: still one
        b = self.put(work=False)
        self.assertFalse(nb.is_work(b))
        self.assertEqual(len(nb.calls_of(b)), 2)                                      # who it went to, kept

    def test_a_block_put_giving_to_as_before_sets_the_lines_one_call(self):
        self.page(blocks=[block("aaaaaa01", "todo", "ship it")])
        b = self.put(to="chan-1", sent=1700000000, extra="today", group="grp00001")
        self.assertEqual(b["calls"], [{"to": "chan-1", "sent": 1700000000.0, "extra": "today", "group": "grp00001"}])
        self.assertFalse({"to", "sent", "extra", "group"} & set(b))
        b = self.put(to="chan-2", sent=1700000100)
        self.assertEqual(b["calls"], [{"to": "chan-2", "sent": 1700000100.0}])
        b = self.put(to="")
        self.assertNotIn("calls", b)                                                  # who it went to: forgotten
        for bad in ({"to": "no spaces here"}, {"to": 7}, {"to": "abc123", "sent": "now"}, {"to": "x1", "group": "NO"}):
            with self.subTest(bad=bad), self.assertRaises(nb.NotebookError):
                self.put(**bad)

    def test_a_notebook_kept_before_reads_the_agent_a_line_went_to_as_its_one_call(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump({"version": 4, "pages": [{"id": "pagepage", "title": "Old", "parent": None, "blocks": [
                block("aaaaaa01", "todo", "ship it", to="chan-1", sent=1700000000, extra="today", work=True,
                      thread=[{"id": "line0001", "by": "user", "text": "and fast", "at": 1700000050}]),
                block("aaaaaa02", text="plain")]}]}, fh)
        book = nb.Notebook(self.path)
        a, b = book.page("pagepage")["blocks"]
        self.assertEqual(a["calls"], [{"to": "chan-1", "sent": 1700000000, "extra": "today"}])
        self.assertFalse({"to", "sent", "extra"} & set(a))
        self.assertNotIn("calls", b)
        self.assertTrue(nb.is_work(a))
        self.assertIn("- [aaaaaa01] sent to actor chan-1, with: today\n    the user: and fast", book.markdown(
            book.page("pagepage")))

    def test_lines_sent_together_share_a_group_which_goes_when_one_is_sent_alone(self):
        self.page(blocks=[block("aaaaaa01", "todo", "fix it"), block("aaaaaa02", "todo", "test it")])
        self.book.apply([{"op": "block.put", "page": "pagepage",
                          "block": {"id": i, "calls": [{"to": "chan-1", "sent": 1700000000, "group": "grp00001"}]}}
                         for i in ("aaaaaa01", "aaaaaa02")])
        self.assertEqual([b["calls"][0].get("group") for b in self.book.page("pagepage")["blocks"]],
                         ["grp00001", "grp00001"])
        b = self.put(calls=[{"to": "chan-1", "sent": 1700000100}])                    # the first, sent again alone
        self.assertNotIn("group", b["calls"][0])
        for bad in ("NO SPACES", 7):
            with self.subTest(bad=bad), self.assertRaises(nb.NotebookError):
                self.put(calls=[{"to": "chan-1", "group": bad}])

    def test_its_thread_takes_lines_in_order_each_once_and_goes_with_it(self):
        self.page(blocks=[block("aaaaaa01", "todo", "ship it", to="chan-1"), block("aaaaaa02", text="other")])
        line = {"id": "line0001", "by": "user", "text": "also <b>this</b><script>x</script>"}
        v, done = self.book.apply([{"op": "thread.add", "page": "pagepage", "block": "aaaaaa01", "line": line},
                                   {"op": "thread.add", "page": "pagepage", "block": "aaaaaa01", "line": line},
                                   {"op": "thread.add", "page": "pagepage", "block": "aaaaaa01",
                                    "line": {"id": "line0002", "by": "agent:chan-1", "text": "done", "done": True}},
                                   {"op": "thread.add", "page": "pagepage", "block": "zzzzzz99", "line": line}])
        self.assertEqual(len(done), 2)                                            # sent again, or no block: skipped
        thread = self.book.page("pagepage")["blocks"][0]["thread"]
        self.assertEqual([(x["id"], x["by"], x["text"]) for x in thread],
                         [("line0001", "user", "also <b>this</b>"), ("line0002", "agent:chan-1", "done")])
        self.assertTrue(thread[1]["done"] and all(isinstance(x["at"], float) for x in thread))
        self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa01", "text": "ship"}},
                         {"op": "block.move", "page": "pagepage", "block": "aaaaaa01", "after": "aaaaaa02"}])
        self.assertEqual(len(self.book.page("pagepage")["blocks"][1]["thread"]), 2)
        self.book.apply([{"op": "thread.add", "page": "pagepage", "block": "aaaaaa01",
                          "line": {"id": "line0003", "by": "user", "to": "chan-1", "text": "to it"}}])
        self.assertEqual(self.book.block("aaaaaa01")[1]["thread"][-1]["to"], "chan-1")    # a message's agent
        for bad in ({"id": "line0004", "by": "someone", "text": "x"}, {"id": "line0004", "by": "user", "text": " "},
                    {"id": "x", "by": "user", "text": "x"}, {"id": "line0004", "by": "user", "to": "a b", "text": "x"},
                    {"id": "line0004", "by": "agent:chan-1", "to": "chan-2", "text": "x"}):
            with self.subTest(bad=bad), self.assertRaises(nb.NotebookError):
                self.book.apply([{"op": "thread.add", "page": "pagepage", "block": "aaaaaa01", "line": bad}])
        self.book.apply([{"op": "block.delete", "page": "pagepage", "block": "aaaaaa01"}])
        self.assertIsNone(self.book.block("aaaaaa01"))

    def test_an_agent_reads_who_a_block_went_to_and_its_thread_apart_from_the_blocks(self):
        page = self.page(blocks=[block("aaaaaa01", "todo", "ship it", to="chan-1", extra="today",
                                       thread=[{"id": "line0001", "by": "user", "text": "and <b>fast</b>"},
                                               {"id": "line0002", "by": "agent:chan-1", "text": "on it"}]),
                                 block("aaaaaa02", "agents")])
        md = self.book.markdown(page, "chan-1")
        self.assertIn("[aaaaaa01] - [ ] ship it\n[aaaaaa02] (a table of the gatherer's actors", md)
        self.assertIn("- [aaaaaa01] sent to actor chan-1 (you), with: today\n    the user: and **fast**\n"
                      "    actor chan-1 (you): on it", md)
        self.assertIn("The user's work items on this page", md)
        self.assertNotIn("(you)", self.book.markdown(page, "chan-2"))
        self.assertNotIn("calls", self.book.page("pagepage")["blocks"][1])      # an agents block goes to no one
        self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa02", "to": "chan-1"}}])
        self.assertNotIn("calls", self.book.page("pagepage")["blocks"][1])

    def test_an_agent_reads_every_agent_a_block_went_to_and_who_each_message_went_to(self):
        page = self.page(blocks=[block("aaaaaa01", "todo", "ship it", calls=[
            {"to": "chan-1", "sent": 1700000000, "dropped": 1700000500}, {"to": "chan-2", "sent": 1700000100},
            {"to": "chan-3", "sent": 1700000200, "extra": "review it"}],
            thread=[{"id": "line0001", "by": "user", "to": "chan-2", "text": "and fast"},
                    {"id": "line0002", "by": "agent:chan-2", "text": "on it"}])])
        md = self.book.markdown(page, "chan-2")
        self.assertIn("- [aaaaaa01] sent to actor chan-2 (you); also sent to actor chan-3, with: review it; taken back "
                      "from actor chan-1\n    the user (to actor chan-2 (you)): and fast\n"
                      "    actor chan-2 (you): on it", md)
        self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa01", "calls": [
            {"to": "chan-1", "sent": 1700000000, "dropped": 1700000500}]}}])
        self.assertIn("- [aaaaaa01] sent to no one now; taken back from actor chan-1",
                      self.book.markdown(self.book.page("pagepage")))


class WorkTest(BookBase):
    """Work items: lines sent to an agent, or marked as one; only the user ends one, done or canceled."""

    def test_a_line_is_a_work_item_once_sent_or_marked_and_stays_one_sent_to_no_one(self):
        self.page(blocks=[block("aaaaaa01", "todo", "ship it"), block("aaaaaa02", text="plain"),
                          block("aaaaaa03", "divider")])
        bs = lambda: self.book.page("pagepage")["blocks"]                          # noqa: E731
        self.assertFalse(any(nb.is_work(b) for b in bs()))
        self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa01", "work": True}},
                         {"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa02", "to": "chan-1"}},
                         {"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa03", "work": True}}])
        self.assertEqual([nb.is_work(b) for b in bs()], [True, True, False])      # a divider is never one
        self.assertNotIn("work", bs()[2])
        self.book.apply([{"op": "block.put", "page": "pagepage",
                          "block": {"id": "aaaaaa01", "to": "chan-1", "sent": 1700000000}},
                         {"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa01", "to": ""}}])
        self.assertTrue(nb.is_work(bs()[0]))                                      # marked: still one, sent to no one
        self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa01", "work": False}}])
        self.assertFalse(nb.is_work(bs()[0]))

    def test_the_user_ends_one_done_or_canceled_and_a_ticked_to_do_one_is_done(self):
        self.page(blocks=[block("aaaaaa01", "todo", "ship it", work=True), block("aaaaaa02", text="ask", to="chan-1"),
                          block("aaaaaa03", "todo", "not one")])
        bs = lambda: self.book.page("pagepage")["blocks"]                          # noqa: E731
        self.assertEqual([nb.ended_of(b) for b in bs()], ["", "", ""])
        self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa01", "checked": True}},
                         {"op": "block.put", "page": "pagepage",
                          "block": {"id": "aaaaaa02", "ended": "canceled", "ended_at": 1700000000}},
                         {"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa03", "checked": True}}])
        self.assertEqual([nb.ended_of(b) for b in bs()], ["done", "canceled", ""])   # (a to-do that is no work item)
        self.assertEqual(bs()[1]["ended_at"], 1700000000.0)
        self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa01", "ended": "done"}},
                         {"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa03", "ended": "done"}}])
        self.assertIsInstance(bs()[0]["ended_at"], float)                         # when: now, if not said
        self.assertNotIn("ended", bs()[2])                                         # nothing to end on a line not one
        self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa02", "ended": ""}}])
        self.assertFalse({"ended", "ended_at"} & set(bs()[1]))                     # reopened
        with self.assertRaises(nb.NotebookError):
            self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa02", "ended": "maybe"}}])

    def test_a_report_keeps_what_it_made(self):
        self.page(blocks=[block("aaaaaa01", "todo", "ship it", to="chan-1")])
        line = {"id": "line0001", "by": "agent:chan-1", "text": "done", "done": True,
                "results": ["  branch   ship-it ", "", "x" * 400, *[f"f{i}.py" for i in range(10)]]}
        self.book.apply([{"op": "thread.add", "page": "pagepage", "block": "aaaaaa01", "line": line}])
        made = self.book.page("pagepage")["blocks"][0]["thread"][0]["results"]
        self.assertEqual(made[:2], ["branch ship-it", "x" * nb.MAX_RESULT])
        self.assertEqual(len(made), nb.MAX_RESULTS)
        with self.assertRaises(nb.NotebookError):
            self.book.apply([{"op": "thread.add", "page": "pagepage", "block": "aaaaaa01",
                              "line": {**line, "id": "line0002", "results": "a.py"}}])

    def test_an_agent_reads_which_lines_are_work_items_and_how_the_user_ended_them(self):
        page = self.page(blocks=[block("aaaaaa01", "todo", "ship it", to="chan-1", checked=True,
                                       thread=[{"id": "line0001", "by": "agent:chan-1", "text": "shipped", "done": True,
                                                "results": ["PR #4"]}]),
                                 block("aaaaaa02", text="later", work=True),
                                 block("aaaaaa03", text="dropped", to="chan-2", ended="canceled"),
                                 block("aaaaaa04", "work")])
        md = self.book.markdown(page, "chan-1")
        self.assertIn("- [aaaaaa01] sent to actor chan-1 (you); the user accepted it as done\n"
                      "    actor chan-1 (you): shipped (said it is done) (made: PR #4)", md)
        self.assertIn("- [aaaaaa02] sent to no one yet\n", md)
        self.assertIn("- [aaaaaa03] sent to actor chan-2; the user canceled it", md)
        self.assertIn("[aaaaaa04] (a list of the user's open work items", md)
        self.assertIn("Plans (0 of 1 to-dos open, 1 work item open)", self.book.outline())


class MarkdownTest(unittest.TestCase):
    MD = ("# Trip\n- [ ] pack **boots**\n  - [x] socks\n* tent\n1. one\n2. two\n   1. inner\n3. three\n"
          "> leave *early*, see [map](https://maps.example)\n---\n```\nx = a < b\n```\nplain `co<de>` text\n")

    def test_lines_become_blocks_and_back(self):
        blocks = nb.blocks_from_markdown(self.MD)
        self.assertEqual([(b["type"], b["indent"]) for b in blocks],
                         [("h1", 0), ("todo", 0), ("todo", 1), ("bullet", 0), ("number", 0), ("number", 0),
                          ("number", 1), ("number", 0), ("quote", 0), ("divider", 0), ("code", 0), ("text", 0)])
        self.assertEqual(blocks[1]["text"], "pack <b>boots</b>")
        self.assertTrue(blocks[2]["checked"])
        self.assertEqual(blocks[8]["text"], 'leave <i>early</i>, see <a href="https://maps.example">map</a>')
        self.assertEqual(blocks[10]["text"], "x = a < b")
        self.assertEqual(blocks[11]["text"], "plain <code>co&lt;de&gt;</code> text")
        lines = nb.markdown_lines([{**b, "id": f"bbbbbb{n:02}"} for n, b in enumerate(blocks)], ids=False)
        self.assertEqual("\n".join(lines) + "\n", self.MD.replace("* tent", "- tent").replace("   1.", "  1."))

    def test_ids_read_from_notes_read_are_left_out_when_given_back(self):
        got = nb.blocks_from_markdown("[abc12345] - [ ] milk\n[abc12346]   - [x] eggs\n[abc12347] ```\nx\n```")
        self.assertEqual([(b["type"], b["text"], b["indent"]) for b in got],
                         [("todo", "milk", 0), ("todo", "eggs", 1), ("code", "x", 0)])
        self.assertEqual(nb.blocks_from_markdown("[x] done")[0]["type"], "todo")      # "[x]" is a to-do, not an id
        got = nb.blocks_from_markdown("- [x](page:chatpage)\n- [ ](https://a.b)")      # links, in list items
        self.assertEqual([(b["type"], b["text"]) for b in got],
                         [("bullet", '<a href="page:chatpage">x</a>'), ("bullet", '<a href="https://a.b"> </a>')])

    def test_inline_marks(self):
        for md, html in (("a **b** _c_ *d* ~~e~~", "a <b>b</b> <i>c</i> <i>d</i> <s>e</s>"),
                         ("2 * 3 * 4", "2 * 3 * 4"), ("snake_case_name", "snake_case_name"),
                         ("[x](javascript:go())", "[x](javascript:go())"), ("<b>raw</b>", "&lt;b&gt;raw&lt;/b&gt;"),
                         ("line<br>next", "line<br>next")):
            with self.subTest(md=md):
                self.assertEqual(nb.inline_html(md), html)
        self.assertEqual(nb.inline_markdown('<b>b</b> <a href="https://x.org">x</a> <code>c</code>'),
                         "**b** [x](https://x.org) `c`")


class Host(app_kit.Host):
    """The host a test gives the backend: its data folder, and what it told the panels."""

    def __init__(self, folder):
        self.data, self.told = folder, []

    def insert(self, instance, events, channel=None):
        raise AssertionError("Notes inserts no events")

    def read(self, instance, types, after=0, channel=None, limit=500):
        return []

    def attached(self, instance):
        return []

    def tell_panel(self, instance, message):
        self.told.append(message)

    def folder(self):
        return self.data


class BackendTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.app = NotesApp()
        self.host = Host(self.dir)
        self.app.start(self.host)
        self.inst = self.app.open(Instance(id="0123456789abcdef", app="notes", gatherer="my gatherer/1"), {})
        self.agent = Caller(channel="chan-1", gatherer="my gatherer/1")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def call(self, tool, **args):
        got = self.app.call(self.inst, tool, args, self.agent)
        return got.is_error, got.content[0]["text"]

    def ask(self, method, path, body=None):
        r = self.app.request(self.inst, method, path, {}, json.dumps(body).encode() if body is not None else b"")
        return r.status, json.loads(r.body)

    def test_an_agent_makes_a_page_adds_to_it_and_ticks_a_to_do(self):
        self.assertEqual(self.inst.title, "my gatherer/1")
        err, text = self.call("read")
        self.assertFalse(err)
        self.assertIn("no pages yet", text)
        err, text = self.call("add", title="Groceries", icon="🛒", markdown="- [ ] milk\n- [ ] eggs")
        self.assertFalse(err)
        self.assertTrue(text.startswith("# 🛒 Groceries   (page "))
        self.assertRegex(text, r"\n\[[a-z0-9]{8}\] - \[ \] milk\n\[[a-z0-9]{8}\] - \[ \] eggs")
        milk = text.split("] - [ ] milk")[0].rsplit("[", 1)[1]
        err, text = self.call("add", page="groceries", markdown="- [ ] bread", after=milk)
        self.assertIn("milk\n[", text)
        self.assertLess(text.index("bread"), text.index("eggs"))
        err, text = self.call("change", page="Groceries", block=milk, checked=True)
        self.assertIn("- [x] milk", text)
        err, text = self.call("change", page="Groceries", block=milk, markdown="- [x] oat milk\n- [ ] butter")
        self.assertIn("- [x] oat milk\n[", text)
        self.assertIn("- [ ] butter", text)
        err, text = self.call("read")
        self.assertIn("Groceries (3 of 4 to-dos open)", text)
        # every change told to the panels, in order, with the agent who made it
        self.assertEqual([m["version"] for m in self.host.told], [1, 2, 3, 4])
        self.assertEqual({m["by"] for m in self.host.told}, {"agent:chan-1"})
        self.assertEqual({m["agent"] for m in self.host.told}, {"chan-1"})
        # kept in the app's data folder, the gatherer's name made a file's
        self.assertEqual(os.listdir(self.dir), ["my%20gatherer%2F1.json"])

    def test_an_agent_links_a_line_to_another_page(self):
        err, text = self.call("add", title="Chat", markdown="x")
        chat = text.split("(page ", 1)[1].split(")", 1)[0]
        err, text = self.call("add", title="To dos", markdown=f"- [Chat](page:{chat})\n- see [it](page:chat)")
        self.assertFalse(err, text)
        self.assertIn(f"- [Chat](page:{chat})\n", text)
        self.assertIn(f"- see [Chat](page:{chat})", text)                 # by its title: linked by its id
        line = text.split("- see")[0].rsplit("[", 1)[1].split("]")[0]
        err, text = self.call("change", page="To dos", block=line, markdown="- [x](page:Nope)")
        self.assertTrue(err)
        self.assertIn("no page 'Nope' to link to", text)

    def test_an_agent_is_told_what_it_got_wrong(self):
        for tool, args, says in (("read", {"page": "Nope"}, "no page 'Nope'"),
                                 ("add", {"markdown": "x"}, "which page"),
                                 ("add", {"page": "Nope", "markdown": "x"}, "no page"),
                                 ("change", {"page": "Nope", "block": "aaaaaaaa"}, "no page")):
            with self.subTest(tool=tool, args=args):
                err, text = self.call(tool, **args)
                self.assertTrue(err)
                self.assertIn(says, text)
        self.call("add", title="List", markdown="text")
        err, text = self.call("change", page="List", block="zzzzzzzz", checked=True)
        self.assertTrue(err)
        self.assertIn("no block 'zzzzzzzz'", text)
        bid = self.call("read", page="List")[1].split("\n")[2][1:9]
        err, text = self.call("change", page="List", block=bid, checked=True)
        self.assertIn("not a to-do", text)
        err, text = self.call("add", page="List", markdown="more", after="zzzzzzzz")
        self.assertIn("no block 'zzzzzzzz'", text)

    def test_an_agent_renames_moves_and_bins_a_page(self):
        self.call("add", title="Top", markdown="")
        self.call("add", title="Kid", markdown="- a", parent="Top")
        err, text = self.call("change", page="Kid", title="Child", icon="🐣")
        self.assertTrue(text.startswith("# 🐣 Child   (page "))
        self.assertIn(", under Top (", text)
        err, text = self.call("change", page="Child", parent="top")
        self.assertNotIn("under", text.split("\n")[0])
        err, text = self.call("change", page="Top", delete=True)
        self.assertIn("is in the trash", text)
        self.assertIn("In the trash (the user can restore them): Top", self.call("read")[1])
        err, text = self.call("change", page="Child")             # nothing to change
        self.assertTrue(err)
        self.assertIn("a `block` to change", text)

    def sent_block(self, text="ship it", type="todo"):
        self.ask("POST", "ops", {"by": "p-one", "ops": [
            {"op": "page.new", "page": {"id": "pagepage", "title": "Plans"},
             "blocks": [block("aaaaaa01", type, text, to="chan-1", sent=1700000000)]}]})

    def test_an_agent_reports_back_on_a_block_it_was_sent_and_the_user_ends_it(self):
        self.sent_block()
        err, text = self.call("report", block="aaaaaa01", text="Did it: **branch** `ship-it`.\nTests pass.")
        self.assertFalse(err)
        self.assertEqual(text, "Reported on the line on “Plans”: the user reviews it there, and says when it is done.")
        err, text = self.call("report", block="aaaaaa01", text="All done.", done=True, results=["ship-it", "a.py"])
        self.assertFalse(err)
        b = self.app.book(self.inst.gatherer).block("aaaaaa01")[1]
        self.assertFalse(b["checked"])                                            # the user's to tick, not its
        self.assertEqual([(x["by"], x["text"], x.get("done", False), x.get("results")) for x in b["thread"]],
                         [("agent:chan-1", "Did it: <b>branch</b> <code>ship-it</code>.<br>Tests pass.", False, None),
                          ("agent:chan-1", "All done.", True, ["ship-it", "a.py"])])
        told = self.host.told[-1]
        self.assertEqual((told["by"], told["agent"], [o["op"] for o in told["ops"]]),
                         ("agent:chan-1", "chan-1", ["thread.add"]))
        self.assertIn("    actor chan-1 (you): All done. (said it is done) (made: ship-it, a.py)",
                      self.call("read", page="Plans")[1])
        err, text = self.call("change", page="Plans", block="aaaaaa01", checked=True)
        self.assertTrue(err)
        self.assertIn("only the user says when one is done", text)
        err, text = self.call("change", page="Plans", block="aaaaaa01", markdown="- [x] ship it today")
        self.assertIn("- [ ] ship it today", text)                                # rewritten, its tick kept
        self.ask("POST", "ops", {"by": "p-one", "ops": [{"op": "block.put", "page": "pagepage", "block": {
            "id": "aaaaaa01", "ended": "canceled"}}]})
        err, text = self.call("report", block="aaaaaa01", text="Late.")
        self.assertIn("The user canceled that line: leave it.", text)

    def test_an_agent_the_user_took_a_line_back_from_may_not_report_on_it(self):
        self.sent_block()
        self.ask("POST", "ops", {"by": "p-one", "ops": [{"op": "block.put", "page": "pagepage", "block": {
            "id": "aaaaaa01", "calls": [{"to": "chan-1", "sent": 1700000000, "dropped": 1700000100},
                                        {"to": "chan-2", "sent": 1700000100}]}}]})
        err, text = self.call("report", block="aaaaaa01", text="Did it.")
        self.assertFalse(err)
        self.assertIn("the user took the line on “Plans” back from you", text)
        self.assertNotIn("thread", self.app.book(self.inst.gatherer).block("aaaaaa01")[1])
        self.agent = Caller(channel="chan-2", gatherer="my gatherer/1")              # the one it is with now
        err, text = self.call("report", block="aaaaaa01", text="Did it.")
        self.assertIn("the user reviews it there", text)
        self.agent = Caller(channel="chan-9", gatherer="my gatherer/1")              # one it never went to (a helper)
        err, text = self.call("report", block="aaaaaa01", text="Helped.")
        self.assertIn("the user reviews it there", text)
        self.assertEqual([x["by"] for x in self.app.book(self.inst.gatherer).block("aaaaaa01")[1]["thread"]],
                         ["agent:chan-2", "agent:chan-9"])

    def test_an_agent_is_told_what_is_wrong_with_its_report(self):
        self.sent_block()
        for args, says in (({"block": "zzzzzz99", "text": "x"}, "no block 'zzzzzz99'"),
                           ({"block": "aaaaaa01", "text": "  "}, "one to three lines"),
                           ({"block": "aaaaaa01", "text": "x" * 2000}, "too long for a report"),
                           ({"block": "aaaaaa01", "text": "x", "results": "a.py"}, "is a list of what you made")):
            with self.subTest(args=args):
                err, text = self.call("report", **args)
                self.assertTrue(err)
                self.assertIn(says, text)
        self.assertNotIn("thread", self.app.book(self.inst.gatherer).block("aaaaaa01")[1])

    def test_a_line_a_panel_adds_is_the_users(self):
        self.sent_block()
        status, got = self.ask("POST", "ops", {"by": "p-one", "ops": [{"op": "thread.add", "page": "pagepage",
                                                                         "block": "aaaaaa01", "line": {
                                                                             "id": "line0001", "by": "agent:chan-1",
                                                                             "text": "I did it", "at": 5}}]})
        self.assertEqual(status, 200)
        line = self.app.book(self.inst.gatherer).block("aaaaaa01")[1]["thread"][0]
        self.assertEqual(line["by"], "user")
        self.assertGreater(line["at"], 1_700_000_000)                              # written now, not when it says

    def test_the_panel_reads_the_notebook_and_changes_it(self):
        status, got = self.ask("GET", "state")
        self.assertEqual((status, got), (200, {"version": 0, "pages": []}))
        status, got = self.ask("POST", "ops", {"by": "p-one", "ops": [
            {"op": "page.new", "page": {"id": "pagepage", "title": "Mine"}, "blocks": [block("aaaaaa01", text="hi")]}]})
        self.assertEqual((status, got), (200, {"version": 1}))
        self.assertEqual(self.host.told[-1]["by"], "p-one")
        self.assertNotIn("agent", self.host.told[-1])
        status, got = self.ask("POST", "ops", {"by": "p-one", "ops": [{"op": "block.put", "page": "pagepage",
                                                                         "block": block("aaaaaa02", "nope")}]})
        self.assertEqual(status, 400)
        self.assertIn("not a block's type", got["error"])
        status, got = self.ask("POST", "parse", {"markdown": "- [ ] a\n\n# b"})
        self.assertEqual([(b["type"], b["text"]) for b in got["blocks"]], [("todo", "a"), ("h1", "b")])
        self.assertTrue(all(nb.ID.match(b["id"]) for b in got["blocks"]))
        self.assertEqual(self.ask("GET", "state")[1]["version"], 1)   # parsing changed nothing
        self.assertEqual(self.ask("POST", "ops", ["not", "an", "object"])[0], 400)
        self.assertEqual(self.app.request(self.inst, "GET", "nothing", {}, b"").status, 404)


class SourceTest(BookBase):
    """A block an agent wrote from its own conversation with the user names it, and when: its source. The user's
    follow-ups on it, and the agent's replies, are its thread."""

    def test_a_block_keeps_its_source_as_it_is_retyped_and_a_divider_has_none(self):
        self.page(blocks=[block("aaaaaa01", "bullet", "ACP fits ag best", source="chan-1", source_at=1700000000),
                          block("aaaaaa02", "divider", source="chan-1")])
        b, d = self.book.page("pagepage")["blocks"]
        self.assertEqual((b["source"], b["source_at"]), ("chan-1", 1700000000.0))
        self.assertFalse({"source", "source_at"} & set(d))
        self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa01", "text": "ACP fits"}},
                         {"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa01", "type": "todo"}}])
        b = self.book.page("pagepage")["blocks"][0]
        self.assertEqual((b["type"], b["text"], b["source"], b["source_at"]),
                         ("todo", "ACP fits", "chan-1", 1700000000.0))
        self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa01", "source": ""}}])
        self.assertFalse({"source", "source_at"} & set(self.book.page("pagepage")["blocks"][0]))
        for bad in ({"source": "no spaces here"}, {"source": 7}, {"source": "abc123", "source_at": "now"}):
            with self.subTest(bad=bad), self.assertRaises(nb.NotebookError):
                self.book.apply([{"op": "block.put", "page": "pagepage", "block": {"id": "aaaaaa01", **bad}}])

    def test_an_agent_reads_who_wrote_lines_from_its_conversation_and_the_follow_ups(self):
        at = 1700000000
        page = self.page(blocks=[
            block("aaaaaa01", "bullet", "ACP fits", source="chan-1", source_at=at),
            block("aaaaaa02", "bullet", "AG-UI less so", source="chan-1", source_at=at,
                  thread=[{"id": "line0001", "by": "user", "text": "why <b>less</b>?"},
                          {"id": "line0002", "by": "agent:chan-1", "text": "it needs a web front end"}]),
            block("aaaaaa03", "text", "my own line"),
            block("aaaaaa04", "todo", "try ACP", source="chan-2", source_at=at + 60, to="chan-3")])
        md = self.book.markdown(page, "chan-1")
        when = __import__("time").strftime("%Y-%m-%d %H:%M", __import__("time").localtime(at))
        self.assertIn("Lines agents wrote from their conversations with the user", md)
        self.assertIn(f"- [aaaaaa01], [aaaaaa02] by actor chan-1 (you), {when}\n    the user: why **less**?\n"
                      f"    actor chan-1 (you): it needs a web front end\n", md)
        self.assertIn("- [aaaaaa04] by actor chan-2, ", md)
        self.assertIn("- [aaaaaa04] sent to actor chan-3", md)                  # sent on: its thread goes with the sent
        self.assertNotIn("sent to no one", md)                                   # a follow-up is not a line sent
        self.assertNotIn("[aaaaaa03] by", md)
        self.assertNotIn("Lines agents wrote", self.book.markdown(self.page("pagetwo", "Two", [block("bbbbbb01")])))


class SourceToolsTest(unittest.TestCase):
    """notes_add and notes_change name the agent as the source of lines it writes from its own conversation."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.app = NotesApp()
        self.app.start(Host(self.dir))
        self.inst = self.app.open(Instance(id="0123456789abcdef", app="notes", gatherer="g"), {})

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def call(self, tool, channel="chan-1", **args):
        got = self.app.call(self.inst, tool, args, Caller(channel=channel, gatherer="g"))
        return got.is_error, got.content[0]["text"]

    def blocks(self, page="Plans"):
        return self.app.book("g").page(page)["blocks"]

    def test_lines_from_its_conversation_name_it_and_lines_it_was_told_to_write_do_not(self):
        self.assertFalse(self.call("add", title="Plans", markdown="- ACP fits\n- AG-UI less so",
                                   from_conversation=True)[0])
        self.assertFalse(self.call("add", page="Plans", markdown="- [ ] call Ana")[0])
        a, b, c = self.blocks()
        self.assertEqual((a["source"], b["source"]), ("chan-1", "chan-1"))
        self.assertEqual(a["source_at"], b["source_at"])                       # one call's lines: one reference
        self.assertFalse({"source", "source_at"} & set(c))
        err, text = self.call("read", page="Plans")
        self.assertIn(f"- [{a['id']}], [{b['id']}] by actor chan-1 (you), ", text)

    def test_a_block_rewritten_from_a_conversation_names_who_did_and_one_tidied_keeps_its_source(self):
        self.call("add", title="Plans", markdown="ACP fits")
        bid = self.blocks()[0]["id"]
        self.assertFalse(self.call("change", page="Plans", block=bid, markdown="ACP fits best", from_conversation=True,
                                   channel="chan-2")[0])
        b = self.blocks()[0]
        self.assertEqual(b["source"], "chan-2")
        self.call("change", page="Plans", block=bid, markdown="- ACP fits best\n- and Zed speaks it")
        b, more = self.blocks()
        self.assertEqual((b["text"], b["source"]), ("ACP fits best", "chan-2"))  # changed as told: still chan-2's
        self.assertNotIn("source", more)
        err, text = self.call("add", page="Plans", markdown="x", from_conversation="yes")
        self.assertTrue(err)
        self.assertIn("`from_conversation` is true or false", text)

    def test_its_reply_to_a_follow_up_goes_beside_the_line_and_a_work_item_it_wrote_stays_one(self):
        self.call("add", title="Plans", markdown="- ACP fits", from_conversation=True)
        bid = self.blocks()[0]["id"]
        err, text = self.call("report", block=bid, text="It speaks JSON-RPC over stdio.")
        self.assertFalse(err)
        self.assertEqual(text, "Reported beside the line on “Plans”: the user sees it there.")
        self.assertNotIn("work", self.blocks()[0])                              # an answer: no work item made
        read = self.call("read", page="Plans")[1]
        self.assertIn("    actor chan-1 (you): It speaks JSON-RPC over stdio.", read)
        pid = self.app.book("g").page("Plans")["id"]
        self.app.change(self.inst, [{"op": "block.put", "page": pid, "block": {"id": bid, "work": True}}], "user")
        read = self.call("read", page="Plans")[1]                              # marked a work item by the user
        self.assertIn(f"- [{bid}] sent to no one yet", read)
        self.assertIn(f"- [{bid}] by actor chan-1 (you), ", read)
        self.assertEqual(read.count("It speaks JSON-RPC over stdio."), 1)       # its thread: with the work items
        self.assertIn("the user reviews it there", self.call("report", block=bid, text="More.")[1])

    def test_a_follow_up_is_read_back_as_the_users_words_about_those_lines(self):
        import re
        m = app_kit.load(FOLDER)
        self.assertIn("from_conversation", m.instructions)
        self.assertIn("from_conversation", m.tool("add").input_schema["properties"])
        self.assertIn("from_conversation", m.tool("change").input_schema["properties"])
        text = ('(A reply in my Notes, page "Discussion", blocks abc12345, def67890: about lines you wrote there on '
                'Nov 9, 2:02 PM, from our conversation. Answer as always, then put one to three lines beside them '
                'with notes_report, one report, on block def67890.)\n\n- ACP fits\n- AG-UI less so\n\nWhy less so?')
        self.assertIn(m.asked.when, text)
        self.assertEqual(re.match(m.asked.pattern, text).groups(),
                         ("- ACP fits\n- AG-UI less so\n\nWhy less so?", "Discussion", "abc12345, def67890"))


if __name__ == "__main__":
    unittest.main()
