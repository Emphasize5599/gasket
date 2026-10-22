# Vehicle comparison

Implemented in 0.0.236 (0.0.235 was source-only after a release-test failure). Compare is step 8, between Stops and Depart (now 9),
including with only one garage vehicle. Compare another vehicle opens the garage
picker; Add vehicle below it opens the existing editor. A new participant starts
at Advice and follows Route, Parameters, Hazards and Adjustments independently.

## Boundaries

Each vehicle owns starting fuel, price, buffer, detour, arrival/charging policies,
speed settings, selected/considered routes, vehicle model, hazard cache/approvals
and optimized result. Destinations/order and departure/return schedule are common.
Changing the schedule invalidates other results and reviews; changing destinations
restarts the comparison. Gas raw station/grade data can be reused and re-filtered;
EV/hydrogen connector-specific results and adjusted prices are not copied to a
different vehicle. Existing provider caches still apply.

Selecting a ready card restores its actual result and opens Depart without calling
discovery or the optimizer again. Cards select a whole-trip vehicle; the per-leg
view is informational, not a plan to change cars mid-trip. Switching is blocked
during active routing, discovery, route-combination planning or editor recalculation.

Edit vehicle returns to the same sort/scope/leg. Cosmetic changes retain results.
Compatible gas/grade edits rebuild consumption/capacity and speed rates, then
recalculate in the planner worker using cached candidates. Other changes require
setup/discovery with the new profile. Both require renewed setup/hazard review;
other vehicles retain their plans. Discarding a new vehicle restores the original
plan, including temporary in-memory route answers.

## Metrics

Default ordering is estimated consumed-energy cost plus known tolls; shortest
travel time is optional. Purchase totals are separate: a full starting tank is not
a free trip. Existing weighted energy accounting reconciles leg and trip costs.
Unknown prices/tolls are not zero; confirmed free chargers remain valid. Estimated
prices are labeled. No winning cost badge is shown while participants are pending
or have missing cost inputs.

Time includes driving, per-road speed changes, detours, setup, refueling/charging
and destination charging, with scheduled return-trip dwell absorbing overlapping
destination charging. Per-road time savings are clipped to the affected leg.
The existing estimates are not charging curves or queue predictions. Parking and
session fees without supported sources are not added. Item 50 remains open.
`VehicleCompare.metrics` accepts price/time adapters for later infrastructure.

## Persistence and safety

Drafts live inside the existing saved-trip record, so existing backup/deletion
applies. They do not serialize optimized results, live models, hazard approvals,
review timestamps or temporary alternative-route consent. The existing explicit
per-vehicle saved-trip remembering toggle remains the only persistent consent
path, with its existing forecast-age popup. Reopened comparison drafts require
review. In-memory reviews expire after an hour; configuration/route/schedule
changes invalidate them earlier. Reader cache bookkeeping and empty editor
defaults do not invalidate a configuration fingerprint.

## Validation

`vehiclecompare.test.js`: full/part-filled fairness, costs versus purchases,
missing/free rates, tolls, leg reconciliation, refueling/setup/detour times,
per-road speed savings, return-dwell overlap, sorting, adapters and safe drafts.

`vehiclecompare-ui.test.js`: 320/448px real planner flow with two legs and two cars,
single-vehicle discoverability, isolated fuel/buffer settings, cached departure,
expanded route maps, scope/sort preservation, edits, cached recalculation,
discarding edits/new cars, saved drafts and renewed review after reopening.
Existing EV, route-choice memory, editor, departure and UI suites remain gates.

Phone checks: plan the same trip for gas and EV vehicles; inspect full-trip and
per-leg costs/time, change sort, edit a vehicle and save/discard, select the other
completed plan, then reopen the saved trip and confirm reviews are required.
