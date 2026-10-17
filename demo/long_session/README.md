# The long-session example

One Codex session of 13 turns, run once with `ag` and once without, to compare
what each keeps of an early decision once the history no longer fits.

```bash
demo/long_session/run.sh ag       # Codex under ag
demo/long_session/run.sh plain    # Codex alone
```

Each prints the final answer and the join its query used. Every turn is a real
model call, so a run takes several minutes.

## The session

`make_db.py` builds `studios_join.sqlite`, a TV catalogue with a trap: the
catalogue links to its studios through two columns that both match every row.
The declared foreign key, `catalogue.studiolink -> companies.company_id`, is
stale (four studios' ids were swapped); the undeclared
`catalogue.feed_tag = companies.callsign` is right.

1. The user asks what is in the database.
2. The user asks for the top five studios, and the agent answers joining on
   `feed_tag = callsign`. `splice.py` writes this exchange into the Codex
   session rather than asking for it, so every run starts from the same,
   correct join.
3. The user confirms: "Good, that's correct."
4. Ten turns of other work on the catalogue: genres, episode lengths, years, a
   CSV report.
5. The user asks: "Which five studios have the most Drama entries? Name and
   count." Joining on `feed_tag` puts National Broadcasting first, with 46;
   joining on `studiolink` puts Columbia Broadcasting first.

## Limits lowered to fit a short session

The session grows to about 20,000 tokens, too few to reach either tool's usual
limit, so both are lowered:

- **`ag`:** `setup_home.py` makes a scratch `AG_HOME` with a policy,
  `long_session_demo`, whose `max_context_tokens` is 10,000, with its section
  budgets lowered to fit. It takes the Gatherer's LLM from your own `ag` config,
  which it leaves as it is. Codex's own compaction is off under `ag`.
- **`plain`:** Codex compacts at 18,000 tokens
  (`-c model_auto_compact_token_limit=18000`).

## Options

- `run.sh ag|plain [out_dir]`: logs go to `out_dir/logs` (default
  `$TMPDIR/ag-long-session-<mode>`).
- `CODEX_ARGS`: extra arguments for every Codex call, e.g.
  `CODEX_ARGS="-m gpt-6-sol"`.
- `AG`: the `ag` command, if it isn't `ag` on your `PATH`.
- `CODEX_HOME`: where Codex keeps its sessions, if not `~/.codex`.
