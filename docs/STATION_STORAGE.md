# Shared station storage

`stationstore` is a durable Android `files/kv` namespace, included automatically in full backups. Clear cache keeps it; Erase all data removes it. It contains public station metadata and observations, never API keys. Existing price history remains separate.

## Locations, coverage and prices

These are independent facts. A station being known does not prove an area was completely searched. Reusing a station does not change its observation or pump timestamp. Missing prices remain missing; Tesla-owner quotes are isolated from guest quotes. Expiry uses the user's gas/EV price-age settings and existing successful-check throttle. An expired price can trigger a price-only website read without repeating location discovery.

Gas map and route searches share stable, approximately ten-mile cells, using eight-mile search radii that cover cell corners. The route scan covers the maximum supported 30-minute detour corridor, independently of the current slider. Successful website result exhaustion or exhausted Places pagination records source/profile coverage. Places reads up to three pages per cell and reserves each page against the monthly cap. Incomplete, restricted, failed and cancelled work never certifies coverage. Completed cells checkpoint immediately; partial stations are still saved. Website/API coverage can be reused in either direction. Since 0.0.270 a searched cell is reused for every grade (the station list doesn't depend on which grade's prices were shown; other grades' prices go through the price-only refresh) and never expires: a list read to its end and a list that sat quiet at its bottom after scrolling are both kept until Rediscover. Replaying a cell gathers every stored cell under its 8-mile circle, so stations just across a cell line, in cells off the route, come back too.

Source exhaustion means the provider completed its query, **not** proof that the real world contains no additional stations. Dense Places responses still carrying a page token remain partial. Explicit Rediscover repeats location discovery, including remembered areas; Update prices reads known stations. Queries beyond 10,000 cells, unsupported polar coordinates or crossing the date line are refused rather than silently cropped.

## EV and hydrogen

A downloaded DOE charger inventory supplies locations without an online route lookup merely to update prices. Without that full inventory, online DOE/OCM searches remember verified geographic corridors, independently of the trip or encoded-polyline cache key. Overlapping new routes query only uncovered contiguous sections. Corridor reuse conservatively proves coverage of the new geometry; station counts or matching endpoints are insufficient. Connector/charging-level provider profiles remain distinct, while compatibility and tariffs are checked for the current vehicle. A failed persistence write cannot certify new corridor coverage.

Rediscovery can supersede a provider's previous membership inside its queried corridor, without deleting historical observations or stations from another provider. Raw offline DOE data, public H2 inventory and station price observations retain their existing separate roles. Explicit price refresh bypasses short-lived normalized/provider-response caches; authentication pacing, bot checks and refusal handling remain in force.

## Persistence and older data

Cells have sparse row indexes and a 64-record in-memory LRU. Indexes are written before records; data uses the atomic native KV writer with fsync. Stations returned to callers are detached copies. No full-world grid is allocated.

Legacy gas price-history locations are imported once in yielding batches on trip discovery, without manufacturing completion evidence. Versions before 0.0.265 stored stations but never recorded a cell as searched (phone replies all say partial and end quiet), so the first scan of a route on 0.0.265 or later reads it once; after that every trip, car and grade reuses it. Subsequent overlapping trips reuse it. Full backup restore already streams all `files/kv` namespaces.

Tests cover cold contexts (`cell-reuse`: real route areas, the phone reader's reply shape, more cells than the memory cache, restart, new trip, other grade, 400 days, price updates off, cancel, bad reads; `cell-reuse-ui`: a new trip in the real UI reads no cells), cache clearing, shared map/trip cells, fresh and expired observations, source/grade boundaries, forced rediscovery, cancelled/partial work, failed persistence, owner/guest prices, corridor extensions, offline DOE behavior, and actual browser map/comparison flows. Native atomic-write execution and compilation are enforced in GitHub's JDK-equipped release gate.
