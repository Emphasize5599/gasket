#!/usr/bin/env bash
# Gradle-free build: aapt -> javac -> dx -> zipalign -> apksigner
set -euo pipefail
cd "$(dirname "$0")"
SDK=/usr/lib/android-sdk
BT=$SDK/build-tools/debian
JAR=$SDK/platforms/android-23/android.jar
OUT=build
APK=Gasket.apk

# signing: the keystore and its password never live in the repo. Point KEYSTORE at the .jks
# (default keystore/release.jks, gitignored) and export KS_PASS before building.
KS=${KEYSTORE:-keystore/release.jks}
if [ -z "${KS_PASS:-}" ]; then
  echo "build.sh: KS_PASS is not set. Export the keystore password in KS_PASS and run again." >&2
  exit 1
fi
if [ ! -f "$KS" ]; then
  echo "build.sh: no keystore at $KS. Set KEYSTORE=/path/to/release.jks (a new key would change the app's signing identity, so none is made here)." >&2
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
