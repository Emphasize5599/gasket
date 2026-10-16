# Remembered alternative-route answers (0.0.174)

`car.rememberRouteChoices === true` opts that vehicle into remembering Yes/No answers. Missing/false means off. It is in Route → Other routes, and ordinary settings/full-backup serialization includes it.

Active answers remain in `S.trip.routeChoices` for planner consumers, but are cleared on page initialization, New trip, shared-link new trips, saved-trip open and vehicle switches. Legacy global and unscoped saved-trip answers are never restored. A new trip can reuse cached station/routes data without reusing consent: station-cache matching does not assign the existing saved trip's history ID. New saved trip instances receive stable, unique IDs; explicit saved-trip opens keep their ID.

Saved trips store `routeChoicesByVehicle[car.id] = {answers, reviewedAt}`. Actual Yes/No answers update the current saved record immediately when opted in; a new trip first persists them when saved normally. Other vehicles' records are preserved. Opt-out removes the current trip's record for that car. Disabled cars cannot load older records in any saved trip. Existing active-session answers remain explicit answers when opting out, but are not restored on reopening.

On saved-trip open (or before proceeding beyond Hazards after switching cars), eligible remembered answers require a styled, always-on confirmation: **Use remembered** or **Review again**. Outside/Back dismissal also means review. No answers apply before acknowledgment; asynchronous results are guarded against trip/vehicle changes. Every popup cautions that forecasts likely changed after an hour, with stronger wording for an already-old record. `reviewedAt` conservatively keeps the first answer time of that review session; reusing choices, saving prices or planning does not refresh it. This avoids making partly old answers look fresh.

Remembered consent does not cache forecast approval. Hazard checks and wet-tire acknowledgments still run. Route hashes scope answers to the particular leg/option; changed options need fresh answers. Ranking never auto-selects a route.

`route-memory-ui` checks default-off and legacy rejection, actual answer persistence, saved-trip separation, distinct answers and opt-ins for two vehicles, explicit reuse, under/over-one-hour warnings, dismissal, timestamp retention, fresh/shared-link resets and opt-out at 320/448 px. No personal route or vehicle data is committed.
