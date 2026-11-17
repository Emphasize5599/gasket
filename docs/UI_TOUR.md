# UI screenshot tour

An on-demand gallery of every Gasket screen, at Pixel 10 Pro width (412 CSS px), in light and dark.

## Run it

- GitHub: Actions → **UI screenshot tour** → Run workflow. Download the `gasket-ui-tour` artifact.
  Optional inputs: a comma list of tests to use instead of the default set, or "Demo walk only".
- Locally: `node tools/ui-tour/run.cjs [out-dir] [--only-core] [--tests a,b]` (default out-dir `tmp/ui-tour`).
  It needs Playwright with Chromium (as the regression tests do). About 20 minutes for the full set.

Output: `light/` and `dark/`, each with `index.html` (searchable list), `viewer.html` (one screen at a time,
← / → keys) and `img/`. Locally, `gasket-ui-tour.zip` holds both.

## How it works

- `core.cjs`, the demo walk:
  - First-time setup.
  - The four demo vehicles and fixture stations on the map, plus a station's details.
  - Every Settings group, plus Garage, the car editor and Advisory for each demo vehicle.
  - A mocked trip (Prius, Tesla, Mirai) through every step.
  - On each screen it opens every tile and saves it. It then tries each option that can reveal other controls
    (switches, segmented choices, radios, dropdowns of up to 8 choices). A variant is saved only when it shows or
    hides controls. It also follows each submenu entrance (`.sub-ent` and similar), up to three levels deep.
- `hook.cjs` is loaded with `node --require` into about 40 existing UI tests. After each page action it saves the
  screen on top. The tests reach states the demo walk can't set up: planned stops, rest lists, reviews,
  dialogs, pickers. The tests run unchanged; a test failing only loses the rest of its screens.
- `snapshot.cjs` copies the top screen's DOM in the page (read-only). Copied are: form values, canvas pixels, and
  the dialog, picker, submenu, setup, Settings, trip panel or station details on top. Screens are deduplicated
  by a signature of their headings, labels and buttons, with numbers ignored.
- `render.cjs` redraws each saved screen at 412 px with scrollers unrolled, tiles open, and sticky/fixed parts
  laid out in place. Screens over 14,000 px are split into parts. Map screens are live screenshots in the
  test's own theme and width, because the map can't be redrawn from a copy; map tiles are blocked offline.

Screens come from mocked data. Prices, routes and hazards are fixtures, and images that need the network are blank.
