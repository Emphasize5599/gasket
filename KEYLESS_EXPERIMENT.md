# Keyless regular-gas experiment

Branch: `test/keyless-regular-gas`. Regular release: 0.0.103 on main.

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
