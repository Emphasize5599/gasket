# Rest-check counters and client throughput (0.0.343)

## Evidence from the 342 run
The screenshot combined three scopes under similar labels:
- Recommendation candidate access (8/8), a small sample for a single leg.
- New background-pass progress (60/3010), excluding earlier completed checks.
- Current trip-wide outcomes, including prior campground checks (24 verified, 234 excluded, 24 unavailable).

From the background-pass start to the last progress record, 131 directed access reads started over 130.1 seconds, about 1.01/second. Google pacing reported zero rate-limit responses; origin timezone failures were also zero in this pass. The six/second setting was an upper bound, not the observed rate, and each place can require two route reads plus other checks. There were six missing time-specific Google-profile warnings; recent campground facts also included 404s and unavailable campground timezones. Failures remain unverified.

## Profile and changes
A synthetic 3,010-site search, 4,801-point route and two legs reproduced severe CPU blocking with a 4x browser CPU slowdown and 40ms mocked replies. The baseline 12-second observation could not return until 20.4 seconds, recorded only one started request, and contained an 8,686ms main-thread task. Repeated local-time conversions and per-coordinate clock-window construction dominated the profile. Empty Maps URLs caused repeated parsing exceptions; list updates also rendered redundantly.

Fixes:
- Clock-only nightly windows share calculations by date, timezone and configuration; solar windows still include coordinates and elevation. Local-clock conversions use bounded exact-instant memoization and no longer perform an unnecessary second StopClock conversion.
- Nightly-fit results are reused only while arrival, timezone, configuration, site evidence and user edits are unchanged. Price filtering precedes expensive evaluation of hidden unknown-price fallback candidates; sparse fallback is still evaluated fully when needed. Background priority favors known-price candidates and avoids calculating a nightly preference for every hidden unknown-price candidate; all remaining checks are retained.
- An absent Maps URL returns immediately rather than throwing and catching a URL parsing exception for each place.
- Coalesced updates render a directory once, without an immediate duplicate redraw and another delayed duplicate.
- Task and card use the same trip-wide resolved/total and verified/excluded/unavailable counters. Recommendation progress names the leg and sample phase, and switches to the forecast phase as soon as candidate access ends.
- Pacing diagnostics separate configured maximum from achieved request-start rate and record cumulative/maximum timer lateness. The fixed six/second provider ceiling and eight-read concurrency cap are unchanged.

The final identical simulated workload recorded **64 starts in 12.02 seconds (~5.3/second)**, a longest main-thread task of **879ms**, and **1,871ms total long-task blocking** versus 8,972ms in the baseline observation. This demonstrates that client processing can starve request scheduling and that these changes reduce it. These are mocked-network desktop measurements, not a promise of five/second on a phone or an assertion that all pauses are gone. Initial work still includes a substantial task.

## Validation and phone checks
Regression coverage exercises 3,010 clock-window lookups with bounded timezone conversions, solar/location separation, invalid zones and caller isolation, filtering before hidden fallback work, one render per coalesced update, and equal global counters in the task/card. Existing DST, polar-event, overnight eligibility, access failure/retry and timing tests remain required.

Retain the same trip and saved data. Compare the **All rest sites** task with the trip-wide card; **Rest suggestions / leg / Sample access** is a different, clearly labeled sample. Export a log after a minute to compare `actualRequestsPerSecond`, timer lateness, provider activity/queue and the global outcome snapshot. Do not interpret request rate as completed sites per second.

All 200 mandatory local release regressions passed in 292.9 seconds with three jobs. Focused UI/eligibility/rendering checks also passed. GitHub repeated all 200 regressions in 256.8 seconds and passed the native reservation gate, Android build and release-signature checks.

## Verified publication
Source commit `58d93eef04008cd5e0a96b855d9704a1c23eadf5` was published as [v0.0.343](https://github.com/Emphasize5599/gasket/releases/tag/v0.0.343). [Source release run 41358429967](https://github.com/Emphasize5599/gasket/actions/runs/41358429967) and [signed APK run 41358429992](https://github.com/Emphasize5599/gasket/actions/runs/41358429992) both succeeded; build job 125003409586 verified the existing signing certificate SHA-256 `94e3154b10bc95e47c34d1678205c1955e1788c4ed52819769b3e1fda391fa0e`.

Both versioned release assets were verified as uploaded:
- ARM64: 30,455,675 bytes; SHA-256 `76032db44a6f792e11d9c8cd9ff16b698d6bd44fbb81ffc0063d9d2ea9b2c71f`.
- Universal: 56,821,702 bytes; SHA-256 `77160ef9384cc109325e1dde5bf58331041fdcf2afc416e42b82b606c6ac2b6c`.

Phone/live-site verification remains outstanding; use the same-trip checks above.
