#!/usr/bin/env bash
# Gradle-free build: aapt -> javac -> dx -> zipalign -> apksigner
set -euo pipefail
cd "$(dirname "$0")"
SDK=/usr/lib/android-sdk
BT=$SDK/build-tools/debian
JAR=$SDK/platforms/android-23/android.jar
OUT=build
rm -rf $OUT && mkdir -p $OUT/gen $OUT/classes

aapt package -f -m -J $OUT/gen -M AndroidManifest.xml -S res -I $JAR
javac -nowarn -Xlint:none -source 8 -target 8 -bootclasspath $JAR -encoding UTF-8 \
  -d $OUT/classes $(find src $OUT/gen -name '*.java') 2>&1 | grep -v 'warning' || true
test -f $OUT/classes/com/bensanzone/fuelmap/MainActivity.class
java -jar $BT/lib/dx.jar --dex --min-sdk-version=26 --output=$OUT/classes.dex $OUT/classes
aapt package -f -M AndroidManifest.xml -S res -A assets -I $JAR -F $OUT/unsigned.apk
(cd $OUT && aapt add -f unsigned.apk classes.dex >/dev/null)
zipalign -f -p 4 $OUT/unsigned.apk $OUT/aligned.apk

KS=${KEYSTORE:-keystore/release.jks}
# the keystore password is never stored in the repo: export KS_PASS before building
: "${KS_PASS:?Set KS_PASS to the keystore password}"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -alias gasket -keyalg RSA -keysize 3072 -validity 10000 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" -dname "CN=Gasket" >/dev/null 2>&1
fi
apksigner sign --ks "$KS" --ks-pass env:KS_PASS --key-pass env:KS_PASS \
  --min-sdk-version 31 --out Gasket.apk $OUT/aligned.apk
apksigner verify --print-certs Gasket.apk | grep -E 'SHA-1|SHA-256' | head -2
ls -la Gasket.apk
