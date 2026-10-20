# Visual distortion diagnostics

## Current behavior: 0.0.225

The 224 GPU texture-layer experiment failed on the owner's phone while the layer was active. It is removed, including its switch/controller/commands. Native rendering is back to223; bounded AI engine reuse and automatic diagnostic samples remain. Earlier sections are historical, not current settings instructions.

A brief notice below the task status bar says: “Screen flickering? Try turning on ‘Disable HW overlays’ in your device’s Developer options.” It starts only when larger AI work is actually requested (automatic GPU attempt), once per continuous batch, and disappears on ×, after10s, on cancellation/CPU fallback, or when the batch finishes. It does not show for app launch, enabling AI alone, model downloads, CPU-only work or station jobs. This is a qualified workaround, not a universal promise. The app never changes the device's Developer options.

**Settings → Help & troubleshooting → Show visual glitch button** defaults off. Turn it on to reveal the task-dock marker during diagnostic watching; Debug logging must also be at Steps or higher. No duplicate marker button in Help. Toggle persists immediately; disabling it hides the button without stopping automatic samples or deleting existing markers. The expanded markers remain private app storage and are cleared with the log.

## Further phone diagnosis

0.0.225 also marks the larger AI's work in system traces: the sections **Gasket AI load** and **Gasket AI generate GPU** (or **CPU**) appear on Gasket's AI worker thread, and the app is `profileable` (shell) so the phone's own System Tracing can record it. In a trace, a bad frame can be lined up with whether the model was loading or generating at that moment.

1. Leave Gasket's Debug logging at Everything. Optionally enable its visual glitch button. Do not use screen video recording: the owner reports it hides the problem. An external camera can document the visible artifact if needed.
2. Open **Android Settings → System → Developer options → System Tracing**, then enable its Quick Settings tile. Use the normal bounded rolling-buffer mode; no long/unbounded capture is needed. Where offered, graphics/view/window-manager and CPU scheduling/frequency categories are useful. Availability varies by OS/build. [Android system-trace instructions](https://developer.android.com/topic/performance/tracing/on-device).
3. For a failing run, turn **Disable HW overlays OFF**, start the System Tracing tile, and request an explanation. If distortion occurs, mark it if enabled, note the approximate time, then stop the system trace promptly (default rolling buffers retain about10–30s). Save the `.perfetto-trace`. Tracing itself can affect timing; report if it prevents reproduction.
4. AFTER stopping the trace, use **Developer options → Take bug report** and save that report plus the Gasket log. This captures broader system logs/state, not just this app. Bug-report collection must not pollute the performance trace. [Android bug-report instructions](https://developer.android.com/studio/debug/bug-report).
5. A second short run with **Disable HW overlays ON**, same AI setup, is the useful control. This changes composition, not AI model/backend. Restore your preferred workaround after testing; it may increase rendering work/battery use. Do not change many graphics settings at once. Flashing redraw indicators, overdraw visualization and Force4×MSAA are not recommended for this comparison.
6. Review reports before sharing: they may include personal data, app/device identifiers and unrelated system activity. Share privately, not on a public issue. Basic system tracing/bug reports do not require rooting the phone. Full [Winscope compositor tracing](https://source.android.com/docs/core/graphics/winscope/capture/adb) has privileged/debug-build requirements; do not root or unlock the bootloader just to obtain it. No custom app method profiling/privileged HWC access is promised by this signed release.

## Retired: 0.0.224 app-local graphics experiment

The owner confirmed Android's **Disable HW overlays** removes the distortion. This resembles the reports in [GrapheneOS issue6757](https://github.com/GrapheneOS/os-issue-tracker/issues/6757), including recording hiding the problem; it does not establish the exact driver fault. 223's log confirms successful serial GPU work and actual engine reuse, without low-memory or thermal flags. Reuse is retained for performance, not claimed as a graphics fix.

224 enables **Settings → Local AI → AI graphics compatibility · experimental** by default, per owner request; an explicit off choice persists. It temporarily renders Gasket's WebView into a [hardware texture layer](https://developer.android.com/topic/performance/views/hardware-accel-views#view-layers) during foreground GPU jobs and brief warm-engine gaps. Original rendering is restored when the batch drains, AI is disabled/cancelled and released, the CPU stands in, or the app is paused/destroyed/loses its renderer. Memory pressure releases it until the current batch ends. Nonaccelerated/software-layer windows, zero/oversized layout and native layer exceptions do not repeatedly attempt activation. One layer, <=8M pixels and <=8192 per dimension; actual driver allocation can exceed the raw ~32MB RGBA texture bound due to internal buffering/caches.

This is NOT equivalent to Disable HW overlays: Android still chooses final display composition. No new permissions, privileged controls, screen recording, dummy windows, colors, blur or AI runtime changes. Other apps and notification shade are not controlled. It may have no effect on the distortion and remains an experiment, not a UI rewrite or guaranteed fix.

**Phone comparison:** temporarily turn Android **Disable HW overlays OFF** so it doesn't hide the result. Keep app compatibility ON, repeat demo/forced explanations without recording, and mark any glitch. Compare with app compatibility OFF. Check background/resume and the status text after completion. If corruption remains, restore the known system workaround as needed and share the log. New `AI graphics experiment` / `ai_graphics_mode` records and marker/frame snapshots report enabled/active/layer type, job/foreground/memory hold, skip/error and reason. These contain no screen text or model content. Controller/JVM and browser tests verify lifecycle, ownership, defaults, no churn, exceptions, command isolation and narrow/enlarged layout, not Pixel graphics behavior.

0.0.221 adds metadata for the owner's transient distortion after model reloads. This is instrumentation, **not a claimed flicker fix**. GPU inference, runtime choice and resource-release policy remain unchanged.

Published as **Gasket 0.0.221 — Debug diagnostics**, a GitHub prerelease, signed with the existing release key. This does not enable Android's `debuggable` flag or change the package identity.

## 0.0.223 controlled reuse experiment

222 passed the new service tests but its APK build was blocked by an unrelated trailer test fixture race; 223 corrects that fixture and ships the same reuse experiment. The 222 source tag is preserved.

Individual forced Tesla explanation did not reproduce the owner's demo-batch distortion. The demo log showed serial, not overlapping, generations, repeated 10–15s reloads and GPU frame-time spikes near markers. Reuse is a hypothesis-driven experiment, not a confirmed graphics fix.

Only one engine may exist, including between requests; its global lease stays held until native close succeeds. Each request still creates and closes a fresh conversation. The JS queue releases the warm engine when drained; native cleanup also runs after three idle seconds, on cancellation, processor change, renderer loss or service closure. Reuse is denied on GPU fallback, native failure, OS low-memory, <2GiB available RAM, >512MiB process-PSS growth since the engine's first completed request, or the eighth request. Missing memory data disables retention. The observed model footprint is still roughly 5GiB: reuse avoids repeated allocation/loading, not the model's own memory cost.

New `engine_initialized`, `engine_reused`, `retained_idle` and `releasing_<reason>` milestones distinguish actual reuse from reloads. Compare erase→demo to a forced individual explanation without screen recording; mark any distortion and export the log. JVM fixtures exercise service sequencing and cleanup but cannot validate Pixel graphics or actual model memory behavior.

The pinned stock [LiteRT-LM Kotlin GPU configuration](https://github.com/google-ai-edge/LiteRT-LM/blob/b2f686e2ed4718fb84ec398a61dd59ca0f0aff27/kotlin/java/com/google/ai/edge/litertlm/Config.kt) exposes no utilization/ramp or priority control. Java thread priority or a ten-second delay would not throttle GPU work. No patched runtime or claimed GPU throttle is included in this experiment.

## Phone procedure

1. Keep Debug logging on at Everything (the default). Optionally enable **Show visual glitch button** in Help & troubleshooting, then tap **Mark visual glitch** below the status bar as soon as distortion appears.
2. Let the current explanation finish if possible, then share the debug log from Help & troubleshooting. Repeated vehicle explanations work normally; no screen recording is required.
3. If corruption extends into the notification shade, an Android bug report or an external-camera video may still be needed. Frame timing cannot prove that rendered pixels are correct. The app does not collect system-wide logcat, GPU driver dumps or screen captures.

## What is recorded

1. Native generation/instance IDs, wall-clock and monotonic timestamps; load, generation, first output, completion, release and periodic generating samples. A 32-event native milestone ring preserves events between coalesced statuses. First output means the first nonempty text callback, not necessarily the first internally decoded token.
2. Five-second/per-phase Android frame buckets: counts, missed deadlines, maximum total/draw/layout/input/sync/command/swap/GPU duration, lost reports, display refresh/state, focus and hardware acceleration. GPU timing availability is explicit. This measures the app window, not other apps or the compositor's actual pixels.
3. Web animation-frame gaps, event-loop lateness, long-task durations, aggregate DOM mutations/node additions/removals and counts of Advice/Garage/trip/status redraws. Visibility/focus/resize and Android pause/resume/focus events are correlated. Hidden-page timer throttling is not reported as an ordinary foreground stall.
4. Native PSS/heap/available memory, Android thermal status (an OS severity code, not temperature), power-saving/interactive state, OS build/security patch and WebView version. Marker snapshots add current display/window and native AI state.
5. Anonymous vehicle ordinal/request/acceptance milestones, not vehicle names, identifiers, prompts or generated text in this new diagnostic stream.

## Bounds, privacy and overhead

1. No screenshots, DOM text, input values, passwords, coordinates or model text collected by the new probes. Existing logs still have their normal troubleshooting content and key/VIN redaction; shared logs should be treated as private.
2. Web collection runs only during AI and a ten-second tail; 96 breadcrumbs and four saved markers (48 pre-marker breadcrumbs each). Saved marker history has a 180k-character budget. Full backup includes this private app-storage namespace. Clearing the log clears it too; a late native snapshot cannot recreate cleared markers.
3. Ordinary log memory is bounded around 1 MiB. Sharing includes the retained log plus marker/timeline metadata; the on-screen viewer previews only the newest 150k characters. Periodic UI measurements are aggregated, never written each frame. Android frame callbacks use a background HandlerThread; PSS/disk samples use a separate, one-slot telemetry queue, not the cancellation timer or GPU callback.
4. Diagnostic-only native messages cannot change AI state, re-open frame collection or redraw menus. Disabling debug logging (or using a level below Steps) stops the expanded probes. Existing minimal crash-recovery journaling remains for safe AI recovery.
5. Automated tests validate UI placement/overflow at 320/448px and enlarged text, marker contents, bounds, deduplication, privacy canaries, clear/disable behavior, and suppression of stale telemetry redraws. CI compiles native code and exercises existing cancellation/runtime contracts. Actual Pixel GPU/compositor distortion still requires phone observation.
