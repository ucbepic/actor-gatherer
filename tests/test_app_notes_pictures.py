"""Pictures in the Notes app (ag_apps/notes/media.py, notebook.py's PICTURES): image and figma blocks, the files they
are kept in, how agents read and add them, and the snapshots Figma gives of a frame -- with a Figma of the test's (no
network). The panel's side is in frontend/e2e/notes-pictures.spec.ts."""
import json
import os
import shutil
import struct
import sys
import tempfile
import threading
import unittest
import zlib

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag_apps.notes import media  # noqa: E402
from ag_apps.notes import notebook as nb  # noqa: E402
from ag_apps.notes.backend import MAX_SHOWN, NotesApp  # noqa: E402
from app_kit import Caller, Instance  # noqa: E402

from test_app_notes import Host  # noqa: E402


def png(w=3, h=2, shade=0):
    """A real PNG of w x h, all one grey."""
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    rows = b"".join(b"\x00" + bytes([shade]) * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


FIGMA = "https://www.figma.com/design/Xk2abcdEF9/Paper-figures?node-id=12-34&t=abc"


class SniffTest(unittest.TestCase):
    def test_each_kind_says_its_size(self):
        gif = b"GIF89a" + struct.pack("<HH", 40, 30) + b"\x00" * 8
        jpg = (b"\xff\xd8\xff\xe0" + struct.pack(">H", 4) + b"JF" + b"\xff\xc0" + struct.pack(">HBHH", 11, 8, 300, 500)
               + b"\x00" * 8)
        webp = (b"RIFF" + b"\x00" * 4 + b"WEBPVP8X" + b"\x00" * 8 + (99).to_bytes(3, "little")
                + (49).to_bytes(3, "little"))
        svg = (b'<?xml version="1.0"?>\n<!-- made by hand -->\n'
               b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80">')
        for data, want in ((png(7, 5), ("png", 7, 5)), (gif, ("gif", 40, 30)), (jpg, ("jpg", 500, 300)),
                           (webp, ("webp", 100, 50)), (svg, ("svg", 120, 80)),
                           (b'<svg width="10px" height="20">', ("svg", 10, 20))):
            with self.subTest(want=want):
                self.assertEqual(media.sniff(data), want)

    def test_what_is_not_a_picture_is_none(self):
        for data in (b"", b"hello", b"<html><svg></svg></html>", b"%PDF-1.7"):
            self.assertIsNone(media.sniff(data))


class FilesTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.files = media.Files(os.path.join(self.dir, "files"))

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_a_picture_kept_twice_is_one_file_named_by_its_contents(self):
        a, b = self.files.keep(png(4, 3)), self.files.keep(png(4, 3))
        self.assertEqual(a, b)
        self.assertRegex(a["file"], r"^[a-f0-9]{16}\.png$")
        self.assertEqual((a["w"], a["h"]), (4, 3))
        self.assertEqual(os.listdir(os.path.join(self.dir, "files")), [a["file"]])
        self.assertNotEqual(self.files.keep(png(4, 3, shade=9))["file"], a["file"])
        self.assertTrue(self.files.path(a["file"]).endswith(a["file"]))

    def test_what_is_not_a_picture_or_too_large_is_refused_and_no_path_leaves_the_folder(self):
        with self.assertRaises(media.MediaError):
            self.files.keep(b"just text")
        with self.assertRaises(media.MediaError):
            self.files.keep(b"\x89PNG\r\n\x1a\n" + b"\x00" * (media.MAX_IMAGE + 1))
        for name in ("../figma.json", "0123456789abcdef.exe", "nothing.png", "0123456789abcdef.png"):
            self.assertIsNone(self.files.path(name))


class PictureBlockTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.book = nb.Notebook(os.path.join(self.dir, "b.json"))
        self.book.apply([{"op": "page.new", "page": {"id": "pageone", "title": "One"}}])

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def put(self, **b):
        self.book.apply([{"op": "block.put", "page": "pageone", "block": {"id": "imgblock", **b}}])
        return self.book.page("pageone")["blocks"][-1]

    def test_an_image_keeps_its_file_size_width_and_caption(self):
        b = self.put(type="image", file="0123456789abcdef.png", w=640, h=480, width=250, text="A <b>plot</b>",
                     indent=3, checked=True, to="chan-1")
        self.assertEqual(b, {"id": "imgblock", "type": "image", "text": "A <b>plot</b>", "checked": False, "indent": 0,
                             "file": "0123456789abcdef.png", "w": 640, "h": 480, "width": 100})
        b = self.put(width=40)                                    # what is given changed, the rest kept
        self.assertEqual((b["file"], b["width"]), ("0123456789abcdef.png", 40))
        self.assertNotIn("to", b)                                 # (a picture is sent to no one)

    def test_a_picture_needs_its_file_or_its_link(self):
        for given in ({"type": "image"}, {"type": "image", "file": "../x.png"}, {"type": "figma"},
                      {"type": "figma", "url": "https://evil.example/design/abc123"},
                      {"type": "image", "file": "0123456789abcdef.png", "w": "wide"}):
            with self.subTest(given=given), self.assertRaises(nb.NotebookError):
                self.put(**given)

    def test_figma_keeps_its_link_name_and_snapshot(self):
        b = self.put(type="figma", url=FIGMA, title="Pipeline", snap="fedcba9876543210.png", snap_at=5,
                     snap_mod="2026-11-11T10:00:00Z", w=800, h=400)
        self.assertEqual({k: b[k] for k in ("url", "title", "snap", "snap_at", "snap_mod", "w", "h")},
                         {"url": FIGMA, "title": "Pipeline", "snap": "fedcba9876543210.png", "snap_at": 5.0,
                          "snap_mod": "2026-11-11T10:00:00Z", "w": 800, "h": 400})

    def test_agents_read_pictures_as_markdown_and_write_them_back(self):
        self.put(type="image", file="0123456789abcdef.png", text="Loss <i>by</i> step")
        self.book.apply([{"op": "block.put", "page": "pageone", "block": {
            "id": "figblock", "type": "figma", "url": FIGMA, "title": "Pipeline", "text": "Figure 2"}}])
        md = self.book.markdown(self.book.page("pageone"))
        self.assertIn("[imgblock] ![Loss *by* step](image:0123456789abcdef.png)", md)
        self.assertIn(f"[figblock] [Figma: Pipeline]({FIGMA}) -- Figure 2", md)
        back = nb.blocks_from_markdown(md.split("\n", 2)[2])
        self.assertEqual([(b["type"], b["text"], b.get("src"), b.get("url"), b.get("title")) for b in back],
                         [("image", "Loss <i>by</i> step", "image:0123456789abcdef.png", None, None),
                          ("figma", "Figure 2", None, FIGMA, "Pipeline")])

    def test_only_a_figma_link_alone_on_a_line_is_a_frame(self):
        got = nb.blocks_from_markdown(f"{FIGMA}\nSee {FIGMA} for it\n"
                                      "[the board](https://www.figma.com/board/Pq7abcdef/S)\n"
                                      "[a page](https://example.com/design/abcdefg)")
        self.assertEqual([(b["type"], b.get("title")) for b in got],
                         [("figma", ""), ("text", None), ("figma", "the board"), ("text", None)])


def fake_figma(answers, asked):
    """A Figma of the test's: each url's (status, body) the first answer whose key is in it."""
    def fetch(url, headers):
        asked.append((url, dict(headers)))
        for part, got in answers:
            if part in url:
                return got
        return 404, b""
    return fetch


class BackendPictureTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.work = os.path.join(self.dir, "work")
        os.makedirs(os.path.join(self.work, "runs"))
        with open(os.path.join(self.work, "runs", "loss.png"), "wb") as fh:
            fh.write(png(30, 20))
        self.app = NotesApp()
        self.host = Host(os.path.join(self.dir, "data"))
        self.app.start(self.host)
        self.inst = self.app.open(Instance(id="0123456789abcdef", app="notes", gatherer="g"), {})
        self.agent = Caller(channel="chan-1", gatherer="g", folder=self.work)
        self.asked = []

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def call(self, tool, **args):
        return self.app.call(self.inst, tool, args, self.agent)

    def blocks(self, page="Figures"):
        return self.app.book("g").page(page)["blocks"]

    def settle(self):
        for t in threading.enumerate():
            if t.name == "notes-figma":
                t.join(5)

    def test_an_agent_adds_its_plot_from_a_file_and_reads_it_back_as_a_picture(self):
        got = self.call("add", title="Figures", markdown="Results:\n![Loss over *training*](runs/loss.png)")
        self.assertFalse(got.is_error, got.content)
        img = self.blocks()[1]
        self.assertEqual((img["type"], img["text"], img["w"], img["h"]), ("image", "Loss over <i>training</i>", 30, 20))
        self.assertTrue(os.path.isfile(os.path.join(self.dir, "data", "files", img["file"])))
        read = self.call("read", page="Figures").content
        self.assertIn(f"![Loss over *training*](image:{img['file']})", read[0]["text"])
        self.assertEqual(read[1], {"type": "text", "text": f"[{img['id']}] the picture: Loss over *training*"})
        self.assertEqual((read[2]["type"], read[2]["mimeType"]), ("image", "image/png"))
        import base64
        self.assertEqual(base64.b64decode(read[2]["data"]), png(30, 20))

    def test_a_picture_it_cannot_read_is_refused_and_nothing_is_added(self):
        self.call("add", title="Figures", markdown="start")
        for md, said in (("![x](runs/none.png)", "no file"), ("![x](https://example.com/a.png)", "download it"),
                         ("![x](image:0123456789abcdef.png)", "no picture"), ("![x](../work/runs)", "no file")):
            with self.subTest(md=md):
                got = self.call("add", page="Figures", markdown=md)
                self.assertTrue(got.is_error)
                self.assertIn(said, got.content[0]["text"])
        self.assertEqual(len(self.blocks()), 1)
        with open(os.path.join(self.work, "notes.txt"), "w") as fh:
            fh.write("not a picture")
        got = self.call("add", page="Figures", markdown=f"![x]({os.path.join(self.work, 'notes.txt')})")
        self.assertIn("not a picture", got.content[0]["text"])

    def test_read_gives_at_most_so_many_pictures_and_no_svg(self):
        lines = [f"![p{i}](image:{self.app.files.keep(png(2, 2, shade=i))['file']})" for i in range(MAX_SHOWN + 1)]
        svg = self.app.files.keep(b'<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>')["file"]
        self.call("add", title="Figures", markdown="\n".join([f"![drawn](image:{svg})", *lines]))
        read = self.call("read", page="Figures").content
        self.assertEqual(sum(1 for c in read if c["type"] == "image"), MAX_SHOWN)
        said = [c["text"] for c in read[1:] if c["type"] == "text"]
        self.assertIn("an SVG, which can't be shown to you", said[0])
        self.assertIn(f"{MAX_SHOWN} pictures given already", said[-1])

    def test_the_panel_uploads_a_picture_and_gets_it_back_only_as_itself(self):
        r = self.app.request(self.inst, "POST", "image", {}, png(9, 4))
        got = json.loads(r.body)
        self.assertEqual((r.status, got["w"], got["h"]), (200, 9, 4))
        r = self.app.request(self.inst, "GET", f"file/{got['file']}", {}, b"")
        self.assertEqual((r.status, r.file["media_type"]), (200, "image/png"))
        self.assertIn("sandbox", r.headers["Content-Security-Policy"])
        self.assertEqual(self.app.request(self.inst, "GET", "file/../figma.json", {}, b"").status, 404)
        r = self.app.request(self.inst, "POST", "image", {}, b"<html>")
        self.assertEqual(r.status, 400)
        self.assertIn("not a picture", json.loads(r.body)["error"])

    def test_pasted_markdown_keeps_a_picture_of_the_notes_and_leaves_another_as_text(self):
        kept = self.app.files.keep(png())["file"]
        r = self.app.request(self.inst, "POST", "parse", {}, json.dumps(
            {"markdown": f"![a](image:{kept})\n![b](/etc/hosts)"}).encode())
        a, b = json.loads(r.body)["blocks"]
        self.assertEqual((a["type"], a["file"]), ("image", kept))
        self.assertEqual((b["type"], b["text"]), ("text", "![b](/etc/hosts)"))

    def test_a_figma_link_becomes_a_frame_and_its_snapshot_is_fetched_with_the_token(self):
        self.app.figma = media.Figma(os.path.join(self.dir, "data"), fake_figma([
            ("/v1/me", (200, b'{"handle": "sam"}')),
            ("/files/Xk2abcdEF9/nodes", (200, json.dumps({"name": "Paper figures", "lastModified": "T1", "nodes": {
                "12:34": {"document": {"name": "Pipeline overview"}}}}).encode())),
            ("/images/Xk2abcdEF9", (200, b'{"images": {"12:34": "https://cdn.figma.test/p.png"}}')),
            ("cdn.figma.test", (200, png(80, 40)))], self.asked))
        self.assertEqual(self.app.figma.set_token(" figd_x "), {"who": "sam"})
        self.assertEqual(json.loads(self.app.request(self.inst, "GET", "figma", {}, b"").body),
                         {"token": True, "who": "sam"})
        self.call("add", title="Figures", markdown=FIGMA)
        self.settle()
        fig = self.blocks()[0]
        self.assertEqual((fig["type"], fig["title"], fig["w"], fig["h"], fig["snap_mod"]),
                         ("figma", "Pipeline overview", 80, 40, "T1"))
        self.assertIn("ids=12%3A34&format=png&scale=2", self.asked[2][0])
        self.assertEqual(self.asked[1][1]["X-Figma-Token"], "figd_x")
        self.assertTrue(self.host.told[-1].get("quiet"))
        read = self.call("read", page="Figures").content
        self.assertIn("[Figma: Pipeline overview](", read[0]["text"])
        self.assertEqual(read[1]["text"], f"[{fig['id']}] the Figma frame's snapshot: Pipeline overview")
        n = len(self.asked)                                       # unchanged in Figma: no new picture asked for
        self.assertEqual(self.app.snap(self.inst, fig["id"]), {"ok": True})
        self.assertEqual(len(self.asked), n + 1)
        self.assertEqual(self.blocks()[0]["snap"], fig["snap"])

    def test_without_a_token_a_public_files_cover_is_its_snapshot_and_a_private_one_says_why(self):
        self.app.figma = media.Figma(os.path.join(self.dir, "data"), fake_figma([
            ("oembed?url=https%3A%2F%2Fwww.figma.com%2Fboard%2FPub", (200, json.dumps({
                "title": "Sketches", "thumbnail_url": "https://cdn.figma.test/t.png"}).encode())),
            ("cdn.figma.test", (200, png(16, 9)))], self.asked))
        self.call("add", title="Figures", markdown="https://www.figma.com/board/Pub1234567/S\n" + FIGMA)
        self.settle()
        pub, private = self.blocks()
        self.assertEqual((pub["title"], pub["w"]), ("Sketches", 16))
        self.assertEqual((private["title"], private.get("snap")), ("Paper figures", None))
        self.assertIn("isn't public", self.app.snap(self.inst, private["id"])["error"])
        self.assertFalse(any("X-Figma-Token" in h for _, h in self.asked))

    def test_a_token_figma_refuses_is_not_kept(self):
        self.app.figma = media.Figma(os.path.join(self.dir, "data"), fake_figma([("/v1/me", (403, b"{}"))], []))
        with self.assertRaises(media.MediaError):
            self.app.figma.set_token("bad")
        self.assertEqual(self.app.figma.token(), "")
        r = self.app.request(self.inst, "POST", "figma/token", {}, b'{"token": "bad"}')
        self.assertEqual(r.status, 400)
        self.assertIn("refused that token", json.loads(r.body)["error"])


if __name__ == "__main__":
    unittest.main()
