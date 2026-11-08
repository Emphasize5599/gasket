# Tires and mileage (0.0.424)

Gasket adjusts planned mileage for the tires you entered (Garage → Tires: type, brand, model, tread), against the
tires the car's rating was measured on. Logged mileage you typed in (Observed mileage) is used as is: it was driven on
your tires already. Unknown tires change nothing.

## Rolling resistance of a tire (TireMath.rrOf)

Relative to a typical replacement all-season tire (1.0):

| Tire | Factor | Basis |
|---|---|---|
| Touring / grand touring / highway / all-season | 1.00 | reference |
| High performance all-season | 1.12 | SR 286: W/Y/Z-rated replacement tires average 0.0113 vs 0.0098 for S/T; OEM figures put performance tires ~1.2–1.4× all-season |
| Summer, ultra-high / max performance | 1.20 | same, upper end |
| All-weather (snowflake-rated) | 1.10 | winter-capable compound; between all-season and winter |
| Winter / studless | 1.20 | common Crr ranges 0.012–0.016 vs 0.010–0.014 for all-season (secondary sources; SR 286 excluded winter tires from its data) |
| All-terrain | 1.20 | Tire Rack's same-truck test: General Grabber HTS60 22.7 mpg vs Grabber AT2 22.0 mpg (3.2%); with the 0.18 highway elasticity, 1.2 gives 3.6% |
| Rugged terrain | 1.30 | between all-terrain and mud-terrain |
| Mud-terrain | 1.45 | retailer/press figures of 3–7% (no controlled test found); cautious |
| Fuel-saving lines (Ecopia, Energy Saver, LRR…) | ×0.85 | SR 286: original-equipment tires average RRC 0.0091 vs 0.0112 for replacements (Michelin 1994 data) |
| Run-flat (RFT, ZP, SSR, DSST…) | ×1.20 | SR 286 p. 63: "at least 20 percent higher" |
| Tread wear | × (1 − 0.2 × worn share) | SR 286 p. 45: RRC falls ~20% (Schuring) to 26% (Martini) over the tread life, new depth → 2/32 |

The car's tires are averaged over its road tires (trailers and the spare excluded). The rating's tires are taken as
0.9 of a typical replacement (factory tires roll easier: SR 286 OE vs replacement means), an EV's 0.85 (EVs ship on
low rolling resistance tires).

## Mileage

Gas, diesel, hybrid and hydrogen (TireMath.rrMileage): fuel use per mile changes by elasticity × the rolling
resistance change, 0.10 in city driving and 0.18 on the highway: TRB Special Report 286 Table 3-1 (four simulation
models, midsize car, baseline RRC 0.008: a 10% RRC change gave 0.7–1.4% city and 1.6–2.0% highway). Combined:
55% city / 45% highway, as the EPA does. NHTSA's labeling analysis used 1.1% per 10%; SR 286 states 1–2%.

EVs (Garage.tireEffect, evEnergy): the ratio scales the rolling term A of the model's EPA road-load (coast-down) curve
(else the typical EV's, Propulsion.ROAD_MEDIAN), so rolling counts for more at town speeds, where it's a larger share
of road load; the same scaled curve shapes trip energy by speed.

## Not modeled

Tire pressure (SR 286: each psi below 36 adds ~1.4% rolling resistance), load range / ply (LT tires heavier), width
and diameter, and road surface. Tire-by-tire RRC isn't published in the US.

## Sources

- TRB Special Report 286, Tires and Passenger Vehicle Fuel Economy (2006): https://www.nationalacademies.org/read/11620/chapter/5
- TRB SR 286 summary: https://www.trb.org/publications/sr/sr286TRNewsSummary.pdf
- Tire Rack all-terrain vs highway test: https://www.tirerack.com/tires/tests/testDisplay.jsp?ttid=210
- EU tyre label rolling-resistance classes (Regulation 1222/2009): https://legislation.gov.uk/eur/2009/1222/annexes/adopted

# EV best cruising speed (0.0.424)

Garage → Best cruising speed for an EV with an EPA road-load test (RoadLoad.forCar): mileage by speed =
highway mi/kWh × (P(61)/61) / (P(v)/v), P(v) = (A·tires + Bv + Cv²) lbf × v → kW / 0.85 + 1.2 kW, the same model trip
planning uses (Propulsion.drivePower, LABEL_MPH 61). The recommended speed is Speed.recommend's (the highest speed
where 1% faster costs no more than 1% more energy, or your $/hr), priced at the EV price setting or a typed $/kWh.
