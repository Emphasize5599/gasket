# EV website price coverage

Checked 2026-10-20, signed out. These are observed reader capabilities, not a claim that a network can never publish prices. No accounts, private app endpoints, or bot-check bypasses.

## Public price readers (enabled by default)

1. Tesla Supercharger: existing findus reader; vehicle/member-specific peak tariff. This is not a quote for the future.
2. IONNA: existing public finder page lists per-site prices.
3. Blink: existing map service returns host-set tariffs; all-zero responses remain untrusted.
4. ChargePoint: public station-page reader; some sites fail or publish incomplete prices. A transient subresource 403/429 or automatic/hidden check is not immediately treated as a user CAPTCHA. The reader waits for recovery, prompts only for a persistent visible challenge, and reports ordinary detail-loading failures separately. If a device URL opens only the map/list, it opens an exact card ID or a unique exact station-name match, never a guessed neighbor. Scheduled energy prices are separated from idle charges; fees/taxes remain flagged. Phase, HTTP hints, timing and exact-card opening are logged. No rate means no price, not free.
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

## Research 2026-10-23: what else is reachable without an account

Two research passes, signed out, using public pages and documentation only. No logins, no bot-check workarounds, no app decompiling. Tags: **[V]** fetched here, **[D]** documented by the company or a third party, **[U]** unverified. A fetch blocked from the research host (403/429/proxy) says nothing about what a phone WebView sees.

### New per-station price sources found

**Electric Era [V]**
- The drivers page (https://electricera.tech/drivers) loads one public JSON file with no credentials: `https://ocpi-http.app.electricera.tech/ocpi/2.2/locations_web`.
- Per site it gives coordinates, ports ("2 ports, 150 kW (CCS)"), live available/in-use counts, 7-day uptime and `priceCentsKwh`.
- Prices of 0–2 cents are placeholders on coming-soon sites; live sites run 35–75 cents.
- The company publishes OCPI docs (https://electricera.tech/ocpi-documentation). robots.txt allows crawling, and no scraping clause was found. **Lowest terms risk.**

**Francis Energy [V]** (Driivz white-label platform)
- The public finder (https://driver.francisenergy.com/findCharger) uses an anonymous session plus the page's CSRF token.
- `POST /stationFacade/findStationsInBounds` returns the stations in a box.
- `GET /stationFacade/findStationById?stationId=N` gives each plug's connector, max kW, live status and `socketPrices` (guest plan $/kWh, transaction fee, per-minute fee).
- Test and coming-soon stations appear, so filter on `comingSoon` and public access.
- **Its terms forbid scripts for scraping or data mining, and the portal's robots.txt disallows everything: owner decision.**

### Partial sources

**Electrify America [V]**
- The public locator calls `api-prod.electrifyamerica.com/v2/locations`: 1,333 sites (1,075 public) with status and CCS/CHAdeMO/NACS/L2 flags.
- `/v2/locations/{id}` adds EVSE, voltage and amperage. Per-station `pricing` was null at all 14 sampled sites.
- The site's code has an old per-state fallback table: kWh states $0.48 Pass / $0.36 Pass+, and per-minute tiers elsewhere. A third-party tracker's October 2026 average is ~$0.61/kWh, so that table is stale.
- Usable for live status and connectors. Its price could only be a labeled estimate.
- **Terms §20 forbids robots/scrapers "or any other automatic device": owner decision.**

**DOE AFDC `ev_pricing` (already read)**
- Free text only, no structured or live price.
- California measurement [V]: 8.7% of 20,387 public stations have any text and 2.2% a $/kWh figure. EA 0/300, EVgo 0/407, ChargePoint 2/703.
- CARB 13 CCR 2360.3(k) requires networks to report pricing to AFDC, but coverage shows it isn't reaching the public data.

### Rules that require open price data, but behind tokens

**Federal NEVI rule, 23 CFR 680.116(c)**
- Funded stations must give third-party developers real-time port price and pricing structure, free, via API.
- The Joint Office protocol (https://driveelectric.gov/files/api-standardized-protocol.pdf) uses OCPI 2.2.1 Tariffs. Tokens come by email request; a no-registration demo key is only encouraged.
- No national endpoint registry exists. State DOT lists, e.g. PennDOT's (2026-07-27), show email requests for EA, EVgo, Electric Era and Francis, and an account for Pilot.
- AFDC does not ingest these feeds.

**California and Vermont**
- California's CEC data standards (publicly funded chargers installed from 2024) and AB 1349 require developer APIs with real-time pricing; no endpoint list is published.
- Vermont passed a 2026 transparency law; details are unknown.

Using any of these needs a **user-supplied developer token**, like the DOE key. That is an owner decision.

### Google Maps (open question, needs a phone probe)

- Networks send price and live status to Google through aggregators (OCPI via Eco-Movement and others) [D]. Google has announced live availability for EA (Oct 2025) and Tesla (Nov 2025) [D].
- No current Google statement says price is shown.
- A plain HTTP fetch of a charger's search/place reply had no price, kW or connectors [V]. A rendered page requests more data, so the existing hidden Maps reader on the phone must check before anything is built.
- The paid Places API's `evChargeOptions` has no price field [D].

### Still closed or unknown

| Network | Status |
|---|---|
| EVgo (incl. Pilot Flying J / GM Energy) | Vercel bot checkpoint on every URL (a stop, not something to get around); prices are in the app |
| bp pulse US | 403 here |
| Mercedes-Benz HPC (incl. Buc-ee's) | Proxy refused the domain. Reportedly listed in the ChargePoint app; check whether AFDC gives ChargePoint IDs so the existing reader covers it |
| Shell Recharge | Prices in the Shell app; web map host blocked here |
| Rivian | App or vehicle only; its API needs a session |
| Red E | Public JSON (1,141 sites, connectors, kW, live status) but no price |
| Walmart, Circle K | Some prices arrive via AFDC per a third-party tracker; walmart.com blocked |
| EV Connect | Host-set prices in the app; terms forbid scrapers |
| Revel | Static "starting at" page only, NY |
| Love's, EVCS, SWTCH, Noodoe, Loop, Xeal, Applegreen, 7Charge, Kwik Trip, Casey's, Gravity | App-only, no price, or blocked |

**Aggregators**
- PlugShare's API is commercial-licence only ("no personal or non-commercial licenses").
- Chargeway (paid plan) and Octopus Charge US (free account; ChargePoint, EVgo, Blink, bp, Shell, FLO, Circle K) show prices in apps only.
- DCFC Tracker publishes per-station prices for EA, EVgo, bp, Shell, Rivian, Mercedes, Red E, Francis and Walmart, sourced from "public data published by" those networks (source not named). Its site forbids scraping; a paid API key is the only allowed route.
- No public US OCPI endpoint without credentials was found.
