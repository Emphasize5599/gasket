package com.bensanzone.fuelmap;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
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
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
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
    private static java.lang.ref.WeakReference<MainActivity> queueActivity=new java.lang.ref.WeakReference<>(null);
    public static void queueTimeout(){MainActivity a=queueActivity.get();if(a!=null)a.js("window.onTripQueueTimeout&&onTripQueueTimeout()");}
    private void handleQueueIntent(Intent i){
        if(i==null||!i.getBooleanExtra("tripQueueOpen",false))return;i.removeExtra("tripQueueOpen");
        String payload="{car:"+q(i.getStringExtra("queueCar"))+",trip:"+q(i.getStringExtra("queueTrip"))+",site:"+q(i.getStringExtra("queueSite"))+"}";
        String code="window.onTripQueueOpen?onTripQueueOpen("+payload+"):(window.__pendingQueueOpen="+payload+")";if(pageReady)js(code);else pendingQueue=code;
    }
    private static boolean isGasWorker(String key) { return key != null && key.matches("gasweb(?:[2-9]|[1-4][0-9]|50)?"); }
    private volatile int gasReaderRecycles = 0, gasRendererLosses = 0;

    private static final int REQ_LOC = 42, REQ_CAM = 43;
    private android.webkit.PermissionRequest camReq;   // the scanner's camera request, waiting for Android's prompt
    private static final String PREFS = "gasket";
    private static final String PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
    private static final String FIELD_MASK =
            "places.id,places.displayName,places.location,places.formattedAddress,"
            + "places.addressComponents,places.types,places.fuelOptions,places.businessStatus,places.googleMapsUri,places.websiteUri";

    private WebView web;
    private TextView startupText;
    private android.widget.LinearLayout startupLayout;
    private android.widget.ProgressBar startupSpinner;
    private long startupStarted, startupPrepared;
    // Aggregate only while AI is active. Frame timing is a diagnostic, not proof of visual corruption.
    private Window.OnFrameMetricsAvailableListener aiFrames;
    private long aiFrameCount, aiFrameSlow, aiFrameMax, aiFrameLost, aiFrameStarted;
    private String aiFrameBackend = "loading";
    private volatile boolean visualLogging = true;
    private android.os.HandlerThread frameThread;
    private final Object frameLock = new Object();
    private final long[] frameParts = new long[7];
    private boolean gpuTimingAvailable;
    private static final int[] FRAME_PART_IDS={android.view.FrameMetrics.DRAW_DURATION,android.view.FrameMetrics.SYNC_DURATION,android.view.FrameMetrics.COMMAND_ISSUE_DURATION,android.view.FrameMetrics.SWAP_BUFFERS_DURATION,android.view.FrameMetrics.GPU_DURATION,android.view.FrameMetrics.LAYOUT_MEASURE_DURATION,android.view.FrameMetrics.INPUT_HANDLING_DURATION};
    private long bucketFrames,bucketMax,bucketLost,bucketSlow,bucketStarted;
    private String framePhase="idle";
    private long frameGeneration;
    private long frameTickDue;
    private final Runnable frameTick = new Runnable(){public void run(){if(aiFrames==null||isDestroyed())return;emitFrameBucket("sample");frameTickDue=android.os.SystemClock.uptimeMillis()+5000;main.postDelayed(this,5000);}};
    private void emitFrameBucket(String reason){
        JSONObject stats=new JSONObject();
        synchronized(frameLock){try{
            long now=android.os.SystemClock.elapsedRealtime();stats.put("timestamp",System.currentTimeMillis());stats.put("monotonicMs",now);stats.put("phase",framePhase);stats.put("generationId",frameGeneration);stats.put("backend",aiFrameBackend);stats.put("reason",reason);
            stats.put("elapsedMs",now-bucketStarted);stats.put("frames",bucketFrames);stats.put("overDeadline",bucketSlow);stats.put("droppedMetricReports",bucketLost);stats.put("maxFrameMs",bucketMax/1e6);
            String[] names={"drawMaxMs","syncMaxMs","commandMaxMs","swapMaxMs","gpuMaxMs","layoutMaxMs","inputMaxMs"};for(int i=0;i<names.length;i++){stats.put(names[i],frameParts[i]/1e6);frameParts[i]=0;}stats.put("gpuTimingAvailable",gpuTimingAvailable);gpuTimingAvailable=false;
            stats.put("mainTimerLateMs",frameTickDue==0?0:Math.max(0,android.os.SystemClock.uptimeMillis()-frameTickDue));stats.put("windowFocus",hasWindowFocus());stats.put("hardwareAccelerated",web!=null&&web.isHardwareAccelerated());
            android.view.Display display=getWindowManager().getDefaultDisplay();stats.put("refreshHz",display.getRefreshRate());stats.put("displayState",display.getState());
            bucketFrames=bucketMax=bucketLost=bucketSlow=0;bucketStarted=now;
        }catch(Exception ignored){}}
        if(visualLogging)js("window.VisualDiagnostics&&VisualDiagnostics.nativeFrame("+stats.toString()+")");
    }
    private void aiStatusWithFrames(final JSONObject value) {
        main.post(() -> {
            if (isDestroyed()) return;
            if(value.optBoolean("diagnosticOnly")){js("window.onGemmaStatus&&onGemmaStatus("+value.toString()+")");return;}
            String phase = value.optString("phase"), task = value.optString("task");
            boolean active = visualLogging && "advice".equals(task) && ("load".equals(phase) || "generate".equals(phase) || "cancelling".equals(phase));
            if(aiFrames!=null&&(!phase.equals(framePhase)||value.optLong("generationId")!=frameGeneration))emitFrameBucket("phase_change");
            framePhase=phase;frameGeneration=value.optLong("generationId");
            if (active && aiFrames == null) {
                aiFrameCount = aiFrameSlow = aiFrameMax = aiFrameLost = 0;
                aiFrameStarted = android.os.SystemClock.elapsedRealtime(); aiFrameBackend = "loading";
                synchronized(frameLock){bucketStarted=aiFrameStarted;bucketFrames=bucketMax=bucketLost=bucketSlow=0;java.util.Arrays.fill(frameParts,0);}
                if(frameThread==null){frameThread=new android.os.HandlerThread("Gasket-frame-diagnostics",android.os.Process.THREAD_PRIORITY_BACKGROUND);frameThread.start();}
                aiFrames = (window, metrics, lost) -> {
                    if (metrics.getMetric(android.view.FrameMetrics.FIRST_DRAW_FRAME) == 1) return;
                    long ns = metrics.getMetric(android.view.FrameMetrics.TOTAL_DURATION);
                    long deadline = metrics.getMetric(android.view.FrameMetrics.DEADLINE);
                    synchronized(frameLock){if (ns >= 0) { aiFrameCount++; bucketFrames++;aiFrameMax = Math.max(aiFrameMax, ns);bucketMax=Math.max(bucketMax,ns);if (deadline > 0 && ns > deadline){aiFrameSlow++;bucketSlow++;} }
                    aiFrameLost += lost;bucketLost+=lost;
                    for(int i=0;i<FRAME_PART_IDS.length;i++)frameParts[i]=Math.max(frameParts[i],metrics.getMetric(FRAME_PART_IDS[i]));if(metrics.getMetric(android.view.FrameMetrics.GPU_DURATION)>=0)gpuTimingAvailable=true;}
                };
                getWindow().addOnFrameMetricsAvailableListener(aiFrames, new Handler(frameThread.getLooper()));
                frameTickDue=android.os.SystemClock.uptimeMillis()+5000;main.postDelayed(frameTick,5000);
            }
            if (active && value.has("backend")) aiFrameBackend = value.optString("backend");
            if (!active && aiFrames != null) {
                emitFrameBucket("finished");main.removeCallbacks(frameTick);
                getWindow().removeOnFrameMetricsAvailableListener(aiFrames); aiFrames = null;
                try {
                    JSONObject stats = new JSONObject(); stats.put("backend", aiFrameBackend);
                    stats.put("cpuOnly", value.optBoolean("cpuOnly")); stats.put("frames", aiFrameCount); stats.put("overDeadline", aiFrameSlow);
                    stats.put("maxFrameMs", Math.round(aiFrameMax / 10000.0) / 100.0); stats.put("droppedMetricReports", aiFrameLost);
                    stats.put("elapsedMs", android.os.SystemClock.elapsedRealtime() - aiFrameStarted);
                    stats.put("hardwareAccelerated", web != null && web.isHardwareAccelerated());
                    stats.put("device", android.os.Build.MODEL); stats.put("sdk", android.os.Build.VERSION.SDK_INT);
                    PackageInfo provider = WebView.getCurrentWebViewPackage(); if (provider != null) stats.put("webView", provider.versionName);
                    value.put("renderDiagnostics", stats);
                } catch (Exception ignored) { }
            }
            js("window.onGemmaStatus&&window.onGemmaStatus(" + value.toString() + ");");
        });
    }
    private GemmaService gemma;
    private synchronized GemmaService gemma() {
        if (gemma == null) gemma = new GemmaService(getApplicationContext(), new GemmaService.Listener() {
            public void status(JSONObject value) { aiStatusWithFrames(value); }
            public void result(int id, JSONObject value) { reply(id, value); }
        });
        gemma.setDiagnosticLogging(visualLogging);
        return gemma;
    }

    @Override protected void onDestroy() {
        main.removeCallbacks(frameTick);if(frameThread!=null)frameThread.quitSafely();
        if (aiFrames != null) { getWindow().removeOnFrameMetricsAvailableListener(aiFrames); aiFrames = null; }
        synchronized (this) { if (gemma != null) { gemma.close(); gemma = null; } }
        super.onDestroy();
    }
    private boolean rendererRecoveryPending = false;
    private void noteRendererExit(String scope, android.webkit.RenderProcessGoneDetail detail) {
        AiDiagnostics.rendererExit(getApplicationContext(), scope, detail.didCrash(), detail.rendererPriorityAtExit());
        synchronized (this) { if (gemma != null) gemma.rendererLost("app".equals(scope)); }
    }
    private void recoverRendererUi() {
        if (rendererRecoveryPending) return;
        rendererRecoveryPending = true;
        getIntent().putExtra("rendererRecovery", true);
        main.post(new Runnable() { public void run() { recreate(); } });
    }
    /** Off-screen pages on each chain's own site, used to read that chain's official prices
     *  (see assets/<key>_worker.js). Each runs the same requests the site's own store finder makes. */
    private FrameLayout root;
    private TextView wmDone;
    private volatile SiteWorker verifying = null;
    private final Map<String, SiteWorker> workers = new HashMap<String, SiteWorker>();
    private LocationManager lm;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<LocationListener> listeners = new ArrayList<LocationListener>();
    private Location best;
    private boolean pageReady = false;
    private String pendingInsets = null;
    private String pendingShare = null;
    private String pendingQueue = null;
    private JSONObject pendingQueueNotification;
    private void queueNotificationPermission(){
        if(android.os.Build.VERSION.SDK_INT>=33&&hasWindowFocus()&&checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=PackageManager.PERMISSION_GRANTED&&!prefs().getBoolean("queueNotificationAsked",false)){
            prefs().edit().putBoolean("queueNotificationAsked",true).apply();requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"},44);
        }
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        queueActivity=new java.lang.ref.WeakReference<>(this);
        startupStarted = android.os.SystemClock.elapsedRealtime();
        Window w = getWindow();
        // Edge-to-edge (enforced on Android 15+/16 anyway); the web UI pads itself with the real insets.
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        w.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);

        root = new FrameLayout(this);
        startupLayout=new android.widget.LinearLayout(this);
        startupLayout.setOrientation(android.widget.LinearLayout.VERTICAL);startupLayout.setGravity(Gravity.CENTER);
        int startupPad=(int)(24*getResources().getDisplayMetrics().density);startupLayout.setPadding(startupPad,startupPad,startupPad,startupPad);
        startupLayout.setBackgroundColor(isDark()?Color.rgb(16,18,22):Color.rgb(242,243,245));
        startupText = new TextView(this);
        startupText.setText("Gasket\n\nGetting ready…");
        startupText.setTextSize(22);startupText.setGravity(Gravity.CENTER);
        startupText.setTextColor(isDark() ? Color.rgb(128,178,255) : Color.rgb(11,95,217));
        startupText.setBackgroundColor(isDark() ? Color.rgb(16,18,22) : Color.rgb(242,243,245));
        startupLayout.addView(startupText,new android.widget.LinearLayout.LayoutParams(-1,-2));
        startupSpinner=new android.widget.ProgressBar(this);
        startupSpinner.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(isDark()?Color.rgb(128,178,255):Color.rgb(11,95,217)));
        int spinnerSize=(int)(32*getResources().getDisplayMetrics().density);
        android.widget.LinearLayout.LayoutParams spinnerParams=new android.widget.LinearLayout.LayoutParams(spinnerSize,spinnerSize);spinnerParams.topMargin=spinnerSize;
        startupLayout.addView(startupSpinner,spinnerParams);
        root.addView(startupLayout,new FrameLayout.LayoutParams(-1,-1));
        setContentView(root);
        applyBarIconColors();
        // Paint the native loading screen before migration and WebView creation.
        root.postOnAnimation(() -> root.post(() -> { if(!isFinishing()&&!isDestroyed())try{initializeApp();}catch(Exception e){android.util.Log.e("Gasket","Startup failed",e);if(startupSpinner!=null)startupSpinner.setVisibility(View.GONE);if(startupText!=null){startupText.setText("Gasket could not start.\n\nTap to retry.");startupText.setOnClickListener(v -> recreate());}} }));
    }

    private void initializeApp() {
        lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);

        migrateCarPictures();
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
        s.setMediaPlaybackRequiresUserGesture(false);   // the VIN scanner's camera preview starts after the permission prompt
        web.setWebChromeClient(new WebChromeClient() {
            // The VIN barcode scanner: video capture for the app's own page only (never a site, never the microphone),
            // after Android's camera permission
            @Override
            public void onPermissionRequest(final android.webkit.PermissionRequest r) {
                main.post(new Runnable() { public void run() {
                    boolean video = false;
                    for (String x : r.getResources()) if (android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(x)) video = true;
                    Uri o = r.getOrigin();
                    if (!video || o == null || !"file".equals(o.getScheme())) { r.deny(); return; }
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) { r.grant(new String[]{android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE}); return; }
                    if (camReq != null) camReq.deny();
                    camReq = r;
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAM);
                } });
            }
            @Override
            public void onPermissionRequestCanceled(android.webkit.PermissionRequest r) { if (camReq == r) camReq = null; }
        });
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
                for (String p : AI_FILES) if (u.startsWith(p) && "GET".equals(req.getMethod())) return aiFile(u);
                return null;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                if (pendingInsets != null) js(pendingInsets);
                if (pendingShare != null) { js(pendingShare); pendingShare = null; }
                if (pendingQueue != null) { js(pendingQueue); pendingQueue = null; }
            }
            @Override
            public boolean onRenderProcessGone(WebView gone, android.webkit.RenderProcessGoneDetail detail) {
                pageReady = false;
                noteRendererExit("app", detail);
                root.removeView(gone); gone.destroy();
                if (web == gone) web = null;
                recoverRendererUi();
                return true;
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

        workers.put("walmart", new SiteWorker("walmart", "https://www.walmart.com/store-finder", "https://www.walmart.com/"));
        workers.put("murphy", new SiteWorker("murphy", "https://service.murphydriverewards.com/mapmodule/", "https://service.murphydriverewards.com/"));
        workers.put("gmaps", new SiteWorker("gmaps", "https://www.google.com/maps", "https://www.google.com/", true));
        // Dedicated gas reader: never replaces an in-progress directions import.
        // Gas readers are created lazily for the configured pool, not at startup.
        // NHTSA's recall lookup by VIN: read in the background (siteRead), or shown to the user (siteShow)
        workers.put("nhtsa", new SiteWorker("nhtsa", "https://www.nhtsa.gov/recalls", "https://www.nhtsa.gov/"));
        // Tire Rack: a car's factory tire size, and the tires sold in that size (read in the background)
        workers.put("tirerack", new SiteWorker("tirerack", "https://www.tirerack.com/tires/brands", "https://www.tirerack.com/"));
        // Brave Search's AI answer: a car's fuel tank size (in the background, or shown to the user to finish it themselves)
        workers.put("brave", new SiteWorker("brave", "https://search.brave.com/", "https://search.brave.com/"));
        // Tesla's charger map: Supercharger prices it publishes signed out (read in the background, a few sites at a time)
        workers.put("tesla", new SiteWorker("tesla", "https://www.tesla.com/findus", "https://www.tesla.com/"));
        // ChargePoint's public station page: the price each station's host set (one station per read)
        workers.put("chargepoint", new SiteWorker("chargepoint", "https://driver.chargepoint.com/", "https://driver.chargepoint.com/"));
        for (SiteWorker sw : workers.values()) {
            // the hidden Google Maps page gets a desktop-sized window so it lays out like the desktop site
            if (sw.key.equals("gmaps") || isGasWorker(sw.key)) root.addView(sw.view, new FrameLayout.LayoutParams(1280, 900));
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
        if(startupLayout!=null)startupLayout.bringToFront();
        applyBarIconColors();
        boolean recoveringRenderer = getIntent().getBooleanExtra("rendererRecovery", false);
        getIntent().removeExtra("rendererRecovery");
        startupPrepared=android.os.SystemClock.elapsedRealtime()-startupStarted;
        web.loadUrl("file:///android_asset/web/index.html" + (recoveringRenderer ? "#restored" : ""));
        handleShare(getIntent());
        handleQueueIntent(getIntent());
    }

    private boolean isDark() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
    }

    private void applyBarIconColors() {
        int flags = getWindow().getDecorView().getSystemUiVisibility();
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

    private volatile String ua;

    /** How the app names itself to OpenStreetMap and other services (their usage policies ask apps to identify themselves). */
    private String userAgent() {
        if (ua == null) {
            String v = "?";
            try { v = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception ignored) { }
            ua = "Gasket/" + v + " (https://github.com/Emphasize5599/gasket; " + getPackageName() + ")";
        }
        return ua;
    }

    // ---------------- the recall-rating model (severity.js): downloaded once, kept on the phone ----------------
    /** Where the small model and its runtime come from; each file is downloaded the first time and served from the phone after. */
    /** Key/value namespaces kept in storage (they cost a Google lookup, they're your saved trips, or the recall model's setup); the rest are cache. */
    static final java.util.Set<String> KV_STORAGE = new java.util.HashSet<String>(java.util.Arrays.asList("trips", "find", "routes", "routes2", "along", "ai", "carpics", "gasmeta", "pricehistory", "tolls", "chargerusage"));

    /** Pictures are user data, including imported images. Upgrade the old cache without
     * overwriting a newer stored image or deleting the only copy if a move fails. */
    private synchronized void migrateCarPictures() {
        File oldDir = new File(getCacheDir(), "kv/carpics");
        File newDir = new File(getFilesDir(), "kv/carpics");
        File[] pictures = oldDir.listFiles();
        if (pictures == null || (!newDir.exists() && !newDir.mkdirs())) return;
        for (File old : pictures) {
            if (!old.isFile() || !old.getName().matches("[a-f0-9]{40}")) continue;
            File saved = new File(newDir, old.getName());
            if (saved.exists()) { old.delete(); continue; }
            if (old.renameTo(saved)) continue;
            File tmp = new File(newDir, old.getName() + ".migrating");
            try {
                java.io.FileInputStream in = new java.io.FileInputStream(old);
                java.io.FileOutputStream out = new java.io.FileOutputStream(tmp);
                try { byte[] buf = new byte[16384]; int n; while ((n = in.read(buf)) != -1) out.write(buf, 0, n); out.getFD().sync(); }
                finally { try { in.close(); } finally { out.close(); } }
                if (tmp.renameTo(saved)) old.delete();
            } catch (Exception ignored) { /* Keep the cache copy and retry next start/backup. */ }
            finally { tmp.delete(); }
        }
    }
    private static final String[] AI_FILES = { "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1/dist/",
            "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/" };

    private WebResourceResponse aiFile(String u) {
        try {
            // kept in the app's storage (a 46 MB download): "Clear cache" leaves it
            File dir = new File(getFilesDir(), "ai");
            dir.mkdirs();
            byte[] dg = MessageDigest.getInstance("SHA-1").digest(u.getBytes("UTF-8"));
            StringBuilder hx = new StringBuilder(); for (byte x : dg) hx.append(String.format("%02x", x & 0xff));
            File f = new File(dir, hx.toString());
            if (!f.exists() || f.length() == 0) {
                java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(u).openConnection();
                c.setConnectTimeout(15000); c.setReadTimeout(60000);
                int code = c.getResponseCode(), hops = 0;
                while ((code == 301 || code == 302 || code == 303 || code == 307 || code == 308) && hops++ < 5) {   // Hugging Face hands off to its file host
                    java.net.URL next = new java.net.URL(c.getURL(), c.getHeaderField("Location"));
                    c.disconnect();
                    if (!"https".equals(next.getProtocol())) return null;
                    c = (java.net.HttpURLConnection) next.openConnection(); c.setConnectTimeout(15000); c.setReadTimeout(60000);
                    code = c.getResponseCode();
                }
                if (code != 200) { c.disconnect(); return null; }
                File tmp = new File(dir, f.getName() + ".part");
                InputStream in = c.getInputStream(); java.io.FileOutputStream out = new java.io.FileOutputStream(tmp);
                byte[] buf = new byte[65536]; int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                out.close(); in.close(); c.disconnect();
                if (!tmp.renameTo(f)) return null;
            }
            String path = u.replaceAll("[?#].*$", "");
            String mime = path.endsWith(".wasm") ? "application/wasm" : path.endsWith(".js") || path.endsWith(".mjs") ? "text/javascript"
                    : path.endsWith(".json") ? "application/json" : "application/octet-stream";
            Map<String, String> h = new HashMap<String, String>();
            h.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse(mime, mime.startsWith("text") || mime.endsWith("json") ? "UTF-8" : null, 200, "OK", h, new java.io.FileInputStream(f));
        } catch (Exception e) {
            return null;   // the page tries the network itself
        }
    }

    private WebResourceResponse fetchTile(String u) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
            c.setUseCaches(true);
            c.setConnectTimeout(10000);
            c.setReadTimeout(15000);
            c.setRequestProperty("User-Agent", userAgent());
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
        WebView view;
        int completedReads = 0;
        boolean ready = false;
        final List<String> queue = new ArrayList<String>();

        int showReq = -1;   // set while the page is shown to the user by siteShow
        int readReq = -1;   // set while a page is read in the background by siteRead (answered once)
        String readCall = null;   // its reader: run on every load of the page (it may reload itself), once per load
        Runnable readDeadline = null;
        volatile boolean leanGasResources = true;
        boolean retriedGasResources = false;
        long gasReadStarted, gasRetryAt;
        String gasFirstStop = "";
        int gasFirstRows;
        JSONArray partialGasStores = null;
        String gasRequestedGrade = "regular";
        String verificationUrl = null;
        final java.util.concurrent.atomic.AtomicIntegerArray omittedGasResources = new java.util.concurrent.atomic.AtomicIntegerArray(4);

        void finishRead(int reqId, String json) {
            if (readReq != reqId) return;
            if (("chargepoint".equals(key) || "tesla".equals(key)) && view != null) {
                try { if (new JSONObject(json).optBoolean("blocked")) {
                    String at = view.getUrl(); if (at != null && at.startsWith(origin)) verificationUrl = at;
                } } catch (Exception ignored) { }
            }
            if (isGasWorker(key)) {
                try {
                    JSONObject answer = new JSONObject(json);
                    JSONArray stores = answer.optJSONArray("stores");
                    if(answer.optBoolean("blocked")&&view!=null){
                        String at=view.getUrl();
                        if(at!=null&&(at.startsWith("https://www.google.com/")||at.startsWith("https://consent.google.com/")))verificationUrl=at;
                    }
                    if (view != null && verifying != this && readCall != null
                            && GasReaderResources.retryFull(leanGasResources, answer.optBoolean("blocked"), answer.optBoolean("cancelled"), answer.optString("code"), stores == null ? 0 : stores.length())) {
                        String at = view.getUrl();
                        if (at != null && at.startsWith("https://www.google.com/maps/search/gas+stations/@")) {
                            // Same request, cookies and overall deadline; never retry restrictions or missing-grade prices.
                            partialGasStores = stores;
                            gasRetryAt = System.nanoTime() / 1000000L;
                            JSONObject firstDetail = answer.optJSONObject("detail");
                            gasFirstStop = firstDetail == null ? answer.optString("code") : firstDetail.optString("stopReason");
                            gasFirstRows = stores == null ? 0 : stores.length();
                            leanGasResources = false; retriedGasResources = true; ready = false;
                            view.stopLoading(); view.loadUrl(at); return;
                        }
                    }
                    JSONObject detail = answer.optJSONObject("detail");
                    if (detail == null) { detail = new JSONObject(); answer.put("detail", detail); }
                    if (partialGasStores != null && partialGasStores.length() > 0 && !answer.optBoolean("cancelled")) {
                        // Keep observations already obtained if recovery is restricted or has fewer results.
                        // Exact identity only; the newer record wins, including its price ambiguity checks.
                        Map<String,JSONObject> combined = new java.util.LinkedHashMap<String,JSONObject>();
                        for (JSONArray list : new JSONArray[] { partialGasStores, stores }) if (list != null) {
                            for (int i = 0; i < list.length(); i++) {
                                JSONObject station = list.optJSONObject(i); if (station == null) continue;
                                String identity = station.optString("featureId", station.optString("id"));
                                if (identity.length() > 0) combined.put(identity, station);
                            }
                        }
                        JSONArray merged = new JSONArray(); int priced = 0;
                        for (JSONObject station : combined.values()) {
                            merged.put(station); JSONObject prices = station.optJSONObject("prices");
                            JSONObject price = prices == null ? null : prices.optJSONObject(gasRequestedGrade);
                            if (price != null && price.optDouble("price", 0) > 0) priced++;
                        }
                        answer.put("stores", merged); detail.put("retainedPartialStores", partialGasStores.length());
                        detail.put("read", merged.length()); detail.put("priced", priced);
                    }
                    detail.put("leanResources", leanGasResources); detail.put("fullResourceRetry", retriedGasResources);
                    detail.put("retryElapsedMs", retriedGasResources ? Math.max(0, gasRetryAt - gasReadStarted) : 0);
                    detail.put("firstAttemptStopReason", gasFirstStop); detail.put("firstAttemptRows", gasFirstRows);
                    detail.put("omittedVisual", omittedGasResources.get(GasReaderResources.VISUAL));
                    detail.put("omittedGraphics", omittedGasResources.get(GasReaderResources.GRAPHICS));
                    detail.put("omittedTelemetry", omittedGasResources.get(GasReaderResources.TELEMETRY));
                    json = answer.toString();
                } catch (Exception ignored) { }
            }
            readReq = -1; readCall = null; partialGasStores = null;
            if (readDeadline != null) main.removeCallbacks(readDeadline);
            readDeadline = null;
            if (isGasWorker(key) && view != null && verifying != this) {
                view.stopLoading(); view.loadUrl("about:blank"); view.clearHistory(); ready = false;
                completedReads++;
                if (completedReads % 4 == 0) {
                    final SiteWorker old = this;
                    main.post(new Runnable() { public void run() {
                        if (old.readReq >= 0 || verifying == old || workers.get(old.key) != old || old.view == null) return;
                        // Only WebView RAM resource cache; never cookies, lookup answers or app storage.
                        gasReaderRecycles++;
                        root.removeView(old.view); old.view.destroy(); old.view = null;
                        // Recreate lazily for the next read; a paused lane must not retain a replacement WebView.
                    }});
                }
            }
            js("window.onNativeResult&&onNativeResult(" + reqId + ",JSON.parse(" + q(json) + "))");
        }

        SiteWorker(String key, String home, String origin) { this(key, home, origin, false); }

        SiteWorker(String key, String home, String origin, boolean desktop) {
            this.key = key; this.home = home; this.origin = origin;
            view = new WebView(MainActivity.this);
            WebSettings ws = view.getSettings();
            ws.setJavaScriptEnabled(true);
            ws.setDomStorageEnabled(true);
            if(isGasWorker(key)) {
                ws.setAllowFileAccess(false); ws.setAllowContentAccess(false);
                ws.setGeolocationEnabled(false); ws.setMediaPlaybackRequiresUserGesture(true);
                ws.setJavaScriptCanOpenWindowsAutomatically(false); ws.setSupportMultipleWindows(false);
            }
            // Station results/prices are text. Do not download map/photo tiles for invisible readers.
            if (isGasWorker(key)) ws.setBlockNetworkImage(true);
            if (desktop) {
                // Google Maps' desktop page is the one that spells out every stop's coordinates in its address
                ws.setUserAgentString("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36");
                ws.setUseWideViewPort(true);
                ws.setLoadWithOverviewMode(true);
            }
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);
            view.addJavascriptInterface(new SiteBridge(key), "GasketSite");
            view.setWebChromeClient(new WebChromeClient());
            view.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageCommitVisible(WebView v, String url) {
                    // a background read (siteRead) starts its reader as soon as the page is drawn: some pages (NHTSA's)
                    // keep loading in the background for a long time, and the reader waits for its answer by itself
                    if (verifying == SiteWorker.this || readReq < 0 || !url.startsWith(SiteWorker.this.origin) || !url.equals(v.getUrl())) return;
                    if (isGasWorker(key)) v.clearHistory();
                    runRead();
                }

                @Override
                public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                    // Keep page JS, CSS, DOM/storage, fetch/XHR and pagination intact.
                    // Visible human-verification pages retain all resources.
                    if(isGasWorker(key)) {
                        String host=String.valueOf(req.getUrl().getHost()).toLowerCase(Locale.US);
                        String path=String.valueOf(req.getUrl().getPath()).toLowerCase(Locale.US);
                        int omitted = GasReaderResources.omission(host,path,req.getMethod(),req.isForMainFrame(),verifying == SiteWorker.this,leanGasResources);
                        if (omitted != GasReaderResources.ALLOW) {
                            omittedGasResources.incrementAndGet(omitted);
                            WebResourceResponse empty = new WebResourceResponse(path.endsWith(".wasm") ? "application/wasm" : "text/plain","UTF-8",new java.io.ByteArrayInputStream(new byte[0]));
                            // These local omissions must not poison the shared HTTP cache used by normal pages/recovery.
                            empty.setResponseHeaders(java.util.Collections.singletonMap("Cache-Control", "no-store"));
                            return empty;
                        }
                    }
                    return null;
                }

                @Override
                public void onPageFinished(WebView v, String url) {
                    if (readReq >= 0 && !url.equals(v.getUrl())) return; // a callback from the page we just left
                    String title = String.valueOf(v.getTitle()).toLowerCase(Locale.US);
                    boolean blocked = url.contains("/blocked") || url.contains("/sorry/") || (isGasWorker(key) && url.startsWith("https://consent.google.")) || title.contains("robot") || title.contains("access denied")
                            || title.contains("captcha") || title.contains("unusual traffic");
                    ready = !blocked && url.startsWith(SiteWorker.this.origin);
                    if (verifying == SiteWorker.this && showReq >= 0) {
                        // a page the user is looking at (siteShow): run its reader on every load (the page may reload itself);
                        // the app takes the first answer, and Done clears it
                        if (url.startsWith(SiteWorker.this.origin)) for (String call : queue) view.evaluateJavascript(call, null);
                        return;
                    }
                    if (verifying == SiteWorker.this) {
                        if (ready) js("window.toast&&toast(" + q("Check passed. Tap Done.") + ")");
                        return;
                    }
                    // ChargePoint's same-origin interstitial can clear itself after loading.
                    // Its reader waits for a persistent visible challenge instead of prompting here.
                    if (readReq >= 0 && (!blocked || "chargepoint".equals(key)) && url.startsWith(SiteWorker.this.origin)) { runRead(); return; }
                    if (blocked) {
                        if (readReq >= 0) {
                            // a background read hit a check (a CAPTCHA page, Access Denied): never get past it, just say so
                            finishRead(readReq, "{\"blocked\":true,\"error\":\"Site access restricted\"}");
                        } else js("window.onSiteBlocked&&onSiteBlocked(" + q(SiteWorker.this.key) + ")");
                        queue.clear();
                    } else if (ready) {
                        runQueue();
                    }
                }

                @Override
                public void onReceivedError(WebView v, WebResourceRequest request, WebResourceError error) {
                    if (request.isForMainFrame() && readReq >= 0) {
                        finishRead(readReq, "{\"error\":\"Page could not load\",\"code\":\"network\"}");
                        ready = false;
                    }
                }

                @Override
                public void onReceivedHttpError(WebView v, WebResourceRequest request, WebResourceResponse response) {
                    // ChargePoint may draw only "Failed to load station details" when its data server
                    // returned a DataDome refusal. Do not mistake that for a missing device ID.
                    String host = String.valueOf(request.getUrl().getHost()).toLowerCase(Locale.US);
                    String path = String.valueOf(request.getUrl().getPath());
                    int dataStatus = response.getStatusCode();
                    if ("chargepoint".equals(key) && readReq >= 0 && (dataStatus == 403 || dataStatus == 429)
                            && (host.equals("chargepoint.com") || host.endsWith(".chargepoint.com"))
                            && path.matches(".*/v[23]/(?:station/.*|stations.*|map.*)")) {
                        // A data request can be retried by the SPA while it shows a spinner.
                        // Let the DOM reader distinguish recovery, a real visible challenge,
                        // and a persistent HTTP failure instead of opening verification early.
                        v.evaluateJavascript("window.__gasketChargePointHttpStatus=" + dataStatus + ";", null);
                        return;
                    }
                    if (!request.isForMainFrame() || readReq < 0) return;
                    int status = response.getStatusCode();
                    if ("chargepoint".equals(key) && (status == 403 || status == 429)) {
                        v.evaluateJavascript("window.__gasketChargePointHttpStatus=" + status + ";", null);
                        return;
                    }
                    if (status >= 400) {
                        finishRead(readReq, "{\"error\":\"HTTP " + status + "\",\"code\":\"http\",\"status\":" + status
                                + ",\"blocked\":" + (status == 403 || status == 429) + "}");
                        ready = false;
                    }
                }
                @Override
                public boolean onRenderProcessGone(WebView gone, android.webkit.RenderProcessGoneDetail detail) {
                    noteRendererExit(key, detail);
                    if (isGasWorker(key)) gasRendererLosses++;
                    root.removeView(gone); gone.destroy();
                    if (view == gone) view = null;
                    ready = false; queue.clear();
                    if (readReq >= 0) finishRead(readReq, "{\"cancelled\":true,\"code\":\"renderer\",\"error\":\"Website renderer stopped; completed prices were retained. Retry when ready.\"}");
                    if (verifying == SiteWorker.this) { verifying = null; recoverRendererUi(); }
                    return true;
                }
            });
        }

        /** A background read's reader, on the page as it is now (a page that reloads itself gets it again). */
        void runRead() {
            if (readCall == null || view == null) return;
            // The document guards by request ID. A previous request or a callback from the old document must not
            // consume the new request; a real page reload needs the reader again because its JS was destroyed.
            view.evaluateJavascript((isGasWorker(key) ? "window.__gasketLeanResources=" + leanGasResources + ";" : "") + readCall, null);
        }

        void runQueue() {
            if (view == null) return;
            for (String call : queue) view.evaluateJavascript(call, null);
            queue.clear();
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

    private SiteWorker ensureWorker(String key) {
        SiteWorker old = workers.get(key);
        if (old == null) {
            if (!isGasWorker(key)) return null;
            SiteWorker fresh = new SiteWorker(key, "https://www.google.com/maps", "https://www.google.com/", true);
            workers.put(key, fresh);
            root.addView(fresh.view, 0, new FrameLayout.LayoutParams(1280, 900));
            return fresh;
        }
        if (old.view != null) return old;
        boolean desktop = isGasWorker(key) || "gmaps".equals(key);
        SiteWorker fresh = new SiteWorker(key, old.home, old.origin, desktop);
        fresh.verificationUrl = old.verificationUrl;
        workers.put(key, fresh);
        root.addView(fresh.view, 0, new FrameLayout.LayoutParams(desktop ? 1280 : -1, desktop ? 900 : -1));
        return fresh;
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
            final int id = reqId; final String payload = json;
            main.post(new Runnable() {
                public void run() {
                    SiteWorker w = workers.get(key);
                    if (w != null && w.readReq == id) { w.finishRead(id, payload); return; }
                    if ("brave".equals(key) && w != null && verifying == w && w.showReq == id) {
                        // A human completed any check; the reader supplies the answer,
                        // then return automatically without requiring copying or Done.
                        w.showReq = -1; w.queue.clear();
                        js("window.onNativeResult&&onNativeResult(" + id + ",JSON.parse(" + q(payload) + "))");
                        endVerify();
                        return;
                    }
                    // Ignore late/duplicate background replies. Visible reads and price workers use onSiteResult.
                    if ("tirerack".equals(key) || isGasWorker(key) || (("nhtsa".equals(key) || "brave".equals(key)) && (w == null || w.showReq != id))) return;
                    js("window.onSiteResult&&onSiteResult(" + q(key) + "," + id + ",JSON.parse(" + q(payload) + "))");
                }
            });
        }
    }

    /**
     * A site's page shown to the user sits between the status bar and the Done button (with a gap above it), so the
     * page's own buttons (Brave's check, say) never end up under ours.
     */
    private void showMargins(SiteWorker w, boolean on) {
        ViewGroup.LayoutParams p = w.view.getLayoutParams();
        if (!(p instanceof FrameLayout.LayoutParams)) return;
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) p;
        float dens = getResources().getDisplayMetrics().density;
        lp.topMargin = on ? (int) (40 * dens) : 0;
        lp.bottomMargin = on ? (int) ((48 + 64 + 24) * dens) : 0;
        w.view.setLayoutParams(lp);
    }

    private void startVerify(SiteWorker w) {
        w.view.getSettings().setBlockNetworkImage(false);
        verifying = w;
        showMargins(w, true);
        w.view.loadUrl(w.verificationUrl != null ? w.verificationUrl : w.home);
        web.setVisibility(View.INVISIBLE);
        wmDone.setVisibility(View.VISIBLE);
        w.view.bringToFront();
        wmDone.bringToFront();
    }

    /** Show a site's page to the user, with the Done button, and run a reader script on it once it has loaded. */
    private void startShow(SiteWorker w, int reqId, String url, String call) {
        w.view.getSettings().setBlockNetworkImage(false);
        verifying = w;
        w.showReq = reqId;
        w.queue.clear();
        w.queue.add(call);
        showMargins(w, true);
        w.view.loadUrl(url);
        wmDone.setText("Done \u2014 back to Gasket");
        web.setVisibility(View.INVISIBLE);
        wmDone.setVisibility(View.VISIBLE);
        w.view.bringToFront();
        wmDone.bringToFront();
    }

    private void endVerify() {
        if (verifying != null && verifying.showReq >= 0) {
            // closed before (or after) the page answered: the app's call ends either way
            js("window.onNativeResult&&onNativeResult(" + verifying.showReq + ",{closed:true})");
            verifying.showReq = -1;
            verifying.queue.clear();
            wmDone.setText("Done \u2014 back to the map");
        }
        String key = verifying != null ? verifying.key : "";
        if (verifying != null) { verifying.verificationUrl=null;showMargins(verifying, false); if(isGasWorker(verifying.key))verifying.view.getSettings().setBlockNetworkImage(true); }
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
        if(web==null||startupText!=null){super.onBackPressed();return;}
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
        js("window.VisualDiagnostics&&VisualDiagnostics.lifecycle('native_pause')");
        stopLocation();
    }
    @Override protected void onResume(){super.onResume();js("window.VisualDiagnostics&&VisualDiagnostics.lifecycle('native_resume')");}
    @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);js("window.VisualDiagnostics&&VisualDiagnostics.lifecycle('native_focus_"+focus+"')");}

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
        if(code==44){if(pendingQueueNotification!=null&&android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission("android.permission.POST_NOTIFICATIONS")==PackageManager.PERMISSION_GRANTED){JSONObject p=pendingQueueNotification;TripQueueService.alert(this,p.optString("title"),p.optString("text"),p.optString("car"),p.optString("trip"),p.optString("site"));}pendingQueueNotification=null;return;}
        if (code == REQ_CAM) {
            android.webkit.PermissionRequest r = camReq; camReq = null;
            if (r == null) return;
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) r.grant(new String[]{android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else r.deny();   // the page says to allow it in settings or type the VIN
            return;
        }
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
            + "routes.legs.distanceMeters,routes.legs.duration,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction,"
            + "routes.travelAdvisory.tollInfo";
    private static final String ALONG_MASK = FIELD_MASK + ",routingSummaries,nextPageToken";

    private static String hereMonthKey() {
        return "hcalls_" + new SimpleDateFormat("yyyy-MM", Locale.US).format(new Date());
    }

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
    // hydrogen), NHTSA (VIN decoding, recalls), and the weather and air along a route (Open-Meteo, the National Weather Service)
    private static final String[] JSON_HOSTS = {"www.fueleconomy.gov", "fueleconomy.gov", "nominatim.openstreetmap.org", "overpass-api.de", "geo.dot.gov", "www.exxon.com",
            "developer.nlr.gov", "developer.nrel.gov", "vpic.nhtsa.dot.gov", "api.nhtsa.gov", "commons.wikimedia.org", "en.wikipedia.org",
            "api.open-meteo.com", "air-quality-api.open-meteo.com", "api.weather.gov",
            // EV networks' own published prices: IONNA's site list page, Blink's map service
            "www.ionna.com", "chargermap.blinknetwork.com", "apigw.blinknetwork.com",
            // Electric Era's drivers page reads this public site list (prices, ports, availability)
            "ocpi-http.app.electricera.tech"};

    // car pictures: NHTSA's vehicle photos, Wikimedia Commons photos (its thumbnails), Fuel API's (signed links that redirect to its CDN)
    private static final String[] PIC_HOSTS = {"static.nhtsa.gov", "upload.wikimedia.org", "thumb.wikimedia.org", "i.fuelapi.com"};

    // brand icons: Google's favicon service, or each brand's own site
    private static final String[] ICON_HOSTS = {"www.google.com", "icons.duckduckgo.com", "www.walmart.com", "www.murphyusa.com", "www.samsclub.com", "www.exxon.com", "www.mobil.com", "www.citgo.com"};

    private String getJson(String url) throws Exception {
        if (!hostAllowed(url, JSON_HOSTS)) throw new Exception("Host not allowed");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(20000);
        c.setRequestProperty("Accept", "application/json");
        // OpenStreetMap's usage policy asks apps to identify themselves
        c.setRequestProperty("User-Agent", userAgent());
        int st = c.getResponseCode();
        String body;
        if ("overpass-api.de".equals(new URL(url).getHost())) {
            // Bound shared-service responses before allocating a huge JSON string in the WebView.
            InputStream in = st >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in == null) { c.disconnect(); throw new Exception("HTTP " + st); }
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            try {
                byte[] buf = new byte[16384]; int n;
                while ((n = in.read(buf)) != -1) {
                    if (bytes.size() + n > 1000000) throw new Exception("Area response too large; search a smaller area");
                    bytes.write(buf, 0, n);
                }
                body = bytes.toString("UTF-8");
            } finally { try { in.close(); } finally { c.disconnect(); } }
        } else body = readAll(st >= 400 ? c.getErrorStream() : c.getInputStream());
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
        handleQueueIntent(i);
    }

    private static final int PICK_FILE = 4711, RESTORE_FILE = 4712, PICK_IMAGE = 4713;
    private int pickReq = -1, restoreReq = -1, imagePickReq = -1;

    // ---------------- full backup / restore (moving to a new install) ----------------
    // Everything the app keeps: every preference (settings incl. API keys, the map's last results, this month's lookup
    // counts), every saved answer and trip in files/kv/, and the debug log. Streamed, so big caches never sit in the WebView.
    private static final String[] BACKUP_FILES = {"debug-log.json"};
    private static final String COUNTER = "^[a-z]*calls_\\d{4}-\\d{2}$";

    private synchronized JSONObject writeBackup(String name) throws Exception {
        migrateCarPictures();
        File[] unmoved = new File(getCacheDir(), "kv/carpics").listFiles();
        if (unmoved != null) for (File f : unmoved) if (f.isFile() && f.getName().matches("[a-f0-9]{40}"))
            throw new Exception("Could not preserve all car pictures. Free some app storage and retry the backup.");
        android.content.ContentValues v = new android.content.ContentValues();
        v.put("_display_name", name.replaceAll("[^A-Za-z0-9._ -]", "_"));
        v.put("mime_type", name.endsWith(".gz") ? "application/gzip" : "application/json");
        v.put("relative_path", "Download/Gasket");
        Uri uri = getContentResolver().insert(Uri.parse("content://media/external/downloads"), v);
        if (uri == null) throw new Exception("couldn't create the file");
        OutputStream os = getContentResolver().openOutputStream(uri);
        if (name.endsWith(".gz")) os = BackupIO.compress(os);
        android.util.JsonWriter w = new android.util.JsonWriter(new java.io.BufferedWriter(new java.io.OutputStreamWriter(os, "UTF-8"), 65536));
        int nPrefs = 0, nKv = 0;
        w.beginObject();
        w.name("fullBackup").value(1);
        w.name("fromPackage").value(getPackageName());
        String ver = "?"; try { ver = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception ignored) { }
        w.name("appVersion").value(ver);
        w.name("created").value(System.currentTimeMillis());
        w.name("prefs").beginObject();
        for (Map.Entry<String, ?> e : prefs().getAll().entrySet()) {
            Object x = e.getValue(); if (x == null) continue;
            w.name(e.getKey()).beginObject();
            if (x instanceof Integer) { w.name("t").value("i"); w.name("v").value((Integer) x); }
            else if (x instanceof Long) { w.name("t").value("l"); w.name("v").value((Long) x); }
            else if (x instanceof Boolean) { w.name("t").value("b"); w.name("v").value((Boolean) x); }
            else if (x instanceof Float) { w.name("t").value("f"); w.name("v").value(((Float) x).doubleValue()); }
            else { w.name("t").value("s"); w.name("v").value(String.valueOf(x)); }
            w.endObject(); nPrefs++;
        }
        w.endObject();
        w.name("kv").beginObject();
        File[] nss = new File(getFilesDir(), "kv").listFiles();
        if (nss != null) for (File ns : nss) {
            if (!ns.isDirectory()) continue;
            w.name(ns.getName()).beginObject();
            File[] fs = ns.listFiles();
            if (fs != null) for (File f : fs) { if (!f.isFile() || f.getName().startsWith(".kv-")) continue; w.name(f.getName()).value(readAll(new java.io.FileInputStream(f))); nKv++; }
            w.endObject();
        }
        w.endObject();
        w.name("files").beginObject();
        for (String fn : BACKUP_FILES) {
            File f = new File(getFilesDir(), fn);
            if (f.isFile()) w.name(fn).value(readAll(new java.io.FileInputStream(f)));
        }
        w.endObject();
        w.endObject();
        w.close();
        JSONObject o = new JSONObject();
        o.put("path", "Downloads/Gasket/" + name); o.put("prefs", nPrefs); o.put("kv", nKv);
        return o;
    }

    /**
     * Replace this install's data with a backup. Backups from Fuel+ Map (fromPackage com.ben.gasmap) restore as-is:
     * same format, same files/kv/<namespace>/<sha1> layout. Lookup counts never go down: for each month the higher of the backup's
     * and this install's count is kept, so a restore can't hand you a fresh monthly cap.
     */
    private JSONObject readBackup(Uri uri) throws Exception {
        android.util.JsonReader r = new android.util.JsonReader(new java.io.BufferedReader(new java.io.InputStreamReader(BackupIO.open(getContentResolver().openInputStream(uri)), "UTF-8"), 65536));
        SharedPreferences p = prefs();
        Map<String, Object> before = new HashMap<String, Object>(p.getAll());
        java.util.Set<String> set = new java.util.HashSet<String>();
        SharedPreferences.Editor ed = null;
        boolean ok = false; int nPrefs = 0, nKv = 0; String from = "";
        r.beginObject();
        while (r.hasNext()) {
            String k = r.nextName();
            if ("fullBackup".equals(k)) { ok = r.nextInt() == 1; }
            else if ("fromPackage".equals(k)) { from = r.nextString(); }
            else if ("prefs".equals(k)) {
                if (!ok) throw new Exception("That isn't a full backup file.");
                ed = p.edit(); ed.clear();
                r.beginObject();
                while (r.hasNext()) {
                    String key = r.nextName(), t = "s", sv = null;
                    r.beginObject();
                    while (r.hasNext()) {
                        String f = r.nextName();
                        if ("t".equals(f)) t = r.nextString();
                        else if ("v".equals(f)) sv = r.peek() == android.util.JsonToken.BOOLEAN ? String.valueOf(r.nextBoolean()) : r.nextString();
                        else r.skipValue();
                    }
                    r.endObject();
                    if (sv == null) continue;
                    if ("i".equals(t)) {
                        int iv = (int) Double.parseDouble(sv);
                        if (key.matches(COUNTER) && before.get(key) instanceof Integer) iv = Math.max(iv, (Integer) before.get(key));
                        ed.putInt(key, iv);
                    }
                    else if ("l".equals(t)) ed.putLong(key, (long) Double.parseDouble(sv));
                    else if ("b".equals(t)) ed.putBoolean(key, Boolean.parseBoolean(sv));
                    else if ("f".equals(t)) ed.putFloat(key, (float) Double.parseDouble(sv));
                    else ed.putString(key, sv);
                    set.add(key); nPrefs++;
                }
                r.endObject();
                for (Map.Entry<String, Object> e : before.entrySet())       // counts the backup doesn't have stay as they are
                    if (!set.contains(e.getKey()) && e.getKey().matches(COUNTER) && e.getValue() instanceof Integer) ed.putInt(e.getKey(), (Integer) e.getValue());
            }
            else if ("kv".equals(k)) {
                if (!ok) throw new Exception("That isn't a full backup file.");
                File root = new File(getFilesDir(), "kv");
                r.beginObject();
                while (r.hasNext()) {
                    String ns = r.nextName().replaceAll("[^a-z0-9_-]", "_");
                    File dir = new File(root, ns);
                    if (!dir.exists()) dir.mkdirs();
                    File[] old = dir.listFiles(); if (old != null) for (File f : old) f.delete();
                    r.beginObject();
                    while (r.hasNext()) {
                        String fn = r.nextName().replaceAll("[^a-f0-9]", ""), body = r.nextString();
                        if (fn.isEmpty()) continue;
                        java.io.FileOutputStream o = new java.io.FileOutputStream(new File(dir, fn));
                        o.write(body.getBytes("UTF-8")); o.close(); nKv++;
                    }
                    r.endObject();
                }
                r.endObject();
            }
            else if ("files".equals(k)) {
                r.beginObject();
                while (r.hasNext()) {
                    String fn = r.nextName(), body = r.nextString();
                    if (java.util.Arrays.asList(BACKUP_FILES).contains(fn)) {
                        java.io.FileOutputStream o = openFileOutput(fn, MODE_PRIVATE);
                        o.write(body.getBytes("UTF-8")); o.close();
                    }
                }
                r.endObject();
            }
            else r.skipValue();
        }
        r.endObject(); r.close();
        if (!ok || ed == null) throw new Exception("That isn't a full backup file.");
        ed.commit();
        JSONObject o = new JSONObject();
        o.put("prefs", nPrefs); o.put("kv", nKv); o.put("from", from);
        return o;
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == RESTORE_FILE && restoreReq >= 0) {
            final int rq = restoreReq; restoreReq = -1;
            final Uri ru = result == RESULT_OK && data != null ? data.getData() : null;
            new Thread(new Runnable() {
                public void run() {
                    JSONObject o;
                    try { if (ru == null) { o = new JSONObject(); o.put("cancelled", true); } else o = readBackup(ru); }
                    catch (Exception e) { o = new JSONObject(); try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { } }
                    reply(rq, o);
                }
            }).start();
            return;
        }
        if (request == PICK_IMAGE && imagePickReq >= 0) {
            final int rq = imagePickReq; imagePickReq = -1;
            final Uri imageUri = result == RESULT_OK && data != null ? data.getData() : null;
            new Thread(new Runnable() {
                public void run() {
                    JSONObject o = new JSONObject();
                    try {
                        if (imageUri == null) o.put("cancelled", true);
                        else {
                            InputStream is = getContentResolver().openInputStream(imageUri);
                            ByteArrayOutputStream raw = new ByteArrayOutputStream();
                            byte[] buf = new byte[8192]; int n, total = 0;
                            while ((n = is.read(buf)) > 0) {
                                total += n;
                                if (total > 20 * 1024 * 1024) throw new Exception("Image file is too big (20 MB maximum)");
                                raw.write(buf, 0, n);
                            }
                            is.close();
                            byte[] bytes = raw.toByteArray();
                            android.graphics.BitmapFactory.Options bounds = new android.graphics.BitmapFactory.Options();
                            bounds.inJustDecodeBounds = true;
                            android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new Exception("That file is not a readable image");
                            int sample = 1;
                            while (Math.max(bounds.outWidth / sample, bounds.outHeight / sample) > 1024) sample *= 2;
                            android.graphics.BitmapFactory.Options opts = new android.graphics.BitmapFactory.Options();
                            opts.inSampleSize = sample;
                            android.graphics.Bitmap bm = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
                            if (bm == null) throw new Exception("Could not decode that image");
                            ByteArrayOutputStream compressed = new ByteArrayOutputStream();
                            bm.compress(android.graphics.Bitmap.CompressFormat.WEBP, 84, compressed);
                            bm.recycle();
                            o.put("dataUrl", "data:image/webp;base64," + android.util.Base64.encodeToString(compressed.toByteArray(), android.util.Base64.NO_WRAP));
                        }
                    } catch (Exception e) { try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { } }
                    reply(rq, o);
                }
            }).start();
            return;
        }
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
        @JavascriptInterface public void tripQueue(final int id,final String action,final String payload){main.post(()->{
            try{
                if(!java.util.Arrays.asList("start","progress","ready","check","finish","stop").contains(action))throw new IllegalArgumentException("Unknown queue action");
                JSONObject p=new JSONObject(payload);Intent i=new Intent(MainActivity.this,TripQueueService.class).putExtra("action",action);
                for(String k:new String[]{"title","text","car","trip","site"})i.putExtra(k,p.optString(k,""));
                if("ready".equals(action)||"check".equals(action)){
                    pendingQueueNotification=p;queueNotificationPermission();
                    TripQueueService.alert(MainActivity.this,p.optString("title"),p.optString("text"),p.optString("car"),p.optString("trip"),p.optString("site"));js("onNativeResult("+id+",{ok:true})");return;
                }
                if("start".equals(action)){
                    queueNotificationPermission();
                    startForegroundService(i);
                }else startService(i);
                js("onNativeResult("+id+",{ok:true,notifications:"+(android.os.Build.VERSION.SDK_INT<33||checkSelfPermission("android.permission.POST_NOTIFICATIONS")==PackageManager.PERMISSION_GRANTED)+"})");
            }catch(Exception e){js("onNativeResult("+id+",{error:"+q(e.getClass().getSimpleName())+"})");}
        });}
        @JavascriptInterface public void startupStage(final String text) { runOnUiThread(() -> { if(startupText!=null)startupText.setText("Gasket\n\n"+(text==null?"Getting ready…":text.substring(0,Math.min(160,text.length())))); }); }
        @JavascriptInterface public void startupReady(final String report) { runOnUiThread(() -> {
            if(startupLayout!=null){root.removeView(startupLayout);startupLayout=null;startupText=null;startupSpinner=null;}
            try { JSONObject timing=new JSONObject();timing.put("nativePrepareMs",startupPrepared);timing.put("totalMs",android.os.SystemClock.elapsedRealtime()-startupStarted);timing.put("web",new JSONObject(report));js("window.FLog&&FLog.info('startup','Native startup timings',"+timing.toString()+")"); } catch(Exception ignored) { }
        }); }
        @JavascriptInterface public String aiStatus() { return gemma().status().toString(); }
        @JavascriptInterface public void aiCommand(int reqId, String command) { gemma().command(reqId, command); }
        @JavascriptInterface public void aiGenerate(int reqId, String prompt) { gemma().generate(reqId, prompt); }
        @JavascriptInterface public void aiNotices(final int reqId) {
            new Thread(() -> {
                JSONObject value = new JSONObject();
                try (InputStream input = getAssets().open("runtime-notices.txt")) { value.put("body", readAll(input)); }
                catch (Exception failure) { try { value.put("error", "Runtime notices could not be read."); } catch (Exception ignored) { } }
                reply(reqId, value);
            }, "AI-license-notices").start();
        }
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
         * Saves a (possibly large) text file to Downloads/Gasket off the main thread, then offers it to other apps as a
         * file — not as pasted text, which makes the share sheet crawl on big reports. Replies {path} or {error}.
         */
        @JavascriptInterface
        public void saveAndShare(final int reqId, final String name, final String mime, final String text, final String subject) {
            new Thread(new Runnable() {
                public void run() {
                    final JSONObject o = new JSONObject();
                    Uri uri = null;
                    try {
                        String savedName = name.replaceAll("[^A-Za-z0-9._ -]", "_");
                        android.content.ContentValues v = new android.content.ContentValues();
                        v.put("_display_name", savedName);
                        v.put("mime_type", mime);
                        v.put("relative_path", "Download/Gasket");
                        uri = getContentResolver().insert(Uri.parse("content://media/external/downloads"), v);
                        if (uri == null) throw new Exception("couldn't create the file");
                        OutputStream os = getContentResolver().openOutputStream(uri);
                        os.write(text.getBytes("UTF-8"));
                        os.close();
                        o.put("path", "Downloads/Gasket/" + savedName);
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

        /** Saves a file to Downloads/Gasket (no storage permission needed on Android 10+). Returns where, or an error. */
        @JavascriptInterface
        public String saveDownload(String name, String mime, String text) {
            try {
                android.content.ContentValues v = new android.content.ContentValues();
                v.put("_display_name", name.replaceAll("[^A-Za-z0-9._ -]", "_"));
                v.put("mime_type", mime);
                v.put("relative_path", "Download/Gasket");
                Uri uri = getContentResolver().insert(Uri.parse("content://media/external/downloads"), v);
                if (uri == null) return "error: couldn't create the file";
                OutputStream os = getContentResolver().openOutputStream(uri);
                os.write(text.getBytes("UTF-8"));
                os.close();
                return "Downloads/Gasket/" + name;
            } catch (Exception e) {
                return "error: " + e.getMessage();
            }
        }

        /** Full backup (with API keys, caches, history and lookup counts) to Downloads/Gasket. Replies {path, prefs, kv} or {error}. */
        @JavascriptInterface
        public void backupAll(final int reqId, final String name) {
            new Thread(new Runnable() {
                public void run() {
                    JSONObject o;
                    try { o = writeBackup(name); }
                    catch (Exception e) { o = new JSONObject(); try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { } }
                    reply(reqId, o);
                }
            }).start();
        }

        /** Pick a full backup and replace this install's data with it. Replies {prefs, kv, from}, {cancelled} or {error}. */
        @JavascriptInterface
        public void pickAndRestore(final int reqId) {
            main.post(new Runnable() {
                public void run() {
                    restoreReq = reqId;
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    try { startActivityForResult(i, RESTORE_FILE); }
                    catch (Exception e) {
                        JSONObject o = new JSONObject();
                        try { o.put("error", "No file picker available"); } catch (Exception ignored) { }
                        reply(reqId, o); restoreReq = -1;
                    }
                }
            });
        }

        /** Opens Android's image picker and returns a compressed image data URL to the car selector. */
        @JavascriptInterface
        public void pickImageFile(final int reqId) {
            main.post(new Runnable() {
                public void run() {
                    imagePickReq = reqId;
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("image/*");
                    try { startActivityForResult(i, PICK_IMAGE); }
                    catch (Exception e) {
                        JSONObject o = new JSONObject();
                        try { o.put("error", "No image picker available"); } catch (Exception ignored) { }
                        reply(reqId, o); imagePickReq = -1;
                    }
                }
            });
        }

        /** Opens the system file picker for a Gasket data file to import (old Fuel+ exports work too); the text comes back via onNativeResult. */
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
        public String memoryInfo() {
            JSONObject result = new JSONObject();
            try {
                ActivityManager manager = (ActivityManager)getSystemService(Context.ACTIVITY_SERVICE);
                ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
                manager.getMemoryInfo(memory);
                result.put("totalMem", memory.totalMem); result.put("availMem", memory.availMem);
                result.put("lowMemory", memory.lowMemory || manager.isLowRamDevice());
                Runtime runtime = Runtime.getRuntime();
                // This is the app's Java heap, NOT WebView renderer memory or whole-process PSS.
                result.put("appHeapUsed", runtime.totalMemory() - runtime.freeMemory());
                result.put("appHeapMax", runtime.maxMemory());
                result.put("readerRecycles", gasReaderRecycles); result.put("rendererLosses", gasRendererLosses);
            } catch (Exception ignored) { }
            return result.toString();
        }

        @JavascriptInterface public void setVisualDiagnostics(final boolean enabled){main.post(()->{visualLogging=enabled;synchronized(MainActivity.this){if(gemma!=null)gemma.setDiagnosticLogging(enabled);}if(!enabled&&aiFrames!=null){getWindow().removeOnFrameMetricsAvailableListener(aiFrames);aiFrames=null;main.removeCallbacks(frameTick);}});}
        @JavascriptInterface public void visualSnapshot(final int reqId){
            main.post(()->{final JSONObject value=new JSONObject();try{
                value.put("timestamp",System.currentTimeMillis());value.put("windowFocus",hasWindowFocus());value.put("width",web==null?0:web.getWidth());value.put("height",web==null?0:web.getHeight());
                android.view.Display d=getWindowManager().getDefaultDisplay();value.put("refreshHz",d.getRefreshRate());value.put("rotation",d.getRotation());value.put("displayState",d.getState());
                value.put("hardwareAccelerated",web!=null&&web.isHardwareAccelerated());PackageInfo p=WebView.getCurrentWebViewPackage();if(p!=null)value.put("webView",p.versionName);
                value.put("osRelease",android.os.Build.VERSION.RELEASE);value.put("osIncremental",android.os.Build.VERSION.INCREMENTAL);value.put("securityPatch",android.os.Build.VERSION.SECURITY_PATCH);value.put("sdk",android.os.Build.VERSION.SDK_INT);
                if(aiFrames!=null)emitFrameBucket("user_marker");
            }catch(Exception ignored){}
            new Thread(()->{try{value.put("pssKb",android.os.Debug.getPss());value.put("memory",new JSONObject(memoryInfo()));android.os.PowerManager p=(android.os.PowerManager)getSystemService(POWER_SERVICE);value.put("thermalStatus",p.getCurrentThermalStatus());value.put("powerSave",p.isPowerSaveMode());
                synchronized(MainActivity.this){if(gemma!=null)value.put("ai",gemma.status());}
            }catch(Exception ignored){}reply(reqId,value);},"Gasket-visual-marker").start();});
        }

        @JavascriptInterface
        public void releaseGasReader(final String key) {
            if (!isGasWorker(key)) return;
            main.post(new Runnable() { public void run() {
                SiteWorker worker = workers.get(key);
                if (worker == null || worker.readReq >= 0 || verifying == worker || worker.view == null) return;
                worker.view.stopLoading(); root.removeView(worker.view); worker.view.destroy();
                worker.view = null; worker.ready = false;
            }});
        }

        @JavascriptInterface
        public void releaseGasReaders() {
            main.post(new Runnable() { public void run() {
                for (SiteWorker worker : workers.values()) {
                    if (!isGasWorker(worker.key) || worker.readReq >= 0 || verifying == worker || worker.view == null) continue;
                    worker.view.stopLoading(); root.removeView(worker.view); worker.view.destroy();
                    worker.view = null; worker.ready = false;
                }
            }});
        }

        @JavascriptInterface
        public int routeCallsThisMonth() { return prefs().getInt(routeMonthKey(), 0); }

        @JavascriptInterface
        public int hereCallsThisMonth() { return prefs().getInt(hereMonthKey(), 0); }

        /**
         * HERE Routing v8 toll prices for one route option (optional HERE key; Route compares toll and toll-free roads).
         * query = the request without the key (only HERE's own parameter characters); the key is added here, never in
         * a URL the page builds or logs. Each request is counted (it uses one HERE car route and one toll cost
         * transaction) and refused at the monthly cap, atomically, like the Routes cap.
         */
        @JavascriptInterface
        public void fetchHere(final int reqId, final String key, final String query, final int monthlyCap) {
            new Thread(new Runnable() {
                public void run() {
                    JSONObject o = new JSONObject();
                    try {
                        if (key == null || !key.matches("[A-Za-z0-9_\\-]{10,128}")) throw new Exception("That HERE key doesn't look right");
                        if (query == null || query.length() > 4000 || !query.matches("[A-Za-z0-9=&%,._!\\-]+")) throw new Exception("Bad HERE request");
                        synchronized (MainActivity.this) {
                            int used = prefs().getInt(hereMonthKey(), 0);
                            if (monthlyCap > 0 && used >= monthlyCap) {
                                o.put("error", "Monthly HERE toll lookup cap reached (" + used + "/" + monthlyCap + ").");
                                o.put("code", "here_cap"); reply(reqId, o); return;
                            }
                            if (!prefs().edit().putInt(hereMonthKey(), used + 1).commit()) throw new Exception("Could not save HERE usage; request stopped");
                        }
                        HttpURLConnection c = (HttpURLConnection) new URL("https://router.hereapi.com/v8/routes?" + query + "&apiKey=" + java.net.URLEncoder.encode(key, "UTF-8")).openConnection();
                        c.setConnectTimeout(15000); c.setReadTimeout(30000);
                        c.setRequestProperty("Accept", "application/json");
                        int st = c.getResponseCode();
                        String body = readAll(st >= 400 ? c.getErrorStream() : c.getInputStream());
                        if (st >= 400) { o.put("status", st); o.put("error", "HERE error " + st); }
                        o.put("body", body);
                    } catch (Exception e) { try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { } }
                    reply(reqId, o);
                }
            }).start();
        }

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
        public void fetchStationRoute(final int reqId, final String key, final String params) {
            new Thread(() -> {
                JSONObject out=new JSONObject();HttpURLConnection c=null;
                try {
                    if(key==null||!key.matches("[A-Za-z0-9_-]{1,128}")||params==null||params.length()>1000000||params.contains("api_key="))throw new Exception("Invalid station query");
                    c=(HttpURLConnection)new URL("https://developer.nlr.gov/api/alt-fuel-stations/v1/nearby-route.json").openConnection();
                    c.setInstanceFollowRedirects(false);c.setConnectTimeout(10000);c.setReadTimeout(30000);c.setRequestMethod("POST");c.setDoOutput(true);
                    c.setRequestProperty("Content-Type","application/x-www-form-urlencoded");c.setRequestProperty("Accept","application/json");c.setRequestProperty("User-Agent",userAgent());c.setRequestProperty("X-Api-Key",key);
                    byte[] body=params.getBytes("UTF-8");
                    try(java.io.OutputStream os=c.getOutputStream()){os.write(body);}
                    int status=c.getResponseCode();out.put("status",status);out.put("remaining",c.getHeaderField("X-RateLimit-Remaining"));out.put("limit",c.getHeaderField("X-RateLimit-Limit"));if(status!=200)throw new Exception("HTTP "+status);
                    try(InputStream in=c.getInputStream();java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream()){
                        byte[] buf=new byte[16384];int n;while((n=in.read(buf))!=-1){if(bytes.size()+n>12000000)throw new Exception("Station response too large");bytes.write(buf,0,n);}out.put("body",bytes.toString("UTF-8"));
                    }
                }catch(Exception e){try{out.put("error",e.getMessage());}catch(Exception ignored){}}finally{if(c!=null)c.disconnect();}
                reply(reqId,out);
            }).start();
        }

        private ChargerInventory inventory;
        private synchronized ChargerInventory inventory() {
            if(inventory==null)inventory=new ChargerInventory(getFilesDir());
            return inventory;
        }

        /** Fixed provider URLs and header-only credentials: never expose keys in URLs, logs or exports. */
        @JavascriptInterface
        public void chargerInventory(final int reqId, final String action, final String value) {
            final ChargerInventory selected=inventory();final long ticket=selected.generation();
            if("clear".equals(action)||"cancel".equals(action))selected.cancel();
            new Thread(() -> {
                JSONObject out;
                try {
                    ChargerInventory inv=selected;
                    if("download".equals(action))out=inv.download(value,userAgent(), count -> js("window.onNativeProgress&&onNativeProgress("+reqId+","+count+",0)"),ticket);
                    else if("query".equals(action))out=inv.query(value);
                    else if("cancel".equals(action))out=inv.status();
                    else if("clear".equals(action)){inv.clear();out=inv.status();}
                    else if("status".equals(action))out=inv.status();
                    else throw new Exception("Unknown inventory action");
                }catch(Exception e){out=new JSONObject();try{out=inventory().status();}catch(Exception ignored){}try{out.put("error",e.getMessage());}catch(Exception ignored){}}
                reply(reqId,out);
            }).start();
        }

        @JavascriptInterface
        public void fetchChargerApi(final int reqId, final String provider, final String key, final String params) {
            new Thread(() -> {
                JSONObject out=new JSONObject();HttpURLConnection c=null;
                try{
                    if(key==null||!key.matches("[A-Za-z0-9_-]{1,128}")||params==null||params.length()>60000||params.matches("(?is).*(?:^|&)(?:key|api_key)=.*"))throw new Exception("Invalid charger query");
                    String base;
                    if("ocm".equals(provider))base="https://api.openchargemap.io/v3/poi/?";
                    else throw new Exception("Unknown charger provider");
                    c=(HttpURLConnection)new URL(base+params).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(10000);c.setReadTimeout(30000);
                    c.setRequestProperty("X-API-Key",key);c.setRequestProperty("User-Agent",userAgent());c.setRequestProperty("Accept","application/json");
                    int status=c.getResponseCode();out.put("status",status);out.put("remaining",c.getHeaderField("X-RateLimit-Remaining"));out.put("limit",c.getHeaderField("X-RateLimit-Limit"));
                    if(status!=200)throw new Exception("HTTP "+status);
                    try(InputStream in=ChargerInventory.bounded(c.getInputStream(),12000000)){out.put("body",readAll(in));}
                }catch(Exception e){try{out.put("error",e.getMessage());}catch(Exception ignored){}}finally{if(c!=null)c.disconnect();}
                reply(reqId,out);
            }).start();
        }

        private EvAppClient evGuestClient;
        private synchronized EvAppClient evGuestClient() {
            if (evGuestClient == null) evGuestClient = new EvAppClient(MainActivity.this);
            return evGuestClient;
        }
        @JavascriptInterface
        public void evGuestConfig(final int reqId, final String args) {
            new Thread(() -> { JSONObject out;
                try { out = evGuestClient().configure(args); }
                catch (Exception e) { out = new JSONObject(); try { out.put("error", "Could not update private EV source settings"); } catch (Exception ignored) {} }
                reply(reqId, out);
            }).start();
        }
        @JavascriptInterface
        public void fetchEvGuest(final int reqId, final String source, final String action, final String args) {
            new Thread(() -> { JSONObject out;
                try { out = evGuestClient().request(source, action, args); }
                catch (Exception e) { out = new JSONObject(); try { out.put("error", "Guest EV source unavailable: " + (e.getMessage()!=null && e.getMessage().startsWith("Guest") ? "credentials required" : "request failed")); } catch (Exception ignored) {} }
                reply(reqId, out);
            }).start();
        }

        @JavascriptInterface
        public void fetchFlo(final int reqId, final String action, final String args) {
            new Thread(() -> {
                JSONObject out=new JSONObject(); HttpURLConnection c=null;
                try {
                    String url="https://emobility.flo.ca/v3.0/parks/",body=null;
                    if("near".equals(action)) {
                        JSONObject p=new JSONObject(args); double lat=p.getDouble("lat"),lng=p.getDouble("lng");
                        if(!Double.isFinite(lat)||!Double.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)throw new Exception("Invalid charger coordinates");
                        url+="nearest";
                        body=new JSONObject().put("geoCoordinates",new JSONObject().put("latitude",lat).put("longitude",lng))
                            .put("filter",new JSONObject().put("networkIds",new JSONArray("[1,6]")).put("connectors",JSONObject.NULL)
                                .put("levels",new JSONArray()).put("rates",new JSONArray()).put("statuses",new JSONArray())
                                .put("minChargingSpeed",JSONObject.NULL).put("maxChargingSpeed",JSONObject.NULL)).toString();
                    } else if("station".equals(action)&&args!=null&&args.matches("[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}"))url+="station/"+args;
                    else throw new Exception("Invalid FLO query");
                    c=(HttpURLConnection)new URL(url).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(8000);c.setReadTimeout(12000);
                    c.setRequestProperty("User-Agent",userAgent());c.setRequestProperty("Accept","application/json");
                    if(body!=null){c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json; charset=utf-8");
                        try(java.io.OutputStream os=c.getOutputStream()){os.write(body.getBytes("UTF-8"));}}
                    int status=c.getResponseCode();out.put("status",status);if(status==403||status==429)out.put("blocked",true);
                    if(status!=200)throw new Exception("HTTP "+status);
                    try(InputStream in=ChargerInventory.bounded(c.getInputStream(),512000)){out.put("body",readAll(in));}
                } catch(Exception e){try{out.put("error",e.getMessage());}catch(Exception ignored){}}finally{if(c!=null)c.disconnect();}
                reply(reqId,out);
            }).start();
        }

        // Francis Energy's signed-out finder map (Driivz): the page's own anonymous session cookie and CSRF token,
        // then only its two map queries (stations in a small box around a charger, one station's detail).
        private final Object fcnLock = new Object();
        private String fcnCookie = null, fcnCsrf = null;
        private long fcnAt = 0;
        private static final String FCN = "https://driver.francisenergy.com";
        private void fcnCookies(HttpURLConnection c) {
            java.util.List<String> set = c.getHeaderFields().get("Set-Cookie");
            if (set == null || set.isEmpty()) return;
            java.util.LinkedHashMap<String, String> jar = new java.util.LinkedHashMap<>();
            if (fcnCookie != null) for (String kv : fcnCookie.split("; ")) { int i = kv.indexOf('='); if (i > 0) jar.put(kv.substring(0, i), kv); }
            for (String h : set) { String kv = h.split(";", 2)[0].trim(); int i = kv.indexOf('='); if (i > 0) jar.put(kv.substring(0, i), kv); }
            fcnCookie = android.text.TextUtils.join("; ", jar.values());
        }
        private void fcnSession(boolean fresh) throws Exception {
            if (!fresh && fcnCsrf != null && System.currentTimeMillis() - fcnAt < 20 * 60000) return;
            fcnCookie = null; fcnCsrf = null;
            HttpURLConnection c = (HttpURLConnection) new URL(FCN + "/findCharger").openConnection();
            try {
                c.setInstanceFollowRedirects(false); c.setConnectTimeout(8000); c.setReadTimeout(12000);
                c.setRequestProperty("User-Agent", userAgent()); c.setRequestProperty("Accept", "text/html");
                int st = c.getResponseCode(); if (st != 200) throw new Exception("HTTP " + st);
                fcnCookies(c);
                String html; try (InputStream in = ChargerInventory.bounded(c.getInputStream(), 512000)) { html = readAll(in); }
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("name=\"_csrf\" content=\"([A-Za-z0-9-]{8,80})\"").matcher(html);
                if (!m.find()) throw new Exception("Francis Energy's map page changed");
                fcnCsrf = m.group(1); fcnAt = System.currentTimeMillis();
            } finally { c.disconnect(); }
        }

        @JavascriptInterface
        public void fetchFrancis(final int reqId, final String action, final String args) {
            new Thread(() -> {
                JSONObject out = new JSONObject();
                try {
                    String url, body = null;
                    if ("box".equals(action)) {
                        JSONObject p = new JSONObject(args); double lat = p.getDouble("lat"), lng = p.getDouble("lng"), d = 0.003;
                        if (!Double.isFinite(lat) || !Double.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Exception("Invalid charger coordinates");
                        url = FCN + "/stationFacade/findStationsInBounds";
                        body = new JSONObject().put("filterByIsManaged", true).put("filterByBounds", new JSONObject()
                            .put("northEastLat", lat + d).put("northEastLng", lng + d).put("southWestLat", lat - d).put("southWestLng", lng - d)).toString();
                    } else if ("station".equals(action) && args != null && args.matches("\\d{1,9}")) url = FCN + "/stationFacade/findStationById?stationId=" + args;
                    else throw new Exception("Invalid Francis Energy query");
                    synchronized (fcnLock) {
                        for (int attempt = 0; ; attempt++) {
                            fcnSession(attempt > 0);
                            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                            try {
                                c.setInstanceFollowRedirects(false); c.setConnectTimeout(8000); c.setReadTimeout(12000);
                                c.setRequestProperty("User-Agent", userAgent()); c.setRequestProperty("Accept", "application/json");
                                c.setRequestProperty("Cookie", fcnCookie == null ? "" : fcnCookie); c.setRequestProperty("X-CSRF-TOKEN", fcnCsrf);
                                c.setRequestProperty("X-APP-TYPE", "WEB"); c.setRequestProperty("X-JSON-TYPES", "None");
                                if (body != null) { c.setRequestMethod("POST"); c.setDoOutput(true); c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                                    try (java.io.OutputStream os = c.getOutputStream()) { os.write(body.getBytes("UTF-8")); } }
                                int status = c.getResponseCode(); out.put("status", status);
                                // an expired session answers 401/403: one fresh session, then a refusal is a refusal
                                if ((status == 401 || status == 403) && attempt == 0) continue;
                                if (status == 403 || status == 429) out.put("blocked", true);
                                if (status != 200) throw new Exception("HTTP " + status);
                                fcnCookies(c);
                                try (InputStream in = ChargerInventory.bounded(c.getInputStream(), 512000)) { out.put("body", readAll(in)); }
                                break;
                            } finally { c.disconnect(); }
                        }
                    }
                } catch (Exception e) { try { out.put("error", e.getMessage()); } catch (Exception ignored) { } }
                reply(reqId, out);
            }).start();
        }

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

        /** Fuel API (car pictures by trim and paint): path under /v1/json/, the owner's key sent as the Basic-auth user (never in the URL, never logged). */
        @JavascriptInterface
        public void fetchFuel(final int reqId, final String path, final String key) {
            new Thread(new Runnable() {
                public void run() {
                    JSONObject o = new JSONObject();
                    try {
                        if (path == null || path.startsWith("/") || path.contains("..") || path.contains("://")) throw new Exception("Bad path");
                        HttpURLConnection c = (HttpURLConnection) new URL("https://api.fuelapi.com/v1/json/" + path).openConnection();
                        c.setConnectTimeout(10000); c.setReadTimeout(20000);
                        c.setRequestProperty("Accept", "application/json");
                        c.setRequestProperty("Authorization", "Basic " + android.util.Base64.encodeToString((key + ":").getBytes("UTF-8"), android.util.Base64.NO_WRAP));
                        int st = c.getResponseCode();
                        String body = readAll(st >= 400 ? c.getErrorStream() : c.getInputStream());
                        if (st >= 400) o.put("status", st);
                        o.put("body", body);
                    } catch (Exception e) { try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { } }
                    reply(reqId, o);
                }
            }).start();
        }

        /** Downloads a selected Fuel API vehicle image into Downloads/Gasket for attaching to ChatGPT. Only approved car-picture hosts are accepted. */
        @JavascriptInterface
        public void saveCarImage(final int reqId, final String url, final String name) {
            new Thread(new Runnable() {
                public void run() {
                    JSONObject o = new JSONObject();
                    try {
                        if (!hostAllowed(url, PIC_HOSTS)) throw new Exception("Image host not allowed");
                        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                        c.setConnectTimeout(10000); c.setReadTimeout(30000); c.setInstanceFollowRedirects(true);
                        c.setRequestProperty("User-Agent", userAgent());
                        int code = c.getResponseCode();
                        if (code < 200 || code >= 300) throw new Exception("Image server returned HTTP " + code);
                        String mime = c.getContentType();
                        if (mime == null || !mime.toLowerCase(Locale.US).startsWith("image/")) throw new Exception("Fuel API link did not return an image");
                        String cleanMime = mime.split(";")[0].toLowerCase(Locale.US);
                        String ext = cleanMime.equals("image/png") ? ".png" : cleanMime.equals("image/webp") ? ".webp" : cleanMime.equals("image/jpeg") ? ".jpg" : cleanMime.equals("image/gif") ? ".gif" : ".img";
                        String baseName = name.replaceAll("[^A-Za-z0-9._ -]", "_").replaceFirst("(?i)\\.(webp|png|jpe?g|gif|img)$", "");
                        String savedName = baseName + ext;
                        android.content.ContentValues values = new android.content.ContentValues();
                        values.put("_display_name", savedName);
                        values.put("mime_type", cleanMime);
                        values.put("relative_path", "Download/Gasket");
                        Uri uri = getContentResolver().insert(Uri.parse("content://media/external/downloads"), values);
                        if (uri == null) throw new Exception("Could not create a file in Downloads/Gasket");
                        InputStream is = c.getInputStream();
                        OutputStream os = getContentResolver().openOutputStream(uri);
                        byte[] buf = new byte[8192]; int n, total = 0;
                        while ((n = is.read(buf)) > 0) {
                            total += n;
                            if (total > 20 * 1024 * 1024) throw new Exception("Image is too large (20 MB maximum)");
                            os.write(buf, 0, n);
                        }
                        is.close(); os.close(); c.disconnect();
                        o.put("path", "Downloads/Gasket/" + name);
                    } catch (Exception e) { try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { } }
                    reply(reqId, o);
                }
            }).start();
        }

        /** A car's picture (NHTSA's vehicle photo, a Wikimedia Commons photo, or Fuel API's in a paint color), shrunk to at most 640 px wide and handed back as a WebP data URL to keep. */
        @JavascriptInterface
        public void fetchImage(final int reqId, final String url) {
            new Thread(new Runnable() {
                public void run() {
                    JSONObject o = new JSONObject();
                    try {
                        if (!hostAllowed(url, PIC_HOSTS)) throw new Exception("Host not allowed");
                        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                        c.setConnectTimeout(8000); c.setReadTimeout(20000); c.setInstanceFollowRedirects(true);
                        c.setRequestProperty("User-Agent", userAgent());     // Wikimedia asks apps to say who they are
                        if (c.getResponseCode() >= 400) throw new Exception("HTTP " + c.getResponseCode());
                        InputStream is = c.getInputStream();
                        java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                        byte[] buf = new byte[8192]; int n;
                        while ((n = is.read(buf)) > 0) { bo.write(buf, 0, n); if (bo.size() > 6000000) throw new Exception("too big"); }
                        is.close();
                        byte[] data = bo.toByteArray();
                        android.graphics.Bitmap bm = android.graphics.BitmapFactory.decodeByteArray(data, 0, data.length);
                        if (bm == null) throw new Exception("not an image");
                        int w = bm.getWidth(), h = bm.getHeight();
                        if (w > 640) { float sc = 640f / w; bm = android.graphics.Bitmap.createScaledBitmap(bm, 640, Math.max(1, Math.round(h * sc)), true); }
                        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                        bm.compress(android.graphics.Bitmap.CompressFormat.WEBP, 82, out);
                        o.put("body", "data:image/webp;base64," + android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP));
                        o.put("w", bm.getWidth()); o.put("h", bm.getHeight());
                    } catch (Exception e) { try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { } }
                    reply(reqId, o);
                }
            }).start();
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
        public void computeRoute(final int reqId, final String apiKey, final String bodyJson, final int monthlyCap) {
            new Thread(new Runnable() {
                public void run() {
                    JSONObject o = new JSONObject();
                    try {
                        String body = new JSONObject(bodyJson).toString();
                        // Reserve atomically before sending: simultaneous legs/alternative rebuilds
                        // must not race past the separate Routes cap. Count attempts conservatively.
                        synchronized (MainActivity.this) {
                            int used=prefs().getInt(routeMonthKey(),0);
                            if(monthlyCap>0&&used>=monthlyCap){
                                o.put("error","Monthly Routes API cap reached ("+used+"/"+monthlyCap+"). Saved routes still work.");
                                o.put("code","route_cap");reply(reqId,o);return;
                            }
                            if(!prefs().edit().putInt(routeMonthKey(),used+1).commit())throw new Exception("Could not save Routes usage; request stopped");
                        }
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

        // ---- small key/value store (saved searches, speed limits, routes, saved trips) ----
        // What cost a Google lookup (Places searches, routes, stations along a route), your saved trips and the recall model's
        // setup stay in the app's storage; everything else can be fetched again, so it lives in the app's cache.
        private java.io.File kvDir(String ns, boolean storage) {
            return new java.io.File(new java.io.File(storage ? getFilesDir() : getCacheDir(), "kv"), ns.replaceAll("[^a-z0-9_-]", "_"));
        }
        private java.io.File kvFile(String ns, String key) throws Exception {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-1");
            byte[] h = md.digest(key.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte x : h) sb.append(String.format("%02x", x));
            boolean storage = KV_STORAGE.contains(ns);
            java.io.File dir = kvDir(ns, storage);
            if (!dir.exists()) dir.mkdirs();
            java.io.File f = new java.io.File(dir, sb.toString());
            if (!storage && !f.exists()) {                 // written by an older version, in storage: moved to the cache
                java.io.File old = new java.io.File(kvDir(ns, true), sb.toString());
                if (old.exists() && !old.renameTo(f)) old.delete();
            }
            return f;
        }

        @JavascriptInterface
        public String kvGet(String ns, String key) {
            try {
                java.io.File f = kvFile(ns, key);
                if (!f.exists()) return "";
                if("trips".equals(ns)&&key.startsWith("trip|")&&f.length()==0)js("window.FLog&&FLog.error('storage','Empty saved-trip record on disk')");
                return readAll(new java.io.FileInputStream(f));
            } catch (Exception e) { return ""; }
        }

        @JavascriptInterface
        public boolean kvPut(String ns, String key, String value) {
            synchronized (MainActivity.this) {
                long started=android.os.SystemClock.elapsedRealtime();
                try {
                    KVStore.write(kvFile(ns,key),value,"trips".equals(ns));
                    if("trips".equals(ns)&&key.startsWith("trip|"))js("window.FLog&&FLog.debug('storage','Saved-trip record persisted',{chars:"+value.length()+",ms:"+(android.os.SystemClock.elapsedRealtime()-started)+"})");
                    return true;
                }
                catch(Exception e) {
                    android.util.Log.e("GasketStorage","KV write failed: namespace="+ns+", chars="+(value==null?0:value.length())+", error="+e.getClass().getSimpleName());
                    js("window.FLog&&FLog.error('storage','Persistent write failed',{namespace:"+JSONObject.quote(ns)+",chars:"+(value==null?0:value.length())+",error:"+JSONObject.quote(e.getClass().getSimpleName())+"})");
                    return false;
                }
            }
        }

        @JavascriptInterface
        public int kvClear(String ns) {
            int n = 0;
            for (boolean storage : new boolean[] { true, false }) {
                java.io.File[] fs = kvDir(ns, storage).listFiles();
                if (fs != null) for (java.io.File f : fs) if (f.delete()) n++;
            }
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
                    SiteWorker w = ensureWorker(key);
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

        /** Read NHTSA's recall lookup for a VIN, or Tire Rack's tire pages, in the background, the way the price sites are read. The page does its own
         *  checks as in any browser; if it shows one (blocked), the reply says so and nothing more is tried. */
        @JavascriptInterface
        public void siteRead(final int reqId, final String key, final String argsJson) {
            main.post(new Runnable() {
                public void run() {
                    SiteWorker w = ensureWorker(key);
                    String script = w != null ? asset((isGasWorker(key) ? "gasweb" : key) + "_worker.js") : "";
                    if ("brave".equals(key) && script.length() > 0) script = "async function(reqId,args){\n" + asset("web/trims.js") + "\nreturn (" + script + ")(reqId,args);}";
                    // Reuse the exact application matcher, not a weaker price/coordinate heuristic.
                    if (isGasWorker(key) && script.length() > 0) script = "async function(reqId,args){\n" + asset("web/pricing.js") + "\n" + asset("web/keylessgas.js") + "\nreturn (" + script + ")(reqId,args);}";
                    String url;
                    try { url = new JSONObject(argsJson).optString("url", ""); } catch (Exception e) { url = ""; }
                    // only these pages may be read this way
                    boolean ok = ("nhtsa".equals(key) && url.startsWith("https://www.nhtsa.gov/recalls?vymm="))
                            || ("walmart".equals(key) && url.equals("https://www.walmart.com/store-finder"))
                            || ("murphy".equals(key) && url.equals("https://service.murphydriverewards.com/mapmodule/"))
                            || ("brave".equals(key) && (url.startsWith("https://search.brave.com/search?") || url.startsWith("https://search.brave.com/ask?")))
                            || ("tirerack".equals(key) && url.startsWith("https://www.tirerack.com/tires/"))
                            || ("tesla".equals(key) && url.equals("https://www.tesla.com/findus"))
                            || ("chargepoint".equals(key) && url.matches("https://driver\\.chargepoint\\.com/stations/[0-9]{4,12}"))
                            || (isGasWorker(key) && url.startsWith("https://www.google.com/maps/search/gas+stations/@"));
                    if (w == null || script.length() == 0 || !ok || verifying == w) {
                        js("window.onNativeResult&&onNativeResult(" + reqId + ",{error:'Not available.'})");
                        return;
                    }
                    if (w.readReq >= 0) w.finishRead(w.readReq, "{\"error\":\"Lookup replaced by another request\",\"code\":\"cancelled\"}");
                    w.readReq = reqId;
                    w.leanGasResources = true; w.retriedGasResources = false; w.partialGasStores = null;
                    w.gasReadStarted = System.nanoTime() / 1000000L; w.gasRetryAt = 0; w.gasFirstStop = ""; w.gasFirstRows = 0;
                    try { w.gasRequestedGrade = new JSONObject(argsJson).optString("grade", "regular"); } catch (Exception ignored) { w.gasRequestedGrade = "regular"; }
                    for (int i = 0; i < 4; i++) w.omittedGasResources.set(i, 0);
                    // once per page load (the page keeps a flag; a reload clears it and gets the reader again)
                    w.readCall = "if(window.__gasketRead!==" + reqId + "){window.__gasketRead=" + reqId + ";Promise.resolve((" + script + ")(" + reqId + "," + argsJson + ")).catch(function(){GasketSite.result(" + reqId + ",JSON.stringify({error:'Page reader failed',code:'reader'}));});}";
                    w.queue.clear();
                    // Picker steps share the same page and cookies. Reuse it instead of racing same-URL reload callbacks.
                    if ("tirerack".equals(key) && w.ready && url.equals(w.view.getUrl())) w.runRead();
                    else { w.ready = false; w.view.loadUrl(url); }
                    // and if the page never says it's drawn or finished, start the reader anyway after a few seconds
                    final SiteWorker fw = w; final int fr = reqId;
                    fw.readDeadline = new Runnable() {
                        public void run() {
                            if (fw.readReq != fr) return;
                            fw.finishRead(fr, "{\"error\":\"Site lookup timed out\",\"code\":\"timeout\"}");
                            fw.ready = false; if (fw.view != null) fw.view.stopLoading();
                        }
                    };
                    boolean discoveryRead = false;
                    try { discoveryRead = "discover".equals(new JSONObject(argsJson).optString("mode")); } catch (Exception ignored) { }
                    main.postDelayed(fw.readDeadline, "tirerack".equals(key) ? 75000 : isGasWorker(key) ? (discoveryRead ? 210000 : 40000) : 90000);
                    main.postDelayed(new Runnable() {
                        public void run() {
                            if (fw.view == null) return;
                            String at = fw.view.getUrl();
                            if (fw.readReq == fr && verifying != fw && at != null && at.startsWith(fw.origin)) fw.runRead();
                        }
                    }, 5000);
                }
            });
        }

        /** Cancel only price readers; late results are ignored by SiteBridge. */
        @JavascriptInterface
        public void cancelSiteRead(final String key) {
            main.post(new Runnable() { public void run() {
                SiteWorker w = workers.get(key);
                if (!(isGasWorker(key) || "walmart".equals(key) || "murphy".equals(key)) || w == null || w.view == null || w.readReq < 0) return;
                w.view.stopLoading();
                w.finishRead(w.readReq, "{\"cancelled\":true}");
                w.ready = false;
                // Destroy the old reader's document and timers, not just its navigation.
                w.view.loadUrl("about:blank");
            }});
        }

        /** Open a page for the user to see (NHTSA's recall lookup for a VIN) and read its answer; replies via onSiteResult. */
        @JavascriptInterface
        public void siteShow(final int reqId, final String key, final String argsJson) {
            main.post(new Runnable() {
                public void run() {
                    SiteWorker w = ensureWorker(key);
                    String script = w != null ? asset(key + "_worker.js") : "";
                    if ("brave".equals(key) && script.length() > 0) script = "async function(reqId,args){\n" + asset("web/trims.js") + "\nreturn (" + script + ")(reqId,args);}";
                    String url;
                    try { url = new JSONObject(argsJson).optString("url", ""); } catch (Exception e) { url = ""; }
                    // only NHTSA's recall page and Brave Search may be opened this way
                    boolean ok = ("nhtsa".equals(key) && url.startsWith("https://www.nhtsa.gov/recalls?vymm="))
                            || ("brave".equals(key) && (url.startsWith("https://search.brave.com/search?") || url.startsWith("https://search.brave.com/ask?")));
                    if (w == null || script.length() == 0 || !ok) {
                        js("window.onNativeResult&&onNativeResult(" + reqId + ",{error:'Not available.'})");
                        return;
                    }
                    if (verifying != null) endVerify();
                    startShow(w, reqId, url, "(" + script + ")(" + reqId + "," + argsJson + ")");
                }
            });
        }

        @JavascriptInterface
        public void siteVerify(final String key) {
            main.post(new Runnable() {
                public void run() {
                    SiteWorker w = ensureWorker(key);
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

        /** A light tick, for each step of the fuel gauge and the buffer / detour sliders (the only haptics for now). */
        @JavascriptInterface
        public void tick() {
            main.post(new Runnable() {
                public void run() { web.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK); }
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
