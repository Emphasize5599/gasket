# Flexible trip timing

## Current requirements (0.0.280)

The owner replaced exhaustive combination optimization with recommendations on October 26, 2026. Cost/time preference comes first; clearer weather breaks ties. Screen every approved hourly option cheaply, then fully plan promising candidates. Do not claim a global optimum.

## Flow

1. Route: enable Plan within a time window. Choose a departure or final-arrival window; both endpoints are required. A checkbox enables the opposite constraint, also requiring both endpoints. Destination arrival/departure constraints have explicit enable checkboxes and required pairs. Disabled constraints are not enforced. The final arrival constraint is edited only once. Immediate returns derive their departure instead of exposing a second departure constraint.
2. Hazards: Review route hazards replaces Choose roads and times. First select roads you would consider without hazards. Then accept/decline known hazards within the specified windows, rather than approving departure times. Consecutive identical physical hazard exposure groups together; absolute ETA stamps alone do not create a new question. Clear conditions need no second approval. Optional hazard rules still control automatic approval; explicit previous declines and tire acknowledgements remain authoritative.
3. Missing air-quality coverage is non-blocking: it does not create another approval or change the consent signature. Known unhealthy-air hazards still obey the user's rules. Unresolved weather/warning data and pending warning ratings still require review. Source-classified air-service failures appear as a consolidated Stops notice for the selected legs.
4. Stations are gathered once and shared by candidate plans. The recommendation ranker visits each approved hourly route and retains a bounded dynamic-programming frontier (8 labels per state, route-sequence diversity). Estimates use route timing, cached traffic if available, representative known station prices, energy, tolls, and service-time estimates. Estimated timing violations rank behind apparently feasible choices. These estimates are not a feasibility proof.
5. At most 48 paths leave ranking. Fully plan up to 16 distinct promising trips initially; if none works, continue through the remaining shortlist. Derived-return hour variants share a plan key. Refine at most two verified candidates across buffer/detour trials, leaving speed unchanged. Costs, reserves, chargers, prices/tariffs, destination charging, actual arrivals/departures, and hazards are checked by the real planner. A recommendation is not returned merely because its estimate fit.
6. A leg without a fixed departure/wait constraint starts when the preceding leg is ready. After stop/charging times are known, align the next leg to its approved forecast hour and rebuild if needed (up to three corrections). This avoids forcing immediate returns to wait for a forecast-hour boundary. Changed hazards requiring approval are reviewed only if there is no already-verified recommendation; allowed/clear conditions can continue automatically, with explicit declines and tire safeguards preserved.
7. Stops shows recommendations and missing air-quality notices. Failed recommendation planning stays in Stops with its error and a path back to Parameters. Departure shows the actual per-leg leave/arrival times, chosen roads, waits and checked hazards.

## State and limits

Configuration: `S.trip.windowPlan` = `{enabled, mode, start, end, otherEnabled, otherStart, otherEnd, priority, destinations:[{arriveOn,arriveStart,arriveEnd,leaveOn,leaveStart,leaveEnd,wait}]}`. Legacy earliestLeave remains readable until the window form is saved. Arrival-only searches derive a bounded departure range from travel estimates when no departure constraint is supplied. Forecasts remain hourly; enabled windows are capped at fourteen days.

Consents remain in memory per car, expire after one hour or relevant setup changes, and apply to specific routes/hours/known hazards. Shared station persistence and successful forecast caches remain independent of this recommendation shortlist. Missing data is never described as a clear forecast.

The pure legacy `TimeWindows.search/count` helpers remain as a small-case regression oracle; production window planning uses `shortlist/recommend`. Large multi-leg searches use bounded frontier labels, so even the cheap stage does not enumerate an exponential Cartesian product. A failed shortlist does not prove all possible trips are impossible.

## Tests

`window-recommendations`: above 19,620 combinations, bounded expensive plan callbacks, input yielding, cost/time/weather ordering and grouped declines. `window-form-ui`: required pairs and enabled opposite/destination constraints at 320px. `windowplanning-ui`: departure/arrival modes, excluded rain, cancellation, non-blocking air notices in Stops, zero-wait return and per-leg Departure cards. `hourly-approval-ui`, `hourly-weather`, `timewindows`: source failures, fallback, coverage, consent, grouping, cache reuse and responsiveness.

## Shared priority and toll constraints (0.0.280)

`car.planningPriority` is the single cost/time objective for window, ordinary automatic and comparison planning. `car.autoTripEnabled` controls automatic buffer/detour adjustment separately; windows require it effectively on. Legacy autoTripPriority remains readable/derived for existing state. Route and window selectors synchronize, including cached Route HTML. Planning preferences are excluded from the mechanical vehicle profile and objective alone does not change comparison journey identity; current window-state keys include objective and toll policy explicitly.

`car.tollPreference={allowPaid,limited,scope:'leg'|'trip',max}` applies to time-first planning. Paid tolls default off. Opting in without a cap allows unknown amounts; a cap requires known prices for every leg, with a single maximum either on each leg individually or on their sum. A zero cap is valid. Cost-first planning continues comparing total cost including tolls; its separate Avoid tolls choice is restored when switching back from Time. Known toll-free options are reused. Google toll metadata/HERE pricing can be requested independently of fetching extra toll-free routes. Ordinary automatic plans, window plans, alternative replacement, EV recovery and departure export enforce policy. Unknown/cap-blocked routes cannot masquerade as free. Route has an explicit update action when current prices/options cannot satisfy the constraint.

Tests: planning-policy, planning-policy-ui, expanded autotrip-ui (paid opt-in/cap), windowplanning-ui (two $6 legs with $10 per-leg versus $10 total), vehiclecompare-ui and tolls-ui.
