# Open work

The single backlog for Gasket: features, defects, validation and release decisions. Reconciled against the keyless test branch through **0.0.154**, 2026-10-14. Add new work here. Remove completed work; move retired, irrelevant or out-of-scope ideas to [RETIRED_WORK.md](RETIRED_WORK.md). Historical implementation notes stay in `CHANGELOG.md`, `CLAUDE.md` and `KEYLESS_EXPERIMENT.md`; `COMPLIANCE.md` is a service/rights reference, not a second task list.

Keep existing item numbers so references remain valid; gaps are intentional. New entries start at 36 (do not reuse completed/retired numbers). Items are grouped by category, so numeric order does not imply priority.

## feat — product features

### Vehicles and fuels

35. [ ] **VIN decoding feedback and failures.** Show the loading indicator in the year / make / model section while a VIN is being decoded, and clear it on success, failure or cancellation. Investigate and fix engine / transmission decode failures as well.
3. [ ] **Full plug-in hybrid planning.** Import EPA electric range and electricity consumption, accept starting charge, account for battery depletion and gasoline use, offer optional charging stops/destination charging, and split trip cost between electricity and fuel. Current PHEV planning uses gasoline mileage and tank capacity.
4. [ ] **End-to-end flex-fuel / E85 integration.** VIN recognition currently helps match the EPA's flex-fuel versions, but E85 is not a selectable fuel grade or planning option. Expose flex-fuel capability in vehicle setup; add E85 prices/station discovery and EPA alternate-fuel mileage (`cityA08`, `highwayA08`, `combA08`), then compare compatible gasoline/E85 choices by trip cost and range.
5. [ ] **EV/hydrogen map controls and detail sheets.** Add direct connector choices to the fuel-mode options and bring alternative-fuel stations into the common station-detail experience, with usable per-kWh/per-kg prices and availability where the source supports them. Existing connector filtering from the selected car, station popups, speed/pressure selectors and basic route stops must be retained.
6. [ ] **More realistic EV/hydrogen trip estimates.** Improve price reliability, charging curves/times and temperature-dependent range beyond the current basic estimates. AFDC station discovery along routes, plug compatibility, charging-stop planning and approximate charging durations already exist; this is an improvement task, not a new planner from scratch.
7. [ ] **Verified marketing trim beyond NHTSA's decode.** Find a manufacturer-backed source or verified generic mapping when the marketing trim is missing. Secondary trim text is supported; internal grade codes are not evidence of a marketing trim.

### Tires and trailers

9. [ ] **Tire dry-rot and aging information screen.** Cover sidewall cracking/dry rot, age-related rubber hardening and reduced grip even when tread remains, date-code reading, inspection and tire-maker age/replacement guidance. Keep age/condition separate from the generalized tread estimate; research the guidance before writing the screen.

### Vehicle images

11. [ ] **Scenic backgrounds.** Let users place their recreated car image into licensed environments inspired by the idea of Gran Turismo Scapes, without using its assets. Design background selection, placement/compositing and required attribution.
12. [ ] **Richer optional doodles.** Consider more wheel detail, roof racks and two-tone paint. This is an existing enhancement idea, not a replacement for vehicle photos.

### Route conditions

13. [ ] **Pollen along routes — provider decision.** Research in [DATA_OPTIONS.md](docs/DATA_OPTIONS.md): Open-Meteo pollen remains Europe-only; Google covers the U.S. with daily forecasts and key/billing/display/storage constraints; Ambee is a commercial option worth evaluating for arrival-hour forecasts and licensing. Choose a provider before integration, with a separate limiter and accurate temporal labels. No new provider has been enabled. Hourly weather, smoke/smog and air-quality hazards already ship.

### Discounts and trip optimization

14. [ ] **Cash-price offers and comparisons.** The current one-price-per-grade model does not preserve payment eligibility; Google fuel-price responses have no cash/card field. Add separate explicitly labeled offers, cash/card preferences, correct reward/cashback eligibility and history/cache support, then verify real source coverage. Never infer that an unlabeled price is cash. Findings and a proposed design are in [DATA_OPTIONS.md](docs/DATA_OPTIONS.md).

### Onboarding and visual explanations

32. [ ] **Onboarding experiences.** Design guided introductions for first-time setup and unfamiliar features, helping users understand what to enter and how to get value from the app.
33. [ ] **More animated explanation menus.** Use short, focused animations or interactive demonstrations to explain concepts where they communicate more clearly than verbose text. Build on the existing animated tire explanations.
34. [ ] **Visual help behind question marks.** Let applicable (?) controls open video, image or animation explanations when those are more effective than text. Choose the format for the topic rather than using media everywhere; retain a concise accessible text explanation.

## test — outstanding device and acceptance checks

15. [ ] **Offline use.** Verify the app's behavior without an internet connection and the availability of saved trip/station data.
16. [ ] **Long-trip Android acceptance measurements.** Scan diagnostics now record 15-second progress checkpoints, sampled Java-heap/system-memory watermarks, stalled-read age, reader recycling/renderer losses, persistence counts/time and elapsed time; an unfinished scan is logged after restart without claiming OOM. Run large discovery/refresh trips with at least four readers, revised RAM defaults (4/8/12/16) and manual counts up to 20. Compare logs, cancellation and retained partial prices on the phone. The five-minute target and suspected version-107 OOM remain unproven; Java heap is not WebView renderer memory or whole-process PSS.

## perf — measurements and efficiency

17. [ ] **Actual web traffic and cache efficiency.** Measure requests, transferred bytes and time, including resources loaded by Maps itself and Android WebView cache misses. Route-wide discovery/refresh already exists; optimize from measurements rather than adding a second implementation or a reader per station.

## chore — release, services and rights decisions

18. [ ] **Google data handling before broader distribution.** Recheck current terms and decide how saved Places/Routes answers, persistent station-price history, Google-derived data on the OSM map, and automated directions/station-page reads will be supported. Preserve the implementation inventory in [COMPLIANCE.md](COMPLIANCE.md), entries 1–3. This backlog does not resolve those questions.
19. [ ] **Direct website provider arrangements.** Review supported feeds/permission or an alternative workflow for Walmart, Murphy USA, ExxonMobil, Tire Rack and Brave Search, covering both tank and spare-tire answers. See compliance entries 4–8. Keep restrictions visible and do not bypass site checks.
20. [ ] **Vehicle-image rights for broader distribution.** Resolve NHTSA/EVOX image reuse, Fuel API licensing and any proposed keyless stock-photo source; retain per-photo Commons attribution and applicable image restrictions. See compliance entries 9–11.
21. [ ] **Data-service capacity and distribution model.** Decide whether personal-use service limits fit the intended audience. Recheck Open-Meteo's plan if use becomes commercial and choose hosted/regional OSM data if public Overpass cannot support the audience. No service purchase is authorized merely by this task.
22. [ ] **Keyless experiment promotion.** After device acceptance and the relevant service decisions, decide when to merge into `main`. Preserve the regular app's package/resource identity rather than copying the separate test-app identity blindly. Public beta readiness is a separate decision from merging personal test improvements.
23. [ ] **Beta release setup — later milestone.** Set up the proposed beta/RC version naming and distribution process when a beta candidate is ready; keep Android version codes increasing.
