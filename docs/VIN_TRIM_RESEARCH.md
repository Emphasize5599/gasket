# Signed-out VIN-to-trim research

## 2026-11-16 follow-up (0.0.484): network-level results

Environment: Android emulator Capture34 (Android 14, Chrome 113 user agent, unmodified), traffic through mitmproxy on the owner's Linux machine, signed out, residential connection. The owner completed the Cloudflare checks on parts.subaru.com, parts.kia.com and parts.vw.com by hand; nothing was solved automatically. No credentials were entered. VINs are public dealer-listing VINs (the owner's own VIN is not used here). Raw responses were read from the capture, not just the page.

### Coverage

| Group / brand | Result | Class |
|---|---|---|
| Toyota, Scion, Lexus | Existing 0.0.477 parts-catalog lookup; not retested here | Verified useful (earlier batch) |
| Subaru | parts.subaru.com VIN lookup named the listing's trim on 6/6 VINs | **Verified useful** (integrated 0.0.484) |
| Kia | parts.kia.com VIN lookup named the listing's trim on 6/6 VINs; resolves vPIC's "FE, LXS" | **Verified useful** (integrated 0.0.484) |
| Ford | Parts store and support page raw answers carry no trim/series/package; window sticker = placeholder for 2019–2020 VINs | Accessible, no trim |
| Lincoln | Not tested separately | Not yet tested |
| Volkswagen | parts.vw.com returns every possible trim for a VIN (SE / SEL / SE R-Line Black, AWD and FWD) | Accessible but ambiguous |
| Audi, Mazda | Same store platform as Subaru/Kia (parts.audiusa.com, parts.mazdausa.com: Cloudflare from Linux); no VINs submitted | Not yet tested |
| Hyundai | parts.hyundaiusa.com does not resolve (DNS) from Linux or the emulator; owner portal needs sign-in (earlier) | Blocked / needs sign-in |
| Genesis | parts.genesis.com did not resolve | Not yet tested |
| Nissan, Infiniti, Mitsubishi | Store hosts answer 403 to Linux; not opened in the emulator | Not yet tested |
| Honda, Acura, BMW, MINI, Mercedes-Benz, Volvo, Polestar, JLR, Porsche | No reachable official parts host found from Linux; not opened in the emulator | Not yet tested |
| GM, Stellantis | Earlier samples: vPIC trims usually clean; no OEM lookup researched | Not yet tested |
| Tesla, Rivian, Lucid | Not researched | Not yet tested |

### Ford / Lincoln (priority 1)

| Source | Endpoint and access | VINs | Returned | Recommendation |
|---|---|---|---|---|
| Ford parts store (manufacturer) | `https://www.ford.com/parts` Select Vehicle → VIN. The page calls a Next.js server action: `POST https://www.ford.com/parts` with header `Next-Action: 7fa979ab94dd3c248cc960278028cf3c4538102a7e` (build-specific), `Accept: text/x-component`, body `["<VIN>"]`, page cookies present (Akamai). Signed out. | `1FA6P8CF8K5178450` (listed GT Premium) | Raw: `{"vin":…,"make":"Ford","model":"Mustang","year":"2019","drive":"2WD","engine":"5.0 Gas","transmission":"Automatic","buildDate":"03/29/2019"}` | No trim, series, equipment group or package in the raw answer. Not usable for GT vs GT Premium. |
| Ford owner support (manufacturer) | `GET https://www.ford.com/support/vehicle/vin/<VIN>` (server-rendered RSC) | same | Page data: `displayName "Mustang"`, year, SYNC generation (`GEN3`, SYNC3 v3.4), vehicle image `build.ford.com/dig/direct/HD-TILE/Vin[<VIN>]/EXT/4/vehicle.png` | No trim. SYNC 3 hints at equipment but isn't a trim decode. |
| FordDirect window sticker | `GET https://www.windowsticker.forddirect.com/windowsticker.pdf?vin=<VIN>` (Linux, no cookies) | `1FA6P8CF8K5178450`, `1FA6P8CF3K5152564`, `1FTEW1E49LFA08332`, `1FTEW1E44LKD08643` | HTTP 200 `application/pdf`, 1,650,766 bytes, identical for all four: "The window sticker has not yet been released for this vehicle." | Not available for these model years. Newer VINs untested. |

A direct replay of the server action from Linux was refused by this session's safety check and was not retried; the emulator capture above is the evidence. Lincoln was not tested.

### Subaru / Kia / VW store platform (reproducible request)

The stores' VIN box makes this same-origin request with the page's cookies (Cloudflare `cf_clearance` after the user's check):

```http
POST https://parts.subaru.com/wm.aspx/CreateVinLinks
Content-Type: application/json;charset=UTF-8
Accept: application/json, text/plain, */*

{"VinNumber":"<VIN>","AbsolutePath":"%252Fdefault.aspx","QueryString":""}
```

Answer: `{"d":"[{\"vehicleDescription\":\"2021 Subaru Outback 2.5L CVT Limited\",\"vechicleHref\":\"/Subaru_2021_Outback-25L-CVT-Limited.html\"}, …]"}` (`d` is a JSON string). Gasket runs it from the store's own page (`assets/oemvin_worker.js`, `store: 'simplepart'`) and takes the words after the engine size, minus transmission / drive / door / body words and "w/…" equipment (`TrimMath.descTrim`). Every description must agree.

| VIN | Listing (source) | Store answer | vPIC Trim |
|---|---|---|---|
| `4S4BTANC5M3183887` | 2021 Outback Limited (handoff) | Outback 2.5L CVT **Limited** / 2.5L Limited | `Limited+M/R+NAVI(HK)` |
| `4S4BTACC9M3110945` | 2021 Outback Premium ([Ourisman](https://www.ourismancars.com/2021/Subaru/Outback/4S4BTACC9M3110945/)) | **Premium** ×2 | `Premium` |
| `4S4BTACC2M3179461` | 2021 Outback Premium ([Subaru of Rochester](https://www.subarurochester.com/inventory/used-2021-subaru-outback-premium-all-wheel-drive-sport-utility-4s4btacc2m3179461/)) | **Premium** ×2 | `Premium` |
| `JF2SKARC1MH581720` | 2021 Forester Sport ([Bud Clary](https://www.budclary.com/inventory/used-2021-subaru-forester-sport-awd-4d-sport-utility-jf2skarc1mh581720/)) | **Sport** w/EyeSight ×2 | `Sport` (Trim2 `ES+HK+SMART`) |
| `JF2GTACC4K8385196` | 2019 Crosstrek 2.0i Premium ([Balise](https://www.baliseauto.com/used-Springfield-2019-Subaru-Crosstrek-20i+Premium+CVT-JF2GTACC4K8385196)) | **Premium** | `Premium` |
| `JF2GTADC9K8301775` | 2019 Crosstrek Premium ([Capital One](https://www.capitalone.com/cars/vehicle-details/2019/Subaru/Crosstrek/Premium/JF2GTADC9K8301775)) | **Premium** | `Premium +BSD` |
| `5XYRG4LC8MG024935` | 2021 Sorento LX ([Huffines](https://www.huffines.net/used/Kia/2021-Kia-Sorento-6325877dac184b11b2d29e4f7b27e6bd.htm)) | Sorento 2.5L AT **LX** | `LX` |
| `5XYRG4LC6MG025307` | 2021 Sorento LX ([Clay Cooley](https://www.claycooley.com/vehicle/5XYRG4LC6MG025307/Used--2021--Kia--Sorento--Irving--TX)) | **LX** | `LX` |
| `3KPF24AD4LE246350` | 2020 Forte LXS ([CarPro](https://www.carpro.com/inventory-search-results/used-2020-kia-forte-carson-ca-1n23568a)) | Forte 2.0L AT **LXS** | `FE, LXS` |
| `3KPF24AD7LE239392` | 2020 Forte LXS ([Westlake](https://autoloan.westlakefinancial.com/car/ks/mission/2020-kia-forte-lxs/5515f199-858d-4c2b-c35a-08ded34c9c62)) | **LXS** | `FE, LXS` |
| `KNDPM3AC6M7890773` | 2021 Sportage LX ([Westlake](https://autoloan.westlakefinancial.com/car/ks/shawnee/2021-kia-sportage-lx/ad3c059c-e208-448b-56c0-08de95360717)) | Sportage 2.4L AT 4 DOOR **LX** | `LX` |
| `KNDP6CAC1M7856881` | 2021 Sportage S ([Ridemotive](https://daca0.app.ridemotive.com/inventory/Used-2021-Kia-Sportage-S-KNDP6CAC1M7856881)) | Sportage 2.4L AT 4WD 4 DOOR **S** | `S` |
| `3VV2B7AX0MM120859` | 2021 Tiguan, unresolved (handoff) | six: AWD/FWD × SE / SEL / SE R-Line Black | `4Motion SE, SE R-Line Black, SEL` |
| `3VV3B7AX5MM061103` | 2021 Tiguan SE (Hendrick VW Frisco) | same six | `SE, SE R-Line Black, SEL` |
| `3VV2B7AXXMM130914` | 2021 Tiguan 2.0T SE (Kelly Nissan) | same six | `4Motion SE, SE R-Line Black, SEL` |

Subaru vPIC adds option codes after "+" ("Premium +BSD", "Limited+M/R+NAVI(HK)"); 0.0.484 treats a Subaru vPIC trim containing "+" as unclear so the catalog is asked. The Kia and Subaru samples cover one or two model years each; other models and years may describe themselves differently, and an unreadable or disagreeing description keeps the trim editable.

---

## 2026-11-13 browser session (0.0.478)

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
