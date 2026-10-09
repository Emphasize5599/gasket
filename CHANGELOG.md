# Changelog

Gasket (formerly **Fuel+ Map**). Version names follow `0.0.<versionCode>` (see `VERSIONING.md`).
The old name each build shipped under is in brackets, e.g. `0.0.46 [3.25]`.
Dates are when each build's source was archived (America/Chicago).

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
