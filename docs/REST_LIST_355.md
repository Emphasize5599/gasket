# Rest list overhaul — 0.0.355

Owner request (Nov 2): replace 0.0.354's candidate screening; wait in leg 1 for compiled details; cooldown in the
status bar; clear per-place buttons; amenity marking/filters for every source; aesthetic flag; experience rating;
wider, pannable satellite view.

## What changed

- **No screening hold.** The "Screen rest candidates" prompt, 2-minute countdown and Keep screening are gone.
  `RestScreen` keeps only the trip-scoped hidden set (`holding()` is always false), so background road-access checks
  and departure suggestions start as soon as the search's facts are in.
- **Waiting in leg 1.** With overnight planning (`nightly()`), Next on Compare goes straight to Stops and opens
  leg 1's rest list (`restUI.waitFirstLeg`), only when no rest has been added yet. Until that leg's details are compiled
  — inventory, campground facts and road access for every visible (not hidden) place on the leg — the list shows a
  non-interactive "Compiling rest stop details for leg 1" card with progress. Those checks are queued first
  (`state.focusLeg` ordering in `bgAccess`, plus urgent checks for the leg). Departure-time suggestions are not part of
  this wait. If background checks are stopped (✕) the list opens anyway, so it can't get stuck.
- **Cooldown in the status bar.** A provider cooldown (traffic/timezone pacing or Recreation.gov) is a priority-60
  Tasks row with a pause icon (`paused: true`, static bar). The list no longer carries the access-status tile; only a
  one-line "N unavailable · Retry" appears when checks failed. The Stops tile keeps its counts.
- **Per-place buttons** (`.rest-tools`): Hide/Unhide, a 😀 Good / 😐 Okay / 🙁 Poor experience group (tap again to
  clear), Not pleasing (toggle), and an **Edit rates / mark amenities** button. Marks are saved in the guarded user
  record (`restplaces` `user|<id>`: `rating`, `unsightly`, `amenities`). Hidden places sit behind a "N places hidden ·
  Show hidden · Restore all" bar.
- **Rates and amenities page.** Above the rate table: Yes / No / Unknown for each of the 12 amenities, Not
  aesthetically pleasing, and your experience; **Save amenities** saves those alone (and searches again so the marks
  count everywhere), Save rates saves both.
- **Amenity filters for every source.** `RestPlaces.ALL_REQUIRE` (12 amenities) can be required on any source.
  Amenities a source doesn't report are under "Amenities this source doesn't report" in its Settings tile; they only
  drop places you marked as lacking them, and places with an unknown (null) value still show until you fill it in.
  Source-reported amenities keep the existing "Include unknown amenities" switch.
- **Aesthetics filter.** Settings → Rest stops → "Hide places I marked not aesthetically pleasing"
  (`S.restHideUnsightly`, off by default).
- **Satellite.** The preview fills the row's width. Tapping it turns it into a pan/zoom map in place (Leaflet with
  the same satellite tiles at zoom 18, a marker at the place, no Google page controls) with Open in Google Maps and
  Done; one at a time, kept across list redraws. Native intercepts `mt1.google.com/vt/lyrs=s` tile URLs (strict
  pattern) like the OSM map tiles, passing the real image type.

## Limits

The Compare → leg 1 hand-off is checked by a source assertion, not an end-to-end trip run (the fixtures can't reach a
prepared Compare). Satellite tile rendering and touch panning on the phone are unverified here (test network is blocked).
