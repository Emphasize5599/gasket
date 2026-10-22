# Refueling time estimates

Active dispensing time uses the amount actually purchased, not tank capacity:

1. Gasoline, E85 and retail diesel: 8 US gallons/minute. This is a planning assumption, not a measured station rate; high-flow truck pumps are not assumed. EPA's historical dispenser testing reports normal gasoline rates around 8–9 gal/min. The US 10 gal/min gasoline limit is a maximum, not a guaranteed rate. [EPA test-procedure evidence](https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P100S9WU.TXT), [EPA flow limit](https://www.epa.gov/sites/default/files/2020-10/documents/fuels-streamlining-fr-2020-10-15.pdf).
2. Light-duty hydrogen: 1 kg/minute, an approximate conservative planning rate rather than a pressure/temperature simulation. A 5 kg purchase takes about 5 minutes of dispensing. DOE describes typical retail fills as 3–5 minutes; partial fills, station recovery and equipment conditions can differ. [DOE AFDC](https://afdc.energy.gov/fuels/hydrogen-basics).
3. EV: SOC-dependent charging simulation, separate stored/billed energy, hourly-weather/thermal estimates and destination charging. See [PROPULSION_MODELS.md](PROPULSION_MODELS.md). The old average-kW estimate remains only for unmodeled/legacy inputs.

Trip comparisons, subsequent-stop arrival times and post-plan hazard timing add dispensing time, detour driving and a separate setup allowance: 3 minutes per liquid/hydrogen stop; the existing 5 minutes for EVs. Do not also add the former fixed 8/10-minute gas/hydrogen stop estimates. No prediction of queues, food/restroom breaks, pump outages or hydrogen compressor recovery is made. The dispensing-only tile parallels the EV charging tile; its help explains the setup allowance and uncertainty. Per-leg totals assign each purchase/top-up to its arriving leg.
