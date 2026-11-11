"""What the Slack app keeps of the user's Slack, in its data folder (slack.db): the conversations they are in, the
workspace's people, the messages seen (fetched for the panel or arrived live), where the user last read each
conversation, the drafts agents made, and the app's settings. It is a cache of Slack plus the app's own state, not the
gatherer's events: Slack's history is Slack's, and the gatherer gets only what its agents should know (backend.py).

    Store(path)
        put_conversations(rows) / conversation(id) / conversations()   each {id, kind, name, user, members, topic,
                                                                        read_ts, read_known, latest_ts, active_ts,
                                                                        synced}
        active(id, ts)                                                  when it was last active
        put_users(rows) / users()                                       {id: {name, real_name, bot}}
        put_messages(channel, msgs) -> new ones / message(ch, ts) / history(ch, before, limit) / thread(ch, ts)
        change(channel, ts, fields) / delete(channel, ts)
        read(channel, ts) / unread(me)                                  read marks; {channel: (unread, mentions)}
        guessed_reads() / take_read(channel, ts)                        read marks still the app's guess; Slack's taken
        draft(...) / drafts(status) / set_draft(id, **fields)
        setting(k, default) / set_setting(k, v)

A conversation's read mark starts as the app's GUESS -- read up to when the app first saw it -- until Slack's own read
cursor of it is taken (take_read, backend.py: on connecting) or the user reads it here (`read_known`).

Slack's timestamps (`ts`, "1794193521.100519") are kept as Slack gives them: strings, ordered as numbers (`_num`).
Every method is safe from any thread (one connection, one lock)."""

import json
import sqlite3
import threading
import time
import uuid
from typing import Dict, Iterable, List, Optional, Tuple

KINDS = ("channel", "private", "im", "mpim")
DRAFT_STATES = ("pending", "sent", "discarded")
NOT_COUNTED = ("channel_join", "channel_leave", "group_join", "group_leave")   # never unread, as in Slack's app

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', user TEXT NOT NULL DEFAULT '',
    members TEXT NOT NULL DEFAULT '[]', topic TEXT NOT NULL DEFAULT '', read_ts TEXT NOT NULL DEFAULT '',
    latest_ts TEXT NOT NULL DEFAULT '', synced INTEGER NOT NULL DEFAULT 0, gone INTEGER NOT NULL DEFAULT 0,
    active_ts TEXT NOT NULL DEFAULT '', read_known INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', real_name TEXT NOT NULL DEFAULT '',
    bot INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS messages (
    channel TEXT NOT NULL, ts TEXT NOT NULL, tsn REAL NOT NULL, user TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '', thread_ts TEXT NOT NULL DEFAULT '', reply_count INTEGER NOT NULL DEFAULT 0,
    latest_reply TEXT NOT NULL DEFAULT '', edited INTEGER NOT NULL DEFAULT 0, subtype TEXT NOT NULL DEFAULT '',
    extra TEXT NOT NULL DEFAULT '{}', deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (channel, ts));
CREATE INDEX IF NOT EXISTS messages_order ON messages (channel, tsn);
CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY, channel TEXT NOT NULL, thread_ts TEXT NOT NULL DEFAULT '', text TEXT NOT NULL,
    broadcast INTEGER NOT NULL DEFAULT 0, by_channel TEXT NOT NULL DEFAULT '', by_name TEXT NOT NULL DEFAULT '',
    gatherer TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', made REAL NOT NULL,
    done REAL, sent_ts TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
"""


def _num(ts: str) -> float:
    try:
        return float(ts)
    except (TypeError, ValueError):
        return 0.0


def later(a: str, b: str) -> str:
    """The later of two Slack timestamps ('' is earliest)."""
    return a if _num(a) >= _num(b) else b


class Store:
    def __init__(self, path: str):
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._db.executescript(SCHEMA)
            cols = {r["name"] for r in self._db.execute("PRAGMA table_info(conversations)")}
            if "active_ts" not in cols:                      # a cache from before activity was kept
                self._db.execute("ALTER TABLE conversations ADD COLUMN active_ts TEXT NOT NULL DEFAULT ''")
            if "read_known" not in cols:                     # from before Slack's read cursors were taken: guesses
                self._db.execute("ALTER TABLE conversations ADD COLUMN read_known INTEGER NOT NULL DEFAULT 0")

    def close(self) -> None:
        with self._lock:
            self._db.close()

    def _all(self, sql: str, args: Iterable = ()) -> List[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, tuple(args)).fetchall()

    def _one(self, sql: str, args: Iterable = ()) -> Optional[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, tuple(args)).fetchone()

    def _do(self, sql: str, args: Iterable = ()) -> int:
        with self._lock:
            return self._db.execute(sql, tuple(args)).rowcount

    # -- conversations

    def put_conversations(self, rows: List[dict]) -> None:
        """The conversations the user is in now, as client.py gives them; one not among them is marked gone (left,
        archived), kept with its messages. A new one starts read up to now -- a guess, until Slack's own read cursor
        of it is taken: unread counts what arrives after."""
        now = f"{time.time():.6f}"
        with self._lock:
            self._db.execute("BEGIN")
            try:
                self._db.execute("UPDATE conversations SET gone = 1")
                for r in rows:
                    if r.get("kind") not in KINDS or not r.get("id"):
                        continue
                    self._db.execute(
                        "INSERT INTO conversations (id, kind, name, user, members, topic, read_ts, latest_ts, gone) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, "
                        "name = excluded.name, user = excluded.user, members = excluded.members, "
                        "topic = excluded.topic, gone = 0",
                        (r["id"], r["kind"], r.get("name") or "", r.get("user") or "",
                         json.dumps(r.get("members") or []), r.get("topic") or "", now, ""))
                self._db.execute("COMMIT")
            except Exception:
                self._db.execute("ROLLBACK")
                raise

    def add_conversation(self, row: dict, read_ts: str = "", member: bool = True) -> None:
        """One conversation the user just joined or was messaged in, read up to `read_ts` (from its start: '');
        one kept already is left as it is, but no longer gone. One the user is not in (`member` False: a public
        channel a search found) is kept to be read, but not listed: gone until the user joins it."""
        if row.get("kind") not in KINDS or not row.get("id"):
            return
        self._do("INSERT INTO conversations (id, kind, name, user, members, topic, read_ts, gone) VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
                 + ("ON CONFLICT(id) DO UPDATE SET gone = 0" if member else "ON CONFLICT(id) DO NOTHING"),
                 (row["id"], row["kind"], row.get("name") or "", row.get("user") or "",
                  json.dumps(row.get("members") or []), row.get("topic") or "", read_ts, 0 if member else 1))

    def _conv(self, r: sqlite3.Row) -> dict:
        return {"id": r["id"], "kind": r["kind"], "name": r["name"], "user": r["user"],
                "members": json.loads(r["members"] or "[]"), "topic": r["topic"], "read_ts": r["read_ts"],
                "read_known": bool(r["read_known"]), "latest_ts": r["latest_ts"], "active_ts": r["active_ts"], "synced": bool(r["synced"]),
                "member": not r["gone"]}

    def conversation(self, cid: str) -> Optional[dict]:
        r = self._one("SELECT * FROM conversations WHERE id = ?", (cid,))
        return self._conv(r) if r else None

    def conversations(self) -> List[dict]:
        return [self._conv(r) for r in self._all("SELECT * FROM conversations WHERE gone = 0 ORDER BY kind, name")]

    def active(self, cid: str, ts: str) -> None:
        """Something was said in `cid` at `ts` -- a message, a thread reply, a search hit: when it was last active
        (never moved back), what the panel's Recent list orders by."""
        self._do("UPDATE conversations SET active_ts = ? WHERE id = ? AND CAST(active_ts AS REAL) < ?", (ts, cid, _num(ts)))

    def synced(self, cid: str) -> None:
        """Its recent history fetched once: the panel reads it from here after."""
        self._do("UPDATE conversations SET synced = 1 WHERE id = ?", (cid,))

    # -- people

    def put_users(self, rows: List[dict]) -> None:
        with self._lock:
            self._db.executemany(
                "INSERT INTO users (id, name, real_name, bot) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                "name = excluded.name, real_name = excluded.real_name, bot = excluded.bot",
                [(r["id"], r.get("name") or "", r.get("real_name") or "", 1 if r.get("bot") else 0)
                 for r in rows if r.get("id")])

    def users(self) -> Dict[str, dict]:
        return {r["id"]: {"name": r["name"], "real_name": r["real_name"], "bot": bool(r["bot"])}
                for r in self._all("SELECT * FROM users")}

    # -- messages

    def _msg(self, r: sqlite3.Row) -> dict:
        return {"channel": r["channel"], "ts": r["ts"], "user": r["user"], "text": r["text"],
                "thread_ts": r["thread_ts"], "reply_count": r["reply_count"], "latest_reply": r["latest_reply"],
                "edited": bool(r["edited"]), "subtype": r["subtype"], **json.loads(r["extra"] or "{}")}

    def put_messages(self, channel: str, msgs: List[dict]) -> List[dict]:
        """Messages of `channel` (client.py's shape) kept, a known one updated; -> the ones not seen before. The
        conversation's latest_ts follows its newest top-level message."""
        new: List[dict] = []
        with self._lock:
            self._db.execute("BEGIN")
            try:
                for m in msgs:
                    ts = m.get("ts")
                    if not ts:
                        continue
                    extra = json.dumps({k: m[k] for k in ("reactions", "files", "bot_name", "attachments")
                                        if m.get(k)})
                    seen = self._db.execute("SELECT 1 FROM messages WHERE channel = ? AND ts = ?",
                                            (channel, ts)).fetchone()
                    self._db.execute(
                        "INSERT INTO messages (channel, ts, tsn, user, text, thread_ts, reply_count, latest_reply, "
                        "edited, subtype, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                        "ON CONFLICT(channel, ts) DO UPDATE SET user = excluded.user, text = excluded.text, "
                        "thread_ts = excluded.thread_ts, reply_count = max(messages.reply_count, excluded.reply_count), "
                        "latest_reply = CASE WHEN CAST(excluded.latest_reply AS REAL) > CAST(messages.latest_reply AS "
                        "REAL) THEN excluded.latest_reply ELSE messages.latest_reply END, edited = excluded.edited, "
                        "subtype = excluded.subtype, extra = excluded.extra",
                        (channel, ts, _num(ts), m.get("user") or "", m.get("text") or "", m.get("thread_ts") or "",
                         int(m.get("reply_count") or 0), m.get("latest_reply") or "", 1 if m.get("edited") else 0,
                         m.get("subtype") or "", extra))
                    if not seen:
                        new.append(m)
                    if not m.get("thread_ts") or m.get("thread_ts") == ts or m.get("subtype") == "thread_broadcast":
                        self._db.execute(
                            "UPDATE conversations SET latest_ts = ? WHERE id = ? AND CAST(latest_ts AS REAL) < ?",
                            (ts, channel, _num(ts)))
                self._db.execute("COMMIT")
            except Exception:
                self._db.execute("ROLLBACK")
                raise
        return new

    def replied(self, channel: str, thread_ts: str, ts: str) -> Optional[dict]:
        """A reply `ts` arrived in the thread of `thread_ts`: its parent's count and latest reply moved on -> the
        parent, if kept."""
        self._do("UPDATE messages SET reply_count = reply_count + 1, latest_reply = ? WHERE channel = ? AND ts = ? "
                 "AND CAST(latest_reply AS REAL) < ?", (ts, channel, thread_ts, _num(ts)))
        return self.message(channel, thread_ts)

    def message(self, channel: str, ts: str) -> Optional[dict]:
        r = self._one("SELECT * FROM messages WHERE channel = ? AND ts = ? AND deleted = 0", (channel, ts))
        return self._msg(r) if r else None

    def history(self, channel: str, before: str = "", limit: int = 50) -> List[dict]:
        """Its top-level messages (and replies also sent to it), the newest `limit` before `before` (any, if ''),
        oldest first."""
        rows = self._all(
            "SELECT * FROM messages WHERE channel = ? AND deleted = 0 AND (thread_ts = '' OR thread_ts = ts OR "
            "subtype = 'thread_broadcast') AND (? = '' OR tsn < ?) ORDER BY tsn DESC LIMIT ?",
            (channel, before, _num(before), max(1, min(int(limit), 500))))
        return [self._msg(r) for r in reversed(rows)]

    def thread(self, channel: str, ts: str) -> List[dict]:
        rows = self._all("SELECT * FROM messages WHERE channel = ? AND deleted = 0 AND (ts = ? OR thread_ts = ?) "
                         "ORDER BY tsn", (channel, ts, ts))
        return [self._msg(r) for r in rows]

    def change(self, channel: str, ts: str, fields: dict) -> Optional[dict]:
        """An edit Slack told of: its text (and what else it gave) replaced -> the message, if kept."""
        cur = self.message(channel, ts)
        if cur is None:
            return None
        merged = {**cur, **{k: v for k, v in fields.items() if v is not None}, "edited": True}
        self.put_messages(channel, [merged])
        return self.message(channel, ts)

    def delete(self, channel: str, ts: str) -> bool:
        return self._do("UPDATE messages SET deleted = 1 WHERE channel = ? AND ts = ?", (channel, ts)) > 0

    # -- read marks

    def read(self, channel: str, ts: str) -> None:
        """The user has read `channel` up to `ts` (never moved back) -- here, or in Slack's own app: its read mark is
        no longer the app's guess."""
        self._do("UPDATE conversations SET read_ts = CASE WHEN CAST(read_ts AS REAL) < ? THEN ? ELSE read_ts END, "
                 "read_known = 1 WHERE id = ?", (_num(ts), ts, channel))

    def guessed_reads(self) -> List[str]:
        """The conversations the user is in whose read mark is still the app's guess, the most recently active first."""
        return [r["id"] for r in self._all(
            "SELECT id FROM conversations WHERE gone = 0 AND read_known = 0 "
            "ORDER BY max(CAST(active_ts AS REAL), CAST(latest_ts AS REAL)) DESC, id")]

    def take_read(self, channel: str, ts: str) -> None:
        """Slack's own read cursor of `channel` taken in place of the app's guess, back or on; '' (Slack has none: it
        never had a message to read) keeps the guess, as known."""
        if ts:
            self._do("UPDATE conversations SET read_ts = ?, read_known = 1 WHERE id = ?", (ts, channel))
        else:
            self._do("UPDATE conversations SET read_known = 1 WHERE id = ?", (channel,))

    def unread(self, me: str) -> Dict[str, Tuple[int, int]]:
        """{conversation: (messages after its read mark from others, how many of those name the user or are in a
        DM)}: top-level messages only, and no joins or leaves, as Slack counts them."""
        rows = self._all(
            "SELECT m.channel AS ch, c.kind AS kind, m.text AS text FROM messages m JOIN conversations c ON "
            "c.id = m.channel WHERE c.gone = 0 AND m.deleted = 0 AND m.user != ? AND m.tsn > CAST(c.read_ts AS REAL) "
            "AND (m.thread_ts = '' OR m.thread_ts = m.ts OR m.subtype = 'thread_broadcast') "
            f"AND m.subtype NOT IN ({', '.join('?' * len(NOT_COUNTED))})", (me, *NOT_COUNTED))
        out: Dict[str, List[int]] = {}
        for r in rows:
            got = out.setdefault(r["ch"], [0, 0])
            got[0] += 1
            if r["kind"] in ("im", "mpim") or (me and f"<@{me}>" in (r["text"] or "")):
                got[1] += 1
        return {k: (v[0], v[1]) for k, v in out.items()}

    # -- drafts

    def _draft(self, r: sqlite3.Row) -> dict:
        return {k: r[k] for k in r.keys()} | {"broadcast": bool(r["broadcast"])}

    def draft(self, channel: str, text: str, thread_ts: str = "", broadcast: bool = False, by_channel: str = "",
              by_name: str = "", gatherer: str = "") -> dict:
        did = "d" + uuid.uuid4().hex[:10]
        self._do("INSERT INTO drafts (id, channel, thread_ts, text, broadcast, by_channel, by_name, gatherer, made) "
                 "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                 (did, channel, thread_ts or "", text, 1 if broadcast else 0, by_channel, by_name, gatherer,
                  time.time()))
        return self.get_draft(did)

    def get_draft(self, did: str) -> Optional[dict]:
        r = self._one("SELECT * FROM drafts WHERE id = ?", (did,))
        return self._draft(r) if r else None

    def drafts(self, status: str = "pending") -> List[dict]:
        return [self._draft(r) for r in self._all("SELECT * FROM drafts WHERE status = ? ORDER BY made", (status,))]

    def set_draft(self, did: str, **fields) -> Optional[dict]:
        allowed = {k: v for k, v in fields.items() if k in ("text", "broadcast", "status", "done", "sent_ts")}
        if "broadcast" in allowed:
            allowed["broadcast"] = 1 if allowed["broadcast"] else 0
        if allowed:
            sets = ", ".join(f"{k} = ?" for k in allowed)
            self._do(f"UPDATE drafts SET {sets} WHERE id = ?", (*allowed.values(), did))
        return self.get_draft(did)

    # -- settings

    def setting(self, k: str, default=None):
        r = self._one("SELECT v FROM settings WHERE k = ?", (k,))
        return json.loads(r["v"]) if r else default

    def set_setting(self, k: str, v) -> None:
        self._do("INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
                 (k, json.dumps(v)))
