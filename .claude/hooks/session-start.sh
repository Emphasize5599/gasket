#!/bin/bash
# Sets up a Claude Code cloud session for Gasket: the Debian Android build tools build.sh uses,
# and Python Playwright for the UI tests (they drive the Chromium that's already on the machine).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Android build tools at /usr/lib/android-sdk (aapt, dx, zipalign, apksigner, platform android-23)
PKGS="android-sdk-platform-23 android-sdk-build-tools aapt dalvik-exchange zipalign apksigner"
if ! dpkg -s $PKGS >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq || true
  apt-get install -y -qq --no-install-recommends $PKGS >/dev/null
fi

# Playwright for Python; the browser itself is not downloaded (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD)
if ! python3 -c 'import playwright' >/dev/null 2>&1; then
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PIP_DISABLE_PIP_VERSION_CHECK=1 pip install -q playwright
fi

# the UI tests read the browser from $CHROME
CHROME=""
for c in /opt/google/chrome/chrome /opt/pw-browsers/chromium-*/chrome-linux/chrome; do
  if [ -x "$c" ]; then CHROME="$c"; break; fi
done
if [ -n "$CHROME" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export CHROME=\"$CHROME\"" >> "$CLAUDE_ENV_FILE"
fi
