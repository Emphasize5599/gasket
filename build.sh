#!/usr/bin/env bash
# Gradle-free build: aapt -> javac -> dx -> zipalign -> apksigner
set -euo pipefail
cd "$(dirname "$0")"
SDK=/usr/lib/android-sdk
BT=$SDK/build-tools/debian
JAR=$SDK/platforms/android-23/android.jar
OUT=build
APK=Gasket.apk

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

rm -rf $OUT && mkdir -p $OUT/gen $OUT/classes

aapt package -f -m -J $OUT/gen -M AndroidManifest.xml -S res -I $JAR
javac -nowarn -Xlint:none -source 8 -target 8 -bootclasspath $JAR -encoding UTF-8 \
  -d $OUT/classes $(find src $OUT/gen -name '*.java') 2>&1 | grep -v 'warning' || true
test -f $OUT/classes/com/bensanzone/fuelmap/MainActivity.class
java -jar $BT/lib/dx.jar --dex --min-sdk-version=26 --output=$OUT/classes.dex $OUT/classes
aapt package -f -M AndroidManifest.xml -S res -A assets -I $JAR -F $OUT/unsigned.apk
(cd $OUT && aapt add -f unsigned.apk classes.dex >/dev/null)
zipalign -f -p 4 $OUT/unsigned.apk $OUT/aligned.apk

apksigner sign --ks "$KS" --ks-pass env:KS_PASS --key-pass env:KS_PASS \
  --min-sdk-version 31 --out $APK $OUT/aligned.apk
apksigner verify --print-certs $APK | grep -E 'SHA-1|SHA-256' | head -2
ls -la $APK
