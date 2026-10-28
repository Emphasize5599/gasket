# Interrupted WIP handoff — read before implementation

Owner explicitly stopped Codex because usage was high. This checkpoint is NOT a completed patch or release. Main remains the previously released293 source; do not merge this WIP until completing and testing it. No version bump was made here. All intended source edits are committed on `wip/rest-planning-handoff-20261028`; no `tmp/` research artifacts, private backup, log, or credentials are committed.

## User's current requirements

1. Per-source rest radius sliders: default slider maximum50miles, configurable maximum; retain chosen radius. Only expose/send provider-supported filters. RV Parky has discrete5/10/25/50/100radii; Campendium adapter has no radius support—do not invent one.
2. Forecast status must name route/queue position and give ETA. Every process needs useful time estimates. Share spare traffic readers across routes, while preserving arrival-dependent sequential sections within each individual route.
3. Diagnose phone command discovery versus earlier scrolling, station merging and long NY planning. Persist coverage and reuse fresh prices/stations across trips/routes/areas.
4. Filter rest eligibility BEFORE showing place counts. No leg entrance if no qualifying stop remains.
5. Casual rest additions first: ask minimum rest/parking permission, add without a trip restart, show rough extra driving+rest time, adjust route/fuel in background from cached stations. User can add several rests before detailed timing.
6. Separate calculation mode after selecting rests: choose departure at each rest, then final timing review with sliders. Green=free-flow, yellow=within user's traffic tolerance, red=beyond tolerance. Owner explicitly confirmed RED IS SELECTABLE WITH A WARNING. Missing forecast is gray/unknown, never green. Respect closing hours, maximum stay, arrival windows and charging.
7. Preserve approval for unchanged roads/conditions. Only significant new sections or newly changed hazards need focused review; never send the user through the full original hazard/route workflow for each rest.

## Inputs and established findings

Owner files (must attach to Claude cloud; paths are on Windows only):
- `D:/Working/gasket-log-2026-10-28-16-27-16.txt`
- `D:/Working/gasket-full-backup-2026-10-28-16-27.json.gz`

Backup contains private keys; do not print credentials or commit either file. Settings are `prefs.settings.v` JSON string. KV namespace values are JSON strings containing `{t,v}`. Stationstore cells are `{schema,coverage,stations}`; some namespace records are index arrays. Last station-duplicate audit mistakenly inspected arrays, not `.stations`; that audit is NOT finished. Saved trip had5stops/no rest; active settings had an extra rest destination, consistent with insertion/restart trouble. Station pool1030 rows; official1030; fresh discovery~1981stations is not itself proof of duplication.

Phone293 log:
-634-area cancelled scan:320s,119done, p50area20.565s,95%row overlap, pool laneUse0.16.
-NY25-area runs55–61s, p50~16s,70%overlap.24/25 and19/24 command reads marked errors/partial despite `command_end`, zero bulkFallback.
-ROOT BUG: successful raw command results can arrive before DOM feed. `loaded` stayed false, causing `unreadable`/error at final send despite valid rows. This prevents completed-cell persistence and makes pool admission back off. Added `loaded=true` after validated bulk page; new no-feed regression added, not rerun after renaming its test variable.
-Earlier supplied291/Oct27scroll logs mostly WARM CACHE; do not claim a valid cold-phone speed comparison from them. Desktop benchmarks in docs/READER_PERFORMANCE.md do not prove phone speed.
-Rest OSM20/20cells failed: timeouts,502,429. Old implementation hammered subsequent cells. Grouping/cooldown prototype added.
-Traffic many route/hour profiles match only40% (correctly fail), others51–88%.64persistent cache slots churn across hundreds of hourly options; projection work repeats across identical road geometries. Do not loosen geometry matching or call missing data clear.

## Changes currently present (incomplete)

-`gasweb_worker.js`: loaded flag fix above. Must test no-feed valid commands are completed and durably remembered by KeylessGas/StationStore, not just parser output.
-`restsettings.js`: prototype radius sliders + expandable numeric slider maximum. Discrete RV Parky slider indices, continuous native inventory radius. Source radius max/default validation in restplaces. Needs UI/persistence tests (including custom max, invalid values and supported external URL radius).
-`restplaces.js`: larger radii allowed; one-degree OSM groups instead of tiny per-cell calls, per-cell result caching, serial requests and cooldown after429/502/timeouts. Needs tests for cooldown, retry, reuse, grouping, cancellation and per-source radii; stale data retained on failure. Existing cell tests need adaptation to true request-vs-cell counts, not weakened coverage checks.
-`restui.js`: validate all access eligibility before advertising ready counts; hide known-empty leg entrances, require successful access; source settings remains available if no matches. Cached access keyed by leg geometry/5min/limit/site, six or fewer jobs. Known closure/minimum-detour lower-bound filtering. This was only syntax checked; browser tests not rerun after changes.
-`googletraffic.js`: shared128-entry promise cache for geometry projections, preserves exact geometry/direction rules. Forecast reports progress before first request and after pieces. New `.request()` shares the same network semaphore with rest-access requests. Projection work deliberately independent of one caller's cancellation; caller validity checked afterward. Needs cancellation/concurrency tests.
-`trafficflow.js`: persistent forecast index64→1024, hot in-memory records, coalesced index writes/flush, timezone hot cache and in-flight dedupe. Shared traffic-work status includes queue/route label, active jobs, progress and crude learned per-piece ETA. Needs cache eviction/TTL/index-flush and many-hour stress tests. Generic prepare coalescing still binds shared work to first caller's validity (existing issue worth checking).
-`tripui.js`: station-planning route forecasts now Promise.all instead of serial; hazard route loaders use traffic-reader count; hourly allowance passes queue labels. Google provider still globally caps requests, each route's dependent clock stays sequential.
-`tasks.js`: prototype generic ETA suffix and learned durations using existing traffic namespace. Must review: seed exhaustion can display~1second indefinitely; this is NOT yet a production-quality universal estimator. Avoid duplicate ETA when a caller supplies one. Existing status tests had exact-caption expectations.

## Rest flow scaffolding — NOT wired/completed

New `assets/web/restplan.js` is loaded in index. Pure helpers build local insertion by preserving original selected roads and splicing verified out/back access geometry; reject joins more than.03mi apart. It also has simple hazard-key delta and timing-zone helpers. No dedicated tests yet.

`tripui.js` now exposes `C.addDraft`, `C.setTime`, `C.commit`, tolerance. Adds `restAddDraft/restReplan/restSetTime/restCommit/restBaseline` and restPending gate. Draft insertion avoids `go()` and uses cached-only `gatherAll(...localOnly,skipNetworkPrices)` plus planner. There is fallback routing of only the affected two new legs. Rough waits move with pending minimum rest. Drafts save immediately; background work uses generation validity. These functions have only syntax checks, not end-to-end validation.

CRITICAL unfinished wiring:
-RestUI's + STILL opens OLD `detail()`/full time-search path and OLD `C.accept`, which restarts/resetSteps. Must replace this with a casual add dialog calling `C.addDraft` with already-verified access paths.
-`navRender` calls `restUI.calculate()` for pending rests, but RestUI DOES NOT YET EXPORT/IMPLEMENT calculate(). Currently a runtime error if reached. Do not ship this branch as-is.
-Implement per-rest calculation wizard + final colored sliders + red warning. Existing detail forecast samples can be reused, but remove old3recommendation cards as the only choice. Store only compact sample/time metadata, not entire traffic profiles.
-New RestPlan.zones currently labels lowest observed driving time green; USER REQUEST IS FREE FLOW. Use normal/free-flow baseline from verified forecast, not merely minimum across all congested samples. Missing/partial coverage gray.
-`restCommit` currently compares global hazard fingerprints only; `holder.major` is recorded but UNUSED. This is insufficient for changed-road-only safety review. Add spatial/temporal approval transfer; show newly affected road intervals/hazards only. Preserve unchanged condition acknowledgments, but don't silently reuse them after materially changed conditions.
-`restCommit` currently passes weather stop delays as `{d,minutes}` but RouteWx expects `{mi,min}`. FIX this and include accumulated rest waits/charging/fuel stops so downstream hourly hazards are timed correctly.
-Provider forecast waits are still absolute. Future pending rest minimums must shift with arrival when evaluating a candidate departure; consider `seconds` minimum-wait support in both Google/HERE, not stale fixed `at` clocks.
-Draft replan calls makeBaseOpts and planAsync with lite=true, final with false; validate fuel cost/grades, speed settings, EV charging/tariffs, closure/window constraints, stale generations, saved restore and route cache. No network prices should run in casual cached replans.
-Rest removal is STILL old full `go()` reset flow. Make consistent with casual editing/preservation.
-C.accept for existing time changes remains old unless new wizard calls C.setTime. Check all entry points.
-Comparison consent proof must be renewed only after focused changed-hazard review, not blindly. Current restCommit populates selected-route proof after fingerprint delta—unfinished as above.

## Tests / last validation

Before this WIP: main293 had174/174 pinned GitHub tests passing. Prior local Windows Edge tinyQR `vinscan-ui` fails on baseline too; don't weaken it.

WIP six-test run: googletraffic + googletraffic-ui passed; keylessgas failed duplicate `noFeed` variable (renamed to commandNoFeed); restplaces failed old radius25→5 expectation (changed to25); tasks failed old exact status caption (updated to expect ETA); restui failed old assumption that closed services remain visible (fixture now open, old closed-add block removed). Those corrections HAVE NOT BEEN RERUN. Existing restui test still expects old insertion to return to Parameters, so rewrite meaningful flow coverage for the requested new behavior, don't just bypass assertions.

Useful commands:
```
NODE_PATH=<Playwright node_modules> CHROME=<browser> node tests/run-node.js googletraffic googletraffic-ui keylessgas tasks restplaces restui
node tests/run-node.js --release
```
Linux CI installs pinned Chromium automatically; inspect workflow for environment. Windows paths/runtime are irrelevant in cloud. New RestPlan test must be registered in runner/workflow if added. Run proportional checks during work, full suite once integrated. Preserve other agents' changes; no tmp files in commits.

## Release instructions

User wants full implementation, merge to main and signed APK release. Finish WIP first; increment version beyond293 (likely294, but fetch current main to avoid collisions). Keep short release notes. Monitor build/regression failures and fix before claiming APK publication. User doesn't require waiting for a successful build to finish, but keep an eye on it and report accurate state. Include a short phone checklist. Never overwrite released APKs or expose keys.


## Completed in 0.0.294

The unfinished wiring above (casual add/remove, calculate wizard and colored sliders, restCommit changed-hazard review and rest waits in hazard timing) is implemented and tested; see CLAUDE.md 0.0.294 and CHANGELOG. Tasks ETA no longer shows a default guess.
