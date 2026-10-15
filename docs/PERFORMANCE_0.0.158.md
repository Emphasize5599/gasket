# 0.0.157 log follow-up / 0.0.158 changes

Aggregate analysis only. No user locations, credentials, VIN or personal log fixtures are bundled.

## Findings

1. The supplied 0.0.157 log records 200 primary search areas in 666.8s, followed by 201 alternative areas in 534.7s: 401 areas and about 20 minutes of discovery. This is not a like-for-like comparison with the prior 351-area itinerary scan.
2. The primary scan's peak was only six active readers; it stayed near four for most of its run. Recovery required 1,500 MB free even though recurring reclamation often produced only 850–1,490 MB. Genuine pressure also occurred (minimum reported free memory zero, no renderer-loss event). It is unsafe to assume every sample is spurious or to disable memory protection.
3. Primary/alternative discovery used separate area plans. Two-mile-near centers were merged within a plan, but not across these two phases. A shared union now assigns existing primary areas to the first phase and only additional areas to alternatives. Its concatenation is exactly the prior single-union plan; distinct search areas are not cut off. Coverage still depends on website results, not a guarantee of every station.
4. Primary median area time was 13.3s; alternative median 17.0s. After-last-row waiting accounted for 35% / 31% of cumulative reader time, not an equivalent share of wall time. The feed-settle/scroll/load-more rules are unchanged.
5. One plan took 20.8s. A later four-route station-matching pass took 17.6s. Repeated selection rebuilt and rematched everything, with synchronous planning blocking the UI. Persistence was 9.9s / 15.5s cumulatively during scans, so checkpoint removal would target a small share and weaken recovery.

## Changes

1. Start eight readers with >=2,200 MB available, six with >=1,200 MB, otherwise four; honor the user's ceiling, including values below four. Resume at >=850 MB, faster with >=1,800 MB; pause extra readers below 350 MB or on Android low-memory indication, with a four-second cooldown. The floor remains four unless the selected ceiling is lower. These are tunable admission heuristics, not proof that 20 readers fit safely.
2. Invisible gas readers block network images (restored for visible site checks), recycle after four reads, retain shared HTTP cache, and recreate lazily. Map discovery uses the configured/adaptive pool instead of a separate fixed four-reader cap. Price-only refresh uses the same admission policy.
3. Per-leg projections are reused for route recombinations and buffer/detour changes. Station discovery and paid calls are not repeated. Matching yields every 25 stations rather than 150 when it is required.
4. CPU planning runs in one reusable Blob Web Worker with only route/candidate/pricing data; no API keys or native/network access are passed. Its bundled source is the same pure Trip/Pricing implementation, not a second optimizer. Calendar rewards, return waits and speed overrides are retained. Unsupported worker construction falls back to the existing planner; a worker runtime failure reports an error and restores the previous route selection.
5. Fuel/time integration uses binary segment lookup; leg-boundary fuel is precomputed instead of integrated again for every candidate pair. A synthetic local 1,000-mile / 8,000-segment / 220-candidate case took 125ms before versus 37ms after with identical results. This is not a phone or website benchmark.
6. The active leg owns recenter bounds. Comparison shows approved alternatives as gray routes and the current choice in blue. Unchanged geometry isn't redrawn for each computation state. Loading appears before recombination; closing removes preview layers immediately and deferred drawing cannot restore a hidden trip.
7. Main-map rendering now stops while the trip owns the map. Previously every route camera move rebuilt the hidden main-map station list/markers/bubbles too. Data collection continues; closing refreshes the main map after the trip panel has painted away.

## Acceptance

1. Automated: union coverage/phase reuse, adaptive pressure/recovery/cancellation, exact worker/main-thread parity (including CITGO calendar and speed overrides), UI heartbeat, leg-only sliders, projection reuse, multiple preview lines, recenter, close cleanup, and existing full release regressions.
2. Phone: repeat the same saved trip/settings and export the next log. Compare completed areas, cache hits, active/target readers, memory minima, renderer events, elapsed time, cancel/reopen recovery, and route-switch/close responsiveness. No five-minute target or measured phone speedup is claimed.
