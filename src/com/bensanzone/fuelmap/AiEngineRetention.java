package com.bensanzone.fuelmap;

/** Bounded warm-engine policy, not a GPU utilization throttle. Conversations never survive a request. */
final class AiEngineRetention {
    static boolean allow(boolean lowMemory, long availableBytes, long pssKb, long baselinePssKb, int runs) {
        return !lowMemory && availableBytes >= 2L * 1024 * 1024 * 1024
            && baselinePssKb > 0 && pssKb > 0 && pssKb - baselinePssKb <= 512L * 1024
            && runs > 0 && runs < 8;
    }
}
