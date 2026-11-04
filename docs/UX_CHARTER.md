# Gasket UX charter — draft 1

Status: working design brief, 4 November 2026. It records the owner's questionnaire answers and subsequent clarifications. Target behavior below is a design requirement, not a claim that the current app implements it. Interface redesign and behavior changes require their own implementation and validation.

## Purpose and audience

Help budget travelers build an affordable, feasible road trip whose choices, costs and limitations they understand. Support occasional travelers without requiring expert knowledge. Preserve room for frequent travelers, EVs, RVs and commercial vehicles as supported capabilities grow.

Design primarily for planning at home. Encourage trip changes while safely parked. An experienced user's ability to find advanced controls must coexist with a straightforward first planning experience.

## Principles

1. **Preserve the user's intent.** Keep original destinations, chosen roads, departure windows, selected rests and exclusions stable unless the user authorizes a change. Explain the scope of a change and retain unaffected completed work.
2. **Present decisions in dependency order.** Choose the mode before showing its fields. Fixed timing and flexible windows need a visible selector; inactive fields must not become hidden active constraints. Automatic planning choices belong at the relevant decision, not in unrelated tiles.
3. **Make the essentials obvious.** Use concise labels, clear hierarchy, larger important text and consistent emphasis. Explanations belong in question-mark help or expandable sections. Units, consequential choices and essential status remain visible.
4. **Explain visually.** Favor maps, timelines, stop sequences and illustrations where they improve understanding. Retain short text equivalents, meaningful labels, accessible contrast, enlarged-text support and reduced-motion alternatives. Color alone must not carry meaning.
5. **Make the work predictable.** Explain likely duration and data-source trade-offs before starting. Show real progress, useful time estimates and interruptions honestly. Reuse stored work and avoid surprise mid-process questions wherever they can be asked beforehand.
6. **Require only what the chosen task needs.** Require information needed for its calculations/evaluations and applicable essential safety acknowledgements. Optional features should not create requirements for users who do not choose them. Offer additional information and controls where they can improve the trip.
7. **Make uncertainty understandable.** Distinguish confirmed, imported, estimated, stored, unavailable and unchecked information. Freshness, source coverage and model confidence are different properties. Missing information must not imply safety, access, a free price or completed checks.

## Planning and cost presentation

Use a guided initial path with an editable overview of completed decisions and drill-down controls. Keep automatic/manual forks explicit. Exact navigation and screen boundaries remain to be prototyped.

Fully calculate the most promising routes before presenting their costs as decision-ready. The owner does not want a provisional cheap-looking plan substituted for the work needed for an accurate comparison. Internal candidate selection and honest progress may precede completed cost results; incomplete work must not be labeled ready.

Retain the Departure map and summary tiles. Add an expandable itinerary below the summary: original destinations with subordinate rest and fuel/charging stops, arrival/departure roles, and information needing attention.

## Hazard review

- A bulk-approval action does not stop hazard lookups.
- It approves ordinary hazards without presenting each review individually; extreme warnings are still presented.
- This convenience preference must not persist as a saved trip, vehicle or global default. Do not confuse reusable weather data with a reusable approval preference.
- Using stored information is a shortcut, distinct from choosing not to consider information. Make the potential benefit of an update discoverable.
- Precise extreme-warning categories, acknowledgement behavior and invalidation rules remain interaction-specification work. The owner's examples include tornadoes and freezing rain/ice; the catalog must also examine other consequential events, including flooding, hail and hurricane conditions. Avoid assuming a vehicle can overcome extreme exposure.

## Automatic changes

The owner accepted this policy as the current design direction:

| Situation | Behavior |
|---|---|
| Gathering information and computing alternatives | Automatic within selected sources and permissions. |
| Selecting fuel stops during initial automatic planning | Automatic within explicit constraints. |
| Updating an accepted plan | Show changes and provide an explicit apply action. |
| Replacing chosen roads/rests or moving selected departures | Preview, unless the user specifically enabled that behavior. |
| No plan satisfies constraints | Explain the conflict, offer specific alternatives and retain entered values. |

Specific automatic options supply permission for their stated behavior. Do not silently relax reserves, exclusions or time constraints to obtain a result.

## Waiting and notifications

Let users explore parts of the app that do not interfere with active work. Encourage background preparation and optional notifications. Distinguish completion from an action-needed state, including website verification. Retain progress around interruptions; do not promise uninterrupted completion when verification may be necessary.

The proposed character sequence shows planning continuing while someone packs and prepares for a trip. Treat it as a brief explanation/optional illustration, with reduced-motion support, rather than a manufactured completion timer. A real progress display remains necessary. Do not keep the user waiting for an animation after work completes.

Exact notification presentation and illustration storyboards remain to be designed. Notification permission, audibility and interruption constraints must be explained without making a ringer setting a planning requirement.

## Towing scope

Support an observed-mileage towing profile for each car. Keep towing observations distinct from ordinary driving observations, so choosing a towing profile does not overwrite normal efficiency data. Make the active profile apparent.

An adjustable larger reserve may help accommodate uncertainty. It does not correct an inaccurate consumption/cost estimate. Do not introduce an unsupported universal weather or towing multiplier.

Weight/drag/speed/grade/elevation-based predictive towing across vehicles is a separate research scope. The owner has not committed to that larger feature. Multiple trailer combinations and more advanced calibration are also future scope decisions.

## Onboarding

Explain expected waiting, optional API capabilities/trade-offs, crucial starting settings and relevant road-trip preparation. Keep required setup minimal and teach detailed parameter consequences at the point of use. Visual preparation scenarios should not imply Gasket guarantees safety or savings.

Sources and discounts need understandable provenance. The current membership-discount defaults warrant review: default-on discounts were found during the audit, but a specific replacement policy has not yet been approved.

## Existing weather/energy behavior — technical clarification

The owner was unsure whether weather-sensitive energy calculations exist. Code inspection confirms that `tripui.js` supplies cached route temperature series through `propulsionContext` to non-gas propulsion calculations. `propulsion.js` has temperature-sensitive auxiliary/cabin loads, EV thermal/charging calculations and explicitly estimated hydrogen behavior. `traffic.js` also has experimental idle/restart fuel calculations using engine context. These are not a validated universal weather correction, particularly for towing.

Route weather readers use NWS and Open-Meteo endpoints. The NWS documents its API data as free open data. Forecast availability and the accuracy of a particular vehicle-consumption model are separate questions. Do not describe the existing models as absent or universally accurate, or infer that the owner has approved disabling them. Model validation and how to expose their uncertainty remain engineering work.

Code references: `assets/web/tripui.js` (`propulsionContext`, `makeBaseOpts`), `assets/web/propulsion.js` (`weather`, `drivePower`, `thermal`, `charge`), `assets/web/traffic.js`, `assets/web/routewx.js`, `assets/web/weathernet.js`. Historical handoff documents can contain superseded defaults; inspect current code before describing present behavior.

## Validation and next design work

Use the reported tester failures as initial task scenarios: confusing sequence, dense wording, insufficient visuals, unexpected waits, and route/window constraints producing an unexplained failure. Verify causes with reproducible scenarios instead of assuming the reported failure's cause.

Next: map the decision dependencies and required inputs; prototype the guided flow and editable overview; specify ordinary/extreme hazard behavior; storyboard waiting/onboarding; test comprehension and recovery with users. Measure task completion, assistance needed, errors, unexpected rework and waiting expectations. Automated layout tests supplement observed usability testing.

Method references: [ISO human-centred design framework](https://www.iso.org/standard/77520.html), [Double Diamond](https://www.designcouncil.org.uk/resources/the-double-diamond/), [product-specific design principles](https://www.nngroup.com/articles/design-principles/), [long waits and interruptions](https://www.nngroup.com/articles/designing-for-waits-and-interruptions/), [NWS API documentation](https://www.weather.gov/documentation/services-web-api).
