"""Paper news's backend (app.toml): each weekday's listing of the user's arXiv categories, fetched by its schedule
just after arXiv's feed takes it (feed.py), kept (store.py); its own agent picks the papers related to the user's
research (interests.py), and the user is told what is for them. Agents attached to it read the listings with its tools.

What the user is interested in, and the agent:
  - The user tells the app what they work on (`interests`: their profile's address, keywords, topics, papers they want
    related work on, their own words). The app asks its agent -- an actor of its own, started with that first message
    if it has none (Host.start_agent), named "Paper news" -- to write a structured summary of it (interests.FIELDS), which
    the agent saves with paper_news_profile. The user can edit any field; the fields they wrote are kept as theirs.
  - Each day that comes in, the agent is sent the summary and the day's papers (titles, abstracts) and saves the ones
    relevant to the user with paper_news_relevant: each with a score and why. The user is notified of those, and the panel
    opens on them ("For you"), the whole listing a tab away.
  - The user marks papers relevant or not. Every FEEDBACK_EVERY of their words since the summary was written, the agent
    is asked to write it again from what they told the app, the summary as it is and that feedback.
  - A message the agent's terminal can't take now (a dialog open in it) waits and is sent again (SEND_RETRY).
  - An ask to pick that never came back is asked again (`_ask_again`, the "picks" schedule, every 30 minutes): the
    message may never have reached the agent (typed into its terminal as the computer went back to sleep, 2026-11-13),
    or its turn may have ended before it saved any. The newest day only, once its ask is STALE, its agent has used none
    of the app's tools for as long (still at it, else) and no ask of it waits for the terminal: at most ASKS_TAKEN asks
    the agent took up (used a tool after) and ASKS_MAX in all, a day.

A run (`fetch`, the schedule's and the panel's "Fetch now"):
  1. The feed (one request for every category): the day it carries, kept if it is new to the app. Empty for the day
     expected (`feed.listing_day`) -- the announcement late, or the feed not yet rebuilt -- the run is tried again in
     WAIT_RETRY, until the next announcement's time, when the day is kept as "none" (arXiv announced nothing: a
     holiday).
  2. Days missed since the app's first (the dashboard not running when they were out, at most CATCHUP_DAYS back): each
     read from arXiv's catch-up pages, a category at a time; a day that can't be read is kept as "missed", tried again
     on the next run.
  3. The newest day that came in is told: a notification on each instance (one at a time: a newer one takes its place),
     and every open panel told to read the days again.

The panel's routes (its own origin, /api/...):

    GET  state                    {settings, days, status, saved}: what the panel shows around a day
    GET  day?day=YYYY-MM-DD       {day, papers}: a day's papers, in arXiv's order
    GET  saved                    {papers}: the saved ones, last saved first
    GET  search?q=words           {papers}: every day's papers holding the words
    POST save      {id, saved}    a paper saved, or not
    POST settings  {categories?, replacements?, notify_system?}   the settings changed: {settings}; new categories
                                                                  fetch the day's listing again
    POST fetch                    a run now, in the background: {started}
    GET  interests                {inputs, profile, fields, feedback, summarizing, agent}: what the user told it, the
                                  summary, the fields' meanings, their feedback and how many until the summary is
                                  written again
    POST interests {scholar, keywords, topics, papers, notes}   what the user told it: the agent asked to (re)write the
                                  summary from it
    POST profile   {fields}       summary fields written by the user: theirs from then on
    POST summarize                the agent asked again to write the summary (one asked for that never came)
    POST feedback  {id, verdict, day}   the user's word on a paper: "relevant", "not", or null (taken back)
    POST judge     {day}          the agent asked to pick a day's papers (again)"""

import json
import re
import threading
import time
from datetime import date, timedelta
from typing import Callable, List, Optional

from app_kit import App, AppError, Caller, Instance, Response, ToolResult

from . import feed
from . import interests as it
from .store import Store

WAIT_RETRY = 1800.0          # seconds until a run waiting for the day's listing tries again
ERROR_RETRY = 900.0          # and one that couldn't reach arXiv
CATCHUP_DAYS = 7             # how far back missed days are read again (calendar days)
CHECK_EVERY = 1800.0         # the panel open and the day's listing not in: looked for, if not looked for this recently
CATEGORIES_MAX = 12
LIST_DEFAULT, LIST_MAX = 100, 500
PAPERS_MAX = 20
FEEDBACK_EVERY = 20          # the user's words on papers that make the agent write the summary again
STALE = 1800.0               # an ask of the agent not answered in this long is shown as not answered, to ask again
ASKS_TAKEN = 2               # asks to pick a day that its agent took up (used a tool after), then no more of that day
ASKS_MAX = 48                # and asks of a day in all, taken up or not (a day of the "picks" schedule's checks)
SEND_RETRY, SEND_TRIES = 60.0, 30   # a message its agent's terminal couldn't take: tried again this often, this often
AGENT_NAME = "Paper news"
LISTED = ("new", "cross")
UPDATED = ("replace", "replace-cross")
WHY_CHARS = 300
_ID = re.compile(r"^(?:arXiv:)?(?:\S*/abs/)?(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d+)?$", re.I)


class PaperNewsApp(App):
    def __init__(self, fetch: Callable[[str], bytes] = feed.get, clock: Callable[[], float] = time.time,
                 pause: float = feed.PAUSE):
        self._get, self._clock, self._pause = fetch, clock, pause
        self.store: Optional[Store] = None
        self._run = threading.Lock()                      # one run at a time
        self._state = threading.Lock()
        self._again: Optional[threading.Timer] = None      # a run of its own tried again (not the schedule's)
        self._outbox: List[list] = []                      # messages to its agent not taken yet: [text, tries, key]
        self._outbox_timer: Optional[threading.Timer] = None
        self._stopped = False
        self.status = {"fetching": False, "waiting": None, "error": None, "checked": None}

    def start(self, host) -> None:
        super().start(host)
        self.store = Store(host.folder())

    def stop(self) -> None:
        self._stopped = True
        self._wait_again(None)
        with self._state:
            if self._outbox_timer is not None:
                self._outbox_timer.cancel()
        if self.store is not None:
            self.store.close()

    # -- the instance

    def open(self, instance: Instance, args: dict) -> Instance:
        if not self.store.days():                         # the first: today's listing at once, not at the schedule's time
            self.fetch_later()
        return Instance(**{**instance.to_dict(), "title": "Paper news"})

    # -- a run

    def scheduled(self, schedule: str, due: float) -> Optional[float]:
        if schedule == "picks":
            self._ask_again()
            return None
        if schedule != "listing":
            return None
        self._wait_again(None)                            # the schedule tries its run again itself
        return self.fetch()

    def fetch_later(self, force: bool = False) -> bool:
        """A run in a thread of its own, unless one is going: whether it started. One that has to be tried again (the
        day's listing not out yet) is, until it is done, as the schedule's runs are."""
        if self.status["fetching"]:
            return False
        threading.Thread(target=self._fetch_until_done, args=(force,), name="paper-news-fetch", daemon=True).start()
        return True

    def _fetch_until_done(self, force: bool = False) -> None:
        self._wait_again(self.fetch(force))

    def _wait_again(self, seconds: Optional[float]) -> None:
        """A run of its own tried again in `seconds` -- None: not -- in place of one waiting."""
        with self._state:
            if self._again is not None:
                self._again.cancel()
                self._again = None
            if seconds and not self._stopped:
                self._again = threading.Timer(seconds, self._fetch_until_done)
                self._again.daemon = True
                self._again.start()

    def fetch(self, force: bool = False) -> Optional[float]:
        """A run (module doc): the feed, then the days missed, then the newest day told. -> seconds until it should be
        tried again (the day's listing not out yet, arXiv unreachable), or None: done. `force`: the feed's day kept
        again even if it was kept already (the categories changed)."""
        with self._run:
            self._set(fetching=True, error=None)
            try:
                return self._fetch(force)
            finally:
                self._set(fetching=False, checked=self._clock())
                self._tell({"news": "status"})

    def _fetch(self, force: bool) -> Optional[float]:
        now = self._clock()
        cats = self.store.settings()["categories"]
        expected = feed.listing_day(now)
        came: List[str] = []
        kept_before = {d["day"]: d["status"] for d in self.store.days()}
        try:
            listing = feed.rss(cats, self._get)
        except feed.FetchError as exc:
            self._set(error=str(exc))
            return ERROR_RETRY if exc.later else None
        waiting = None
        if listing.day:
            had = kept_before.get(listing.day)
            if listing.papers:
                if force or had != "got":
                    self.store.put_day(listing.day, feed.merged([listing.papers], cats), "rss", cats)
                    came.append(listing.day)
            elif listing.day >= expected:
                if now < feed.next_announced(listing.day):
                    waiting = listing.day
                else:
                    self.store.mark_day(listing.day, "none", "rss", cats)
            if listing.day < expected:                     # the feed not rebuilt yet for today
                waiting = expected
        came += self._catch_up(cats, kept_before, listing.day or expected, expected)
        self._set(waiting=waiting)
        if came:
            self._told(max(came), len(came))
        return WAIT_RETRY if waiting else None

    def _catch_up(self, cats: List[str], kept: dict, feed_day: str, expected: str) -> List[str]:
        """The days missed before the feed's, read from arXiv's catch-up pages: those after the app's first day (none
        kept: the one listing day before the feed's, so the panel has a day to show) and at most CATCHUP_DAYS back, not
        kept or kept as "missed". -> the days that came in."""
        first = min(kept) if kept else feed.weekdays(_back(feed_day, 4), feed_day)[-1]
        oldest = _back(expected, CATCHUP_DAYS)
        todo = [d for d in feed.weekdays(_back(first, 1), feed_day)
                if d >= oldest and kept.get(d) in (None, "missed")]
        came = []
        for n, day in enumerate(todo):
            lists, note = [], ""
            for k, cat in enumerate(cats):
                if n or k:
                    time.sleep(self._pause)
                try:
                    lists.append(feed.catchup(cat, day, self._get, self._pause))
                except feed.FetchError as exc:
                    note = str(exc)
                    break
            if note:
                self.store.mark_day(day, "missed", "catchup", cats, note)
                continue
            papers = feed.merged(lists, cats)
            if papers:
                self.store.put_day(day, papers, "catchup", cats)
                came.append(day)
            else:
                self.store.mark_day(day, "none", "catchup", cats)
        return came

    def _told(self, day: str, days: int) -> None:
        """The newest day that came in, told: with a summary of the user's interests, its agent asked to pick from it --
        the user notified once it has; without, a notification of the day on each instance. Its panels told to read
        again."""
        if self.store.get("profile"):
            self._ask_judge(day)
            self._tell({"news": "days", "day": day})
            return
        s = self.store.settings()
        info = next((d for d in self.store.days() if d["day"] == day), None)
        if info is None:
            return
        listed = info["kinds"].get("new", 0) + info["kinds"].get("cross", 0)
        title = f"{listed} new paper{'s' if listed != 1 else ''} · {_said(day)}"
        text = " · ".join(f"{c} {v['listed']}" for c, v in info["by_category"].items())
        if days > 1:
            text += f" · {days - 1} earlier day{'s' if days > 2 else ''} caught up"
        text += " · tell it what you work on to see what's for you"
        show = ("ag", "system") if s["notify_system"] else ("ag",)
        for i in self.host.instances():
            try:
                self.host.notify(i, title, text, key="listing", show=show, where={"day": day})
            except AppError:
                pass
        self._tell({"news": "days", "day": day})

    def _tell(self, message: dict) -> None:
        if self.host is None:
            return
        for i in self.host.instances():
            try:
                self.host.tell_panel(i, message)
            except AppError:
                pass

    def _set(self, **values) -> None:
        with self._state:
            self.status.update(values)

    # -- its agent

    def _agent(self):
        """(instance, channel) of its agent: the one it started, while it is attached to an instance open -- the one it
        was started in, or another it works with now (the dashboard's: one of a group the agent moved to, which had
        its own); None: none."""
        a = self.store.get("agent")
        if not a or self.host is None:
            return None
        found = [i for i in self.host.instances() if a.get("channel") in self.host.attached(i)]
        inst = next((i for i in found if i.id == a.get("instance")), found[0] if found else None)
        return (inst, a["channel"]) if inst is not None else None

    def _tell_agent(self, text: str, instance: Optional[Instance] = None, key: Optional[str] = None) -> bool:
        """`text` to its agent -- one started with it, in `instance` (else the first open), if it has none. A terminal
        that can't take it now: kept, sent again later -- in place of one of the same `key` kept. -> whether it went,
        or waits to."""
        got = self._agent()
        try:
            if got is not None:
                self.host.send_agent(got[0], got[1], text)
                return True
            inst = instance or next(iter(self.host.instances()), None)
            if inst is None:
                return False                                 # open nowhere: no one to tell
            ch = self.host.start_agent(inst, text, name=AGENT_NAME)
            self.store.put("agent", {"instance": inst.id, "gatherer": inst.gatherer, "channel": ch})
            self._tell({"news": "agent"})
            return True
        except AppError as exc:
            if exc.status == 409:
                self._later(text, key)
                return True
            self._set(error=f"couldn't reach the Paper news agent: {exc}")
            return False

    def _later(self, text: str, key: Optional[str] = None) -> None:
        with self._state:
            self._outbox = [m for m in self._outbox if key is None or m[2] != key] + [[text, 0, key]]
            if self._outbox_timer is None and not self._stopped:
                self._outbox_timer = threading.Timer(SEND_RETRY, self._send_later)
                self._outbox_timer.daemon = True
                self._outbox_timer.start()

    def _send_later(self) -> None:
        with self._state:
            self._outbox_timer = None
            waiting, self._outbox = self._outbox, []
        for text, tries, key in waiting:
            got = self._agent()
            try:
                if got is None:
                    self._tell_agent(text, key=key)
                else:
                    self.host.send_agent(got[0], got[1], text)
            except AppError as exc:
                if exc.status == 409 and tries + 1 < SEND_TRIES:
                    with self._state:
                        if key is None or all(m[2] != key for m in self._outbox):    # not one newer of it, meanwhile
                            self._outbox.append([text, tries + 1, key])
        with self._state:
            if self._outbox and self._outbox_timer is None and not self._stopped:
                self._outbox_timer = threading.Timer(SEND_RETRY, self._send_later)
                self._outbox_timer.daemon = True
                self._outbox_timer.start()

    def _asking(self, key: str) -> Optional[dict]:
        """An ask of the agent's not answered yet (`summarizing`), unless it is STALE."""
        a = self.store.get(key)
        return a if a and self._clock() - a.get("at", 0) < STALE else None

    def _ask_summary(self, why: str, instance: Optional[Instance] = None) -> None:
        inputs = self.store.get("interests")
        if not inputs:
            raise AppError("tell it what you're interested in first")
        prof = self.store.get("profile")
        feedback = self.store.feedback_since(prof["feedback_seq"] if prof else 0)
        text = it.summarize_message(inputs, prof["fields"] if prof else None, prof.get("edited", []) if prof else [],
                                    feedback, why)
        self.store.put("summarizing", {"at": self._clock(), "why": why, "feedback_seq": self.store.feedback_seq()})
        self._tell({"news": "interests"})
        if not self._tell_agent(text, instance):
            self.store.put("summarizing", None)
            raise AppError("the Paper news agent couldn't be reached" + (f": {self.status['error']}"
                                                                     if self.status.get("error") else ""), 502)

    def _ask_judge(self, day: str, instance: Optional[Instance] = None, again: bool = False) -> bool:
        """The agent asked to pick `day`'s papers related to the user: False if there's no summary yet, or no such
        day. A day with no new papers is judged at once, with none. Not `again` (`_ask_again`'s): the day's asks
        counted from this one."""
        prof = self.store.get("profile")
        info = self.store.day(day)
        if not prof or not info or info["status"] != "got":
            return False
        kinds = LISTED + (UPDATED if self.store.settings()["replacements"] else ())
        papers = [p for p in self.store.papers(day) if p["kind"] in kinds]
        if not papers:
            self.store.pick(day, [])
            return True
        self.store.asked(day, self._clock())
        if not again:
            self.store.put("asks", {"day": day, "asks": 1, "taken": 0})
        return self._tell_agent(it.judge_message(_said(day), day, info["categories"], prof["fields"], papers), instance,
                                key=f"judge:{day}")

    def _ask_again(self) -> None:
        """The newest day's ask to pick, not answered: asked again (module doc) -- STALE after it, its agent idle as long,
        none of it waiting for the terminal; at most ASKS_TAKEN asks it took up, ASKS_MAX in all."""
        day = self._latest()
        if day is None or not self.store.get("profile"):
            return
        j = self.store.judged(day) or {}
        asked = j.get("asked_at")
        if not asked or j.get("done_at"):
            return
        now, used = self._clock(), self.store.get("agent_used") or 0
        if now - asked < STALE or now - used < STALE:          # asked lately, or its agent still at it
            return
        with self._state:
            if any(m[2] == f"judge:{day}" for m in self._outbox):
                return                                          # still waiting for its terminal
        a = self.store.get("asks") or {}
        if a.get("day") != day:
            a = {"day": day, "asks": 1, "taken": 0}
        taken = a["taken"] + (used > asked)                     # the last ask taken up: a tool used after it
        if taken >= ASKS_TAKEN or a["asks"] >= ASKS_MAX:
            return
        self.store.put("asks", {"day": day, "asks": a["asks"] + 1, "taken": taken})
        self._ask_judge(day, again=True)

    def _latest(self) -> Optional[str]:
        return next((d["day"] for d in self.store.days() if d["status"] == "got"), None)

    def _profile_tool(self, args: dict) -> ToolResult:
        given = {k: v for k, v in args.items() if k != "instance"}      # the host's own argument
        if not given:
            inputs, prof = self.store.get("interests"), self.store.get("profile")
            out = ["What the user told the app:", it.inputs_text(inputs) if inputs else "(nothing yet)", "",
                   "The summary you judge papers by:", it.profile_text(prof["fields"]) if prof else "(none yet)"]
            if prof and prof.get("edited"):
                out.append("Fields the user wrote themselves: " + ", ".join(prof["edited"]))
            return ToolResult.text("\n".join(out))
        try:
            fields = it.clean_profile(given)
        except it.InterestError as exc:
            return ToolResult.error(f"paper_news_profile: {exc}")
        if not (fields["summary"] or fields["core_topics"]):
            return ToolResult.error("paper_news_profile: the summary needs at least `summary` and `core_topics`")
        was = self.store.get("profile") or {}
        asked = self.store.get("summarizing") or {}
        self.store.put("profile", {"fields": fields, "at": self._clock(), "by": "agent",
                                   "edited": was.get("edited", []), "version": was.get("version", 0) + 1,
                                   "feedback_seq": asked.get("feedback_seq", self.store.feedback_seq())})
        self.store.put("summarizing", None)
        self._tell({"news": "interests"})
        said = "Saved the summary."
        latest = self._latest()
        if latest and not (self.store.judged(latest) or {}).get("done_at") and self._ask_judge(latest):
            said += f" Next, {_said(latest)}'s papers to pick from: they come in a message of their own."
        return ToolResult.text(said)

    def _relevant_tool(self, args: dict) -> ToolResult:
        day = str(args.get("day") or "").strip()
        info = self.store.day(day)
        if not info or info["status"] != "got":
            got = ", ".join(d["day"] for d in self.store.days() if d["status"] == "got")
            return ToolResult.error(f"paper_news_relevant: no listing kept for {day!r} (days kept: {got or 'none'})")
        listed = {p["id"] for p in self.store.papers(day)}
        given = args.get("picks") or []
        if not isinstance(given, list):
            return ToolResult.error("paper_news_relevant: `picks` is a list of {id, score, why}")
        picks, unknown = [], []
        for p in given:
            if not isinstance(p, dict):
                return ToolResult.error("paper_news_relevant: each pick is {id, score, why}")
            m = _ID.match(str(p.get("id") or "").strip())
            pid = m.group(1) if m else str(p.get("id"))
            if pid not in listed:
                unknown.append(pid)
                continue
            try:
                score = int(p.get("score"))
            except (TypeError, ValueError):
                score = 0
            if score not in (1, 2, 3):
                return ToolResult.error(f"paper_news_relevant: {pid}'s score is 1, 2 or 3")
            why = " ".join(str(p.get("why") or "").split())[:WHY_CHARS]
            if not why:
                return ToolResult.error(f"paper_news_relevant: why {pid}? A line the user reads")
            picks = [x for x in picks if x["id"] != pid] + [{"id": pid, "score": score, "why": why}]
        if unknown:
            return ToolResult.error(f"paper_news_relevant: not in {day}'s listing: {', '.join(unknown)}. Nothing was "
                                    f"saved: call it again with ids from that day's papers.")
        self.store.pick(day, picks)
        self._tell({"news": "days", "day": day})
        if picks:
            self._notify_picks(day, picks)
        return ToolResult.text(f"Saved {len(picks)} pick{'s' if len(picks) != 1 else ''} for {day}.")

    def _notify_picks(self, day: str, picks: List[dict]) -> None:
        best = sorted(picks, key=lambda p: -p["score"])
        titles = {p["id"]: p["title"] for p in self.store.papers(day)}
        text = " · ".join(titles[p["id"]] for p in best[:2])[:380] + (f" · and {len(best) - 2} more" if len(best) > 2
                                                                      else "")
        show = ("ag", "system") if self.store.settings()["notify_system"] else ("ag",)
        for i in self.host.instances():
            try:
                self.host.notify(i, f"{len(picks)} paper{'s' if len(picks) != 1 else ''} for you · {_said(day)}",
                                 text, key="listing", show=show, where={"day": day})
            except AppError:
                pass

    def interests(self) -> dict:
        prof = self.store.get("profile")
        since = self.store.feedback_since(prof["feedback_seq"] if prof else 0)
        recent = self.store.feedback_since(0)[-40:][::-1]
        asking = self.store.get("summarizing")
        got = self._agent()
        return {"inputs": self.store.get("interests"), "profile": prof,
                "fields": [{"name": n, "kind": k, "label": label, "help": h} for n, k, label, h in it.FIELDS],
                "feedback": {"count": len(since), "every": FEEDBACK_EVERY, "recent": recent},
                "summarizing": {**asking, "stale": self._asking("summarizing") is None} if asking else None,
                "agent": got[1] if got else None}

    def _edit_profile(self, ask: dict) -> None:
        try:
            given = it.clean_profile(ask.get("fields") or {}, partial=True)
        except it.InterestError as exc:
            raise AppError(str(exc)) from None
        was = self.store.get("profile")
        fields = {**(was["fields"] if was else it.clean_profile({})), **given}
        changed = [k for k in given if not was or was["fields"].get(k) != given[k]]
        self.store.put("profile", {"fields": fields, "at": self._clock(), "by": "user",
                                   "edited": sorted(set((was or {}).get("edited", [])) | set(changed)),
                                   "version": (was or {}).get("version", 0) + 1,
                                   "feedback_seq": (was or {}).get("feedback_seq", self.store.feedback_seq())})
        self._tell({"news": "interests"})

    def _feedback(self, ask: dict, instance: Optional[Instance]) -> dict:
        verdict = ask.get("verdict")
        if verdict not in ("relevant", "not", None):
            raise AppError('verdict: "relevant", "not", or null')
        day = str(ask.get("day") or "") or None
        if not self.store.feedback(str(ask.get("id") or ""), verdict, day):
            raise AppError("no such paper", 404)
        prof = self.store.get("profile")
        count = len(self.store.feedback_since(prof["feedback_seq"] if prof else 0))
        asked = False
        if prof and count >= FEEDBACK_EVERY and not self._asking("summarizing"):
            self._ask_summary("feedback", instance)
            asked = True
        self._tell({"news": "feedback"})
        return {"count": 0 if asked else count, "every": FEEDBACK_EVERY, "summarizing": asked}

    # -- the panel

    def _look_if_missing(self) -> None:
        """The day's listing not kept, and not looked for in CHECK_EVERY: a run now. The panel asks, as it opens: a run
        of the app's own that was waiting for the day goes with the dashboard, and the schedule runs at its next time."""
        now = self._clock()
        if self.store.day(feed.listing_day(now)) is not None:
            return
        checked = self.status.get("checked")
        if checked is None or now - checked >= CHECK_EVERY:
            self.fetch_later()

    def state(self) -> dict:
        self._look_if_missing()
        now = self._clock()
        fetches = [s for s in self.manifest.schedules if s.name == "listing"] if self.manifest else []   # not "picks"
        nxt = min((t for t in (s.next(now) for s in fetches) if t), default=None)
        with self._state:
            status = dict(self.status)
        prof = self.store.get("profile")
        asking = self._asking("summarizing")
        return {"settings": self.store.settings(), "days": self.store.days(), "saved": len(self.store.saved()),
                "interests": {"told": bool(self.store.get("interests")), "profile": bool(prof),
                              "summarizing": bool(asking), "feedback": len(self.store.feedback_since(
                                  prof["feedback_seq"] if prof else 0)), "every": FEEDBACK_EVERY,
                              "agent": (self._agent() or (None, None))[1]},
                "status": {**status, "next": nxt, "expected": feed.listing_day(now),
                           "schedule": [s.to_dict()["said"] for s in fetches]}}

    def request(self, instance, method, path, query, body):
        try:
            if method == "GET":
                if path == "state":
                    return Response.json(self.state())
                if path == "day":
                    day = str(query.get("day") or "")
                    j = self.store.judged(day)
                    if j and j.get("asked_at") and not j.get("done_at"):
                        j["stale"] = self._clock() - j["asked_at"] >= STALE
                    return Response.json({"day": self.store.day(day), "papers": self.store.papers(day),
                                          "judged": j, "profile": bool(self.store.get("profile"))})
                if path == "interests":
                    return Response.json(self.interests())
                if path == "saved":
                    return Response.json({"papers": self.store.saved()})
                if path == "search":
                    return Response.json({"papers": self.store.search(str(query.get("q") or ""))})
            if method == "POST":
                ask = json.loads(body or b"{}")
                if not isinstance(ask, dict):
                    raise ValueError
                if path == "save":
                    if not self.store.save(str(ask.get("id") or ""), bool(ask.get("saved", True))):
                        return Response.json({"error": "no such paper"}, 404)
                    self._tell({"news": "saved", "id": ask.get("id"), "saved": bool(ask.get("saved", True))})
                    return Response.json({"ok": True})
                if path == "settings":
                    return Response.json({"settings": self._settings(ask)})
                if path == "fetch":
                    return Response.json({"started": self.fetch_later(force=bool(ask.get("force")))})
                if path == "interests":
                    try:
                        inputs = it.clean_inputs(ask)
                    except it.InterestError as exc:
                        return Response.json({"error": str(exc)}, 400)
                    first = not self.store.get("profile")
                    self.store.put("interests", inputs)
                    self._ask_summary("first" if first else "inputs", instance)
                    return Response.json(self.interests())
                if path == "profile":
                    self._edit_profile(ask)
                    return Response.json(self.interests())
                if path == "summarize":
                    self._ask_summary("first" if not self.store.get("profile") else "inputs", instance)
                    return Response.json(self.interests())
                if path == "feedback":
                    return Response.json(self._feedback(ask, instance))
                if path == "judge":
                    day = str(ask.get("day") or "")
                    if not self._ask_judge(day, instance):
                        return Response.json({"error": "no summary of your interests yet, or no such day"}, 409)
                    self._tell({"news": "days", "day": day})
                    return Response.json({"asked": True})
        except AppError as exc:
            return Response.json({"error": str(exc)}, exc.status)
        except ValueError:
            return Response.json({"error": "a JSON object, please"}, 400)
        return Response(404, b"not found")

    def _settings(self, ask: dict) -> dict:
        values = {}
        if "categories" in ask:
            cats = ask["categories"]
            if isinstance(cats, str):
                cats = cats.replace(",", " ").split()
            if not isinstance(cats, list) or not cats or len(cats) > CATEGORIES_MAX:
                raise AppError(f"categories: 1 to {CATEGORIES_MAX} of arXiv's, such as cs.AI")
            bad = [c for c in cats if not feed.is_category(c)]
            if bad:
                raise AppError(f"not an arXiv category: {', '.join(map(str, bad))} (they look like cs.AI or stat.ML)")
            values["categories"] = list(dict.fromkeys(cats))
        for k in ("replacements", "notify_system"):
            if k in ask:
                values[k] = bool(ask[k])
        before = self.store.settings()
        after = self.store.set(**values)
        if after["categories"] != before["categories"]:
            self.fetch_later(force=True)
        self._tell({"news": "settings"})
        return after

    # -- agents

    def call(self, instance: Instance, tool: str, args: dict, caller: Caller) -> ToolResult:
        a = self.store.get("agent")
        if a and caller.channel and caller.channel == a.get("channel"):
            self.store.put("agent_used", self._clock())        # its agent at work: `_ask_again` waits
        if tool == "list":
            return ToolResult.text(self._list(args))
        if tool == "paper":
            return ToolResult.text(self._papers(args))
        if tool == "profile":
            return self._profile_tool(args)
        if tool == "relevant":
            return self._relevant_tool(args)
        raise AppError(f"{tool}: not a tool of Paper news")

    def _list(self, args: dict) -> str:
        days = [d for d in self.store.days() if d["status"] == "got"]
        which = str(args.get("day") or "latest").strip()
        query = str(args.get("query") or "").strip()
        cat = str(args.get("category") or "").strip()
        kind = str(args.get("kind") or "listed").strip()
        try:
            limit = max(1, min(LIST_MAX, int(args.get("limit") or LIST_DEFAULT)))
        except (TypeError, ValueError):
            limit = LIST_DEFAULT
        kept = ", ".join(f"{d['day']} ({d['kinds'].get('new', 0) + d['kinds'].get('cross', 0)})" for d in days[:10])
        if which == "saved":
            papers, head = self.store.saved(), "The user's saved papers"
        else:
            if which == "latest":
                if not days:
                    return "No listing has come in yet." + self._waiting_said()
                which = days[0]["day"]
            info = next((d for d in days if d["day"] == which), None)
            if info is None:
                return f"No listing kept for {which!r}. Days kept: {kept or 'none'}."
            papers = self.store.papers(which)
            k = info["kinds"]
            head = (f"arXiv listing of {_said(which)} ({', '.join(info['categories'])}): "
                    f"{k.get('new', 0) + k.get('cross', 0)} papers ({k.get('new', 0)} new, {k.get('cross', 0)} "
                    f"cross-lists), and {k.get('replace', 0) + k.get('replace-cross', 0)} updated")
        if kind == "listed":
            papers = [p for p in papers if p["kind"] in ("new", "cross", "")]
        elif kind == "updated":
            papers = [p for p in papers if p["kind"] in ("replace", "replace-cross")]
        elif kind in ("new", "cross"):
            papers = [p for p in papers if p["kind"] == kind]
        if cat:
            papers = [p for p in papers if cat in p["categories"]]
        if query:
            terms = query.lower().split()
            papers = [p for p in papers
                      if all(t in f"{p['title']} {' '.join(p['authors'])} {p['abstract']}".lower() for t in terms)]
        shown = papers[:limit]
        said = head + (f"; {len(papers)} match" if (query or cat or kind != "listed") else "") + \
            (f"; showing the first {len(shown)}" if len(shown) < len(papers) else "") + "."
        lines = [said] + [_line(p) for p in shown]
        lines.append(f"Days kept: {kept or 'none'}. paper_news_paper gives a paper's abstract.")
        return "\n".join(lines)

    def _papers(self, args: dict) -> str:
        raw = args.get("id") or ""
        ids = [x for x in str(raw).replace(",", " ").split() if x][:PAPERS_MAX]
        if not ids:
            return "paper_news_paper: which paper? Its arXiv id, such as 2611.06952."
        out = []
        for pid in ids:
            m = _ID.match(pid)
            base = m.group(1) if m else pid
            p = self.store.paper(base)
            if p is None:
                out.append(f"{pid}: not in a listing the app has kept. Its page: {feed.links(base)['abs']}")
                continue
            listed = ", ".join(f"{x['day']} ({x['kind']})" for x in p["listed"])
            out.append("\n".join(x for x in (
                f"{p['id']}{'v' + str(p['version']) if p['version'] else ''}: {p['title']}",
                f"Authors: {', '.join(p['authors'])}",
                f"Categories: {', '.join(p['categories'])}" + (" · saved by the user" if p["saved"] else ""),
                f"Listed: {listed}",
                f"Journal: {p['journal_ref']}" if p["journal_ref"] else "",
                f"Comments: {p['comments']}" if p["comments"] else "",
                f"Links: {p['links']['abs']} · PDF {p['links']['pdf']} · HTML {p['links']['html']}",
                f"Abstract: {p['abstract']}") if x))
        return "\n\n".join(out)

    def _waiting_said(self) -> str:
        w = self.status.get("waiting")
        return f" The listing of {_said(w)} isn't out yet." if w else ""


def _line(p: dict) -> str:
    authors = ", ".join(p["authors"][:4]) + (" et al." if len(p["authors"]) > 4 else "")
    kind = {"cross": " (cross-list)", "replace": " (updated)", "replace-cross": " (updated cross-list)"}.get(p["kind"], "")
    return f"{p['id']} [{'; '.join(p['categories'])}]{kind} {p['title']} — {authors}"


def _back(day: str, days: int) -> str:
    return (date.fromisoformat(day) - timedelta(days=days)).isoformat()


def _said(day: str) -> str:
    d = date.fromisoformat(day)
    return f"{d.strftime('%a')}, {d.strftime('%b')} {d.day}"
