# Saved multi-night trip replay: continuation handoff

## User request and standing authorization

Create a fresh long trip with multiple selected overnight rests, starting a few hours after app-now. Advance only the app clock EXACTLY three days, move ALL original windows by that amount, cold-reopen, and click Next through Depart. Traffic reads require an actual app prompt; durable inventory should reuse. Fix each discovered bug and restart from scratch. Test many settings paths. Push fixes with conventional commits and release; monitor GitHub through successful tests, signing and downloadable APKs. The user is low on usage and explicitly requested this repository handoff so another agent can continue.

## Repository state

- Repository: https://github.com/Emphasize5599/gasket ; main contains all work.
- Production changes/version: `9bad094` (`fix: preserve overnight trips across date shifts and interrupted checks`), Android version code 482 / version name 0.0.482.
- Test harness follow-up: `9e410b0` (`test: restore complete storage for cold trip replay`).
- Workflow trigger follow-up: `cfc0313` (`ci: watch saved-trip replay regression fixtures`).
- Existing release entry/tag: https://github.com/Emphasize5599/gasket/releases/tag/v0.0.482 . APK publication is NOT yet verified as of this handoff.
- Current local checkout: `C:/Users/username/Documents/Codex/2026-10-11/lo/work/gasket-window-466`, branch `fix/window-night-flow-466`. Push convention used: `git push origin HEAD:main`.
- No uncommitted source changes before this handoff. Untracked `diagnostic-*.txt` and `tmp/` are local diagnostics, not release inputs; do not bulk-stage them.

## Current release monitoring (remaining work)

Latest signed-APK workflow run: **43528471736**, job **132239967798**, commit `cfc0313`.
https://github.com/Emphasize5599/gasket/actions/runs/43528471736
At handoff creation it is IN PROGRESS, running release regressions (257 tests). Continue watching; do not declare release complete until tests, native gate, signed builds and uploads succeed.

Previous APK run **43527054018**, job **132235296518**, failed ONLY `old-rest-trip-ui`; the other 256 release tests passed. That failure was in cold-storage simulation, not a reason to relax planner or permission checks. Release-entry workflow **43527054143** succeeded.

Root cause of the CI-only test failure: Chromium's file-origin reload dropped browser session state, while the harness retained the trip KV data through window.name. Vehicle settings, provider choice and fake clock then reset, causing permission-profile mismatch and unexpected Google traffic. `9e410b0` now stores native preferences/cache and clock offsets alongside KV in window.name, restores them in the SAME pre-page initialization script, deliberately clears sessionStorage before reload, and asserts vehicle profile, provider flags and exact three-day offset. Baseline plus focused tests pass locally with this stricter cold simulation. The test-only fix does not change the production APK code from `9bad094`, so version 482 remains appropriate.

If the latest run fails, fetch concrete logs, fix root cause, run focused tests and push. New app changes need a version bump and release notes per AGENTS.md. Harness-only follow-ups can remain version 482. The new test/fixture files are now included in build-apk.yml push paths so their changes trigger verification.

After success, verify BOTH assets with redirects and HTTP 200:
- https://github.com/Emphasize5599/gasket/releases/download/v0.0.482/Gasket-0.0.482-arm64-v8a.apk
- https://github.com/Emphasize5599/gasket/releases/download/v0.0.482/Gasket-0.0.482-universal.apk

Update this handoff with final outcome if convenient, and give the user a concise release link and test/fix summary. No need to rerun all tests locally while the required CI is progressing normally.

## Fixes already implemented

See ../SAVED_REST_REPLAY.md for design and reproduction. Key changes:

1. Window planning without alternative-road comparison now retains discovered station candidates (`cacheChoiceCandidates`).
2. New `assets/web/tripdates.js` recognizes uniform whole-day translation of ALL original windows. It moves selected rest clocks, generated rest windows, original departure anchors, skipped-night dates, date-specific no-leave rules/exclusions and nightly overrides. It recomputes location-local solar/DST overnight bounds; invalid moved departures require review. Partial edits/changed overnight requirements do not silently translate all rests.
3. Valid permission records for the unchanged site/car/profile/stay requirements translate their bound clocks while preserving original acknowledgment timestamps. Different sites/profiles/requirements remain unauthorized. Old traffic samples are cleared; site observation dates are untouched.
4. Saved comparison snapshots recover the root compatible station inventory when their own replay is absent. Window-only saves keep replay inventory in memory.
5. Changed-date traffic requires a real prompt before new provider reads. Declining uses normal times and explicitly disables the incompatible shared early-departure traffic allowance; late answers cannot alter another trip. Provider boundary checks still prevent reads after cancellation.
6. Cancelled rest access results are no longer treated as reusable completed answers. Opening a leg retries unfinished access, and unchecked work remains visible with a retry action. A dedicated UI regression reproduces cancellation then successful retry.

Do not freeze feasibility or weather merely to reduce call counts: changed dates legitimately require those checks. Reuse proven here concerns routes, station inventory, rest inventory and speed-limit data. No actual external service calls are made by the browser fixtures.

## Test coverage and exact status

All **14** original fresh replay variants passed to Depart: baseline, warm, narrow (320px), time, roads, decline, commute, weekend, road, skipped, no-leave, allowance, allowance-decline and google. Every audit had zero unapproved traffic requests and zero route/station/rest-inventory/speed-limit rediscovery. Compact metrics are in `2026-11-13-replay-results.json` next to this handoff.

`tripdates` passes **36** combinations of clock/solar overnight bounds, positive/negative day shifts, Chicago/Los Angeles/Phoenix time zones, normal dates and spring/fall DST dates. Additional assertions reject partial shifts, changed requirements and permission transfer to another site/profile.

Final focused release check: 11/11 passed (tripdates, old-rest-trip-ui, rest-access-cancel-ui, rest-access-ui, restui, trafficflow-cache, traffic-analysis-reuse, saved-rest-review-ui, window-rest-delta-ui, windowplanning-ui, overnight-ui). Earlier focused sets also passed saved-rest-ui, saved-rest-compare-ui, plannedtrip, plannedtrip-ui, timewindows, tripstops, vehiclecompare, window-plan-consistency and window-night-flow-ui. Cancellation/recommendation follow-ups passed too.

After the CI harness correction, baseline/tripdates/trafficflow-cache/rest-access-cancel-ui passed (4/4). A further strict-cold local sequence (session 97101 in the current tool session) has already passed decline, allowance-decline and skipped, and is now running google. Logs: `tmp/replay-cold-<scenario>.log`. Do not rely on the old failed intermediate logs; use latest PASSED/PRIMARY FAILURE line and current audit.

The full replay is browser UI + real business logic with repeatable provider-boundary fixtures, NOT an Android emulator or real provider availability test. Clock starts at Nov 13, 2026, 22:00 UTC only in the test browser and advances exactly 259200000 ms. The OS clock is untouched. The fresh roundtrip is North Little Rock–Los Angeles–North Little Rock, ~2963 miles, normally four actual selected rests (three in skipped-night variant). Google uses production six-per-second pacing with a narrower selected departure range to bound work.

## Commands and tools

Windows focused tests (escalation is needed to launch the browser):

```powershell
$env:NODE_PATH=(Resolve-Path ../test-tools/node_modules).Path
$env:CHROME='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node tests/run-node.js tripdates old-rest-trip-ui rest-access-cancel-ui trafficflow-cache
$env:GASKET_REPLAY_CASE='skipped'
node tests/old-rest-trip-ui.test.js
```

Always set the working directory to the checkout above. Plain sandbox PATH may lack node/python; elevated shell finds node. Python path when needed: `C:/Users/username/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`. Use UTF-8 explicitly. Do not run the full suite unnecessarily; release CI does it.

Connected GitHub tools (discover exact tool metadata through ALL_TOOLS):
- `mcp__codex_apps__github_fetch_workflow_run_jobs({repo_full_name:"Emphasize5599/gasket",run_id:43528471736})`
- `mcp__codex_apps__github_fetch_workflow_job_logs({repo_full_name:"Emphasize5599/gasket",job_id:132239967798})`

They return structuredContent.jobs / structuredContent.content respectively. Poll unchanged runs about every 45 seconds; notify the user only for meaningful progress/failure/completion. Final APK checks can use `curl.exe -fIL <asset URL>` with network escalation.

No CUA session or subagent was used; no computer-use completion action is pending. No secrets need publishing; fixture keys are dummy TEST values. All test code, fixtures, production changes, release notes and workflow trigger fixes are already on main.
