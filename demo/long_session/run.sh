#!/usr/bin/env bash
# run.sh ag|plain [out_dir]: the long-session example. One Codex session of 13 turns: the agent
# looks at studios_join.sqlite, joins catalogue to companies on feed_tag = callsign and the user
# confirms it, ten turns of other work on the catalogue follow, and then the user asks for the
# top five studios by Drama entries.
#   ag      Codex under ag, with a 10,000-token limit (setup_home.py), so the Gatherer builds
#           its context several times in the session; Codex's own compaction is off under ag.
#   plain   Codex alone, compacting at 18,000 tokens.
# Either way it prints the answer and the join the final query used. Every turn is a real
# model call, on the model your Codex config uses; CODEX_ARGS adds arguments to every call,
# e.g. CODEX_ARGS="-m gpt-6-sol". AG names the ag command (default: ag).
set -u
MODE=${1:?usage: run.sh ag|plain [out_dir]}
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$(mkdir -p "${2:-${TMPDIR:-/tmp}/ag-long-session-$MODE}" && cd "${2:-${TMPDIR:-/tmp}/ag-long-session-$MODE}" && pwd)
AG=${AG:-ag}
CODEX_HOME=${CODEX_HOME:-$HOME/.codex}
read -r -a EXTRA <<< "${CODEX_ARGS:-}"
rm -rf "$OUT/work" "$OUT/logs"; mkdir -p "$OUT/work" "$OUT/logs"
python3 "$HERE/make_db.py" "$OUT/work/studios_join.sqlite"

case $MODE in
  ag)
    rm -rf "$OUT/aghome"
    YOURS=$($AG model | sed -nE 's/^config: +//p')
    python3 "$HERE/setup_home.py" "$AG" "$YOURS" "$OUT/aghome" || exit 1
    export AG_HOME=$OUT/aghome
    $AG new long-session --policy long_session_demo >/dev/null
    RUN=($AG --gatherer long-session codex "${EXTRA[@]}") ;;
  plain)
    RUN=(codex "${EXTRA[@]}" -c model_auto_compact_token_limit=18000) ;;
  *) echo "usage: run.sh ag|plain [out_dir]" >&2; exit 2 ;;
esac

cd "$OUT/work"
SID=""
turn() {  # turn <name> <message>
  if [ -z "$SID" ]; then
    "${RUN[@]}" exec --skip-git-repo-check "$2" </dev/null >"$OUT/logs/$1.out" 2>"$OUT/logs/$1.err"
    SID=$(sed -nE 's/^session id: (.*)$/\1/p' "$OUT/logs/$1.err" | head -1)
  else
    "${RUN[@]}" exec --skip-git-repo-check resume "$SID" "$2" </dev/null >"$OUT/logs/$1.out" 2>"$OUT/logs/$1.err"
  fi
  [ -s "$OUT/logs/$1.out" ] || { echo "turn $1: no answer, see $OUT/logs/$1.err" >&2; exit 1; }
  echo "turn $1 done"
}

turn 1 "Look at studios_join.sqlite and tell me briefly what is in it."
[ -n "$SID" ] || { echo "no Codex session id in $OUT/logs/1.err" >&2; exit 1; }
python3 "$HERE/splice.py" "$(find "$CODEX_HOME/sessions" -name "*$SID*.jsonl" | head -1)"
echo "turn 2 written in: the agent's answer joining on feed_tag = callsign"
turn 3 "Good, that's correct."
n=3
while IFS= read -r msg; do
  n=$((n + 1)); turn $n "$msg"
done <<'EOF'
Which genres are most common across the catalogue? Give counts.
What is the average episode length in minutes per genre?
List every show title with its number of episodes and its genre mix, sorted by title.
Which years had the most new entries? Show a count per year.
For each genre, which show has the most episodes?
Write a CSV file, genre_report.csv, with genre, entries, average minutes and the earliest and latest year, then show me its contents.
Which shows run longer than 40 minutes per episode on average? List them with their average.
How many seasons does each show have? List all of them.
Which show titles appear in more than one genre? List them with their genres.
What share of entries is from before 2010 versus 2010 and later, per genre?
EOF
turn question "Which five studios have the most Drama entries? Name and count."

echo
echo "=== answer"
cat "$OUT/logs/question.out"
echo "=== join in the final query: $(grep -oE 'ON [a-z_.]+ ?= ?[a-z_.]+' "$OUT/logs/question.err" | sort -u | tr '\n' ' ')"
echo "(correct: feed_tag = callsign, with National Broadcasting first at 46; studiolink puts Columbia Broadcasting first)"
echo "logs: $OUT/logs"
