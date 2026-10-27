# Traffic fuel consumption and EV cabin loads

Research date: October 27, 2026. Research checkpoint on `feature/traffic-rest-integration`; no production model change or APK.

## Scope and access

Owner priority: measured gas-mileage effects of slow/stop-go traffic, plus EV cabin loads tied to Garage climate settings. Retain existing battery cooldown measurements; do not replace them or count pack cooling twice.

ASU-Beebe's library database link successfully opened an institution-authorized ProQuest session. STEM search was too narrow (three results for the initial hybrid/congestion query); expanding to ProQuest Central returned 363. Targeted title searches then supplied full text for the EV cabin experiment and the 2025 gasoline/diesel road-test paper below. Public primary research/report sources supplemented the library searches. No credentials/session tokens were collected or saved, and no full copyrighted papers are committed here.

Only the individually identified studies/methods were reviewed, not every search result. Some full-text/PDF retrievals failed; unsuccessful access is not evidence about a paper's findings. Date metadata and search snippets can be misleading: check the document's own title, methods and dates.

## Evidence register

### E1 — Prius versus Corolla in real congestion (measured)

Pitanuwat and Sripakagorn (2015), *An Investigation of Fuel Economy Potential of Hybrid Vehicles under Real-World Driving Conditions in Bangkok*, DOI [10.1016/j.egypro.2015.11.607](https://doi.org/10.1016/j.egypro.2015.11.607). [Accessible full paper](https://www.researchgate.net/publication/285782072_An_Investigation_of_Fuel_Economy_Potential_of_Hybrid_Vehicles_under_Real-World_Driving_Conditions_in_Bangkok).

2014 Prius and 2015 Corolla Altis, four drivers, 12 tests per car, over 400 km; A/C auto at 25 C, initial Prius SOC 51%. Calm city samples averaged 5–10 km/h with 37–46% idle time. Maximum reported hybrid fuel reduction was 47.3% versus the conventional car. Battery state and acceleration affected results. Useful traffic-pattern/HEV evidence, not universal MPG or Google color calibration. Initial SOC control does not establish that every microtrip is charge-neutral. Use net SOC correction in any new fitting. Tables 1–2 and methods 3.2–3.3 were inspected; do not import thresholds or drivetrain behavior fleetwide.

### E2 — Modal fuel rates and traffic time shares (measured plus extrapolation)

Fukuda et al. (2017), *Impact on fuel consumption reduction of introducing hybrid cars in Bangkok using probe information and mobile fuel measurement*, DOI [10.14456/easr.2017.34](https://doi.org/10.14456/easr.2017.34). [Publisher record](https://ph01.tci-thaijo.org/index.php/easr/article/view/104394), [paper](https://www.thaiscience.info/Journals/Article/EASR/10988716.pdf).

Combines approximately 10,000 taxis' probe observations with fuel-rate measurements from one hybrid/conventional pair. Separates idling, crawling, accelerating, cruising and decelerating, and hybrid engine-on frequency. Fleet replacement outcomes are extrapolations, not measured fuel consumption of 10,000 hybrids. Useful structural precedent for time-weighted modal consumption. Fuel-rate tables are rasterized and were not successfully visually extracted in this pass; no table coefficients are transcribed or approved for code. Narrative equation labels also need verification before reuse.

### E3 — Gasoline/diesel urban cycle (library full text)

Nitoiu, Cofaru and Popescu (2025), *Influence of road and traffic conditions on emissions and fuel consumption of light vehicles in a real urban driving cycle*, DOI [10.1007/s11356-025-36573-3](https://doi.org/10.1007/s11356-025-36573-3). [Library document](https://www.proquest.com/docview/3224405936).

Real urban observations inform dynamometer replay on four Euro 6 vehicles. Shows engine/load/traffic differences and provides methods for comparing gasoline/diesel consumption. Small fleet, one locality; OBD/derived quantities and dynamometer results must be distinguished. Abstract/body descriptions of the heavier-traffic time of day are inconsistent. Do not fit blanket gas/diesel multipliers from its reported instantaneous g/s ranges or assume those ranges are whole-trip averages. Further extraction needs exact vehicle/cycle totals, measurement provenance and conditions.

### E4 — Hybrid air conditioning and engine-on behavior (lab measured)

Rask et al. (2010), *Model Year 2010 Ford Fusion Level-1 Testing Report*, ANL/ES/RP-68384. [Actual report](https://publications.anl.gov/anlpubs/2010/11/68384.pdf).

Important provenance correction: search metadata calls this a Prius investigation, but its cover and contents describe a **Ford Fusion Hybrid**. It records 10 Hz instrumentation and unadjusted cold/warm urban results of 45/49 mpg. A/C reduces urban engine-off operation; its electrical demand ultimately needs engine generation during charge-sustaining use. Useful independent HEV cross-check. Do not use these laboratory MPG values as EPA labels or Prius measurements. Sections 4 and 7–8 inspected; obtain actual D3 traces for new calibration.

### E5 — Congestion dynamics versus steady speed (model applied to real trajectories)

Barth and Boriboonsomsin, *Real-World CO2 Impacts of Traffic Congestion*, TRB 2008 submission revised November 2007. [Full manuscript](https://la-plan.caset.buffalo.edu/papers/traffic_congestion.pdf).

Separates real-trajectory and constant-speed consumption behavior; smoothing stop-go can matter even at equal average speed. Table 1 gives fleet CO2 curve fits, not direct vehicle-specific fuel measurements. Older California fleet and model assumptions limit transfer to modern hybrids/EVs. Useful shape/method validation, not coefficients to paste into Gasket. Any carbon-to-fuel conversion needs the applicable fuel basis and units; model fit R-squared is not held-out fuel-prediction accuracy.

### E6 — Parked EV heating/cooling (library full text, measured)

Russi et al. (2022), *Air Quality and Comfort Characterisation within an Electric Vehicle Cabin in Heating and Cooling Operations*, DOI [10.3390/s22020543](https://doi.org/10.3390/s22020543). [Library document](https://www.proquest.com/docview/2621379754), [publisher](https://www.mdpi.com/1424-8220/22/2/543).

2018 Leaf Acenta 40 kWh, parked outdoor one-hour tests. Heating setpoint 30 C/cooling 16 C, maximum fan; separate HVAC/heater/accessory readings. Initial heating total exceeded 4 kW. Recirculation used roughly 20% less cooling energy; heating discussion says about 25% less, conclusion about 30%. Treat this as an approximate 25–30% study-specific result, not an exact multiplier. Extreme settings, one vehicle, uncontrolled weather/solar and no passengers limit generalization. Evidence supports separate startup and maintenance loads; ventilation tradeoffs preclude automatically enforcing recirculation for savings.

### E7 — Heat-pump vehicle auxiliary prediction (measured and simulated, distinguished)

Schafers et al. (2024 issue; first online December 2023), *Auxiliaries' power and energy demand prediction of battery electric vehicles using system identification and deep learning*, DOI [10.1049/itr2.12467](https://doi.org/10.1049/itr2.12467). [Full text](https://ietresearch.onlinelibrary.wiley.com/doi/full/10.1049/itr2.12467).

149 real vehicle datasets, mostly short trips and approximately 0–25 C, with heat pump plus separate electric heaters. Simulation inputs also include sun, humidity, occupants, recirculation and preconditioning; some were unknown in real measurements. Real-data mean signed energy errors around -3.09%/-8.73% are not absolute-error guarantees. Data unavailable due to third-party restrictions. Useful input/state design and uncertainty evidence, not downloadable training data or permission to claim equivalent Gasket accuracy. Sections 3.3/4.2/data availability inspected.

### E8 — Attractive result excluded from calibration

Skuza et al. (2023), DOI [10.19206/CE-169569](https://doi.org/10.19206/CE-169569), [paper](https://www.combustion-engines.eu/pdf-169569-93360?filename=93360.pdf), reports 53% lower hybrid fuel consumption over 28 trips. Its own abstract identifies **simulation** results. Keep as supporting context only; do not relabel that percentage as measured fleet performance.

## Concrete code gap

Targeted inspection of `assets/web/propulsion.js` found `hvac(t,p)` selects outside-temperature curves using `p.heatPump`. It does not inspect the Garage climate presets. Those presets in `assets/web/climate.js` already contain temperature, auto/manual mode, fan, A/C state, fresh/recirculated air, defrost, seat/wheel heating/cooling, rear climate and windows/roof state. Existing thermal and climate advice features do not establish that these controls currently affect EV energy.

This is an implementation finding, not a request to alter those settings in this research pass. Existing generic driving calculations normalize against a baseline and add additional weather HVAC demand; simply adding a new full HVAC number on top would double-count some loads.

## Proposed modeling contract

For each road/time segment, keep these components separate at a consistent battery-terminal accounting boundary:

`net traction kWh + cabin HVAC kWh + low-voltage accessory kWh + pack thermal kWh`

Include conversion losses exactly once. Shared cabin/pack compressors require joint load allocation, not two full compressor budgets. Preserve the existing pack cooldown work, noting its own confidence. During charging, allocate cabin demand from the inlet budget while reconciling purchased energy separately.

1. Resolve the applicable saved climate preset for route season/weather and local time. Treat it as intended behavior, not observed controller telemetry. Define conflicts between season, special-weather and manual trip overrides explicitly. Changes need to invalidate energy/cost estimates, not station discovery.
2. Separate initial heat-up/cool-down from maintenance. Track cabin thermal state across adjacent sections; a new Google traffic cell or stop must not restart warm-up. Track parked soak and plugged-in preconditioning separately. Account for energy source when charging costs matter.
3. Feed ambient temperature, solar load/daylight, humidity, target temperature, vehicle cabin size, heat-pump/resistive equipment and mode into bounded estimates. Heating/cooling thermal output is not electrical input: apply COP and backup resistance behavior. Missing sun/humidity/hardware becomes an uncertainty range, not zero load.
4. A/C off does not mean electric heating is off. Auto/defog can run compressor plus heat; do not misread a toggle as the real compressor duty cycle. A fan level is ordinal and vehicle-specific, not that fraction of peak HVAC kW. Dual/rear zones are not automatically a two-times load.
5. Resolve seat/wheel/defrost and other accessory loads separately where equipment data exists, accounting for duty cycles. Preserve needed visibility/ventilation. Do not recommend compromising defogging or adopt a fleetwide recirculation saving from one experiment. Automatic recirculation is uncertain, not always fresh or always recirculated.
6. Integrate power over elapsed time, including queueing. Use Wh/mile only for display on nonzero distance; do not divide by zero at standstill. Hypothetical 1.5 kW sustained load adds 150 Wh/mile at 10 mph, or 375 Wh/mile at 4 mph; these are arithmetic scenarios, not fitted default powers.
7. ICE/HEV need equivalent elapsed HVAC effects through their own fuel/engine/SOC models. Treat gasoline, diesel, start-stop, mild/full hybrid and PHEV operation separately. SOC-neutral cycles prevent temporary electric operation from looking like zero long-run fuel use. Never enforce city EPA MPG as a floor.
8. Fit compact powertrain/cycle/climate tables offline using independently measured traces. Normalize the combined model to EPA/observed anchors rather than overlaying full city-cycle losses again. Avoid running a neural network or a per-second simulation for every combination on the phone merely because a paper did so.

## Evidence needed before numerical integration

1. Retrieve D3 fuel/energy traces and metadata for several conventional, full-hybrid and EV examples, including the user's Prius class. Verify current raw-data availability and reuse terms. Match measured fuel/terminal energy, cycle speed/time, SOC change, ambient/cabin conditions and start state; paired vehicles must not be assumed otherwise identical.
2. Use independent holdout cycles/vehicles, especially sustained crawling versus smooth low speed, long queues, warmed versus cold engines and cabins, and hot/cold HVAC. Report energy bias and absolute error plus arrival-SOC/feasibility consequences; in-sample fit or signed mean error is insufficient.
3. Fuel-consumption/thermal data does **not** calibrate Google color-to-speed or stopped-fraction probabilities. Separately match exact road/direction/time against travel-time observations; keep unknowns and uncertainty. No validated numeric color factors were obtained in this pass.
4. Exact vehicle-specific low-speed fuel curves and ordinary-setpoint EV cabin-power tables are still missing. The papers strengthen model structure and bounds; they do not justify claiming accurate per-car fuel predictions yet. No dataset fitting, coefficient import or performance claim occurred here.

Related backlog: 50, 52, 53. Integration overview: [TRAFFIC_REST_HANDOFF.md](TRAFFIC_REST_HANDOFF.md).
