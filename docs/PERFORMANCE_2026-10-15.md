# Scan and lookup findings — 2026-10-15

Aggregate-only analysis of the owner's supplied log and a read-only planning replay from the backup. No credentials, VINs, coordinates, addresses or backup contents are bundled in this repository.

## Observed, before 0.0.157

1. The large discovery scan completed 351 areas in 1,091 seconds (18m 11s), with 2,054 final station records and no reported renderer loss or source restriction.
2. It started 20 readers with about 2.2 GB system memory available. A low-memory sample caused all 16 extra lanes to retire permanently in about four seconds. The five-second cached low flag remained true while fresh diagnostic samples already showed recovery above 2 GB. Most subsequent work used four readers; reported utilization against the configured 20 was 22%.
3. Median area time was 12.85s, 90th percentile 16.46s; median page-load time was 1.07s. Waiting after the last new row accounted for 35% of cumulative reader time. This is parallel reader time, not 35% of wall-clock time that can simply be subtracted.
4. Completed-result persistence took 16.51s cumulatively (about 1.5% of elapsed time). Reducing durable checkpoints would target a small share of the time and weaken cancellation/restart recovery.
5. Peak sampled Java heap was 96 MB against a 256 MB maximum. It excludes WebView renderer memory and whole-process PSS, so it cannot rule out system-memory pressure. The log does not prove an OOM crash.
6. The saved itinerary had three legs and was about 2,006 miles. The 6,093-mile planner metric summed several whole-route candidates; it was not the actual trip length. Replaying the same compared choices produced 351 old areas versus 348 primary-plus-changed-leg areas before cache reuse, only about 1% fewer. The previous union already removed much overlap; do not promise a large website speedup just from this refactor. It also avoids paid chunk searches along unchanged legs and supports explicit route consent.
7. The first Tire Rack OE-size request returned an unverified vehicle panel. A later manual retry succeeded, followed by 65 tires / 63 model names. The first result was incorrectly terminal `unknown`, not evidence of a restriction or absent vehicle.

## Changes and acceptance checks

1. Gradual native-memory-aware admission; one shared fresh sample controls downsizing, idle extra readers pause and later resume. Maintain at least four unless the user explicitly selects fewer. A setting of 20 is a ceiling, not a promise that 20 will be safe simultaneously.
2. Native idle-reader cleanup targets the paused lane rather than every idle lane. Preserve completed observations, cancellation and per-request deadlines. Deadlines cover all 20 bridge reader names.
3. Primary searches finish before approved alternative searches. For multi-leg alternatives, search the changed leg rather than submit another complete itinerary. Local comparisons reuse station data and skip website discovery and membership lookups. Fuel and monthly reward state remain continuous across legs.
4. Keep the conservative four-second quiet-feed rule, scrolling/load-more behavior and full viewport coverage. Shortening it without slow-feed tests could recreate missing stations.
5. OE panels with missing/mismatched identity or unreadable sizes use the existing bounded retries. Genuine no-results and security restrictions are not retried automatically.
6. Re-run discovery/refresh on the phone with the same trip and settings; compare elapsed time, target/active readers, system-memory samples, renderer events, partial retention and cancel responsiveness. A five-minute result or specific speedup has not been demonstrated on the phone.

## Tire categories

The old fallback was a short generic list. Defaults now include the finer categories shown in [Tire Rack's result filters](https://www.tirerack.com/tires/TireSearchResults.jsp?autoMake=TVR&autoModClar=&autoModel=390SE&autoYear=1985&diameter=15&minLoadRating=S&minSpeedRating=S&performance=ALL&ratio=50&skipOver=true&sortCode=39500&tireIndex=0&width=225%2F), alongside general/manual choices. The selector also unions all live catalog types and the saved value, so a new source category is retained automatically. Categories never filter out brands/models. See also [Tire Rack's category overview](https://www.tirerack.com/tires/types).
