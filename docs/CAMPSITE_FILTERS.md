# Campsite website filters — verified October 27, 2026

Owner direction: exclude iOverlander; ignore RV Parky reviews/star ratings because they are too sparse. Pass the user's applicable filters into external website searches, not only Gasket's candidate list. This is research and a tested RV Parky URL builder, not a shipped rest-stop UI.

## RV Parky: search fixed and URL handoff verified

Typing a location and pressing Search/Enter without resolving it did not work in the earlier investigation. Typing **Searcy**, then selecting the **Searcy, AR** autocomplete suggestion immediately produced results. Gasket already has coordinates, so its links can skip geocoding/autocomplete and supply `l`, `x` and `y` directly. Here, unusually, **x is latitude and y is longitude**.

Verified signed-out search results included Searcy Walmart, local RV parks, Love's and rest areas. The filter panel supports place categories, overnight-only stores, amenities, distance and stars. Stars/reviews are excluded from Gasket's proposed integration at the owner's request. Clearing the test's star control removed its restriction. Sorting changed in-session but reset to distance on reload; do not assume it is carried in the URL.

URL fields:

| Parameter | Verified purpose |
| --- | --- |
| `l` | Human-readable location label |
| `x`, `y` | Latitude, longitude |
| `f` | Category/required-amenity masks |
| `d` | Radius in miles: 5, 10, 25, 50, 100; omitted/empty means any distance |
| `s` | Star threshold; **omit it** |

The site's public bundle and actual form agree: `f` consists of **eight hex category digits followed by a separately parsed hex amenity mask**. Do not treat the concatenation as one numeric bitmask. Known category IDs 1–19 and amenity bit positions were verified from the rendered controls. Preserve reserved category flags rather than infer new meanings for them. The research builder uses independent integers and rejects unknown filters instead of dropping them.

Verified example: [Searcy, 25 miles, stores/rest areas and overnight-store flag, no star threshold](https://www.rvparky.com/search?l=Searcy%2C%20AR&x=35.26885986328125&y=-91.7083740234375&f=7ff803e0400000&d=25).

Reload preserved radius 25, rest areas, the four store categories, overnight-only stores, and excluded RV parks, gas stations and road warnings. A second generated URL with `f=7fffffff10080` restored **Pets Allowed + Restrooms**, all categories, and no star threshold in a new tab. These are tested URL/checkbox states, not proof every returned station has verified current amenities.

Important semantics: RV Parky says required amenities hide **RV parks** without the listed amenity; the overnight-parking checkbox is specifically **for stores**. Neither is a guarantee that every rest area/store has toilets or a legal/available overnight space. There is no verified universal free-price filter, exact vehicle-length filter, drinking-water guarantee or routed-detour-time filter. Water means its Water amenity, not a verified potable source. Big Rig Access is a broad flag, not a dimensional fit calculation.

`research/rest-traffic/site_links.py` independently implements the observed RV Parky URL format. Four tests cover the real mask, coordinates/escaping, multiple/high amenity bits, absence of star restrictions and rejection of unknown constraints. Existing seven rest-timing tests also pass. No provider code was copied into the adapter.

## Other sites

| Website | What passed | What still needs implementation/validation |
| --- | --- | --- |
| Campendium | Free Public Camping generated `a5=p!PLND,f!CPRC'0;0`. Selecting pets and 35+ft produced `*FPTA'1*FCRL'35`. Reloading the URL restored both selected controls. Map center/zoom travel in `lat`, `lng`, `z`. | More field mappings, category combinations, exact size/unknown handling and membership-gated fields. Its free-price label is based on reported price, not a new price confirmation. |
| FreeCampsites | Paved + Restrooms were selected and its real search request carried `advancedSearch={"road_type":"Paved","amenities":1024}`. | The ordinary `#!Wall,+South+Dakota` URL did **not** carry these filters. Public JS stores/applies advanced search separately. No reliable filter-bearing external URL was established. Use a controlled in-app website flow to reset/set/verify supported filter controls before searching, or show only Gasket-filtered individual listing links. A bare location link must not be called a filtered search. |
| OpenCampingMap / OSM | OSM-backed inventory and individual detail links were previously verified. | Parameterized filter handoff has not been verified. Filter licensed inventory in Gasket and open matching details until its search interface is validated. |
| Recreation.gov / agency pages | Official inventory/downloads and detail links established. | No common filter protocol across agency sites. Gasket's own requirements must be checked before opening the exact site; only offer website-wide filtered search after validating that site's controls. |
| The Dyrt | Optional website source only. | Curated collection/membership restrictions and filter-link mappings remain unvalidated. Do not advertise full filtered access. |

Example Campendium link from the real UI: [free public camping, pets, 35+ft](https://maps.campendium.com/?lng=-98.35&lat=39.5&z=3.30945&a5=p!PLND,f!CPRC%270%3B0*FPTA%271*FCRL%2735). This is a continental map center, not a claim to list only nearby Searcy stops.

## Integration contract

1. Persist a provider-neutral filter profile: allowed stay/site types, free/paid/unknown price policy, required versus preferred amenities, vehicle/trailer dimensions and access-surface constraints, location/radius and actual detour allowance. RV Parky reviews/stars have no role. Category choices are alternatives; required amenities must all be satisfied. Validate each provider's own semantics before treating it as equivalent.
2. Adapters report exactly which constraints are applied by the provider, enforced by Gasket, or unsupported. Do not map water hookups to drinking water, radius to detour time, big-rig access to exact dimensions, or a blank rate to free. Missing facts must follow an explicit unknown policy.
3. Prefer filter-bearing URLs for ordinary external browsing. Reopen in a fresh session and verify selected controls and results. Known coordinates avoid location-autocomplete fragility. For a website without URL support, an in-app controlled page can set visible controls and verify them before presenting results; do not claim a plain external browser link can carry that page's unencoded state.
4. Never silently discard a required filter. If the provider cannot honor it, keep the restriction in Gasket's validated candidate set and link to matching individual places, or clearly explain that filtered search is unavailable there. Keep this concise, with details behind an indicator; no blanket notice wall. A source's missing amenities are not proof the user should relax requirements.
5. Test round trips through links for OR categories/AND amenities, unsupported constraints, no prior cookies, preexisting conflicting filters, empty results, page changes and phone-sized viewports. Do not let old website/session filters accidentally narrow a new Gasket search. Discovery, permissions and stale information remain separate from successful checkbox transfer.

Production discovery/UI adapters and broader mappings remain TODO55/56; this pass establishes a working RV Parky search and tested filter-link format.
