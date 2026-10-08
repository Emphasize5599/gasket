package com.ben.gasmap;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.res.Configuration;
import android.graphics.Color;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.CookieManager;
import android.net.http.HttpResponseCache;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.view.Gravity;
import java.io.File;
import java.util.HashMap;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Single-activity shell. The UI lives in assets/web (Leaflet + OpenStreetMap tiles);
 * this class provides location (straight from the OS, no Google Play services needed,
 * so it works on GrapheneOS without sandboxed Play), Google Places API calls (done here
 * because the Places REST API has no browser CORS support), settings storage,
 * a monthly API-call guard, and the hand-off to Google Maps for directions.
 */
public class MainActivity extends Activity {

    private static final int REQ_LOC = 42;
    private static final String PREFS = "gasmap";
    private static final String PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
    private static final String FIELD_MASK =
            "places.id,places.displayName,places.location,places.formattedAddress,"
            + "places.addressComponents,places.fuelOptions,places.businessStatus,places.googleMapsUri,places.websiteUri";

    private WebView web;
    /** Off-screen pages on each chain's own site, used to read that chain's official prices
     *  (see assets/<key>_worker.js). Each runs the same requests the site's own store finder makes. */
    private FrameLayout root;
    private TextView wmDone;
    private SiteWorker verifying = null;
    private final Map<String, SiteWorker> workers = new HashMap<String, SiteWorker>();
    private LocationManager lm;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<LocationListener> listeners = new ArrayList<LocationListener>();
    private Location best;
    private boolean pageReady = false;
    private String pendingInsets = null;
    private String pendingShare = null;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window w = getWindow();
        // Edge-to-edge (enforced on Android 15+/16 anyway); the web UI pads itself with the real insets.
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        w.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);

        lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);

        web = new WebView(this);
        web.setBackgroundColor(isDark() ? Color.rgb(16, 18, 22) : Color.rgb(242, 243, 245));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(), "Native");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("file:")) return false;
                openExternal(url);
                return true;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                String u = req.getUrl().toString();
                if (u.startsWith("https://tile.openstreetmap.org/")) return fetchTile(u);
                return null;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                if (pendingInsets != null) js(pendingInsets);
                if (pendingShare != null) { js(pendingShare); pendingShare = null; }
            }
        });
        web.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets in) {
                float d = getResources().getDisplayMetrics().density;
                String call = "window.setInsets&&setInsets(" + (in.getSystemWindowInsetTop() / d) + ","
                        + (in.getSystemWindowInsetBottom() / d) + "," + (in.getSystemWindowInsetLeft() / d) + ","
                        + (in.getSystemWindowInsetRight() / d) + ")";
                pendingInsets = call;
                if (pageReady) js(call);
                return in;
            }
        });
        try {
            HttpResponseCache.install(new File(getCacheDir(), "tiles"), 80L * 1024 * 1024);
        } catch (Exception ignored) { }

        root = new FrameLayout(this);
        workers.put("walmart", new SiteWorker("walmart", "https://www.walmart.com/store-finder", "https://www.walmart.com/"));
        workers.put("murphy", new SiteWorker("murphy", "https://service.murphydriverewards.com/mapmodule/", "https://service.murphydriverewards.com/"));
        workers.put("gmaps", new SiteWorker("gmaps", "https://www.google.com/maps", "https://www.google.com/", true));
        for (SiteWorker sw : workers.values()) {
            // the hidden Google Maps page gets a desktop-sized window so it lays out like the desktop site
            if (sw.key.equals("gmaps")) root.addView(sw.view, new FrameLayout.LayoutParams(1280, 900));
            else root.addView(sw.view, new FrameLayout.LayoutParams(-1, -1));
        }
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        wmDone = new TextView(this);
        wmDone.setText("Done \u2014 back to the map");
        wmDone.setTextSize(17);
        wmDone.setTextColor(Color.WHITE);
        wmDone.setGravity(Gravity.CENTER);
        wmDone.setBackgroundColor(Color.rgb(11, 95, 217));
        wmDone.setVisibility(View.GONE);
        float dens = getResources().getDisplayMetrics().density;
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-1, (int) (64 * dens), Gravity.BOTTOM);
        lp.bottomMargin = (int) (48 * dens);
        root.addView(wmDone, lp);
        wmDone.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { endVerify(); }
        });
        setContentView(root);
        applyBarIconColors();
        web.loadUrl("file:///android_asset/web/index.html");
        handleShare(getIntent());
    }

    private boolean isDark() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
    }

    private void applyBarIconColors() {
        int flags = web != null ? getWindow().getDecorView().getSystemUiVisibility() : 0;
        int lightStatus = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR; // 0x2000
        int lightNav = 0x10; // SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR (API 26)
        if (isDark()) flags &= ~(lightStatus | lightNav);
        else flags |= (lightStatus | lightNav);
        getWindow().getDecorView().setSystemUiVisibility(flags);
    }

    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        applyBarIconColors();
    }

    private void js(final String code) {
        main.post(new Runnable() {
            public void run() {
                if (web != null) web.evaluateJavascript(code, null);
            }
        });
    }

    private static String q(String s) {
        return JSONObject.quote(s == null ? "" : s);
    }

    // ---------------- OpenStreetMap tiles (identified, cached; OSM tile policy) ----------------

    private WebResourceResponse fetchTile(String u) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
            c.setUseCaches(true);
            c.setConnectTimeout(10000);
            c.setReadTimeout(15000);
            c.setRequestProperty("User-Agent", "FuelPlusMap/1.2 (Android; personal use; com.ben.gasmap)");
            int st = c.getResponseCode();
            if (st != 200) return null;
            Map<String, String> h = new HashMap<String, String>();
            h.put("Access-Control-Allow-Origin", "*");
            h.put("Cache-Control", "max-age=604800");
            return new WebResourceResponse("image/png", null, 200, "OK", h, c.getInputStream());
        } catch (Exception e) {
            return null;
        }
    }

    // ---------------- official chain prices (off-screen site pages) ----------------

    class SiteWorker {
        final String key, home, origin;
        final WebView view;
        boolean ready = false;
        final List<String> queue = new ArrayList<String>();

        SiteWorker(String key, String home, String origin) { this(key, home, origin, false); }

        SiteWorker(String key, String home, String origin, boolean desktop) {
            this.key = key; this.home = home; this.origin = origin;
            view = new WebView(MainActivity.this);
            WebSettings ws = view.getSettings();
            ws.setJavaScriptEnabled(true);
            ws.setDomStorageEnabled(true);
            if (desktop) {
                // Google Maps' desktop page is the one that spells out every stop's coordinates in its address
                ws.setUserAgentString("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36");
                ws.setUseWideViewPort(true);
                ws.setLoadWithOverviewMode(true);
            }
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);
            view.addJavascriptInterface(new SiteBridge(key), "FuelPlusSite");
            view.setWebChromeClient(new WebChromeClient());
            view.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView v, String url) {
                    String title = String.valueOf(v.getTitle()).toLowerCase(Locale.US);
                    boolean blocked = url.contains("/blocked") || url.contains("/sorry/") || title.contains("robot") || title.contains("access denied")
                            || title.contains("captcha") || title.contains("unusual traffic");
                    ready = !blocked && url.startsWith(SiteWorker.this.origin);
                    if (verifying == SiteWorker.this) {
                        if (ready) js("window.toast&&toast(" + q("Check passed. Tap Done.") + ")");
                        return;
                    }
                    if (blocked) {
                        js("window.onSiteBlocked&&onSiteBlocked(" + q(SiteWorker.this.key) + ")");
                        queue.clear();
                    } else if (ready) {
                        for (String call : queue) view.evaluateJavascript(call, null);
                        queue.clear();
                    }
                }
            });
        }

        /** Open a specific page (a shared Google Maps link), then run the script once it has loaded. */
        void loadAndRun(String url, String call) {
            queue.clear();
            queue.add(call);
            ready = false;
            view.loadUrl(url);
        }

        void run(String call) {
            if (ready && view.getUrl() != null && view.getUrl().startsWith(origin)) {
                view.evaluateJavascript(call, null);
            } else {
                queue.clear();
                queue.add(call);
                view.loadUrl(home);
            }
        }
    }

    public class SiteBridge {
        private final String key;
        SiteBridge(String key) { this.key = key; }

        @JavascriptInterface
        public void progress(int reqId, int done, int total) {
            js("window.onSiteProgress&&onSiteProgress(" + q(key) + "," + reqId + "," + done + "," + total + ")");
        }

        /** Called by the worker script; payload is data only and is parsed with JSON.parse on the app side. */
        @JavascriptInterface
        public void result(int reqId, String json) {
            js("window.onSiteResult&&onSiteResult(" + q(key) + "," + reqId + ",JSON.parse(" + q(json) + "))");
        }
    }

    private void startVerify(SiteWorker w) {
        verifying = w;
        w.view.loadUrl(w.home);
        web.setVisibility(View.INVISIBLE);
        wmDone.setVisibility(View.VISIBLE);
        w.view.bringToFront();
        wmDone.bringToFront();
    }

    private void endVerify() {
        String key = verifying != null ? verifying.key : "";
        verifying = null;
        wmDone.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        web.bringToFront();
        wmDone.bringToFront();
        js("window.onSiteVerified&&onSiteVerified(" + q(key) + ")");
    }

    private String asset(String name) {
        try {
            InputStream is = getAssets().open(name);
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
            is.close();
            return bo.toString("UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    @Override
    public void onBackPressed() {
        if (verifying != null) { endVerify(); return; }
        web.evaluateJavascript("window.onBack?onBack():false", new android.webkit.ValueCallback<String>() {
            public void onReceiveValue(String handled) {
                if (!"true".equals(handled)) MainActivity.super.onBackPressed();
            }
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        stopLocation();
    }

    // ---------------- location (OS LocationManager; GPS + network/fused if present) ----------------

    private boolean hasLocPerm() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void startLocation() {
        if (!hasLocPerm()) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOC);
            return;
        }
        stopLocation();
        best = null;
        List<String> providers = lm.getProviders(true);
        if (providers.isEmpty()) {
            js("window.onLocationError&&onLocationError(" + q("Location is turned off. Enable it in quick settings.") + ")");
            return;
        }
        for (String p : providers) {
            if ("passive".equals(p)) continue;
            try {
                Location last = lm.getLastKnownLocation(p);
                if (last != null && System.currentTimeMillis() - last.getTime() < 10 * 60 * 1000) consider(last);
            } catch (SecurityException ignored) { }
        }
        for (String p : providers) {
            if ("passive".equals(p)) continue;
            LocationListener l = new LocationListener() {
                public void onLocationChanged(Location loc) { consider(loc); }
                public void onStatusChanged(String pr, int st, Bundle b) { }
                public void onProviderEnabled(String pr) { }
                public void onProviderDisabled(String pr) { }
            };
            try {
                lm.requestLocationUpdates(p, 2000, 5, l, Looper.getMainLooper());
                listeners.add(l);
            } catch (SecurityException ignored) { } catch (IllegalArgumentException ignored) { }
        }
        // Save battery: stop listening after 45 s; the user can tap "locate" again.
        main.postDelayed(new Runnable() { public void run() { stopLocation(); } }, 45000);
    }

    private void consider(Location loc) {
        if (best == null || loc.getAccuracy() <= best.getAccuracy() || loc.getTime() - best.getTime() > 15000) {
            best = loc;
            js("window.onLocation&&onLocation(" + loc.getLatitude() + "," + loc.getLongitude() + "," + loc.getAccuracy() + ")");
        }
        if (loc.getAccuracy() > 0 && loc.getAccuracy() < 25) stopLocation();
    }

    private void stopLocation() {
        for (LocationListener l : listeners) {
            try { lm.removeUpdates(l); } catch (SecurityException ignored) { }
        }
        listeners.clear();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code != REQ_LOC) return;
        if (hasLocPerm()) startLocation();
        else js("window.onLocationError&&onLocationError(" + q("Location permission denied. You can still pan the map and tap 'Search this area'.") + ")");
    }

    // ---------------- external apps ----------------

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException e) {
            js("window.toast&&toast(" + q("No app can open that link.") + ")");
        }
    }

    private String certSha1() {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), PackageManager.GET_SIGNATURES);
            Signature sig = pi.signatures[0];
            byte[] dg = MessageDigest.getInstance("SHA-1").digest(sig.toByteArray());
            StringBuilder sb = new StringBuilder();
            for (byte b : dg) sb.append(String.format(Locale.US, "%02X", b));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private static String monthKey() {
        return "calls_" + new SimpleDateFormat("yyyy-MM", Locale.US).format(new Date());
    }

    // ---------------- Places API ----------------

    private String placesSearch(String apiKey, String text, double minLat, double minLng, double maxLat, double maxLng)
            throws Exception {
        JSONObject body = new JSONObject();
        body.put("textQuery", text);
        body.put("includedType", "gas_station");
        body.put("pageSize", 20);
        JSONObject rect = new JSONObject();
        rect.put("low", new JSONObject().put("latitude", minLat).put("longitude", minLng));
        rect.put("high", new JSONObject().put("latitude", maxLat).put("longitude", maxLng));
        body.put("locationRestriction", new JSONObject().put("rectangle", rect));

        HttpURLConnection c = (HttpURLConnection) new URL(PLACES_URL).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("X-Goog-Api-Key", apiKey);
        c.setRequestProperty("X-Goog-FieldMask", FIELD_MASK);
        // Lets the key be restricted to this app in Google Cloud Console.
        c.setRequestProperty("X-Android-Package", getPackageName());
        c.setRequestProperty("X-Android-Cert", certSha1());
        OutputStream os = c.getOutputStream();
        os.write(body.toString().getBytes("UTF-8"));
        os.close();
        int status = c.getResponseCode();
        InputStream is = status >= 400 ? c.getErrorStream() : c.getInputStream();
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        if (is != null) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
            is.close();
        }
        String resp = bo.toString("UTF-8");
        if (status >= 400) {
            String msg = resp;
            try { msg = new JSONObject(resp).getJSONObject("error").getString("message"); } catch (Exception ignored) { }
            throw new Exception("Google Places error " + status + ": " + msg);
        }
        return resp;
    }

    // ---------------- trip planning: Google Routes + along-route Places search, link resolving, EPA data ----------------

    private static final String ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
    private static final String ROUTES_MASK = "routes.description,routes.routeLabels,routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,"
            + "routes.legs.distanceMeters,routes.legs.duration,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction";
    private static final String ALONG_MASK = FIELD_MASK + ",routingSummaries,nextPageToken";

    private static String routeMonthKey() {
        return "rcalls_" + new SimpleDateFormat("yyyy-MM", Locale.US).format(new Date());
    }

    private static String readAll(InputStream is) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        if (is != null) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
            is.close();
        }
        return bo.toString("UTF-8");
    }

    private String googlePost(String url, String apiKey, String mask, String body, String what) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("X-Goog-Api-Key", apiKey);
        c.setRequestProperty("X-Goog-FieldMask", mask);
        c.setRequestProperty("X-Android-Package", getPackageName());
        c.setRequestProperty("X-Android-Cert", certSha1());
        OutputStream os = c.getOutputStream();
        os.write(body.getBytes("UTF-8"));
        os.close();
        int status = c.getResponseCode();
        String resp = readAll(status >= 400 ? c.getErrorStream() : c.getInputStream());
        if (status >= 400) {
            String msg = resp;
            try { msg = new JSONObject(resp).getJSONObject("error").getString("message"); } catch (Exception ignored) { }
            throw new Exception(what + " error " + status + ": " + msg);
        }
        return resp;
    }

    private static boolean hostAllowed(String url, String[] hosts) {
        try {
            String h = new URL(url).getHost().toLowerCase(Locale.US);
            if (!url.startsWith("https://")) return false;
            for (String a : hosts) if (h.equals(a)) return true;
        } catch (Exception ignored) { }
        return false;
    }

    private static final String[] LINK_HOSTS = {"maps.app.goo.gl", "goo.gl", "g.co", "maps.google.com", "www.google.com", "google.com"};

    /** Follows a shared Google Maps short link (maps.app.goo.gl/...) to the full directions URL. */
    private String resolveMapsLink(String url) throws Exception {
        String cur = url;
        for (int hop = 0; hop < 8; hop++) {
            if (!hostAllowed(cur, LINK_HOSTS)) throw new Exception("Not a Google Maps link");
            if (cur.contains("/maps/dir") || cur.contains("daddr=") || cur.contains("destination=")) return cur;
            HttpURLConnection c = (HttpURLConnection) new URL(cur).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(10000);
            c.setReadTimeout(15000);
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36");
            int st = c.getResponseCode();
            if (st >= 300 && st < 400) {
                String loc = c.getHeaderField("Location");
                if (loc == null) break;
                cur = new URL(new URL(cur), loc).toString();
                continue;
            }
            String body = readAll(st >= 400 ? c.getErrorStream() : c.getInputStream());
            java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile("https://(?:www\\.)?google\\.com/maps/dir/[^\"'\\s<>]+").matcher(body.replace("\\u003d", "=").replace("\\u0026", "&"));
            if (m.find()) return m.group().replace("&amp;", "&");
            break;
        }
        throw new Exception("Couldn't open that link. In Google Maps use Share \u2192 Copy, then paste it here.");
    }

    // EPA mileage, OpenStreetMap places, FHWA speed limits, ExxonMobil's station finder, the DOE station finder (EV chargers,
    // hydrogen), and NHTSA (VIN decoding, recalls)
    private static final String[] JSON_HOSTS = {"www.fueleconomy.gov", "fueleconomy.gov", "nominatim.openstreetmap.org", "geo.dot.gov", "www.exxon.com",
            "developer.nlr.gov", "developer.nrel.gov", "vpic.nhtsa.dot.gov", "api.nhtsa.gov"};

    // brand icons: Google's favicon service, or each brand's own site
    private static final String[] ICON_HOSTS = {"www.google.com", "icons.duckduckgo.com", "www.walmart.com", "www.murphyusa.com", "www.samsclub.com", "www.exxon.com", "www.mobil.com", "www.citgo.com"};

    private String getJson(String url) throws Exception {
        if (!hostAllowed(url, JSON_HOSTS)) throw new Exception("Host not allowed");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(20000);
        c.setRequestProperty("Accept", "application/json");
        // OpenStreetMap's usage policy asks apps to identify themselves
        c.setRequestProperty("User-Agent", "FuelPlusMap/2.0 (personal Android app; com.ben.gasmap)");
        int st = c.getResponseCode();
        String body = readAll(st >= 400 ? c.getErrorStream() : c.getInputStream());
        if (st >= 400) throw new Exception("HTTP " + st);
        return body;
    }

    private void reply(final int reqId, final JSONObject o) {
        js("window.onNativeResult&&onNativeResult(" + reqId + "," + o.toString() + ")");
    }

    private void handleShare(Intent i) {
        if (i == null || !Intent.ACTION_SEND.equals(i.getAction())) return;
        String t = i.getStringExtra(Intent.EXTRA_TEXT);
        if (t == null) return;
        final String call = "window.onSharedText?onSharedText(" + q(t) + "):(window.__pendingShare=" + q(t) + ")";
        if (pageReady) js(call); else pendingShare = call;
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        handleShare(i);
    }

    private static final int PICK_FILE = 4711;
    private int pickReq = -1;

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_FILE || pickReq < 0) return;
        final int reqId = pickReq; pickReq = -1;
        final Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        new Thread(new Runnable() {
            public void run() {
                JSONObject o = new JSONObject();
                try {
                    if (uri == null) o.put("cancelled", true);
                    else {
                        InputStream is = getContentResolver().openInputStream(uri);
                        ByteArrayOutputStream bo = new ByteArrayOutputStream();
                        byte[] buf = new byte[8192]; int n, total = 0;
                        while ((n = is.read(buf)) > 0) { total += n; if (total > 20 * 1024 * 1024) throw new Exception("File is too big"); bo.write(buf, 0, n); }
                        is.close();
                        o.put("body", bo.toString("UTF-8"));
                    }
                } catch (Exception e) { try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { } }
                reply(reqId, o);
            }
        }).start();
    }

    public class Bridge {
        /** Debug log lives in a private file (only when you turn debug logging on). */
        @JavascriptInterface
        public void saveLog(String text) {
            try {
                java.io.FileOutputStream f = openFileOutput("debug-log.json", MODE_PRIVATE);
                f.write(text.getBytes("UTF-8"));
                f.close();
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public String loadLog() {
            try { return readAll(openFileInput("debug-log.json")); } catch (Exception e) { return ""; }
        }

        /** Android share sheet with plain text (trip summaries, troubleshooting reports). */
        @JavascriptInterface
        public void shareText(final String subject, final String text) {
            main.post(new Runnable() {
                public void run() {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType("text/plain");
                    i.putExtra(Intent.EXTRA_SUBJECT, subject);
                    i.putExtra(Intent.EXTRA_TEXT, text);
                    try { startActivity(Intent.createChooser(i, subject)); }
                    catch (Exception e) { js("window.toast&&toast(" + q("No app can share that.") + ")"); }
                }
            });
        }

        /**
         * Saves a (possibly large) text file to Downloads/FuelPlus off the main thread, then offers it to other apps as a
         * file — not as pasted text, which makes the share sheet crawl on big reports. Replies {path} or {error}.
         */
        @JavascriptInterface
        public void saveAndShare(final int reqId, final String name, final String mime, final String text, final String subject) {
            new Thread(new Runnable() {
                public void run() {
                    final JSONObject o = new JSONObject();
                    Uri uri = null;
                    try {
                        android.content.ContentValues v = new android.content.ContentValues();
                        v.put("_display_name", name.replaceAll("[^A-Za-z0-9._ -]", "_"));
                        v.put("mime_type", mime);
                        v.put("relative_path", "Download/FuelPlus");
                        uri = getContentResolver().insert(Uri.parse("content://media/external/downloads"), v);
                        if (uri == null) throw new Exception("couldn't create the file");
                        OutputStream os = getContentResolver().openOutputStream(uri);
                        os.write(text.getBytes("UTF-8"));
                        os.close();
                        o.put("path", "Downloads/FuelPlus/" + name);
                    } catch (Exception e) { try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { } }
                    final Uri u = uri;
                    main.post(new Runnable() {
                        public void run() {
                            if (u != null && !o.has("error")) {
                                Intent i = new Intent(Intent.ACTION_SEND);
                                i.setType(mime);
                                i.putExtra(Intent.EXTRA_SUBJECT, subject);
                                i.putExtra(Intent.EXTRA_STREAM, u);
                                i.setClipData(android.content.ClipData.newRawUri(subject, u));
                                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                try { startActivity(Intent.createChooser(i, subject)); }
                                catch (Exception e) { js("window.toast&&toast(" + q("No app can share that.") + ")"); }
                            }
                            reply(reqId, o);
                        }
                    });
                }
            }).start();
        }

        /** Saves a file to Downloads/FuelPlus (no storage permission needed on Android 10+). Returns where, or an error. */
        @JavascriptInterface
        public String saveDownload(String name, String mime, String text) {
            try {
                android.content.ContentValues v = new android.content.ContentValues();
                v.put("_display_name", name.replaceAll("[^A-Za-z0-9._ -]", "_"));
                v.put("mime_type", mime);
                v.put("relative_path", "Download/FuelPlus");
                Uri uri = getContentResolver().insert(Uri.parse("content://media/external/downloads"), v);
                if (uri == null) return "error: couldn't create the file";
                OutputStream os = getContentResolver().openOutputStream(uri);
                os.write(text.getBytes("UTF-8"));
                os.close();
                return "Downloads/FuelPlus/" + name;
            } catch (Exception e) {
                return "error: " + e.getMessage();
            }
        }

        /** Opens the system file picker for a Fuel+ data file to import; the text comes back via onNativeResult. */
        @JavascriptInterface
        public void pickTextFile(final int reqId) {
            main.post(new Runnable() {
                public void run() {
                    pickReq = reqId;
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    i.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"application/json", "text/plain", "application/octet-stream"});
                    try { startActivityForResult(i, PICK_FILE); }
                    catch (Exception e) {
                        JSONObject o = new JSONObject();
                        try { o.put("error", "No file picker available"); } catch (Exception ignored) { }
                        reply(reqId, o); pickReq = -1;
                    }
                }
            });
        }

        @JavascriptInterface
        public String appVersion() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
        }

        @JavascriptInterface
        public int routeCallsThisMonth() { return prefs().getInt(routeMonthKey(), 0); }

        /**
         * Address / place lookup: returns full Google addresses with place IDs and coordinates, biased toward
         * (lat, lng) when given. Basic fields only (Text Search Essentials), counted separately from price lookups.
         */
        @JavascriptInterface
        public void placesFind(final int reqId, final String apiKey, final String query, final double lat, final double lng, final boolean bias, final double radiusM) {
            new Thread(new Runnable() {
                public void run() {
                    JSONObject o = new JSONObject();
                    try {
                        JSONObject body = new JSONObject();
                        body.put("textQuery", query);
                        body.put("pageSize", 5);
                        if (bias) body.put("locationBias", new JSONObject().put("circle", new JSONObject()
                                .put("center", new JSONObject().put("latitude", lat).put("longitude", lng)).put("radius", radiusM > 0 ? Math.min(50000.0, radiusM) : 50000.0)));
                        String k = "fcalls_" + new SimpleDateFormat("yyyy-MM", Locale.US).format(new Date());
                        prefs().edit().putInt(k, prefs().getInt(k, 0) + 1).apply();
                        o.put("body", googlePost(PLACES_URL, apiKey, "places.id,places.displayName,places.formattedAddress,places.location", body.toString(), "Google Places"));
                    } catch (Exception e) { try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { } }
                    reply(reqId, o);
                }
            }).start();
        }

        @JavascriptInterface
        public void resolveLink(final int reqId, final String url) {
            new Thread(new Runnable() {
                public void run() {
                    JSONObject o = new JSONObject();
                    try { o.put("url", resolveMapsLink(url)); } catch (Exception e) { try { o.put("error", e.getMessage()); } catch (Exception ignored) { } }
                    reply(reqId, o);
                }
            }).start();
        }

        /** fueleconomy.gov (EPA) vehicle menus and records. */
        @JavascriptInterface
        public void fetchJson(final int reqId, final String url) {
            new Thread(new Runnable() {
                public void run() {
                    JSONObject o = new JSONObject();
                    try { o.put("body", getJson(url)); } catch (Exception e) { try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { } }
                    reply(reqId, o);
                }
            }).start();
        }

        private byte[] iconBytes(String url, String[] finalUrl) throws Exception {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(8000); c.setReadTimeout(12000); c.setInstanceFollowRedirects(true);
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 15; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36");
            c.setRequestProperty("Accept", "image/avif,image/webp,image/png,image/*,text/html;q=0.9,*/*;q=0.8");
            if (c.getResponseCode() >= 400) throw new Exception("HTTP " + c.getResponseCode());
            InputStream is = c.getInputStream();
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192]; int n;
            while ((n = is.read(buf)) > 0) { bo.write(buf, 0, n); if (bo.size() > 1500000) throw new Exception("too big"); }
            is.close();
            if (finalUrl != null) finalUrl[0] = c.getURL().toString();
            return bo.toByteArray();
        }

        /** A brand's own icon (its website's favicon), shrunk to at most 96 px and handed back as a PNG data URL. */
        @JavascriptInterface
        public void fetchIcon(final int reqId, final String url) {
            new Thread(new Runnable() {
                public void run() {
                    JSONObject o = new JSONObject();
                    try {
                        if (!hostAllowed(url, ICON_HOSTS)) throw new Exception("Host not allowed");
                        String[] fin = new String[1];
                        byte[] data = iconBytes(url, fin);
                        // a web page (the brand's home page): use the icon it links to — the biggest one it lists
                        String head = new String(data, 0, Math.min(data.length, 200000), "UTF-8");
                        if (head.trim().startsWith("<") && head.toLowerCase(Locale.US).contains("<html")) {
                            String best = null; int bestSz = -1;
                            java.util.regex.Matcher m = java.util.regex.Pattern.compile("<link\\b[^>]*>", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(head);
                            while (m.find()) {
                                String tag = m.group();
                                java.util.regex.Matcher rel = java.util.regex.Pattern.compile("rel\\s*=\\s*[\"']([^\"']+)", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(tag);
                                java.util.regex.Matcher href = java.util.regex.Pattern.compile("href\\s*=\\s*[\"']([^\"']+)", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(tag);
                                if (!rel.find() || !href.find() || !rel.group(1).toLowerCase(Locale.US).contains("icon")) continue;
                                if (href.group(1).toLowerCase(Locale.US).endsWith(".svg")) continue;
                                int sz = rel.group(1).toLowerCase(Locale.US).contains("apple") ? 180 : 32;
                                java.util.regex.Matcher sm = java.util.regex.Pattern.compile("sizes\\s*=\\s*[\"'](\\d+)").matcher(tag);
                                if (sm.find()) sz = Integer.parseInt(sm.group(1));
                                if (sz > bestSz) { bestSz = sz; best = href.group(1).replace("&amp;", "&"); }
                            }
                            if (best == null) throw new Exception("no icon on the page");
                            String abs = new URL(new URL(fin[0]), best).toString();
                            if (!abs.startsWith("https://")) throw new Exception("icon not https");
                            data = iconBytes(abs, fin);
                        }
                        android.graphics.Bitmap bm = android.graphics.BitmapFactory.decodeByteArray(data, 0, data.length);
                        if (bm == null) throw new Exception("not an image");
                        int w = bm.getWidth(), h = bm.getHeight();
                        if (Math.max(w, h) > 96) {
                            float s = 96f / Math.max(w, h);
                            bm = android.graphics.Bitmap.createScaledBitmap(bm, Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)), true);
                        }
                        java.io.ByteArrayOutputStream png = new java.io.ByteArrayOutputStream();
                        bm.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, png);
                        o.put("body", "data:image/png;base64," + android.util.Base64.encodeToString(png.toByteArray(), android.util.Base64.NO_WRAP));
                        o.put("w", w); o.put("h", h);
                    } catch (Exception e) { try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { } }
                    reply(reqId, o);
                }
            }).start();
        }

        @JavascriptInterface
        public void computeRoute(final int reqId, final String apiKey, final String bodyJson) {
            new Thread(new Runnable() {
                public void run() {
                    JSONObject o = new JSONObject();
                    try {
                        String body = new JSONObject(bodyJson).toString();
                        prefs().edit().putInt(routeMonthKey(), prefs().getInt(routeMonthKey(), 0) + 1).apply();
                        o.put("body", googlePost(ROUTES_URL, apiKey, ROUTES_MASK, body, "Google Routes"));
                    } catch (Exception e) { try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { } }
                    reply(reqId, o);
                }
            }).start();
        }

        /**
         * Text Search along route. jobs = [{q, polyline, lat, lng, pages}] (lat/lng = where that piece of the
         * route starts, for detour summaries). Each request counts toward the monthly Places cap.
         */
        @JavascriptInterface
        public void routeSearch(final int reqId, final String apiKey, final String jobsJson, final int monthlyCap) {
            new Thread(new Runnable() {
                public void run() {
                    final JSONObject out = new JSONObject();
                    final JSONArray results = new JSONArray(), errors = new JSONArray();
                    try {
                        final JSONArray jobs = new JSONArray(jobsJson);
                        final int n = jobs.length();
                        final java.util.concurrent.atomic.AtomicInteger done = new java.util.concurrent.atomic.AtomicInteger(0);
                        final java.util.concurrent.atomic.AtomicBoolean stop = new java.util.concurrent.atomic.AtomicBoolean(false);
                        // several lookups at once (Google allows plenty of parallel requests); the monthly counter is shared
                        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(Math.max(1, Math.min(6, n)));
                        for (int ii = 0; ii < n; ii++) {
                            final int i = ii;
                            pool.execute(new Runnable() {
                                public void run() {
                                    try {
                                        JSONObject job = jobs.getJSONObject(i);
                                        String token = null;
                                        int pages = Math.max(1, Math.min(3, job.optInt("pages", 1)));
                                        for (int pg = 0; pg < pages && !stop.get(); pg++) {
                                            synchronized (MainActivity.this) {
                                                int used = prefs().getInt(monthKey(), 0);
                                                if (monthlyCap > 0 && used >= monthlyCap) {
                                                    if (!stop.getAndSet(true)) synchronized (errors) { errors.put("Monthly Google lookup cap reached (" + used + "/" + monthlyCap + "). Planned with what was found."); }
                                                    return;
                                                }
                                                prefs().edit().putInt(monthKey(), used + 1).apply();
                                            }
                                            JSONObject body = new JSONObject();
                                            body.put("textQuery", job.getString("q"));
                                            body.put("includedType", "gas_station");
                                            body.put("pageSize", 20);
                                            body.put("searchAlongRouteParameters", new JSONObject().put("polyline",
                                                    new JSONObject().put("encodedPolyline", job.getString("polyline"))));
                                            body.put("routingParameters", new JSONObject().put("origin",
                                                    new JSONObject().put("latitude", job.getDouble("lat")).put("longitude", job.getDouble("lng"))));
                                            if (token != null) body.put("pageToken", token);
                                            try {
                                                JSONObject r = new JSONObject(googlePost(PLACES_URL, apiKey, ALONG_MASK, body.toString(), "Google Places"));
                                                r.put("job", i);
                                                synchronized (results) { results.put(r); }
                                                token = r.optString("nextPageToken", null);
                                                if (token == null || token.length() == 0) break;
                                                Thread.sleep(400);
                                            } catch (Exception e) {
                                                synchronized (errors) { errors.put(job.getString("q") + ": " + e.getMessage()); }
                                                if (String.valueOf(e.getMessage()).contains(" 40")) stop.set(true);
                                                break;
                                            }
                                        }
                                    } catch (Exception e) { synchronized (errors) { errors.put(String.valueOf(e)); } }
                                    finally { js("window.onNativeProgress&&onNativeProgress(" + reqId + "," + done.incrementAndGet() + "," + n + ")"); }
                                }
                            });
                        }
                        pool.shutdown();
                        pool.awaitTermination(5, java.util.concurrent.TimeUnit.MINUTES);
                    } catch (Exception e) { errors.put(String.valueOf(e)); }
                    try {
                        out.put("results", results);
                        out.put("errors", errors);
                        out.put("calls", prefs().getInt(monthKey(), 0));
                    } catch (Exception ignored) { }
                    reply(reqId, out);
                }
            }).start();
        }

        // ---- small key/value cache in the app's private storage (saved searches, speed limits, routes) ----
        private java.io.File kvFile(String ns, String key) throws Exception {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-1");
            byte[] h = md.digest(key.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte x : h) sb.append(String.format("%02x", x));
            java.io.File dir = new java.io.File(new java.io.File(getFilesDir(), "kv"), ns.replaceAll("[^a-z0-9_-]", "_"));
            if (!dir.exists()) dir.mkdirs();
            return new java.io.File(dir, sb.toString());
        }

        @JavascriptInterface
        public String kvGet(String ns, String key) {
            try {
                java.io.File f = kvFile(ns, key);
                if (!f.exists()) return "";
                return readAll(new java.io.FileInputStream(f));
            } catch (Exception e) { return ""; }
        }

        @JavascriptInterface
        public void kvPut(String ns, String key, String value) {
            try {
                java.io.FileOutputStream o = new java.io.FileOutputStream(kvFile(ns, key));
                o.write(value.getBytes("UTF-8"));
                o.close();
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public int kvClear(String ns) {
            int n = 0;
            java.io.File dir = new java.io.File(new java.io.File(getFilesDir(), "kv"), ns.replaceAll("[^a-z0-9_-]", "_"));
            java.io.File[] fs = dir.listFiles();
            if (fs != null) for (java.io.File f : fs) if (f.delete()) n++;
            return n;
        }

        @JavascriptInterface
        public String loadSettings() { return prefs().getString("settings", ""); }

        @JavascriptInterface
        public void saveSettings(String json) { prefs().edit().putString("settings", json).apply(); }

        @JavascriptInterface
        public String loadCache() { return prefs().getString("cache", ""); }

        @JavascriptInterface
        public void saveCache(String json) { prefs().edit().putString("cache", json).apply(); }

        @JavascriptInterface
        public int callsThisMonth() { return prefs().getInt(monthKey(), 0); }

        @JavascriptInterface
        public String certFingerprint() { return certSha1(); }

        @JavascriptInterface
        public String packageName() { return getPackageName(); }

        /** Runs assets/<key>_worker.js inside that chain's own site page. argsJson is built by the app. */
        @JavascriptInterface
        public void siteSearch(final String key, final int reqId, final String argsJson) {
            main.post(new Runnable() {
                public void run() {
                    SiteWorker w = workers.get(key);
                    if (w == null) return;
                    String script = asset(key + "_worker.js");
                    if (script.length() == 0) return;
                    String args, url = null;
                    try {
                        JSONObject a = new JSONObject(argsJson);
                        args = a.toString();
                        url = a.optString("url", null);
                    } catch (Exception e) { return; }
                    String call = "(" + script + ")(" + reqId + "," + args + ")";
                    if (url != null && url.length() > 0) {
                        // only Google Maps directions links may be opened this way
                        if (!url.startsWith("https://www.google.com/maps/dir/")) return;
                        w.loadAndRun(url, call);
                    } else w.run(call);
                }
            });
        }

        @JavascriptInterface
        public void siteVerify(final String key) {
            main.post(new Runnable() {
                public void run() {
                    SiteWorker w = workers.get(key);
                    if (w != null) startVerify(w);
                }
            });
        }

        @JavascriptInterface
        public void locate() {
            main.post(new Runnable() { public void run() { startLocation(); } });
        }

        @JavascriptInterface
        public void haptic() {
            main.post(new Runnable() {
                public void run() { web.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY); }
            });
        }

        @JavascriptInterface
        public void setStatusBarDark(final boolean darkUi) {
            main.post(new Runnable() { public void run() { applyBarIconColors(); } });
        }

        /** Put text on the clipboard (e.g. your VIN before opening a site that asks for it). */
        @JavascriptInterface
        public void copyText(final String text) {
            main.post(new Runnable() {
                public void run() {
                    try {
                        android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                        if (cm != null) cm.setPrimaryClip(android.content.ClipData.newPlainText("VIN", text));
                    } catch (Exception ignored) { }
                }
            });
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            main.post(new Runnable() { public void run() { openExternal(url); } });
        }

        /** Google Maps turn-by-turn; falls back to the browser version of Maps. */
        @JavascriptInterface
        public void navigate(final double lat, final double lng, final String placeId, final String name) {
            main.post(new Runnable() {
                public void run() {
                    String url = "https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate"
                            + "&destination=" + lat + "," + lng
                            + (placeId != null && placeId.length() > 0 ? "&destination_place_id=" + Uri.encode(placeId) : "");
                    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    i.setPackage("com.google.android.apps.maps");
                    try {
                        startActivity(i);
                    } catch (ActivityNotFoundException e) {
                        openExternal(url);
                    }
                }
            });
        }

        /** Any installed maps app (Organic Maps, CoMaps, OsmAnd, Magic Earth...). */
        @JavascriptInterface
        public void openInOtherApp(final double lat, final double lng, final String name) {
            main.post(new Runnable() {
                public void run() {
                    openExternal("geo:" + lat + "," + lng + "?q=" + lat + "," + lng + "(" + Uri.encode(name) + ")");
                }
            });
        }

        /**
         * Runs one Text Search per query string inside the bounding box, in a background thread.
         * Calls window.onSearchResult(reqId, {places:[...], errors:[...], calls:n}).
         */
        @JavascriptInterface
        public void search(final int reqId, final String apiKey, final String queriesJson,
                           final double minLat, final double minLng, final double maxLat, final double maxLng,
                           final int monthlyCap) {
            new Thread(new Runnable() {
                public void run() {
                    JSONObject out = new JSONObject();
                    final JSONArray places = new JSONArray();
                    final JSONArray errors = new JSONArray();
                    try {
                        final JSONArray queries = new JSONArray(queriesJson);
                        final java.util.concurrent.atomic.AtomicBoolean stop = new java.util.concurrent.atomic.AtomicBoolean(false);
                        // one lookup per brand, all at once
                        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(Math.max(1, Math.min(6, queries.length())));
                        for (int ii = 0; ii < queries.length(); ii++) {
                            final String text = queries.getString(ii);
                            pool.execute(new Runnable() {
                                public void run() {
                                    if (stop.get()) return;
                                    synchronized (MainActivity.this) {
                                        int used = prefs().getInt(monthKey(), 0);
                                        if (monthlyCap > 0 && used >= monthlyCap) {
                                            if (!stop.getAndSet(true)) synchronized (errors) { errors.put("Monthly API-call cap reached (" + used + "/" + monthlyCap
                                                    + "). Showing cached prices. Raise the cap in Settings if you accept possible charges."); }
                                            return;
                                        }
                                        prefs().edit().putInt(monthKey(), used + 1).apply();
                                    }
                                    try {
                                        JSONObject r = new JSONObject(placesSearch(apiKey, text, minLat, minLng, maxLat, maxLng));
                                        JSONArray arr = r.optJSONArray("places");
                                        if (arr != null) for (int k = 0; k < arr.length(); k++) {
                                            JSONObject p = arr.getJSONObject(k);
                                            p.put("_query", text);
                                            synchronized (places) { places.put(p); }
                                        }
                                    } catch (Exception e) {
                                        synchronized (errors) { errors.put(text + ": " + e.getMessage()); }
                                        if (String.valueOf(e.getMessage()).contains(" 40")) stop.set(true); // bad key / not enabled: don't burn calls
                                    }
                                }
                            });
                        }
                        pool.shutdown();
                        pool.awaitTermination(2, java.util.concurrent.TimeUnit.MINUTES);
                        out.put("places", places);
                        out.put("errors", errors);
                        out.put("calls", prefs().getInt(monthKey(), 0));
                    } catch (Exception e) {
                        try { out.put("places", places); out.put("errors", errors.put(String.valueOf(e))); } catch (Exception ignored) { }
                    }
                    js("window.onSearchResult&&onSearchResult(" + reqId + "," + out.toString() + ")");
                }
            }).start();
        }
    }
}
