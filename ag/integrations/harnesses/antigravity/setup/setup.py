"""Setting the context manager up in Antigravity's CLI (agy). agy has no hook that can replace what it sends its
model, so its setup is the hook server (ag/integrations/tools/hook_server/hook_server.py) calling the context manager
as agy's hook (ag_orchestrator/context_manager.py) on every request, relaying each to the Gemini API:

    agy --(Gemini API)--> :<port> this --> <upstream>
                              |
                        agy's context manager --(stdio)--> context manager server, one per gatherer

    python -m ag.integrations.harnesses.antigravity.setup.setup --port 4213 --upstream https://generativelanguage.googleapis.com
                                    [--log-dir DIR] [--option cwd=DIR] [--option factory=module:attr] ...

agy is then pointed at it on its Gemini API route: `modelProvider: "gemini"` in its settings, GEMINI_API_KEY, and
`GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:<port>[/h/<gatherer>][/r/<run>]`. `ag antigravity` (launch.py) does that
for one run, starting this if it is not running.

Every flag but --hook is the hook server's; it needs `aiohttp`.
"""

import sys

from ag.integrations.tools.hook_server import hook_server

HOOK = "ag.integrations.harnesses.antigravity.ag_orchestrator.context_manager:AntigravityContextManager"


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else list(argv)
    return hook_server.main(["--hook", HOOK, *argv])


if __name__ == "__main__":
    sys.exit(main())
