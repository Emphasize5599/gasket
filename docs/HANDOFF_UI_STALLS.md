# Handoff: UI stalls and rest-flow blockers (released in 0.0.323)

State: Claude's branch through484ee68 merged into main with Codex follow-up ce86413. Published0.0.323:
signed build41128759986/job124313970606 succeeded, all191 release regressions (including VIN) and native/runtime/
propulsion/signing checks passed on GitHub. Local full suite190/191; owner confirmed VIN tiny-QR camera timeout is a
known local-environment failure. Both ARM64 and universal direct APKs verified in the release API.

Fixed (see CLAUDE.md 0.0.323 for detail): leg renumbering kept road answers (shiftChoices), every leg gets a rest list entrance +
need button, rest access without a traffic provider, `raw._sel` crash in Stops, paint-before-work (afterPaint) for rest add/remove
and Stops' search, lazy rest access checks, accessKey/legSites/restSeedRows memos, mergeOfficial + knownAreas grids (verified
identical), planner sends candidate lists once per worker, planner drops queued plans when the trip is closed (unless background /
batch), Tasks redraw throttle + ResizeObserver measuring, comparePersist debounced (flush on pagehide / openSaved), main-map
visibleStations/enriched memos (window.__stationRev), qify/markRequired batched per frame and qify skips the map.

Audit: `tools/ui-stall-audit.cjs` (THROTTLE=8 for phone-like; PROFILE_ALL=1 TOP=30 for whole-run self/inclusive CPU;
PROFILE='label|label'; walks Next, reports STUCK; cancel scenario with ✕ after 1 s). Last clean 8x run: 25 s blocked over 29
actions before the comparePersist / Tasks RO / markRequired / enriched changes (not re-measured since).

Codex follow-up: planner results now send candidate positions plus changed fields instead of returning the full station
records for every plan. The main page reconstructs the exact filtered list, preserving calendar rewards, tariff prices and
candidate order for top-up advice. Unknown/ambiguous candidates fall back to complete records. Worker input templates are
cloned on first use too, and the page only records a cached list after postMessage succeeds. Actual-worker tests cover gas,
hydrogen, EV and CITGO parity, concurrent plans, filtered candidates and repeated large-list runs. A synthetic 3.8 MB input
produces a ~77 KB result (about 98% smaller); this is transport evidence, not a measured phone speedup.

Remaining: gatherAll pricing (Pricing.compute per station per replan), reconcileStations/mergeSites in restSeedRows,
renderStep/renderList costs, and cancellation work. Full release results and audit limitations will be recorded in CLAUDE.md.
