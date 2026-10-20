# Visual distortion diagnostics

0.0.221 adds metadata for the owner's transient distortion after model reloads. This is instrumentation, **not a claimed flicker fix**. GPU inference, runtime choice and resource-release policy remain unchanged.

Published as **Gasket 0.0.221 — Debug diagnostics**, a GitHub prerelease, signed with the existing release key. This does not enable Android's `debuggable` flag or change the package identity.

## Phone procedure

1. Keep Debug logging on at Everything (the default). During local AI work, tap **Mark visual glitch** below the status bar as soon as distortion appears. It is also under Settings → Help & troubleshooting.
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
