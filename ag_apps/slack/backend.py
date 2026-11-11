"""The Slack app's backend (app.toml): the user's Slack in a panel of the dashboard, new messages as they are sent,
and replies that agents draft and only the user sends.

One line to Slack serves every gatherer (client.py: the user's own Slack app's tokens, kept in the app's data folder),
and one cache (store.py: slack.db there). Each gatherer has one instance -- its panel -- and the agents attached to it.

    a new message (Socket Mode)   kept; told to every open panel; told to the agents working with Slack as a
                                  context_stream in their channels ("Message in Slack #design from Maya ..."), all of
                                  them or only the user's DMs and mentions (setting `tell_agents`)
    an agent's slack_draft        a draft kept and shown in the panel, never sent: the user sends it, edits it, asks
                                  for changes or discards it; the agent is told which
    the user's own message        sent from the panel, as them

The user is NOTIFIED of new messages through the dashboard (Host.notify), one notification open a conversation of each
of two kinds and one a thread (its key): a DM or a message that @mentions them ("you:<conversation>") and a reply in a
thread they follow -- as Slack has it: one they started, replied in or followed (`_follows`) -- or that mentions them
("thread:<conversation>:<thread>"), popped up -- and on the computer too, setting `notify_system` -- and any other new
top-level message of a conversation ("new:<conversation>"), only listed on the Slack app's row: QUIET, said again at
most every QUIET_EVERY seconds. Their own messages never; nor replies in threads they don't follow, nor joins and
leaves. Messages fetched after the line was down are listed quietly, never popped up. A conversation read (in the
panel, or the user writing in it) clears its notifications; a thread opened in the panel, or replied in, its.

What the user READ IN SLACK'S OWN APP is followed too: Slack keeps a read cursor a conversation (client.last_read) but
sends no event when it moves, so it is asked -- every minute, of the conversations here unread or with a notification
open, and of the threads with one open (at most SYNC_MOST in all), and on (re)connecting, of those with missed
messages. A cursor further on than the app's is taken: those messages read here too, and a notification of one read
cleared. (The app doesn't move Slack's.) A conversation's read mark is the app's GUESS until then -- read up to when
the app first saw it --, so on connecting (and each minute, for one new since) Slack's cursor of each such one is taken
whichever way it moves (_learn_reads): what the user hasn't read in Slack since before the app was connected is
fetched and unread here too, its DMs and mentions listed quietly, as missed messages are.

The LIVE LINE is kept up by the "line" schedule (app.toml, every minute; it also starts the backend with the
dashboard): a line down DOWN_WAIT seconds -- Slack's SDK reconnects by itself, but not always (a sleep, a network
change) -- is made again; a connection that failed, tried again (not a refused token). What was missed is fetched
(_catch_up) on connecting, and when the line is found up after it went down or after a while unseen (GAP_WAIT: the
computer slept, and the SDK may have reconnected by itself) -- from when the line was last seen up (kept across
restarts), not from the newest message kept, so a gap followed by newer messages is filled too: the conversations shown
and DMs from then, and what Slack's search of the last days finds that the app hasn't kept and the user hasn't read.
While it is down the panel says so: `setup` says "disconnected", never "connected" without a line.

What the user and agents did is recorded in the gatherer as the app's own events (slack.drafted, slack.sent,
slack.discarded), which no model is shown. Slack's own history stays in the cache, not in the gatherer.

The panel's routes (on the app's origin, /api/...):

    GET  state                      {setup, settings, me, team, conversations (with unread), users, drafts}
    GET  history?conversation=&before=   {messages, more}: the newest 50 (before `before`), oldest first
    GET  thread?conversation=&ts=   {messages}: a thread, its parent first
    GET  search?q=                  {messages}: Slack's search
    GET  manifest                   the Slack app manifest to make the user's Slack app from
    POST view {conversation, thread}   what the panel has open now: agents' "open", said by slack_read, and told
                                       to its agents once it has stayed open VIEW_SETTLE seconds
    POST read {conversation, ts}    the user read it up to `ts`
    POST send {conversation, text, thread?, broadcast?}   posted as the user -> {message}
    POST draft {id, action: send | discard | edit, text?, broadcast?}
    POST connect {user_token, app_token} / disconnect
    POST notified {conversation, thread?}   the user opened a notification of it: its (the thread's) cleared
    POST settings {tell_agents?, notify_system?}

What the panels are told: {kind: status | conversations | message | reply | changed | deleted | draft | unread, ...}."""

import json
import os
import re
import threading
import time
from typing import Callable, Dict, List, Optional

from app_kit import App, AppError, Caller, Instance, Response, ToolResult, context_stream

from . import client as slack
from .mrkdwn import plain
from .store import Store

STREAM = "Slack"
VIEW_SETTLE = 2.0   # seconds a conversation (or thread) stays open in the panel before its agents are told of it
CREDENTIALS = "credentials.json"
TELL = ("all", "mentions", "none")
MANIFEST_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "slack_app_manifest.json")
REFRESH_EVERY = 300.0          # seconds between re-reads of the conversations list (joins, leaves, renames)
RECENT_DAYS = 14               # how far back the panel's Recent list looks
CATCH_UP = 40                  # at most this many conversations' missed messages fetched after (re)connecting
CATCH_PAGES = 3                # at most this many pages (of 100) of one conversation's missed messages
GAP_WAIT = 150.0               # seconds the line may go unseen (the "line" schedule sees it each minute) before what
                               # may have been missed then is fetched: the computer slept
GAP_MARGIN = 60.0              # seconds before the line was last seen up that missed messages are fetched from
LEARN_MOST = 5                 # at most this many guessed read marks a minute replaced by Slack's (all on connecting)
NAMES_MOST = 20                # at most this many people users.list leaves out looked up a refresh
NOT_THERE = ("channel_not_found", "not_in_channel", "is_archived")   # a conversation Slack has no read cursor of
ENV = ("AG_SLACK_USER_TOKEN", "AG_SLACK_APP_TOKEN")
ID = re.compile(r"^[CGD][A-Z0-9]{6,}$")   # a Slack conversation's id
DOWN_WAIT = 45.0               # seconds the live line may be down (the SDK reconnecting by itself) before it is made again
QUIET_EVERY = 120.0            # seconds: a conversation's quiet notification said again at most this often while open
SYNC_MOST = 30                 # at most this many conversations' (and threads') read cursors asked of Slack a minute
UNFOLLOWED_FOR = 600.0         # seconds a thread found not followed is taken as such before Slack is asked again
REFUSED = ("invalid_auth", "not_authed", "token_revoked", "account_inactive", "missing_scope")   # not tried again
NOT_NEWS = ("channel_join", "channel_leave", "group_join", "group_leave", "channel_topic", "channel_purpose",
            "channel_name", "group_topic", "group_purpose", "group_name", "pinned_item", "unpinned_item")


class SlackApp(App):
    def __init__(self, make_client: Optional[Callable[[str, str], "slack.Client"]] = None):
        self._make = make_client or slack.Client
        self.store: Optional[Store] = None
        self.cl = None
        self.me: Dict[str, str] = {}
        self.status = "off"          # off | connecting | connected | live-off (no app token) | disconnected | error
        self.error = ""
        self._users: Dict[str, dict] = {}
        self._refreshed = 0.0
        self._lock = threading.RLock()
        self._gen = 0                # which connection is current: an old one's callbacks are ignored
        self._views: Dict[str, dict] = {}   # instance -> what its panel has open: {conversation, thread, at}
        self._view_timers: Dict[str, threading.Timer] = {}   # instance -> the wait before telling its agents
        self._view_told: Dict[str, tuple] = {}               # instance -> (conversation, thread) its agents were told
        self._down_since: Optional[float] = None             # when the live line was first seen down
        self._up_at = 0.0                                    # when it was last seen up (kept: "live_at")
        self._lost = False                                   # it went down since: what was missed to be fetched
        self._catching = threading.Lock()                    # one catch-up at a time
        self._asked_users: set = set()                       # people users.list left out, looked up once
        self._said: Dict[str, float] = {}                    # a notification's key -> when it was last said
        self._noticed: Dict[str, str] = {}                   # the keys that may be open -> the ts each said (kept)
        self._threads: Dict[tuple, tuple] = {}               # (conversation, thread) -> (followed, when found so)

    # -- the host

    def start(self, host) -> None:
        super().start(host)
        self.store = Store(os.path.join(host.folder(), "slack.db"))
        self._users = self.store.users()
        kept = self.store.setting("noticed", {}) or {}
        self._noticed = {str(k): str(v) for k, v in (kept.items() if isinstance(kept, dict) else ((k, "") for k in kept))}
        self._up_at = _num(self.store.setting("live_at", 0))
        user, app = self._tokens()
        if user:
            self._connect(user, app)

    def stop(self) -> None:
        with self._lock:
            cl, self.cl = self.cl, None
            self._gen += 1
        if cl is not None:
            cl.close()
        if self.store is not None:
            self.store.close()

    def open(self, instance: Instance, args: dict) -> Instance:
        return Instance(**{**instance.to_dict(), "title": "Slack"})

    # -- the connection

    def _tokens(self):
        try:
            with open(os.path.join(self.host.folder(), CREDENTIALS)) as f:
                got = json.load(f)
            return str(got.get("user_token") or ""), str(got.get("app_token") or "")
        except (OSError, ValueError):
            return os.environ.get(ENV[0], ""), os.environ.get(ENV[1], "")

    def _save_tokens(self, user: str, app: str) -> None:
        path = os.path.join(self.host.folder(), CREDENTIALS)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump({"user_token": user, "app_token": app}, f)
        os.chmod(path, 0o600)

    def _connect(self, user: str, app: str, wait: bool = False) -> None:
        """Connected in the background (or now, `wait`): who the user is, their people and conversations, then the
        live line, then what was missed."""
        with self._lock:
            self._gen += 1
            gen = self._gen
            old, self.cl = self.cl, None
            self.status, self.error = "connecting", ""
        if old is not None:
            old.close()
        self._tell_all({"kind": "status", "setup": self.setup()})
        run = threading.Thread(target=self._run, args=(gen, user, app), name="ag-slack-connect", daemon=True)
        run.start()
        if wait:
            run.join()

    def _run(self, gen: int, user: str, app: str) -> None:
        try:
            after = self._missed_after()                    # (before the line is seen up again)
            cl = self._make(user, app)
            me = cl.who()
            with self._lock:
                if gen != self._gen:
                    cl.close()
                    return
                self.cl, self.me = cl, me
            self._refresh(cl)
            if app:
                cl.listen(lambda ev: self._event(gen, ev), lambda s: self._on_status(gen, s))
                self._lost = False
                self._seen_up(time.time())
            else:
                self._on_status(gen, "live-off")
            self._learn_reads(gen, cl)
            self._catch_up(gen, cl, self._recent(gen, cl), after)
        except Exception as exc:  # noqa: BLE001 - shown to the user in the panel, not raised
            if gen == self._gen:
                with self._lock:
                    self.status, self.error = "error", _why(exc)
                self._tell_all({"kind": "status", "setup": self.setup()})

    def _on_status(self, gen: int, status: str) -> None:
        if gen != self._gen:
            return
        with self._lock:
            if status.startswith("error: "):
                self.error = status[7:]
                if self.status != "connected":
                    self.status = "error"
            else:
                self.status = status
                if status == "connected":
                    self.error = ""
            if status == "disconnected" or status.startswith("error: "):
                self._lost = True                           # what came meanwhile fetched once it is back
        self._tell_all({"kind": "status", "setup": self.setup()})

    def _seen_up(self, now: float) -> None:
        """The live line seen up at `now`: what a later catch-up fetches from, kept for the next start."""
        self._up_at = now
        self.store.set_setting("live_at", now)

    def _missed_after(self) -> str:
        """Where missed messages may start: a little before the line was last seen up ('' if never)."""
        return f"{self._up_at - GAP_MARGIN:.6f}" if self._up_at > 0 else ""

    def _refresh(self, cl) -> None:
        """The people and the conversations, read again -- and the people users.list leaves out whom a DM is with
        (Slack's own "Slack" account), looked up once each."""
        users = cl.users()
        self.store.put_users(users)
        self._users = self.store.users()
        convs = cl.conversations()
        self.store.put_conversations(convs)
        missing = [c["user"] for c in convs if c.get("kind") == "im" and c.get("user")
                   and c["user"] not in self._users and c["user"] not in self._asked_users][:NAMES_MOST]
        for uid in missing:
            self._asked_users.add(uid)
            got = cl.user(uid)
            if got:
                self.store.put_users([got])
        if missing:
            self._users = self.store.users()
        self._refreshed = time.time()
        self._tell_all({"kind": "conversations", **self._lists()})

    def _recent(self, gen: int, cl) -> List[dict]:
        """When each conversation was last active, from Slack's search of the last RECENT_DAYS days (a few calls, not
        one a conversation): what the panel's Recent list shows and orders by. Live messages keep it after. -> the
        search's hits ({channel, ts, thread_ts}), for _catch_up."""
        after = time.strftime("%Y-%m-%d", time.localtime(time.time() - RECENT_DAYS * 86400))
        try:
            hits = cl.recent(after)
        except slack.SlackError:
            return []                                       # (no search:read: the list fills as messages come)
        if gen != self._gen:
            return []
        for h in hits:
            if h["channel"] and h["ts"]:
                self.store.active(h["channel"], h["ts"])
        self._tell_all({"kind": "conversations", **self._lists()})
        return hits

    def _catch_up(self, gen: int, cl, hits: List[dict] = (), after: str = "") -> None:
        """Messages sent while the line was down, fetched (at most CATCH_UP conversations, CATCH_PAGES pages each):
        those Slack's search found (`hits`) that the app hasn't kept and that are newer than the user read here --
        their conversations, their threads -- and those of the conversations the panel has shown and of DMs; each
        conversation from its newest message kept or from `after` (a little before the line was last seen up), the
        earlier, so a gap with newer messages after it is filled. Slack's read cursors of those with new messages
        taken (the user may have read them in Slack's own app), what is left unread listed for the user quietly; not
        told to agents (they are not new news)."""
        since: Dict[str, str] = {}                          # conversation -> fetch what came after
        threads: Dict[tuple, None] = {}

        def start(floor: str) -> str:                       # where a conversation's missed messages may start
            return min([t for t in (floor, after) if _num(t) > 0], key=_num, default="")

        for h in hits:
            c = self.store.conversation(h.get("channel") or "")
            if c is None or c.get("gone") or _num(h.get("ts")) <= _num(c["read_ts"]) \
                    or self.store.message(c["id"], h["ts"]) is not None:
                continue
            if h.get("thread_ts") and h["thread_ts"] != h["ts"]:
                threads[(c["id"], h["thread_ts"])] = None
            else:
                since[c["id"]] = start(max(c["latest_ts"], c["read_ts"], key=_num))
        for c in self.store.conversations():
            if c["id"] not in since and c["latest_ts"] and (c["synced"] or c["kind"] in ("im", "mpim")):
                since[c["id"]] = start(c["latest_ts"])
        got: Dict[str, List[dict]] = {}
        calls = [(cid, ts, "") for cid, ts in since.items()] + [(cid, "", ts) for cid, ts in threads]
        for cid, oldest, thread in calls[:CATCH_UP]:
            if gen != self._gen:
                return
            try:
                msgs = cl.replies(cid, thread) if thread else self._since(cl, cid, oldest)
            except slack.SlackError:
                continue
            new = self.store.put_messages(cid, msgs) if msgs else []
            if new:
                got.setdefault(cid, []).extend(new)
        if gen != self._gen:
            return
        self._slack_read(cl, list(got))
        for cid, new in got.items():
            self._tell_all({"kind": "history", "conversation": cid})
            self._caught_up(cid, new)
        self._tell_all({"kind": "unread", "unread": self._unread()})

    def _since(self, cl, cid: str, oldest: str) -> List[dict]:
        """A conversation's messages after `oldest`, newest first: the newest at most CATCH_PAGES pages of 100 (one,
        with no `oldest`). Read back from the newest, not with Slack's own `oldest`: given that alone, Slack answers
        the OLDEST 100 after it (as checked on a real workspace), and a long gap would miss its newest."""
        out: List[dict] = []
        latest = ""
        for _ in range(CATCH_PAGES if oldest else 1):
            msgs, more = cl.history(cid, latest=latest, limit=100)
            after = [m for m in msgs if _num(m["ts"]) > _num(oldest)]
            out.extend(after)
            if not more or not msgs or len(after) < len(msgs):
                break
            latest = min((m["ts"] for m in msgs), key=_num)
        return out

    def _later_catch_up(self, gen: int, cl, after: str) -> None:
        """What may have been missed since `after`, fetched in the background -- unless a catch-up is running."""
        self._lost = False

        def run() -> None:
            if not self._catching.acquire(blocking=False):
                return
            try:
                self._catch_up(gen, cl, self._recent(gen, cl), after)
            except Exception:  # noqa: BLE001 - fetched again at the next gap
                pass
            finally:
                self._catching.release()
        threading.Thread(target=run, name="ag-slack-catch-up", daemon=True).start()

    def _learn_reads(self, gen: int, cl, most: Optional[int] = None) -> None:
        """Slack's own read cursor taken for each conversation whose read mark is still the app's guess (`most` of
        them, the most recently active first): back or on. One moved back -- the user hadn't read it in Slack since
        before the app first saw it -- has what came after it fetched, unread here as there, and its DMs and mentions
        listed quietly (a channel's other messages only counted, as Slack's app does)."""
        ids = self.store.guessed_reads()
        if most is not None:
            ids = ids[:most]
        got: Dict[str, List[dict]] = {}
        moved = False
        for cid in ids:
            if gen != self._gen:
                return
            c = self.store.conversation(cid)
            if c is None:
                continue
            try:
                last = cl.last_read(cid)
            except slack.SlackError as exc:
                if str(exc) in NOT_THERE:
                    self.store.take_read(cid, "")            # (no cursor to take: the guess stays, not asked again)
                continue
            self.store.take_read(cid, last)
            if not last or _num(last) == _num(c["read_ts"]):
                continue
            moved = True
            if _num(last) < _num(c["read_ts"]):
                try:
                    new = self.store.put_messages(cid, self._since(cl, cid, last))
                except slack.SlackError:
                    continue
                if new:
                    got[cid] = new
        if gen != self._gen or not (moved or got):
            return
        self._tell_all({"kind": "conversations", **self._lists()})
        for cid, new in got.items():
            self._tell_all({"kind": "history", "conversation": cid})
            self._caught_up(cid, new, kinds=("you", "thread"))
        self._tell_all({"kind": "unread", "unread": self._unread()})

    def _slack_read(self, cl, cids: List[str]) -> List[str]:
        """Slack's own read cursor of each of `cids` taken where it is further on than the app's -- the user read them
        in Slack's app --, and a notification of a message so read cleared. -> those whose cursor moved."""
        moved = []
        for cid in cids:
            c = self.store.conversation(cid)
            if c is None:
                continue
            try:
                last = cl.last_read(cid)
            except slack.SlackError:
                continue
            if _num(last) <= _num(c["read_ts"]):
                continue
            self.store.read(cid, last)
            moved.append(cid)
            for key in (f"you:{cid}", f"new:{cid}"):
                if key in self._noticed and _num(self._noticed[key]) <= _num(last):
                    self._unnotice(key)
        if moved:
            self._tell_all({"kind": "conversations", **self._lists()})
        return moved

    def _sync_read(self, cl) -> None:
        """Every minute: the read cursors, in Slack, of the threads with a notification open, their newest first, and
        of the conversations unread here or with one open, the most recently active first -- SYNC_MOST in all."""
        threads = sorted((k for k in self._noticed if k.startswith("thread:")), key=lambda k: -_num(self._noticed[k]))
        for key in threads[:SYNC_MOST]:
            _, cid, ts = key.split(":", 2)
            try:
                last = cl.thread_state(cid, ts)["last_read"]
            except slack.SlackError:
                continue
            if last and _num(self._noticed.get(key)) <= _num(last):
                self._unnotice(key)
        cids = set(self._unread()) | {k.split(":", 2)[1] for k in self._noticed if not k.startswith("thread:")}
        convs = [c for c in (self.store.conversation(cid) for cid in cids) if c is not None and not c.get("gone")]
        convs.sort(key=lambda c: -max(_num(c.get("active_ts")), _num(c.get("latest_ts"))))
        self._slack_read(cl, [c["id"] for c in convs[:max(0, SYNC_MOST - len(threads))]])

    def _line_up(self) -> bool:
        cl = self.cl
        try:
            return cl is not None and bool(cl.connected())
        except Exception:  # noqa: BLE001 - a line that can't say is not one to count on
            return False

    def scheduled(self, schedule: str, due: float) -> Optional[float]:
        if schedule == "line":
            self.keep_line()
        return None

    def keep_line(self, now: Optional[float] = None) -> None:
        """The live line kept up (the "line" schedule, every minute): a connection that failed, made again -- not one
        Slack refused the tokens of --, and a line down DOWN_WAIT seconds made again (missed messages fetched); the
        panels told when it goes down and comes back. A line up again by itself after it went down, or seen up after
        more than GAP_WAIT unseen (the computer slept: the SDK may have reconnected without a word), has what may have
        been missed since it was last seen up fetched."""
        now = time.time() if now is None else now
        user, app = self._tokens()
        if not user or self.store is None:
            return
        with self._lock:
            cl, status, error, gen = self.cl, self.status, self.error, self._gen
        if status == "connecting" or (status == "error" and any(k in error for k in REFUSED)):
            return
        if cl is None or not app:                           # no line to keep: a connection that failed, made again
            if status == "error":
                self._connect(user, app)
            return
        if self._line_up():
            self._down_since = None
            if status != "connected":
                self._on_status(gen, "connected")
            if self._lost or (self._up_at > 0 and now - self._up_at > GAP_WAIT):
                self._later_catch_up(gen, cl, self._missed_after())
            self._seen_up(now)
            self._learn_reads(gen, cl, LEARN_MOST)
            self._sync_read(cl)
        elif self._down_since is None:
            self._down_since = now
            self._lost = True
            self._tell_all({"kind": "status", "setup": self.setup()})
        elif now - self._down_since >= DOWN_WAIT:
            self._down_since = None
            self._connect(user, app)

    def _caught_up(self, ch: str, new: List[dict], kinds: tuple = ("you", "thread", "new")) -> None:
        """Messages missed while the line was down, listed for the user quietly: the newest of each kind (of `kinds`),
        unless they wrote in the conversation after (read)."""
        newest: Dict[str, dict] = {}
        read = _num((self.store.conversation(ch) or {}).get("read_ts"))
        for m in sorted(new, key=lambda m: _num(m["ts"])):
            if _num(m["ts"]) <= read:
                continue                                    # read already: in Slack's own app
            if m.get("user") and m["user"] == self.me.get("user_id"):
                newest.clear()
            else:
                what = self._news(ch, m)
                if what in kinds:
                    newest[self._key(ch, m, what)] = m
        for m in newest.values():
            self._notify(ch, m, caught_up=True)

    def _client(self):
        cl = self.cl
        if cl is None:
            raise AppError("Slack isn't connected: connect it in the Slack panel"
                           + (f" ({self.error})" if self.error else ""), 409)
        return cl

    def setup(self) -> dict:
        user, app = self._tokens()
        status = self.status
        if status == "connected" and app and not self._line_up():
            status = "disconnected"                         # said connected once, its line gone since
        return {"sdk": slack.available(), "tokens": bool(user), "live": bool(app), "status": status,
                "error": self.error, "me": self.me.get("user_id", ""), "team": self.me.get("team", ""),
                "url": self.me.get("url", "")}

    # -- what comes in

    def _event(self, gen: int, ev: dict) -> None:
        if gen != self._gen or self.store is None:
            return
        t = ev.get("type")
        if t == "message":
            self._message(ev)
        elif t in ("reaction_added", "reaction_removed"):
            self._reaction(ev, t == "reaction_added")
        elif t in ("channel_left", "group_left", "member_joined_channel", "channel_rename", "group_rename",
                   "im_created", "channel_archive", "group_archive"):
            self._later_refresh()

    def _message(self, ev: dict) -> None:
        ch, sub, me = ev.get("channel") or "", ev.get("subtype") or "", self.me.get("user_id", "")
        if not ch:
            return
        if sub == "message_changed" and isinstance(ev.get("message"), dict):
            m = slack.message(ev["message"], me)
            if self.store.message(ch, m["ts"]) is not None:
                self.store.put_messages(ch, [m])
                self._tell_all({"kind": "changed", "conversation": ch, "message": self.store.message(ch, m["ts"])})
            return
        if sub == "message_deleted":
            ts = ev.get("deleted_ts") or ""
            if self.store.delete(ch, ts):
                self._tell_all({"kind": "deleted", "conversation": ch, "ts": ts,
                                "unread": self._unread()})
            return
        if sub in ("message_replied", "channel_topic", "channel_purpose") and isinstance(ev.get("message"), dict):
            return
        m = slack.message(ev, me)
        if not m["ts"]:
            return
        if self.store.conversation(ch) is None:            # a new DM, or a channel just joined
            got = self.cl.conversation(ch) if self.cl is not None else None
            self.store.add_conversation(got or {"id": ch, "kind": _kind(ev.get("channel_type"))},
                                        read_ts=f"{float(m['ts']) - 1e-6:.6f}")
            self._tell_all({"kind": "conversations", **self._lists()})
        if not self.store.put_messages(ch, [m]):
            return                                          # seen already (the panel's own send, a re-sent event)
        self.store.active(ch, m["ts"])
        if m["user"] and m["user"] == me:
            self.store.read(ch, m["ts"])                    # the user wrote it: read up to there
        reply = bool(m["thread_ts"] and m["thread_ts"] != m["ts"])
        told = {"kind": "reply" if reply else "message", "conversation": ch, "message": m,
                "mention": self._mentions(ch, m), "unread": self._unread()}
        if reply:
            told["parent"] = self.store.replied(ch, m["thread_ts"], m["ts"])
        self._tell_all(told)
        self._tell_agents(ch, m)
        if m["user"] and m["user"] == me:
            self._clear(ch, m["thread_ts"] if reply else "")   # they wrote in it: read (and follow its thread)
        else:
            self._notify(ch, m, parent_user=ev.get("parent_user_id") or "")

    def _reaction(self, ev: dict, added: bool) -> None:
        item = ev.get("item") or {}
        ch, ts, name = item.get("channel") or "", item.get("ts") or "", ev.get("reaction") or ""
        m = self.store.message(ch, ts) if ch and ts else None
        if m is None or not name:
            return
        mine = ev.get("user") == self.me.get("user_id")
        reactions = [dict(r) for r in m.get("reactions") or []]
        r = next((r for r in reactions if r["name"] == name), None)
        if added:
            if r is None:
                reactions.append({"name": name, "count": 1, "mine": mine})
            else:
                r["count"] += 1
                r["mine"] = r.get("mine") or mine
        elif r is not None:
            r["count"] -= 1
            if mine:
                r["mine"] = False
            if r["count"] <= 0:
                reactions.remove(r)
        self.store.put_messages(ch, [{**m, "reactions": reactions}])
        self._tell_all({"kind": "changed", "conversation": ch, "message": self.store.message(ch, ts)})

    def _later_refresh(self) -> None:
        cl = self.cl
        if cl is not None:
            threading.Thread(target=self._safe_refresh, args=(cl,), name="ag-slack-refresh", daemon=True).start()

    def _safe_refresh(self, cl) -> None:
        try:
            self._refresh(cl)
        except Exception:  # noqa: BLE001 - kept as it was; the next refresh tries again
            pass

    def _mentions(self, ch: str, m: dict) -> bool:
        c = self.store.conversation(ch) or {}
        me = self.me.get("user_id", "")
        return m.get("user") != me and (c.get("kind") in ("im", "mpim") or bool(me and f"<@{me}>" in m["text"]))

    def _tell_agents(self, ch: str, m: dict, skip: Optional[str] = None) -> None:
        """A new message, to the agents working with Slack in every gatherer (but `skip`'s, told otherwise): as a
        context_stream in each one's channel, placed at its next model call."""
        how = self.store.setting("tell_agents", "all")
        if how == "none" or (how == "mentions" and not self._mentions(ch, m)):
            return
        c = self.store.conversation(ch) or {"id": ch, "kind": "channel"}
        reply = bool(m["thread_ts"] and m["thread_ts"] != m["ts"])
        where = self.label(c) + (" (in a thread)" if reply else "")
        text = self.plain(m["text"])
        if m.get("files"):
            text += "".join(f" [file: {f['name']}]" for f in m["files"])
        text += f"  [conversation {ch}, ts {m['ts']}" + (f", thread {m['thread_ts']}" if reply else "") + "]"
        author = self.who(m)
        for inst in self.host.instances():
            for chan in self.host.attached(inst):
                if chan == skip:
                    continue
                try:
                    self.host.insert(inst, [context_stream(f"{STREAM} {where}", author, text,
                                                           timestamp=_num(m["ts"]),
                                                           id=f"slack:{ch}:{m['ts']}:{chan}")], channel=chan)
                except AppError:
                    pass

    # -- the user notified

    def _news(self, ch: str, m: dict, parent_user: str = "") -> Optional[str]:
        """What a message is to the user: "you" (a DM, or it @mentions them), "thread" (a reply in a thread they follow,
        or that is "you"), "new" (any other top-level message of a conversation of theirs), or None (theirs, a reply
        in a thread they don't follow, a join or a leave ...). `parent_user`: who started its thread, if Slack said."""
        c = self.store.conversation(ch)
        if c is None or c.get("gone") or not m.get("user") or m["user"] == self.me.get("user_id") \
                or m.get("subtype") in NOT_NEWS or m.get("deleted"):
            return None
        reply = m.get("thread_ts") and m["thread_ts"] != m["ts"] and m.get("subtype") != "thread_broadcast"
        if not reply:
            return "you" if self._mentions(ch, m) else "new"
        return "thread" if self._mentions(ch, m) or self._follows(ch, m["thread_ts"], parent_user) else None

    def _follows(self, ch: str, thread: str, parent_user: str = "") -> bool:
        """Whether the user follows a thread, as Slack has it: they started it, replied in it (as kept here), or Slack
        says so (its parent's `subscribed`: also one followed by hand) -- asked once a thread, one found not followed
        asked again after UNFOLLOWED_FOR seconds."""
        me = self.me.get("user_id", "")
        if not me:
            return False
        if parent_user == me:
            return True
        got = self._threads.get((ch, thread))
        if got and (got[0] or time.time() - got[1] < UNFOLLOWED_FOR):
            return got[0]
        followed = any(x["user"] == me for x in self.store.thread(ch, thread))
        if not followed and self.cl is not None:
            try:
                followed = bool(self.cl.thread_state(ch, thread)["subscribed"])
            except slack.SlackError:
                return False                                # (not kept: asked again next time)
        self._threads[(ch, thread)] = (followed, time.time())
        return followed

    def _key(self, ch: str, m: dict, what: str) -> str:
        return f"thread:{ch}:{m['thread_ts']}" if what == "thread" else f"{what}:{ch}"

    def _notify(self, ch: str, m: dict, caught_up: bool = False, parent_user: str = "") -> None:
        """A new message, to the user as a notification of each instance: popped up (a DM, a mention, a reply in a
        thread they follow -- unless `caught_up`: fetched after the line was down) or only listed (quiet: said again
        at most every QUIET_EVERY seconds while one is open). One open a conversation and kind, and a thread: a newer
        takes its place."""
        what = self._news(ch, m, parent_user)
        if what is None or self.host is None:
            return
        key, now = self._key(ch, m, what), time.time()
        if what == "new" and not caught_up and key in self._noticed and now - self._said.get(key, 0) < QUIET_EVERY:
            return
        c = self.store.conversation(ch)
        who, place = self.who(m), self.label(c)
        text = self.plain(m["text"]) + "".join(f" [file: {f['name']}]" for f in m.get("files") or [])
        reply = bool(m.get("thread_ts") and m["thread_ts"] != m["ts"])
        if what in ("you", "thread"):
            if what == "thread" and not self._mentions(ch, m):
                title = (f"{who} replied to your thread in {place}" if parent_user == self.me.get("user_id")
                         else f"{who} replied in a thread you follow in {place}")
            else:
                title = (f"{who}, direct message" if c["kind"] == "im" else f"{who} in {place}" if c["kind"] == "mpim"
                         else f"{who} mentioned you in {place}") + (", in a thread" if reply else "")
            show = () if caught_up else ("ag", "system") if self.store.setting("notify_system", True) else ("ag",)
        else:
            n = (self._unread().get(ch) or [0])[0]
            title, text = ((f"{n} new messages in {place}", f"{who}: {text}") if n > 1 else (f"{who} in {place}", text))
            show = ()
        where = {"conversation": ch, "ts": m["ts"], "thread": m["thread_ts"] if reply else ""}
        told = False
        for inst in self.host.instances():
            try:
                self.host.notify(inst, title, text, key=key, show=show, where=where)
                told = True
            except AppError:
                pass                                        # (a host that takes none)
        if told:
            self._said[key] = now
            self._noticed[key] = m["ts"]
            self._keep_noticed()

    def _clear(self, ch: str, thread: str = "") -> None:
        """The conversation read -- or, `thread`, a thread of it seen: replied in (then followed) or opened -- its
        notifications (the thread's), if any may be open, no longer asking for the user."""
        if thread:
            if self.me.get("user_id"):
                self._threads[(ch, thread)] = (True, time.time())
            keys = (f"thread:{ch}:{thread}", f"you:{ch}", f"new:{ch}")
        else:
            keys = (f"you:{ch}", f"new:{ch}")
        for key in keys:
            if key in self._noticed:
                self._unnotice(key)

    def _unnotice(self, key: str) -> None:
        if self.host is not None:
            for inst in self.host.instances():
                try:
                    self.host.clear_notice(inst, key)
                except AppError:
                    pass
        self._noticed.pop(key, None)
        self._keep_noticed()

    def _keep_noticed(self) -> None:
        if self.store is not None:
            self.store.set_setting("noticed", dict(self._noticed))

    # -- names

    def name(self, uid: str) -> str:
        u = self._users.get(uid) or {}
        return u.get("real_name") or u.get("name") or uid

    def who(self, m: dict) -> str:
        if m.get("user") and m["user"] == self.me.get("user_id"):
            return f"the user ({self.name(m['user'])})"
        return m.get("bot_name") or self.name(m.get("user") or "") or "someone"

    def label(self, c: dict) -> str:
        if c["kind"] in ("channel", "private"):
            return f"#{c.get('name') or c['id']}"
        if c["kind"] == "im":
            return f"DM with {self.name(c.get('user') or '')}"
        names = [self.name(u) for u in c.get("members") or [] if u != self.me.get("user_id")]
        if not names and c.get("name", "").startswith("mpdm-"):
            names = [n for n in c["name"][5:].rsplit("-", 1)[0].split("--") if n != self.me.get("user")]
        return "group DM with " + (", ".join(names) or c["id"])

    def plain(self, text: str) -> str:
        def channel(cid):
            c = self.store.conversation(cid)
            return c.get("name") if c else None
        return plain(text, lambda u: self.name(u) if u in self._users else None, channel)

    def _unread(self) -> Dict[str, list]:
        return {k: list(v) for k, v in self.store.unread(self.me.get("user_id", "")).items()}

    def _lists(self) -> dict:
        convs = self.store.conversations()
        return {"conversations": [{**c, "label": self.label(c)} for c in convs], "unread": self._unread(),
                "users": {k: {"name": v["real_name"] or v["name"], "handle": v["name"], "bot": v["bot"]}
                          for k, v in self._users.items()}}

    def _tell_all(self, message: dict) -> None:
        if self.host is None:
            return
        for inst in self.host.instances():
            try:
                self.host.tell_panel(inst, message)
            except AppError:
                pass

    # -- conversations and their messages

    def view(self, instance: Optional[Instance]) -> Optional[dict]:
        """What the user has open in the instance's panel -- {conversation, thread} as the panel last said -- or None
        when no panel of it is open."""
        if instance is None or not self.host.panels(instance):
            return None
        return self._views.get(instance.id) or {"conversation": "", "thread": ""}

    def _view_line(self, instance: Optional[Instance]) -> str:
        v = self.view(instance)
        if v is None:
            return "The user's Slack panel isn't open."
        c = self.store.conversation(v["conversation"]) if v.get("conversation") else None
        if c is None:
            return "Open in the user's Slack panel: no conversation."
        return f"Open in the user's Slack panel: {self._view_words(c, v.get('thread') or '')}. " \
               "(conversation \"open\" names it.)"

    def _view_words(self, c: dict, thread: str) -> str:
        """`c` (and the thread of its message `thread`), as said to an agent: "#design (C1), the thread of Maya
        Chen's message 1794... ("Can you look at ...")"."""
        out = f"{self.label(c)} ({c['id']})"
        if thread:
            p = self.store.message(c["id"], thread)
            said = self.plain(p["text"]).replace("\n", " ") if p else ""
            out += f", the thread of {self.who(p) if p else 'a message'}'s message {thread}" + \
                (f' ("{said[:80]}{"…" if len(said) > 80 else ""}")' if said else "")
        return out

    def _view_changed(self, instance: Instance) -> None:
        """The panel opened something else: its agents are told once it has stayed open VIEW_SETTLE seconds, so
        clicking through conversations tells them only the one the user stops at."""
        old = self._view_timers.pop(instance.id, None)
        if old is not None:
            old.cancel()
        t = threading.Timer(VIEW_SETTLE, self._tell_view, args=(instance,))
        t.daemon = True
        self._view_timers[instance.id] = t
        t.start()

    def _tell_view(self, instance: Instance) -> None:
        """What the user is looking at, to the agents working with this instance -- as a note at each one's next
        model call, the way the Browser tells its pages -- unless it is what they were last told."""
        v = self._views.get(instance.id) or {}
        key = (v.get("conversation") or "", v.get("thread") or "")
        c = self.store.conversation(key[0]) if key[0] else None
        if c is None or self._view_told.get(instance.id) == key:
            return
        self._view_told[instance.id] = key
        text = f"The user opened {self._view_words(c, key[1])} in the Slack panel  [conversation {c['id']}" + \
            (f", thread {key[1]}" if key[1] else "") + "]"
        now = time.time()
        for chan in self.host.attached(instance):
            try:
                self.host.insert(instance, [context_stream(STREAM, "the user", text, timestamp=now,
                                                           id=f"slack-view:{instance.id}:{now:.6f}:{chan}")],
                                 channel=chan)
            except AppError:
                pass

    def find(self, ref: str, instance: Optional[Instance] = None) -> dict:
        """A conversation from what an agent or the panel names it: its id (any public channel's, a search found it,
        whether the user is in it or not), #name or name, a person (@handle, a name) -- their DM, opened if need be --
        or "open", what the user has open in the panel."""
        ref = str(ref or "").strip()
        if not ref:
            raise AppError("which conversation: its id, #name, a person's @name, or \"open\"")
        if ref.lower() == "open":
            v = self.view(instance)
            if v is None:
                raise AppError("the user's Slack panel isn't open, so nothing is open in it: name the conversation")
            got = self.store.conversation(v.get("conversation") or "")
            if got is None:
                raise AppError("the user has no conversation open in the Slack panel: name one")
            return got
        got = self.store.conversation(ref)
        if got:
            return got
        if ID.match(ref) and self.cl is not None:          # a conversation the user isn't in: a search found it
            info = self.cl.conversation(ref)
            if info and info.get("id"):
                self.store.add_conversation(info, read_ts=f"{time.time():.6f}", member=False)
                return self.store.conversation(info["id"]) or info
        convs = self.store.conversations()
        bare = ref.lstrip("#").lower()
        for c in convs:
            if c["kind"] in ("channel", "private") and c["name"].lower() == bare:
                return c
        person = ref.lstrip("@").lower()
        uid = next((k for k, u in self._users.items()
                    if person in (k.lower(), (u["name"] or "").lower(), (u["real_name"] or "").lower())), None)
        if uid:
            for c in convs:
                if c["kind"] == "im" and c["user"] == uid:
                    return c
            made = self._client().open_dm(uid)
            self.store.add_conversation(made, read_ts=f"{time.time():.6f}")
            self._tell_all({"kind": "conversations", **self._lists()})
            return self.store.conversation(made["id"]) or made
        names = ", ".join(self.label(c) for c in convs[:30])
        raise AppError(f"no conversation {ref!r} among the user's: {names}")

    def history(self, cid: str, before: str = "", limit: int = 50) -> dict:
        """The newest `limit` messages (before `before`): from Slack the first time and for older ones not kept."""
        c = self.store.conversation(cid)
        if c is None:
            raise AppError(f"no conversation {cid}")
        kept = self.store.history(cid, before, limit)
        more = True
        if self.cl is not None and (not c["synced"] or len(kept) < limit):
            oldest_kept = kept[0]["ts"] if kept else before
            try:
                msgs, more = self.cl.history(cid, latest=(oldest_kept if (c["synced"] or before) else ""), limit=limit)
                self.store.put_messages(cid, msgs)
                if not c["synced"]:
                    self.store.synced(cid)
            except slack.SlackError as exc:
                if not kept:
                    raise AppError(f"Slack: {exc}") from None
            kept = self.store.history(cid, before, limit)
        elif self.cl is None:
            more = False
        return {"messages": kept, "more": more}

    def thread(self, cid: str, ts: str) -> List[dict]:
        if self.cl is not None:
            try:
                self.store.put_messages(cid, self.cl.replies(cid, ts))
            except slack.SlackError as exc:
                if not self.store.thread(cid, ts):
                    raise AppError(f"Slack: {exc}") from None
        return self.store.thread(cid, ts)

    def send(self, cid: str, text: str, thread_ts: str = "", broadcast: bool = False, skip: Optional[str] = None) -> dict:
        """`text` posted as the user, kept, and told to the agents working with Slack as Slack's own copy of it would
        have been (that copy, arriving after, is one already seen) -- but to `skip`, the agent whose draft it was,
        which is told so instead."""
        if not str(text or "").strip():
            raise AppError("nothing to send")
        c = self.find(cid)
        try:
            m = self._client().post(c["id"], text, thread_ts, broadcast)
        except slack.SlackError as exc:
            raise AppError(f"Slack didn't send it: {exc}") from None
        if self.store.put_messages(c["id"], [m]):
            if thread_ts:
                self.store.replied(c["id"], thread_ts, m["ts"])
            self._tell_agents(c["id"], m, skip=skip)
        self.store.active(c["id"], m["ts"])
        self.store.read(c["id"], m["ts"])
        self._clear(c["id"], thread_ts)
        return {**m, "channel": c["id"]}

    # -- the panel

    def request(self, instance, method, path, query, body):
        try:
            if method == "GET":
                return self._get(instance, path, query)
            if method == "POST":
                ask = json.loads(body or b"{}")
                if not isinstance(ask, dict):
                    raise ValueError
                return self._post(instance, path, ask)
        except AppError as exc:
            return Response.json({"error": str(exc)}, getattr(exc, "status", 400))
        except ValueError:
            return Response.json({"error": "a JSON object, please"}, 400)
        return Response(404, b"not found")

    def _get(self, instance, path, q) -> Response:
        if path == "state":
            if self.cl is not None and time.time() - self._refreshed > REFRESH_EVERY:
                self._later_refresh()
            return Response.json({"setup": self.setup(), "settings": self._settings(), **self._lists(),
                                  "drafts": self._drafts()})
        if path == "history":
            return Response.json(self.history(q.get("conversation", ""), q.get("before", ""),
                                              int(q.get("limit") or 50)))
        if path == "thread":
            return Response.json({"messages": self.thread(q.get("conversation", ""), q.get("ts", ""))})
        if path == "search":
            try:
                return Response.json({"messages": self._client().search(q.get("q", ""), 30)})
            except slack.SlackError as exc:
                raise AppError(f"Slack: {exc}") from None
        if path == "manifest":
            with open(MANIFEST_FILE, "rb") as f:
                return Response(200, f.read(), {"Content-Type": "application/json"})
        return Response(404, b"not found")

    def _post(self, instance, path, ask) -> Response:
        if path == "view":
            if instance is not None:
                self._views[instance.id] = {"conversation": str(ask.get("conversation") or ""),
                                            "thread": str(ask.get("thread") or ""), "at": time.time()}
                self._view_changed(instance)
                key = f"thread:{ask.get('conversation')}:{ask.get('thread')}"
                if ask.get("thread") and key in self._noticed:
                    self._unnotice(key)                     # the thread opened: seen
            return Response.json({"ok": True})
        if path == "read":
            cid, ts = str(ask.get("conversation") or ""), str(ask.get("ts") or "")
            if cid and ts:
                self.store.read(cid, ts)
                self._clear(cid)
                self._tell_all({"kind": "unread", "unread": self._unread()})
            return Response.json({"ok": True})
        if path == "notified":
            cid, thread = str(ask.get("conversation") or ""), str(ask.get("thread") or "")
            if thread:
                key = f"thread:{cid}:{thread}"
                if key in self._noticed:
                    self._unnotice(key)
            else:
                self._clear(cid)
            return Response.json({"ok": True})
        if path == "send":
            m = self.send(str(ask.get("conversation") or ""), str(ask.get("text") or ""),
                          str(ask.get("thread") or ""), bool(ask.get("broadcast")))
            self._record(instance, "slack.sent", {"conversation": m["channel"], "ts": m["ts"], "draft": None,
                                                  "text": m["text"]})
            self._tell_all({"kind": "reply" if ask.get("thread") else "message", "conversation": m["channel"],
                            "message": m, "mine": True, "unread": self._unread(),
                            **({"parent": self.store.message(m["channel"], ask["thread"])} if ask.get("thread")
                               else {})})
            return Response.json({"message": m})
        if path == "draft":
            return Response.json({"draft": self._settle(instance, ask)})
        if path == "connect":
            user, app = str(ask.get("user_token") or "").strip(), str(ask.get("app_token") or "").strip()
            if not user.startswith("xoxp-"):
                raise AppError("the user token starts xoxp- (OAuth & Permissions, after installing the app)")
            if app and not app.startswith("xapp-"):
                raise AppError("the app-level token starts xapp- (Basic Information, App-Level Tokens)")
            if not slack.available():
                raise AppError("Slack's SDK isn't installed here: pip install slack_sdk", 500)
            self._save_tokens(user, app)
            self._connect(user, app, wait=bool(ask.get("wait")))
            return Response.json({"setup": self.setup()})
        if path == "disconnect":
            with self._lock:
                self._gen += 1
                cl, self.cl, self.me = self.cl, None, {}
                self.status, self.error = "off", ""
            if cl is not None:
                cl.close()
            try:
                os.remove(os.path.join(self.host.folder(), CREDENTIALS))
            except OSError:
                pass
            self._tell_all({"kind": "status", "setup": self.setup()})
            return Response.json({"setup": self.setup()})
        if path == "settings":
            if "tell_agents" in ask:
                if ask["tell_agents"] not in TELL:
                    raise AppError(f"tell_agents: one of {', '.join(TELL)}")
                self.store.set_setting("tell_agents", ask["tell_agents"])
            if "notify_system" in ask:
                if not isinstance(ask["notify_system"], bool):
                    raise AppError("notify_system: true or false")
                self.store.set_setting("notify_system", ask["notify_system"])
            self._tell_all({"kind": "settings", "settings": self._settings()})
            return Response.json({"settings": self._settings()})
        return Response(404, b"not found")

    def _settings(self) -> dict:
        return {"tell_agents": self.store.setting("tell_agents", "all"),
                "notify_system": bool(self.store.setting("notify_system", True))}

    # -- drafts

    def _drafts(self) -> List[dict]:
        return [self._shown(d) for d in self.store.drafts("pending")]

    def _shown(self, d: dict) -> dict:
        c = self.store.conversation(d["channel"])
        return {**d, "label": self.label(c) if c else d["channel"]}

    def _settle(self, instance, ask: dict) -> dict:
        """The user's answer to a draft: sent (as it is, or edited), discarded, or edited and kept."""
        d = self.store.get_draft(str(ask.get("id") or ""))
        if d is None or d["status"] != "pending":
            raise AppError("no draft waiting with that id", 404)
        action = ask.get("action")
        text = ask.get("text") if isinstance(ask.get("text"), str) else d["text"]
        broadcast = bool(ask["broadcast"]) if "broadcast" in ask else d["broadcast"]
        if action == "edit":
            d = self.store.set_draft(d["id"], text=text, broadcast=broadcast)
            self._tell_all({"kind": "draft", "draft": self._shown(d)})
            return self._shown(d)
        if action == "send":
            m = self.send(d["channel"], text, d["thread_ts"], broadcast, skip=d.get("by_channel") or None)
            edited = text != d["text"]
            d = self.store.set_draft(d["id"], text=text, broadcast=broadcast, status="sent", done=time.time(),
                                     sent_ts=m["ts"])
            self._record(instance, "slack.sent", {"conversation": d["channel"], "ts": m["ts"], "draft": d["id"],
                                                  "text": text})
            self._tell_drafter(d, f"The user sent your draft {d['id']} in {self._shown(d)['label']}"
                                  + (", after editing it" if edited else "") + f": {plain(text)}")
            self._tell_all({"kind": "draft", "draft": self._shown(d)})
            self._tell_all({"kind": "reply" if d["thread_ts"] else "message", "conversation": d["channel"],
                            "message": m, "mine": True, "unread": self._unread(),
                            **({"parent": self.store.message(d["channel"], d["thread_ts"])} if d["thread_ts"]
                               else {})})
            return self._shown(d)
        if action == "discard":
            d = self.store.set_draft(d["id"], status="discarded", done=time.time())
            self._record(instance, "slack.discarded", {"conversation": d["channel"], "draft": d["id"]})
            self._tell_drafter(d, f"The user discarded your draft {d['id']} in {self._shown(d)['label']}; nothing "
                                  f"was sent.")
            self._tell_all({"kind": "draft", "draft": self._shown(d)})
            return self._shown(d)
        raise AppError("action: send, discard or edit")

    def _tell_drafter(self, d: dict, text: str) -> None:
        """The agent that made a draft, told what the user did with it -- attached to Slack or not (the gatherer
        agent uses every app without being attached)."""
        if not d.get("by_channel"):
            return
        for inst in self.host.instances():
            if inst.gatherer == d.get("gatherer"):
                try:
                    self.host.insert(inst, [context_stream(STREAM, "the user", text)], channel=d["by_channel"])
                except AppError:
                    pass
                return

    def _record(self, instance, type_: str, payload: dict, channel: Optional[str] = None) -> None:
        targets = [instance] if instance is not None else self.host.instances()
        for inst in targets[:1]:
            try:
                self.host.insert(inst, [{"type": type_, "payload": payload}], channel=channel)
            except AppError:
                pass

    # -- agents

    def call(self, instance: Instance, tool: str, args: dict, caller: Caller) -> ToolResult:
        try:
            if tool == "read":
                return ToolResult.text(self._read_tool(instance, args))
            if tool == "search":
                return ToolResult.text(self._search_tool(args))
            if tool == "draft":
                return ToolResult.text(self._draft_tool(instance, args, caller))
        except AppError as exc:
            return ToolResult.error(str(exc))
        except slack.SlackError as exc:
            return ToolResult.error(f"Slack: {exc}")
        raise AppError(f"{tool}: not a tool of Slack")

    def _line(self, m: dict, indent: str = "") -> str:
        out = f"{indent}[{m['ts']}] {self.who(m)}: {self.plain(m['text'])}"
        if m.get("files"):
            out += "".join(f" [file: {f['name']}]" for f in m["files"])
        if m.get("reply_count") and m.get("ts") == (m.get("thread_ts") or m["ts"]):
            out += f"  ({m['reply_count']} replies: thread {m['ts']})"
        if m.get("edited"):
            out += " (edited)"
        return out

    def _read_tool(self, instance: Instance, args: dict) -> str:
        if self.cl is None and not self.store.conversations():
            raise AppError("Slack isn't connected yet: ask the user to connect it in the Slack panel")
        ref = args.get("conversation")
        if not ref:
            unread = self._unread()
            convs = sorted(self.store.conversations(),
                           key=lambda c: (-(unread.get(c["id"], [0, 0])[1]), -(unread.get(c["id"], [0, 0])[0]),
                                          -_num(c["latest_ts"]), c["name"]))
            lines = [self._view_line(instance), "The user's Slack conversations (unread first):"]
            for c in convs:
                u, m = unread.get(c["id"], [0, 0])
                note = f" -- {u} unread" + (f", {m} for the user" if m else "") if u else ""
                lines.append(f"- {self.label(c)} ({c['id']}){note}")
            drafts = self._drafts()
            if drafts:
                lines.append("Drafts waiting for the user to send:")
                lines += [f"- {d['id']} in {d['label']}: {plain(d['text'])}" for d in drafts]
            return "\n".join(lines)
        c = self.find(str(ref), instance)
        limit = max(1, min(int(args.get("limit") or 20), 100))
        thread = str(args.get("thread") or "")
        if not thread and str(ref).strip().lower() == "open":
            thread = (self.view(instance) or {}).get("thread") or ""      # the thread open, if one is
        member = "" if c.get("member", True) else " (a channel the user isn't in)"
        if thread:
            msgs = self.thread(c["id"], thread)
            return f"Thread {thread} in {self.label(c)} ({c['id']}){member}:\n" + "\n".join(self._line(m) for m in msgs)
        got = self.history(c["id"], "", limit)
        head = f"{self.label(c)} ({c['id']}){member}" + (f", topic: {c['topic']}" if c.get("topic") else "")
        return f"The latest {len(got['messages'])} messages in {head}, oldest first:\n" + \
            "\n".join(self._line(m) for m in got["messages"])

    def _search_tool(self, args: dict) -> str:
        q = str(args.get("query") or "").strip()
        if not q:
            raise AppError("slack_search: a `query`")
        found = self._client().search(q, int(args.get("limit") or 20))
        if not found:
            return f"Nothing in Slack matches {q!r}."
        lines = []
        for m in found:
            c = self.store.conversation(m["channel"])
            where = self.label(c) if c else f"#{m['channel_name'] or m['channel']}"
            if c is None or not c.get("member", True):
                where += " (the user isn't in it)"
            ref = f"conversation {m['channel']}" + (f", thread {m['thread_ts']}" if m.get("thread_ts") else "")
            said = " ".join(self.plain(m["text"]).split())          # one line a hit
            lines.append(f"- {where} [{m['ts']}] {m['username'] or self.name(m['user'])}: {said}  [{ref}]")
        return ("Newest first; read more with slack_read and the conversation (and thread) given.\n"
                + "\n".join(lines))

    def _draft_tool(self, instance: Instance, args: dict, caller: Caller) -> str:
        text = args.get("text")
        if not isinstance(text, str) or not text.strip():
            raise AppError("slack_draft: the reply's `text`")
        if args.get("draft"):
            d = self.store.get_draft(str(args["draft"]))
            if d is None or d["status"] != "pending":
                raise AppError(f"no draft {args['draft']} waiting: make a new one")
            d = self.store.set_draft(d["id"], text=text, broadcast=bool(args.get("broadcast", d["broadcast"])))
        else:
            ref = str(args.get("conversation") or "")
            c = self.find(ref, instance)
            thread = str(args.get("thread") or "")
            if not thread and ref.strip().lower() == "open":
                thread = (self.view(instance) or {}).get("thread") or ""   # into the thread open, if one is
            if thread:
                parent = self.store.message(c["id"], thread)
                if parent and parent.get("thread_ts") and parent["thread_ts"] != thread:
                    thread = parent["thread_ts"]          # a reply's ts given: its thread's
            d = self.store.draft(c["id"], text, thread, bool(args.get("broadcast")), caller.channel or "",
                                 "", instance.gatherer)
        self._record(instance, "slack.drafted", {"conversation": d["channel"], "draft": d["id"], "text": text,
                                                 "thread": d["thread_ts"] or None}, channel=caller.channel)
        self._tell_all({"kind": "draft", "draft": self._shown(d)})
        return (f"Draft {d['id']} is in the Slack panel for the user, in {self._shown(d)['label']}"
                + (" (thread reply)" if d["thread_ts"] else "") + ". Nothing was sent: the user sends it, edits it or "
                "discards it, and you will be told which.")


def _num(ts: str) -> float:
    try:
        return float(ts)
    except (TypeError, ValueError):
        return 0.0


def _kind(channel_type: Optional[str]) -> str:
    return {"im": "im", "mpim": "mpim", "group": "private"}.get(channel_type or "", "channel")


def _why(exc: Exception) -> str:
    text = str(exc)
    hints = {"invalid_auth": "the user token was refused", "not_authed": "no user token",
             "missing_scope": "the Slack app is missing a permission: make it from the manifest again",
             "token_revoked": "the token was revoked"}
    for k, v in hints.items():
        if k in text:
            return f"{v} ({k})"
    return text or type(exc).__name__
