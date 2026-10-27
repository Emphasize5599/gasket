# Rest stops and traffic windows — research, October 27, 2026

This is a measured data-source investigation and a timing prototype, not an enabled app feature. Backlog items 53, 55 and 56 own the remaining integration. No production traffic speeds, departure choices or rest-stop rules were changed in this pass.

## Inventory sources and what they establish

1. **USDOT/BTS NTAD Truck Stop Parking** is a practical downloadable national seed. [Layer and metadata](https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_Truck_Stop_Parking/FeatureServer/0). Its metadata describes a 2019 FHWA compilation and reports data edits in June 2024; editing is not proof every location was reverified then. It explicitly permits unrestricted public use as a US-government work. The tested layer returned **1,915 features across 48 states**, all with point geometry. Fields include rest-stop name, highway, milepost, state and truck parking count. There are Arkansas I-30 examples with E/W suffixes. Direction spellings vary; simply searching for NB/SB/EB/WB misses many. Truck space count is neither passenger parking capacity nor current occupancy. Missing Alaska/Hawaii, current closure, amenities, stay limits and passenger access cannot be inferred.
2. **State DOT rest-area GIS and official facility pages** should override older federal facts and supply current facilities/closures/rules where available. [FDOT's official directory](https://fdot.gov/maintenance/rest-area-app/restareainfo.shtm) links GIS and facility lists and describes restrooms, nighttime security and a three-hour visitor stay. That example illustrates why an eight-hour stop must not be inferred from a rest-area map pin. Verify the applicable facility's current parking/stay rules; restroom opening hours and parking opening hours are different fields.
3. **OpenStreetMap** can enrich and supplement locations with `highway=rest_area`, `highway=services`, toilets, drinking water, picnic facilities, vehicle access and opening hours. [Rest-area tags](https://wiki.openstreetmap.org/wiki/Tag:highway%3Drest_area), [service-area tags](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dservices), [data license](https://www.openstreetmap.org/copyright). Missing tags mean unknown, not no. Preserve provenance and OSM attribution/license handling, and do not mix observations from Google into OSM's database.
4. **Walmart** is a permission-dependent candidate, not a confirmed overnight site. Its [corporate FAQ](https://corporate.walmart.com/askwalmart) says RV accommodation depends on individual management, available space and local laws, and asks travelers to contact that store. This does not establish permission for sleeping in an ordinary passenger car, trailer combination or truck. Store location data may identify a candidate; user confirmation must cover that vehicle, date and intended stay. Preserve the store phone/link and an alternative. Do not infer permission from a nearby Walmart fuel station.

None of these sources alone establishes that a location is clean, comfortable, secure, currently open or has spaces available. Initially present verified amenities and restrictions rather than an invented universal quality score. Keep parking entrances/carriageway access separate from a facility centroid; require routed access to avoid recommending the opposite side of a divided highway.

## Measured inventory experiment

One bounded REST request with six attribute fields and WGS84 geometry returned the complete current layer, `exceededTransferLimit=false`:

| Measurement | Result |
| --- | --- |
| Response read wall time | 730 ms on this desktop connection |
| Features / states | 1,915 / 48 |
| Raw JSON bytes | 405,808 |
| Offline gzip equivalent | 68,514 bytes; not a measurement of HTTP wire compression |
| Compact row representation | 178,617 bytes; 60,654 bytes gzipped |
| Local read + JSON parse | 4.72 ms |
| Validate, normalize, encode, gzip and hash | 18.54 ms |

These are single desktop measurements, not phone benchmarks. A small persisted national seed looks practical without route-by-route discovery calls. Production ingestion still needs pagination (already handled in the reproducible script), version/checksum, validation, atomic replacement, deduplication and independently dated state/OSM overlays. Keep restrictions separate and never reset them to permissive defaults when an inventory refresh has missing fields.

Reproduce with Python's standard library:

```text
python research/rest-traffic/benchmark_ntad.py --download
python -m unittest discover -s research/rest-traffic -p "test_*.py"
python research/rest-traffic/rest_timing.py
```

The last command uses explicitly synthetic travel durations; it does not query Google or prove a real itinerary works. The raw public inventory sample was kept outside the repository and is not bundled into the APK.

## Google fine-time experiment

Tested the real signed-out desktop Maps **Typical traffic** layer over New York, not the API. The time displayed five-minute boundaries. Verified transitions included Monday 9:00→9:05 and 9:10→9:15. The same ArrowRight command also moved 9:05→9:15; ArrowLeft returned 9:15→9:05. Thus **five minutes is the smallest displayed increment verified, but a key press is not reliably one increment**. A one-pixel pointer action produced 9:05→9:10 once. Subsequent tiny drags/clicks did not advance the clock; they are failed inputs, not successful samples. Native input also changed the viewport from 1280×720 to 887×871. Fixed-pixel stepping is therefore unsuitable without a stable viewport and feedback.

Three keyboard command-and-ARIA-read operations took 43–63 ms. This is control/label latency only: it is NOT settled map-render latency, data extraction throughput or source forecast accuracy. During nearby clock changes, the browser asset inventories exposed no additional non-telemetry resources, while later inventories included telemetry. This suggests reuse is worth exploring; it is not a complete network capture or proof that an entire weekly profile is downloaded once. The maps are canvas-rendered, and numeric per-road speeds were not extracted in this experiment.

The reader must request an exact weekday/local time, read `aria-valuetext`, correct overshoot, and reject a sample if the displayed time differs. Never assign a requested clock to old pixels simply because a command returned. Bound correction attempts; detect a no-op, unsupported time, viewport shift, loading or bot check explicitly. Check actual repaint/data identity separately. The observed UI's overnight coverage still needs validation; do not clamp to its endpoints. Five-minute labels also do not establish independent source observations every five minutes.

Efficient next experiment: capture one viewport/cell's actual traffic data/render state at requested adjacent five-minute times, identify whether time profiles can be reused locally, then establish category/direction/geometry stability. A tile/vector decoder is preferable to coordinate sampling. Raster fallback needs fixed projection, geographic calibration, per-direction matching and an ambiguity mask. Benchmark verified fresh samples and missing/failed samples separately. Continue the source/energy-calibration gates in [TRAFFIC.md](TRAFFIC.md); labels alone do not supply mph.

## Rest timing logic and prototype

The pure `research/rest-traffic/rest_timing.py` prototype operates only on supplied forecasts and **absolute UTC minutes**. Resolve local weekday, timezone, midnight and DST before invoking it; display local clock and date/zone to the user. It verifies these separate outputs:

1. **Soonest low-traffic departure:** among legally/physically feasible departures, find the least remaining driving time, then the earliest time achieving it. A visible user-approved tolerance can widen the low-traffic band; the prototype defaults to zero tolerance. Say “lowest forecast driving time among checked times,” not a guaranteed optimum or safest departure.
2. **Latest feasible departure:** scan every available five-minute sample within the stay limit and retain the last whose predicted arrival lies inside both supplied arrival bounds. No arrival window is required; without one, this is a stay-limited choice rather than an on-time deadline. Missing samples are not assumed feasible. Do not binary-search feasibility: a later departure can become feasible again after congestion decreases, and estimates can be noisy. Show separated feasible intervals rather than bridging gaps.
3. **Earliest arrival overall:** minimize departure plus remaining driving time. This can differ from the lowest-traffic departure. The UI should show the tradeoff explicitly: extra rest/wait, change in driving time, and predicted arrival. Waiting does not become “time saved” merely because driving takes fewer minutes.

Earliest departure is no earlier than arrival plus the user's requested minimum rest. The latest permitted departure also respects the user's maximum stay, facility parking closure and applicable stay cap. If the user permits simultaneous rest/charging, readiness is `max(rest end, charge end)`, not the sum. Otherwise reserve rest after charging; retain separate charging/queue/meal details and do not assume every activity counts as the desired rest. Permission/suitability is an explicit source-verified or user-confirmed input; unknown private-lot permission blocks automatic selection. The prototype neither recommends a medically sufficient rest length nor guarantees available space.

Seven fast deterministic tests cover nonmonotonic feasibility, distinct outputs, both arrival bounds, minimum/maximum stay, closure, overlapping/sequential charging, unknown forecasts, absent permission, no arrival deadline, midnight, no feasible result and invalid input.

### Integration to leave open

1. Find reachable sites on the correct carriageway within a user-allowed detour, with enough usable range to get there and continue. Include access-road time, reopening/closure limits and any extra tolls. Preserve source IDs, dates, restrictions and user permission separately; persistent inventory is shared across trips/cars. Rank by actual known amenities, allowed duration, detour and vehicle/trailer fit, not truck-space count alone.
2. Add concise opt-in controls: desired rest duration/range, maximum waiting, amenities/vehicle needs and private-lot candidates. For each candidate show “arrive,” “rest until,” lowest-traffic range, latest checked on-time departure, updated ETA and cost. Distinguish request-permission and unknown access; allow manual choice and refusal. Never label a predicted time as guaranteed to arrive on time. Optional uncertainty/slack must be explicit.
3. Use hourly weather screening as the coarse approval stage; refine traffic times to verified five-minute slots on promising routes/sites. Revalidate the shifted itinerary against actual hourly hazards, all destination windows, forecast horizon, tariffs, reserves and toll budgets. Previously approved hazards do not automatically cover a changed time/route. Do not create 12 hazard-approval screens per hour or a Cartesian product of every site and five-minute departure.
4. Propagate absolute readiness/arrival constraints across each leg and immediate/delayed return. Use reusable cell/road/time observations and dominance pruning of genuinely equivalent future states, then run the real stop planner on promising candidates. Keep Cost/Time as the shared objective: include waiting, detour and charging in total time; include energy, tariffs, tolls and possible fees in cost. Low-traffic guidance must not secretly replace the user's selected objective.
5. Build progress, ETA, cancel, site-check pause/resume, persistent checkpoints and cache reuse. Changes invalidate only affected downstream timing; no repeat station discovery for an unchanged area. Validate on actual phones and with real source data before release. Leave multi-site optimization, production UI, provider extraction and integration in the numbered backlog.
