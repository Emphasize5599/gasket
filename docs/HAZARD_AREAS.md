# Warning footprints

The [NWS geolocation guide](https://www.weather.gov/media/documentation/docs/NWS_Geolocation.pdf) explains that a zone alert's SAME codes identify every county intersecting its forecast zone. They do **not** mean the whole county is affected. Mountain-only winter warnings can otherwise incorrectly cover valley highways.

Gasket now prefers an alert's explicit polygon, then official affected-zone geometry. Unique zone requests are shared between concurrent route checks and cached for 30 days (warning text still expires after 10 minutes). County bounds can conservatively rule out far-away zones before requests; they never broaden a resolved zone. County-based watches still use counties.

If zone geometry cannot be verified, retain a clearly labeled nearby/unverified warning in the surrounding county instead of asserting snow/ice on that road. Failed geometry checks count as incomplete weather checks, not all-clear results. Logs report zone lookups, failures and uncertain areas. Hourly forecasts and actual winter alerts remain enabled everywhere, including Southern California passes; no latitude or warm-temperature suppression is used. Elevation-qualified warning text must still be reviewed: a forecast zone can contain different terrain elevations.
