"""A Browser in the dashboard (ag_dashboard/browser.py): which Chrome it runs, what its actor is started with, the
user's message with what they did and picked, the snapshot's outline, the keys and addresses it takes, the server's
/browser/w/<key>/ routes -- and, where a Chrome is installed, the whole of it against a real one: the agent's tools,
the user's input and picks (also on a page asking for a passkey), the screen streamed, its tabs opened again after
the Chrome stopped."""
import base64
import functools
import http.server
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ag_dashboard import browser, home as dashboard_home, mcp, sessions  # noqa: E402

PAGE = """<!doctype html><title>Shop checkout</title>
<div class="card"><h1>Checkout</h1>
<label>Email <input id="email" type="email"></label>
<label>Password <input id="pw" type="password" value="hunter2"></label>
<label>Size <select id="size"><option value="s">Small</option><option value="l">Large</option></select></label>
<button data-testid="pay" onclick="document.getElementById('out').textContent = 'paid ' + email.value + ' ' + size.value">Pay $42.00</button>
<button onclick="alert('Are you sure?')">Warn me</button>
<a href="two.html">Next page</a> <a href="two.html" target="_blank">New tab</a>
<p id="out">not paid</p></div>"""


PASSKEY = """<!doctype html><title>Use Touch ID</title>
<button onclick="out.textContent = 'other options'">Other options</button> <p id="out">waiting</p>
<script>
const key = {challenge: new Uint8Array(32), timeout: 60000};
window.asked = window.made = 'waiting';
if (!location.search) navigator.credentials.get({publicKey: {...key, userVerification: 'required',
    allowCredentials: [{type: 'public-key', id: new Uint8Array(16), transports: ['internal']}]}})
  .then(() => asked = 'given', (e) => asked = e.name);
</script>"""
# A text box, and a frame like Google Docs': the focus in it, no selection a script can read, its app filling the
# clipboard itself on a copy and taking what is pasted from the paste's own data.
CLIP = """<!doctype html><title>Clipboard</title><textarea id="t">plain text here</textarea>
<iframe id="f" src="clip-frame.html"></iframe><script>window.log = [];</script>"""
CLIP_FRAME = """<!doctype html><div id="e" contenteditable></div><script>
document.addEventListener('copy', (ev) => { ev.clipboardData.setData('text/plain', "the app's words");
  ev.clipboardData.setData('text/html', "<b>the app's</b> words"); ev.preventDefault(); });
document.addEventListener('paste', (ev) => { parent.log.push(ev.clipboardData.getData('text/plain') + ' | ' +
  ev.clipboardData.getData('text/html')); ev.preventDefault(); });
</script>"""


WIDGETS = """<!doctype html><title>Widgets</title>
<style>body{margin:0;font:16px sans-serif} .r{position:absolute;left:20px;margin:0}</style>
<select class=r id=size aria-label=Size style="top:20px;width:160px"><optgroup label=Small><option>Tiny</option>
<option>Small</option></optgroup><option disabled>Medium</option><option>Large</option></select>
<input class=r id=day type=date style="top:70px;width:180px">
<input class=r id=hue type=color style="top:120px">
<button class=r id=tip title="Saves the draft" style="top:170px">Save</button>
<input class=r id=up type=file style="top:220px">
<a class=r id=go href="two.html" style="top:270px">A link</a>
<p class=r id=words style="top:300px">Some words to point at</p>
<div class=r id=grab style="top:340px;width:100px;height:30px;cursor:grab">grab</div>
<div class=r id=own style="top:380px;width:100px;height:30px" oncontextmenu="event.preventDefault()">its own menu</div>
<div class=r id=drop style="top:420px;width:200px;height:60px;border:1px dashed">drop here</div>
<a class=r id=dl download="hello.txt" href="data:text/plain,hi" style="top:490px">Download</a>
<p class=r id=out style="top:520px"></p>
<p class=r style="top:560px">apple, Apple and apples</p>
<input class=r id=fruit list=fruits aria-label=Fruit style="top:600px">
<datalist id=fruits><option value=apple><option value=apricot><option value=banana label=Yellow></datalist>
<script>
const log = (s) => document.getElementById('out').textContent += s + ' ';
for (const id of ['size', 'day', 'hue', 'up', 'fruit']) document.getElementById(id).addEventListener('change',
  (e) => log(id + '=' + (e.target.files ? [...e.target.files].map((f) => f.name).join() : e.target.value)));
drop.addEventListener('dragover', (e) => e.preventDefault());
drop.addEventListener('drop', (e) => { e.preventDefault(); log('dropped=' + [...e.dataTransfer.files].map((f) => f.name).join()); });
</script>"""


class Home(unittest.TestCase):
    """A dashboard home of its own, and a folder with a page in it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.saved, dashboard_home.HOME = dashboard_home.HOME, os.path.join(self.tmp.name, "home")
        self.addCleanup(setattr, dashboard_home, "HOME", self.saved)
        os.makedirs(dashboard_home.HOME)
        self.root = os.path.join(os.path.realpath(self.tmp.name), "site")
        os.makedirs(self.root)
        self.write("index.html", PAGE)
        self.write("two.html", "<!doctype html><title>Second page</title><h1>Page two</h1>")

    def write(self, name: str, text: str) -> str:
        path = os.path.join(self.root, name)
        with open(path, "w") as fh:
            fh.write(text)
        return path

    def config(self, text: str) -> None:
        with open(os.path.join(dashboard_home.HOME, "config.toml"), "w") as fh:
            fh.write(text)


class ExecutableTest(Home):
    def test_the_config_names_the_chrome_else_one_installed_is_found(self):
        exe = self.write("chrome", "#!/bin/sh\n")
        os.chmod(exe, 0o755)
        self.config(f'[dashboard]\nbrowser = "{exe}"\n')
        self.assertEqual(browser.executable(), exe)
        self.config('[dashboard]\nbrowser = "/no/such/chrome"\n')
        self.assertIsNone(browser.executable())
        self.assertFalse(browser.available())
        self.config("")
        with mock.patch.object(browser, "APPS", []), mock.patch.object(browser, "COMMANDS", []):
            self.assertIsNone(browser.executable())


class MineTest(Home):
    """Which Chrome: the dashboard's own, or the user's ("mine"), found by the port its DevToolsActivePort names."""

    def test_the_config_says_which(self):
        self.assertEqual(browser.mode(), "own")
        self.config('[dashboard]\nbrowser_profile = "mine"\n')
        self.assertEqual(browser.mode(), "mine")
        with mock.patch.object(browser, "executable", lambda: None):
            self.assertTrue(browser.available())          # the user's Chrome: none of the dashboard's needed

    def test_the_user_s_chrome_is_found_by_its_devtools_active_port(self):
        d = os.path.join(self.tmp.name, "Chrome")
        os.makedirs(d)
        with mock.patch.dict(browser.USER_DIRS, {sys.platform: [os.path.join(self.tmp.name, "none"), d]}):
            self.assertIsNone(browser.devtools_port())
            with open(os.path.join(d, "DevToolsActivePort"), "w") as fh:
                fh.write("9222\n/devtools/browser/abc\n")
            self.assertEqual(browser.devtools_port(), (9222, "/devtools/browser/abc"))

    def test_with_its_debugging_off_the_user_is_told_how_to_turn_it_on(self):
        self.config('[dashboard]\nbrowser_profile = "mine"\n')
        bs = browser.Browsers(sessions.Sessions())
        self.addCleanup(bs.close)
        with mock.patch.dict(browser.USER_DIRS, {sys.platform: [os.path.join(self.tmp.name, "none")]}):
            with self.assertRaisesRegex(browser.BrowserError, "chrome://inspect/#remote-debugging"):
                bs.chrome.cdp()


class RoleTest(unittest.TestCase):
    """What a Browser's actor is: a session whose `role` names its Browser, started with its tools and instructions."""

    def test_a_browser_role_is_known_and_names_its_key(self):
        role = json.dumps({"browser": "0123456789abcdef"})
        self.assertTrue(sessions.known_role(role))
        self.assertEqual(browser.key_of({"role": role}), "0123456789abcdef")
        self.assertIsNone(browser.key_of({"role": json.dumps({"browser": "../etc"})}))
        self.assertIsNone(browser.key_of({"role": "coordinator"}))
        self.assertIsNone(browser.key_of({"role": json.dumps({"docwriter": "0123456789abcdef"})}))

    def test_claude_code_gets_the_mcp_server_and_the_instructions(self):
        with mock.patch.object(browser, "ORIGIN", "http://127.0.0.1:4999"):
            args = sessions.extra_args({"role": json.dumps({"browser": "0123456789abcdef"}), "harness": "claude",
                                        "cwd": "/work"})
        self.assertEqual(args[0], "--mcp-config")
        server = json.loads(args[1])["mcpServers"][browser.NAME]
        self.assertEqual(server, {"type": "http", "url": "http://127.0.0.1:4999/browser/w/0123456789abcdef/mcp"})
        self.assertEqual(args[2], "--append-system-prompt")
        self.assertIn("<browser_state>", args[3])
        self.assertIn("/work", args[3])
        self.assertIn("Click only when there is no other way", args[3])      # dedicated tools first, the page last

    def test_codex_gets_them_as_its_config(self):
        with mock.patch.object(browser, "ORIGIN", "http://127.0.0.1:4999"):
            args = sessions.extra_args({"role": json.dumps({"browser": "0123456789abcdef"}), "harness": "codex", "cwd": "/w"})
        self.assertEqual(args[:2], ["-c", f'mcp_servers.{browser.NAME}.url="http://127.0.0.1:4999/browser/w/0123456789abcdef/mcp"'])
        self.assertTrue(args[3].startswith("developer_instructions="))

    def test_an_actor_like_any_other_gets_nothing(self):
        self.assertEqual(browser.launch_args({"role": None, "harness": "claude"}), [])
        self.assertEqual(sessions.extra_args({"role": "coordinator", "harness": "claude"}), [])


class WordsTest(unittest.TestCase):
    """What the user and the agent type: addresses, keys."""

    def test_an_address_gets_its_scheme(self):
        self.assertEqual(browser._url("example.com/a"), "https://example.com/a")
        self.assertEqual(browser._url("localhost:3000"), "http://localhost:3000")
        self.assertEqual(browser._url("127.0.0.1:8080/x"), "http://127.0.0.1:8080/x")
        self.assertEqual(browser._url("http://a.b"), "http://a.b")
        self.assertEqual(browser._url("/tmp/x.html"), "file:///tmp/x.html")
        with self.assertRaises(browser.BrowserError):
            browser._url("javascript:alert(1)")
        with self.assertRaises(browser.BrowserError):
            browser._url("  ")

    def test_keys_as_chrome_takes_them(self):
        down = browser._key_event({"key": "a", "code": "KeyA", "keyCode": 65}, True, 0)
        self.assertEqual((down["type"], down["text"]), ("keyDown", "a"))
        enter = browser._key_event({"key": "Enter", "code": "Enter", "keyCode": 13}, True, 0)
        self.assertEqual((enter["type"], enter["text"]), ("keyDown", "\r"))
        back = browser._key_event({"key": "Backspace", "code": "Backspace"}, True, 0)
        self.assertEqual((back["type"], back["windowsVirtualKeyCode"]), ("rawKeyDown", 8))
        self.assertNotIn("text", back)
        select_all = browser._key_event({"key": "a", "code": "KeyA", "keyCode": 65}, True, 4)
        self.assertEqual((select_all["type"], select_all["commands"]), ("rawKeyDown", ["selectAll"]))
        redo = browser._key_event({"key": "z", "code": "KeyZ"}, True, 4 | 8)
        self.assertEqual(redo["commands"], ["redo"])
        self.assertEqual(browser._key_event({"key": "a"}, False, 0)["type"], "keyUp")
        self.assertIsNone(browser._key_event({"key": ""}, True, 0))
        alt = browser._key_event({"key": "Alt", "code": "AltLeft", "keyCode": 18, "location": 1}, True, 1)
        self.assertNotIn("nativeVirtualKeyCode", alt)       # one would make macOS beep for a key the page leaves unused


def ax(nid, role, name="", kids=(), parent=None, node=None, value=None, ignored=False, props=None):
    n = {"nodeId": nid, "role": {"value": role}, "name": {"value": name}, "childIds": list(kids), "ignored": ignored}
    if parent:
        n["parentId"] = parent
    if node:
        n["backendDOMNodeId"] = node
    if value is not None:
        n["value"] = {"value": value}
    if props:
        n["properties"] = [{"name": k, "value": {"value": v}} for k, v in props.items()]
    return n


class ShownTest(unittest.TestCase):
    """What UI_JS reports, from a page the dashboard doesn't control, as the view is told it: checked, cut to size."""

    def test_the_pointer_s_shape_is_css_s_its_images_from_the_web_or_data_only(self):
        for ok in ("pointer", "text", "grab", 'url("data:image/png;base64,AAAA") 4 4, pointer',
                   'url("https://x.org/c.svg"), url("https://x.org/c.png") 2 2, default'):
            self.assertEqual(browser._cursor(ok), ok)
        for bad in ('url("javascript:alert(1)"), pointer', 'url("https://x.org/a.png"); color: red', "pointer;", 42, None,
                    'url("data:x,' + "a" * 30_000 + '"), pointer'):
            self.assertEqual(browser._cursor(bad), "default")

    def test_a_list_picker_or_menu_is_cut_to_size_and_its_links_web_ones(self):
        got = browser._popup("select", {"i": 1, "name": "Size" * 50, "box": [1, 2, 3, 4], "options": [
            {"t": "x" * 400, "d": 1, "g": "G"}, "junk", {"t": "y"}] + [{"t": "z"}] * 3000})
        self.assertEqual((len(got["options"]), len(got["options"][0]["t"]), len(got["name"])), (1999, 300, 80))   # 2000 taken, one junk
        self.assertEqual(got["options"][:2], [{"t": "x" * 300, "d": True, "g": "G"}, {"t": "y", "d": False, "g": None}])
        self.assertEqual(browser._popup("select", {"i": "1", "box": [1, 2]})["i"], -1)
        self.assertIsNone(browser._popup("select", {"box": [1, 2]})["box"])
        self.assertEqual(browser._popup("picker", {"type": "evil"})["type"], "date")
        got = browser._popup("suggest", {"options": [{"t": "a" * 400, "l": 5}, {"t": ""}, "junk"] + [{"t": "b"}] * 300})
        self.assertEqual((len(got["options"]), got["options"][0]), (198, {"t": "a" * 300, "l": "5"}))   # 200 taken
        menu = browser._popup("menu", {"link": "javascript:alert(1)", "img": "https://x.org/a.png", "at": [1, 2]})
        self.assertEqual((menu["link"], menu["img"], menu["at"]), ("", "https://x.org/a.png", [1.0, 2.0]))


class OutlineTest(unittest.TestCase):
    """The snapshot's outline of Chrome's accessibility tree."""

    def test_wrappers_go_their_insides_stay_and_each_element_has_a_ref(self):
        nodes = [ax("1", "RootWebArea", "Shop", ["2", "3", "9"], node=1),
                 ax("2", "heading", "Checkout", ["21"], "1", 2, props={"level": 1}),
                 ax("21", "StaticText", "Checkout", [], "2"),
                 ax("3", "generic", "", ["4"], "1", 3),
                 ax("4", "LabelText", "", ["41", "5"], "3", 4),
                 ax("41", "StaticText", "Email", [], "4"),
                 ax("5", "textbox", "Email", ["51"], "4", 5, value="me@x"),
                 ax("51", "StaticText", "me@x", [], "5"),
                 ax("9", "button", "Pay", ["91"], "1", 9, props={"focused": True, "disabled": False}),
                 ax("91", "StaticText", "Pay", [], "9")]
        refs = {}
        lines = browser._outline(nodes, lambda n: refs.setdefault(n, f"e{len(refs) + 1}"))
        self.assertEqual(lines, ['- heading "Checkout" [e1] (level=1)',
                                 '- textbox "Email" [e2]: "me@x"',
                                 '- button "Pay" [e3] (focused)'])

    def test_a_part_of_the_page(self):
        nodes = [ax("1", "RootWebArea", "", ["2"], node=1), ax("2", "list", "", ["3"], "1", 2),
                 ax("3", "listitem", "", ["31"], "2", 3), ax("31", "StaticText", "one", [], "3")]
        self.assertEqual(browser._outline(nodes, lambda n: f"e{n}", start=2),
                         ["- list [e2]", "  - listitem [e3]", '    - text: "one"'])


class Picked(Home):
    """A Browser with no Chrome running: its notes and picks, and the message they make."""

    def setUp(self):
        super().setUp()
        self.bs = browser.Browsers(sessions.Sessions())
        self.addCleanup(self.bs.close)
        with mock.patch.object(browser, "available", lambda: True):
            self.cfg = self.bs.create("g", self.root, "claude")
        self.b = self.bs.get(self.cfg["key"])

    def test_the_message_ends_with_the_page_what_the_user_did_and_picked(self):
        tab = browser.Tab("T1", "S1", "http://localhost:3000/cart", "Cart")
        self.b.tabs = [tab]
        self.b.note("opened http://localhost:3000/cart")
        self.b.note("the page went to http://localhost:3000/cart")       # the same move, told once
        self.b.note("clicked button \"Checkout\"")
        self.b.note("clicked button \"Checkout\"")
        pick = {"kind": "element", "id": "p1", "label": 'button "Pay"', "selector": "form > button", "tag": "button",
                "html": '<button class="pay">Pay</button>', "styles": {"color": "red"}, "image": "/up/p1.png",
                "target": "T1", "node": 7}
        area = {"kind": "area", "id": "p2", "label": "an area 30×20", "box": [1, 2, 30, 20], "text": "Total $42",
                "image": "/up/p2.png"}
        self.b.picks, self.b.kept_picks = [pick, area], {"p1": pick, "p2": area}
        s = next(x for x in self.bs.started.list() if x["session_id"] == self.cfg["channel"])
        with mock.patch.object(self.bs, "name_actor"):
            text, told = self.bs.compose(s, "Make it blue")
        self.assertIs(told, self.b)
        words, state = text.split("\n\n", 1)
        self.assertEqual(words, "Make it blue")
        self.assertEqual(state.splitlines()[0], "<browser_state>")
        self.assertIn("page: Cart — http://localhost:3000/cart", state)
        self.assertIn('since their last message, the user: opened http://localhost:3000/cart; clicked button "Checkout"\n', state)
        self.assertIn('[p1] button "Pay"\n  where: form > button\n  html: <button class="pay">Pay</button>\n'
                      '  styles: color red\n  image: /up/p1.png', state)
        self.assertIn('[p2] an area 30×20 at (1, 2) of the page\n  text in it: "Total $42"\n  image: /up/p2.png', state)
        self.assertTrue(state.endswith("</browser_state>"))
        told.sent()
        self.assertEqual((self.b.picks, self.b.log), ([], []))
        self.assertEqual(set(self.b.kept_picks), {"p1", "p2"})              # their refs work on
        self.assertNotIn("picked", self.b.compose("again"))

    def test_another_actor_s_message_is_as_typed(self):
        self.assertEqual(self.bs.compose({"role": None}, "hi"), ("hi", None))

    def test_its_actor_is_named_once_by_the_name_given_else_by_its_folder(self):
        named = queue.Queue()
        with mock.patch.object(browser, "NAME_WAIT", 0), \
                mock.patch.object(browser, "available", lambda: True), \
                mock.patch.object(browser.naming, "record",
                                  lambda g, channel, name: named.put((g, channel, browser.naming.clean(name)))):
            self.bs.name_actor(self.cfg["key"], "Checkout")
            self.assertEqual(named.get(timeout=5), ("g", self.cfg["channel"], "Checkout"))
            self.bs.name_actor(self.cfg["key"])              # named already: not again
            other = self.bs.create("g", self.root, "claude")
            self.bs.name_actor(other["key"])
            self.assertEqual(named.get(timeout=5), ("g", other["channel"], "Browser · site"))
            self.assertTrue(named.empty())

    def test_refs_say_why_they_do_not_work(self):
        self.b.ref_n = 5
        with self.assertRaisesRegex(browser.BrowserError, "e3 is gone"):
            self.b.resolve("e3")
        with self.assertRaisesRegex(browser.BrowserError, "no element e9"):
            self.b.resolve("e9")
        self.b.kept_picks["p2"] = {"kind": "area"}
        with self.assertRaisesRegex(browser.BrowserError, "an area"):
            self.b.resolve("p2")

    def test_a_browser_is_found_by_its_key_only(self):
        with self.assertRaises(browser.BrowserError):
            self.bs.get("0" * 16)
        with self.assertRaises(browser.BrowserError):
            self.bs.get("../x")


class ServerTest(Home):
    """The routes, through the dashboard's server: made, messaged, its MCP server's tools, the page's only."""

    def setUp(self):
        super().setUp()
        from ag_dashboard import server
        self.httpd = server.serve("127.0.0.1", 0, live_updates=False)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"
        with mock.patch.object(browser, "available", lambda: True):
            self.cfg = self.post("/api/browser", {"gatherer": "g", "cwd": self.root, "harness": "claude"})

    def post(self, path: str, body, headers=None):
        req = urllib.request.Request(self.url + path, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", **(headers or {})}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as res:
            raw = res.read()
        return json.loads(raw) if raw else None

    def test_made_its_actor_listed_with_its_role(self):
        s = next(x for x in self.httpd.sessions.list() if x["session_id"] == self.cfg["channel"])
        self.assertEqual(browser.key_of(s), self.cfg["key"])
        self.assertEqual(os.path.realpath(s["cwd"]), self.root)

    def test_a_message_to_it_carries_the_browser_state_and_its_picks_are_told(self):
        b = self.httpd.browsers.get(self.cfg["key"])
        b.picks = [{"kind": "area", "id": "p1", "label": "an area", "box": [0, 0, 5, 5]}]
        sent = []
        with mock.patch.object(sessions.Sessions, "send", lambda self, sid, text, *a: sent.append(text) or {"ok": 1}), \
                mock.patch.object(self.httpd.browsers, "name_actor"):
            self.post("/api/send", {"session_id": self.cfg["channel"], "text": "look here"})
            self.post("/api/send", {"session_id": self.cfg["channel"], "text": "/compact"})
        self.assertTrue(sent[0].startswith("look here\n\n<browser_state>"))
        self.assertIn("[p1] an area", sent[0])
        self.assertEqual(sent[1], "/compact")                               # a command, as typed
        self.assertEqual(b.picks, [])

    def test_its_mcp_server_lists_the_tools(self):
        base = f"/browser/w/{self.cfg['key']}/mcp"
        init = self.post(base, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
        self.assertEqual(init["result"]["serverInfo"]["name"], browser.NAME)
        listed = self.post(base, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        self.assertEqual([t["name"] for t in listed["result"]["tools"]], [t["name"] for t in browser.TOOLS])

    def test_only_the_dashboard_s_own_page_may_post(self):
        with self.assertRaises(urllib.error.HTTPError) as got:
            self.post(f"/browser/w/{self.cfg['key']}/nav", {"url": "example.com"}, {"Origin": "http://evil.example"})
        self.assertEqual(got.exception.code, 403)

    def test_what_the_page_shows_is_answered_and_a_file_kept_for_it_through_the_routes(self):
        key = self.cfg["key"]
        with self.assertRaises(urllib.error.HTTPError) as got:     # a list gone (or never there): nothing set
            self.post(f"/browser/w/{key}/choose", {"n": 7, "index": 0})
        self.assertEqual(got.exception.code, 409)
        fid = self.post(f"/browser/w/{key}/file", {"name": "a.txt", "data": base64.b64encode(b"hi").decode()})["id"]
        with open(self.httpd.browsers.get(key).uploads[fid]) as fh:
            self.assertEqual(fh.read(), "hi")
        with self.assertRaises(urllib.error.HTTPError) as got:
            self.post(f"/browser/w/{key}/file", {"name": "a.txt", "data": "not base64!"})
        self.assertEqual(got.exception.code, 400)
        with self.assertRaises(urllib.error.HTTPError) as got:
            self.post(f"/browser/w/{key}/reveal", {"i": 3})
        self.assertEqual(got.exception.code, 404)

    def test_an_unknown_browser_is_not_found(self):
        for path in (f"/browser/w/{'0' * 16}/nav", "/browser/w/zz/nav"):
            with self.assertRaises(urllib.error.HTTPError) as got:
                self.post(path, {"url": "x"})
            self.assertEqual(got.exception.code, 404)
        with self.assertRaises(urllib.error.HTTPError) as got:
            urllib.request.urlopen(f"{self.url}/browser/w/{'0' * 16}/stream", timeout=5)
        self.assertEqual(got.exception.code, 404)


@unittest.skipUnless(browser.available(), "no Chrome here")
class ChromeTest(Home):
    """The whole of it against a real Chrome, headless: the agent's tools, the user's input and picks, the screen."""

    def setUp(self):
        super().setUp()
        self.bs = browser.Browsers(sessions.Sessions())
        self.addCleanup(self.bs.close)
        self.cfg = self.bs.create("g", self.root, "claude")
        self.key = self.cfg["key"]
        self.b = self.bs.get(self.key)

    def call(self, name: str, **args) -> dict:
        return self.bs.call(self.key, name, args)

    def text(self, name: str, **args) -> str:
        got = self.call(name, **args)
        self.assertFalse(got.get("isError"), got)
        return got["content"][0]["text"]

    def ref(self, outline: str, starts: str) -> str:
        line = next(x for x in outline.splitlines() if x.strip().startswith("- " + starts))
        return line.split("[", 1)[1].split("]", 1)[0]

    def middle(self, ref: str):
        tab, node, _ = self.b.resolve(ref)
        q = self.bs.chrome.cdp().call("DOM.getContentQuads", {"backendNodeId": node}, tab.session)["quads"][0]
        return sum(q[0::2]) / 4, sum(q[1::2]) / 4

    def page_says(self) -> str:
        return self.text("evaluate", expression="document.getElementById('out').textContent")

    def serve(self, name: str, text: str) -> str:
        """The page `name`, served from the test's folder over http://localhost (a file: page can't do everything)."""
        self.write(name, text)

        class Quiet(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=self.root))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://localhost:{server.server_address[1]}/{name}"

    def until(self, check, wait: float = 3.0):
        end = time.time() + wait
        while time.time() < end and not check():
            time.sleep(0.05)
        return check()

    def test_the_agent_and_the_user_use_one_tab(self):
        self.assertIn('"Shop checkout"', self.text("navigate", url=os.path.join(self.root, "index.html")))
        outline = self.text("snapshot")
        self.assertIn("page: Shop checkout — file://", outline)
        self.assertIn('- textbox "Password"', outline)
        self.assertNotIn("hunter2", outline)                                # a password's value never
        email, size, pay = (self.ref(outline, w) for w in ('textbox "Email"', 'combobox "Size"', 'button "Pay'))

        # the agent's tools
        self.assertIn("Typed 8 characters", self.text("type", ref=email, text="me@x.org"))
        self.assertIn('Chose "Large"', self.text("select", ref=size, values=["Large"]))
        self.assertIn("Clicked button", self.text("click", ref=pay))
        self.assertEqual(self.page_says(), "paid me@x.org l")
        warned = self.text("click", ref=self.ref(outline, 'button "Warn'))   # its alert: told, not waited on
        self.assertIn("alert dialog opened", warned)
        self.assertTrue(self.call("snapshot").get("isError"))
        self.assertIn("accepted", self.text("dialog", accept=True))
        shot = self.call("screenshot", ref=pay)["content"][1]
        self.assertEqual(shot["type"], "image")
        self.assertTrue(base64.b64decode(shot["data"]).startswith(b"\x89PNG"))
        self.text("console")
        self.assertEqual(self.text("evaluate", expression="new Promise((r) => setTimeout(() => r(42), 20))"), "42")
        self.assertEqual(self.text("evaluate", expression="await new Promise((r) => setTimeout(() => r('a'), 20))"), "a")

        # the user's: a pick of an element and of an area, typing, a click -- the next message tells them
        x, y = self.middle(pay)
        self.assertEqual(self.b.pick(x, y)["label"], 'button "Pay $42.00"')
        self.assertTrue(self.b.pick(box=[0, 0, 200, 120])["label"].startswith("an area"))
        ex, ey = self.middle(email)
        self.b.input([{"type": "mouse", "kind": "mousePressed", "x": ex, "y": ey, "button": "left", "buttons": 1, "clickCount": 1},
                      {"type": "mouse", "kind": "mouseReleased", "x": ex, "y": ey, "button": "left", "clickCount": 1},
                      {"type": "key", "down": True, "key": "Backspace", "code": "Backspace", "keyCode": 8},
                      {"type": "key", "down": False, "key": "Backspace", "code": "Backspace", "keyCode": 8},
                      {"type": "text", "text": "!"}])
        self.assertEqual(self.text("evaluate", expression="email.value"), "me@x.or!")
        time.sleep(0.5)
        message = self.b.compose("make p1 blue")
        self.assertIn('typed into textbox "Email"', message)
        self.assertIn('clicked textbox "Email"', message)
        self.assertIn("[p1] button", message)
        self.assertIn('[p2] an area', message)
        for p in self.b.picks:
            self.assertTrue(os.path.isfile(p["image"]))
        self.b.sent()
        self.assertIn("Clicked button", self.text("click", ref="p1"))        # a pick's ref, after its message

        # a page the user opened, then one the agent's click opened in a tab of its own
        self.assertIn("Opened a new tab", self.text("tabs", action="new"))
        self.text("tabs", action="close", index=2)
        self.assertIn("It opened a new tab", self.text("click", ref=self.ref(outline, 'link "New tab')))
        self.assertIn("2 (shown): Second page", self.text("tabs"))
        self.assertIn('"Second page"', self.text("click", ref=self.ref(outline, 'link "Next page')))
        self.assertIn("is gone", self.call("click", ref=email)["content"][0]["text"])

        # the screen, to a page watching
        self.b.resize(640, 480, 1)
        v = self.b.join()
        self.addCleanup(self.b.leave, v)
        seen, end = {}, time.time() + 10
        while time.time() < end and "frame" not in seen:
            for name, value in v.take(1) or []:
                seen[name] = value
        self.assertEqual(seen["state"]["tabs"][seen["state"]["active"]]["title"], "Second page")
        self.assertEqual((seen["frame"]["w"], seen["frame"]["h"]), (640, 480))
        self.assertTrue(base64.b64decode(seen["frame"]["data"]).startswith(b"\xff\xd8"))   # a JPEG

    def test_the_screen_comes_quicker_while_the_user_scrolls_or_drags_then_sharp_again(self):
        def cast(want):
            end = time.time() + 5
            while time.time() < end and self.b.tab().cast != want:
                time.sleep(0.05)
            return self.b.tab().cast
        mouse = lambda kind, x, y, **more: {"type": "mouse", "kind": kind, "x": x, "y": y, "button": "left", **more}
        self.text("navigate", url=os.path.join(self.root, "index.html"))
        with mock.patch.object(browser, "QUICK_FOR", 0.3):
            v = self.b.join()
            self.addCleanup(self.b.leave, v)
            self.b.resize(800, 600, 2.0)
            sharp, quick = (1600, 1200), (1200, 900)
            self.assertEqual(cast(sharp), sharp)
            self.b.input([{"type": "mouse", "kind": "mouseMoved", "x": 5, "y": 5}])
            self.b.input([mouse("mousePressed", 300, 300, buttons=1, clickCount=1), mouse("mouseMoved", 302, 301, buttons=1),
                          mouse("mouseReleased", 302, 301, clickCount=1)])
            self.b.input([{"type": "key", "down": True, "key": "a", "code": "KeyA"}])
            self.assertEqual(self.b.tab().cast, sharp)          # a move, a (shaky) click, a key: still sharp
            self.b.input([{"type": "mouse", "kind": "mouseWheel", "x": 5, "y": 5, "deltaY": 40}])
            self.assertEqual(self.b.tab().cast, quick)          # scrolled: quicker, before Chrome's frame
            self.assertEqual(cast(sharp), sharp)                # then sharp again
            self.b.input([mouse("mousePressed", 300, 300, buttons=1, clickCount=1), mouse("mouseMoved", 340, 300, buttons=1)])
            self.assertEqual(self.b.tab().cast, quick)          # dragged
            self.b.input([mouse("mouseReleased", 340, 300, clickCount=1)])
            self.assertEqual(cast(sharp), sharp)

    def test_a_link_cmd_clicked_or_middle_clicked_opens_in_a_tab_behind(self):
        self.text("navigate", url=os.path.join(self.root, "index.html"))
        x, y = self.middle(self.ref(self.text("snapshot"), 'link "Next page'))
        for button, mods in (("left", 4), ("middle", 0)):
            self.b.input([{"type": "mouse", "kind": "mousePressed", "x": x, "y": y, "button": button, "buttons": 1,
                           "clickCount": 1, "modifiers": mods},
                          {"type": "mouse", "kind": "mouseReleased", "x": x, "y": y, "button": button, "clickCount": 1,
                           "modifiers": mods}])
        end = time.time() + 10
        while time.time() < end and (len(self.b.tabs) < 3 or not all(t.url for t in self.b.tabs)):
            time.sleep(0.1)
        self.assertEqual([t.url.rsplit("/", 1)[-1] for t in self.b.tabs], ["index.html", "two.html", "two.html"])
        self.assertEqual(self.b.active, 0)                                # behind, as Chrome opens them
        self.assertIn("a new tab opened behind", self.b.compose(""))

    def test_a_page_asking_for_a_passkey_still_takes_the_user_s_clicks(self):
        """No passkey can be given here (PASSKEYS in browser.py): the request waits on the page, and the user can
        still click its other way -- Chrome's own prompt, unseen, would drop their input -- and no passkey is made."""
        page = self.serve("passkey.html", PASSKEY)               # served: a file:// page can't ask for a passkey
        self.text("navigate", url=page)
        time.sleep(0.5)
        x, y = self.middle(self.ref(self.text("snapshot"), 'button "Other options'))
        self.b.input([{"type": "mouse", "kind": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1, "clickCount": 1},
                      {"type": "mouse", "kind": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1}])
        end = time.time() + 3
        while time.time() < end and self.page_says() != "other options":
            time.sleep(0.1)
        self.assertEqual(self.page_says(), "other options")
        self.assertEqual(self.text("evaluate", expression="asked"), "waiting")
        self.text("navigate", url=page + "?make")                # its request gone (one at a time), one to make a passkey
        self.text("evaluate", expression="""navigator.credentials.create({publicKey: {...key,
            rp: {name: 'x'}, user: {id: new Uint8Array(8), name: 'me', displayName: 'me'},
            pubKeyCredParams: [{type: 'public-key', alg: -7}]}}).then(() => made = 'made', (e) => made = e.name); 0""")
        time.sleep(1)
        self.assertEqual(self.text("evaluate", expression="made"), "waiting")

    # -- what Chrome would show itself (UI_JS), the view draws

    def widgets(self) -> None:
        self.text("navigate", url=self.serve("w.html", WIDGETS))
        self.assertTrue(self.until(lambda: self.b.tab().ui_ctx is not None))

    def at(self, el: str, across: float = 0.5):
        r = json.loads(self.text("evaluate", expression=f"JSON.stringify(document.getElementById('{el}').getBoundingClientRect())"))
        return r["x"] + r["width"] * across, r["y"] + r["height"] / 2

    def mouse(self, *kinds: str, at, button: str = "left") -> None:
        x, y = at
        self.b.input([{"type": "mouse", "kind": k, "x": x, "y": y, "button": "none" if k == "mouseMoved" else button,
                       "buttons": {"left": 1, "right": 2}[button] if k == "mousePressed" else 0, "clickCount": 1}
                      for k in kinds])

    def click_at(self, at, button: str = "left") -> None:
        self.mouse("mouseMoved", "mousePressed", "mouseReleased", at=at, button=button)

    def popup(self, k: str):
        self.assertTrue(self.until(lambda: (self.b.state()["popup"] or {}).get("k") == k), self.b.state()["popup"])
        return self.b.state()["popup"]

    def test_the_pointer_takes_the_page_s_shape(self):
        self.widgets()
        for el, shape in (("go", "pointer"), ("words", "text"), ("grab", "grab"), ("size", "default"), ("tip", "default")):
            self.mouse("mouseMoved", at=self.at(el))
            self.assertTrue(self.until(lambda: self.b.tab().cursor == shape), (el, self.b.tab().cursor))
        self.mouse("mouseMoved", at=(700, 300))                     # nothing there
        self.assertTrue(self.until(lambda: self.b.state()["cursor"] == "default"))

    def test_a_drop_down_s_list_is_the_view_s_and_what_the_user_chose_is_set(self):
        self.widgets()
        self.click_at(self.at("size"))
        p = self.popup("select")
        self.assertEqual([o["t"] for o in p["options"]], ["Tiny", "Small", "Medium", "Large"])
        self.assertEqual([o["g"] for o in p["options"]], ["Small", "Small", None, None])
        self.assertEqual([o["d"] for o in p["options"]], [False, False, True, False])
        self.assertEqual((p["name"], p["i"], len(p["box"])), ("Size", 0, 4))
        self.assertNotIn("ctx", p)
        self.assertEqual(self.text("evaluate", expression="document.activeElement.id"), "size")   # keys go to it next
        self.b.choose(p["n"], index=3)
        self.assertIn("size=Large", self.page_says())               # as if chosen there: its change sent
        self.assertIn('chose "Large" in drop-down "Size"', self.b.log)
        with self.assertRaises(browser.BrowserError):
            self.b.choose(p["n"] + 100, index=1)
        # the agent's click on it: told to choose with the select tool
        said = self.text("click", ref=self.ref(self.text("snapshot"), 'combobox "Size"'))
        self.assertIn("select tool", said)

    def test_a_date_s_or_a_color_s_picker_is_the_view_s(self):
        self.widgets()
        self.click_at(self.at("day", 0.2))                          # its digits: typed into, no picker
        time.sleep(0.4)
        self.assertIsNone(self.b.state()["popup"])
        self.click_at(self.at("day", 0.95))                         # its icon, at its end
        p = self.popup("picker")
        self.assertEqual((p["type"], p["value"]), ("date", ""))
        self.b.choose(p["n"], value="2026-11-01")
        self.assertIn("day=2026-11-01", self.page_says())
        self.click_at(self.at("hue"))
        p = self.popup("picker")
        self.assertEqual((p["type"], p["value"]), ("color", "#000000"))
        self.b.choose(p["n"], value="#ff0000")
        self.assertIn("hue=#ff0000", self.page_says())

    def test_a_field_s_suggestions_are_the_view_s_and_the_one_chosen_fills_it(self):
        self.widgets()
        self.click_at(self.at("fruit"))
        p = self.popup("suggest")
        self.assertEqual([(o["t"], o["l"]) for o in p["options"]], [("apple", ""), ("apricot", ""), ("banana", "Yellow")])
        self.assertEqual((p["name"], len(p["box"])), ("Fruit", 4))
        self.b.input([{"type": "text", "text": "ap"}])               # typed: those matching, each keystroke
        self.assertTrue(self.until(lambda: [o["t"] for o in self.b.state()["popup"]["options"]] == ["apple", "apricot"]))
        p = self.b.state()["popup"]
        self.b.choose(p["n"], index=1)
        self.assertIn("fruit=apricot", self.page_says())
        self.assertIn('chose the suggestion "apricot" for field "Fruit"', self.b.log)
        self.assertTrue(self.until(lambda: self.b.state()["popup"]["options"] == []))   # none left: gone
        with self.assertRaises(browser.BrowserError):
            self.b.choose(self.b.state()["popup"]["n"], index=0)

    def test_a_tooltip_shows_after_a_hover_and_goes_with_a_click(self):
        self.widgets()
        x, y = self.at("tip")
        self.mouse("mouseMoved", at=(x, y))
        self.assertTrue(self.until(lambda: self.b.state()["tip"] is not None))
        tip = self.b.state()["tip"]
        self.assertEqual(tip["text"], "Saves the draft")
        self.assertTrue(abs(tip["at"][0] - x) <= 1 and abs(tip["at"][1] - y) <= 1, (tip["at"], x, y))   # (whole pixels)
        self.click_at((x, y))
        self.assertTrue(self.until(lambda: self.b.state()["tip"] is None))

    def test_the_right_click_menu_where_the_page_shows_none_of_its_own(self):
        self.widgets()
        self.click_at(self.at("go"), button="right")
        p = self.popup("menu")
        self.assertTrue(p["link"].startswith("http://localhost:") and p["link"].endswith("/two.html"), p["link"])
        self.assertEqual((p["linkText"], p["editable"]), ("A link", False))
        self.click_at(self.at("own"), button="right")               # the page's own menu: none of the dashboard's
        time.sleep(0.5)
        self.assertEqual(self.b.state()["popup"]["n"], p["n"])

    def test_text_is_found_as_chrome_s_find_bar_finds_it(self):
        self.widgets()
        self.assertEqual(self.b.find("apple"), {"count": 3, "index": 0})
        self.assertEqual(self.text("evaluate", expression="String(getSelection())"), "apple")
        self.assertEqual(self.b.find("apple", again=True), {"count": 3, "index": 1})
        self.assertEqual(self.text("evaluate", expression="String(getSelection())"), "Apple")
        self.assertEqual(self.b.find("apple", back=True, again=True), {"count": 3, "index": 0})
        self.assertEqual(self.b.find("nowhere at all"), {"count": 0, "index": -1})
        self.text("evaluate", expression="document.getElementById('fruit').value = 'apple pie', 0")   # in a field too
        self.assertEqual(self.b.find("apple"), {"count": 4, "index": 0})
        for i in (1, 2, 3):
            self.assertEqual(self.b.find("apple", again=True), {"count": 4, "index": i})
        self.assertEqual(self.text("evaluate", expression="document.activeElement.id"), "fruit")
        cmd_f = [{"type": "key", "down": d, "key": "f", "code": "KeyF", "keyCode": 70, "modifiers": 4} for d in (True, False)]
        self.b.input(cmd_f)
        n = self.popup("find")["n"]
        self.text("evaluate", expression="addEventListener('keydown', (e) => e.preventDefault()), 0")   # its own Cmd+F
        self.b.input(cmd_f)
        time.sleep(0.5)
        self.assertEqual(self.b.state()["popup"]["n"], n)

    def test_the_page_s_file_chooser_is_the_user_s_and_files_dropped_on_it_land(self):
        self.widgets()
        self.click_at(self.at("up"))
        self.assertTrue(self.until(lambda: self.b.state()["chooser"] is not None))
        c = self.b.state()["chooser"]
        self.assertEqual(c["mode"], "single")
        self.assertNotIn("node", c)
        fid = self.b.upload("../../notes.txt", base64.b64encode(b"hi").decode())
        self.assertEqual(os.path.dirname(os.path.dirname(self.b.uploads[fid])), browser.uploads_dir())   # kept there only
        self.assertEqual(self.b.chosen(c["n"], [fid]), 1)
        self.assertTrue(self.until(lambda: "up=notes.txt" in self.page_says()))
        self.assertIsNone(self.b.state()["chooser"])
        self.assertIn('gave the page the file "notes.txt"', self.b.log)
        self.click_at(self.at("up"))                                # again, closed unanswered
        self.assertTrue(self.until(lambda: self.b.state()["chooser"] is not None))
        self.assertEqual(self.b.chosen(self.b.state()["chooser"]["n"], []), 0)
        self.assertIsNone(self.b.state()["chooser"])
        self.assertEqual(self.b.drop(*self.at("drop"), [fid]), 1)
        self.assertTrue(self.until(lambda: "dropped=notes.txt" in self.page_says()))
        with mock.patch.object(browser, "MAX_UPLOAD", 1), self.assertRaises(browser.BrowserError):
            self.b.upload("big.bin", base64.b64encode(b"too big").decode())

    def test_a_download_done_is_told(self):
        self.widgets()
        self.click_at(self.at("dl"))
        self.assertTrue(self.until(lambda: self.b.state()["downloads"], 5))
        d = self.b.downloads[-1]
        self.assertEqual(self.b.state()["downloads"], [{"i": d["i"], "name": "hello.txt"}])
        with open(d["path"]) as fh:
            self.assertEqual(fh.read(), "hi")
        self.assertIn(f"a download finished: {d['path']}", self.b.log)
        with self.assertRaises(browser.BrowserError):
            self.b.reveal(d["i"] + 100)
    def test_copy_cut_and_paste_are_the_page_s_own_through_its_clipboard(self):
        """Cmd+C, X and V as the page would have them: its copy and paste handlers run (Google Docs has no selection
        to read); what a copy put on Chrome's clipboard comes back for the user's, and a paste is put there first."""
        self.write("clip.html", CLIP)
        self.write("clip-frame.html", CLIP_FRAME)

        class Quiet(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=self.root))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.text("navigate", url=f"http://localhost:{server.server_address[1]}/clip.html")   # a secure page
        time.sleep(0.5)
        js = lambda expression: self.text("evaluate", expression=expression)
        copy = lambda cut=False: self.b.input([{"type": "copy", "cut": cut, "modifiers": 4}]).get("clipboard")

        js("t.focus(); t.setSelectionRange(0, 5)")
        self.assertEqual(copy(), {"text": "plain"})
        self.assertEqual(copy(cut=True), {"text": "plain"})
        self.assertEqual(js("t.value"), " text here")
        self.assertEqual(copy(), {})                              # nothing selected: the user's clipboard stays
        js("f.contentDocument.getElementById('e').focus()")
        self.assertEqual(js("String(getSelection())"), "")
        self.assertEqual(copy(), {"text": "the app's words", "html": "<b>the app's</b> words"})
        self.b.input([{"type": "paste", "text": "from the Mac", "html": "<i>from</i> the Mac"}])
        self.assertEqual(js("log[0]").split(" | ")[0], "from the Mac")
        self.assertIn("<i>from</i> the Mac", js("log[0]"))
        js("t.focus(); t.setSelectionRange(0, 0)")
        self.b.input([{"type": "paste", "text": "Pasted", "html": ""}])
        self.assertEqual(js("t.value"), "Pasted text here")
        self.assertEqual(js("navigator.permissions.query({name: 'clipboard-read'}).then((p) => p.state)"), "prompt")

        self.text("navigate", url=os.path.join(self.root, "clip.html"))    # file://: no clipboard, what is selected
        time.sleep(0.3)
        js("t.focus(); t.setSelectionRange(0, 5)")
        self.assertEqual(copy(), {"text": "plain"})
        js("t.setSelectionRange(5, 5)")
        self.b.input([{"type": "paste", "text": "!", "html": ""}])
        self.assertEqual(js("t.value"), "plain! text here")

    def test_its_tabs_open_again_after_the_chrome_stopped(self):
        self.text("navigate", url=os.path.join(self.root, "two.html"))
        time.sleep(1.5)                                  # its pages kept (at most every second)
        self.bs.chrome.conn.stop()
        end = time.time() + 5
        while time.time() < end and self.b.tabs:
            time.sleep(0.1)
        self.assertEqual(self.b.tabs, [])
        self.assertIn("Page two", self.text("snapshot"))


@unittest.skipUnless(browser.available(), "no Chrome here")
class UsersChromeTest(Home):
    """"mine" against a stand-in for the user's Chrome -- one with its debugging on (headless here, a profile of its
    own): reached over a WebSocket, the Browser's tab hidden in it, closed when the dashboard stops, the Chrome left
    running; and a change of `browser_profile` taken at the next use, the tabs opened again in the other Chrome."""

    def setUp(self):
        super().setUp()
        self.user = os.path.join(self.tmp.name, "userchrome")
        self.chrome = subprocess.Popen([browser.executable(), "--headless=new", "--remote-debugging-port=0",
                                        f"--user-data-dir={self.user}", "--no-first-run", "about:blank"],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(self.chrome.wait, 10)
        self.addCleanup(self.chrome.terminate)
        end = time.time() + 15
        while time.time() < end and not os.path.exists(os.path.join(self.user, "DevToolsActivePort")):
            time.sleep(0.1)
        dirs = mock.patch.dict(browser.USER_DIRS, {sys.platform: [self.user]})
        dirs.start()
        self.addCleanup(dirs.stop)
        self.bs = browser.Browsers(sessions.Sessions())
        self.addCleanup(self.bs.close)
        self.cfg = self.bs.create("g", self.root, "claude")
        self.b = self.bs.get(self.cfg["key"])

    def text(self, name: str, **args) -> str:
        got = self.bs.call(self.cfg["key"], name, args)
        self.assertFalse(got.get("isError"), got)
        return got["content"][0]["text"]

    def test_a_browser_in_the_user_s_chrome(self):
        self.text("navigate", url=os.path.join(self.root, "index.html"))
        self.assertEqual(type(self.bs.chrome.conn), browser.PipeCdp)    # the dashboard's own, by default
        self.config('[dashboard]\nbrowser_profile = "mine"\n')
        self.assertIn("page: Shop checkout", self.text("snapshot"))     # the same page, opened again in the user's
        conn = self.bs.chrome.conn
        self.assertEqual(type(conn), browser.WsCdp)
        mine = self.b.tabs[0].target
        listed = {t["targetId"]: t for t in conn.call("Target.getTargets")["targetInfos"]}
        self.assertNotEqual(listed[mine]["type"], "page")                # hidden from the user's tab strip
        self.assertEqual(self.b.state()["chrome"], "mine")
        big = "x" * 70_000                                               # a message over a WebSocket frame's 16-bit length
        self.assertEqual(self.text("evaluate", expression=f"'{big}'.length"), "70000")
        self.b.resize(400, 300, 1)
        v = self.b.join()
        self.addCleanup(self.b.leave, v)
        seen, end = set(), time.time() + 10
        while time.time() < end and "frame" not in seen:
            seen |= {name for name, _ in v.take(1) or []}
        self.assertIn("frame", seen)
        self.bs.close()
        time.sleep(0.5)
        self.assertIsNone(self.chrome.poll())                            # the user's Chrome runs on
        self.assertEqual(conn.alive, False)

    def test_a_tab_a_page_opens_from_a_hidden_tab_is_opened_by_the_dashboard(self):
        self.config('[dashboard]\nbrowser_profile = "mine"\n')
        self.text("navigate", url=os.path.join(self.root, "index.html"))
        outline = self.text("snapshot")
        ref = lambda name: next(x for x in outline.splitlines() if f'link "{name}"' in x).split("[", 1)[1].split("]", 1)[0]
        got = self.text("click", ref=ref("New tab"))                    # target=_blank: Chrome says so, opens none
        self.assertIn("It opened a new tab (2), shown now:", got)
        self.assertTrue(got.rstrip(".").endswith("two.html"), got)
        self.text("tabs", action="switch", index=1)
        outline = self.text("snapshot")
        got = self.text("click", ref=ref("Next page"), modifiers=["Meta"])   # Cmd+click: behind
        self.assertIn("It opened a new tab (3), behind this one:", got)
        self.assertEqual([t.url.rsplit("/", 1)[-1] for t in self.b.tabs], ["index.html", "two.html", "two.html"])
        self.assertEqual(self.b.active, 0)


class LoginsTest(unittest.TestCase):
    """The user's Chrome's logins, copied: which site a cookie is of, and what of a cookie another Chrome takes."""

    def test_a_cookie_s_site(self):
        self.assertEqual(browser.site_of(".www.figma.com"), "figma.com")
        self.assertEqual(browser.site_of("figma.com"), "figma.com")
        self.assertEqual(browser.site_of(".news.bbc.co.uk"), "bbc.co.uk")
        self.assertEqual(browser.site_of("127.0.0.1"), "127.0.0.1")
        self.assertEqual(browser.site_of("localhost"), "localhost")

    def test_a_cookie_as_another_chrome_takes_it(self):
        got = browser.cookie_param({"name": "a", "value": "b", "domain": ".x.com", "path": "/", "expires": -1,
                                    "size": 2, "session": True, "httpOnly": True, "sameSite": "Lax"})
        self.assertEqual(got, {"name": "a", "value": "b", "domain": ".x.com", "path": "/", "httpOnly": True, "sameSite": "Lax"})
        self.assertEqual(browser.cookie_param({"name": "a", "value": "b", "domain": "x.com", "expires": 2e9,
                                               "session": False})["expires"], 2e9)


@unittest.skipUnless(browser.available(), "no Chrome here")
class ImportLoginsTest(Home):
    """Logins from a stand-in for the user's Chrome (debugging on, headless, a profile of its own) into the dashboard's
    own: the sites listed by name and count, the picked ones' cookies copied -- and still there once the dashboard's
    Chrome stopped and started again (closed as it closes itself, so it wrote them)."""

    def setUp(self):
        super().setUp()
        self.user = os.path.join(self.tmp.name, "userchrome")
        self.chrome = subprocess.Popen([browser.executable(), "--headless=new", "--remote-debugging-port=0",
                                        f"--user-data-dir={self.user}", "--no-first-run", "about:blank"],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(self.chrome.wait, 10)
        self.addCleanup(self.chrome.terminate)
        end = time.time() + 15
        while time.time() < end and not os.path.exists(os.path.join(self.user, "DevToolsActivePort")):
            time.sleep(0.1)
        dirs = mock.patch.dict(browser.USER_DIRS, {sys.platform: [self.user]})
        dirs.start()
        self.addCleanup(dirs.stop)
        found = browser.devtools_port()
        theirs = browser.WsCdp(found[0], found[1], lambda *a: None, lambda c: None)
        try:
            theirs.call("Storage.setCookies", {"cookies": [
                {"name": "sid", "value": "secret-1", "domain": ".figma.test", "path": "/", "httpOnly": True, "secure": True,
                 "expires": time.time() + 86400},
                {"name": "pref", "value": "dark", "domain": "www.figma.test", "path": "/", "expires": time.time() + 86400},
                {"name": "other", "value": "x", "domain": ".else.test", "path": "/", "expires": time.time() + 86400}]})
        finally:
            theirs.stop()

    def ours(self, bs: browser.Browsers) -> dict:
        return {c["name"]: c for c in bs.chrome.cdp().call("Storage.getCookies", {})["cookies"]}

    def test_the_picked_sites_logins_are_copied_for_every_browser_and_kept(self):
        bs = browser.Browsers(sessions.Sessions())
        listed = {s["site"]: s["cookies"] for s in bs.login_sites()["sites"]}
        self.assertEqual((listed.get("figma.test"), listed.get("else.test")), (2, 1))
        self.assertNotIn("secret-1", json.dumps(listed))
        got = bs.import_logins(["figma.test"])
        self.assertEqual(got["imported"], [{"site": "figma.test", "cookies": 2}])
        self.assertIsNone(bs.logins)                                # the user's cookies not kept after
        ours = self.ours(bs)
        self.assertEqual((ours["sid"]["value"], ours["sid"]["httpOnly"]), ("secret-1", True))
        self.assertIn("pref", ours)
        self.assertNotIn("other", ours)                             # a site not picked: not copied
        bs.close()                                                  # its Chrome stopped: the cookies written to disk
        again = browser.Browsers(sessions.Sessions())
        self.addCleanup(again.close)
        self.assertEqual(self.ours(again)["sid"]["value"], "secret-1")

    def test_with_the_user_s_chrome_used_already_there_is_nothing_to_import(self):
        self.config('[dashboard]\nbrowser_profile = "mine"\n')
        bs = browser.Browsers(sessions.Sessions())
        self.addCleanup(bs.close)
        with self.assertRaisesRegex(browser.BrowserError, "own Chrome"):
            bs.login_sites()


if __name__ == "__main__":
    unittest.main()
