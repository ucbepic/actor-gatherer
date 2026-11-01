"""Codex's plan in the Chat view (ag_dashboard/page.html's replyBlocks and unplanned, from harness_kit's `reply_block`):
a plan is the text between <proposed_plan> and </proposed_plan>, each tag on a line of its own as codex's Plan mode
writes them; a tag named in a sentence is only words -- run in Node, without the rest of the page."""
import json
import os
import shutil
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from ag_dashboard import data  # noqa: E402

PAGE = os.path.join(ROOT, "ag_dashboard", "page.html")
START, END = "const reEscape = ", "// `breaks`: each line break kept"
# the harnesses as the home has them, the page's lines, then each text as markdown() splits it: [before, the plan,
# after] or null; and its summary line
RUN = r"""
const state = { home: { harness_info: %s } };
%s
let input = "";
process.stdin.on("data", (d) => { input += d; }).on("end", () => process.stdout.write(JSON.stringify(
  JSON.parse(input).map((t) => {
    const b = replyBlocks().find((x) => t.includes(x.open)), p = b ? b.re.exec(t) : null;
    return [p && [t.slice(0, p.index).trim(), p[1], t.slice(p.index + p[0].length).trim()], unplanned(t)];
  }))));
"""


def run(*texts):
    with open(PAGE, encoding="utf-8") as fh:
        page = fh.read()
    code = page[page.index(START):page.index(END)]
    got = subprocess.run(["node", "-e", RUN % (json.dumps(data.harness_info()), code)], input=json.dumps(texts),
                         capture_output=True, text=True, timeout=30)
    if got.returncode:
        raise AssertionError(got.stderr)
    return json.loads(got.stdout)


@unittest.skipUnless(shutil.which("node"), "needs Node to run the page's code")
class PlanTest(unittest.TestCase):

    def test_a_plan_as_codex_writes_it_with_words_around_it(self):
        [(parts, summary)] = run("Here it is.\n\n<proposed_plan>\n## Plan\n- a\n</proposed_plan>\n\nSay if it should change.")
        self.assertEqual(parts, ["Here it is.", "## Plan\n- a", "Say if it should change."])
        self.assertEqual(summary, "Here it is.\n\n## Plan\n- a\n\nSay if it should change.")

    def test_a_plan_still_streaming_runs_to_the_end(self):
        [(parts, _)] = run("<proposed_plan>\n1. Create hello.txt.\n2. Wri")
        self.assertEqual(parts, ["", "1. Create hello.txt.\n2. Wri", ""])

    def test_a_tag_named_in_a_sentence_is_not_a_plan(self):
        # an answer about codex (2026-10-26, dce93434): its list cut off at "so `", the rest drawn as a plan
        text = "- **Codex:** so `<proposed_plan>` arrives as its own `plan` item.\n- raw `<proposed_plan>` text;"
        self.assertEqual(run(text), [[None, text]])
