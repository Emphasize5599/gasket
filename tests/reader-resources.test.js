const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const omission=require('../tools/reader-resource-policy');
const native=fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java','utf8');
const cases=[
 ['https://www.google.com/maps/_/wa/w.version.mapcore.O.wasm','GET',2],
 ['https://www.google.com/maps/vt/sxforms?x=1','GET',2],
 ['https://www.google.com/maps/vt/pb=!1m4!1m3','GET',2],
 ['https://www.gstatic.com/maps/res/CompactLegend-Roadmap-version','GET',2],
 ['https://www.google.com/maps/preview/log204','GET',3],
 ['https://www.google.com/maps/preview/log204','POST',3],
 ['https://fonts.googleapis.com/css?family=Roboto','GET',1],
 ['https://fonts.gstatic.com/l/font','GET',1],
 ['https://example.com/sound.ogg?x=1','GET',1],
 ['https://www.google.com/search?tbm=map&q=gas+stations','GET',0],
 ['https://www.google.com/maps/search/gas+stations/@35,-91,13z','GET',0],
 ['https://www.google.com/maps/_/js/mapcode','GET',0],
 ['https://www.google.com/maps/_/ss/mapstyles','GET',0],
 ['https://www.google.com/maps/_/wa/other.wasm','GET',0],
 ['https://www.google.com/maps/_/MapsWizUi/data/batchexecute','POST',0],
 ['https://www.google.com/maps/preview/place','GET',0],
 ['https://www.google.com/js/bg/security.js','GET',0],
 ['https://www.google.com/sorry/index','GET',0],
 ['https://consent.google.com/m','GET',0],
 ['https://accounts.google.com/ListAccounts','GET',0],
 ['https://www.google.com.evil.test/maps/vt/sxforms','GET',0],
 ['https://www.gstatic.com.evil.test/maps/res/CompactLegend-version','GET',0],
 ['https://www.google.com/maps/preview/log204-extra','POST',0],
 ['https://www.google.com/maps/vt/sxforms','POST',0]
];
for(const [url,method,expected] of cases){
 const u=new URL(url),host=u.hostname.toLowerCase(),p=u.pathname.toLowerCase();
 assert.equal(omission(host,p,method),expected,url);
 assert.equal(omission(host,p,method,true),0,'main frames always load');
 assert.equal(omission(host,p,method,false,true),0,'visible checks always load');
 assert.equal(omission(host,p,method,false,false,false),expected===1?1:0,'normal-resource retry restores graphics/telemetry');
}
assert.match(native,/GasReaderResources\.omission\(host,path,req\.getMethod\(\),req\.isForMainFrame\(\),verifying == SiteWorker\.this,leanGasResources\)/);
assert.match(native,/window\.__gasketLeanResources=/);
assert.match(native,/w\.leanGasResources = true; w\.retriedGasResources = false/);
assert.match(native,/setBlockNetworkImage\(false\)/,'visible verification restores images');
console.log('Reader resource policy: narrow graphics/logging filters; scripts, CSS, station data, security, main frames and visible checks retained');
if(spawnSync('javac',['-version']).error){if(process.env.GASKET_NATIVE_TESTS==='1')throw Error('JDK required');console.log('Native reader resource/fallback execution needs a JDK; enforced in CI');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gasket-reader-policy-')),pkg=path.join(dir,'com/bensanzone/fuelmap');fs.mkdirSync(pkg,{recursive:true});
fs.copyFileSync('src/com/bensanzone/fuelmap/GasReaderResources.java',path.join(pkg,'GasReaderResources.java'));
const finish=native.slice(native.indexOf('        void finishRead(int reqId, String json)'),native.indexOf('        SiteWorker(String key, String home, String origin)'));
const java=`package com.bensanzone.fuelmap;
import java.util.*;import java.net.*;import java.util.concurrent.atomic.*;
public class ReaderTest {
 static void check(boolean c,String m){if(!c)throw new AssertionError(m);}
 static class JSONArray {List<JSONObject> rows=new ArrayList<>();JSONArray(){}JSONArray(int n){for(int i=0;i<n;i++){JSONObject s=new JSONObject();s.put("featureId","fixture"+i);rows.add(s);}}int length(){return rows.size();}JSONObject optJSONObject(int i){return rows.get(i);}void put(JSONObject s){rows.add(s);}}
 static class JSONObject {
  static Map<String,JSONObject> answers=new HashMap<>();Map<String,Object> data=new HashMap<>();
  JSONObject(){} JSONObject(String raw){data=answers.get(raw).data;}
  JSONArray optJSONArray(String k){return (JSONArray)data.get(k);} JSONObject optJSONObject(String k){return (JSONObject)data.get(k);}
  String optString(String k){return optString(k,"");}String optString(String k,String d){return String.valueOf(data.getOrDefault(k,d));} boolean optBoolean(String k){return Boolean.TRUE.equals(data.get(k));}double optDouble(String k,double d){Object x=data.get(k);return x instanceof Number?((Number)x).doubleValue():d;}
  void put(String k,Object v){data.put(k,v);} public String toString(){return "result";}
 }
 static class View {String at="https://www.google.com/maps/search/gas+stations/@35,-91,13z";int loads=0;String getUrl(){return at;}void stopLoading(){}void loadUrl(String u){at=u;loads++;}void clearHistory(){}void destroy(){}}
 static class Main {int removed=0;void removeCallbacks(Runnable r){removed++;}void post(Runnable r){r.run();}}
 static class Root {void removeView(View v){}}
 class SiteWorker {
  int readReq=1,completedReads=0;String readCall="reader",key="gasweb";boolean leanGasResources=true,retriedGasResources=false,ready=true;
  AtomicIntegerArray omittedGasResources=new AtomicIntegerArray(4);View view=new View();Runnable readDeadline=()->{};JSONArray partialGasStores=null;String gasRequestedGrade="regular";
  ${finish}
 }
 SiteWorker verifying=null;Main main=new Main();Root root=new Root();int gasReaderRecycles=0,replies=0;Map<String,SiteWorker> workers=new HashMap<>();
 boolean isGasWorker(String k){return k.equals("gasweb");}String q(String s){return s;}void js(String s){replies++;}
 static JSONObject answer(String key,String code,int count,boolean blocked,boolean cancelled){JSONObject a=new JSONObject();a.put("stores",new JSONArray(count));a.put("code",code);a.put("blocked",blocked);a.put("cancelled",cancelled);JSONObject.answers.put(key,a);return a;}
 public static void main(String[] args)throws Exception {
  ${cases.map(([url,method,expected])=>`{URI u=new URI(${JSON.stringify(url)});String h=u.getHost().toLowerCase(Locale.US),p=u.getPath().toLowerCase(Locale.US);check(GasReaderResources.omission(h,p,${JSON.stringify(method)},false,false,true)==${expected},"policy mismatch");check(GasReaderResources.omission(h,p,${JSON.stringify(method)},true,false,true)==0,"main frame filtered");check(GasReaderResources.omission(h,p,${JSON.stringify(method)},false,true,true)==0,"visible check filtered");check(GasReaderResources.omission(h,p,${JSON.stringify(method)},false,false,false)==${expected===1?1:0},"fallback policy mismatch");}`).join('\n')}
  ReaderTest app=new ReaderTest();SiteWorker w=app.new SiteWorker();Runnable deadline=w.readDeadline;answer("empty","unreadable",0,false,false);
  w.finishRead(1,"empty");check(!w.leanGasResources&&w.retriedGasResources&&w.readReq==1&&w.readCall!=null,"did not retry same request");check(w.view.loads==1&&app.replies==0&&w.readDeadline==deadline&&app.main.removed==0,"retry reset deadline or answered early");
  JSONObject success=answer("ok","limited",2,false,false);w.finishRead(1,"ok");check(w.readReq==-1&&w.readCall==null&&app.replies==1&&app.main.removed==1,"fallback failed to settle");check(success.optJSONObject("detail").optBoolean("fullResourceRetry"),"retry diagnostic missing");
  for(String code:new String[]{"unreadable","incomplete_feed","no_prices","reader","timeout"})for(boolean blocked:new boolean[]{false,true})for(boolean cancelled:new boolean[]{false,true}){
   ReaderTest x=new ReaderTest();SiteWorker lane=x.new SiteWorker();answer("case",code,0,blocked,cancelled);lane.finishRead(2,"case");check(lane.view.loads==0&&x.replies==0,"late reply changed current request");lane.finishRead(1,"case");boolean retry=(code.equals("unreadable")||code.equals("incomplete_feed"))&&!blocked&&!cancelled;check(lane.view.loads==1&&x.replies==(retry?0:1),"unexpected retry/reply");
   if(retry){lane.finishRead(1,"case");check(x.replies==1&&!lane.leanGasResources,"fallback looped");}
  }
  ReaderTest visible=new ReaderTest();SiteWorker lane=visible.new SiteWorker();visible.verifying=lane;lane.finishRead(1,"empty");check(lane.view.loads==0&&visible.replies==1,"visible verification retried");
  ReaderTest partial=new ReaderTest();lane=partial.new SiteWorker();answer("partial","unreadable",1,false,false);lane.finishRead(1,"partial");check(partial.replies==1&&lane.leanGasResources,"discarded partial results");
  ReaderTest recovery=new ReaderTest();lane=recovery.new SiteWorker();answer("early","incomplete_feed",2,false,false);lane.finishRead(1,"early");check(recovery.replies==0&&lane.partialGasStores.length()==2,"quiet page was incorrectly treated as complete");JSONObject later=answer("later","limited",1,false,false);JSONObject newest=later.optJSONArray("stores").optJSONObject(0);lane.finishRead(1,"later");check(later.optJSONArray("stores").length()==2&&later.optJSONArray("stores").optJSONObject(0)==newest,"lost partial identity or replaced newer record with old price");check(lane.partialGasStores==null&&recovery.replies==1,"partial storage leaked or duplicate reply");
  ReaderTest restricted=new ReaderTest();lane=restricted.new SiteWorker();answer("early2","incomplete_feed",2,false,false);lane.finishRead(1,"early2");JSONObject deny=answer("deny","blocked",0,true,false);lane.finishRead(1,"deny");check(deny.optBoolean("blocked")&&deny.optJSONArray("stores").length()==2&&restricted.replies==1,"restriction lost partial observations or retried");
  System.out.println("Actual Java reader filter and finishRead: one retry, original deadline, same ID, partial results, restrictions, cancellation, stale replies and visible checks passed");
 }
}`;
fs.writeFileSync(path.join(pkg,'ReaderTest.java'),java);
for(const [cmd,args] of [['javac',['com/bensanzone/fuelmap/GasReaderResources.java','com/bensanzone/fuelmap/ReaderTest.java']],['java',['-cp',dir,'com.bensanzone.fuelmap.ReaderTest']]]){
 const r=spawnSync(cmd,args,{cwd:dir,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);if(r.stdout)process.stdout.write(r.stdout);
}
