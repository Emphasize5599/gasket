# Third-party notices

Gasket is licensed under the Source First License 1.1 (see `LICENSE.md`). That license covers Gasket's own code only. The third-party parts below keep their own licenses.

## Experimental OpenStreetMap station data

The keyless test branch queries fuel-station locations from OpenStreetMap via Overpass. Data © OpenStreetMap contributors, available under the Open Database License (ODbL): https://www.openstreetmap.org/copyright . Station attribution is shown in the experimental map's station details and results. No Overpass server software is bundled.

Vela (https://github.com/PimpinPumpkin/Vela), GPL-3.0, was researched for feasibility. No Vela code, libraries, calibration files or request templates are incorporated; see KEYLESS_EXPERIMENT.md for the independent implementation and direct-reuse licensing gate.

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

## ZXing for JavaScript 0.23.0 (the VIN barcode scanner)

Bundled as `assets/web/lib/zxing.min.js` (the package's own UMD build, unmodified), loaded only when you scan a VIN. https://github.com/zxing-js/library . Copyright the ZXing authors and the ZXing for JavaScript contributors, under the Apache License 2.0:

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

========================================================================
jai-imageio
========================================================================

Copyright (c) 2005 Sun Microsystems, Inc.
Copyright © 2010-2014 University of Manchester
Copyright © 2010-2015 Stian Soiland-Reyes
Copyright © 2015 Peter Hull
All Rights Reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

- Redistribution of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.

- Redistribution in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in
  the documentation and/or other materials provided with the
  distribution.

Neither the name of Sun Microsystems, Inc. or the names of
contributors may be used to endorse or promote products derived
from this software without specific prior written permission.

This software is provided "AS IS," without a warranty of any
kind. ALL EXPRESS OR IMPLIED CONDITIONS, REPRESENTATIONS AND
WARRANTIES, INCLUDING ANY IMPLIED WARRANTY OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE OR NON-INFRINGEMENT, ARE HEREBY
EXCLUDED. SUN MIDROSYSTEMS, INC. ("SUN") AND ITS LICENSORS SHALL
NOT BE LIABLE FOR ANY DAMAGES SUFFERED BY LICENSEE AS A RESULT OF
USING, MODIFYING OR DISTRIBUTING THIS SOFTWARE OR ITS
DERIVATIVES. IN NO EVENT WILL SUN OR ITS LICENSORS BE LIABLE FOR
ANY LOST REVENUE, PROFIT OR DATA, OR FOR DIRECT, INDIRECT, SPECIAL,
CONSEQUENTIAL, INCIDENTAL OR PUNITIVE DAMAGES, HOWEVER CAUSED AND
REGARDLESS OF THE THEORY OF LIABILITY, ARISING OUT OF THE USE OF OR
INABILITY TO USE THIS SOFTWARE, EVEN IF SUN HAS BEEN ADVISED OF THE
POSSIBILITY OF SUCH DAMAGES.

You acknowledge that this software is not designed or intended for
use in the design, construction, operation or maintenance of any
nuclear facility.
```

Its build includes ts-custom-error 3.3.1 (MIT):

```
The MIT License

Copyright (c) 2019 Adrien Gibrat https://github.com/adriengibrat

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

The camera picture is read on the phone and is never saved or sent anywhere.

## us-atlas (U.S. state and county outlines)

`assets/web/states.js` and `assets/web/counties.js` hold U.S. state and county outlines derived from us-atlas (https://github.com/topojson/us-atlas), which is built from the U.S. Census Bureau's cartographic boundary files. The Census Bureau data is a U.S. government work in the public domain. us-atlas is distributed under this license:

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

## The recall-rating model (downloaded on first use, not bundled)

Advisory rates how serious a recall is on the phone. The first time it's needed, the app downloads these and keeps them on the phone (about 46 MB):

- **Transformers.js 3.7.1** (Hugging Face), from cdn.jsdelivr.net. Apache License 2.0. https://github.com/huggingface/transformers.js
- **ONNX Runtime Web** (Microsoft), the runtime Transformers.js ships with. MIT License. https://github.com/microsoft/onnxruntime
- **all-MiniLM-L6-v2** (sentence-transformers; the quantized ONNX copy by Xenova), from huggingface.co. Apache License 2.0. https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2

The recall text is rated on the phone; it isn't sent anywhere.

## Optional on-device explanations

Gemma 4 E4B instruction-tuned, Google, is downloaded only with consent; it is not bundled in the APK. Apache License 2.0. Model: https://huggingface.co/google/gemma-4-E4B-it . LiteRT conversion: https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm . Downloaded weights stay on the device and are excluded from backups.

LiteRT-LM Android 0.18.0 (Google AI Edge, Apache License 2.0) is bundled for native inference: https://github.com/google-ai-edge/LiteRT-LM . Java dependencies include Gson 2.14.0 (Google), Kotlin 2.4.0 and Kotlin coroutines 1.11.0 (JetBrains), under Apache License 2.0. The build preserves the resolved dependency license files and LiteRT-LM's complete native THIRD_PARTY_NOTICE.txt, including its differently licensed components. These are available using **Full AI runtime license notices** in Licenses & credits. The runtime's Apache license also accompanies these notices.

## Map data and online services

None of this data is bundled in the repository. The app fetches it while it runs, and each source's own terms apply.

- **OpenStreetMap:** map tiles and place names (Nominatim). © OpenStreetMap contributors. The data is available under the Open Database License: https://www.openstreetmap.org/copyright
- **Google Maps:** station names, places and prices (Places API), and driving routes (Routes API). Google Maps Platform Terms of Service: https://cloud.google.com/maps-platform/terms. The app shows a "Google Maps" credit wherever this content appears.
- **U.S. Environmental Protection Agency:** fuel economy data from fueleconomy.gov.
- **National Highway Traffic Safety Administration:** vehicle make/model catalog and VIN decoding (vPIC), and safety recalls. Catalog identity is not a fuel-economy rating or tire-fitment certification.
- **Federal Highway Administration:** posted speed limits (Highway Performance Monitoring System, via geo.dot.gov).
- **U.S. Department of Energy:** electric-charging and hydrogen station locations from the Alternative Fuels Data Center, via the National Renewable Energy Laboratory's developer network.
- **Brave Search:** a car's fuel tank size and which kind of spare tire it has, read from Brave Search's AI answer when the Garage has none (marked as such; check your owner's manual).
- **Tire Rack:** a car's factory tire size, and the tires sold in that size (type, wear rating, mileage warranty), read from tirerack.com when you open Tires in the Garage.
- **Discount Tire (Treadwell Research Park):** the wet stopping distances in Tires' "Why tread matters" picture (158 ft on new tires, 226 and 301 ft on worn ones), from its published new-vs-worn test results and credited under the picture. The picture itself is the app's own drawing.
- **Toll prices:** with your own HERE key (Settings), HERE Technologies' Routing API v8 prices toll roads on route options Route compares (router.hereapi.com; © HERE, credited where the prices show). Only the route's points and your trailer's axle count are sent.
- **Car pictures:** NHTSA's photo of each model (EVOX Images, the pictures nhtsa.gov's vehicle pages show) from api.nhtsa.gov, credited under it; when NHTSA has none, a photo from Wikimedia Commons, credited under it with its photographer and license (mostly Creative Commons; the link opens the file's page). With your own Fuel API key, your trim in a factory color from Fuel API (fuelapi.com, © EVOX Images), shown as delivered and credited under it. Doodles are the app's own drawings.
- **Open-Meteo (open-meteo.com):** the weather forecast along a trip's route past the National Weather Service's own (NOAA's National Blend of Models, else its default models) and the air-quality forecast (from the Copernicus Atmosphere Monitoring Service). Weather data by Open-Meteo.com, available under Creative Commons Attribution 4.0 (CC BY 4.0): https://open-meteo.com/en/license . Air quality: contains modified Copernicus Atmosphere Monitoring Service information 2026. Credited under the "Weather & air along the way" card.
- **National Weather Service (api.weather.gov):** the hourly forecast along a trip's route (about 6½ days ahead) and active watches, warnings and advisories. U.S. government work, public domain.
- **Station operators' own websites:** prices and station details from walmart.com and murphyusa.com, and the ExxonMobil station finder.
- **Brand logos:** fetched from each brand's own website or icon services at run time. The logos are trademarks of their owners.
