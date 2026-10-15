package com.bensanzone.fuelmap;

import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.Locale;

/** Streaming, resumable, checksum-verified download. No model bytes enter the Java heap as a whole. */
final class ModelDownload {
    interface Control { boolean cancelled(); void progress(long bytes, boolean verifying); }
    static void fetch(URL url, File partial, File destination, long expected, String sha, Control control) throws Exception {
        if (control.cancelled()) throw new InterruptedIOException("Model download paused.");
        if (destination.exists()) throw new IOException("Remove the existing model before replacing it.");
        long start = partial.exists() ? partial.length() : 0;
        if (start > expected) { if (!partial.delete()) throw new IOException("Cannot reset partial model."); start = 0; }
        if (start < expected) {
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(15000); connection.setReadTimeout(15000);
            connection.setRequestProperty("Accept-Encoding", "identity");
            if (start > 0) connection.setRequestProperty("Range", "bytes=" + start + "-");
            try {
                int code = connection.getResponseCode();
                if (code == 200) start = 0; // Range ignored: overwrite rather than append duplicate bytes.
                else if (code != 206) throw new IOException("Model download failed (HTTP " + code + "). Resume from Settings.");
                if (code == 206 && !("bytes " + start + "-" + (expected - 1) + "/" + expected).equals(connection.getHeaderField("Content-Range")))
                    throw new IOException("Model server returned an unexpected byte range.");
                long length = connection.getContentLengthLong();
                if (length >= 0 && length != expected - start) throw new IOException("Model download length changed.");
                if (partial.getParentFile().getUsableSpace() < expected - start + 256L * 1024 * 1024)
                    throw new IOException("Not enough free storage for the model and working space.");
                try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(partial, start > 0)) {
                    byte[] buffer = new byte[256 * 1024]; long count = start; int read;
                    while ((read = in.read(buffer)) != -1) {
                        if (control.cancelled()) throw new InterruptedIOException("Model download paused.");
                        if (count + read > expected) throw new IOException("Model is larger than the pinned download.");
                        out.write(buffer, 0, read); count += read; control.progress(count, false);
                    }
                    out.getFD().sync();
                }
            } finally { connection.disconnect(); }
        }
        if (control.cancelled()) throw new InterruptedIOException("Model download paused.");
        if (partial.length() != expected) throw new IOException("Model download was interrupted. Resume from Settings.");
        control.progress(expected, true);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(partial)) {
            byte[] buffer = new byte[256 * 1024]; int read;
            while ((read = in.read(buffer)) != -1) {
                if (control.cancelled()) throw new InterruptedIOException("Model verification paused.");
                digest.update(buffer, 0, read);
            }
        }
        StringBuilder actual = new StringBuilder();
        for (byte b : digest.digest()) actual.append(String.format(Locale.US, "%02x", b & 255));
        if (!actual.toString().equals(sha)) {
            if (!partial.delete()) throw new IOException("Model checksum failed; remove the partial download in Settings.");
            throw new IOException("Model checksum failed. Download it again from Settings.");
        }
        if (control.cancelled()) throw new InterruptedIOException("Model download paused.");
        if (!partial.renameTo(destination)) throw new IOException("Cannot save the verified model.");
    }
}
