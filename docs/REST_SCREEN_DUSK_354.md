# Civil-dusk context and rest-candidate screening — 0.0.354

## Departure-window context

`routedusk.js` follows each existing route clock and solves the first downward crossing of solar altitude -6 degrees (end of civil twilight). It samples nine departures within the entered window across up to three available road choices. After reaching the next endpoint, its position stays there to provide that evening's context for a short drive. Late departures report that civil dusk already ended at the departure location; polar/no-event cases report no estimate instead of inventing a time. Tests compare stationary-endpoint results against the existing SunCalc/Overnight event calculation within five minutes.

WindowPlanning places the hint below Latest for the origin and each intermediate destination's departure window. It updates after edits and DST-fold choices, formats times in that departure location's IANA zone, and includes dates when the band spans calendar dates. It does not fill or change any window bounds. Different departure times can put the user at different positions at dusk, so the band is an estimated route context, not a guaranteed light/dark boundary.

The helper uses a matching cached traffic profile where already available, otherwise existing route timing. It requests no new traffic, timezone or weather data. Base road models are memoized by raw route/car profile so typing does not repeatedly decode a large route. Dusk hints are debounced 200ms. Final fuel stops, terrain, shade and later route choices can change actual conditions; window validation and final planning remain independent.

## Candidate screening

Inventory and needed facility/price facts still establish which results meet source filters. Before broad road-access checking and automatic departure recommendations start, the rest tile and opened leg list prompt **Screen rest candidates**. Full candidate names/images/actions are available during this step without waiting for every road-access check. An explicit Add may perform the one site's required access checks.

- **Hide candidate** temporarily removes a source ID across this trip's candidate lists, counts, broad access jobs and traffic samples. It does not remove an already added rest from the route, delete source records, change provider facts or clear route caches.
- **Show excluded candidates**, **Restore candidate** and **Restore all candidates** let the user undo screening. A hidden row cannot be added before restoration. Existing source/price/nightly filters still apply to the hidden view.
- **Continue with remaining candidates** starts the existing access/recommendation workflow. Requests already answered remain reusable. Automatic/manual continuation and counts are logged, without trip coordinates.
- Owner chose **two minutes**. The visible countdown starts when results/facility checks are ready. Touch, pointer, scroll, typing and other interaction on this screen reset 120 seconds. **Keep screening** pauses it; Resume restarts a fresh interval. A different subpage or an unavailable trip snapshot resets/stops the idle period so editing rates/settings does not silently finish screening.
- Inactivity starts forecasts for the remaining candidates. It does not add rest stops, choose rest departures, acknowledge parking permissions or accept a final trip. Those remain explicit user decisions.
- Preferences persist with the saved trip, scoped by history ID, original non-rest locations, source filters and detour limit. New candidate IDs require screening again. A different signature clears temporary exclusions; provider/cache data remains intact. Reopening an accepted same candidate set can reuse its screening decision.

The countdown uses the app's normal JavaScript scheduler. Physical-phone lifecycle/background scheduling is not verified; automated checks cover active-screen behavior, pause/reset and screen-context guards.

## Verification

New pure checks cover moving east/west, route-clock changes, late/polar/DST cases, trip-scoped hide/restore, new candidates, idempotent continuation, 120-second inactivity, interaction resets and paused/inactive contexts. New browser checks cover both origin and intermediate departure hints below Latest, live field edits, late departures, hide/show/restore, no broad access/forecast before screening, automatic continuation excluding hidden places and 320/448px layouts. Screenshots were inspected at 320px. Existing workflows explicitly continue screening before expecting background work; the unpriced/unknown-source filtering and access-failure checks remain in place.

Final release-suite/CI and signed APK verification results are recorded after completion. Phone checks: edit both departure windows; screen a multi-leg list; hide/restore places; let the two-minute countdown expire while on screening; verify forecasts and then complete normal stop/parking/time review. Keep all saved data.

Local checks: new-feature group passed all four in 8.7s; full local release run checked 217 in 305.0s with 214 passing. EV recovery and vehicle comparison passed a subsequent paired rerun (32.1s/33.9s); the rest fixture needed its programmatic setup click for a second injected list, consistent with that fixture's existing setup click behind a leftover confirmation overlay. Final restui/restscreen/rest-screening-ui/routedusk/route-dusk-ui group passed all five in 28.0s. Complete windowplanning-ui also passed in 76.5s. New user-facing screening tests use actual clicks and inspected screenshots at 320/448px.
