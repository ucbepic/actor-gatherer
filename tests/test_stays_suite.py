"""The policy's and the store's tests again, with each gatherer's read log kept as stays from the moment its file is
made -- as migrate.py leaves a file once it moved it (schema.switch). Run as they are, those tests keep it as every
file starts, one row per item of every read; ag must give the same contexts either way."""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ag.ag_harness.store import schema  # noqa: E402

MODULES = ("test_store", "test_core", "test_proactive_context_manager", "test_join", "test_counting",
           "test_outside_events", "test_suggestions")
#: Tests that look at the read log's table itself, as a file has it before it is moved.
TABLE_ONLY = {
    "test_proactive_context_manager.BuildTest.test_shown_before_a_message_a_build_condensed_it_comes_first_in_the_verbatim_part",
    "test_store.InitTest.test_creates_the_database_and_directory",
}
_create = schema.create


def born_moved(conn):
    """schema.create, and a file just made switched to stays at once."""
    _create(conn)
    if not schema.stays(conn) and conn.execute("SELECT NOT EXISTS (SELECT 1 FROM _reads)").fetchone()[0]:
        with schema.writing(conn):
            schema.switch(conn)


class Moved(unittest.TestSuite):
    def run(self, result, debug=False):
        with mock.patch.object(schema, "create", born_moved):
            return super().run(result, debug)


def _tests(suite):
    for t in suite:
        if isinstance(t, unittest.TestSuite):
            yield from _tests(t)
        else:
            yield t


def load_tests(loader, standard_tests, pattern):
    suite = Moved()
    for name in MODULES:
        for test in _tests(loader.loadTestsFromName(name)):
            if test.id() not in TABLE_ONLY:
                suite.addTest(test)
    return suite


if __name__ == "__main__":
    unittest.main()
