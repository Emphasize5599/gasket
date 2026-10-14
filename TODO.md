# Later

Things the owner wants, saved for later. Add to it as ideas come up; take an item off when it ships.

## Trips
- **Pollen along the route.** Weather and air along the way shipped in 0.0.114 (the Hazards step since 0.0.116) (Open-Meteo, National Weather Service), but there's no free U.S. pollen forecast (Open-Meteo's covers Europe only; Google's Pollen API is paid). Add it if a free source turns up.

## Hydrogen and electric cars
- **In the main UI** since 0.0.100: the fuel-mode pill (⛽ / ⚡ / H₂) switches the top bar's selector, pins and list. Still to do there: picking plugs (CCS, NACS, CHAdeMO, J1772) from the pill's options, chargers and hydrogen stations in the same detail sheet as gas stations (price per kWh / kg, speed, open now), and Stops following the mode.
- Everything else for hydrogen and EVs: stations / chargers along the route, prices, plug and connector types, charging speeds and times, range in cold and heat, and plans that work for them like the gas planner does.

## Plug-in hybrids
- **Better plug-in hybrid (PHEV) support.** Today a PHEV is planned like a gas car (the EPA's gas-only mileage, the gas tank). Still to do: its electric range and kWh per 100 mi (the EPA lists both), how much of a trip runs on the battery (starting charge, charging at the destination or along the way), blended mileage once the battery is used up, charging stops as an option alongside fuel stops, and the battery's share of the fuel cost.

## Flex fuel (E85)
- **Flex-fuel cars as their own fuel type.** The VIN decode already knows a car is flex-fuel (NHTSA's FuelTypeSecondary "Ethanol (E85)"; used since 0.0.129 only to tell the EPA's "FFV" versions apart). Still to do: E85 as a grade (prices: Maps lists it at some stations, AFDC lists E85 stations), the EPA's E85 mileage (`cityA08` / `highwayA08` / `combA08`, its alternate-fuel numbers), and plans that weigh E85's lower price against its ~25% lower mileage.

## Garage
- **Trailer tire tread differences.** Cars get tread-difference warnings by drivetrain since 0.0.148 (`TireMath.treadDiff`). Trailers have no drivetrain, but mismatched tires still matter (tandem axles share the load, duals must match in diameter, ST tires age out by date): research the best practices (tire makers, RV / trailer industry guidance) and add warnings and suggestions for trailers.
- **Tire dry-rot information screen.** Explain dry rot/sidewall cracking, what to inspect and when to seek a qualified tire inspection; keep it distinct from the generalized tread estimate. Content and design are still to be developed.
- **Scenic backgrounds for car images.** Offer cool default environments the user can apply to their recreated car image, inspired by Gran Turismo Scapes (not using its assets). Support placing the car naturally in different scenes; choose a suitable licensed background source and retain any required attribution. Background sourcing and compositing are still to be designed.
- **Marketing trim from VIN when NHTSA omits it.** Manufacturer-backed lookup or a verified generic mapping, not an AI guess or conversion of internal grade codes. Secondary trim text is supported; internal grade codes remain unresolved.
- **Car pictures:** NHTSA, Wikimedia Commons, the doodle, and Fuel API (owner's key, watermark as delivered) for factory colors, as of 0.0.86. A paid Fuel API plan would drop the FUEL watermark (COMPLIANCE.md #9). Doodles could get more detail (wheels, roof racks, two-tone).

## Cowork session (needs a web browser)
Work for a session that can open the sites themselves.
- **Automatic VIN recall lookup reliability.** NHTSA can decline background reads; 0.0.130 clearly preserves that as unresolved and offers the visible page. Investigate legitimate manufacturer/NHTSA-supported options without bypassing website checks.
- **Tire Rack drops tires from a size's list.** 195/65R15 read 77 tires but kept 70: 7 were rejected with "No product card with a size was found" (Continental ProContact TX ×2, Kumho Solus TA31, Bridgestone Ecopia EP422 Plus, Nexen N Priz AH8, Yokohama AVID S33D and S33B). Look at those products' cards on TireSearchResults.jsp and fix `tirerack_worker.js`'s card reading.
- **Tire Rack versions lookup fails right after a list read.** For the next car looked up, step `clars` failed after 97 ms with "Failed to fetch" while the reader was still on the 195/65R15 results page (`https://www.tirerack.com/tires/TireSearchResults.jsp?...`). The ValidationServlet request probably needs the reader back on a page where it's allowed (or a fresh load) between steps.
