package com.bensanzone.fuelmap;

/** Called only by the serial model worker, never during UI/status rendering. */
final class GemmaGpuSupport {
    private static Integer checkedVersion;
    private static native int nativePatchVersion();
    static synchronized int version() {
        if (checkedVersion == null) {
            try {
                System.loadLibrary("litertlm_jni");
                checkedVersion = nativePatchVersion();
            } catch (LinkageError | SecurityException unavailable) { checkedVersion = 0; }
        }
        return checkedVersion;
    }
}
