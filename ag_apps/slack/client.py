"""The app's line to Slack: Slack's own Python SDK (slack_sdk), on the user's own Slack app's tokens -- a user token
(xoxp-...), so what it reads is what the user can read and what it posts is posted as them, and an app-level token
(xapp-...) for Socket Mode, which brings each new message as it is sent, with no public URL.

    Client(user_token, app_token)
        who()                       auth.test: {user_id, user, team, team_id, url, scopes (the token's, as Slack
                                    says them: None if it doesn't)}
        conversations()             the conversations the user is in: each {id, kind, name, user, members, topic}
        conversation(id)            one, the same shape (None: not one the user can see)
        last_read(id)               the user's read cursor in it, as Slack keeps it: what they last read in Slack's
                                    own app ('' if none said)
        users()                     the workspace's people: each {id, name, real_name, bot, handle, image, status,
                                    title, tz, deleted}
        user(id)                    one users() leaves out (Slack's own "Slack" account a DM can be with), the same
                                    shape (None: Slack won't say)
        history(id, latest, limit, oldest)  (messages newest first, more?) -- each message as `message` shapes it
        open_dm(user)               the DM with a person, opened if it wasn't
        open_group(users)           the group DM with several (mpim:write)
        replies(id, ts)             a thread, its parent first
        thread_state(id, ts)        {subscribed, last_read}: whether the user follows a thread (started it, replied
                                    in it, followed it) and how far they read it in Slack's own app
        post(id, text, thread_ts, broadcast)   posted as the user -> the message
        update(id, ts, text) / delete(id, ts)   one of the user's own messages edited / deleted (chat:write)
        permalink(id, ts)           Slack's link to a message
        members(id)                 who is in a conversation (user ids)
        schedule(id, text, at, thread_ts)       a message posted as the user at `at` (seconds) -> {id, post_at, ...}
        scheduled(id) / unschedule(id, sid)     the user's messages waiting to be posted there / one taken back
        react(id, ts, name, on)     the user's reaction added to a message or taken off (reactions:write)
        file(fid)                   files.info: one file, as `files_of` shapes it (files:read)
        download(url, path, most)   a file of Slack's saved at `path`, with the user's token -- only from Slack's own
                                    file hosts, and at most `most` bytes
        upload(id, files, text, thread_ts)   files ([(path, name)]) shared there with `text` -> their ids (files:write)
        emoji()                     the workspace's own emoji: {name: picture address, or "alias:<name>"} (emoji:read)
        mark(id, ts)                the user's read cursor there moved to `ts`, in Slack too (channels:write ...)
        channels()                  the workspace's public channels: each {id, name, topic, purpose, members, member}
        join(id) / leave(id)        a channel joined / left (channels:write; groups:write for a private one)
        pins(id)                    the messages pinned in a conversation (pins:read)
        search(query, limit)        search.messages: each {channel, channel_name, ts, user, username, text, permalink,
                                    thread_ts (the thread a reply is in, from its permalink; '' if none)}
        recent(after, pages)        the user's conversations' messages since a day, from search: each {channel, ts,
                                    thread_ts} -- when each was last active, and what the app may not have kept
        listen(on_event, on_status) Socket Mode: each Events API event to `on_event`, acknowledged; `on_status`
                                    told "connected" / "disconnected" / an error's text
        close()

`message(raw, me)` is the one shape every message is kept and shown in (store.py, the panel):
{ts, user, text, thread_ts, reply_count, latest_reply, edited, subtype, bot_name, files, reactions, attachments}; a
reaction {name, count, mine, users (who, as far as Slack lists them)}, a file as `files_of` shapes it.
slack_sdk is imported when a Client is made, so the app loads (and says what is missing) without it."""

import os
import threading
import urllib.parse
import urllib.request
from typing import Callable, Dict, List, Optional, Tuple

PAGE = 200
TYPES = "public_channel,private_channel,mpim,im"
FILE_HOSTS = (".slack.com", ".slack-edu.com", ".slack-gov.com", ".slack-files.com")   # where the token may go
CHANNELS_MOST = 5                # at most this many pages (of 1000) of the workspace's public channels


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
    """A person (or app) as Slack gives them, in the app's shape: `image` their photo's address (Slack serves it to
    anyone), `status` {emoji, text, until} -- until 0: no end -- or None."""
    p = u.get("profile") or {}
    emoji, text = p.get("status_emoji") or "", p.get("status_text") or ""
    until = int(p.get("status_expiration") or 0)
    return {"id": u.get("id"), "name": p.get("display_name") or u.get("name") or "",
            "real_name": p.get("real_name") or u.get("real_name") or "",
            "bot": bool(u.get("is_bot") or u.get("id") in ("USLACKBOT", "USLACK")),
            "handle": u.get("name") or "", "image": p.get("image_72") or p.get("image_48") or "",
            "status": {"emoji": emoji, "text": text, "until": until} if (emoji or text) else None,
            "title": p.get("title") or "", "tz": u.get("tz") or "", "deleted": bool(u.get("deleted"))}


def file_of(f: dict) -> dict:
    """A file as Slack gives it, in the app's shape: what the panel shows of it and what it is fetched from --
    `thumb` its picture's largest preview, `gone` when Slack no longer shows it (deleted, beyond a free plan's limit)."""
    thumb = next((k for k in ("thumb_720", "thumb_480", "thumb_360", "thumb_pdf") if f.get(k)), "")
    out = {"id": f.get("id") or "", "name": f.get("name") or f.get("title") or "file", "title": f.get("title") or "",
           "mimetype": f.get("mimetype") or "", "filetype": f.get("filetype") or "",
           "kind": f.get("pretty_type") or (f.get("filetype") or "").upper(), "size": int(f.get("size") or 0),
           "url": f.get("url_private") or "", "permalink": f.get("permalink") or "",
           "thumb": f.get(thumb) or "", "w": int(f.get(f"{thumb}_w") or f.get("original_w") or 0) if thumb else 0,
           "h": int(f.get(f"{thumb}_h") or f.get("original_h") or 0) if thumb else 0,
           "gone": f.get("mode") in ("tombstone", "hidden_by_limit")}
    return out


def message(m: dict, me: str = "") -> dict:
    """A message as Slack gives it (history, a thread, an event), in the app's shape."""
    files = [file_of(f) for f in (m.get("files") or []) if isinstance(f, dict)]
    reactions = [{"name": r.get("name") or "", "count": int(r.get("count") or len(r.get("users") or [])),
                  "mine": bool(me and me in (r.get("users") or [])), "users": [str(u) for u in r.get("users") or []]}
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
        from slack_sdk.errors import SlackApiError
        try:
            got = self.web.auth_test()
        except SlackApiError as exc:
            raise SlackError(str(exc.response.get("error") or exc)) from None
        r = got.data
        self.me = r.get("user_id") or ""
        said = {str(k).lower(): v for k, v in (getattr(got, "headers", None) or {}).items()}.get("x-oauth-scopes")
        scopes = sorted(x.strip() for x in str(said).split(",") if x.strip()) if said is not None else None
        return {**{k: r.get(k) or "" for k in ("user_id", "user", "team", "team_id", "url")}, "scopes": scopes}

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

    def open_group(self, users: List[str]) -> dict:
        r = self._call("conversations_open", users=",".join(users), return_im=True)
        c = r.get("channel") or {}
        got = self.conversation(c["id"]) if c.get("id") else None
        return got or conversation({**c, "is_mpim": True})

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

    def update(self, cid: str, ts: str, text: str) -> dict:
        r = self._call("chat_update", channel=cid, ts=ts, text=text)
        return {"ts": r.get("ts") or ts, "text": (r.get("message") or {}).get("text") or text}

    def delete(self, cid: str, ts: str) -> None:
        self._call("chat_delete", channel=cid, ts=ts)

    def permalink(self, cid: str, ts: str) -> str:
        return self._call("chat_getPermalink", channel=cid, message_ts=ts).get("permalink") or ""

    def members(self, cid: str) -> List[str]:
        return [str(u) for u in self._pages("conversations_members", "members", channel=cid)]

    def schedule(self, cid: str, text: str, at: float, thread_ts: str = "") -> dict:
        r = self._call("chat_scheduleMessage", channel=cid, text=text, post_at=int(at), thread_ts=thread_ts or None)
        return {"id": r.get("scheduled_message_id") or "", "channel": cid, "post_at": int(r.get("post_at") or at),
                "text": text, "thread_ts": thread_ts or ""}

    def scheduled(self, cid: str) -> List[dict]:
        r = self._call("chat_scheduledMessages_list", channel=cid, limit=100)
        return [{"id": m.get("id") or "", "channel": m.get("channel_id") or cid, "post_at": int(m.get("post_at") or 0),
                 "text": m.get("text") or "", "thread_ts": m.get("thread_ts") or ""}
                for m in r.get("scheduled_messages") or []]

    def unschedule(self, cid: str, sid: str) -> None:
        self._call("chat_deleteScheduledMessage", channel=cid, scheduled_message_id=sid)

    def react(self, cid: str, ts: str, name: str, on: bool) -> None:
        self._call("reactions_add" if on else "reactions_remove", channel=cid, timestamp=ts, name=name)

    def reactions(self, cid: str, ts: str) -> List[dict]:
        """A message's reactions as Slack has them now, everyone who reacted listed (reactions.get, full)."""
        got = self._call("reactions_get", channel=cid, timestamp=ts, full=True)
        return message(got.get("message") or {}, self.me).get("reactions") or []

    def file(self, fid: str) -> dict:
        return file_of(self._call("files_info", file=fid).get("file") or {})

    def download(self, url: str, path: str, most: int) -> str:
        """`url` (one of Slack's files) saved at `path`, fetched with the user's token -> its content type. Only from
        Slack's own hosts, over https, never following a redirect elsewhere: the token goes nowhere else."""
        def ours(u: str) -> bool:
            p = urllib.parse.urlparse(u)
            return p.scheme == "https" and any((p.hostname or "").endswith(h) for h in FILE_HOSTS)
        if not ours(url):
            raise SlackError("not_a_slack_file")

        class Stay(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                if not ours(newurl):
                    raise SlackError("file_moved_elsewhere")
                return super().redirect_request(req, fp, code, msg, headers, newurl)
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.web.token}"})
        part = f"{path}.part"
        with urllib.request.build_opener(Stay).open(req, timeout=60) as r:
            kind = r.headers.get("Content-Type") or ""
            if kind.startswith("text/html"):           # Slack's sign-in page: the token can't read files
                raise SlackError("missing_scope")
            got = 0
            with open(part, "wb") as f:
                while True:
                    chunk = r.read(1 << 16)
                    if not chunk:
                        break
                    got += len(chunk)
                    if got > most:
                        raise SlackError("file_too_large")
                    f.write(chunk)
        os.replace(part, path)
        return kind

    def upload(self, cid: str, files: List[Tuple[str, str]], text: str = "", thread_ts: str = "") -> List[str]:
        from slack_sdk.errors import SlackApiError
        try:
            r = self.web.files_upload_v2(file_uploads=[{"file": p, "filename": n, "title": n} for p, n in files],
                                         channel=cid, initial_comment=text or None, thread_ts=thread_ts or None)
        except SlackApiError as exc:
            raise SlackError(str(exc.response.get("error") or exc)) from None
        return [f.get("id") for f in (r.data.get("files") or []) if f.get("id")]

    def emoji(self) -> Dict[str, str]:
        return {str(k): str(v) for k, v in (self._call("emoji_list").get("emoji") or {}).items()}

    def mark(self, cid: str, ts: str) -> None:
        self._call("conversations_mark", channel=cid, ts=ts)

    def channels(self) -> List[dict]:
        out, cursor = [], None
        for _ in range(CHANNELS_MOST):
            r = self._call("conversations_list", types="public_channel", exclude_archived=True, limit=1000, cursor=cursor)
            for c in r.get("channels") or []:
                purpose = c.get("purpose")
                out.append({**conversation(c), "purpose": (purpose.get("value") if isinstance(purpose, dict) else "") or "",
                            "members": int(c.get("num_members") or 0), "member": bool(c.get("is_member"))})
            cursor = (r.get("response_metadata") or {}).get("next_cursor")
            if not cursor:
                break
        return out

    def join(self, cid: str) -> dict:
        return conversation(self._call("conversations_join", channel=cid).get("channel") or {"id": cid})

    def leave(self, cid: str) -> None:
        self._call("conversations_leave", channel=cid)

    def pins(self, cid: str) -> List[dict]:
        return [message(i["message"], self.me) for i in self._call("pins_list", channel=cid).get("items") or []
                if isinstance(i, dict) and isinstance(i.get("message"), dict)]

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
