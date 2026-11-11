"""The app's line to Slack: Slack's own Python SDK (slack_sdk), on the user's own Slack app's tokens -- a user token
(xoxp-...), so what it reads is what the user can read and what it posts is posted as them, and an app-level token
(xapp-...) for Socket Mode, which brings each new message as it is sent, with no public URL.

    Client(user_token, app_token)
        who()                       auth.test: {user_id, user, team, team_id, url}
        conversations()             the conversations the user is in: each {id, kind, name, user, members, topic}
        conversation(id)            one, the same shape (None: not one the user can see)
        last_read(id)               the user's read cursor in it, as Slack keeps it: what they last read in Slack's
                                    own app ('' if none said)
        users()                     the workspace's people: each {id, name, real_name, bot}
        user(id)                    one users() leaves out (Slack's own "Slack" account a DM can be with), the same
                                    shape (None: Slack won't say)
        history(id, latest, limit, oldest)  (messages newest first, more?) -- each message as `message` shapes it
        open_dm(user)               the DM with a person, opened if it wasn't
        replies(id, ts)             a thread, its parent first
        thread_state(id, ts)        {subscribed, last_read}: whether the user follows a thread (started it, replied
                                    in it, followed it) and how far they read it in Slack's own app
        post(id, text, thread_ts, broadcast)   posted as the user -> the message
        search(query, limit)        search.messages: each {channel, channel_name, ts, user, username, text, permalink,
                                    thread_ts (the thread a reply is in, from its permalink; '' if none)}
        recent(after, pages)        the user's conversations' messages since a day, from search: each {channel, ts,
                                    thread_ts} -- when each was last active, and what the app may not have kept
        listen(on_event, on_status) Socket Mode: each Events API event to `on_event`, acknowledged; `on_status`
                                    told "connected" / "disconnected" / an error's text
        close()

`message(raw, me)` is the one shape every message is kept and shown in (store.py, the panel):
{ts, user, text, thread_ts, reply_count, latest_reply, edited, subtype, bot_name, files, reactions, attachments}.
slack_sdk is imported when a Client is made, so the app loads (and says what is missing) without it."""

import threading
import urllib.parse
from typing import Callable, List, Optional, Tuple

PAGE = 200
TYPES = "public_channel,private_channel,mpim,im"


class SlackError(Exception):
    """A call Slack refused: its error code (`not_in_channel`, `missing_scope` ...) as the message."""


def _ts(ts: str) -> float:
    try:
        return float(ts)
    except (TypeError, ValueError):
        return 0.0


def available() -> bool:
    try:
        import slack_sdk  # noqa: F401
        return True
    except ImportError:
        return False


def thread_of(permalink: str) -> str:
    """The thread a message is a reply in, from Slack's link to it (`...?thread_ts=<ts>&cid=...`; '' for a message
    not in a thread): search gives no thread_ts of its own."""
    try:
        return (urllib.parse.parse_qs(urllib.parse.urlparse(permalink or "").query).get("thread_ts") or [""])[0]
    except ValueError:
        return ""


def kind_of(c: dict) -> str:
    if c.get("is_im"):
        return "im"
    if c.get("is_mpim"):
        return "mpim"
    if c.get("is_private") or c.get("is_group"):
        return "private"
    return "channel"


def conversation(c: dict) -> dict:
    """A conversation as Slack gives it, in the app's shape."""
    topic = c.get("topic")
    return {"id": c.get("id") or "", "kind": kind_of(c), "name": c.get("name") or "", "user": c.get("user") or "",
            "members": list(c.get("members") or []),
            "topic": (topic.get("value") if isinstance(topic, dict) else topic) or ""}


def person(u: dict) -> dict:
    """A person (or app) as Slack gives them, in the app's shape."""
    p = u.get("profile") or {}
    return {"id": u.get("id"), "name": p.get("display_name") or u.get("name") or "",
            "real_name": p.get("real_name") or u.get("real_name") or "",
            "bot": bool(u.get("is_bot") or u.get("id") in ("USLACKBOT", "USLACK"))}


def message(m: dict, me: str = "") -> dict:
    """A message as Slack gives it (history, a thread, an event), in the app's shape."""
    files = [{"name": f.get("name") or f.get("title") or "file", "title": f.get("title") or ""}
             for f in (m.get("files") or []) if isinstance(f, dict)]
    reactions = [{"name": r.get("name") or "", "count": int(r.get("count") or len(r.get("users") or [])),
                  "mine": bool(me and me in (r.get("users") or []))}
                 for r in (m.get("reactions") or []) if isinstance(r, dict) and r.get("name")]
    attachments = [{"text": a.get("text") or a.get("fallback") or "", "title": a.get("title") or ""}
                   for a in (m.get("attachments") or []) if isinstance(a, dict)
                   and (a.get("text") or a.get("fallback") or a.get("title"))]
    bot = m.get("bot_profile") if isinstance(m.get("bot_profile"), dict) else {}
    out = {"ts": m.get("ts") or "", "user": m.get("user") or m.get("bot_id") or "", "text": m.get("text") or "",
           "thread_ts": m.get("thread_ts") or "", "reply_count": int(m.get("reply_count") or 0),
           "latest_reply": m.get("latest_reply") or "", "edited": bool(m.get("edited")),
           "subtype": m.get("subtype") or ""}
    name = m.get("username") or bot.get("name")
    if name:
        out["bot_name"] = name
    if files:
        out["files"] = files
    if reactions:
        out["reactions"] = reactions
    if attachments:
        out["attachments"] = attachments
    return out


class Client:
    def __init__(self, user_token: str, app_token: str = ""):
        from slack_sdk import WebClient
        from slack_sdk.http_retry.builtin_handlers import RateLimitErrorRetryHandler
        self.web = WebClient(token=user_token, timeout=30)
        self.web.retry_handlers.append(RateLimitErrorRetryHandler(max_retry_count=2))
        self.app_token = app_token
        self.me = ""
        self._socket = None
        self._lock = threading.Lock()

    def _call(self, method: str, **kw) -> dict:
        from slack_sdk.errors import SlackApiError
        try:
            return getattr(self.web, method)(**{k: v for k, v in kw.items() if v is not None}).data
        except SlackApiError as exc:
            raise SlackError(str(exc.response.get("error") or exc)) from None

    def who(self) -> dict:
        r = self._call("auth_test")
        self.me = r.get("user_id") or ""
        return {k: r.get(k) or "" for k in ("user_id", "user", "team", "team_id", "url")}

    def _pages(self, method: str, key: str, **kw) -> List[dict]:
        out, cursor = [], None
        while True:
            r = self._call(method, limit=PAGE, cursor=cursor, **kw)
            out.extend(r.get(key) or [])
            cursor = (r.get("response_metadata") or {}).get("next_cursor")
            if not cursor:
                return out

    def conversations(self) -> List[dict]:
        return [conversation(c) for c in self._pages("users_conversations", "channels", types=TYPES,
                                                     exclude_archived=True)]

    def conversation(self, cid: str) -> Optional[dict]:
        try:
            return conversation(self._call("conversations_info", channel=cid).get("channel") or {})
        except SlackError:
            return None

    def last_read(self, cid: str) -> str:
        """conversations.info's `last_read` (every kind of conversation, with the user's token); Slack sends no event
        when the user reads in its own app (channel_marked is RTM's only), so it is asked."""
        got = (self._call("conversations_info", channel=cid).get("channel") or {}).get("last_read") or ""
        return got if _ts(got) > 0 else ""

    def users(self) -> List[dict]:
        return [person(u) for u in self._pages("users_list", "members")]

    def user(self, uid: str) -> Optional[dict]:
        """users.info: one users.list doesn't list -- Slack's own "Slack" account (USLACK), whose DM holds its notices."""
        try:
            u = self._call("users_info", user=uid).get("user") or {}
        except SlackError:
            return None
        return person(u) if u.get("id") else None

    def history(self, cid: str, latest: str = "", limit: int = 50, oldest: str = "") -> Tuple[List[dict], bool]:
        r = self._call("conversations_history", channel=cid, latest=latest or None, oldest=oldest or None,
                       limit=limit, inclusive=False)
        return [message(m, self.me) for m in r.get("messages") or []], bool(r.get("has_more"))

    def open_dm(self, user: str) -> dict:
        """The DM with `user`, opened if it wasn't (conversations.open; scope im:write)."""
        r = self._call("conversations_open", users=user, return_im=True)
        return conversation({**(r.get("channel") or {}), "is_im": True, "user": user})

    def replies(self, cid: str, ts: str, limit: int = 200) -> List[dict]:
        r = self._call("conversations_replies", channel=cid, ts=ts, limit=limit)
        return [message(m, self.me) for m in r.get("messages") or []]

    def thread_state(self, cid: str, ts: str) -> dict:
        """conversations.replies' parent, with the user's token: its `subscribed` and `last_read`."""
        got = (self._call("conversations_replies", channel=cid, ts=ts, limit=1).get("messages") or [{}])[0]
        last = got.get("last_read") or ""
        return {"subscribed": bool(got.get("subscribed")), "last_read": last if _ts(last) > 0 else ""}

    def post(self, cid: str, text: str, thread_ts: str = "", broadcast: bool = False) -> dict:
        r = self._call("chat_postMessage", channel=cid, text=text, thread_ts=thread_ts or None,
                       reply_broadcast=True if (thread_ts and broadcast) else None)
        return message({**(r.get("message") or {}), "ts": r.get("ts")}, self.me)

    def search(self, query: str, limit: int = 20) -> List[dict]:
        r = self._call("search_messages", query=query, count=max(1, min(int(limit), 100)), sort="timestamp")
        out = []
        for m in ((r.get("messages") or {}).get("matches") or []):
            ch = m.get("channel") or {}
            out.append({"channel": ch.get("id") or "", "channel_name": ch.get("name") or "", "ts": m.get("ts") or "",
                        "user": m.get("user") or "", "username": m.get("username") or "", "text": m.get("text") or "",
                        "permalink": m.get("permalink") or "", "thread_ts": thread_of(m.get("permalink") or "")})
        return out

    def recent(self, after: str, pages: int = 3) -> List[dict]:
        """Messages since the day `after` (YYYY-MM-DD) anywhere the user can see, newest first, each {channel, ts,
        thread_ts}: Slack's search, `after:<day>`, up to `pages` of 100 -- the thread a reply is in from its permalink
        ('' for one not in a thread)."""
        out = []
        for page in range(1, pages + 1):
            r = self._call("search_messages", query=f"after:{after}", sort="timestamp", count=100, page=page)
            got = (r.get("messages") or {})
            out.extend({"channel": (m.get("channel") or {}).get("id") or "", "ts": m.get("ts") or "",
                        "thread_ts": thread_of(m.get("permalink") or "")}
                       for m in got.get("matches") or [])
            if page >= int((got.get("paging") or {}).get("pages") or 1):
                break
        return out

    def listen(self, on_event: Callable[[dict], None], on_status: Callable[[str], None]) -> None:
        from slack_sdk.socket_mode import SocketModeClient
        from slack_sdk.socket_mode.response import SocketModeResponse

        def request(client, req) -> None:
            client.send_socket_mode_response(SocketModeResponse(envelope_id=req.envelope_id))   # acknowledged first
            if req.type == "events_api":
                ev = (req.payload or {}).get("event")
                if isinstance(ev, dict):
                    try:
                        on_event(ev)
                    except Exception as exc:          # one bad event never stops the line
                        on_status(f"error: {exc}")
            elif req.type == "hello":
                on_status("connected")

        with self._lock:
            sock = SocketModeClient(app_token=self.app_token, web_client=self.web,
                                    on_error_listeners=[lambda e: on_status(f"error: {e}")],
                                    on_close_listeners=[lambda code, why: on_status("disconnected")])
            sock.socket_mode_request_listeners.append(request)
            self._socket = sock
        sock.connect()
        on_status("connected")

    def connected(self) -> bool:
        s = self._socket
        try:
            return bool(s and s.is_connected())
        except Exception:
            return False

    def close(self) -> None:
        with self._lock:
            s, self._socket = self._socket, None
        if s is not None:
            try:
                s.close()
            except Exception:
                pass
