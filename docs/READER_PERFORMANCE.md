# Reader measurements — 0.0.180

Live public Maps pages around Searcy, Arkansas; headless Edge, 1280×900,
fresh browser contexts, cold routed loads. No private endpoint construction or
challenge bypass. `tools/reader-benchmark.js` runs the real production reader,
counts network requests/encoded transfer bytes through CDP, and retains complete
results in an optional local `READER_REPORT`. It is opt-in, never CI.

## Observations (2026-10-17)

| Profile | Time incl. navigation | Transferred | Cards at end |
|---|---:|---:|---:|
| Original reader, normal assets | 24.695 s | 5,603,129 B | 120 |
| Faster reader, normal assets | 16.003 s | 5,406,396 B | 120 |
| Faster reader, images/fonts/media blocked | 16.132 s | 4,595,092 B | 120 |
| No JavaScript (earlier probe) | 5.067 s | 137,618 B | 0 |
| No CSS (earlier probe) | 12.189 s | 4,142,121 B | 40 |

These are samples, not universal speed guarantees. Live result identities,
ads, closure status and prices vary between requests: 120 DOM cards is not
proof of an identical or exhaustive station catalog. The reader still checks
all pages; fixture tests enforce multi-page coverage, all four explicit fuel
grades, ambiguous-price rejection, missing targets, and cancellation.

The practical tested floor retains JavaScript, CSS/layout, scrolling, DOM,
fetch/XHR, storage and cookies. Removing CSS looked faster only because it lost
roughly two thirds of the list. No-JS did not build a feed. Do not disable other
capabilities speculatively. Images were already blocked in Android, so the
visual-assets byte reduction above is **not** an incremental APK improvement;
this release additionally blocks font/media assets for invisible gas readers.
Visible checks retain normal resources. Website file/content access, location
permission and unsolicited windows are unnecessary and disabled in those readers.

A separate live diesel probe reached 120 cards but no explicitly labeled diesel
prices. Inspection showed this headless limited-view page had no fuel-grade
selector. This is not evidence that the stations lack diesel. Keep existing
official price sources, never substitute regular, and validate full Android
WebView grade availability separately; the desktop capability floor is not a
guarantee that every website variant exposes every grade.

The shipped speedup reduces unnecessary stable-feed waiting (150 ms polling,
two stable samples), honors active loading indicators and still waits for the
end/quiet-list rules. Explicit adjacent-line grade/price labels are recognized.
A saved-price refresh ends before replaying a search response when every exact
target already has its requested grade. Unlabeled amounts never become prices.

An experiment observing fetch/XHR bodies, including document-start injection,
was slower (~34 s), captured only the initial response reliably, and did not
eliminate later replays. It and its extra AndroidX dependency were removed.
Further reducing Maps' own worker/graphics/RPC traffic needs separate evidence;
there is no claim that the mathematical absolute minimum has been found.

## Reproduce

Set `NODE_PATH` to the Playwright install and `CHROME` to a Chromium executable.
Run `node tools/reader-benchmark.js` from the repository. Optional variables:

1. `READER_PROFILES=baseline,fast,lean-fast,no-css,no-js`
2. `READER_GRADE=regular` (also midgrade, premium, diesel)
3. `READER_BASELINE=3cbf7e8` (original reader commit)
4. `READER_REPORT=/absolute/path/report.json` (contains public station details;
   console output is aggregate only)

Manual pool ceiling is 50, not a promise of 50 concurrent WebViews. RAM defaults
remain 4–20; admission still ramps up and retreats under pressure, with the
existing four-reader floor when enough work exists. Real-phone 50-reader stress,
Android WebView cache hit/miss tracing, and broader coverage equivalence remain
open work 16/17. Desktop/CDP transfer figures are not Android-cache measurements.
