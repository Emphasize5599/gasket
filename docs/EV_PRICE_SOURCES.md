# EV price sources and proposed guest-app add-on

## Implementation 0.0.256 — owner-approved experimental add-on

**0.0.267 correction (supersedes the 0.0.266 finding below):** EVgo does let guests read station details. On 2026-10-25 a fresh anonymous identity got `Not Authorized` from `siteForMobile` without, and the full site with 3 chargers with, an Apollo client-identification header; `apollographql-client-name` or `apollographql-client-version` alone was enough (the value isn't checked). Query text, `operationName`, the app's operation ID, `x-client-id` and the token made no difference. EVgo's app sends both headers, which is why it worked there. The native client now sends `apollographql-client-name: EVgo Android Client` and `apollographql-client-version: 26.14.0-122279` (the captured app's values) on every EVgo request, including the refresh retry. The `guestNotPermitted` 24 h pause and the stored `evgo-guest-denied` skip are removed; a repeat denial after one refresh uses the ordinary 15-minute pause and Chargeway/PlugShare fallback. Not yet confirmed on a phone.

**0.0.266 finding:** EVgo's station-detail query (`siteForMobile`) is refused to guest identities as such, not because of an expired token. On 2026-10-25, from this host, a brand-new anonymous registration got `Not Authorized` (code `INTERNAL_SERVER_ERROR`, service `falcon`, empty path) even when asking only for the site's ID, while the nearby-sites query on the same token returned 22 sites. The owner's phone log shows the same pattern in both of that morning's batches (nearby OK; detail refused after the one refresh). Without site detail there are no charger IDs for the pricing query, so EVgo's own guest prices are unavailable. EVgo stations are priced only by the Chargeway/PlugShare fallback. The native client now reports this case as `guestNotPermitted` (24 h pause, refusal message/code/path logged, body dropped), and the app remembers it for a day across restarts; Update prices tries again. Only the app's own three queries were run; EVgo's wider undocumented API was not explored.

**0.0.259 correction:** A later EVgo guest site query returned GraphQL `Not Authorized` inside HTTP 200, so the earlier successful sample does not establish reliable current access. EVgo/Chargeway authentication errors trigger one refresh of the existing anonymous identity and one retry of the same request. A second denial pauses the source for 15 minutes; refresh failure pauses it for one minute, without creating a replacement identity. Protection/rate-limit responses retain their refusal cooldown and do not trigger refresh. Denials are logged as authentication/access errors, not CAPTCHAs. EVgo may use the existing Chargeway/PlugShare fallback, subject to the same exact station/connector and complete-fee checks. This bounded recovery is tested with fixtures; successful live EVgo access after refresh is not claimed.

The owner approved implementation and explicitly approved bundling shared Chargeway/PlugShare app-client credentials after being told they are extractable from the APK. They are not personal credentials, captured anonymous identities or refresh tokens. EA requires no authentication. EVgo and Chargeway create and refresh their own anonymous identities natively; generated tokens and user overrides use Android Keystore-backed AES-GCM storage, excluded from app backups/logs. Provider licensing remains unresolved; owner approval is not provider permission.

**Phone test:** Settings → Connections → Optional guest-app price sources; then Parameters → Charging networks → Tariff validation. IONNA and Electric Era default on. Blink, bp pulse, ChargePoint, EA, EVgo, FLO, Francis, Mercedes HPC, Tesla Supercharger and Walmart EV are separate optional selections. EV Connect, generic other/non-networked, Shell and Rivian remain locked out of routing in this version, including restored selection maps. Hosted charging remains separate and never implicitly free. The guest add-on also has a native opt-in gate: importing an enabled JavaScript preference alone cannot authorize requests.

Implemented fixed native endpoints for EA, EVgo, ChargePoint, Chargeway and PlugShare; no arbitrary URLs/headers, redirects, protection bypass or captured device identity. Requests are serialized with per-source spacing and refusal cooldowns. Guest tariff caches are shared across vehicles/routes and expire at the tighter of 24 hours or user preference. Source price timestamps remain distinct from retrieval time. Clearing cache removes tariff caches; resetting guest sources/erasing data removes generated identities. Only normalized offers, not raw aggregator reviews/photos/personal data, are cached.

Tariff offers preserve connector, level, power, fees, schedule and source association. EA/EVgo direct prices can use a Chargeway time zone only after an exact DOE ID and coordinate match. Walmart/Mercedes/bp use PlugShare per-port structured prices and Chargeway-matched time zones; Chargeway station tariffs remain a partial fallback because missing fees are not zero. Mercedes ChargePoint-style Energy text has a narrow fallback parser; arbitrary price prose is not accepted. bp never uses Chargeway's generic network text. Multiple operators within 100 m are ambiguous rather than automatically joined. Full provider port coverage is not guaranteed: only validated compatible offers are used.

Planner workers reevaluate retained schedules against estimated arrival after earlier stops; bounded replan handles changed windows. Known session fees are included in stop cost and metered charging totals. Boundary-crossing sessions use a labeled upper estimate until billing lock-in rules are verified. No API time parameter was invented: these captured endpoints do not establish a future-date quote interface. A missing/unverified time zone retains an upper estimate, never the cheaper current rate. Legacy Tesla/Blink/FLO/ChargePoint reductions are labeled upper estimates where variability is known. Full arrival-sensitive schedules for those legacy readers remain future work, not claimed complete in this release. More complex power bands and fee interpretations are rejected rather than guessed.

Incomplete mandatory fees are not allowed into normal planning. Explicitly allowing estimated/unknown charging costs can admit a partial energy quote, with the unresolved-fee label retained. A complete native ChargePoint quote avoids its web page; an unclear guest fee falls back to the existing page reader. A refusal pauses the affected native source; the existing browser path can offer a real visible ChargePoint challenge, but an app API refusal is not labeled a user-solvable CAPTCHA automatically.

Verified from this desktop: one unauthenticated EA detail and ChargePoint guest batch response; one fresh anonymous registration, token refresh and guest tariff request each for EVgo and Chargeway. Pure tests and phone-width browser fixtures cover identities/joins, opt-out, shared caches, tariffs, currencies, effective dates/days, session boundaries, repricing, fees and worker parity. Physical Android networking, actual billing and broader multi-site network coverage still need owner testing. Do not interpret these checks as proof of national coverage or a guaranteed price.

The detailed proposal below is retained as research history. Its pre-implementation approval/credential-packaging statements are superseded by this section; unresolved provider rights, broader sampling and advanced tariff semantics are not marked resolved.

## Proposed add-on: awaiting owner approval

Plan prepared against main `2791d80` (0.0.255), using the supplied Android app research labeled 2026-10-23/24. This section supersedes conflicting coverage claims in the historical website research below. It is a **plan, not implemented support**. Existing public readers remain unchanged. No reader code, APK, anonymous identities or private API requests were created for this review. Raw captures and helper scripts stay outside the repository; captured credentials must never enter code, fixtures, exports or logs.

The proposed private-app add-on is off by default. Enabling it must explain undocumented endpoints, licensing uncertainty, possible blocking and incomplete prices. Both the native bridge and JavaScript must enforce the opt-in; individual network selections still apply. Owner approval does not grant provider permission. In particular, [PlugShare offers commercial API licenses only](https://company.plugshare.com/api.html), not personal/noncommercial licenses. Provider authorization and credential-distribution rights remain release gates, not issues solved by a disclaimer. See [COMPLIANCE #15](../COMPLIANCE.md).

Evidence below means the supplied capture or owner-run native probe, not a new live verification by this session. A successful sample proves neither network-wide coverage nor permission. Prefer an existing reliable public reader over an extra private/aggregator request.

### Owner coverage requirements and default eligibility

Updated 2026-10-23: a usable offer must have **(1) applicable published price for the estimated charging time, (2) charging level (DC fast / L2 / L1), and (3) connector type**. Live availability is optional. Multiple sources may jointly satisfy this contract; one provider need not supply every field. Price must apply to the identified compatible charger, not merely a nearby site. Include mandatory fee applicability in price completeness. A full time-of-day schedule is NOT required: a provider quote explicitly applicable to the estimated arrival time is sufficient, as is a verified flat tariff. A current-only quote cannot silently be presented as the arrival price when it may change by then.

Use three distinct states:

1. **Default eligible:** validated source chain supplies all three, with price applicability at the estimated charging time established by a flat tariff, an arrival-time server quote, or local schedule evaluation. This is still subject to the private add-on's explicit opt-in and provider access gates. Each station/offer must pass the same completeness check; a network checkbox is not proof every station is usable.
2. **Not default eligible / validation pending:** a price source exists, but equipment joins, tariff interpretation, source reliability or implementation remain incomplete. User selection must not permit an incomplete offer into automatic stop planning.
3. **Disabled for now:** no usable station-price source established. Non-selectable in the network picker and excluded from automatic/alternative-route planning; no "try anyway" override or estimated-price fallback for these networks. This is an intentional lockout until a future implementation validates a real source, not a permanent claim that the provider can never publish prices. Existing user preferences/saved trips cannot silently re-enable them. Explicit user-entered destination charging is separate from network discovery.

**This is an evidence assessment, not a claim of nationwide completeness or a change already applied to the app.** The existing `NET_PRICED` list is not a certification. Current readers sometimes discard schedule/port detail, so retaining today's defaults without validation would not implement this policy.

| Network | Source chain capable of supplying all three | Assessment / remaining gate |
| --- | --- | --- |
| IONNA | Published site tariff + matched DOE/OCM charging level and connectors | Strong default candidate for validated flat-rate sites. Confirm site/port mapping and any applicable variable schedule before certification. |
| Electric Era | Public site price + same-site equipment text / matched DOE units | Strong default candidate for open, non-placeholder, flat-rate sites. Current parser does not retain all equipment; verify joins and tariff scope. |
| Tesla Supercharger | Tesla applicable-time tariff + matched DOE/OCM units | Candidate: verify arrival-time quote or evaluate schedule, correct vehicle/member applicability and compatible port association. Full schedule retention is not required if a server quote covers the estimated time. Destination is a separate category. |
| Francis Energy | Same guest socket's tariff, charging mode and connector | All three observed. Validate simultaneous energy/minute charges and any variable pricing. Current aggregation of socket prices must not create a synthetic quote from different sockets. |
| Blink | Host tariff schedule + charger equipment / matched DOE units | All three potentially available. Current parser collapses day/time slots and chooses a charger, so schedule and connector-specific applicability need correction. |
| FLO | Same station's tariff and connector/level records | All three observed for simple offers. Current parser reduces hourly schedules to a maximum and rejects complex tariffs: scheduled sites need an applicable-time quote or schedule evaluation; a maximum is only a labeled conservative estimate. |
| ChargePoint | Native guest per-port equipment + station tariff; public page as fallback | All three observed, but guest/service fee applicability and scheduled rates need validation. Do not default-enable on partial energy-only quotes. |
| Electrify America | Direct guest tariff + same location's EVSE/connector data | All three observed. Resolve station-local time versus UTC preference, tariff/power-band join and implement reader before default eligibility. |
| EVgo USA | Direct guest site → charger → connector pricing/equipment | All three observed. Resolve TOU/fee precedence, test refresh and implement before default eligibility. |
| Walmart-operated EV | Chargeway station TOU + exact PlugShare stall equipment or validated DOE unit | Combined chain demonstrates all three at a sample site, not network-wide coverage. Verify unit join, fees, refresh, access rights and multiple sites; default off meanwhile. Direct Walmart blocking does not invalidate a sound alternative chain. |
| Mercedes HPC | Chargeway/PlugShare tariff + exact stall equipment; ChargePoint direct only for verified backend IDs | Combined chain demonstrates all three at samples. Different hardware/backends and fee/schedule coverage require multi-site validation; default off meanwhile. |
| bp pulse US | PlugShare stall tariff/schedule and equipment | All three demonstrated at LAX only. More sites, sanctioned access and implementation needed; default off. Chargeway generic text cannot fill a gap. |
| Shell Recharge US | Exact PlugShare stall tariff/fees/equipment, optionally Chargeway schedule | Potential combined chain, but operator tariff not independently confirmed and Chargeway omits fees. Validation pending, default off; not classified as price-unavailable solely because the own app is closed. |
| Rivian Adventure | Chargeway station tariff + exact PlugShare/DOE connector and level | Potential combined chain; source-only tariff and equipment join need validation. Default off, not claimed price-unavailable. No further protected-app investigation. |
| PowerFlex | Explicit PlugShare stall tariff + same stall equipment | Isolated evidence only; default off pending operator-specific validation. Do not extrapolate to all aggregator operators. |
| EV Connect, Rivian Waypoints, generic other/non-networked | No dependable network-wide station-price chain established in this research | Disabled for now. Isolated DOE notes are not evidence of reliable network coverage; investigate separately before unlocking. |
| Red E, Circle K, Revel, Love's, EVCS, SWTCH, Noodoe, Loop, Xeal, Applegreen, 7Charge, Kwik Trip, Casey's, Gravity | No validated usable station-price chain in supplied research | Disabled for now, unless a separately validated existing source is documented before release. Not a claim that all their stations lack published prices. |
| Hotels, dealerships, Tesla Destination and other potentially complimentary hosts | No universal tariff; explicit host terms may support individual stations | Separate, not default enabled. Unknown is not free. Offers lacking an explicit applicable price remain unavailable; network-operated equipment on these properties keeps its real operator classification. |

No additional network is certified default-on by this documentation change. To promote one, record a small stratified validation set spanning AC/DC where offered, connector variants, different hosts/backends, flat and scheduled prices, fees and unknown-price cases. Check each against displayed provider prices where possible; record successes/failures and the matched inventory fraction, not just a single success. Exact sample thresholds should reflect network diversity, not imply statistical national coverage. A failure to load today is distinct from absence of a price source: preserve valid cache and report failure, but do not fabricate an offer.

For combined sources, equipment can be older than the price if still valid, but its IDs/connector association must remain consistent. Stable validated DOE/provider/OCPI identity is preferred; unique operator/location/address matching can establish a station join, but a station join alone cannot assign different tariffs to its ports. When port association is ambiguous, exclude the offer until resolved. Treat availability as an optional separately timestamped field, never a completeness prerequisite.

This owner policy supersedes historical "unchecked but selectable" language below for networks with no price source. It also supersedes generic estimated-price fallback for those networks. Implementation remains pending approval; do not imply these locks already exist in version 255.

### Per-network source plan

| Network | Price, connectors and speed evidence | Primary / secondary and exact join | Fallback / limitation |
| --- | --- | --- | --- |
| Electrify America | Guest app location detail has power/time-banded energy prices, fixed fees and idle terms; EVSE connectors include standard, voltage and amperage. Owner reports unauthenticated native success. | Direct EA guest endpoints. Join location ID → EVSE/connector → tariff ID and power band. Keep location time zone and schedule. | DOE/OCM for missing equipment. Old website state averages are not prices. PlugShare has a demonstrated idle-fee error; never use it to repair EA fees automatically. |
| EVgo USA, including EVgo-operated Pilot/GM sites | Guest GraphQL has site equipment, charger-specific connector prices, session-fee information and TOU schedules. Captured app evidence; anonymous token refresh untested. | Direct EVgo: site `altId` → charger `altId` → connector ID. All three operations are required; a single charger price cannot price the entire site. | Chargeway station blocks or PlugShare stall text only after exact matching and completeness checks. Exclude the unrelated Morocco EVgo service. Do not assume every Pilot/GM-branded site is EVgo. |
| ChargePoint | Native guest batch detail gives per-station energy/service/guest fee fields, explicit free flag, per-port connectors, L2/DC and maximum kW. Owner tested native calls successfully. | Native guest station detail, keyed by validated ChargePoint device/station ID. Preserve port association. | Existing public station page, then DOE/OCM equipment. One sample shows a guest fee absent from displayed pricing: determine applicability before producing a complete cost quote; do not sum all fee fields blindly. |
| Mercedes-Benz HPC | Roswell: Chargeway structured .22/.44/.22 TOU and PlugShare agree; PlugShare adds idle terms. Sandy Springs: PlugShare has a different schedule and ChargePoint hardware. Per-stall equipment is available. | Chargeway station tariff plus PlugShare stall fees only where the same site, charger, guest plan and schedule can be proven. ChargePoint direct for confirmed ChargePoint-operated units, not the whole brand. | DOE/OCM equipment. Own app login wall: no direct reader proposed. Matching hardware manufacturer does not establish tariff backend. |
| Walmart-operated EV chargers | Chargeway Ellenwood TOU .29/.46/.29 agrees with captured Walmart guest UI and PlugShare. PlugShare equipment supplies connector type; Walmart list supplies power but not connector type. | Chargeway structured station price; PlugShare per-stall connector/fee detail when justified, joined by stable OCPI identity or unique station/operator/coordinates plus unit identity. | DOE/OCM equipment. Direct Walmart native probe returned Akamai 418: stop, no reader/bypass proposed. Authorization holds are not fees. EA chargers at Walmart are EA, not Walmart-operated. |
| Shell Recharge US | Houston: Chargeway .35/kWh omits PlugShare's $1.95 session and idle terms. PlugShare supplies stall equipment. Actual tariff not verified against operator. | Conditional Chargeway schedule + PlugShare fees, only with exact station/connector/plan/time agreement; retain source uncertainty. | Prefer a complete explicit stall tariff if authorized. Energy-only data is a partial quote, never a complete cheapest-route price. Own app login/protection out of scope; no European roaming-price substitution. |
| bp pulse US | LAX PlugShare TOU .30/.45/.55/.30 independently agrees with captured Octopus guest UI; stall hardware distinguishes 150 kW CCS and 400 kW NACS. | PlugShare stall-specific tariff and equipment. No merge with Chargeway network text: its generic .48 is not this site's tariff. | DOE/OCM equipment. No direct guest app tariff established. Octopus is a research cross-check only, not a runtime source. One site does not prove national coverage. |
| Rivian Adventure Network | Chargeway Joshua Tree .74/kWh plus idle terms is source-only, unverified against Rivian. PlugShare reports unknown price but 300 kW NACS equipment. | Chargeway explicit station blocks, marked unverified; PlugShare equipment only if exact unit join is possible. | DOE/OCM equipment. Leave uncertain pricing off unless explicitly accepted. No further app-install, age-check or protected-app investigation. Do not generalize this site to all RAN. |
| Rivian Waypoints | No reliable station-specific price demonstrated. | DOE/OCM and explicit published host statements only; keep distinct from RAN. | Unknown, not free. No new private reader proposed. |
| Tesla Supercharger / Destination | New aggregators show generic text or unknown prices, not improved station tariff evidence. | Keep existing Tesla public reader and equipment sources; preserve membership/vehicle applicability. | Explicit host/free terms for Destination only. No fabricated price from network text; destination chargers are not automatically public/free. |
| IONNA, Blink, FLO | Already implemented public readers; this bundle does not establish a better replacement. | Keep existing source-specific readers and matching. | DOE/OCM explicit tariffs/equipment. Preserve current restrictions and unknown/free distinctions. |
| Electric Era | Already implemented in 0.0.255; public list has price and equipment text. | Existing daily public list and coordinate match within 250 m. | Skip coming-soon and suspicious placeholder prices; no new aggregator traffic needed. Preserve current reader limits. |
| Francis Energy | Already implemented in 0.0.255; guest public map has socket equipment/prices. | Existing anonymous public-map session; coordinate match within 150 m and AC/DC compatibility. DOE FCN identifiers are NOT the map station IDs. | Keep bounded box/detail reads and refusal stop. Separate terms decision remains in compliance #14. |
| EV Connect | PlugShare example is unknown; no reliable new station tariff established. | Existing explicit DOE/OCM price notes only. | Unchecked by default where reliable price is unavailable; no new private reader. |
| PowerFlex / other PlugShare-listed operators | Some individual paid-price examples exist; not demonstrated network-wide support. | Only explicit station/stall tariff after authorized access, exact equipment matching and operator-specific fixtures. | DOE/OCM; no blanket enabling of all operators. |
| Dealerships, hotels and other potentially complimentary hosts | No general price evidence; customer/parking/access restrictions can apply. | Separate host category, explicit published free statement or actual tariff required. | Off by default; never infer free from host type. A public network charger at a hotel/dealership retains its actual network. |

### Source contracts and discovery joins

1. **EA:** `msp.electrifyamerica.com/public/locations` bounded coordinate search; `/public/locations/{id}` detail. No auth observed. Capture `pricing[]`, `fixedFees[]`, `idleFee`, power bands, period text, connector standard and `tariffId`. Match DOE/OCM by exact network-specific ID where independently validated, otherwise unique operator + coordinates + name/address. App sends a UTC preference header: site-local schedule interpretation, overnight windows and DST must be verified before selecting a time band. Voltage × amperage is not proof of delivered power or AC phase; keep source-rated power or unknown.
2. **EVgo:** `api.prod.evgo.com/` GraphQL operations `getEvgoSitesForMobile`, `siteForMobile`, `getChargerPricingForMobile`. Preserve exact query schemas from sanitized capture excerpts before implementation. Connector IDs observed: 1 J1772, 2 CHAdeMO, 3 CCS, 5 NACS; unknown IDs stay unknown. Site mapping uses validated provider ID or unique network/coordinates/address; prices then join by charger and connector, not nearest port. Confirm `maxSessionFee` semantics and TOU/connector-price precedence before calculating totals. Firebase anonymous bearer required.
3. **ChargePoint:** `internal-api-us.chargepoint.com/driver-bff/v2/map-data`, then `/driver-bff/v3/station-detail-list`. Use validated existing station/device IDs first; location map clusters require subdivision, not conversion into fictitious stations. Detail batch size around 32 was observed, not a guaranteed contract. Preserve `stationPrice` components and `portsInfo.ports[]` together. `use_cache:false` does not excuse discarding Gasket's valid cached tariff. Request only missing/stale units. DataDome blocking remains possible despite successful low-rate probes. Never replay captured device identity or push tokens; any necessary device identity is Gasket's own, with documented minimal fields.
4. **Chargeway:** `api.chargeway.net/mobile/stations/search` rectangular search, then `/stations/{id}/pricing`. Use `nrel_id` as the first DOE join, verifying operator/location; otherwise use unique network/coordinates and address, with stored provider station ID. Preserve structured currency/units and `blocks` start/end/rate. Equipment power is watts, not kW: convert explicitly. Network-wide `text_pricing` never becomes a station tariff. Static app API credential plus Firebase anonymous identity required; legal distribution and refresh remain gates. `updated_at` appeared stale across app use: preserve it, do not turn retrieval into a new source-update time.
5. **PlugShare:** `api.plugshare.com/v3/locations/region`, then `/v3/locations/{id}?minimal=0`; static app Basic credential, not a user API entitlement. Region request parameters still need a sanitized offline extraction from `plugshare2.mitm` before implementation; do not guess them. Use `ocpi_ids` only after confirming identifier namespace/type; otherwise unique operator/coordinates/address, then exact stall/equipment compatibility. `cost_description` is per-stall text, with possible errors. No reviews, photos, check-ins or personal data needed. EA idle error must be rejected, not globally multiplied by 60. Licensing is a blocking gate for shipping this source without authorization.
6. **ChargeHub:** `apiv3.chargehub.com/chapi/prod/locationsmap/v2` and `/chapi/prod/stations/details?station_id=…&language=en&isShared=false&isTest=0`; static subscription and Basic credentials. Exact map parameters still need sanitized offline extraction from `chargehub.mitm`. Persist ChargeHub station ID after unique network/coordinate/address match. Per-plug `PriceString`, `ChargingRate`, `ParkingRate`, `FlexFee`, connector, power, amps, volts and status stay associated. Only a free ChargePoint L2 sample was validated, not paid DC coverage. Its equipment omitted a NACS port present in ChargePoint: do not replace a fuller authoritative port list. Paid-DC fixtures and access rights are prerequisites, not assumed coverage.

For non-ID matches, start with a conservative unique match within 100 m plus operator and address/name agreement; uncertainty means no join. Existing Electric Era/Francis matching bounds remain source-specific, not widened globally. Co-located operators, opposite-side highway plazas, renamed networks, duplicate locations and incompatible connectors must remain distinguishable. Station proximity alone cannot join fees onto a particular charger. OCM connection IDs, DOE IDs, provider location IDs and OCPI EVSE IDs occupy different namespaces. Record the source ID mapping and confidence; do not derive one by stripping arbitrary prefixes.

### Arrival-time price lookup

Prefer asking a provider for the price at the estimated station arrival when its endpoint actually supports a documented or verified time parameter. Do not invent parameters, assume a successful response honored them, change the phone clock, or assume today's weekday schedule applies to a future date. Confirm returned validity/effective time, station time zone, connector and plan. If the endpoint only serves the current price, use a published schedule where available; otherwise mark future applicability unknown rather than label the current rate an arrival quote. Missing a full schedule alone does not make a network unsupported.

Cache time-specific quotes by station/charger/connector, plan and their verified validity interval/date, not station ID alone. Reuse within that interval; re-evaluate or requery when departures, preceding charging stops, speed, detours or route choice move arrival outside it. Changes to price can change chosen stops and arrival times: use bounded refinement, deduplicated requests and a convergence limit, then expose unresolved uncertainty rather than loop indefinitely. If charging crosses a tariff boundary, apply the provider's actual billing rule (start-time locked versus interval-based); a quote valid only at arrival is not automatically valid for the entire session. Never promise that published prices cannot change before travel. A peak rate can be shown as a clearly labeled conservative estimate, not as the exact expected price or a complete comparable quote.

### Tariffs, freshness and planner behavior

The current simple `netPrice` shape cannot safely describe all these tariffs. Before claiming complete support, add a versioned tariff record alongside legacy prices, with provider/location/EVSE/connector identity; guest/member applicability; currency; energy/minute/session components; idle grace; parking; tax inclusion; restrictions; station IANA time zone; schedule and effective dates; retrieved/source-updated times; and confidence/completeness. Authorization holds are separate, never travel cost. Unknown fees are unknown, not zero. Only unambiguous simple tariffs may be adapted to the old price shape; complex/incomplete quotes must not silently enter exact cheapest-route ranking.

Never combine the cheapest energy block with unrelated fees or equipment. Cross-source merges require the same operator/site/unit, connector, plan, currency, effective period and compatible schedule. Keep both provenances and reject contradictions. Two aggregators may share an upstream feed, so agreement is not necessarily independent verification. Use departure/arrival time in the station's zone for TOU; future trips get the existing change warning, not a promised future price. Explicit free plus applicable access conditions is required for zero.

Reuse all valid cache data across route alternatives and queued vehicles. Price expiry remains the tighter of the user's freshness preference and the normal 24-hour refresh cap. Known source price-update times take precedence; observation time is the fallback only when price-update time is unknown. Do not substitute inventory timestamps for price timestamps or mark an old source value fresh just because it was retrieved again. Proposed equipment cache: seven days, with separately timestamped short-lived availability; cached availability is never called live. Schedule selection may change without refetching a still-valid tariff. No bulk nationwide scraping: DOE/OCM remains inventory discovery, private requests enrich only relevant missing/stale route stations.

### Operational controls and failure handling

1. Start conservatively: at most two requests in flight across this add-on, one per source, deduplicate identical station work across trips/vehicles, and prioritize needed route prices over optional equipment. These are proposed Gasket budgets, not verified provider allowances. The gas browser-worker slider (up to 50) must not control private API concurrency.
2. Chargeway reported 100 requests/minute. Start at no more than 60/minute, burst one, shared by all jobs and retries; reduce on refusals. For other sources begin one request/second or slower with bounded batches, then adjust only from measured permitted behavior. Honor `Retry-After`, apply backoff/jitter and a provider-wide circuit breaker. No token/account/device rotation to avoid limits.
3. EVgo and Chargeway each need one isolated anonymous identity per installation, not a signup per request. Follow [Firebase's refresh protocol](https://firebase.google.com/docs/reference/rest/auth), response expiry and rotated refresh tokens, but first test each provider project's actual refresh support. Single-flight refresh and one auth retry; revoked/invalid identity becomes an actionable failure, not an endless signup loop. Refresh remains unverified in supplied research.
4. Keep own tokens in protected app storage, out of backups/logs/exports; remove them on add-on disable/data erasure. Do not ship captured bearer tokens, refresh tokens, static credentials, cookies, device IDs or FCM tokens. Distribution of any necessary static app credentials requires an approved lawful provision mechanism; an opt-in toggle does not make those credentials redistributable. Fixed-host native endpoints, validated inputs, bounded bodies/timeouts, and no credential-forwarding redirects.
5. Distinguish explicit challenge, ordinary SPA/loading failure, auth expiry, rate limit, malformed response and unsupported tariff. Pause the affected source's queued work on blocking rather than emitting a series of unknown prices. Reuse the existing user-visible challenge flow/notification only for an actual interactive browser challenge; an app-only refusal may have no challenge the user can solve. Keep successful cache entries and resume safely without rescanning everything. No bypass, patched APK, pinning/CT workaround, attestation spoof or hidden account creation.
6. Log sanitized phase, source ID, cache reason/age, match decision, HTTP category, latency, retries and tariff completeness. Never log raw authentication headers or full captured payloads. Cancellation must preserve completed valid station records without pretending incomplete work succeeded.

### Unsupported and approval gates

- **No new direct readers:** Walmart (Akamai refusal), Shell and Mercedes (login/protected app), bp (no guest tariff established), Rivian (left unverified), Octopus (protected app), EV Connect (no verified useful tariff), Chargemap (insufficient US value), and the unrelated Morocco EVgo app. No further protection/age-check work is proposed.
- Public-site research below also names Red E, Circle K, Revel, Love's, EVCS, SWTCH, Noodoe, Loop, Xeal, Applegreen, 7Charge, Kwik Trip, Casey's and Gravity. This bundle does not establish reliable new tariffs for them; retain unknown/off-by-default behavior rather than advertise coverage. DCFC Tracker is not an approved scraping fallback. Sanctioned provider/NEVI feeds with user developer credentials remain an alternative, not part of this private add-on implementation.
- Resolve provider authorization/terms and credential provisioning before shipping affected private readers. PlugShare is a specific licensing blocker; do not present its successful HTTP response as permission. ChargeHub and Chargeway rights also need explicit review.
- Resolve EA local-time/power-band interpretation, ChargePoint fee applicability, EVgo fee/TOU precedence and both Firebase refresh paths before enabling complete cost quotes for those sources.

### Proposed implementation order after approval

1. Define tariff/completeness contracts, source gating, protected storage, shared request budgets and sanitized fixtures. Keep partial prices out of exact-cost ranking.
2. EA direct guest reader first: no observed authentication, useful structured tariff. Validate zone/schedule/power-band selection before enabling it.
3. ChargePoint native guest fallback: batched IDs and equipment should reduce fragile page work; resolve guest/service fee applicability and exercise DataDome refusal behavior.
4. EVgo direct guest reader: isolated anonymous identity, verified refresh and per-charger quote association. Test Pilot/GM identity mapping separately.
5. Chargeway enrichment, then PlugShare cross-source repairs only if rights/provisioning gates clear. Prioritize Walmart and Mercedes; keep Shell/RAN uncertainty visible. bp needs its own verified per-stall tariff, not Chargeway text.
6. ChargeHub only after paid-DC coverage is demonstrated; never overwrite better port data with an incomplete aggregate. Do not replace already working public readers without a concrete benefit.

After approval, tests should cover sanitized fixture tariffs (not raw captures), free/unknown/partial distinctions, overnight/DST schedules, units, currency, member exclusions, fee/hold semantics, timestamp aging, exact-ID/proximity conflicts, co-located operators, AC/DC and per-port joins. Exercise auth refresh rotation/failure, 401/403/418/429, persistent visible versus transient challenges, cancellation/resume, shared caches across route alternatives/vehicle batches, opt-out enforcement at both bridges, secret-free logs/exports and unsupported-schema failure. Only then make small bounded native/device probes; successful unit tests do not prove live tariff accuracy or permission.

**Decision requested:** approve this staged plan (including the tariff contract work), or narrow the first pass to EA and ChargePoint while provider rights and aggregator access remain unresolved. No reader implementation or APK until approval.

## Historical website-only research

Checked 2026-10-20, signed out. These are observed reader capabilities, not a claim that a network can never publish prices. No accounts, private app endpoints, or bot-check bypasses.

## Public price readers (enabled by default)

1. Tesla Supercharger: existing findus reader; vehicle/member-specific peak tariff. This is not a quote for the future.
2. IONNA: existing public finder page lists per-site prices.
3. Blink: existing map service returns host-set tariffs; all-zero responses remain untrusted.
4. ChargePoint: public station-page reader; some sites fail or publish incomplete prices. A transient subresource 403/429 or automatic/hidden check is not immediately treated as a user CAPTCHA. The reader waits for recovery, prompts only for a persistent visible challenge, and reports ordinary detail-loading failures separately. If a device URL opens only the map/list, it opens an exact card ID or a unique exact station-name match, never a guessed neighbor. Scheduled energy prices are separated from idle charges; fees/taxes remain flagged. Phase, HTTP hints, timing and exact-card opening are logged. No rate means no price, not free.
5. FLO: new reader for the public map embedded on [FLO Network](https://www.flo.com/flo-network/). Its published bundle uses `emobility.flo.ca/v3.0/parks/nearest` (POST) and `parks/station/<UUID>` (GET), without credentials. Tested live: Canadian DC tariffs explicitly marked CAD, US hourly tariffs explicitly marked USD, and US public curbside time-of-day hourly tariffs. The latter chooses the highest listed flat hourly rate. Station detail also supplies connector type, AC/DC level and power in watts. Implementation is US/USD only; CAD, ambiguous location matches, unsupported connectors, restricted sites and complex tiered tariffs are not guessed. Nonmember/parking fees are not silently converted into energy charges. Native requests have fixed endpoints, validated coordinates/UUIDs, bounded bodies, no redirects and timeouts. A refusal stops FLO reads and does not populate a negative price cache. Site matching requires network, name and <=100 m; reading is bounded to 24 route sites and at most eight units/site. Unread sites remain unknown unless DOE already publishes a tariff.

6. Electric Era (0.0.255): the drivers page's public site list (`ocpi-http.app.electricera.tech/ocpi/2.2/locations_web`), read once a day. Each DOE `ELECTRIC_ERA` station is matched within 250 m. Prices under 10¢ (coming-soon placeholders, and the 0 an open site can show) are not prices. Coming-soon sites are skipped.
7. Francis Energy (0.0.255): the signed-out finder map (native `fetchFrancis`), using the page's own anonymous session cookie and CSRF token, and only its two map queries.
   - Each DOE `FCN` station is matched by coordinates; the DOE network IDs are not the map's station numbers, and the map's coordinates match DOE's exactly.
   - The box query covers ±0.003°. Up to 3 stations of the right speed within 150 m are read; test, coming-soon and non-public stations are skipped.
   - Price is the guest plan in USD per kWh (or per minute), plus any transaction fee. All-zero prices are not published, never free.
   - At most 30 sites per pass, cached a day. A 403/429 stops Francis reads for that pass.
   - Grouped before the dealership test, because Francis hosts public chargers at dealerships.
   - Its terms forbid scraping: owner decision, see COMPLIANCE #14.

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

### Follow-up 2026-10-23: signed-out display and app guest access

**Websites: confirmed from their own code**

- **Electric Era:** the drivers page writes `$x.xx / kWh` into each site card from the public JSON.
  - Placeholders (0–2¢) also show on coming-soon cards.
  - One open site shows $0.00. Treat it as unknown, never as free.
- **Francis Energy:** the public map shows socket prices to signed-out visitors.
  - The anonymous configuration has `showPricesForUpperLevel: true` and `hide3rdPartyPricesForOtp: false`, so prices for other networks' stations on its map are shown too.
  - Checked from the code and settings, not in a rendered browser.

**Apps: public sources don't settle whether prices need a login**

| App | Map signed out | Prices signed out | Evidence |
|---|---|---|---|
| PlugShare | Yes | Not confirmed | BC Hydro: no registration needed except to check in |
| Chargeway | Unknown | Unknown | — |
| Octopus Charge | Unknown | Unknown | — |
| Rivian | Unknown in the app | Rivian.com map shows none | — |
| Shell | Unknown | Unknown | New Shell App account required for charging |
| Walmart | Unknown | Unknown | Help text says get the app and an account; site behind a bot check |
| bp pulse US | Unknown | Unknown | Reviews say registration and payment before charging |
| Mercedes HPC | Unknown | Unknown | Payment through the Mercedes-Benz app |

A hands-on signed-out check on the phone is the reliable answer for the apps.
