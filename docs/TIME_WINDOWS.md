# Flexible trip timing (time windows)

Added in 0.0.274 (Codex's design, finished in Claude's session). The owner asked for:

> The user can give the app their leave time window (or their arrival time window) and then the automatic planning can have them choose whether to consider the windows with the least cost or the windows with the least time. Then, there would have to be a screening step before the hazards where the app would ask the user whether they would consider a route if it had no hazards. Then, out of all the routes they said they would consider, the app would need to ask them for each route if they would consider it on a separate screen for every hour as the projected hazards change. Then the app needs to take all the yeses and build routes that make sense out of it. So on the trip overview for each leg, it should tell the user when to leave and what route to take.

Owner decisions: departures are hourly (the route forecasts are hourly); consecutive hours with identical conditions share one screen; waits at destinations are allowed, each destination with its own optional arrival / leave-again windows or extra minutes of waiting; every approved combination is checked before anything is shown.

## Flow
1. **Route** → "Flexible trip timing" (`windowplanning.js`, `S.trip.windowPlan` = {enabled, mode depart | arrive, start, end, earliestLeave, priority cost | time, destinations[{arriveStart, arriveEnd, leaveStart, leaveEnd, wait}]}), saved with the trip. While on, the single Leaving / Head back boxes are hidden.
2. **Hazards** becomes the review: first, for each leg's routes, "Would you consider these roads in clear conditions?" (no forecast work until then: a declined road is never read). Then each accepted road is read for every departure hour in the window (`TimeWindows.readings`, two at a time, a Tasks row with progress and cancel), and hours with identical conditions are grouped (`TimeWindows.group`, a missing / failed forecast never counts as clear). One screen per group: map, conditions, Yes / No; Yes on low tread in wet / snow conditions still needs the usual confirmation.
3. **Compare → Next** plans: stations are gathered once for all approved roads, then every approved route × hour path (legs in order, a later leg never before the earlier one could finish) runs through the real planner (`planAsync`, prices, stops, tariffs) with `legDepartures` / destination waits (`T.scheduleTimeline`, `T.travelClock`). Each candidate is re-checked against the forecast at its *actual* times after stops and waits (`windowConditions`); conditions the user hasn't answered go back to them as another review (`reviewChanges`), never assumed. Arrival windows and leave-again windows are enforced on actual times. Best = lowest cost (then time) or shortest elapsed time including waits (then cost).
4. **Departure** shows "When to leave": per leg, the leave time, the route to take, the expected arrival and any wait first (`scheduleHtml`), and the map shows the conditions each leg was checked in.

Approvals live in memory for the car and expire after an hour or when the trip, car, routes, speeds or windows change (`windowStateKey`); they are not saved with trips.

## Limits
- Hourly granularity; within an hour the planner departs at the hour it was approved for (or later, when an earlier leg finishes inside that hour).
- The number of combinations is the product of approved hours per leg (`TimeWindows.count`); a 14-day window cap keeps it bounded, but long multi-leg windows with many approvals can take a while (each one is a full plan).
- Forecasts beyond the NWS hourly range use the existing fallbacks; times are estimates.

Tests: `timewindows` (grouping, consent, missing data, changed conditions, arrival windows, cost / time choice, waits, cancellation), `windowplanning-ui` (real UI at 320 / 448: road screening before any forecast, grouped hours, a declined rainy hour never planned, per-leg waits, arrival window honored, Departure's per-leg leave time and route).
