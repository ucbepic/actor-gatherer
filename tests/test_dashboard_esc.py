"""Esc in Chat, and a message Claude Code took back: when the page may type Esc into an actor's terminal, when the message
taken back is still in Claude Code's box untouched, and how it is put in Chat's message box and taken out again. Those
cases run in Vitest now (frontend/src/features/chat/esc.test.ts), on the TypeScript that does it (esc.ts); here, that
the words a stopped turn is said in, which the page's tests read, are harness_kit's."""
import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from ag_dashboard import data  # noqa: E402


FIXTURE = os.path.join(ROOT, "frontend", "src", "core", "ui", "harness-info.json")


class StoppedTest(unittest.TestCase):
    """A turn stopped short says so under it in its harness's own words (harness_kit's `stopped_says`): Claude Code's,
    codex's; a harness that says none its own, plain ones. Its cases run in Vitest (frontend/src/features/chat/
    Working.test.tsx) on the words in frontend/src/core/ui/harness-info.json; here, that those are harness_kit's."""

    def test_the_pages_tests_read_the_words_harness_kit_has(self):
        with open(FIXTURE, encoding="utf-8") as fh:
            fixture = json.load(fh)
        said = lambda info: {n: h.get("stopped") for n, h in info.items()}  # noqa: E731
        self.assertEqual(said(fixture), said(data.harness_info()),
                         "harness_kit's words for a stopped turn changed: write them to the page's tests' "
                         "harness-info.json")


if __name__ == "__main__":
    unittest.main()
