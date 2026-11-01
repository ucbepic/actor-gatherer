"""A Browser's screen as video (browser.py), for the dashboard's own Chrome: sharper and quicker than the screencast's
JPEG frames, which stay for the user's own Chrome and whenever the video can't run.

    the capture   a CAPTURER: a page of the dashboard's own in that Chrome (a file of the home's, so a secure page, as
                  the capture and the encoder need), one per Browser. It captures the Browser's tab -- the one shown --
                  with getDisplayMedia, as a page shares a tab in a video call. Chrome is started with
                  --auto-select-tab-capture-source-by-title=TOKEN, so the tab picked is the one titled TOKEN: the tab is
                  titled so for the moment the capture starts, then given its own title back (`Capture.start`, one at a
                  time). Started from another page, the capture follows the tab across its navigations
    the encoding  each frame the tab makes (only when it changes) H.264, as a call's video is -- a key frame (all of it)
                  first, then what changed: a click's frame some KB, not a whole JPEG. The software encoder first (it
                  answers at once); the hardware one, which takes some seconds to start the first time in a Chrome,
                  warmed up meanwhile and taken over to once it answers. A frame's size changing (the view resized): a
                  new encoder, a key frame
    the chunks    to the Browser (a binding, over the DevTools connection), to each page watching it that can decode
                  video (`Viewer`, the page's stream): it draws them on a canvas where the JPEG frames' image was. A page
                  joining, or behind, gets a key frame made again of the last frame: a page not changing makes none
    the input     as with the JPEG frames: the page's clicks and keys to the tab, at the same places (the video is the
                  page at its own size, from its top left)

Standard library only."""
import json
import os
import secrets
import threading
import time
from typing import Callable, Optional

TOKEN = "ag-capture-" + secrets.token_hex(6)   # the title the dashboard's own Chrome picks a tab to capture by
FLAG = f"--auto-select-tab-capture-source-by-title={TOKEN}"
BINDING = "__agVideo"
START_TRIES = 3             # a capture's start tried so many times (it can fail on Chrome's side, now and then)
LOAD_WAIT = 3.0             # seconds a tab still loading is waited for before its capture starts all the same
GIVE_UP = 3                 # captures failed in a row before the Browser keeps to JPEG frames (until its Chrome restarts)
KEEP_CHUNKS = 120           # a page's backlog of chunks (about 2 s of frames) before it is dropped for a new key frame

PAGE = r"""<!doctype html><meta charset="utf-8"><title>ag capture</title>
<script>
// The capturer (browser_video.py): the Browser's tab captured, encoded, each chunk sent as __agVideo(JSON).
const send = (m) => __agVideo(JSON.stringify(m));
const START_WAIT = 3000;
const CODECS = ['avc1.640033', 'avc1.4d0033', 'avc1.42e033', 'vp09.00.51.08', 'vp8'];
let track = null, enc = null, encHw = false, warm = null, hwReady = false, hwNo = false;
let W = 0, H = 0, codec = null, last = null, tick = 0, keyNext = true, gen = 0, chain = Promise.resolve();
const settings = (c, w, h, accel) => ({ codec: c, width: w, height: h, bitrate: 20e6, framerate: 60, latencyMode: 'realtime',
  hardwareAcceleration: accel, ...(c.startsWith('avc1') ? { avc: { format: 'annexb' } } : {}) });
async function pick(w, h, accel) {
  for (const c of CODECS) { try { if ((await VideoEncoder.isConfigSupported(settings(c, w, h, accel))).supported) return c; } catch (e) {} }
  return null;
}
function b64(u8) { let t = ''; for (let i = 0; i < u8.length; i += 0x8000) t += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(t); }
function make(c, w, h, accel) {
  const mine = ++gen;                                   // a replaced encoder's late output is dropped
  const e = new VideoEncoder({
    output: (chunk) => { if (mine !== gen) return; const u = new Uint8Array(chunk.byteLength); chunk.copyTo(u);
      send({ t: chunk.type, ts: chunk.timestamp, d: b64(u), ...(chunk.type === 'key' ? { codec: c, w, h } : {}) }); },
    error: (err) => { if (mine === gen) send({ error: 'encoder: ' + err.message }); } });
  e.configure(settings(c, w, h, accel));
  return e;
}
function warmUp(w, h) {                                // the hardware encoder started, and fed a frame, until it answers
  if (warm || hwReady || hwNo) return;
  warm = 'starting';
  pick(w, h, 'prefer-hardware').then((c) => {
    if (!c || !last) { hwNo = !c; warm = null; return; }
    const src = last.clone();
    warm = new VideoEncoder({ output: () => { if (hwReady) return; hwReady = true; try { warm.close(); } catch (e) {} warm = null; agKey(); },
      error: () => { hwNo = true; warm = null; } });
    warm.configure(settings(c, w, h, 'prefer-hardware'));
    warm.encode(src, { keyFrame: true }); src.close();
  }).catch(() => { hwNo = true; warm = null; });
}
async function onFrame(f) {
  const r = f.visibleRect, w = r.width & ~1, h = r.height & ~1;
  if (!w || !h || !track) { f.close(); return; }
  if (w !== W || h !== H || !enc || (hwReady && !encHw)) {
    if (enc) { try { enc.close(); } catch (e) {} enc = null; }
    W = w; H = h; keyNext = true;
    const accel = hwReady ? 'prefer-hardware' : 'prefer-software';
    codec = (await pick(w, h, accel)) || (await pick(w, h, 'no-preference'));
    if (!codec) { f.close(); send({ error: `no video encoder for ${w}x${h}` }); return; }
    enc = make(codec, w, h, accel); encHw = hwReady;
  }
  const g = new VideoFrame(f, { timestamp: ++tick * 16667, visibleRect: { x: r.x, y: r.y, width: w, height: h } });
  f.close();
  if (last) last.close();
  last = g.clone();
  warmUp(w, h);
  if (enc.encodeQueueSize > 4) { keyNext = true; g.close(); return; }   // behind: this one skipped, a key frame next
  enc.encode(g, { keyFrame: keyNext }); keyNext = false; g.close();
}
const queue = (f) => (chain = chain.then(() => onFrame(f)).catch((e) => send({ error: 'frame: ' + e })));
async function pump(t) {
  const reader = new MediaStreamTrackProcessor({ track: t }).readable.getReader();
  for (;;) {
    let got; try { got = await reader.read(); } catch (e) { break; }
    if (got.done || track !== t) { if (got.value) got.value.close(); break; }
    await queue(got.value);
  }
}
const want = (w, h) => ({ frameRate: 60, width: { ideal: w, max: 4096 }, height: { ideal: h, max: 4096 } });
let asking = 0;
window.agStart = async (w, h) => {
  agStop();
  const mine = ++asking;
  const asked = navigator.mediaDevices.getDisplayMedia({ video: want(w, h), audio: false, preferCurrentTab: false,
    selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude' });
  // no tab titled so (its page put its own title back first): Chrome would wait on a choice no one makes
  asked.then((s) => { if (mine !== asking || track) s.getTracks().forEach((t) => t.stop()); }, () => {});
  const s = await Promise.race([asked, new Promise((_, no) => setTimeout(() => no(new Error('no tab picked')), START_WAIT))]);
  if (mine !== asking) { s.getTracks().forEach((t) => t.stop()); throw new Error('started again'); }
  const t = track = s.getVideoTracks()[0];
  t.onended = () => { if (track === t) { track = null; send({ ended: true }); } };
  pump(t);
  const st = t.getSettings();
  return `${st.width}x${st.height}`;
};
window.agSize = (w, h) => { if (track) track.applyConstraints(want(w, h)).catch(() => {}); };
window.agKey = () => { if (track && last) { keyNext = true; queue(last.clone()); } };
window.agStop = () => {
  if (track) { const t = track; track = null; t.onended = null; t.stop(); }
  if (enc) { try { enc.close(); } catch (e) {} enc = null; }
  gen++; W = H = 0;
  if (last) { last.close(); last = null; }
};
</script>"""


def page_path(home_dir: str) -> str:
    """The capturer's page: a file of the home's (a file is a secure page: the capture and the encoder need one)."""
    path = os.path.join(home_dir, "dashboard", "capture.html")
    try:
        with open(path, encoding="utf-8") as fh:
            if fh.read() == PAGE:
                return path
    except OSError:
        pass
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(PAGE)
    os.replace(tmp, path)
    return path


START_LOCK = threading.Lock()   # one capture started at a time: TOKEN picks one tab
WINDOWS = threading.Lock()      # a window opened (a tab, attached) or resized, one at a time: Chrome has been seen to
                                # answer neither a resize of a captured tab's window nor an attach to a tab opening then
RESIZE_WAIT = 3.0               # the most a window's resize is waited for


class Capture:
    """One Browser's video (module doc): its capturer page, the tab it captures, whether its chunks come. Its calls to
    Chrome go through the Browser's connection; `got` is handed each binding call of the capturer page -- on the
    connection's reader, which must never wait on a call to Chrome: `lock` guards the fields only and is never held over
    a call; `busy` (a start, a move to another tab, a resize, one at a time) is, and is never taken on the reader."""

    def __init__(self, owner: Callable[[str], None], home_dir: str, later: Callable[[Callable], None],
                 on_change: Callable[[], None]):
        self.own = owner                    # registers a target or session id as the Browser's (its events routed to it)
        self.home_dir = home_dir
        self.later = later                  # a job run off the connection's reader (which a call to Chrome would block)
        self.on_change = on_change          # the Browser to look again at what it sends (`_recast`): video came or went
        self.lock = threading.RLock()
        self.busy = threading.Lock()
        self.cdp = None
        self.target: Optional[str] = None
        self.session: Optional[str] = None
        self.tab = None                     # the Tab captured now
        self.starting = None                # the Tab whose capture is starting: its first chunks come before it has
        self.view = (0, 0, 1.0)             # the view it was asked for: width, height (the page's pixels), density
        self.bars = 0                       # the height of a window's own bars in the Chrome (a window is sized so its
                                            # page is the view: the capture is of the window's page, at its size)
        self.extra = 0                      # more, in the captured tab's window: Chrome's "sharing this tab" bar,
        self.fixes = 0                      # learned from the frames' size (`got`), so many times at most
        self.ok = False                     # chunks come: the JPEG frames can stop
        self.waiting = None                 # a tab to capture once it has loaded (its page would undo its title)
        self.waited = 0.0                   # since when
        self.failed = 0
        self.why = ""                       # why it last failed

    def usable(self) -> bool:
        return self.failed < GIVE_UP

    def _page(self, cdp) -> str:
        """The capturer page's session in `cdp`'s Chrome, opened if it isn't."""
        if self.cdp is cdp and self.session is not None:
            return self.session
        with WINDOWS:
            self.target = cdp.call("Target.createTarget", {"url": "about:blank", "newWindow": True})["targetId"]
            self.session = cdp.call("Target.attachToTarget", {"targetId": self.target, "flatten": True})["sessionId"]
        self.cdp = cdp
        self.own(self.target)
        self.own(self.session)
        cdp.call("Runtime.enable", {}, self.session)       # its binding's calls are told only with it
        cdp.call("Runtime.addBinding", {"name": BINDING}, self.session)
        cdp.call("Page.enable", {}, self.session)
        cdp.call("Page.navigate", {"url": "file://" + page_path(self.home_dir)}, self.session)
        end = time.time() + 10
        while time.time() < end:
            got = cdp.call("Runtime.evaluate", {"expression": "typeof agStart", "returnByValue": True}, self.session)
            if (got.get("result") or {}).get("value") == "function":
                break
            time.sleep(0.05)
        else:
            raise ValueError("the capture page did not load")
        window = cdp.call("Browser.getWindowForTarget", {"targetId": self.target})["windowId"]   # its bars, measured:
        for height in (600, 640):                        # the same at two heights, so not read before the page resized
            with WINDOWS:
                cdp.call("Browser.setWindowBounds", {"windowId": window, "bounds": {"width": 800, "height": height}},
                         timeout=RESIZE_WAIT)
            bars, end = None, time.time() + 2
            while time.time() < end:
                inner = cdp.call("Runtime.evaluate", {"expression": "innerHeight", "returnByValue": True}, self.session)
                got = height - int((inner.get("result") or {}).get("value") or 0)
                if got == bars:
                    break
                bars = got
                time.sleep(0.05)
        self.bars = max(0, bars or 0)
        return self.session

    def _fit(self, cdp, tab, view) -> bool:
        """The tab's window sized so its page is the view: what the capture takes (its window's page, at its size).
        True: it was resized (a frame taken now could still be of the old size)."""
        try:
            got = cdp.call("Browser.getWindowForTarget", {"targetId": tab.target})
            want = {"width": int(view[0]), "height": int(view[1]) + self.bars + self.extra}
            bounds = got.get("bounds") or {}
            if bounds.get("windowState") == "normal" and all(bounds.get(k) == v for k, v in want.items()):
                return False
            with WINDOWS:
                cdp.call("Browser.setWindowBounds", {"windowId": got["windowId"], "bounds": {"windowState": "normal"}},
                         timeout=RESIZE_WAIT)
                cdp.call("Browser.setWindowBounds", {"windowId": got["windowId"], "bounds": want}, timeout=RESIZE_WAIT)
            return True
        except (ValueError, KeyError):
            return False

    def follow(self, cdp, tab, view) -> None:
        """`tab` captured, at `view` (width, height -- the page's pixels -- and density): started, moved to it, or
        resized."""
        px = (int(view[0] * view[2]), int(view[1] * view[2]))
        with self.busy:
            with self.lock:
                same = self.tab is tab and self.cdp is cdp
                resized = same and view != self.view
                if resized:
                    self.view = view
                usable = self.usable()
            if same:
                if resized:
                    self._fit(cdp, tab, view)
                    cdp.post("Runtime.evaluate", {"expression": f"agSize({px[0]}, {px[1]})"}, self.session)
                return
            if not usable:
                return
            if getattr(tab, "loading", False) and not (self.waiting is tab and time.time() - self.waited > LOAD_WAIT):
                if self.waiting is not tab:              # its page loading would put its own title back: once loaded
                    self.waiting, self.waited = tab, time.time()   # (a page loading on and on: after LOAD_WAIT)
                    timer = threading.Timer(LOAD_WAIT + 0.1, self.on_change)
                    timer.daemon = True
                    timer.start()
                self.stop()                              # the JPEG frames meanwhile: another tab's video stopped
                return
            self.waiting = None
            for attempt in range(START_TRIES):
                try:
                    self._start(cdp, tab, view, px)
                    return
                except ValueError as exc:                # BrowserError and CdpError are ValueErrors
                    error = exc
                finally:
                    with self.lock:
                        self.starting = None
            self._failed(f"the video did not start: {error}")

    def _start(self, cdp, tab, view, px) -> None:
        session = self._page(cdp)
        if self._fit(cdp, tab, view):
            time.sleep(0.25)                             # resized: the first frame (the only one, if the page is still)
        cdp.call("Page.bringToFront", {}, session)       # the capture is started only by a page in front
        with self.lock:
            self.starting, self.view = tab, view
        with START_LOCK:
            got = cdp.call("Runtime.evaluate", {"returnByValue": True, "expression":
                           f"(() => {{ const t = document.title; document.title = {json.dumps(TOKEN)}; return t; }})()"},
                           tab.session)
            title = (got.get("result") or {}).get("value")
            try:
                got = cdp.call("Runtime.evaluate", {"expression": f"agStart({px[0]}, {px[1]})", "awaitPromise": True,
                                                    "userGesture": True, "returnByValue": True}, session, timeout=8)
            finally:
                if isinstance(title, str):
                    cdp.call("Runtime.evaluate", {"expression": f"document.title = {json.dumps(title)}"}, tab.session)
        try:
            cdp.call("Page.bringToFront", {}, tab.session)   # the tab in front again: shown in its window
        except ValueError:
            pass
        if got.get("exceptionDetails"):
            raise ValueError(((got["exceptionDetails"].get("exception") or {}).get("description") or "failed").split("\n")[0])
        with self.lock:
            self.tab = tab

    def _failed(self, why: str) -> None:
        """It stopped, or did not start: the JPEG frames again (the Browser told), the capture tried again on its next
        use, until GIVE_UP in a row."""
        with self.lock:
            self.failed += 1
            self.tab, self.ok, self.why = None, False, why
            cdp, session = self.cdp, self.session
        if cdp is not None and session is not None:
            try:
                cdp.post("Runtime.evaluate", {"expression": "agStop()"}, session)
            except ValueError:
                pass
        self.on_change()

    def _refit(self) -> None:
        """The tab's window grown by what its frames lacked; a frame drawn again (a still page makes none itself)."""
        with self.busy:
            with self.lock:
                tab, view, cdp = self.tab or self.starting, self.view, self.cdp
            if tab is None or cdp is None or not self._fit(cdp, tab, view):
                return
            time.sleep(0.15)
            self.redraw(cdp, tab)

    @staticmethod
    def redraw(cdp, tab) -> None:
        """A new frame of the tab, nothing on it changed: an invisible highlight shown and hidden (it is drawn as the
        page is, so the capture takes a frame)."""
        try:
            cdp.call("Overlay.highlightRect", {"x": 0, "y": 0, "width": 1, "height": 1, "color": {"r": 0, "g": 0, "b": 0, "a": 0}},
                     tab.session)
            time.sleep(0.05)
            cdp.call("Overlay.hideHighlight", {}, tab.session)
        except ValueError:
            pass

    def key(self) -> None:
        """A key frame of what the tab shows now: for a page joining, or one behind."""
        with self.lock:
            cdp, session = (self.cdp, self.session) if self.tab is not None else (None, None)
        if cdp is not None:
            try:
                cdp.post("Runtime.evaluate", {"expression": "agKey()"}, session)
            except ValueError:
                pass

    def stop(self) -> None:
        """No page watching: the capture stopped (its page kept, for the next)."""
        with self.lock:
            if self.tab is None:
                return
            self.tab, self.ok = None, False
            cdp, session = self.cdp, self.session
        try:
            cdp.post("Runtime.evaluate", {"expression": "agStop()"}, session)
        except ValueError:
            pass

    def gone(self) -> None:
        """Its Chrome stopped, or its page closed: all of it to make again."""
        with self.lock:
            self.cdp = self.target = self.session = self.tab = None
            self.ok = False
            self.failed = 0

    def got(self, payload: str) -> Optional[dict]:
        """What the capturer page sent: a chunk (returned, for the Browser's pages), or that it stopped."""
        try:
            m = json.loads(payload)
        except ValueError:
            return None
        if not isinstance(m, dict):
            return None
        if m.get("error") or m.get("ended"):
            self._failed(str(m.get("error") or "the capture ended"))
            return None
        if m.get("t") not in ("key", "delta"):
            return None
        with self.lock:
            if self.tab is None and self.starting is None:
                return None
            first = not self.ok
            self.ok, self.failed = True, 0
            w, h, dpr = self.view
            want = (int(w * dpr), int(h * dpr))
            if m["t"] == "key" and m.get("w") == want[0] and isinstance(m.get("h"), int) and m["h"] != want[1] \
                    and abs(want[1] - m["h"]) < 400 * dpr and self.fixes < 3:   # the window's page short of the view
                self.fixes += 1
                self.extra += round((want[1] - m["h"]) / dpr)
                self.later(self._refit)
        if first:
            self.on_change()
        chunk = {"t": m["t"], "ts": m.get("ts") or 0, "d": m.get("d") or ""}
        if m["t"] == "key":
            chunk.update(codec=m.get("codec"), w=m.get("w"), h=m.get("h"))
        return chunk
