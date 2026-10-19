package com.bensanzone.fuelmap;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.util.JsonReader;
import android.util.JsonToken;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Download once, query locally. The nationwide response never crosses the WebView bridge. */
final class ChargerInventory {
    private final File file;
    private final AtomicBoolean downloading = new AtomicBoolean();
    private final java.util.concurrent.atomic.AtomicLong generation = new java.util.concurrent.atomic.AtomicLong();
    private volatile boolean cancelled;
    private volatile HttpURLConnection connection;
    private volatile int received;
    private volatile int expected;
    private volatile int httpStatus;
    private volatile String remaining, limit;
    private volatile boolean prepared;
    private final Object schemaLock = new Object();
    interface Progress { void update(int count); }
    ChargerInventory(File files) { file = new File(files, "charger-inventory.sqlite"); }
    private SQLiteDatabase open() {
        SQLiteDatabase db = SQLiteDatabase.openDatabase(file.getPath(), null, SQLiteDatabase.CREATE_IF_NECESSARY | SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING);
        if (!prepared) synchronized (schemaLock) { if (!prepared) {
            db.execSQL("CREATE TABLE IF NOT EXISTS stations(id INTEGER PRIMARY KEY,lat REAL,lng REAL,body TEXT)");
            db.execSQL("CREATE INDEX IF NOT EXISTS station_coords ON stations(lat,lng)");
            db.execSQL("CREATE TABLE IF NOT EXISTS metadata(k TEXT PRIMARY KEY,v TEXT)");
            prepared = true;
        } }
        return db;
    }
    JSONObject status() throws Exception {
        JSONObject result = new JSONObject().put("busy", downloading.get()).put("received", received).put("expected", expected).put("count", 0).put("updated", 0).put("status", httpStatus).put("remaining", remaining).put("limit", limit);
        try (SQLiteDatabase db = open(); Cursor c = db.rawQuery("SELECT k,v FROM metadata", null)) {
            while (c.moveToNext()) result.put(c.getString(0), Long.parseLong(c.getString(1)));
        }
        return result;
    }
    long generation() { return generation.get(); }
    void cancel() { generation.incrementAndGet(); cancelled = true; HttpURLConnection c = connection; if (c != null) c.disconnect(); }
    void clear() throws Exception {
        cancel();
        // Wait for rollback before removing records, so an in-flight update cannot resurrect them.
        synchronized (this) {
            try (SQLiteDatabase db = open()) { db.execSQL("DELETE FROM stations"); db.execSQL("DELETE FROM metadata"); }
        }
    }
    JSONObject download(String key, String agent, Progress progress, long ticket) throws Exception {
        if (!downloading.compareAndSet(false, true)) throw new Exception("A charger download is already running");
        try { synchronized (this) {
            if (ticket != generation.get()) throw new Exception("Download cancelled; previous inventory kept");
            cancelled = false; received = 0; expected = 0; httpStatus = 0; remaining = null; limit = null;
            return load(key, agent, progress, ticket);
        } }
        finally { connection = null; downloading.set(false); }
    }
    private JSONObject load(String key, String agent, Progress progress, long ticket) throws Exception {
        if (key == null || !key.matches("[A-Za-z0-9_-]{1,128}")) throw new Exception("Invalid station-finder key");
        HttpURLConnection c = (HttpURLConnection) new URL("https://developer.nlr.gov/api/alt-fuel-stations/v1.json?fuel_type=ELEC&access=public&status=E&country=all&limit=all").openConnection();
        connection = c; c.setConnectTimeout(15000); c.setReadTimeout(45000); c.setInstanceFollowRedirects(false);
        c.setRequestProperty("X-Api-Key", key); c.setRequestProperty("Accept", "application/json"); c.setRequestProperty("User-Agent", agent);
        long deadline = System.currentTimeMillis() + 900000;
        try {
            int status = c.getResponseCode(); httpStatus = status; remaining = c.getHeaderField("X-RateLimit-Remaining"); limit = c.getHeaderField("X-RateLimit-Limit"); if (status != 200) throw new Exception("HTTP " + status);
            try (SQLiteDatabase db = open(); InputStream input = bounded(c.getInputStream(), 750000000);
                 JsonReader reader = new JsonReader(new InputStreamReader(input, "UTF-8"))) {
                db.beginTransaction();
                try {
                    db.execSQL("DROP TABLE IF EXISTS incoming");
                    db.execSQL("CREATE TABLE incoming(id INTEGER PRIMARY KEY,lat REAL,lng REAL,body TEXT)");
                    boolean found = false; int total = -1;
                    reader.beginObject();
                    while (reader.hasNext()) {
                        String field = reader.nextName();
                        if ("total_results".equals(field)) { total = reader.nextInt(); expected = total; }
                        else if ("fuel_stations".equals(field)) {
                            found = true; reader.beginArray();
                            while (reader.hasNext()) {
                                if (cancelled || ticket != generation.get()) throw new Exception("Download cancelled; previous inventory kept");
                                if (System.currentTimeMillis() > deadline) throw new Exception("Download timed out; previous inventory kept");
                                JSONObject row = (JSONObject) readValue(reader, 0);
                                if (row.optLong("id", -1) < 0 || row.isNull("latitude") || row.isNull("longitude")) throw new Exception("Invalid charger record");
                                double lat = row.getDouble("latitude"), lng = row.getDouble("longitude");
                                if (!Double.isFinite(lat) || !Double.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Exception("Invalid charger coordinates");
                                ContentValues values = new ContentValues(); values.put("id", row.getLong("id")); values.put("lat", lat); values.put("lng", lng); values.put("body", compact(row).toString());
                                db.insertOrThrow("incoming", null, values); received++;
                                if (received % 500 == 0) progress.update(received);
                            }
                            reader.endArray();
                        } else reader.skipValue();
                    }
                    reader.endObject();
                    if (!found || received == 0 || total != received) throw new Exception("Incomplete charger download; previous inventory kept");
                    if (cancelled || ticket != generation.get()) throw new Exception("Download cancelled; previous inventory kept");
                    db.execSQL("DELETE FROM stations"); db.execSQL("INSERT INTO stations SELECT * FROM incoming"); db.execSQL("DROP TABLE incoming");
                    db.execSQL("INSERT OR REPLACE INTO metadata VALUES('count',?)", new Object[]{String.valueOf(received)});
                    db.execSQL("INSERT OR REPLACE INTO metadata VALUES('updated',?)", new Object[]{String.valueOf(System.currentTimeMillis())});
                    db.setTransactionSuccessful();
                } finally { db.endTransaction(); }
            }
        } finally { c.disconnect(); }
        return new JSONObject().put("count", received).put("updated", System.currentTimeMillis()).put("status", httpStatus).put("remaining", remaining).put("limit", limit);
    }
    private static JSONObject compact(JSONObject row) throws Exception {
        JSONObject out = new JSONObject();
        for (String k : new String[]{"id","fuel_type_code","station_name","street_address","city","state","zip","country","latitude","longitude","ev_network","ev_network_web","ev_network_ids","ev_dc_fast_num","ev_level2_evse_num","ev_level1_evse_num","ev_connector_types","ev_charging_units","ev_pricing","access_days_time","status_code","station_phone","date_last_confirmed","updated_at"})
            if (row.has(k)) out.put(k, row.get(k));
        return out;
    }
    /** One bounded station at a time; nested input cannot exhaust the stack. */
    private static Object readValue(JsonReader r, int depth) throws Exception {
        if (depth > 12) throw new Exception("Charger record too deeply nested");
        JsonToken token = r.peek();
        if (token == JsonToken.BEGIN_OBJECT) { JSONObject o = new JSONObject(); r.beginObject(); while (r.hasNext()) o.put(r.nextName(), readValue(r, depth + 1)); r.endObject(); return o; }
        if (token == JsonToken.BEGIN_ARRAY) { JSONArray a = new JSONArray(); r.beginArray(); while (r.hasNext()) a.put(readValue(r, depth + 1)); r.endArray(); return a; }
        if (token == JsonToken.NULL) { r.nextNull(); return JSONObject.NULL; }
        if (token == JsonToken.BOOLEAN) return r.nextBoolean();
        if (token == JsonToken.NUMBER) return Double.valueOf(r.nextString());
        String s = r.nextString(); if (s.length() > 100000) throw new Exception("Charger field too large"); return s;
    }
    static InputStream bounded(InputStream input, final long max) {
        return new FilterInputStream(input) {
            long count;
            private void add(long n) throws IOException { if (n > 0 && (count += n) > max) throw new IOException("Charger download too large"); }
            public int read() throws IOException { int v = in.read(); if (v >= 0) add(1); return v; }
            public int read(byte[] b, int off, int len) throws IOException { int n = in.read(b, off, len); add(n); return n; }
        };
    }
    JSONObject query(String query) throws Exception {
        JSONArray boxes = new JSONArray(query); if (boxes.length() > 3000) throw new Exception("Too many route sections");
        JSONArray rows = new JSONArray(); java.util.Set<Long> ids = new java.util.HashSet<>(); int bytes = 0;
        try (SQLiteDatabase db = open()) {
            for (int i = 0; i < boxes.length(); i++) {
                JSONArray b = boxes.getJSONArray(i); if (b.length() != 4) throw new Exception("Invalid area");
                String[] args = new String[4]; for (int j = 0; j < 4; j++) { double n = b.getDouble(j); if (!Double.isFinite(n)) throw new Exception("Invalid area"); args[j] = String.valueOf(n); }
                try (Cursor c = db.rawQuery("SELECT id,body FROM stations WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?", args)) {
                    while (c.moveToNext()) {
                        if (!ids.add(c.getLong(0))) continue;
                        String body = c.getString(1); bytes += body.length();
                        if (rows.length() >= 20000 || bytes > 12000000) throw new Exception("Charger area too large; use a smaller area");
                        rows.put(new JSONObject(body));
                    }
                }
            }
        }
        return status().put("fuel_stations", rows);
    }
}
