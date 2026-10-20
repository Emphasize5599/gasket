package com.bensanzone.fuelmap;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONObject;
import java.io.File;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/** Opt-in local generation; one worker, no UI-thread model I/O and no autonomous network fallback. */
final class GemmaService {
    static final long BYTES = 3659530240L;
    static final String REV = "2eee7ac325f20eb8c9ac1d0e972f7c84663062da";
    static final String SHA = "0b2a8980ce155fd97673d8e820b4d29d9c7d99b8fa6806f425d969b145bd52e0";
    static final String URL_MODEL = "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/" + REV + "/gemma-4-E4B-it.litertlm";
    interface Listener { void status(JSONObject value); void result(int id, JSONObject value); }
    private final Listener listener;
    private final SharedPreferences prefs;
    private final AiDiagnostics diagnostics;
    private final AiCancellation cancellation = new AiCancellation();
    private static final Semaphore MODEL_SLOT = new Semaphore(1);
    private final android.app.ActivityManager memoryManager;
    // Worker-owned lease stays held while the ONE engine is warm, even between requests.
    private volatile boolean slotHeld, releaseFailed;
    private int warmRuns;
    private long baselinePssKb;
    private volatile boolean recoveryRequired;
    /** The last GPU start failure while the CPU stood in (scrubbed), cleared by the next GPU start; shown and logged. */
    private volatile String gpuFallback = "";
    private final File directory, model, partial, cache;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    // Never put diagnostic disk/PSS work on the UI, GPU callback or cancellation timer.
    private final ExecutorService telemetry = new ThreadPoolExecutor(1,1,0L,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<Runnable>(1),new ThreadPoolExecutor.DiscardPolicy());
    private final AtomicBoolean busy = new AtomicBoolean();
    private final AtomicLong epoch = new AtomicLong();
    private volatile GemmaRuntime runtime;
    private volatile boolean closed;
    private volatile String phase = "idle", error = "", task = "";
    private volatile long downloaded, lastNotify;
    private volatile String reason = "";
    private volatile int attempt = 1;
    private volatile boolean ready;
    private volatile long activeTicket, firstOutputAt;
    private volatile int diagnosticInputBytes;
    private volatile boolean diagnosticLogging=true;
    void setDiagnosticLogging(boolean enabled){diagnosticLogging=enabled;}

    GemmaService(Context context, Listener listener) {
        this.listener = listener;
        memoryManager = (android.app.ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        prefs = context.getSharedPreferences("gasket_ai", Context.MODE_PRIVATE);
        diagnostics = new AiDiagnostics(context, prefs);
        recoveryRequired = diagnostics.interrupted || prefs.getBoolean("recoveryRequired", false);
        // 0.0.218: the GPU is the default again; a CPU-only choice made while testing 0.0.215–0.0.217's flicker is reset once
        if (!prefs.getBoolean("gpuDefault218", false)) prefs.edit().putBoolean("cpuOnly", false).putBoolean("gpuDefault218", true).apply();
        if (recoveryRequired) prefs.edit().putBoolean("recoveryRequired", true).apply();
        directory = new File(context.getNoBackupFilesDir(), "gemma-4-e4b"); directory.mkdirs();
        model = new File(directory, "model.litertlm"); partial = new File(directory, "model.part");
        cache = new File(context.getCacheDir(), "gemma-stock-cpu-217"); cache.mkdirs();
        downloaded = partial.length();
        ready = model.isFile() && model.length() == BYTES && SHA.equals(prefs.getString("verifiedSha", ""))
            && model.lastModified() == prefs.getLong("verifiedMtime", -1);
    }
    private boolean supported() { return Arrays.asList(Build.SUPPORTED_ABIS).contains("arm64-v8a") || Arrays.asList(Build.SUPPORTED_ABIS).contains("x86_64"); }
    private boolean enabled() { return prefs.getBoolean("enabled", true); }
    /** The CPU deadline (600 s) applies when CPU only was chosen or the GPU failed to start (emergency fallback). */
    private boolean onCpu(boolean chosen) { GemmaRuntime active = runtime; return chosen || active != null && "CPU".equals(active.backend); }
    private boolean cpuOnly() { return prefs.getBoolean("cpuOnly", false); }
    JSONObject status() {
        JSONObject value = new JSONObject();
        try {
            value.put("enabled", enabled()); value.put("ready", ready); value.put("supported", supported());
            value.put("phase", phase); value.put("error", error); value.put("bytes", downloaded); value.put("total", BYTES);
            value.put("task", task);
            value.put("cpuOnly", cpuOnly());
            value.put("recoveryRequired", recoveryRequired); value.put("gpuFallback", gpuFallback);
            value.put("startupDiagnostics", diagnostics.startup); value.put("nativeDiagnostics", diagnostics.latest());
            value.put("nativeTimeline", diagnostics.timeline()); value.put("generationId", activeTicket);
            value.put("firstOutputAt", firstOutputAt);
            value.put("reason", reason); value.put("attempt", attempt);
            value.put("revision", REV); value.put("busy", busy.get());
            GemmaRuntime active = runtime;
            if (active != null) {
                value.put("backend", active.backend);
                value.put("gpuLowPriorityRequested", active.gpuLowPriorityRequested);
                value.put("gpuPatchVersion", active.gpuPatchVersion);
            }
        } catch (Exception ignored) { }
        return value;
    }
    private void notifyStatus() { if (!closed) listener.status(status()); }
    /** The app's own page dying mid-generation pauses AI until a retry; a hidden website reader dying only stops this explanation. */
    synchronized void rendererLost(boolean appPage) {
        if (!closed && !busy.get()) worker.execute(() -> releaseRuntime("renderer_lost"));
        if (!closed && busy.get() && "advice".equals(task)) {
            if (appPage) { recoveryRequired = true; prefs.edit().putBoolean("recoveryRequired", true).apply(); }
            epoch.incrementAndGet();
            error = appPage ? "Local AI paused after the app's page stopped. Use Recheck current car to retry."
                : "Local AI stopped this explanation while the phone was short on memory.";
            phase = "cancelling"; GemmaRuntime active = runtime;
            if (active != null) cancellation.request(active.cancellation()); notifyStatus();
        }
    }
    private void result(int id, String text, String failure) {
        JSONObject value = new JSONObject();
        try { if (failure != null) { value.put("error", failure); value.put("recoveryRequired", recoveryRequired); } else value.put("text", text); } catch (Exception ignored) { }
        if (!closed) listener.result(id, value);
    }
    synchronized void command(int id, String command) {
        if (closed) return;
        if ("acknowledgeRecovery".equals(command)) {
            recoveryRequired = false; prefs.edit().putBoolean("recoveryRequired", false).apply(); error = "";
            listener.result(id, status()); notifyStatus(); return;
        }
        if ("processorCpu".equals(command) || "processorAuto".equals(command)) {
            if (busy.get()) { result(id, null, "Turn AI off or wait for the current task before changing its processor."); return; }
            prefs.edit().putBoolean("cpuOnly", "processorCpu".equals(command)).apply();
            worker.execute(() -> releaseRuntime("processor_changed"));
            listener.result(id, status()); notifyStatus(); return;
        }
        if ("releaseIdle".equals(command)) {
            // Never interrupt generation/download, change the enabled preference, or delete files.
            final long idleEpoch = epoch.get();
            if (!busy.get()) worker.execute(() -> {
                if (!busy.get() && idleEpoch == epoch.get()) releaseRuntime("queue_drained");
                notifyStatus();
            });
            listener.result(id, status()); return;
        }
        if("cancelAdvice".equals(command)&&!"advice".equals(task)){
            if (!busy.get()) worker.execute(() -> { if (!busy.get()) releaseRuntime("cancelled_idle"); });
            listener.result(id,status());return;
        }
        if ("cancel".equals(command) || "cancelAdvice".equals(command) || "disable".equals(command)) {
            reason="disable".equals(command)?"Larger AI disabled by user":"cancelAdvice".equals(command)?"Advice cancelled after setup change or timeout":"Task paused by user";
            if ("disable".equals(command)) prefs.edit().putBoolean("enabled", false).apply();
            epoch.incrementAndGet();
            GemmaRuntime active = runtime; if (active != null) cancellation.request(active.cancellation());
            if (busy.get()) phase = "cancelling";
            worker.execute(() -> { releaseRuntime("cancelled"); notifyStatus(); });
        } else if ("enable".equals(command)) {
            if (!supported()) { result(id, null, "This phone's CPU is not supported by the larger model runtime."); return; }
            prefs.edit().putBoolean("enabled", true).apply(); error = "";
        } else if ("remove".equals(command)) {
            if (busy.get()) { result(id, null, "Cancel the current model task before removing it."); return; }
            if (!busy.compareAndSet(false, true)) { result(id, null, "Model is busy."); return; }
            epoch.incrementAndGet(); prefs.edit().putBoolean("enabled", false).apply();
            worker.execute(() -> {
                try {
                    if (!releaseRuntime("removed")) return;
                    boolean removed = !model.exists() || model.delete();
                    removed &= !partial.exists() || partial.delete();
                    ready = false; downloaded = partial.length();
                    prefs.edit().remove("verifiedSha").remove("verifiedMtime").apply();
                    error = removed ? "" : "Could not remove all model files.";
                } finally { busy.set(false); phase = "idle"; notifyStatus(); }
            });
        } else if ("download".equals(command)) {
            if (!enabled() || !supported()) { result(id, null, "Enable the larger model first."); return; }
            if (ready || !busy.compareAndSet(false, true)) { listener.result(id, status()); return; }
            long ticket = epoch.incrementAndGet(); error = ""; reason="";attempt=1;task = "download"; phase = "download"; notifyStatus();
            worker.execute(() -> {
                try {
                    // An unverified leftover is never loaded. Re-download rather than blessing it by size.
                    if (model.exists() && !model.delete()) throw new Exception("Remove the unverified model before downloading again.");
                    ModelDownload.fetch(new URL(URL_MODEL), partial, model, BYTES, SHA, new ModelDownload.Control() {
                        public boolean cancelled() { return closed || ticket != epoch.get() || !enabled(); }
                        public void retry(int next, String why) { attempt=next;reason=why;phase="retry";notifyStatus(); }
                        public void progress(long count, boolean verifying) {
                            downloaded = count; phase = verifying ? "verify" : "download";
                            long now = System.currentTimeMillis(); if (verifying || now - lastNotify > 500) { lastNotify = now; notifyStatus(); }
                        }
                    });
                    prefs.edit().putString("verifiedSha", SHA).putLong("verifiedMtime", model.lastModified()).commit();
                    ready = SHA.equals(prefs.getString("verifiedSha", "")) && model.lastModified() == prefs.getLong("verifiedMtime", -1);
                    if (!ready) throw new Exception("Could not record model verification.");
                    reason="";
                } catch (Exception failure) {
                    if (ticket == epoch.get()) {error = failure.getMessage() == null ? "Model download failed." : failure.getMessage();reason=failure.getClass().getSimpleName();}
                } finally { downloaded=ready?BYTES:partial.length();busy.set(false); phase = "idle"; task = ""; notifyStatus(); }
            });
        } else { result(id, null, "Unknown model command."); return; }
        listener.result(id, status()); notifyStatus();
    }
    synchronized void generate(int id, String prompt) {
        if (closed || !enabled() || !ready || !supported()) { result(id, null, "Larger model is not enabled and ready."); return; }
        if (recoveryRequired) { result(id, null, "Local AI paused after an unexpected exit. Use Recheck current car to retry."); return; }
        // Conservative UTF-8 bound: leave room for instructions/output in the 32k token context. Never truncate rules.
        if (prompt == null || prompt.getBytes(StandardCharsets.UTF_8).length > 27000) { result(id, null, "Complete tire setup exceeds the model context budget."); return; }
        if (!busy.compareAndSet(false, true)) { result(id, null, "Larger model is already working."); return; }
        final long ticket = epoch.incrementAndGet(); error = ""; reason="";task = "advice"; phase = "load";
        activeTicket = ticket;
        diagnostics.beginRun(ticket);
        firstOutputAt=0;diagnosticInputBytes=prompt.getBytes(StandardCharsets.UTF_8).length;
        notifyStatus();
        final long started = System.nanoTime();
        final boolean useCpu = cpuOnly();
        ScheduledFuture<?> deadline = timer.scheduleAtFixedRate(() -> {
            synchronized (GemmaService.this) {
                if (activeTicket != ticket || !busy.get()) return;
                if (ticket != epoch.get() || closed || !enabled() || System.nanoTime() - started > TimeUnit.SECONDS.toNanos(onCpu(useCpu) ? 600 : 120)) {
                    if (ticket == epoch.get()) epoch.incrementAndGet();
                    if (!"cancelling".equals(phase)) { phase = "cancelling"; notifyStatus(); }
                    GemmaRuntime active = runtime; if (active != null) cancellation.request(active.cancellation());
                }
            }
        }, 250, 250, TimeUnit.MILLISECONDS);
        ScheduledFuture<?> samples = timer.scheduleAtFixedRate(() -> sample(ticket,"generating_sample"),5,5,TimeUnit.SECONDS);
        worker.execute(() -> {
            boolean ownsSlot = false;
            boolean completed = false;
            int inputBytes = prompt.getBytes(StandardCharsets.UTF_8).length;
            int plannedTokens = GemmaRuntime.contextFor(inputBytes);
            try {
                android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND);
                if (ticket != epoch.get() || !enabled()) throw new CancellationException();
                if (releaseFailed || (!slotHeld && !MODEL_SLOT.tryAcquire())) throw new IllegalStateException("Previous local model is still stopping.");
                slotHeld = true;
                ownsSlot = true;
                diagnostics.record("load", true, useCpu ? "CPU" : "GPU", plannedTokens, inputBytes, null); notifyStatus();
                boolean reused = runtime != null && runtime.contextTokens >= plannedTokens
                    && ("CPU".equals(runtime.backend) == useCpu) && runtime.gpuFailure == null;
                if (runtime == null) runtime = new GemmaRuntime();
                // Named sections in Android system traces (System Tracing / Perfetto), so a flicker can be lined up with the AI stage
                android.os.Trace.beginSection("Gasket AI load");
                try { runtime.load(model.getAbsolutePath(), cache.getAbsolutePath(), prompt.getBytes(StandardCharsets.UTF_8).length, useCpu); }
                finally { android.os.Trace.endSection(); }
                if (!reused) { warmRuns = 0; baselinePssKb = 0; }
                diagnostics.record(reused ? "engine_reused" : "engine_initialized", true, runtime.backend, runtime.contextTokens, inputBytes, null);
                if (runtime.gpuFailure != null) { gpuFallback = AiDiagnostics.failure(runtime.gpuFailure); diagnostics.record("gpu_failed_cpu_fallback", true, "CPU", runtime.contextTokens, inputBytes, runtime.gpuFailure); }
                else if ("GPU".equals(runtime.backend)) gpuFallback = "";
                if (ticket != epoch.get() || !enabled()) throw new CancellationException();
                phase = "generate"; diagnostics.record("generate", true, runtime.backend, runtime.contextTokens, inputBytes, null); notifyStatus();
                String response;
                android.os.Trace.beginSection("Gasket AI generate " + runtime.backend);
                try { response = runtime.generate(prompt, () -> ticket != epoch.get() || !enabled() || closed, () -> { firstOutputAt=System.currentTimeMillis();sample(ticket,"first_output"); }); }
                finally { android.os.Trace.endSection(); }
                if (ticket != epoch.get() || !enabled()) throw new CancellationException();
                diagnostics.record("completed", true, runtime.backend, runtime.contextTokens, inputBytes, null);
                completed = true;
                result(id, response, null);
            } catch (Exception | LinkageError failure) {
                if (ownsSlot) diagnostics.record(ticket == epoch.get() ? "failed" : "cancelled", true, runtime == null ? "unknown" : runtime.backend, plannedTokens, inputBytes, failure);
                if (ownsSlot && ticket == epoch.get() && !(failure instanceof CancellationException)) { recoveryRequired = true; prefs.edit().putBoolean("recoveryRequired", true).apply(); }
                error = ticket == epoch.get() ? "Local AI could not finish. Checked tire notices are still available." : "Local AI cancelled or timed out.";
                result(id, null, error);
            } finally {
                // Each conversation is already closed by generate(). Keep only the engine/lease,
                // briefly, so the next queued car does not reload several GB of model weights.
                boolean retain = ownsSlot && completed && ticket == epoch.get() && !closed && enabled()
                    && !recoveryRequired && runtime != null && runtime.gpuFailure == null && retainWithinBudget();
                if (ownsSlot) {
                    if (retain) diagnostics.record("retained_idle", false, runtime.backend, runtime.contextTokens, inputBytes, null);
                    else releaseRuntime(completed ? "reuse_budget_or_cancel" : "generation_failed");
                }
                synchronized (GemmaService.this) {
                    deadline.cancel(false); samples.cancel(false); activeTicket = 0; busy.set(false); phase = "idle"; task = ""; notifyStatus();
                }
                long idleTicket = epoch.get();
                try {
                    if (!closed) timer.schedule(() -> {
                        synchronized (GemmaService.this) { if (!closed) worker.execute(() -> { if (!busy.get() && idleTicket == epoch.get()) { releaseRuntime("idle_timeout"); notifyStatus(); } }); }
                    }, 3, TimeUnit.SECONDS);
                } catch (RejectedExecutionException shuttingDown) { }
            }
        });
    }
    synchronized void close() {
        if (closed) return;
        closed = true; epoch.incrementAndGet();
        GemmaRuntime active = runtime; if (active != null) cancellation.request(active.cancellation());
        worker.execute(() -> releaseRuntime("service_closed"));
        worker.shutdown(); timer.shutdownNow(); telemetry.shutdownNow(); cancellation.close();
    }
    /** Worker only. A failed close deliberately poisons the lease until process restart. */
    private boolean releaseRuntime(String why) {
        if (!slotHeld || releaseFailed) return !releaseFailed;
        String used = runtime == null ? "unknown" : runtime.backend;
        int tokens = runtime == null ? 0 : runtime.contextTokens;
        diagnostics.record("releasing_" + why, true, used, tokens, diagnosticInputBytes, null);
        try {
            // Release native memory before another service/activity can acquire the model slot.
            if (runtime != null) runtime.close();
            runtime = null; warmRuns = 0; baselinePssKb = 0;
            diagnostics.record("released", false, used, tokens, diagnosticInputBytes, null);
            slotHeld = false; MODEL_SLOT.release();
            return true;
        } catch (Exception | LinkageError failure) {
            releaseFailed = true; recoveryRequired = true;
            prefs.edit().putBoolean("recoveryRequired", true).apply();
            error = "Local AI could not release its resources. Restart the app before retrying.";
            diagnostics.record("release_failed", true, used, tokens, diagnosticInputBytes, failure);
            return false;
        }
    }
    private boolean retainWithinBudget() {
        try {
            if (memoryManager == null) return false;
            android.app.ActivityManager.MemoryInfo memory = new android.app.ActivityManager.MemoryInfo();
            memoryManager.getMemoryInfo(memory);
            long pssKb = android.os.Debug.getPss();
            if (baselinePssKb == 0) baselinePssKb = pssKb;
            return AiEngineRetention.allow(memory.lowMemory, memory.availMem, pssKb, baselinePssKb, ++warmRuns);
        } catch (Exception unavailable) { return false; }
    }
    private void sample(long ticket,String stage) {
        if(closed||!diagnosticLogging)return;
        try { telemetry.execute(() -> { GemmaRuntime active=runtime;
            if(closed||!diagnosticLogging||activeTicket!=ticket||ticket!=epoch.get()||!busy.get()||active==null||!"generate".equals(phase))return;
            diagnostics.record(stage,true,active.backend,active.contextTokens,diagnosticInputBytes,null);
            JSONObject value=status();try{value.put("diagnosticOnly",true);}catch(Exception ignored){}if(!closed)listener.status(value);
        }); } catch(RejectedExecutionException ignored) { }
    }
}
