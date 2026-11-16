# Full-leg rest suggestion cache repair — 2026-11-16

The supplied 22:45 log explicitly reports quick screening. In its latest run, inventory was ready at 22:30:40 UTC; screening started at 22:30:50. First suggestions appeared after about 103 seconds on original leg 1 and 401 seconds on leg 2. At 872 seconds only 4/24 and 2/19 candidate departure forecasts had completed. The shared limiter recorded no rate-limit responses or verification hold, and commonly had only zero to two native reads active. Logical forecast counts therefore concealed a much larger number of road-piece lookups.

## Reproduced defect

`GoogleTraffic.piece` uses saved overlapping observations to join old sections and query missing gaps. Indexed future sections provide endpoint hints without loading every saved payload. Those hints previously triggered a query split purely because their start lay inside the requested road. Their forecast clock could be a different hour or day. Loaded observations could cause the same problem if their clock was valid at the road's beginning but wrong for the later arrival at the interior section.

A regression fixture places 24 future-day partial profiles inside one road. Before the fix, a fresh forecast issued 25 requests; after it, one request covers the entire road. The former forecast returned 248.77074 seconds with 99.9893% coverage; the repaired forecast returned 248.73874 seconds with 100% coverage. The roughly 0.032-second difference is segment/coordinate rounding in this constant-speed synthetic fixture. This is a request-count reproduction, not a claimed 25x phone speedup.

## Fix and accuracy

Only use a cached interior section as a split hint when its timestamp is near the route model's expected arrival at that position, within the existing 150-second matching tolerance. Ignore far-future hints before expensive geometry projection. Actual cached values still pass the existing geometry, direction, timestamp, avoidance and expiry checks. If a hint cannot help, query the normal full road section or use another verified cached profile. No missing traffic is declared free flow by this change.

The full remaining-leg horizon stays intact. Quick mode still screens up to eight candidates at three departures each. Extensive mode and final departure selection retain their complete five-minute grids. No cache is cleared, source rate increased, or traffic-time interpolation introduced.

## Verification

- The new future-partial regression fails on the previous implementation (25 requests) and passes after the fix (one request, full coverage).
- A second regression covers loaded partial observations whose clocks do not fit later arrival down-road.
- Existing tests still join three compatible stored sections without network reads, fetch only a missing/expired middle, reject the old tail when a slower middle changes arrival, and honor explicit refresh/cancellation.
- Focused cache, matching, lookahead, full-leg bounds, quick/extensive, saved-trip, final timing and browser flows passed locally. The signed-release workflow reruns the complete regression and native gates.

The raw user log remains outside version control. Phone performance after this repair still needs confirmation against the same trip; total time also depends on network latency and genuinely missing full-leg traffic.
