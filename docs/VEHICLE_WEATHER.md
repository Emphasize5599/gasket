# Vehicle-aware hazards and unavailable A/C

Items 40 and 41, version 0.0.174. All decisions use existing vehicle/forecast data and deterministic code; no new provider, key, AI call or background network work is added.

## Data sources and limits

Research checked 2026-10-16:

- [EPA vehicle service](https://www.fueleconomy.gov/feg/ws/index.shtml): `VClass` is a size class (passenger/luggage volume or GVWR), not a clearance measurement.
- [NHTSA vPIC variable catalog](https://vpic.nhtsa.dot.gov/api/vehicles/getvehiclevariablelist?format=json): Body Class describes general body configuration; this catalog has no general ground-clearance field. Body classes do not establish exact ride height.
- [NWS wind guidance](https://www.weather.gov/safety/wind-during): high-profile vehicles and trailers are particularly vulnerable to wind.
- [NWS flood guidance](https://www.weather.gov/ohx/flooding): never enter floodwater, regardless of vehicle profile.
- [NWS heat guidance](https://www.weather.gov/safety/heat-during): heat exposure warrants precautions; unavailable A/C must not become an assurance that ventilation will suffice.
- [Ford climate-control manual](https://www.fordservicecontent.com/Ford_Content/vdirsnet/OwnerManual/Home/Content?ProcUid=G1641343&Uid=G1634973&buildtype=web&countryCode=USA&div=f&languageCode=en&moidRef=G539503&userMarket=USATHAT&vFilteringEnabled=False&variantid=4691): some defrost modes operate the compressor even if A/C is switched off. Do not equate a working blower with working A/C dehumidification.

`RouteWx.vehicleProfile` uses stored NHTSA body class, then EPA size class, then the selected vehicle type. SUV/truck/van/bus/motorhome classes provide a labeled high-profile **estimate**. It never infers low ground clearance from a model name or two-seat class. Garage → About this car → Edit has an override: Auto, Standard, Low-riding, Tall / large. Overrides are user classifications, not measurements; no clearance number is fabricated. No larger model is needed.

## Comparison heuristic

`vehicleFit` is an explainable comparison, not a calibrated accident probability. It considers:

1. Major hazards (tornado, flood, tropical storm, severe unclassified warnings) before lesser hazards, for every vehicle.
2. The highest supplied hazard severity.
3. Weighted exposure over route miles, adding known vehicle vulnerabilities: wind/storm exposure while towing or in a high-profile vehicle; low tread in wet/winter weather; low-riding profile in heavy precipitation; unavailable A/C in heat or visibility-affecting weather; summer tires in snow/ice.

For each hazard kind, overlapping stretches use the highest contribution at each point, not the sum of duplicate forecast/alert entries. Same-kind disjoint exposure is retained. Review thresholds for low tread follow item 39 (see WET_TIRE_ROUTES.md). Towing requires an actually hooked-up trailer and enabled tow mode; stored spares are excluded.

Weights in `FIT_WEIGHT` and modifiers are product heuristics, not sourced empirical risk coefficients. Critical warnings remain visible even on the first-ranked option. Ties stay tied. Unknown tire/profile information is not proof of suitability. Rank only when every option has completed its forecast/air checks, no lookup errors or forecast gaps, and no pending AI classification; otherwise show comparison incomplete. Cards keep original route IDs even when ordered by fit, and ranking never changes the selected route. Equipment/tire changes recompute from cached forecasts.

## Broken or absent A/C

Per-car `climate.acBroken` is the top switch in Climate control. `climate.caps.noAc` describes a vehicle with no A/C fitted. Both feed the same availability checks. The ordinary export includes these nested car fields, and full backup stores the entire settings preference; browser regression tests exercise export and full restore through that boundary.

`ClimateMath.effective` derives a manual, A/C-off view without overwriting saved presets. Preset summaries, Advice and route presets use that view; saved free-text notes are omitted from recommendations while unavailable because they may assume working A/C. The editor hides A/C and automatic mode choices, retains blower/heat/windshield airflow and electric rear defrost, and explains that visibility failures require stopping safely. Repairing A/C restores the original saved preferences. Discarded edits retain ordinary editor semantics.

No A/C cooling or dehumidification is recommended while unavailable. Air-quality advice does not tell the driver to keep A/C on; heat advice suggests postponing/cooler travel times and cooled rest stops, not that windows or ventilation make extreme heat acceptable.
