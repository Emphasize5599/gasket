#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p build/runtime
# First publication supplies this directory through download-artifact. Later
# builds use the permanent release asset, not an expiring Actions artifact.
if [ ! -f build/gpu-runtime/candidate/arm64-v8a/liblitertlm_jni.so ]; then
  curl --fail --location --retry 2 https://github.com/Emphasize5599/gasket/releases/download/keyless-test-v0.0.216/Gasket-LiteRT-0.18.0-gpu-ui1-arm64.zip -o build/runtime/native.zip
  mkdir -p build/gpu-runtime/candidate
  unzip -q -o build/runtime/native.zip -d build/gpu-runtime/candidate
fi
if ! echo 'f2aa38cecc5c728050652ffdbaed4c6f2d444e098e1ca3ecf8b85be46baae5b9  build/gpu-runtime/candidate/arm64-v8a/libGemmaModelConstraintProvider.so' | sha256sum --check --status 2>/dev/null; then
  curl --fail --location --retry 2 https://media.githubusercontent.com/media/google-ai-edge/LiteRT-LM/b2f686e2ed4718fb84ec398a61dd59ca0f0aff27/prebuilt/android_arm64/libGemmaModelConstraintProvider.so -o build/gpu-runtime/candidate/arm64-v8a/libGemmaModelConstraintProvider.so
fi
curl --fail --location --retry 2 https://dl.google.com/dl/android/maven2/com/google/ai/edge/litertlm/litertlm-android/0.18.0/litertlm-android-0.18.0.aar -o build/runtime/stock.aar
# Independently verify the real candidate on EVERY build, never trust a stored report.
python3 tools/runtime/verify-candidate.py build/runtime/stock.aar build/gpu-runtime/candidate/arm64-v8a/liblitertlm_jni.so > build/runtime/ABI_REPORT.json
cat build/runtime/ABI_REPORT.json
python3 tools/runtime/package-aar.py build/runtime/stock.aar build/gpu-runtime/candidate/arm64-v8a/liblitertlm_jni.so build/runtime/litertlm-patched.aar
cp build/runtime/ABI_REPORT.json build/gpu-runtime/candidate/ABI_REPORT.json
(cd build/gpu-runtime/candidate && zip -q -r ../../runtime/Gasket-LiteRT-0.18.0-gpu-ui1-arm64.zip .)
