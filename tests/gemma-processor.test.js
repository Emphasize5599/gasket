const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const runtime=fs.readFileSync('src/com/bensanzone/fuelmap/GemmaRuntime.java','utf8'),service=fs.readFileSync('src/com/bensanzone/fuelmap/GemmaService.java','utf8'),trip=fs.readFileSync('assets/web/tripui.js','utf8');
assert(!/GPU_SAFETY_HOLD/.test(service),'0.0.218: the GPU is the default again');assert.match(service,/return prefs.getBoolean\("cpuOnly", false\);/,'GPU unless CPU only was chosen');
assert.match(service,/onCpu\(useCpu\) \? 600 : 120/,'a GPU start that fell back to the CPU gets the CPU deadline');assert.match(trip,/aiGenerate'\) timeout = 610000/,'the bridge never cuts a CPU fallback short');
assert.match(service,/gpuDefault218/,'a CPU-only choice from the flicker tests is reset once');assert.match(service,/gpu_failed_cpu_fallback/,'the GPU failure is logged with its reason');
assert.match(fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java','utf8'),/droppedMetricReports/);
if(spawnSync('javac',['-version']).error){if(process.env.GASKET_NATIVE_TESTS==='1')throw Error('JDK required');console.log('CPU processor contracts passed; actual Java load/reuse/fallback execution needs a JDK (enforced in CI)');process.exit(0);}
function method(needle){const at=runtime.indexOf(needle);assert(at>=0);let b=runtime.indexOf('{',at),depth=1,i=b+1;for(;depth;i++){if(runtime[i]==='{')depth++;if(runtime[i]==='}')depth--;}return runtime.slice(at,i);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gasket-ai-processor-'));
const java=`class ProcessorTest {
 static class GemmaGpuSupport {static int patch=1;static int version(){return patch;}}
 static class Backend {static class GPU extends Backend{} static class CPU extends Backend{CPU(int n,Object ignored){if(n!=2)throw new AssertionError();}}}
 static class EngineConfig {Backend b;EngineConfig(String p,Backend b,Object a,Object z,int n,Object x,String cache){this.b=b;}}
 static class Engine {static int created,closed;static boolean failGpu,failClose;Backend b;Engine(EngineConfig c){b=c.b;created++;}void initialize()throws Exception{if(failGpu&&b instanceof Backend.GPU)throw new Exception("fixture GPU failure");}void close(){closed++;if(failClose)throw new IllegalStateException("fixture close failure");}}
 static class Runtime {Engine engine;int contextTokens;boolean loadedCpuOnly,closeFailed;String backend="unknown";boolean gpuLowPriorityRequested;int gpuPatchVersion;Throwable gpuFailure;
 ${method('static int contextFor(')} ${method('void load(')} ${method('private void initialize(')} ${method('void close()')}
 }
 static void check(boolean b){if(!b)throw new AssertionError();}
 public static void main(String[] args)throws Exception{
 check(Runtime.contextFor(4658)==8192&&Runtime.contextFor(5120)==8192&&Runtime.contextFor(5121)==12288&&Runtime.contextFor(27000)==32768);
 Runtime r=new Runtime();r.load("model","cache",1864,false);check(r.backend.equals("GPU")&&r.gpuFailure==null&&r.engine.b instanceof Backend.GPU);int n=Engine.created;
 r.load("model","cache",4658,false);check(n==Engine.created&&r.contextTokens==8192);
 r.load("model","cache",4658,true);check(r.backend.equals("CPU")&&r.engine.b instanceof Backend.CPU&&Engine.created==n+1&&r.gpuFailure==null);
 r.load("model","cache",6000,true);check(r.contextTokens==12288&&r.engine.b instanceof Backend.CPU);
 Engine.failGpu=true;r.close();r.load("model","cache",1000,false);check(r.backend.equals("CPU")&&r.engine.b instanceof Backend.CPU&&r.gpuFailure!=null&&r.gpuFailure.getMessage().contains("fixture"));
 Engine.failGpu=false;r.close();r.load("model","cache",1000,false);check(r.backend.equals("GPU")&&r.gpuFailure==null);
 r.close();
 Runtime broken=new Runtime();broken.load("model","cache",1000,false);Engine.failClose=true;int beforeClose=Engine.closed;boolean failed=false;
 try{broken.load("model","cache",6000,false);}catch(Exception expected){failed=true;}check(failed&&broken.closeFailed&&Engine.closed==beforeClose+1);
 failed=false;try{broken.close();}catch(Exception expected){failed=true;}check(failed&&Engine.closed==beforeClose+1);
 int beforeCreate=Engine.created;failed=false;try{broken.load("model","cache",1000,false);}catch(Exception expected){failed=true;}check(failed&&Engine.created==beforeCreate);
 System.out.println("Actual runtime: GPU first, CPU only on request or as the fallback with the reason kept, bounded complete context, reuse passed");
 }}
`;
fs.writeFileSync(path.join(dir,'ProcessorTest.java'),java);
for(const [cmd,args]of [['javac',['ProcessorTest.java']],['java',['-cp',dir,'ProcessorTest']]]){const r=spawnSync(cmd,args,{cwd:dir,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);if(r.stdout)process.stdout.write(r.stdout);}
