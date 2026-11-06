
# Tesla high-voltage pack and charging-curve evidence

Scope is U.S. light-duty battery EVs, including discontinued models. The table distinguishes evidence for the vehicle and installed pack from evidence for its charging curve. kWh labels in trim names can be nominal or marketing classes. Keep the user's usable capacity separate. A cell format such as 2170 or 4680 does not identify a pack or a charging curve.

| U.S. model or pack candidate | Charging evidence and applicability | Catalog decision |
| --- | --- | --- |
| Model 3 2021 Long Range AWD, Panasonic 2170 family | Tom Moloughney's U.S. V3 test is a direct year/trim reference. Bjørn Nyland's V3 session used a California-built car reported to have the nominal 82 kWh Panasonic pack. The two sessions differ. | Selectable after pack confirmation. Warm rounded curve, including inferred endpoints. |
| Model 3 2020 SR+, nickel-based pack | Digitized 2020 SR+ trace in the CMU data. Do not transfer to the LFP pack. | Selectable after pack confirmation. |
| Model 3 2020 SR+, CATL LFP | TUM identifies its individual car and provides raw 10–80% data plus conditioned and unconditioned sessions. Confirm U.S. installed-pack equivalence before adopting it. | Research reference, distinct from the nickel-based SR+. |
| Model 3 2021/22 RWD or SR+, LFP | CMU LFP trace is a separate session with a pronounced ramp. Its capacity reference describes a 60.5 kWh car. Country, build applicability and variant boundaries need reconciliation. | Manual installed profile until the mapping is verified. |
| Model 3 earlier Long Range / Performance, and newer Long Range or Standard/Premium | U.S. 2019 V3 test and CMU newer Fastned traces exist. Older LR held peak longer than the 2021 example. The newer Fastned test does not establish U.S. pack equivalence. | Separate profiles pending. Do not reuse the demo curve by model name alone. |
| Model Y 2170 Long Range/Performance | U.S. Model Y Performance test in Edmunds/P3 and 2023 Long Range trace in CMU. The latter lacks a verified U.S. supplier/pack match. | Research references. Keep Long Range, Performance and different build families separate. |
| Model Y Austin structural 4680 AWD | Tesla service documentation identifies the structural family. U.S. V3 tests report 32 min from 0–80% in one run and 34 min from 9–80% in another. Those points do not establish a stable curve across software or packs. | Manual profile until a full trace is validated. |
| Model Y RWD/Standard and 2026+ refreshed variants | Tesla documents multiple structural configurations. Do not infer chemistry or assign the Long Range curve from a shared body name. | Exact U.S. build-to-pack mapping open. |
| Model S refreshed 100 kWh class and Plaid | Separate Fastned-derived CMU traces. U.S. Plaid V3 test is an independent cross-check. Do not copy the CMU capacity reference from a legacy 100 pack teardown to the refresh. | Separate selectable curves. Use the driver's usable capacity. |
| Model X refreshed 100 kWh class and Plaid | Separate Fastned-derived CMU traces. Capacity metadata for Plaid needs independent verification. | Separate selectable curves. Use the driver's usable capacity. |
| Model S/X legacy 60/70/75/85/90/100 and software-limited variants | CMU adapter traces reflect connector or dispenser constraints and do not identify the full native curve. The CMU “Model S SR+ 2021” filename conflicts with the vehicle-attributes row's 2019–20 dates. | Withhold those ambiguous traces. Research legacy packs and software-limited versions separately. |
| Cybertruck Foundation AWD and Cyberbeast | U.S. AWD V3 test, Cyberbeast 10–90% timing and a separate high-voltage test. Charger voltage and current limits can produce very different results. | Preserve as separate references until matched vehicle/charger traces are validated. |
| Original Roadster | Tesla's manual documents its AC wall and mobile charging hardware. | No Supercharger curve for the original vehicle. |

## Selectable warm DC curves

Power in kW at the displayed battery state of charge. The driver confirms the installed pack and supplies usable capacity separately.

| Profile | 0% | 10% | 20% | 30% | 40% | 50% | 60% | 70% | 80% | 90% | 100% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Model 3 LR AWD, 2021 Panasonic 2170 family | 100 | 250 | 225 | 180 | 145 | 100 | 80 | 60 | 45 | 30 | 15 |
| Model 3 SR+, 2020 nickel-based | 169 | 169 | 155 | 138 | 115 | 89 | 71 | 57 | 36 | 22 | 10 |
| Model S refresh, 100 kWh class | 138 | 214 | 220 | 224 | 200 | 152 | 118 | 94 | 67 | 48 | 15 |
| Model S Plaid | 133 | 205 | 211 | 215 | 193 | 146 | 114 | 90 | 65 | 46 | 15 |
| Model X refresh, 100 kWh class | 136 | 210 | 216 | 220 | 198 | 149 | 116 | 92 | 67 | 46 | 15 |
| Model X Plaid | 133 | 205 | 211 | 215 | 192 | 146 | 114 | 90 | 65 | 47 | 15 |

## Curve provenance

The six selectable curves use 10-percentage-point anchors. The demo values are rounded estimates from the year/trim V3 sessions. Other values are rounded nearest-point samples from the CSVs named below, with inferred edge values where the traces stop short of 0% or 100%. Those tails should not be treated as measured. The library stores each curve under a stable profile ID. A selected curve is reused across the planner, and a user-entered profile requires a pack name and curve.

- Morin, Chatra, Michalek and Whitacre, [Digitized Electric Vehicle Fast-Charging Profiles by Model, v1](https://doi.org/10.6084/m9.figshare.30570653.v1), CC BY 4.0. Tesla CSVs use prefixes “Model 3 SR+ 2020”, “Model S 100 kWh (2022+)”, “Model S Plaid 100 kWh”, “Model X 100 kWh (2022+)” and “Model X Plaid 100 kWh”. Original curve publishers are InsideEVs and Fastned. Transformation is sampling, rounding and endpoint estimation. Dataset rows reviewed include five Model 3 traces, five Model S traces, four Model X traces and one Model Y trace, including adapter and ambiguous entries.
- [Moloughney's 2021 Model 3 test](https://insideevs.com/news/506520/tesla-model-3-supercharger-test/) and [Nyland's 2021 trace and comparison](https://insideevs.com/news/519382/tesla-model3-82kwh-charging-analysis/).
- [TUM raw Model 3 LFP data](https://doi.org/10.14459/2024mp1735494), with the Gasket baseline in [charge-fill-v3](../research/charge-fill-v3/README.md).
- [Tesla Model Y structural pack service bulletin](https://service.tesla.com/docs/ServiceBulletins/External/SB/SB-23-16-004_Replace_the_Structural_Pack_HV_Battery.pdf), [U.S. 4680 V3 sessions](https://insideevs.com/news/597305/4680-tesla-modely-fast-charging/), [Edmunds/P3 charging measurements](https://www.edmunds.com/car-news/electric-car-charging.html/tesla/model-y/), and [U.S. Model S Plaid test](https://insideevs.com/news/544379/tesla-model-s-plaid-supercharging/).
- [Cybertruck AWD V3 session](https://insideevs.com/news/721583/tesla-cybertruck-v3-supercharger-test/), [Cyberbeast test](https://www.caranddriver.com/reviews/a60115630/2024-tesla-cybertruck-beast-test/), and [Tesla Roadster manual](https://service.tesla.com/docs/Public/Roadster/Owner/Roadster_2008_Owners_Manual.pdf).

Brave may provide possible installed-pack names and references. Its answer does not identify the current pack or populate the numerical curve. Confirm from vehicle information or service records.
