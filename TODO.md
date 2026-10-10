# Later

Things the owner wants, saved for later. Add to it as ideas come up; take an item off when it ships.

## Trips
- **Weather along the route.** Forecast the conditions for each part of the drive at the time you'd be there (rain, snow, ice, fog, heat), and tie them to the climate presets ("If it's snowy…") and the tire advice.
- **Polluted zones.** Find which stretches of the route have bad air (smoke, smog, heavy pollen) so Advice can say when recirculate makes sense, and for how long.

## Hydrogen and electric cars
- Everything for hydrogen and EVs: stations / chargers along the route, prices, plug and connector types, charging speeds and times, range in cold and heat, and plans that work for them like the gas planner does.

## Garage
- **Picking a car with pictures.** Swipe side to side (or arrow keys) through the cars, each with its picture down to the trim and paint color. Research (0.0.82):
  - Photos by trim and color only come from paid providers: IMAGIN.studio (rendered by URL: make / model / year / variant / paint; key from sales, priced by quote) and Fuel API / EVOX (1998 on; trial key, then paid; EVOX logo required). A key can't live in the repo; the owner would enter their own.
  - Free: Wikimedia Commons photos by generation (credit each one: author, license, link; colors are whatever someone photographed), or our own drawing per body style tinted to the paint color (offline, no key).
  - **NHTSA (free, no key):** `https://api.nhtsa.gov/vehicles/byYmmt?modelYear=2016&make=TOYOTA&model=PRIUS&data=none&productDetail=all` returns `vehiclePicture`, the EVOX studio photo nhtsa.gov's vehicle pages show (e.g. `https://static.nhtsa.gov/images/vehicles/11017_st0640_046.png`, 640 px, front three-quarter; newer ones look like `BTL_53808_cc0640_032_1K6.png`). One photo per NHTSA vehicle (year / make / model / body / drive), one angle, one color; other sizes, angles and paint codes 404. Gaps: some years / models return nothing (model names must match NHTSA's). The photos are EVOX's (watermarked) and licensed to NHTSA, so showing them is fine for the owner's own use but needs a look before publishing (COMPLIANCE.md).
  - **Fuel API (EVOX):** `https://api.fuelapi.com/v1/json/vehicles?year=&make=&model=&trim=` then `/v1/json/vehicle/{id}?productID=2&color=<OEM name | simple name | hex>&productFormatIDs=…` (Basic auth, key as the username). Color stills at 1280 / 640 / 480 / 320 px, angles 1, 14 and 32; also spins and video. Free demo by request form at fuelapi.com/demo (watermarked images); pricing by quote, pay as you go. The terms page wasn't reachable; read it before paying.
  - Plan: swipe picker with a picture source that starts with NHTSA's photo (cached), and uses Fuel API for the exact trim and paint when the owner enters a key in Settings (never in the repo).
  - Not usable: scraping (cars.com, KBB, auto-data.net), Edmunds (closed 2018), research datasets (Stanford Cars, CompCars: non-commercial only), CarsXE (third-party photos, rights unclear).
