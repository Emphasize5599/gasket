# EV website price coverage

Checked 2026-10-20, signed out. These are observed reader capabilities, not a claim that a network can never publish prices. No accounts, private app endpoints, or bot-check bypasses.

## Public price readers (enabled by default)

1. Tesla Supercharger: existing findus reader; vehicle/member-specific peak tariff. This is not a quote for the future.
2. IONNA: existing public finder page lists per-site prices.
3. Blink: existing map service returns host-set tariffs; all-zero responses remain untrusted.
4. ChargePoint: existing public station-page reader; some sites fail or publish incomplete prices. No rate means no price, not free.
5. FLO: new reader for the public map embedded on [FLO Network](https://www.flo.com/flo-network/). Its published bundle uses `emobility.flo.ca/v3.0/parks/nearest` (POST) and `parks/station/<UUID>` (GET), without credentials. Tested live: Canadian DC tariffs explicitly marked CAD, US hourly tariffs explicitly marked USD, and US public curbside time-of-day hourly tariffs. The latter chooses the highest listed flat hourly rate. Station detail also supplies connector type, AC/DC level and power in watts. Implementation is US/USD only; CAD, ambiguous location matches, unsupported connectors, restricted sites and complex tiered tariffs are not guessed. Nonmember/parking fees are not silently converted into energy charges. Native requests have fixed endpoints, validated coordinates/UUIDs, bounded bodies, no redirects and timeouts. A refusal stops FLO reads and does not populate a negative price cache. Site matching requires network, name and <=100 m; reading is bounded to 24 route sites and at most eight units/site. Unread sites remain unknown unless DOE already publishes a tariff.

## No reliable station-price website reader yet (off by default)

1. Electrify America and EVgo: previously identified app/charger pricing; no new app/account investigation. [EA pricing](https://www.electrifyamerica.com/pricing/) directs drivers to the app for real-time station rates.
2. EV Connect: [official FAQ](https://www.evconnect.com/resources/faq/) puts owner-set pricing in the app. QR web payment exists, but requires a particular physical station/QR; no dependable signed-out route-wide tariff finder verified. Its Level 2/DC and J1772/CCS descriptions are network-wide, not proof of a site's equipment. Keep DOE/OCM unit-specific equipment.
3. Shell Recharge: inspected the [US locator](https://www.shell.us/electric-vehicle-charging/find-an-ev-charging-station.html) and [FAQ](https://www.shell.us/electric-vehicle-charging/shell-app-ev-faqs.html). The locator describes connector/status information; prices are directed to the app and vary by site, type, market and time of use. No reliable signed-out US station tariff reader verified. European roaming tariffs must not substitute for US host prices.
4. Rivian Adventure: inspected [public map page](https://rivian.com/experience/charging), including in a visible browser. It describes DC speeds and access but this browser did not expose a usable station tariff panel. No reliable signed-out station-price extraction verified; do not substitute vehicle marketing, network averages or third-party prices. DOE/OCM remain the unit-specific equipment source.
5. Walmart: [official EV guide](https://www.walmart.com/cp/9145505) specifies CCS1/NACS DC equipment and directs real-time prices to the charger or Walmart app. No public station-specific tariff verified. Do not use Walmart gasoline prices, promotional discounts, or prices at unrelated EA chargers on Walmart property.
6. Non-networked / Other: not one provider or one website. Existing DOE/OCM published price notes remain usable when the group is selected; no generic website reader can reliably infer each host's price.

## Potentially complimentary hosts (separate, off by default)

1. Dealerships.
2. Hotels/lodging AC chargers.
3. Tesla Destination chargers.

These are **not automatically free or publicly accessible**. A published free charging statement is required for a zero price. Fast charging networks at a hotel do not become hotel chargers merely because of location. Users must verify guest/customer access and parking restrictions.

## Price age and planning

There is no defensible universal weekly change interval: [Tesla live-pricing documentation](https://www.tesla.com/support/charging/supercharger/understanding-live-pricing) describes real-time changes, while EA and Shell describe station/time-of-use variability. **24 hours is a conservative configurable cache/freshness policy, not an empirically measured median price lifetime.** Global Settings → Connections exposes 1–720 hours. Network rate caches expire no later than 24 hours (so a longer preference does not reduce normal refresh frequency); a shorter preference expires them sooner.

Cached reads retain the original observation time. Inventory/status confirmation dates are not price dates. The planner first tries a feasible trip using only recently observed published tariffs, respecting reachability, reserves and detour limits; if that cannot cover the trip it can use older/undated published prices and warns. Missing prices are excluded by default; estimated costs require a separate explicit global opt-in. Published time-based prices may still require an estimated energy cost. Future departure gets a price-change warning, not a forecasted price or a fresh timestamp.

Automated fixtures cover grouping/defaults, explicit opt-in persistence, known/free/unknown distinctions, FLO currency/connector/tariff parsing, restriction responses, cache timestamps, freshness preference and reachability fallback. Phone/driver verification is still needed; fixtures cannot validate Android networking or GPU display behavior.
