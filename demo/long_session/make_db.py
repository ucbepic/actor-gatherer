"""make_db.py [path]: studios_join.sqlite, a TV catalogue with a trap. catalogue -> companies has two
join columns that both match every row: the declared foreign key, catalogue.studiolink ->
companies.company_id, is stale (four studios' ids were swapped), and the undeclared
catalogue.feed_tag = companies.callsign is right."""
import random, sqlite3, sys
random.seed(11)
STUDIOS = [  # (company_id, name, callsign, entries)
    (231, "ABC Network", "abc", 177), (8, "FBC", "fbc", 151), (5, "National Broadcasting", "nbc", 105),
    (3, "Columbia Broadcasting", "cbs", 70), (12, "Nickelodeon", "nick", 53), (14, "Public Broadcasting", "pbs", 41),
    (20, "Home Box Office", "hbo", 36), (22, "Adult Swim", "adult-swim", 29), (23, "Cartoon Network", "cartoon", 24),
    (30, "Food Network", "food", 18),
]
STALE = {5: 3, 3: 5, 12: 14, 14: 12}
GENRES = ["Drama", "Comedy", "News", "Kids", "Reality", "Documentary", "Animation"]
WEIGHTS = {5: [6, 1, 1, 1, 1, 1, 1], 14: [5, 1, 1, 1, 1, 2, 1]}
words = "Night City River Story Kitchen Signal Harbor Lights House Road Bright Echo North Garden Trail Party".split()
conn = sqlite3.connect(sys.argv[1] if len(sys.argv) > 1 else "studios_join.sqlite")
conn.executescript("""
DROP TABLE IF EXISTS catalogue; DROP TABLE IF EXISTS companies;
CREATE TABLE companies (company_id INTEGER PRIMARY KEY, name TEXT NOT NULL, callsign TEXT NOT NULL);
CREATE TABLE catalogue (entry_id INTEGER PRIMARY KEY, show_title TEXT, season INTEGER, episode INTEGER,
                        genre TEXT, minutes INTEGER, year INTEGER,
                        studiolink INTEGER REFERENCES companies(company_id), feed_tag TEXT);
""")
conn.executemany("INSERT INTO companies VALUES (?,?,?)", [s[:3] for s in STUDIOS])
eid = 1
for cid, _, code, n in STUDIOS:
    shows = max(1, n // 12)
    titles = [f"{random.choice(words)} {random.choice(words)}" for _ in range(shows)]
    for i in range(n):
        genre = random.choices(GENRES, WEIGHTS.get(cid, [1] * 7))[0]
        conn.execute("INSERT INTO catalogue VALUES (?,?,?,?,?,?,?,?,?)",
                     (eid, titles[i % shows], 1 + i // (shows * 6), 1 + i % 6, genre,
                      random.choice([22, 30, 44, 60]), random.randint(1995, 2024), STALE.get(cid, cid), code))
        eid += 1
conn.commit()
