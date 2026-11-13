"""The Slack app (ag_apps/slack/): the user's Slack in a panel, new messages as Slack sends them (Socket Mode), and
replies agents draft and only the user sends. The cache (store.py) is tested directly; the backend through a Slack of
the test's (FakeSlack, in client.py's shape) and a host of the test's -- what it tells the panels, what it inserts for
agents, what it posts."""
import json
import os
import shutil
import sqlite3
import stat
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app_kit  # noqa: E402
from ag_apps.slack import backend as be  # noqa: E402
from ag_apps.slack.client import thread_of  # noqa: E402
from ag_apps.slack.mrkdwn import plain  # noqa: E402
from ag_apps.slack.store import Store  # noqa: E402
from app_kit import Caller, Instance  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOLDER = os.path.join(ROOT, "ag_apps", "slack")
ME, MAYA, LEO = "UME", "UMAYA", "ULEO"


def ts_ago(seconds: float) -> str:
    return f"{time.time() - seconds:.6f}"


def full(m: dict) -> dict:
    """A message as client.Client gives it (history, replies): every field, from Slack's few."""
    return be.slack.message(m, ME)


class FakeSlack:
    """Slack, as client.Client gives it: a channel and a DM with old messages, and what was posted."""

    made = []

    def __init__(self, user_token, app_token=""):
        self.user_token, self.app_token = user_token, app_token
        self.me = ME
        self.convs = [{"id": "C1", "kind": "channel", "name": "paper-deadline", "user": "", "members": [],
                       "topic": "Camera-ready Fri"},
                      {"id": "D1", "kind": "im", "name": "", "user": MAYA, "members": [], "topic": ""}]
        self.people = [{"id": ME, "name": "sep", "real_name": "Sep", "bot": False, "handle": "sep"},
                       {"id": MAYA, "name": "maya", "real_name": "Maya Chen", "bot": False, "handle": "maya",
                        "image": "https://avatars.example/maya.png", "status": {"emoji": ":palm_tree:", "text": "Away",
                                                                               "until": 0}, "tz": "Europe/Berlin"},
                       {"id": LEO, "name": "leo", "real_name": "Leo Park", "bot": False, "handle": "lpark"}]
        old = ts_ago(3600)
        self.msgs = {"C1": [{"ts": old, "user": LEO, "text": "Added the citations.", "thread_ts": "", "reply_count": 0,
                             "latest_reply": "", "edited": False, "subtype": ""}], "D1": []}
        self.threads = {}
        self.posted = []
        self.on_event = None
        self.closed = False
        self.extra = {}            # conversations.info for ones not listed
        self.cursors = {}          # the user's read cursors in Slack's own app
        self.asked_read = []
        self.hits = None           # search's hits, for recent() (None: its default)
        self.followed = {}         # (conversation, thread) -> [subscribed, last_read], as Slack keeps them
        self.asked_thread = []
        self.not_there = set()     # conversations conversations.info can't find
        self.others = {"USLACK": {"id": "USLACK", "name": "slack", "real_name": "Slack", "bot": True}}   # users.info only
        self.asked_user = []
        self.asked_history = []
        self.updated, self.deleted, self.waiting = [], [], []
        FakeSlack.made.append(self)

    def who(self):
        return {"user_id": ME, "user": "sep", "team": "Lab", "team_id": "T1", "url": "https://lab.slack.com/"}

    def conversations(self):
        return [dict(c) for c in self.convs]

    def conversation(self, cid):
        return next((dict(c) for c in self.convs if c["id"] == cid), self.extra.get(cid))

    def users(self):
        return [dict(u) for u in self.people]

    def history(self, cid, latest="", limit=50, oldest=""):
        self.asked_history.append(cid)
        got = [m for m in self.msgs.get(cid, []) if (not latest or float(m["ts"]) < float(latest))
               and (not oldest or float(m["ts"]) > float(oldest))]
        got.sort(key=lambda m: -float(m["ts"]))
        if oldest and not latest:                       # as Slack does: the OLDEST `limit` after `oldest`
            return [dict(m) for m in got[-limit:]], len(got) > limit
        return [dict(m) for m in got[:limit]], len(got) > limit

    def replies(self, cid, ts, limit=200):
        parent = next((m for m in self.msgs.get(cid, []) if m["ts"] == ts), None)
        return ([dict(parent)] if parent else []) + [dict(m) for m in self.threads.get((cid, ts), [])]

    def post(self, cid, text, thread_ts="", broadcast=False):
        ts = f"{time.time():.6f}"
        self.posted.append({"channel": cid, "text": text, "thread_ts": thread_ts, "broadcast": broadcast, "ts": ts})
        return {"ts": ts, "user": ME, "text": text, "thread_ts": thread_ts, "reply_count": 0, "latest_reply": "",
                "edited": False, "subtype": "thread_broadcast" if (thread_ts and broadcast) else ""}

    def search(self, query, limit=20):
        if "citation" in query:
            return [{"channel": "C1", "channel_name": "paper-deadline", "ts": self.msgs["C1"][0]["ts"], "user": LEO,
                     "username": "leo", "text": "Added the citations.", "permalink": "", "thread_ts": ""}]
        if "budget" in query:
            return [{"channel": "C0OPS7777", "channel_name": "ops", "ts": "300.000003", "user": MAYA, "username": "maya",
                     "text": "The budget\nis in.", "permalink": "", "thread_ts": "200.000002"}]
        return []

    def recent(self, after, pages=3):
        self.recent_after, self.recent_pages = after, pages
        if self.hits is not None:
            return [dict(h) for h in self.hits]
        return [{"channel": "D1", "ts": ts_ago(600), "thread_ts": ""}, {"channel": "CNOTMINE", "ts": ts_ago(60), "thread_ts": ""}]

    def thread_state(self, cid, ts):
        self.asked_thread.append((cid, ts))
        sub, last = self.followed.get((cid, ts), (False, ""))
        return {"subscribed": sub, "last_read": last}

    def last_read(self, cid):
        self.asked_read.append(cid)
        if cid in self.not_there:
            raise be.slack.SlackError("channel_not_found")
        return self.cursors.get(cid, "")

    def user(self, uid):
        self.asked_user.append(uid)
        return dict(self.others[uid]) if uid in self.others else None

    def open_dm(self, user):
        c = {"id": f"D-{user}", "kind": "im", "name": "", "user": user, "members": [], "topic": ""}
        self.convs.append(c)
        return dict(c)

    def update(self, cid, ts, text):
        self.updated.append((cid, ts, text))
        return {"ts": ts, "text": text}

    def delete(self, cid, ts):
        self.deleted.append((cid, ts))

    def permalink(self, cid, ts):
        return f"https://lab.slack.com/archives/{cid}/p{ts.replace('.', '')}"

    def members(self, cid):
        return [ME, MAYA, LEO]

    def schedule(self, cid, text, at, thread_ts=""):
        x = {"id": f"Q{len(self.waiting) + 1}", "channel": cid, "post_at": int(at), "text": text, "thread_ts": thread_ts}
        self.waiting.append(x)
        return dict(x)

    def scheduled(self, cid):
        return [dict(x) for x in self.waiting if x["channel"] == cid]

    def unschedule(self, cid, sid):
        self.waiting = [x for x in self.waiting if x["id"] != sid]

    def open_group(self, users):
        c = {"id": "G-" + "-".join(users), "kind": "mpim", "name": "mpdm-" + "--".join(users), "user": "",
             "members": [ME, *users], "topic": ""}
        self.convs.append(c)
        return dict(c)

    def listen(self, on_event, on_status):
        self.on_event = on_event
        self.up = True
        on_status("connected")

    def connected(self):
        return getattr(self, "up", False)

    def close(self):
        self.closed = True
        self.up = False


class Host(app_kit.Host):
    def __init__(self, folder):
        self.data = folder
        self.told, self.inserted = [], []
        self.notices, self.cleared = [], []
        self.inst = Instance(id="i1", app="slack", gatherer="g", title="Slack")
        self.agents = ["agent-a"]
        self.open_panels = 1

    def insert(self, instance, events, channel=None):
        for e in events:
            self.inserted.append({**e, "channel": channel, "gatherer": instance.gatherer})

    def read(self, instance, types, after=0, channel=None, limit=500):
        return []

    def attached(self, instance):
        return list(self.agents)

    def tell_panel(self, instance, message):
        self.told.append(json.loads(json.dumps(message)))

    def folder(self):
        return self.data

    def instances(self):
        return [self.inst]

    def notify(self, instance, title, text="", key=None, show=("ag",), where=None):
        self.notices.append({"title": title, "text": text, "key": key, "show": list(show), "where": where})
        return f"n{len(self.notices)}"

    def clear_notice(self, instance, which):
        self.cleared.append(which)

    def panels(self, instance):
        return self.open_panels


class ManifestTest(unittest.TestCase):
    def test_it_loads_as_an_app_that_starts_its_own_agent_and_offers_its_tools_to_attached_ones(self):
        m = app_kit.load(FOLDER)
        self.assertEqual((m.name, m.label, m.instances, m.offer), ("slack", "Slack", "one", "attached"))
        self.assertTrue(m.agent.start)
        self.assertEqual([t.mcp("slack")["name"] for t in m.tools], ["slack_read", "slack_search", "slack_draft"])
        self.assertEqual([e.name for e in m.events], ["slack.drafted", "slack.sent", "slack.discarded"])
        self.assertTrue(m.capabilities.message_agents and m.capabilities.actors and m.capabilities.notify)
        self.assertEqual([(s.name, s.every) for s in m.schedules], [("line", 60)])       # the live line kept up
        for f in ("panel/index.html", "panel/panel.js", "panel/panel.css", m.mark):
            self.assertTrue(os.path.isfile(os.path.join(FOLDER, f)), f)
        self.assertIn("slack_draft", m.instructions)
        self.assertIn("never send", m.instructions)

    def test_the_slack_app_manifest_asks_for_socket_mode_and_user_scopes_only(self):
        with open(be.MANIFEST_FILE) as f:
            sm = json.load(f)
        self.assertTrue(sm["settings"]["socket_mode_enabled"])
        self.assertNotIn("bot", sm["oauth_config"]["scopes"])
        user = set(sm["oauth_config"]["scopes"]["user"])
        self.assertTrue({"chat:write", "channels:history", "im:history", "search:read", "users:read"} <= user)
        self.assertTrue({"message.channels", "message.groups", "message.im", "message.mpim"}
                        <= set(sm["settings"]["event_subscriptions"]["user_events"]))


class MrkdwnTest(unittest.TestCase):
    def test_ids_become_names_links_keep_their_address_and_escapes_are_undone(self):
        names = {MAYA: "Maya Chen"}.get
        text = "<@UMAYA> see <#C1|paper-deadline> and <https://x.org/a|the doc> &amp; <!here> &lt;3 <mailto:a@b.c>"
        self.assertEqual(plain(text, names), "@Maya Chen see #paper-deadline and the doc (https://x.org/a) & @here <3 a@b.c")


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.s = Store(os.path.join(self.dir, "slack.db"))

    def tearDown(self):
        self.s.close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_a_conversation_starts_read_up_to_now_and_counts_what_comes_after(self):
        self.s.put_conversations([{"id": "C1", "kind": "channel", "name": "a"}, {"id": "D1", "kind": "im", "user": MAYA}])
        self.s.put_messages("C1", [{"ts": ts_ago(60), "user": LEO, "text": "old"}])
        self.assertEqual(self.s.unread(ME), {})
        new = ts_ago(-1)
        self.s.put_messages("C1", [{"ts": new, "user": LEO, "text": f"hi <@{ME}>"},
                                   {"ts": ts_ago(-2), "user": ME, "text": "mine"},
                                   {"ts": ts_ago(-3), "user": LEO, "text": "in a thread", "thread_ts": new}])
        self.s.put_messages("D1", [{"ts": ts_ago(-1), "user": MAYA, "text": "call?"}])
        self.assertEqual(self.s.unread(ME), {"C1": (1, 1), "D1": (1, 1)})   # not mine, not the thread reply
        self.s.read("C1", new)
        self.s.read("C1", ts_ago(100))                                       # never moved back
        self.assertEqual(self.s.unread(ME), {"D1": (1, 1)})

    def test_history_is_top_level_oldest_first_and_a_thread_is_its_parent_and_replies(self):
        self.s.put_conversations([{"id": "C1", "kind": "channel", "name": "a"}])
        a, b, c = "100.000001", "200.000002", "300.000003"
        self.s.put_messages("C1", [{"ts": c, "user": LEO, "text": "three"}, {"ts": a, "user": LEO, "text": "one"},
                                   {"ts": b, "user": MAYA, "text": "reply", "thread_ts": a}])
        self.assertEqual([m["text"] for m in self.s.history("C1")], ["one", "three"])
        self.assertEqual([m["text"] for m in self.s.history("C1", before=c)], ["one"])
        self.assertEqual([m["text"] for m in self.s.thread("C1", a)], ["one", "reply"])
        self.assertEqual(self.s.replied("C1", a, b)["reply_count"], 1)
        self.assertTrue(self.s.delete("C1", c))
        self.assertEqual([m["text"] for m in self.s.history("C1")], ["one"])
        self.assertEqual(self.s.conversation("C1")["latest_ts"], c)

    def test_a_conversation_no_longer_listed_is_gone_but_kept(self):
        self.s.put_conversations([{"id": "C1", "kind": "channel", "name": "a"}, {"id": "C2", "kind": "channel", "name": "b"}])
        self.s.put_conversations([{"id": "C1", "kind": "channel", "name": "a2"}])
        self.assertEqual([(c["id"], c["name"]) for c in self.s.conversations()], [("C1", "a2")])
        self.assertIsNotNone(self.s.conversation("C2"))

    def test_a_read_mark_is_a_guess_until_slacks_is_taken_or_the_user_reads(self):
        self.s.put_conversations([{"id": "C1", "kind": "channel", "name": "a"}, {"id": "D1", "kind": "im", "user": MAYA},
                                  {"id": "D2", "kind": "im", "user": LEO}])
        self.assertEqual(sorted(self.s.guessed_reads()), ["C1", "D1", "D2"])
        self.s.put_messages("D1", [{"ts": ts_ago(3600), "user": MAYA, "text": "call?"}])
        self.assertEqual(self.s.unread(ME), {})                              # the guess: read up to when first seen
        self.s.take_read("D1", ts_ago(7200))                                 # Slack's, before it: taken, back
        self.s.take_read("D2", "")                                           # Slack has none: the guess stays
        self.s.read("C1", ts_ago(100))                                       # read here: known, never moved back
        self.assertEqual(self.s.guessed_reads(), [])
        self.assertEqual(self.s.unread(ME), {"D1": (1, 1)})
        self.assertGreater(float(self.s.conversation("C1")["read_ts"]), time.time() - 50)
        self.s.put_conversations([{"id": "D1", "kind": "im", "user": MAYA}])   # listed again: still Slack's
        self.assertEqual((self.s.unread(ME), self.s.conversation("D1")["read_known"]), ({"D1": (1, 1)}, True))

    def test_a_cache_from_before_has_every_read_mark_a_guess(self):
        path = os.path.join(self.dir, "old.db")
        db = sqlite3.connect(path)
        db.executescript("CREATE TABLE conversations (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL "
                         "DEFAULT '', user TEXT NOT NULL DEFAULT '', members TEXT NOT NULL DEFAULT '[]', topic TEXT NOT "
                         "NULL DEFAULT '', read_ts TEXT NOT NULL DEFAULT '', latest_ts TEXT NOT NULL DEFAULT '', synced "
                         "INTEGER NOT NULL DEFAULT 0, gone INTEGER NOT NULL DEFAULT 0, active_ts TEXT NOT NULL DEFAULT '');"
                         "INSERT INTO conversations (id, kind, read_ts) VALUES ('D1', 'im', '5.000000');")
        db.close()
        old = Store(path)
        self.assertEqual((old.guessed_reads(), old.conversation("D1")["read_ts"]), (["D1"], "5.000000"))
        old.close()

    def test_joins_and_leaves_are_never_unread(self):
        self.s.put_conversations([{"id": "C1", "kind": "channel", "name": "a"}])
        self.s.put_messages("C1", [{"ts": ts_ago(-1), "user": LEO, "text": "joined", "subtype": "channel_join"},
                                   {"ts": ts_ago(-2), "user": MAYA, "text": "left", "subtype": "group_leave"}])
        self.assertEqual(self.s.unread(ME), {})

    def test_drafts_wait_until_settled(self):
        d = self.s.draft("C1", "yes", "1.0", by_channel="agent-a", gatherer="g")
        self.assertEqual([x["id"] for x in self.s.drafts()], [d["id"]])
        self.s.set_draft(d["id"], status="sent", sent_ts="2.0")
        self.assertEqual(self.s.drafts(), [])
        self.assertEqual(self.s.get_draft(d["id"])["sent_ts"], "2.0")


class BackendBase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.host = Host(self.dir)
        FakeSlack.made = []
        self.app = be.SlackApp(make_client=FakeSlack)
        self.app.start(self.host)
        self.assertEqual(self.app.status, "off")
        r = self.post("connect", {"user_token": "xoxp-1", "app_token": "xapp-1", "wait": True})
        self.assertEqual(r.status, 200, r.body)
        self.slack = FakeSlack.made[-1]
        self.host.told.clear()
        self.slack.asked_read.clear()                    # (connecting asks each conversation's once: _learn_reads)

    def tearDown(self):
        self.app.stop()
        shutil.rmtree(self.dir, ignore_errors=True)

    def post(self, path, body):
        return self.app.request(self.host.inst, "POST", path, {}, json.dumps(body).encode())

    def get(self, path, **q):
        r = self.app.request(self.host.inst, "GET", path, q, b"")
        return json.loads(r.body) if r.status == 200 else (r.status, json.loads(r.body or b"{}"))

    def call(self, tool, args, channel="agent-a"):
        return self.app.call(self.host.inst, tool, args, Caller(channel=channel, gatherer="g"))

    def live(self, **ev):
        self.slack.on_event({"type": "message", **ev})

    def kinds(self):
        return [t["kind"] for t in self.host.told]

    def streams(self):
        return [e for e in self.host.inserted if e["type"] == "context_stream"]


class ConnectTest(BackendBase):
    def test_connecting_keeps_the_tokens_for_the_user_only_and_reads_who_and_what(self):
        path = os.path.join(self.dir, be.CREDENTIALS)
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
        self.assertEqual(self.app.status, "connected")
        st = self.get("state")
        self.assertEqual((st["setup"]["me"], st["setup"]["team"], st["setup"]["live"]), (ME, "Lab", True))
        self.assertEqual({c["id"]: c["label"] for c in st["conversations"]}, {"C1": "#paper-deadline",
                                                                                "D1": "DM with Maya Chen"})
        self.assertEqual(st["users"][MAYA]["name"], "Maya Chen")
        self.assertEqual(st["unread"], {})                   # what was there before connecting is read
        self.assertEqual(self.app.store.guessed_reads(), [])   # Slack asked: its read cursors (none here) taken

    def test_a_restart_connects_again_from_the_kept_tokens(self):
        self.app.stop()
        again = be.SlackApp(make_client=FakeSlack)
        again.start(self.host)
        deadline = time.time() + 5
        while again.status != "connected" and time.time() < deadline:
            time.sleep(0.02)
        self.assertEqual(again.status, "connected")
        self.assertEqual(FakeSlack.made[-1].user_token, "xoxp-1")
        again.stop()
        other = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, other, True)
        self.app = be.SlackApp(make_client=FakeSlack)      # (tearDown stops one)
        self.app.start(Host(other))

    def test_when_each_conversation_was_last_active_comes_from_a_search_of_the_last_two_weeks(self):
        convs = {c["id"]: c for c in self.get("state")["conversations"]}
        self.assertGreater(float(convs["D1"]["active_ts"]), time.time() - 700)          # a search hit
        self.assertEqual(convs["C1"]["active_ts"], "")                                  # none in two weeks
        self.assertNotIn("CNOTMINE", convs)                                             # not the user's: left out
        self.assertEqual(self.slack.recent_after, time.strftime("%Y-%m-%d", time.localtime(time.time() - 14 * 86400)))
        parent = self.slack.msgs["C1"][0]["ts"]
        reply = ts_ago(-1)
        self.live(channel="C1", user=MAYA, text="?", ts=reply, thread_ts=parent)       # a thread reply counts too
        self.assertEqual(self.app.store.conversation("C1")["active_ts"], reply)
        self.app.store.active("C1", ts_ago(3600))                                       # never moved back
        self.assertEqual(self.app.store.conversation("C1")["active_ts"], reply)

    def test_tokens_that_are_not_slacks_are_refused(self):
        r = self.post("connect", {"user_token": "xoxb-1", "app_token": "xapp-1"})
        self.assertEqual(r.status, 400)
        self.assertIn("xoxp-", json.loads(r.body)["error"])

    def test_disconnecting_forgets_the_tokens(self):
        self.post("disconnect", {})
        self.assertFalse(os.path.exists(os.path.join(self.dir, be.CREDENTIALS)))
        self.assertTrue(self.slack.closed)
        self.assertEqual(self.get("state")["setup"]["status"], "off")
        self.assertTrue(self.call("search", {"query": "x"}).is_error)


class LiveTest(BackendBase):
    def test_a_new_message_is_told_to_the_panels_and_to_the_agents_working_with_slack(self):
        ts = ts_ago(-1)
        self.live(channel="C1", user=MAYA, text=f"<@{ME}> is Table 3 the Nov 1 rerun?", ts=ts)
        told = self.host.told[-1]
        self.assertEqual((told["kind"], told["conversation"], told["mention"]), ("message", "C1", True))
        self.assertEqual(told["unread"], {"C1": [1, 1]})
        (s,) = self.streams()
        self.assertEqual(s["channel"], "agent-a")
        self.assertEqual(s["payload"]["stream"], "Slack #paper-deadline")
        self.assertEqual(s["payload"]["author"], "Maya Chen")
        self.assertEqual(s["payload"]["text"], f"@Sep is Table 3 the Nov 1 rerun?  [conversation C1, ts {ts}]")
        self.live(channel="C1", user=MAYA, text="again", ts=ts)               # Slack re-sending it: once
        self.assertEqual(len(self.streams()), 1)

    def test_only_dms_and_mentions_reach_agents_when_the_user_says_so_and_nothing_with_none(self):
        self.post("settings", {"tell_agents": "mentions"})
        self.live(channel="C1", user=LEO, text="lunch?", ts=ts_ago(-1))
        self.live(channel="D1", user=MAYA, text="call?", ts=ts_ago(-2))
        self.assertEqual([s["payload"]["stream"] for s in self.streams()], ["Slack DM with Maya Chen"])
        self.post("settings", {"tell_agents": "none"})
        self.live(channel="D1", user=MAYA, text="hello?", ts=ts_ago(-3))
        self.assertEqual(len(self.streams()), 1)
        self.assertEqual(self.post("settings", {"tell_agents": "loud"}).status, 400)

    def test_the_users_own_message_marks_the_conversation_read(self):
        self.live(channel="C1", user=LEO, text="one", ts=ts_ago(-1))
        self.live(channel="C1", user=ME, text="two", ts=ts_ago(-2))
        self.assertEqual(self.host.told[-1]["unread"], {})
        self.assertEqual(self.streams()[-1]["payload"]["author"], "the user (Sep)")

    def test_a_message_in_a_conversation_not_known_adds_it_unread(self):
        self.slack.extra["D9"] = {"id": "D9", "kind": "im", "name": "", "user": LEO, "members": [], "topic": ""}
        self.live(channel="D9", user=LEO, text="hey", ts=ts_ago(-1), channel_type="im")
        self.assertIn("conversations", self.kinds())
        self.assertEqual(self.host.told[-1]["unread"], {"D9": [1, 1]})

    def test_a_thread_reply_moves_its_parents_count_and_edits_and_deletes_follow(self):
        parent = self.slack.msgs["C1"][0]["ts"]
        self.app.history("C1")                                               # the panel had it shown
        reply = ts_ago(-1)
        self.live(channel="C1", user=MAYA, text="done?", ts=reply, thread_ts=parent)
        told = self.host.told[-1]
        self.assertEqual((told["kind"], told["parent"]["reply_count"]), ("reply", 1))
        self.assertIn("(in a thread)", self.streams()[-1]["payload"]["stream"])
        self.assertIn(f"thread {parent}", self.streams()[-1]["payload"]["text"])
        self.live(channel="C1", subtype="message_changed", message={"ts": reply, "user": MAYA, "text": "done now?",
                                                                    "thread_ts": parent, "edited": {"ts": "1"}})
        self.assertEqual((self.host.told[-1]["kind"], self.host.told[-1]["message"]["text"]), ("changed", "done now?"))
        self.live(channel="C1", subtype="message_deleted", deleted_ts=reply)
        self.assertEqual(self.host.told[-1]["kind"], "deleted")
        self.assertEqual([m["ts"] for m in self.app.store.thread("C1", parent)], [parent])

    def test_reactions_are_counted_on_the_message(self):
        ts = self.slack.msgs["C1"][0]["ts"]
        self.app.history("C1")
        self.slack.on_event({"type": "reaction_added", "user": ME, "reaction": "eyes", "item": {"channel": "C1", "ts": ts}})
        self.slack.on_event({"type": "reaction_added", "user": MAYA, "reaction": "eyes", "item": {"channel": "C1", "ts": ts}})
        self.assertEqual(self.app.store.message("C1", ts)["reactions"], [{"name": "eyes", "count": 2, "mine": True}])
        self.slack.on_event({"type": "reaction_removed", "user": ME, "reaction": "eyes", "item": {"channel": "C1", "ts": ts}})
        self.assertEqual(self.app.store.message("C1", ts)["reactions"], [{"name": "eyes", "count": 1, "mine": False}])


class ToolsTest(BackendBase):
    def test_read_lists_conversations_unread_first_then_a_conversations_messages_then_a_thread(self):
        self.live(channel="D1", user=MAYA, text="call?", ts=ts_ago(-1))
        out = self.call("read", {}).content[0]["text"]
        self.assertLess(out.index("DM with Maya Chen (D1) -- 1 unread, 1 for the user"), out.index("#paper-deadline"))
        out = self.call("read", {"conversation": "#paper-deadline"}).content[0]["text"]
        self.assertIn("#paper-deadline (C1), topic: Camera-ready Fri", out)
        self.assertIn("Leo Park: Added the citations.", out)
        out = self.call("read", {"conversation": "maya"}).content[0]["text"]          # a person: their DM
        self.assertIn("Maya Chen: call?", out)
        self.assertTrue(self.call("read", {"conversation": "#nope"}).is_error)

    def test_draft_waits_in_the_panel_and_posts_nothing(self):
        parent = self.slack.msgs["C1"][0]["ts"]
        got = self.call("draft", {"conversation": "C1", "text": "Yes, it is.", "thread": parent})
        self.assertFalse(got.is_error, got.content)
        self.assertIn("Nothing was sent", got.content[0]["text"])
        self.assertEqual(self.slack.posted, [])
        (d,) = self.get("state")["drafts"]
        self.assertEqual((d["channel"], d["thread_ts"], d["by_channel"], d["label"]), ("C1", parent, "agent-a",
                                                                                       "#paper-deadline"))
        self.assertEqual(self.host.told[-1]["kind"], "draft")
        rec = [e for e in self.host.inserted if e["type"] == "slack.drafted"]
        self.assertEqual((rec[0]["channel"], rec[0]["payload"]["draft"]), ("agent-a", d["id"]))
        again = self.call("draft", {"draft": d["id"], "text": "Yes: the Nov 1 rerun."})
        self.assertFalse(again.is_error)
        self.assertEqual(self.get("state")["drafts"][0]["text"], "Yes: the Nov 1 rerun.")

    def test_a_draft_answering_a_reply_goes_in_its_thread(self):
        parent = self.slack.msgs["C1"][0]["ts"]
        self.app.history("C1")
        reply = ts_ago(-1)
        self.live(channel="C1", user=MAYA, text="?", ts=reply, thread_ts=parent)
        self.call("draft", {"conversation": "C1", "text": "ok", "thread": reply})
        self.assertEqual(self.get("state")["drafts"][0]["thread_ts"], parent)

    def test_a_draft_to_a_person_without_a_dm_opens_one(self):
        self.call("draft", {"conversation": "@leo", "text": "hi"})
        self.assertEqual(self.get("state")["drafts"][0]["channel"], f"D-{LEO}")

    def test_search_goes_to_slack(self):
        self.assertIn("#paper-deadline", self.call("search", {"query": "citations"}).content[0]["text"])
        self.assertIn("Nothing", self.call("search", {"query": "zebra"}).content[0]["text"])


class OpenTest(BackendBase):
    """What the panel has open: told by the panel, said by slack_read, and named "open" by agents."""

    def test_slack_read_says_what_is_open_and_open_names_it(self):
        parent = self.slack.msgs["C1"][0]["ts"]
        self.assertIn("Open in the user's Slack panel: no conversation.", self.call("read", {}).content[0]["text"])
        self.post("view", {"conversation": "C1", "thread": ""})
        out = self.call("read", {}).content[0]["text"]
        self.assertTrue(out.startswith("Open in the user's Slack panel: #paper-deadline (C1)."), out)
        self.assertIn("Leo Park: Added the citations.", self.call("read", {"conversation": "open"}).content[0]["text"])
        self.app.history("C1")
        self.post("view", {"conversation": "C1", "thread": parent})
        out = self.call("read", {}).content[0]["text"]
        self.assertIn(f"the thread of Leo Park's message {parent} (\"Added the citations.\")", out)
        self.assertTrue(self.call("read", {"conversation": "open"}).content[0]["text"].startswith(f"Thread {parent} in"))
        self.call("draft", {"conversation": "open", "text": "Thanks!"})           # into the open thread
        self.assertEqual(self.get("state")["drafts"][0]["thread_ts"], parent)

    def view(self, conversation, thread=""):
        """The panel opens it; the agents' wait for it to stay open runs out at once."""
        self.post("view", {"conversation": conversation, "thread": thread})
        t = self.app._view_timers.get(self.host.inst.id)
        if t is not None:
            t.join(2)

    def test_what_the_user_settles_on_is_told_to_the_agents_once(self):
        with mock.patch.object(be, "VIEW_SETTLE", 0):
            self.view("C1")
            (told,) = self.streams()
            self.assertEqual((told["channel"], told["payload"]["author"]), ("agent-a", "the user"))
            self.assertEqual(told["payload"]["text"],
                             "The user opened #paper-deadline (C1) in the Slack panel  [conversation C1]")
            self.view("C1")                                            # the same again: nothing new
            self.assertEqual(len(self.streams()), 1)
            parent = self.slack.msgs["C1"][0]["ts"]
            self.app.history("C1")
            self.view("C1", parent)                                    # its thread: told
            self.assertIn(f"the thread of Leo Park's message {parent}", self.streams()[-1]["payload"]["text"])
            self.assertTrue(self.streams()[-1]["payload"]["text"].endswith(f"[conversation C1, thread {parent}]"))

    def test_clicking_through_tells_only_where_the_user_stops(self):
        with mock.patch.object(be, "VIEW_SETTLE", 0.3):
            self.post("view", {"conversation": "C1", "thread": ""})
            self.view("D1")
        (told,) = self.streams()
        self.assertIn("The user opened DM with Maya Chen (D1)", told["payload"]["text"])

    def test_with_no_panel_open_nothing_is_open(self):
        self.post("view", {"conversation": "C1", "thread": ""})
        self.host.open_panels = 0
        self.assertIn("The user's Slack panel isn't open.", self.call("read", {}).content[0]["text"])
        got = self.call("read", {"conversation": "open"})
        self.assertTrue(got.is_error)
        self.assertIn("isn't open", got.content[0]["text"])


class ReachTest(BackendBase):
    """Search covers all of the user's Slack; a hit names where to read it, in channels they aren't in too."""

    def test_a_reply_found_names_its_thread_and_its_channel_can_be_read(self):
        out = self.call("search", {"query": "budget"}).content[0]["text"]
        self.assertIn("#ops (the user isn't in it) [300.000003] maya: The budget is in.  [conversation C0OPS7777, thread 200.000002]", out)
        self.slack.extra["C0OPS7777"] = {"id": "C0OPS7777", "kind": "channel", "name": "ops", "user": "", "members": [], "topic": ""}
        self.slack.msgs["C0OPS7777"] = [{"ts": "200.000002", "user": MAYA, "text": "Budget?", "thread_ts": "200.000002",
                                   "reply_count": 1, "latest_reply": "300.000003", "edited": False, "subtype": ""}]
        self.slack.threads[("C0OPS7777", "200.000002")] = [{"ts": "300.000003", "user": MAYA, "text": "The budget is in.",
                                                      "thread_ts": "200.000002", "reply_count": 0, "latest_reply": "",
                                                      "edited": False, "subtype": ""}]
        out = self.call("read", {"conversation": "C0OPS7777", "thread": "200.000002"}).content[0]["text"]
        self.assertIn("in #ops (C0OPS7777) (a channel the user isn't in):", out)
        self.assertIn("Maya Chen: The budget is in.", out)
        self.assertNotIn("C0OPS7777", [c["id"] for c in self.get("state")["conversations"]])   # not listed as theirs
        self.assertTrue(self.call("read", {"conversation": "C0NOPE404"}).is_error)

    def test_a_thread_is_read_from_slacks_link_to_a_message(self):
        self.assertEqual(thread_of("https://x.slack.com/archives/C1/p300000003?thread_ts=200.000002&cid=C1"), "200.000002")
        self.assertEqual(thread_of("https://x.slack.com/archives/C1/p300000003"), "")
        self.assertEqual(thread_of(""), "")


class SettleTest(BackendBase):
    def draft(self, **kw):
        self.call("draft", {"conversation": "C1", "text": "Yes, it is.", **kw})
        return self.get("state")["drafts"][0]

    def test_send_posts_the_users_text_and_tells_the_agent(self):
        parent = self.slack.msgs["C1"][0]["ts"]
        d = self.draft(thread=parent)
        r = self.post("draft", {"id": d["id"], "action": "send", "text": "Yes, it's the Nov 1 rerun.", "broadcast": True})
        self.assertEqual(r.status, 200, r.body)
        (p,) = self.slack.posted
        self.assertEqual((p["channel"], p["text"], p["thread_ts"], p["broadcast"]),
                         ("C1", "Yes, it's the Nov 1 rerun.", parent, True))
        self.assertEqual(self.get("state")["drafts"], [])
        told = self.streams()[-1]
        self.assertEqual((told["channel"], told["payload"]["author"]), ("agent-a", "the user"))
        self.assertIn(f"sent your draft {d['id']} in #paper-deadline, after editing it", told["payload"]["text"])
        sent = [e for e in self.host.inserted if e["type"] == "slack.sent"]
        self.assertEqual(sent[0]["payload"]["draft"], d["id"])
        self.assertEqual(self.post("draft", {"id": d["id"], "action": "send"}).status, 404)   # once

    def test_discard_posts_nothing_and_tells_the_agent(self):
        d = self.draft()
        self.post("draft", {"id": d["id"], "action": "discard"})
        self.assertEqual(self.slack.posted, [])
        self.assertIn("discarded your draft", self.streams()[-1]["payload"]["text"])
        self.assertTrue([e for e in self.host.inserted if e["type"] == "slack.discarded"])

    def test_the_users_own_message_is_posted_and_empty_ones_refused(self):
        r = self.post("send", {"conversation": "D1", "text": "  indented\nsecond"})
        self.assertEqual(r.status, 200)
        self.assertEqual(self.slack.posted[-1]["text"], "  indented\nsecond")         # as typed
        self.assertEqual(self.post("send", {"conversation": "D1", "text": "  \n"}).status, 400)
        self.assertEqual(self.host.told[-1]["kind"], "message")
        (told,) = self.streams()                                                 # the agent hears it, as from Slack
        self.assertEqual((told["channel"], told["payload"]["author"]), ("agent-a", "the user (Sep)"))
        self.assertIn("[conversation D1, ts", told["payload"]["text"])
        ts = self.slack.posted[-1]["ts"]
        self.live(channel="D1", user=ME, text="  indented\nsecond", ts=ts)         # Slack's own copy: told once
        self.assertEqual(len(self.streams()), 1)

    def test_a_sent_draft_is_told_to_its_agent_as_its_draft_and_to_the_others_as_a_message(self):
        self.host.agents = ["agent-a", "agent-b"]
        d = self.draft()
        self.post("draft", {"id": d["id"], "action": "send"})
        a = [x["payload"]["text"] for x in self.streams() if x["channel"] == "agent-a"]
        b = [x["payload"]["text"] for x in self.streams() if x["channel"] == "agent-b"]
        self.assertEqual(len(a), 1)
        self.assertIn(f"The user sent your draft {d['id']}", a[0])
        self.assertEqual(len(b), 1)
        self.assertTrue(b[0].startswith("Yes, it is.  [conversation C1, ts"), b[0])


class NotifyTest(BackendBase):
    """The user notified of new messages through the dashboard: DMs and mentions popped up, a channel's other new
    messages only listed (quiet), a conversation read clearing its."""

    def keys(self):
        return [(n["key"], n["show"]) for n in self.host.notices]

    def test_a_dm_and_a_mention_pop_up_and_on_the_computer_too(self):
        ts = ts_ago(-1)
        self.live(channel="D1", user=MAYA, text="call?", ts=ts)
        self.live(channel="C1", user=LEO, text=f"<@{ME}> can you check Table 3?", ts=ts_ago(-2))
        dm, mention = self.host.notices
        self.assertEqual((dm["key"], dm["show"], dm["title"], dm["text"]),
                         ("you:D1", ["ag", "system"], "Maya Chen, direct message", "call?"))
        self.assertEqual(dm["where"], {"conversation": "D1", "ts": ts, "thread": ""})
        self.assertEqual((mention["key"], mention["title"], mention["text"]),
                         ("you:C1", "Leo Park mentioned you in #paper-deadline", "@Sep can you check Table 3?"))
        self.post("settings", {"notify_system": False})
        self.live(channel="D1", user=MAYA, text="?", ts=ts_ago(-3))
        self.assertEqual(self.host.notices[-1]["show"], ["ag"])                    # in the dashboard only
        self.assertEqual(self.post("settings", {"notify_system": "no"}).status, 400)
        self.assertIs(self.get("state")["settings"]["notify_system"], False)

    def test_a_channels_other_messages_are_only_listed_and_said_again_at_most_every_while(self):
        self.live(channel="C1", user=LEO, text="lunch?", ts=ts_ago(-1))
        self.live(channel="C1", user=MAYA, text="yes", ts=ts_ago(-2))               # within QUIET_EVERY: not again
        self.assertEqual(self.keys(), [("new:C1", [])])
        self.assertEqual((self.host.notices[0]["title"], self.host.notices[0]["text"]), ("Leo Park in #paper-deadline", "lunch?"))
        with mock.patch.object(be, "QUIET_EVERY", 0):
            self.live(channel="C1", user=MAYA, text="at noon", ts=ts_ago(-3))
        n = self.host.notices[-1]
        self.assertEqual((n["key"], n["show"], n["title"], n["text"]), ("new:C1", [], "3 new messages in #paper-deadline",
                                                                         "Maya Chen: at noon"))

    def test_nothing_for_the_users_own_a_thread_reply_not_for_them_or_a_join(self):
        parent = self.slack.msgs["C1"][0]["ts"]
        self.live(channel="C1", user=ME, text="mine", ts=ts_ago(-1))
        self.live(channel="C1", user=MAYA, text="in the thread", ts=ts_ago(-2), thread_ts=parent)
        self.live(channel="C1", user=MAYA, text="joined", ts=ts_ago(-3), subtype="channel_join")
        self.assertEqual(self.host.notices, [])
        self.live(channel="C1", user=MAYA, text=f"<@{ME}> here", ts=ts_ago(-4), thread_ts=parent)   # for them: it is
        self.assertEqual((self.host.notices[0]["key"], self.host.notices[0]["title"], self.host.notices[0]["where"]["thread"]),
                         (f"thread:C1:{parent}", "Maya Chen mentioned you in #paper-deadline, in a thread", parent))

    def test_a_conversation_read_or_written_in_clears_its_and_only_what_may_be_open(self):
        ts = ts_ago(-1)
        self.live(channel="D1", user=MAYA, text="call?", ts=ts)
        self.live(channel="C1", user=LEO, text="lunch?", ts=ts_ago(-2))
        self.post("read", {"conversation": "D1", "ts": ts})
        self.assertEqual(self.host.cleared, ["you:D1"])
        self.post("read", {"conversation": "D1", "ts": ts})                         # nothing open: no record
        self.assertEqual(self.host.cleared, ["you:D1"])
        self.live(channel="C1", user=ME, text="I'm in", ts=ts_ago(-3))              # they wrote in it, in Slack
        self.assertEqual(self.host.cleared, ["you:D1", "new:C1"])
        self.live(channel="C1", user=LEO, text="great", ts=ts_ago(-4))              # cleared: said again at once
        self.assertEqual(self.keys()[-1], ("new:C1", []))
        self.post("send", {"conversation": "C1", "text": "see you"})                # from the panel
        self.post("notified", {"conversation": "D1"})
        self.assertEqual(self.host.cleared, ["you:D1", "new:C1", "new:C1"])

    def test_what_may_be_open_is_kept_across_a_restart(self):
        self.live(channel="D1", user=MAYA, text="call?", ts=ts_ago(-1))
        self.app.stop()
        self.app = be.SlackApp(make_client=FakeSlack)
        self.app.start(self.host)
        self.app.request(self.host.inst, "POST", "notified", {}, json.dumps({"conversation": "D1"}).encode())
        self.assertEqual(self.host.cleared, ["you:D1"])

    def test_messages_missed_while_the_line_was_down_are_listed_quietly_the_newest_of_each_kind(self):
        self.get("history", conversation="C1")                                      # shown in the panel: caught up
        a, b, c = ts_ago(-1), ts_ago(-2), ts_ago(-3)
        self.slack.msgs["C1"] += [{"ts": a, "user": MAYA, "text": f"<@{ME}> look"}, {"ts": b, "user": LEO, "text": "x"},
                                  {"ts": c, "user": LEO, "text": "y"}]
        self.slack.msgs["D1"] = [{"ts": a, "user": MAYA, "text": "hi"}, {"ts": b, "user": ME, "text": "hey"}]
        self.app._catch_up(self.app._gen, self.slack)
        got = {n["key"]: (n["show"], n["where"]["ts"]) for n in self.host.notices}
        self.assertEqual(got, {"you:C1": ([], a), "new:C1": ([], c)})              # D1: they answered after


class LineTest(BackendBase):
    """The live line kept up (the "line" schedule): a line down a while made again; the panel told."""

    def test_a_line_down_is_said_and_made_again_after_a_while(self):
        self.assertEqual(self.app.scheduled("line", time.time()), None)
        self.assertEqual(len(FakeSlack.made), 1)                                     # up: nothing to do
        self.slack.up = False
        self.assertEqual(self.get("state")["setup"]["status"], "disconnected")     # never "connected" without a line
        t = time.time()
        self.app.keep_line(t)
        self.assertEqual(self.host.told[-1]["setup"]["status"], "disconnected")
        self.app.keep_line(t + be.DOWN_WAIT - 1)
        self.assertEqual(len(FakeSlack.made), 1)                                     # the SDK may still reconnect
        self.app.keep_line(t + be.DOWN_WAIT)
        deadline = time.time() + 5
        while (len(FakeSlack.made) < 2 or self.app.status != "connected") and time.time() < deadline:
            time.sleep(0.02)
        self.assertEqual((len(FakeSlack.made), self.app.status), (2, "connected"))
        self.assertTrue(self.slack.closed)                                           # the old one let go

    def test_a_line_back_by_itself_is_said_connected_again(self):
        self.slack.up = False
        self.app._on_status(self.app._gen, "disconnected")
        self.slack.up = True
        self.app.keep_line()
        said = [t["setup"]["status"] for t in self.host.told if t["kind"] == "status"]
        self.assertEqual((self.app.status, said[-1]), ("connected", "connected"))
        self.assertEqual(len(FakeSlack.made), 1)

    def test_a_connection_that_failed_is_tried_again_but_not_refused_tokens(self):
        with self.app._lock:
            self.app.cl, self.app.status, self.app.error = None, "error", "timed out"
        self.app.keep_line()
        deadline = time.time() + 5
        while self.app.status != "connected" and time.time() < deadline:
            time.sleep(0.02)
        self.assertEqual((len(FakeSlack.made), self.app.status), (2, "connected"))
        with self.app._lock:
            self.app.cl, self.app.status, self.app.error = None, "error", "the user token was refused (invalid_auth)"
        self.app.keep_line()
        time.sleep(0.1)
        self.assertEqual((len(FakeSlack.made), self.app.status), (2, "error"))


class ReadInSlackTest(BackendBase):
    """What the user read in Slack's own app, followed: its read cursors asked every minute and on reconnecting; and
    messages missed while the line was down found through Slack's search, not only in conversations kept."""

    def test_reading_in_slack_reads_here_and_clears_a_notification_of_what_was_read(self):
        a, b = ts_ago(-1), ts_ago(-2)
        self.live(channel="D1", user=MAYA, text="call?", ts=a)
        self.live(channel="C1", user=LEO, text="lunch?", ts=b)
        self.assertEqual(self.app._unread(), {"D1": [1, 1], "C1": [1, 0]})
        self.slack.cursors = {"D1": a, "C1": ts_ago(30)}                           # D1 read in Slack; C1 not this far
        self.app.keep_line()
        self.assertEqual(sorted(self.slack.asked_read), ["C1", "D1"])             # those unread or notified only
        self.assertEqual(self.app._unread(), {"C1": [1, 0]})
        self.assertEqual(self.host.cleared, ["you:D1"])
        self.assertEqual(self.host.told[-1]["kind"], "conversations")             # the panels: D1 read
        self.slack.cursors["C1"] = b
        self.app.keep_line()
        self.assertEqual((self.app._unread(), self.host.cleared), ({}, ["you:D1", "new:C1"]))
        self.slack.asked_read.clear()
        self.app.keep_line()
        self.assertEqual(self.slack.asked_read, [])                                # nothing unread: nothing asked

    def test_a_notification_of_a_newer_message_stays_until_that_is_read(self):
        a = ts_ago(-1)
        self.live(channel="D1", user=MAYA, text="call?", ts=a)
        self.slack.cursors = {"D1": ts_ago(1)}                                     # read in Slack, but before it
        self.app.keep_line()
        self.assertEqual((self.app._unread(), self.host.cleared), ({"D1": [1, 1]}, []))

    def test_a_missed_message_found_by_search_is_fetched_and_listed_quietly_unless_read_in_slack(self):
        c1, d1 = self.app.store.conversation("C1"), self.app.store.conversation("D1")
        self.assertEqual((c1["latest_ts"], c1["synced"]), ("", 0))                 # nothing kept: the old catch-up's gap
        mention, other, dm = ts_ago(-1), ts_ago(-2), ts_ago(-3)
        self.slack.msgs["C1"] += [{"ts": mention, "user": MAYA, "text": f"<@{ME}> Table 3?"},
                                  {"ts": other, "user": LEO, "text": "pushed"}]
        self.slack.msgs["D1"] += [{"ts": dm, "user": MAYA, "text": "call?"}]
        self.slack.hits = [{"channel": "C1", "ts": other, "thread_ts": ""}, {"channel": "D1", "ts": dm, "thread_ts": ""},
                           {"channel": "C1", "ts": self.slack.msgs["C1"][0]["ts"], "thread_ts": ""}]   # old: read
        self.slack.cursors = {"D1": dm}                                            # the DM read in Slack's app
        self.app._catch_up(self.app._gen, self.slack, self.slack.recent(""))      # as a reconnect does
        got = {n["key"]: (n["show"], n["where"]["ts"]) for n in self.host.notices}
        self.assertEqual(got, {"you:C1": ([], mention), "new:C1": ([], other)})   # quiet; nothing for the DM read
        self.assertEqual(self.app._unread(), {"C1": [2, 1]})
        self.assertIsNone(self.app.store.message("C1", self.slack.msgs["C1"][0]["ts"]))   # an old one not fetched

    def test_a_missed_reply_is_fetched_with_its_thread(self):
        parent = self.slack.msgs["C1"][0]["ts"]
        reply = ts_ago(-1)
        self.slack.threads[("C1", parent)] = [{"ts": reply, "user": MAYA, "text": f"<@{ME}> see above", "thread_ts": parent}]
        self.slack.hits = [{"channel": "C1", "ts": reply, "thread_ts": parent}]
        self.app._catch_up(self.app._gen, self.slack, self.slack.recent(""))
        (n,) = self.host.notices
        self.assertEqual((n["key"], n["show"], n["where"]["thread"]), (f"thread:C1:{parent}", [], parent))

    def test_the_open_notifications_kept_before_their_times_were_still_cleared(self):
        self.app.store.set_setting("noticed", ["you:D1"])                         # as an earlier version kept them
        self.app.stop()
        self.app = be.SlackApp(make_client=FakeSlack)
        self.app.start(self.host)
        deadline = time.time() + 5
        while self.app.status != "connected" and time.time() < deadline:
            time.sleep(0.02)
        FakeSlack.made[-1].cursors = {"D1": ts_ago(-5)}                          # read in Slack since
        self.app.keep_line()
        self.assertEqual(self.host.cleared, ["you:D1"])


class LearnReadsTest(BackendBase):
    """A conversation's read mark is the app's guess until Slack's own cursor of it is taken (on connecting): what the
    user hadn't read in Slack before the app first saw it is unread here too."""

    def guess_again(self):
        self.app.store._do("UPDATE conversations SET read_known = 0")       # as a cache from before cursors were taken

    def test_what_was_unread_in_slack_before_is_fetched_and_its_dms_listed_quietly(self):
        a, b = ts_ago(7200), ts_ago(5400)
        self.slack.msgs["D1"] = [{"ts": a, "user": MAYA, "text": "call?"}, {"ts": b, "user": MAYA, "text": "?"}]
        self.slack.msgs["C1"].append({"ts": ts_ago(3000), "user": LEO, "text": "lunch?"})
        self.guess_again()
        self.slack.cursors = {"D1": ts_ago(9000), "C1": self.slack.msgs["C1"][0]["ts"]}
        self.app._learn_reads(self.app._gen, self.slack)
        self.assertEqual(self.app._unread(), {"D1": [2, 2], "C1": [1, 0]})
        self.assertEqual([(n["key"], n["show"], n["title"], n["where"]["ts"]) for n in self.host.notices],
                         [("you:D1", [], "Maya Chen, direct message", b)])  # quiet; a channel's only counted
        self.assertIn("history", self.kinds())
        self.slack.asked_read.clear()
        self.app._learn_reads(self.app._gen, self.slack)
        self.assertEqual(self.slack.asked_read, [])                          # known now: not asked again

    def test_a_cursor_further_on_is_taken_and_nothing_fetched(self):
        self.guess_again()
        on = ts_ago(-60)
        self.slack.cursors = {"C1": on}
        self.app._learn_reads(self.app._gen, self.slack)
        self.assertEqual(self.app.store.conversation("C1")["read_ts"], on)
        self.assertIsNone(self.app.store.message("C1", self.slack.msgs["C1"][0]["ts"]))

    def test_a_conversation_slack_cant_find_keeps_its_guess_and_isnt_asked_again(self):
        self.guess_again()
        self.slack.not_there = {"D1"}
        self.app._learn_reads(self.app._gen, self.slack)
        self.app._learn_reads(self.app._gen, self.slack)
        self.assertEqual(sorted(self.slack.asked_read), ["C1", "D1"])

    def test_a_dm_with_an_account_users_list_leaves_out_is_named_looked_up_once(self):
        self.slack.convs += [{"id": "D9", "kind": "im", "name": "", "user": "USLACK", "members": [], "topic": ""},
                             {"id": "D8", "kind": "im", "name": "", "user": "UGONE", "members": [], "topic": ""}]
        self.app._refresh(self.slack)
        self.app._refresh(self.slack)
        labels = {c["id"]: c["label"] for c in self.get("state")["conversations"]}
        self.assertEqual((labels["D9"], labels["D8"]), ("DM with Slack", "DM with UGONE"))
        self.assertEqual(sorted(self.slack.asked_user), ["UGONE", "USLACK"])


class GapTest(BackendBase):
    """What came while the line was down or unseen (the computer asleep), fetched from when it was last seen up -- also
    when newer messages came after, and when Slack's SDK reconnected by itself."""

    def until(self, check, seconds=5.0):
        deadline = time.time() + seconds
        while not check() and time.time() < deadline:
            time.sleep(0.02)
        return check()

    def test_a_gap_with_newer_messages_after_it_is_filled_once_the_line_is_seen_after_a_while(self):
        self.get("history", conversation="C1")                                  # shown in the panel
        t = time.time()
        self.app._seen_up(t)
        gap, after = ts_ago(-300), ts_ago(-600)                                 # asleep; the SDK back by itself
        self.slack.msgs["C1"] += [{"ts": gap, "user": MAYA, "text": f"<@{ME}> while you slept"},
                                  {"ts": after, "user": LEO, "text": "after"}]
        self.live(channel="C1", user=LEO, text="after", ts=after)              # newer than the gap: kept first
        self.app.keep_line(t + 900)                                             # seen again after 15 minutes
        self.assertTrue(self.until(lambda: self.app.store.message("C1", gap) is not None))
        self.assertTrue(self.until(lambda: any(n["key"] == "you:C1" for n in self.host.notices)))
        n = next(n for n in self.host.notices if n["key"] == "you:C1")
        self.assertEqual((n["show"], n["where"]["ts"]), ([], gap))              # listed quietly
        self.assertEqual(self.app.store.setting("live_at"), t + 900)

    def test_a_line_seen_each_minute_fetches_nothing(self):
        t = time.time()
        self.app._seen_up(t)
        self.slack.recent_after, self.slack.asked_history = None, []
        self.app.keep_line(t + 60)
        time.sleep(0.1)
        self.assertEqual(self.slack.recent_pages, 1)                            # only the minute's look (MissedTest)
        self.assertEqual(self.slack.asked_history, [])

    def test_a_line_back_by_itself_soon_after_it_went_down_has_what_came_meanwhile_fetched(self):
        self.get("history", conversation="C1")
        self.app._seen_up(time.time())
        self.slack.up = False
        self.app._on_status(self.app._gen, "error: [Errno 54] Connection reset by peer")
        missed = ts_ago(-1)
        self.slack.msgs["C1"].append({"ts": missed, "user": MAYA, "text": "meanwhile"})
        self.slack.up = True
        self.app._on_status(self.app._gen, "connected")                         # the SDK's own reconnect
        self.app.keep_line()
        self.assertTrue(self.until(lambda: self.app.store.message("C1", missed) is not None))

    def test_a_restart_fetches_from_when_the_line_was_last_seen_up(self):
        t = time.time() - 30
        self.app.keep_line(t)
        self.app.stop()
        self.app = be.SlackApp(make_client=FakeSlack)
        self.app.start(self.host)
        self.assertEqual(self.app._missed_after(), f"{t - be.GAP_MARGIN:.6f}")

    def test_a_long_gap_is_fetched_newest_first_page_by_page(self):
        self.get("history", conversation="C1")
        base = time.time() + 10
        many = [{"ts": f"{base + i:.6f}", "user": LEO, "text": f"m{i}"} for i in range(350)]
        self.slack.msgs["C1"] += many
        self.app._catch_up(self.app._gen, self.slack)
        kept = [i for i, m in enumerate(many) if self.app.store.message("C1", m["ts"])]
        self.assertEqual((len(kept), kept[0], kept[-1]), (be.CATCH_PAGES * 100, 50, 349))   # the newest, not the oldest


class ThreadTest(BackendBase):
    """Replies in threads the user follows -- started, replied in, followed by hand -- popped up, as Slack does."""

    def setUp(self):
        super().setUp()
        self.parent = self.slack.msgs["C1"][0]["ts"]                               # Leo's, in #paper-deadline

    def test_a_reply_in_a_thread_they_started_or_replied_in_pops_up(self):
        mine = ts_ago(-1)
        self.live(channel="C1", user=ME, text="a question", ts=mine)
        self.live(channel="C1", user=MAYA, text="an answer", ts=ts_ago(-2), thread_ts=mine, parent_user_id=ME)
        n = self.host.notices[-1]
        self.assertEqual((n["key"], n["show"], n["title"], n["where"]["thread"]),
                         (f"thread:C1:{mine}", ["ag", "system"], "Maya Chen replied to your thread in #paper-deadline", mine))
        self.live(channel="C1", user=ME, text="I'll look", ts=ts_ago(-3), thread_ts=self.parent)   # they reply in Leo's
        self.live(channel="C1", user=LEO, text="thanks", ts=ts_ago(-4), thread_ts=self.parent)
        self.assertEqual((self.host.notices[-1]["key"], self.host.notices[-1]["title"]),
                         (f"thread:C1:{self.parent}", "Leo Park replied in a thread you follow in #paper-deadline"))
        self.assertEqual(self.slack.asked_thread, [])                              # known here: Slack not asked

    def test_slack_says_which_others_they_follow_asked_once_a_thread(self):
        self.slack.followed[("C1", self.parent)] = [True, ""]                       # followed in Slack's app
        self.live(channel="C1", user=MAYA, text="+1", ts=ts_ago(-1), thread_ts=self.parent)
        self.live(channel="C1", user=MAYA, text="+2", ts=ts_ago(-2), thread_ts=self.parent)
        self.assertEqual([n["key"] for n in self.host.notices], [f"thread:C1:{self.parent}"] * 2)
        self.assertEqual(self.slack.asked_thread, [("C1", self.parent)])
        other = ts_ago(-3)
        self.live(channel="C1", user=LEO, text="unrelated", ts=other)
        self.live(channel="C1", user=MAYA, text="re", ts=ts_ago(-4), thread_ts=other)      # not followed: nothing
        self.assertEqual([n["key"] for n in self.host.notices], [f"thread:C1:{self.parent}"] * 2 + ["new:C1"])

    def test_a_threads_notification_clears_when_it_is_opened_replied_in_or_read_in_slack(self):
        self.slack.followed[("C1", self.parent)] = [True, ""]
        a = ts_ago(-1)
        self.live(channel="C1", user=MAYA, text="+1", ts=a, thread_ts=self.parent)
        key = f"thread:C1:{self.parent}"
        self.post("view", {"conversation": "C1", "thread": self.parent})            # opened in the panel
        self.assertEqual(self.host.cleared, [key])
        self.live(channel="C1", user=MAYA, text="+2", ts=ts_ago(-2), thread_ts=self.parent)
        self.post("send", {"conversation": "C1", "text": "ok", "thread": self.parent})    # replied in, from the panel
        self.assertEqual(self.host.cleared, [key, key])
        b = ts_ago(-3)
        self.live(channel="C1", user=MAYA, text="+3", ts=b, thread_ts=self.parent)
        self.slack.followed[("C1", self.parent)] = [True, ts_ago(-2.5)]             # read in Slack, but not this far
        self.app.keep_line()
        self.assertEqual(self.host.cleared, [key, key])
        self.slack.followed[("C1", self.parent)] = [True, b]
        self.app.keep_line()
        self.assertEqual(self.host.cleared, [key, key, key])
        self.live(channel="C1", user=MAYA, text="+4", ts=ts_ago(-4), thread_ts=self.parent)
        self.post("notified", {"conversation": "C1", "thread": self.parent})       # its notification clicked
        self.assertEqual(self.host.cleared, [key] * 4)


if __name__ == "__main__":
    unittest.main()


class MissedTest(BackendBase):
    """A line that says it is up and brings nothing (dead without a word, or Slack handing the messages to another
    connection): each minute Slack's search is looked at, and what the line never brought is taken as new."""

    def test_a_message_the_line_never_brought_is_found_and_taken_as_new_and_the_line_made_again(self):
        ts = ts_ago(30)
        self.slack.msgs["D1"].append(full({"ts": ts, "user": MAYA, "text": "you there?"}))
        self.slack.hits = [{"channel": "D1", "ts": ts, "thread_ts": ""}]
        with mock.patch.object(self.app, "_connect") as remake:
            self.app.keep_line()
            self.assertEqual(self.slack.recent_pages, 1)
            self.assertEqual(self.slack.recent_after, time.strftime("%Y-%m-%d", time.localtime(time.time() - 2 * 86400)))
            self.assertIsNotNone(self.app.store.message("D1", ts))
            n = self.host.notices[-1]
            self.assertEqual((n["key"], n["show"], n["text"]), ("you:D1", ["ag", "system"], "you there?"))   # popped up
            self.assertEqual([t["conversation"] for t in self.host.told if t["kind"] == "message"], ["D1"])
            self.assertEqual([e["payload"]["stream"] for e in self.streams()], ["Slack DM with Maya Chen"])
            self.assertEqual(remake.call_args.args, ("xoxp-1", "xapp-1"))
            self.app.keep_line()                                                  # kept now: nothing again
            self.assertEqual((len(self.host.notices), remake.call_count), (1, 1))

    def test_a_missed_thread_reply_is_fetched_from_its_thread(self):
        parent = self.slack.msgs["C1"][0]["ts"]
        reply = full({"ts": ts_ago(20), "user": MAYA, "text": f"<@{ME}> see above", "thread_ts": parent})
        self.slack.threads[("C1", parent)] = [reply]
        self.slack.hits = [{"channel": "C1", "ts": reply["ts"], "thread_ts": parent}]
        with mock.patch.object(self.app, "_connect"):
            self.app.keep_line()
        self.assertIsNotNone(self.app.store.message("C1", reply["ts"]))
        self.assertEqual(self.host.notices[-1]["key"], f"thread:C1:{parent}")
        self.assertEqual(self.slack.asked_history, [])

    def test_what_the_line_brought_what_is_older_and_others_conversations_are_left_alone(self):
        brought = ts_ago(10)
        self.live(channel="C1", user=LEO, text="on the line", ts=brought)
        self.host.notices.clear()
        old = ts_ago(be.CHECK_BACK + 60)
        self.slack.msgs["C1"].append(full({"ts": old, "user": LEO, "text": "long ago"}))
        self.slack.hits = [{"channel": "C1", "ts": brought, "thread_ts": ""}, {"channel": "C1", "ts": old, "thread_ts": ""},
                           {"channel": "CNOTMINE", "ts": ts_ago(5), "thread_ts": ""}]
        self.slack.asked_history = []
        with mock.patch.object(self.app, "_connect") as remake:
            self.app.keep_line()
        self.assertEqual((self.slack.asked_history, self.host.notices, remake.call_count), ([], [], 0))
        self.assertIsNone(self.app.store.message("C1", old))                     # (a catch-up's, after a gap)

    def test_a_line_that_keeps_missing_is_made_again_at_most_every_while(self):
        with mock.patch.object(self.app, "_connect") as remake:
            for i, ago in enumerate((40, 30)):
                ts = ts_ago(ago)
                self.slack.msgs["D1"].append(full({"ts": ts, "user": MAYA, "text": f"m{i}"}))
                self.slack.hits = [{"channel": "D1", "ts": ts, "thread_ts": ""}]
                self.assertEqual(self.app._check_missed(self.app._gen, self.slack, time.time()), 1)
            self.assertEqual(remake.call_count, 1)
            later = time.time() + be.REMAKE_EVERY                                  # a while on: made again
            ts = f"{later - 10:.6f}"
            self.slack.msgs["D1"].append(full({"ts": ts, "user": MAYA, "text": "later"}))
            self.slack.hits = [{"channel": "D1", "ts": ts, "thread_ts": ""}]
            self.app._check_missed(self.app._gen, self.slack, later)
            self.assertEqual(remake.call_count, 2)

    def test_no_check_while_a_gap_is_being_caught_up(self):
        self.app._seen_up(time.time())
        self.slack.recent_pages = None
        with mock.patch.object(self.app, "_check_missed") as check:
            self.app.keep_line(time.time() + 900)                                 # unseen 15 minutes: a catch-up
        self.assertEqual(check.call_count, 0)


class HomeTest(BackendBase):
    """The live line is the home's the tokens were connected in: a copy of the home opens none, so it can't take the
    user's messages (Slack hands each to only one connection on the tokens)."""

    def copy(self):
        other = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, other, True)
        folder = os.path.join(other, "home", "apps", "slack", "data")
        os.makedirs(folder)
        shutil.copy(os.path.join(self.dir, be.CREDENTIALS), folder)
        host = Host(folder)
        app = be.SlackApp(make_client=FakeSlack)
        self.addCleanup(app.stop)
        app.start(host)
        deadline = time.time() + 5
        while app.status in ("off", "connecting") and time.time() < deadline:
            time.sleep(0.02)
        return app, host, folder

    def kept(self, folder):
        with open(os.path.join(folder, be.CREDENTIALS)) as f:
            return json.load(f)

    def test_the_tokens_are_kept_with_the_home_they_were_connected_in(self):
        self.assertEqual(self.kept(self.dir)["home"], self.app._home())
        self.assertEqual(self.get("state")["setup"]["copy_of"], "")

    def test_a_copy_of_the_home_reads_slack_but_opens_no_line(self):
        app, host, folder = self.copy()
        made = FakeSlack.made[-1]
        self.assertEqual((app.status, made.user_token, made.app_token, made.on_event), ("copied", "xoxp-1", "", None))
        st = json.loads(app.request(host.inst, "GET", "state", {}, b"").body)["setup"]
        self.assertEqual((st["status"], st["live"], st["tokens"], st["copy_of"]), ("copied", False, True, self.app._home()))
        made.recent_pages = None
        app.keep_line()                                                          # no line to keep: none made, no look
        self.assertEqual((len(FakeSlack.made), made.recent_pages), (2, None))

    def test_connecting_again_in_the_copy_moves_the_line_there(self):
        app, host, folder = self.copy()
        r = app.request(host.inst, "POST", "connect", {}, json.dumps({"user_token": "xoxp-1", "app_token": "xapp-1",
                                                                        "wait": True}).encode())
        self.assertEqual(json.loads(r.body)["setup"]["status"], "connected")
        self.assertEqual(self.kept(folder)["home"], app._home())

    def test_tokens_kept_before_homes_were_named_are_the_default_homes(self):
        path = os.path.join(self.dir, be.CREDENTIALS)
        with open(path, "w") as f:
            json.dump({"user_token": "xoxp-1", "app_token": "xapp-1"}, f)
        with mock.patch.object(be, "DEFAULT_HOME", "/nowhere/.ag"):              # not the default home: a copy's
            self.assertEqual(self.app._tokens(), ("xoxp-1", ""))
            self.assertEqual(self.app._copy_of, "another ag home")
        self.assertNotIn("home", self.kept(self.dir))
        with mock.patch.object(be, "DEFAULT_HOME", self.app._home()):            # the default home: its, named now
            self.assertEqual(self.app._tokens(), ("xoxp-1", "xapp-1"))
        self.assertEqual(self.kept(self.dir)["home"], self.app._home())
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)


class FeaturesTest(BackendBase):
    """What the panel does besides reading and sending: names made mentions, the user's own messages edited and deleted,
    messages scheduled, the Threads and Activity views, DMs and group DMs opened, people's photos and statuses."""

    def test_names_typed_become_slacks_mentions_and_links_outside_code(self):
        a = self.app
        self.assertEqual(a.linked("@Maya Chen and @lpark, see #paper-deadline @here"),
                         f"<@{MAYA}> and <@{LEO}>, see <#C1> @here".replace("@here", "<!here>"))
        self.assertEqual(a.linked("`@maya` ```@leo #paper-deadline``` <https://x.org|@maya>"),
                         "`@maya` ```@leo #paper-deadline``` <https://x.org|@maya>")      # code and links kept
        self.assertEqual(a.linked("mail maya@lab.org, #nochannel, @nobody"), "mail maya@lab.org, #nochannel, @nobody")
        self.assertEqual(a.linked("@Maya Chen's draft"), f"<@{MAYA}>'s draft")

    def test_what_the_user_sends_and_drafts_they_send_carry_mentions(self):
        self.post("send", {"conversation": "C1", "text": "@maya can you look?"})
        self.assertEqual(self.slack.posted[-1]["text"], f"<@{MAYA}> can you look?")
        self.call("draft", {"conversation": "C1", "text": "Thanks @Leo Park!"})
        d = self.app.store.drafts()[0]
        self.post("draft", {"id": d["id"], "action": "send"})
        self.assertEqual(self.slack.posted[-1]["text"], f"Thanks <@{LEO}>!")

    def test_the_user_edits_and_deletes_only_their_own_messages(self):
        sent = json.loads(self.post("send", {"conversation": "C1", "text": "first try"}).body)["message"]
        self.host.told.clear()
        r = self.post("edit", {"conversation": "C1", "ts": sent["ts"], "text": "second try, @maya"})
        self.assertEqual(r.status, 200, r.body)
        self.assertEqual(self.slack.updated, [("C1", sent["ts"], f"second try, <@{MAYA}>")])
        kept = self.app.store.message("C1", sent["ts"])
        self.assertEqual((kept["text"], kept["edited"]), (f"second try, <@{MAYA}>", True))
        self.assertEqual(self.kinds(), ["changed"])
        theirs = self.slack.msgs["C1"][0]["ts"]
        self.get("history", conversation="C1")
        self.assertEqual(self.post("edit", {"conversation": "C1", "ts": theirs, "text": "x"}).status, 403)
        self.assertEqual(self.post("delete", {"conversation": "C1", "ts": theirs}).status, 403)
        self.assertEqual(self.post("edit", {"conversation": "C1", "ts": sent["ts"], "text": "  "}).status, 400)
        self.assertEqual(self.post("delete", {"conversation": "C1", "ts": sent["ts"]}).status, 200)
        self.assertEqual(self.slack.deleted, [("C1", sent["ts"])])
        self.assertIsNone(self.app.store.message("C1", sent["ts"]))
        self.assertEqual(self.kinds()[-1], "deleted")

    def test_a_message_is_scheduled_listed_and_taken_back(self):
        soon = time.time() + 3600
        self.assertEqual(self.post("schedule", {"conversation": "C1", "text": "hi", "at": time.time() - 5}).status, 400)
        self.assertEqual(self.post("schedule", {"conversation": "C1", "text": "hi", "at": time.time() + 200 * 86400}).status, 400)
        r = self.post("schedule", {"conversation": "C1", "text": "standup @here", "at": soon})
        self.assertEqual(r.status, 200, r.body)
        self.assertEqual(self.slack.waiting[0]["text"], "standup <!here>")
        self.assertEqual(self.kinds(), ["scheduled"])
        got = self.get("scheduled", conversation="C1")["scheduled"]
        self.assertEqual([(x["text"], x["post_at"]) for x in got], [("standup <!here>", int(soon))])
        self.post("unschedule", {"conversation": "C1", "id": got[0]["id"]})
        self.assertEqual(self.get("scheduled", conversation="C1")["scheduled"], [])

    def test_threads_lists_the_ones_the_user_is_in_newest_reply_first(self):
        parent = ts_ago(500)
        self.live(channel="C1", user=LEO, text="Who has the slides?", ts=parent, channel_type="channel")
        self.post("send", {"conversation": "C1", "text": "I do", "thread": parent})
        self.live(channel="C1", user=MAYA, text="thanks!", ts=ts_ago(-1), thread_ts=parent, channel_type="channel")
        self.live(channel="C1", user=LEO, text="unrelated", ts=ts_ago(400), channel_type="channel")
        got = self.get("threads")["threads"]
        self.assertEqual([(t["conversation"], t["parent"]["text"], t["last"]["text"]) for t in got],
                         [("C1", "Who has the slides?", "thanks!")])
        self.assertTrue(got[0]["unread"])                # a reply in a thread they follow: its notification open
        self.assertEqual(self.app._badges()["threads"], 1)
        self.post("view", {"conversation": "C1", "thread": parent})
        self.assertFalse(self.get("threads")["threads"][0]["unread"])
        self.assertEqual(self.host.told[-1].get("badges", {}).get("threads"), 0)

    def test_activity_is_mentions_and_reactions_to_the_users_messages(self):
        mine = json.loads(self.post("send", {"conversation": "C1", "text": "draft is up"}).body)["message"]
        self.live(channel="C1", user=MAYA, text=f"<@{ME}> nice", ts=ts_ago(-1), channel_type="channel")
        self.slack.on_event({"type": "reaction_added", "user": LEO, "reaction": "tada", "item_user": ME,
                             "item": {"type": "message", "channel": "C1", "ts": mine["ts"]}, "event_ts": ts_ago(-2)})
        self.slack.on_event({"type": "reaction_added", "user": ME, "reaction": "eyes", "item_user": ME,
                             "item": {"type": "message", "channel": "C1", "ts": mine["ts"]}, "event_ts": ts_ago(-3)})
        got = self.get("activity")
        self.assertEqual([(x["kind"], x["user"], x["name"]) for x in got["items"]],
                         [("reaction", LEO, "tada"), ("mention", MAYA, "")])     # not the user's own reaction
        self.assertEqual(got["items"][0]["message"]["text"], "draft is up")
        self.assertEqual(self.app._badges()["activity"], 2)
        self.post("activity_seen", {"at": got["items"][0]["at"]})
        self.assertEqual(self.app._badges()["activity"], 0)
        self.slack.on_event({"type": "reaction_removed", "user": LEO, "reaction": "tada", "item_user": ME,
                             "item": {"type": "message", "channel": "C1", "ts": mine["ts"]}})
        self.assertEqual([x["kind"] for x in self.get("activity")["items"]], ["mention"])

    def test_the_views_are_filled_from_slacks_search_too_in_the_background(self):
        parent = ts_ago(9000)
        self.slack.msgs["C1"].append({"ts": parent, "user": LEO, "text": "Old question", "thread_ts": "", "reply_count": 1,
                                      "latest_reply": ts_ago(8000), "edited": False, "subtype": ""})
        self.slack.threads[("C1", parent)] = [{"ts": ts_ago(8000), "user": ME, "text": "Old answer", "thread_ts": parent}]
        asked = []

        def search(query, limit=20):
            asked.append(query)
            if query.startswith("from:"):
                return [{"channel": "C1", "channel_name": "paper-deadline", "ts": ts_ago(8000), "user": ME, "username": "sep",
                         "text": "Old answer", "permalink": "", "thread_ts": parent}]
            return [{"channel": "D1", "channel_name": "", "ts": ts_ago(7000), "user": MAYA, "username": "maya",
                     "text": f"<@{ME}> ping", "permalink": "", "thread_ts": ""}]
        self.slack.search = search
        self.assertEqual(self.get("threads")["threads"], [])            # (what is kept, at once)
        self.get("activity")
        deadline = time.time() + 3
        while time.time() < deadline and not (self.get("threads")["threads"] and self.app._mention_hits):
            time.sleep(0.02)
        self.assertEqual([t["last"]["text"] for t in self.get("threads")["threads"]], ["Old answer"])
        self.assertEqual([x["message"]["text"] for x in self.get("activity")["items"]], [f"<@{ME}> ping"])
        self.assertIn("threads", self.kinds())
        self.assertEqual(asked[0].split(" ")[0], f"from:<@{ME}>")
        n = len(asked)
        self.get("threads"); self.get("activity")                        # not asked again for a while
        self.assertEqual(len(asked), n)

    def test_a_dm_or_group_dm_is_opened_with_people(self):
        got = json.loads(self.post("open", {"users": [MAYA]}).body)["conversation"]
        self.assertEqual(got["id"], "D1")                # the DM already kept
        got = json.loads(self.post("open", {"users": [MAYA, LEO, ME]}).body)["conversation"]
        self.assertEqual((got["kind"], got["id"]), ("mpim", f"G-{MAYA}-{LEO}"))
        self.assertIn(got["id"], [c["id"] for c in self.app.store.conversations()])
        self.assertEqual(self.post("open", {"users": []}).status, 400)

    def test_the_panel_gets_peoples_photos_statuses_and_a_conversations_members_and_links(self):
        users = self.get("state")["users"]
        self.assertEqual((users[MAYA]["image"], users[MAYA]["status"]["text"], users[MAYA]["tz"]),
                         ("https://avatars.example/maya.png", "Away", "Europe/Berlin"))
        self.assertEqual(self.get("members", conversation="C1")["members"], [ME, MAYA, LEO])
        self.assertTrue(self.get("permalink", conversation="C1", ts="1.000002")["url"].endswith("/C1/p1000002"))

    def test_a_cache_from_before_photos_gains_their_columns(self):
        path = os.path.join(self.dir, "old-users.db")
        db = sqlite3.connect(path)
        db.executescript("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', real_name TEXT NOT "
                         "NULL DEFAULT '', bot INTEGER NOT NULL DEFAULT 0); INSERT INTO users (id, name) VALUES ('U9', 'x');")
        db.close()
        old = Store(path)
        self.assertEqual((old.users()["U9"]["name"], old.users()["U9"]["image"], old.users()["U9"]["status"]), ("x", "", None))
        old.close()


class PersonTest(unittest.TestCase):
    def test_a_person_keeps_their_photo_status_and_handle(self):
        got = be.slack.person({"id": "U1", "name": "mchen", "tz": "America/New_York", "profile": {
            "display_name": "Maya", "real_name": "Maya Chen", "image_72": "https://a/72.png", "status_emoji": ":car:",
            "status_text": "Driving", "status_expiration": 99, "title": "PhD student"}})
        self.assertEqual((got["handle"], got["image"], got["status"], got["title"], got["deleted"]),
                         ("mchen", "https://a/72.png", {"emoji": ":car:", "text": "Driving", "until": 99}, "PhD student", False))
        self.assertIsNone(be.slack.person({"id": "U2", "profile": {}})["status"])
