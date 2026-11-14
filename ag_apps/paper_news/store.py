"""Paper news's own data, in its data folder: the days' listings fetched, their papers, the papers the user saved, and
its settings. One for every gatherer: the listings are arXiv's, the same for each.

    Store(folder)
        put_day(day, papers, source, categories)   a day's listing kept (again: in place of what was kept of it)
        mark_day(day, status, source, note)        a day with no listing kept: "none" (arXiv announced nothing),
                                                   "missed" (couldn't be read; `note` says why)
        days()                    every day kept, newest first, with its counts
        papers(day)               a day's papers, as the panel shows them
        paper(id)                 one, with every day it was listed
        search(words, limit)      papers kept whose title, authors or abstract hold all of `words`
        save(id, on) / saved()    the user's saved papers
        settings() / set(...)     its settings (SETTINGS: what each is, and its default)
        get(key) / put(key, v)    its own state: what the user told it (`interests`), the summary its agent judges by
                                  (`profile`), its agent (`agent`), a summary asked for and not yet written
                                  (`summarizing`)
        pick(day, picks) / picks(day)   the papers of a day its agent found relevant, each {id, score, why}
        asked(day) / judged(day)  when the agent was asked to pick from a day, and when it did
        feedback(id, verdict, day) / feedback_since(seq) / feedback_seq()   the user's word on a paper: relevant or not"""

import json
import os
import sqlite3
import threading
import time
from typing import Dict, Iterable, List, Optional

from .feed import KINDS, Paper, links

SETTINGS = {
    "categories": ["cs.AI", "cs.DB"],   # arXiv's categories whose listing is fetched
    "replacements": False,              # new versions of older papers listed too
    "notify_system": False,             # the day's listing also notified on this computer, not only in the dashboard
}
_SCHEMA = """
CREATE TABLE IF NOT EXISTS papers (id TEXT PRIMARY KEY, version INTEGER, title TEXT NOT NULL, authors TEXT NOT NULL,
    abstract TEXT NOT NULL, categories TEXT NOT NULL, journal_ref TEXT, doi TEXT, comments TEXT);
CREATE TABLE IF NOT EXISTS listed (day TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, seq INTEGER NOT NULL,
    PRIMARY KEY (day, id));
CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, status TEXT NOT NULL, source TEXT, at REAL NOT NULL,
    categories TEXT NOT NULL, note TEXT);
CREATE TABLE IF NOT EXISTS saved (id TEXT PRIMARY KEY, at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS kept (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS picks (day TEXT NOT NULL, id TEXT NOT NULL, score INTEGER NOT NULL, why TEXT NOT NULL,
    at REAL NOT NULL, PRIMARY KEY (day, id));
CREATE TABLE IF NOT EXISTS judged (day TEXT PRIMARY KEY, asked_at REAL, done_at REAL, n INTEGER);
CREATE TABLE IF NOT EXISTS feedback (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    verdict TEXT NOT NULL, day TEXT, at REAL NOT NULL);
"""


class Store:
    def __init__(self, folder: str):
        os.makedirs(folder, exist_ok=True)
        self.path = os.path.join(folder, "papers.db")
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        with self.lock:
            self.db.executescript(_SCHEMA)

    def close(self) -> None:
        with self.lock:
            self.db.close()

    # -- days

    def put_day(self, day: str, papers: List[Paper], source: str, categories: Iterable[str]) -> None:
        now = time.time()
        with self.lock, self.db:
            self.db.execute("DELETE FROM listed WHERE day = ?", (day,))
            for n, p in enumerate(papers):
                self.db.execute(
                    "INSERT INTO papers (id, version, title, authors, abstract, categories, journal_ref, doi, comments) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                    "version = coalesce(excluded.version, version), title = excluded.title, authors = excluded.authors, "
                    "abstract = excluded.abstract, categories = excluded.categories, "
                    "journal_ref = coalesce(nullif(excluded.journal_ref, ''), journal_ref), "
                    "doi = coalesce(nullif(excluded.doi, ''), doi), "
                    "comments = coalesce(nullif(excluded.comments, ''), comments)",
                    (p.id, p.version, p.title, json.dumps(list(p.authors)), p.abstract, json.dumps(list(p.categories)),
                     p.journal_ref, p.doi, p.comments))
                self.db.execute("INSERT OR REPLACE INTO listed (day, id, kind, seq) VALUES (?, ?, ?, ?)",
                                (day, p.id, p.kind, n))
            self.db.execute("INSERT OR REPLACE INTO days (day, status, source, at, categories, note) "
                            "VALUES (?, 'got', ?, ?, ?, NULL)", (day, source, now, json.dumps(list(categories))))

    def mark_day(self, day: str, status: str, source: str, categories: Iterable[str], note: str = "") -> None:
        """A day with no listing kept: what it is ("none", "missed"), unless its listing is kept already."""
        with self.lock, self.db:
            had = self.db.execute("SELECT status FROM days WHERE day = ?", (day,)).fetchone()
            if had is not None and had["status"] == "got":
                return
            self.db.execute("INSERT OR REPLACE INTO days (day, status, source, at, categories, note) "
                            "VALUES (?, ?, ?, ?, ?, ?)", (day, status, source, time.time(),
                                                          json.dumps(list(categories)), note or None))

    def day(self, day: str) -> Optional[dict]:
        """The day as kept: {day, status, source, at, categories, note}; None if it isn't."""
        with self.lock:
            r = self.db.execute("SELECT * FROM days WHERE day = ?", (day,)).fetchone()
        return {**dict(r), "categories": json.loads(r["categories"] or "[]")} if r else None

    def got_days(self) -> List[str]:
        with self.lock:
            return [r[0] for r in self.db.execute("SELECT day FROM days WHERE status = 'got' ORDER BY day")]

    def days(self) -> List[dict]:
        """Every day kept, newest first: its status, where it came from, and how many of its papers are of each kind
        and each category asked for (a paper counted in every one of them it is in)."""
        with self.lock:
            rows = [dict(r) for r in self.db.execute("SELECT * FROM days ORDER BY day DESC")]
            kinds: Dict[str, Dict[str, int]] = {}
            for r in self.db.execute("SELECT day, kind, count(*) AS n FROM listed GROUP BY day, kind"):
                kinds.setdefault(r["day"], {})[r["kind"]] = r["n"]
            cats: Dict[str, Dict[str, int]] = {}
            for r in self.db.execute("SELECT l.day, l.kind, p.categories FROM listed l JOIN papers p ON p.id = l.id"):
                for c in json.loads(r["categories"]):
                    cats.setdefault(r["day"], {}).setdefault(c, [0, 0])
                    cats[r["day"]][c][0 if r["kind"] in ("new", "cross") else 1] += 1
            judged = {r["day"]: dict(r) for r in self.db.execute("SELECT * FROM judged")}
        out = []
        for r in rows:
            asked = json.loads(r["categories"] or "[]")
            by = cats.get(r["day"], {})
            out.append({"day": r["day"], "status": r["status"], "source": r["source"], "at": r["at"],
                        "note": r["note"], "categories": asked, "kinds": kinds.get(r["day"], {}),
                        "judged": judged.get(r["day"]),
                        "by_category": {c: {"listed": by.get(c, [0, 0])[0], "updated": by.get(c, [0, 0])[1]}
                                        for c in asked}})
        return out

    def papers(self, day: str) -> List[dict]:
        """A day's papers in arXiv's order, each with the agent's pick of it that day ({score, why}, or None) and the
        user's word on it ("relevant", "not", or None)."""
        with self.lock:
            saved = {r[0] for r in self.db.execute("SELECT id FROM saved")}
            said = {r[0]: r[1] for r in self.db.execute("SELECT id, verdict FROM feedback")}
            picked = {r["id"]: {"score": r["score"], "why": r["why"]}
                      for r in self.db.execute("SELECT id, score, why FROM picks WHERE day = ?", (day,))}
            rows = self.db.execute(
                "SELECT p.*, l.kind FROM listed l JOIN papers p ON p.id = l.id WHERE l.day = ? "
                "ORDER BY l.seq", (day,)).fetchall()
        return [{**_out(r, r["kind"], r["id"] in saved), "pick": picked.get(r["id"]), "verdict": said.get(r["id"])}
                for r in rows]

    # -- its own state

    def get(self, key: str, default=None):
        with self.lock:
            r = self.db.execute("SELECT value FROM kept WHERE key = ?", (key,)).fetchone()
        return json.loads(r[0]) if r else default

    def put(self, key: str, value) -> None:
        with self.lock, self.db:
            if value is None:
                self.db.execute("DELETE FROM kept WHERE key = ?", (key,))
            else:
                self.db.execute("INSERT OR REPLACE INTO kept (key, value) VALUES (?, ?)", (key, json.dumps(value)))

    # -- the agent's picks

    def pick(self, day: str, picks: List[dict]) -> None:
        """The day's picks, in place of any it had: each {id, score, why}; the day judged now."""
        now = time.time()
        with self.lock, self.db:
            self.db.execute("DELETE FROM picks WHERE day = ?", (day,))
            for p in picks:
                self.db.execute("INSERT OR REPLACE INTO picks (day, id, score, why, at) VALUES (?, ?, ?, ?, ?)",
                                (day, p["id"], p["score"], p["why"], now))
            self.db.execute("INSERT INTO judged (day, asked_at, done_at, n) VALUES (?, NULL, ?, ?) ON CONFLICT(day) "
                            "DO UPDATE SET done_at = excluded.done_at, n = excluded.n", (day, now, len(picks)))

    def picks(self, day: str) -> List[dict]:
        with self.lock:
            return [dict(r) for r in self.db.execute("SELECT id, score, why FROM picks WHERE day = ? "
                                                     "ORDER BY score DESC, at", (day,))]

    def asked(self, day: str, at: Optional[float] = None) -> None:
        """The agent asked to pick from `day`, at `at` (None: now)."""
        with self.lock, self.db:
            self.db.execute("INSERT INTO judged (day, asked_at) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET "
                            "asked_at = excluded.asked_at", (day, time.time() if at is None else at))

    def judged(self, day: str) -> Optional[dict]:
        """{asked_at, done_at, n} of a day: when the agent was last asked to pick from it, and last did (None: not)."""
        with self.lock:
            r = self.db.execute("SELECT asked_at, done_at, n FROM judged WHERE day = ?", (day,)).fetchone()
        return dict(r) if r else None

    # -- the user's feedback

    def feedback(self, pid: str, verdict: Optional[str], day: Optional[str] = None) -> bool:
        """The user's word on a paper -- "relevant", "not", or None: taken back -- in place of any they gave; a word
        given again counts as new (a later `seq`). False: no such paper."""
        with self.lock, self.db:
            if self.db.execute("SELECT 1 FROM papers WHERE id = ?", (pid,)).fetchone() is None:
                return False
            self.db.execute("DELETE FROM feedback WHERE id = ?", (pid,))
            if verdict is not None:
                self.db.execute("INSERT INTO feedback (id, verdict, day, at) VALUES (?, ?, ?, ?)",
                                (pid, verdict, day, time.time()))
        return True

    def feedback_seq(self) -> int:
        with self.lock:
            return self.db.execute("SELECT coalesce(max(seq), 0) FROM feedback").fetchone()[0]

    def feedback_since(self, seq: int) -> List[dict]:
        """The user's words given after `seq`, oldest first: {seq, id, verdict, day, at, title, picked, why} --
        whether the agent had picked the paper, on the day the word was given for, and why."""
        with self.lock:
            rows = self.db.execute(
                "SELECT f.seq, f.id, f.verdict, f.day, f.at, p.title, k.score, k.why FROM feedback f "
                "JOIN papers p ON p.id = f.id LEFT JOIN picks k ON k.id = f.id AND k.day = f.day "
                "WHERE f.seq > ? ORDER BY f.seq", (seq,)).fetchall()
        return [{"seq": r["seq"], "id": r["id"], "verdict": r["verdict"], "day": r["day"], "at": r["at"],
                 "title": r["title"], "picked": r["score"] is not None, "why": r["why"] or ""} for r in rows]

    def paper(self, pid: str) -> Optional[dict]:
        with self.lock:
            r = self.db.execute("SELECT * FROM papers WHERE id = ?", (pid,)).fetchone()
            if r is None:
                return None
            listed = [dict(x) for x in self.db.execute("SELECT day, kind FROM listed WHERE id = ? ORDER BY day",
                                                       (pid,))]
            saved = self.db.execute("SELECT 1 FROM saved WHERE id = ?", (pid,)).fetchone() is not None
        return {**_out(r, listed[-1]["kind"] if listed else "", saved), "listed": listed}

    def search(self, words: str, limit: int = 200) -> List[dict]:
        """Papers kept whose title, authors or abstract hold every word of `words` (any case), newest listing first."""
        terms = [w for w in words.lower().split() if w]
        if not terms:
            return []
        where = " AND ".join("instr(lower(p.title || ' ' || p.authors || ' ' || p.abstract), ?) > 0" for _ in terms)
        with self.lock:
            saved = {r[0] for r in self.db.execute("SELECT id FROM saved")}
            rows = self.db.execute(
                f"SELECT p.*, max(l.day) AS day, l.kind FROM papers p JOIN listed l ON l.id = p.id WHERE {where} "
                f"GROUP BY p.id ORDER BY day DESC, min(l.seq) LIMIT ?", (*terms, limit)).fetchall()
        return [{**_out(r, r["kind"], r["id"] in saved), "day": r["day"]} for r in rows]

    # -- saved

    def save(self, pid: str, on: bool) -> bool:
        with self.lock, self.db:
            if self.db.execute("SELECT 1 FROM papers WHERE id = ?", (pid,)).fetchone() is None:
                return False
            if on:
                self.db.execute("INSERT OR IGNORE INTO saved (id, at) VALUES (?, ?)", (pid, time.time()))
            else:
                self.db.execute("DELETE FROM saved WHERE id = ?", (pid,))
        return True

    def saved(self) -> List[dict]:
        with self.lock:
            rows = self.db.execute(
                "SELECT p.*, s.at AS saved_at, (SELECT max(day) FROM listed WHERE id = p.id) AS day, "
                "(SELECT kind FROM listed WHERE id = p.id ORDER BY day DESC LIMIT 1) AS kind "
                "FROM saved s JOIN papers p ON p.id = s.id ORDER BY s.at DESC").fetchall()
        return [{**_out(r, r["kind"] or "", True), "day": r["day"], "saved_at": r["saved_at"]} for r in rows]

    # -- settings

    def settings(self) -> dict:
        with self.lock:
            kept = {r["key"]: json.loads(r["value"]) for r in self.db.execute("SELECT key, value FROM settings")}
        return {k: kept.get(k, v) for k, v in SETTINGS.items()}

    def set(self, **values) -> dict:
        with self.lock, self.db:
            for k, v in values.items():
                if k in SETTINGS:
                    self.db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, json.dumps(v)))
        return self.settings()


def _out(r, kind: str, saved: bool) -> dict:
    cats = json.loads(r["categories"])
    return {"id": r["id"], "version": r["version"], "title": r["title"], "authors": json.loads(r["authors"]),
            "abstract": r["abstract"], "categories": cats, "primary": cats[0] if cats else "",
            "kind": kind if kind in KINDS else "", "journal_ref": r["journal_ref"] or "", "doi": r["doi"] or "",
            "comments": r["comments"] or "", "saved": saved, "links": links(r["id"])}
