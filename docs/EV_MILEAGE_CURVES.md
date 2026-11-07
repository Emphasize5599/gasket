# EV mileage (consumption vs speed) curves

Research 2026-11-07. Goal: find which EVs have an established, sourced consumption-versus-speed curve so Gasket can plan trips accurately even when the absolute mileage is off.

## Summary

1. **Every EPA-certified EV has an official road-load curve.** EPA's [Test Car List](https://www.epa.gov/compliance-and-fuel-economy-data/data-cars-used-testing-fuel-economy) gives coast-down target coefficients A (lbf), B (lbf/mph) and C (lbf/mph²) for each test vehicle. Road force is F(v) = A + Bv + Cv², and wheel energy per mile is F × 1.9884 Wh/mi. MY2017–2026 has about 1,400 electric test configurations (1,127 year/make/model labels, including plug-in hybrids). Rows are separate by wheel size where tested, e.g. Model S Plaid 19″ vs 21″. Every established pack in `chargecurve.js` is covered: 2020–21 Model 3 SR+/LR AWD, 2021–25 Model S/X refresh and Plaid, 2022 Bolt EV, 2022 R1T/R1S. Extracted table: [epa_ev_roadload_my2017_2026.json](../research/ev-mileage/epa_ev_roadload_my2017_2026.json); script: [extract_epa_roadload.py](../research/ev-mileage/extract_epa_roadload.py).
2. **Measured multi-speed curves exist for a few cars.**
   - DOE/INL AVTA steady-state dynamometer tables, 10–80 mph: [2013 Nissan Leaf](https://www.energy.gov/sites/prod/files/2015/01/f19/fact2013nissanleaf.pdf) and [2013 Ford Focus Electric](https://www.energy.gov/sites/prod/files/2015/02/f19/fact2013fordfocus.pdf). Each sheet also lists that car's own coast-down coefficients.
   - TUM's measured 2020 Model 3 SR+ LFP polynomial, already in `propulsion.js`.
   - Argonne's [D3](https://www.anl.gov/taps/d3-2020-tesla-model-3) holds second-by-second dynamometer data, including a 2020 Model 3 Long Range. Argonne's steady-state procedure steps in 10 mph increments to 80 mph. Its availability for each vehicle is unverified.
3. **Two real-road speeds for many cars.** Bjørn Nyland's constant 90 and 120 km/h tests (mirrored by [Zerofy](https://www.zerofy.net/ev-database.html)): 293 cars, 180 with both summer speeds. These are European-spec cars on public roads, measured from the car's own battery readout at roughly 11–20 °C.

## Findings

**A. Gasket's EV speed model had a units bug (fixed in 0.0.413).** It scaled per-mile energy by the power ratio instead of power/speed. Compared with the measured Leaf dynamometer ratios:

| Speed change | Before | After | Measured |
|---|---|---|---|
| 60→80 mph | ×1.82 | ×1.37 | ×1.39 |
| 65→30 mph (traffic) | ×0.27 | ×0.60 | ×0.53 |

**B. The curve shape: per-car coast-down data is modestly better than Gasket's generic curve.** On 30 Nyland cars matched to EPA coefficients, predicting each car's 120/90 km/h consumption ratio:
- Coast-down shape (battery Wh/mi = F·1.9884/0.85 + 1.6 kW/v): bias about 0, mean error 2.9%, correlation 0.45 with the measured ratio.
- Gasket's generic shape: bias −2.7%, mean error 3.7%.

The measured ratio itself spreads 1.31–1.48 across cars (p10–p90, median 1.39), so cars genuinely differ. The 1.6 kW term is fitted. It absorbs real-road losses beyond the dynamometer, such as wind, tire temperature and accessories; it is not a measured accessory load. On the DOE dynamometer data alone, a two-parameter fit (η 0.80, 1.6 kW) reproduces the Leaf at 40–80 mph within about 2%.

**C. The absolute level: the EPA highway label equals about 65 mph steady.** Gasket anchors the EPA label at each segment's own route speed (highway label at 55 mph and above), then applies the speed shape. Comparing 30 Nyland cars to their EPA highway label, wall basis, assuming 0.88 charging efficiency:
- At 90 km/h (55.9 mph): median 0.85 × label.
- At 120 km/h (74.6 mph): median 1.19 × label.
- Interpolated, the label equals a steady speed of about **65 mph** (median; 27 of 30 cars fall between the two test speeds).

So on a 70 mph interstate Gasket's baseline is roughly 8% optimistic, and at 75 mph roughly 16%. This assumes Google's route time reflects the actual cruising speed. Absolute numbers carry the conversion assumptions above and European-spec differences.

**D. Energy basis.** EPA label kWh are measured at the wall. Usable pack kWh are battery-side. 0.0.412 converts EPA efficiency with the label's own range: usable / (range × kWh per mile), 0.861 for the 2021 Model 3 LR.

## Implemented in 0.0.416

1. **The EPA highway rating is taken at 65 mph** (`Propulsion.LABEL_MPH`), for EPA-derived efficiencies only. Highway stretches (route speed 55 mph or more) are referenced to 65 mph. A blended stretch's reference moves from its own speed at 25 mph to 65 mph at 55 mph, following the same blend that mixes the city and highway ratings. Typed (observed) highway efficiencies stay referenced to the route speed. City stretches are unchanged.
2. **Each car's EPA coast-down sets its speed curve.** Battery power is road load × v / 0.85 + 1.2 kW. A car without a matched test vehicle uses the median MY2017+ battery EV (A 39.52 lbf, B 0.2483, C 0.01934; flag `road_load_typical`).
   - The 1.2 kW term is a compromise. On the 30 matched Nyland cars it gives 3.3% mean error (1.6 kW gave 3.1%). It keeps the Leaf dyno's traffic ratio closer (65→30 mph: 0.56 vs 0.53 measured; 1.6 kW gives 0.59). Its 60→80 mph ratio is 1.45 against 1.39 on the dyno (a lab with no wind).
   - The median curve predicts a 1.40 ratio for 120 vs 90 km/h; Nyland's median is 1.39.
3. **Data:** `assets/web/evroadload-data.js`, built by `tools/gen-ev-roadload.py` (EPA Test Car List MY2017–2026 + fueleconomy.gov vehicles).
   - Battery EVs only: Electricity test fuel, with an EV displacement marker (under 0.1 L, or 99.99 L in older years).
   - Matched to fueleconomy.gov names offline, with wheel sizes preferred. Equally good rows are averaged; a neighboring model year is used when the same year has none, and is marked.
   - 1,415 of 1,569 MY2017+ EPA EVs matched. The misses are mostly MY2026–27 cars not yet in the test lists, plus a few naming oddities (Polestar, i3, e-Golf).
4. **Three EV types in Add Car:**
   - **EV: charging and efficiency curves:** an established pack.
   - **EV: efficiency curve only:** an EPA road-load test, no pack. Charging uses the typed curve, else Open EV Data's, else a typical curve at the entered peak, marked as an estimate.
   - **EV: no curves:** neither; typical speed curve and estimated charging.
   - Each type's menus list only its own models. Custom still lists every EPA vehicle.
5. Completed EV plans saved before 0.0.416 are rebuilt once (`PlannedTrip` identity `ev-energy-416`).

## Cautious margins (0.0.417)

The owner asked to err on the side of caution, so the planner uses the pessimistic end of the measured spread rather than the median:
- **Label speed 61 mph:** the 20th percentile of the label-equivalent steady speed across the 30 cars (the median is 65 mph). About four in five cars use no more than planned at highway speed.
- **Untested cars:** the speed curve is the 80th-percentile battery EV's (2025 Volvo EC40 coefficients; 120 vs 90 km/h ratio 1.45, against a median of 1.40).
- **Estimated charging curves:** charge 15% slower. These are the curves for EVs without an established pack: Open EV Data or the typical curve.
- **Result for a typical untested EV:** 1.32 times the label at 75 mph (Nyland median 1.19, 90th percentile 1.34) and 0.90 at 56 mph (median 0.85, 90th percentile 1.00).
- **Not covered:** cold weather and wind. Nyland's tests are mild-weather runs, so these remain the larger real-world risk.

## Still open

1. **Calibration data to collect:** ANL D3 steady-state tables for US cars (Model 3 LR, Bolt). US single-speed tests: InsideEVs, Car and Driver (75 mph), Edmunds. Per-car Nyland pairs as validation fixtures.
2. **Temperature and wind remain the dominant real-world error.** The Leaf track tests at 60/70 mph ran 9–27% above the dynamometer at the same speed. Propulsion's weather/HVAC model covers temperature only.
