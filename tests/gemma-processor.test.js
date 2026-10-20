const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const runtime=fs.readFileSync('src/com/bensanzone/fuelmap/GemmaRuntime.java','utf8'),service=fs.readFileSync('src/com/bensanzone/fuelmap/GemmaService.java','utf8'),trip=fs.readFileSync('assets/web/tripui.js','utf8');
assert.match(service,/getBoolean\("cpuOnly", false\)/,'preserve automatic GPU default');assert.match(service,/if \(busy.get\(\)\) \{ result\(id, null, "Turn AI off/,'no processor changes during a native task');assert.match(service,/useCpu \? 600 : 120/);assert.match(trip,/cpuOnly \? 610000 : 125000/,'bridge must not time out a deliberately slower CPU run at 125 seconds');
assert.match(fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java','utf8'),/droppedMetricReports/);
if(spawnSync('javac',['-version']).error){if(process.env.GASKET_NATIVE_TESTS==='1')throw Error('JDK required');console.log('CPU processor contracts passed; actual Java load/reuse/fallback execution needs a JDK (enforced in CI)');process.exit(0);}
function method(needle){const at=runtime.indexOf(needle);assert(at>=0);let b=runtime.indexOf('{',at),depth=1,i=b+1;for(;depth;i++){if(runtime[i]==='{')depth++;if(runtime[i]==='}')depth--;}return runtime.slice(at,i);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gasket-ai-processor-'));
const java=`class ProcessorTest {
 static class Backend {static class GPU extends Backend{} static class CPU extends Backend{CPU(int n,Object ignored){if(n!=4)throw new AssertionError();}}}
 static class EngineConfig {Backend b;EngineConfig(String p,Backend b,Object a,Object z,int n,Object x,String cache){this.b=b;}}
 static class Engine {static int created,closed;static boolean failGpu;Backend b;Engine(EngineConfig c){b=c.b;created++;}void initialize()throws Exception{if(failGpu&&b instanceof Backend.GPU)throw new Exception("fixture GPU failure");}void close(){closed++;}}
 static class Runtime {Engine engine;int contextTokens;boolean loadedCpuOnly;String backend="GPU";
 ${method('void load(')} ${method('private void initialize(')} ${method('void close()')}
 }
 static void check(boolean b){if(!b)throw new AssertionError();}
 public static void main(String[] args)throws Exception{
 Runtime r=new Runtime();r.load("model","cache",1000,false);check(r.backend.equals("GPU"));int n=Engine.created;
 r.load("model","cache",1000,false);check(n==Engine.created);
 r.load("model","cache",1000,true);check(r.backend.equals("CPU")&&r.engine.b instanceof Backend.CPU&&Engine.closed==1);n=Engine.created;
 r.load("model","cache",1000,true);check(n==Engine.created);
 r.load("model","cache",1000,false);check(r.backend.equals("GPU")&&Engine.closed==2);
 Engine.failGpu=true;r.close();r.load("model","cache",1000,false);check(r.backend.equals("CPU"));
 n=Engine.created;r.load("model","cache",1000,true);check(r.backend.equals("CPU")&&Engine.created==n+1);
 System.out.println("Actual GemmaRuntime load: GPU default, strict CPU selection, same-backend reuse, processor switch rebuild and GPU failure fallback passed");
 }}
`;
fs.writeFileSync(path.join(dir,'ProcessorTest.java'),java);
for(const [cmd,args]of [['javac',['ProcessorTest.java']],['java',['-cp',dir,'ProcessorTest']]]){const r=spawnSync(cmd,args,{cwd:dir,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);if(r.stdout)process.stdout.write(r.stdout);}
