# Gasket

A personal Android app (formerly Fuel+ Map) that maps gas stations from the brands its owner's discounts cover. It shows the price after discounts and plans the cheapest fuel stops for a Google Maps route. Application ID `com.bensanzone.fuelmap`. Alpha; it is published only once there's a beta release candidate.

## Layout
- `src/com/bensanzone/fuelmap/MainActivity.java`: the only Java class. It hosts a WebView and exposes the `Native` JS bridge, plus `GasketSite` for the hidden site WebViews.
- `assets/web/`: the whole UI, in plain HTML/CSS/JS with no framework or bundler. `trip.js` is pure logic and also runs in Node. `app.js` contains a browser stand-in for `Native`, so the UI runs in desktop Chrome.
- `assets/*_worker.js`: scripts injected into hidden walmart.com, murphyusa.com and Google Maps pages.
- `build.sh`: a Gradle-free build (aapt → javac → dx → zipalign → apksigner) that writes `Gasket.apk`.

## Commands
- All tests: `tests/run_all.sh [screenshot-dir]`. That's the Node unit tests plus the Playwright UI tests, about 8 minutes.
- One Node test: `node tests/trip.test.js`. One UI test: `python3 tests/ui_test.py /tmp/shots`. The UI tests use the browser at `$CHROME`; the session-start hook sets it in cloud sessions.
- Syntax check: `node --check assets/web/app.js`, `python3 -m py_compile tests/ui_test.py`. The `assets/*_worker.js` files are bare anonymous functions that the Java side wraps before injecting, so check those wrapped in parentheses.
- Build: `KS_PASS=… KEYSTORE=/path/to/release.jks ./build.sh`. It fails if either is missing and never generates a key. The keystore and its password never go in the repo, logs or commits.

## Rules (from the owner; keep them)
- No user price reporting. If no source has a price, show the station without one.
- No CAPTCHA bypassing. Bot checks are completed by the user in a visible WebView.
- Never log, print, commit or export API keys or the keystore password. `log.js` scrubs keys and exports drop them.
- No horizontal scrolling anywhere. The UI tests check every step at 320–448 px and at 130% text size.
- Keep Google API use low: there's a monthly cap (default 900), answers are cached, and nothing searches automatically on open.
- No Play-services APIs. The target phones are Pixels on GrapheneOS.
- Test data uses generic public places (state capitols, "100 Main St", "Testville"), never real personal addresses, coordinates or share links.
- Keep compatibility: imports accept old Fuel+ exports (`fuelPlusData`) and old shared trips (`-----FUEL+ TRIP-----`).

## Versioning and commits
- `versionName` is always `0.0.<versionCode>` (see `VERSIONING.md`). Each bump gets a `CHANGELOG.md` entry.
- Use conventional commits (`feat:`, `fix:`, `chore:`, `test:`, `build:`, `docs:`, `refactor:`).
- Licensed under the Source First License 1.1 (`LICENSE.md`). Third-party code keeps its own licenses (`THIRD_PARTY_NOTICES.md`).
