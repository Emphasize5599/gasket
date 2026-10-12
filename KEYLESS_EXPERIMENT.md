# Keyless regular-gas experiment

Branch: `test/keyless-regular-gas`. Regular release: 0.0.103 on main.

## 0.0.105: saved-trip refresh and Routes limiter

The main price-refresh workflow is now **saved-trip price refresh**, not complete keyless discovery. Open a saved gas trip, go to Stops, and tap **Refresh saved prices — no API calls**. It updates regular prices only at already-saved stations. It preserves IDs, coordinates, membership/discount flags, route geometry, detours and other fuel grades. Unmatched stations and their old/missing prices stay unchanged. The trip retains its original discovery timestamp, and per-price `observedAt` records when a web price was retrieved; it is not a pump-price update time.

Matching prefers a stable Google place ID, then a one-to-one same-brand address/coordinate match (normalized street addresses within 0.1 miles, otherwise coordinates within 0.03 miles). Duplicate saved rows across route alternatives receive the same update; website-only stations are not added. Website results from overlapping areas are deduplicated first.

Known stations are grouped into 8-mile searches, with planned stops prioritized, not one browser per station. Version 0.0.106 uses two dedicated readers concurrently, at most 12 uncached area reads, and stops starting reads after three minutes; each active read has its own deadline. Readers stop scrolling early only when every target's stable ID has a regular price. Answers are reused for 15 minutes for the same target set. A following batch can continue to uncached areas. Bot/consent restrictions stop new scheduling; already-active reads may finish. The visible check never triggers an automatic paid search. Partial matches, unchanged stations and errors are reported. These boundaries limit traffic; they do not guarantee every saved station gets a fresh price.

**Discover stations again (API)** remains a separate action for complete station discovery. On a saved regular-gas trip, that action switches to price-only website refresh if the Places cap is already exhausted. It never raises the existing Places cap. New trips and other fuel grades retain the existing discovery workflow.

Settings has a separate **Monthly Routes safety cap**, default **9,500** against the current Compute Routes Essentials free allowance of 10,000. Current route requests use TRAFFIC_UNAWARE and at most ten intermediate waypoints (including eight-point alternative reconstruction). The JS adapter checks before new requests and the native gate reserves attempts atomically and persists them before sending. Cached/saved routes are usable at the cap. Route attempts use `rcalls_YYYY-MM`, separate from Places `calls_YYYY-MM`; backup restores retain the higher count. A zero cap explicitly disables the limit. Counts are per installation, not billing-account-wide; advanced features or shared keys need different budgets.

Added tests execute the actual native reservation block against Java stubs, including concurrent requests at the boundary, blocked requests and failed persistence. Browser tests cover saved-trip refresh with zero paid calls, no new stations, other grades/geometry/detours preserved, price persistence on reopen, cache reuse, and capped-discovery fallback. A direct Routes adapter test checks cached routes at the cap and explicit unlimited mode.

## Scope and use

The APK installs separately as **Gasket Keyless Test** (`com.bensanzone.fuelmap.keyless`), with the same signing key but separate data. The regular app is not replaced. A full backup from the regular app may be restored into the test app, including pictures; keep backups private because they include API keys.

In Settings, enable **Try keyless regular prices**, select Regular, then refresh the nearby map. The switch is off by default. The installed API key is not used for nearby regular searches while the switch is on. Paid fallback is never automatic. Disable the switch to compare with the existing API path. Route creation, along-route station searches, and other grades still use the existing API path: this prototype does NOT eliminate all API-key dependence.

For paid API comparisons in this separate installation, an Android-restricted Google key must also allow `com.bensanzone.fuelmap.keyless` with the existing signing certificate. Restoring the same key does not automatically add that package to its restrictions. No key is needed for the experiment's nearby regular mode.

## Sources and limits

- OpenStreetMap's Overpass API: one `amenity=fuel` area query, 15-mile maximum radius, seven-day location cache, 30-second cooldown, no automatic retries. Experimental per-device daily budget: 20 queries and 5 MB estimated transfer; 1 MB maximum accepted response. Limits live in persistent `gasmeta`, not cache. This is a personal test, NOT a scalable production backend. Public Overpass is shared and its limits apply across all app users; broader distribution requires a different host or regional extracts.
- Google Maps web: the phone opens an ordinary gas-station search. The reader uses the search response the page fetched, asking the browser cache for the same URL. Cache misses can cause a refetch. No private request template, session token construction, account, Google SDK or API key. Up to three scrolls and a 30-second worker deadline. Final area answers cache for 15 minutes; errors are not cached. No CAPTCHA bypass; a restriction offers the existing visible verification window.
- Walmart and Murphy direct-source readers remain available and override matched web prices.
- Search results are NOT an exhaustive station catalog. OSM can miss stations, brands, addresses or recent closures. Google may omit prices or omit stations. Missing prices remain missing.
- Only explicit USD `/Regular` labels are accepted. Premium, diesel, prices without a grade, implausible values and ambiguous ID/price associations are rejected. Google's US price update time is unknown; retrieval time is not represented as a pump-price update time.
- OSM node/way duplicates collapse only within 0.025 miles of the same brand. Price transfer requires a one-to-one match between same-brand OSM and Google candidates within 0.06 miles; ambiguous candidates in either direction retain separate Google rows. No nearest-station guessing across brands. The experiment is US-focused.

## License decision

Vela is GPL-3.0: https://github.com/PimpinPumpkin/Vela/blob/main/LICENSE. Its architecture and documented behavior informed the feasibility investigation. **No Vela source code, request/protobuf templates, calibration files, fixtures or libraries are bundled or copied.** This branch's new JavaScript was written for Gasket's existing native/WebView architecture and debugged against independently observed public Google page responses. Gasket's Source First License remains unchanged. This is not a claim that rewriting copied GPL code avoids GPL obligations: direct Vela code reuse would require a compatible licensing arrangement, appropriate notices and corresponding source, and confirmation of rights to relicense all affected Gasket code.

OSM data is separately licensed under ODbL and requires attribution; the UI and third-party notices link to the contributors and license. Data licensing obligations are separate from software licensing. Google's public web content still comes with Google's terms: lack of an API key does not waive them. Existing Google/OSM display and collection questions remain in COMPLIANCE.md. Do not represent this experiment as resolving those questions.

## Verification and promotion gates

Automated tests cover nodes/ways, bounds, supported brands, duplicate forecourts, provenance, conservative price matching, raw and framed JSON replies, exact regular-grade labels, escaped JSON strings, malformed responses, restrictions and zero paid nearby calls. Captured public test responses were also replayed locally: initial search had 20 price labels; a scroll frame had 16. Live Overpass returned 74 fuel objects in a small public Little Rock sample area. These are coverage samples, not guarantees or independent pump-price verification.

Final live run of the actual worker in an isolated desktop browser: 28 Google station rows, 26 with matched regular prices, about 9.2 seconds. This verifies the browser path, not Android WebView behavior or the owner's local coverage. Full existing Node tests passed; normal map/settings and trip UI are tested with the experimental switch off.

Before promotion to main:

1. Compare API vs keyless results on the owner's actual phone in urban, suburban and rural areas; count missing stations and priced stations by brand.
2. Check a sample against displayed Google prices and chain prices, including cash/member variants. Never infer cash/credit or membership conditions from an unlabeled price.
3. Confirm retries, visible consent/security checks, airplane mode, cooldowns, cached results and restarts do not strand the spinner or spend paid lookups.
4. Measure total requests/bytes/time (including Maps' own resources), not just nominal API calls. Verify Android WebView response-cache behavior.
5. Add efficient route-wide coverage separately. Do not fan out a public Overpass query or a Google browser per station or route point. Keep existing route behavior until coverage is measured.
6. Decide data-service capacity and review Google's terms and OSM obligations before broader distribution.

Public source references: https://github.com/PimpinPumpkin/Vela ; https://wiki.openstreetmap.org/wiki/Overpass_API ; https://www.openstreetmap.org/copyright
