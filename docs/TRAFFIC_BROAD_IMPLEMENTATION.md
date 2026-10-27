# Broader traffic and rest integration — in progress

Owner explicitly requested completion after 0.0.283. Main synced at 737cd37. Preserve tmp/ (existing research) and do not remove branches.

## Live protocol findings, October 27

A signed-out Maps Boston→New York desktop Depart at test selected Tuesday 17:15 and Wednesday 08:00; UI, URL !8j and request !19m3!1e0!2e2!3j clocks agree. Anonymous HTTP replay of the **observed** request succeeds without cookies/session tokens. Raw captures are local tmp/google-future.json and tmp/google-morning.json, not committed or bundled.

Important: !3j is a floating local-wall timestamp, not an actual UTC instant. Convert through an explicit origin IANA timezone (and verify echoed request clock); do not apply the phone timezone to a remote origin.

Structured root[0][1][i] summary includes nominal duration, arrival-time traffic duration/range and arrival timezone. root[0][7][i] contains the route E7 delta geometry. Route[3][0] has cumulative meters/seconds and local speed rows; its terminal time agrees within rounding with the summary. Route[3][5][0] contains categorical spans. Evening I-90 profile ends at 344977m/15094s; morning at 344977m/14745s; ranges and congestion spans differ as well. Thus this is a promising time-dependent source, not just the previously proven live-only Vela request. Do not assume every schema row means a posted limit or every incident belongs to the future. Google traffic remains an estimate.

## Work sequence

1. Independent bounded Google adapter: validate schema/time echo, normalize profile by its own full geometry, match chosen roads/direction, share stored observations, two requests maximum, cancel and verification pause/resume. Use existing numeric overlay; inferred stop/go energy remains experimental.
2. Connect provider settings, default HERE traffic off while preserving tolls, coverage/source/uncertainty, itinerary timing refinement and forecast reuse.
3. Persistent government/OSM rest inventory and search/filter UI, verified external filter URLs, private permissions and unknown restrictions.
4. Rest timing and itinerary integration, route/hazard/tariff/reserve revalidation, multi-leg/round-trip semantics and tests.
5. Release gates, signed APKs and phone checks. Do not label remaining steps done before they work.

## Integration checkpoint 1

Paired same-instant requests for Wednesday 02:00 and 08:00 have identical geometry but distinct cumulative profiles (13063s vs14745s), forecast ranges and congestion spans. This rejects the live-only-profile hypothesis. GoogleTraffic numeric parser/matcher and per-section provider are now being wired; native bounded anonymous HTTP (two requests) has no cookies or credentials. A fallback runs same-origin fetch *inside* the Google page after explicit human verification. Source data and clocks must validate; different roads stay unforecast. Open-Meteo supplies origin IANA zones. Geographic-cell/stop/leg boundaries advance arrival clocks; parser projection yields to the UI every128 points. HERE opt-in stays independent of tolls. Not released/tested yet.
