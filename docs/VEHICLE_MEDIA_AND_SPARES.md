# Vehicle views and rear-mounted spares

## Fuel API views

The car editor cycles the returned color-exterior PNG views for the selected vehicle and paint: front three-quarter (`032`, format 12), rear three-quarter (`014`, format 8), and side (`001`, format 6). Only angles actually returned for that paint are offered. This is a set of discrete views, not a synthesized 360-degree spin or a separate licensed spin product.

Downloaded views stay in persistent `carpics` storage and full backups; expiring asset URLs are held only in memory. Missing views keep the previous selection. User-selected/generated photos and illustrations do not expose rotation controls. The two buttons flank the reduced image and have accessible direction labels.

Reference: [Fuel API official API documentation](https://fuelapi.com/support/api-documentation).

## Model and year fallback (262)

Tesla Model Y/3/S/X names normalize to the base model for photo searches, even when EPA model names contain Long Range, RWD, AWD, Performance or Plaid. Fuel lookups use the selected model rather than a potentially broader NHTSA alias. The exact year is tried first, retrieving all offered trims without a trim filter. If none has a usable color image, the provider's `modelYears/` catalog supplies older candidate years in descending order. No future or invented year is probed. Each year's closest trim is tried first, then its other offered trims before moving to an older year. Successful catalog responses coalesce across cars in the session; auth/network errors stop instead of triggering a year search. Source image year/model/trim are stored under `pic.fuel`, with a source-year label when different. EPA identity, drivetrain, fuel economy and actual trim remain untouched. A similar-year photo is a visual substitute, not proof the designs are identical.

Commons queries use make + base photo model without a year or range/drive suffix. Automatic non-Tesla selection retains the existing year/configuration checks. Tesla fallback accepts older model photos when a close-year image is unavailable, retains the title/license/attribution, labels the image approximate, and never automatically selects a later-year photo. The Tesla picker shows all model years; the existing broader-search button enables broader years for other models. Model identity, unsuitable-photo and dually checks still apply. Fuel API failed lookups and Commons failed lookups from previous policies are retried once by revised lookup signatures. Photo-configuration fallbacks never supply older trims to the actual vehicle setup.

## Editable saved identity

Saved EPA selectors load their complete choices independently, preserving the saved selection on errors and ignoring replies for changed ancestors or replaced controls. Rehydration does not simulate user changes or reapply the saved EPA record. Handlers remain attached across redraws; selecting a new ancestor still clears dependent controls and blocks Save until the record is valid. The app's dropdown popup observes changes to its source options while open, so tapping before an EPA response arrives no longer traps the user in a snapshot containing only the saved choice. Its observer is disconnected on close, and filter text is retained on updates.

Custom/NHTSA-only vehicles also retain editable year/make/model inputs after VIN decoding. Changing those entries detaches the old VIN association and its decoded facts; changing an already EPA-configured vehicle to a different identity clears the old trim. VIN-assisted initial EPA matching still preserves decoded trim/facts. Pending VIN decode replies cannot overwrite later manual identity edits. Discard restores the prior configuration. Tests use actual popup clicks with a delayed year reply, saved selectors after redraw, required dependent choices, custom VIN edits, and discard at 320/448px.

## Spare storage research

The location selector distinguishes inside the vehicle (including below the cargo floor), underbody, and exterior rear-mounted. A soft or hard cover does not establish the spare's size, original fitment, or whether it is standard on the exact trim. Brave supplies a suggestion; the user confirms it.

OEM examples checked on 2026-10-24:

1. [2024 Jeep Wrangler owner manual](https://vehicleinfo.mopar.com/assets/publications/en-us/Jeep/2024/Wrangler/5538906_24_JL_OM_EN_USC_DIGITAL_E2.pdf): rear swing-gate spare.
2. [2024 Ford Bronco owner manual](https://www.fordservicecontent.com/Ford_Content/Catalog/owner_information/2024_Ford_Bronco_Owners_Manual_version_1_om_EN-US.pdf): rear-mounted spare. Bronco Sport is a different vehicle; its cargo-floor location must not be generalized from Bronco.
3. [Land Rover Defender accessory catalog](https://accessories.landrover.com/us/en/defender-130/wheels-wheel-accessories/wheel-accessories/vplew0143-spare-wheel-cover/): a cover for the exterior rear-mounted spare; factory accessory availability disproves the blanket claim that all covers are aftermarket.
4. [2014 Toyota FJ Cruiser quick reference guide](https://assets.sia.toyota.com/publications/en/om-s/OM14J5QRG/pdf/2014FJ_QRG.pdf): rear-door spare.

Actual Brave AI answers were inspected in the browser for Wrangler and a Bronco/Bronco Sport/FJ Cruiser/Defender comparison. It recognized the rear locations but made an overbroad aftermarket-only Defender-cover claim and mixed a Bronco Sport package year. No vehicle-specific lookup table was added from those answers. The revised question asks for exact-version standard spare, location and cover status; the parser keeps optional/aftermarket or conflicting locations unconfirmed and does not confuse “cargo” with “car.”

The hidden Brave reader waits up to 25 seconds for its AI answer before considering search-result fallback; its overall page and bridge deadlines leave time for that wait. Human bot-check handling is unchanged.
