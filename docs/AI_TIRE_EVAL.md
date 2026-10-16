# Local AI tire explanations: evaluation (0.0.170)

Gasket's on-phone Gemma 4 E4B explains the **checked tire findings** (`TirePolicy`, rules version 3); it adds no facts. This page records how the prompt was tuned and what the model actually wrote.

## How it was run

`tools/gemma-eval/` runs the same pinned `gemma-4-E4B-it.litertlm` (revision `2eee7ac…`, SHA-256 `0b2a8980…52e0`, checked) through LiteRT-LM 0.18.0's Python package on a 4-core CPU, with the app's own system prompt (read from `GemmaRuntime.java`) and sampler (top-k 10, top-p 0.9, temperature 0.1, seed 1). Prompts come from the app's `TirePolicy.prepare` / `prompt` on the demo cars plus a few edge cases (`cars.js`); every answer goes through the app's own output guard (`TirePolicy.check`).

```
pip install litert-lm
node tools/gemma-eval/gen.js prompts.json
python3 tools/gemma-eval/run.py /path/to/model.litertlm prompts.json out.json
node tools/gemma-eval/check.js out.json
```

CPU times here were 25–70 s per answer; the phone runs it on its GPU. This is not a phone acceptance test (TODO 38).

## What was wrong

The 0.0.168 log's answer was accepted but said nothing: a good set of estimated tires produced only two generic notices ("estimated wear is generalized", "check size, model, pattern and fitment"), the second fired on every car because no tire ever has a known tread pattern, and the card printed each notice in bold followed by the model's restatement of it. The model was explaining an empty list.

## What changed

- Findings now say what a tire shop would: each group's tread and what it means, miles left until 4/32 and 2/32 at its rate, past its warranty, rotation answer, **age from the DOT date code** (yearly inspection from 5 years; some makers replace at 6–10; 10 is past what makers allow), the spare's kind and age (assumed from the model year when undated), tread differences by drivetrain, which tire doesn't match the others, duals and trailers. A set bought together is one finding ("All four tires: …").
- The prompt lists the findings only, numbered and most urgent first (URGENT / SOON / CHECK / NOTE), and asks for a 2–3 sentence summary naming every urgent finding first, plus the top 1–3 findings by number with one sentence each on why they matter. Numbers instead of IDs: the model copied IDs badly ("driver-rear" for "tread:driver-rear").
- Tuning fixes, each from a wrong answer: the Mirai's fronts were called worse than its rears (fixed by the urgency order); the RAM's mismatched inner dual was tied to four-wheel drive (fixed by "do not link findings the list doesn't link"); a 3.6-year-old spare became a concern (fixed by findings that state "Well within the age makers allow" and "a NOTE is not a problem").

## Final answers (all accepted by the guard)


### blazer-good (26.4 s) ACCEPTED
**Summary:** The tires have plenty of tread left, with an estimated 9/32 in on all four tires. They are also well within the age limits set by the manufacturer. A repair kit is available, but it has limitations.
 * [5] The current repair kit sealant has an expiration date and cannot repair sidewall damage or a blowout.

### old-save-unknowns (45.2 s) ACCEPTED
**Summary:** The tires are estimated to be at 3/32 in, which is below the 4/32 in threshold where wet stopping distances increase rapidly. It is also unknown when the tires were manufactured, and their current wear rate suggests they may reach 2/32 in in about 6,000 miles.
 * [1] The current tread depth is below 4/32 in, which means wet stopping distances are increasing quickly.
 * [2] The age of the tires is unknown, and the DOT date code should be entered to check this.
 * [3] Based on current wear, the tires are estimated to reach 2/32 in in approximately 6,000 miles.

### all-fine-measured (27.5 s) ACCEPTED
**Summary:** All four tires have plenty of tread left, and the spare tire is also within its age limits. The tires were made in week 10 of 2025, 1.6 years ago, and the spare was made in week 9 of 2023, about 3.6 years ago.
 * [4] The compact spare is intended only for reaching a tire shop and has specific speed and distance limitations.

### 2021 Toyota Prius Prime LE (40.8 s) ACCEPTED
**Summary:** The rear tires are due for replacement soon because their tread is low, and the front tires have plenty of tread left. Additionally, the rear tires are seven years old, which is a factor to consider. The front tires are in good condition and are relatively new.
 * [1] The low tread on the driver's rear tire means wet stopping distances can increase quickly.
 * [2] The low tread on the passenger's rear tire means wet stopping distances can increase quickly.
 * [3] The rear tires are seven years old, and some manufacturers suggest replacement regardless of tread depth.

### 2024 RAM 3500 Tradesman (64.5 s) ACCEPTED
**Summary:** The front tires are worn to the legal minimum and must be replaced before driving, and the passenger rear inner tire and the demo cargo trailer axle 1 tires are over ten years old and should be replaced regardless of tread. Additionally, the front tires have not been rotated, and there are mismatched tires on the vehicle that should be checked for fitment. Other tires have plenty of tread remaining.
 * [1] The front tires are worn to the legal minimum and need to be replaced before driving.
 * [2] The passenger rear inner tire is over ten years old and should be replaced regardless of tread.
 * [3] The demo cargo trailer axle 1 tires are over ten years old and should be replaced regardless of tread.

### 2021 Tesla Model 3 Long Range AWD (42.4 s) ACCEPTED
**Summary:** The driver rear tires are nearing the point where replacement is advised due to reduced tread depth. Additionally, there are inconsistencies in tire matching and tread depth across the vehicle that require attention. Other tires currently have sufficient tread and age.
 * [1] The driver rear tires are approaching a depth where wet stopping distances increase significantly.
 * [3] The significant difference in tread depth across the tires can cause the vehicle's all-wheel drive system to overheat and wear out.
 * [2] The tires on the vehicle are not all the same brand or model, which may affect how the car handles.

### 2021 Toyota Mirai XLE (46.9 s) ACCEPTED
**Summary:** All four tires are past the recommended age limit of ten years and should be replaced regardless of tread depth. The rear tires are nearing a depth where wet stopping distances increase quickly, and the front tires are also approaching a point where grip for wet and snow conditions fades. The compact spare is also getting older and may need replacement.
 * [1] All four tires are over ten years old, which is past the recommended lifespan for tire and vehicle makers.
 * [2] The rear tires are getting low, and wet stopping distances can increase rapidly when tread depth drops below 4/32 in.
 * [3] The front tires are approaching a depth where grip for wet and snow conditions begins to fade.
