# Recreation.gov structured rest-source data — 2026-10-29

## Research scope

Public signed-out requests; no account, extracted key or bundled client credential. Sample manifest: `research/rest-traffic/recreation-sample-2026-10-29.json`. 107 distinct campground IDs attempted, 83 returned valid campground records; 24 did not (mostly records without that website endpoint). Across these: 976 season rows from distinct rate responses and 592 campsite records from 17 campground site responses (16 successful). Six named agencies: FS, USACE, NPS, BLM, BOR, FWS. One record has no agency code. This is broad sampling, not a proof that every possible future format is known.

The public website uses these JSON resources:

- `https://www.recreation.gov/api/camps/campgrounds/{id}`: timezone, amenities, active notices, descriptive facts, stay/booking rules.
- `.../campgrounds/{id}/rates`: date-bounded seasons, price/name/site-type maps and rate templates.
- `.../campgrounds/{id}/campsites`: site-specific equipment, dimensions, attributes, amenity facts, notices, status, fee-template bindings and recurring-closure records.
- `.../availability/campground/{id}/month?start_date=YYYY-MM-01T00:00:00.000Z`: dated status for each site. This resolves many operational closures that a season description alone does not.

Primary references: [RIDB](https://ridb.recreation.gov/), [daily bulk download](https://ridb.recreation.gov/download), [Federal Camping Data Standard 2.1](https://ridb.recreation.gov/shared/pdf/Federal_Camping_Data_Standard_2.1_12232024.pdf), [Upper Pines website](https://www.recreation.gov/camping/campgrounds/232447). The website client was inspected to establish the rates request; no provider client source is included in Gasket.

## Observed formats and filtering

109 facility amenity labels; 41 campsite attribute names/codes. Initial filter vocabulary is in `assets/web/recreation-facets.js`; newly observed public amenities/attribute values are learned into persistent rest-source storage. Technical map-coordinate fields are not user filters. Controls remain under Settings → Rest stops → Recreation.gov; independent of all other sources.

Filters: ordinary amenity requirements; exact additional reported amenities/attributes; equipment type; vehicle length capacity; driveway length and site width; people/vehicles; published nightly ceiling or known-free; optional existing-reservation inclusion. All site requirements must hold on the SAME eligible campsite, rather than combining a shower-only site and an electrical-only site. Unknown dimensions do not satisfy a requested fit. Site-specific trailer and RV limits are separate. Source labels and dates remain visible; permission and booking are still the user's responsibility.

Season types observed: Peak, Off Peak, Walk In, Transition. Both historical and future years can coexist. Dates are interpreted as local operating dates, never assumed annual. Templates can differ by site; fee_templates bind them. Observed components: per_night, per_person, weekend, holiday, deposit, partial_payment, group_fees, increment_fees, effective_date and future_fees. Only a matching, date-applicable per_night is shown as a base USD/night range. Extra/unclear components are labeled; price caps/free filters reject ambiguous quotes. Deposits are not relabeled as hourly parking prices; there is no invented prorating for a short rest. No reservation transaction is performed.

Opening evidence: the matching site's dated Available status; explicit Walk In season + Not Reservable; Reserved only after the user opts in because they already hold a reservation. Not Reservable alone is not proof of opening; Not Available, Closed, missing or unfamiliar states do not qualify. Calendar checks cover every local day touched by the stay. Monthly boundary reads share caches; check-in/out and booking-release dates are not gate hours.

Normal-hours formats sampled include daily park hours, locked gate intervals, seasonal gate schedules, quiet/generator hours, after-hours check-in, and year-round opening conditional on season. Only unambiguous daily access times are parsed. Unparsed gate restrictions are withheld. Quiet hours do not close a campground. Active facility/campsite closure statements are checked, including ISO and named-month dated ranges; ambiguous facility-wide construction/closure notices withhold the candidate. A closed restroom, visitor office, loop or swimming area does NOT automatically close the entire campground. Novel free-text rules remain a limitation: source calendar/website verification is still essential. Do not claim a universal natural-language closure parser.

## Runtime and UI

Use existing RIDB location download as seed, enrich only route candidates. At most four public data requests at once; deduplicate in-flight requests. Facility/site/closure and calendar cache one hour, rates one day. Compact persisted responses drop booking quantities, author-account metadata and irrelevant site geometry. Data is app storage, backed up; website failures are not cached as success. Failed/unverified candidates are excluded and retriable with Search again. They are not called closed merely because a request failed.

The list's order is Maps pin / matched Maps link, Recreation.gov external link, then green add. Do not build a substitute provider place page or fetch its photos. The add dialog still collects minimum rest and permission; final timing rechecks the retained dated facts. No automatic Maps place search is needed for these records; exact coordinates give a pin, with a previously known place link preferred.

## Device acceptance still needed

Recheck an actual planned arrival outside gate hours, seasonal/maintenance closure, month-crossing rest, occupied campground, RV/trailer dimensional filter, and a source failure/retry. Public JSON endpoints are website implementation details and may change. Schema changes fail as unverified rather than silently passing filters. A full booking quote or guaranteed available campsite is not promised.
