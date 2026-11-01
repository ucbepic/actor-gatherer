"""A Browser's screen as video (browser.py), for the dashboard's own Chrome: sharper and quicker than the screencast's
JPEG frames, which stay for the user's own Chrome and whenever the video can't run.

    the capture   a CAPTURER: a page of an extension of the dashboard's (EXTENSION, written to the home and loaded into
                  that Chrome over its pipe: Extensions.loadUnpacked, Chrome started with
                  --enable-unsafe-extension-debugging), one page per Browser. The extension's button is pressed on the
                  Browser's tab shown (Extensions.triggerAction): that lets it capture the tab (chrome.tabCapture, as
                  an extension that shares a tab in a call does), and the capturer opens the stream at the view's size.
                  Nothing on the page is touched; the capture follows the tab across its navigations
    the encoding  each frame the tab makes (only when it changes) H.264, as a call's video is -- a key frame (all of it)
                  first, then what changed: a click's frame some KB, not a whole JPEG. The software encoder first (it
                  answers at once); the hardware one, which takes some seconds to start the first time in a Chrome,
                  warmed up meanwhile and taken over to once it answers. A frame's size changing (the view resized): a
                  new encoder, a key frame
    the chunks    to the Browser (a binding, over the DevTools connection), to each page watching it that can decode
                  video (`Viewer`, the page's stream): it draws them on a canvas where the JPEG frames' image was. A page
                  joining, or behind, gets a key frame made again of the last frame: a page not changing makes none
    the sizes     the capture is of the tab's window's page, at its size: each tab has a window of its own (browser.py's
                  `new_target`), sized to the view -- the window's bars measured once on the capturer's window; more,
                  if any, learned from the first key frame being short of the view (`got`)
    the input     as with the JPEG frames: the page's clicks and keys to the tab, at the same places (the video is the
                  page at its own size, from its top left)

Standard library only."""
import json
import os
import sys
import threading
import time
from typing import Callable, Dict, Optional

FLAGS = ["--enable-unsafe-extension-debugging",   # the dashboard's own Chrome: an extension loaded over its pipe
         "--force-device-scale-factor=2"]           # its screen at 2x: the JPEG frames, where no video, sharp too
BINDING = "__agVideo"
START_TRIES = 2             # a capture's start tried so many times (it can fail on Chrome's side, now and then)
START_WAIT = 2.0            # seconds a start is waited for
SETTLE = 0.4                # seconds a view's size is to stay before its capture starts again at it (a pane dragged)
GIVE_UP = 3                 # starts failed in a row before the Browser keeps to JPEG frames -- for that tab, until it
                            # goes to another page or another tab is shown
KEEP_CHUNKS = 120           # a page's backlog of chunks (about 2 s of frames) before it is dropped for a new key frame
RESIZE_WAIT = 3.0           # the most a window's resize is waited for
WINDOWS = threading.Lock()  # a window opened (a tab, attached) or resized, one at a time: Chrome has been seen to answer
                            # neither a resize of a captured tab's window nor an attach to a tab opening then
START_LOCK = threading.Lock()   # one capture started at a time: the extension's answer goes to the capturer waiting

MANIFEST = {"manifest_version": 3, "name": "ag capture", "version": "1.0", "description": "The ag dashboard's Browser, as video",
            "permissions": ["tabCapture", "activeTab"], "action": {}, "background": {"service_worker": "worker.js"}}

WORKER = r"""// Its button pressed on a tab (by the dashboard, Extensions.triggerAction): a stream id for the tab, to the capturer.
chrome.action.onClicked.addListener(async (tab) => {
  try { chrome.runtime.sendMessage({ streamId: await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }) }); }
  catch (e) { chrome.runtime.sendMessage({ error: String((e && e.message) || e) }); }
});
"""

PAGE = """<!doctype html><meta charset="utf-8"><title>ag capture</title><script src="capture.js"></script>"""

SCRIPT = r"""// The capturer (browser_video.py): the Browser's tab captured, encoded, each chunk sent as __agVideo(JSON).
const send = (m) => __agVideo(JSON.stringify(m));
const CODECS = ['avc1.640033', 'avc1.4d0033', 'avc1.42e033', 'vp09.00.51.08', 'vp8'];
let track = null, enc = null, encHw = false, warm = null, hwReady = false, hwNo = false, armed = null, status = 'idle';
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
const size = (w, h) => ({ minWidth: w, maxWidth: w, minHeight: h, maxHeight: h, maxFrameRate: 60 });
chrome.runtime.onMessage.addListener((m) => {           // the extension's answer to its button: the tab's stream
  if (!armed) return;
  const want = armed; armed = null;
  if (m.error) { status = 'error: ' + m.error; return; }
  navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: m.streamId, ...size(want.w, want.h) } } })
    .then((s) => {
      const t = track = s.getVideoTracks()[0];
      t.onended = () => { if (track === t) { track = null; send({ ended: true }); } };
      pump(t);
      status = 'capturing';
    }, (e) => { status = 'error: ' + e; });
});
window.agArm = (w, h) => { agStop(); armed = { w, h }; status = 'armed'; return status; };
window.agStatus = () => status;
window.agKey = () => { if (track && last) { keyNext = true; queue(last.clone()); } };
window.agStop = () => {
  if (track) { const t = track; track = null; t.onended = null; t.stop(); }
  if (enc) { try { enc.close(); } catch (e) {} enc = null; }
  gen++; W = H = 0; status = 'idle';
  if (last) { last.close(); last = null; }
};
"""


def extension_dir(home_dir: str) -> str:
    """The extension's files, written to the home (again only if they changed)."""
    path = os.path.join(home_dir, "dashboard", "capture-ext")
    os.makedirs(path, exist_ok=True)
    for name, text in (("manifest.json", json.dumps(MANIFEST, indent=1)), ("worker.js", WORKER),
                       ("capture.html", PAGE), ("capture.js", SCRIPT)):
        file = os.path.join(path, name)
        try:
            with open(file, encoding="utf-8") as fh:
                if fh.read() == text:
                    continue
        except OSError:
            pass
        tmp = f"{file}.{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, file)
    return path


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
        self.ext: Optional[str] = None      # the extension's id in that Chrome
        self.target: Optional[str] = None
        self.session: Optional[str] = None
        self.tab = None                     # the Tab captured now
        self.starting = None                # the Tab whose capture is starting: its first chunks come before it has
        self.tab_targets: Dict[str, str] = {}   # a page's target id -> its tab's (the extension's button is a tab's)
        self.view = (0, 0, 1.0)             # the view it was asked for: width, height (the page's pixels), density
        self.pending = None                 # a new view, and since when, waited on to settle
        self.pending_at = 0.0
        self.bars = 0                       # the height of a window's own bars in the Chrome (a window is sized so its
                                            # page is the view: the capture is of the window's page, at its size)
        self.extra = 0                      # more, in the captured tab's window, learned from the frames' size (`got`),
        self.fixes = 0                      # so many times at most
        self.ok = False                     # chunks come: the JPEG frames can stop
        self.since_start = 0                # chunks since the capture last started
        self.failed = 0                     # starts failed in a row, for `failed_on`
        self.failed_on = None
        self.why = ""                       # why it last failed

    def usable(self, tab=None) -> bool:
        return self.failed < GIVE_UP or (tab is not None and tab is not self.failed_on)

    def retry(self) -> None:
        """The tab went to another page: worth trying again."""
        with self.lock:
            self.failed = 0

    def _page(self, cdp) -> str:
        """The capturer page's session in `cdp`'s Chrome: the extension loaded and its page opened, if they aren't."""
        if self.cdp is cdp and self.session is not None:
            return self.session
        self.ext = cdp.call("Extensions.loadUnpacked", {"path": extension_dir(self.home_dir)})["id"]
        worker, end = f"chrome-extension://{self.ext}/worker.js", time.time() + 5   # its worker running: a press of its
        while time.time() < end and not any(t.get("url") == worker for t in cdp.call(   # button before it, lost
                "Target.getTargets", {"filter": [{"type": "service_worker"}]})["targetInfos"]):
            time.sleep(0.05)
        with WINDOWS:
            target = cdp.call("Target.createTarget", {"url": "about:blank", "newWindow": True})["targetId"]
            session = cdp.call("Target.attachToTarget", {"targetId": target, "flatten": True})["sessionId"]
        self.own(target)
        self.own(session)
        cdp.call("Runtime.enable", {}, session)          # its binding's calls are told only with it
        cdp.call("Runtime.addBinding", {"name": BINDING}, session)
        cdp.call("Page.navigate", {"url": f"chrome-extension://{self.ext}/capture.html"}, session)
        end = time.time() + 10
        while time.time() < end:
            got = cdp.call("Runtime.evaluate", {"expression": "typeof agArm", "returnByValue": True}, session)
            if (got.get("result") or {}).get("value") == "function":
                break
            time.sleep(0.05)
        else:
            raise ValueError("the capture page did not load")
        window = cdp.call("Browser.getWindowForTarget", {"targetId": target})["windowId"]   # its bars, measured:
        bars = None
        for height in (600, 640):                        # the same at two heights, so not read before the page resized
            with WINDOWS:
                cdp.call("Browser.setWindowBounds", {"windowId": window, "bounds": {"width": 800, "height": height}},
                         timeout=RESIZE_WAIT)
            bars, end = None, time.time() + 2
            while time.time() < end:
                inner = cdp.call("Runtime.evaluate", {"expression": "innerHeight", "returnByValue": True}, session)
                got = height - int((inner.get("result") or {}).get("value") or 0)
                if got == bars:
                    break
                bars = got
                time.sleep(0.05)
        with self.lock:
            self.cdp, self.target, self.session, self.bars = cdp, target, session, max(0, bars or 0)
            self.tab_targets = {}
        return session

    def _tab_target(self, cdp, tab) -> str:
        """The id of the tab `tab`'s page is in -- the one in its window, at its address (the window's shown one, if
        more are)."""
        with self.lock:
            known = self.tab_targets.get(tab.target)
        if known:
            return known
        info = cdp.call("Target.getTargetInfo", {"targetId": tab.target})["targetInfo"]
        window = cdp.call("Browser.getWindowForTarget", {"targetId": tab.target})["windowId"]
        found = []                                       # the tabs in its window (one, but for a page's popups): the
        for t in cdp.call("Target.getTargets", {"filter": [{"type": "tab"}]})["targetInfos"]:   # one at its address
            try:                                         # (a page changes it, at times), else the window's shown one
                if cdp.call("Browser.getWindowForTarget", {"targetId": t["targetId"]})["windowId"] == window:
                    found.append(t)
            except (ValueError, KeyError):
                pass
        if not found:
            raise ValueError("its tab was not found")
        rank = lambda t: (t.get("url") == info.get("url"), bool((t.get("embedderData") or {}).get("tabActive")))
        tid = max(found, key=rank)["targetId"]
        with self.lock:
            self.tab_targets[tab.target] = tid
        return tid

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
            with self.lock:                              # the same tab at a new size: started again at it (a capture
                on_it = self.tab is tab and self.cdp is cdp            # grows no bigger than it began), once the size
                if on_it and view != self.view:                         # has settled: until then, as it is
                    if view != self.pending:
                        self.pending, self.pending_at = view, time.time()
                    if time.time() - self.pending_at < SETTLE:
                        timer = threading.Timer(SETTLE + 0.05, self.on_change)
                        timer.daemon = True
                        timer.start()
                        return
                same = on_it and view == self.view
                usable = self.usable(tab)
                if tab is not self.failed_on:
                    self.failed = 0
            if same:
                return
            if not usable:
                return
            error = None
            for attempt in range(START_TRIES):
                try:
                    self._start(cdp, tab, view, px)
                    self.later(lambda: self._nudge(cdp, tab))
                    return
                except ValueError as exc:                # BrowserError and CdpError are ValueErrors
                    error = exc
                    with self.lock:
                        self.tab_targets.pop(tab.target, None)
                finally:
                    with self.lock:
                        self.starting = None
            self._failed(f"the video did not start: {error}", tab)

    def _start(self, cdp, tab, view, px) -> None:
        session = self._page(cdp)
        if self._fit(cdp, tab, view):
            time.sleep(0.25)                             # resized: the first frame (the only one, if the page is still)
        tab_target = self._tab_target(cdp, tab)
        with self.lock:
            self.starting, self.view, self.since_start = tab, view, 0
        with START_LOCK:
            cdp.call("Runtime.evaluate", {"expression": f"agArm({px[0]}, {px[1]})"}, session)
            cdp.call("Extensions.triggerAction", {"id": self.ext, "targetId": tab_target})
            status, end = "", time.time() + START_WAIT
            while time.time() < end:
                status = str((cdp.call("Runtime.evaluate", {"expression": "agStatus()", "returnByValue": True},
                                       session).get("result") or {}).get("value") or "")
                if status == "capturing" or status.startswith("error"):
                    break
                time.sleep(0.03)
        if status != "capturing":
            raise ValueError(status or "no answer")
        with self.lock:
            self.tab = tab

    def _failed(self, why: str, tab=None) -> None:
        """It stopped, or did not start: the JPEG frames again (the Browser told), the capture tried again on its next
        use, until GIVE_UP in a row on one tab."""
        with self.lock:
            self.failed += 1
            self.failed_on = tab if tab is not None else self.tab
            self.tab, self.ok, self.why = None, False, why
            cdp, session = self.cdp, self.session
        print(f"dashboard: a Browser's video stopped ({why}): its JPEG frames instead"
              + (", for this tab until it goes to another page" if not self.usable(self.failed_on) else ""),
              file=sys.stderr, flush=True)
        if cdp is not None and session is not None:
            try:
                cdp.post("Runtime.evaluate", {"expression": "agStop()"}, session)
            except ValueError:
                pass
        self.on_change()

    def _nudge(self, cdp, tab) -> None:
        """A capture started, no frame yet: one drawn (a still page makes none; Chrome's first has been seen missing)."""
        time.sleep(0.3)
        with self.lock:
            quiet = self.tab is tab and self.since_start == 0
        if quiet:
            self.redraw(cdp, tab)

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
            self.cdp = self.target = self.session = self.tab = self.ext = None
            self.tab_targets = {}
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
            self.since_start += 1
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
