r"""Each harness's own integration, one package per harness: its hook (ag_orchestrator/), its
adaptor (adaptor/), and its setup and launcher (setup/).

| harness | type | what the launcher does | gatherer | channel | the Gatherer's own messages arrive as | turned off | token counts |
|---|---|---|---|---|---|---|---|
| Pi | hook | Loads the extension with `-e`, unless Pi already has the package installed. | `--ag-gatherer NAME` | the session | a hidden custom message | Pi's compaction | ag's, and each call's own |
| OpenCode | hook | Adds the plugin through `OPENCODE_CONFIG_CONTENT`. | the plugin's `gatherer` option | the session | a synthetic user message | auto-compaction and tool-output pruning | ag's, and each call's own |
| Claude Code | proxy | Starts a proxy if none is running for the upstream, and points `ANTHROPIC_BASE_URL` at it. | URL path `/h/<gatherer>/` | the session | system messages, or user-turn reminders (`system_messages`) | nothing | Anthropic's `count_tokens` |
| Codex | proxy | Starts a proxy if none is running for the upstream, and points the active provider's `base_url` at it (`-c`). | URL path `/h/<gatherer>/` | the thread | developer messages (`AG_CODEX_AG_ROLE=user`: user messages) | nothing | OpenAI's `input_tokens` |
| Antigravity | proxy | Starts a proxy if none is running for the upstream, points `GOOGLE_GEMINI_BASE_URL` at it, and has agy call the Gemini API itself (`--settings`). | URL path `/h/<gatherer>/` | the conversation | user messages in agy's `<SYSTEM_MESSAGE>` wrapper | nothing (its compaction is answered by a build) | Gemini's `countTokens` |

Token counts: the provider's own count of each call's events, set in place of ag's tokenizer's (see "Counting tokens"
in ag/integrations); "ag's, and each call's own" -- ag's tokenizer, scaled by how far each call's reported input
tokens ran over it.
"""
