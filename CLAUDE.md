# Gasket

A personal Android app (formerly Fuel+ Map) that maps gas stations from the brands its owner's discounts cover. It shows the price after discounts and plans the cheapest fuel stops for a Google Maps route. Application ID `com.bensanzone.fuelmap`. Alpha; it is published only once there's a beta release candidate.

## Layout
- `src/com/bensanzone/fuelmap/MainActivity.java`: the only Java class. It hosts a WebView and exposes the `Native` JS bridge, plus `GasketSite` for the hidden site WebViews.
- `assets/web/`: the whole UI, in plain HTML/CSS/JS with no framework or bundler. `trip.js` is pure logic and also runs in Node. `app.js` contains a browser stand-in for `Native`, so the UI runs in desktop Chrome.
- `assets/*_worker.js`: scripts injected into hidden walmart.com, murphyusa.com and Google Maps pages. `nhtsa_worker.js` reads NHTSA's recall page for a VIN: in the background (`Native.siteRead`, automatic, at most weekly) or shown to the user (`Native.siteShow`, the button). If the page shows a check (CAPTCHA, Access Denied) the read reports `blocked` and stops; nothing ever gets past a check.
- Garage → Tires (`tires.js`, `TireMath` is pure and tested in Node): factory size and the tires in that size come from Tire Rack via `tirerack_worker.js` (`Native.siteRead`, cached; blocked = type it in). Tread left = measured, or new depth − (new − 2) × miles ÷ (life × rotation factor); life = mileage warranty, else treadwear × 100, else 50k.
- Garage → Tires is split: "Tire details" (size, type → brand → model, wear rating, fuel /10; collapsed once filled in), then Tread left (one answer, or each corner + extra wheels when `tires.corners.split`), then Spare tire. `TireMath.rotation` puts the better pair on the rear (understeer over oversteer) and never moves a tire at 4/32 or less to the rear (FWD worn fronts = replace); `fuelScore` is rules, nudged ±1 by `Severity.compare`. The spare's kind comes from Brave (`brave_worker.js` with `kind: 'spare'`, `parseSpare`), confirmed by you; Advice asks for "I aired up my spare" every 30 days. The two hidden Brave reads take turns (`Garage.braveSerial`).
- Every `<details>` gets the same chevron on the right (app.css); `A.scrollHint(el)` adds the ↓ / ↑ button to a scrolling area.
- `A.subPage(title, html, onOpen)` opens a submenu page (Back bar, phone Back closes it; onOpen may return a cleanup). Tires' "why" pages animate with requestAnimationFrame for a fixed time (then ▶ Play again), so tests settle.
- The VIN is private: masked in its box (eye to show), never shown elsewhere, and `log.js` writes `[VIN]` for any VIN.
- Garage → tank size: a gas / hybrid car with none asks Brave Search's AI answer once (`brave_worker.js`, `Native.siteRead` key `brave`; failed = ↻ in the box, or "Search Brave yourself" = `siteShow`). A check on Brave's page is never got around.
- Garage → About this car: `info.src` / `info.featSrc` record where each detail came from (`vin`, `epa` = confirmed; `user`). Versions of a model come from the EPA options for the year/make/model plus its 2WD/AWD sibling models; cars with no EPA record and no VIN are "custom" and keep the menus.
- Parameters → how much gas: `fuelgauge.js` (`FuelGauge.math` is pure and tested in Node). `S.trip.fuel` = `{mode: gauge | miles | pct, n16 (sixteenths), pct, miles}`; `S.trip.milesLeft` follows it for saved trips and old exports. EVs get percent or miles.
- Route: routes are fetched by themselves (`autoRoute`) whenever the Route step has a link or both addresses and no routes; changing avoid / round trip brings the Get routes button back until the link or addresses change. The first start after a restore never looks anything up by itself.
- Haptics: only `N.tick()` (a light tick) on each step of the fuel gauge and the buffer / detour sliders. Loading: show the real tiles with a bar inside (`A.ldBar(label)`, or `progBar` in tripui, which follows `prog()`), never a blank area.
- Advisory → recall severity: `severity.js` rates each recall on the phone with all-MiniLM-L6-v2 (transformers.js, downloaded once from jsDelivr / Hugging Face; `MainActivity.aiFile` keeps the files in `files/ai`) by comparing it with example sentences per level; ratings are kept by recall number (`S.recallSev`). NHTSA's park-it / park-outside flags are serious without the model. Tests use `__mocks.severity`, never the download.
- Trip steps: Garage, Advisory (`advisory.js`: recalls, engine advice), Route, Parameters, Adjustments, Stops, Departure. Use the `ST_*` constants in `tripui.js`, never bare step numbers.
- `build.sh`: a Gradle-free build (aapt → javac → dx → zipalign → apksigner) that writes `Gasket.apk`.

## Commands
- All tests: `tests/run_all.sh [screenshot-dir] [test names…]`. It runs every Node test and every UI test once per phone size in parallel (`JOBS`, default: CPUs), about 1.5–2 minutes. Pass names to run only some, e.g. `tests/run_all.sh /tmp/shots trip_ui restore`. `NO_SCREENSHOTS=1` skips the PNGs for quick runs.
- The UI tests import `tests/fastwait.py`: `wait_for_timeout(ms)` returns once the page has settled (no timers, animation frames or CSS animations due within the window) instead of sleeping the full time. If a test looks timing-dependent, rerun it with `SLOW_WAITS=1`, and in new tests wait for the condition you mean (`wait_for_selector`, a flag) rather than a fixed time. `VIEWPORT_INDEX=0|1` runs one phone size.
- One Node test: `node tests/trip.test.js`. One UI test: `python3 tests/ui_test.py /tmp/shots`. The UI tests use the browser at `$CHROME`; the session-start hook sets it in cloud sessions.
- README screenshots: `python3 tools/readme-shots.py` (demo data) writes `docs/screenshots/`; the Garage and Stops shots are copied from the trip UI test (`pixel10pro-w1-garage`, `pixel10pro-t2-result`).
- Syntax check: `node --check assets/web/app.js`, `python3 -m py_compile tests/ui_test.py`. The `assets/*_worker.js` files are bare anonymous functions that the Java side wraps before injecting, so check those wrapped in parentheses.
- Build a signed APK: `./build.sh`. Cloud sessions sign with `KS_PASS` and `GASKET_KEYSTORE_B64` from the environment settings; elsewhere, set `KEYSTORE=/path/to.jks`. It fails if either is missing and never generates a key. See `SIGNING.md`. Never print, log or commit `KS_PASS`, `GASKET_KEYSTORE_B64` or the keystore, and don't dump the environment (`env`, `printenv`).

## Rules (from the owner; keep them)
- No user price reporting. If no source has a price, show the station without one.
- No CAPTCHA bypassing. Bot checks are completed by the user in a visible WebView.
- Never log, print, commit or export API keys or the keystore password. `log.js` scrubs keys and exports drop them.
- No horizontal scrolling anywhere. The UI tests check every step at 320–448 px and at 130% text size.
- Keep Google API use low: there's a monthly cap (default 900), answers are cached, and nothing searches automatically on open.
- No Play-services APIs. The target phones are Pixels on GrapheneOS.
- Test data uses generic public places (state capitols, "100 Main St", "Testville"), never real personal addresses, coordinates or share links.
- Keep compatibility: Restore full backup accepts Fuel+ 0.0.47 backups (`fromPackage` `com.ben.gasmap`, same `files/kv/<namespace>/<sha1>` layout); imports accept old Fuel+ exports (`fuelPlusData`) and old shared trips (`-----FUEL+ TRIP-----`).
- A restore, and the restart right after it, never use Google lookups; restored lookup counts keep the higher number.

## Working with the owner
- Small changes don't need the full test suite; run it on a larger batch of changes (it catches anything a small change broke). Still syntax-check what you touched.
- Changelog entries: the big things that matter, plus a general "Bug fixes" line instead of listing each fix.
- No popups (toasts) for things the screen already shows: missing fields get an outline or pulse, results show in place. Popups are only for errors and for save / backup / restore results.

## Versioning and commits
- `versionName` is always `0.0.<versionCode>` (see `VERSIONING.md`). Each bump gets a `CHANGELOG.md` entry.
- Use conventional commits (`feat:`, `fix:`, `chore:`, `test:`, `build:`, `docs:`, `refactor:`).
- `main` is the default branch. Pushing a new version to `main` releases it: the Release workflow tags it `v0.0.<code>` and publishes source code only (see `VERSIONING.md`). Don't push tags yourself. Never attach an APK to a release.
- Licensed under the Source First License 1.1 (`LICENSE.md`). Third-party code keeps its own licenses (`THIRD_PARTY_NOTICES.md`). After editing either file run `node tools/gen-legal.js` (the app shows them from `assets/web/legal.js`; `tests/legal.test.js` fails when it's stale). A new bundled library or data source needs an entry there.
- Wherever Google Places/Routes content shows, add the "Google Maps" credit (`window.__app.gAttr()`). Open terms-of-service questions are in `COMPLIANCE.md`.
