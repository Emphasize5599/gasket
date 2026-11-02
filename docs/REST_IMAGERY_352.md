# Rest-stop imagery — 0.0.352

Requested behavior: omit Street View when unavailable; offer a distinct satellite action only with imagery; keep all actions right-aligned; include satellite surroundings previews so names do not dominate the choice.

## Implementation

- Visible directory rows, plus the existing 80px scroll margin, initiate checks. No trip-wide imagery sweep or work for filtered-out rows. Pending/confirmed absence/temporary failure are distinct.
- Street View checks official panorama metadata within 50m and accepts only a recognized successful response with a nearby (within 65m) panorama ID. Links include the exact checked ID. Unknown response schemas never become positive coverage or permanent absence.
- Aerial checks a neighborhood-scale Google satellite tile at zoom 17. Native code validates HTTP status, bounded body, image dimensions and successful decoding; uniform no-detail tiles are unknown. A 404/204 is completed absence for that tile. A global low-detail map is not presented as a detailed site picture.
- A 256px preview marks the inventory coordinate on its tile; it is not a certified driveway/access location. The full tile is shown without cropping the stop out. Both preview and satellite icon open the centered Google satellite map. Name/place pin, panorama, satellite and original provider record keep independent purposes. Missing actions are omitted.
- Action flex rows justify to the right, wrapping within narrow layouts. Pending preview space reduces layout changes as pictures arrive.
- Coordinates scope panorama reuse; aerial tiles share across nearby sites. Coverage records persist in `restplaces`: positive 48h, completed absence 24h. Thumbnail bytes remain transient, at most 96 tiles in memory; durable records and backups contain no new imagery. A new session reloads previews only for browsed positive sites.
- Existing rest-worker setting provides a RAM-based default or user 1–50 ceiling for lightweight HTTP readers, with ~6 check starts/sec. These are network requests, not 50 WebViews. Both image and metadata calls share the queue. 403/429 pauses queued checks, honoring Retry-After (at least a minute). One failed view does not discard the other. Temporary failures cool down for five minutes, show inline Retry, and log kind/reason without site location or raw metadata.
- Native requests use fixed endpoint paths, validated finite coordinates, bounded response sizes, 8s connection/12s read timeouts, image dimension checks before decode, bitmap recycling, and executor shutdown. Bridge calls have a 30s JS deadline. No keys, cookies or page credentials are copied; no new library is bundled.

## Verification

- Live public probes at a generic Berkeley street and an ocean location: covered metadata supplied nearby panorama/coordinates and satellite returned a 19,063-byte JPEG; ocean metadata explicitly returned no images and the satellite request returned 404. The obsolete `cbk` endpoint returned 404 and was not used. No raw live metadata or image is committed.
- `restimagery`: metadata validation/proximity, exact panorama/satellite URLs, positive and negative reuse, absence vs error, no persisted thumbnails, coalescing, tile keys, cancellation, request pacing, 50-reader hard ceiling and Retry-After behavior with a simulated clock.
- `rest-links-prices-ui`: both views, aerial only, panorama only, neither, temporary failure/retry, independent source/map targets, clickable preview and right alignment at 320/448px. `restui`: existing broader rest workflows with checked panorama fixture.
- Initial local release run: 211 tests in 240.9s, 209 passed. Two fixtures needed updates: Recreation.gov expected the old unconditional panorama button; restui was already running with the previous fixture while the live-response nesting correction landed. Final targeted run passed restimagery, rest-links-prices-ui, restui, recreation-ui and legal (28.3s); the 50-reader/tile-sharing test passed again after its final assertion. Real downloaded metadata was parsed successfully for both covered and no-coverage locations. Real satellite bytes were also substituted locally for visual inspection (not committed) at 320/448px.
- Full release and signed Android CI results are recorded after completion.

Native website protocols are not stable public APIs: schema, network or policy failures leave the affected view unconfirmed, hide its control, and expose retry. Confirmed imagery can change after a cached check. On-phone rendering and real Google Maps app handoff remain unverified.

Phone checks: browse rest results; confirm the satellite marker matches the stop, tap preview and each icon, test a site lacking panorama, check right alignment at large text size, and retry after temporarily disabling connectivity. Keep the existing saved trip/place data.
