package com.bensanzone.fuelmap;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

/**
 * Full backups are gzip-compressed JSON (.json.gz): saved trips, price history and pictures are JSON held as escaped
 * strings, which compress several times over (a phone's plain backup passed 30 MB). Restore reads either kind, so
 * plain .json backups (older Gasket, Fuel+ 0.0.47) still restore.
 */
final class BackupIO {
    private BackupIO() { }

    static OutputStream compress(OutputStream os) throws IOException { return new GZIPOutputStream(os, 65536); }

    /** The backup's JSON, unzipped when the file starts with gzip's magic bytes (1f 8b). */
    static InputStream open(InputStream in) throws IOException {
        BufferedInputStream b = new BufferedInputStream(in, 65536);
        b.mark(2);
        int a = b.read(), c = b.read();
        b.reset();
        return a == 0x1f && c == 0x8b ? new GZIPInputStream(b, 65536) : b;
    }
}
