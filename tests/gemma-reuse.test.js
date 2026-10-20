// Run the ACTUAL service and retention policy with tiny Android/runtime fixtures; no model download.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const service=fs.readFileSync('src/com/bensanzone/fuelmap/GemmaService.java','utf8'),runtime=fs.readFileSync('src/com/bensanzone/fuelmap/GemmaRuntime.java','utf8');
assert.match(service,/slotHeld = true/);assert.match(service,/retained_idle/);assert.match(service,/3, TimeUnit.SECONDS/);
assert.match(runtime,/engine.createConversation\(config\)/);assert.match(runtime,/finally \{\s*synchronized \(conversationLock\) \{ conversation = null; active.close\(\); \}/,'each request closes its own conversation, not its engine');
if(spawnSync('javac',['-version']).error){if(process.env.GASKET_NATIVE_TESTS==='1')throw Error('JDK required');console.log('Reuse contracts passed; actual service lifecycle execution needs a JDK (enforced in CI)');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gasket-reuse-')),sources=[];
function put(name,body){const file=path.join(dir,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);sources.push(name);}
for(const name of ['GemmaService','AiEngineRetention','AiCancellation'])put('com/bensanzone/fuelmap/'+name+'.java',fs.readFileSync('src/com/bensanzone/fuelmap/'+name+'.java','utf8'));
put('org/json/JSONObject.java',`package org.json; public class JSONObject {
 public final java.util.Map<String,Object> values=new java.util.concurrent.ConcurrentHashMap<>();
 public JSONObject put(String k,Object v){if(v!=null)values.put(k,v);return this;}
 public Object get(String k){return values.get(k);}
}`);
put('android/content/SharedPreferences.java',`package android.content; public class SharedPreferences {
 final java.util.Map<String,Object> m=new java.util.concurrent.ConcurrentHashMap<>();
 public boolean getBoolean(String k,boolean d){return (boolean)m.getOrDefault(k,d);} public long getLong(String k,long d){return (long)m.getOrDefault(k,d);} public String getString(String k,String d){return (String)m.getOrDefault(k,d);}
 public Editor edit(){return new Editor();} public class Editor {
 public Editor putBoolean(String k,boolean v){m.put(k,v);return this;}public Editor putLong(String k,long v){m.put(k,v);return this;}public Editor putString(String k,String v){m.put(k,v);return this;}
 public Editor remove(String k){m.remove(k);return this;}public void apply(){}public boolean commit(){return true;}}
}`);
put('android/content/Context.java',`package android.content; public class Context {
 public static final int MODE_PRIVATE=0;public static final String ACTIVITY_SERVICE="activity";final SharedPreferences p=new SharedPreferences();
 public SharedPreferences getSharedPreferences(String n,int m){return p;}public Object getSystemService(String n){return new android.app.ActivityManager();}
 public java.io.File getNoBackupFilesDir(){return new java.io.File("files");}public java.io.File getCacheDir(){return new java.io.File("cache");}
}`);
put('android/app/ActivityManager.java',`package android.app;public class ActivityManager {
 public static volatile long available=4L*1024*1024*1024;public static volatile boolean low=false;
 public static class MemoryInfo {public boolean lowMemory;public long availMem;}
 public void getMemoryInfo(MemoryInfo m){m.lowMemory=low;m.availMem=available;}
}`);
put('android/os/Build.java','package android.os;public class Build {public static final String[] SUPPORTED_ABIS={"arm64-v8a"};}');
put('android/os/Debug.java','package android.os;public class Debug {public static volatile long pss=5L*1024*1024;public static long getPss(){return pss;}}');
put('android/os/Process.java','package android.os;public class Process {public static final int THREAD_PRIORITY_BACKGROUND=10;public static void setThreadPriority(int p){}}');
put('com/bensanzone/fuelmap/AiDiagnostics.java',`package com.bensanzone.fuelmap;class AiDiagnostics {
 boolean interrupted;Object startup=new Object();AiDiagnostics(android.content.Context c,android.content.SharedPreferences p){}
 void beginRun(long id){}void record(String s,boolean f,String b,int t,int i,Throwable e){}Object latest(){return new Object();}Object timeline(){return new Object();}static String failure(Throwable t){return "fixture";}
}`);
put('com/bensanzone/fuelmap/ModelDownload.java',`package com.bensanzone.fuelmap;class ModelDownload {
 interface Control {boolean cancelled();void retry(int n,String why);void progress(long n,boolean v);}
 static void fetch(java.net.URL u,java.io.File p,java.io.File m,long b,String s,Control c){}
}`);
put('com/bensanzone/fuelmap/GemmaRuntime.java',`package com.bensanzone.fuelmap;class GemmaRuntime {
 static volatile int loads,closes;static volatile boolean fail,failClose,block;static volatile java.util.concurrent.CountDownLatch entered;
 int contextTokens;String backend="GPU";boolean gpuLowPriorityRequested;int gpuPatchVersion;Throwable gpuFailure;boolean loaded;
 static int contextFor(int n){return 8192;}
 void load(String p,String c,int n,boolean cpu){if(!loaded){loads++;loaded=true;}contextTokens=8192;backend=cpu?"CPU":"GPU";}
 String generate(String p,java.util.function.BooleanSupplier cancelled,Runnable first)throws Exception {
 if(entered!=null)entered.countDown();while(block&&!cancelled.getAsBoolean())Thread.sleep(2);
 if(cancelled.getAsBoolean())throw new java.util.concurrent.CancellationException();if(fail)throw new Exception("fixture generation failure");first.run();return "fixture";
 }
 Runnable cancellation(){return ()->{};}void close(){if(failClose)throw new IllegalStateException("fixture close failure");closes++;loaded=false;}
}`);
put('com/bensanzone/fuelmap/ReuseTest.java',`package com.bensanzone.fuelmap;
import java.lang.reflect.*;import java.util.concurrent.*;import org.json.JSONObject;
public class ReuseTest {
 static void check(boolean b,String m){if(!b)throw new AssertionError(m);}
 interface Condition {boolean ok()throws Exception;}
 static void waitFor(Condition c)throws Exception{long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(8);while(!c.ok()){if(System.nanoTime()>end)throw new AssertionError("wait timed out");Thread.sleep(5);}}
 static boolean flag(GemmaService s,String n)throws Exception{Field f=GemmaService.class.getDeclaredField(n);f.setAccessible(true);return f.getBoolean(s);}
 static void ready(GemmaService s)throws Exception{Field f=GemmaService.class.getDeclaredField("ready");f.setAccessible(true);f.setBoolean(s,true);}
 static GemmaService service()throws Exception{GemmaService s=new GemmaService(new android.content.Context(),new GemmaService.Listener(){public void status(JSONObject j){}public void result(int id,JSONObject j){}});ready(s);return s;}
 static void run(GemmaService s)throws Exception{s.generate(1,"fixture");waitFor(()->Boolean.FALSE.equals(s.status().get("busy")));}
 static void idleReleased(GemmaService s)throws Exception{waitFor(()->!flag(s,"slotHeld"));}
 public static void main(String[] args)throws Exception{
 long gb=1024L*1024*1024,pss=5L*1024*1024;
 check(AiEngineRetention.allow(false,2*gb,pss,pss,1),"healthy warm budget");
 check(!AiEngineRetention.allow(true,4*gb,pss,pss,1),"OS low memory");check(!AiEngineRetention.allow(false,2*gb-1,pss,pss,1),"RAM reserve");
 check(!AiEngineRetention.allow(false,4*gb,pss+512L*1024+1,pss,2),"PSS growth");check(!AiEngineRetention.allow(false,4*gb,pss,pss,8),"batch ceiling");check(!AiEngineRetention.allow(false,4*gb,0,0,1),"unknown memory");
 GemmaService a=service();check(Boolean.TRUE.equals(a.status().get("graphicsCompatibility")),"graphics default");a.command(3,"graphicsOff");check(Boolean.FALSE.equals(a.status().get("graphicsCompatibility")),"explicit graphics opt-out");a.command(3,"graphicsOn");run(a);run(a);check(GemmaRuntime.loads==1&&GemmaRuntime.closes==0,"serial requests reloaded the engine");check(Boolean.TRUE.equals(a.status().get("engineResident")),"warm engine residency exposed");
 GemmaService other=service();run(other);check(GemmaRuntime.loads==1,"second service loaded while warm lease held");
 a.command(2,"releaseIdle");idleReleased(a);run(other);check(GemmaRuntime.loads==2,"slot not reusable after batch drain");other.close();idleReleased(other);a.close();
 a=service();run(a);GemmaService timed=a;idleReleased(timed);check(!flag(timed,"slotHeld"),"3s idle cleanup");a.close();
 a=service();run(a);int before=GemmaRuntime.closes;android.app.ActivityManager.low=true;run(a);check(GemmaRuntime.closes==before+1,"low memory retained engine");android.app.ActivityManager.low=false;a.close();
 a=service();run(a);before=GemmaRuntime.closes;android.os.Debug.pss+=512L*1024+1;run(a);check(GemmaRuntime.closes==before+1,"growth budget retained engine");android.os.Debug.pss=pss;a.close();
 a=service();for(int i=0;i<8;i++)run(a);check(!flag(a,"slotHeld"),"8th request retained engine");a.close();
 a=service();run(a);a.command(2,"processorCpu");GemmaService switched=a;idleReleased(switched);run(a);check("CPU".equals(a.status().get("backend")),"processor switch reused GPU");a.close();idleReleased(switched);
 a=service();GemmaRuntime.block=true;GemmaRuntime.entered=new CountDownLatch(1);a.generate(1,"fixture");check(GemmaRuntime.entered.await(2,TimeUnit.SECONDS),"generation not started");a.close();GemmaService cancelled=a;idleReleased(cancelled);GemmaRuntime.block=false;GemmaRuntime.entered=null;
 a=service();run(a);a.rendererLost(false);GemmaService renderer=a;idleReleased(renderer);a.close();
 a=service();GemmaRuntime.fail=true;run(a);check(!flag(a,"slotHeld")&&Boolean.TRUE.equals(a.status().get("recoveryRequired")),"failed generation retained engine");GemmaRuntime.fail=false;a.close();
 // Last: unsafe native-close failure must poison the process-wide lease, not permit a second engine.
 a=service();run(a);GemmaRuntime.failClose=true;a.command(2,"releaseIdle");GemmaService poisoned=a;waitFor(()->Boolean.TRUE.equals(poisoned.status().get("recoveryRequired")));check(flag(a,"slotHeld"),"failed close released lease");
 other=service();before=GemmaRuntime.loads;run(other);check(GemmaRuntime.loads==before,"second engine loaded after failed close");other.close();a.close();
 System.out.println("Actual service: serial warm reuse, exclusive lease, idle/drain/processor/renderer/cancel cleanup, RAM/PSS/run budgets, generation and close failures passed");
 }
}`);
const compile=spawnSync('javac',sources,{cwd:dir,encoding:'utf8',timeout:30000});assert.equal(compile.status,0,compile.stdout+compile.stderr);
const run=spawnSync('java',['-cp',dir,'com.bensanzone.fuelmap.ReuseTest'],{cwd:dir,encoding:'utf8',timeout:25000});assert.equal(run.status,0,run.stdout+run.stderr);process.stdout.write(run.stdout);
