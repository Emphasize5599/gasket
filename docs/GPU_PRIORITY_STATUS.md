# GPU priority experiment — 2026-10-20

No replacement runtime or APK has shipped from this experiment. Current app: 0.0.215.

User evidence: GPU-only display corruption also affects Android's notification
shade, while CPU-only mode appears unaffected. FrameMetrics can be normal during
the corruption. This implicates shared GPU/runtime/driver behavior; it does not
prove the exact defect or that low-priority execution will fix it.

Official LiteRT-LM 0.18.0 has a native priority option but no Android Kotlin setter.
Raising Android minSdk/targetSdk does not expose it. Upstream related report:
https://github.com/google-ai-edge/LiteRT-LM/issues/3992 . No ready maintained
Android wrapper exposing it was found in the focused search.

`tools/runtime/patch-litert-gpu.js` verifies pinned upstream source before setting
only GPU context priority, preserving all other settings and adding a JNI identity
method. `gpu-runtime.yml` compiles ARM64 only, without signing credentials.

First attempt failed in upstream Abseil with host Clang 14's C++20 source_location
support. Ubuntu 24.04 / Clang 18 replaces it. The injected C++ settings test passed
on Linux (run 39449788674). Eight negative/positive ABI-verifier fixture tests pass
locally; these are not real-binary or device tests.

Previous source build (started at f7884c1):
https://github.com/Emphasize5599/gasket/actions/runs/39449788674

The ABI verifier was added while that compilation was running, so that particular
run does NOT execute it. Before integration, run it against the candidate and the
pinned official AAR (or rerun the updated workflow, using the compiled disk cache).
It checks JNI export parity, dependencies, architecture, 16 KB ELF alignment,
patch identity, and stock native notices. Never call this device validation.

Follow-up: that run compiled the patched JNI but failed at linking because
`prebuilt/android_arm64/libGemmaModelConstraintProvider.so` was an unfetched Git
LFS pointer. Commit 8a73bf4 explicitly pulls only the ARM64 upstream LFS binaries
and checks ELF headers before compilation. Cache restore/save are now separate;
completed compilation work is preserved even if a later step fails. The previous
failed run had no saved cache, so this retry is still a cold compilation.

Replacement build (includes real ABI verification):
https://github.com/Emphasize5599/gasket/actions/runs/39458036225

User explicitly requested ongoing build monitoring and a new APK. A thread
heartbeat named "Watch Gasket builds" checks every ten minutes, remains quiet
when unchanged, fixes new in-scope failures, and continues these integration
gates on native success. Keep it current; avoid duplicate monitors. Do not
confuse a native candidate artifact with a signed app release. The app still
uses the stock AAR until the remaining integration below is actually done.

Remaining integration gates:

1. Get a successful source compile and real-binary ABI report. Preserve a pinned,
   reproducibly sourced candidate, its SHA256, patch and upstream notices.
2. Replace only ARM64 JNI in the exact official AAR, preserving classes, provider
   libraries and notices. Verify the patch's identity before enabling GPU in Java.
   Universal x86_64 must explicitly use CPU unless separately patched/tested.
3. Bump app version, run targeted Java/backend/packaging tests and signed APK CI.
   Do not overwrite existing released APKs or force another model download.
4. Phone acceptance: Automatic mode + Recheck explanation, without recording;
   switch menus and open notification shade. Confirm actual backend and priority
   identity in logs. Compare CPU-only as a control. Low priority is a driver
   request, not a guarantee. Do not declare flicker fixed until tested.
