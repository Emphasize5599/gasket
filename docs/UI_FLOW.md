# First testing UI pass · 0.0.176

## Garage and Advice

Your car owns the photo/carousel, selection dots, fuel economy, then collapsed About this car. About's preview blurb is removed. Demo caveats/configuration detail are inside About, not below the carousel; EPA mileage remains clearly sourced and non-EPA examples are labeled illustrative. Observed mileage, cruising speed, tires and climate retain their own sections. Narrow screens use two-column EPA tiles rather than splitting labels.

Advice omits its generic introduction, the empty engine-settings card and the AI-download promotional card. Tire pressure has a short instruction; full pressure/spare limitations remain in Details. Required checkboxes stay visible and use the same gates. Warning findings stay visible, not sentence-truncated. Routine climate presets and longer engine explanations are collapsed; the fresh-air caution stays visible beside its acknowledgment. Towing cash keeps its amount/payment caution and researched help. AI summaries no longer repeat full checked finding text immediately; all checked findings remain expandable. This is presentation, not a model-prompt/rules overhaul (TODO 38 remains).

## Settings

The seven home entries are Map & stations; Trip defaults; Savings; Connections & usage; Local AI; Data & privacy; Help & troubleshooting. SettingsNav moves existing live controls into these groups without rebuilding them on Back. Ordinary input drafts commit on Done/closing Settings; existing immediate actions such as model commands and reward-ledger controls keep their behavior. Native Back returns to the Settings home before closing the page; values survive moving between groups. A persistent Done footer clears the navigation inset. Long descriptions use Details; counters, values, warnings and controls remain accessible. Planning defaults expose buffer, minimum savings, max extra time and the switching threshold. Optional keys are together rather than mixed with EV prices. Demo insertion, replaying onboarding, logs and licenses are under Help.

No key, budget, membership, backup, native service or provider is removed. Existing persisted settings are reused. Keys remain in the normal private settings fields, not extra onboarding metadata or diagnostics.

## Onboarding

Five focused, scrollable screens: Welcome → Station access → Savings → Optional local AI → Ready. Progress, Back, skip and explicit Next replace the former full Settings dump. Step and confirmed fields survive restart; normal private key storage/export exclusions apply. Skip goes to the map without scanning. Ready opens the existing car editor; demo exploration loads example vehicles without station fixtures or station discovery. Vehicle lookups may run normally once Garage is opened.

Website coverage/speed caveats are explicit. An API key is optional and can be added later; onboarding doesn't promise caps cover an entire Google account or guarantee no billing. Finishing/skip starts no station requests. The larger model is disabled initially for genuinely unfinished setup, and no model download starts without the existing separate confirmation. RAM is read from native memoryInfo; <8 GiB or lowMemory produces advisory wording, unknown RAM is called unknown, and neither blocks an opt-in. Download size is 3.66 GB plus runtime headroom. Existing installs aren't forced through onboarding or silently disabled. Help can replay the walkthrough without erasing cars/trips. Cancellation/resume/remove remain in Local AI; basic planning and checked notices need no larger model.

UI uses the existing colors, buttons, custom pickers and safe-area/status-dock offsets. Keyboard focus stays within onboarding; title focus and labeled progress identify each screen. Reduced-motion users get no transition animation. This does not implement the future illustrated character or per-hazard animations.

## Validation and phone checks

`ui-flow` checks 320/448px, light/dark, 30% enlarged text, three-button inset, no sideways overflow, screen Back/draft preservation, explicit AI consent/cancel, low RAM, no implicit station scans, seven Settings groups, native Back, planning-default save, walkthrough replay without duplicate IDs, Garage ordering and visible warning/ack controls. Existing affected tests now navigate the real Settings submenus through `tests/settings-ui.js`, never by unhiding controls. Setup/demo, model controller, cache/backup, source scans, hazard gates and route-consent tests remain in the release suite.

On device: replay setup from Help, try the own-car and demo paths, cancel a model download, open each Settings group, change defaults and reopen, expand About, and verify Advice remains understandable without opening every detail. Actual usability sessions with new testers remain TODO 46; this pass is not a distribution-rights/service-terms signoff.
