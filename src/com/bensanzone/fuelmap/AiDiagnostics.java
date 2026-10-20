package com.bensanzone.fuelmap;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Debug;
import android.os.Process;
import org.json.JSONArray;
import org.json.JSONObject;

/** Bounded metadata only: no prompts, answers, vehicle identifiers, URLs or credentials. */
final class AiDiagnostics {
    private final ActivityManager manager;
    private final SharedPreferences prefs;
    private final android.os.PowerManager power;
    private final long instanceId = android.os.SystemClock.elapsedRealtime();
    private final java.util.ArrayDeque<JSONObject> timeline = new java.util.ArrayDeque<>();
    private volatile long runId;
    final JSONObject startup = new JSONObject();
    final boolean interrupted;
    private volatile JSONObject latest = new JSONObject();
    private long sequence, started;

    AiDiagnostics(Context context, SharedPreferences prefs) {
        this.prefs = prefs;
        power = (android.os.PowerManager) context.getSystemService(Context.POWER_SERVICE);
        manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        JSONObject previous = new JSONObject();
        try { previous = new JSONObject(prefs.getString("lastNativeTask", "{}")); } catch (Exception ignored) { }
        boolean wasRunning = previous.optBoolean("inFlight") && previous.optInt("pid") != Process.myPid();
        try {
            startup.put("pid", Process.myPid()); startup.put("previousTask", previous);
            startup.put("device", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL);
            startup.put("sdk", android.os.Build.VERSION.SDK_INT); startup.put("soc", android.os.Build.SOC_MODEL);
            startup.put("osRelease", android.os.Build.VERSION.RELEASE); startup.put("osIncremental", android.os.Build.VERSION.INCREMENTAL);
            startup.put("securityPatch", android.os.Build.VERSION.SECURITY_PATCH); startup.put("hardware", android.os.Build.HARDWARE);
            startup.put("abis", new JSONArray(java.util.Arrays.asList(android.os.Build.SUPPORTED_ABIS)));
            startup.put("rendererExits", new JSONArray(prefs.getString("rendererExits", "[]")));
            JSONArray exits = new JSONArray();
            if (manager != null) for (ApplicationExitInfo exit : manager.getHistoricalProcessExitReasons(context.getPackageName(), 0, 5)) {
                JSONObject row = new JSONObject();
                row.put("timestamp", exit.getTimestamp()); row.put("pid", exit.getPid());
                row.put("reason", exit.getReason()); row.put("reasonName", reasonName(exit.getReason()));
                row.put("status", exit.getStatus()); row.put("importance", exit.getImportance());
                row.put("pssKb", exit.getPss()); row.put("rssKb", exit.getRss()); exits.put(row);
            }
            startup.put("processExits", exits);
            // Closed from Recents or force-stopped while generating: not a crash, so no pause
            for (int i = 0; i < exits.length(); i++) { JSONObject e = exits.getJSONObject(i); if (e.optInt("pid") == previous.optInt("pid") && "user_requested".equals(e.optString("reasonName"))) wasRunning = false; }
        } catch (Exception unavailable) { try { startup.put("exitDiagnosticsUnavailable", unavailable.getClass().getSimpleName()); } catch (Exception ignored) { } }
        interrupted = wasRunning;
    }
    static String reasonName(int reason) {
        switch (reason) {
            case ApplicationExitInfo.REASON_LOW_MEMORY: return "low_memory";
            case ApplicationExitInfo.REASON_ANR: return "anr";
            case ApplicationExitInfo.REASON_CRASH_NATIVE: return "native_crash";
            case ApplicationExitInfo.REASON_CRASH: return "java_crash";
            case ApplicationExitInfo.REASON_SIGNALED: return "signaled";
            case ApplicationExitInfo.REASON_USER_REQUESTED: return "user_requested";
            case ApplicationExitInfo.REASON_EXIT_SELF: return "exit_self";
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE: return "resource_usage";
            default: return "other";
        }
    }
    static void rendererExit(Context context, String scope, boolean crashed, int priority) {
        SharedPreferences prefs = context.getSharedPreferences("gasket_ai", Context.MODE_PRIVATE);
        try {
            JSONArray old = new JSONArray(prefs.getString("rendererExits", "[]")), events = new JSONArray();
            for (int i = Math.max(0, old.length() - 4); i < old.length(); i++) events.put(old.get(i));
            JSONObject event = new JSONObject(); event.put("timestamp", System.currentTimeMillis());
            event.put("pid", Process.myPid()); event.put("scope", scope); event.put("didCrash", crashed); event.put("priority", priority);
            JSONObject task = new JSONObject(prefs.getString("lastNativeTask", "{}"));
            boolean active = task.optBoolean("inFlight") && task.optInt("pid") == Process.myPid();
            event.put("nativeAiInFlight", active); events.put(event);
            SharedPreferences.Editor edit = prefs.edit().putString("rendererExits", events.toString());
            if (active && "app".equals(scope)) edit.putBoolean("recoveryRequired", true);   // a hidden reader's renderer: only that explanation stops
            edit.apply(); // UI callback: do not wait for disk or JNI before replacing the dead WebView.
        } catch (Exception ignored) { }
    }
    static String failure(Throwable error) {
        StringBuilder result = new StringBuilder();
        for (int i = 0; error != null && i < 3; i++, error = error.getCause()) {
            if (i > 0) result.append(" <- ");
            String message = String.valueOf(error.getMessage()).replaceAll("https?://\\S+", "[url]")
                .replaceAll("/[A-Za-z0-9_./-]+", "[path]")
                .replaceAll("\\b[A-HJ-NPR-Z0-9]{17}\\b", "[identifier]");
            result.append(error.getClass().getSimpleName()).append(": ").append(message.substring(0, Math.min(300, message.length())));
        }
        return result.toString();
    }
    synchronized void record(String stage, boolean inFlight, String backend, int contextTokens, int inputBytes, Throwable failure) {
        if (("generating_sample".equals(stage)||"first_output".equals(stage)) && (!latest.optBoolean("inFlight")||"releasing".equals(latest.optString("stage")))) return;
        JSONObject value = new JSONObject();
        long now = System.currentTimeMillis(), monotonic = android.os.SystemClock.elapsedRealtime();
        if ("load".equals(stage)) started = monotonic;
        try {
            value.put("sequence", ++sequence); value.put("stage", stage); value.put("timestamp", now);
            value.put("instanceId", instanceId); value.put("generationId", runId); value.put("monotonicMs", monotonic);
            value.put("elapsedMs", started == 0 ? 0 : monotonic - started); value.put("pid", Process.myPid());
            value.put("inFlight", inFlight); value.put("backend", backend); value.put("runtime", "stock-0.18.0");
            value.put("contextTokens", contextTokens); value.put("inputBytes", inputBytes);
            value.put("modelRevision", GemmaService.REV);
            value.put("nativeHeapBytes", Debug.getNativeHeapAllocatedSize()); value.put("pssKb", Debug.getPss());
            Runtime heap = Runtime.getRuntime(); value.put("javaUsedBytes", heap.totalMemory() - heap.freeMemory());
            value.put("javaMaxBytes", heap.maxMemory());
            if (power != null) { value.put("thermalStatus", power.getCurrentThermalStatus()); value.put("powerSave", power.isPowerSaveMode()); value.put("interactive", power.isInteractive()); }
            if (manager != null) { ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo(); manager.getMemoryInfo(memory);
                value.put("availableBytes", memory.availMem); value.put("totalBytes", memory.totalMem); value.put("lowMemory", memory.lowMemory); }
            if (failure != null) {
                value.put("failure", failure(failure)); JSONArray frames = new JSONArray();
                for (StackTraceElement frame : failure.getStackTrace()) {
                    if (frames.length() >= 12) break;
                    if (frame.getClassName().startsWith("com.bensanzone.") || frame.getClassName().startsWith("com.google.ai.edge.")) frames.put(frame.toString());
                }
                value.put("frames", frames);
            } else if (!"load".equals(stage) && latest.has("failure")) {
                value.put("failure", latest.get("failure")); if (latest.has("frames")) value.put("frames", latest.get("frames"));
            }
        } catch (Exception ignored) { }
        // Worker/timer only; a small synchronous write preserves the last stage across native death.
        try { if (!prefs.edit().putString("lastNativeTask", value.toString()).commit()) value.put("journalWriteFailed", true); }
        catch (Exception unavailable) { try { value.put("journalWriteFailed", true); } catch (Exception ignored) { } }
        latest = value;
        // Small milestones survive intermediate status messages being coalesced. No model text.
        try { JSONObject event=new JSONObject();for(String key:new String[]{"instanceId","generationId","sequence","stage","timestamp","monotonicMs","elapsedMs","backend","pssKb","availableBytes","thermalStatus"})if(value.has(key))event.put(key,value.get(key));
            timeline.addLast(event);while(timeline.size()>32)timeline.removeFirst();
        } catch(Exception ignored) { }
    }
    void beginRun(long id) { runId=id; }
    synchronized JSONArray timeline() { return new JSONArray(timeline); }
    JSONObject latest() { return latest; }
}
