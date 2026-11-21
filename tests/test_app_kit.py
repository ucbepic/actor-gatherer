"""app_kit: the contract an app plugs into a host by -- its manifest, its backend and what the host gives it, and the
same calls over HTTP for an app in a process of its own (app_kit/DESIGN.md). Its events are ag's: event types and
properties are ag.ag_interface's own."""
import ast
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app_kit  # noqa: E402
from ag.ag_interface import EventType, Property  # noqa: E402
from app_kit import (App, AppError, Caller, Host, Instance, ManifestError, Response, ToolResult, remote)  # noqa: E402

FULL = """
name = "notes"
label = "Notes"
version = "1.2.0"
description = "A note pad agents and the user share."
instances = "per-folder"
instructions_file = "instructions.md"

[backend]
python = "notes_app:NotesApp"

[panel]
entry = "panel/index.html"

[[tools]]
name = "add"
description = "Add a note."
input_schema = { type = "object", properties = { text = { type = "string" } }, required = ["text"] }

[[tools]]
name = "pick"
description = "The note the user has picked in the panel."
handled_by = "panel"

[[events]]
name = "notes.added"
properties = ["by", { name = "note", required = true, identifies = true }]
description = "A note was added."

[[pollers]]
name = "inbox"
file = "pollers.py"
class = "InboxPoller"
args = { root = "{cwd}" }

[[handles]]
intent = "open-file"
types = ["text/markdown", "text/*"]

[[links]]
form = "note/<id>"
about = "A note: its id from notes_add. Add #<line> for one line of it."

[[links]]
form = "file/<path...>"

[capabilities]
reads = ["tool_call"]
files = true
"""


def app_folder(toml: str = FULL, files=("panel/index.html", "instructions.md", "pollers.py")) -> str:
    folder = tempfile.mkdtemp()
    for rel in files:
        os.makedirs(os.path.dirname(os.path.join(folder, rel)) or folder, exist_ok=True)
        with open(os.path.join(folder, rel), "w") as fh:
            fh.write("Use notes_add to keep a note.\n" if rel == "instructions.md" else "")
    with open(os.path.join(folder, "app.toml"), "w") as fh:
        fh.write(toml)
    return folder


def without(toml: str, block: str) -> str:
    assert block in toml, block
    return toml.replace(block, "")


class PanelKitTest(unittest.TestCase):
    """The panels' kit (js/kit.js, at /_ag/lib/kit.js): served by the host, loaded before each panel's own script,
    and its `el` what each panel builds with. A panel built on app_kit.fileedit (Files, LaTeX), and Notes, loads its
    code as one ES module, its own, which imports the rest: after the kit and the SDK, which it reads as globals."""
    ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    def test_it_is_served_and_every_panel_that_builds_with_it_loads_it_first(self):
        from ag_dashboard import libs
        body, kind = libs.lib_file("kit.js")
        self.assertIn(b"window.agKit", body)
        self.assertTrue(kind.startswith("text/javascript"))
        body, kind = libs.lib_file("kit.css")              # its colours: the theme's, light and dark
        self.assertIn(b'[data-ag-theme="dark"]', body)
        self.assertTrue(kind.startswith("text/css"))
        for app in ("browser", "files", "latex", "notes", "paper_news", "slack"):
            with self.subTest(app=app):
                with open(os.path.join(self.ROOT, "ag_apps", app, "panel", "index.html"), encoding="utf-8") as fh:
                    page = fh.read()
                self.assertLess(page.index('src="/_ag/lib/kit.js"'), page.index('src="/_ag/app.js"'))
                first_sheet = page.index('<link rel="stylesheet"')        # the kit's colours, before its own
                self.assertEqual(first_sheet, page.index('<link rel="stylesheet" href="/_ag/lib/kit.css">'))
                if app in ("files", "latex", "notes"):
                    entry = f'<script type="module" src="{app}.js"></script>'
                    self.assertLess(page.index('src="/_ag/app.js"'), page.index(entry))
                    # (marked,) DOMPurify, the kit, the SDK, its own
                    self.assertEqual(page.count("<script"), 4 if app == "notes" else 5)

    def test_el_sets_what_it_is_given_and_leaves_out_what_is_not(self):
        if not shutil.which("node"):
            self.skipTest("no node here")
        script = textwrap.dedent("""
            class Node { constructor() { this.attrs = {}; this.kids = []; } setAttribute(k, v) { this.attrs[k] = String(v); }
              addEventListener(k) { this.attrs["on:" + k] = true; } append(k) { this.kids.push(k instanceof Node ? "<node>" : k); } }
            class Input extends Node { constructor() { super(); this.value = ""; } }
            const document = { createElement: (t) => (t === "input" ? new Input() : new Node()) };
            const window = {};
            %s
            const { el } = window.agKit;
            const a = el("button", { class: "b", hidden: false, disabled: true, title: null, "aria-pressed": "false",
                                     onclick: () => {}, text: "Go" }, "x", null, false, [el("i"), ["y"]]);
            const i = el("input", { value: "v", checked: true });
            const j = el("input", { checked: "" }), k = el("input", { checked: 0 });
            console.log(JSON.stringify({ a: [a.className, a.textContent, a.attrs, a.kids],
                                         i: [i.value, i.checked, i.attrs], j: [j.checked, k.checked] }));
        """)
        with open(os.path.join(self.ROOT, "app_kit", "js", "kit.js"), encoding="utf-8") as fh:
            script %= fh.read()
        got = json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)
        self.assertEqual(got["a"], ["b", "Go", {"disabled": "", "aria-pressed": "false", "on:click": True},
                                    ["x", "<node>", "y"]])
        self.assertEqual(got["i"], ["v", True, {}])
        self.assertEqual(got["j"], [True, False])            # "" as a present attribute (`cond ? "" : null`)


class SeparateTest(unittest.TestCase):
    def test_it_imports_the_standard_library_and_ag_s_contract_only(self):
        root = os.path.dirname(app_kit.__file__)
        for name in os.listdir(root):
            if not name.endswith(".py"):
                continue
            with open(os.path.join(root, name)) as fh:
                tree = ast.parse(fh.read())
            for node in ast.walk(tree):
                mods = [a.name for a in node.names] if isinstance(node, ast.Import) else \
                    [node.module or ""] if isinstance(node, ast.ImportFrom) and not node.level else []
                for m in mods:
                    if m.split(".")[0] == "ag":
                        self.assertTrue(m == "ag.ag_interface" or m.startswith("ag.ag_interface."),
                                        f"{name} imports {m}: of ag, only its contract")
                    else:
                        self.assertIn(m.split(".")[0], sys.stdlib_module_names, f"{name} imports {m}")


class ManifestTest(unittest.TestCase):
    def test_a_full_manifest_reads_as_written(self):
        folder = app_folder()
        m = app_kit.load(folder)
        self.assertEqual((m.name, m.label, m.version, m.instances), ("notes", "Notes", "1.2.0", "per-folder"))
        self.assertEqual(m.instructions, "Use notes_add to keep a note.\n")
        self.assertEqual(m.backend.python, "notes_app:NotesApp")
        self.assertEqual(m.panel_path(), os.path.join(os.path.abspath(folder), "panel/index.html"))
        self.assertEqual([t.name for t in m.tools], ["add", "pick"])
        self.assertEqual(m.tool("pick").handled_by, "panel")
        self.assertEqual(m.tool("pick").input_schema, {"type": "object", "properties": {}})
        self.assertEqual(m.events[0], EventType("notes.added", (Property("by"),
                                                                 Property("note", required=True, identifies=True))))
        self.assertEqual(m.pollers[0].catalog(m.folder),
                         {"class": "InboxPoller", "args": {"root": "{cwd}"},
                          "file": os.path.join(m.folder, "pollers.py")})
        self.assertEqual(m.capabilities.reads, ("tool_call",))
        self.assertTrue(m.capabilities.files)
        self.assertEqual(len(m.capabilities.asked()), 2)
        json.dumps(m.to_dict())                                   # all of it is JSON

    def test_a_tool_as_agents_see_it_carries_the_app_s_name(self):
        m = app_kit.load(app_folder())
        self.assertEqual(m.tool("add").mcp("notes")["name"], "notes_add")
        self.assertEqual(m.tool("add").mcp("notes")["inputSchema"]["required"], ["text"])
        self.assertIn("instance", m.tool("add").mcp("notes")["inputSchema"]["properties"])     # the host's
        self.assertEqual(m.tool("add").mcp("notes", "Notes")["description"], "Notes: Add a note.")
        self.assertNotIn("instance", m.tool("add").input_schema["properties"])                  # not the manifest's
        self.assertEqual(app_kit.split_tool_name("notes_add", ["notes", "browser"]), ("notes", "add"))
        self.assertEqual(app_kit.split_tool_name("my_app_go", ["my", "my_app"]), ("my_app", "go"))
        self.assertIsNone(app_kit.split_tool_name("other_go", ["notes"]))
        self.assertIsNone(app_kit.split_tool_name("notes_", ["notes"]))

    def test_its_event_types_as_ag_registers_them_carry_the_host_s_properties_first(self):
        types = app_kit.load(app_folder()).event_types()
        self.assertEqual([p.name for p in types[0].properties], ["app", "instance", "channel", "by", "note"])
        self.assertTrue(types[0].properties[0].required)              # app
        self.assertTrue(types[0].properties[2].identifies)            # channel, as on every type of ag's
        self.assertEqual({t.name for t in app_kit.HOST_TYPES}, set(app_kit.HOST_RECORDS))

    def test_what_it_may_insert_and_read(self):
        m = app_kit.load(app_folder())
        self.assertTrue(m.may_insert("notes.added"))
        self.assertTrue(m.may_insert("context_stream"))
        self.assertFalse(m.may_insert("notes.removed"))           # not declared
        self.assertFalse(m.may_insert("user_message"))
        self.assertFalse(m.may_insert("app_attached"))            # the host's own
        self.assertTrue(m.may_read("notes.anything"))
        self.assertTrue(m.may_read("app_attached"))
        self.assertTrue(m.may_read("tool_call"))                  # asked for
        self.assertFalse(m.may_read("user_message"))

    def test_an_intent_by_media_type(self):
        h = app_kit.load(app_folder()).handles[0]
        self.assertTrue(h.takes("open-file", "text/markdown"))
        self.assertTrue(h.takes("open-file", "text/x-python"))
        self.assertFalse(h.takes("open-file", "application/pdf"))
        self.assertFalse(h.takes("open-url"))
        self.assertTrue(app_kit.Handles("open-file").takes("open-file", "application/pdf"))

    def test_a_panel_only_app_with_no_backend(self):
        toml = without(FULL, '[backend]\npython = "notes_app:NotesApp"\n')
        toml = toml.replace('description = "Add a note."', 'description = "Add a note."\nhandled_by = "panel"')
        m = app_kit.parse(__import__("tomllib").loads(toml))       # no folder: its files are not looked for
        self.assertIsNone(m.backend.python)
        self.assertEqual({t.handled_by for t in m.tools}, {"panel"})

    def refused(self, toml: str, says: str, files=("panel/index.html", "instructions.md", "pollers.py")):
        with self.assertRaises(ManifestError) as ctx:
            app_kit.load(app_folder(toml, files))
        self.assertIn(says, str(ctx.exception))
        self.assertIn("app.toml", str(ctx.exception))

    def test_what_a_manifest_may_not_say(self):
        self.refused(FULL.replace('name = "notes"', 'name = "Notes"'), "name: 'Notes'")
        self.refused(FULL.replace('name = "notes"', 'name = "x"\nhomepage = "y"'), "homepage: not a key here")
        self.refused(FULL.replace('instances = "per-folder"', 'instances = "two"'), "instances: 'two'")
        self.refused(FULL.replace('name = "notes.added"', 'name = "added"'), "events[0].name")
        self.refused(FULL.replace('properties = ["by",', 'properties = ["channel",'), "is the host's")
        self.refused(FULL.replace('properties = ["by",', 'properties = ["9by",'), "properties[0].name")
        self.refused(FULL.replace('required = true', 'required = "yes"'), "properties[1].required")
        self.refused(FULL.replace('properties = ["by",', 'properties = ["note",'), "a property named twice")
        self.refused(FULL.replace('name = "pick"', 'name = "add"'), "'add' twice")
        self.refused(FULL.replace('name = "pick"', 'name = "' + "p" * 60 + '"'), "longer than 64")
        self.refused(FULL.replace('intent = "open-file"', 'intent = "open-door"'), "'open-door'")
        self.refused(FULL.replace('intent = "open-file"', 'intent = "open-url"'), "for open-file only")
        self.refused(FULL.replace("files = true", "network = true"), "capabilities.network: not a key here")
        self.refused(FULL.replace('python = "notes_app:NotesApp"', 'python = "notes_app"'), "\"module:Class\"")
        self.refused(FULL.replace('python = "notes_app:NotesApp"', 'python = "a:B"\ncommand = ["x"]'), "not both")
        self.refused(FULL.replace('instructions_file = "instructions.md"',
                                  'instructions = "hi"\ninstructions_file = "instructions.md"'), "not both")
        self.refused(FULL.replace('input_schema = { type = "object",', 'input_schema = { type = "array",'),
                     "input_schema")
        self.refused(FULL.replace('text = { type = "string" }', 'instance = { type = "string" }'), "the host's argument")
        self.refused(FULL, "panel.entry: panel/index.html: no such file", files=("instructions.md", "pollers.py"))
        self.refused(FULL, "pollers[0].file: pollers.py: no such file", files=("panel/index.html", "instructions.md"))
        self.refused(FULL.replace('entry = "panel/index.html"', 'entry = "../elsewhere.html"'),
                     "is outside the app's folder")
        self.refused(FULL.replace('entry = "panel/index.html"', 'entry = "/etc/hosts"'), "not an absolute one")
        self.refused(FULL.replace("[[pollers]]", "[[pollers]]").replace('class = "InboxPoller"', 'class = "a.B"'),
                     "pollers[0].class")
        self.refused("name = 3", "name: a string, not int")
        self.refused("name = \"x\"\nname2 = ", "app.toml:")             # not TOML

    def test_what_adding_it_to_an_actor_or_a_task_does(self):
        """`on_task`: a task app joins the task unless it says otherwise; a group app, in no task, is not added unless it
        says "folder" -- and can't say "join"."""
        parse = app_kit.parse
        self.assertEqual(parse({"name": "x"}).on_task, "join")
        self.assertEqual(parse({"name": "x", "access": "group"}).on_task, "no")
        self.assertEqual(parse({"name": "x", "access": "group", "on_task": "folder"}).on_task, "folder")
        self.assertEqual(parse({"name": "x", "on_task": "no"}).to_dict()["on_task"], "no")      # as the page reads it
        self.refused(FULL.replace('instances = "per-folder"', 'instances = "per-folder"\non_task = "beside"'),
                     "on_task: 'beside'")
        self.refused(FULL.replace('instances = "per-folder"', 'instances = "per-folder"\naccess = "group"\n'
                                  'on_task = "join"'), "is in no task")

    def test_a_tool_the_backend_handles_needs_a_backend_and_a_panel_tool_a_panel(self):
        self.refused(without(FULL, '[backend]\npython = "notes_app:NotesApp"\n'), "tools[0].handled_by")
        no_panel = without(FULL, '[panel]\nentry = "panel/index.html"\n')
        self.refused(no_panel, "tools[1].handled_by")
        self.refused(no_panel.replace('handled_by = "panel"\n', ""), "handles: an app handles intents in its panel")

    def test_no_such_folder(self):
        with self.assertRaises(ManifestError):
            app_kit.load(os.path.join(tempfile.mkdtemp(), "nothing"))


class LinksTest(unittest.TestCase):
    """Links to things in apps, `ag://<app>/<path>`: an app's [[links]] forms, read, matched and told to agents."""

    def test_its_forms_match_paths_and_hand_back_their_values_decoded(self):
        m = app_kit.load(app_folder())
        self.assertEqual([k.form for k in m.links], ["note/<id>", "file/<path...>"])
        self.assertEqual(m.link("note/a1b2")[1], {"id": "a1b2"})
        self.assertEqual(m.link("note/a%20b")[1], {"id": "a b"})
        self.assertIsNone(m.link("note/a1/b2"))                    # <id> is one segment
        self.assertIsNone(m.link("note/"))
        self.assertIsNone(m.link("notes/a1"))
        self.assertEqual(m.link("file//Users/x/a%20b.py")[1], {"path": "/Users/x/a b.py"})   # <path...>: the rest
        self.assertEqual(m.link("file/src/a.py")[0].form, "file/<path...>")
        self.assertEqual(m.to_dict()["links"][0], {"form": "note/<id>",
                                                   "about": "A note: its id from notes_add. Add #<line> for one line of it."})

    def test_a_link_read_and_written(self):
        h = app_kit.links.parse("ag://notes/note/a1b2?instance=i9#l%203")
        self.assertEqual((h.app, h.path, h.part, h.instance), ("notes", "note/a1b2", "l 3", "i9"))
        self.assertEqual(app_kit.links.parse("ag://notes").path, "")
        for no in ("https://x.org/a", "ag:notes/x", "ag://Notes/x", "ag://9x/y", "page:abc123", "", None):
            self.assertIsNone(app_kit.links.parse(no), no)
        made = app_kit.links.href("notes", "file//Users/x/a b.py", part="L12", instance="i9")
        self.assertEqual(made, "ag://notes/file//Users/x/a%20b.py?instance=i9#L12")
        back = app_kit.links.parse(made)
        self.assertEqual(app_kit.load(app_folder()).link(back.path)[1], {"path": "/Users/x/a b.py"})

    def test_agents_are_told_each_form_after_the_app_s_instructions(self):
        m = app_kit.load(app_folder())
        told = m.told()
        self.assertTrue(told.startswith("Use notes_add to keep a note."))
        self.assertIn("`[its name](ag://notes/note/<id>)`, in one of these forms", told)
        self.assertIn("- `ag://notes/note/<id>`: A note: its id from notes_add.", told)
        self.assertIn("- `ag://notes/file/<path...>`", told)
        self.assertIn("`?instance=<its id>`", told)                # several Notes may be open: per-folder
        one = app_kit.parse({"name": "x", "instances": "one", "panel": {"entry": "i.html"},
                             "links": [{"form": "a/<b>"}]})
        self.assertNotIn("?instance=", one.told())
        self.assertEqual(app_kit.parse({"name": "x"}).told(), "")

    def test_a_form_it_may_not_have(self):
        refused = ManifestTest.refused
        for form, says in (("", "none empty"), ("/note/<id>", "none empty"), ("note/<id>/", "none empty"),
                           ("note//<id>", "none empty"), ("note/<id>/<id>", "<id> twice"),
                           ("<rest...>/x", "comes last"), ("note/<Id>", "neither a word"), ("a b", "neither a word")):
            refused(self, FULL.replace('form = "note/<id>"', f"form = {json.dumps(form)}"), f"links[0].form: ")
            with self.assertRaises(ValueError) as ctx:
                app_kit.links.form(form)
            self.assertIn(says, str(ctx.exception))
        refused(self, FULL.replace('form = "file/<path...>"', 'form = "note/<id>"'), "links: a form given twice")
        refused(self, FULL.replace('form = "note/<id>"', 'form = "note/<id>"\nopens = "x"'), "links[0].opens: not a key")
        refused(self, without(FULL, '[panel]\nentry = "panel/index.html"\n').replace('handled_by = "panel"\n', "")
                .replace('[[handles]]\nintent = "open-file"\ntypes = ["text/markdown", "text/*"]\n', ""),
                "links: an app opens links in its panel")


class EventsTest(unittest.TestCase):
    """What an app inserts for agents, in the shapes ag's policies read (proactive_context_manager/events.py)."""

    def test_a_context_stream_and_an_environment_update_as_ag_makes_them(self):
        c = app_kit.context_stream("Notes", "the user", "pinned it", timestamp=5.0, id="p1")
        self.assertEqual(c, {"type": "context_stream", "id": "p1", "text": "the user in Notes: pinned it",
                             "payload": {"stream": "Notes", "author": "the user", "text": "pinned it", "timestamp": 5.0}})
        u = app_kit.environment_update("/w/a.md", "saved by the user", source="notes")
        self.assertEqual((u["text"], u["payload"]["source"]), ("/w/a.md: saved by the user", "notes"))
        self.assertIsInstance(u["payload"]["timestamp"], float)               # now, where none was given

    def test_what_is_not_in_the_shape(self):
        for bad in ({"type": "notes.x", "payload": {}}, {"type": "context_stream", "payload": "x"},
                    {"type": "context_stream", "payload": {"stream": "", "author": "a", "text": "t"}},
                    {"type": "environment_update", "payload": {"subject": "s", "what": 3}}):
            with self.assertRaises(ValueError):
                app_kit.events.checked(bad)


class MemoryHost(Host):
    """A host that keeps everything in lists: what the app inserts, and what it told its panels."""

    def __init__(self):
        self.inserted, self.told, self.channels = [], [], {"i1": ["chan-a"]}

    def insert(self, instance, events, channel=None):
        if any(e["type"] == "user_message" for e in events):
            raise AppError("user_message: not an app's to insert", 403)
        self.inserted.append((instance.id, events, channel))

    def read(self, instance, types, after=0, channel=None, limit=500):
        rows = [{"row_id": n + 1, "type": e["type"], "payload": e["payload"], "text": None, "properties": {}}
                for n, (_, evs, _) in enumerate(self.inserted) for e in evs]
        return [r for r in rows if r["type"] in types and r["row_id"] > after][:limit]

    def attached(self, instance):
        return self.channels.get(instance.id, [])

    def tell_panel(self, instance, message):
        self.told.append((instance.id, message))

    def folder(self):
        return "/tmp/notes-data"

    def instances(self):
        return [Instance("i1", "notes", "g")]


class NotesApp(App):
    """A toy app: `add` keeps a note as an event and tells the panel; `fail` refuses; its panel asks for /count."""

    def open(self, instance, args):
        return Instance(**{**instance.to_dict(), "title": args.get("title", "Notes"), "data": {"n": 0}})

    def call(self, instance, tool, args, caller):
        if tool == "add":
            self.host.insert(instance, [{"type": "notes.added", "payload": {"text": args["text"],
                                                                             "by": caller.channel}}])
            self.host.tell_panel(instance, {"added": args["text"]})
            return ToolResult.text(f"kept; agents here: {', '.join(self.host.attached(instance))}")
        if tool == "user":
            self.host.insert(instance, [{"type": "user_message", "payload": {}}])
        if tool == "fail":
            raise AppError("no", 409)
        return ToolResult.error(f"{tool}?")

    def sleep(self, instance):
        self.host.tell_panel(instance, {"slept": True})

    def request(self, instance, method, path, query, body):
        if path == "count":
            return Response.json({"n": len(self.host.read(instance, ["notes.added"])), "echo": body.decode()})
        return Response(404, b"\xff\x00raw")


class RemoteTest(unittest.TestCase):
    """An app served over HTTP, called as RemoteApp: each App method the same, both ways."""

    def setUp(self):
        self.host, self.token = MemoryHost(), remote.new_token()
        self.srv, url = remote.serve(NotesApp(), self.host, self.token)
        self.addCleanup(remote.close, self.srv)
        self.app = remote.RemoteApp(url, self.token)
        self.i = Instance("i1", "notes", "g", folder="/work")

    def test_open_call_and_request_through_http(self):
        opened = self.app.open(self.i, {"title": "Mine"})
        self.assertEqual((opened.id, opened.folder, opened.title, opened.data), ("i1", "/work", "Mine", {"n": 0}))
        got = self.app.call(self.i, "add", {"text": "buy milk"}, Caller(channel="chan-a", gatherer="g"))
        self.assertEqual(got.content, [{"type": "text", "text": "kept; agents here: chan-a"}])
        self.assertFalse(got.is_error)
        self.assertEqual(self.host.inserted, [("i1", [{"type": "notes.added",
                                                        "payload": {"text": "buy milk", "by": "chan-a"}}], None)])
        self.assertEqual(self.host.told, [("i1", {"added": "buy milk"})])
        r = self.app.request(self.i, "GET", "count", {}, b"hello")
        self.assertEqual((r.status, json.loads(r.body)), (200, {"n": 1, "echo": "hello"}))
        self.assertEqual(self.app.request(None, "GET", "nope", {}, b"").body, b"\xff\x00raw")   # bytes kept

    def test_an_instance_put_to_sleep_through_http(self):
        self.app.sleep(self.i)
        self.assertEqual(self.host.told, [("i1", {"slept": True})])
        App.sleep(App(), self.i)                                  # an app with nothing running for it: nothing to do

    def test_refusals_come_back_as_app_errors(self):
        self.assertTrue(self.app.call(self.i, "what", {}, Caller()).is_error)
        with self.assertRaises(AppError) as ctx:
            self.app.call(self.i, "fail", {}, Caller())
        self.assertEqual((str(ctx.exception), ctx.exception.status), ("no", 409))
        with self.assertRaises(AppError) as ctx:                  # the host's refusal reaches the app as its own
            self.app.call(self.i, "user", {}, Caller())
        self.assertIn("not an app's to insert", str(ctx.exception))

    def test_a_caller_without_the_token_is_refused(self):
        bad = remote.RemoteApp(self.app.url, "not-the-token")
        with self.assertRaises(AppError) as ctx:
            bad.call(self.i, "add", {"text": "x"}, Caller())
        self.assertEqual(ctx.exception.status, 401)
        self.assertEqual(self.host.inserted, [])

    def test_the_host_served_to_an_app(self):
        srv, url = remote.serve_host(self.host, Instance.from_dict, self.token)
        self.addCleanup(remote.close, srv)
        h = remote.RemoteHost(url, self.token, "/data")
        h.insert(self.i, [{"type": "notes.added", "payload": {"text": "a"}}], channel="chan-a")
        self.assertEqual(self.host.inserted[-1][2], "chan-a")
        self.assertEqual([e["payload"]["text"] for e in h.read(self.i, ["notes.added"])], ["a"])
        self.assertEqual(h.attached(self.i), ["chan-a"])
        h.tell_panel(self.i, {"x": 1})
        self.assertEqual(self.host.told[-1], ("i1", {"x": 1}))
        self.assertEqual([i.id for i in h.instances()], ["i1"])
        self.assertEqual(h.folder(), "/data")
        with self.assertRaises(AppError):
            remote.RemoteHost(url, "wrong", "/data").attached(self.i)


class LaunchTest(unittest.TestCase):
    """An app in a process of its own, started as the host starts one: `python -m app_kit.remote module:Class` in
    its folder, which prints its URL; then stopped."""

    def test_launch_call_and_stop(self):
        folder = tempfile.mkdtemp()
        with open(os.path.join(folder, "notes_app.py"), "w") as fh:
            fh.write(textwrap.dedent("""
                from app_kit import App, ToolResult

                class NotesApp(App):
                    def call(self, instance, tool, args, caller):
                        self.host.insert(instance, [{"type": "notes.added", "payload": args}])
                        return ToolResult.text(f"{tool} in {self.host.folder()}")
            """))
        host, token = MemoryHost(), remote.new_token()
        srv, host_url = remote.serve_host(host, Instance.from_dict, token)
        self.addCleanup(remote.close, srv)
        root = os.path.dirname(os.path.dirname(os.path.abspath(app_kit.__file__)))
        env = dict(os.environ, PYTHONPATH=root)
        app = remote.launch([sys.executable, "-m", "app_kit.remote", "notes_app:NotesApp"], folder, host_url, token,
                            "/data/notes", env=env)
        try:
            got = app.call(Instance("i1", "notes", "g"), "add", {"text": "hi"}, Caller())
            self.assertEqual(got.content[0]["text"], "add in /data/notes")
            self.assertEqual(host.inserted, [("i1", [{"type": "notes.added", "payload": {"text": "hi"}}], None)])
        finally:
            app.stop()
        self.assertIsNotNone(app.process.wait(10))

    def test_a_command_that_prints_no_url_is_refused(self):
        with self.assertRaises(AppError) as ctx:
            remote.launch([sys.executable, "-c", "print('hello')"], tempfile.mkdtemp(), "http://127.0.0.1:1", "t",
                          "/d", wait=10)
        self.assertIn("printed no", str(ctx.exception))
        self.assertIn("hello", str(ctx.exception))

    def test_main_needs_the_host_s_variables(self):
        env = {k: v for k, v in os.environ.items() if k not in (remote.HOST_ENV, remote.TOKEN_ENV, remote.DATA_ENV)}
        root = os.path.dirname(os.path.dirname(os.path.abspath(app_kit.__file__)))
        done = subprocess.run([sys.executable, "-m", "app_kit.remote", "a:B"], env=dict(env, PYTHONPATH=root),
                              capture_output=True, text=True, timeout=30)
        self.assertEqual(done.returncode, 2)
        self.assertIn("the host starts an app", done.stderr)


if __name__ == "__main__":
    unittest.main()
