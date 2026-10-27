# Traffic, energy and rest planning integration checkpoint

Updated October 27, 2026. Branch: `feature/traffic-rest-integration`.

## Purpose and current state

Preserve the complete research and agreed integration direction before further library research. This branch inherits the existing app and research commits from main at b4cbeb1. It does not enable an unvalidated Google traffic reader or claim that production rest planning is implemented. The owner paused production integration to improve the evidence for traffic speeds and energy consumption; subsequent instruction requests a branch checkpoint so this work is not lost.

Start here in a new session, then read the linked documents relevant to the next task. Do not reconstruct completed research from chat history or rerun unchanged tests/builds. Sync and preserve others' changes before implementation.

## Existing evidence and prototypes

1. [TRAFFIC.md](TRAFFIC.md): HERE matching and independent traffic setting; actual Google future departure and Typical traffic experiments, semantic clock controls, limitations and production acceptance gates.
2. [REST_PLANNING.md](REST_PLANNING.md): measured NTAD inventory (1,915 points/48 states), five-minute traffic-control experiments, rest timing semantics, seven deterministic prototype tests and integration work.
3. [CAMPSITE_SOURCES.md](CAMPSITE_SOURCES.md): inspected government/open and public campsite sources, coverage and access limitations.
4. [CAMPSITE_FILTERS.md](CAMPSITE_FILTERS.md): verified RV Parky search and filter URLs, Campendium handoff, unsupported filter handling. RV Parky ignores reviews/stars; iOverlander is excluded.
5. `research/rest-traffic/`: rest_timing.py, site_links.py, benchmark_ntad.py and 11 previously passing timing/link tests. These are research prototypes, not app adapters.
6. [PROPULSION_MODELS.md](PROPULSION_MODELS.md): existing EV/hydrogen model assumptions and calibration limits. Current average-speed handling is not a complete traffic-cycle model.

## Agreed integration direction

1. Add an experimental Google website traffic provider, using the chosen weekday/time and each road section's projected arrival, not one fixed map snapshot for the entire trip. Verify the actual selected clock and settled data. Five-minute displayed controls do not prove independent five-minute source observations. Decode structured geometry/time data if available; a raster fallback must establish road, direction, projection and ambiguity handling. A controllable slider alone does not meet the extraction gate.
2. Once a validated Google provider exists, make HERE traffic forecasts disabled by default, with an explicit global opt-in; keep HERE tolls and the key independent. Currently HERE traffic remains on by default. Do not silently replace missing traffic with uncongested speeds.
3. Share persistent traffic observations across trips/cars by road/direction, geographic area, weekday/time and source timestamp. Reuse overlapping routes, keep readers bounded, support progress/cancel and pause/resume on site verification. Determine TTL from measurements.
4. Build persistent rest inventories from government/state DOT/OSM sources, preserving direction/access, current rules, stay limits, amenities, dates and unknowns. Walmart/private parking requires applicable permission; a chain name is not overnight permission.
5. Let users set rest requirements and pass supported constraints to external campsite searches. Never silently drop required filters or equate radius with actual detour. Use the verified RV Parky URL builder, ignore its reviews/stars, exclude iOverlander. Unverified provider mappings remain unsupported.
6. Show the soonest lowest-forecast-driving-time departure, latest checked departure meeting arrival windows, and earliest arrival as distinct options. Include minimum rest, maximum wait/stay, opening hours, charging overlap, all destination windows and both return legs. All times must account for timezone/DST. Do not label these options guaranteed or medically sufficient.
7. Preserve the shared Cost/Time objective. Screen/prune cheaply before expensive stop planning; do not recreate the earlier Cartesian explosion. Shifted timing must revalidate hazards, tariffs, tolls and energy reserves. Preserve existing station discovery and fresh prices when the area is unchanged.

## Traffic color and energy modeling plan

No numerical Google color-to-speed coefficients have been validated. Current Google help defines congestion categories, not stable mph cutoffs. Green is free flow for that road, orange reduced flow, red substantial delay, dark red severe congestion/queues. Uncolored means unknown. Dark red does not establish sustained standstill at every point.

Estimate a distribution of moving speed, stopped fraction and acceleration intensity relative to each road's free-flow baseline. Calibrate section times against numeric same-route departure estimates; do not spread delay from a different route onto the selected geometry. Matching total duration cannot uniquely identify local speeds or validate fuel consumption. Independently test both time and energy against held-out measurements.

Gas/diesel: model road load, load-dependent engine efficiency, acceleration, engine-on idling, stop-start, warm-up and HVAC. Moderate steady slowing can improve economy; congestion is not uniformly harmful.

Full hybrids: include engine-off stops, limited regenerative recovery, battery state-of-charge balance and engine-on heating/warm-up/recharging. City EPA economy is an anchor, not a floor. Distinguish mild/full hybrids and PHEV charge-depleting versus charge-sustaining operation; do not count net battery depletion as free fuel.

EVs: include traction/regen plus time-based cabin/electronics and battery thermal loads. Auxiliary kWh = average auxiliary kW multiplied by elapsed hours. Hypothetical 1 kW for an hour over five miles adds 200 Wh/mile; this is an illustration, not a measured universal accessory load. Do not extrapolate the existing one-car highway polynomial below its validated speeds or apply it fleetwide. Account for existing conservative regen handling in the reserve planner.

Hydrogen: use fuel-cell/buffer-battery/regen and auxiliary behavior rather than treating it as an ICE or directly transferring EV coefficients.

Use EPA second-by-second cycles and measured vehicle data to calibrate offline, producing compact runtime tables by vehicle/powertrain, temperature, speed and traffic pattern. Avoid per-second simulations for every route/hour combination on the phone. Avoid counting urban acceleration/idling and HVAC twice when normalizing against EPA/observed baselines. Report estimated consumption/range with uncertainty; use conservative feasibility assumptions until independently validated. No accuracy percentage is established yet.

## Research sources already identified

These sources were inspected at page/report level; relevant raw vehicle datasets have not yet been downloaded and fitted for this task.

1. [Google traffic legend](https://support.google.com/maps/answer/3092439?co=GENIE.Platform%3DDesktop&hl=en): categorical interpretation. [2009 historical explanation](https://maps.googleblog.com/2009/08/arterial-traffic-available-on-google.html): relative road-speed context, not modern numeric coefficients.
2. [EPA dynamometer schedules](https://www.epa.gov/vehicle-and-fuel-emissions-testing/dynamometer-drive-schedules): UDDS urban, NYCC crawl, HWFET highway, US06 acceleration and SC03 AC second-by-second inputs.
3. [Argonne dynamometer database](https://www.anl.gov/topic/downloadable-dynamometer-database?content-type=project&sort_by=title&sort_order=ASC): measured conventional, hybrid, PHEV and EV data. Select vehicle/temperature/cycle samples with explicit coverage; do not assume every desired configuration exists.
4. [FASTSim validation report, 2021](https://docs.nlr.gov/docs/fy22osti/81097.pdf): physics model and validation foundation; library integration and model-specific accuracy are not established by citing it.
5. [Galvin, 2017, Energy consumption effects of speed and acceleration in electric vehicles](https://www.sciencedirect.com/science/article/pii/S1361920915301280), DOI 10.1016/j.trd.2017.04.020: eight-vehicle laboratory evidence that acceleration matters; not universal modern fleet coefficients.
6. [DOE/Argonne cold-temperature BEV performance, 2024](https://www.energy.gov/sites/default/files/2024-10/Impact_of_Cold_Ambient_Temperature_on_BEV_Performance_v15_TechEditFinal_12Sep2024__0.pdf): elapsed HVAC/thermal demand and vehicle/temperature dependence.
7. [Toyota hybrid operating guidance](https://www.toyota.com/content/dam/toyotaowners/digital-owners-manual-v2/en/om0r160u/chapter/ch04se060401.html): cold engine/cabin can prevent engine shutdown.
8. Public anecdotes sampled: [relative freeway color/speed discussion](https://www.reddit.com/r/changemyview/comments/17kvhug/), [orange/intersection discussion](https://www.reddit.com/r/GoogleMaps/comments/19b9417/), [dark-red interchange clear on later arrival](https://www.reddit.com/r/AskLosAngeles/comments/1pjq67r/). Search excerpts were available; full thread opens were unreliable. These are anecdotal checks, not a representative user survey or calibration data.

## Next library research and implementation gates

1. Owner will log into a library proxy in the browser. Let the owner enter credentials; do not store/copy credentials, cookies or session tokens into repo/logs. Use accessible licensed papers for research and citation, without committing full copyrighted papers.
2. Search measured stop-go fuel/energy models (ICE gas/diesel, stop-start, full/mild hybrid, EV, fuel-cell), idle/auxiliary loads, thermal effects and SOC-neutral testing. Investigate Google traffic category ground-truth, historical reliability and spatial/directional matching separately. Record publication year, sample vehicles/cycles, temperature, model equations/units, validation splits, uncertainty and reuse rights.
3. Maintain an evidence matrix distinguishing measured facts, source-specific inferences, hypotheses and unsupported gaps. Collect supporting and conflicting observations; do not turn anecdotes or proprietary color legends into fitted constants.
4. Prototype extracted traffic observations on matched rush-hour/overnight roads; validate selected time, repaint identity, road/direction, numeric travel-time agreement, missing data and bot-check handling before enabling a production provider.
5. Fit and independently validate consumption tables using actual raw measurements. Include steady low-speed versus stop-go at the same average speed, hot/cold HVAC, hybrid SOC balance, and uncertainties. Benchmark runtime and long-route memory.
6. Then implement the production adapters/UI and rest timing, targeted regression tests and phone acceptance. Build arm64 and universal signed APKs only after app changes are ready; no build/version bump is needed for this checkpoint.

Backlog owners remain items 50, 52, 53, 55 and 56 in [TODO.md](../TODO.md). Keep them open until their acceptance work actually ships.
