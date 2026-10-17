# Open work

The single backlog for Gasket: features, defects, validation and release decisions. Updated through **0.0.182**, 2026-10-17, including the owner's completed-item confirmations. Add new work here. Remove completed work; move retired, irrelevant or out-of-scope ideas to [RETIRED_WORK.md](RETIRED_WORK.md). Historical implementation notes stay in `CHANGELOG.md`, `CLAUDE.md` and `KEYLESS_EXPERIMENT.md`; `COMPLIANCE.md` is a service/rights reference, not a second task list.

Keep existing item numbers so references remain valid; gaps are intentional. New entries start at 48 (do not reuse completed/retired numbers). Items are grouped by category, so numeric order does not imply priority.

## feat — product features

### Vehicles and fuels

3. [ ] **Full plug-in hybrid planning.** Import EPA electric range and electricity consumption, accept starting charge, account for battery depletion and gasoline use, offer optional charging stops/destination charging, and split trip cost between electricity and fuel. Current PHEV planning uses gasoline mileage and tank capacity.
4. [ ] **End-to-end flex-fuel / E85 integration.** VIN recognition currently helps match the EPA's flex-fuel versions, but E85 is not a selectable fuel grade or planning option. Expose flex-fuel capability in vehicle setup; add E85 prices/station discovery and EPA alternate-fuel mileage (`cityA08`, `highwayA08`, `combA08`), then compare compatible gasoline/E85 choices by trip cost and range.
5. [ ] **EV/hydrogen map controls and detail sheets.** Add direct connector choices to the fuel-mode options and bring alternative-fuel stations into the common station-detail experience, with usable per-kWh/per-kg prices and availability where the source supports them. Existing connector filtering from the selected car, station popups, speed/pressure selectors and basic route stops must be retained.
6. [ ] **More realistic EV/hydrogen trip estimates.** Improve price reliability, charging curves/times and temperature-dependent range beyond the current basic estimates. AFDC station discovery along routes, plug compatibility, charging-stop planning and approximate charging durations already exist; this is an improvement task, not a new planner from scratch.

### Tires and trailers

38. [ ] **More succinct AI responses.** Make the larger model's responses shorter and easier to scan while preserving essential facts, affected tires and important safety information.

9. [ ] **Tire dry-rot and aging information screen.** Cover sidewall cracking/dry rot, age-related rubber hardening and reduced grip even when tread remains, date-code reading, inspection and tire-maker age/replacement guidance. Keep age/condition separate from the generalized tread estimate; research the guidance before writing the screen.

### Route hazards and climate

47. [ ] **Redesign hazard warning menus with animations.** Use concise, focused animations to make each hazard and its vehicle-specific consequences understandable without a text wall. Preserve accessible text, reduced-motion support and explicit acknowledgment where required.

### Vehicle images

11. [ ] **Scenic backgrounds.** Let users place their recreated car image into licensed environments inspired by the idea of Gran Turismo Scapes, without using its assets. Design background selection, placement/compositing and required attribution.
12. [ ] **Richer optional doodles.** Consider more wheel detail, roof racks and two-tone paint. This is an existing enhancement idea, not a replacement for vehicle photos.

### Discounts and trip optimization

14. [ ] **Cash-price offers and comparisons.** The current one-price-per-grade model does not preserve payment eligibility; Google fuel-price responses have no cash/card field. Add separate explicitly labeled offers, cash/card preferences, correct reward/cashback eligibility and history/cache support, then verify real source coverage. Never infer that an unlabeled price is cash. Findings and a proposed design are in [DATA_OPTIONS.md](docs/DATA_OPTIONS.md).

### Onboarding and visual explanations

46. [ ] **Simpler UI flow for everyday users.** Assume users will read very little: make the next action obvious, group related inputs where users expect them, and use concise labels, progressive disclosure and visual feedback instead of explanation walls. Validate common setup and trip tasks with people unfamiliar with Gasket.

42. [ ] **Tire rules submenu and acknowledged issue alerts.** Put all tire configuration rules in a dedicated submenu instead of explaining every rule in a text wall. When a tire configuration issue occurs, show a compact, initially collapsed alert that expands to explain the specific problem and affected tires. Require the user to acknowledge that they understand the issue; do not treat dismissing it as acknowledgment. Keep this rules-based experience useful without the larger AI.
44. [ ] **How to read a tire size code.** An interactive lesson on a size like `265/45R21 101V`: tap each part (section width, aspect ratio, construction, rim diameter, load index, speed rating, and the DOT date code) to see it on an animated tire drawn to scale, with the app's character (item 45) standing beside it for size. Reach it from the tire size box's (?) and Tire details. Keep a short text explanation for accessibility.
45. [ ] **Design the app's character.** One recurring figure for the app's animations (tire lessons, help screens, onboarding, future explanations). Decide his look, proportions (a real adult height, so he works as a size reference), poses and expressions, and a style that fits the app in light and dark mode. Use the app's own artwork, not licensed or borrowed characters.
33. [ ] **More animated explanation menus.** Use short, focused animations or interactive demonstrations to explain concepts where they communicate more clearly than verbose text. Build on the existing animated tire explanations.
34. [ ] **Visual help behind question marks.** Let applicable (?) controls open video, image or animation explanations when those are more effective than text. Choose the format for the topic rather than using media everywhere; retain a concise accessible text explanation.

## perf — measurements and efficiency

16. [ ] **Find new ways past the station-scan performance ceiling.** Continue beyond 0.0.182's measured desktop graphics filter, lower-allocation parser, selective recovery and opt-in aggressive admission. Phone logs confirmed large-AI memory competition; compare identical routes after model work finishes, then standard/aggressive 20 and 50 workers. Investigate redundant work, scheduling, shared route coverage, reader lifecycle and persistence overhead while preserving coverage, cancellation and stability. Measure actual phone concurrency/memory and stress-test the optional 50-reader ceiling; desktop memory savings are not proof of safe phone limits. Measurements and rejected experiments: [reader performance](docs/READER_PERFORMANCE.md). Related to item 17.

17. [ ] **Actual web traffic and cache efficiency.** Extend 0.0.181's desktop transfer/renderer-memory and exact-frame parser measurements to actual Android WebView cache hits/misses and more areas/grades. Compare station identities and prices, not only counts; check recovery frequency and non-regular price availability on phones. Investigate safe response reuse beyond the measured graphics filter; a fetch/XHR observer and disabling WebGL were measured and rejected. See [reader performance](docs/READER_PERFORMANCE.md); related to item 16.

## chore — release, services and rights decisions

18. [ ] **Google data handling before broader distribution.** Recheck current terms and decide how saved Places/Routes answers, persistent station-price history, Google-derived data on the OSM map, and automated directions/station-page reads will be supported. Preserve the implementation inventory in [COMPLIANCE.md](COMPLIANCE.md), entries 1–3. This backlog does not resolve those questions.
19. [ ] **Direct website provider arrangements.** Review supported feeds/permission or an alternative workflow for Walmart, Murphy USA, ExxonMobil, Tire Rack and Brave Search, covering both tank and spare-tire answers. See compliance entries 4–8. Keep restrictions visible and do not bypass site checks.
20. [ ] **Vehicle-image rights for broader distribution.** Resolve NHTSA/EVOX image reuse, Fuel API licensing and any proposed keyless stock-photo source; retain per-photo Commons attribution and applicable image restrictions. See compliance entries 9–11.
21. [ ] **Data-service capacity and distribution model.** Decide whether personal-use service limits fit the intended audience. Recheck Open-Meteo's plan if use becomes commercial and choose hosted/regional OSM data if public Overpass cannot support the audience. No service purchase is authorized merely by this task.
22. [ ] **Keyless experiment promotion.** After device acceptance and the relevant service decisions, decide when to merge into `main`. Preserve the regular app's package/resource identity rather than copying the separate test-app identity blindly. Public beta readiness is a separate decision from merging personal test improvements.
23. [ ] **Beta release setup — later milestone.** Set up the proposed beta/RC version naming and distribution process when a beta candidate is ready; keep Android version codes increasing.
