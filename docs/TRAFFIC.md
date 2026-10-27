# Traffic forecasts and departure windows

## Implemented in 0.0.272

Route → **Forecast traffic** uses the optional HERE key. **Explore departure times** checks selected roads within user-entered windows and presents colored sliders. All congestion levels remain selectable. Gray means no usable forecast, an unmet arrival deadline, or a return departure before reaching the destination. No time changes until **Use these times** is pressed.

Green means at most five additional driving minutes versus the lowest tested value with the other slider held fixed; amber means up to fifteen, red more than fifteen. These are Gasket's comparisons of numeric duration forecasts, not Google's traffic colors or a road-safety classification. Major ticks show clock time and added driving minutes. Sampling defaults to hourly; it does not prove the optimum between samples. Each window is at most 48 hours / 25 samples. Users can narrow the window or change the interval.

Immediate-return comparisons include the entire round trip, including return congestion at the projected arrival time. Manual return compares both windows and presents separate sliders. Known stop, charging, destination and fixed-return waits advance the clock. Final acceptance invalidates prior route/hazard acknowledgements and planning results; existing station inventories remain reusable. Weather, energy, prices/tariffs and stops are rebuilt for the chosen times.

## Source and matching

HERE Routing v8 receives an actual ISO departure instant, sampled pass-through points on the selected line, avoidance settings and timed stops. It evaluates later sections at their projected arrival times. `departureTime=any` is never used. Numeric span durations and dynamic speed fields are required. The flexible-polyline decoder is independently implemented from the documented format, not copied from another project.

(Until 0.0.280; replaced by stretch-by-stretch matching, see 0.0.281 below.) Responses had to match route length within 2% (minimum tolerance 0.03 mile), cover both endpoints, progress in order, and lie within 0.03 mile of the selected geometry; reverse sampling also rejects shortcuts. Each leg is matched independently, including repeated roads on an out-and-back. This is conservative corridor matching, not proof of identical lane/road IDs: closely parallel roads remain a validation concern. Failures are reported rather than silently using a newly chosen HERE route.

Span durations retime the route. Expected speeds remain separate from posted limits; speed choices cannot override forecast congestion. Gas/diesel estimates retain the existing EPA city/highway interpolation, while EV/hydrogen projection receives the forecast speed and time. This improves consistency but is not a measured stop-and-go fuel model; vehicle/thermal calibration remains TODO50.

Non-lite planning performs one stop-aware forecast/refinement from the same station candidates and prices. Lightweight slider sweeps make no provider requests. A changed second plan is not iterated indefinitely: phone validation should examine sensitivity when charging locations/times change substantially. Very long waits are split into subsequent forecast requests instead of exceeding HERE's per-stop duration limit.

## Usage, caching and cancellation

Forecasts and tolls share the existing native monthly HERE reservation and cap (default 2,000 attempts). Existing counters now say routing rather than tolls. A failed HTTP attempt still consumes its reservation. The fixed native endpoint and request allowlist are unchanged; JS additionally bounds a HERE call at 45 seconds. Check the actual HERE account allowance rather than assuming an unlimited/free plan.

Persistent forecast answers are keyed by geometry, exact query/departure, avoids and stop delays, independent of trip or vehicle identity. Request clocks are rounded forward to a minute; displayed trip clocks retain their stop-aware timing. Cached reads retain the oldest source timestamp. Near-term answers live ten minutes; departures more than an hour away live six hours. A memory layer bounded to 128 entries / 100,000 span rows avoids repeated disk/provider reads while exploring outbound/return combinations. Clear cache resets forecasts too. Forecast status uses the shared task surface; departure-window search can be cancelled and late/stale results cannot be accepted.

One uncached request is normally needed per leg at each tested departure, plus any long-wait splits. Fixed-return combinations reuse identical return-leg forecasts. Final stop-aware refinement may need additional requests. Missing data is never treated as a zero-delay prediction.

## Keyless investigation, October 26, 2026

Vela's current `DirectionsPb` has no future departure argument. Its parser reads live duration, a typical trip-duration range and categorical congestion spans. Its GPL source was inspected but no implementation was copied or adapted into Gasket.

Public Google Maps UI test: Boston → New York, Tuesday October 27, same I-90 route, 214 miles. At 2 AM the page showed typically 3h20–4h20; at 8 AM, 3h40–5h10. The **Depart at** control changed the route URL (`!8j...`) and survived reload. Its timestamp/timezone semantics and machine-readable future-section data are not validated for integration.

The separate **Typical traffic** layer changed its map colors for weekday/time. Changing Tuesday 8:05 AM to 5:25 PM changed neither the URL nor the route's 8 AM estimate; reloading restored Live traffic. Therefore the observed route URL does not encode that layer's selected typical clock. The layer describes one map-time snapshot, whereas route planning needs traffic when each section is reached.

Google's current documentation provides normal/slow/jam categories, not numerical speed ratios. A 2008 Google article gave fixed mph ranges, while its 2009 explanation described colors relative to road speed limits. The old fixed chart is not a defensible modern mph conversion. A future structured reader remains research, not an implemented keyless forecast or a conclusion that it is impossible.

## Primary references

- [HERE time-dependent routing](https://docs.here.com/routing/docs/routing-v8-time-dependent-routing)
- [HERE traffic](https://docs.here.com/routing/docs/routing-v8-traffic-in-routing), [durations](https://docs.here.com/routing/docs/routing-v8-duration), [spans](https://docs.here.com/routing/docs/routing-v8-span)
- [HERE flexible-polyline format](https://github.com/heremaps/flexible-polyline)
- [Google current traffic colors](https://support.google.com/maps/answer/3092439?co=GENIE.Platform%3DDesktop&hl=en)
- [Google speed categories](https://developers.google.com/maps/documentation/roads-management-insights/rmi-concepts)
- [Google's 2009 relative-speed explanation](https://maps.googleblog.com/2009/08/arterial-traffic-available-on-google.html)
- [Vela directions request](https://github.com/PimpinPumpkin/Vela/blob/main/core/src/main/java/app/vela/core/data/google/DirectionsPb.kt), [parser](https://github.com/PimpinPumpkin/Vela/blob/main/core/src/main/java/app/vela/core/data/google/parse/DirectionsParser.kt)

## 0.0.273 recovery

Unavailable/mismatched forecasts no longer suppress independent hazard checks or prevent comparison and stop planning. The original route model is used with a traffic-unavailable notice; this is not presented as a zero-congestion forecast. Exploration with no usable forecasts reports the actual source/matching error, and the arrival deadline remains optional. Arrival deadlines filter successful forecasts only.

Guide points use recorded route vertices instead of interpolated locations. Rejections include numeric offset/backtracking diagnostics. The owner's272 log alone does not prove whether HERE selected different roads or coarse geometry caused rejection; source matching is not relaxed. Failed identical requests are retained five minutes (bounded128 failures), and an explicit new exploration retries old failures while preserving good answers. Regression coverage exercises failed forecasts through actual comparison/hazard/planning flow, not only perfect synthetic source responses.

## 0.0.281 — partial matching

The owner's 0.0.280 log (2,631-mile round trip, website route lines with ~6,500 points per leg) had 565 rejected forecasts and two used ones (a 6-mile trip). HERE answered every request (~16,500 points each); the app threw each leg away at the first point outside 0.03 mile, which on every long-trip option was HERE's second point, 239 ft off at the start (HERE leaving the origin by another street). The 6-mile trip also had single points 175 / 256 ft off mid-route.

`Traffic.read` now matches stretch by stretch instead of all-or-nothing. A HERE span is used only when every one of its points is within 0.03 mile of the selected line and in order (≤ 0.04 mile backtrack), and its length agrees with the stretch it covers (within 0.02 mile or 10%), which rules out a shortcut between two matching points. Everything else keeps the route's own time (rows with `forecast: false`, `trafficMph: null`), so a mismatch never invents congestion or free flow on roads HERE didn't forecast. A leg is rejected only when under 50% of it matches. Profiles carry `coverage` and `match` {coverage, stretchesOff, spansSkipped, pointsOff, maxOffsetFeet, firstOffMile, routePoints}; "Forecast ready" is logged at info with coverage and per-leg match details, and the Route card shows "Traffic forecast covers N% of this route" below 100%. The old whole-route length and reverse-sampling checks are replaced by the per-span rules (unmatched road is simply not forecast). Cache identity `traffic-v3`.

HERE's clock on a matched stretch is its own arrival time along its route; where HERE took another road earlier, that clock can differ from ours by the difference in those stretches (minutes against hourly traffic patterns).


## 0.0.282 — remaining failures and independent provider control

The 0.0.281 export contains historical geometry failures and newer `Missing traffic speed` failures. The reader previously threw away an entire leg if any single span lacked positive finite duration, length, trafficSpeed or baseSpeed (including zero-duration connectors). Missing values now exclude only that span. The same matching rules and minimum 50% actual forecast coverage still apply. Unforecast stretches use ordinary route times and have no congestion speed. Diagnostics include `speedsMissing` and one `firstMissing` sample; no API key or full payload. Schema cache key is traffic-v4 to avoid replaying the old parser failures. This is a regression fix, not proof that every actual failed HERE response now meets coverage; the supplied log contains no full rejected payload.

Settings → Connections → **Use HERE for traffic forecasts** is a persistent global control, default on for compatibility. Off prevents subsequent forecast calls even with a trip's Forecast traffic checked, invalidates the current overlay/result/hazard approvals, and ignores in-flight answers after a settings epoch changes. It does not clear the HERE key or disable toll lookups. A request already sent can still consume a call. Google website forecasting is NOT yet a provider in this release.

## Google typical traffic investigation — October 27, 2026

Tested the actual signed-out Google Maps desktop page centered on New York at zoom12. Live traffic → Typical traffic exposes weekday radio controls and an ARIA `Time` slider. Tuesday selection and ArrowRight/ArrowLeft commands changed the selected clock, including a verified **Tuesday 5:15 PM**, while leaving the URL unchanged. `aria-valuetext` exposes the chosen local weekday/time; the generic AX slider value stayed50, so never use that number as the time. Repeated commands should verify the text after each change, rather than assume a fixed event count. Morning and late-evening screenshots showed changed congestion colors. Home/End did not change this observed slider. On this map the visible time range ended at10PM: do not silently clamp overnight requests.

The rendered roads are in three canvases, with no DOM per-road speed table. Resource inventory includes `/maps/vt/pb=...` traffic tiles, but this inspection did NOT decode a time-specific road/direction/speed dataset. The visible control is proven; reliable numeric route extraction is not. Typical weekday traffic is a historical pattern, not a date-specific prediction of holidays, incidents or weather. A single5:15PM map is not a forecast for every road of a several-hour drive.

### Proposed implementation and acceptance gates

1. Dedicated desktop website reader, initially experimental. Select Typical traffic and weekday; move the Time slider using semantic controls; verify `aria-valuetext` and wait for rendered data to settle. Preserve signed-out human verification handling; stop and prompt on real restrictions. Unsupported clocks/failed loads produce an explicit unavailable result, never silent live traffic or a clamped time.
2. Prototype a time-tagged traffic tile/vector decoder first. If the public page does not expose usable geometry, evaluate a north-up, fixed-zoom raster read with a stable map projection. Keep route overlays/labels out of the sampling area. Validate direction, parallel streets, bridges, interchanges and uncolored roads. Pixel proximity alone is insufficient to prove a match; ambiguous roads remain unforecast. Benchmark this before adopting a screen-scraping architecture for long routes.
3. Reuse the known route geometry and posted speed limits, but treat Google colors as congestion categories, not exact mph. Calibrate category speed ranges against the website's numeric departure-time route duration ranges on matched roads. Report estimated speed/energy ranges and coverage, not fabricated precise mileage. Reject any calibration that requires impossible speeds or applies opposite-direction congestion.
4. Evaluate each section at its estimated arrival weekday/local time, including stop delays, destination waits, midnight/week rollover and time zones. Recompute arrival-dependent buckets once after stop planning, with bounded refinement. Validate the route still matches Google's numeric route estimate; do not spread a new route's total delay over the selected route blindly.
5. Store observations by spatial cell, direction/road identity, weekday and clock bucket plus fetch timestamp, independent of trips/cars. Share overlapping routes and batch vehicles; one or two traffic readers initially, not the station-worker count. Bound memory, add progress/cancel/checkpoint recovery, and log selected clock, actual read clock, coverage and unavailable reasons. Define TTL after measuring changes and source load; no repeated hourly query when a compatible cell observation is already held.
6. Validate rush-hour versus overnight, both carriageways, city streets/highways, toll versus free roads, DST/time-zone transitions, round-trip delayed returns, bot checks and missing tiles. Compare numeric travel-time ranges and energy sensitivity against HERE on a small matched test set. Only then offer Google as an active provider with explicit source/coverage, retain the independent HERE switch, and decide whether HERE traffic should become off by default. HERE toll pricing remains separate throughout.

Current Google documentation specifies traffic color categories, not a stable numeric color-to-speed ratio. References above: Google traffic-layer help and Roads Management Insights concepts. Existing HERE traffic support should not be replaced merely because the forecast slider can now be controlled.
