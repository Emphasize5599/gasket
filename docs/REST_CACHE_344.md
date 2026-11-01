# Filter-scoped campsite reuse (0.0.344)

The owner requested longer reuse of durable campsite details, 48-hour refreshes for changing information such as rates, and refreshes only for places matching the active filters.

## Storage and refresh policy

All records remain in persistent `restplaces` app storage across trips and restarts. Expiration means refresh eligibility on the next relevant search/use; there is no unattended timer downloading every saved place.

| Data | Reuse policy |
| --- | --- |
| Recreation.gov campsite facts | Separate durable snapshot eligible for 30 days; retain structured fields, amenities, attributes, equipment limits, loop/name and provider properties, excluding unused photo/image payloads |
| Recreation.gov campsite notices/status/deactivation/fee templates | Separate overlay required within 48 hours before an otherwise eligible campsite is used |
| Recreation.gov structured rates | 48 hours; still evaluate seasonal rates against every intended booking night |
| Recreation.gov campground notices/gates and availability calendars | One hour, unchanged |
| RV Parky and Campendium cells | Retain saved locations/amenities for 30 days; matching areas become eligible for price-bearing refresh after 48 hours |
| Downloaded RIDB inventory, road/traffic caches and timezones | Existing policies unchanged |

Recreation.gov's public campsite endpoint bundles stable facts and changing site notices/status/fee templates. A matching campground therefore still needs that endpoint after 48 hours; separate durable storage does not imply a month without checking its status. The response refresh also updates durable facts. Existing legacy campsite records can be reused for their original one-hour lifetime; new responses populate the separate snapshots. Existing rate records use their original storage timestamp with the new 48-hour deadline.

## Filtering before requests

- The road-access, initial verification and add-stop flows pass the active Recreation.gov filter into the loader. Within the 30-day durable lifetime, saved equipment, dimensions, capacity, attribute and amenity mismatches prevent all refresh requests for that campground. Loosening filters re-evaluates those records and enables relevant requests.
- On first discovery, facility/site facts must be downloaded to determine eligibility. The loader checks them before requesting rates or calendars. Failed/challenge responses never renew a cache entry.
- RV Parky/Campendium refresh decisions check saved categories, required amenities, access/overnight constraints, vehicle fit and actual route distance. An area with only nonmatching saved places is not refreshed. Prices are deliberately not a permanent negative filter: an expired or unknown rate must be refreshed for otherwise matching candidates, since the new rate may meet the budget.
- Those providers expose area searches, not an independent rate-only request for every saved place. A needed area request can contain other places, which are saved for future reuse; it cannot be narrowed to a single matching campsite. New/30-day-expired areas still need discovery. Previously saved empty areas wait until the durable lifetime expires.
- If an area refresh fails, hits a verification restriction, or is deferred by the existing per-search budget, retain older locations and amenities with rate fields removed and price explicitly unverified. Do not promote expired overnight permission or opening-hour evidence to current facts. Existing known closures/access prohibitions remain conservative exclusions. No failed request resets freshness.

## Validation and phone checks

`rest-cache-policy` exercises fresh loader instances/trips, 47-hour reuse, 48-hour expiration, hourly calendars/facility checks, preservation of extra durable properties, nonmatching-filter zero-request behavior, first-discovery fact-only requests, failed-refresh preservation and expired-price removal for both area providers. Existing campground eligibility, seasonal prices, booking-night, UI, road access and source-cell regressions remain required.

Phone: retain saved data; reopen the same trip with a restrictive equipment/amenity filter, then loosen it. Confirm only relevant campgrounds resume checking, unavailable rates remain unverified, and a repeat search reuses details. The 48-hour refresh occurs when a matching place is searched/used after that age, not continuously in the background. On-phone/live-provider verification is outstanding.

All 201 mandatory local release regressions passed in 297.7 seconds with three jobs. The eight focused campground/cache/browser regressions also passed. Publication verification pending.
