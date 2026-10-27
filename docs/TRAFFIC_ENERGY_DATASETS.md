# Traffic/energy research round 2 — working record

October 27, 2026; branch `feature/traffic-rest-integration`. This file is updated during research so another agent can resume from evidence rather than conversation history. No production coefficients are approved by this document merely because a source is listed.

## Questions and stop conditions

1. Can we retrieve actual vehicle fuel/energy traces, with conditions and usable rights, rather than just papers describing them?
2. Can we obtain ordinary-setpoint EV cabin electrical load observations distinct from pack loads, startup conditioning and traction?
3. Is there independently validated Google color-to-speed methodology that transfers to US roads and Typical traffic? Distinguish numerical API durations, live colors and historical Typical traffic.

Stop broad searching once specific usable sources or concrete blockers are established. Preserve what is measured, what is model-generated, and what needs further access/fitting. No Android build is needed for research documentation.

## Initial leads and cautions

1. Argonne D3: current landing/download interface must be checked. A historical DOE-hosted database presentation says publication/profit use required Argonne consent. This is historical evidence, not a determination of current terms. Public download does not establish unrestricted reuse. [Historical presentation](https://www.energy.gov/sites/prod/files/2014/03/f13/vssp_19_keller.pdf).
2. New Google lead: *Travel Time Estimation by means of Google API Data* (2020), DOI 10.1016/j.ifacol.2020.12.2365. Search results describe color-based travel time estimates validated by test drives; inspect methodology before using its accuracy claim or thresholds.
3. EV leads must be vehicle data: building heat-pump databases are not an EV cabin calibration dataset. Neural-network papers predicting HVAC power from the HVAC's own measured control/power signals may not support a pre-trip estimator using only Garage settings/weather.

## Research status

In progress. For already completed first-round evidence and the climate-preset implementation gap, read [TRAFFIC_ENERGY_EVIDENCE.md](TRAFFIC_ENERGY_EVIDENCE.md). Full integration direction is in [TRAFFIC_REST_HANDOFF.md](TRAFFIC_REST_HANDOFF.md).

## Download checkpoint — Argonne

Current [D3 landing page](https://www.anl.gov/taps/downloadable-dynamometer-database) was successfully inspected in the browser. It requires attribution to D3/AMTL/Argonne/DOE or a standard bibliographic reference. Historical bundled PDFs retain a publication/profit-consent notice; preserve both statements rather than declaring all files unrestricted.

1. [2010 Prius page](https://www.anl.gov/taps/d3-2010-toyota-prius), [public folder](https://app.box.com/s/56wv6abwb9tcww8ko881up2dyqtj02z9). Downloaded `All Data- 2010 Toyota Prius.zip` (Box file 28874124774) to `C:/Users/username/Downloads/All Data- 2010 Toyota Prius.zip`. SHA256 `96099f1f9756b6d3938fcf99bb02798ccff5475715b76df0b031528d63823a2f`. Contains five text traces (60909045, 46, 48, 49, 51) and a V2 summary. Fuel flow, time, speed, engine temperature, SOC and HV voltage/current headers verified. Source spans include negative setup time and noisy near-zero values: do not integrate every row blindly. Summary is at about 22 C with climate off; these are not hot/cold HVAC traces or the owner's 2016 car. Fuel/SOC reconciliation remains to be performed.
2. [2023 Ioniq 5 page](https://www.anl.gov/taps/d3-2023-hyundai-ioniq5), [public folder](https://anl.app.box.com/s/b8xuadhau857u3a2wdpy5x2qsuqqmsn3), Extended Datasets folder 276753813409. Observed 13 TDMS files plus summary, total about 151 MB. Downloaded summary `2023_Hyunday_Ioniq_5_TestSummary_20240724.pdf` to Downloads (Box file 1602046957596). Lists steady-state, HWY, US06, UDDS, WLTP, NEDC and CAV 20/30/40/50 mph tests at approximately 18–26 C. Downloaded representative test `62405005 Analysis.tdms`, CAV 20 mph, Box file 1602035509638, 4,122,700 bytes, SHA256 `f2295134bab1131ec4bb6b7eee19ed0571c7232a19a5943629c1f6bbc4437cc4`. npTDMS 1.13.0 header inspection found 129 channels/3,921 samples; 0.1 s nominal step, setup timestamps begin at -20 s. Includes HV measurements and ambient HVAC temperature but no named cabin target/actual temperature, compressor/heater electrical power or HVAC setting channels. This sample is not isolated cabin-load evidence. Multiple time channels and dubious inherited units on some CAN channels require explicit signal alignment/scale checks. Do not infer 20 mph is the cycle-average speed.

Do not commit binary archives or full reports without resolving per-file terms; retain URLs, hashes and reproducible derived audits instead.

### Prius numerical audit checkpoint

Trapezoid integration using adjacent rows both in positive phases (excluding pre/post setup), signed raw fuel flow, US gallons. Published summary MPG are laboratory/unadjusted, not EPA labels. Results rounded here:

| Test | Cycle | Integrated miles | Integrated raw MPG | Summary MPG | Signed HV Wh (V times I) |
| --- | --- | ---: | ---: | ---: | ---: |
| 60909045 | UDDS cold | 7.44744 | 63.245 | 63.1 | -84.103 |
| 60909046 | UDDS hot | 7.44952 | 69.898 | 69.6 | -110.099 |
| 60909048 | Highway hot | 10.25022 | 67.274 | 67.3 | -24.183 |
| 60909049 | US06 hot | 8.01596 | 42.987 | 43.5 | -65.989 |

MPG differences are about 0.04–1.18%; not exact reconciliation. Summary HV Wh are -90.0/-113.2/-23.8/-87.7 respectively, showing more material differences, especially US06. Raw SOC endpoints do not consistently resolve HV sign/energy interpretation. Do not SOC-correct fuel from these channels until analyzer sign, phase boundaries, filtering and report energy method are reconciled. Small negative bench fuel noise exists; clipping changes cold UDDS volume by about 0.005 cc, so clipping is not a fix for the energy discrepancy. Steady-speed file 60909051 has phase zero throughout and requires separately defined steady windows; the positive-phase audit intentionally excludes it. Do not turn a zero audit total into zero consumption.

### Google calibration paper checkpoint

[Wagner et al. 2020 full manuscript](https://ifatwww.et.uni-magdeburg.de/ifac2020/media/pdfs/2531.pdf), DOI 10.1016/j.ifacol.2020.12.2365. Fits nonnegative color-dependent **travel-time multipliers** against Google live API duration on a 3.4 km Krefeld street, with separate direction/image matching. Reported 3.4% model/API error is not independent driving accuracy: GPS trips were on average 16.5% shorter than API times (SD 10%). Fitted orange factors differ substantially between this street (~1.27) and earlier A57 motorway (~2.18); dark red also differs. These are local fitted delay factors, not universal mph fractions or validation of modern Typical traffic. Useful calibration methodology; do not paste Table 1 into Gasket. Unknown/uncolored road handling must stay explicit even though their fit includes a black category.
