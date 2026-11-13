# Signed-out VIN-to-trim research — 2026-11-13

## Scope and limits

Live checks used the local Codex built-in browser with its normal user agent, no credentials, and public dealer VINs or the owner's explicitly supplied Mustang VIN. No security challenge was solved. The owner's full VIN is omitted from this public report.

This session verified **visible website results**, not raw network responses. The browser tool exposes page controls and console logs but no network request/response inspection. Consequently, Ford's internal API URL, method, headers, cookies and raw trim/package fields remain **unverified**. A model-only UI does not prove that an underlying API lacks more information. Toyota's GraphQL request below is carried forward from the 0.0.477 handoff/code; its signed-out website lookup was independently exercised here, but the raw same-origin fetch and cookie-free request were not independently replayed.

## Results and recommendations

| Brand/source | Entry point or endpoint | This session's result | Recommendation |
|---|---|---|---|
| Toyota manufacturer parts store | `POST https://autoparts.toyota.com/graphql?getVehicleDataByVin`; prior verified header `dealer-code: default` | Signed-out VIN form selected 2011 SIENNA, **LE**, 2WD 3.5L 6-CYL 6AT for `5TDKK3DC9BS006257`. This is consistent with the existing fixture/handoff. | Retain the existing integration. This is one fresh browser confirmation, not a repeat of the earlier eight-VIN batch. |
| Ford manufacturer parts store | `https://parts.ford.com/` redirects to `https://www.ford.com/parts`; Select Vehicle → VIN | All five handoff VINs recognized, but the visible result names year/model and engine/drive/transmission only. Neither tested Mustang gets a visible GT/Premium distinction. Internal endpoint/session requirements not captured. | Do not add a trim integration from these results. Continue asking when trim is unknown. |
| Ford owner support | Search Vehicle → VIN at `https://www.ford.com/support/`; observed result route `GET https://www.ford.com/support/vehicle/vin/1FA6P8CF8K5178450` | Public page says **2019 Mustang**, with the correct VIN. No visible GT Premium designation. Further personalized features are offered behind sign-in. | Public route is useful for support, not a verified marketing-trim API. Do not sign in or infer Premium from the generic feature cards. |
| FordDirect window sticker | `https://www.windowsticker.forddirect.com/windowsticker.pdf?vin=1FA6P8CF8K5178450` | Browser displayed an empty gray document view. No readable sticker was verified. This does not establish that Ford has no sticker for this VIN. | Follow-up needed with a PDF-capable browser/network inspector; no automatic fallback justified yet. |
| Hyundai manufacturer owner portal | `https://owners.hyundaiusa.com/us/en/index` | Login form requires email/password. The genuine-parts information page links to dealer service, not a public marketing-trim result. | **Needs sign-in** for the inspected owner portal. No integration added. |
| Hyundai dealer catalog, **not a manufacturer API** | `https://hyundai.oempartsonline.com/` (RevolutionParts / AutoNation National eStore) | Four Tucson VINs all led to a trim-selection page with **Limited / SEL / Sport / Ultimate**, each 2.4L. The page explicitly reported a problem selecting the vehicle. | Useful as an ambiguity check, not a source of one verified trim. Never choose the first returned trim. |
| Hyundai other candidate | `https://www.hyundaiparts.com/` | Connection timed out in the browser. Ownership/manufacturer status was not established. | Record as unreachable, not as a working Hyundai manufacturer endpoint. |
| Volkswagen manufacturer parts store | `https://parts.vw.com/` | Cloudflare security verification did not complete. No VIN was submitted. | **Blocked in this browser.** No endpoint/trim result verified. |
| Volkswagen owner portal | `https://www.vw.com/en/owners.html` | Page offers Log in / Sign Up to view vehicle details. | **Needs sign-in** for the inspected portal. No integration added. |
| Lexus | Existing `/graphql` integration | Not retested here. Earlier handoff reports F-SPORT identification, but STANDARD/BASE/body-only grades do not establish Premium/Luxury packages. | Preserve existing conservative parser and clean vPIC trims. |
| Subaru | Existing vPIC parsing | No additional Subaru VINs tested. `Limited+M/R+NAVI(HK)` remains unknown because it contains a slash. | Do not add an unvalidated rule that strips everything after `+`. |

The prior Toyota/Lexus request body is:

```json
{"query":"{vehicleData(vin:\"<VIN>\"){message allRecords{model_year make model_name grade driveline}}}"}
```

## Ford parts VIN results

The listing descriptions below are the handoff's labels, not independently reverified dealer claims in this session. All rows were submitted in the same normal, signed-out browser session. Successful UI operation does not establish whether cookies are required.

| VIN | Handoff vehicle/trim | Visible parts-store answer |
|---|---|---|
| Owner's VIN ending `203631` | 2005 Mustang V6, Deluxe or Premium unknown | 2005 Ford Mustang; 4.0 Gas, 2WD Automatic |
| `1FA6P8CF8K5178450` | 2019 Mustang GT Premium | 2019 Ford Mustang; 5.0 Gas, 2WD Automatic |
| `1FA6P8CF3K5152564` | 2019 Mustang GT | 2019 Ford Mustang; 5.0 Gas, 2WD Manual |
| `1FTEW1E49LFA08332` | 2020 F-150 Lariat | 2020 Ford F-150; 3.5 Gas, 4WD Automatic |
| `1FTEW1E44LKD08643` | 2020 F-150 Lariat | 2020 Ford F-150; 3.5 Gas, 4WD Automatic |

## Hyundai dealer catalog samples

All four returned the same four choices described above; **none** identified SEL uniquely.

| VIN | Listing trim | Listing source |
|---|---|---|
| `KM8J3CAL4MU379391` | SEL | Supplied handoff |
| `KM8J33AL9MU282977` | SEL | [Pohanka Hyundai of Fredericksburg](https://www.pohankahyundaiva.com/search/used-2021-hyundai-tucson/?md=146&tp=used&yr=2021) |
| `KM8J3CAL8MU314690` | SEL | [Hyundai of Cool Springs](https://www.hyundaiofcoolsprings.com/auto/used-2021-hyundai-tucson-sel/127034883/) |
| `KM8J33AL5MU306000` | SEL | [Jeff Wyler Toyota of Clarksville](https://jeffwylerclarksvilletoyota.com/inventory/Used-2021-Hyundai-Tucson-SEL-KM8J33AL5MU306000-2890) |

## VW samples still awaiting an accessible lookup

The supplied `3VV2B7AX0MM120859` and these two additional dealer samples were **not submitted** because the parts-site verification remained unresolved. No new trim accuracy claim is made:

- `3VV3B7AX5MM061103`: SE, [Hendrick Volkswagen Frisco](https://www.hendrickvwfrisco.com/inventory/2021-volkswagen-tiguan-se-fwd-suv-3vv3b7ax5mm061103/).
- `3VV2B7AXXMM130914`: 2.0T SE, [Kelly Nissan of Route 33](https://www.kellynissanofroute33.com/vehicles/2021-volkswagen-tiguan-2-0t-se-np8100-3vv2b7axxmm130914).

## Confirmed app correction

`fromVpic` now rejects comma-separated choices as well as slash-separated choices and internal grade codes. It retains the original `trimHint`, leaves the trim editable, and allows the existing manufacturer fallback when supported. A secondary trim cannot override an ambiguous primary one. Clean `350 F Sport High` and `GT Coupe` strings remain unchanged. No new Ford/Hyundai/VW automatic lookup or Subaru cleanup is introduced.

Remaining research: capture Ford's actual VIN network requests and raw response fields in a browser with a network inspector; independently replay Toyota's same-origin request; obtain an accessible VW catalog session; gather multiple Subaru build-code examples before normalizing those codes.
