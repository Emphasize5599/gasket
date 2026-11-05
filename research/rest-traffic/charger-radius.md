# Chargers near rest facilities

The November 5, 2026 run used all 1,915 records from the [DOT/BTS truck parking layer](https://catalog.data.gov/dataset/truck-stop-parking), the [RIDB facility export](https://ridb.recreation.gov/download), and 83,906 [AFDC U.S. public operational EV station records](https://developer.nlr.gov/docs/transportation/alt-fuel-stations-v1/all/). The station filter excluded 1,776 records flagged as restricted, leaving 82,130. The RIDB export was last modified November 4. It had 12,690 enabled facilities with usable coordinates and 2,738 without, including 5,260 mapped campgrounds and 544 unmapped campgrounds. The campground subset follows the app's facility type and enabled status filters.

Each table cell counts facilities with at least one charger within the given straight-line distance. The count in parentheses requires at least one DC fast charger. Counts are cumulative. A single charger can be near multiple facility records, and the analysis does not estimate live port availability, connector compatibility for a particular car, or permission to park while resting.

| Radius | DOT/BTS | RIDB all enabled facilities | RIDB campgrounds |
| ---: | ---: | ---: | ---: |
| 25 m | 3 (2) | 18 (1) | 1 (0) |
| 50 m | 30 (25) | 48 (3) | 1 (0) |
| 100 m | 87 (76) | 103 (8) | 2 (0) |
| 150 m | 109 (94) | 149 (13) | 4 (0) |
| 250 m | 137 (117) | 244 (29) | 12 (0) |
| 500 m | 168 (142) | 415 (77) | 26 (3) |
| 1,000 m | 217 (169) | 680 (205) | 63 (10) |

For DOT/BTS, 58 of the 87 locations at 100 m and 98 of the 137 at 250 m have a candidate tagged as a rest stop, travel center or truck stop. The tag is a clue. Missing tags occur at plausible matches such as Canoe Creek Service Plaza. A conflicting travel direction can rule out a match even when the tag agrees. Plainfield northbound lies 101 m from the southbound charger candidate, and [Connecticut DOT lists separate plazas](https://portal.ct.gov/dot/travel-gateway/roads-and-highways/rest-areas). At Point Reyes the campground record is 10 m from an AFDC charger, but the [Park Service places it at the Bear Valley Visitor Center](https://www.nps.gov/pore/planyourvisit/evchargingstations.htm) and documents separate overnight parking rules. These spot checks illustrate errors that cannot be measured from coordinates alone. The study does not estimate precision or recall without a labeled set of entrances and premises.

At 250 m, 117 DOT/BTS locations had a DC candidate and 37 had Level 2. All 12 campground candidates had Level 2. The two charger-level counts can overlap at a facility.

The app uses 250 m as the default for the optional nearby-charger filter, with 100, 500 and 1,000 m alternatives. A match can be across the highway. The directory gives the straight-line distance and a driving-directions link between the rest stop and charger. The planner still needs user-confirmed charging at the actual stop before crediting energy during the rest. For RIDB campgrounds the join is supplementary because coverage is sparse and facility pins can be reservation or visitor-center locations.

Run `python research/rest-traffic/charger_radius.py afdc.csv ntad.json ridb.zip`. Inputs are the AFDC all-stations CSV filtered to `fuel_type=ELEC&country=US&access=public&status=E&limit=all`, the full NTAD ArcGIS layer query in WGS84 with `OBJECTID,nhs_rest_stop,highway_route,state` and geometry, and the official RIDB full CSV ZIP. The script reads its Facilities entry. The station index uses a 1 km Cartesian grid on the sphere, then calculates great-circle distance for candidates in adjacent cells.
