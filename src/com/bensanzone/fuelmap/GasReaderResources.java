package com.bensanzone.fuelmap;

/** Narrow denylist for invisible station readers, not the map UI or visible checks.
 * Unknown resources, page scripts/styles, station searches and security endpoints stay enabled.
 * Kept Android-independent so the exact policy can be executed in CI. */
final class GasReaderResources {
    static final int ALLOW = 0, VISUAL = 1, GRAPHICS = 2, TELEMETRY = 3;

    static int omission(String host, String path, String method, boolean mainFrame, boolean visible, boolean lean) {
        if (mainFrame || visible || host == null || path == null) return ALLOW;
        boolean get = "GET".equals(method);
        if (get && (host.equals("fonts.gstatic.com") || host.equals("fonts.googleapis.com")
                || path.endsWith(".woff") || path.endsWith(".woff2") || path.endsWith(".ttf") || path.endsWith(".otf")
                || path.endsWith(".mp4") || path.endsWith(".webm") || path.endsWith(".mp3") || path.endsWith(".ogg") || path.endsWith(".wav"))) return VISUAL;
        if (!lean) return ALLOW;
        // The map's graphics engine and its JS-renderer fallback are both unnecessary for the result feed.
        if (get && (host.equals("www.google.com") && (path.startsWith("/maps/_/wa/") && path.contains(".mapcore.") && path.endsWith(".wasm")
                || path.startsWith("/maps/vt/"))
                || host.equals("www.gstatic.com") && path.startsWith("/maps/res/compactlegend-"))) return GRAPHICS;
        // Only this measured logging endpoint, never arbitrary RPCs, consent or bot-check code.
        if ((get || "POST".equals(method)) && host.equals("www.google.com") && path.equals("/maps/preview/log204")) return TELEMETRY;
        return ALLOW;
    }

    static boolean retryFull(boolean lean, boolean blocked, boolean cancelled, String code, int stores) {
        return lean && !blocked && !cancelled && (stores == 0 && "unreadable".equals(code) || "incomplete_feed".equals(code));
    }
}
