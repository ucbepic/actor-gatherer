"""The Browser app (ag_apps/browser/: core.py, backend.py): which Chrome it runs, what its agent is told of what the
user did and picked, the snapshot's outline, the keys and addresses it takes, its tools only for its own agent, its
panel's routes on the app's own origin -- and, where a Chrome is installed, the whole of it against a real one: the
agent's tools, the user's input and picks (also on a page asking for a passkey), the screen streamed, its tabs opened
again after the Chrome stopped. Moved from test_dashboard_browser.py with the Browser."""
import base64
import functools
import http.server
import json
import os
import queue
import socket
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

import secrets  # noqa: E402

from ag_apps.browser import core as browser  # noqa: E402

#: A check that holds on any page: for the tests of other things than checks, which an acting tool needs (ExpectTest).
HOLDS = [{"js": "document.documentElement !== null"}]


def checked(name: str, args: dict) -> dict:
    """`args`, with HOLDS as their `expect` if the tool needs one and they have none -- and a script, what it does."""
    if name == "evaluate" and "says" not in args:
        args = {**args, "says": "reading the page for a test"}
    lists = name == "tabs" and (args.get("action") or "list") == "list"
    return args if name not in browser.ACTS or lists or "expect" in args else {**args, "expect": HOLDS}

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
        self.saved = browser.HOME, browser.DB_PATH
        browser.HOME = os.path.join(self.tmp.name, "home")
        browser.DB_PATH = os.path.join(browser.HOME, "apps", "browser", "data", "browser.db")
        self.addCleanup(lambda: setattr(browser, "HOME", self.saved[0]) or setattr(browser, "DB_PATH", self.saved[1]))
        os.makedirs(browser.HOME)
        self.told_to = []                                 # what each Browser told its agent: (key, text)
        self.root = os.path.join(os.path.realpath(self.tmp.name), "site")
        os.makedirs(self.root)
        self.write("index.html", PAGE)
        self.write("two.html", "<!doctype html><title>Second page</title><h1>Page two</h1>")

    def write(self, name: str, text: str) -> str:
        path = os.path.join(self.root, name)
        with open(path, "w") as fh:
            fh.write(text)
        return path

    def browsers(self) -> "browser.Browsers":
        """The app's Browsers, what they tell their agents kept (`told`)."""
        return browser.Browsers(lambda key, text: self.told_to.append((key, text)))

    def told(self, b: "browser.Browser") -> str:
        """Everything Browser `b` told its agent, what it was about to tell told now."""
        b._tell()
        return "\n".join(t for k, t in self.told_to if k == b.key)

    def config(self, text: str) -> None:
        with open(os.path.join(browser.HOME, "config.toml"), "w") as fh:
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


class OrdinaryUaTest(Home):
    """The user agent the dashboard's own Chrome is started with: ordinary Chrome's, of the version installed."""

    def chrome(self, says: str) -> str:
        exe = self.write(f"chrome{len(os.listdir(self.root))}", f"#!/bin/sh\necho '{says}'\n")
        os.chmod(exe, 0o755)
        return exe

    def test_the_version_installed_named_as_ordinary_chrome(self):
        with mock.patch.object(browser.sys, "platform", "darwin"):
            self.assertEqual(browser.ordinary_ua(self.chrome("Google Chrome 156.0.8078.80 ")),
                             "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
                             "Chrome/156.0.0.0 Safari/537.36")
        with mock.patch.object(browser.sys, "platform", "linux"):
            self.assertEqual(browser.ordinary_ua(self.chrome("Microsoft Edge 157.0.3400.12")),
                             "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                             "Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0")

    def test_none_when_the_chrome_names_no_version_of_chrome_s(self):
        self.assertIsNone(browser.ordinary_ua(self.chrome("")))
        self.assertIsNone(browser.ordinary_ua(self.chrome("Brave Browser 1.71.118")))   # not Chrome's numbering
        self.assertIsNone(browser.ordinary_ua("/no/such/chrome"))


class PipesTest(unittest.TestCase):
    """Chrome is handed its DevTools pipe as fds 3 and 4 (PLACE_PIPES), whatever numbers the pipes have here: past 9,
    as a server's mostly are (where Linux's /bin/sh, dash, refused them), or one of them on 3 already."""

    def handed(self, opened):
        keep = [os.open(os.devnull, os.O_RDONLY) for _ in range(opened)]
        try:
            r3, w3 = os.pipe()
            r4, w4 = os.pipe()
            probe = "import os; os.write(4, os.read(3, 5).upper())"         # reads 3, writes 4, as Chrome does
            p = subprocess.Popen([sys.executable, "-c", browser.PLACE_PIPES, str(r3), str(w4), sys.executable, "-c",
                                  probe], pass_fds=(r3, w4))
            os.close(r3)
            os.close(w4)
            os.write(w3, b"hello")
            self.assertEqual(p.wait(timeout=30), 0)
            self.assertEqual(os.read(r4, 5), b"HELLO")
            os.close(w3)
            os.close(r4)
        finally:
            for f in keep:
                os.close(f)

    def test_pipes_past_nine(self):
        self.handed(12)

    def test_a_pipe_on_three_already(self):
        self.handed(0)


class GroupEndedTest(unittest.TestCase):
    """A Chrome stopped: its helpers, which outlive its browser process a moment, waited for -- else killed."""

    def started(self, linger: float) -> int:
        """A process in a session of its own, ended, its child left running `linger` seconds."""
        p = subprocess.Popen([sys.executable, "-c", "import subprocess, sys; subprocess.Popen([sys.executable, '-c', "
                              f"'import time; time.sleep({linger})'])"], start_new_session=True)
        p.wait(10)
        os.killpg(p.pid, 0)                                         # its child still there
        return p.pid

    def gone(self, pgid: int) -> bool:
        try:
            os.killpg(pgid, 0)
        except ProcessLookupError:
            return True
        return False

    def test_a_helper_ending_by_itself_waited_for(self):
        pgid = self.started(0.5)
        start = time.time()
        browser.group_ended(pgid)
        self.assertTrue(self.gone(pgid))
        self.assertLess(time.time() - start, 4)

    def test_one_left_running_killed(self):
        pgid = self.started(60)
        start = time.time()
        browser.group_ended(pgid, wait=0.5)
        self.assertTrue(self.gone(pgid))
        self.assertLess(time.time() - start, 4)


class ShortcutKeyTest(unittest.TestCase):
    """Chrome's shortcut key -- a link opened in a tab behind, Find, copy and paste -- is Cmd on macOS and Ctrl elsewhere:
    Cmd from a user on a Mac, or from the agent ("Meta"), goes to a Chrome on Linux as Ctrl."""

    def test_cmd_is_ctrl_where_chrome_is_not_on_a_mac(self):
        with mock.patch.object(browser, "CHROME_ON_MAC", False):
            self.assertEqual(browser._for_chrome(4), 2)              # Cmd
            self.assertEqual(browser._for_chrome(4 | 8), 2 | 8)      # Cmd+Shift
            self.assertEqual(browser._for_chrome(2 | 4), 2 | 4)      # Ctrl held too: as it is
            self.assertEqual(browser._for_chrome(1 | 8), 1 | 8)      # no Cmd: as it is

    def test_on_a_mac_cmd_is_cmd(self):
        with mock.patch.object(browser, "CHROME_ON_MAC", True):
            self.assertEqual(browser._for_chrome(4), 4)
            self.assertEqual(browser._for_chrome(2), 2)


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
        bs = self.browsers()
        self.addCleanup(bs.close)
        with mock.patch.dict(browser.USER_DIRS, {sys.platform: [os.path.join(self.tmp.name, "none")]}):
            with self.assertRaisesRegex(browser.BrowserError, "chrome://inspect/#remote-debugging"):
                bs.chrome.cdp()


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
        self.assertEqual(browser._url("example.com:8080/x"), "https://example.com:8080/x")   # a port, not a scheme
        self.assertEqual(browser._url("10.0.0.2/x"), "https://10.0.0.2/x")
        self.assertEqual(browser._url("Numpy.org."), "https://Numpy.org.")
        self.assertEqual(browser._url("пример.рф"), "https://пример.рф")

    def test_words_are_searched_for_as_chrome_does(self):
        google = "https://www.google.com/search?q="
        self.assertEqual(browser._typed("tau-bench: evaluating agents"),
                         (google + "tau-bench%3A+evaluating+agents", "tau-bench: evaluating agents"))
        self.assertEqual(browser._typed("Attention: is all you need")[1], "Attention: is all you need")   # no scheme
        for words in ("numpy", "numpy.array", "README.txt", "me@example.com", "3+4", "what's c++?", "C:/x y"):
            self.assertEqual(browser._typed(words)[1], words, words)
        self.assertEqual(browser._typed("? example.com"), (google + "example.com", "example.com"))   # ? first: words
        for address in ("numpy.org", "localhost", "en.wikipedia.org/wiki/A_B?x=1#y", "a.io"):
            self.assertIsNone(browser._typed(address)[1], address)
        with self.assertRaises(browser.BrowserError):
            browser._typed("?")
        self.assertEqual(browser._phrases(None, "navigate", {"url": "numpy array"}, None, {})[0],
                         'Searching Google for "numpy array"')
        self.assertEqual(browser._phrases(None, "navigate", {"url": "numpy.org"}, None, {})[0], "Opening numpy.org")

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
        self.bs = self.browsers()
        self.addCleanup(self.bs.close)
        with mock.patch.object(browser, "available", lambda: True):
            self.cfg = self.bs.keep(secrets.token_hex(8), self.root, "g")
        self.b = self.bs.get(self.cfg["key"])

    def test_the_agent_is_told_the_page_what_the_user_did_and_picked(self):
        tab = browser.Tab("T1", "S1", "http://localhost:3000/cart", "Cart")
        self.b.tabs = [tab]
        with mock.patch.object(browser, "TELL_AFTER", 30):                # told when the test says
            self.b.note("opened http://localhost:3000/cart")
            self.b.note("the page went to http://localhost:3000/cart")   # the same move, told once
            self.b.note("clicked button \"Checkout\"")
            self.b.note("clicked button \"Checkout\"")
        pick = {"kind": "element", "id": "p1", "label": 'button "Pay"', "selector": "form > button", "tag": "button",
                "html": '<button class="pay">Pay</button>', "styles": {"color": "red"}, "image": "/up/p1.png",
                "target": "T1", "node": 7}
        area = {"kind": "area", "id": "p2", "label": "an area 30×20", "box": [1, 2, 30, 20], "text": "Total $42",
                "image": "/up/p2.png"}
        self.b.picks, self.b.kept_picks = [pick, area], {"p1": pick, "p2": area}
        state = self.told(self.b)
        self.assertEqual(state.splitlines()[0], "The browser you share with the user:")
        self.assertIn("page: Cart — http://localhost:3000/cart", state)
        self.assertIn('the user: opened http://localhost:3000/cart; clicked button "Checkout"\n', state)
        self.assertIn("they picked (use these refs in the browser_* tools, as e-refs):", state)
        self.assertIn('[p1] button "Pay"\n  where: form > button\n  html: <button class="pay">Pay</button>\n'
                      '  styles: color red\n  image: /up/p1.png', state)
        self.assertIn('[p2] an area 30×20 at (1, 2) of the page\n  text in it: "Total $42"\n  image: /up/p2.png', state)
        self.assertEqual(self.b.log, [])                                   # told: not again
        n = len(self.told_to)
        self.b._tell()
        self.assertEqual(len(self.told_to), n)                             # nothing new: nothing told
        self.b.sent()                                                      # their next message seen
        self.assertEqual(self.b.picks, [])
        self.assertEqual(set(self.b.kept_picks), {"p1", "p2"})              # their refs work on

    def test_a_pick_is_told_at_once_and_the_rest_after_a_while(self):
        with mock.patch.object(browser, "TELL_AFTER", 0.2):
            self.b.note('clicked button "Next"')
            time.sleep(0.05)
            self.assertEqual(self.told_to, [])                             # a run of clicks and typing: one message
            end = time.time() + 5
            while not self.told_to and time.time() < end:
                time.sleep(0.02)
        self.assertIn('the user: clicked button "Next"', self.told_to[-1][1])

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


class ChromeBase(Home):
    """A Browser in a real Chrome, headless, and the tests' ways to use it."""

    def setUp(self):
        super().setUp()
        self.bs = self.browsers()
        self.addCleanup(self.bs.close)
        self.cfg = self.bs.keep(secrets.token_hex(8), self.root, "g")
        self.key = self.cfg["key"]
        self.b = self.bs.get(self.key)

    def call(self, name: str, **args) -> dict:
        return self.bs.call(self.key, name, checked(name, args))

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

    def js(self, expression: str):
        """`expression`'s value in the shown page, run as the page's own script would be: no tool, so no check."""
        tab = self.b.tab()
        return self.bs.chrome.cdp().call("Runtime.evaluate", {"expression": expression, "returnByValue": True},
                                         tab.session)["result"].get("value")

    def click_as_user(self, ref: str) -> None:
        """A click of the user's, in the view, on the element `ref` names."""
        x, y = self.middle(ref)
        self.b.input([{"type": "mouse", "kind": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1, "clickCount": 1},
                      {"type": "mouse", "kind": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1}])


@unittest.skipUnless(browser.available(), "no Chrome here")
class ChromeTest(ChromeBase):
    """The whole of it against a real Chrome, headless: the agent's tools, the user's input and picks, the screen."""

    def test_a_link_clicked_in_the_dashboard_opens_in_its_blank_tab_then_in_new_ones(self):
        first = self.serve("first.html", "<title>First</title><p>one</p>")
        second = first.replace("first.html", "second.html")
        self.write("second.html", "<title>Second</title><p>two</p>")
        for url in ("file:///etc/hosts", "javascript:alert(1)", "example.com"):
            with self.assertRaises(browser.BrowserError):
                self.b.open_link(url)
        self.assertEqual(self.b.open_link(first), first)     # a Browser just opened for it: its one tab, blank, used
        self.assertTrue(self.until(lambda: [t.url for t in self.b.tabs] == [first]), [t.url for t in self.b.tabs])
        self.b.open_link(second)                              # one with a page: a new tab
        self.assertTrue(self.until(lambda: [t.url for t in self.b.tabs] == [first, second]), [t.url for t in self.b.tabs])
        self.assertEqual(self.b.active, 1)
        told = [what for _, what in self.b.lately]            # what its agent is told the user did
        self.assertIn("opened " + first, told)
        self.assertIn("opened a new tab: " + second, told)

    def test_a_new_tab_is_told_at_the_page_asked_for_whatever_chrome_says_first(self):
        first = self.serve("first.html", "<title>First</title><p>one</p>")
        second = first.replace("first.html", "second.html")
        self.write("second.html", "<title>Second</title><p>two</p>")
        self.b.open_link(first)
        self.assertTrue(self.until(lambda: [t.url for t in self.b.tabs] == [first]), [t.url for t in self.b.tabs])
        made = self.b._open

        def blank_first(cdp, url, *a, **k):              # Chrome's first word on the new tab, "about:blank", handled
            tab = made(cdp, url, *a, **k)                 # after the tab is made (as a slower machine has it)
            self.b._target_event("Target.targetInfoChanged",
                                 {"targetInfo": {"targetId": tab.target, "url": "about:blank", "title": "about:blank"}})
            return tab
        with mock.patch.object(self.b, "_open", blank_first):
            self.b.open_link(second)
        urls = lambda: [t.url for t in self.b.tabs]          # noqa: E731
        self.assertTrue(self.until(lambda: urls() == [first, second]), urls())
        told = [what for _, what in self.b.lately]
        self.assertIn("opened a new tab: " + second, told)
        self.assertNotIn("opened a new tab: about:blank", told)
        self.assertNotIn("the page went to " + second, told)   # (the same thing, told once)

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
        message = self.told(self.b)
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

    def test_a_site_is_told_it_is_ordinary_chrome_not_driven(self):
        """Some sites refuse headless Chrome by its user agent (Figma's CloudFront: a 403 "Request blocked"), Google's
        sign-in a Chrome that says it is driven: pages, their workers and requests see ordinary Chrome's user agent, its
        client hints in full, and navigator.webdriver false (AUTOMATION_HIDDEN)."""
        url = self.serve("ua.html", "<!doctype html><title>UA</title>")
        self.text("navigate", url=url)
        seen = json.loads(self.text("evaluate", expression="""(async () => ({ua: navigator.userAgent,
            driven: navigator.webdriver, hints: await navigator.userAgentData.getHighEntropyValues(
              ['fullVersionList', 'platformVersion', 'architecture', 'bitness']),
            worker: await new Promise((r) => { const w = new Worker(URL.createObjectURL(new Blob(
              ['postMessage(navigator.userAgent)']))); w.onmessage = (e) => r(e.data); })}))()"""))
        self.assertNotIn("Headless", seen["ua"])
        self.assertRegex(seen["ua"], r" Chrome/\d+\.0\.0\.0 ")
        self.assertEqual(seen["worker"], seen["ua"])
        self.assertIs(seen["driven"], False)
        hints = seen["hints"]
        self.assertTrue(any(len(b["version"].split(".")) == 4 and b["version"].split(".")[0] in seen["ua"]
                            for b in hints["fullVersionList"]), hints)
        self.assertRegex(hints["platformVersion"], r"^\d+\.\d+\.\d+$")
        self.assertIn(hints["architecture"], ("arm", "x86"))
        self.assertEqual(hints["bitness"], "64")

    def test_its_pages_are_shown_in_the_dashboard_s_theme(self):
        """The dashboard's page tells its theme (set_scheme): a page open then is shown in it at once, and one opened
        later is opened in it -- as a site with a dark look shows it in one's own Chrome in a dark system."""
        dark = "matchMedia('(prefers-color-scheme: dark)').matches"
        url = self.serve("scheme.html", "<!doctype html><title>Scheme</title>")
        self.text("navigate", url=url)
        self.assertEqual(self.text("evaluate", expression=dark), "false")     # headless Chrome's own: light
        self.assertEqual(self.bs.set_scheme("dark"), {"scheme": "dark"})
        self.assertEqual(self.text("evaluate", expression=dark), "true")
        self.text("tabs", action="new", url=url)
        self.assertIn("2 (shown)", self.text("tabs"))
        self.assertEqual(self.text("evaluate", expression=dark), "true")
        self.bs.set_scheme("light")
        self.assertEqual(self.text("evaluate", expression=dark), "false")
        self.text("tabs", action="switch", index=1)
        self.assertEqual(self.text("evaluate", expression="matchMedia('(prefers-color-scheme: light)').matches"), "true")
        with self.assertRaises(browser.BrowserError):
            self.bs.set_scheme("sepia")

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
        self.assertIn("a new tab opened behind", self.told(self.b))

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

    def test_put_to_sleep_its_tabs_close_and_open_again_as_they_were_on_its_next_use(self):
        self.text("navigate", url=os.path.join(self.root, "two.html"))
        self.text("tabs", action="new", url=os.path.join(self.root, "index.html"))
        targets = [t.target for t in self.b.tabs]
        self.bs.sleep(self.key)                          # its task closed: at once, no wait for its pages to be kept
        self.assertEqual(self.b.tabs, [])
        self.assertTrue(self.until(lambda: not any(t["targetId"] in targets for t in
                                                   self.bs.chrome.cdp().call("Target.getTargets")["targetInfos"])))
        self.bs.sleep("0" * 16)                          # one not open: asleep already
        listed = self.text("tabs")                       # used again: its tabs back, the one shown as it was
        self.assertIn("Second page", listed)
        self.assertIn("Shop checkout", listed)
        self.assertEqual(len(self.b.tabs), 2)
        self.assertEqual(self.b.active, 1)

    def test_a_page_opened_again_is_read_once_it_has_loaded(self):
        class Slow(http.server.BaseHTTPRequestHandler):                 # its title at once, its body 1.5 s later
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(b"<!doctype html><title>Slow page</title>" + b" " * 2048)
                self.wfile.flush()
                time.sleep(1.5)
                self.wfile.write(b"<h1>Slow page body</h1>")

            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Slow)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.text("navigate", url=f"http://localhost:{server.server_address[1]}/slow.html")
        time.sleep(1.5)                                  # its pages kept (at most every second)
        self.bs.chrome.conn.stop()
        end = time.time() + 5
        while time.time() < end and self.b.tabs:
            time.sleep(0.1)
        self.assertEqual(self.b.tabs, [])
        got = self.text("snapshot")
        self.assertIn("Slow page body", got)
        self.assertNotIn("(loading)", got)


INVOICES = """<!doctype html><title>Invoices</title>
<button id="move" onclick="move()">Sort by date</button> <button id="swap" onclick="swap()">Sort in place</button>
<button onclick="this.textContent = this.textContent === 'Show more' ? 'Show less' : 'Show more'">Show more</button>
<button id="a" onclick="order.textContent += 'A'">Agent's</button> <button id="b" onclick="order.textContent += 'B'">User's</button>
<ul id="rows">
  <li><span>Invoice #4411</span> <button onclick="del(this)">Delete</button> <button onclick="del(this)">Remove #4411</button></li>
  <li><span>Invoice #4412</span> <button onclick="del(this)">Delete</button> <button onclick="del(this)">Remove #4412</button></li>
</ul>
<input id="note" aria-label="Note"> <input id="pw" type="password" aria-label="Password" value="hunter2">
<p id="out"></p><p id="order"></p>
<script>
var pageVar = 1;
function move() { const ul = document.getElementById('rows'); ul.prepend(ul.lastElementChild); }   // the rows move
function swap() {                                    // the rows stay, what they show swapped: a list redrawn in place
  const lis = [...document.querySelectorAll('#rows li')];
  const ids = lis.map((li) => li.querySelector('span').textContent.slice(9)).reverse();
  lis.forEach((li, i) => { li.querySelector('span').textContent = 'Invoice #' + ids[i];
                           li.querySelectorAll('button')[1].textContent = 'Remove #' + ids[i]; });
}
function del(b) { out.textContent = 'deleted ' + b.closest('li').querySelector('span').textContent; }
</script>"""


class Counting:
    """A lock that counts how often it is taken: a Browser's `acts`, watched."""

    def __init__(self):
        self.lock, self.taken = threading.Lock(), 0

    def acquire(self, *args, **kw):
        got = self.lock.acquire(*args, **kw)
        self.taken += bool(got)
        return got

    def release(self):
        self.lock.release()

    def locked(self):
        return self.lock.locked()

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *exc):
        self.release()


@unittest.skipUnless(browser.available(), "no Chrome here")
class ExpectTest(ChromeBase):
    """An action's checks (`expect`), against a real Chrome: the user changes the page between the agent's snapshot and
    its action, as they may while it thinks."""

    def setUp(self):
        super().setUp()
        self.text("navigate", url=self.write("invoices.html", INVOICES))
        self.outline = self.text("snapshot")

    def row(self, n: int) -> str:
        """The ref of row n's list item, from 1, as the page has it now."""
        tab, _, _ = self.b.resolve(self.ref(self.outline, 'button "Sort by date'))
        cdp = self.bs.chrome.cdp()
        root = cdp.call("DOM.getDocument", {"depth": 0}, tab.session)["root"]["nodeId"]
        node = cdp.call("DOM.querySelector", {"nodeId": root, "selector": f"#rows li:nth-child({n})"}, tab.session)["nodeId"]
        backend = cdp.call("DOM.describeNode", {"nodeId": node}, tab.session)["node"]["backendNodeId"]
        return self.b._ref(tab.target, backend)

    def delete_in_row_1(self) -> str:
        return next(x for x in self.outline.splitlines() if x.strip().startswith('- button "Delete"')).split("[")[1].split("]")[0]

    def said(self, got: dict) -> str:
        return "\n".join(c["text"] for c in got["content"] if c.get("type") == "text")

    def test_an_action_needs_its_checks_and_one_must_check_something(self):
        sort = self.ref(self.outline, 'button "Sort by date')
        for expect, says in ((None, "needs `expect`"), ([], "needs `expect`"), ([{"ref": sort}], "has no `js`"),
                             ([{"js": "true"}], "the same whatever the page shows"),
                             (["  'yes' "], "the same whatever the page shows")):
            got = self.bs.call(self.key, "click", {"ref": sort} if expect is None else {"ref": sort, "expect": expect})
            self.assertTrue(got.get("isError"))
            self.assertIn(says, self.said(got))
        self.assertEqual(self.page_says(), "")
        self.assertIn("1 (shown): Invoices", self.text("tabs"))            # listing the tabs acts on nothing
        self.assertNotIn("expect", self.bs.call(self.key, "dialog", {"accept": True})["content"][0]["text"])
        listed = {t["name"]: t["inputSchema"] for t in browser.TOOLS}
        for name in browser.ACTS - {"tabs"}:
            self.assertIn("expect", listed[name]["required"], name)
        self.assertNotIn("expect", listed["snapshot"].get("properties", {}))
        self.assertIn("expect", listed["tabs"]["properties"])
        self.assertIn("Assume the user is using the page while you think", browser.instructions())

    def test_rows_the_user_sorted_the_check_follows_the_row_and_the_right_one_is_deleted(self):
        delete = self.delete_in_row_1()
        self.click_as_user(self.ref(self.outline, 'button "Sort by date'))
        self.assertTrue(self.until(lambda: "4412" in self.js("rows.firstElementChild.innerText")))
        self.until(lambda: any("Sort by date" in w for _, w in self.b.lately))
        got = self.call("click", ref=delete, expect=[{"ref": self.row(2), "js": "el.innerText.includes('#4411')"}])
        self.assertFalse(got.get("isError"), got)
        self.assertEqual(self.page_says(), "deleted Invoice #4411")         # its row moved with it: still #4411's
        self.assertIn('Meanwhile, the user: clicked button "Sort by date"', self.said(got))
        self.assertNotIn("Meanwhile", self.said(self.call("click", ref=delete)))   # told once

    def test_a_row_redrawn_in_place_with_another_invoice_is_not_acted_on(self):
        delete, row = self.delete_in_row_1(), self.row(1)
        self.click_as_user(self.ref(self.outline, 'button "Sort in place'))
        self.assertTrue(self.until(lambda: "4412" in self.js("rows.firstElementChild.innerText")))
        self.until(lambda: any("Sort in place" in w for _, w in self.b.lately))
        got = self.call("click", ref=delete, expect=[{"js": "document.title === 'Invoices'"},
                                                     {"ref": row, "js": "el.innerText.includes('#4411')"}])
        self.assertTrue(got.get("isError"))
        said = self.said(got)
        self.assertIn("Not done: expect 2 is false: el.innerText.includes('#4411')", said)
        self.assertIn('reading "Invoice #4412 Delete Remove #4412"', said)  # what is there now
        self.assertIn('Since your last snapshot', said)
        self.assertIn('the user: clicked button "Sort in place"', said)
        self.assertEqual(self.page_says(), "")                              # not clicked

    def test_an_element_that_is_no_longer_what_the_snapshot_showed_is_not_acted_on(self):
        remove = self.ref(self.outline, 'button "Remove #4411')
        self.js("swap()")                                                   # the page itself, this time
        got = self.call("click", ref=remove)
        self.assertTrue(got.get("isError"))
        said = self.said(got)
        self.assertIn(f'{remove} was button "Remove #4411" in your snapshot; it is button "Remove #4412" now', said)
        self.assertIn("clicked, typed and navigated nothing since your last snapshot", said)
        self.assertEqual(self.page_says(), "")
        self.text("snapshot")                                               # seen again: it is what it is now
        self.call("click", ref=remove)
        self.assertEqual(self.page_says(), "deleted Invoice #4412")

    def test_what_the_agent_s_own_action_changed_is_not_taken_for_a_change(self):
        toggle = self.ref(self.outline, 'button "Show more')
        self.assertIn('Clicked button "Show more"', self.text("click", ref=toggle))
        self.assertIn('Clicked button "Show less"', self.text("click", ref=toggle))

    def test_a_check_runs_apart_from_the_page_s_scripts_and_may_neither_run_long_nor_wait(self):
        note, pw = self.ref(self.outline, 'textbox "Note'), self.ref(self.outline, 'textbox "Password')
        self.text("type", ref=note, text="hi", expect=[{"ref": note, "js": "el.value === '' && typeof pageVar === 'undefined'"}])
        self.assertEqual(self.text("evaluate", expression="typeof __agExpectEl + ' ' + note.value"), "undefined hi")
        said = self.said(self.call("type", ref=pw, text="x", expect=[{"ref": pw, "js": "el.value === ''"}]))
        self.assertIn("is false", said)
        self.assertNotIn("hunter2", said)                                   # a password's value never
        start = time.time()
        said = self.said(self.call("click", ref=note, expect=[{"js": "(() => { while (true) {} })()"}]))
        self.assertLess(time.time() - start, 3)
        self.assertIn("Not done: expect 1 failed: it ran longer than 200 ms", said)
        self.assertIn("may not wait", self.said(self.call("click", ref=note, expect=[{"js": "Promise.resolve(true)"}])))
        self.assertIn("failed: ReferenceError", self.said(self.call("click", ref=note, expect=[{"js": "nothing.here"}])))
        self.assertIn("could not be checked", self.said(self.call("click", ref=note, expect=[{"ref": "e999", "js": "!!el"}])))

    def test_the_user_s_click_waits_until_the_agent_s_checked_action_is_done(self):
        a, b = self.ref(self.outline, "button \"Agent's"), self.ref(self.outline, "button \"User's")
        x, y = self.middle(b)
        slow_again = ("(globalThis.__agRuns = (globalThis.__agRuns || 0) + 1) < 2 || "   # the second time: holding `acts`
                      "(() => { const t = Date.now(); while (Date.now() - t < 150) {} return !!document.body; })()")
        checks, again, check = [], threading.Event(), self.bs._check

        def checking(*args):
            checks.append(args)
            if len(checks) == 2:                                            # checked again: `acts` held
                again.set()
            return check(*args)
        done = []
        # the check's 150 ms well within its limit, on a slow machine too (CI's ran past 200 ms); and the user's click
        # sent once it is checked again, not after a time it might not be by
        with mock.patch.object(self.bs, "_check", side_effect=checking), mock.patch.object(browser, "EXPECT_TIME", 5000):
            agent = threading.Thread(target=lambda: done.append(self.call("click", ref=a, expect=[{"js": slow_again}])))
            agent.start()
            self.assertTrue(again.wait(10))                                 # the user clicks while it checks again
            self.b.input([{"type": "mouse", "kind": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1, "clickCount": 1},
                          {"type": "mouse", "kind": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1}])
            agent.join(10)
        self.assertFalse(done[0].get("isError"), done[0])
        self.assertEqual(self.text("evaluate", expression="order.textContent"), "AB")

    def test_a_false_check_is_refused_holding_nothing_and_a_true_one_is_run_again_holding_the_lock(self):
        acts = self.b.acts = Counting()
        row, delete = self.row(1), self.delete_in_row_1()
        with mock.patch.object(self.bs, "_check", wraps=self.bs._check) as checked_:
            got = self.call("click", ref=delete, expect=[{"ref": row, "js": "el.innerText.includes('#9999')"}])
            self.assertTrue(got.get("isError"))
            self.assertEqual((acts.taken, checked_.call_count), (0, 1))     # refused at the first: the lock untaken
            got = self.call("click", ref=delete, expect=[{"ref": row, "js": "el.innerText.includes('#4411')"}])
            self.assertFalse(got.get("isError"), got)
            self.assertEqual((acts.taken, checked_.call_count), (1, 3))     # true: again, holding it, then done
        self.assertFalse(acts.locked())
        self.assertEqual(self.page_says(), "deleted Invoice #4411")

    def test_a_false_check_slow_to_answer_holds_up_not_the_user_s_click(self):
        a, b = self.ref(self.outline, "button \"Agent's"), self.ref(self.outline, "button \"User's")
        x, y = self.middle(b)
        real = self.bs._check

        def slow(*args):                       # Chrome slow to answer it (a busy page, say), the page itself not held
            time.sleep(0.2)
            return real(*args)
        done = []
        with mock.patch.object(self.bs, "_check", side_effect=slow):
            agent = threading.Thread(target=lambda: done.append(
                self.call("click", ref=a, expect=[{"js": "document.title === 'Not this page'"}])))
            agent.start()
            time.sleep(0.05)                                                # the user clicks while it checks
            t0 = time.time()
            self.b.input([{"type": "mouse", "kind": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1,
                           "clickCount": 1},
                          {"type": "mouse", "kind": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1}])
            took = time.time() - t0
            agent.join(10)
        self.assertLess(took, 0.1)                                          # not waiting out the check (~0.15 s left)
        self.assertIn("is false", self.said(done[0]))
        self.assertEqual(self.text("evaluate", expression="order.textContent"), "B")   # theirs; the agent's, not done

    def test_a_check_true_then_false_as_the_action_comes_is_refused_the_lock_let_go_before_it_is_said(self):
        row, delete = self.row(1), self.delete_in_row_1()
        real, runs, held = self.bs._check, [], []

        def check(*args):
            got = real(*args)
            runs.append(got)
            if len(runs) == 1:
                self.js("swap()")                                           # between the two: the page changes
            return got
        real_ax = self.b._ax
        with mock.patch.object(self.bs, "_check", side_effect=check), \
                mock.patch.object(self.b, "_ax", side_effect=lambda *a: held.append(self.b.acts.locked()) or real_ax(*a)):
            got = self.call("click", ref=delete, expect=[{"ref": row, "js": "el.innerText.includes('#4411')"}])
        self.assertEqual([ok for ok, _ in runs], [True, False])
        self.assertIn("Not done: expect 1 is false: el.innerText.includes('#4411')", self.said(got))
        self.assertIn('reading "Invoice #4412', self.said(got))
        self.assertEqual(held, [False])                                     # what is there now: read, the lock let go
        self.assertFalse(self.b.acts.locked())
        self.assertEqual(self.page_says(), "")

    def page(self, name: str, title: str, body: str = "") -> str:
        return self.write(name, f"<!doctype html><title>{title}</title><h1>{title}</h1>{body}")

    def silent(self) -> str:
        """A site that takes the connection and never answers (the user's mielections.us)."""
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        s.listen(8)
        held = []

        def hold():
            while True:
                try:
                    held.append(s.accept()[0])
                except OSError:
                    return
        threading.Thread(target=hold, daemon=True).start()
        self.addCleanup(lambda: [c.close() for c in held + [s]])
        return f"http://127.0.0.1:{s.getsockname()[1]}/results"

    def test_a_check_of_another_tab_runs_in_its_page_and_the_tab_shown_stays(self):
        self.text("tabs", action="new", url=self.page("two.html", "Two"))
        self.text("tabs", action="switch", index=1)
        got = self.bs.call(self.key, "tabs", {"action": "switch", "index": 2,
                                              "expect": [{"tab": 2, "js": "document.title === 'Two'"}]})
        self.assertFalse(got.get("isError"), got)
        self.assertEqual(self.b.active, 1)
        self.text("tabs", action="switch", index=1)
        cdp = self.bs.chrome.cdp()                                          # tab 2 goes elsewhere, behind
        cdp.call("Page.navigate", {"url": "file://" + self.page("three.html", "Three")}, self.b.tabs[1].session)
        self.assertTrue(self.until(lambda: self.b._retitle(self.b.tabs[1]) or self.b.tabs[1].title == "Three"))
        got = self.bs.call(self.key, "tabs", {"action": "switch", "index": 2,
                                              "expect": [{"tab": 2, "js": "document.title === 'Two'"}]})
        self.assertTrue(got.get("isError"))
        self.assertIn("Not done: expect 1 is false: document.title === 'Two'\nTab 2 is \"Three\"", self.said(got))
        self.assertEqual(self.b.active, 0)                                  # not switched
        self.b.close_tab(1)                                                 # the user closes it
        got = self.bs.call(self.key, "tabs", {"action": "close", "index": 2,
                                              "expect": [{"tab": 2, "js": "document.title === 'Three'"}]})
        self.assertIn("Not done: expect 1 could not be checked: no tab 2: there are 1", self.said(got))
        self.assertEqual(len(self.b.tabs), 1)
        got = self.bs.call(self.key, "tabs", {"action": "switch", "index": 1, "expect": [{"tab": 0, "js": "1 < 2 && !!document"}]})
        self.assertIn("is not a tab's number", self.said(got))

    def test_a_check_of_an_element_in_another_tab_does_not_show_that_tab(self):
        row = self.row(1)                                                   # in tab 1
        self.text("tabs", action="new", url=self.page("two.html", "Two"))  # tab 2, shown
        for expect, says in (([{"ref": row, "js": "el.innerText.includes('#9999')"}], "is false"),
                             ([{"ref": row, "tab": 2, "js": "el.innerText.includes('#4411')"}],
                              f"is false: {row} is in tab 1 now, not tab 2")):
            got = self.bs.call(self.key, "scroll", {"direction": "down", "expect": expect})
            self.assertTrue(got.get("isError"))
            self.assertIn(says, self.said(got))
            self.assertEqual(self.b.active, 1)                              # still the tab the user sees
        got = self.bs.call(self.key, "scroll", {"direction": "down",
                                                "expect": [{"ref": row, "tab": 1, "js": "el.innerText.includes('#4411')"}]})
        self.assertFalse(got.get("isError"), got)
        self.assertEqual(self.b.active, 1)

    def test_the_agent_s_navigation_to_a_site_that_never_answers_is_stopped(self):
        url = self.silent()
        with mock.patch.object(browser, "NAV_WAIT", 2.0):
            t0 = time.time()
            got = self.call("navigate", url=url)
            self.assertLess(time.time() - t0, 5)
            said = self.said(got)
            self.assertTrue(got.get("isError"))
            self.assertIn(f"Not opened: {url} did not answer in 2 s, so its loading was stopped", said)
            self.assertIn('The tab shows "Invoices" — file://', said)
            t0 = time.time()                                                # its page answers again at once
            self.assertIn("Invoices", self.text("snapshot"))
            self.assertLess(time.time() - t0, 2)
            got = self.call("tabs", action="new", url=url)                 # a new tab's, the same
            self.assertIn(f"Opened a new tab (2), shown now, but {url} did not answer in 2 s", self.said(got))
            self.assertIn("about:blank", self.text("snapshot"))
        time.sleep(1)
        self.assertEqual(self.b.tabs[0].url, "file://" + os.path.join(self.root, "invoices.html"))   # gone nowhere

    def test_a_navigation_the_user_cuts_short_says_what_they_did_and_holds_them_up_not(self):
        url = self.silent()
        self.page("two.html", "Two")
        self.text("navigate", url=self.page("go.html", "Go", '<a href="two.html" style="display:block;font-size:40px">'
                                                           "to Two</a>"))
        x, y = self.middle(self.ref(self.text("snapshot"), 'link "to Two"'))
        done = []
        with mock.patch.object(browser, "NAV_WAIT", 10.0):
            agent = threading.Thread(target=lambda: done.append(self.call("navigate", url=url)))
            agent.start()
            time.sleep(1.0)                                                 # its site is not answering
            t0 = time.time()
            self.b.input([{"type": "mouse", "kind": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1,
                           "clickCount": 1},
                          {"type": "mouse", "kind": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1}])
            self.assertLess(time.time() - t0, 1)                            # the user's click waits on no site
            agent.join(10)
        said = self.said(done[0])
        self.assertTrue(done[0].get("isError"))
        self.assertIn(f"Not opened: {url} did not open: the page went elsewhere before it answered", said)
        self.assertIn("the user: clicked", said)
        self.assertIn('The tab shows "Two"', said)

    def test_the_user_s_navigation_to_a_slow_site_holds_up_neither_them_nor_the_agent_s_checks(self):
        url, b_ = self.silent(), self.ref(self.outline, "button \"User's")
        x, y = self.middle(b_)
        going = threading.Thread(target=lambda: self.assertRaises(browser.BrowserError, self.b.navigate, url))
        going.start()                                                       # the user's: up to CALL_WAIT
        self.addCleanup(going.join, 25)
        self.addCleanup(lambda: self.bs.chrome.cdp().call("Page.stopLoading", {}, self.b.tab().session))
        time.sleep(0.5)
        t0 = time.time()
        self.b.input([{"type": "mouse", "kind": "mouseMoved", "x": x, "y": y}])
        self.assertLess(time.time() - t0, 1)                                # the lock is not held for the site
        with mock.patch.object(browser, "EXPECT_WAIT", 1.0):
            t0 = time.time()
            got = self.call("click", ref=self.ref(self.outline, "button \"Agent's"), expect=[{"js": "!!document.body"}])
            self.assertLess(time.time() - t0, 4)                            # its page answers nothing meanwhile
        self.assertTrue(got.get("isError"))
        self.assertIn("could not be checked: its page answered nothing in 1 s -- it is busy, or still opening another "
                      "page", self.said(got))


@unittest.skipUnless(browser.available(), "no Chrome here")
@unittest.skipUnless(browser.available(), "no Chrome here")
class ToldTest(ChromeBase):
    """What the agent did, as the user is shown it (`Browser.show`, the state's `actions`): in the past tense, naming
    what it acted on and the row it is in; what it didn't do and why, the element whose check failed outlined."""
    row, delete_in_row_1 = ExpectTest.row, ExpectTest.delete_in_row_1

    def setUp(self):
        super().setUp()
        self.text("navigate", url=self.write("invoices.html", INVOICES))
        self.outline = self.text("snapshot")

    def told(self) -> dict:
        return self.b.state()["actions"][-1]

    def test_a_click_is_told_done_naming_the_row_its_check_was_of_else_the_nearest(self):
        delete = self.delete_in_row_1()
        self.call("click", ref=delete, expect=[{"ref": self.row(1), "js": "el.innerText.includes('#4411')"}])
        a = self.told()
        self.assertEqual(a["text"], 'Clicked "Delete" in "Invoice #4411"')
        self.assertTrue(a["ok"])
        x, y = self.middle(delete)
        self.assertTrue(a["box"][0] <= x <= a["box"][0] + a["box"][2] and a["box"][1] <= y <= a["box"][1] + a["box"][3])
        self.assertIsNone(self.b.state()["acting"])                        # done: no more "Clicking ..."
        self.call("click", ref=delete)                                      # no check of its row: the row it is in
        self.assertEqual(self.told()["text"], 'Clicked "Delete" in "Invoice #4411"')
        self.call("click", ref=self.ref(self.outline, 'button "Show more'))
        self.assertEqual(self.told()["text"], 'Clicked "Show more"')         # in no row
        self.js("document.getElementById('a').onclick = function () { this.remove(); }")
        self.call("click", ref=self.ref(self.outline, "button \"Agent's"))
        self.assertEqual(self.told()["text"], 'Clicked "Agent\'s"')
        self.assertIsNone(self.told()["box"])                               # gone with its click: nothing to outline

    def test_while_it_acts_what_it_does_is_said(self):
        seen = []
        slow = threading.Thread(target=lambda: self.call("evaluate", expression="new Promise((r) => setTimeout(r, 600))",
                                                         says="reading the result links"))
        slow.start()
        self.until(lambda: (seen.append(self.b.state()["acting"]) or seen[-1]) is not None)
        slow.join()
        self.assertEqual(seen[-1]["label"], "Reading the result links")       # what it is for, in the agent's words
        self.assertEqual(self.told()["text"], "Ran a script reading the result links")
        self.assertIsNone(self.b.state()["acting"])
        n = len(self.b.state()["actions"])
        got = self.bs.call(self.key, "evaluate", {"expression": "1", "expect": HOLDS})   # without: refused, not shown
        self.assertIn("evaluate needs `says`", got["content"][0]["text"])
        self.assertEqual(len(self.b.state()["actions"]), n)
        real = browser.Browsers._t_snapshot
        with mock.patch.object(browser.Browsers, "_t_snapshot", lambda *a: (time.sleep(0.4), real(*a))[1]):
            looking = threading.Thread(target=lambda: self.call("snapshot"))
            looking.start()
            self.assertTrue(self.until(lambda: self.b.state()["reading"] == "Looking at the page"))   # as it looks
            looking.join()
        self.assertEqual(self.b.state()["reading"], "")

    def test_a_check_that_failed_says_what_its_row_reads_now_and_what_the_user_did(self):
        delete, row = self.delete_in_row_1(), self.row(1)
        self.click_as_user(self.ref(self.outline, 'button "Sort in place'))
        self.assertTrue(self.until(lambda: "4412" in self.js("rows.firstElementChild.innerText")))
        self.until(lambda: any("Sort in place" in w for _, w in self.b.lately))
        got = self.call("click", ref=delete, expect=[{"ref": row, "js": "el.innerText.includes('#4411')"}])
        self.assertTrue(got.get("isError"))
        a = self.told()
        self.assertFalse(a["ok"])
        self.assertEqual(a["text"], """Didn't click "Delete": its row now reads "Invoice #4412" (you clicked button "Sort in place")""")
        self.assertIn("Not done: expect 1 is false", a["detail"])            # what the agent was told
        x, y = self.middle(row)                                             # the row outlined, not the button: what
        width = self.js("rows.firstElementChild.getBoundingClientRect().width")     # it holds, not its whole width
        self.assertTrue(a["box"][1] <= y <= a["box"][1] + a["box"][3])
        self.assertTrue(self.middle(delete)[0] < a["box"][0] + a["box"][2] < width / 2, (a["box"], width))
        self.assertEqual(self.b.where(a["i"]), a["box"])                    # where it is now: the same
        self.call("click", ref=delete, expect=[{"js": "document.title === 'Elsewhere'"}])
        self.assertEqual(self.told()["text"], """Didn't click "Delete": the page is not as it expected (you clicked button "Sort in place")""")
        self.assertIsNone(self.told()["box"])

    def test_an_element_the_page_renamed_is_said_and_outlined(self):
        remove = self.ref(self.outline, 'button "Remove #4411')
        self.js("swap()")
        self.call("click", ref=remove)
        a = self.told()
        self.assertEqual(a["text"], """Didn't click "Remove #4411": it reads "Remove #4412" now (the page changed by itself)""")
        self.assertIsNotNone(a["box"])

    def test_what_was_typed_is_said_but_never_into_a_password(self):
        note, pw = self.ref(self.outline, 'textbox "Note'), self.ref(self.outline, 'textbox "Password')
        self.call("type", ref=note, text="hello", submit=True)
        self.assertEqual(self.told()["text"], 'Typed "hello" into "Note", then pressed Enter')
        self.call("type", ref=pw, text="s3cret")
        self.assertEqual(self.told()["text"], 'Typed into "Password"')
        self.assertNotIn("s3cret", json.dumps(self.b.state()))
        self.call("type", ref=note, text="")
        self.assertEqual(self.told()["text"], 'Cleared "Note"')

    def test_pages_and_tabs_are_told_as_the_user_would_say_them(self):
        page = self.serve("other.html", "<title>Other</title><p>hi")
        self.call("navigate", url=page)
        self.assertEqual(self.told()["text"], f"Opened {page[len('http://'):]}")
        self.call("back")
        self.assertEqual(self.told()["text"], "Went back")
        self.call("tabs", action="new")
        self.call("tabs", action="switch", index=1)
        self.assertEqual(self.told()["text"], 'Switched to tab 1 "Invoices"')
        self.call("tabs", action="close", index=2)
        self.assertEqual(self.told()["text"], 'Closed tab 2 "about:blank"')
        n = len(self.b.state()["actions"])
        self.text("tabs")                                                   # listing them does nothing to the page
        self.text("snapshot")
        self.assertEqual(len(self.b.state()["actions"]), n)

    def test_a_call_missing_its_checks_is_not_listed_the_latest_ten_are_and_where_they_are_now(self):
        more = self.ref(self.outline, 'button "Show more')
        self.assertEqual([a["text"] for a in self.b.state()["actions"]], ['Opened "invoices.html"'])
        self.bs.call(self.key, "click", {"ref": more})                       # the agent's slip, told it alone
        self.assertEqual(len(self.b.state()["actions"]), 1)
        for _ in range(12):
            self.call("click", ref=more)
        listed = self.b.state()["actions"]
        self.assertEqual(len(listed), browser.SHOWN_KEEP)
        self.assertEqual([a["i"] for a in listed], list(range(4, 14)))
        self.assertTrue(self.b.where(13))                                    # still there
        self.js("document.querySelectorAll('button')[2].remove()")
        self.assertIsNone(self.b.where(13))                                  # gone
        self.assertIsNone(self.b.where(99))


@unittest.skipUnless(browser.available(), "no Chrome here")
class StepsTest(ChromeBase):
    """`steps`: several actions in one call, in order, each with its own checks; stopped at the first not done."""

    def setUp(self):
        super().setUp()
        self.text("navigate", url=self.write("invoices.html", INVOICES))
        self.outline = self.text("snapshot")
        self.note, self.a, self.b_ = (self.ref(self.outline, 'textbox "Note'), self.ref(self.outline, "button \"Agent's"),
                                      self.ref(self.outline, "button \"User's"))

    def said(self, got: dict) -> str:
        return "\n".join(c["text"] for c in got["content"] if c.get("type") == "text")

    def test_each_runs_in_order_its_checks_of_what_the_steps_before_did_and_the_rest_stop_at_one_not_done(self):
        typed = {"ref": self.note, "js": "el.value === 'hello'"}
        got = self.bs.call(self.key, "steps", {"steps": [
            {"tool": "type", "ref": self.note, "text": "hello", "expect": [{"ref": self.note, "js": "el.value === ''"}]},
            {"tool": "click", "ref": self.a, "expect": [typed]},
            {"tool": "click", "ref": self.b_, "expect": [typed]}]})
        self.assertFalse(got.get("isError"), got)
        said = self.said(got)
        self.assertIn('Step 1 of 3, type: Typed 5 characters into textbox "Note"', said)
        self.assertIn("Step 3 of 3, click: Clicked button \"User's\"", said)
        self.assertEqual(self.js("order.textContent"), "AB")
        self.assertEqual([a["text"] for a in self.b.state()["actions"]][-3:],
                         ['Typed "hello" into "Note"', "Clicked \"Agent's\"", "Clicked \"User's\""])   # each shown
        got = self.bs.call(self.key, "steps", {"steps": [
            {"tool": "click", "ref": self.a, "expect": [typed]},
            {"tool": "click", "ref": self.b_, "expect": [{"ref": self.note, "js": "el.value === 'bye'"}]},
            {"tool": "click", "ref": self.a, "expect": [typed]},
            {"tool": "click", "ref": self.a, "expect": [typed]}]})
        self.assertTrue(got.get("isError"))
        said = self.said(got)
        self.assertIn("Step 2 of 4, click: Not done: expect 1 is false: el.value === 'bye'", said)
        self.assertIn("Stopped there: steps 3-4 not run.", said)
        self.assertEqual(self.js("order.textContent"), "ABA")            # the first only
        self.assertFalse(self.b.state()["actions"][-1]["ok"])

    def test_text_appended_goes_at_the_end_of_what_the_field_holds(self):
        self.js("note.value = 'michigan primary results'")
        self.text("type", ref=self.note, text=" 2026", append=True)
        self.assertEqual(self.js("note.value"), "michigan primary results 2026")   # not at its start, where focus put it
        self.js("note.setSelectionRange(0, 8)")                              # some of it selected: still at the end
        self.text("type", ref=self.note, text="!", append=True)
        self.assertEqual(self.js("note.value"), "michigan primary results 2026!")
        self.text("type", ref=self.note, text="new")                         # not appended: what it holds replaced
        self.assertEqual(self.js("note.value"), "new")

    def test_the_page_after_them_with_snapshot(self):
        more = self.ref(self.outline, 'button "Show more')
        got = self.bs.call(self.key, "steps", {"steps": [{"tool": "click", "ref": more, "expect": [
            {"ref": more, "js": "el.innerText === 'Show more'"}]}], "snapshot": True})
        said = self.said(got)
        self.assertIn('Step 1 of 1, click: Clicked button "Show more"', said)
        self.assertIn("The page after them:\npage: Invoices", said)
        self.assertIn('button "Show less"', said)

    def test_a_step_is_one_of_the_tools_that_act_given_as_its_own_call_or_as_json(self):
        got = self.bs.call(self.key, "steps", {"steps": [{"tool": "snapshot"}, {"tool": "click", "ref": self.a,
                                                                                 "expect": HOLDS}]})
        self.assertTrue(got.get("isError"))
        self.assertIn('a step is a call of one of', self.said(got))
        self.assertIn("Stopped there: step 2 not run.", self.said(got))
        self.assertEqual(self.js("order.textContent"), "")
        n = len(self.b.state()["actions"])
        got = self.bs.call(self.key, "steps", {"steps": [{"tool": "click", "ref": self.a}]})   # no checks: its slip
        self.assertIn("needs `expect`", self.said(got))
        self.assertEqual(len(self.b.state()["actions"]), n)               # not shown the user
        got = self.bs.call(self.key, "steps", {"steps": json.dumps([{"tool": "click", "args": {"ref": self.a},
                                                                      "expect": HOLDS}])})
        self.assertFalse(got.get("isError"), got)
        self.assertEqual(self.js("order.textContent"), "A")
        self.assertIn("needs a list of steps", self.said(self.bs.call(self.key, "steps", {"steps": []})))
        listed = {t["name"]: t for t in browser.TOOLS}
        self.assertEqual(listed["steps"]["inputSchema"]["required"], ["steps"])
        self.assertIn("## Several actions in one call", browser.instructions())


@unittest.skipUnless(browser.available(), "no Chrome here")
class WatchedTest(ChromeBase):
    """While the user watches, each action is shown coming (`next`) PACE seconds before it is done, and Esc stops it:
    that one, the rest of its steps, and every action after until their next message."""

    def setUp(self):
        super().setUp()
        self.text("navigate", url=self.write("invoices.html", INVOICES))
        self.outline = self.text("snapshot")
        self.a, self.b_ = self.ref(self.outline, "button \"Agent's"), self.ref(self.outline, "button \"User's")
        self.viewer = self.b.join(page="pg", visible=True)
        self.addCleanup(self.b.leave, self.viewer)

    def said(self, got: dict) -> str:
        return "\n".join(c["text"] for c in got["content"] if c.get("type") == "text")

    def in_thread(self, name: str, **args):
        done = []
        t = threading.Thread(target=lambda: done.append(self.call(name, **args)))
        t.start()
        return t, done

    def test_an_action_is_shown_coming_while_watched_and_not_when_its_tab_is_behind(self):
        seen, start = [], time.time()
        t, done = self.in_thread("click", ref=self.a)
        self.until(lambda: (seen.append(self.b.state()["next"]) or seen[-1]) is not None)
        t.join()
        took = time.time() - start
        nxt = seen[-1]
        self.assertEqual(nxt["label"], "Clicking \"Agent's\"")
        self.assertEqual(nxt["tool"], "click")
        x, y = self.middle(self.a)
        self.assertTrue(nxt["box"][0] <= x <= nxt["box"][0] + nxt["box"][2] and nxt["box"][1] <= y <= nxt["box"][1] + nxt["box"][3])
        self.assertGreaterEqual(took, browser.PACE)
        self.assertIsNone(self.b.state()["next"])
        self.assertEqual(self.js("order.textContent"), "A")
        self.b.watch("pg", False)                                           # nobody watching: at full speed
        start = time.time()
        self.call("click", ref=self.a)
        self.assertLess(time.time() - start, browser.PACE)
        self.assertEqual(self.js("order.textContent"), "AA")

    def test_what_acts_outside_the_page_is_shown_where_it_acts(self):
        seen = []
        def coming(name, **args):
            seen.clear()
            t = threading.Thread(target=lambda: self.call(name, **args))
            t.start()
            self.until(lambda: (seen.append(self.b.state()["next"]) or seen[-1]) is not None)
            t.join()
            return seen[-1]
        page = self.write("other.html", "<title>Other</title><p>hi")
        nxt = coming("navigate", url=page)
        self.assertEqual((nxt["tool"], nxt["cue"], nxt["box"]), ("navigate", {"url": f"file://{page}"}, None))
        self.assertEqual(coming("press", key="Enter")["cue"], {"key": "Enter"})
        self.assertEqual(coming("scroll", direction="up")["cue"], {"direction": "up"})
        self.assertEqual(coming("tabs", action="new")["cue"], {"action": "new", "index": None})
        self.assertEqual(coming("tabs", action="switch", index=1)["cue"], {"action": "switch", "index": 1})
        nxt = coming("evaluate", expression="document.title", says="reading the title")     # a script: shown coming too
        self.assertEqual(nxt["label"], "Reading the title")

    def test_esc_stops_the_action_shown_coming_and_every_one_after_until_the_user_s_next_message(self):
        t, done = self.in_thread("click", ref=self.a)
        self.assertTrue(self.until(lambda: self.b.state()["next"] is not None))
        self.b.stop()
        t.join()
        self.assertTrue(done[0].get("isError"))
        self.assertIn("the user pressed Esc to stop you, before this was done", self.said(done[0]))
        self.assertEqual(self.js("order.textContent"), "")                 # not clicked
        self.assertEqual(self.b.state()["actions"][-1]["text"], "Didn't click \"Agent's\": you stopped it (Esc)")
        self.assertIn("the user stopped you (Esc)", self.said(self.call("click", ref=self.b_)))
        self.assertIn("page: Invoices", self.text("snapshot"))              # looking still is
        self.assertIn("pressed Esc to stop you", self.told(self.b))        # told the agent
        self.b.sent()
        self.b.watch("pg", False)
        self.text("click", ref=self.b_)
        self.assertEqual(self.js("order.textContent"), "B")

    def test_esc_during_steps_stops_the_rest(self):
        done = []
        t = threading.Thread(target=lambda: done.append(self.bs.call(self.key, "steps", {"steps": [
            {"tool": "click", "ref": self.a, "expect": HOLDS}, {"tool": "click", "ref": self.b_, "expect": HOLDS},
            {"tool": "click", "ref": self.a, "expect": HOLDS}]})))
        t.start()
        self.assertTrue(self.until(lambda: self.b.state()["playing"]))
        self.assertTrue(self.until(lambda: (self.b.state()["next"] or {}).get("label") == "Clicking \"User's\"", 5))
        self.b.stop()
        t.join()
        said = self.said(done[0])
        self.assertIn("Step 2 of 3, click: Not done: the user pressed Esc", said)
        self.assertIn("Stopped there: step 3 not run.", said)
        self.assertEqual(self.js("order.textContent"), "A")
        self.assertFalse(self.b.state()["playing"])

    def test_text_typed_while_watched_appears_a_character_at_a_time(self):
        note = self.ref(self.outline, 'textbox "Note')
        self.js("window.inputs = 0; note.addEventListener('input', () => inputs++)")
        start = time.time()
        self.text("type", ref=note, text="hello world")
        self.assertEqual(self.js("note.value"), "hello world")
        self.assertEqual(self.js("inputs"), 11)                            # one input per character
        self.assertLess(time.time() - start, browser.PACE + browser.TYPE_SHOWN + 1.5)


class UsersChromeTest(Home):
    """"mine" against a stand-in for the user's Chrome -- one with its debugging on (headless here, a profile of its
    own): reached over a WebSocket, the Browser's tab hidden in it, closed when the dashboard stops, the Chrome left
    running; and a change of `browser_profile` taken at the next use, the tabs opened again in the other Chrome."""

    def setUp(self):
        super().setUp()
        self.user = os.path.join(self.tmp.name, "userchrome")
        self.chrome = subprocess.Popen([browser.executable(), "--headless=new", "--remote-debugging-port=0",
                                        f"--user-data-dir={self.user}", "--no-first-run", "about:blank"],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        self.addCleanup(browser.group_ended, self.chrome.pid)         # its helpers too, before its profile is removed
        self.addCleanup(self.chrome.wait, 10)
        self.addCleanup(self.chrome.terminate)
        end = time.time() + 15
        while time.time() < end and not os.path.exists(os.path.join(self.user, "DevToolsActivePort")):
            time.sleep(0.1)
        dirs = mock.patch.dict(browser.USER_DIRS, {sys.platform: [self.user]})
        dirs.start()
        self.addCleanup(dirs.stop)
        self.bs = self.browsers()
        self.addCleanup(self.bs.close)
        self.cfg = self.bs.keep(secrets.token_hex(8), self.root, "g")
        self.b = self.bs.get(self.cfg["key"])

    def text(self, name: str, **args) -> str:
        got = self.bs.call(self.cfg["key"], name, checked(name, args))
        self.assertFalse(got.get("isError"), got)
        return got["content"][0]["text"]

    @unittest.skipUnless(sys.platform == "darwin", "on Linux no frame comes from a tab hidden in the user's Chrome "
                                                   "(ag_dashboard/TODO.md: Browser, Linux)")
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
        for features, popup in ((["noopener", "width=500", "height=600"], True), (["popup"], True), (["left=10"], True),
                                (["noopener"], False), (["noopener", "noreferrer"], False), ([], False), (None, False)):
            self.assertIs(browser.popup_window(features), popup, features)

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
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        self.addCleanup(browser.group_ended, self.chrome.pid)         # its helpers too, before its profile is removed
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
        bs = self.browsers()
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
        again = self.browsers()
        self.addCleanup(again.close)
        self.assertEqual(self.ours(again)["sid"]["value"], "secret-1")

    def test_with_the_user_s_chrome_used_already_there_is_nothing_to_import(self):
        self.config('[dashboard]\nbrowser_profile = "mine"\n')
        bs = self.browsers()
        self.addCleanup(bs.close)
        with self.assertRaisesRegex(browser.BrowserError, "own Chrome"):
            bs.login_sites()


if __name__ == "__main__":
    unittest.main()
