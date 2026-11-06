# U.S. EV charging profiles

Established profiles use a measured session or a documented match to a measured vehicle. EPA or observed efficiency remains a separate choice. A custom profile requires charging power entered by the driver. See [Tesla pack coverage](TESLA_PACKS.md) for the existing Tesla profiles.

| Profile | Catalog match | Evidence |
| --- | --- | --- |
| Bolt EV 65 kWh class | U.S. 2022 Chevrolet Bolt EV | Rounded planning approximation based on the published plot and elapsed-time checkpoints. The 0–25%, 0–50%, 0–75%, and full-session times were 25, 47, 75, and 133 minutes. The model uses a smooth taper and is less certain at the end of a session. [State Of Charge test](https://insideevs.com/news/613786/chevrolet-bolt-ev-fast-charging/) |
| Rivian first-generation Large Pack | U.S. 2022 R1T and R1S | Approximate warm R1T curve using the measured 350 kW session after the 500 A software update. The R1S uses the R1T reference based on the same Large Pack generation and the tester's reported 40–45 minute 10–80% range for both vehicles. A separate R1S power trace would improve confidence in the taper. [Measured R1T session](https://insideevs.com/news/586886/how-long-to-charge-rivian-r1t/), [R1T and R1S comparison](https://insideevs.com/features/633791/rivian-r1t-charging-review/) |

Compare elapsed time in multiple state-of-charge bands before adding another pack, model, or generation. Record the charging equipment, software, temperature where available, and whether power was measured at the charger or battery.

The 77.4 kWh Ioniq 5, EV6, and GV60 are the next cross-model candidates. Their aggregate U.S. measurements agree closely. The remaining step is to compare intermediate points from the tested configurations and track voltage-dependent charging behavior. The 91 kWh Mach-E and the 85 kWh Prologue/Blazer EV are also candidates for narrower reuse. [Hyundai/Kia/Genesis comparison](https://www.caranddriver.com/news/a40907906/tested-hyundai-kia-genesis-fastest-charge-evs/), [charger voltage comparison](https://www.caranddriver.com/news/a64410159/2025-hyundai-ioniq-5-nacs-port-charging-test/), [Ford specifications](https://media.ford.com/content/dam/fordmedia/North%20America/US/2024/04/09/2024%20Mustang%20Mach-E%20Tech%20Specs.pdf), [Prologue charging test](https://www.caranddriver.com/reviews/a46788612/2024-honda-prologue-ev-drive/)
