package com.bensanzone.fuelmap;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.io.BufferedReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.CRC32;
import java.util.zip.CheckedInputStream;
import java.util.zip.Inflater;
import java.util.zip.InflaterInputStream;

/**
 * National campground inventory from Recreation.gov's RIDB full export (user-started download,
 * like the offline charger inventory). The export is a ~570 MB zip; only Facilities_API_v1.json
 * (~35 MB) is fetched, with HTTP byte ranges read from the zip's central directory, and
 * stream-parsed so the whole file is never held in memory. Every range carries If-Range with the
 * first answer's ETag (the CDN can serve two versions at once), and the entry's CRC-32 and size
 * are checked before anything is kept. Plain Java (no Android classes) so it runs in JVM tests.
 * Output: a JSON array of [id, name, lat, lng, reservable 0|1, stayLimit, fee] campgrounds.
 */
final class RidbCampgrounds {
    static final String URL_EXPORT = "https://ridb.recreation.gov/downloads/RIDBFullExport_V1_JSON.zip";
    static final String ENTRY = "Facilities_API_v1.json";
    static final long MAX_ENTRY = 128L << 20;

    interface Progress { void bytes(long done, long total); }
    interface Fetch { Answer get(String range, String ifRange) throws IOException; }
    static final class Answer {
        final int status; final String contentRange, etag; final InputStream body;
        Answer(int status, String contentRange, String etag, InputStream body) { this.status = status; this.contentRange = contentRange; this.etag = etag; this.body = body; }
    }
    static final class Result { String rows; int count; long bytes; }

    static Fetch http(final String userAgent) {
        return (range, ifRange) -> {
            HttpURLConnection c = (HttpURLConnection) new URL(URL_EXPORT).openConnection();
            c.setInstanceFollowRedirects(false); c.setConnectTimeout(30000); c.setReadTimeout(60000);
            c.setRequestProperty("Range", range); c.setRequestProperty("Accept-Encoding", "identity");
            if (userAgent != null) c.setRequestProperty("User-Agent", userAgent);
            if (ifRange != null) c.setRequestProperty("If-Range", ifRange);
            int s = c.getResponseCode();
            return new Answer(s, c.getHeaderField("Content-Range"), c.getHeaderField("ETag"), s >= 400 ? c.getErrorStream() : c.getInputStream());
        };
    }

    static Result download(Fetch f, Progress p, AtomicBoolean cancel) throws IOException {
        Answer tail = f.get("bytes=-65536", null);
        if (tail.status != 206 || tail.contentRange == null) throw new IOException("Recreation.gov export does not allow partial downloads (HTTP " + tail.status + ")");
        String etag = tail.etag;
        long total = Long.parseLong(tail.contentRange.substring(tail.contentRange.lastIndexOf('/') + 1).trim());
        byte[] end = readAll(tail.body, 1 << 20); long base = total - end.length;
        int e = -1; for (int i = end.length - 22; i >= 0; i--) if (u32(end, i) == 0x06054b50L) { e = i; break; }
        if (e < 0) throw new IOException("Recreation.gov export index not found");
        long cdSize = u32(end, e + 12), cdOff = u32(end, e + 16);
        if (cdSize == 0xFFFFFFFFL || cdOff == 0xFFFFFFFFL) throw new IOException("Recreation.gov export format not supported (ZIP64)");
        byte[] cd = cdOff >= base ? java.util.Arrays.copyOfRange(end, (int) (cdOff - base), (int) (cdOff - base + cdSize)) : readAll(range(f, cdOff, cdSize, etag), 4 << 20);
        long crc = -1, csize = 0, usize = 0, lho = 0; int method = -1;
        for (int q = 0; q + 46 <= cd.length && u32(cd, q) == 0x02014b50L; ) {
            int nl = u16(cd, q + 28), el = u16(cd, q + 30), cl = u16(cd, q + 32);
            String name = new String(cd, q + 46, nl, StandardCharsets.UTF_8);
            if (ENTRY.equals(name)) { method = u16(cd, q + 10); crc = u32(cd, q + 16); csize = u32(cd, q + 20); usize = u32(cd, q + 24); lho = u32(cd, q + 42); break; }
            q += 46 + nl + el + cl;
        }
        if (crc < 0) throw new IOException("Campground file missing from the Recreation.gov export");
        if (method != 0 && method != 8) throw new IOException("Recreation.gov export compression not supported");
        if (csize > MAX_ENTRY || usize > MAX_ENTRY) throw new IOException("Recreation.gov campground file is unexpectedly large");
        byte[] local = readAll(range(f, lho, 30, etag), 64);
        if (local.length < 30 || u32(local, 0) != 0x04034b50L) throw new IOException("Recreation.gov export entry is damaged");
        long start = lho + 30 + u16(local, 26) + u16(local, 28);
        final long size = csize; final InputStream raw = range(f, start, csize, etag);
        InputStream counted = new InputStream() {
            long done = 0, told = 0;
            @Override public int read() throws IOException { int b = raw.read(); if (b >= 0) tick(1); return b; }
            @Override public int read(byte[] b, int o, int n) throws IOException { if (cancel != null && cancel.get()) throw new IOException("Campground download cancelled"); int r = raw.read(b, o, n); if (r > 0) tick(r); return r; }
            void tick(long n) { done += n; if (done > size) throw new IllegalStateException("Recreation.gov sent more data than expected"); if (p != null && done - told >= (1 << 20)) { told = done; p.bytes(done, size); } }
            @Override public void close() throws IOException { raw.close(); }
        };
        CheckedInputStream checked = new CheckedInputStream(method == 8 ? new InflaterInputStream(counted, new Inflater(true)) : counted, new CRC32());
        Result out = new Result();
        try (Reader r = new BufferedReader(new InputStreamReader(checked, StandardCharsets.UTF_8), 1 << 16)) {
            StringBuilder rows = new StringBuilder("[");
            out.count = parse(r, rows);
            rows.append(']'); out.rows = rows.toString();
            byte[] skip = new byte[8192]; while (checked.read(skip) >= 0) { if (cancel != null && cancel.get()) throw new IOException("Campground download cancelled"); }
        }
        if (checked.getChecksum().getValue() != crc) throw new IOException("Campground file failed its integrity check; try again");
        out.bytes = size; if (p != null) p.bytes(size, size);
        return out;
    }

    static InputStream range(Fetch f, long from, long len, String etag) throws IOException {
        Answer a = f.get("bytes=" + from + "-" + (from + len - 1), etag);
        if (a.status == 200) throw new IOException("Recreation.gov updated its export during the download; try again");
        if (a.status != 206) throw new IOException("Recreation.gov download failed (HTTP " + a.status + ")");
        return a.body;
    }

    // ---- minimal streaming JSON: {"RECDATA":[{flat fields}...], ...}; nested values skipped ----
    static int parse(Reader r, StringBuilder rows) throws IOException {
        Lexer x = new Lexer(r); int n = 0;
        x.expect('{');
        while (true) {
            int c = x.next(); if (c == '}') break; if (c == ',') c = x.next();
            if (c != '"') throw new IOException("Unexpected campground data");
            String key = x.string(); x.expect(':');
            if (!"RECDATA".equals(key)) { x.skipValue(); continue; }
            x.expect('[');
            while (true) {
                int d = x.next(); if (d == ']') break; if (d == ',') d = x.next();
                if (d != '{') { x.skipValue(d); continue; }
                Map<String, String> f = x.flatObject();
                if (keep(f)) { if (n > 0) rows.append(','); row(rows, f); n++; }
            }
        }
        return n;
    }
    static boolean keep(Map<String, String> f) {
        if (!"Campground".equals(f.get("FacilityTypeDescription")) || "False".equalsIgnoreCase(f.get("Enabled"))) return false;
        try { double lat = Double.parseDouble(f.get("FacilityLatitude")), lng = Double.parseDouble(f.get("FacilityLongitude")); return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat == 0 && lng == 0); } catch (Exception e) { return false; }
    }
    static void row(StringBuilder b, Map<String, String> f) {
        b.append('['); str(b, f.get("FacilityID"), 64); b.append(','); str(b, f.get("FacilityName"), 120); b.append(',');
        b.append(Double.parseDouble(f.get("FacilityLatitude"))).append(',').append(Double.parseDouble(f.get("FacilityLongitude"))).append(',');
        b.append("True".equalsIgnoreCase(f.get("Reservable")) ? 1 : 0).append(','); str(b, f.get("StayLimit"), 160); b.append(','); str(b, f.get("FacilityUseFeeDescription"), 240); b.append(']');
    }
    static void str(StringBuilder b, String s, int max) {
        if (s == null) s = ""; s = s.replaceAll("<[^>]*>", " ").replaceAll("\\s+", " ").trim(); if (s.length() > max) s = s.substring(0, max);
        b.append('"'); for (int i = 0; i < s.length(); i++) { char c = s.charAt(i); if (c == '"' || c == '\\') b.append('\\').append(c); else if (c < 0x20) b.append(' '); else b.append(c); } b.append('"');
    }
    static final class Lexer {
        final Reader r; int peeked = -2;
        Lexer(Reader r) { this.r = r; }
        int raw() throws IOException { if (peeked != -2) { int p = peeked; peeked = -2; return p; } return r.read(); }
        int next() throws IOException { int c; do c = raw(); while (c == ' ' || c == '\n' || c == '\r' || c == '\t' || c == 0xFEFF); if (c < 0) throw new IOException("Campground data ended early"); return c; }
        void expect(char want) throws IOException { if (next() != want) throw new IOException("Unexpected campground data"); }
        String string() throws IOException {
            StringBuilder s = new StringBuilder();
            while (true) { int c = raw(); if (c < 0) throw new IOException("Campground data ended early"); if (c == '"') return s.toString();
                if (c == '\\') { int e = raw(); switch (e) { case 'n': s.append('\n'); break; case 't': s.append('\t'); break; case 'r': s.append('\r'); break; case 'b': case 'f': s.append(' '); break;
                    case 'u': { char[] h = new char[4]; for (int i = 0; i < 4; i++) h[i] = (char) raw(); s.append((char) Integer.parseInt(new String(h), 16)); break; } default: s.append((char) e); } }
                else s.append((char) c); }
        }
        String scalar(int first) throws IOException { StringBuilder s = new StringBuilder(); s.append((char) first); while (true) { int c = raw(); if (c < 0 || c == ',' || c == '}' || c == ']' || c == ' ' || c == '\n' || c == '\r' || c == '\t') { peeked = c; return s.toString(); } s.append((char) c); } }
        void skipValue() throws IOException { skipValue(next()); }
        void skipValue(int c) throws IOException {
            if (c == '"') { string(); return; }
            if (c == '{' || c == '[') { int depth = 1; while (depth > 0) { int d = raw(); if (d < 0) throw new IOException("Campground data ended early"); if (d == '"') string(); else if (d == '{' || d == '[') depth++; else if (d == '}' || d == ']') depth--; } return; }
            scalar(c);
        }
        Map<String, String> flatObject() throws IOException {
            Map<String, String> m = new HashMap<>();
            while (true) { int c = next(); if (c == '}') return m; if (c == ',') c = next(); if (c != '"') throw new IOException("Unexpected campground data");
                String k = string(); expect(':'); int v = next();
                if (v == '"') m.put(k, string()); else if (v == '{' || v == '[') skipValue(v); else { String s = scalar(v); if (!"null".equals(s)) m.put(k, s); } }
        }
    }
    static byte[] readAll(InputStream in, int max) throws IOException {
        try (InputStream s = in) { ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n; while ((n = s.read(b)) > 0) { o.write(b, 0, n); if (o.size() > max) throw new IOException("Recreation.gov answer too large"); } return o.toByteArray(); }
    }
    static int u16(byte[] b, int i) { return (b[i] & 0xff) | (b[i + 1] & 0xff) << 8; }
    static long u32(byte[] b, int i) { return ((long) (b[i] & 0xff)) | ((long) (b[i + 1] & 0xff)) << 8 | ((long) (b[i + 2] & 0xff)) << 16 | ((long) (b[i + 3] & 0xff)) << 24; }
}
