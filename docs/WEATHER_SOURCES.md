# Weather sources for rest-stop comfort (research, 2026-11-12/13)

Goal: hourly temperature, feels-like and humidity at rest stops, so users don't plan to rest in the car at a
dangerously cold or hot and humid stop; pollen and air quality where available. Owner's requirements: free only,
avoid Open-Meteo where a better source exists, **one primary and at most one fallback per data point**, and never
call a source in a country it doesn't cover.

Status: initial stay-window submenu implemented in 0.0.479. Candidate stops use estimated arrival/stay; added rests use their selected departure. Forecasts load on demand and reuse point records for 45 minutes. US comfort uses NWS, then AccuWeather for missing hours; elsewhere AccuWeather is available. Air uses the existing Open-Meteo/CAMS fallback. NWS alerts are US-only. Pollen uses AccuWeather, then TWC in the US; CA/MX pollen is not requested pending coverage validation. Missing coverage remains explicit. WU is deferred: its captured client key and fixtures are only on the owner's inaccessible Linux machine. The owner authorized hardcoding it when available; track this in TODO 61.

Validation: live NWS point/grid/hourly access checked from Windows; fixture tests cover parsing, units, clipping, fallback routing, caching and restrictions. The Accu endpoint returned 403 to a desktop request; Android uses its actual WebView user agent and reports refusals without bypassing them. Accu/TWC live phone payload validation remains open. UI uses the MIT layout patterns from j-labbe/weather-app-clone with Gasket fonts and original icons; license in THIRD_PARTY_NOTICES.md and assets/web/vendor/weather-layout-LICENSE.txt.

## How this was tested

Traffic captured on the Capture34 emulator (Android 14, mitmproxy, root CA), signed out, free tier, apps unmodified:
Real Weather 3.1.0, The Weather Channel 16.28.0, Weather Underground, AccuWeather 21.2.1. Then every candidate was
called natively from a desktop (plain HTTP client, no browser) at four public landmarks: Little Rock (Capitol),
Toronto (Queen's Park), Mexico City (Zócalo), London (Parliament). The captures, samples and test script live
outside the repo (`~/Development/weather-captures` on the owner's Linux machine) and are not committed: they
contain an app's static key and install IDs.

## Native results (2026-11-13)

| Call | US | CA | MX | UK |
|---|---|---|---|---|
| NWS gridpoint (`api.weather.gov/points` → `forecastGridData`) | 200, ~7.5 days: apparentTemperature, relativeHumidity, dewpoint | 404 | 404 | 404 |
| WU `v3/wx/forecast/hourly/15day` | 200, **360 h** | 200, 360 h | 200, 360 h | 200, 360 h |
| WU `v3/wx/globalAirQuality?scale=EPA` | 200 | 200 | 200 | 200 |
| WU `v3/alerts/headlines` | 204 | 204 | 204 | 204 |
| TWC `weather.com/api/v1/sdui` Hourly page | 200, 48 h | 200, 48 h | 200, 48 h | 200, 48 h |
| TWC sdui Today page `PollenForecastDaily` | 5 days | empty | empty | empty |
| AccuWeather `www.accuweather.com/api/hourly/{key}` | 200, 72 h | 200, 72 h | 200, 72 h | 200, 72 h |
| AccuWeather `api/lifestyle-indices` (pollen) | tree/grass/ragweed/mold 15 d | dust & dander only | dust & dander only | tree/grass/ragweed/mold 15 d |
| AccuWeather `api/air-quality` | 204 empty | 204 | 204 | 204 |

Notes:
- WU alerts 204 = no active alert at those points (not proven failure); non-US alert coverage is **unverified**
  until it's called where an alert is active.
- AccuWeather pollen missing in CA/MX may be the November off-season; re-check in spring before calling it a coverage gap.
- AccuWeather's web API was **not** refused by Akamai from a plain client, despite its `bm_sv` cookies in the app.
  Air quality returned empty natively (probably needs a cookie/parameter the app sends); not pursued, WU covers it.
- Rejected: **Real Weather** relays Apple WeatherKit through the developer's own server: only 49 free hourly
  hours, no pollen, no air quality. **WeatherKit** itself (bring your own key) has no pollen or air quality and its
  US alerts are relayed NWS: nothing unique for the default user. **TWC hourly** repeats WU (same Weather Company
  backend) with only 48 h. Paid tiers/trials were not touched.

## Approved-pending plan: primary → fallback

| Data point | US | Canada / Mexico | UK / elsewhere tested |
|---|---|---|---|
| Hourly comfort (temp, feels-like, humidity, dew point) | NWS → WU | WU → AccuWeather | WU → AccuWeather |
| Pollen | AccuWeather (15 d) → TWC sdui (5 d) | none: say "no pollen data" | AccuWeather → none |
| Air quality | WU → Open-Meteo/CAMS (current code) | WU → Open-Meteo | WU → Open-Meteo |
| Alerts | NWS (current code) → WU | WU → none | WU → none |

Open-Meteo stays only as the air-quality fallback (its CAMS data is the same model TWC/WU use). The current
`routewx.js` order (NWS `forecastHourly` → Open-Meteo NBM → Open-Meteo default) would become NWS → WU → AccuWeather
for comfort, by country.

## Request details

**NWS** (already used): `GET api.weather.gov/points/{lat},{lng}` → `properties.forecastGridData` →
`properties.{apparentTemperature, relativeHumidity, dewpoint, heatIndex, windChill}.values` (ISO interval series).
Needs a descriptive User-Agent. US only (404 elsewhere).

**Weather Underground / The Weather Company API**: `GET https://api.weather.com/v3/wx/forecast/hourly/15day?geocode={lat},{lng}&units=e&format=json&language=en-US&apiKey=<WU app key>`.
Headers seen: only user-agent + accept-encoding; no account or token. Column arrays: `validTimeUtc`, `temperature`,
`temperatureFeelsLike`, `temperatureHeatIndex`, `temperatureWindChill`, `temperatureDewPoint`, `relativeHumidity`,
`uvIndex`, `precipChance`, `precipType`, `qpf`/`qpfRain`/`qpfSnow`/`qpfIce`, `cloudCover`, `visibility`,
`windSpeed`/`windGust`, `wxPhraseLong`, `wxSeverity`. Same geocode/format/language params for
`v3/wx/globalAirQuality?scale=EPA` (`globalairquality.airQualityIndex`, `airQualityCategory`, pollutants) and
`v3/alerts/headlines`. **The key is the WU Android app's static key; it is not written in this repo.** Bundling it
in the APK makes it extractable, like the Chargeway/PlugShare client credentials (COMPLIANCE.md 0.0.256): owner decision.

**The Weather Channel sdui** (pollen fallback, US only): `POST https://weather.com/api/v1/sdui`, headers
`User-Agent: flagship/16.28.0`, `Content-Type: application/json; charset=utf-8`. Body:
`{"pageKey":"Today SubTab Page","appId":"twc-android-flagship","appType":"flagship","appVersion":"16.28.0","privacyRegime":"USA","viewedPlaceId":"","viewedGeocode":"<lat 2dp>,<lng 2dp>","deviceLanguage":"en-US","deviceLocale":"en_US","deviceOSType":"android","deviceClass":"phone","deviceDate":"YYYY-MM-DD","upsxIsRegistered":false,"premiumSubscriptions":[],"upsxUnitsPreference":"e","enabledFeatures":{},"overrideParams":{"stormbreakerUsername":""},"metrics":{},"savedPlaceIds":[],"recentPlaceIds":[]}`.
No key or token. The ~240 KB response is a UI tree; walk it for dict keys `PollenForecastDaily` and
`FiveDayPollenIndex` whose value is a list `[{response: …}]` (TWC v3 column arrays: `PollenForecastDaily` has
`validTimeUtc` plus total/grass/tree/weed counts, risk and index; `FiveDayPollenIndex.response.pollenForecast12hour`
has tree/grass/ragweed index + category per 12-hour daypart). Fragile: the page layout can change without notice.

**AccuWeather web API** (pollen primary, comfort fallback): same-site JSON used by the app's WebView.
1. `GET https://www.accuweather.com/api/resolve-current-location` with cookies
   `awx_current_location=%5B{lng}%2C{lat}%5D; awx_user_subscriptions=%5B%22none%22%5D; awx_partner=accuweather`,
   headers: a mobile Chrome user-agent, `Accept: application/json`, `X-Requested-With: com.accuweather.android`,
   `Referer: https://www.accuweather.com/app/today`. The location key comes back in the `awx_current_location_key`
   Set-Cookie (Little Rock 326862). Cache keys by rounded coordinates.
2. `GET /api/hourly/{key}?isEvent=false&lang=en-US` → list of 72 hours (temperature, RealFeel, RealFeel Shade,
   heat index, dew point, humidity, wind/gust, precipitation probabilities/amounts, UV).
3. `GET /api/lifestyle-indices?lang=en-US&locationKey={key}` → `lifestyleIndices.Allergies[]`
   (`indexName` Tree Pollen / Grass Pollen / Ragweed Pollen / Mold / Dust & Dander, `days[]` 15 daily values 0–10 + category).
Keep the cookie jar per session. Not tested from a phone: watch for Akamai refusals (418/403) and treat them as
"source unavailable → fallback", never retry around a check.

## Before shipping

- Owner approval of the plan and of bundling WU's app key.
- COMPLIANCE.md entry (#18): all three are unofficial, undocumented, can change or refuse at any time.
- Per-country routing table in code (NWS US only; AccuWeather pollen only where its `Allergies` list has pollen
  types; TWC pollen US only).
- Re-verify WU alerts with an active non-US alert; re-check AccuWeather/TWC pollen coverage in spring.
- Cache like `weathernet.js` (per rounded point + query day + horizon), bounded concurrency, cooldown on refusal.
- Rest-stop integration (owner's next step): comfort at each rest site's local arrival-to-departure window.
