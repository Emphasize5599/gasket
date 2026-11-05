package com.bensanzone.fuelmap;

import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/** Independent providers overlap; each provider and credential changes remain serialized. */
final class GuestSourceGate {
    private final ReentrantReadWriteLock lifecycle = new ReentrantReadWriteLock(true);
    private final ConcurrentHashMap<String, Object> sources = new ConcurrentHashMap<>();
    <T> T read(String source, Callable<T> work) throws Exception {
        lifecycle.readLock().lock();
        try { synchronized(sources.computeIfAbsent(source, k -> new Object())) { return work.call(); } }
        finally { lifecycle.readLock().unlock(); }
    }
    <T> T change(Callable<T> work) throws Exception {
        lifecycle.writeLock().lock();
        try { return work.call(); } finally { lifecycle.writeLock().unlock(); }
    }
}
