# Saved overnight-trip replay audit

## Reproduction

`tests/old-rest-trip-ui.test.js` builds a new North Little Rock–Los Angeles–North Little Rock trip through the real UI and planner, selects multiple overnight rests, completes departure timing, advances the app clock exactly 259,200,000 ms, moves every original window by that same amount, closes/reopens, and continues through Depart. The browser-only clock starts at November 13, 2026, 22:00 UTC for repeatability; the operating-system clock is untouched.

Provider boundary fixtures supply repeatable routing, fuel, rest-area, weather and traffic responses. Business logic, selection UI, permissions, planning, cache identity and storage remain real. HTTPS requests outside these boundaries are blocked. Cold reopening flushes pagehide storage and reloads persistent native-storage stand-ins, including preferences and the controlled clock. Browser session storage is deliberately cleared: Chromium file origins can discard it on reload. Vehicle profile, provider settings and exact clock offset are asserted before replay. This validates app behavior rather than third-party service availability or Android process lifecycle.

## Bugs repaired

- Window planning without alternative-route comparison discarded discovered station candidates.
- Moving original dates left selected rests and generated rest windows on their old dates.
- Comparison snapshots without their own station replay discarded the root saved inventory.
- Rest acknowledgments bound to old clocks rejected otherwise unchanged selected sites after a uniform trip-date move. Only valid acknowledgments for the unchanged site, vehicle profile and stay requirements are translated; their original observation times remain unchanged.
- Declining new-date traffic reads surfaced cancellation as a planning failure. The choice now takes effect before planning begins and explicitly disables an incompatible traffic-delay allowance.

- Cancelled rest-access checks were cached as reusable completed answers, preventing later leg views from retrying them. Cancellation now remains retryable. A dedicated UI regression covers cancellation followed by opening the leg.

Uniform translations clear date-specific forecast samples and recompute overnight bounds at each site's location/time zone. Invalid translated departures require review. Partial window changes or changed overnight requirements do not silently move all rests. Weather and changed-date feasibility still need validation; retaining inventory does not imply freezing all calculations.

## Settings coverage

The scenario can be selected with `GASKET_REPLAY_CASE`: `baseline`, `warm`, `narrow` (320px), `time`, `roads`, `decline`, `commute`, `weekend`, `road`, `skipped`, `no-leave`, `allowance`, `allowance-decline`, or `google`. Every scenario starts from scratch. Google uses the production request limiter and a narrower nightly departure range to bound forecast work. Other cases use HERE boundary responses. Baseline runs in release CI; other paths are focused audit runs.

Assertions require the selected sites and translated departures to survive, every Next to reach Depart, no unapproved traffic read, and no route/station/rest-inventory/speed-limit rediscovery. Network call audits are written to `tmp/old-rest-trip-<scenario>-audit.json`. Screenshots capture initial planning, selected rests and Depart.

`tests/tripdates.test.js` additionally checks partial-edit rejection, changed requirements, permission isolation, calendar-date rules, and 36 combinations of clock/solar bounds, forward/backward shifts, Chicago/Los Angeles/Phoenix zones and normal/fall/spring DST dates. Existing saved-rest, EV/window, forecast-cache and comparison regressions cover neighboring paths. These are bounded scenarios, not a claim that every possible setting combination is exhausted.

## Running

Use the repository's Playwright setup and set `CHROME` if required:

```sh
node tests/run-node.js tripdates old-rest-trip-ui trafficflow-cache
GASKET_REPLAY_CASE=skipped node tests/old-rest-trip-ui.test.js
```
