# Third-party notices

Gasket is licensed under the Source First License 1.1 (see `LICENSE.md`). That license covers Gasket's own code only. The third-party parts below keep their own licenses.

## Leaflet 1.9.4

Bundled as `assets/web/lib/leaflet.js` and `assets/web/lib/leaflet.css`. https://leafletjs.com

```
BSD 2-Clause License

Copyright (c) 2010-2023, Volodymyr Agafonkin
Copyright (c) 2010-2011, CloudMade
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## us-atlas (U.S. state outlines)

`assets/web/states.js` holds U.S. state outlines derived from us-atlas (https://github.com/topojson/us-atlas), which is built from the U.S. Census Bureau's cartographic boundary files. The Census Bureau data is a U.S. government work in the public domain. us-atlas is distributed under this license:

```
Copyright 2013-2019 Michael Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

## Map data and online services

None of this data is bundled in the repository. The app fetches it while it runs, and each source's own terms apply.

- **OpenStreetMap:** map tiles and place names (Nominatim). © OpenStreetMap contributors. The data is available under the Open Database License: https://www.openstreetmap.org/copyright
- **Google Maps:** station names, places and prices (Places API), and driving routes (Routes API). Google Maps Platform Terms of Service: https://cloud.google.com/maps-platform/terms. The app shows a "Google Maps" credit wherever this content appears.
- **U.S. Environmental Protection Agency:** fuel economy data from fueleconomy.gov.
- **National Highway Traffic Safety Administration:** VIN decoding (vPIC) and safety recalls.
- **Federal Highway Administration:** posted speed limits (Highway Performance Monitoring System, via geo.dot.gov).
- **U.S. Department of Energy:** electric-charging and hydrogen station locations from the Alternative Fuels Data Center, via the National Renewable Energy Laboratory's developer network.
- **Tire Rack:** a car's factory tire size, and the tires sold in that size (type, wear rating, mileage warranty), read from tirerack.com when you open Tires in the Garage.
- **Station operators' own websites:** prices and station details from walmart.com and murphyusa.com, and the ExxonMobil station finder.
- **Brand logos:** fetched from each brand's own website or icon services at run time. The logos are trademarks of their owners.
