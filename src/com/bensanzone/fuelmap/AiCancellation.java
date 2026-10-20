package com.bensanzone.fuelmap;

import java.util.concurrent.*;

/** Never wait for JNI/its monitor on a lifecycle or JavaScript bridge caller. */
final class AiCancellation {
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<Runnable>(1), runnable -> {
            Thread thread = new Thread(runnable, "gasket-ai-cancel"); thread.setDaemon(true); return thread;
        }, new ThreadPoolExecutor.DiscardOldestPolicy());
    void request(Runnable operation) { worker.execute(operation); }
    void close() { worker.shutdown(); }
}
