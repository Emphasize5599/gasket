# Handoff: UI stalls and rest-flow blockers (unreleased, branch claude/blissful-mccarthy-s8spue)

State: committed on the session branch, NOT pushed to main (main would release 0.0.323). Manifest/CHANGELOG/CLAUDE.md already
say 0.0.323. Run `node tests/run-node.js --release` before merging; the last full run (before the later perf commits) was 191/191
except one hazard-zones flake that passed on 4 reruns. Focused tests after the latest changes pass: restui, rest-leg-choices,
windowplanning-ui, overnight-ui, recreation-ui, tasks, api-meter-ui, ui-flow, background-search, vehiclecompare-ui,
planner-worker, planner-queue, ev-feasibility, autotrip-ui, citgo-trip-ui.

Fixed (see CLAUDE.md 0.0.323 for detail): leg renumbering kept road answers (shiftChoices), every leg gets a rest list entrance +
need button, rest access without a traffic provider, `raw._sel` crash in Stops, paint-before-work (afterPaint) for rest add/remove
and Stops' search, lazy rest access checks, accessKey/legSites/restSeedRows memos, mergeOfficial + knownAreas grids (verified
identical), planner sends candidate lists once per worker, planner drops queued plans when the trip is closed (unless background /
batch), Tasks redraw throttle + ResizeObserver measuring, comparePersist debounced (flush on pagehide / openSaved), main-map
visibleStations/enriched memos (window.__stationRev), qify/markRequired batched per frame and qify skips the map.

Audit: `tools/ui-stall-audit.cjs` (THROTTLE=8 for phone-like; PROFILE_ALL=1 TOP=30 for whole-run self/inclusive CPU;
PROFILE='label|label'; walks Next, reports STUCK; cancel scenario with ✕ after 1 s). Last clean 8x run: 25 s blocked over 29
actions before the comparePersist / Tasks RO / markRequired / enriched changes (not re-measured since).

Next step found but not done: every planner result posts `plan.cands` back (3.6 MB per plan, measured) — the biggest remaining
main-thread cost (worker onmessage ~3.3 s at 8x). tripui uses `p.cands` only in topUps (tripui ~4051, `T.topUps(... cands:
p.cands ...)`) and a citgo `.some` (~4147); both could use `r.cands`/`o.cands` instead. Strip `cands` from the posted plan in
planner.js boot (`plan.cands=undefined` before postMessage, restore main-side from p.opts.cands if needed). Other remaining:
gatherAll pricing (Pricing.compute per station per replan, ~3 s at 8x), reconcileStations/mergeSites in restSeedRows,
renderStep/renderList costs. Owner wants less total work, not just shorter longest tasks, and ✕ must leave the app responsive.
