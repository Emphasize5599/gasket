package com.bensanzone.fuelmap;

import org.json.JSONObject;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.List;
import java.util.Map;

/** Small, fixed-endpoint transport for the researched signed-out weather sources. */
final class RestWeatherHttp {
    /** Weather Underground Android app's static client key (owner-authorized, extractable; COMPLIANCE.md #18). */
    private static final String WU_KEY = "99d32948179b0c5dcc8970c4d68d5ba1";
    static JSONObject request(JSONObject args, String browserUserAgent) {
        JSONObject out = new JSONObject(); HttpURLConnection c = null;
        try {
            double lat=args.getDouble("lat"), lng=args.getDouble("lng");
            if(!Double.isFinite(lat)||!Double.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)throw new Exception("Invalid weather coordinates");
            String kind=args.getString("provider"), key=args.optString("key", "");
            String base="https://www.accuweather.com", url;
            if("resolve".equals(kind)) url=base+"/api/resolve-current-location";
            else if("hourly".equals(kind)||"pollen".equals(kind)) {
                if(!key.matches("[0-9]{1,12}"))throw new Exception("Invalid weather location key");
                url="hourly".equals(kind)?base+"/api/hourly/"+key+"?isEvent=false&lang=en-US":base+"/api/lifestyle-indices?lang=en-US&locationKey="+key;
            } else if(kind.startsWith("wu")) {
                String geo=String.format(java.util.Locale.US,"%.3f,%.3f",lat,lng),q="?geocode="+geo+"&format=json&language=en-US&apiKey="+WU_KEY,w="https://api.weather.com/";
                if("wuhourly".equals(kind)) url=w+"v3/wx/forecast/hourly/15day"+q+"&units=e";
                else if("wupollen".equals(kind)) url=w+"v2/indices/pollen/daypart/15day"+q;
                else if("wuair".equals(kind)) url=w+"v3/wx/globalAirQuality"+q+"&scale=EPA";
                else if("wualerts".equals(kind)) url=w+"v3/alerts/headlines"+q;
                else throw new Exception("Unknown weather source");
            } else throw new Exception("Unknown weather source");
            c=(HttpURLConnection)new URL(url).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(10000);c.setReadTimeout(20000);
            c.setRequestProperty("Accept","application/json");c.setRequestProperty("User-Agent",browserUserAgent);
            if(kind.startsWith("wu")) {
                c.setRequestProperty("User-Agent","okhttp/4.12.0");
            } else {
                String location=URLEncoder.encode("["+lng+","+lat+"]","UTF-8");
                c.setRequestProperty("Cookie","awx_current_location="+location+"; awx_user_subscriptions=%5B%22none%22%5D; awx_partner=accuweather"+(key.isEmpty()?"":"; awx_current_location_key="+key));
                c.setRequestProperty("Referer",base+"/app/today");c.setRequestProperty("X-Requested-With","com.accuweather.android");
            }
            int status=c.getResponseCode();out.put("status",status);String retry=c.getHeaderField("Retry-After");if(retry!=null)out.put("retryAfter",retry);
            if(status==403||status==418||status==429)out.put("blocked",true);
            if(status==204){out.put("body","");return out;}
            if(status!=200)throw new Exception("Weather source HTTP "+status);
            String locationKey="";
            for(Map.Entry<String,List<String>> entry:c.getHeaderFields().entrySet())if("Set-Cookie".equalsIgnoreCase(entry.getKey()))for(String cookie:entry.getValue()) {
                String pair=cookie.split(";",2)[0];int eq=pair.indexOf('=');if(eq>0&&"awx_current_location_key".equals(pair.substring(0,eq).trim()))locationKey=java.net.URLDecoder.decode(pair.substring(eq+1),"UTF-8");
            }
            if(locationKey.matches("[0-9]{1,12}"))out.put("locationKey",locationKey);
            try(InputStream in=c.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream()) {
                byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){if(bytes.size()+n>2000000)throw new Exception("Weather response too large");bytes.write(buf,0,n);}out.put("body",bytes.toString("UTF-8"));
            }
        } catch(Exception e){try{out.put("error",e.getMessage()==null?"Weather source unavailable":e.getMessage());}catch(Exception ignored){}}
        finally{if(c!=null)c.disconnect();}
        return out;
    }
}
