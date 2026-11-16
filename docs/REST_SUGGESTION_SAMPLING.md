# Rest suggestion sampling performance — 0.0.487

The owner's November 16, 2026 log (0.0.486) shows both leg recommendation jobs starting at 16:55:46 UTC. A background road-access pass took 169 seconds for 110 places, with 80 unavailable results. Many Recreation.gov 404s appeared during both the initial metadata pass and the later access pass. The cumulative provider counters are not a measurement of recommendation-only requests, and the log alone does not prove a single cause for every delay.

Two reproducible problems were found:

- `checkAccess` rejected a cached details-only result when full access was requested, even if that result had already failed or excluded the place. This repeated missing-record downloads. Reuse finished failures/exclusions within their retry window; retain 404 failures for five minutes. Explicit Retry checks still clears the failed records immediately.
- Each of two recommendation workers held its slot for access plus six onward forecasts. Two slow access reads blocked later verified candidates, and long forecasts serialized further access screening. Nested per-site/per-time concurrency could also start six whole-route forecasts per leg. The status stayed at Sample access until a forecast completed.

Access now has four bounded lanes, separate from two forecast lanes per leg. Ready candidates get initial samples ahead of queued refinements. At most eight candidates receive three coarse samples (beginning/middle/end): **24 whole-route forecasts per leg, versus 48 previously**. This is a 50% reduction in the bounded automatic workload, not a guaranteed 50% phone wall-time improvement. Existing traffic caches and provider pacing remain in effect. Selecting a stop still runs its normal five-minute departure slider; no full-list overnight precomputation was added.

Suggestions require verified access and sufficient traffic coverage. Unknown coverage is not highlighted as clear traffic. The list describes sampled departures rather than promising an exhaustive minimum. Status enters Departure forecasts before the first answer arrives; waiting and unavailable reasons are logged instead of disappearing into the sampler's catch block.

`tests/rest-suggestion-budget.test.js` reproduces blocked access, independent access/forecast progress, bounded forecast concurrency, failed metadata reuse, partial-coverage rejection and explicit forecast failures. It fails against the prior source and passes with the repair. Existing progressive suggestions, independent-leg startup, tolerance changes, access UI, overnight UI and the fresh three-day saved-rest replay remain covered. Release CI runs the new regression.

Run with the repository's Node/Playwright environment:

```sh
node tests/run-node.js rest-suggestion-budget rest-suggestion-progress rest-reco-restart rest-access-ui rest-access-cancel-ui restui old-rest-trip-ui
```

To repeat the negative control, export the prior `assets/web/restui.js` to a temporary file and set `GASKET_RECO_SOURCE` to that file for the budget test. The fixture deliberately blocks two access reads; the old implementation cannot publish later verified candidates.
