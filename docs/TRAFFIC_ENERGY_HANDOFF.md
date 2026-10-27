# Traffic-aware speed and energy model: research handoff for implementation

Prepared 27 October 2026 for a Claude Code or Codex session working in the Gasket repo, branch `feature/traffic-rest-integration` or its successor. It consolidates research rounds 2–5 and the owner's decisions. **This file is research and specification only. Nothing here has been implemented, and no app code was changed while preparing it.**

## Implementation progress (update after every round of commits)

Branch: `feature/traffic-rest-integration` (the same commits are also pushed to `claude/blissful-mccarthy-s8spue`). Main is untouched until the model is wired up and tested, so nothing half-built ships in a release. Next agent: `git fetch && git checkout feature/traffic-rest-integration`, read this section, continue at **Next**.

| Round | Status | What |
| --- | --- | --- |
| 0 | done | This handoff committed to `docs/`. |
| 1 | done | Pure modules, not loaded by the app yet: `assets/web/trafficmodel.js` (`TrafficModel`: section 4 priors with freeway/arterial halves, `section()` → seconds / tStopped / vMoving / nStops, D2 `coverage()` guard rails, `calibrate()` = box-bounded least squares with a weak prior pull and the section 4.3 rejections, `Calibration` running posterior with save/restore, `restart()` kinetic restart energy). `assets/web/auxload.js` (`AuxLoad`: section 5.2 heat-pump / resistive tables (unknown → resistive), `warmup()`, `presetScale()` (setpoint ±40%, recirc −15%, A/C off, seat/wheel/defrost), warm-up **state** via `start` / `energy` / `park` (≥ 20 min park re-arms; preconditioned skips)). `assets/web/idlefuel.js` (`IdleFuel`: section 7 formula, `idleRpm()` by cylinders, `acAdd()`, `idle()` with cold ×1.6, start-stop rule, hybrid engine-off share + charge-neutral battery repay, `fromText()` for the EPA engine string). Test `tests/traffic-energy.test.js` (in the release list): priors, timing, guard rails, calibration recovers synthetic ratios within 0.02 and rejects the five bad cases, warm-up once per cold start, idle table rows within 5%, measured rows in range, Sienna/Prius. |

Decisions taken in round 1 (fill-ins, all labeled in code): heat-pump −25 °C mid 4.2 kW (2.5–5.9 range); warm-up seconds = lerp(−18 °C 14 min, −7 °C 10 min, 10 °C 4 min), hot ≥ 30 °C 2.3 kW for 15 min; diesel k 0.28 (0.23–0.33); hybrid repay 0.1 gal/kWh; restart regen gas 0 / hybrid 30% / EV 60% (EV drivetrain 90%).

| 2 | done | EV / fuel-cell wiring in `propulsion.js`, behind `p.auxModel` (set from tripui `makeBaseOpts` when `S.trafficEnergy` is true; **no Settings toggle yet, default off**). `auxKw()` = `AuxLoad.power(ta, p, p.preset)` replaces `hvac()` in both branches (estimate branch keeps the "minus 20 °C" increment, so a mild green section is unchanged); `crawl_city_baseline`: below 25 mph EV traction is floored at `model.cityGpm × speed` (the old road-load ratio fell to ~13% of highway at 16 mph; Leaf measured ~76%); warm-up transient carried as `AuxLoad` state across segments, re-armed by waits / charging stops ≥ 20 min (`AL.park`), skipped with `preconditionedStart`; traffic stops: `Traffic.overlay` segs now carry `freeMph`, `TrafficModel.fromRatio(trafficMph / freeMph)` → category → `section().nStops` × `restart('ev')` (flag `traffic_stops_estimated`, `trafficStops` in the result). The preset passed is `Climate.current(car)` (season preset: `temp` °F, `ac`, `air`, `seatD`, `wheel`, `frontDef`, `flow`), and `AuxLoad.presetScale` reads those fields. `auxload.js` / `trafficmodel.js` / `idlefuel.js` are loaded in index.html before propulsion.js and have `workerSource` (planner.js puts AuxLoad + TrafficModel in the worker blob). Tests: traffic-energy round-2 block (flag off and mild green unchanged, warm-up once across 12 segments, preconditioning, crawl floor, inferred stops, cold crawl > 1.5× mild, recirculation); planner-worker, propulsion, traffic(-ui), ev-flow-ui, charge-curve, ev-feasibility, vehiclecompare-ui, windowplanning-ui, legal all pass. |

| 3 | done | Gas / diesel / hybrid congestion (section 6.4) in `Traffic.overlay` → `congestion(m, r, len, dt)`, active only when the route model has `engine` (tripui `carModel()` adds `engineFacts(car)` when `S.trafficEnergy`; `trip.js` `buildRoute` / `makeModel` carry `engine` and `trafficStops`). Per forecast row with `freeMph`: `TrafficModel.fromRatio` → category (NORMAL / NONE untouched), `TrafficModel.split(len, seconds, vff, cat, cls)` (stopped share from the prior, capped so moving speed ≤ free flow) → moving gpm = EPA city/highway blend at max(15 mph, moving speed) + `IdleFuel.idle` × stopped time + `nStops` × `restart(gas | diesel | hybrid)`; segs get `trafficCat` / `stoppedSec`. `engineFacts`: `IdleFuel.fromText(car.info.engine)` (now reads "3.5L V6", "Inline 4", "4 Cyl"), hybrid from `power` / `type` (not plug-in), diesel from grade / EPA fuel, `acFrac` 0.5 when this season's preset has A/C on (fill-in), start-stop unknown → off. Measured outcome on the test model: gas 25/33 mpg dark red = 1.86× its highway best (Zhang 1.7–3×), Prius-like hybrid 1.35× (1–2×), green unchanged, EV untouched (Propulsion handles it). |

**Next:** round 4 = Settings toggle "Estimate traffic energy (experimental)" in Settings → Trip (default off; `S.trafficEnergy`), docs/PROPULSION_MODELS.md + docs/TRAFFIC.md notes, then version bump + CHANGELOG + CLAUDE.md note, full release suite, merge to main. After that: section 9 step 3 (Google website traffic reader + calibration persistence using `TrafficModel.calibrate` / `Calibration`), step 4 UI ranges / labels.

## 0. How to use this document (instructions to the implementing agent)

1. **Read this whole file first.** Then read the repo docs it points to:
   - `docs/TRAFFIC.md`
   - `docs/TRAFFIC_REST_HANDOFF.md`
   - `docs/TRAFFIC_ENERGY_EVIDENCE.md`
   - `docs/TRAFFIC_ENERGY_DATASETS.md`
   - `docs/PROPULSION_MODELS.md`
   - `docs/REST_PLANNING.md`

   Then read the code they name: the traffic reader, `propulsion.js`, `climate.js`, `speed.js`, `trip.js`, `gmaps_worker.js`, `tripui.js`. File and function names below come from earlier research sessions. **Verify them against the current repo before relying on them.**
2. **Decide whether you have everything you need for each part.** Section 11 lists what is known to be missing. Where this document gives a range or prior and no better data exists, **fill the gap reasonably**:
   - pick the documented middle value;
   - keep the range as uncertainty;
   - label it in code comments and docs as an estimate, with the basis named.

   Do not block implementation on missing data that has a stated default here.
3. **Extending the idle table (section 7.3):** you may add engine families, idle rpm or A/C values using the stated formula. Mark every added row as *derived*, not *measured*. If the owner later supplies OBD idle logs, prefer them over the formula for that car.
4. **Do not invent precision.** Show estimated consumption and range as ranges or with uncertainty labels. Never present a colour-derived speed as a measured speed.
5. **Follow CLAUDE.md:**
   - no CAPTCHA bypass;
   - no logging of keys or VINs;
   - generic test places only;
   - no horizontal scroll;
   - changelog conventions;
   - Google attribution where Google content is shown.

   Keep HERE tolls independent from HERE traffic.
6. **Before coding, sync with origin and preserve others' changes.** Then decide the version bump, tests and phone-check checklist as CLAUDE.md requires.

## 1. Owner decisions (binding)

| # | Decision |
| --- | --- |
| D1 | Google publishes no colour → speed conversion, and that is likely deliberate. **Estimate speeds from inferred congestion patterns**: priors, then calibration against Google's own durations (section 4). |
| D2 | **Uncoloured roads are treated as free flow.** Reason: no colour generally means too few phones to report congestion, i.e. a quiet road behaving normally. This replaces the earlier research recommendation to treat uncoloured roads as unknown. See section 4.6 for guard rails. |
| D3 | **EV crawling** = time-based load (cabin HVAC + 12 V + battery thermal) + small moving energy at the crawl speed. Implement this model. |
| D4 | **Gas idle fuel** is estimated from **engine displacement**, with cylinder count used where it helps (mainly to choose a default idle rpm). Police / fleet idle data may be used. Fill gaps reasonably (section 7). |
| D5 | Earlier, still in force (`docs/TRAFFIC_REST_HANDOFF.md`): build an experimental Google website traffic provider; once validated, make HERE traffic opt-in (off by default); keep HERE tolls separate. Share traffic observations across trips by road/direction/weekday/time. Keep the single Cost/Time objective. |
| D6 | Owner's prior expectations, now checked against data (section 2): dark red ≈ bumper-to-bumper; a hybrid gets roughly its city rating in bad traffic; an EV does well in traffic except in heat or cold; gas cars do badly. |

## 2. Owner expectations versus measured evidence (summary)

| Expectation | Verdict | Key numbers |
| --- | --- | --- |
| Dark red = sustained bumper-to-bumper | Mostly; model it as a high stopped share, not 0 mph everywhere | Google: "heavy traffic jam is detected". Ecuador ground truth: darkest cluster about 11 km/h (≈ 0.23 of a 50 km/h limit). Bangkok congested driving at 5–10 km/h averaged 37–46% idle time. |
| Hybrid ≈ city rating in bad traffic, slightly below if sustained | True down to about 15 km/h (9 mph) in mild weather. Below about 10 km/h it costs 1.5–2× its best. Cold or hot weather with A/C costs about 30% more. | Sonata Hybrid (Argonne): stop-go 61–64 mpg vs highway 71–74. Zhang 2025 fleet curve (section 6.1). Sonata at 95 °F + A/C: 40–45 mpg; at 20 °F: 44.5 mpg. |
| EV excellent in traffic unless very hot or cold | True in mild weather. In the cold, slow traffic is the *worst* per mile. | Leaf: 167 Wh/mi in 16 mph stop-go vs 220 on the highway; at 20 °F 342, at 0 °F 491. |
| Gas car = horrible in traffic | True below about 15 mph; about −40% at 16 mph stop-go | Camry UDDS phase 2 (stop-go part of the EPA city cycle) about 34 mpg vs highway 56. Gas MPV fleet about 2.7× its best at 12.5 km/h. 60-car PEMS study: +81% fuel going from 35 to 15 km/h. |

## 3. Energy accounting contract (all powertrains)

Compute energy per route **section**: a stretch with one traffic category and one road class. Use a consistent accounting boundary: battery terminal for EVs, fuel for ICE and HEVs.

```text
E_section = d_moving × e_move(v_moving, powertrain, ambient, grade)          # distance-based
          + t_total × P_aux(ambient, sun, climate preset, heat source, warm-up state)  # time-based (cabin HVAC, 12 V, battery thermal)
          + t_stopped × P_idle(powertrain, displacement, rpm, A/C)            # ICE / HEV engine-on idle; 0 for EV
          + n_stops × E_restart(powertrain)                                   # accel penalty net of regen
```

**Rules:**

- **No double counting.** Existing EPA-anchored city/highway interpolation already contains average city stops and HVAC-off driving. When adding traffic terms, normalise the green / free-flow baseline to the existing model. Then add *incremental* stop / idle / auxiliary effects for slower categories. See section 6.4.
- **Auxiliary load is per hour.** Integrate it over elapsed time, including queueing. Show Wh/mi or mpg only for display, on non-zero distance. Never divide by zero at standstill.
- **Warm-up is a state, not a per-mile constant.** Carry cabin, engine and battery warm-up state across sections. A new traffic cell or a colour change must not restart warm-up. A long parked stop (rest, charging, destination) cools the state again (`docs/PROPULSION_MODELS.md` has the existing battery cooldown model; reuse it, don't duplicate it). Plugged-in preconditioning removes most first-drive penalty (section 5.3).
- **Hybrids must be charge-neutral over the trip.** A long crawl drains the battery; the engine later repays it at engine-plus-generator efficiency. Never count battery depletion as free fuel.
- **PHEVs:** charge-depleting versus charge-sustaining are distinct regimes. TODO item 3 still owns full PHEV planning.
- **Hydrogen:** fuel-cell plus buffer-battery behaviour. Reuse the EV time-based auxiliary structure. The traction side keeps the existing hydrogen model.

## 4. Google traffic categories → speed (inferred model)

### 4.1 What Google defines (no numbers)

Google Roads Management Insights concepts:

| Category | Colour | Google's definition |
| --- | --- | --- |
| `NORMAL` | Green | "Traffic is flowing smoothly; no slowdown is detected." |
| `SLOW` | Yellow/orange | "Slowdown is detected, but no traffic jam has formed." |
| `TRAFFIC_JAM` | Red | "Traffic jam is detected." |
| `TRAFFIC_JAM_HEAVY` | Dark red | "Heavy traffic jam is detected." Offset-based intervals only, as of 8 Oct 2026; legacy coordinate intervals report dark red as `TRAFFIC_JAM`. |

- Historical data defines what is "normal" for a road at a given time and weekday, so categories are **relative to that road's usual behaviour**.
- No thresholds, percentages or free-flow ratios are published.
- History: 2008 phones used fixed green > 50 / yellow 25–50 / red < 25 mph. From 2009 the colours became relative to road speed. **Do not use the 2008 table.**

### 4.2 Priors: speed ÷ free-flow speed, and stopped share

Free-flow speed = the posted or derived speed limit already in Gasket (HPMS / road class / speed rules), capped by the user's speed rules where they apply.

| Category | r = speed / free-flow: range (default) | Stopped share of section time: range (default) | Evidence |
| --- | --- | --- | --- |
| Green `NORMAL` | 0.85–1.00 (0.92) | 0 on access-controlled roads. On signalised arterials, use the existing city model, no extra. | Ecuador 0.89; "no slowdown" |
| Uncoloured (owner D2) | **treat as free flow: 1.00** (range 0.90–1.00) | as green | Owner decision |
| Yellow `SLOW` | 0.45–0.80 (0.65) | 0–10% (5%) | Ecuador 0.62. Wagner: Krefeld street 0.79 (×1.27 time), A57 motorway 0.46 (×2.18). |
| Red `TRAFFIC_JAM` | 0.25–0.50 (0.38) | 10–30% (20%) | Ecuador 0.41; 2008 Google < 25 mph on a 65 mph road ≈ < 0.38 |
| Dark red `HEAVY` | 0.08–0.30 (0.18) | 30–50% (40%) | Ecuador 0.23 (11 km/h); Bangkok 37–46% idle at 5–10 km/h; Toronto city 22–28% idle |

**Road-class split** (fill-in defaults; refine by calibration):

- **Freeways / access-controlled roads:** use the *lower half* of the Yellow and Red ranges. Wagner's motorway orange was 0.46. Congestion there forms queues.
- **Arterials / local roads:** use the *upper half*. Signals already slow normal flow.

### 4.3 Self-calibration against Google's own durations (preferred over priors)

Wagner et al. 2020 fitted colour multipliers to Google durations. Do the same, using Google's own numbers for the route Gasket is actually evaluating.

**Data available:**

- **Keyless (website):** the directions response the hidden Maps reader already loads. `docs/TRAFFIC.md` notes Vela's parser reads live duration, a typical duration range and **categorical congestion spans** from the directions response, and `gmaps_worker.js` already decodes the route line (`line(g, head)`) and steps. **Verify where the congestion spans and typical / no-traffic durations live in that response.**

  Vela is GPL; do not copy its code. Re-derive the structure independently, as was done for the polyline.
- **Keyed (optional):** Routes API `duration` (traffic-aware), `staticDuration`, and `extraComputations: TRAFFIC_ON_POLYLINE` → `speedReadingIntervals`. Paid calls must respect the existing Google cap and caching rules.

**Model for one route answer:**

```text
T_traffic ≈ Σ_sections len_s / (r_{c(s),k(s)} × v_ff,s) + Σ stop-light/other delays already in T_free
T_free    ≈ Σ_sections len_s / v_ff,s     (or Google's no-traffic/typical duration if provided)
=> T_traffic − T_free ≈ Σ_c Σ_{s∈c} len_s × (1/r_c − 1) / v_ff,s
```

- **Solve** for `r_c` per (category c, road class k) by **bounded non-negative least squares**, with bounds equal to the prior ranges.
- **Add a weak prior penalty** pulling each `r_c` toward its default.
- **Pool** observations across routes, departure hours and cached cells. Use a running posterior, e.g. a weighted mean and variance per (c, k), so each new route improves the estimate.
- **Persist** the calibration table with source timestamps. Bound its memory.
- **Reject a fit when any of these happen:**
  - it needs r > 1.05 or r < 0.05;
  - Google's route differs from Gasket's selected route (reuse `Traffic.read`'s stretch-matching rules from 0.0.281: spans only count where they match the selected line);
  - the colour coverage of the route is under 50%;
  - durations are missing.
- **What it can't prove:** matching total duration does not prove local speeds. Keep the uncertainty and display ranges.

### 4.4 Converting a section to energy inputs

For category c with ratio r and stopped share s:

- `t_section = len / (r × v_ff)`
- `t_stopped = s × t_section`
- `v_moving = len / ((1 − s) × t_section)`. If `v_moving` exceeds `v_ff`, reduce s.
- `n_stops` (fill-in defaults):
  - green: city model as now;
  - yellow: 0.3 per km;
  - red: 1.5 per km;
  - dark red: 3 per km on freeways; on arterials, use signal density if known, else 2 per km.

  These are reasonable assumptions, not measured. Label them so, and tune if Gasket ever gets trajectory data.

### 4.5 Evaluating time

Evaluate each section at its **arrival time**: weekday plus local clock including stop delays, timezone and DST. Typical traffic is a weekday/time pattern, not a forecast of incidents, holidays or weather. Use hourly or five-minute buckets as the provider allows. **Verify the clock that was actually selected, never the requested one** (`docs/REST_PLANNING.md`).

### 4.6 Guard rails for D2 (uncoloured = free flow)

- Apply D2 **only** when the traffic layer or answer loaded successfully for that area and time, and other roads nearby are coloured. That separates a quiet road from a failed read.
- If the whole viewport or route has no colours (load failure, unsupported area, blocked page, off-hours gap), do **not** silently claim free flow. Report "traffic unavailable" and use the existing route model, as for HERE failures (0.0.273).
- Log the uncoloured share per route so phone logs can show how often D2 applied.

## 5. EV and fuel-cell time-based auxiliary load (P_aux)

### 5.1 Measured references

**2019 Nissan Leaf e+** (heat pump plus PTC heater; auto 72 °F), Argonne D3 summary `2019_Nissan_Leaf_TestPlanInstru_MasterSummary_220118_D3.xlsx`:

- Power derived from the energy columns using the standard cycle lengths: UDDS 1,369 s, its phase 2 864 s, HWY 765 s.
- **The PTC heater is outside the HV-battery clamp.** Total = HV + PTC; the state-of-charge cross-check gives a ratio of 0.94–1.00.

| Condition | Stop-go (UDDS phase 2, 16 mph) | Whole UDDS warm repeat (19.5 mph) | Highway (48 mph) |
| --- | --- | --- | --- |
| 72 °F, HVAC off | 2.67 kW, 167 Wh/mi | 3.60 kW, 185 Wh/mi | 220 Wh/mi |
| 95 °F + 850 W/m² sun, A/C auto | 3.82 kW, 239 Wh/mi | 4.83 kW, 248 Wh/mi | 233 Wh/mi |
| 95 °F, no sun | — | 210 Wh/mi | — |
| 20 °F | 5.50 kW, 342 Wh/mi | 6.96 kW, 355 Wh/mi | 304 Wh/mi |
| 0 °F | 7.86 kW, 491 Wh/mi | 9.15 kW, 469 Wh/mi | 359 Wh/mi |

- HVAC alone (Seo et al. 2025, Argonne, same Leaf plus 2020 Bolt, setpoint 22 °C):

| Car | Ambient | Transient → steady |
| --- | --- | --- |
| Leaf | −18 °C | 4.5 → 4.15 kW |
| Leaf | −7 °C | 3.8 → 2.2 kW |
| Leaf | 35 °C | 1.9 → 1.1 kW |
| Bolt (resistive only) | −18 °C | 5.0 → 4.0 kW |
| Bolt (resistive only) | −7 °C | 3.7 → 2.8 kW |
| Bolt (resistive only) | 35 °C | 1.9 → 0.7 kW |

  The transient phase lasted 250–820 s.

**2020 Tesla Model 3** (resistive heater, no heat pump; auto 72 °F), Argonne `2020_Tesla_Model_3_TestSummary__20211112.xlsx`. Here the heater **is** inside the HV clamp (state-of-charge ratio about 0.87–0.89, same as warm tests).

| Condition | Stop-go (UDDS phase 2) | Whole UDDS | Highway |
| --- | --- | --- | --- |
| 72 °F | 167 Wh/mi (2.68 kW) | 174–182 | 186 |
| 95 °F, no sun | 204 (+0.6 kW; A/C 0.5 + heater reheat 0.3) | 203 | 187 |
| 20 °F, first drive after soak | 433 (first 505 s: 508) | 469 | 278 |
| 20 °F, settled | 278–317 (+1.8–2.4 kW) | 286–329 | 247 |
| 20 °F, after 50-min plugged preconditioning | 287 | **298** | 254 |
| 0 °F, first drive after soak | 644 (first 505 s: 761) | 701 | 322 |
| 0 °F, settled | 311–391 (+2.3–3.6 kW) | 314–420 | 269 |

**2025–26 model-year EVs** (Applied Energy 2026; climate chamber; WLTC at about 46.5 km/h; setpoints 22 °C heat / 25 °C cool). At −25 °C, climate-system energy and the equivalent average power:

| Car | Climate-system energy | Average power |
| --- | --- | --- |
| Heat pump only | 12.73 kWh/100 km | ≈ 5.9 kW |
| Mainly resistive (PTC) | 14.11 kWh/100 km | ≈ 6.6 kW |
| Heat pump + PTC | 5.36 kWh/100 km | ≈ 2.5 kW |

- The first cold cycle used about 1.4–1.7× the later cycles.
- At 35 °C, total consumption was +15–29%.

**Standstill measurements:**

- **ADAC, Model Y, 2024:** 8 h at 35 °C with strong simulated sun → about 1.5 kW average (12 kWh); cabin held at about 25 °C, not the 20 °C setpoint.
- **ADAC, −10 °C, seven EVs:** cabin heat-up took 1.5–2.3 kWh over 12.5 to more than 40 min; holding temperature took **1.5–2 kW**.
- **Norway, 51 plugged-in preheat sessions:** 3–8 kW initially, 2–4 kW after 10–20 min; 15–45 min sessions; usually ≤ 2 kWh, at most 5 kWh.
- **Cha & Seo 2026 (about 7,000 km on road, heat pump + PTC crossover):** HVAC load is roughly speed-independent; cold adds 22.7–33.3 Wh/km; climate on adds about 17 Wh/km on average.

### 5.2 Default P_aux table (fill-in values; use when vehicle-specific data is absent)

P_aux = cabin HVAC + 12 V / electronics + battery thermal. Setpoint about 21–22 °C, auto mode.

| Ambient | Heat pump + PTC (or heat pump with good low-temperature performance) | Resistive only (or unknown → use this column for feasibility) | Notes |
| --- | --- | --- | --- |
| 15–24 °C (mild) | 0.25 kW (0.15–0.35) | 0.25 kW | Mostly 12 V and blower |
| 25–30 °C | 0.6 kW (0.4–0.9) | 0.6 kW | A/C |
| 30–35 °C plus sun | 1.2 kW (1.0–2.0); 2.0–2.6 kW for the first 10–20 min | same | ADAC, Leaf, Model 3 |
| 5–15 °C | 0.8 kW (0.5–1.2) | 1.2 kW (0.8–1.6) | Interpolated; less measured |
| −7 to −10 °C | 1.8 kW (1.5–2.4) settled; 3.8 kW warm-up | 2.6 kW (2.0–3.0) settled; 4.0 kW warm-up | Seo, ADAC, Model 3 |
| −18 °C | 3.5 kW (2.5–4.2) settled | 4.2 kW (3.5–5.0) | Leaf's heat pump turned off at −18 °C |
| −25 °C | 2.5–5.9 kW (design-dependent) | 6.6 kW | Applied Energy 2026 |

- **Warm-up transient:** apply transient power for `t_warm` = 4–14 min after a cold start (Seo: 250–820 s), longer when colder. Skip it if the car was preconditioned on a plug, or if the previous section ended less than about 15–20 min ago (continuing cabin).
- **Garage climate presets** (`climate.js`) set the setpoint, A/C, recirculation, seat/wheel heat, defrost and so on. Map them as follows:
  - **Setpoint:** scale heating and cooling power by the gap between setpoint and ambient, relative to a 22 °C reference. This is a linear fill-in; clamp at ±40%.
  - **Recirculation:** about 20–30% less HVAC power in one Leaf study, single vehicle (Russi 2022). Use −15% as a cautious fill-in.
  - **Seat / wheel heaters:** add 0.05–0.1 kW each when on; this is a fill-in.
  - **Defrost:** add about 0.5 kW. It usually runs A/C and heat together.
  - **Equipment:** heat pump presence comes from vehicle data (`p.heatPump` already exists in `propulsion.js` `hvac(t,p)`). When unknown, use the resistive column for range feasibility and the mid value for cost.
- **No double count:** existing `propulsion.js` normalises against a baseline and adds weather HVAC. Replace that HVAC term with the per-hour `P_aux × t`; don't add both. Keep the existing battery cooldown / thermal model and only add cabin load.

### 5.3 EV crawl (owner D3)

EV energy in a red or dark-red section:

- moving energy: `d_moving × e_move(v_moving)`, using the existing EV road-load at low speed, clamped to the valid range. **Do not extrapolate the one-car highway polynomial below its validated speeds.** Below about 25 mph, use the UDDS-phase-2-like baseline of about 165–175 Wh/mi for compact or mid EVs, scaled by the vehicle's EPA city rating;
- plus `t_total × P_aux`;
- plus the stop penalty, net of regeneration. Regeneration is weaker in the cold: 6–10 points less in Cha & Seo; near 0% in the first cold cycle in the 2026 study.

## 6. Gas, diesel and hybrid moving / crawl energy

### 6.1 Measured crawl curve

Zhang, Fan, Lu, Song 2025, TR-D, Fig. 6: Beijing, 15 Honda Odyssey hybrids and 15 Buick GL8 2.5 L gas MPVs, 1 Hz onboard (OBD) data over one year. Values were read from the graph by eye, ±0.5 L/100 km.

| Trip average speed | Gas MPV (L/100 km) | × its best (≈ 6.8) | Hybrid MPV (L/100 km) | × its best (≈ 4.8) |
| --- | --- | --- | --- | --- |
| 2.5 km/h | > 20 | > 3× | 4.8–10 | 1–2.1× |
| 7.5 km/h | > 20 | > 3× | 7–11.2 | 1.5–2.3× |
| 12.5 km/h | 18–19.5 | 2.7× | 5.2–8.4 | 1.1–1.75× |
| 17.5 km/h | 14.5–15.3 | 2.2× | 4.7–7.3 | 1–1.5× |
| 27.5 km/h | 11.2–11.7 | 1.7× | 4.7–5.9 | 1–1.2× |
| 42.5 km/h | 8.7–9.1 | 1.3× | 4.9–5.5 | 1.1× |
| 70–80 km/h | 6.7–7.7 | 1.0–1.1× | 5.0–6.0 | 1.0–1.25× |
| 117 km/h | 8.8 | 1.3× | 9.5 | 2.0× |

Corroboration (Huo et al. 2014, 60 cars, PEMS): going from 35 to 15 km/h increased fuel use by +81 ± 16% for gasoline and +60 ± 15% for diesel.

### 6.2 Same-car temperature effects (Argonne D3, lab, unadjusted)

**2018 Camry 2.5 (gas):**

- **72 °F:** UDDS phase 2 about 34 mpg; HWY 55–57; US06 city about 20; LA92 30–32.
- **95 °F + A/C:** UDDS hot start 32.2 (−10%).
- **20 °F:** UDDS cold start 24.9 (−25%), hot start 31.0 (−13%), HWY about 49 (−12%).

**2021 Sonata Hybrid:**

- **72 °F, charge-neutral:** UDDS 61–64; HWY 71–74.
- **95 °F + sun + A/C:** UDDS 40–45; electric A/C compressor 1.3–2.2 kW.
- **20 °F:** UDDS warm start 44.5, cold start 32.9; HWY 57.

**2019 Blazer 3.6 V6 (a stand-in for the Sienna class, 72 °F only):** HWY 35.8 mpg, UDDS about 21.9 (ratio 0.61, same as Camry).

**Zhang 2025 (hybrid temperature):** at 5 km/h the engine-off share was 82% at 15–20 °C but 52% at −10 °C. Hybrid fuel use was +68% in cold and +28% in heat; gas cars +20% in heat.

**Hybrid nuance (Wang et al. 2020, dynamometer, same-model gas vs hybrid):** gentle low-speed driving (CLTC low phase, about 13 km/h) was the hybrid's *best* phase at 3.54 L/100 km. The aggressive WLTC low phase gave 9.18. Driving style matters a lot in congested segments; use the mid priors.

### 6.3 Model structure evidence

Kropiwnicki 2019 (Energy) modelled fuel from road-averaged variables on 50 m segments by weekday and time:

- fuel while driving, linear in specific energy (R² 0.95);
- plus idle time × idle rate;
- plus a regeneration credit for hybrids.

Average error was 4.2–4.7% across 5 cars (5.4% for a simulated hybrid). Cars at the same average speed differed by up to 70% in fuel, so stopped share and stop count must be explicit.

### 6.4 Integration with the existing gas model (fill-in method)

- Keep the existing EPA city/highway interpolation for **green / uncoloured** sections, using the speed the route already implies.
- For yellow, red and dark-red sections:
  - moving part: existing speed model at `v_moving`. **Do not go below the existing model's valid speed range**; clamp at about 15 mph for the moving part;
  - plus `t_stopped × P_idle` (section 7);
  - plus `n_stops × E_restart`.
- **Default E_restart (fill-in):** fuel to accelerate the vehicle mass from 0 to v_moving at about 25% tank-to-wheel efficiency (gas) or 35% (hybrid / diesel), minus 0% regeneration for gas, 30% for full hybrids and 60% for EVs. Compute from kinetic energy: `0.5 × m × v²`.
- **Sanity check:** the totals for red and dark red should land inside the Zhang 2025 multipliers above (gas about 1.7–3× its best; hybrid 1–2×). If not, adjust the stopped share or stops within the prior ranges rather than inventing new constants.
- **Hybrids:**
  - engine-off share at crawl: 0.8 when warm and mild, 0.5 when cold (< 0 °C), 0.6 in heat with A/C;
  - battery drain at standstill about 0.3 kW (Sonata idle test), repaid later at about 0.1 gal of fuel per kWh (fill-in: 33.7 kWh/gal × about 30% engine-plus-generator efficiency);
  - Toyota Prius (owner's car): engine stays on when cold or when the cabin needs heat.

## 7. Gas idle fuel versus displacement and cylinders (owner D4)

### 7.1 Measured or reported data points

| Vehicle / engine | No load | With load (A/C, electrical, or high idle) | Source / type |
| --- | --- | --- | --- |
| Ford Focus 2.0 L I4 | 0.16 gal/h (0.61 L/h) | 0.29 gal/h (1.10 L/h) | Argonne idling worksheet (measured) |
| VW Jetta 2.0 L diesel | 0.17 gal/h (0.64 L/h) | 0.39 gal/h (1.48 L/h) | Argonne (measured) |
| Ford Fusion 2.5 L I4 (2011) | 0.265 gal/h (1.00 L/h; 0.279 cc/s, warm) | — | Argonne "Which is greener" (measured) |
| Ford Crown Victoria 4.6 L V8 | 0.39 gal/h (1.48 L/h) | 0.59 gal/h (2.23 L/h) | Argonne (measured) |
| 2004 Crown Victoria police, all emergency lights | — | 0.70 gal/h (2.65 L/h); 2.80 gal over 4 h | Glastonbury CT Police Dept. (measured) |
| Police cars generally | — | 0.5–1.0 gal/h | Rask et al., Argonne 2013, via DOE AFDC (reported) |
| Ford Police Interceptor 3.5 L V6 / 3.7 L V6 | 35% / 32% less idle fuel than the 4.6 V8 | — | Ford (relative claim) |
| Passenger cars generally | 0.2–0.5 gal/h | — | Argonne (range) |
| Medium/heavy diesel truck, 6–10 L | 0.44 gal/h | — | WVU, via Argonne worksheet |
| Rule of thumb | 0.6 L/h per litre of displacement | — | NRCan (method not stated; looks like a loaded or cold upper bound) |
| Car with A/C in a hot jam | — | 1–1.5 L/h | ADAC (estimate) |
| 2021 Sonata Hybrid, 30 min idle from cold, 72 °F | 0.04 gal/h fuel, plus 10.5 points of battery (≈ 0.3 kW) | — | Argonne D3 (measured) |

**Police idle context:**

- Ottawa police vehicles idled up to 6.7 h per 10-h shift.
- AFDC: cruisers idle about 60% of operating time.
- Managed start/stop on 55 cruisers saved about 260 gal per vehicle per year (Argonne case study).

### 7.2 Formula

```text
P_idle_warm [L/h] = k_fric × displacement_L × (idle_rpm / 700)
    k_fric default 0.32   (range 0.25–0.40; fitted: Focus 0.30, Fusion 0.40, Crown Vic 0.32)
P_idle = P_idle_warm
       + A/C add-on       (default by size class, table below; scale by the climate preset: A/C off → 0, max → full)
       + electrical add   (normal 0; heavy accessories/lights up to +1 L/h — police data)
P_idle_cold = P_idle × 1.6 for the first 3–5 min after a cold start below 10 °C (fast idle; fill-in)
Start-stop engines: P_idle = 0 while stopped unless A/C max, defrost, cold engine or low 12 V — then use P_idle (fill-in rule).
```

- **Cylinder count:** there is no evidence of an independent effect. It enters through **default idle rpm** when unknown:

| Cylinders | Default idle rpm |
| --- | --- |
| 3 | 800 |
| 4 | 750 (≥ 2.4 L: 700) |
| 6 | 650 |
| 8 | 575–600 |

  **Cylinder deactivation** (V6/V8): no idle effect in the data found; ignore unless a better source appears.
- **VT-CPFM physics check** (Rakha et al.): idle = friction mean pressure (400 kPa) × idle rpm × displacement ÷ (22164 × fuel heating value × N). The paper defines N as cylinder count. With N = 4 this gives about 0.66 L/h for 2.5 L at 700 rpm, which is consistent with the table. Using real cylinder counts would make V6/V8 engines idle *less* than an I4, which contradicts Ford's and Argonne's data. So treat N as a constant 4.

### 7.3 Default idle table (derived from 7.2 unless marked; extend as needed)

Values: warm, no load, `k = 0.32` (range 0.25–0.40); "with A/C" adds the size-class A/C load; cold = ×1.6.

| Engine family | Default idle rpm | Warm no-load L/h (range) | gal/h | With full A/C L/h | gal/h | Cold-start fast idle L/h | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1.0–1.2 L I3 | 800 | 0.40 (0.31–0.50) | 0.11 | 0.85 | 0.23 | 0.64 | derived |
| 1.4–1.6 L I4 | 750 | 0.51 (0.40–0.64) | 0.14 | 0.96 | 0.25 | 0.82 | derived |
| 1.8–2.0 L I4 | 750 | 0.65 (0.51–0.81) | 0.17 | 1.15 | 0.30 | 1.04 | derived; **measured Focus 2.0: 0.61 / 1.10** |
| 2.0 L I4 turbo | 750 | 0.69 (0.54–0.86) | 0.18 | 1.19 | 0.31 | 1.10 | derived |
| 2.4–2.5 L I4 | 700 | 0.80 (0.62–1.00) | 0.21 | 1.35 | 0.36 | 1.28 | derived; **measured Fusion 2.5: 1.00** |
| 2.7 L V6 turbo | 650 | 0.80 (0.63–1.00) | 0.21 | 1.40 | 0.37 | 1.28 | derived |
| 3.0 L V6 | 650 | 0.89 (0.70–1.11) | 0.24 | 1.49 | 0.39 | 1.43 | derived |
| **3.5–3.6 L V6 (2011 Sienna)** | 650 | **1.04 (0.81–1.30)** | 0.27 | **1.69** | 0.45 | 1.66 | derived; Ford police V6 implies about 0.25 gal/h |
| 4.0 L V6 | 650 | 1.19 (0.93–1.49) | 0.31 | 1.84 | 0.49 | 1.90 | derived |
| 4.6–5.0 L V8 | 600 | 1.32 (1.03–1.65) | 0.35 | 2.07 | 0.55 | 2.11 | derived; **measured Crown Vic 4.6: 1.48 / 2.23** |
| 5.3–5.7 L V8 | 575 | 1.45 (1.13–1.81) | 0.38 | 2.20 | 0.58 | 2.31 | derived |
| 6.2–6.4 L V8 | 575 | 1.66 (1.29–2.07) | 0.44 | 2.46 | 0.65 | 2.65 | derived |
| 6.6–7.3 L V8 heavy-duty gas | 600 | 1.92 (1.50–2.40) | 0.51 | 2.77 | 0.73 | 3.07 | derived |
| 2.0 L diesel I4 | 800 | 0.64 | 0.17 | 1.48 | 0.39 | 1.0 | **measured Jetta TDI** |
| 3.0 L diesel V6 | 700 | 0.85 (0.65–1.05) | 0.22 | 1.6 | 0.42 | 1.4 | derived (diesel k ≈ 0.28) |
| 6.6–6.7 L diesel V8/I6 (heavy-duty pickup) | 700 | 1.7 (1.5–2.2) | 0.45 | 2.6 | 0.69 | 2.7 | WVU/Argonne 0.44 gal/h for 6–10 L medium/heavy diesel |
| Full hybrid (e.g. Prius 1.8) | engine usually off | ≈ 0 fuel + 0.3 kW battery drain (repay later) | — | engine cycles: about 0.5–0.8 L/h effective with A/C (fill-in) | — | engine on: use the matching I4 row | measured Sonata idle; A/C value is a fill-in |

**Owner's cars:**

- **2011 Toyota Sienna LE 3.5 V6:** use the **3.5–3.6 L V6** row.
- **2016 Prius Two (1.8 hybrid):** use the hybrid row; when cold or heating, use the 1.8–2.0 L I4 row with the engine-on share from 6.4.

**Units:** 1 US gal = 3.785 L. Gasoline density is about 0.745 kg/L; diesel about 0.84.

## 8. Full integration scope agreed with the owner in the Codex planning session

This section is condensed from the owner's Codex conversations of 27 October 2026 and the docs Codex committed on `feature/traffic-rest-integration`. The owner's last integration instruction before research began was: *"let's integrate all of it: google maps traffic projection, disable here api for traffic projection by default, rest stop logic and searching."* The owner then paused integration for this research. The authoritative details remain in the repo docs named below; this list makes the handoff self-contained.

### 8.1 Google website traffic provider (TODO 53; `docs/TRAFFIC.md`)

1. **Dedicated desktop website reader**, initially experimental.
   - Select **Typical traffic**, then the weekday.
   - Move the **Time** slider with semantic controls (ArrowLeft / ArrowRight).
   - After every step, read `aria-valuetext` and correct any overshoot. A key press can skip a five-minute slot, and a tiny drag can do nothing. Five minutes is the smallest step verified.
   - Wait for the rendered data to settle.
   - The URL does **not** encode the Typical-traffic clock.
   - The observed slider ended at 10 PM. Do not silently clamp overnight requests; return "unsupported time" instead.
2. **Extraction:**
   - Prefer decoding time-specific tile or vector data. `/maps/vt/pb=…` traffic tiles were seen but not decoded.
   - A raster fallback needs a fixed north-up zoom and projection, matching per direction, an ambiguity mask, and keeping route overlays out of the sampled area.
   - The map is drawn on three canvases with no per-road DOM.
   - The **directions response** (route line, steps, durations, congestion spans) is the preferred calibration source (section 4.3).
3. **Evaluate each section at its arrival time**, including stops, destination waits, midnight / week rollover and time zones. Run one bounded re-check after stop planning.
4. **Store observations** by spatial cell, road / direction, weekday and clock bucket, plus fetch time. Do this independently of trips and cars, and share them across overlapping routes.
   - Use one or two traffic readers, not the station-worker count.
   - Bound memory, and support progress / cancel / checkpoints.
   - Log the selected clock, the clock actually read, coverage and reasons for unavailable data.
   - Set the TTL (cache lifetime) only after measurement.
5. **Validate before enabling routinely:** rush hour versus overnight, both directions, city versus highway, toll versus free roads, DST / timezone changes, delayed round-trip returns, bot checks, missing tiles. Compare against HERE on a small matched set.
6. **Bot checks:** pause, show the visible verification (existing site-check banner flow), then resume. **Never bypass.**

### 8.2 HERE traffic

- **Today:** Settings → Connections → **Use HERE for traffic forecasts** exists and is on by default (0.0.282).
- **Owner direction:** once the Google provider is validated, make HERE traffic **off by default**, as an explicit global opt-in.
- **Keep HERE tolls and the key independent.**
- **Never silently replace missing traffic** with uncongested speeds. This is distinct from D2, which concerns uncoloured roads within a successful Google read.

### 8.3 Rest stops and campsites (TODO 55; `docs/REST_PLANNING.md`, `docs/CAMPSITE_SOURCES.md`, `docs/CAMPSITE_FILTERS.md`)

- **Persistent, trip-independent inventory:**
  - **USDOT/BTS NTAD Truck Stop Parking** seed: 1,915 points in 48 states, about 61 KB compressed, unrestricted public use. Fields: name, highway, milepost, state, truck spaces.
  - **Overlays:** state DOT data and **OSM** (`highway=rest_area` / `services` plus amenities; OSM licence and attribution apply), and **Recreation.gov / RIDB** periodic downloads.
  - **What to keep for each place:** direction / entrance access, vehicle and trailer fit, amenities, hours, closure / stay limits, source dates, and unknowns. Unknown is not "no". Never reset restrictions to permissive values when a refresh lacks fields.
- **Walmart / private lots:** permission-dependent candidates only (corporate FAQ: store management and local law decide). The user must confirm permission for that vehicle, date and stay. A chain name is not permission.
- **User-facing sources:**
  - **Campendium** (preferred for photos and recent reports) and **FreeCampsites** (public detail JSON works; area search not proven; a blank price is not $0);
  - **RV Parky**: search verified; URL builder in `research/rest-traffic/site_links.py`. In `f`, x = latitude and y = longitude. `f` = 8 hex category digits + an amenity mask. `d` is the radius in miles. **Omit `s`**: the owner said to **ignore RV Parky reviews and stars** because they are too sparse;
  - **OpenCampingMap / OSM.**
- **Excluded:** iOverlander (owner). The Dyrt is optional only.
- **Filters:** pass the user's filters into provider searches.
  - Never silently drop a required filter.
  - Never treat radius as detour time, "big rig" as exact fit, or "water" as drinking water.
  - Report each filter as applied by the provider, enforced by Gasket, or unsupported.
  - FreeCampsites filters do not survive in a plain URL; use a controlled in-app page or Gasket-filtered individual links.
- **Concise controls** (proposed): `Rest stop` / `Overnight parking` / `Campground`; `Free only` / `Allow paid`; `View photos & recent reports`.

### 8.4 Rest-aware departure and arrival windows (TODO 56; prototype `research/rest-traffic/rest_timing.py`, 7 tests)

- **Three distinct outputs:**
  1. **soonest lowest-forecast-driving-time departure**;
  2. **latest checked departure that still meets the arrival window**;
  3. **earliest arrival overall.**
- **Never binary-search feasibility.** A later departure can become feasible again after congestion clears. Show separate feasible intervals.
- **Constraints:**
  - minimum rest, maximum wait / stay, facility hours and closures, applicable stay caps;
  - rest and charging overlap: ready time = max(rest end, charge end) when the user allows overlap;
  - all destination windows and both legs of a round trip;
  - timezone / DST.
- **Labels:** never call a time guaranteed or medically sufficient.
- **Planning approach:** hourly weather screening as the coarse stage, then refine on promising routes and sites with verified five-minute traffic samples.
  - Shifted timing must re-check hazards (grouped by identical hourly conditions), tariffs, tolls, reserves and forecast horizon.
  - Do not create a Cartesian product of sites × five-minute slots. Screen cheaply, then fully plan the best candidates. The owner already chose this over exhaustive checking for window planning.
- **Objective and display:**
  - keep the single **Cost / Time** objective (binary choice, with optional toll budget per leg or round-trip total, already shipped);
  - show waiting versus driving-time savings explicitly.

### 8.5 Order the owner expects

Research (done) → this energy / traffic model → Google provider plus calibration → HERE traffic off by default → rest inventory and searching → rest-aware windows → phone validation. Build signed arm64 + universal APKs only once app changes are ready. The CLAUDE.md release and phone-check rules apply.

**Note:** Codex's local tree held only research files and an npTDMS library install under `tmp/research-python` (for reading Argonne TDMS traces). No uncommitted app code was found in the folders inspected. Run `git status` before starting.

## 9. Suggested implementation order

1. **Pure modules first, with Node unit tests:**
   - `trafficmodel.js`: priors, the calibration solver, the section → (`v_moving`, `t_stopped`, `n_stops`) conversion, and the D2 guard rails;
   - `auxload.js`: the P_aux table, warm-up state and climate-preset mapping;
   - idle model: the section 7 table plus formula, keyed by EPA engine displacement / cylinders, which Gasket already has from EPA vehicle data. **Verify the field names.**
2. **Wire into `propulsion.js` / `trip.js` energy accounting** behind a flag, replacing (not adding to) the existing weather HVAC term. Write regression tests showing green / uncoloured sections reproduce today's estimates within tolerance.
3. **Google website traffic extraction** (experimental reader). Follow the acceptance gates in `docs/TRAFFIC.md`: verify the selected clock, settled data, road/direction matching, and pause and resume on bot checks. Then add calibration persistence.
4. **UI:** ranges and labels such as "estimated from typical traffic"; never claim a measured speed.
5. **Phone validation checklist:** rush-hour versus overnight routes, both directions, cold and hot days, EV and gas, and comparison against HERE where available.

## 10. Tests the implementer should add (minimum)

- **Colour model:**
  - priors are respected;
  - the NNLS calibration recovers known synthetic ratios within tolerance;
  - fits are rejected on mismatch, low coverage or missing duration;
  - uncoloured = free flow only when other roads are coloured, otherwise "unavailable".
- **Energy:**
  - green / uncoloured sections equal the current model;
  - red and dark red fall inside the Zhang multipliers;
  - a hybrid stays charge-neutral over a trip;
  - EV standstill energy = P_aux × t;
  - warm-up is applied once per cold start and not restarted by section boundaries;
  - preconditioning removes the warm-up penalty;
  - no divide-by-zero at 0 distance.
- **Idle:**
  - each table row is reproduced by the formula;
  - measured rows sit inside their ranges;
  - start-stop rules hold;
  - unknown displacement falls back to the EPA class median or a 2.5 L default, with an "estimated" label.
- **UI:** 320–448 px widths and 130% text, no horizontal scroll, labels present.

## 11. Known gaps (decide whether to proceed with defaults)

| Gap | Default to use now | Better data later |
| --- | --- | --- |
| Google colour → speed ratios | Section 4.2 priors plus 4.3 self-calibration | Matched-route calibration logs from phones |
| Stopped share and stops per km by colour | 4.2 / 4.4 defaults | Trajectory or OBD logs |
| EV energy below 10 mph (moving part) | UDDS-phase-2-like baseline + P_aux (D3) | Argonne traces at crawl speed |
| Measured idle with A/C by displacement | Section 7.3 derived table | Owner OBD idle logs (Sienna, Prius) |
| Sienna temperature effects | Camry / GL8 / Blazer patterns | Owner's own logs |
| Heat-pump performance by model | Heat-pump column vs resistive column | Per-model specs; vehicle databases |
| Climate-preset scaling factors | Linear setpoint-gap scaling (±40%), recirculation −15% | Controlled tests |
| Hydrogen auxiliary loads | Reuse the EV P_aux structure | Fuel-cell vehicle data |

## 12. Data access and rights notes

- **Argonne D3** requires the attribution: "This data is from the Downloadable Dynamometer Database and was generated at the Advanced Mobility Technology Laboratory (AMTL) at Argonne National Laboratory under the funding and guidance of the U.S. Department of Energy (DOE)". Some older bundles carry a publication/profit consent notice. Do not commit raw D3 files; commit derived tables with this attribution.
- **D3 summary sheets** are public Box shares:
  - Leaf `2esdlz7wiqpu5odqk90jn2myqz64u6gf`
  - Model 3 `6ybbqmq5orgq6m47nt8zjvfwmfohph6i`
  - Sonata Hybrid `bbo0chvvlpxijd0qvyphzutwkeoi5ocv`
  - Camry `k39kpkwrxcbte0j6340a2ysiz6tvdp44`
  - Blazer `qc7324oek427s6o7olypubrb9vd2m5xc`

  The shell in the cloud sessions cannot reach Box or anl.gov (proxy 403); the browser can.
- **Library papers:** cite them, don't copy them. Numbers here are short factual extracts.
- **Google content:** follow `COMPLIANCE.md` and the Google attribution rules. Keyless website extraction remains experimental and subject to the gates in `docs/TRAFFIC.md`.

## 13. Sources

**Google and traffic:**

- [Google Roads Management Insights concepts](https://developers.google.com/maps/documentation/roads-management-insights/rmi-concepts)
- [Google traffic legend help](https://support.google.com/maps/answer/3092439?co=GENIE.Platform%3DDesktop&hl=en)
- [HTC G1 manual (2008 legend)](https://www.manualslib.com/manual/73079/Htc-G1.html?page=76)
- Patents: [US9311819B1](https://patents.google.com/patent/US9311819B1/en), [US7859535B2](https://patents.google.com/patent/US7859535B2/en)
- [Wagner et al. 2020 IFAC](https://ifatwww.et.uni-magdeburg.de/ifac2020/media/pdfs/2531.pdf)
- [Loja, Ecuador 2020](https://www.scitepress.org/Papers/2020/95945/95945.pdf)
- [Hong Kong 2023](https://www.sciencedirect.com/science/article/pii/S1352231023004855)
- [Tehran 2024](https://www.sciencedirect.com/science/article/pii/S2666691X24000459)
- [Dhaka 2020](https://arxiv.org/pdf/2011.02359)
- [Delhi 2022](https://arxiv.org/pdf/2205.01640)
- [Al Ain 2024 (GoogleTraffic R package)](https://www.sciencedirect.com/science/article/pii/S2590198224002471)

**Fuel and energy:**

- [Zhang et al. 2025](https://www.sciencedirect.com/science/article/pii/S1361920925001014)
- [Wang, Xu et al. 2022](https://www.sciencedirect.com/science/article/pii/S0306261921013635)
- [Wang et al. 2020](https://www.sciencedirect.com/science/article/pii/S0016236120313363)
- [Huo et al. 2014](https://www.sciencedirect.com/science/article/pii/S0360544214002503)
- [Kropiwnicki 2019](https://www.sciencedirect.com/science/article/pii/S0360544219312460)
- [VT-CPFM validation](https://www.sciencedirect.com/science/article/pii/S2046043016300880)
- [Seo et al. 2025](https://doi.org/10.1016/j.enconman.2025.119493)
- [Cha & Seo 2026](https://www.sciencedirect.com/science/article/pii/S1359431126035945)
- [BEV energy flow in extreme climates 2026](https://www.sciencedirect.com/science/article/pii/S0306261926007154)
- [Norway preheating 2023](https://www.sciencedirect.com/science/article/pii/S030626192300418X)
- [Zhang & He 2026 (arXiv, simulation)](https://arxiv.org/pdf/2605.05919)

**Standstill, idle and police:**

- [ADAC heating test](https://www.adac.de/rund-ums-fahrzeug/elektromobilitaet/tests/heizung-elektroauto/)
- [ADAC hot jam (InsideEVs)](https://insideevs.de/news/728377/elektroauto-autobahnstau-stromverbrauch-klimaanlage/)
- [Argonne idling worksheet](https://sandbox4-www.anl.gov/sites/www/files/2018-02/idling_worksheet.pdf)
- [Argonne "Which is greener"](https://afdc.energy.gov/files/u/publication/which_is_greener.pdf)
- [AFDC emergency-vehicle idling](https://afdc.energy.gov/uploads/publication/idling_emergency-service_vehicles.pdf)
- [AFDC idle-reduction case study](https://afdc.energy.gov/files/u/publication/idling_reduction_emergency_vehicles_case_study.pdf)
- [Glastonbury Police bulletin](https://glastonburyct.gov/home/showpublisheddocument/3031/635495271344870000)
- [Ford Police Interceptor idle claims](https://www.guideautoweb.com/en/articles/15553/new-ford-police-interceptors-deliver-up-to-35-percent-better-fuel-economy-when-idling)
- [NRCan idling calculations](https://www.nrcan.gc.ca/energy/efficiency/communities-infrastructure/transportation/idling/4457)

**Argonne D3:**

- [D3 landing page](https://www.anl.gov/taps/downloadable-dynamometer-database)
- [2019 Leaf e+](https://www.anl.gov/taps/d3-2019-nissan-leaf-eplus)
- Box shares as listed in section 12.
