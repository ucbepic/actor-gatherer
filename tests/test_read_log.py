"""The read log as stays, made items kept once, and a file moved to them (ag/ag_harness/store/schema.py,
operations.py, migrate.py): every read's items come back exactly as they were logged -- by ag before and after the
move, by an older ag beside it, and across the move -- while a read that extends the one before adds rows only for
what it adds; the move waits while an older ag has the file open."""
import os
import random
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ag.ag_harness.store import migrate, paths, schema  # noqa: E402
from ag.ag_harness.store import operations as store  # noqa: E402
from ag.ag_interface import Ref  # noqa: E402


class Count:
    def count(self, text):
        return len(text)


TOK = Count()
A, B = {"channel": "a", "cwd": "/w"}, {"channel": "b", "cwd": "/w"}

# What an older ag ran to log a read: its row, then one row per item, in order (operations.record_read before stays).
OLD_READ = ("INSERT INTO _reads (read_at, row_id, manager, p_channel, p_cwd) VALUES ('2026-10-01T00:00:00+00:00', 1, 'old', ?, ?)")
OLD_ITEM = "INSERT INTO _read_items (read_id, position, row_id, made_id) VALUES (?, ?, ?, ?)"


def refs(items):
    return [Ref(row_id=v) if k == "r" else Ref(made_id=v) for k, v in items]


def pairs(items):
    return [(v, None) if k == "r" else (None, v) for k, v in items]


class Base(unittest.TestCase):
    MOVED = True                                         # the read log kept as stays (migrate.py has moved it)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = paths.TRACE_DIR
        paths.TRACE_DIR = os.path.join(self.tmp.name, "gatherers")
        self.conn = schema.connect("g")
        schema.add_properties(self.conn, ["channel", "cwd"])
        if self.MOVED:
            migrate._retry(self.conn, lambda: migrate._switch(self.conn))
        room = mock.patch.object(migrate, "ROOM", 0)       # this disk's free space is no test's business
        room.start()
        self.addCleanup(room.stop)

    def tearDown(self):
        self.conn.close()
        paths.TRACE_DIR = self.saved
        self.tmp.cleanup()

    def log(self, props, items):
        return store.record_read(self.conn, props, refs(items), manager="t")

    def old_log(self, props, items, conn=None):
        conn = conn or self.conn
        with conn:
            read_id = conn.execute(OLD_READ, (props["channel"], props["cwd"])).lastrowid
            conn.executemany(OLD_ITEM, [(read_id, i, r, m) for i, (r, m) in enumerate(pairs(items))])
        return read_id

    def items(self, read_id, conn=None):
        """A read's items through the view, as an older ag (and SQL by hand) reads them."""
        return (conn or self.conn).execute("SELECT row_id, made_id FROM _read_items WHERE read_id = ? ORDER BY position",
                                           (read_id,)).fetchall()

    def check(self, logged, conn=None):
        for read_id, want in logged.items():
            self.assertEqual(self.items(read_id, conn), want, read_id)
            self.assertEqual(store.read_items(conn or self.conn, read_id), want, read_id)

    def stays(self):
        return self.conn.execute("SELECT count(*) FROM _stays").fetchone()[0]


class LogTest(Base):
    def test_a_read_that_extends_the_last_adds_rows_only_for_what_it_adds(self):
        logged = {}
        for n in (5, 7, 8):
            items = [("r", i) for i in range(1, n + 1)]
            logged[self.log(A, items)] = pairs(items)
        self.check(logged)
        self.assertEqual(self.stays(), 8)

    def test_from_the_first_difference_a_read_has_stays_of_its_own(self):
        logged = {self.log(A, [("r", 1), ("r", 2), ("r", 3)]): [(1, None), (2, None), (3, None)]}
        logged[self.log(A, [("m", 9), ("r", 2), ("r", 3), ("r", 4)])] = [(None, 9), (2, None), (3, None), (4, None)]
        logged[self.log(A, [("m", 9), ("r", 2)])] = [(None, 9), (2, None)]                   # shorter: the rest end
        logged[self.log(A, [("m", 9), ("r", 2), ("r", 3)])] = [(None, 9), (2, None), (3, None)]   # 3 comes back
        self.check(logged)
        self.assertEqual(self.stays(), 3 + 4 + 1)

    def test_a_context_is_the_reads_with_the_same_properties(self):
        logged = {}
        for i in range(1, 5):
            for props in (A, B, {"channel": "a", "cwd": "/elsewhere"}):
                items = [("r", props["channel"] == "a" and 100 or 200)] + [("r", j) for j in range(1, i + 1)]
                logged[self.log(props, items)] = pairs(items)
        self.check(logged)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM _contexts").fetchone()[0], 3)
        self.assertEqual(self.stays(), 3 * 5)

    def test_any_sequence_comes_back_exactly(self):
        rng, logged, last = random.Random(7), {}, {}
        for _ in range(300):
            props = rng.choice([A, B])
            items = list(last.get(props["channel"], []))
            roll = rng.random()
            if roll < 0.6:
                items += [rng.choice([("r", rng.randint(1, 50)), ("m", rng.randint(1, 9))]) for _ in range(rng.randint(1, 3))]
            elif roll < 0.8 and items:
                items = items[:rng.randint(0, len(items))] + [("m", rng.randint(1, 9))]
            else:
                items = [("m", 1)] + items[rng.randint(0, len(items)):]
            if not items:
                items = [("r", 1)]
            last[props["channel"]] = items
            logged[self.log(props, items)] = pairs(items)
        self.check(logged)
        self.assertLess(self.stays(), sum(len(v) for v in logged.values()) / 3)

    def test_an_older_ag_writing_each_item_through_the_view(self):
        rng, logged, items = random.Random(3), {}, []
        for i in range(120):
            if rng.random() < 0.7:
                items = items + [("r", rng.randint(1, 40))]
            else:
                items = items[:rng.randint(0, len(items))] + [("m", rng.randint(1, 5))]
            write = self.old_log if rng.random() < 0.5 else self.log            # an older ag beside this one
            logged[write(A, items)] = pairs(items)
        self.check(logged)
        self.assertLess(self.stays(), sum(len(v) for v in logged.values()) / 5)

    def test_an_item_for_no_read_is_refused(self):
        with self.assertRaisesRegex(sqlite3.IntegrityError, "no read"):
            with self.conn:
                self.conn.execute(OLD_ITEM, (999, 0, 1, None))

    def test_a_property_added_later_leaves_each_context_as_it_was(self):
        first = self.log(A, [("r", 1)])
        schema.add_properties(self.conn, ["lane"])
        second = self.log(A, [("r", 1), ("r", 2)])
        self.check({first: [(1, None)], second: [(1, None), (2, None)]})
        self.assertEqual(self.stays(), 2)                                  # the same context: extended
        self.assertEqual(len({c for (c,) in self.conn.execute("SELECT context_id FROM _reads")}), 1)

    def test_last_read_gives_the_latest_read_s_items(self):
        self.log(A, [("r", 1), ("r", 2)])
        self.log(B, [("r", 5)])
        self.log(A, [("r", 1), ("r", 2), ("m", 3)])
        self.assertEqual(store.last_read(self.conn, {"channel": "a"})["refs"], refs([("r", 1), ("r", 2), ("m", 3)]))
        self.assertEqual(store.last_read(self.conn, {"channel": "b"})["refs"], refs([("r", 5)]))


class DashboardTest(Base):
    def test_each_read_s_sum_from_the_stays_is_its_items_added_up(self):
        from ag_dashboard import data
        rng, sizes, logged, items = random.Random(5), {}, {}, []
        made = [store.make_item(self.conn, "x" * n, TOK, name="n", source=str(n)) for n in range(1, 12)]
        sizes = dict(self.conn.execute("SELECT made_id, tokens FROM _made_items"))
        for _ in range(150):
            props = rng.choice([A, {"channel": "a", "cwd": "/other"}])     # one channel, two contexts
            items = (items + [("m", rng.choice(made))]) if rng.random() < 0.7 else \
                [("m", rng.choice(made))] + items[rng.randint(0, len(items)):]
            logged[self.log(props, items)] = sum(sizes[v] for _, v in items)
        tables = data._tables(self.conn)
        self.assertEqual(data._sent_by_read(self.conn, "a", tables), logged)                     # the running sum
        self.assertEqual(data._sent_by_read(self.conn, "a", tables - {"_stays"}), logged)   # each read's items listed
        self.assertEqual(data._sent_by_read(self.conn, "b", tables), {})


class MadeTest(Base):
    def test_an_item_made_again_is_the_one_stored(self):
        one = store.make_item(self.conn, {"t": "x"}, TOK, properties={"channel": "a"}, name="n", source="s")
        self.assertEqual(store.make_item(self.conn, {"t": "x"}, TOK, properties={"channel": "b"}, name="n", source="s"), one)
        self.assertNotEqual(store.make_item(self.conn, {"t": "x"}, TOK, name="n", source="other"), one)
        self.assertNotEqual(store.make_item(self.conn, {"t": "x"}, TOK, name="other", source="s"), one)
        self.assertNotEqual(store.make_item(self.conn, {"t": "y"}, TOK, name="n", source="s"), one)
        self.assertEqual(self.conn.execute("SELECT p_channel FROM _made_items WHERE made_id = ?", (one,)).fetchone(),
                         ("a",))                                          # as it was first made
        self.assertEqual(self.conn.execute("SELECT count(*) FROM _made_items").fetchone()[0], 4)


class NotMovedTest(Base):
    MOVED = False

    def test_until_it_is_moved_a_read_is_a_row_per_item_as_every_ag_keeps_it(self):
        logged = {}
        for n in (2, 3):
            items = [("r", i) for i in range(1, n + 1)]
            logged[self.log(A, items)] = pairs(items)
        logged[self.old_log(A, [("r", 1), ("m", 7)])] = [(1, None), (None, 7)]     # an older ag beside it
        self.check(logged)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM _read_items").fetchone()[0], 2 + 3 + 2)
        self.assertEqual(self.stays(), 0)
        self.assertEqual(self.conn.execute("SELECT type FROM sqlite_master WHERE name = '_read_items'").fetchone(), ("table",))

    def test_made_items_are_kept_once_before_it_is_moved_too(self):
        one = store.make_item(self.conn, {"t": "x"}, TOK, properties=A, name="n")
        self.assertEqual(store.make_item(self.conn, {"t": "x"}, TOK, properties=B, name="n"), one)


class OldFile(Base):
    """A file an older ag wrote: `_read_items` one row per item, a copy of a made item for every read that sent it."""
    MOVED = False

    def setUp(self):
        super().setUp()
        self.conn.executescript("""
            DROP TRIGGER _reads_context; DROP TABLE _stays; DROP TABLE _contexts;
            DROP TABLE _made_folded; DROP INDEX _reads_context; DROP INDEX _made_items_sha;
            ALTER TABLE _reads DROP COLUMN context_id; ALTER TABLE _made_items DROP COLUMN sha;""")
        self.conn.commit()
        self.expected, self.copies = {}, {}                  # read -> [(row, made)]; copy made_id -> its text
        rng = random.Random(11)
        sections = {props["channel"]: [] for props in (A, B)}
        for i in range(60):
            props = rng.choice([A, B])
            if rng.random() < 0.15:
                sections[props["channel"]] = [rng.choice(["s1", "s2", "s3"])]          # a build: new sections
            history = sections[props["channel"]] + [f"r{j}" for j in range(i % 7 + 1)]
            items = []
            for part in history + ["notice"]:                 # each read made its items again, as copies
                if part.startswith("r"):
                    items.append(("r", int(part[1:])))
                else:
                    with self.conn:
                        made = self.conn.execute(
                            "INSERT INTO _made_items (created_at, name, source, item_json, tokens) VALUES "
                            "('2026-10-01', 'n', 's', ?, 1)", (f'"{part}"',)).lastrowid
                    self.copies[made] = part
                    items.append(("m", made))
            self.expected[self.old_log(props, items)] = pairs(items)
        self.conn.close()
        self.path = paths.db_path("g")

    def text(self, made_id, conn):
        return conn.execute("SELECT item_json FROM _made_items WHERE made_id = ?", (made_id,)).fetchone()[0]

    def same(self, conn):
        """Every read's items as they were, a made item by its text (a copy may be named by the one kept)."""
        for read_id, want in self.expected.items():
            got = self.items(read_id, conn)
            self.assertEqual([(r, None if m is None else self.text(m, conn)) for r, m in got],
                             [(r, None if m is None else f'"{self.copies[m]}"') for r, m in want], read_id)


class MoveTest(OldFile):
    def test_due_until_moved(self):
        self.assertEqual(migrate.due(self.path), "move")
        self.conn = schema.connect("g")                    # a current ag opens it: the read log as it was
        self.assertEqual(self.conn.execute("SELECT type FROM sqlite_master WHERE name = '_read_items'").fetchone(), ("table",))
        self.check(self.expected)
        self.assertEqual(migrate.due(self.path), "move")
        result = migrate.migrate("g", vacuum=False, now=True)
        self.assertEqual(result["read_items"], sum(len(v) for v in self.expected.values()))
        self.assertIsNone(migrate.due(self.path))
        self.assertNotIn(migrate.OLD_READ_ITEMS, migrate._tables(self.conn))
        self.assertIsNone(migrate.migrate("g", vacuum=False, now=True)["read_items"])              # once

    def test_every_read_comes_back_as_it_was_and_each_item_is_kept_once(self):
        from ag_dashboard import data
        self.conn = schema.connect("g")
        before = migrate._bytes(self.path)
        sums = {r: sum(1 for _, m in want if m is not None) for r, want in self.expected.items()}   # each made item 1
        for channel in ("a", "b"):                        # the dashboard's sums before the move ...
            mine = {r: n for r, n in sums.items() if self.conn.execute(
                "SELECT p_channel FROM _reads WHERE read_id = ?", (r,)).fetchone()[0] == channel}
            self.assertEqual(data._sent_by_read(self.conn, channel, data._tables(self.conn)), mine)
        result = migrate.migrate("g", vacuum=False, now=True)
        for channel in ("a", "b"):                        # ... and once it is moved
            mine = {r: n for r, n in sums.items() if self.conn.execute(
                "SELECT p_channel FROM _reads WHERE read_id = ?", (r,)).fetchone()[0] == channel}
            self.assertEqual(data._sent_by_read(self.conn, channel, data._tables(self.conn)), mine)
        self.same(self.conn)
        self.assertEqual(result["made_after"], len(set(self.copies.values())))
        self.assertEqual(self.conn.execute("SELECT count(*) FROM _made_items WHERE sha IS NULL").fetchone()[0], 0)
        self.assertLess(result["stays"], result["read_items"])
        self.assertEqual(self.conn.execute("SELECT count(*) FROM _made_folded").fetchone()[0],
                         len(self.copies) - len(set(self.copies.values())))
        self.assertGreater(before, 0)
        self.assertIn(migrate.DONE, {n for (n,) in self.conn.execute("SELECT name FROM _migrated")})

    def test_reads_logged_beside_the_move_by_this_ag_and_an_older_one(self):
        self.conn = schema.connect("g")
        self.expected[self.old_log(A, [("r", 1)])] = [(1, None)]    # an older ag still running, after the upgrade
        self.expected[self.log(B, [("r", 3)])] = [(3, None)]        # and this one, before the move
        migrate._retry(self.conn, lambda: migrate._switch(self.conn))
        self.expected[self.old_log(A, [("r", 1), ("r", 4)])] = [(1, None), (4, None)]   # one that slipped in after
        plan = migrate._plan_made(self.conn)               # the move reads what it moves ...
        newer = self.log(B, [("r", 2)])                    # ... while this ag logs a read
        self.expected[newer] = [(2, None)]
        stays, _ = migrate._plan_stays(self.conn, plan["copies"])
        migrate._retry(self.conn, lambda: migrate._move_read_log(self.conn, stays))
        migrate._retry(self.conn, lambda: (migrate._fold_made(self.conn, plan), migrate._mark(self.conn)))
        self.same(self.conn)

    def test_a_read_made_while_the_fold_ran_names_the_kept_item(self):
        self.conn = schema.connect("g")
        copy = next(m for m, text in self.copies.items() if list(self.copies.values()).count(text) > 1
                    and m != min(c for c, t in self.copies.items() if t == text))
        migrate.migrate("g", vacuum=False, now=True)
        read_id = self.log(A, [("r", 1), ("m", copy)])     # its refs from before the fold
        (_, made), = [i for i in store.read_items(self.conn, read_id) if i[1] is not None]
        self.assertEqual(self.text(made, self.conn), f'"{self.copies[copy]}"')
        self.assertNotEqual(made, copy)
        store.record_counts(self.conn, {}, {}, {copy: 42}, [])                 # its count: the kept one's
        self.assertEqual(self.conn.execute("SELECT tokens, counted FROM _made_items WHERE made_id = ?", (made,)).fetchone(),
                         (42, 1))

    def test_a_read_after_the_move_carries_on_from_its_context_s_last(self):
        self.conn = schema.connect("g")
        migrate.migrate("g", vacuum=False, now=True)
        last = store.last_read(self.conn, A)
        more = [(r.row_id, r.made_id) for r in last["refs"]] + [(99, None)]
        before = self.stays()
        read_id = store.record_read(self.conn, A, [Ref(r, m) for r, m in more], manager="t")
        self.assertEqual(store.read_items(self.conn, read_id), more)
        self.assertEqual(self.stays(), before + 1)                            # only what it adds
        self.same(self.conn)

    def test_the_fold_s_map_is_emptied_by_a_later_run(self):
        self.conn = schema.connect("g")
        migrate.migrate("g", vacuum=False, now=True)
        self.assertIsNone(migrate.due(self.path))
        with self.conn:
            self.conn.execute("UPDATE _migrated SET at = ? WHERE name = ?",
                              ((datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(), migrate.DONE))
        self.assertEqual(migrate.due(self.path), "tidy")
        self.assertEqual(migrate.migrate("g", vacuum=False, now=True)["folded_map"], "emptied")
        self.assertEqual(self.conn.execute("SELECT count(*) FROM _made_folded").fetchone()[0], 0)
        self.same(self.conn)

    def test_the_move_waits_while_an_older_ag_has_the_file_open(self):
        self.conn = schema.connect("g")
        with mock.patch.object(migrate, "older", return_value=["72217 (python -m ag.ag_harness.server)"]):
            result = migrate.migrate("g")
        self.assertIn("72217", result["waiting"])
        self.assertIn("72217", migrate.said(result))
        self.assertIsNone(result["read_items"])
        self.assertEqual(migrate.due(self.path), "move")                      # tried again at ag's next start
        self.assertEqual(self.conn.execute("SELECT type FROM sqlite_master WHERE name = '_read_items'").fetchone(), ("table",))
        self.same(self.conn)
        with mock.patch.object(migrate, "older", return_value=None):
            self.assertIn("--now", migrate.migrate("g")["waiting"])          # can't tell: by hand
        with mock.patch.object(migrate, "older", return_value=["1 (x)"]):
            self.assertIsNotNone(migrate.migrate("g", vacuum=False, now=True)["read_items"])
        self.same(self.conn)

    def test_an_older_ag_s_processes_are_told_by_when_they_started(self):
        since = migrate.code_since()
        started = {1: (since - 3600, "/usr/bin/python3 -m ag.ag_harness.server"),     # before the code: older
                   2: (since + 60, "/usr/bin/python3 -m ag.ag_harness.server"),       # after: this code
                   3: (since - 3600, "/opt/python /Users/x/.local/bin/ag"),            # a dashboard: reads only
                   4: (since - 3600, "/usr/bin/python3 -m ag_dashboard --home /h")}
        with mock.patch.object(migrate, "_others", return_value=set(started)), \
                mock.patch.object(migrate, "_process", side_effect=started.get):
            self.assertEqual(migrate.older(self.path), ["1 (/usr/bin/python3 -m ag.ag_harness.server)"])
        with mock.patch.object(migrate, "_others", return_value=None):
            self.assertIsNone(migrate.older(self.path))
        self.assertEqual(migrate.older(self.path), [])                       # this process isn't one

    def test_the_move_waits_for_room_on_the_disk(self):
        self.conn = schema.connect("g")
        with mock.patch.object(migrate, "ROOM", 1 << 60):
            self.assertIn("MB free", migrate.migrate("g", now=True)["waiting"])
        self.assertEqual(migrate.due(self.path), "move")

    def test_the_space_is_given_back_only_when_nothing_else_has_the_file_open(self):
        self.conn = schema.connect("g")
        with mock.patch.object(migrate, "FREE_WORTH", 0), mock.patch.object(migrate, "FREE_SHARE", 0):
            with mock.patch.object(migrate, "_others", return_value={4242}):
                self.assertIn("4242", migrate.migrate("g", now=True)["vacuum"])
            with mock.patch.object(migrate, "_others", return_value=set()):
                self.assertEqual(migrate.migrate("g", now=True)["vacuum"], "given back")
        self.same(self.conn)


class StartTest(OldFile):
    def test_ag_starts_the_move_in_the_background_for_what_is_due(self):
        from ag.cli import config as cli_config, main as cli
        with mock.patch.object(cli_config, "home", return_value=self.tmp.name), \
                mock.patch.object(cli.subprocess, "Popen") as popen, mock.patch.object(cli, "say") as said:
            cli.migrations()
        argv = popen.call_args.args[0]
        self.assertEqual(argv[1:], ["-m", "ag.ag_harness.home", "migrate", "g"])
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        self.assertIn("moving gatherer g", said.call_args.args[0])

    def test_nothing_started_when_nothing_is_due(self):
        from ag.cli import config as cli_config, main as cli
        self.conn = schema.connect("g")
        migrate.migrate("g", vacuum=False, now=True)
        with mock.patch.object(cli_config, "home", return_value=self.tmp.name), \
                mock.patch.object(cli.subprocess, "Popen") as popen:
            cli.migrations()
        popen.assert_not_called()

    def test_the_command_moves_every_gatherer_due(self):
        from ag.ag_harness.home import __main__ as home_cli
        root = self.tmp.name
        with mock.patch.dict(os.environ, {"AG_HOME": root}), mock.patch("builtins.print") as printed:
            code = home_cli.cmd_migrate(home_cli.home(root), [], vacuum=False)
        self.assertEqual(code, 0)
        self.assertIn("g: read log", printed.call_args_list[0].args[0])
        self.conn = schema.connect("g")
        self.same(self.conn)


if __name__ == "__main__":
    unittest.main()
