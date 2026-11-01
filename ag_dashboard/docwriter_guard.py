"""The guard a DocWriter actor's harness runs before each of its own file edits (docwriter.py's `launch_args`, harness_kit's
`edit_guard_args`: Claude Code's PreToolUse hook): an edit of a file open in DocWriter refused -- with why, and what to
use instead (DocWriter's edit_doc, which proposes the change for the author to accept). It asks the dashboard (`guard`,
at the URL it is run with); a dashboard it cannot reach, or any trouble, lets the edit go. What the harness gives it,
and how it refuses, are the harness's (harness_kit's `guard_path`, `guard_refusal`). Run as a script:

    python docwriter_guard.py http://127.0.0.1:4200/docwriter/w/<key>/guard <harness>     (the hook's input on stdin)
"""
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # harness_kit, beside the dashboard

import harness_kit  # noqa: E402


def main() -> int:
    try:
        rules = harness_kit.get(sys.argv[2] if len(sys.argv) > 2 else harness_kit.DEFAULT)
        path = rules.guard_path(json.load(sys.stdin)) if rules is not None else None
        if not path:
            return 0
        req = urllib.request.Request(sys.argv[1], data=json.dumps({"path": path}).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=5) as res:
            why = json.load(res).get("deny")
    except Exception:  # noqa: BLE001 - the edit is not held up by the hook's own trouble
        return 0
    if why:
        print(rules.guard_refusal(why))
    return 0


if __name__ == "__main__":
    sys.exit(main())
