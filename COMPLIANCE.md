# Terms-of-service compliance (open items)

Gasket's own code and the libraries it bundles are covered: see `LICENSE.md`, `THIRD_PARTY_NOTICES.md` and in the app Settings → About → Licenses & credits. The app shows a "Google Maps" credit wherever Google content appears, following Google's text-attribution rules (12px, normal weight, gray #5E5E5E or white).

The items below are the services' **terms of use**, not licenses. They are fine for a personal app but have to be settled before a public beta. Each one has options, and some of them cost Google lookups, so they're decisions for the owner.

| # | Where | What the terms say | What Gasket does | Options |
|---|---|---|---|---|
| 1 | Google Places / Routes (Maps Platform Service Specific Terms) | Don't pre-fetch, cache or store content, except place IDs (kept forever) and limited short-term caching. | Saves Google answers (stations, prices, routes) indefinitely so the same search or saved trip needs no new lookups. | Expire Google answers after a short window and keep only place IDs; saved trips would then re-fetch routes and stations (more lookups). |
| 2 | Google Places / Routes | Google Maps content must not be shown on a non-Google map. | Draws Google stations and routes on an OpenStreetMap (Leaflet) map. | Use a Google map (Maps JavaScript API: billed, and it needs Play-services-free handling), or get stations and routes from non-Google sources. |
| 3 | Google Maps website (hidden page in `gmaps_worker.js`) | Google's terms forbid automated access to its web pages. | Reads a shared directions link's stops and route options from the Maps web page. | Use only the Routes API (fewer route options, more lookups), or ask the user to pick the route themselves. |
| 4 | walmart.com, murphyusa.com (`walmart_worker.js`, `murphy_worker.js`) | Their site terms generally forbid automated collection. | Reads prices from their store pages in hidden windows; bot checks are shown to the user, never bypassed. | Ask each company for permission or an official feed, or show their prices only on the user's request. |
| 5 | ExxonMobil station finder | Site terms. | Checks which Exxon/Mobil stations take Walmart+. | As in 4. |
| 6 | Tire Rack (Garage → Tires) | Site terms. | Reads the factory size for the car's trim and the tires sold in that size, in a hidden window, cached for 30 days (bot checks are never got past; the user types the size instead). | As in 4; or let the user type the size and tire. |
| 7 | NHTSA recall lookup by VIN (Advisory) | Protected by Google's invisible reCAPTCHA. | Loads NHTSA's own page in a hidden window at most weekly per VIN (the page runs its check like any browser; a blocked or challenged page is reported and left alone), or visibly when the user taps the button. | None needed while it stays user-initiated and visible. |
| 8 | Brave Search (Garage → tank size, `brave_worker.js`) | Brave's terms limit automated use of its search pages; its Search API is the sanctioned way (paid for AI answers). | When a gas or hybrid car has no tank size, asks Brave Search once, in a hidden window, for "<car> fuel tank capacity in gallons?" and reads the number from its AI answer. A check on Brave's page is never got around: the user can open the page and finish it. | Use the Brave Search API with the user's own key, or keep the lookup user-initiated only (the "Search Brave yourself" link). |

Public U.S. government data (EPA fueleconomy.gov, NHTSA vPIC and recalls, FHWA, DOE/NREL) is in the public domain or free to use with credit, and it's credited in `THIRD_PARTY_NOTICES.md`.
