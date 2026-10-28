# Changelog

Gasket (formerly **Fuel+ Map**). Version names follow `0.0.<versionCode>` (see `VERSIONING.md`).
The old name each build shipped under is in brackets, e.g. `0.0.46 [3.25]`.
Dates are when each build's source was archived (America/Chicago).

## 0.0.300 - 2026-10-28
- Repair rest-stop additions, cached fuel planning and departure-time review.
- Keep completed speed graphs from restarting queued calculations.

## 0.0.299 - 2026-10-28
- Keep adding rest stops without restarting route planning or repeating all hazard approvals.
- Correct rest timing after fuel stops and improve added-stop management.
- Bug fixes.

## 0.0.298 - 2026-10-28
- Map-first hourly hazard review with standard hazard cards, route colors and expandable details.
- Bug fixes.

## 0.0.297 - 2026-10-28
- Keep added rest stops manageable when no new sites qualify.
- Bug fixes.

## 0.0.296 - 2026-10-28
- Expanded setup: traffic readers, rest stops, trip defaults, hazard approval and data downloads. Traffic energy defaults on.
- Shared discovery queue for approved routes and clearer planning failure explanations.
- More patient spare lookup and improved NHTSA/HERE recovery.
- Bug fixes.

## 0.0.295 - 2026-10-28
- Faster screening of promising trips.
- Independent rest-stop detour limit and clearer explanations when no stops qualify.
- Show/hide buttons for API keys in Settings and onboarding.
- Bug fixes.

## 0.0.294 - 2026-10-28
- Add rest stops casually: minimum rest and parking permission only, a rough added time, no trip restart; fuel stops update in the background. Remove a rest the same way.
- Calculate rest timing: choose each departure on a traffic-colored slider (green free flow, yellow within your tolerance, red beyond it but still choosable, gray unknown), then review all rests together. Only new or changed road conditions are asked about afterwards.
- Rest-stop sources get their own radius sliders (up to 50 miles by default, adjustable maximum).
- Stations found by the faster result-page reader are now remembered, so later trips don't re-read those areas. Traffic forecasts are kept longer and the status shows which route is being read and the time left.
- Bug fixes.

## 0.0.293 - 2026-10-28
- Faster regular-fuel discovery using result-page commands, with scrolling fallback.
- Adjustable Google traffic readers: RAM-based default, up to 50.
- Includes the rest-stop fixes from292 and updates the Settings regression check.

## 0.0.292 - 2026-10-28
- Separate indented rest-stop lists, clearer expandable tiles, and quieter stop details.
- Configure each rest source and its supported filters in Settings.
- Fix Ardsley Maps matching; check rest-stop road detours and log incomplete searches.

## 0.0.291 - 2026-10-27
- Per-leg rest-stop lists with source labels, external Maps links and green add buttons.
- Editable details for places without a matched Maps page; rest time is confirmed before adding.
- Resolves release checks that prevented289 and290 APKs from being published.

## 0.0.290 - 2026-10-27
- Includes the per-leg rest-stop menus, source labels and green add buttons from289.
- Fixes the Android Maps reader integration;289’s build stopped before publishing an APK.

## 0.0.289 - 2026-10-27
- Rest stops are listed in a separate submenu for each leg, with the source beneath each name.
- Open matched Google Maps places externally, or tap the green + to choose rest time before adding.
- Places without a matched Maps page have editable details and a mapped-data lookup.
- Bug fixes.

## 0.0.288 - 2026-10-27
- Choose an earlier departure within your whole-trip traffic-delay allowance instead of always waiting for the quietest hour.
- Rest stops open a place view with illustrated surroundings, available photos, amenities and local arrival times.
- Visitor-center and store opening hours no longer stand in for parking hours.
- Bug fixes.

## 0.0.287 - 2026-10-27
- Rest stops show local arrival dates and times beside “Since stop,” including the timezone.
- Reported opening hours flag closed sites and exclude stays that cross a closure. Missing or complex hours remain unverified.
- Bug fixes.

## 0.0.286 - 2026-10-27
- Flexible-time planning leaves later when a trip would reach a destination before its arrival window, instead of rejecting it, and says exactly which window a trip missed.
- After flexible-time planning finds nothing, the app no longer starts ordinary planning (and its traffic lookups) on its own.
- Bug fixes.

## 0.0.285 - 2026-10-27
- Rest stops are now the first card in Stops: every rest area, campground and store along the whole route, numbered in green in route order, with driving time since the last stop and in total. Searched area by area like gas stations, so other trips reuse it.
- Google traffic forecasts keep the stretches they match instead of failing the whole trip, and no longer re-ask stretches Google routes differently.
- Flexible-time planning can start inside the current hour and says why checked trips were set aside.
- Bug fixes.

## 0.0.284 - 2026-10-27
- Traffic forecasts without a key: future traffic comes from Google Maps' own typical-traffic answer, matched road by road. HERE traffic is now opt-in (tolls unchanged).
- Rest stops: find rest areas, campgrounds and other places to stop along a trip, check parking rules and timing, and add one as a stop.
- Download Recreation.gov's federal campgrounds once in Settings → Trip defaults, so rest planning has them on hand.
- Bug fixes.

## 0.0.283 - 2026-10-27
- Add an optional experimental traffic-energy model in Settings → Trip defaults: stop/go fuel use, EV cabin loads and cold-start estimates.
- Bug fixes: correct HVAC warm-up accounting, carry cabin state through charging, and keep closed trips closed when changing traffic settings.

## 0.0.282 - 2026-10-27
- Restore ExxonMobil discount checks after its website moved; large batches continue without losing completed areas.
- Keep usable HERE traffic spans when individual speeds are missing. Disable HERE traffic independently of tolls in Settings → Connections.

## 0.0.281 - 2026-10-27
- Traffic forecasts now apply on long trips: HERE's forecast is used wherever it follows your route, and only the stretches where it takes other roads (often the first block from your start) use normal route times. Route says how much of the trip the forecast covers, or why it wasn't used.

## 0.0.280 - 2026-10-26
- One shared Cost/Time priority per vehicle across windows, Routes and comparison; automatic adjustment is a separate toggle.
- Time-first planning can allow paid tolls with an optional per-leg or whole-trip budget. Unknown prices cannot satisfy a cap.

## 0.0.279 - 2026-10-26
- Time-window planning screens hourly options and fully plans promising trips instead of exhaustively optimizing every combination.
- Hazard-focused review, required enabled time windows, derived return times, and missing air-quality notices in Stops.

## 0.0.278 - 2026-10-26
- Consistent automatic hazard approval when revisiting candidates or recovering forecast data through a fallback.
- Shows why manual review is needed and separates candidates with different forecast coverage.

## 0.0.277 - 2026-10-26
- Keeps hourly weather reading responsive, reuses route geography and cached forecasts, and shows progress within each hour.
- Adds hourly-reading diagnostics and makes cancellation stop queued work.

## 0.0.276 - 2026-10-26
- Hourly planning reuses leg forecasts and rejects impossible timing combinations before costly stop optimization.
- Clarified route/hour candidate counts and arrival-window search bounds.

## 0.0.275 - 2026-10-26
- Faster failure recovery for Exxon/Mobil discount checks, preserving completed results.
- Simplified traffic settings and fixed bottom buttons for road/time screening.
- Optional automatic approval of hourly candidates based on your chosen hazard exclusions.

## 0.0.274 - 2026-10-26
- Flexible trip timing: give a window to leave in (or to arrive in), and choose lowest cost or shortest time. The app first asks which roads you'd take in clear weather, then shows each road's forecast hour by hour (hours that look the same share a screen) for a yes or no. It checks every approved road and hour, with your stops and any waits at your destinations, and Departure tells you when to leave and which route to take on each leg.
- Bug fixes.

## 0.0.273 - 2026-10-26
- Unavailable traffic forecasts no longer block hazard checks, comparison or trip planning. Normal route estimates remain available and are labeled.
- Departure exploration keeps arrival deadlines optional and reports the actual forecast failure. Rejected lookups are briefly remembered to avoid repeated HERE calls; explicit exploration retries can try again.

## 0.0.272 - 2026-10-26
- Optional HERE traffic forecasts now inform route timing and energy estimates, with shared usage limits and reusable forecasts.
- Explore departure windows on traffic-colored sliders with added driving minutes at major points. Choose outbound and return times separately, or compare the whole immediate round trip.

## 0.0.271 - 2026-10-25
- The Walmart+ check for Exxon and Mobil stations works again: ExxonMobil's station finder refused the app's requests, so it's now asked from a hidden exxon.com page, a few areas at a time. If ExxonMobil asks for a check, the usual banner opens it, and finishing it retries the areas that failed.
- Bug fixes.

## 0.0.270 - 2026-10-25
- Searched areas are always reused: every later trip, car and fuel grade uses the stations found in an area searched before (no more re-searching after a week, or for a car on another grade). Only areas never searched are read; Rediscover still searches everything again.
- Stations found just across an area's edge come back when the area is reused, instead of dropping out of later trips.
- Reusing hundreds of searched areas takes seconds instead of over a minute.
- Bug fixes.

## 0.0.269 - 2026-10-25
- Same as 0.0.268 (whose APK build stopped on a test timing problem; no app change).

## 0.0.268 - 2026-10-25
- Comparisons have an "Update prices first" switch. Turn it off and every queued vehicle plans with the stations and prices already saved with the trip, with no price websites read.
- Tapping ✕ while a comparison is updating prices now skips the rest of the update and still finishes that vehicle's trip (and the rest of the batch) with the saved prices. Before, it stopped the trip with "Station discovery did not finish".
- Gas price checks are remembered between runs on the phone again: a refresh no longer re-reads every older price minutes after the last one checked them.
- Bug fixes.

## 0.0.267 - 2026-10-25
- EVgo prices come from EVgo again: its station-detail lookup was refused only because Gasket's request didn't identify itself the way EVgo's app does. Gasket now sends the same app identification, so EVgo stations get EVgo's own per-charger prices. The one-day "EVgo needs a signed-in account" skip from 0.0.266 is removed; Chargeway / PlugShare remain the fallback.

## 0.0.266 - 2026-10-25
- EVgo diagnosis: EVgo doesn't let guest accounts read station details (the token refresh can't fix that), so the app now says so, logs EVgo's refusal reason, and goes straight to Chargeway / PlugShare for EVgo prices for a day instead of retrying every plan.

## 0.0.265 - 2026-10-25
- Searched areas are now actually remembered and shared: a gas station search done for one car, trip or the map is reused by the next instead of scanning the whole route again (searched areas are re-checked weekly; prices still refresh as usual).
- In a multi-car comparison, each gas car reuses the trip's saved gas stations even when an EV planned last.
- Charger tariff lookups remember when a station has no published guest-app price, so later plans don't ask again for 6 hours.

## 0.0.264 - 2026-10-25
- EV charging stops follow the car's charging curve: Fastest plans charge low in the battery and stop more often when that's quicker, charging higher only to cross long gaps, instead of assuming every kWh charges at one average speed.
- Bundled charging curves for 346 EVs from Open EV Data, matched to your car; otherwise a typical curve scaled to its peak. The car editor shows the curve as a graph and lets you type your own kW at each charge level.
- A more realistic (steeper) generic charging curve.

## 0.0.263 - 2026-10-25
- Show Tesla Model 3 / Model Y "Long Range" as "Premium" for 2026 and later (the EPA's names and IDs are kept underneath); Fuel API photos match either name and Tesla photos try Fuel API before Commons.
- Fill in an EV's fastest DC charging rate from Brave Search's answer when it's blank, with That's right / See Brave's answer; a typed number is never replaced and a new trim asks again.

## 0.0.262 - 2026-10-24
- Search Tesla photos by base model, including Model Y Long Range RWD → Model Y.
- Use Fuel API's newest available image year when the requested year is missing; retain rotation and label the source year without changing the car's configuration.
- Broaden Commons model searches and Tesla photo choices across model years.
- Keep saved vehicle identity fields editable and update open dropdowns when choices finish loading.

## 0.0.261 - 2026-10-24
- Share remembered stations and completed scan areas across trips and the map in persistent app storage; separate price updates from rediscovery.
- Reuse overlapping charger discovery and cached vehicle-specific prices; avoid redundant DOE searches with downloaded inventory.
- Give Brave's AI answers 25 seconds and distinguish exterior rear-mounted spare tires.
- Add left/right Fuel API vehicle views in the car editor.

## 0.0.260 - 2026-10-24
- Reuse completed station-price checks across comparison vehicles; avoid repeating unchanged or failed lookups.
- Add “Routes that would work” to failed EV comparison cards and retain checked alternatives when switching cars.
- Choose each vehicle’s planning priority in Route or below its comparison buttons.

## 0.0.259 - 2026-10-24
- Allow charging above the preferred 80% when needed in Cheapest overall mode; show the required charge level and include charging time.
- Refresh expired guest-source authentication once, then pause denied sources and try existing EVgo price fallbacks.

## 0.0.258 - 2026-10-24
- Guest-source confirmation, onboarding key guides and targeted ChargePoint retries from 257, with cancellation-safe stop rebuilding.

## 0.0.257 - 2026-10-24
- Confirm before enabling guest-app EV prices, in Settings and onboarding.
- Add all five optional API keys to onboarding, with expandable setup instructions and provider links.
- Retry failed ChargePoint pages without rescanning stations or discarding successful cached prices.

## 0.0.256 - 2026-10-23
- Optional native guest prices for EA, EVgo and ChargePoint, plus Chargeway/PlugShare coverage for Walmart EV, Mercedes HPC and bp pulse.
- Separate straightforward and experimental tariffs; networks without reliable price readers cannot be selected.
- Preserve connector/charging-level matches, reuse cached tariffs, recheck arrival-time prices and include known session fees. Unresolved prices remain labeled estimates or excluded.

## 0.0.255 - 2026-10-23
- Charger prices from two more networks' public websites: Electric Era and Francis Energy. Both are now listed with the readable networks and on by default.

## 0.0.254 - 2026-10-23
- Comparison batch: a vehicle's "Needs review" note clears once its setup and hazards are reviewed.
- Status bar: opening or closing the other statuses keeps an expanded status message open.

## 0.0.253 - 2026-10-23
- Move batch planning/cancellation to the footer and highlight every vehicle needing review before launch.
- Show an overall batch-time estimate and expand background task lists to the full width.
- Reuse shared station caches and refresh expired batch prices using configured age limits.

## 0.0.252 - 2026-10-23
- Queue vehicles before Adjustments, with background planning and completion/website-check notifications.
- Add adaptive, cache-aware stage estimates and targeted website retries.
- Preserve comparison approvals when switching cars and combine repeated price-age warnings.

## 0.0.251 - 2026-10-23
- Improve ChargePoint price parsing, cached-price reuse and retry backoff.
- Add automatic lowest-cost or shortest-total-time planning, including buffer and detour adjustments while keeping speed settings.

## 0.0.250 - 2026-10-23
- Improve ChargePoint tariff parsing and reuse cached prices; avoid immediately retrying failed pages on overlapping routes.
- Add optional automatic lowest-cost or shortest-total-time planning after hazard approval. Adjust buffer and detour without changing speed settings, then go directly to Stops.

## 0.0.249 - 2026-10-23
- Reduce saved-trip duplication to fix failures when accepting workable EV routes; preserve cached prices across alternatives and vehicles.
- Offer a DOE charger-location download on the first EV trip.

## 0.0.248 - 2026-10-23
- Apply the CPU/GPU setting to both models and show the small model's actual backend.
- Try additional supported WebGPU adapters, including compatibility mode; verify GPU warm-up before use, with CPU fallback.

## 0.0.247 - 2026-10-23
- Make recall rating resilient on CPU: smaller batches, preserved progress and bounded retries.
- Show completed recall counts and explicit retry controls instead of endless rating indicators; expand inference diagnostics.

## 0.0.246 - 2026-10-23
- Search the full 30-minute detour window once; accept 1.0–30.0-minute limits in tenths. Tesla and Mirai demos default to 30 minutes.
- Protect saved trips with atomic writes, checked save results, smaller inventories and storage diagnostics.
- Confirm failed speed previews with the full planner and explain when no green balance band exists.

## 0.0.245 - 2026-10-23
- No APK: the release gate caught an outdated slider-index test. Corrected in 0.0.246 without changing the selected-minute behavior.

## 0.0.244 - 2026-10-22
- Reuse saved EV/H2 route prices after reopening, retaining searched alternatives and original price timestamps.
- Show a gas-style energy-use curve with diagonal lines and separate lowest-energy/lowest-cost tested choices.

## 0.0.243 - 2026-10-22
- Startup loading screen, readiness stages and timing diagnostics; preserve Android edge-to-edge layout.
- Clarify the speed graph’s zero baseline, steps and whole-trip scale; log exact sample values.
- No APK was published for 0.0.242.

## 0.0.242 - 2026-10-22
- Show startup readiness before browser initialization, with loading stages, retry on failure and timing diagnostics.
- Clarify the speed graph’s whole-trip scale, zero baseline and connected steps; avoid crowded ticks and log the underlying samples.

## 0.0.241 - 2026-10-22
- Driving-time savings versus charging/refueling time, with per-road speed controls and trip cost changes.
- Stabilize the existing AI-notice regression check. No APK was published for 0.0.240.

## 0.0.240 - 2026-10-22
- Compare driving minutes saved against extra charging/refueling minutes per speed increase, with trip energy-cost changes.
- Adjust individual roads or all roads; retain route-specific choices and reuse cached graphs without station lookups.
- Account for stop overhead and scheduled waits when highlighting faster trips; retain hourly energy inputs during forecast refreshes.

## 0.0.239 - 2026-10-22
- Check EV alternatives with the same hourly weather and speed limits used after acceptance; retain the validated plan during hazard review.
- Avoid repeated web-price passes during cached route projection and keep large station-processing loops responsive.
- Support EV/hydrogen speed lookups without turn instructions; show a failed recalculation instead of outdated successful stops.

## 0.0.238 - 2026-10-22
- Graph EV/hydrogen speed against energy cost and driving/stop time; honor default speed rules and caps.
- Let ChargePoint recover from automatic checks/loading before requesting verification; improve station-page opening and scheduled-rate parsing.
- Fix completed speed-limit loading bars and retain current vehicle review when switching to an approved alternative.

## 0.0.237 - 2026-10-22
- Weather-aware EV energy and charging estimates, with separate stored/billed electricity and optional measured Model 3 LFP profile.
- Compare slower speed caps using saved stations; hydrogen speed estimates remain explicitly unvalidated.
- Show the selected menu’s full title at every screen width, with compact numbered navigation.
- Corrected charging power budgets, forecast timing and reference regeneration accounting; added numerical and UI regressions.

## 0.0.236 - 2026-10-22
- Compare vehicles for the same trip: independent setup/routes, whole-trip or per-leg costs and estimated time.
- Edit vehicles and return to Compare; select completed plans without rescanning.
- Corrected the release checks for the new Compare step. No APK was published for 0.0.235.

## 0.0.235 - 2026-10-22
- Compare vehicles for the same trip, with independent setup, routes and whole-trip/per-leg summaries.
- Compare energy used, known tolls and estimated travel/refueling time; select a completed plan without rescanning.
- Edit or add vehicles from Compare; compatible edits recalculate from cached prices and require setup/hazard review.

## 0.0.234 - 2026-10-21
- Smooth hydrogen coverage boundaries.
- Fixed gas price labels appearing in EV and hydrogen modes.
- Use precise NWS warning zones instead of spreading mountain warnings across whole counties.

## 0.0.233 - 2026-10-21
- Smooth zoom sizing for station dots, routes and selected-road highlights.
- Fixed main-map hydrogen/EV stations and hydrogen coverage leaking into trips.

## 0.0.232 - 2026-10-21
- Estimated refueling time for gas, diesel and hydrogen stops, with trip and per-leg totals.
- Include refueling time in route comparisons and arrival estimates.

## 0.0.231 - 2026-10-21
- Faster fuel-stop planning and slider calculations; prioritize interactive adjustments.
- Reuse overlapping speed-limit requests and begin alternative-route lookups earlier.
- Fixed alternative-route fuel models retaining the previous vehicle's economy.

## 0.0.229 - 2026-10-21
- Removed the remaining Google-key warning from EV cruising-speed settings.
- Bug fixes.

## 0.0.228 - 2026-10-21
- Reuse completed EV price scans after accepting a feasible route.
- Whole-trip and per-leg summaries on Depart.
- Bug fixes.

## 0.0.227 - 2026-10-21
- Fixed feasible EV routes being missed when charger prices were already cached or learned on another route.
- Bug fixes.

## 0.0.226 - 2026-10-21
- Reuse completed charger searches when switching routes, and offer routes that meet your charging settings.
- Split long Google Maps navigation into balanced, clearly labeled links.
- Bug fixes.

## 0.0.225 - 2026-10-20
Debug diagnostics build.

- Removed experimental AI rendering; added a brief, dismissible flicker-workaround tip when larger GPU AI work starts.
- Visual glitch marker is now an optional debug setting, off by default.
- System traces recorded on the phone (Developer options → System Tracing) now show when the larger AI loads and generates.
- Bug fixes.

## 0.0.224 - 2026-10-20
Debug diagnostics build.

- Experimental AI graphics compatibility mode, enabled by default with an off switch in Local AI settings.
- Bug fixes.

## 0.0.223 - 2026-10-20
Debug diagnostics build.

- Queued local AI explanations reuse one engine briefly, with fresh conversations and bounded memory retention.
- Bug fixes.

## 0.0.222 - 2026-10-20
Debug diagnostics build.

- Queued local AI explanations reuse one engine briefly, with fresh conversations and bounded memory retention.
- Bug fixes.

## 0.0.221 - 2026-10-20
Debug diagnostics build.

- Expanded visual and local AI diagnostics, with a “Mark visual glitch” button and richer shared logs.
- Bug fixes.

## 0.0.220 - 2026-10-20
- EV planning prefers recently checked prices, with a global freshness setting. Unknown prices and unsupported networks are opt-in; hotel/dealership chargers have their own group.
- Public FLO tariff and connector lookups.
- Bug fixes.

## 0.0.219 - 2026-10-20
- Local AI runs on the GPU again; the CPU is only an emergency fallback when the GPU won't start, and the app says when that happened.
- Recall ratings try the GPU too (WebGPU, when the phone's WebView offers it) and no longer fight the larger model for the processor.
- Bug fixes.

## 0.0.218 - 2026-10-20
- Gasket no longer needs a Google key: everything from the keyless test app (website station and price discovery, approximate routes without a key, EV and hydrogen trips with network prices, hazards along the route, tolls, the garage's tires and climate, local AI tire explanations) is now Gasket itself, on main.
- Coming from Gasket Keyless Test: save a full backup there (Settings → Data & privacy) and restore it here. Download the offline charger data and the optional AI model again; they aren't in backups.
- Bug fixes.

## 0.0.217 - 2026-10-20 (keyless test branch only)
- AI stability recovery: stock runtime, temporary CPU-only mode, non-blocking cancellation and protection against repeated startup failures.
- Better crash and memory diagnostics.
- Bug fixes.

## 0.0.216 - 2026-10-20 (keyless test branch only)
- Lower-priority GPU AI execution to reduce interference with the phone's display; CPU-only mode remains available.
- Bug fixes.

## 0.0.215 - 2026-10-20 (keyless test branch only)
- Optional CPU-only AI mode and rendering diagnostics to investigate screen flicker during local AI work.
- Bug fixes.

## 0.0.214 - 2026-10-20 (keyless test branch only)
- ChargePoint prices use the correct station IDs, include service-fee information, and pause for detected website checks.
- Bug fixes, including screen jumps between queued AI explanations and invalid prices being treated as free.

## 0.0.213 - 2026-10-19 (keyless test branch only)
- The offline charger download's progress only moves forward, and its status row goes away when the download finishes.
- Offline charger data now works on long trips (it said "Charger area too large").
- ChargePoint prices: stops trying after a few station pages that don't load, instead of spending minutes on them.

## 0.0.212 - 2026-10-19 (keyless test branch only)
- EV trips: choose the charging networks you use (Parameters → Charging stops). Networks Gasket reads prices from come first; the others, including car dealerships and Tesla Destination chargers at hotels (often listed as free but usually for customers or guests), are dimmed but can still be chosen.
- Getting charger prices from the networks shows the time left and moves steadily, and Tesla prices load about twice as fast.
- Departure's summary tiles keep their text centered.

## 0.0.211 - 2026-10-19 (keyless test branch only)
- EV trips also read ChargePoint stations' prices from their public station pages (each host's rate, fees, or free), up to 20 stations a trip, fast chargers first.

## 0.0.210 - 2026-10-19 (keyless test branch only)
- EV trips read charging networks' own published prices: Tesla Superchargers (the Tesla-owner or non-Tesla rate, peak time of day), IONNA, and Blink (each charger's host-set rate and session fee). Other chargers use the government's price notes or the route's typical rate as before. Settings → Connections can switch it off.

## 0.0.209 - 2026-10-19 (keyless test branch only)
- EV charging prices: more of the chargers' published prices are read (time-of-day and membership prices, ranges, hourly rates), and chargers with no published price use the typical rate of the chargers on your route instead of one fixed guess.
- The charge already in your battery is valued at that same typical rate, unless you type your own. A gas price you entered is no longer used for a battery or hydrogen tank.
- When you get there: its choices sit side by side with wrapping text, "At least one of my destinations will have a charger" is chosen by default for EVs, and its (?) explains all three.
- Departure's trip summary tiles stay on one row. The demo Tesla starts at 80%.

## 0.0.208 - 2026-10-19 (keyless test branch only)
- EV trips: when your route has no workable charging plan, Stops offers the other routes that do; with none, Next says Adjust parameters and takes you back there.
- EV trips: "At least one of my destinations will have a charger" under When you get there. Per destination: full charge, a percentage, miles of range, or time plugged in on Level 1 / Level 2 (with an estimated ending charge), an optional charge limit (like 80%) and the electricity price.
- A Tesla Superchargers only option, and (?) explanations for charger types, J1772 / NACS / CCS and charging speeds.
- A failed plan's Adjustments screen shows just the errors and the station search.

## 0.0.207 - 2026-10-19 (keyless test branch only)
- Merge DOE and Open Charge Map usage into the existing Google/HERE counter pill.
- Keep quota periods distinct and move full-screen menus below taller combined counters.

## 0.0.206 - 2026-10-19 (keyless test branch only)
- Download an offline U.S./Canada charger inventory; keep saved data if an update fails or is cancelled.
- Add optional Open Charge Map coverage, personal-key setup guides and persistent charger-request tracking.
- Use unambiguous published charging rates where available; keep unknown or complex prices labeled as estimates.

## 0.0.205 - 2026-10-19 (keyless test branch only)
- Choose DC fast, Level 2 and Level 1 chargers under Charging stops; use realistic slow-charging estimates.
- Reduce route-discovery requests, retain cached chargers after provider limits, and check connector/charging-level compatibility together.
- Explain detour-limit failures and keep slower nearby chargers available to the planner.

## 0.0.204 - 2026-10-18 (keyless test branch only)
- The spare tire lookup waits for Ask Brave's real answer instead of reading our own question back (it lists every kind of spare); a wrong answer saved that way is asked again.
- Tank size from Brave shows just the figure and the buttons.

## 0.0.203 - 2026-10-18 (keyless test branch only)
- Tank size, spare tire and trim lookups ask Ask Brave (Brave's AI chat, which always answers) first, and only read the Brave search page when the chat gives no answer.

## 0.0.202 - 2026-10-18 (keyless test branch only)
- VIN scanner focuses like GrapheneOS Camera's QR mode: focus, exposure and white balance metered on the scan square every 2 seconds, a larger square, and light-on-dark codes read too. The log now says what the phone's camera lets the app do (focus, zoom, light).

## 0.0.201 - 2026-10-18 (keyless test branch only)
- VIN scanner, for small QR codes: a center square it reads at higher detail, zoom (slider or pinch) when the camera allows it, focus refreshed on the square every 2 seconds, and tap to focus. Modeled on GrapheneOS Camera's QR mode.

## 0.0.200 - 2026-10-18 (keyless test branch only)
- The VIN scanner reads QR codes that hold more than the VIN: a link with the VIN in it, "VIN" written against it, or several fields.

## 0.0.199 - 2026-10-18 (keyless test branch only)
- The tank size from Brave Search is shown like the spare tire's: what Brave said, with That's right and See Brave's answer.
- Tank sizes are read better: the figure next to "tank capacity" wins over a reserve or warning-light amount (a 2020 Sienna read as 4 gallons), and a figure too small for the car is shown but not filled in. An earlier too-small answer is cleared and asked again.

## 0.0.198 - 2026-10-18 (keyless test branch only)
- Bug fixes

## 0.0.197 - 2026-10-18 (keyless test branch only)
- The VIN scan button sits beside Look up and matches it: a barcode in a viewfinder like the Route button.
- The scanner stays plain black until the camera picture is there.
- Year / make / model / trim is one rounded tile that includes the trim, for EPA and custom cars alike, with a little more room above the EPA / custom choice.

## 0.0.196 - 2026-10-18 (keyless test branch only)
- Scan your VIN: the barcode button in the car editor's VIN box opens the camera and reads the VIN label on the driver's door jamb or windshield (Code 39, Data Matrix or QR), then looks it up. It works without Google Play services; the camera picture stays on the phone. The app asks for camera permission the first time.

## 0.0.195 - 2026-10-18 (keyless test branch only)
- Whole-trip comparison works on long trips: the other routes' speed limits are read one at a time and retried by themselves (they were all read at once and given up on after 15 seconds, so every trip was skipped). Try again only shows if they fail three times.
- Routes a saved trip never searched aren't compared on guesses anymore: the comparison names them and offers to search just those routes. A saved trip missing some approved routes also searches only those, not the whole trip again.
- Full backups are compressed (.json.gz, several times smaller); older .json backups still restore.
- Cruising speed for this trip is only in Adjustments, not Stops.
- Bug fixes

## 0.0.194 - 2026-10-18 (keyless test branch only)
- Switching to a cheaper whole-trip recommendation keeps Hazards done: the routes it replaces stay approved alternatives, so Hazards no longer asks about them again, the later steps stay open, and the next station search uses the saved stations instead of searching again.

## 0.0.193 - 2026-10-18 (keyless test branch only)
- Saved trips get toll prices too: a trip saved before toll comparison existed (or with it off) now fetches its toll-free routes when you open it with "Compare with and without tolls" on, and HERE prices its routes (before, HERE was never asked for saved trips' routes).
- The log says why HERE wasn't asked (the comparison switch is off, or you're avoiding tolls).
- Bug fixes

## 0.0.192 - 2026-10-18 (keyless test branch only)
- The lookup counter in the top corner also counts HERE toll lookups: with both keys, Google's and HERE's counts share the pill (G over H); with just one, that count sits where Google's always has.
- The HERE, station finder and car picture keys are where they belong, in Settings → Connections & usage → Other optional keys (they had stayed in Trip defaults → EV & hydrogen).

## 0.0.191 - 2026-10-18 (keyless test branch only)
- Toll prices from HERE: add your free HERE key in Settings → Connections and, when Route compares toll and toll-free roads, each toll road gets its price automatically (with your trailer's axles when you tow). Only roads with tolls of an unknown amount are asked, once each, and each answer is kept 30 days; a monthly limit (2,000 by default, under HERE's free 2,500) stops it before any charge.
- Bug fixes.

## 0.0.190 - 2026-10-18 (keyless test branch only)
- Compare with and without tolls (Route → Other routes): each leg's toll-free routes are fetched too and join the alternatives, and the route comparisons count each route's tolls, so a toll road with cheap stations can still win. With the API key Google estimates the toll amounts; without it the Google Maps website only says a route has tolls, so Route's new Tolls card takes the amount (also for a toll pass or a trailer). A trip whose tolls aren't known isn't recommended.
- Hazards shows each route option's tolls.

## 0.0.189 - 2026-10-18 (keyless test branch only)
- Trip planning runs on several background workers at once. The buffer and detour sliders, the other routes and the whole-trip comparison no longer plan one after another, and moving a slider no longer freezes the app while the trip is planned again (the top bar shows it working).
- Bug fixes.

## 0.0.188 - 2026-10-18 (keyless test branch only)
- Zoomed out, the map shows only the cheapest stations: the cheapest 1% a few states across, more as you zoom in, and every station once the map is a couple of towns across. The list says how many it's showing. Zooming out on a long trip no longer lags.
- A gas station that Google Maps lists several times (the fuel brand, the store's name, an old brand) is now one station, and alternative routes no longer list the stations they share with your main route twice.
- An area whose page loaded its stations and then timed out on a second try keeps them and is no longer reported as failed.

## 0.0.187 - 2026-10-18 (keyless test branch only)
- Station scans find the right number of website readers sooner: they start at 8 and add readers while pages load quickly, and take some away as soon as pages slow down, before they start timing out. In a simulation of slow and fast connections this was within about 15% of the best fixed reader count at every speed.

## 0.0.186 - 2026-10-18 (keyless test branch only)
- Station scans adjust how many website readers run to what your connection can carry: pages timing out cut the readers back, pages loading add them again. Too many readers at once was slowing scans down.
- Bug fixes.

## 0.0.185 - 2026-10-17 (keyless test branch only)
- Station scans no longer lose areas whose page failed to load: they're read again after the pass (fewer readers, up to three tries), so a route isn't left with a stretch of no stations and no workable plan.
- After you finish a website check, the scan restarts gently instead of reloading every reader at once.
- Bug fixes.

## 0.0.184 - 2026-10-17 (keyless test branch only)
- Pause website scans immediately for Google, Walmart or Murphy checks; retry unfinished areas after the visible check closes.
- Show check prompts over the trip and preserve the actual Google challenge URL.

## 0.0.183 - 2026-10-17 (keyless test branch only)
- Automatically retry failed AI explanations with fresh corrective feedback and affected-answer cache cleanup.
- Hide duplicate checked tire warnings after validated AI advice appears; keep pressure checks and fallback warnings.

## 0.0.182 - 2026-10-17 (keyless test branch only)
- Add optional aggressive website-worker mode with emergency memory backoff.
- Avoid unnecessary reloads of short station lists; improve scan timing and cancellation logs.
- Defer queued large-AI explanations during low-memory scans and release idle model RAM.

## 0.0.181 - 2026-10-17 (keyless test branch only)
- Reduce background Maps graphics downloads and memory overhead while preserving station data.
- Retry unreadable or stalled discovery once with normal resources, retaining partial results.
- Reduce price-parser allocations; don't cache a quiet list as proven complete.

## 0.0.180 - 2026-10-17 (keyless test branch only)
- Remember validated AI explanations and prepare all saved vehicles in the background, one at a time.
- Keep completed explanations when switching cars; clear them with the lookup cache.
- Faster station-reader pagination and direct labeled-price refreshes, with fewer visual resources.
- Website-worker ceiling raised to 50; memory safeguards remain.

## 0.0.179 - 2026-10-17 (keyless test branch only)
- Failed Brave lookups offer a bot-check screen and read the answer automatically afterward.
- Improved trim parsing for ordinary summaries and pages echoing the search question.
- Fixed a late-save race after erasing data; detailed logging stays enabled on the fresh setup.

## 0.0.178 - 2026-10-17 (keyless test branch only)
- Better NHTSA photo matching, with selected-model and broader photo searches.
- Fixed EPA mode labels and erased trim caches interfering with vehicle lookups; added trim retry.
- Corrected the older onboarding AI-off default; downloads still require consent.
- Detailed, bounded troubleshooting logs enabled by default on fresh setup.

## 0.0.177 - 2026-10-17 (keyless test branch only)
- Fixed Settings submenu headers to use the standard Back button.
- Onboarding now includes price-display choices, a rounding preview and website-worker controls, without an early setup exit.
- Larger AI defaults on for new setup; downloads still require confirmation. Three AI controls share a row and wrap text.
- Higher RAM-based worker defaults, with warnings for excessive overrides.

## 0.0.176 - 2026-10-17 (keyless test branch only)
- Shorter Advice with expandable explanations; important warnings and acknowledgments remain visible.
- Fuel economy and expandable car details now live in Your car.
- Settings reorganized into seven focused submenus.
- New five-step onboarding, with optional keys, savings setup and explicit local-AI download consent.

## 0.0.175 - 2026-10-16 (keyless test branch only)
- Route review has a square Back arrow beside No/Yes; remembering off asks again when returning to Hazards and never writes temporary answers into settings.
- Demo vehicles prefill fuel/charge and trip-planning values.
- Fixed the empty speed-controls tile in Stops.

## 0.0.174 - 2026-10-16 (keyless test branch only)
- Vehicle-aware hazard ranking, with brief reasons and an optional vehicle-profile override.
- Per-car broken-A/C switch updates climate recommendations and hazard advice.
- Remembering cheaper-route answers is off by default, saved-trip/vehicle-specific, and warns before reuse. New trips always ask again.

## 0.0.173 - 2026-10-16 (keyless test branch only)
- Added Back navigation while reviewing cheaper-route alternatives.
- Expanded statuses show other active work, then pending planning stages, without duplicating the primary scan.
- Automated warning checks now cover every hazard type at two phone widths.

## 0.0.172 - 2026-10-16 (keyless test branch only)
- Wet-weather routes now require acknowledgment when car or hooked-up trailer tires have low tread, naming the hazards and affected tires.
- Applies to default routes, alternate selections and cheaper-route consideration; reuses background weather checks.

## 0.0.171 - 2026-10-16 (keyless test branch only)
- Fixed overlapping tire manufacture-date fields; the spare date now lives in Tire details, not the main Tires tile.
- Larger trailer number tags, plus a numbered spare tag after the last road tire.

## 0.0.170 - 2026-10-16 (keyless test branch only)
- Local AI tire explanations rebuilt: the checked findings now cover each tire's tread, miles left, warranty, rotation, age and the spare, and the AI summarizes the most urgent first (tuned on the real model; see docs/AI_TIRE_EVAL.md).
- Tire age: when your tires were made (the DOT date code) is required; the spare, if undated, is assumed as old as the car's model year allows.
- The tire picture shows the spare lying flat, behind the car or beside it while towing; small trailer wheels get number tags.
- Demo cars each have a different set of tire problems to try.
- Bug fixes.

## 0.0.169 - 2026-10-16 (keyless test branch only)
- The spare-tire lookup names your car's powertrain and reads only what an answer says about your version (a gas Blazer's answer that also covered the Blazer EV opened with the EV's "No spare").
- Bug fixes.

## 0.0.168 - 2026-10-16 (keyless test branch only)
- About this car is read-only; change details in Edit → Details. Switching EPA versions replaces the old version's details.
- Tire type narrows the brand and model lists; picking a model fills its mileage warranty.
- Better spare-tire reading when a spare is optional rather than standard.
- The only car can be removed; popups stay clear of the status bar; "Pick a photo...".
- Local AI explanations are checked more sensibly, and rejections say why in the log.
- Bug fixes.

## 0.0.167 - 2026-10-16 (keyless test branch only)
- The trim box shows while it's asking Brave; the tank size waits for a trim.
- The AI model download shows the time left.
- Bug fixes.

## 0.0.166 - 2026-10-16 (keyless test branch only)
- Pick your trim from a list (Brave Search's answer, plus Fuel API's trims with its key), or type another.

## 0.0.165 - 2026-10-16 (keyless test branch only)
- Trim is required; changing it clears the tank size and asks Brave again.
- First-time setup offers the optional larger AI download.
- The lookup counter shows only with a Google key; full-screen menus only move down when there's a status to show.
- Bug fixes.

## 0.0.164 - 2026-10-16 (keyless test branch only)
- Buffer and max-detour sliders snap to their marks again.

## 0.0.163 - 2026-10-16 (keyless test branch only)
- "Never below" on the buffer slider: a lowest buffer (default 10 mi) that trip adjustments can't go under.
- Replacing a trip with a cheaper one returns to Adjustments, then checks for cheaper trips once more.
- Bug fixes.

## 0.0.162 - 2026-10-15 (keyless test branch only)
- Require vehicle capacity before saving; Route now precedes Parameters.
- Keep equal-width red No / green Yes route-review buttons visible during background work.
- Avoid false extreme-cold statements; improve AI download retries, resume controls and logging.
- Larger AI defaults enabled; model download still requires confirmation.
- Consolidated progress in a wrapping top bar, with tap-to-expand full-screen messages.

## 0.0.161 - 2026-10-15 (keyless test branch only)
- Trip-wide adjustments and optional cheaper-trip maps with hazards, added time and savings.
- Parameters before Route; removed the dollars-per-hour setting.
- Top task dock clears menus and the API meter; fixed stalled hazard AI requests.

## 0.0.160 - 2026-10-15 (keyless test branch only)
- Separate smaller ARM64 and universal APK downloads with Obtainium-friendly names.

## 0.0.159 - 2026-10-15 (keyless test branch only)
- Optional Gemma 4 E4B tire explanations with a verified, resumable model download.
- Expandable top progress bar for simultaneous background tasks.
- Tire advice identifies affected tires; safety notices remain independent of AI.

## 0.0.158 - 2026-10-15 (keyless test branch only)
- Estimated tire wear graphics and required tire details.
- Shared route searches, faster background planning and per-leg sliders/maps.
- Bug fixes.

## 0.0.157 - 2026-10-15 (keyless test branch only)
- Per-leg route choices, adjustments and comparisons.
- Better vehicle validation and website-reader recovery.
- Bug fixes.

## 0.0.156 - 2026-10-14 (keyless test branch only)
- Search the full visible map area; reconcile saved station duplicates after cancelled searches.
- Bug fixes.

## 0.0.155 - 2026-10-14 (keyless test branch only)
- Clearer VIN lookup progress and unresolved selections, with less setup clutter.
- Emergency towing cash guidance in Advisory.
- Bug fixes.

## 0.0.154 - 2026-10-14 (keyless test branch only)
- Up to 20 website readers, more generous RAM defaults and better scan diagnostics.
- Plan CITGO monthly specials once per month across the trip, with confirmed actual fill-up tracking.
- Bug fixes.

## 0.0.153 - 2026-10-14 (keyless test branch only)
- Spare tire: "No spare" with a repair kit (or run-flat tires) mentioned anywhere in Brave's answer now reads as the kit, even when the answer also says a spare can be added; saved answers are read again once.

## 0.0.152 - 2026-10-14 (keyless test branch only)
- The spare-tire question fits Brave Search's 50-word limit again (it was turned away as too long).

## 0.0.151 - 2026-10-14 (keyless test branch only)
- Pages opened for you (Brave Search, NHTSA, a site's check) leave room above and below, so their buttons aren't under Gasket's.
- Tire Rack lookups try again twice after a hiccup; without a size, picking your version comes before the size box.
- Tire details unlock once the tire size is in; tires are no longer needed to go on to the next step (Advice still warns).
- Spare tire: an answer saying a spare was optional shows that as a tip; hybrids are asked about by their full name (Corolla Hybrid, not Corolla), for the tank size too.
- Bug fixes.

## 0.0.150 - 2026-10-14 (keyless test branch only)
- Tire details: the tire size is required; "My car has more than 1 tire size" adds a rear size (each tire then gets its own answer), and a tire's lookup uses its axle's size instead of its own size box.
- "My tires are different", with a tip under the choice about tires put on 5,000+ miles apart; By mileage comes first.
- The demo cargo trailer's tires have their type, so its fuel rating shows.
- Bug fixes.

## 0.0.149 - 2026-10-14 (keyless test branch only)
- Recalls on record load for every car again: NHTSA's "no recalls under that name" answer counts as none, and shorter model names are tried (an EPA name like "Model 3 Long Range AWD" finds "Model 3").
- Bug fixes.

## 0.0.148 - 2026-10-14 (keyless test branch only)
- Tires: a Fuel rating section with a tile for the car and each hooked-up trailer, summing up every tire (mixed tire types count for their share); the overall rating shows under Tires.
- Tread-difference warnings by drivetrain (AWD, on-demand AWD, full- and part-time 4WD, front- and rear-wheel drive), suggesting the axle that just rolls along where there is one.
- "Why tread matters" sits under the tread answer; the car tire details page ends with the tires themselves.
- "+ Add car" is a blue button beside Edit; car photos keep their own shape instead of being cut off.
- Bug fixes.

## 0.0.147 - 2026-10-14 (keyless test branch only)
- Tire details: choose "My tires are all the same" or "My tires aren't all the same" under the size, each with an explanation; the tread question follows it, and different tires go straight to each tire.
- Edit your car in its own page with Discard changes and Save at the bottom; the name comes first, then the VIN through the picture style, then the picture.
- A "New photo" button beside Edit picks another public photo; a new car shows a tip instead of a stand-in drawing.
- Bug fixes.

## 0.0.146 - 2026-10-14 (keyless test branch only)
- Organize car and trailer tire details into their own menus, with mirrored dually selectors.
- Keep a clean hooked-up overview; remove its trailer label.
- Improve keyless photo matching and add a photo picker alongside device images.
- Tire buttons show each tire's miles, warranty and tread; the Tire details and trailer rows say when tires still need details.
- Bug fixes.

## 0.0.145 - 2026-10-14 (keyless test branch only)
- Show previously known stations as you pan the main map, without new API calls.
- Use the correct hourly forecast at each route ETA.
- Refine demo vehicle and spare-tire details; add diesel powertrain and correct passenger dual-tire order.

## 0.0.144 - 2026-10-14 (keyless test branch only)
- Round vehicle photos to match the garage tiles.

## 0.0.143 - 2026-10-14 (keyless test branch only)
- Demo vehicles default to photos; fixed Wikimedia thumbnails and Mirai photo lookup.
- Demo warnings identify only non-EPA sample values.

## 0.0.142 - 2026-10-14 (keyless test branch only)
- Empty fresh-install garage and opt-in four-vehicle demo, without station data.
- Anchored setup menus and EPA, NHTSA and custom vehicle entry.
- Bug fixes.

## 0.0.141 - 2026-10-14 (keyless test branch only)
- Empty fresh-install garage and opt-in four-vehicle demo, without station data.
- Anchored setup menus and clearer EPA, NHTSA and custom vehicle entry.
- Bug fixes.

## 0.0.140 - 2026-10-13 (keyless test branch only)
- NHTSA selection for vehicles beyond EPA coverage, plus a labeled Ram dually demo.
- Improved truck tire-size reading and manual Tire Rack model matching.
- Bug fixes.

## 0.0.139 - 2026-10-13 (keyless test branch only)
- Clearer custom vehicle entry alongside the full EPA catalog.
- Matching rounded image buttons with readable wrapping labels.
- Bug fixes.

## 0.0.138 - 2026-10-13 (keyless test branch only)
- Lock both trailer dimensions and improve axle dragging versus scrolling.
- Revised ruler/control placement and right-aligned Specify arrows.
- Bug fixes.

## 0.0.137 - 2026-10-13 (keyless test branch only)
- Horizontal dual-tire controls, trailer-scoped size autofill and confirmed Delete shortcut.
- Unlock/edit/lock-to-save trailer length.
- Bug fixes.

## 0.0.136 - 2026-10-13 (keyless test branch only)
- Resizable trailer body, measurement rulers and tire-size-aware wheel spacing.
- Driver/passenger tire columns and quick trailer unhooking.
- Bug fixes.

## 0.0.135 - 2026-10-13 (keyless test branch only)
- Smooth touch axle dragging, clearer dual-tire controls and consistent trailer spacing.
- Bug fixes.

## 0.0.134 - 2026-10-13 (keyless test branch only)
- Trailer tire selector and movable, order-preserving axle visual.
- Bug fixes.

## 0.0.133 - 2026-10-13 (keyless test branch only)
- Styled pickers, improved image controls and individual tire/trailer editing.
- Blue anchored headings, required asterisks and nonintrusive tow controls.
- Bug fixes.

## 0.0.132 - 2026-10-13 (keyless test branch only)
- Styled selectors, date dialogs and vehicle image controls.
- Correct Tires header anchoring and required-field markers.
- Improved individual tire lookup and trailer tire editing.
- Tow mode reveals controls without opening a submenu.
- Bug fixes.

## 0.0.131 - 2026-10-13 (keyless test branch only)
- Consistent blue tile headings and unobstructed submenus.
- Safer car editing and confirmed discard actions.
- Easier tire selection, spare storage location and clearer tread estimates.
- Future-leg hazards load concurrently with yellow AI progress notices.
- Bug fixes.

## 0.0.130 - 2026-10-13 (keyless test branch only)
- Tile headings stay visible while scrolling their tile.
- Earlier background hazard checks with a distinct AI-rating stage.
- Clearer VIN trim and recall-lookup results.
- Bug fixes.

## 0.0.129 - 2026-10-13 (keyless test branch only)
- **VINs find their EPA version more often.** Each version the EPA lists (like "Sienna 2WD" and "Sienna AWD") is scored against what the VIN says: two- or all-wheel drive (including NHTSA's "4x2"), hybrid, plug-in, flex fuel, diesel. When versions still tie, the on-phone AI picks the closest one, only when it's clearly closer, and says so. Then the engine / transmission follows from the engine size and cylinders.

## 0.0.128 - 2026-10-13 (keyless test branch only)
- **Typed addresses can have stops in between:** "+ Add a stop" between From and To (each stop its own leg, like a Maps link's).
- **VIN lookups fill the car in once:** the year / make / model / engine boxes no longer empty and refill themselves; looking up the same VIN again leaves them alone. The NHTSA VIN check tries again by itself if NHTSA's page errors.
- **"Now" means leaving now:** it stays current while you look around. A reopened saved trip asks when you're leaving again.
- **Spare tire:** Brave's AI is asked to answer in a fixed way and to write the tip itself in one short sentence; the tip looks like the app's other tips. "See Brave's answer" opens its page for you.
- **Status bar:** wraps on the map, a short line in full-screen menus, "Preparing…" before the first area is done, and a ✕ on Adjustments' own progress too.
- **Search this area** uses fewer website readers and the areas nearest the middle, so the map stays smooth while it runs.
- Bug fixes.

## 0.0.127 - 2026-10-13 (keyless test branch only)
- **The spare tire is read right.** "Doesn't come with a spare" now wins over any mention of one (room for it, buy one separately), so cars with a repair kit no longer show up as having a spare. When the answer says you can get a spare anyway, a tip under "What your car has" says so (with its size, when given).
- **Air checks follow what you picked:** the spare's monthly air check only comes up once you've chosen a full-size or compact spare.
- **New in Advice: tire pressure.** A monthly tick for setting your tires to their cold pressure (the sticker in the driver's door jamb); the trip waits for it like the others.
- During a background station search, Stops and Departure are grayed out too, and Advice → Parameters works.
- Speed by road shows only your route and stops on the map, not every other station.
- Bug fixes.

## 0.0.126 - 2026-10-13 (keyless test branch only)
- **Station searches and price updates can run in the background.** Leaving one (✕, Back or the phone's Back) asks whether to cancel it or keep it running. In the background, a status bar shows its progress with a ✕ to cancel (on the map under the top bar, and in the empty space above the step tabs in full-screen menus), and anything that would change it is grayed out: the car, route and hazards steps, grades, fuel mode, refresh, settings and other trips. When it finishes, the bar offers to open your stops.
- The map's own search shows in the same bar, and gives way when you start a trip search.
- **No more hazard loop:** warnings the AI couldn't get to are read again once, with time to finish, then kept as worded.
- Bug fixes.

## 0.0.125 - 2026-10-13 (keyless test branch only)
- **Website routes follow the roads.** Without a key, a route's line now comes from the Google Maps page's own full drawing (thousands of points, simplified to about 10 m) instead of a few dozen points, so the map, detours, hazards and speed-by-road stretches line up with the real roads.
- **Main map refresh menu:** the same blue buttons as the trip, each with its (?) beside it; no Close button (tap anywhere else).
- **Walmart lookups no longer time out** on long trips: smaller batches, and a slow batch is read again in halves before it counts as an error.

## 0.0.124 - 2026-10-13 (keyless test branch only)
- **Turn-by-turn directions without an API key.** The Google Maps website's own directions (road names, each stretch's miles and time) are now read for each route, so website routes know their roads like API routes do, and **cruising speed works without a key** on any route Maps sent them for.
- **Hazards no longer hang** waiting for the on-phone AI. Warnings are sorted by their wording at once; while the AI is still summarizing, the list says so and updates by itself when it's done.
- Adjustments: the No API and API buttons match, their (?) sit evenly between them, and ▾ shows a matching "Discover stations" button with its own (?).

## 0.0.123 - 2026-10-13 (keyless test branch only)
- **Trips with stops in between, on website routes (no API key), know where each leg ends.** Every leg used to count as mile 0, so Departure put all the fuel stops on the last leg ("0 mi · no fuel stops" on the way there), and the per-leg detours and tank tiles were off too.

## 0.0.122 - 2026-10-12 (keyless test branch only)
- **Leaving is required**, and **Now** fills in the current time.
- **Head back right away** is a switch on round trips (on by default): no date to pick, the way back starts when you arrive. Turn it off and Head back becomes a required time after you leave.

## 0.0.121 - 2026-10-12 (keyless test branch only)
- **Route is shorter:** the summary tile under it is gone (routes are picked on Hazards; the "approximate website route" note moved there).
- **"Now" and "Right away" work on the phone:** they swap in a fresh empty date box, and the button lights up while you're leaving now / heading back right away.
- **Adjust no longer breaks on another route of a saved trip.** If the stations the trip already knows can't plan the route you picked, it finds stations along that route instead.
- Parameters: the (?) on "Check Google's other routes too" says that without a key, website discovery searches those routes too.
- Bug fixes.

## 0.0.120 - 2026-10-12 (keyless test branch only)
- **Advice's tick boxes really hold the trip.** Unticking "I understand when to use recirculate" (or a due spare check) keeps every later step closed, however you get there.
- **Adjustments refresh buttons are blue**, with a refresh icon. "Discover stations again" moved into a small ▾ menu on the No API button, since discovery already runs by itself.
- **No false "coverage is partial" warning.** A website list that scrolls to its bottom and stops growing counts as finished (and is cached), so only lists that were really cut short are reported.
- Bug fixes.

## 0.0.119 - 2026-10-12 (keyless test branch only)
- **Weather from the National Weather Service.** Hazards now use the NWS's own hourly forecast (its forecasters' wording, like "Thunderstorms Likely" or "Freezing Rain", with the chance) for the next 6½ days, and the list shows it. Past that, or if the NWS doesn't answer, Open-Meteo's National Blend of Models. Air quality still comes from Copernicus.
- Bug fixes.

## 0.0.118 - 2026-10-12 (keyless test branch only)
- Route: Leaving comes before Round trip, and "Now" / "Right away" clear a picked time on the phone too.
- Hazards: each route tile has its own progress bar while its weather is checked (two routes at a time), the panel fits itself to the route tiles, and a notice says hazards are projections that can change with little warning.
- Bug fixes.

## 0.0.117 - 2026-10-12 (keyless test branch only)
- **Faster website discovery along a route.** From a 2,600-mile round trip's log: the readers spent 45% of their time waiting for rows that never came, so a list that's at its bottom and quiet for 4 seconds now counts as done (long lists still get up to 12). Search areas are 10 miles apart instead of 6 (57% of rows were repeats). When the phone runs low on memory, readers past the first four step back and free their pages.
- Without an API key, speed limits aren't looked up at all (cruising speed is off), so they don't compete with discovery.
- Bug fixes.

## 0.0.116 - 2026-10-12 (keyless test branch only)
- **New Hazards step, after Route.** You pick each leg's route here, on the big map (the panel takes a quarter of the screen): every option is drawn, with each hazard colored where and when you'd be in it, and labeled on the route you pick. Round trips and trips with stops in between go one leg at a time, with "Step 1/2" at the top. Route is now just where you enter the trip (with a "head back" time for round trips).
- **Hazards are color-coded and say what they are.** Weather warnings are placed on the route by their own outline or by the counties they list (county outlines for all 50 states are built in), and vague ones like a "Special Weather Statement" are read by the on-phone AI so the map says "Dense fog" or "Strong storms". The list keeps the original notice.
- Departure shows the hazards on your route without labels, and only your stops (no dots for the other stations). The weather card moved to Hazards.
- Bug fixes.

## 0.0.115 - 2026-10-12 (keyless test branch only)
- Cruising speed is off without a Google API key (website routes don't have the road details it needs): its controls stay on screen, grayed out, with a short note at the top, and stops are planned at the speed limits.
- Without a key, Stops and Departure note that the costs are rough estimates.
- Bug fixes.

## 0.0.114 - 2026-10-12 (keyless test branch only)
- **Weather and air along the way.** Departure shows what you'll drive through, where and when you'll be there: storms, rain, snow, ice, fog, strong wind, heat and cold (Open-Meteo's forecast, up to 16 days ahead), unhealthy air from smoke, smog or dust (Copernicus air-quality forecast, about 5 days ahead), and National Weather Service warnings. Each stretch says what to do: your climate preset for that weather, recirculate through bad air and back to fresh after, and tire advice from your tread and tire type.
- **Spare tire read by the AI.** The rating model on the phone now reads Brave's answer (setting aside what the car doesn't have), so "no spare, it has a repair kit" is no longer read as a compact spare. An answer misread before is read again, and if you'd confirmed the wrong kind you're asked again.
- Bug fixes.

## 0.0.113 - 2026-10-12 (keyless test branch only)
- Cruising speed works on website routes (no API key): the major roads and their limits now come from the FHWA road inventory along the route, since website routes have no turn-by-turn text.
- Detailed debug logging for website discovery: the area plan, progress every 50 areas, a per-area timing table (page load, list shown, last new row, stop reason, rows, new stations) and a summary of where the time went (lane use, idle tail, waiting after the last row, overlap between areas, phone memory).
- Bug fixes.

## 0.0.112 - 2026-10-12 (keyless test branch only)
- Going over the limit by default now starts at +0, and "no faster than" starts at your car's ideal cruising speed.
- The "let the buffer and speed sliders adjust each other" option is gone: each slider stops at the gray where the other doesn't leave enough gas.
- RAM-based website reader count, adjustable from 1 to 16 in Settings.
- Lazy reader creation and idle-reader cleanup after scans.
- Bug fixes.

## 0.0.111 - 2026-10-12 (keyless test branch only)
- Walmart website prices fill keyless discovery and all-grade refreshes.
- Faster tests with simulated worker clocks, parallel checks and cached build dependencies.
- Bug fixes.

## 0.0.110 - 2026-10-12 (keyless test branch only)
- Optional Google key with website station discovery and approximate website routing.
- Full-list scrolling, four readers, progress, cancellation and duplicate detection.
- Special-weather answers are separate for each season.
- Bug fixes.

## 0.0.109 - 2026-10-12 (keyless test branch only)
- Adjustments-only refresh controls with separate scan buttons and trip-based help.
- No-API refresh handles all fuel grades and diesel where prices are published.
- Correct price-age warnings and fuel-control layering.
- Bug fixes.

## 0.0.108 - 2026-10-12 (keyless test branch only)
- Special-weather presets can copy defaults from their parent season.
- Mileage entries show their logging time.
- Faster no-API refresh with four readers and fewer unnecessary waits.
- Reader memory cleanup and incremental price saving for long scans.
- Bug fixes.

## 0.0.107 - 2026-10-11 (keyless test branch only)
- Refresh cards in Adjustments, Stops and Departure, with API/no-API choices.
- Uncapped website refresh with progress, estimated time remaining and Cancel.
- Persistent station price history, included in full backups.
- Bug fixes.

## 0.0.106 - 2026-10-11 (keyless test branch only)
- Faster saved-price refresh with two parallel readers and targeted early completion.
- Shorter release notes; credits remain in project information.
- Bug fixes.

## 0.0.105 - 2026-10-11 (keyless test branch only)
- **Saved-trip price refresh.** Update matched regular prices from Google Maps web without spending Places or Routes calls. Keep saved stations, route geometry, other fuel grades and unmatched prices; persist refresh results separately from original discovery time.
- **Separate Routes budget.** Default 9,500 monthly attempts for current Essentials routing, enforced atomically before network requests. Cached routes remain usable at the cap.
- Bug fixes.

## 0.0.104 - 2026-10-11 (keyless test branch only)
- **Optional keyless nearby regular prices.** OpenStreetMap locations and Google Maps web search prices, bounded and cached without a paid Places fallback. Coverage and unknown update times are explicitly labeled. Routes and other grades remain unchanged.
- Separate test installation (`com.bensanzone.fuelmap.keyless`), preserving the regular app and its data.
- Bug fixes.

## 0.0.103 - 2026-10-11
- **Keep car pictures.** Downloaded and imported pictures live in app storage and travel with full backups; upgrade preserves existing cached images and photo metadata.
- **Direct APK downloads.** Signed APKs are available on each GitHub release without unpacking an Actions ZIP.
- Bug fixes.

## 0.0.102 - 2026-10-11
- **Complete tire options.** Keep separate Tire Rack product variants instead of merging different speed/load ratings under one model name. The model selector distinguishes ratings and fills the matching warranty and wear rating. Read plain-text categories and image pagination controls, and log rejected cards for incomplete catalogs.
- Bug fixes.

## 0.0.101 - 2026-10-11
- **Tire catalog and warranty autofill.** Read Tire Rack's product cards, results-per-page selector and dynamically loaded pages so brands and models beyond the first results appear. Refresh older incomplete caches, preserve manual warranties, and fill ratings and mileage warranty for an existing or newly selected catalog tire.
- Bug fixes.

## 0.0.100 - 2026-10-11
- **Fuel-mode pill.** A pill at the left of the top bar switches the map between ⛽ Gas & diesel, ⚡ Electric and H₂ Hydrogen. The selector next to it follows: gas grades, charger speed (Fast / Level 2 / All) or hydrogen pressure (All / H70 / H35). Pins, the list, refresh and "Search this area" show chargers or hydrogen stations in those modes, and the mode follows your car when you pick one of another kind. The ⚡ button is gone; its options (hydrogen range shading) are under "EV & hydrogen options…" in the pill's menu.
- Bug fixes.

## 0.0.99 - 2026-10-11
- Fix Tire Rack lookups getting stuck when the hidden page is reused for model and trim requests. Readers are keyed to each request, and lookups share a queue instead of replacing one another.
- Stop stalled page loads, response bodies, and native bridge requests. Show site restrictions, connection errors, timeouts, and unreadable results with a manual retry button and detailed debug logs.
- Ignore a factory-size answer when another version or a manual size was selected while it was loading. Read linked result pages without destroying the active reader.
- Resume incomplete lookups after restarting the app; unfinished requests are no longer cached as completed failures.

## 0.0.98 - 2026-10-11
- Tire Rack vehicle-picker requests now time out cleanly instead of leaving the tire lookup spinning forever. The lookup reports the failure and can retry later.

## 0.0.97 - 2026-10-11
- **Tire Rack sizes work for every car.** Tire Rack files cars under its own names (a 2011 Sienna LE is "Sienna FWD" + "LE V6"), and its size page answers only to those. Tires now asks Tire Rack's vehicle menu for its names and matches your car by trim, drive, engine and body, so the factory size comes up on its own. When that isn't certain (no trim, or two close matches) you pick your version from Tire Rack's list, and you can change it any time.
- Bug fixes.

## 0.0.96 - 2026-10-11
- Bug fixes (Tire Rack's version list is asked from its vehicle picker).

## 0.0.95 - 2026-10-11
- **Pick your trim for tires.** When Tire Rack can't find your car's trim (or there's none), Tires → Tire details shows a dropdown of versions: Tire Rack's own names when its page lists them, plus the model's trims from Fuel API if you have a key.
- Bug fixes.

## 0.0.94 - 2026-10-11
- Bug fixes (older cars' paint colors are looked up again; Tire Rack's version list reads more of its page).

## 0.0.93 - 2026-10-11
- **Tire Rack versions.** When Tire Rack doesn't know your trim (or the car has none), Tires lists the versions Tire Rack has for your model; pick yours to get its factory tire size.
- Older cars (like a 2005 Mustang) get their factory paint colors too: Fuel API only has their side view, so that's what's shown.

## 0.0.92 - 2026-10-11
- Climate control's seasons start with winter.

## 0.0.91 - 2026-10-11
- The current season's outline in Climate control is subtler: a thin, faint light that moves slowly.

## 0.0.90 - 2026-10-11
- Bug fixes (0.0.89's source didn't build).

## 0.0.89 - 2026-10-11
- **Climate control seasons** get an emoji each (🌷 ☀️ 🍂 ❄️), and the season you're in has a glowing light running around its outline. The summary next to the Climate control heading is gone.

## 0.0.88 - 2026-10-11
- The car picture buttons only show while you're editing the car.

## 0.0.87 - 2026-10-11
- **Special weather, by season.** In Climate control, each season now has "Adjust for special weather conditions" right under it, with "What would you do if it's…" for the weather that season brings (winter: snowy, icy, frosty, foggy; and so on). An answer counts in every season that has that weather.
- Import your own picture of a car into the Garage.

## 0.0.86 - 2026-10-10
- **Fuel API is back for colors.** With your Fuel API key in Settings, Edit → Picture lists your trim's factory colors; pick one to see your car in it ("As photographed" goes back to NHTSA's photo). Pictures are shown as Fuel API delivers them, watermark included. They're from the front three-quarter angle closest to NHTSA's (EVOX makes its color pictures at only three angles, none of them NHTSA's shot).

## 0.0.85 - 2026-10-10
- **Photo or Doodle.** Your car's picture is NHTSA's photo of the model, or for cars NHTSA doesn't have (older ones), a photo from Wikimedia Commons, credited to its photographer. Switch to Doodle under Edit → Picture for the app's own drawing of your car's body style in the color you pick; colors are only for the doodle.
- Fuel API is gone (its pictures can't be used without a license), and its saved key is deleted.

## 0.0.84 - 2026-10-10
- **NHTSA's photo first.** Your car's picture is NHTSA's photo of the model. Fuel API (with your key) is only asked when you pick one of your trim's factory colors under Edit, or when NHTSA has no photo of the car; "As photographed" goes back to NHTSA's.

## 0.0.83 - 2026-10-10
- **Your cars, with pictures.** The Garage shows one car at a time with its picture: swipe, tap the arrows or use the arrow keys for the next one. Pictures are NHTSA's photo of the model; add a Fuel API key in Settings and you get your exact trim in its factory paint colors (pick yours under Edit). No photo: a drawing of the body style in your color. Each picture is downloaded once and kept.
- Remove a car from Edit (the small x on the car buttons is gone).

## 0.0.82 - 2026-10-10
- **"What would you do if it's…"** replaces the weather presets in Climate control: snowy, icy, frosty, foggy, rainy, stormy, full of pollen, hot & sunny, humid, smoky or polluted. The ones that come with this time of year are listed first, and Advice shows your answers for them (and which are still open).
- The scroll button sits clear of the Back / Next bar, and turns into "back to the top" near the end.
- Bug fixes (including a lag when the gauge reaches empty).

## 0.0.81 - 2026-10-10
- **An empty tank isn't a starting point.** Empty on the gauge, 0% or 0 miles now grays out Adjustments, Stops and Departure. A red box under the gauge says how much to put in first: enough to reach the nearest station Gasket knows, or the first one along your route (0.1 mile extra included), with a button to use that amount.

## 0.0.80 - 2026-10-10
- **Cabin climate advice.** The card explains when recirculate does make sense (harsh allergens, heavy pollution, and very hot, humid days when the A/C can't keep up and the windows could fog), and you tick "I understand when to use recirculate" once before the trip goes on.
- New High pollen weather preset, and a "No cabin air filter" switch under your car's controls (recirculate is flagged less for those cars).

## 0.0.79 - 2026-10-10
- **Climate control.** A new Garage section: tell Gasket what your car's climate controls have (automatic, dual-zone, heated / cooled seats, heated wheel, rear defroster, sunroof, fan steps), then save your favorite settings as presets: one for each season, any weather you like (rain, snow & ice, foggy windows, hot & sunny, frosty mornings, humid, smoke or dust), and your own. Each preset opens its own page with a sensible starting point.
- **Fresh air, not recirculate.** Advice shows this season's preset and explains why to keep it on fresh air: recirculating makes you drowsy, and with the A/C on the air gets very dry. A preset that recirculates gets flagged.

## 0.0.78 - 2026-10-10
- A trailer's "Unhook & save" is now just "Unhook" (changes are always kept), and "Discard changes" is in orange.

## 0.0.77 - 2026-10-10
- **Tire details on their own pages.** "Tire details" (or "Car tire details") and each hooked-up trailer are now rows that open their own page.
- **Trailers.** A new trailer is hooked up right away and opens to fill in. Its page ends with Delete, Unhook & save, and Discard changes. Unhooked trailers wait under "Saved trailers", next to "+ Add a trailer", where you can hook one back up.
- The alignment tip now says it only applies when both tires on that axle went on around the same time.

## 0.0.76 - 2026-10-10
- **Tow mode.** A switch at the top of Tires: "Tire details" becomes "Car tire details", and each of your trailers gets its own tile (name, hooked up or not, axles, tires per axle, size, Tire Rack tires, wear rating, warranty). Keep as many trailers as you like; the hooked-up ones are drawn behind the car, one after another, and their tires count.
- **Each tire by tread depth or by mileage.** By mileage, every tire opens its own page: its miles, the maker's mileage warranty (filled in from the car's or trailer's tire details) and whether it's been rotated, plus an optional Tire Rack lookup by size.
- **No half-filled tires.** When your tires aren't all the same, the Garage won't go on until every tire is filled in, or you discard the tire changes; Advice warns that your tires could be unsafe.
- **Dual rear wheels only where they can be.** The switch is hidden for cars the EPA rates and anything that isn't a pickup or van, turned on by itself when your VIN says the truck is a dually.
- The understeer crash star now fades out with the rest.
- Bug fixes.

## 0.0.75 - 2026-10-10
- **The spare check is required.** With a full-size or compact spare, Advice's Next waits until you tick "I aired up my spare" (the later steps stay grayed out). The tick lasts 30 days, saved trips included.
- **Tires by position, with pictures.** Turn on dual rear wheels (pickups and vans only; grayed out for other cars) and the picture becomes a dually with four rear tires. Turn on a trailer and pick its axles (1–3) and tires per axle (2 or 4): it hooks up behind the car. Every tire is numbered on the picture, colored by its tread, and gets its own box. Mismatched duals are flagged.
- **Understeer vs oversteer:** the oversteer car now spins the right way (counterclockwise on that left-hand curve), and the second understeer car runs farther off the road into a tree, because understeer is the safer of the two, not a safe one.
- Bug fixes.

## 0.0.74 - 2026-10-10
- **No more lag from rating recalls.** The AI model now runs in the background, apart from the screen, so scrolling and taps stay smooth while it works (if a phone can't, it falls back to one recall at a time).
- **Open recalls first.** Once your VIN has been checked at NHTSA, the recalls still open on your car show up front and are rated right away. The rest (fixed on yours, or for other cars of the model) sit in the folded list and are rated only when you open it. Without a VIN check, nothing is rated until you open the list.
- Bug fixes.

## 0.0.73 - 2026-10-10
- **Past the monthly Google lookup cap, prices still update where they can.** Walmart and Murphy USA prices come from their own sites, so they keep refreshing; the warning now says "Only locations already in your phone's storage were updated, for Walmart and Murphy USA" (on the map and when planning stops).
- Bug fixes.

## 0.0.72 - 2026-10-10
- **Smoother recall rating.** The AI rates recalls three at a time with a pause in between, and goes much slower while you're not on Advice.
- **Clear cache, keep your setup.** Settings, your cars, saved trips, anything that cost a Google lookup, and the recall-rating model stay in the app's storage. Everything that can simply load again (recalls and VIN checks, Tire Rack and Brave answers, recall ratings, logos, speed limits, station lists from the stores' own sites) is now in the cache, so Android's "Clear cache" lets you watch it all load fresh.
- Bug fixes.

## 0.0.71 - 2026-10-09
- **Why tread matters** now loops: the rain never stops, the cars hold at their stopping points for a moment, fade, and drive in again. They face the right way, and an arrow marks where they started braking.
- **Why the better tires go on the back** has three scenes: understeer where the front tires skid, then grip again and the car stays on the road ("Phew!"); understeer where it runs off onto the grass but stays upright ("I'm okay!"); and oversteer, where it spins, rolls over and catches fire ("Not okay! Help!"). The front wheels turn and leave skid marks, and it loops too.
- Bug fixes.

## 0.0.70 - 2026-10-09
- **Your VIN stays private.** The VIN box shows dots like a password, with an eye to show it; the VIN no longer appears under Features, and the debug log writes [VIN] instead of it.
- **Why tread matters, animated.** Three cars brake from the same speed on wet roads in the rain: on new tires the car stops at the stop sign (158 ft); on worn tires they slide 68 and 143 ft past it.
- **Understeer vs oversteer, animated.** On a wet curve, the car with the better tires on the back runs wide and grips again; the one with worn rear tires spins off the road and rolls over.
- Both open as their own pages from Tires, with Back to return.
- Bug fixes.

## 0.0.69 - 2026-10-09
- **Tires, rebuilt around safety.** The line under Tires shows the type, a fuel-economy score out of 10, the wear rating and the tread left, each colored from green to red. Tire details fold away once filled in; the tread is in front.
- **Each tire on its own.** Turn on "My tires aren't all the same" to measure each corner (plus dual or trailer wheels). Gasket says where each tire should go: the better pair always on the rear, and worn tires replaced instead of moved back (on a front-wheel-drive car with worn fronts: new ones on the rear). It allows for your drive, including all-wheel drive's need for matched tires.
- **Pictures that show why:** how much farther worn tires take to stop on a wet road (Discount Tire's test figures), and understeer vs oversteer.
- **Your spare tire.** Gasket asks Brave Search whether your car has a full-size spare, a compact one, a repair kit or none, for you to confirm. Advice asks you to tick "I aired up my spare" every month, and Departure reminds you; no spare gets a plan for a flat.
- **Observed mileage:** one (?) for what the numbers do, "Log mileage" in its own menu (with a date), and the log as a table you can sort by any column and filter by mpg, mph, dates and city / highway / mixed.
- Advice: a recall still being rated shows a progress bar on its tile.
- Everywhere: every menu that opens has the same arrow on the right, and a small ↓ button shows when there's more below (↑ takes you back to the top).
- Bug fixes.

## 0.0.68 - 2026-10-09
- **Saved round trips open straight through.** A saved round trip kept being treated as changed at the Route step, which threw its routes away and stopped you there. Now its routes and leg picks stay, and you can jump from the Garage to Departure.
- **Tank size from Brave's AI answer, not a stray result.** The lookup waits for the AI answer instead of taking the first number on the page (a forum post about another generation). Without an AI answer, it uses the results about your car's year.
- Garage: the tank size box and its ↻ are one box, as wide and level as Vehicle type.
- Adjust: the marks on the buffer and detour sliders sit right over the knob, and the All roads line never passes your rule, even while you drag.
- Bug fixes.

## 0.0.67 - 2026-10-09
- **Switching cars no longer locks the buttons.** Recalls are rated only while Advice is on screen, a little at a time so taps get through, and the model's setup is saved instead of redone each launch. The route's fuel math for the new car waits until the Garage has redrawn.
- **Opening a saved trip shows it's loading.** "Opening your trip" with a moving bar sits where Next goes, and steps 2–7 are grayed out until it's open.
- **Step tabs show how far you can go.** A step is grayed out until everything before it is done. Once it's all done you can jump straight from the Garage to Departure (it used to stop at Adjustments while the stops were being found).
- Bug fixes.

## 0.0.66 - 2026-10-09
- **Recalls you can read.** Each recall is its own tile, most serious first: how serious it is, the part, and one line. Tap it for "What's wrong", "The risk", "The fix" and "When it began", each folded on its own.
- **A small AI model on your phone rates each recall** serious, moderate or minor, and says which kind of problem it reads most like. A loose axle hub that can cause a crash without warning comes out serious; a trunk latch, minor. The model (about 46 MB with its runtime) downloads once, the first time it's needed; recall text never leaves the phone.
- The tank size's ↻ is its own button next to the box.
- Bug fixes.

## 0.0.65 - 2026-10-09
- **Tank size looks itself up.** When a gas or hybrid car has no tank size, Gasket asks Brave Search's AI answer in the background and fills in the box, marked as Brave's answer so you know to check it. If that fails, the box has a ↻ to try again and a "Search Brave yourself" link that opens the page for you. Typing it in always works.
- Bug fixes.

## 0.0.64 - 2026-10-09
- **A VIN finds the car's mileage again.** The Garage redrew itself in the middle of matching a VIN to the EPA, which cleared the year and left the car without mileage. The match also uses the VIN's drive and engine, so a 2008 Charger with all-wheel drive and a 3.5-liter V6 gets the EPA's "Charger AWD" and that engine.

## 0.0.63 - 2026-10-09
- **Recall checks read NHTSA's answer.** The page shows the count and "Unrepaired Recalls" with no space between them ("0Unrepaired Recalls"), and the reader missed it.

## 0.0.62 - 2026-10-09
- **Fixed the recall check that never ran.** A check cut short by closing the app no longer holds the next one back for half an hour while Advisory says "Checking…".

## 0.0.61 - 2026-10-09
- **Faster recall checks:** the background check follows NHTSA's page when it reloads itself, so it answers in seconds instead of hanging until it gives up. A try that gets no answer stops after a minute.

## 0.0.60 - 2026-10-09
- **Saved round trips keep their routes.** A trip that starts from your location no longer drops its saved routes and looks them up again because you've moved a little since saving it.

## 0.0.59 - 2026-10-09
- **Recall checks work:** Gasket now reads NHTSA's "N Unrepaired Recalls Found" answer. It was waiting for older wording and never saw it.
- Bug fixes.

## 0.0.58 - 2026-10-09
- **The buffer and detour sliders snap** to their green, yellow and usual marks, with a tick each time the knob lands on a new one.
- **All roads keeps your rule.** Two small toggles under the slider, "No faster than 70 mph" and "As slow as the trucks", decide whether it follows your top speed and the truck limits.
- **Speed sliders stay smooth while you drag.** The heavier checks run when you let go.
- The background recall check logs exactly why NHTSA didn't answer.
- Bug fixes.

## 0.0.57 - 2026-10-09
- **Loading looks finished sooner.** Adjustments, Stops, Advisory and Tires show their tiles right away, with a loading bar inside each that says what it's waiting on.
- **Routes come by themselves** whenever the Route step has a link or both addresses, including a trip you come back to.
- **Haptics only where they help:** a light tick on each step of the fuel gauge and the buffer and detour sliders, and nowhere else.
- The background recall check starts reading NHTSA's page as soon as it's drawn, tries again after half an hour if it gets no answer, and logs what the page showed.
- Bug fixes.

## 0.0.56 - 2026-10-09
- Fewer popups: a missing field is shown by its outline alone, and results show in place. Popups are left for errors and for saving, backing up and restoring.

## 0.0.55 - 2026-10-09
- **Fixed:** opening Year / make / model on a car with a VIN kept filling itself in, clearing and filling in again, and wiped the tank size. It now shows your car once, and a car keeps its tank size unless you switch it to a different car.
- **Recalls check themselves.** With a VIN in the Garage, the check at NHTSA runs in the background soon after the app opens and again every week, so Advisory is ready when you get there. The "Check my car at NHTSA" button only shows up when the background check couldn't get an answer.
- **Routes come by themselves** once a link is pasted or shared, or both addresses are filled in. Get routes comes back only after you change avoid tolls / highways / ferries or round trip.
- **The leaving time can't be in the past.** A past time is set back to now.
- **The fuel gauge snaps to sixteenths** and its tabs are Gauge, Miles left, Percent. Each one's rounding advice is a Tip like the one in Adjustments, and the extra gallons and miles line under it is gone.
- **"Your tank's gas" sits next to Buffer**, with the other things about your tank.
- Every mark on the buffer and detour sliders shows what it saves or costs. A third row of labels makes room, and a mark with no room for its label isn't drawn.
- Adjustments' tip: cheaper stations farther off the route count, but only if they save more money than the extra miles cost.

## 0.0.54 - 2026-10-09
- **A fuel gauge in Parameters.** Say how much gas you have the way your dash shows it: drag the needle (it snaps to eighths, with a low-fuel light near E), or switch to a percentage or the miles left on your dash. It shows what that comes to in gallons and miles. Each way nudges toward a slightly low guess, since a stop planned a little early costs almost nothing. Electric cars get percent or miles.
- **Adding a car is one menu.** The VIN box comes first, outlined in green and marked Recommended, since it gets your exact version, open recalls and factory tire size. Year / make / model sits under it, and a VIN lookup fills it in.
- Removed the license plate option. No free source turns a plate into a VIN.
- The Tires card's summary line is styled like About this car's.
- The built-in example garage and all test data use generic places and example cars.

## 0.0.53 - 2026-10-08
- **Tires** have their own card in the Garage:
  - **Size:** your trim's factory size is looked up at Tire Rack (for example 195/65R15 for a 2020 Corolla Hybrid LE). If a trim came with several sizes you pick yours, and you can always type it from the sticker inside the driver's door.
  - **Type → brand → model:** chosen from the tires Tire Rack sells in that size. Picking one fills in its wear rating (treadwear, traction, temperature) and the maker's mileage warranty. "Other…" lets you type anything.
  - **Tread left:** measure it with the coin tests explained in the (?), or let Gasket estimate it from the miles on the tires, their expected life, and whether they're rotated regularly.
- **Advisory** gets a Tires card when there's something worth knowing: worn tread (a red dot when it's time to replace them), skipped rotations, or a low wet-traction grade.

## 0.0.52 - 2026-10-08
- **Your VIN is checked for open recalls by itself**, in the background like the price sites, when you add a VIN and then about once a week. If NHTSA doesn't answer, Advisory says so in one line and the "Check my car at NHTSA" button opens its page for you.
- **Range tile** next to City / Highway / Combined: how far a full tank or charge goes at highway mileage (yours if you've logged it). The math is in its (?). It replaces the "About … mi on a full tank" line.
- Less noise in the Garage: the best-cruising-speed card no longer repeats the car's name, and About this car drops its intro line.
- Plain words first, then the technical term in parentheses: "Hybrid automatic (eCVT)", "Front-wheel drive (FWD)", "No turbocharger (naturally aspirated)". The three camshaft layouts now sit together in the features list.

## 0.0.51 - 2026-10-08
- **About this car, reworked.** Powertrain, engine, air intake, transmission and drivetrain show as tiles, in plain words like "3.5-liter V6" or "Automatic, no fixed gears", with a (?) on each that explains it.
- **A ▾ only where your car could differ:** when the EPA lists more than one version of your model (for example, the 2012 Venza's V6 and four-cylinder versions, each with front- or all-wheel drive) and you haven't entered a VIN, the tiles that differ get a ▾ to pick yours, which loads that version's mileage and details. With a VIN there's nothing to pick. Cars you build yourself keep the menus.
- **Features checklist:** collapsed by default, alphabetical, with checkboxes and a (?) on every feature. What the VIN or the EPA confirms comes pre-checked and labeled, and unchecking one asks first. A car can have only one camshaft layout, so picking another swaps it, and asks first if the records say otherwise.
- The seeded Venza is linked to its EPA record.

## 0.0.50 - 2026-10-08
- **New Advisory step**, right after Garage: things worth knowing about your car before you drive. Its tab shows a red dot when something needs a look.
- **Safety recalls moved here from the Garage.** It lists every recall on record for your year, make and model. With a VIN, "Check my car at NHTSA" opens NHTSA's own recall page with your VIN filled in. Gasket reads its answer ("N unrepaired recalls") and remembers it, shows any open recalls with what they fix, and suggests checking again after three months. The page is always shown to you. Gasket never runs it hidden and never gets past its checks for you.
- **Worth turning off:** if your car has cylinder shut-off or engine stop at red lights, Advisory explains what each does, why it can wear the engine, and how to turn it off. Mark each one "I've turned it off" or "Keep it on". Hybrids aren't told to turn off engine stop.
- Departure now mentions open recalls from your VIN check, or recalls on record that haven't been checked yet.
- Removed the stolen-car (NICB) check; its site needs a CAPTCHA.

## 0.0.49 - 2026-10-08
- **Licenses & credits:** Settings → About lists the open-source code Gasket includes (Leaflet, the U.S. state outlines) with their full license texts, credits every data source, and shows Gasket's own license.
- **Google Maps credit:** a small "Google Maps" label wherever Google's stations, prices or routes appear: the station list, a station's details, the map's credit line and the trip planner. Demo data doesn't get it.
- `COMPLIANCE.md` lists the services' terms-of-use questions to settle before a public beta.

## 0.0.48 - 2026-10-08
The first Gasket build.
- **Renamed to Gasket.** The application ID is now `com.bensanzone.fuelmap` (was `com.ben.gasmap`), so Gasket installs as a separate app next to Fuel+ Map, and it's signed with a new key.
- **Moving from Fuel+ Map:** in Fuel+ 0.0.47 use Settings → Your data → Save full backup, then in Gasket use Restore full backup and pick the file from `Download/FuelPlus`. Everything comes over, including API keys, cars, trips, saved searches and this month's lookup counts (the higher count is kept). The restore, and the restart after it, use no Google lookups.
- New full backups are saved to `Downloads/Gasket` as `gasket-full-backup-….json`.
- Exports, logs and reports save to `Downloads/Gasket` with `gasket-…` file names. Data files exported by Fuel+ Map and trips it shared (`-----FUEL+ TRIP-----`) still import.
- The APK is now `Gasket.apk`. `build.sh` stops with a clear message if `KS_PASS` or the keystore is missing, and no longer creates a new signing key on its own.
- Version names follow `0.0.<versionCode>` (see `VERSIONING.md`).
- Fixed: the "Speed settings" panel on the cruising-speed card could snap shut when you changed a value right after opening it.

## 0.0.47 [Fuel+ Map] - 2026-10-08
- Still Fuel+ Map (`com.ben.gasmap`, old signing key) so it installs over 0.0.46: a migration build.
- Settings → Your data → Full backup: save and restore everything (settings including API keys, cars, trips, every saved search and price, bad CITGO list, debug log, this month's Google lookup counts). Restoring replaces everything; lookup counts keep the higher number so the monthly cap still holds. Uses no lookups.
- Versioning switched to `0.0.<versionCode>`.

## 0.0.46 [3.25] - 2026-10-08
- EV and hydrogen basics: ⚡ map panel (fetch every hydrogen station, shade areas out of a fuel-cell car's reach, find DC fast chargers); EV/H₂ trips use chargers or hydrogen stations from the DOE station finder; EV plans charge to 80% and count charging time.
- Garage rework: car chips with ✕, optional trim, units follow the car (gal / kWh / kg), cruising-speed card above fuel economy, new "About this car" tile.
- VIN lookup (NHTSA vPIC) with automatic EPA match; NHTSA recall card with NHTSA/NICB check buttons; plate lookup explained as unavailable.
- Confirmation before every delete (Settings → General → Ask before deleting).
- Saved trips open on Garage and remember route picks.

## 0.0.45 [3.24] - 2026-10-07
- Departure shows miles / driving time / fuel stops as tiles.
- Adjustments always starts fresh (speed-by-road submenu resets on open, new trip and close).

## 0.0.44 [3.23] - 2026-10-07
- Removed the route picker shown before "Get routes" and the "Cheapest…" slider blurbs.
- "Make X my usual buffer / max detour" links; "Adjust speed by road" submenu entry with Discard/Save adjustments.
- One map bubble per station stopped at more than once ("1, 3").

## 0.0.43 [3.22] - 2026-10-07
- New Adjustments step (Garage, Route, Parameters, Adjustments, Stops, Departure) holding the buffer, max-detour and speed sliders, with a green tip box.
- Short step labels on narrow screens.

## 0.0.42 [3.21] - 2026-10-07
- Max-detour slider; speed-by-road submenu with Discard / Save and continue.
- Drag the trip panel from the step tabs; Departure panel fits its content and re-centers the route.
- Better bubble spacing (24 angles, spacing cost, repair pass).

## 0.0.41 [3.20] - 2026-10-07
- Bubbles avoid only the visible top controls and re-place when the panel resizes; multi-pass placement.
- Speed by road holds the panel at 75%; bigger drag handles.
- Troubleshooting report and log shared as a file (native saveAndShare), fixing the hang.
- Logos from the brand's home-page icon link as a further fallback.

## 0.0.40 [3.19] - 2026-10-07
- Price bubbles with diagonal leader lines at any angle; lines never cross; bubbles never on the route.
- Logo fallbacks (DuckDuckGo, site icons, retry each start); draggable main list.

## 0.0.39 [3.18] - 2026-10-07
- Main map: canvas station dots and placed price bubbles (labels.js); brand logos via native fetchIcon; stations' own names.
- "Hide stations with no price" (trips still use them at an estimate where nothing priced is in reach).
- Numbered trip lists; loaders after 0.75 s; faster route switching and reopening; reuse of a saved trip for a similar link.

## 0.0.38 [3.17] - 2026-10-07
- Stop-tile button layout fix; diesel own-risk checkbox only on diesel.
- Settings: Clear cache, Delete bad CITGO list (Undo), Erase all data (two taps).

## 0.0.37 [3.16] - 2026-10-07
- Bad CITGO list (Undo, settings page, map pins); Walmart+ not counted on CITGO diesel unless you take the risk.
- Export / import of your data (adds only); tappable trip price bubbles.

## 0.0.36 [3.15] - 2026-10-07
- Checks which Exxon/Mobil stations take Walmart+ via ExxonMobil's station finder; CITGO discount marked unconfirmed.

## 0.0.35 [3.14] - 2026-10-06
- No automatic price search on app open (new setting, off by default); refresh-spinner style fix.

## 0.0.34 [3.13] - 2026-10-06
- Explicit "Get routes" / "Refresh routes"; later steps dimmed until routes load.
- Chosen stops shown with price bubbles on the big map; numbered gas tiles per place; forward-only speed-limit progress.

## 0.0.33 [3.12] - 2026-10-06
- Five steps (new Parameters step); settings re-plan on entering Stops.
- Garage split into three tiles; numbered place lists; speed-by-road road highlight band; single "Open in Google Maps" button with per-leg links above 9 stops.

## 0.0.32 [3.11] - 2026-10-06
- Layout fixes for long names and large text (no sideways scrolling).

## 0.0.31 [3.10] - 2026-10-06
- Faster step switching (steps kept built); Android sideways-scroll fixes; overflow tests.

## 0.0.30 [3.9] - 2026-10-06
- Trip planner becomes a 4-step panel (Garage, Route, Stops, Departure) with Back/Next checks.
- Trip button picker (new / continue / recent trips); monthly Google lookup counter in the top bar.

## 0.0.29 [3.8] - 2026-10-06
- "Gas to leave with" read straight from the plan; collapsible speed-by-road with pinned chart and filters.

## 0.0.28 [3.7] - 2026-10-06
- Floating (?) popovers; Maps link / Addresses toggle; "Leaving" date/time; collapsible stop cards; route framing button; fewer speed-limit lookups.

## 0.0.27 [3.6] - 2026-10-06
- Stops planned at your cruising speeds; buffer and speed sliders limit each other; road filters and sorting.

## 0.0.26 [3.5] - 2026-10-06
- Truck speed limits from state law; linked buffer and speed sliders; required-field markers.

## 0.0.25 [3.4] - 2026-10-06
- "Round trip" switch adds a real return leg; redesigned buffer markers.

## 0.0.24 [3.3] - 2026-10-06
- Trips with stops in between routed one leg at a time with a route pick per leg; round trips count stations both ways and skip re-searching the way back; one Maps link per leg.

## 0.0.23 [3.2] - 2026-10-06
- Club CITGO day bonuses applied automatically; "Gas to leave with"; trip history (25 trips, reopened with no lookups).

## 0.0.22 [3.1] - 2026-10-05
- Explanations moved behind (?) buttons; station dots shrink as you zoom out.

## 0.0.21 [3.0] - 2026-10-05
- Default "+N over the limit, capped" speed rule; prices to the cent option; touch-safe sliders.

## 0.0.20 [2.9] - 2026-10-05
- Route options on a small map; one speed slider per posted-limit section.

## 0.0.19 [2.8] - 2026-10-05
- Performance for very long routes (spatial grid, lite plans, canvas dots).

## 0.0.18 [2.7] - 2026-10-05
- Speed sliders per major road (from route instructions) plus an "All roads" slider.

## 0.0.17 [2.6] - 2026-10-05
- Parallel lookups; native key/value store for saved answers; exact rebuild of Google Maps' route options.

## 0.0.16 [2.5] - 2026-10-05
- Fixes to route-option matching (thousands separators, longer waits, looser same-route test).

## 0.0.15 [2.4] - 2026-10-05
- Reproduces every route option Google Maps shows; pinned trip-speed chart and total.

## 0.0.14 [2.3] - 2026-10-05
- Per-leg cruising-speed sliders using posted limits (FHWA HPMS, state maximums as fallback).

## 0.0.13 [2.2] - 2026-10-05
- Garage with several cars, fill-up log and the best-cruising-speed card.

## 0.0.12 [2.1] - 2026-10-05
- Buffer slider with background re-planning; optional check of Google's other routes.

## 0.0.11 [2.0] - 2026-10-05
- Oldest archived build: price map (Walmart, Murphy USA, Sam's Club, Exxon, Mobil, CITGO) with Walmart+/Club CITGO discounts, and a trip fuel-stop planner from a Google Maps link.

## 0.0.1 – 0.0.10
- Built between 2026-10-03 and 2026-10-05; no source or notes survive. Old version names unknown.
