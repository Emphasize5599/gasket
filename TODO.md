# Open work

The single backlog for Gasket: features, defects, validation and release decisions. Reconciled against the keyless test branch through **0.0.153**, 2026-10-14. Add new work here; close an item when it ships, is retired or its acceptance check passes. Historical implementation notes stay in `CHANGELOG.md`, `CLAUDE.md` and `KEYLESS_EXPERIMENT.md`; `COMPLIANCE.md` is a service/rights reference, not a second task list.

Keep item numbers when discussing or changing status. Checked entries are done or explicitly retired; new work takes the next unused number. Items are grouped by category, so numeric order does not imply priority.

## Pending work

1. [ ] **perf: Increase website-reader limit to 20 and use more generous defaults.** Raise the configurable maximum from 16 to 20, increase the RAM-based default worker counts moderately, and keep explicit user settings and low-memory safeguards. Check speed and stability on the phone before settling the revised defaults. This is the first queued implementation task; it has not been implemented yet.

## fix — reported defects and investigations

2. [x] **Automatic VIN-specific open-recall lookup reliability — done.** Closed per the owner's 2026-10-14 update.

## feat — product features

### Vehicles and fuels

3. [ ] **Full plug-in hybrid planning.** Import EPA electric range and electricity consumption, accept starting charge, account for battery depletion and gasoline use, offer optional charging stops/destination charging, and split trip cost between electricity and fuel. Current PHEV planning uses gasoline mileage and tank capacity.
4. [ ] **End-to-end flex-fuel / E85 integration.** VIN recognition currently helps match the EPA's flex-fuel versions, but E85 is not a selectable fuel grade or planning option. Expose flex-fuel capability in vehicle setup; add E85 prices/station discovery and EPA alternate-fuel mileage (`cityA08`, `highwayA08`, `combA08`), then compare compatible gasoline/E85 choices by trip cost and range.
5. [ ] **EV/hydrogen map controls and detail sheets.** Add direct connector choices to the fuel-mode options and bring alternative-fuel stations into the common station-detail experience, with usable per-kWh/per-kg prices and availability where the source supports them. Existing connector filtering from the selected car, station popups, speed/pressure selectors and basic route stops must be retained.
6. [ ] **More realistic EV/hydrogen trip estimates.** Improve price reliability, charging curves/times and temperature-dependent range beyond the current basic estimates. AFDC station discovery along routes, plug compatibility, charging-stop planning and approximate charging durations already exist; this is an improvement task, not a new planner from scratch.
7. [ ] **Verified marketing trim beyond NHTSA's decode.** Find a manufacturer-backed source or verified generic mapping when the marketing trim is missing. Secondary trim text is supported; internal grade codes are not evidence of a marketing trim.

### Tires and trailers

8. [x] **Trailer tire mismatch/age guidance — not planned.** Retired as not relevant per the owner's 2026-10-14 update. General tire aging belongs to item 9.
9. [ ] **Tire dry-rot and aging information screen.** Cover sidewall cracking/dry rot, age-related rubber hardening and reduced grip even when tread remains, date-code reading, inspection and tire-maker age/replacement guidance. Keep age/condition separate from the generalized tread estimate; research the guidance before writing the screen.

### Vehicle images

10. [x] **Keyless vehicle imagery — done for now.** Current NHTSA/Commons matching and photo selection are accepted. Reopen only if actual use shows Commons coverage is too sparse; optional Fuel API support remains.
11. [ ] **Scenic backgrounds.** Let users place their recreated car image into licensed environments inspired by the idea of Gran Turismo Scapes, without using its assets. Design background selection, placement/compositing and required attribution.
12. [ ] **Richer optional doodles.** Consider more wheel detail, roof racks and two-tone paint. This is an existing enhancement idea, not a replacement for vehicle photos.

### Route conditions

13. [ ] **Pollen along routes — source-dependent.** Find a usable U.S. forecast source and integrate it with arrival times and recirculation advice. Previous research found no suitable free U.S. source; recheck availability before choosing an implementation. Hourly weather, smoke/smog and air-quality hazards already ship.

### Discounts and trip optimization

31. [ ] **CITGO monthly special redemption and trip optimization.** Verify and improve the planner's treatment of Triple Tuesday and Five Cent Friday: each special is available once per month on its first eligible fill-up, subject to the user's redemption state. Manual monthly tracking already exists in Settings (`citgoUsed` / `citgoBonus`); station candidates are priced individually from that shared state. Ensure a proposed trip cannot count the same monthly special at multiple stops, and optimize stop choice, order and purchase quantities around the first eligible redemption. Later CITGO stops may still be worthwhile at ordinary rewards/prices, so do not impose a one-CITGO-per-trip limit. Handle arrival dates, month changes and already-redeemed specials. Planning/replanning must not record a real redemption; provide a clear user-confirmed way to record an actual fill-up and persist the appropriate month's state. Verify current program terms when implementing.

## test — outstanding device and acceptance checks

14. [ ] **Cash-price accuracy checks.** Verify explicitly labeled cash prices are distinguished from card prices and presented appropriately when comparing stations. Do not infer that an unlabeled price is a cash price.
15. [ ] **Offline use.** Verify the app's behavior without an internet connection and the availability of saved trip/station data.

## perf — measurements and efficiency

16. [ ] **Long-trip Android stability and duration.** Measure large discovery/refresh runs with at least four readers, RAM-based defaults and user-selected worker counts. Record peak memory, reader recycling, partial-result persistence and elapsed time. A five-minute refresh target and the suspected version-107 OOM have not been established by phone measurements.
17. [ ] **Actual web traffic and cache efficiency.** Measure requests, transferred bytes and time, including resources loaded by Maps itself and Android WebView cache misses. Route-wide discovery/refresh already exists; optimize from measurements rather than adding a second implementation or a reader per station.

## chore — release, services and rights decisions

18. [ ] **Google data handling before broader distribution.** Recheck current terms and decide how saved Places/Routes answers, persistent station-price history, Google-derived data on the OSM map, and automated directions/station-page reads will be supported. Preserve the implementation inventory in [COMPLIANCE.md](COMPLIANCE.md), entries 1–3. This backlog does not resolve those questions.
19. [ ] **Direct website provider arrangements.** Review supported feeds/permission or an alternative workflow for Walmart, Murphy USA, ExxonMobil, Tire Rack and Brave Search, covering both tank and spare-tire answers. See compliance entries 4–8. Keep restrictions visible and do not bypass site checks.
20. [ ] **Vehicle-image rights for broader distribution.** Resolve NHTSA/EVOX image reuse, Fuel API licensing and any proposed keyless stock-photo source; retain per-photo Commons attribution and applicable image restrictions. See compliance entries 9–11.
21. [ ] **Data-service capacity and distribution model.** Decide whether personal-use service limits fit the intended audience. Recheck Open-Meteo's plan if use becomes commercial and choose hosted/regional OSM data if public Overpass cannot support the audience. No service purchase is authorized merely by this task.
22. [ ] **Keyless experiment promotion.** After device acceptance and the relevant service decisions, decide when to merge into `main`. Preserve the regular app's package/resource identity rather than copying the separate test-app identity blindly. Public beta readiness is a separate decision from merging personal test improvements.
23. [ ] **Beta release setup — later milestone.** Set up the proposed beta/RC version naming and distribution process when a beta candidate is ready; keep Android version codes increasing.

Vela reuse is conditional, not current unfinished implementation: no Vela source/templates are bundled. If direct GPL code reuse is proposed, revisit license compatibility, notices and corresponding-source obligations before integrating it. See [KEYLESS_EXPERIMENT.md](KEYLESS_EXPERIMENT.md#license-decision).

## Reconciled items (not open)

24. Tire Rack catalog omissions and the lookup-after-catalog failure: marked resolved per the owner's 2026-10-14 update; no new independent verification was performed during this backlog edit.
25. Station-discovery coverage, including the earlier Searcy concern: marked resolved per the owner's 2026-10-14 update. Price accuracy and performance checks remain separate tasks.
26. Hourly route weather and smoke/smog/air-quality hazards: shipped; only pollen sourcing remains above.
27. Keyless nearby/route discovery, all-grade saved-price refresh, progress/cancel and persistent station history: implemented; cash-price/offline/performance validation remains above. No specific history-chart UI has been committed to the backlog.
28. Basic EV/hydrogen discovery and route-stop support: implemented; the older “everything else” entry overstated what was missing.
29. Tire submenu/dually reorganization, hooked-up overview cleanup and photo picker: shipped in 0.0.146–147; superseded local work is not a pending patch.
30. Car tread-difference warnings and per-vehicle/trailer tire fuel ratings: shipped in 0.0.148; trailer mismatch guidance remains above.
