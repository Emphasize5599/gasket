# Tires and mileage (0.0.424)

Gasket adjusts planned mileage for the tires you entered (Garage → Tires: type, brand, model, tread), against the
tires the car's rating was measured on. Logged mileage you typed in (Observed mileage) is used as is: it was driven on
your tires already. Unknown tires change nothing.

## Rolling resistance of a tire (TireMath.rrOf)

Relative to a typical replacement all-season tire (1.0). 0.0.426 revised these against NHTSA's own measurements
(the owner supplied the PDFs; they answer 403 to downloads from here).

NHTSA Phase 1 lab data (DOT HS 811 119, 2009; rolling resistance coefficient, SAE J1269 single point):

| Tires (same size unless noted) | RRC |
|---|---|
| All-season / touring, 225/60R16: Turanza LS-T .01188, Turanza LS-V .01100, Pilot MXM4 .00903, Lifeliner Touring .01022, Pep Boys Touring HR .01077, Pirelli P6 .01147 | mean .01073 |
| Winter: Blizzak REVO1 .00928, Winterforce .01086 | mean .01007 (0.94×) |
| Ultra high performance summer: Potenza RE750 | .01164 (1.08×) |
| High performance all-season: Potenza RE92 | .00778 (0.73×) |
| Run-flat: Dunlop SP Sport 4000 DSST (P225/60R17) | .01031 |
| Fuel-efficient all-season: Goodyear Integrity (4 sizes) | .00733–.00933 (0.68–0.87×) |
| LT245/75R16 on-road all-season: LTX A/S .00923, LTX M/S .00952, X Radial LT .00945, Scrambler A/P .00991, Road Venture HT .00980 | mean .00958 |
| LT245/75R16 all-terrain: Discoverer ST-C .00976, AmeriTrac TR .01158 (plus LT235/LT265 ST-C .00990/.00948) | 1.06–1.11× on-road LT |

The FRIA's comparison (Table III-15): rolling resistance varies more within a category than between categories;
winter tires were within the all-season range. Type alone predicts little, so most types are 1.0.

| Tire | Factor | Basis |
|---|---|---|
| Touring / grand touring / highway / all-season / high-performance all-season | 1.00 | reference (NHTSA: no consistent category difference) |
| All-weather, winter / studless | 1.00 | NHTSA measured winter tires within the all-season range (2 tires) |
| Summer, ultra-high / max performance | 1.08 | NHTSA: Potenza RE750 1.08× |
| All-terrain | 1.25 | lab 1.06–1.11×, but Tire Rack's on-vehicle pair (Grabber HTS60 22.7 vs AT2 22.0 mpg) cost 3.2%, which also includes tread mass and squirm: 1.25 gives ~3% with the measured elasticity |
| Rugged terrain | 1.35 | between all-terrain and mud-terrain (no measurement) |
| Mud-terrain | 1.50 | no controlled measurement; scaled up from all-terrain, cautious |
| Fuel-saving lines (Ecopia, Energy Saver, LRR…) | ×0.85 | NHTSA: Goodyear Integrity 0.68–0.87×; SR 286: OE tires average 0.0091 vs 0.0112 for replacements |
| Run-flat (RFT, ZP, SSR, DSST…) | ×1.20 | SR 286 p. 63: "at least 20 percent higher" than conventional OE tires on the same vehicle |
| Tread wear | × (1 − 0.2 × worn share) | SR 286 p. 45 and ch. 4 ("20 percent or more as the tread diminishes"); NHTSA Phase 2: "can decrease by more than 20 percent from a new tread to completely worn" |

The car's tires are averaged over its road tires (trailers and the spare excluded). The rating's tires are taken as
0.9 of a typical replacement (factory tires roll easier: SR 286 OE vs replacement means), an EV's 0.85 (EVs ship on
low rolling resistance tires).

## Mileage

Gas, diesel, hybrid and hydrogen (TireMath.rrMileage): fuel use per mile changes by elasticity × the rolling
resistance change: 0.10 in city driving and 0.12 on the highway. NHTSA measured it on a vehicle with 16 tire models
(DOT HS 811 154, Table 19, % mpg per % rolling resistance): city FTP 0.102, highway FET 0.113, high-speed US06 0.132,
A/C SC03 0.083, cold FTP 0.112 ("a 10 percent decrease in tire rolling resistance resulted in approximately 1.1
percent increase in fuel economy"). 0.0.425 used SR 286 Table 3-1's simulated 0.18 for highway, which overstated it.
Combined: 55% city / 45% highway, as the EPA does.

EVs (Garage.tireEffect, evEnergy): the ratio scales the rolling term A of the model's EPA road-load (coast-down) curve
(else the typical EV's, Propulsion.ROAD_MEDIAN), so rolling counts for more at town speeds, where it's a larger share
of road load; the same scaled curve shapes trip energy by speed.

## Not modeled

Tire pressure (SR 286: each psi below 36 adds ~1.4% rolling resistance), load range / ply (LT tires heavier), width
and diameter, and road surface. Tire-by-tire RRC isn't published in the US.

## Sources

- NHTSA Tire Fuel Efficiency Phase 1, Laboratory Test Protocols (DOT HS 811 119, 2009): https://nhtsa.gov/document/phase-1-evaluation-laboratory-test-protocols-nhtsa-tire-fuel-efficiency-consumer
- NHTSA Phase 2, Effects of Tire Rolling Resistance Levels on Traction, Treadwear, and Vehicle Fuel Economy (DOT HS 811 154, 2009): https://downloads.regulations.gov/NHTSA-2025-0491-0088/attachment_36.pdf
- NHTSA Replacement Tire Consumer Information Program FRIA / PRIA: https://www.nhtsa.gov/sites/nhtsa.gov/files/rolling_resistance_fria.pdf , https://www.nhtsa.gov/sites/nhtsa.gov/files/pria-rollingresistance.pdf
- California State Fuel-Efficient Tire Report, Volume I (2003; summary only, no category data): https://downloads.regulations.gov/NHTSA-2008-0121-0009/attachment_1.pdf

- TRB Special Report 286, Tires and Passenger Vehicle Fuel Economy (2006): https://www.nationalacademies.org/read/11620/chapter/5
- TRB SR 286 summary: https://www.trb.org/publications/sr/sr286TRNewsSummary.pdf
- Tire Rack all-terrain vs highway test: https://www.tirerack.com/tires/tests/testDisplay.jsp?ttid=210
- EU tyre label rolling-resistance classes (Regulation 1222/2009): https://legislation.gov.uk/eur/2009/1222/annexes/adopted

# EV best cruising speed (0.0.424)

Garage → Best cruising speed for an EV with an EPA road-load test (RoadLoad.forCar): mileage by speed =
highway mi/kWh × (P(61)/61) / (P(v)/v), P(v) = (A·tires + Bv + Cv²) lbf × v → kW / 0.85 + 1.2 kW, the same model trip
planning uses (Propulsion.drivePower, LABEL_MPH 61). The recommended speed is Speed.recommend's (the highest speed
where 1% faster costs no more than 1% more energy, or your $/hr), priced at the EV price setting or a typed $/kWh.
