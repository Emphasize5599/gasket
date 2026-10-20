#!/usr/bin/env bash
# Dependency-aware build for LiteRT-LM's native AARs; signing identity is unchanged.
set -euo pipefail
cd "$(dirname "$0")"
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/lib/android-sdk}}

# signing: the keystore and its password never live in the repo (see SIGNING.md). The password comes from KS_PASS.
# The keystore is KEYSTORE=/path/to.jks, else keystore/release.jks (gitignored), else GASKET_KEYSTORE_B64 (the
# keystore as base64, how cloud sessions get it from their environment settings), written to a private temp file.
KS=${KEYSTORE:-keystore/release.jks}
if [ -z "${KS_PASS:-}" ]; then
  echo "build.sh: KS_PASS is not set. Export the keystore password in KS_PASS and run again (see SIGNING.md)." >&2
  exit 1
fi
if [ -z "${KEYSTORE:-}" ] && [ ! -f "$KS" ] && [ -n "${GASKET_KEYSTORE_B64:-}" ]; then
  KS=$(mktemp "${TMPDIR:-/tmp}/gasket-ks.XXXXXX")   # created readable by this user only
  trap 'rm -f "$KS"' EXIT
  if ! printf '%s' "$GASKET_KEYSTORE_B64" | tr -d ' \r\n' | base64 -d > "$KS" 2>/dev/null || [ ! -s "$KS" ]; then
    echo "build.sh: GASKET_KEYSTORE_B64 isn't a base64 keystore. Paste it again from tools/new-signing-key.ps1." >&2
    exit 1
  fi
fi
if [ ! -f "$KS" ]; then
  echo "build.sh: no keystore at $KS. Set KEYSTORE=/path/to/release.jks or GASKET_KEYSTORE_B64 (see SIGNING.md). A new key would change the app's signing identity, so none is made here." >&2
  exit 1
fi

# A checksum-pinned distribution replaces a binary wrapper checked into source.
GRADLE_CACHE=${GASKET_GRADLE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/gasket-gradle}
GRADLE_SHA=20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78
mkdir -p "$GRADLE_CACHE"
if [ ! -x "$GRADLE_CACHE/gradle-8.13/bin/gradle" ]; then
  curl --fail --location --retry 2 https://services.gradle.org/distributions/gradle-8.13-bin.zip -o "$GRADLE_CACHE/gradle-8.13-bin.zip"
  echo "$GRADLE_SHA  $GRADLE_CACHE/gradle-8.13-bin.zip" | sha256sum -c -
  unzip -q -o "$GRADLE_CACHE/gradle-8.13-bin.zip" -d "$GRADLE_CACHE"
fi
bash tools/runtime/prepare-runtime.sh
ANDROID_HOME="$SDK" "$GRADLE_CACHE/gradle-8.13/bin/gradle" --console=plain --no-daemon assembleRelease
SIGNER=${APKSIGNER:-$(find "$SDK/build-tools" -name apksigner -type f | sort -V | tail -1)}
test -n "$SIGNER"

# One compilation/dex pass; Gradle packages both supported ABIs plus the universal output.
# Publish just these two choices. The x86_64-only intermediate need not be signed or uploaded.
for ABI in arm64-v8a universal; do
  APK="Gasket-$ABI.apk"
  UNSIGNED="build/outputs/apk/release/Gasket-$ABI-release-unsigned.apk"
  test -s "$UNSIGNED"
  "$SIGNER" sign --ks "$KS" --ks-pass env:KS_PASS --key-pass env:KS_PASS \
    --min-sdk-version 31 --out "$APK" "$UNSIGNED"
  "$SIGNER" verify --print-certs "$APK" | grep -E 'SHA-1|SHA-256' | head -2
  ls -la "$APK"
done
# Local backwards-compatible convenience name only; never publish a third duplicate universal asset.
cp Gasket-universal.apk Gasket.apk
