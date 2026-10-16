# Wet-weather route confirmation

Implemented for backlog item 39 in 0.0.172. This is deterministic and works without either AI model.

## Inputs and review thresholds

Use `TirePolicy.snapshot` and the route's existing ETA-based hazard result. Include measured and estimated depths for car road tires and hooked-up trailers; exclude the stored spare. Unknown depths are not treated as zero or as proof of good tires.

- Rain, thunderstorms, flooding and tropical storms: prompt at 4/32 in or less.
- Snow or ice: prompt at 5/32 in or less. This is a precautionary winter review trigger, not an ice-traction test or a claim that deeper tires are safe.
- At 2/32 in or less, emphasize replacing worn-out tires before driving.

Sources checked 2026-10-16: [Tire Rack's replacement guidance](https://www.tirerack.com/upgrade-garage/when-should-tires-be-replaced) gives approximately 4/32 for wet roads, 5/32 for snow and 2/32 for dry roads; [its tread-depth explanation](https://www.tirerack.com/upgrade-garage/how-much-tread-depth-is-enough) explains reduced water evacuation and snow traction. [Michelin](https://www.michelinman.com/auto/auto-tips-and-advice/tire-damage/tread-problems) says not to continue using tires at the wear bars.

These are review thresholds, not legal limits for every jurisdiction or comprehensive suitability checks. Compound, temperature, speed, water depth and tire condition also matter. Vehicle-aware ranking and broken-A/C integration remain items 40 and 41.

## Interaction and lifecycle

Confirm before changing a route from its tile or map, continuing past the default route, advancing through legs/tabs, or answering Yes to considering a cheaper alternate. Cancel, outside dismissal and Back never acknowledge the warning. The explicit acknowledgment still applies if deletion confirmations are disabled.

Reuse any in-flight forecast promise rather than performing another lookup. Vehicles without known low tread never wait for a forecast solely for this check. Forecast failures retain the existing unavailable-forecast message, not a new assurance of safety. Do not wait for AI rerating; use currently classified hazards and recheck if classifications change.

Acknowledgments stay in memory per route and tire/hazard/timing signature, not in backups. Revalidate after the dialog before accepting; tire edits, relevant hazard changes, departure/earlier-leg timing changes and closing the trip invalidate acknowledgment. Group matching tire depths to keep the dialog compact; additional distinct groups are expandable. Unknown/unclassified weather statements do not become wet-weather hazards by guessing from arbitrary text.
