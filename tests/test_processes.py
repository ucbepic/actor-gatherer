"""What differs by OS, run for real on this one: a process and what it started ended (harness_kit/processes.py), and
one `ag home migrate` at a time in a home (its lock)."""

import os
import subprocess
import sys
import tempfile
import time
import unittest
import unittest.mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from ag.ag_harness.home.__main__ import _locked  # noqa: E402
from harness_kit.processes import end_group, running  # noqa: E402

CHILD = "import time; time.sleep(60)"
PARENT = ("import subprocess, sys, time; child = subprocess.Popen([sys.executable, '-c', sys.argv[1]]); "
          "print(child.pid, flush=True); time.sleep(60)")


class EndGroupTest(unittest.TestCase):
    def gone(self, pid):
        until = time.time() + 10
        while time.time() < until and running(pid):
            time.sleep(0.1)
        return not running(pid)

    def test_a_process_and_what_it_started_are_ended(self):
        for force in (False, True):
            parent = subprocess.Popen([sys.executable, "-c", PARENT, CHILD], stdout=subprocess.PIPE, text=True,
                                      start_new_session=True)
            self.addCleanup(parent.stdout.close)
            child = int(parent.stdout.readline())
            end_group(parent.pid, force)
            parent.wait(timeout=10)
            self.assertTrue(self.gone(child), f"force={force}: what it started still runs")

    def test_none_there_is_said(self):
        parent = subprocess.Popen([sys.executable, "-c", ""], start_new_session=True)
        parent.wait(timeout=30)
        with self.assertRaises(ProcessLookupError):
            end_group(parent.pid)


HOLD = ("import os, sys, time; f = open(sys.argv[1], 'a'); print(os.getpid(), flush=True); time.sleep(60)")


class HoldersTest(unittest.TestCase):
    """Who has a gatherer's file open, as the storage upgrade asks before it moves the read log (store/migrate.py):
    lsof or /proc, and on Windows the Restart Manager. The process is the one that prints its pid: Windows' venv
    python.exe starts the real one as a child."""

    def hold(self, path, *extra):
        p = subprocess.Popen([sys.executable, "-c", HOLD, path, *extra], stdout=subprocess.PIPE, text=True,
                             start_new_session=True)
        self.addCleanup(self.end, p)                  # before the folder goes: Windows can't delete a file held open
        return int(p.stdout.readline())

    def end(self, p):
        try:
            end_group(p.pid, force=True)              # the venv launcher and the python it started
        except ProcessLookupError:
            pass
        p.wait(timeout=10)
        p.stdout.close()

    def test_an_older_ag_holding_the_file_is_found_and_a_dashboard_is_not(self):
        from ag.ag_harness.store import migrate
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = os.path.join(tmp.name, "context.db")
        open(path, "w").close()
        if migrate._others(path) is None:
            self.skipTest("nothing here tells what has a file open")
        self.assertEqual(migrate.older(path), [])
        ag = self.hold(path)
        dashboard = self.hold(path, "-m", "ag_dashboard")
        self.assertTrue({ag, dashboard} <= migrate._others(path))
        started = migrate._process(ag)
        self.assertLess(abs(started[0] - time.time()), 120)
        self.assertIn(HOLD[:20], started[1])
        self.assertEqual(migrate.older(path), [])                     # started after the code: this ag's
        with unittest.mock.patch.object(migrate, "code_since", return_value=time.time() + 3600):
            found = migrate.older(path)                               # as if started before it: an older ag's
        self.assertEqual([int(x.split()[0]) for x in found], [ag])

    def test_a_dashboard_is_told_by_its_command_on_every_os(self):
        from ag.ag_harness.store.migrate import READER
        for cmd in ("/usr/bin/python3 -m ag_dashboard --home /h", "/opt/python /Users/x/.local/bin/ag",
                    "/opt/python /Users/x/.local/bin/ag dashboard --port 1",
                    r'"C:\Py\python.exe" "C:\my venv\Scripts\ag.exe"',
                    r'"C:\Py\python.exe" "C:\my venv\Scripts\ag.exe" dashboard --port 4217 --no-open'):
            self.assertTrue(READER.search(cmd), cmd)
        for cmd in ("/usr/bin/python3 -m ag.ag_harness.server", r'"C:\Py\python.exe" -m ag.ag_harness.server',
                    r'"C:\Py\python.exe" "C:\my venv\Scripts\ag.exe" claude -p hi'):
            self.assertFalse(READER.search(cmd), cmd)


class MigrateLockTest(unittest.TestCase):
    def test_one_holder_at_a_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "migrate.lock")
            with open(path, "w") as first:
                self.assertTrue(_locked(first))
                with open(path, "w") as second:
                    self.assertFalse(_locked(second))
            with open(path, "w") as third:              # the first closed: free again
                self.assertTrue(_locked(third))


if __name__ == "__main__":
    unittest.main()
