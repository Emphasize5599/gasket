# Rest-site prices and fixed destination buttons (0.0.345)

## Findings from the owner's examples

A bounded live RV Parky search on 2026-11-01 returned Pennyrile Forest State Park (`25032`) with `dailyRate: "$25-30"`. The existing numeric parser accepts that format. Older saved cells can contain only rate text, without the newer numeric `nightlyRate`; fresh cells now normalize that text in memory without rewriting timestamps or extending evidence freshness. Every recognized range is visible in the list as a reported nightly range. Missing/expired evidence remains unverified.

Huggins Haven's [Campendium record](https://maps.campendium.com/us/st-charles-ky/camping-rv/huggins-haven-rv-campground-saint-charles-ky--0) showed a last nightly rate of $49. A bounded read of its public POI endpoint (`25952371`) confirmed `canonical_place.campground_details.last_nightly_rate: "$49"`; the older `last_nightly_rate_review` field was absent. The worker now reads either explicitly nightly field, including ranges, never the categorical `price` field. A missing report date still prevents treating it as a confirmed date-specific quote, but the reported amount remains separate evidence: an above-budget report cannot become a missing-price fallback. The operator's [rate page](https://hugginshaven.com/rates/) also distinguishes site types, weekdays/weekends, seasonal and stay-length prices; those should not be reduced to an invented single universal price.

Campendium's cell schema is now v4. Existing v3 cells remain available as durable fallback records, but relevant areas need a new-schema refresh before receiving a fresh 48-hour lifetime. Failed/deferred refreshes retain old places/amenities and any known reported range without claiming the expired rate is verified. Existing per-search budgets and human verification remain unchanged.

## Personal rate tables

Each rest-result row has **Edit rates / mark not free**. The user may save a not-free flag without a numeric price, or a table with:

- Site type, with a selected type for the trip. Multiple types require a choice; no automatic cheapest-type selection.
- Inclusive local start/end dates; blank endpoints mean no bound.
- Applicable weekdays; none selected means every weekday.
- Minimum/maximum stay length measured in calendar dates touched, with an optional open maximum.
- Per-night, per-calendar-day or entire-stay charge and a minimum/maximum dollar range.

The owner explicitly confirmed that Monday evening to Tuesday morning is **two calendar days** for calendar-day billing. Departure exactly at midnight does not occupy the next date. Timezone-local dates handle DST; elapsed 24-hour blocks are not substituted. Nightly charges apply to nights and flat stay charges apply once. Every charged date must be covered. Conflicting overlapping rows, ambiguous site types, unknown timezone and missing coverage remain unverified instead of selecting a convenient cheap row. The nightly budget compares total stay cost divided by nights (at least one); list rows show the total estimated range for the stay and its calendar-day count.

Tables are user-owned `restplaces/user|id` records, share the existing geographic origin guard and persistent user index, and survive refreshes, restarts and backup. Provider refreshes never overwrite them. **Use provider prices instead** removes the override. General detail edits preserve the saved pricing table. Unknown-price fields from providers never override an explicit not-free decision.

Pricing is applied to list filtering and road-access eligibility, actual add-stop duration, structured Recreation.gov validation, departure-sample filtering and final timing checks. Extending a stay or crossing midnight cannot silently retain an earlier cheaper quote. User pricing changes preserve closure, equipment, opening-hour, availability and parking-consent checks; they do not establish availability or parking permission. Existing broad price confirmations remain available for places without a populated custom table.

## Destination buttons

The list consistently separates a location-pin button for a confirmed Google Maps place, a person/map icon for Street View at the location, and an external-link icon for the source record. An unavailable destination is omitted. Google coordinate searches and Street View are never substituted for a missing Maps place. Street View opens the provider viewer at the coordinates; imagery coverage is not guaranteed. Source links accept only HTTP(S). Add-stop and the text pricing editor remain separate actions. The name and action row wrap to preserve narrow-screen legibility.

## Validation and phone checks

Pure tests cover calendar-day versus nightly/flat charges, local midnight, both DST transitions, dates/weekdays, site types, stay discounts, ambiguous/missing coverage, not-free behavior, restoration of provider values, over-budget undated reports, and final timing revalidation. Structured Recreation.gov tests prove user rates can override provider prices while still obeying the budget and not-free filters. The Campendium reader test uses the observed current-schema rate path. Browser tests cover 320/448px tables and buttons, persistence across new UI instances, actual-duration rejection, clear/reset, existing sparse verification and source-missing destinations. Screenshots were visually checked locally; no personal travel data is in test fixtures.

Phone: reopen the same trip without clearing saved data. Check Pennyrile's reported range; a $10 budget must exclude Huggins Haven after its new-schema detail read. Test the three fixed-purpose buttons. Save two site types and weekday/date rates, extend a stay across midnight, and confirm the total/budget updates. Mark a place not free and verify it disappears from free-only results. Phone/live-app verification remains outstanding.

All 204 local mandatory release checks passed in 247.2 seconds with three jobs. Ten focused pricing, browser, source, cache and rendering regressions passed again in 5.8 seconds after the final stay-price preview refinement. Changed JavaScript syntax and whitespace checks passed. GitHub repeated all 204 checks in 262.8 seconds and passed the native reservation gate, Android build and existing release-signature checks.

## Verified publication

Source `c37b242d7216581ebd35ae9643e3d4a446063306` was published as [v0.0.345](https://github.com/Emphasize5599/gasket/releases/tag/v0.0.345). [Source release run 41365350205](https://github.com/Emphasize5599/gasket/actions/runs/41365350205) and [signed APK run 41365350262](https://github.com/Emphasize5599/gasket/actions/runs/41365350262) succeeded; build job 125024226089 verified the existing certificate SHA-256 `94e3154b10bc95e47c34d1678205c1955e1788c4ed52819769b3e1fda391fa0e`.

Both release assets were verified uploaded:
- ARM64: 30,464,016 bytes; SHA-256 `d29463492d76c25be0ebe4477b7e66479881c6df403d32cf412039b006e1f0b6`.
- Universal: 56,830,043 bytes; SHA-256 `58eaadb8072d05df5a7bd9cb6765bc64e731b71da1b88dad4d98e031d39399b2`.

The published ARM64 APK was downloaded and its digest independently checked. Packaged index, both new pricing modules, RestUI, RestPlaces, CampPrice, Recreation, app CSS and Campendium worker exactly matched the committed Git blob bytes. Windows working-copy CRLF differences were distinguished from committed LF bytes. Phone/live-app checks remain outstanding.
