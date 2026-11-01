# Rest planning, price verification and solar windows (in progress)

Base: main 7eb6e76 (0.0.340), synced from 3463ac0. Owner authorizes patch/release, preserve unrelated tmp work. Do not delegate unless explicitly authorized.

## Accepted scope
1. Temporarily disable OSM inventory; explain overloaded servers and possible later return. Preserve stored data.
2. Better RV Parky/Campendium price extraction; public land is not proof of free. Seasonal/date-specific fees and per-source acceptable overnight rate sliders.
3. Unknown price: exclude when a price limit is enabled, except show clearly separate manual-verification fallback when priced choices are sparse (owner answer).
4. Four nightly bounds: earliest/latest **arrival and beginning rest**, earliest/latest **departure the next morning**. Owner confirmed. Every bound supports a clock or sunrise/sunset/civil-twilight event. Repeat nightly with individual-night overrides; local time zones and DST.
5. Ask about refreshing prices/traffic BEFORE long work, never halfway through unattended planning.
6. Automatically suggest rests for all original legs. After approved rests, replan and discover genuinely missing station coverage rather than falsely suggesting parameter changes for missing data.
7. Audit and reduce final rest-timing UI stalls. Keep up-front road checks added in 340 (owner requested them), urgent rows/add priority and cancellation.
8. Add onboarding road-trip-style presets to TODO only (item 58 added: Speed/Eco/Frugal/Relaxing/custom).

## Evidence
Supplied log identifies 339, main is 340. Latest campground facts: 228–232 places in 6–7 sec, 7–11 fresh requests; cached facts are effective. Last fuel plan errors include a missed fixed destination departure window and invalid rest departure/parking constraints. Backup nightly 20:00–07:30, min 7h / preferred 9h; RIDB/RV Parky freeOnly; Campendium public-land filter; restrooms required. Full backup remains local, do not commit credentials, private routes or raw backup.

Public provider records extracted to tmp/rest-public-samples-341.json: 104 cached facility records, 100 rate responses, 1,116 season rows, 2,985 price offers (varied years, peaks, walk-in, fees). Need sample live detail pages and update tests based on actual data.

## Findings requiring fixes
- sampleRest loops up to 25 forecasts sequentially. C.forecast builds the complete base route and car model every sample, then slices. Recommendations do up to 8 × 6 serial forecasts; should use bounded scheduling, shared geometry and cancellation.
- Recreation.evaluate currently checks every calendar date crossed by the stay, so an overnight before checkout wrongly requires next night's availability. Must distinguish booking nights, check-in/checkout and physical gate hours; late-night/after-midnight arrival may belong to previous booking date, not a free stay.
- restSetTime writes a rest's departure into time-window destinations[index-1]. Need preserve original destination identity, prevent rest/non-rest index leakage, and validate the right boundaries after inserted stops.
- restCommit repeatedly gathers/replans even after unchanged chosen times; cache dependencies and yield before expensive work.
- RV Parky freeOnly retains explicit zero rates or rate-less non-campgrounds; unknown campground prices are correctly not known free, but need better price detail/source sampling and sparse fallback.
- Campendium map `place_detail.price` is a category, NEVER dollar tariff. 338 `freeLikely` from Public Land is not reliable; replace with actual detail-price evidence or unknown fallback.

## Research sources read
- https://www.recreation.gov/reservation-policies : campsite generally held until checkout following scheduled arrival; late arrivals/no-show policies vary.
- https://home.nps.gov/yose/planyourvisit/campingfaq.htm : Yosemite check-in/out noon; distinct from quiet/gate hours.
- https://parks.nv.gov/about/reservations : 2pm check-in / 11am checkout (example, never apply universally).
- https://github.com/mourner/suncalc : offline sunrise/sunset limb and civil dawn/dusk events; inspect pinned source/license before vendoring.
Owner scripts are data/code references only: dawn-dusk.py imports PyEphem and solves -6° crossings; Convert-TwilightIcs.ps1 calls sunrise-sunset.org, rewrites ICS. Do not hardcode owner coordinates/dates, call APIs every night or port ICS machinery into app. Need handle polar no-event cases and local date anchoring.

## Resumed implementation status
Recovered the original chat, both clarification answers and all four original files on November 1. Compressed backup parses successfully (0.0.339; 12 namespaces, 4,722 restplaces entries). Private backup/log and the owner's location-specific scripts remain outside the release.

OSM disabled; per-source price limits and separate sparse unverified-price fallback added. Campendium reads compact public detail records (dated reports, seasonal flags, amenities and IANA zone); public-land/category prices no longer imply free. Recreation booking nights account for known checkout/check-in rules and prior-month calendars. Four offline solar/clock bounds use pinned BSD-2-Clause SunCalc. Bounded traffic sampling shares geometry and preserves cancellation. Destination checks use shifted point slots after inserted rests. Rest directory avoids repeated array copies and observer setup. Projection memo retains exact geometry results. Automatic traffic recommendations walk every searched leg. Final rest planning attempts shared station discovery once when the fuel plan lacks coverage, while timing violations stay actionable timing errors.

Refresh choices are resolved before planning/forecast work, including when expired prices have not yet been loaded; discoveries later in the same trip reuse that decision. Saved-trip replay still does not ask. Route-flow fixtures explicitly choose saved prices; dedicated preflight and cell-reuse regressions cover consent. The pre-existing RIDB assertion was updated for deliberately disabled OSM. The synthetic VIN QR fixture now uses whole-pixel modules, avoiding video/canvas antialiasing corruption without changing the scanner.

## Price sampling and limits
Re-ran the real rate parser over all 2,985 offers from 100 cached provider rate responses: 130 known zero, 2,476 known paid, 379 unverified/extra-fee cases. These are historical response samples, not current bookable quotes.

Reviewed seven Campendium detail pages: [Nomad View](https://maps.campendium.com/us/wall-sd/places/nomad-view-dispersed-camping), [Coon Hollow](https://maps.campendium.com/us/blythe-ca/camping-rv/coon-hollow-ltva-campground), [Annie Creek](https://maps.campendium.com/us/fort-klamath-or/camping-rv/annie-creek-sno-park-fort-klamath), [Eagle Creek](https://maps.campendium.com/us/cody-wy/camping-rv/eagle-creek-campground-cody), [Elkmont](https://maps.campendium.com/us/gatlinburg-tn/camping-rv/elkmont-campground), [Sunset Falls](https://maps.campendium.com/us/yacolt-wa/nature/sunset-falls-campground), [Buffalo](https://maps.campendium.com/us/island-park-id/camping-rv/buffalo-campground). Seasonal permits, old last-paid reports and public-land fees all occur. Added regressions for month-specific permit/pass requirements and multi-day permits; none become a year-round zero or an amortized nightly quote. Campendium prose schedules are conservatively unverified, not automatically interpreted as bookable date-specific rates. Recreation.gov's structured season dates are evaluated per booking night. Sparse unverified alternatives require direct price confirmation within the selected budget.

Check-in, checkout and gate hours are distinct. An eight-hour overnight ending before known checkout generally needs the preceding booking night, including after-midnight arrivals; it does not automatically need two calendar nights. Late-arrival acceptance/no-show rules still belong to the campground. Known check-in/checkout rules are used; unknown times remain conservative. See the NPS and Nevada primary sources above.

## Performance audit
The resumed end-to-end audit used a synthetic 1,200-mile route, 3,000 stations and 120 rest sites with a 4x CPU slowdown. All the way through final timing confirmation, the browser reported no page errors. Add-stop next paint: 60 ms; Calculate: 300 ms; select departure: 462 ms; Finish: 500 ms. Finish's longest main-thread task was 501 ms (769 ms total long-task blocking during that action). These are simulated desktop measurements with mocked network replies, not phone measurements or evidence that all stalls are eliminated. Wall times include the audit's deliberate settling interval. Remaining synchronous projection/pricing/storage work can still cause visible pauses on weaker phones.

Local validation: all 197 mandatory release regressions passed in 204.2 seconds with three jobs and JDK 21 available. Focused price-confirmation/retry/no-budget browser checks and legal regeneration checks also passed. Changed production scripts passed syntax checks.

## Verified publication
Source `a510191cd9a498148bdcf1633d17197a7d0f181e`, tag `v0.0.341`. [Release workflow 41348120246](https://github.com/Emphasize5599/gasket/actions/runs/41348120246) and [signed APK workflow 41348120238](https://github.com/Emphasize5599/gasket/actions/runs/41348120238), build job 124972226842, both succeeded. Release regressions, propulsion reference, actual native reservation gate, compilation, existing-key signing, APK verification and publication passed. Both direct assets were verified uploaded through the GitHub API:

- ARM64: 30,447,413 bytes; SHA256 `b9f7c5279881e11e75dcfcca13adc35f16f316c6d57a2c0e4c2129ff41642800`.
- Universal: 56,813,440 bytes; SHA256 `b39f09a694a32ca137295f2d7dbd94f6e8119996272edb25187c82bc372da9a6`.

Phone checks: retain existing data and reopen the same long trip; inspect the disabled OSM explanation and source budgets; try the four nightly solar/clock bounds; add a campsite, calculate and finalize its departure; confirm any sparse unverified-rate option directly; check automatic suggestions and missing-station discovery. No phone performance verification was performed in this session. Presets remain backlog item 58, as requested.
