# GPU UI-priority candidate

The latest official LiteRT-LM release checked on 2026-10-20 is 0.18.0. Its Android
Kotlin API does not expose GPU context priority; raising Android minSdk/targetSdk
does not expose it. Upstream tracking: https://github.com/google-ai-edge/LiteRT-LM/issues/3992

`patch-litert-gpu.js` checks the exact JNI source SHA256 at upstream commit
`b2f686e2ed4718fb84ec398a61dd59ca0f0aff27`, then adds only a low-priority request
for the GPU backend, preserving all existing advanced settings. It adds a JNI
identity check so the app can verify that a patched native library was packaged.
CPU settings, model/prompt behavior, kernel batching and Java signatures stay unchanged.

0.0.216 integrates the checksum-pinned JNI with its separately linked upstream
Gemma constraint provider. `prepare-runtime.sh` checks actual ELF exports,
dependencies and 16 KB alignment, and `package-aar.py` verifies binary hashes and
preserves every other stock AAR entry. Java checks native patch identity before
using GPU; unpatched x86_64 uses CPU. Initial CI uses the compiled Actions
artifact, then release 0.0.216 hosts a permanent source/provenance/native archive
for later builds. Every build re-verifies the binaries rather than trusting its
stored report. Complete notices remain in Settings. No new model download is
required. Real-phone GPU/display behavior still requires acceptance testing.

The separate GPU runtime workflow compiles the ARM64 JNI target first. It does
not ship a replacement runtime or APK automatically. Before integration: verify
binary dependencies/exported JNI parity against the pinned Maven AAR, preserve
all upstream runtime notices, compile the second ABI or explicitly fall back to
CPU there, and test GPU inference/system UI on the affected phone without screen
recording. A successful compilation cannot prove a driver honored the request.

Avoid adopting unmaintained binary-only forks. Remove this transformation when
the official supported API exposes the option and passes the same phone checks.
