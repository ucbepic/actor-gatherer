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

A line can also say it is up and bring nothing (one dead without a word; Slack handing the messages to another
connection on the same tokens): so each minute, with the line up, Slack's search of the newest messages is looked at
too (_check_missed), and what came in the last CHECK_BACK seconds in a conversation of the user's that the app hasn't
kept is fetched and taken as if it had come on the line -- told, notified, popped up --, and the line made again (at
most every REMAKE_EVERY seconds). One search a minute.

The line is the HOME's it was connected in (credentials.json keeps that home): Slack hands each message to only one of
the connections on an app's tokens, so a copy of the home (a test's, a backup's) that opened its own would take the
user's messages from the dashboard they use. A copy gets no line -- its panel reads Slack, says it is a copy and shows
new messages as a conversation is opened (status "copied") -- until the user connects it again there. Tokens kept
before homes were (none named) are DEFAULT_HOME's, and taken as a copy's anywhere else.

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
    POST edit {conversation, ts, text} / delete {conversation, ts}   one of the user's own messages changed / deleted
    GET  permalink?conversation=&ts=    {url}: Slack's link to a message
    GET  members?conversation=      {members}: who is in it (ids)
    POST schedule {conversation, text, thread?, at}   posted as the user at `at` (seconds) -> {scheduled}
    GET  scheduled?conversation=    {scheduled}: what waits to be posted there; POST unschedule {conversation, id}
    GET  threads                    {threads}: the threads the user follows, the newest reply first
    GET  activity                   {items, seen}: mentions of the user and reactions to their messages, newest first;
                                    POST activity_seen {at}: looked at up to `at`
    POST open {users}               the DM (one person) or group DM (several) with them, opened -> {conversation}
    POST react {conversation, ts, name, on}   the user's reaction added or taken off
    GET  file?id=&v=thumb|full&dl=  a shared file (its preview), fetched from Slack once and kept (FILES_KEEP bytes in
                                    all, the oldest let go); `dl` to save it
    POST upload?name=  (the file's bytes)   a file to share, kept until sent -> {id}; POST send {..., files: [id]}
    POST unread {conversation, ts}  the conversation marked unread from that message on, in Slack too
    GET  channels                   {channels}: the workspace's public channels, to browse; POST join / leave
                                    {conversation}
    GET  pins?conversation=         {messages}: the messages pinned there
    POST recheck {user_token?}      connected again with the tokens kept (or a new user token): the permissions the
                                    token has, read again

Some of these need permissions a Slack app made from an older manifest lacks (NEEDED): `setup` says which are
missing, read from Slack's answer to auth.test, and the panel asks the user to add them and reinstall the app.
Reading in the panel moves the user's read cursor in Slack too (conversations.mark), a moment after (MARK_WAIT).

What the panels are told: {kind: status | conversations | message | reply | changed | deleted | draft | unread |
scheduled | emoji (the workspace's own emoji) | threads (more found: the Threads view drawn again), ...}; one carrying `unread` carries `badges` too ({threads, activity}: the Threads and Activity rows' counts).

What the user writes -- in the panel, or an agent's draft they send -- has its names made Slack's (`linked`): "@Maya
Chen" (a person's display name, full name or handle) a mention of her, "@here" Slack's, "#design" a link to the channel;
never inside code or a link already Slack's."""

import json
import mimetypes
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import uuid
from typing import Callable, Dict, List, Optional

from app_kit import App, AppError, Caller, Instance, Response, ToolResult, context_stream

from . import client as slack
from .mrkdwn import plain
from .store import Store

STREAM = "Slack"
VIEW_SETTLE = 2.0   # seconds a conversation (or thread) stays open in the panel before its agents are told of it
CREDENTIALS = "credentials.json"
DEFAULT_HOME = "~/.ag"         # ag's home when AG_HOME isn't set (ag/cli/config.py): tokens kept there unnamed are its
TELL = ("all", "mentions", "none")
MANIFEST_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "slack_app_manifest.json")
REFRESH_EVERY = 300.0          # seconds between re-reads of the conversations list (joins, leaves, renames)
RECENT_DAYS = 14               # how far back the panel's Recent list looks
CATCH_UP = 40                  # at most this many conversations' missed messages fetched after (re)connecting
CATCH_PAGES = 3                # at most this many pages (of 100) of one conversation's missed messages
GAP_WAIT = 150.0               # seconds the line may go unseen (the "line" schedule sees it each minute) before what
                               # may have been missed then is fetched: the computer slept
GAP_MARGIN = 60.0              # seconds before the line was last seen up that missed messages are fetched from
CHECK_BACK = 300.0             # seconds back each minute's look at Slack's search finds messages the line never brought
REMAKE_EVERY = 600.0           # seconds: a line that missed messages made again at most this often
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
SPECIAL = {"here": "<!here>", "channel": "<!channel>", "everyone": "<!everyone>"}
KEEP = re.compile(r"```.*?```|`[^`\n]*`|<[^<>\n]*>", re.S)    # what `linked` leaves as written: code, Slack's links
CHANNEL_REF = re.compile(r"(?<![\w<|/&#])#([a-z0-9][a-z0-9_.-]*)", re.I)
MEMBERS_FOR = 300.0            # seconds a conversation's members are kept before Slack is asked again
LOOK_EVERY = 300.0             # seconds between Slack's searches for the Threads and Activity views (when shown)
LOOK_THREADS = 12              # at most this many threads the user replied in fetched a search
with open(MANIFEST_FILE) as _f:
    NEEDED = tuple(json.load(_f)["oauth_config"]["scopes"]["user"])   # the permissions every part of the app uses
FEATURES = {"reactions:write": ("reactions",), "files:read": ("files",), "files:write": ("files",),
            "emoji:read": ("custom emoji",), "channels:write": ("read marks in Slack", "joining channels"),
            "groups:write": ("read marks in Slack",), "mpim:write": ("group DMs",), "pins:read": ("pins",)}
FEATURE_ORDER = ("reactions", "files", "custom emoji", "read marks in Slack", "joining channels", "group DMs", "pins")
FILE_ID = re.compile(r"^F[A-Z0-9]{6,}$")
FILE_MOST = 200 * 1024 * 1024  # the largest file the panel fetches
FILES_KEEP = 300 * 1024 * 1024 # the fetched files kept in all (the oldest let go)
STAGED_FOR = 3600.0            # seconds a file the panel staged to share is kept, unsent
FILE_INFO_FOR = 600.0          # seconds a file's details are kept before Slack is asked again
EMOJI_EVERY = 6 * 3600.0       # seconds between reads of the workspace's own emoji
MARK_WAIT = 1.5                # seconds after the user reads in the panel that Slack's read cursor is moved
CHANNELS_FOR = 600.0           # seconds the workspace's channel list is kept
UPLOAD_LOOKS = 6               # times Slack's history is looked at for the message files were shared in
AGENT_TEXT = 60000             # at most this many characters of a file's text given to an agent
AGENT_IMAGE = 4 * 1024 * 1024  # the largest picture given to an agent as one
TEXT_KINDS = {"text", "markdown", "post", "python", "javascript", "json", "csv", "tsv", "html", "xml", "yaml", "shell",
              "sql", "c", "cpp", "java", "go", "rust", "ruby", "php", "latex", "r", "diff", "css", "typescript",
              "kotlin", "swift", "scala", "matlab", "perl", "bash", "toml", "ini", "plain"}
NOT_NEWS = ("channel_join", "channel_leave", "group_join", "group_leave", "channel_topic", "channel_purpose",
            "channel_name", "group_topic", "group_purpose", "group_name", "pinned_item", "unpinned_item")


class SlackApp(App):
    def __init__(self, make_client: Optional[Callable[[str, str], "slack.Client"]] = None):
        self._make = make_client or slack.Client
        self.store: Optional[Store] = None
        self.cl = None
        self.me: Dict[str, str] = {}
        self.status = "off"          # off | connecting | connected | live-off (no app token) | copied (a copy of
                                     # the home the tokens are of: no line) | disconnected | error
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
        self._copy_of: Optional[str] = None                  # the home the tokens are of, when this one is a copy
        self._remade_at = 0.0                                # when a line that missed messages was last made again
        self._names = (None, None)                           # (the people it was made of, the @name pattern)
        self._members: Dict[str, tuple] = {}                 # conversation -> (when asked, its members)
        self._looked: Dict[str, float] = {}                  # "threads" / "activity" -> when Slack's search was asked
        self._mention_hits: List[dict] = []                  # mentions of the user Slack's search found (not kept)
        self.scopes: Optional[List[str]] = None              # the token's permissions, as Slack said (None: not said)
        self._emoji: Dict[str, str] = {}                     # the workspace's own emoji
        self._emoji_at = 0.0
        self._files: Dict[str, tuple] = {}                   # file id -> (when asked, its details)
        self._kinds: Dict[str, str] = {}                     # a fetched file's path -> its content type
        self._staged: Dict[str, dict] = {}                   # a file the panel staged to share: {path, name, at}
        self._marks: Dict[str, str] = {}                     # conversation -> the read cursor to move Slack's to
        self._mark_timers: Dict[str, threading.Timer] = {}
        self._channels = (0.0, [])                           # (when, the workspace's public channels)

    # -- the host

    def start(self, host) -> None:
        super().start(host)
        self.store = Store(os.path.join(host.folder(), "slack.db"))
        self._users = self.store.users()
        got = self.store.setting("emoji", {}) or {}
        self._emoji, self._emoji_at = dict(got.get("map") or {}), _num(got.get("at"))
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

    def _home(self) -> str:
        """The ag home the app runs in (its folder is <home>/apps/<name>/data), as a real path."""
        return os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(self.host.folder()))))

    def _tokens(self):
        """(user token, app token) -- the app token, which opens the live line, only in the home the tokens were
        connected in: in a copy of it, '' (and `_copy_of` that home). Kept with no home named (before homes were):
        DEFAULT_HOME's, named so now; anywhere else, a copy's."""
        try:
            with open(os.path.join(self.host.folder(), CREDENTIALS)) as f:
                got = json.load(f)
            user, app, home = (str(got.get(k) or "") for k in ("user_token", "app_token", "home"))
        except (OSError, ValueError, AttributeError):
            self._copy_of = None
            return os.environ.get(ENV[0], ""), os.environ.get(ENV[1], "")
        here = self._home()
        if not home and here == os.path.realpath(os.path.expanduser(DEFAULT_HOME)):
            self._save_tokens(user, app)
            home = here
        self._copy_of = None if (not app or home == here) else (home or "another ag home")
        return user, ("" if self._copy_of is not None else app)

    def _save_tokens(self, user: str, app: str) -> None:
        """The tokens kept, readable by the user only, with the home they are this one's of."""
        path = os.path.join(self.host.folder(), CREDENTIALS)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump({"user_token": user, "app_token": app, "home": self._home()}, f)
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
                self.scopes = me.pop("scopes", None)
                self.cl, self.me = cl, me
            self._refresh(cl)
            if time.time() - self._emoji_at > EMOJI_EVERY or not self._emoji:
                self._load_emoji(cl)
            if app:
                cl.listen(lambda ev: self._event(gen, ev), lambda s: self._on_status(gen, s))
                self._lost = False
                self._seen_up(time.time())
            else:
                self._on_status(gen, "copied" if self._copy_of is not None else "live-off")
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
            gap = self._lost or (self._up_at > 0 and now - self._up_at > GAP_WAIT)
            if gap:
                self._later_catch_up(gen, cl, self._missed_after())
            self._seen_up(now)
            if now - self._emoji_at > EMOJI_EVERY:
                threading.Thread(target=self._load_emoji, args=(cl,), name="ag-slack-emoji", daemon=True).start()
            self._learn_reads(gen, cl, LEARN_MOST)
            self._sync_read(cl)
            if not gap:                                     # (a catch-up fetches those, and more)
                try:
                    self._check_missed(gen, cl, now)
                except Exception:  # noqa: BLE001 - looked at again next minute; the line's own checks go on
                    pass
        elif self._down_since is None:
            self._down_since = now
            self._lost = True
            self._tell_all({"kind": "status", "setup": self.setup()})
        elif now - self._down_since >= DOWN_WAIT:
            self._down_since = None
            self._connect(user, app)

    def _check_missed(self, gen: int, cl, now: float) -> int:
        """Each minute, with the line up: Slack's search of the newest messages, and those of the last CHECK_BACK
        seconds in a conversation of the user's that the app hasn't kept -- the line never brought them -- fetched
        (their conversation since then, or their thread) and taken as if they had come on it; then the line made again
        (at most every REMAKE_EVERY seconds). -> how many were taken."""
        day = time.strftime("%Y-%m-%d", time.localtime(now - 2 * 86400))   # (search's after: is a day, not a time)
        try:
            hits = cl.recent(day, pages=1)
        except slack.SlackError:
            return 0
        floor = now - CHECK_BACK
        want: Dict[tuple, None] = {}                        # (conversation, thread or '')
        for h in hits:
            cid, ts = h.get("channel") or "", h.get("ts") or ""
            c = self.store.conversation(cid) if cid else None
            if c is None or c.get("gone") or _num(ts) <= floor or self.store.message(cid, ts) is not None:
                continue
            thread = h.get("thread_ts") or ""
            want[(cid, thread if thread and thread != ts else "")] = None
        got: List[tuple] = []
        for cid, thread in list(want)[:CATCH_UP]:
            if gen != self._gen:
                return 0
            try:
                msgs = cl.replies(cid, thread) if thread else self._since(cl, cid, f"{floor:.6f}")
            except slack.SlackError:
                continue
            parent = next((m.get("user") or "" for m in msgs if m["ts"] == thread), "") if thread else ""
            got.extend((cid, m, parent) for m in msgs if _num(m["ts"]) > floor)
        taken = 0
        for cid, m, parent in sorted(got, key=lambda x: _num(x[1]["ts"])):
            if gen != self._gen:
                return taken
            taken += self._take(cid, m, parent)
        if taken and now - self._remade_at >= REMAKE_EVERY:
            self._remade_at = now
            user, app = self._tokens()
            if user and app:
                self._connect(user, app)                    # a line that let messages by is not one to keep
        return taken

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

    def missing(self) -> List[str]:
        """The permissions the app uses that the token lacks ([] when Slack didn't say)."""
        return [x for x in NEEDED if x not in self.scopes] if self.scopes is not None else []

    def _load_emoji(self, cl) -> None:
        """The workspace's own emoji, read again and told to the panels (kept: the next start has them at once)."""
        if "emoji:read" in self.missing():
            return
        try:
            got = cl.emoji()
        except Exception:  # noqa: BLE001 - kept as they were; read again later
            return
        self._emoji, self._emoji_at = got, time.time()
        self.store.set_setting("emoji", {"at": self._emoji_at, "map": got})
        self._tell_all({"kind": "emoji", "emoji": got})

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
        missing = self.missing()
        return {"sdk": slack.available(), "tokens": bool(user), "live": bool(app), "status": status,
                "error": self.error, "me": self.me.get("user_id", ""), "team": self.me.get("team", ""),
                "url": self.me.get("url", ""), "copy_of": self._copy_of or "", "scopes": self.scopes,
                "missing": missing, "missing_for": [f for f in FEATURE_ORDER if any(f in FEATURES.get(x, ()) for x in missing)]}

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
        self._take(ch, m, ev.get("parent_user_id") or "")

    def _take(self, ch: str, m: dict, parent_user: str = "") -> bool:
        """A new message of a conversation kept (from the line, or found by _check_missed): told to the panels and the
        agents, the user notified. -> False if it was kept already (the panel's own send, a re-sent event)."""
        me = self.me.get("user_id", "")
        if not self.store.put_messages(ch, [m]):
            return False
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
            self._notify(ch, m, parent_user=parent_user)
        return True

    def _reaction(self, ev: dict, added: bool) -> None:
        item = ev.get("item") or {}
        ch, ts, name = item.get("channel") or "", item.get("ts") or "", ev.get("reaction") or ""
        me, by = self.me.get("user_id", ""), ev.get("user") or ""
        if ch and ts and name and me and ev.get("item_user") == me and by and by != me:   # to the user's message
            if added:
                self.store.add_activity("reaction", ch, ts, by, name, _num(ev.get("event_ts")) or None)
            else:
                self.store.drop_activity("reaction", ch, ts, by, name)
            self._tell_all({"kind": "unread", "unread": self._unread()})
        if ch and ts and name and by:
            self._apply_reaction(ch, ts, name, by, added)

    def _apply_reaction(self, ch: str, ts: str, name: str, by: str, added: bool) -> None:
        """`by`'s reaction `name` added to (or taken off) a kept message -- once: a reaction Slack tells of twice (the
        user's own, kept as they made it, then told on the line) counted once, by who reacted, as far as known."""
        m = self.store.message(ch, ts)
        if m is None:
            return
        me = self.me.get("user_id", "")
        reactions = [dict(r) for r in m.get("reactions") or []]
        r = next((r for r in reactions if r["name"] == name), None)
        users = list((r or {}).get("users") or [])
        if added:
            if r is None:
                reactions.append({"name": name, "count": 1, "mine": by == me, "users": [by]})
            elif by not in users:
                r.update(count=r["count"] + 1, users=users + [by], mine=bool(r.get("mine") or by == me))
            else:
                return
        else:
            if r is None:
                return
            if by in users:
                users.remove(by)
            elif r["count"] <= len(users):                  # (not among them, and they are all of them)
                return
            r.update(count=r["count"] - 1, users=users, mine=bool(r.get("mine")) and by != me)
            if r["count"] <= 0:
                reactions.remove(r)
        self.store.put_messages(ch, [{**m, "reactions": reactions}])
        self._tell_all({"kind": "changed", "conversation": ch, "message": self.store.message(ch, ts)})

    def react(self, cid: str, ts: str, name: str, on: bool) -> dict:
        """The user's reaction added (`on`) or taken off; the message's reactions read again from Slack after, so the
        line's own word of it changes nothing."""
        name = str(name or "").strip().strip(":")
        if not name or not re.match(r"^[a-z0-9_+'-]+(::skin-tone-[2-6])?$", name):
            raise AppError("which emoji: its name, as :name:")
        cl = self._client()
        try:
            cl.react(cid, ts, name, on)
        except slack.SlackError as exc:
            if str(exc) not in ("already_reacted", "no_reaction"):
                raise AppError(f"Slack: {_why(exc)}") from None
        m = self.store.message(cid, ts)
        if m is not None:
            try:
                fresh = cl.reactions(cid, ts)
            except slack.SlackError:
                self._apply_reaction(cid, ts, name, self.me.get("user_id", ""), on)
            else:
                self.store.put_messages(cid, [{**m, "reactions": fresh}])
                self._tell_all({"kind": "changed", "conversation": cid, "message": self.store.message(cid, ts)})
        return self.store.message(cid, ts) or {}

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
        text += self._files_said(m)
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
            if what == "thread":
                self._tell_all({"kind": "unread", "unread": self._unread()})    # (the Threads row's count)

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
        had = self._noticed.pop(key, None) is not None
        self._keep_noticed()
        if had and key.startswith("thread:"):
            self._tell_all({"kind": "unread", "unread": self._unread()})        # (the Threads row's count)

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

    def linked(self, text: str) -> str:
        """What the user wrote, its names made Slack's links: @here, @channel, @everyone; "@" and a person's display
        name, full name or handle, a mention of them (the longest name that fits); "#" and a channel's name, a link to
        it -- outside code and Slack's own <...> links."""
        out, at = [], 0
        for m in KEEP.finditer(text or ""):
            out += [self._link_names(text[at:m.start()]), m.group(0)]
            at = m.end()
        return "".join(out + [self._link_names((text or "")[at:])])

    def _link_names(self, part: str) -> str:
        if "@" not in part and "#" not in part:
            return part
        users = self._users
        if self._names[0] is not users:
            people: Dict[str, str] = {}
            for key in ("handle", "name", "real_name"):      # a handle first: it is the user's own
                for uid, u in users.items():
                    n = (u.get(key) or "").strip()
                    if len(n) >= 2 and not u.get("deleted"):
                        people.setdefault(n.lower(), uid)
            alts = sorted(set(people) | set(SPECIAL), key=len, reverse=True)
            pat = re.compile(r"(?<![\w<|/@.])@(" + "|".join(re.escape(n) for n in alts) + r")(?![\w-])", re.I)
            self._names = (users, (pat, people))
        pat, people = self._names[1]

        def person(m: "re.Match") -> str:
            n = m.group(1).lower()
            return SPECIAL[n] if n in SPECIAL else f"<@{people[n]}>"
        part = pat.sub(person, part)
        if "#" in part:
            chans = {c["name"].lower(): c["id"] for c in self.store.conversations()
                     if c["kind"] in ("channel", "private") and c.get("name")}
            part = CHANNEL_REF.sub(lambda m: f"<#{chans[m.group(1).lower()]}>" if m.group(1).lower() in chans
                                   else m.group(0), part)
        return part

    def _unread(self) -> Dict[str, list]:
        return {k: list(v) for k, v in self.store.unread(self.me.get("user_id", "")).items()}

    def _badges(self) -> dict:
        """The Threads and Activity rows' counts: threads with a reply for the user (a notification open), and
        mentions and reactions since the user last looked at Activity."""
        seen = _num(self.store.setting("activity_seen", 0))
        if not seen:                                        # (counted from when Activity was first there)
            seen = time.time()
            self.store.set_setting("activity_seen", seen)
        return {"threads": sum(1 for k in self._noticed if k.startswith("thread:")),
                "activity": sum(1 for x in self._activity(30) if x["at"] > seen)}

    def _lists(self) -> dict:
        convs = self.store.conversations()
        return {"conversations": [{**c, "label": self.label(c)} for c in convs], "unread": self._unread(),
                "badges": self._badges(),
                "users": {k: {"name": v["real_name"] or v["name"], "handle": v["name"], "bot": v["bot"],
                              "image": v.get("image") or "", "status": v.get("status"), "title": v.get("title") or "",
                              "tz": v.get("tz") or "", "deleted": bool(v.get("deleted"))}
                          for k, v in self._users.items()}}

    def _tell_all(self, message: dict) -> None:
        if self.host is None:
            return
        if "unread" in message and "badges" not in message:
            message = {**message, "badges": self._badges()}
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
        if self.cl is not None and kept and any(not f.get("id") for m in kept for f in m.get("files") or []):
            try:                                            # (files kept from before their ids were): read again
                self.store.put_messages(cid, self.cl.history(cid, latest=before, limit=limit)[0])
                kept = self.store.history(cid, before, limit)
            except slack.SlackError:
                pass
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

    def send(self, cid: str, text: str, thread_ts: str = "", broadcast: bool = False, skip: Optional[str] = None,
             files: Optional[List[str]] = None) -> dict:
        """`text` posted as the user (with `files` the panel staged, shared with it), kept, and told to the agents
        working with Slack as Slack's own copy of it would have been (that copy, arriving after, is one already seen) --
        but to `skip`, the agent whose draft it was, which is told so instead."""
        if files:
            return self._share(cid, text, thread_ts, files)
        if not str(text or "").strip():
            raise AppError("nothing to send")
        c = self.find(cid)
        try:
            m = self._client().post(c["id"], self.linked(text), thread_ts, broadcast)
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

    def _share(self, cid: str, text: str, thread_ts: str, ids: List[str]) -> dict:
        """Files the panel staged, shared in `cid` (its thread) with `text`; the message they came in looked for in
        Slack's history a few times (Slack posts it a moment after) and kept, as a sent message is. -> it, or one with
        no ts when Slack hadn't posted it yet (the line brings it)."""
        staged = [self._staged.get(i) for i in ids]
        if not ids or any(x is None for x in staged):
            raise AppError("a file to share is no longer here: attach it again")
        c = self.find(cid)
        cl = self._client()
        try:
            fids = cl.upload(c["id"], [(x["path"], x["name"]) for x in staged], self.linked(text or ""), thread_ts)
        except slack.SlackError as exc:
            raise AppError(f"Slack didn't share it: {_why(exc)}") from None
        for i, x in zip(ids, staged):
            self._staged.pop(i, None)
            try:
                os.remove(x["path"])
            except OSError:
                pass
        me = self.me.get("user_id", "")
        for n in range(UPLOAD_LOOKS):
            try:
                msgs = cl.replies(c["id"], thread_ts) if thread_ts else cl.history(c["id"], limit=10)[0]
            except slack.SlackError:
                break
            m = next((m for m in msgs if m.get("user") == me and fids and
                      any(f.get("id") in fids for f in m.get("files") or [])), None)
            if m is not None:
                if self.store.put_messages(c["id"], [m]):
                    if thread_ts:
                        self.store.replied(c["id"], thread_ts, m["ts"])
                    self._tell_agents(c["id"], m)
                self.store.active(c["id"], m["ts"])
                self.store.read(c["id"], m["ts"])
                self._clear(c["id"], thread_ts)
                return {**m, "channel": c["id"]}
            time.sleep(0.4 + 0.3 * n)
        return {"ts": "", "user": me, "text": text or "", "thread_ts": thread_ts, "channel": c["id"], "files": []}

    def stage(self, name: str, body: bytes) -> dict:
        """A file the panel will share, kept in the app's folder until it is sent (or STAGED_FOR seconds)."""
        if not body:
            raise AppError("an empty file")
        folder = os.path.join(self.host.folder(), "uploads")
        os.makedirs(folder, exist_ok=True)
        now = time.time()
        for k, x in list(self._staged.items()):
            if now - x["at"] > STAGED_FOR:
                self._staged.pop(k, None)
                try:
                    os.remove(x["path"])
                except OSError:
                    pass
        sid = uuid.uuid4().hex
        path = os.path.join(folder, sid)
        with open(path, "wb") as f:
            f.write(body)
        name = os.path.basename(str(name or "").replace("\\", "/")).strip() or "file"
        self._staged[sid] = {"path": path, "name": name[:200], "at": now}
        return {"id": sid, "name": name[:200], "size": len(body)}

    def _file_info(self, fid: str) -> dict:
        if not FILE_ID.match(fid or ""):
            raise AppError("not a Slack file's id", 400)
        got = self._files.get(fid)
        if got and time.time() - got[0] < FILE_INFO_FOR:
            return got[1]
        try:
            info = self._client().file(fid)
        except slack.SlackError as exc:
            if str(exc) == "missing_scope":
                raise AppError("seeing files needs the files:read permission: update your Slack app", 403) from None
            raise AppError(f"Slack: {exc}", 404 if str(exc) == "file_not_found" else 502) from None
        self._files[fid] = (time.time(), info)
        return info

    def fetch_file(self, fid: str, variant: str = "full") -> tuple:
        """A shared file (`variant` "thumb": its preview), fetched from Slack once and kept -> (path, content type,
        its details)."""
        info = self._file_info(fid)
        if info.get("gone"):
            raise AppError("Slack no longer shows this file", 410)
        thumb = variant == "thumb" and bool(info.get("thumb"))
        url = info["thumb"] if thumb else info.get("url")
        if not url:
            raise AppError("this file isn't kept in Slack (an outside link?)", 404)
        if not thumb and info.get("size", 0) > FILE_MOST:
            raise AppError("this file is too large to fetch here: open it in Slack", 413)
        folder = os.path.join(self.host.folder(), "files")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f"{fid}-{'thumb' if thumb else 'full'}")
        if not os.path.isfile(path):
            try:
                self._kinds[path] = self._client().download(url, path, FILE_MOST)
            except slack.SlackError as exc:
                if str(exc) == "missing_scope":
                    raise AppError("seeing files needs the files:read permission: update your Slack app", 403) from None
                raise AppError(f"Slack: {exc}", 502) from None
            except (OSError, urllib.error.URLError) as exc:
                raise AppError(f"couldn't fetch it from Slack: {exc}", 502) from None
            self._trim_files(folder)
        kind = (self._kinds.get(path) or "").split(";")[0].strip()
        if not kind or kind == "application/octet-stream":
            kind = (info.get("mimetype") if not thumb else mimetypes.guess_type(url.split("?")[0])[0]) or \
                "application/octet-stream"
        return path, kind, info

    @staticmethod
    def _trim_files(folder: str) -> None:
        """The fetched files kept to FILES_KEEP bytes in all, the longest unused let go."""
        try:
            got = sorted(((e.stat().st_atime, e.stat().st_size, e.path) for e in os.scandir(folder) if e.is_file()),
                         reverse=True)
        except OSError:
            return
        total = 0
        for _, size, path in got:
            total += size
            if total > FILES_KEEP:
                try:
                    os.remove(path)
                except OSError:
                    pass

    def _mark_later(self, cid: str, ts: str) -> None:
        """Slack's own read cursor of `cid` moved to `ts`, a moment after the user read it here (MARK_WAIT: reading
        on, they move it once)."""
        if self.cl is None or self._copy_of is not None or not self._can_mark(cid):
            return
        self._marks[cid] = ts
        if cid not in self._mark_timers:
            t = threading.Timer(MARK_WAIT, self._mark_now, args=(cid,))
            t.daemon = True
            self._mark_timers[cid] = t
            t.start()

    def _can_mark(self, cid: str) -> bool:
        c = self.store.conversation(cid) or {}
        need = {"channel": "channels:write", "private": "groups:write", "mpim": "mpim:write", "im": "im:write"}.get(c.get("kind"))
        return bool(need) and need not in self.missing()

    def _mark_now(self, cid: str) -> None:
        self._mark_timers.pop(cid, None)
        ts, cl = self._marks.pop(cid, None), self.cl
        if ts and cl is not None:
            try:
                cl.mark(cid, ts)
            except Exception:  # noqa: BLE001 - Slack's cursor stays; the app's moved
                pass

    def channels(self) -> List[dict]:
        """The workspace's public channels (kept CHANNELS_FOR seconds), each said whether the user is in it."""
        at, got = self._channels
        if time.time() - at > CHANNELS_FOR or not got:
            try:
                got = self._client().channels()
            except slack.SlackError as exc:
                raise AppError(f"Slack: {exc}") from None
            self._channels = (time.time(), got)
        mine = {c["id"] for c in self.store.conversations()}
        return [{**c, "member": c["id"] in mine} for c in got]

    def join(self, cid: str) -> dict:
        try:
            got = self._client().join(cid)
        except slack.SlackError as exc:
            raise AppError(f"Slack didn't add you: {_why(exc)}") from None
        info = (self.cl.conversation(cid) if self.cl is not None else None) or got
        self.store.add_conversation(info, read_ts=f"{time.time():.6f}")
        self._tell_all({"kind": "conversations", **self._lists()})
        return self.store.conversation(cid) or info

    def leave(self, cid: str) -> None:
        try:
            self._client().leave(cid)
        except slack.SlackError as exc:
            raise AppError(f"Slack didn't let you leave: {_why(exc)}") from None
        self.store.leave(cid)
        self._tell_all({"kind": "conversations", **self._lists()})

    def _own(self, cid: str, ts: str) -> dict:
        m = self.store.message(cid, ts)
        if m is None:
            raise AppError("no such message", 404)
        if not m.get("user") or m["user"] != self.me.get("user_id"):
            raise AppError("only your own messages", 403)
        return m

    def edit(self, cid: str, ts: str, text: str) -> dict:
        """One of the user's own messages, its text replaced in Slack and here."""
        if not str(text or "").strip():
            raise AppError("an edit needs some text: delete the message instead")
        self._own(cid, ts)
        try:
            got = self._client().update(cid, ts, self.linked(text))
        except slack.SlackError as exc:
            raise AppError(f"Slack didn't change it: {exc}") from None
        m = self.store.change(cid, ts, {"text": got["text"]})
        self._tell_all({"kind": "changed", "conversation": cid, "message": m})
        return m

    def delete(self, cid: str, ts: str) -> None:
        self._own(cid, ts)
        try:
            self._client().delete(cid, ts)
        except slack.SlackError as exc:
            if str(exc) != "message_not_found":
                raise AppError(f"Slack didn't delete it: {exc}") from None
        self.store.delete(cid, ts)
        self._tell_all({"kind": "deleted", "conversation": cid, "ts": ts, "unread": self._unread()})

    def members(self, cid: str) -> List[str]:
        got = self._members.get(cid)
        if got and time.time() - got[0] < MEMBERS_FOR:
            return got[1]
        try:
            ids = self._client().members(cid)
        except slack.SlackError as exc:
            raise AppError(f"Slack: {exc}") from None
        self._members[cid] = (time.time(), ids)
        return ids

    def threads(self) -> List[dict]:
        """The threads the user follows -- started or replied in (as kept here), or Slack said so -- each {conversation,
        parent, last (its newest reply), unread (a notification of it open)}, the newest reply first."""
        me = self.me.get("user_id", "")
        got = self.store.threads(me, 60) if me else []
        have = {(t["channel"], t["ts"]) for t in got}
        more = [k for k, (followed, _) in self._threads.items() if followed and k not in have]
        more += [tuple(k.split(":", 2)[1:]) for k in self._noticed if k.startswith("thread:")]
        got += self.store.thread_heads(dict.fromkeys(k for k in more if k not in have))
        got.sort(key=lambda t: -_num(t["last"]["ts"]))
        return [{"conversation": t["channel"], "parent": {k: v for k, v in t.items() if k != "last"},
                 "last": t["last"], "unread": f"thread:{t['channel']}:{t['ts']}" in self._noticed} for t in got[:60]]

    def _look(self, what: str) -> None:
        """What the Threads or Activity view shows, filled from Slack's search too -- in the background, at most every
        LOOK_EVERY seconds -- since the app keeps only what it has seen: "threads", the threads the user replied in over
        the last RECENT_DAYS days (their replies fetched); "activity", the messages that mention them. The panels are
        told when more is found."""
        cl, me = self.cl, self.me.get("user_id", "")
        if cl is None or not me or time.time() - self._looked.get(what, 0) < LOOK_EVERY:
            return
        self._looked[what] = time.time()
        day = time.strftime("%Y-%m-%d", time.localtime(time.time() - RECENT_DAYS * 86400))

        def run() -> None:
            try:
                if what == "threads":
                    have = {(t["channel"], t["ts"]) for t in self.store.threads(me, 200)}
                    keys = [(h["channel"], h["thread_ts"]) for h in cl.search(f"from:<@{me}> after:{day}", 100)
                            if h.get("thread_ts") and h["thread_ts"] != h["ts"]]
                    got = 0
                    for cid, th in [k for k in dict.fromkeys(keys) if k not in have][:LOOK_THREADS]:
                        c = self.store.conversation(cid)
                        if c is None or c.get("gone"):
                            continue
                        self.store.put_messages(cid, cl.replies(cid, th))
                        got += 1
                    if got:
                        self._tell_all({"kind": "threads"})
                else:
                    hits = [h for h in cl.search(f"<@{me}> after:{day}", 100) if h.get("user") != me]
                    self._mention_hits = hits
                    self._tell_all({"kind": "unread", "unread": self._unread()})    # (Activity's count)
            except Exception:  # noqa: BLE001 - looked for again next time the view is shown
                self._looked[what] = 0.0
        threading.Thread(target=run, name=f"ag-slack-{what}", daemon=True).start()

    def _activity(self, limit: int = 60) -> List[dict]:
        """Mentions of the user and reactions to their messages, newest first: each {kind, conversation, ts, at,
        message (if kept, else as search found it), user, name (a reaction's)}."""
        me = self.me.get("user_id", "")
        out = [{"kind": "mention", "conversation": m["channel"], "ts": m["ts"], "at": _num(m["ts"]), "message": m,
                "user": m.get("user") or "", "name": ""} for m in (self.store.mentions(me, limit) if me else [])]
        kept = {(x["conversation"], x["ts"]) for x in out}
        for h in self._mention_hits:
            if (h["channel"], h["ts"]) not in kept and self.store.conversation(h["channel"]) is not None:
                m = {"channel": h["channel"], "ts": h["ts"], "user": h["user"], "text": h["text"],
                     "thread_ts": h.get("thread_ts") or ""}
                out.append({"kind": "mention", "conversation": h["channel"], "ts": h["ts"], "at": _num(h["ts"]),
                            "message": m, "user": h["user"], "name": ""})
        for a in self.store.activity(limit):
            out.append({"kind": a["kind"], "conversation": a["channel"], "ts": a["ts"], "at": a["at"],
                        "message": self.store.message(a["channel"], a["ts"]), "user": a["user"], "name": a["name"]})
        out.sort(key=lambda x: -x["at"])
        return out[:limit]

    def open_with(self, users: List[str]) -> dict:
        """The DM with one person, or the group DM with several, opened if need be."""
        users = [u for u in dict.fromkeys(str(u) for u in users or []) if u and u != self.me.get("user_id")]
        if not users:
            raise AppError("whom: one person or more")
        if len(users) > 8:
            raise AppError("a group DM is at most 8 people besides you")
        cl = self._client()
        if len(users) == 1:
            got = next((c for c in self.store.conversations() if c["kind"] == "im" and c["user"] == users[0]), None)
            if got:
                return got
        try:
            made = cl.open_dm(users[0]) if len(users) == 1 else cl.open_group(users)
        except slack.SlackError as exc:
            raise AppError(f"Slack: {_why(exc)}") from None
        self.store.add_conversation(made, read_ts=f"{time.time():.6f}")
        self._tell_all({"kind": "conversations", **self._lists()})
        return self.store.conversation(made["id"]) or made

    # -- the panel

    def request(self, instance, method, path, query, body):
        try:
            if method == "POST" and path == "upload":       # (the file's own bytes, not JSON)
                return Response.json(self.stage(query.get("name", ""), body or b""))
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
                                  "drafts": self._drafts(), "emoji": self._emoji})
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
        if path == "permalink":
            try:
                return Response.json({"url": self._client().permalink(q.get("conversation", ""), q.get("ts", ""))})
            except slack.SlackError as exc:
                raise AppError(f"Slack: {exc}") from None
        if path == "members":
            return Response.json({"members": self.members(q.get("conversation", ""))})
        if path == "scheduled":
            try:
                return Response.json({"scheduled": self._client().scheduled(q.get("conversation", ""))})
            except slack.SlackError as exc:
                raise AppError(f"Slack: {exc}") from None
        if path == "file":
            fpath, kind, info = self.fetch_file(q.get("id", ""), q.get("v", "full"))
            return Response.file_at(fpath, kind, filename=info.get("name") or "file", download=bool(q.get("dl")))
        if path == "channels":
            return Response.json({"channels": self.channels()})
        if path == "pins":
            try:
                return Response.json({"messages": self._client().pins(q.get("conversation", ""))})
            except slack.SlackError as exc:
                raise AppError(f"Slack: {_why(exc)}") from None
        if path == "threads":
            self._look("threads")
            return Response.json({"threads": self.threads()})
        if path == "activity":
            self._look("activity")
            return Response.json({"items": self._activity(), "seen": _num(self.store.setting("activity_seen", 0))})
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
                self._mark_later(cid, ts)
            return Response.json({"ok": True})
        if path == "unread":
            cid, ts = str(ask.get("conversation") or ""), str(ask.get("ts") or "")
            if self.store.conversation(cid) is None or not ts:
                raise AppError("which conversation and message")
            back = self.store.before(cid, ts)
            self.store.set_read(cid, back)
            self._marks.pop(cid, None)
            self._tell_all({"kind": "unread", "unread": self._unread()})
            synced = False
            if self.cl is not None and self._can_mark(cid):
                try:
                    self.cl.mark(cid, back)
                    synced = True
                except slack.SlackError:
                    pass
            return Response.json({"read_ts": back, "in_slack": synced})
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
            files = ask.get("files") if isinstance(ask.get("files"), list) else None
            m = self.send(str(ask.get("conversation") or ""), str(ask.get("text") or ""),
                          str(ask.get("thread") or ""), bool(ask.get("broadcast")), files=[str(f) for f in files or []])
            self._record(instance, "slack.sent", {"conversation": m["channel"], "ts": m["ts"], "draft": None,
                                                  "text": m["text"]})
            self._tell_all({"kind": "reply" if ask.get("thread") else "message", "conversation": m["channel"],
                            "message": m, "mine": True, "unread": self._unread(),
                            **({"parent": self.store.message(m["channel"], ask["thread"])} if ask.get("thread")
                               else {})})
            return Response.json({"message": m})
        if path == "draft":
            return Response.json({"draft": self._settle(instance, ask)})
        if path == "edit":
            return Response.json({"message": self.edit(str(ask.get("conversation") or ""), str(ask.get("ts") or ""),
                                                       str(ask.get("text") or ""))})
        if path == "delete":
            self.delete(str(ask.get("conversation") or ""), str(ask.get("ts") or ""))
            return Response.json({"ok": True})
        if path == "schedule":
            cid, text = str(ask.get("conversation") or ""), str(ask.get("text") or "")
            at = _num(ask.get("at"))
            if not text.strip():
                raise AppError("nothing to schedule")
            if at < time.time() + 30:
                raise AppError("pick a time in the future")
            if at > time.time() + 120 * 86400:
                raise AppError("Slack schedules at most 120 days ahead")
            c = self.find(cid)
            try:
                got = self._client().schedule(c["id"], self.linked(text), at, str(ask.get("thread") or ""))
            except slack.SlackError as exc:
                raise AppError(f"Slack didn't schedule it: {exc}") from None
            self._tell_all({"kind": "scheduled", "conversation": c["id"]})
            return Response.json({"scheduled": got})
        if path == "unschedule":
            cid = str(ask.get("conversation") or "")
            try:
                self._client().unschedule(cid, str(ask.get("id") or ""))
            except slack.SlackError as exc:
                raise AppError(f"Slack: {exc}") from None
            self._tell_all({"kind": "scheduled", "conversation": cid})
            return Response.json({"ok": True})
        if path == "react":
            return Response.json({"message": self.react(str(ask.get("conversation") or ""), str(ask.get("ts") or ""),
                                                        str(ask.get("name") or ""), ask.get("on") is not False)})
        if path == "join":
            c = self.join(str(ask.get("conversation") or ""))
            return Response.json({"conversation": {**c, "label": self.label(c)}})
        if path == "leave":
            self.leave(str(ask.get("conversation") or ""))
            return Response.json({"ok": True})
        if path == "recheck":
            user, app = self._tokens()
            if not user:
                raise AppError("Slack isn't connected")
            new = str(ask.get("user_token") or "").strip()     # (reinstalling the app may have given a new one)
            if new:
                if not new.startswith("xoxp-"):
                    raise AppError("the user token starts xoxp- (OAuth & Permissions)")
                if self._copy_of is None:
                    self._save_tokens(new, app)
                user = new
            self._connect(user, app, wait=True)
            return Response.json({"setup": self.setup()})
        if path == "activity_seen":
            self.store.set_setting("activity_seen", max(_num(ask.get("at")), _num(self.store.setting("activity_seen", 0))))
            self._tell_all({"kind": "unread", "unread": self._unread()})
            return Response.json({"ok": True})
        if path == "open":
            users = ask.get("users")
            if not isinstance(users, list):
                raise AppError("users: a list of people's ids")
            return Response.json({"conversation": {**(c := self.open_with(users)), "label": self.label(c)}})
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
            if tool == "read" and args.get("file"):
                return self._file_tool(str(args["file"]))
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

    @staticmethod
    def _files_said(m: dict) -> str:
        """A message's files as an agent reads them: their names, and the id slack_read takes to read one."""
        return "".join(f" [file: {f['name']}" + (f" ({f['id']}, {f.get('kind') or 'file'})" if f.get("id") else "") + "]"
                       for f in m.get("files") or [])

    def _line(self, m: dict, indent: str = "") -> str:
        out = f"{indent}[{m['ts']}] {self.who(m)}: {self.plain(m['text'])}"
        out += self._files_said(m)
        if m.get("reactions"):
            out += " [" + ", ".join(f":{r['name']}: {r['count']}" for r in m["reactions"]) + "]"
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

    def _file_tool(self, fid: str) -> ToolResult:
        """A shared file, for an agent: a text or code file's text, a PDF's (pdftotext, where it is installed), a
        picture as one; what it is, for anything else."""
        info = self._file_info(fid.strip())
        what = f"{info['name']} ({fid}, {info.get('kind') or 'file'}, {info.get('size', 0):,} bytes)"
        mt, ft = (info.get("mimetype") or "").lower(), (info.get("filetype") or "").lower()
        if mt.startswith("image/") and mt.split("/")[1] in ("png", "jpeg", "gif", "webp"):
            path, kind, _ = self.fetch_file(fid, "full" if info.get("size", 0) <= AGENT_IMAGE else "thumb")
            if os.path.getsize(path) > AGENT_IMAGE:
                return ToolResult.text(f"{what}: a picture too large to give you; ask the user to look at it.")
            with open(path, "rb") as f:
                data = f.read()
            got = ToolResult.image(data, kind if kind.startswith("image/") else mt)
            return ToolResult([{"type": "text", "text": f"The picture {what}:"}] + got.content)
        if mt == "application/pdf" or ft == "pdf":
            tool = shutil.which("pdftotext")
            if not tool:
                return ToolResult.text(f"{what}: a PDF, and there is no pdftotext here to read it; ask the user.")
            path, _, _ = self.fetch_file(fid)
            try:
                out = subprocess.run([tool, "-layout", "-q", path, "-"], capture_output=True, timeout=60).stdout
            except (OSError, subprocess.TimeoutExpired) as exc:
                return ToolResult.error(f"couldn't read the PDF {what}: {exc}")
            return ToolResult.text(self._cut(f"The text of the PDF {what}:", out.decode("utf-8", "replace")))
        textual = mt.startswith("text/") or ft in TEXT_KINDS or mt in (
            "application/json", "application/xml", "application/javascript", "application/x-sh", "application/x-yaml",
            "application/x-tex", "application/sql")
        if textual:
            path, _, _ = self.fetch_file(fid)
            with open(path, "rb") as f:
                raw = f.read(AGENT_TEXT * 4)
            return ToolResult.text(self._cut(f"The text of {what}:", raw.decode("utf-8", "replace")))
        return ToolResult.text(f"{what}: not a kind ag can read (only text and code files, PDFs and pictures); ask the "
                               "user to open it.")

    @staticmethod
    def _cut(head: str, text: str) -> str:
        if len(text) <= AGENT_TEXT:
            return f"{head}\n{text}"
        return f"{head} (its first {AGENT_TEXT:,} of {len(text):,} characters)\n{text[:AGENT_TEXT]}"

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
