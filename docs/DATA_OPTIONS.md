# Pollen and cash-price options

Research notes, 2026-10-14. Decisions and unfinished implementation remain in `TODO.md` (13 and 14); this is not another backlog. No new data provider, paid requests or subscription has been enabled.

## 13 — U.S. pollen

1. **Open-Meteo:** its air-quality API's pollen variables are available only in Europe during pollen season. Existing U.S. weather/air-quality coverage does not imply U.S. pollen coverage. It cannot supply this feature for U.S. trips today. [Official documentation](https://open-meteo.com/en/docs/air-quality-api).
2. **Google Pollen:** documented U.S. coverage for trees, grass and weeds, up to five **daily** forecast days, not an hourly forecast. The current global pay-as-you-go list gives 5,000 free monthly Pollen Usage events and then $10 per 1,000 at the first paid tier; check the account's actual agreement before enabling it. It needs an enabled/billed API and key. Google specifies attribution, storage restrictions and Google-map requirements for map visualization, so it is not a drop-in OSM route overlay or an offline forecast cache. A separate attributed text view would need policy review too. [Coverage](https://developers.google.com/maps/documentation/pollen/coverage), [forecast](https://developers.google.com/maps/documentation/pollen/forecast), [pricing](https://developers.google.com/maps/billing-and-pricing/pricing), [policies](https://developers.google.com/maps/documentation/pollen/policies).
3. **Ambee:** advertises worldwide land coverage, multiple allergens, forecast products and hourly/daily temporal resolutions. Present observations update hourly; forecasts update daily. Obtain the actual forecast endpoint documentation, U.S. samples and a quote/license specifying hourly availability, caching, redistribution and display rights before selecting it. This is a commercial/keyed option, not an established free keyless source. [Product](https://www.getambee.com/api/pollen), [terms](https://www.getambee.com/terms-and-conditions).

Recommendation: choose an optional licensed provider if real U.S. pollen forecasts are important. Ambee is worth investigating for arrival-hour matching; Google is simpler to evaluate with an existing account but only daily and with display/storage constraints. Without a chosen provider, keep U.S. pollen unavailable rather than estimate it from AQI, weather or the season. A clearly labeled seasonal information screen could be keyless, but is not a live pollen forecast.

For an eventual implementation: coalesce route samples into provider-appropriate geographic cells, match each sample's arrival date/hour, limit requests separately from Places/Routes, and fetch in the background without blocking navigation. Cache only as permitted. Never label daily values hourly or missing/out-of-horizon values low risk. Recirculation suggestions should be optional driving-comfort advice, not personalized medical guidance. Live response quality and route coverage are untested; advertised resolution is not proof of accuracy.

## 14 — Cash prices

The current normalized station shape has one `prices[grade]` value; it has no payment eligibility dimension. `gasweb_worker.js` identifies grades and rejects conflicting prices for a grade, but does not retain cash/card labels. Google Places' published `FuelPrice` fields are fuel type, price and update time, with no payment-method field. Consequently, current reads do **not** establish whether an unlabeled price is valid for cash or card. [Official schema](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#FuelPrice).

Recommended design:

1. Retain distinct offers with grade, unit/currency, payment class (`cash`, `credit`, `debit`, `unknown`), membership/eligibility, source, posted update time, observation time and evidence of an explicit source label. Unknown stays unknown; never assume the cheapest price is cash or invent a card surcharge.
2. Add Cash / Card / Either preferences. Show the selected offer's label on station cards and route stops; explain uncertainty when only an unlabeled price exists. Apply card cashback only to an eligible card offer. Membership/rewards may stack only when supported by program terms; do not assume a cash price stacks with Walmart+.
3. Read cash/card labels only when clearly attached to that station, fuel grade and amount. Do not associate page-level promotional text with every price. Official chain pages may help when they explicitly publish these distinctions, but no live chain coverage has been established by this research.
4. Carry payment eligibility through merging, known-station updates, cache keys, history deduplication, backups and trip replay so one offer cannot overwrite a different offer. Preserve original posted prices separately from computed rewards.
5. Test explicit same-grade cash/card pairs, unlabeled values, membership-only prices, diesel/other grades, stale offers, conflicts, partial refreshes and cash-without-card-cashback. Then validate real source examples on the phone. Do not claim existing cash-price accuracy has been verified.

Recommendation: implement the offer model and conservative UI first, then add source adapters with captured labeled fixtures. Better labeling is useful immediately; complete cash-price coverage cannot be promised from currently available inputs.
