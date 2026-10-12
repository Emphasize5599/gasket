// Execute the ACTUAL native reservation block against small preference/JSON stubs.
// No Android runtime or real API requests. CI runs this after installing the JDK.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const code=fs.readFileSync(path.join(__dirname,'../src/com/bensanzone/fuelmap/MainActivity.java'),'utf8');
const method=code.slice(code.indexOf('public void computeRoute('),code.indexOf('public void routeSearch('));
const start=method.indexOf('synchronized (MainActivity.this)'),end=method.indexOf('o.put("body", googlePost(ROUTES_URL');
assert.ok(start>=0&&end>start);
const javac=spawnSync('javac',['-version'],{encoding:'utf8'});
if(javac.error){if(process.env.GASKET_NATIVE_TESTS==='1')throw javac.error;console.log('Native Routes gate test needs a JDK; enforced in CI');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gasket-routes-gate-'));
const java=`import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
class MainActivity {
 int count=0; boolean fail=false; AtomicInteger sent=new AtomicInteger(),blocked=new AtomicInteger();
 String routeMonthKey(){return "rcalls_test";} Pref prefs(){return new Pref();}
 class Pref {int getInt(String k,int d){return count;} Editor edit(){return new Editor();}}
 class Editor {int next; Editor putInt(String k,int n){next=n;return this;} boolean commit(){if(fail)return false;count=next;return true;}}
 class Json {void put(String k,String v){} }
 void reply(int id,Json o){blocked.incrementAndGet();}
 void request(int monthlyCap) throws Exception {
  Json o=new Json();int reqId=1;
  ${method.slice(start,end)}
  sent.incrementAndGet();
 }
 static void check(boolean c,String m){if(!c)throw new AssertionError(m);}
 public static void main(String[] args)throws Exception{
  MainActivity m=new MainActivity();m.count=9;
  ExecutorService pool=Executors.newFixedThreadPool(8);
  for(int i=0;i<80;i++)pool.submit(()->{try{m.request(10);}catch(Exception e){throw new RuntimeException(e);}});
  pool.shutdown();check(pool.awaitTermination(10,TimeUnit.SECONDS),"threads stalled");
  check(m.count==10&&m.sent.get()==1&&m.blocked.get()==79,"concurrent requests exceeded cap");
  m.request(10);check(m.sent.get()==1,"at cap still sent");
  m.request(0);check(m.sent.get()==2&&m.count==11,"explicit unlimited broken");
  m.count=0;m.request(10);check(m.count==1,"new monthly bucket not counted");
  m.fail=true;boolean failed=false;try{m.request(10);}catch(Exception e){failed=true;}
  check(failed&&m.sent.get()==3,"persistence failure sent a request");
  System.out.println("Native Routes cap: concurrent boundary, blocked requests, unlimited, monthly bucket and failed persistence passed");
 }
}`;
fs.writeFileSync(path.join(dir,'MainActivity.java'),java);
for(const [bin,args] of [['javac',['MainActivity.java']],['java',['-cp',dir,'MainActivity']]]){
 const r=spawnSync(bin,args,{cwd:dir,encoding:'utf8',timeout:30000});
 assert.equal(r.status,0,r.stdout+r.stderr);if(r.stdout)process.stdout.write(r.stdout);
}
