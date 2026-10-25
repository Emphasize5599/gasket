package com.bensanzone.fuelmap;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.HashMap;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Fixed guest endpoints only. No captured identities, embedded app credentials or arbitrary URLs/headers. */
final class EvAppClient {
    private final SharedPreferences prefs;
    private final HashMap<String, Long> next = new HashMap<>(), refused = new HashMap<>();
    private static final String ALIAS = "gasket-ev-guest-v1";
    // Public Firebase project identifier, not an identity/session token. Guest identities are created per device.
    private static final String EVGO_FIREBASE_CLIENT = "AIzaSyB3lt9BT-8YCybXkXuMmL9MXV9zc3823tc";
    EvAppClient(Context context) { prefs = context.getSharedPreferences("ev-guest-private", Context.MODE_PRIVATE); }
    private JSONObject bootstrap(JSONObject s) throws Exception {
        // Owner explicitly approved packaging shared app-client credentials (2026-10-23).
        // Inspectable client configuration, NOT captured anonymous identity or refresh tokens.
        // Optional access does not confer provider licensing permission.
        if (!s.has("evgoApiKey")) s.put("evgoApiKey", EVGO_FIREBASE_CLIENT);
        if (!s.has("chargewayApiKey")) s.put("chargewayApiKey", "AIzaSyDmxuocAy8sdB-fkCTOzjQYjzAn0Z-pJps");
        if (!s.has("chargewayApiToken")) s.put("chargewayApiToken", "6a6fd29c-364a-4332-8119-9b427658910b");
        if (!s.has("plugshareBasic")) s.put("plugshareBasic", Base64.encodeToString("android:zuckerberg".getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP));
        return s;
    }
    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if (!ks.containsAlias(ALIAS)) {
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()); kg.generateKey();
        }
        return (SecretKey)ks.getKey(ALIAS, null);
    }
    private JSONObject secrets() throws Exception {
        String s = prefs.getString("secrets", ""); if (s.isEmpty()) return bootstrap(new JSONObject());
        String[] p = s.split(":"); Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(p[0], Base64.NO_WRAP)));
        return bootstrap(new JSONObject(new String(c.doFinal(Base64.decode(p[1], Base64.NO_WRAP)), StandardCharsets.UTF_8)));
    }
    private void store(JSONObject value) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key());
        String s = Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(c.doFinal(value.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!prefs.edit().putString("secrets", s).commit()) throw new Exception("Could not save private credentials");
    }
    synchronized void clear() { prefs.edit().clear().commit(); next.clear(); refused.clear(); }
    synchronized JSONObject configure(String args) throws Exception {
        JSONObject a = new JSONObject(args);
        if (a.optBoolean("clear")) { clear(); return status(); }
        JSONObject s = secrets();
        if (a.has("credentials")) {
            JSONObject input = a.getJSONObject("credentials");
            for (String k : new String[]{"evgoApiKey", "chargewayApiKey", "chargewayApiToken", "plugshareBasic"}) {
                if (input.has(k)) {
                    String v = input.getString(k); if (v.length() > 1024 || v.contains("\n") || v.contains("\r")) throw new Exception("Invalid credential format");
                    s.put(k, v); s.remove(k.startsWith("evgo") ? "evgoAuth" : "chargewayAuth");
                }
            }
            store(s);
        }
        if (a.has("enabled")) {
            boolean enabled = a.getBoolean("enabled");
            if (!enabled) { s.remove("evgoAuth"); s.remove("chargewayAuth"); store(s); }
            prefs.edit().putBoolean("enabled", enabled).commit();
        }
        return status();
    }
    private JSONObject status() throws Exception {
        JSONObject s = secrets(); return new JSONObject().put("enabled", prefs.getBoolean("enabled", false))
            .put("evgo", !s.optString("evgoApiKey").isEmpty())
            .put("chargeway", !s.optString("chargewayApiKey").isEmpty() && !s.optString("chargewayApiToken").isEmpty())
            .put("plugshare", !s.optString("plugshareBasic").isEmpty());
    }
    private String id(JSONObject a) throws Exception { String id = a.getString("id"); if (!id.matches("[A-Za-z0-9_-]{1,80}")) throw new Exception("Invalid station identifier"); return id; }
    private double coord(JSONObject a, String k, double limit) throws Exception { double n=a.getDouble(k); if (!Double.isFinite(n)||Math.abs(n)>limit) throw new Exception("Invalid charger coordinates"); return n; }
    private String encode(String s) throws Exception { return URLEncoder.encode(s,"UTF-8"); }
    private JSONObject http(String source, String url, String body, String type, String bearer, String headerKey, String headerValue) throws Exception {
        long now=System.currentTimeMillis(); if (refused.getOrDefault(source,0L)>now) return new JSONObject().put("paused",true).put("blocked",true).put("error","Source is cooling down after a refusal");
        long wait=next.getOrDefault(source,0L)-now; if(wait>0)Thread.sleep(Math.min(wait,2000)); next.put(source,System.currentTimeMillis()+1100);
        HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection();
        try {
            c.setInstanceFollowRedirects(false); c.setConnectTimeout(8000); c.setReadTimeout(15000);
            c.setRequestProperty("Accept","application/json"); c.setRequestProperty("User-Agent","Gasket EV guest reader");
            if(bearer!=null)c.setRequestProperty("Authorization",bearer);
            if(headerKey!=null)c.setRequestProperty(headerKey,headerValue);
            if(body!=null){c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type",type);try(java.io.OutputStream out=c.getOutputStream()){out.write(body.getBytes(StandardCharsets.UTF_8));}}
            int code=c.getResponseCode(); JSONObject out=new JSONObject().put("status",code);
            if(code==403||code==418||code==429){long seconds=900;try{seconds=Math.max(60,Math.min(86400,Long.parseLong(c.getHeaderField("Retry-After"))));}catch(Exception ignored){}
                refused.put(source,System.currentTimeMillis()+seconds*1000);return out.put("blocked",true).put("error","Provider refused access; source paused");}
            if(code!=200)return out.put("error","HTTP "+code);
            try(java.io.InputStream in=ChargerInventory.bounded(c.getInputStream(),2000000);java.io.ByteArrayOutputStream b=new java.io.ByteArrayOutputStream()){
                byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1)b.write(buf,0,n);return out.put("body",new String(b.toByteArray(),StandardCharsets.UTF_8));}
        }finally{c.disconnect();}
    }
    private String token(String source, JSONObject s, boolean renew) throws Exception {
        JSONObject auth=s.optJSONObject(source+"Auth"); long now=System.currentTimeMillis();
        if(renew&&(auth==null||auth.optString("refresh").isEmpty()))throw new Exception("No refresh token; anonymous identity will not be replaced automatically");
        if(!renew&&auth!=null&&auth.optLong("until")>now+120000)return auth.getString("id");
        String api=s.optString(source+"ApiKey");if(api.isEmpty())throw new Exception("Guest source credentials are not configured");
        boolean refresh=auth!=null&&!auth.optString("refresh").isEmpty();
        String url=refresh?"https://securetoken.googleapis.com/v1/token?key=":"https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=";
        JSONObject r=http(source,url+encode(api),refresh?"grant_type=refresh_token&refresh_token="+encode(auth.getString("refresh")):"{\"returnSecureToken\":true}",refresh?"application/x-www-form-urlencoded":"application/json",null,null,null);
        if(r.has("error"))throw new Exception("Anonymous authentication failed; no automatic identity replacement");
        JSONObject j=new JSONObject(r.getString("body"));
        auth=new JSONObject().put("id",j.getString(refresh?"id_token":"idToken")).put("refresh",j.getString(refresh?"refresh_token":"refreshToken"))
            .put("until",now+Math.min(86400,j.getLong(refresh?"expires_in":"expiresIn"))*1000);
        s.put(source+"Auth",auth);store(s);return auth.getString("id");
    }
    private static boolean authenticationFailure(JSONObject out) {
        if(out.optBoolean("blocked"))return false;
        if(out.optInt("status")==401)return true;
        if(out.optInt("status")!=200)return false;
        try {
            JSONArray errors=new JSONObject(out.optString("body")).optJSONArray("errors");
            if(errors==null)return false;
            for(int i=0;i<errors.length();i++) {
                JSONObject e=errors.optJSONObject(i);if(e==null)continue;JSONObject ext=e.optJSONObject("extensions");
                String message=(e.optString("message")+" "+(ext==null?"":ext.optString("code"))).toLowerCase(java.util.Locale.ROOT).replaceAll("[ _-]","");
                if(message.contains("notauthorized")||message.contains("unauthenticated")||message.contains("tokenexpired")||message.contains("jwtexpired")||message.contains("invalidtoken"))return true;
            }
        }catch(Exception ignored){}
        return false;
    }
    // What a GraphQL source said when it refused: message, code, service and the refused field path. Server text
    // only, trimmed and with anything token-like removed: never the request, the token or the rest of the body.
    private static JSONArray gqlErrors(JSONObject out) {
        JSONArray list=new JSONArray();
        try {
            JSONArray errors=new JSONObject(out.optString("body")).optJSONArray("errors");
            for(int i=0;errors!=null&&i<errors.length()&&i<4;i++) {
                JSONObject e=errors.optJSONObject(i);if(e==null)continue;JSONObject ext=e.optJSONObject("extensions");JSONArray path=e.optJSONArray("path");
                String message=e.optString("message").replaceAll("[A-Za-z0-9_\\-.]{32,}","[redacted]");if(message.length()>120)message=message.substring(0,120);
                list.put(new JSONObject().put("message",message).put("code",ext==null?"":ext.optString("code")).put("service",ext==null?"":ext.optString("service")).put("path",path==null?"":path.join(".")));
            }
        }catch(Exception ignored){}
        return list;
    }
    synchronized JSONObject request(String source,String action,String args) throws Exception {
        if(!prefs.getBoolean("enabled",false))throw new Exception("Guest-app add-on is disabled");
        JSONObject a=new JSONObject(args),s=secrets();String url,body=null,type="application/json",bearer=null,hk=null,hv=null;
        if(source.equals("ea")) {
            url="https://msp.electrifyamerica.com/public/locations";
            if(action.equals("near")){double lat=coord(a,"lat",89.99),lng=coord(a,"lng",179.99);url+="?swLong="+(lng-.004)+"&swLat="+(lat-.004)+"&neLong="+(lng+.004)+"&neLat="+(lat+.004)+"&lat="+lat+"&long="+lng+"&comingSoon=false&unit=IMPERIAL";}
            else if(action.equals("detail"))url+="/"+id(a);else throw new Exception("Unsupported EA action");
        } else if(source.equals("chargepoint")) {
            if(!action.equals("detail"))throw new Exception("Unsupported ChargePoint action");
            JSONArray ids=a.getJSONArray("ids");if(ids.length()<1||ids.length()>32)throw new Exception("Invalid station batch");
            JSONArray numericIds=new JSONArray();for(int i=0;i<ids.length();i++){if(!ids.getString(i).matches("[0-9]{1,12}"))throw new Exception("Invalid ChargePoint identifier");numericIds.put(Long.parseLong(ids.getString(i)));}
            url="https://internal-api-us.chargepoint.com/driver-bff/v3/station-detail-list";
            body=new JSONObject().put("station_ids",numericIds).put("use_cache",false).put("user_id","").toString();
        } else if(source.equals("chargeway")) {
            if(s.optString("chargewayApiToken").isEmpty())throw new Exception("Chargeway credentials are not configured");
            url="https://api.chargeway.net/mobile/stations/";
            if(action.equals("near")){double lat=coord(a,"lat",89.99),lng=coord(a,"lng",179.99);url+="search";
                body=new JSONObject().put("location",new JSONObject().put("rectangle",new JSONObject()
                    .put("southwest_corner",new JSONObject().put("latitude",lat-.003).put("longitude",lng-.003))
                    .put("northeast_corner",new JSONObject().put("latitude",lat+.003).put("longitude",lng+.003))))
                    .put("include_restricted",false).put("include_coming_soon",false).put("include_offline",true).toString();
            }else if(action.equals("price"))url+=id(a)+"/pricing";else throw new Exception("Unsupported Chargeway action");
            bearer="Bearer "+token(source,s,false);hk="x-api-token";hv=s.getString("chargewayApiToken");
        } else if(source.equals("plugshare")) {
            String credential=s.optString("plugshareBasic");if(credential.isEmpty())throw new Exception("PlugShare credentials are not configured");
            if(action.equals("detail"))url="https://api.plugshare.com/v3/locations/"+id(a)+"?minimal=0";
            else if(action.equals("near")){double lat=coord(a,"lat",89.99),lng=coord(a,"lng",179.99);
                url="https://api.plugshare.com/v3/locations/region?minimal=1&latitude="+lat+"&longitude="+lng+"&spanLat=0.006&spanLng=0.006&count=100&access=1";}
            else throw new Exception("Unsupported PlugShare action");bearer="Basic "+credential;
        } else if(source.equals("evgo")) {
            url="https://api.prod.evgo.com/";String query;JSONObject vars=new JSONObject();
            if(action.equals("near")){
                double lat=coord(a,"lat",90),lng=coord(a,"lng",180);
                query="query GetEvgoSitesForMobile($input: EvgoSitesForMobileInput!) { getEvgoSitesForMobile(input: $input) { edges { altId access address1 latitude longitude networkName displayName siteStatus } } }";
                vars.put("input",new JSONObject().put("distance",1).put("latitude",lat).put("longitude",lng).put("outputKwMin",0).put("outputKwMax",1000).put("plugAndCharge",false).put("vehicleConnectorIds",new JSONArray("[1,2,3,5]")));
            }else if(action.equals("site")){
                query="query GetSingleSite($altId: ID!, $latitude: Float!, $longitude: Float!) { siteForMobile(input:{altId:$altId latitude:$latitude longitude:$longitude}) { altId access latitude longitude timeZone chargers { altId chargerType maxConnectorPower evses { connectors { altId connectorType maxPower } } } } }";
                vars.put("altId",id(a)).put("latitude",coord(a,"lat",90)).put("longitude",coord(a,"lng",180));
            }else if(action.equals("price")){
                query="query getChargerPricingForMobile($chargerId: ID!) { getChargerPricingForMobile(input:{chargerId:$chargerId}) { chargerType maxSessionFee connectorsPrice { altText vehicleConnectorId kwhFee minuteFee } touPricing { name order price priceUnit schedule } } }";
                vars.put("chargerId",id(a));
            }else throw new Exception("Unsupported EVgo action");
            body=new JSONObject().put("query",query).put("variables",vars).toString();bearer="Bearer "+token(source,s,false);
        } else throw new Exception("Unsupported guest source");
        JSONObject out=http(source,url,body,type,bearer,hk,hv);
        if((source.equals("evgo")||source.equals("chargeway"))&&out.optInt("status")==200&&gqlErrors(out).length()>0)out.put("gqlErrors",gqlErrors(out));
        if((source.equals("evgo")||source.equals("chargeway"))&&authenticationFailure(out)) {
            try {
                out=http(source,url,body,type,"Bearer "+token(source,s,true),hk,hv);
                out.put("authRefreshed",true);
                if(authenticationFailure(out)) {
                    // EVgo answers its station-detail query with "Not Authorized" for every guest identity, even a fresh
                    // one asking only for the site's ID (checked 2026-10-25), while its nearby-sites query works: that's a
                    // guest permission, not an expired token, so the refresh can't help. Pause a day, not 15 minutes.
                    boolean guest=source.equals("evgo")&&action.equals("site");
                    refused.put(source,System.currentTimeMillis()+(guest?86400000L:900000L));
                    out.put("authDenied",true).put("blocked",true).put("scope",action).put("gqlErrors",gqlErrors(out)).put("guestNotPermitted",guest)
                        .put("error",guest?"EVgo doesn't let guest accounts read station details; source paused for a day":"Guest access denied after one token refresh; source paused");
                    out.remove("body");
                }
            }catch(Exception e) {
                refused.put(source,System.currentTimeMillis()+60000);
                out=new JSONObject().put("authRefreshFailed",true).put("blocked",true).put("error","Token refresh failed; source paused without creating a replacement identity");
            }
        }
        return out;
    }
}
