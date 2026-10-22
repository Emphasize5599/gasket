# EV charging and hydrogen fill time: research (TODO 50)

Historical research, 2026-10-22. Its proposed formulas and old description below are **not the current implementation**. The corrected v3 reference and production integration are described in [PROPULSION_MODELS.md](PROPULSION_MODELS.md). Vehicle comparison already exists. Do not use the old proposal tables below as a description of shipped behavior or as validated model-specific curves.

**What the app does today** (`Trip.serviceMinutes`, `AltFuel.charging`, [REFUEL_TIME.md](REFUEL_TIME.md)):
- **EV DC:** kWh ÷ (0.7 × min(car DC kW, default 150; station kW)).
- **EV AC:** 0.9 × min(car AC kW, default 7.2; station kW). Level 1 is about 1.4 kW.
- **Destination charging:** a generic ">90% slows" factor and 10% losses.
- **Hydrogen:** kg ÷ 1 kg/min.
- **Setup minutes:** 5 for EV, 3 for gas and hydrogen. Detour time is added on top.

**Labels:**

| Label | Meaning |
|---|---|
| **[M]** | Measured: a published test, fleet or station data. |
| **[C]** | A manufacturer's or network's claim. |
| **[S]** | A standard, model or design value. |
| **[2nd]** | A third party whose method is unstated. |
| **[A]** | Anecdote: one owner's log or a forum post. |
| **[E]** | Our own estimate or arithmetic, with no source behind the number itself. |

Every planned minute derived from this document is an estimate and must be labeled as one in the app.

---

## Part 1: EV DC charging curves

### Measured shapes

| Car | Usable kWh | Peak kW | Measured curve | 10–80% |
|---|---|---|---|---|
| Tesla Model 3 LR, V3 Supercharger | ~75 | 250 | 250 kW from ~5% to 24%. 120 kW at 50% (min 13). 54 kW at 80% (min 28). [M, 1] | ~26 min [E, from 1] |
| Model 3 LR, V2 (150 kW, paired stalls) | ~75 | 150 | 0–100% in ~70 min vs 63.5 min on V3. [M, 4] | — |
| Hyundai Ioniq 5 (800 V) | 72.6 | 224 near 47% | 20–80% averaged 170 kW. ~130 kW at 80%. [M, 5, 6] | 18 min [C] |
| Ioniq 5, preconditioned, 4 °C | 77.4 | 224 | 19→80% in 16 min, average ~182 kW. [M, 7] | — |
| Chevy Bolt EV (2023) | ~65 | 54 | Near flat from 1% to 51%. Under 25 kW at 80%. Average ~43 kW. [M, 10] | ~63 min [E] |
| Chevy Equinox EV | — | 150 [C] | Never above 96 kW on a 350 A Electrify America unit (its pack runs under 300 V at low charge). [M, 11] | 44 min [M, 11] |
| Ford F-150 Lightning ER | 131 | 155 [C] | ~115 kW held to 80%. | 15–80% in 38–43 min [M]; 41 [C] [12] |
| Rivian R1T | 135 | ~184 | ~51 kW at 80%. | 20–80% ~42 min [M, 14] |
| Nissan Leaf 40 (CHAdeMO, no active cooling) | 40 | ~46 real | Repeated DC sessions on a hot pack fell to 12–16 kW. [A, 16] | ~40 min to 80%, 40–80 min if cold or hot [C, 15] |

**Shape patterns:**
- Tesla and the Bolt: a short peak, then a roughly exponential decline. The decay constant is about 2.7–2.9 per unit of charge.
- 800 V E-GMP cars (Ioniq 5, EV6): a broad plateau at about 0.8 × peak to ~75–80%, then a step down. [5, 7, 17]
- A car's peak depends on the network: Fastned lists the Model 3 LR at 190 kW on CCS in Europe vs 250 kW on V3. [18, 1]

**Bundleable curve data: none found.**
- Fastned's curves are images with no data license.
- open-ev-data is MIT licensed but says its curves are derived from Fastned's charts, from 2019. Its provenance needs checking before any use.
- EVKX, EV-Database and A Better Routeplanner have no open license.
- P3's index is report-only and covers Europe.
- So the practical route is a parametric model tuned to makers' claims.

### Proposed curve model ("C")

- Power the car accepts at charge s: `P(s) = Pmax` until a knee `k`, then `Pmax · e^(−a(s−k))`, with `a ≈ 2.8`.
- Stop time: `∫ C ds / min(P(s), P_station)`. Above the knee the integral has a closed form.
- Above 90% charge, double `a` [E]. Label every time above 80% as rough.

**Fit check** (agent's script) [E]:

| Car | Model | Published |
|---|---|---|
| Model 3 LR (k 0.25) | 124 kW at 50%, 54 kW at 80% | 120 and 54 kW |
| Bolt (k 0.51) | 61 min for 10–80% | ~63 min |
| F-150 Lightning (k 0.51–0.56) | 38–41 min | 38–43 min |
| Ioniq 5 | right total time, but tapers too early | — |

- **The current flat model** says 18 min for a Model 3's 10–80%. Measured is ~26, so today's estimate is about 30% too fast for Tesla, and too slow for the Bolt and Lightning.
- **800 V variant "C′":** a plateau of 0.8 × peak to a knee of 0.78, then a steep drop. It gives 14.5 min for the Ioniq 5's 20–80% vs 15 measured. [E]
- **Tuning from a maker's claim:** given usable kWh, peak and a "10→80% in N min" claim, fix `a` and solve `k` by bisection.
  - Examples: Mach-E ER k ≈ 0.31, Lightning ≈ 0.5, Model 3 ≈ 0.25.
  - If the solved k falls outside 0.15–0.85, the claim doesn't fit the peak: scale Pmax instead.

**Defaults when the curve is unknown** [E]:

| Car | Settings |
|---|---|
| Peak ≤ 60 kW | k 0.5, a 2.7 |
| 400 V, 100–200 kW | k 0.35, a 2.8 |
| 800 V (≥ 230 kW) | C′ |
| Nothing known | 150 kW, 400 V, k 0.35, a 2.8 |

No measured LFP-specific taper was found, so LFP gets no adjustment.

### Station-side limits

- **Power is min(nameplate kW, max current × pack voltage).**
  - A 150 kW Electrify America unit is limited to 350 A, so a 400 V car gets about 130 kW [M, 11; E].
  - The max current of 350 kW units (450 vs 500 A) is unresolved [A, 37].
- **Shared power:**
  - Tesla V2 A/B stalls share ~150 kW [38]. Plan with half of the shortfall as an expected loss [E].
  - V3 stalls are 250 kW and unpaired [38, 4].
  - Electrify America "balanced" pairs share 350 kW with at least 150 kW per car [39].
- **800 V cars on 400 V-only units:** about 97–120 kW [2nd/A, 40]. Plan for 110 kW.
- **AFDC `power_kw` is nominal:** an upper bound, never an expected power. French roaming data averaged 35–46 kW per session [M, 41].

### AC charging and losses

| Level | Efficiency |
|---|---|
| Level 2 | ~89–91% [M, 42, 43] |
| Level 1 | ~80–89% [M, 42, 43] |
| DC | mostly above 90% [43] |

- AC power is about min(onboard charger, EVSE). No measured source was found for AC top-end taper, so the app's ">90% slows" stays an [E].
- Proposed factors: 0.9 for Level 2, 0.82 for Level 1, and about 7% DC loss for cost.

### Overheads and reliability

- The handshake takes about 10 s [A, 45]. No large-sample measurement of plug-in, authentication or payment time was found. Keep the 5-minute setup.
- Reliability:
  - 14% of US EV owners had at least one visit without a successful charge (J.D. Power 2025) [46].
  - Only 71% of charging attempts succeed (ChargerHelp / Paren 2025) [47].
- Show reliability as a risk note, not as minutes.

---

## Part 2: EV temperature along the whole trip

The app already has hourly forecasts every ~20 mi along each route, keyed to the estimated time the car passes (NWS hourly forecast, Open-Meteo fallback; `routewx.js`). So the outside temperature at every stop and endpoint, at its ETA, is available with no new requests.

### Evidence

**Cold charging:**
- INL's Leaf taxi fleet, ~500 DC sessions: at 32 °F a pack was 36 charge points lower after 30 min than at 77 °F, and about 3× slower in the coldest cases. [M, 23]
- Ioniq 5 without preconditioning at −5–0 °C: 10–80% in 30 min vs 18 claimed. [M, 24]
- Ioniq 5 after a −3 °C night: about 63 kW average vs 220+ kW warm. [M, 25]
- Model 3 at about −26 °F: 10–15 min of the session spent warming, and power never reached 100 kW. [M, 26]

**Preconditioning:**
- Same Tesla, with vs without, ~30 °F: 33 vs 42 min. [2nd, 27]
- Ioniq 5 at 4 °C: 16 vs 28 min. Preconditioning sometimes didn't engage. [M, 7]
- Tesla suggests preconditioning before leaving when the charger is under about 30–45 min away. [28]

**Warming while driving:**
- Model 3 pack warmed from −20 to 3 °C in a 30-min highway drive and was still too cold for full-speed charging. [M, one case, 26]
- The NAF winter test drove cars 2 h before charging "to ensure batteries were warm." [30]
- No measured rate was found for warming without active battery heating.

**Hot packs:**
- The Leaf (no active cooling) throttles badly on its second DC session of a hot day. [A, 16]
- No controlled measurement exists for actively cooled cars in heat.
- Air-cooled chargers throttle near a 55 °C rectifier temperature. [M, 31]

**Cooling while parked:**
- The only figure found is one Leaf owner's ~9 h thermal time constant. [A, 32]
- At that rate, after 1 h ~89% of the pack-to-ambient gap remains, after 4 h ~64%, and after 12 h ~26%.
- So **a short dwell (head back right away) keeps the pack warm, and that endpoint's temperature barely matters**, as the owner expected. After an overnight park, the pack is at the outside temperature.

**Energy use:**
- AAA: −41% range at 20 °F with heat on, −17% at 95 °F with AC. [M, 33]
- Geotab, 4,200 vehicles: best at 21.5 °C (115% of rated range), ≥ 100% between 50 and 88 °F, 54% at −15 °C. [M, 34]
- Heat pumps give 8–10% more range near 30 °F. [35]
- A cold first drive used ~1.9× the energy of the warmed return. [M, one case, 26]

### Proposed battery-temperature model (all parameters [E])

**Tracking rules:**
- Track an estimated pack temperature `Tp` along the plan, with the outside temperature `Ta` taken from the forecast at each point and ETA.
- **At departure after a long park (≥ 6 h):** `Tp = Ta` at the origin. If the user charged at home just before leaving: 15 °C.
- **Parked for d hours** (a destination stop, or waiting before the return): `Tp ← Ta + (Tp − Ta) · e^(−d/9)`. Heading back right away means d ≈ 0, so nothing changes.
- **Driving for m minutes:** `Tp ← min(25, Tp + r·m)`. `r` is 0.4 °C/min when the car actively heats the pack, otherwise 0.1 °C/min. The 0.1 has no source; it is chosen to make self-warming slow, consistent with NAF's 2 h warm-up.
- **Preconditioning:** a per-car checkbox. It's on by default for makes known to support navigation-triggered preconditioning (Tesla; Hyundai/Kia after their update; Ford), with a note that it may not engage.

**DC charge-time multiplier by `Tp` at plug-in:**

| Band | Tp | Time × | Anchors |
|---|---|---|---|
| Warm | ≥ 20 °C | 1.0 | — |
| Cool | 10–20 °C | 1.15 | — |
| Cold | 0–10 °C | 1.4 | ×1.27 [27], ×1.66 [24] |
| Very cold | −10–0 °C | 2.0 | [25] |
| Frozen | < −10 °C | 3.0, plus 12 warm-up minutes added to the stop | [23, 26] |

- Hot weather, no active cooling (Leaf): ×2.5 on the second and later DC stop of the day above 25 °C.
- Actively cooled cars in heat: ×1.0, labeled unknown.

**Energy-use multiplier by outside temperature** (feeds each leg's energy, and so the arrival charge and how much to buy):

| Outside | Heat pump | Resistive (default when unknown) |
|---|---|---|
| 15–27 °C | 1.0 | 1.0 |
| 5 °C | 1.1 | 1.2 |
| 0 °C | 1.15 | 1.3 |
| −7 °C | 1.4 | 1.65 |
| −15 °C | 1.7 | 2.0 |
| 35 °C | 1.15 | 1.15 |

- Add +30% on the first 30 min of driving after a long park below 0 °C.

---

## Part 3: Hydrogen fueling

### How a fill is controlled (SAE J2601, public summaries)

- **Pressure classes:** H70 (70 MPa) and H35 (35 MPa).
- **Pre-cooling types:** T40, T30 and T20 cool the gas to −40, −30 and −20 °C. [S, DOE 2013; Reddi et al.]
- **Targets:** about 3 min for a 70 MPa car at a T40 station, reaching 95–100% full (above 100% is not allowed). [S, Reddi; Wenger]
- **The rule is a pressure ramp rate (APRR), not a flow rate.** A fill's time ≈ pressure to add ÷ APRR, and APRR falls sharply as the outside temperature rises.

**H70, T40, 4–7 kg tank, no communication (J2601 Table D-25 via NREL)** [S]:

| Outside °C | ≤ 0 | 10 | 20 | 25 | 30 | 35 | 40 | 45 | 50 |
|---|---|---|---|---|---|---|---|---|---|
| MPa/min | 28.5 | 28.0 | 21.8 | 18.5 | 15.3 | 12.4 | 11.5 | 8.1 | 5.1 |

- **Near-full refusals:** the table says "no fueling" for a nearly full tank (60–70 MPa) in moderate or hot weather. A top-off may be refused.
- **Other effects on time:**
  - Leak checks pause the flow, about 10 s per 20 MPa in models.
  - Slow pre-cooling drops a fill to slower ramp rates or aborts it.
  - The newer MC method is faster in heat.
  - No public T30 or T20 tables were found, so the model assumes T40 (the fastest).

### Measured fills (NREL retail data, California 2014–Q2 2022) [M]

**All 1.85 million fills:**
- Average 0.9 kg/min, 3.22 min and 2.78 kg per fill (people top up).
- Only 0.2% of fills were faster than 2 kg/min.

**By pressure class:**

| Fill type | Average rate |
|---|---|
| H70 | 0.90 kg/min |
| H35 | 0.82 kg/min |

**End pressures:**
- H70 fills averaged 748 bar; 83% ended above 700 bar.
- H35 fills averaged 338 bar; only 47% ended above 350 bar.

**Other findings:**
- No upward trend in fill rate since 2018.
- 30% of fills started within 5 min of the previous one.
- A small electrolyzer station averaged ~0.4 kg/min and 5–8 min fills. Back-to-back fills drained storage and pushed chiller limits. [M, Genovese 2021]
- Time at the station, 2018: median 7.4 min, mean 8.5, max 30.2. Even with no wait, at least 3.5 min. Waits over 20 min were seen. [M, NREL AMR 2019]

**Makers' claims:** Nexo about 5 min for 6.69 kg; Mirai 5.6 kg. [C]

### Partial fills at H35 pumps

- Hydrogen density at 15 °C is 24.0 kg/m³ at 35 MPa vs 40.2 at 70 MPa [NIST]. So a perfect H35 fill holds about 60% of a 70 MPa tank's rated mass [E].
- With real H35 end pressures, plan for about 55% [E]. That is about 3.1 kg in a Mirai.
- If the tank is already above about 55–60%, an H35 pump adds almost nothing.
- Press reports match: about half or a quarter of a tank. [A]

### Reliability

- California network availability:
  - About 60% in the year before September 2025 (CEC/CARB AB 126 report).
  - 58% in Q2 2024 and 74% in Q2 2025 (H2FCP).
  - Causes: maintenance, failures and supply.
- **Useful AFDC fields:**

| Field | Use |
|---|---|
| `hy_pressures` | read today |
| `hy_status_link` | read today |
| `status_code` | `T` = temporarily unavailable |
| `expected_date` | estimated reopening, for T stations |
| `date_last_confirmed` | how fresh the details are |
| `hy_standards` | J2601 / J2601-2 |

- AFDC has no live kg inventory, pre-cooling class or dispenser count.

### Proposed hydrogen model (all parameters [E] unless noted)

1. **Fill ceiling:**
   - 0.95 of the tank at H70 (conservative within J2601's 95–100%).
   - 0.55 at an H35-only station for a 70 MPa car.
   - If the plan needs more than that, mark a partial fill and replan with the smaller amount.
2. **Fill minutes:**
   - Pressure added ΔP ≈ (end fraction − start fraction) × 65 MPa. This is linear; the real curve slightly overestimates low-tank fills, which is the safe direction.
   - Minutes = ΔP ÷ APRR(outside temperature at the ETA), interpolated from the table above, + 0.5 for leak checks.
   - At 50 °C or above, use 5.1 MPa/min and warn that the station may refuse.
   - Floor: 1.5 min.
   - Bounds: never faster than kg ÷ 2.0, never slower than kg ÷ 0.4 (both from measured data).
   - H35: scale ΔP to the 35 MPa range and × 0.9/0.82 (the measured rate ratio).
   - No temperature available: kg ÷ 0.9 (the measured average).

   **Mirai, 10% → 95%:**

   | Outside | Fill time |
   |---|---|
   | 10 °C | 2.5 min |
   | 25 °C | 3.5 min |
   | 35 °C | 5 min |
   | 45 °C | 7.3 min |

3. **Stop time:** setup (3 min, unchanged) + fill + detour.
4. **Reliability:**
   - Skip `status_code` T stations and show their `expected_date`.
   - Offer a reachable backup station after each hydrogen stop.
   - Always offer the live status link, and flag a stale `date_last_confirmed`.
   - Queues and outages can't be known: show a "busy station" range (about 2× the fill time plus 10–20 min) as text, not planned minutes.

---

## Gaps

- **EV:**
  - The warming rate while driving (0.1 °C/min) has no source.
  - The 9 h parked time constant comes from one Leaf owner.
  - There is no hot-weather measurement for actively cooled cars and no measured AC top-end taper.
  - No bundleable US curve dataset was found.
- **Hydrogen:**
  - The newest public NREL retail data ends in Q2 2022.
  - No public T30 or T20 ramp tables.
  - No measured split of payment and connection time.
  - No per-transaction kg limit source.
  - No official H35 fill level from Toyota, Hyundai or Honda.

## Sources

### EV
1. InsideEVs, Model 3 V3 test: https://insideevs.com/news/427836/tesla-model-3-v3-supercharging-test/
4. InsideEVs, V2 vs V3: https://insideevs.com/news/516438/tesla-supercharger-comparison-review/
5. InsideEVs, Ioniq 5 at IONITY: https://insideevs.com/news/512917/hyundai-ioniq5-charging-analysis-ionity/
6. InsideEVs, Ioniq 5 session data: https://insideevs.com/news/503522/hyundai-ioniq5-fast-charging-analysis/
7. electrive, Ioniq 5 preconditioning: https://www.electrive.com/2023/03/24/hyundai-ioniq-5-battery-preconditioning-is-it-worth-the-upgrade/
10. Bolt 2023 test, via https://insideevs.com/news/589169/how-long-charge-chevrolet-bolt-ev/
11. InsideEVs, Equinox EV: https://insideevs.com/news/751289/chevrolet-equinox-ev-350kw-charging-test/ and https://insideevs.com/news/733806/chevrolet-equinox-ev-fast-charging/
12. InsideEVs, F-150 Lightning: https://insideevs.com/news/615115/ford-f150-lightning-charging-analysis/
14. InsideEVs, R1T: https://insideevs.com/news/575986/rivian-r1t-charging-analysis/
15. Nissan Leaf owner's manual: https://www.nissan.com.mt/ownership/owners-manuals/manuals.html/iom/leaf/0ze1/e0/2023/quick-charge-1.shtml
16. CleanTechnica, Leaf "Rapidgate": https://cleantechnica.com/2019/07/02/initial-testing-suggests-new-62-kwh-nissan-leaf-suffers-from-rapidgate-on-longer-trips
17. arXiv 2606.29994 (Fastned sessions): https://arxiv.org/pdf/2606.29994
18. Fastned Tesla brand page: https://fastnedcharging.com/en/brands-overview/tesla?model=Model%203
19. open-ev-data: https://github.com/OpenChargingCloud/open-ev-data
23. INL cold-charging study: https://insideevs.com/news/338635/study-says-fast-charging-takes-longer-when-its-cold-out/
24. InsideEVs, Ioniq 5 in the cold: https://insideevs.com/news/578869/hyundai-ioniq-5-charging-analysis/
25. InsideEVs, Ioniq 5 after a cold night: https://insideevs.com/news/565913/hyundai-ioniq5-limited-charging-cold/
26. InsideEVs, Model 3 deep freeze: https://insideevs.com/news/786332/tesla-model-3-deep-freeze-night-charge-efficiency/
27. EVANNEX, preconditioning: https://evannex.com/blogs/news/the-importance-of-battery-preconditioning-for-evs-in-winter
28. Tesla Model 3 manual, Cold Weather: https://www.tesla.cn/ownersmanual/model3/en_is/GUID-F907200E-A619-4A95-A0CF-94E0D03BEBEF.html
30. NAF winter test, via https://insideevs.com/news/623759/nissan-ariya-91kwh-cold-weather-range/
31. Qatar charger study: https://elmi.hbku.edu.qa/en/publications/impact-of-extreme-climatic-conditions-on-fast-ev-charger-performa/
32. Leaf pack time constant (forum): https://mynissanleaf.com/threads/estimating-thermal-time-constant-for-cooling-battery-pack.13106/
33. AAA 2019: https://newsroom.aaa.com/2019/02/cold-weather-reduces-electric-vehicle-range/
34. Geotab: https://www.geotab.com/blog/ev-range/
35. Recurrent, heat pumps: https://recurrentauto.com/research/heat-pumps
37. Electrify America current limits (forum): https://www.macheforum.com/site/threads/do-you-really-know-your-car.20176/post-478466
38. Wikipedia, Tesla Supercharger: https://en.wikipedia.org/wiki/Tesla_Supercharger
39. InsideEVs, EA balanced chargers: https://insideevs.com/news/609179/electrify-america-balanced-charging-hyper-fast/
40. E-GMP on 400 V (forum): https://www.insideevsforum.com/community/threads/how-e-gmp-handles-400v-dc-chargers.19497/latest
41. Gireve: https://www.gireve.com/beyond-ev-charging-15/
42. INL Volt onboard charger: https://www.osti.gov/biblio/1047194
43. Recurrent, charging losses: https://www.recurrentauto.com/research/why-doesnt-your-battery-get-all-the-energy-you-pay-for
45. Mach-E forum, handshake: https://www.macheforum.com/site/threads/dc-fast-charging.5260/post-151207
46. J.D. Power 2025 EVX: https://www.jdpower.com/business/press-releases/2025-us-electric-vehicle-experience-evx-public-charging-study
47. ChargerHelp / Paren: https://chargedevs.com/newswire/a-new-report-suggests-us-ev-charging-networks-are-slowly-improving-and-getting-more-prevalent

### Hydrogen
- NREL, Retail Station Composite Data Products, Summer 2022: https://docs.nlr.gov/docs/fy23osti/86247.pdf
- NREL, Hydrogen Station Data Collection and Analysis, AMR 2019: https://www.hydrogen.energy.gov/pdfs/review19/ta014_sprik_2019_o.pdf
- NREL, Mathison 2020, advanced fueling protocols: https://docs.nlr.gov/docs/fy20osti/77368.pdf
- Reddi, Elgowainy et al. (Argonne), J2601 fueling methods and time: https://www.osti.gov/servlets/purl/1389635
- DOE webinar, FCEV fueling protocol (2013): https://www1.eere.energy.gov/hydrogenandfuelcells/pdfs/webinarslides_h2_refueling_protocols_022213.pdf
- Wenger Engineering, SAE J2601: https://www.sae-j2601.com/wp-content/uploads/2021/01/SAE-J2601-The-Worldwide-Standard-for-Hydrogen-Fueling-Stations.pdf
- Genovese, Blekhman et al. 2021, back-to-back fueling: https://www.osti.gov/pages/servlets/purl/1977265
- CEC/CARB, AB 126 2025 assessment: https://www.energy.ca.gov/publications/2026/joint-agency-staff-report-assembly-bill-126-2025-annual-assessment-hydrogen
- H2FCP, 2025 infrastructure report: https://h2fcp.org/blog/californias-2025-hydrogen-infrastructure-report-key-findings-hydrogen-community
- AFDC API fields: https://developer.nlr.gov/docs/transportation/alt-fuel-stations-v1/all/
- NIST Chemistry WebBook, hydrogen at 15 °C: https://webbook.nist.gov/chemistry/fluid/
- Hyundai Nexo: https://www.hyundai.com/eu/en/models/new-nexo/hydrogen.html
