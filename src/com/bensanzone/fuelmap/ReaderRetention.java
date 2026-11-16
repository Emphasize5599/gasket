package com.bensanzone.fuelmap;

/** Never reclaim a reader that owns a request, visible check or queued command. */
final class ReaderRetention {
    static boolean canRelease(int readRequest, int visibleRequest, boolean verifying, int queuedCommands) {
        return readRequest < 0 && visibleRequest < 0 && !verifying && queuedCommands == 0;
    }
}
