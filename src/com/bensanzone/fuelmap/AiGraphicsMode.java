package com.bensanzone.fuelmap;

/** Main-thread-only, app-local texture-layer experiment. NOT a hardware-composer override. */
final class AiGraphicsMode {
    interface Target {
        int layerType(); void layerType(int value);
        boolean accelerated(); int width(); int height();
    }
    // Android View constants; this controller is also exercised without an Android runtime.
    private static final int SOFTWARE = 1, HARDWARE = 2;
    private final Target target;
    private boolean owned;
    private int previous;
    private String error = "", skipped = "";
    AiGraphicsMode(Target target) { this.target = target; }
    static boolean gpuJob(boolean enabled, boolean cpuOnly, boolean recoveryRequired, String backend, String task, String phase, boolean resident) {
        return enabled && !cpuOnly && !recoveryRequired && !"CPU".equals(backend)
            && (("advice".equals(task) && ("load".equals(phase) || "generate".equals(phase) || "cancelling".equals(phase)))
                || (resident && "idle".equals(phase)));
    }
    void update(boolean enabled, boolean job, boolean foreground) {
        if (!enabled || !job || !foreground) {
            restore();
            if (!enabled && !owned) error = ""; // explicit off/on permits another experiment
            skipped = "";
            return;
        }
        if (owned || !error.isEmpty()) return;
        try {
            int width = target.width(), height = target.height();
            long pixels = (long) width * height;
            if (!target.accelerated()) { skipped = "window_not_accelerated"; return; }
            if (width <= 0 || height <= 0 || width > 8192 || height > 8192 || pixels > 8_000_000L) { skipped = "texture_size_budget"; return; }
            if (target.layerType() == SOFTWARE) { skipped = "existing_software_layer"; return; }
            previous = target.layerType(); owned = true; skipped = "";
            if (previous != HARDWARE) target.layerType(HARDWARE);
        } catch (RuntimeException | LinkageError failure) {
            error = failure.getClass().getSimpleName(); restore();
        }
    }
    private void restore() {
        if (!owned) return;
        try {
            // Do not overwrite a later layer choice made by another owner.
            if (target.layerType() == HARDWARE && previous != HARDWARE) target.layerType(previous);
            owned = false;
        } catch (RuntimeException | LinkageError failure) { error = "restore_" + failure.getClass().getSimpleName(); }
    }
    boolean active() { return owned; }
    String error() { return error; }
    String skipped() { return skipped; }
}
