# Open work

The single backlog for Gasket: features, defects, validation and release decisions. Reconciled against the keyless test branch through **0.0.153**, 2026-10-14. Add new work here; remove an item when it ships or its acceptance check passes. Historical implementation notes stay in `CHANGELOG.md`, `CLAUDE.md` and `KEYLESS_EXPERIMENT.md`; `COMPLIANCE.md` is a service/rights reference, not a second task list.

## Pending work

- [ ] **perf: Increase website-reader limit to 20 and use more generous defaults.** Raise the configurable maximum from 16 to 20, increase the RAM-based default worker counts moderately, and keep explicit user settings and low-memory safeguards. Check speed and stability on the phone before settling the revised defaults. This is the first queued implementation task; it has not been implemented yet.

## fix — reported defects and investigations

- [ ] **Automatic VIN-specific open-recall lookup reliability.** Investigate NHTSA background reads being declined and supported manufacturer/NHTSA alternatives. Preserve an unresolved result and the visible lookup when checks prevent access. The model/year recall-list fixes in 0.0.149 are already shipped; this item concerns the VIN-specific open/remedied result.

## feat — product features

### Vehicles and fuels

- [ ] **Full plug-in hybrid planning.** Import EPA electric range and electricity consumption, accept starting charge, account for battery depletion and gasoline use, offer optional charging stops/destination charging, and split trip cost between electricity and fuel. Current PHEV planning uses gasoline mileage and tank capacity.
- [ ] **E85 / flex-fuel planning.** Add E85 prices/station discovery and EPA alternate-fuel mileage (`cityA08`, `highwayA08`, `combA08`), then compare fuel choices by trip cost. VIN recognition of flex-fuel versions already exists; E85 as a usable grade does not.
- [ ] **EV/hydrogen map controls and detail sheets.** Add direct connector choices to the fuel-mode options and bring alternative-fuel stations into the common station-detail experience, with usable per-kWh/per-kg prices and availability where the source supports them. Existing connector filtering from the selected car, station popups, speed/pressure selectors and basic route stops must be retained.
- [ ] **More realistic EV/hydrogen trip estimates.** Improve price reliability, charging curves/times and temperature-dependent range beyond the current basic estimates. AFDC station discovery along routes, plug compatibility, charging-stop planning and approximate charging durations already exist; this is an improvement task, not a new planner from scratch.
- [ ] **Verified marketing trim beyond NHTSA's decode.** Find a manufacturer-backed source or verified generic mapping when the marketing trim is missing. Secondary trim text is supported; internal grade codes are not evidence of a marketing trim.

### Tires and trailers

- [ ] **Trailer tire mismatch/age guidance.** Research tire-maker and trailer-industry guidance for tandem-axle load sharing, dual-tire diameter differences and age/date limits, then add applicable warnings and suggestions. Car drivetrain-based tread-difference warnings shipped in 0.0.148.
- [ ] **Tire dry-rot information screen.** Explain sidewall cracking/dry rot, what to inspect and when to seek a qualified tire inspection. Keep it distinct from the generalized tread estimate.

### Vehicle images

- [ ] **Better keyless catalog imagery.** Evaluate sources that can reliably represent the model year, body and trim without requiring the user to obtain another key. NHTSA/Commons matching and the photo picker improved in 0.0.146–147; consistent catalog-quality coverage remains an open sourcing problem. Keep optional Fuel API support.
- [ ] **Scenic backgrounds.** Let users place their recreated car image into licensed environments inspired by the idea of Gran Turismo Scapes, without using its assets. Design background selection, placement/compositing and required attribution.
- [ ] **Richer optional doodles.** Consider more wheel detail, roof racks and two-tone paint. This is an existing enhancement idea, not a replacement for vehicle photos.

### Route conditions

- [ ] **Pollen along routes — source-dependent.** Find a usable U.S. forecast source and integrate it with arrival times and recirculation advice. Previous research found no suitable free U.S. source; recheck availability before choosing an implementation. Hourly weather, smoke/smog and air-quality hazards already ship.

## test — outstanding device and acceptance checks

- [ ] **Grade and price accuracy checks.** Compare a sample against the displayed Maps and official-chain prices for regular, midgrade, premium and diesel, including Walmart. Check cash/member variants and unknown update times; never infer conditions absent from the source.
- [ ] **Recovery and request-budget checks.** Exercise blocked pages, visible site checks, airplane mode, cancellation, cooldowns, cache reuse and restart. Confirm progress always exits and keyless operations do not consume paid API calls.

## perf — measurements and efficiency

- [ ] **Long-trip Android stability and duration.** Measure large discovery/refresh runs with at least four readers, RAM-based defaults and user-selected worker counts. Record peak memory, reader recycling, partial-result persistence and elapsed time. A five-minute refresh target and the suspected version-107 OOM have not been established by phone measurements.
- [ ] **Actual web traffic and cache efficiency.** Measure requests, transferred bytes and time, including resources loaded by Maps itself and Android WebView cache misses. Route-wide discovery/refresh already exists; optimize from measurements rather than adding a second implementation or a reader per station.

## chore — release, services and rights decisions

- [ ] **Google data handling before broader distribution.** Recheck current terms and decide how saved Places/Routes answers, persistent station-price history, Google-derived data on the OSM map, and automated directions/station-page reads will be supported. Preserve the implementation inventory in [COMPLIANCE.md](COMPLIANCE.md), entries 1–3. This backlog does not resolve those questions.
- [ ] **Direct website provider arrangements.** Review supported feeds/permission or an alternative workflow for Walmart, Murphy USA, ExxonMobil, Tire Rack and Brave Search, covering both tank and spare-tire answers. See compliance entries 4–8. Keep restrictions visible and do not bypass site checks.
- [ ] **Vehicle-image rights for broader distribution.** Resolve NHTSA/EVOX image reuse, Fuel API licensing and any proposed keyless stock-photo source; retain per-photo Commons attribution and applicable image restrictions. See compliance entries 9–11.
- [ ] **Data-service capacity and distribution model.** Decide whether personal-use service limits fit the intended audience. Recheck Open-Meteo's plan if use becomes commercial and choose hosted/regional OSM data if public Overpass cannot support the audience. No service purchase is authorized merely by this task.
- [ ] **Keyless experiment promotion.** After device acceptance and the relevant service decisions, decide when to merge into `main`. Preserve the regular app's package/resource identity rather than copying the separate test-app identity blindly. Public beta readiness is a separate decision from merging personal test improvements.
- [ ] **Beta release setup — later milestone.** Set up the proposed beta/RC version naming and distribution process when a beta candidate is ready; keep Android version codes increasing.

Vela reuse is conditional, not current unfinished implementation: no Vela source/templates are bundled. If direct GPL code reuse is proposed, revisit license compatibility, notices and corresponding-source obligations before integrating it. See [KEYLESS_EXPERIMENT.md](KEYLESS_EXPERIMENT.md#license-decision).

## Reconciled items (not open)

- Tire Rack catalog omissions and the lookup-after-catalog failure: marked resolved per the owner's 2026-10-14 update; no new independent verification was performed during this backlog edit.
- Station-discovery coverage, including the earlier Searcy concern: marked resolved per the owner's 2026-10-14 update. Price accuracy and performance checks remain separate tasks.
- Hourly route weather and smoke/smog/air-quality hazards: shipped; only pollen sourcing remains above.
- Keyless nearby/route discovery, all-grade saved-price refresh, progress/cancel and persistent station history: implemented; price/recovery/performance validation remains above. No specific history-chart UI has been committed to the backlog.
- Basic EV/hydrogen discovery and route-stop support: implemented; the older “everything else” entry overstated what was missing.
- Tire submenu/dually reorganization, hooked-up overview cleanup and photo picker: shipped in 0.0.146–147; superseded local work is not a pending patch.
- Car tread-difference warnings and per-vehicle/trailer tire fuel ratings: shipped in 0.0.148; trailer mismatch guidance remains above.
