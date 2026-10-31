# Persistent traffic forecasts (313)

## Trip presets

Auto uses the whole outward journey's original route duration, before Gasket traffic overlays or added rest/charging stops. <=90 minutes: Commute / short trip, 2 hours. >90 minutes through5 hours: Weekend / regional trip, 7 days. >5 hours: Vacation / road trip, 28 days. A20-hour outward trip therefore keeps28 days; the return and individual100-mile reader pieces do not change the category. The original outward duration is retained against the non-rest stop identity. Changing those destinations rebuilds it. Route has an explicit per-trip override, saved with the trip. These choices replace312's proximity-to-departure tightening and global reuse-days setting. Google and optional HERE use the same preset in Gasket; provider selection remains separate.

The90-minute/5-hour boundaries are product heuristics, not official trip classifications. [2022 NHTS summary](https://nhts.ornl.gov/assets/2022/pub/2022_NHTS_Summary_Travel_Trends.pdf), table7-4, reports mean private-vehicle commute13.56mi/26.94min. [Census commuting data](https://www.census.gov/topics/employment/commuting/guidance/acs-1yr.html) reports2024 mean27.2min and9.3% at least60min. Ninety minutes leaves headroom for long commutes. The older [BTS summer-travel survey](https://www.bts.gov/statistical-products/surveys/national-household-travel-survey-summer-travel-quick-facts) found78% of long-distance summer trips50–249mi; five hours roughly spans250mi at50mph. This historical result is supporting context, not a current population estimate or an exact miles-to-duration conversion. Explicit overrides handle unusual commutes and trip styles.

Google describes predictions as historical patterns combined with live conditions and road restrictions/incidents. It does not promise weather-independent or immutable forecasts: [Google explanation](https://blog.google/products-and-platforms/products/maps/google-maps-101-how-ai-helps-predict-traffic-and-determine-routes/). Two hours/seven days/28 days are planning-reuse preferences, not provider accuracy guarantees. Changed dates/minutes still need matching forecasts. Weather/hazards and vehicle energy are recalculated independently.

## Depart refresh

Depart shows the oldest observation used in its current traffic profile and a Refresh traffic button. Refresh bypasses existing exact/shared profiles on its first pass, then refines changed fuel/charging stops once using only traffic observations recorded since refresh began. Two full passes maximum prevents an unbounded stop/traffic loop. Existing station candidates/prices, speed settings and destination waits remain inputs; there is no station discovery or price-update callback. The normal planner recalculates fuel and timing. Network failure retains the previous plan and displays the error. Updated arrival/departure-window conflicts return to Route; infeasibility returns to Stops. Changed/worse hazards, incomplete weather or an earlier explicit hourly No require hazard review. Export is blocked while review is pending. Refresh does not certify future traffic or replace checking conditions before driving.

## Storage and identity

TrafficCache keeps8192 records within256MiB UTF-8 payload budget plus small index/tombstone overhead,128-record hot RAM LRU, persisted LRU and reusable slots in app KV storage. Evicted payloads are tombstoned. Old unknown sizes are learned lazily; no startup read of all files. Legacy index/slot keys and exact forecasts survive. Original observation timestamps determine age; reads do not freshen records. Storage failure does not fail a valid network forecast. Cache clear resets memory/index/disk via the app's existing mechanism; lifecycle and work completion flush the delayed index checkpoint.

Identity includes captured dated local minute, geometry and avoid settings. No weekday-only reuse across dates. Geometry-verified overlap reuse remains bounded to2.5-minute arrival alignment and matching avoid tags. Untagged old observations do not participate in broader reuse; exact legacy keys still work. Unknown/mismatched Google responses remain negative-cached only10 minutes; HERE request failures5 minutes. Incomplete road coverage keeps normal-road fallback warnings. No final itinerary, hazard approval or vehicle fuel calculation is a reusable traffic fact.

## Verification

trafficpolicy covers threshold edges, explicit overrides, outward round trips with rest stops and bounded/cancelled stop refinement. traffic-presets-ui at320/448 covers saved20-hour outward classification despite short slices/overlays, forced refresh, no station/price calls, old-plan preservation on error, changed-hazard decline/confirmation/export block, override and impossible arrival window. trafficflow-cache covers1030 retained profiles, restart/no-query reuse after2days,7-day expiry, explicit2-hour override, no departure-horizon tightening, changed time/avoid misses and current-car energy recomputation. Existing Google/HERE traffic, window planning, rest and comparison tests pass. Physical-phone speedup remains to be measured.

## 0.0.320 read speed (simulated)

`tools/simulate-traffic-reads.cjs` (opt-in, no network) runs the real GoogleTraffic code against a fake Google that answers each piece of a synthetic 1,300-mile route with a time-dependent profile (rush-hour slowdowns near towns, work zones) after a 0.9–2.3 s delay (5% three times longer), 8 reader slots. Three seeds:

| | one route | 12 departure hours, 8 lanes | rest timing, 25 departures in a row | replans 1–12 min later |
|---|---|---|---|---|
| before | 73–76 s, 41 reads | 145–155 s, 492 reads | 1,230–1,274 s, 700 reads | 160–164 reads |
| 0.0.320 | 34–43 s, 50–59 reads | 130–132 s, 518–553 reads | 531–573 s, 709–725 reads | 111–123 reads |

Worst trip-time difference from the exact integration: 1.2 min on a ~21 h drive (before: 0.3 min); rest timing picked the same best departure in every run.

- Lookahead: while piece *i* is read from Google (not when it comes from storage), the next two pieces are read at departures guessed from the traffic seen so far, using only reader slots that no route is waiting on (one slot reserved per route being read). A piece whose real departure is within 2 minutes of its guess uses that answer; a guess that drifts is replaced before it starts. When as many routes as readers are being read (hourly screening) there is no idle slot, so nothing changes there.
- A stored piece read up to 2 minutes from the wanted departure is reused. Rest timing samples every 5 minutes, so its samples never borrow each other.
- Matching follows Google's points in road order (identical result, about 3× less work on dense lines).
- The native reader keeps the connection open between reads (no `disconnect()` after a fully read answer).
- Not changed: longer pieces (150 mi / 2° cells, or no cells) were 2–3× faster with no simulated accuracy loss, but the simulation can't model Google choosing other roads between farther-apart endpoints or the loss of cross-route sharing; the next phone logs' per-piece `coverage` would show whether that's safe.

## 0.0.324 partial reuse

A cache miss for a whole requested section no longer requires a whole-section Google read. Shared-road lookup lazily examines all compatible indexed observations rather than stopping at four records. Intersecting stored sections can form a verified prefix; the next section is evaluated at the arrival clock produced by that prefix. If the middle is missing or expired, only that gap is requested before checking the stored tail at the new arrival time. Changed traffic in the gap may require refreshing the tail; cached roads at a different time are not treated as valid. Geometry, direction, avoid tags, original observation age, preset TTL and the existing 2.5-minute shared-road alignment remain enforced. Explicit Depart refresh still bypasses old records. No cross-date/hour or weekday-only substitution was added.

Index entries now include original observation time and avoid tags to skip incompatible records before loading payloads. Legacy entries remain usable through payload checks. Repeated endpoint projections are memoized per lookup, and long legacy searches yield to the UI. The existing byte/count/hot-cache budgets remain unchanged. A float tolerance coalesces nearly identical stop/leg boundaries, preventing a zero-distance Google request when return timing is edited.

Status shows sections reused from storage. Forecast-ready logs include `cachedSections` and `fetchedSections` in addition to requested-piece counts, original age, preset and coverage. Joined profiles retain the oldest contributing observation timestamp; reuse does not extend retention.

Regression tests simulate persisted forecasts across a restart and several hours of elapsed planning time: join three old sections; request only a missing middle; refresh only an expired middle; reject an old tail when a new gap delay shifts arrival; find a valid record beyond six incompatible legacy records; change immediate-return timing without refetching the outward leg; preserve explicit refresh, new-hour misses and current preset retention. These are deterministic provider simulations, not a diagnosis of an unprovided phone log.

## 0.0.325 planning passes and diagnostics

Window planning's station-only preparation skips whole-trip traffic for provisional departures. Stops' automatic search is suppressed while that explicit planner owns the work, including during asynchronous notification setup. It collects station geometry first, then forecasts approved route/hour choices as needed for traffic allowance screening and actual candidate plans. Normal fixed-departure planning retains stop-aware refinement: refueling/charging delays can change when subsequent roads are reached. That pass now says “Updating traffic for fuel-stop timing.” Empty and omitted wait lists share the same prepared-profile identity; nonempty waits/stops and changed clocks still invalidate it.

Forecast-ready summaries put cache counts, age, timing and phase ahead of up to six road-match summaries, with total legCount retained. This prevents long routes from truncating the diagnostics needed to distinguish stored reuse from actual fetching. Cancellation is a debug event rather than a network-unavailability warning. Weather forecasts/approvals remain independent.

## 0.0.326 wide-window lookup and diagnostics

Future observations cannot cover the current section's starting clock. The index now stores their first/last points so they can suggest a future cached boundary without loading each full profile. Repeated endpoint pairs are deduplicated across hours. Full payload reads remain for observations covering the current clock; geometry, direction and timestamp checks still decide whether they can actually be used. Legacy endpoint metadata is learned lazily, with at most one future legacy payload probed per lookup. There is no startup scan/migration of all stored profiles. In the deterministic 2000-future-profile regression, the previous code loads2000 payloads before fetching one uncached section; the fixed code loads none of those future payloads. This is a storage-operation comparison, not measured phone timing.

Every15 seconds while traffic work is running, Forecast progress records routes/pieces, actual slot-read count delta, queued/active reader counts, transport, native/browser requests, human-verification wait and seconds since piece progress. Browser fallback after verification has one WebView, so its engine concurrency and ETA use one reader. Verification is a prominent paused task cleared on completion/cancel, with an explicit log. These diagnostics do not imply that the owner's324 stall was conclusively a cache scan or a bot check; its original log lacks the needed measurements.
