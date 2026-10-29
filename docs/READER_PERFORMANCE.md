# Reader measurements

## 0.0.182 — phone-log findings and opt-in aggressive admission

The owner's two 0.0.181 scans were not controlled comparisons: different routes,
both canceled, with large-model generation overlapping the first scan. At a
configured ceiling of 50 the phone mostly admitted 4–8 readers (peak 9), reaching
6 MB available RAM; 46 areas completed in 207 seconds. The later 20-reader scan
sustained 20 with at least 4.4 GB available; 55 areas completed in 150 seconds.
These numbers do not establish a speedup from resource filtering or worker count.

Every final feed stopped quiet. Previously all quiet discovery feeds triggered a
second navigation, including ordinary short lists. Now only unreadable empty
feeds or suspected first-page pagination stalls qualify for one normal-resource
retry. Quiet still does not mean exhaustive, so these partial lists stay uncached.
Per-area diagnostics include retry flag/time, first stop/rows, omitted resources
and feed geometry; canceled in-flight areas no longer inflate completed/cache
counts. Page-load estimates exclude the first attempt's recovery overhead.

Aggressive mode is opt-in in Website workers (Settings and onboarding), ceiling
50. It starts up to 8 and ramps by 4 every 2 seconds with >=512 MB free. It halves
new admission below160 MB or OS-low below300 MB, waits 6 seconds before recovery,
and respects the four-reader floor or smaller manual limit. Active reads are not
canceled to change admission. Heat, OS kills and throttling remain possible.
Queued Gemma explanation work defers under low-memory scans until completion;
in-flight generation finishes and an idle model may unload without deleting it.

Next phone check: finish the model download/generation first; compare the same
trip, grade, forced fresh scan and 20-worker setting with aggressive off/on.
Then try 50 aggressive only if stable. Compare completed areas/minute, identities,
prices, actual concurrency, retries, available RAM and renderer losses—not the
configured ceiling. Android low-memory handling remains device-dependent.

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
Local omission responses explicitly use `Cache-Control: no-store` to avoid
contaminating the shared cache used by normal pages and recovery attempts.

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


## 2026-10-28: result commands and incremental list parsing (293)

Tested fresh desktop Edge,1280×900 desktop UA, identical GasReaderResources omission policy, no user login. Current Maps gas /search?tbm=map responses expose typed station records at field64; normal request head uses !7i20 and pagination !8i<offset>. Changing only these top-level fields on the current page's observed request to100results/page worked. No static request template/session token is bundled. Existing query, bounds and filters are retained. Records require explicit feature ID, name and valid coordinates; prices use the existing unique-ID/explicit-grade evidence parser. Explicit closure labels are excluded. Completion needs a verified empty result response, not a short page. Observed terminal scaffold:72-field array, query heading gas stations, finite3-value viewport, absent64,58=[0],71=[1]. Changed/missing schema, repeated page, timeout or size limits cause scrolling fallback;403/429/consent/challenge stops for existing verification flow.

| Live experiment | Candidate | Baseline | Coverage comparison |
|---|---:|---:|---|
| Searcy direct scroll event,150→75ms poll |11.77s|14.65s|119 IDs/59 priced, identical|
| Searcy scrollTo command + event |12.28s|14.65s|119 IDs/59 priced, identical|
| Reverse incremental-card run |11.96s|13.36s|Exact IDs/prices;120 parses,4240 unchanged-card skips|
| Searcy100-result commands |4.89s|14.27s|145vs119; broad rankings differ, needs area clipping|
| Searcy20-result commands |6.68s|14.87s|8mi40/40,12mi48/47,15mi57/56; no missing baseline ID or price differences|
| JFK100-result commands |7.60s|15.29s|225vs120; within8mi210/120,12–15mi216/120; no missing IDs/price differences|
| Searcy diesel UI |12.15s|13.51s|Both pages provide0explicit diesel prices; no invented regular-to-diesel fallback|

A missing far-away Maverik in the first100-result trial was near Little Rock (~50mi away), outside any app scan cell radius. This is why raw counts are insufficient. Google can expand its own returned viewport and change ranking with page size; Gasket's existing area clipping and station deduplication remain required. More records do not mean a full station catalog. No phone throughput, RAM or multi-reader speedup claim is established here.

Regular discovery ships with commands and verified scrolling fallback. Price updates and non-regular grades retain UI grade selection and incremental scrolling. Existing unknown/incomplete feed states stay incomplete. Added regression cases:100+2+empty pagination without scrolling, explicit closed exclusion, identity/schema fallback,429pause, DOM detach/change/reinsert price invalidation, blank-line price labels; existing all-grade/ambiguity/cache/retry checks retained. Mutation observer disconnects after each job.

Traffic is separately adjustable1–50 using the same RAM-based defaults as station readers. Native pool expires idle threads after30seconds; JavaScript semaphore and hourly allowance lanes respect the selected count. Human-verification browser recovery remains serialized. High overrides use the existing memory/site-restriction warning rule.


## 2026-10-29 — long cold route scan (303)

Owner302 log16:43: 781cells processed,779command ends +2scroll/quiet fallbacks,2302016mswall (38m22s),17228unique stations,175787command rows/2963pages. Overlap0.90 measures repeated station identities, NOT a measured out-of-cell percentage. Roughly6active readers on average with50selected. No reported blocked/failed areas; this does not prove exhaustive Google coverage. Warm147cell pass20.8s. Official-provider work697776ms overlaps the web jobs; do not add it to total wall time.

The100-result request retains the original query/viewport but Google may expand ranked results. Existing controller already clips EVERY station to the area's geographic radius before persistent cell completion. Thus distant returned records were not accepted into that cell. Add earlier reader clipping and bulkOutside diagnostics to avoid unnecessary record processing/bridge transfer; an all-outside command answer verifies by scrolling. Never stop pagination just because a page includes outsiders.

Found a throttle mismatch: netStep's16/22s thresholds measured a whole multi-page cell as one network request. A healthy4page20scell could back off to4–8lanes. Normalize successful command duration by completed pages (at most4); failed/fallback work retains raw duration and existing cuts. Memory admission, bot-check pause, cancellation, retry and coverage rules stay in force. Log networkCap/effectiveReaderTarget separately from configured/memory target. High counts still may not be fastest on a phone.

Settings/onboarding now offer100-result commands (existing default), original20-result commands and pure scrolling for real-phone A/B measurement. Same persistent cell cache across methods; use Rediscover for comparison. No claim that100is universally faster or that scrolling guarantees more stations. Prior desktop evidence above remains scoped to those places. Tests cover all modes, terminal pagination, bounds, malformed identity, closed stations, site checks, cache and simulated link throughput.


## 2026-10-29 - 308 warm command readers

Owner306 18:09 log is a canceled cold scan:197/784areas in576s,2708final stations,0still-failed areas,15canceled in-flight. Selected50/aggressive; peak18active and adaptive cap often4-15, available RAM>=1187MB, no renderer losses. Commands processed41253records,35394outside (85.8%). Median whole read29.7s versus reader work around20s; p90 page-load/dispatch gap37.9s, max whole read251.8s. Persistence23.4s aggregate is measurable but not the main29minute estimate. Official-source work overlaps, not additive.

308 retains one successful regular-command Maps document per lane for up to16 completed reads. The next cell reuses the page's captured request template, changing validated center and viewport scale/zoom to match that cell's existing URL. No smaller search radius, skipped pages, shared coverage stamps or invented stations. Query/filter tail stays captured, not a shipped protobuf template. Each cell still requests pages to explicit end and clips all records; failed schema/geometry/repetition/deadline/all-outside reuse returns command_reload. Native reloads the requested cell under the same request/deadline before the established normal-resource/scroll fallback. Restrictions remain blocked and pause the scan. Failed and other-grade reads clear the page, idle/pressure/cancel releases still destroy readers; every16 successful commands recycles. No credentials in logs.

Discovery no longer reinjects pricing.js and keylessgas.js: these were only used by saved-station price matching. Typed command price traversal now examines in-cell station records, skipping evidence allocation for outside records; raw JSON identity validation and full pagination remain. Successful command network feedback uses measured bulkMs per page, excluding navigation/bridge/verification waits; failed/fallback reads retain conservative raw timing. Log summary includes warm-use count; rows append commandReused/nativeReadMs. Memory/site/retry limits unchanged.

Desktop Edge1280x900, same omission policy, actual patched worker: warm Bald Knob3.32s versus cold4.20s; warm Little Rock6.34s versus cold7.44s. All in-radius IDs matched paired runs (18/18 and178/178). Cold Bald Knob also briefly saw a DOM-only Phillips66 about25mi away; existing controller discards it, so it is not missing app coverage. Searcy first cold6.55s/41raw records. Earlier isolated commands across centers completed2.5-3.1s. Timing is sequential and cache/order/network-sensitive, NOT a phone or50-reader speedup claim. Narrower viewport exploratory samples retained40/40Searcy IDs but were not shipped: insufficient broader coverage evidence. Raw experiments in tmp, not bundled.

Tests: command reuse recenter/zoom, no old DOM leak, explicit end, schema reload without coverage,429block, scoped price evidence; adaptive/slow-link, retries, cell reuse, station merge and grades. Phone check: same cold trip/settings, compare completed areas/minute and network/effective cap, warm count, dispatch gaps, prices and actual completion. Avoid comparing only the initial ETA. Freshly remembered cells and prices remain durable.
