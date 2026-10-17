# Reader measurements

## 0.0.181 — invisible desktop reader resource filter (2026-10-17)

Visible Edge, Linux-desktop Chrome 141 user agent matching Android's gas readers,
1280×900, new browser contexts and equal cold-cache routing. JavaScript, CSS,
cookies, storage, fetch/XHR, security code, station requests and real pagination
remain enabled. Only hidden **gasweb** readers receive the new filter: the
app's map, route-link reader, official station sites and visible checks do not.

The initial profile found a ~2.76 MB `mapcore` graphics Wasm download. The filter
omits that specific graphics engine, `/maps/vt/` graphics requests, its static
`CompactLegend` renderer fallback, and the measured `/maps/preview/log204`
telemetry endpoint. Unknown Wasm/scripts/RPCs are allowed. Existing image/font/
media suppression remains. Empty local responses omit network transfers; their
intentional graphics compile error is captured in benchmark diagnostics, not
treated as a station-data error.

| Matched area | Before transfer | Lightweight transfer | IDs / price comparison |
|---|---:|---:|---|
| Searcy (first graphics experiment) | 4.39 MB | 1.46 MB | Same 120 IDs, identical prices |
| Little Rock (native-equivalent policy) | 4.40 MB | 1.80 MB | Same 120 IDs, identical prices |
| Bald Knob (native-equivalent policy) | 4.40 MB | 1.80 MB | Same 120 IDs, identical prices |

The exploratory filter is not exactly the native visual-response behavior;
quote the native-equivalent **~59%** transfer reduction, not the best exploratory
67% as a guaranteed APK saving. Three later paired Searcy samples reached 120
DOM cards each. Some changed station identities or price availability between
requests: one exact 120-ID/price pair, one common-ID price difference, and one
pair with 1 missing/3 extra identities. Counts alone do not prove equivalence.
Within the app's eight-mile search radius, all four later Searcy pairs matched
the same 39 station IDs and all prices; Little Rock matched 118 and Bald Knob 17.
The final Searcy shipping check had larger differences among distant results
(19 missing/18 extra), but again identical in-radius identities/prices. The
harness now records both scopes explicitly instead of hiding distant changes.

Those three pairs measured ~469–480 MB versus ~240–248 MB **renderer private
committed bytes**, and ~456–466 MB versus ~310–316 MB summed renderer working
sets, sampled after main-page GC. Only renderer PIDs from the isolated test
browser were queried. Private commitment is not resident RAM; summed working
sets can double-count shared pages. JS-only retained heap actually rose from
~33 MB to ~36–37 MB because Maps loads a JS graphics fallback. Windows Edge is
not Android WebView: don't multiply these figures by 50 or promise twice as
many phone workers. Admission/backoff/defaults are unchanged; manual max is 50.
Successful scans stayed around 14–15 seconds: this is principally a transfer/
memory optimization, not a claimed large single-reader speedup.

Repeated experiments also exposed an intermittent 20-card first-page stall.
The reader now nudges a stuck bottom position to trigger a late pagination
listener. A quiet list is no longer called exhausted or cached as complete.
Native retries an unreadable lean page (no feed after 8 seconds), or an
unconfirmed quiet/stalled discovery, **once** with the old normal-resource
policy, same request/cookies and original overall deadline. Partial identities
survive recovery; newer exact-ID records win, with no borrowing of old prices
when the newer record lacks/invalidates them. Blocked/cancelled/missing-grade
results never initiate a retry. Visible verification always restores normal
resources. Diagnostics include resource omission counts, `fullResourceRetry`
and retained partial counts. Some real sources may still end without proving
exhaustion; no complete-world-coverage promise is made.
Older discovery-cache entries ending `quiet` are ignored; valid end-of-list
caches remain reusable rather than forcing every area to reload.

Price parsing now shares empty traversal results for irrelevant JSON leaves,
reuses the grade dictionary and avoids temporary label/amount arrays. On 12
captured public response frames, old/current parser outputs were identical.
Three offline samples (20 passes over all frames) took old 1507/1417/1414 ms
versus current 1048/1024/1018 ms (~28% median reduction). This is parser CPU,
not a 28% whole-route speed claim. Limits, grade labels and ambiguous-price
rejection remain. Real non-regular price availability is still unproven in the
limited Maps view; never substitute regular.

Rejected: disabling WebGL itself raised JS heap (~50 MB) and lost 37 common-ID
prices despite 120 cards. Disabling only mapcore saved fewer bytes because its
fallback downloaded ~0.66 MB of vector legend/transforms. Account-toolbar
blocking yielded no meaningful additional saving after graphics omission and
was not shipped. Older no-CSS/no-JS/replay-observer rejections below still apply.

Regression coverage includes all four grades, ambiguity/missing-target guards,
bulk irrelevant JSON leaves, delayed scroll listeners, quiet-not-exhausted,
no-feed/bot-check outcomes and real Java filter/`finishRead` execution in CI:
same deadline/ID, one retry, partial retention, newer-record precedence, stale
replies, cancellation, restrictions, main frames and visible checks.

### Reproduce the new measurements

1. Run `node tools/reader-benchmark.js` with `NODE_PATH` and `CHROME` as below.
   Defaults compare `native-before,native-lite`, with the native-equivalent
   resource policy; the Java and benchmark mirror share executable test cases.
2. `READER_HEADED=1` uses a visible desktop browser. `READER_CENTER` is an
   explicit `latitude,longitude,zoomz` (default `35.2506,-91.7362,13z`).
3. `READER_REPEATS=1..3`, `READER_GRADE`, `READER_MODE=discover|refresh`, and
   `READER_VIEWPORT=1280x900` select opt-in experiments. Production geometry is
   unchanged. No parallel live runs for performance comparisons.
4. `READER_REPORT` saves full public records and aggregate URL-path traffic
   without query strings. Console prints aggregate results, not station lists.
5. Optional `READER_RAW_REPORT` saves public response frames locally, never in
   the repo. Use the same variable with
   `node --expose-gc tools/reader-parser-benchmark.js` for exact output and CPU
   comparison against 0.0.180. Capture overhead is opt-in, not APK code.
6. `native-lite-old` isolates 0.0.180 parser behavior under the new resource
   filter; exploratory profiles remain available explicitly. The harness
   emulates native's one retry and records first-attempt diagnostics.

## 0.0.180 — pagination baseline

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
