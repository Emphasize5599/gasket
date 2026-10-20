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
    private final File directory, model, partial, cache;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private final AtomicBoolean busy = new AtomicBoolean();
    private final AtomicLong epoch = new AtomicLong();
    private volatile GemmaRuntime runtime;
    private volatile boolean closed;
    private volatile String phase = "idle", error = "", task = "";
    private volatile long downloaded, lastNotify;
    private volatile String reason = "";
    private volatile int attempt = 1;
    private volatile boolean ready;
    private long activeTicket;

    GemmaService(Context context, Listener listener) {
        this.listener = listener;
        prefs = context.getSharedPreferences("gasket_ai", Context.MODE_PRIVATE);
        directory = new File(context.getNoBackupFilesDir(), "gemma-4-e4b"); directory.mkdirs();
        model = new File(directory, "model.litertlm"); partial = new File(directory, "model.part");
        cache = new File(context.getCacheDir(), "gemma"); cache.mkdirs();
        downloaded = partial.length();
        ready = model.isFile() && model.length() == BYTES && SHA.equals(prefs.getString("verifiedSha", ""))
            && model.lastModified() == prefs.getLong("verifiedMtime", -1);
    }
    private boolean supported() { return Arrays.asList(Build.SUPPORTED_ABIS).contains("arm64-v8a") || Arrays.asList(Build.SUPPORTED_ABIS).contains("x86_64"); }
    private boolean enabled() { return prefs.getBoolean("enabled", true); }
    private boolean cpuOnly() { return prefs.getBoolean("cpuOnly", false); }
    JSONObject status() {
        JSONObject value = new JSONObject();
        try {
            value.put("enabled", enabled()); value.put("ready", ready); value.put("supported", supported());
            value.put("phase", phase); value.put("error", error); value.put("bytes", downloaded); value.put("total", BYTES);
            value.put("task", task);
            value.put("cpuOnly", cpuOnly());
            value.put("reason", reason); value.put("attempt", attempt);
            value.put("revision", REV); value.put("busy", busy.get());
            if (runtime != null) value.put("backend", runtime.backend);
        } catch (Exception ignored) { }
        return value;
    }
    private void notifyStatus() { if (!closed) listener.status(status()); }
    private void result(int id, String text, String failure) {
        JSONObject value = new JSONObject();
        try { if (failure != null) value.put("error", failure); else value.put("text", text); } catch (Exception ignored) { }
        if (!closed) listener.result(id, value);
    }
    synchronized void command(int id, String command) {
        if (closed) return;
        if ("processorCpu".equals(command) || "processorAuto".equals(command)) {
            if (busy.get()) { result(id, null, "Turn AI off or wait for the current task before changing its processor."); return; }
            prefs.edit().putBoolean("cpuOnly", "processorCpu".equals(command)).apply();
            // load() recreates the engine on the serial worker when the preference changes.
            listener.result(id, status()); notifyStatus(); return;
        }
        if ("releaseIdle".equals(command)) {
            // Never interrupt generation/download, change the enabled preference, or delete files.
            if (!busy.get()) worker.execute(() -> {
                if (!busy.get() && runtime != null) { runtime.close(); runtime = null; }
                notifyStatus();
            });
            listener.result(id, status()); return;
        }
        if("cancelAdvice".equals(command)&&!"advice".equals(task)){listener.result(id,status());return;}
        if ("cancel".equals(command) || "cancelAdvice".equals(command) || "disable".equals(command)) {
            reason="disable".equals(command)?"Larger AI disabled by user":"cancelAdvice".equals(command)?"Advice cancelled after setup change or timeout":"Task paused by user";
            if ("disable".equals(command)) prefs.edit().putBoolean("enabled", false).apply();
            epoch.incrementAndGet();
            GemmaRuntime active = runtime; if (active != null) active.cancel();
            if (busy.get()) phase = "cancelling";
            worker.execute(() -> { if (runtime != null) { runtime.close(); runtime = null; } notifyStatus(); });
        } else if ("enable".equals(command)) {
            if (!supported()) { result(id, null, "This phone's CPU is not supported by the larger model runtime."); return; }
            prefs.edit().putBoolean("enabled", true).apply(); error = "";
        } else if ("remove".equals(command)) {
            if (busy.get()) { result(id, null, "Cancel the current model task before removing it."); return; }
            if (!busy.compareAndSet(false, true)) { result(id, null, "Model is busy."); return; }
            epoch.incrementAndGet(); prefs.edit().putBoolean("enabled", false).apply();
            worker.execute(() -> {
                try {
                    if (runtime != null) { runtime.close(); runtime = null; }
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
        // Conservative UTF-8 bound: leave room for instructions/output in the 32k token context. Never truncate rules.
        if (prompt == null || prompt.getBytes(StandardCharsets.UTF_8).length > 27000) { result(id, null, "Complete tire setup exceeds the model context budget."); return; }
        if (!busy.compareAndSet(false, true)) { result(id, null, "Larger model is already working."); return; }
        final long ticket = epoch.incrementAndGet(); error = ""; reason="";task = "advice"; phase = "load"; notifyStatus();
        activeTicket = ticket;
        final long started = System.nanoTime();
        final boolean useCpu = cpuOnly();
        ScheduledFuture<?> deadline = timer.scheduleAtFixedRate(() -> {
            synchronized (GemmaService.this) {
                if (activeTicket != ticket || !busy.get()) return;
                if (ticket != epoch.get() || closed || !enabled() || System.nanoTime() - started > TimeUnit.SECONDS.toNanos(useCpu ? 600 : 120)) {
                    if (ticket == epoch.get()) epoch.incrementAndGet();
                    if (!"cancelling".equals(phase)) { phase = "cancelling"; notifyStatus(); }
                    GemmaRuntime active = runtime; if (active != null) active.cancel();
                }
            }
        }, 250, 250, TimeUnit.MILLISECONDS);
        worker.execute(() -> {
            try {
                if (ticket != epoch.get() || !enabled()) throw new CancellationException();
                if (runtime == null) runtime = new GemmaRuntime();
                runtime.load(model.getAbsolutePath(), cache.getAbsolutePath(), prompt.getBytes(StandardCharsets.UTF_8).length, useCpu);
                if (ticket != epoch.get() || !enabled()) throw new CancellationException();
                phase = "generate"; notifyStatus();
                String response = runtime.generate(prompt, () -> ticket != epoch.get() || !enabled() || closed);
                if (ticket != epoch.get() || !enabled()) throw new CancellationException();
                result(id, response, null);
            } catch (Exception | LinkageError failure) {
                if (runtime != null) { runtime.close(); runtime = null; }
                error = ticket == epoch.get() ? "Local AI could not finish. Checked tire notices are still available." : "Local AI cancelled or timed out.";
                result(id, null, error);
            } finally {
                synchronized (GemmaService.this) {
                    deadline.cancel(false); activeTicket = 0; busy.set(false); phase = "idle"; task = ""; notifyStatus();
                }
                long idleTicket = epoch.get();
                try {
                    if (!closed) timer.schedule(() -> {
                        synchronized (GemmaService.this) { if (!closed) worker.execute(() -> { if (!busy.get() && idleTicket == epoch.get() && runtime != null) { runtime.close(); runtime = null; } }); }
                    }, 60, TimeUnit.SECONDS);
                } catch (RejectedExecutionException shuttingDown) { }
            }
        });
    }
    synchronized void close() {
        if (closed) return;
        closed = true; epoch.incrementAndGet();
        GemmaRuntime active = runtime; if (active != null) active.cancel();
        worker.execute(() -> { if (runtime != null) { runtime.close(); runtime = null; } });
        worker.shutdown(); timer.shutdownNow();
    }
}
