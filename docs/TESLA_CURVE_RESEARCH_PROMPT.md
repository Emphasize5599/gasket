# Tesla charging research prompt for Google AI Mode

Run the first prompt once per U.S. year, model and trim. Include a pack code or build plant only if already known. Treat each candidate as a separate pack. Never include a full VIN.

Browser entry point: `https://www.google.com/search?udm=50&q=` followed by the URL-encoded prompt.

## Discover packs and find usable evidence

```text
Research DC fast charging for this exact U.S. Tesla: [YEAR MODEL TRIM AND OPTIONAL PACK CANDIDATE]. Find each plausible factory pack separately by pack code, supplier, build dates and plant. Do not transfer curves from another pack, year, market, trim, charger session, or firmware. Separate gross and usable kWh; use unknown unless supported. Prefer OEM data, raw telemetry, a published numeric table, or a clearly identifiable measured curve from the original tester. For each curve verify the tested vehicle and pack, charger, and that the source actually contains SOC vs kW. Reject database curves with unclear provenance, peak/average/time-only summaries, guessed points and extrapolation. Use one session, not a blend. Numeric-table interpolation between observed points is allowed; label it in evidence. Do not read a chart unless you can inspect the correct plotted series and axes; label chart readings approximate. A complete curve needs coverage at 0,10,20,30,40,50,60,70,80,90,100% with 11 positive kW values. Never invent endpoints or replace observed zero. If coverage or pack match is inadequate, use exactly Charge curve cannot be confidently determined. Output one plain-text line per identified pack in a code block, no header or Markdown table: PACK: ID | chemistry/supplier | usable kWh number or unknown | gross kWh number or unknown | build/plant | owner verification | pack source URL or unknown | 11 comma-separated kW numbers or required uncertainty phrase | direct curve URL or unknown. Keep the order and put no citations or prose inside numbers or URLs. After the block give per-pack evidence: exact test vehicle, charger, direct links, observed SOC range, extraction method, missing evidence and any conflicting variants. If only partial points are supported, list SOC%:kW there without promoting them to a complete curve.
```

## Audit one pack and one source

Use this in a fresh query when the first answer leaves the curve unresolved or proposes a source that needs checking. The result is an evidence record. Review it before constructing a PACK line.

```text
Audit one exact vehicle and one DC charging session: [YEAR MODEL TRIM PACK AND SESSION]. Start from [CANDIDATE SOURCE URL] and its original test video or dataset. Confirm the test vehicle, pack identification and charger hardware separately, marking any unverified item unknown. Give only numeric SOC%:kW observations supported by this one session. Separate exact points from threshold statements; never convert elapsed time or a peak into a point. Identify the covered SOC interval. Exclude other charger sessions and generic model tables without verified provenance. Return SOURCE: direct test URL; VEHICLE: year/trim/pack; CHARGER: cabinet/dispenser; POINTS: semicolon-separated SOC%:kW; LIMIT: what the source cannot establish. If either 0% or 100% lacks a positive observed power, conclude exactly Charge curve cannot be confidently determined. Retain useful partial evidence.
```

## Reader and acceptance

- Extract the actual response block only. Pass only lines beginning with `PACK:` in that block to `ChargeCurve.researchPacks`. Google also repeats the prompt in headings and renders a code-block footer. Those strings and the evidence narrative are outside the import.
- A parsed candidate is a proposed identity. Verify the installed pack and treat a reported usable capacity as a separate decision. A number can pass syntax checks and still have poor evidence.
- A curve becomes eligible after review confirms exact pack applicability, a trace tied to one charger session, adequate coverage, and a matching source. The current planner requires 11 positive kW values and an HTTPS source URL for this format. Keep real zeroes and partial SOC observations in the evidence record if they cannot be represented by that format.
- Check at least a low, middle and high SOC point against the cited trace. Where the data comes from a chart, record which series was digitized and the expected precision. A dense table with no established provenance remains research evidence.
- Expose missing evidence in the UI and retain partial points for review or manual entry. The prompt alone cannot enforce this acceptance policy.

## Live browser check

Three independent signed-out Google AI Mode requests on 2026-11-06 produced a syntactically readable candidate each and declined to produce a complete curve. The first pass was useful as a candidate finder. None of its pack codes or capacities should be adopted without source review.

| Vehicle | Observed result | Source check |
| --- | --- | --- |
| 2021 Model 3 Long Range AWD, Fremont 82 kWh candidate | Returned E3LD and withheld the curve. | Google gave 77.8 kWh usable, while the cited test family includes a reported 76.5 kWh estimate for the specific 82 kWh car. Pack-code and U.S. applicability remain unverified for the returned candidate. [Nyland charging analysis](https://insideevs.com/news/519382/tesla-model3-82kwh-charging-analysis/) |
| 2022 Model Y AWD, Austin structural 4680 | Returned a candidate and 67.5 kWh usable, left gross unknown, and withheld the curve. | 67.5 kWh is an app estimate reported by the owner. Published observations cover selected points only. [Capacity estimate](https://driveteslacanada.ca/model-y/4680-model-y-usable-battery-67-5-kwh/) · [Charging observations](https://driveteslacanada.ca/supercharger/tesla-model-y-supercharger-test-4680-charging-curve/) |
| 2024 Cybertruck Foundation Series AWD | Returned a candidate and withheld the curve despite finding the dense EVKX table. | The table gives a numerical profile, but the tested pack and charger provenance are not established by the table. The independent V3.5 test covers only 10–80%. [EVKX table](https://evkx.net/models/tesla/cybertruck/cybertruck_awd/chargingcurve/) · [V3/V3.5 comparison](https://evchargingstations.com/chargingnews/2024-tesla-cybertruck-awd-dc-fast-charging-analysis-10-80/) |

The targeted Cybertruck audit found about 90 kW at 70% and 95 kW at 80% on the V3.5 session. Google also put a 300+ kW threshold in the points list despite the instruction to separate thresholds. Keep that threshold as context. The test does not cover the curve endpoints, and Google left the exact installed pack code unknown.

All three live PACK lines parsed as candidates with no eligible curve. A synthetic 11-point control passed the same parser. This validates the response format. It does not establish that live AI responses reliably supply eligible curves.

## Search for the trace before asking for an import row

Use the first prompt above after identifying a plausible pack. For discovery, start with the shorter prompt below. Replace the bracketed fields with details you already have. Put uncertain aliases in the search terms and ask the source to verify them.

```text
Find the original DC fast charging trace for [US MODEL YEAR, TRIM, PACK]. Search the pack code and aliases, cell supplier, tested usable capacity, original tester, charger cabinet/dispenser, and these data terms: SOC vs DC power, kW vs state of charge, charging telemetry, CAN log, CSV, data supplement, digitized, charge curve chart, source image. Follow primary reports through to their downloadable data, attachment manifest or actual chart. Return up to three source records. For each give the direct file/chart URL, source type (measured table, digitized measured chart, plot only, summary only, or unknown), pack-match evidence, test market, charger, observed SOC span, and any gaps. If you only found a landing page, say FILE NOT VERIFIED. If there is a generic curve with no exact test linkage, say SAME SESSION NOT VERIFIED. Do not combine tests or generate charging points in this step.
```

For an attachment lead, ask for the exact listed filename, direct download URL and the tested pack metadata field that proves the match. Check those directly against the provider's file list and metadata. If the search model cannot see an API response or an attachment, retrieve the public artifact directly. For a chart lead, open the original chart image and record the ends of the plotted series, even if the horizontal axis spans a wider interval. Compare candidate sources using the same SOC interval, units, test car, and charger. Similar peak power is insufficient to establish shared provenance.

### Follow-up experiments

Five further live searches tested source discovery for the Model 3 and Ioniq 5/Mach-E, attribution of an EVKX table, and two versions of the Figshare attachment audit. The Model 3 discovery prompt located the chart but incorrectly treated a generic EVKX table as the same session. A follow-up requiring provenance evidence correctly marked the session link unverified, but still confused the chart axis with the plotted span. The exact Figshare API query yielded no answer. The HTML page query explicitly marked individual attachments and metadata unverified. Direct retrieval of the [Figshare manifest](https://api.figshare.com/v2/articles/30570653) showed the relevant files.

- Model 3 Panasonic 82 kWh candidate: the [original V3 chart](https://cdn.motor1.com/images/custom/img-tesla-model-3-lr-awd-2021-v3-sc-dcfc-power-20210710.png) contains a red trace from about 9.3% to 88.8%, read from the chart pixels. Approximate 10–80% anchors by tens are 238, 227, 182, 138, 94, 78, 61 and 44 kW. The x-axis was calibrated with the 0–100% grid and the y-axis with the 0–300 kW grid. At each anchor, use the median red-line pixel height. This is one session, and the missing ends remain unmeasured. The published test identifies capacity as estimated. [Test context](https://insideevs.com/news/519382/tesla-model3-82kwh-charging-analysis/)
- Ioniq 5: Figshare file 59409995 is titled 77.4 kWh, but the [metadata file](https://ndownloader.figshare.com/files/59409272) lists 70 kWh usable and 72.6 kWh total for that row. The provenance is Fastned and the years are European. Resolve the metadata conflict and U.S. pack applicability before offering the trace.
- Mach-E: Figshare file 59410136 lists 91 kWh usable and 98.8 kWh total in the metadata. The provenance is a Fastned plot digitization, with European years. Confirm U.S. pack equivalence before offering the trace.

### Fit curves on known data

A small holdout check used five digitized Tesla traces in [Figshare record 30570653](https://figshare.com/articles/dataset/Digitized_Electric_Vehicle_Fast-Charging_Profiles_by_Model_Power_vs_SOC_SOE_CSV_Format_Version_1/30570653). Fit on median points within one SOC point of 15, 25, …, 85%, then test on median points at 20, 30, …, 80%. The offset exponential was fit by trying offsets below the minimum training kW, regressing log(power minus offset), and choosing the lowest training squared error in kW. Linear interpolation had 1.0–2.5 kW mean absolute error across the five traces. The single exponential had 5.3–15.9 kW. This is a within-trace comparison and does not validate other vehicles or extrapolation.

For curated curves, preserve measured points around ramps and knees and interpolate inside the observed span. Compare a segmented fit only where it improves held-out power and integrated charging time in the intended SOC window. Keep any estimated tails separate and label them as estimates. Useful first catalog targets are common U.S. Model 3 and Y variants, Ioniq 5, EV6, Mach-E and Bolt, with separate entries where pack or charging behavior differs. The source search helps find measurements. The published artifact determines what goes into the profile.
