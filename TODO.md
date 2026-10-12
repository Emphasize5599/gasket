# Later

Things the owner wants, saved for later. Add to it as ideas come up; take an item off when it ships.

## Trips
- **Weather along the route.** Forecast the conditions for each part of the drive at the time you'd be there (rain, snow, ice, fog, heat), and tie them to the climate presets ("If it's snowy…") and the tire advice.
- **Polluted zones.** Find which stretches of the route have bad air (smoke, smog, heavy pollen) so Advice can say when recirculate makes sense, and for how long.

## Hydrogen and electric cars
- **Next up (owner's priority): EV / hydrogen in the main UI.** Plan (0.0.97):
  - Today: a floating ⚡ button opens a separate alt-fuel panel (`altfuel.js`), and the top bar's segment (`#grades`) only knows gas grades.
  - A fuel-mode pill at the left of the top bar's segment, showing the current mode's icon (⛽ / ⚡ / H₂). Tapping it opens a tiny three-choice menu: Gas & diesel, Electric, Hydrogen. It starts on the selected car's kind.
  - The segment next to it changes with the mode:
    - Gas: Regular / Mid / Premium / Diesel, as today.
    - Electric: charger speed (Fast DC / Level 2 / All). A long-press or second row picks plugs (CCS, NACS, CHAdeMO, J1772), defaulting to the car's plug and adapters.
    - Hydrogen: H70 / H35 pressure.
  - Refresh, the lookup counter and Settings stay where they are. The ⚡ floating button goes away. Its panel's extras (hydrogen range shading, charger filters) become a small sheet behind the pill's menu.
  - The map pins, price list, "Search this area" and Stops all follow the mode: chargers and hydrogen stations use the same list and detail sheet as gas stations (price per kWh / kg, speed, plugs, open now).
- Everything else for hydrogen and EVs: stations / chargers along the route, prices, plug and connector types, charging speeds and times, range in cold and heat, and plans that work for them like the gas planner does.

## Garage
- **Car pictures:** NHTSA, Wikimedia Commons, the doodle, and Fuel API (owner's key, watermark as delivered) for factory colors, as of 0.0.86. A paid Fuel API plan would drop the FUEL watermark (COMPLIANCE.md #9). Doodles could get more detail (wheels, roof racks, two-tone).
