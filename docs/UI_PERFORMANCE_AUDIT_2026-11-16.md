# UI and reader performance audit — 2026-11-16

## Scope and method

The audit uses the real HTML/JS application in headless Edge, with provider replies mocked at the native boundary. The long-trip fixture has roughly 1,200 miles, 4,801 route points, 3,000 gas stations and 120 rest sites. `tools/ui-stall-audit.cjs` clicks through trip menus, adds two rests and opens timing. CDP slows CPU work by 4x. This is a repeatable stress test, not a model of a particular Android phone or a network-throughput benchmark.

The baseline is 0.0.487. Initial and final measurements both include background work after each interaction. Long-task totals sum tasks lasting at least 50 ms; they are cumulative CPU blocking, not the time a tap waited. First-frame measurements begin when the click reaches the document. They do not include an event's input-queue delay. Profiler sampling also adds overhead. Earlier failed diagnostic runs left two browser processes alive during baseline and final measurements; both were removed before follow-up testing. Treat these numbers as directional evidence, not isolated hardware benchmarks.

## Measured result

| Operation | Baseline | After changes |
| --- | ---: | ---: |
| Cumulative long tasks over the same 26 actions | 97,405 ms | 9,376 ms |
| Open rest directory: cumulative long tasks | 77,029 ms | 493 ms |
| Open rest directory: longest task | 845 ms | 202 ms |
| Tap Add: first frame | 119 ms | 37 ms |
| Tap Add: longest task | 2,053 ms | 74 ms |
| Reopen directory: first frame | 600 ms | 108 ms |
| Reopen directory: longest task | 681 ms | 118 ms |

Whole-run profiling located about 64.9 seconds inside the former rest redraw path. After incremental updates and progressive rows, that path accounted for about 2.5 seconds. Total measured blocking fell about 90%. Results vary with background work, CPU load and data volume. Remaining large tasks include station preparation, persistence, copying data into/out of planner workers and menu construction; the final measurement still contained a 922 ms task during planning. This does not establish that every tap is instant.

## Changes and why

- Rest lists patch existing DOM instead of replacing all rows on every access, imagery or recommendation update. Controls retain focus and images retain their nodes. Explicit night checkbox identities prevent one night inheriting another night's checked state.
- Direct user changes render immediately; background redraws defer while a pointer is held and shortly after scrolling or keyboard input. A progress update cannot remove the control between pointer-down and pointer-up.
- Directories initially render twelve candidates. A near-bottom observer loads twelve more; a Show more button provides an explicit alternative. All candidate records remain available; filtering and recommendation calculations still use the complete set.
- Shared primary/alternative discovery no longer builds the same geographic coverage three times. Coverage setup and rest projections/deduplication yield in bounded batches and honor cancellation before publishing results.
- Spatial duplicate indexes preserve same-leg, direction, source-alias and name rules. Disabled OSM no longer builds an unused search grid. Cached cell results append without copying the entire accumulated inventory repeatedly.
- The task hub advertises future rest inventory, details/local times, access, suggestions per original leg and eligible charger work before those stages run. Cancelled/failed planning clears pending stages. Pending future work does not hide a completed search’s Open button. The expanded list has a bounded height, touch scrolling and stable scroll position through progress updates.
- Seventeen provider definitions formerly constructed WebViews during startup. They now allocate only for a request. Idle readers retire after 1.5 seconds, or 15 seconds for reusable gas batches; low-memory callbacks can release them immediately. Active requests, visible reads, verification and queued commands prevent destruction. Explicit background cancellation releases the abandoned document. Planner workers and Blob URLs retire after five seconds idle and can recreate their candidate templates.
- Google Maps names normalize highway punctuation and accept distinctive partial names within 0.1 mile. Conflicting highway numbers, opposite directions and ambiguous equally plausible listings still fail closed.

## Verification and reproduction

New checks cover cooperative cancellation, exact synchronous/asynchronous coverage parity, indexed duplicate-decision parity, worker retirement/recreation, actual Java lifecycle methods compiled against a small view/handler harness, long queued-task scrolling, narrow/wide screens, both themes and pointer-down/progress/pointer-up stability. Existing trip, EV, hazard, settings, rest timing, saved-trip and cancellation tests remain in the release gate. The local 262-test sweep exposed four regressions; targeted reruns passed after fixing completion visibility, immediate rating feedback and tolerance commit behavior, and waiting for cooperative directory refresh in the existing leg-identity test. CI reruns the full gate on the released commit.

```powershell
$env:NODE_PATH=(Resolve-Path ../test-tools/node_modules).Path
$env:CHROME='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
$env:THROTTLE='4'
$env:NO_CANCEL='1'
$env:PROFILE_ALL='1'
$env:OUT='tmp/perf-main.json'
node tools/ui-stall-audit.cjs
# Unset NO_CANCEL to exercise both cancellation paths. Set SCROLL=1 and
# FINAL_TIMING=1 to verify progressive scrolling and completed rest review.
node tests/run-node.js --release
# The signed-build workflow additionally enforces the Java harness with a JDK.
```

`GASKET_PERF_AUDIT=2` on `tests/old-rest-trip-ui.test.js` records trusted-click paint timings, long tasks, post-GC JS heap and DOM counts for `GASKET_REPLAY_CASE`. Cases include baseline, warm, time, roads, narrow, skipped, no-leave and decline. Provider mock state and serialized cold-storage strings live in browser JS, so their heap figures overstate the corresponding native-storage application heap.

## Saved-trip settings matrix

All eight three-day replays passed at 2x CPU slowdown: cold restore, warm restore, shortest-time objective, compare rest access roads, 320px phone, a skipped later night, excluded departure hours, and declined traffic refresh. Across 423 trusted clicks, per-case p95 click-to-painted-response ranged from 106–127 ms and maxima from 187–272 ms. Every case finished with zero active or queued planner jobs. These are click-handler-to-paint measurements, not hardware input-queue latency.

Post-GC browser heap was 138–231 MiB. These figures include the test's mocked native KV data (a cold replay serializes roughly 153 million characters), so they cannot be reported as Android memory consumption or memory savings. Warm restore retained more heap/DOM than cold restore; this audit does not prove absence of leaks. Device PSS and repeated-session retention remain required follow-up.

The 0.0.488 CI gate caught a Java extraction-boundary mistake and an intermittent empty-list failure; it produced no APK. The replacement 0.0.489 separates the resource and retention harnesses and scopes each controller's redraw to its own tiles. A deterministic two-controller regression fails without that ownership guard: controller B overwrites A's original-leg labels. It passes with the guard. The full 263-test gate passed on 0.0.489. Final navigation review then removed implicit cancellation on closing a trip: useful rest work continues in the background, while idle reader retirement still reclaims unused views. Background search, explicit cancellation, saved-trip replay and the complete rest flow passed focused reruns for 0.0.490.

The separate 4x-CPU cancellation/scroll audit completed all 38 actions, including both cancellation paths, settings navigation, saved-plan recovery, progressive directory loading, two additions, both full departure sliders and final rest review, with no page errors. Scroll-time work contained no task over 59 ms; adding the two sites painted in 34/15 ms, confirming them in 76/58 ms, and choosing their departure times in 36/31 ms. This run used a shorter settling period and is not directly comparable with the baseline total. It still measured a 567 ms task when committing final timing, so that path remains a candidate for further work.

## Limits and device follow-up

There is no attached Android device/emulator or local Android/JDK toolchain in this workspace. Native code is built and lifecycle tests execute in GitHub CI. No Android PSS/RSS reduction or safe 50-reader concurrency claim is made from browser measurements. On a device, compare cold/warm trips, cancellation and navigation with `dumpsys meminfo`, reader counts, frame/input latency and real verification pages. Existing backlog items 16/17/48 remain the place for actual-phone throughput and memory tuning. Keep durable provider caches: releasing renderers must not force another national download or discard a saved trip.

## Release verification

0.0.490 was pushed at `50b6f37`. The [signed build](https://github.com/Emphasize5599/gasket/actions/runs/43941710342) completed successfully: 263 release regressions, enforced native reader/resource/lifecycle checks, signing and APK verification. Both `Gasket-0.0.490-arm64-v8a.apk` and `Gasket-0.0.490-universal.apk` returned HTTP 200 from the [release](https://github.com/Emphasize5599/gasket/releases/tag/v0.0.490). The final navigation correction passed the saved-trip, full rest-directory/timing, explicit access-cancellation and background-search focused checks before push.
