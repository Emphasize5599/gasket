# Traffic forecasts and departure windows

## Implemented in 0.0.272

Route → **Forecast traffic** uses the optional HERE key. **Explore departure times** checks selected roads within user-entered windows and presents colored sliders. All congestion levels remain selectable. Gray means no usable forecast, an unmet arrival deadline, or a return departure before reaching the destination. No time changes until **Use these times** is pressed.

Green means at most five additional driving minutes versus the lowest tested value with the other slider held fixed; amber means up to fifteen, red more than fifteen. These are Gasket's comparisons of numeric duration forecasts, not Google's traffic colors or a road-safety classification. Major ticks show clock time and added driving minutes. Sampling defaults to hourly; it does not prove the optimum between samples. Each window is at most 48 hours / 25 samples. Users can narrow the window or change the interval.

Immediate-return comparisons include the entire round trip, including return congestion at the projected arrival time. Manual return compares both windows and presents separate sliders. Known stop, charging, destination and fixed-return waits advance the clock. Final acceptance invalidates prior route/hazard acknowledgements and planning results; existing station inventories remain reusable. Weather, energy, prices/tariffs and stops are rebuilt for the chosen times.

## Source and matching

HERE Routing v8 receives an actual ISO departure instant, sampled pass-through points on the selected line, avoidance settings and timed stops. It evaluates later sections at their projected arrival times. `departureTime=any` is never used. Numeric span durations and dynamic speed fields are required. The flexible-polyline decoder is independently implemented from the documented format, not copied from another project.

Responses must match route length within 2% (minimum tolerance 0.03 mile), cover both endpoints, progress in order, and lie within 0.03 mile of the selected geometry; reverse sampling also rejects shortcuts. Each leg is matched independently, including repeated roads on an out-and-back. This is conservative corridor matching, not proof of identical lane/road IDs: closely parallel roads remain a validation concern. Failures are reported rather than silently using a newly chosen HERE route.

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
