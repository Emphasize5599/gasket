#!/usr/bin/env bash
# Runs every test: the Node unit tests, then the Playwright UI tests (screenshots go to $1, default /tmp/gasket-shots).
# The UI tests drive Chrome/Chromium from $CHROME (default /opt/google/chrome/chrome).
set -uo pipefail
cd "$(dirname "$0")/.."
SHOTS=${1:-/tmp/gasket-shots}
fail=0
for t in tests/*.test.js; do
  if node "$t" >/dev/null 2>&1; then echo "PASS $t"; else echo "FAIL $t"; fail=1; fi
done
for t in ui blacklist est garage perf trip_ui; do
  log="$SHOTS/$t.log"; mkdir -p "$SHOTS/$t"
  if python3 "tests/${t}_test.py" "$SHOTS/$t" >"$log" 2>&1; then echo "PASS tests/${t}_test.py"; else echo "FAIL tests/${t}_test.py (see $log)"; fail=1; fi
done
exit $fail
