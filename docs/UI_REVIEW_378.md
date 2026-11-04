# Menu review — 0.0.378

Reviewed against [the UX charter](UX_CHARTER.md), November 4, 2026. This is a presentation pass, not implementation of every future behavior in the charter.

## Decisions

- Choose fixed times, time windows, or overnight planning before entering dependent times. Preserve exact-time drafts when changing modes. Keep route loading and round-trip choices available in every mode.
- Use switches for ongoing behavior preferences; checkboxes for memberships, vehicle facts, source categories, amenity filters, and acknowledgments. Keep native inputs, keyboard operation, existing handlers, and saved values.
- Keep errors, freshness, attribution, coverage, estimates, and consequential choices visible. Put technical worker settings and secondary explanations in disclosures. Do not change membership economics or silently relax trip constraints.
- Use a clear heading hierarchy and wrapping buttons. Bound dialogs to the viewport. At narrow widths, present campsite rate rules as labeled vertical cards, retaining all rate dimensions.
- Put an expandable itinerary below Departure summary facts. Original destinations, subordinate rests, and fuel/charging stops retain their distinct roles. Do not invent intermediate arrival times when only route distance is known.
- Reserve empty outlined illustration areas in onboarding, time-window planning, vehicle preparation, hazard advice, and automatic planning. No animation assets or animation implementation were added.

## Coverage

The review combined live browser interaction, individual screenshots, contact sheets, and the release browser suite. It covered these menu families, including existing layouts that were retained:

| Family | States reviewed / treatment |
| --- | --- |
| Onboarding | Six steps, optional access/downloads, demo vehicles, worker settings, Back-state preservation; shorter hierarchy and outline panel |
| Map and station controls | Fuel modes, station lists/details, refresh and mode menus, hidden-station feedback; shared wrapping controls retained |
| Settings | Map, rest, trip, savings, connections, local AI, data/privacy, help; behavior switches, membership/filter checkboxes, collapsible worker controls |
| Garage | Vehicle selection, EPA/custom identity, NHTSA, VIN, photo picker, comparison, tires, trailer/towing, climate, charging; shared hierarchy and bounds, narrow EPA tiles corrected |
| Vehicle preparation | Advisory cards, roadside cash/help, acknowledgments; illustration space and existing detailed help retained |
| Route and timing | Fixed/window/overnight modes, departure/return controls, date wheels, local-time/DST dialogs, intermediate deadlines; mode moved before dependent fields |
| Roads and hazards | Road selection, weather review, ordinary/extreme advice, confirmations; existing consent semantics retained, illustration space inside advice |
| Stops and adjustments | Automatic planning, feasible alternatives, manual adjustments, refresh prices, rest directory, screening, add/manage rests, timing; wrapping actions and bounded retry row |
| Rest settings and rates | Source filters, unavailable/disabled source explanation, price freshness, memberships, amenities, user price rules; responsive rate cards and disclosures |
| Departure | Summary, expandable itinerary, per-leg/individual directions; summary precedes detailed itinerary |
| Shared dialogs | Help, choices, discard/delete, import/export feedback, loading/errors; viewport-bounded scrolling and wrapping labels |

## Visual assessment

Captured 56 targeted final screens at 320px light and 448px dark. The broader instrumented release run collected 880 screenshots across 145 heading/expansion combinations, including duplicate states and test fixtures. Those counts are collection coverage, not a claim that 145 separate production menus exist or that every screenshot was individually inspected. Contact sheets and selected individual images were inspected for hierarchy, discoverability, text load, button legibility, alignment, and viewport fit. Actual browser tests exercised the flows rather than relying on static mockups.

Visual review found and corrected a retry label squeezed into a one-character column, a range control overflowing with enlarged text, and an EPA tile grid retaining implicit columns. The final timing screen presents a compact mode choice before its fields; rest settings show a short list of expandable sources rather than a continuous technical form. Detailed help pages remain text-heavy by design because the user explicitly opened an explanation.

## Verification and limits

All 233 local release test groups passed in 353.3 seconds, including native gates with a JDK configured. New regression coverage checks control semantics and keyboard use, preserved timing drafts, route-loading access in window mode, enlarged-text source filters, EPA tiles, and retry bounds. Existing rate, saved-rest, traffic, itinerary, and settings tests were updated to interact with real disclosures.

This is an agent visual review, not a human usability study. Browser rendering does not verify Android WebView font scaling, screen-reader announcements, touch ergonomics, or native app handoffs. Waiting-time accuracy, bulk hazard approval policy, and further towing capabilities remain separate functional work; this pass does not claim to implement them.

Phone checks: walk through onboarding and every Settings group; try large system text; switch timing modes and back; load routes in window mode; retry unavailable checks; edit a multi-rule campsite rate; expand Departure's itinerary and individual directions. Confirm labels wrap, actions remain reachable, drafts persist, and no unintended horizontal scrolling occurs.
