#!/usr/bin/env bash
# Runs every test in parallel: each Node unit test, and each Playwright UI test once per phone size, as separate jobs
# (JOBS of them at a time, default: the number of CPUs). Screenshots and logs go to $1 (default /tmp/gasket-shots).
# The UI tests drive Chrome/Chromium from $CHROME (default /opt/google/chrome/chrome).
# Only some tests: ./tests/run_all.sh /tmp/shots trip_ui garage   (Node tests by name too, e.g. trip.test)
set -uo pipefail
cd "$(dirname "$0")/.."
SHOTS=${1:-/tmp/gasket-shots}
shift || true
JOBS=${JOBS:-$(nproc 2>/dev/null || echo 4)}
mkdir -p "$SHOTS"

# job = "<kind> <test> <viewport index or ->"
jobs=()
ONLY_TESTS=("$@")
want() { [ ${#ONLY_TESTS[@]} -eq 0 ] && return 0; for w in "${ONLY_TESTS[@]}"; do [ "$w" = "$1" ] && return 0; done; return 1; }
for t in tests/*.test.js; do
  n=$(basename "$t" .js); want "$n" && jobs+=("node $n -")
done
for t in trip_ui garage blacklist advisory aboutcar ui about restore perf est; do   # longest first, so they start early
  want "$t" || continue
  if grep -q 'fastwait.viewports(' "tests/${t}_test.py"; then jobs+=("ui $t 0" "ui $t 1"); else jobs+=("ui $t -"); fi
done

if [ ${#jobs[@]} -eq 0 ]; then echo "No tests match: $*" >&2; exit 1; fi

run_one() {
  kind=$1; t=$2; vp=$3; label=$t; [ "$vp" != - ] && label="$t#$vp"
  log="$SHOTS/${label/\#/-}.log"; start=$(date +%s)
  if [ "$kind" = node ]; then
    node "tests/$t.js" >"$log" 2>&1
  else
    mkdir -p "$SHOTS/$t"
    if [ "$vp" = - ]; then python3 "tests/${t}_test.py" "$SHOTS/$t" >"$log" 2>&1
    else VIEWPORT_INDEX=$vp python3 "tests/${t}_test.py" "$SHOTS/$t" >"$log" 2>&1; fi
  fi
  rc=$?; secs=$(( $(date +%s) - start ))
  if [ $rc -eq 0 ]; then echo "PASS $label (${secs}s)"; else echo "FAIL $label (${secs}s) — see $log"; fi
  return $rc
}
export -f run_one; export SHOTS

start=$(date +%s)
printf '%s\n' "${jobs[@]}" | xargs -P "$JOBS" -L 1 bash -c 'run_one $0 $1 $2'
rc=$?
echo "${#jobs[@]} jobs in $(( $(date +%s) - start ))s with $JOBS at a time"
[ $rc -eq 0 ] && exit 0 || exit 1
