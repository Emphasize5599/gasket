const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const runtime=fs.readFileSync('src/com/bensanzone/fuelmap/GemmaRuntime.java','utf8'),service=fs.readFileSync('src/com/bensanzone/fuelmap/GemmaService.java','utf8'),diagnostics=fs.readFileSync('src/com/bensanzone/fuelmap/AiDiagnostics.java','utf8');
assert(!/active\.cancel\(\)/.test(service),'bridge and lifecycle must never wait for a native cancel');
assert.match(service,/cancellation\.request\(active\.cancellation\(\)\)/);
assert.match(service,/static final Semaphore MODEL_SLOT = new Semaphore\(1\)/);
assert(service.indexOf('runtime.close();',service.indexOf('// Release native memory'))<service.indexOf('MODEL_SLOT.release()'),'release native memory before another service can load');
assert.match(service,/if \(recoveryRequired\).*Recheck current car/);
assert.match(diagnostics,/getHistoricalProcessExitReasons/);assert.match(diagnostics,/lastNativeTask/);assert.match(diagnostics,/getNativeHeapAllocatedSize/);assert.match(diagnostics,/getPss/);
assert.match(service,/if \(appPage\) \{ recoveryRequired = true/,'only the app page dying pauses AI; a hidden reader renderer only stops this explanation');
assert.match(diagnostics,/active && "app"\.equals\(scope\)/);assert.match(fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java','utf8'),/rendererLost\("app"\.equals\(scope\)\)/);
assert.match(diagnostics,/"user_requested"\.equals\(e\.optString\("reasonName"\)\)\) wasRunning = false/,'closing from Recents is not a crash');
assert(!diagnostics.includes('getTraceInputStream'),'do not dump unfiltered native tombstones or user data');
if(spawnSync('javac',['-version']).error){if(process.env.GASKET_NATIVE_TESTS==='1')throw Error('JDK required');console.log('Stability contracts passed; native-lock concurrency exercised in CI');process.exit(0);}
function method(needle,source=runtime){const at=source.indexOf(needle);assert(at>=0);let b=source.indexOf('{',at),depth=1,i=b+1;for(;depth;i++){if(source[i]==='{')depth++;if(source[i]==='}')depth--;}return source.slice(at,i);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gasket-ai-stability-')),pkg=path.join(dir,'com/bensanzone/fuelmap');fs.mkdirSync(pkg,{recursive:true});
fs.copyFileSync('src/com/bensanzone/fuelmap/AiCancellation.java',path.join(pkg,'AiCancellation.java'));
fs.writeFileSync(path.join(pkg,'StabilityTest.java'),`package com.bensanzone.fuelmap;
import java.util.concurrent.*;
class StabilityTest {
 static class DiagnosticFormatter {${method('static String failure(',diagnostics)}}
 static class Conversation {int cancelled;void cancelProcess(){cancelled++;}}
 static class Fixture {volatile Conversation conversation;final Object conversationLock=new Object();${method('Runnable cancellation(')}}
 static void check(boolean b){if(!b)throw new AssertionError();}
 public static void main(String[] args)throws Exception{
  String safe=DiagnosticFormatter.failure(new IllegalStateException("Failed /data/user/0/example/model https://example.invalid/?token=test-only",new IllegalArgumentException("inner failure")));
  check(safe.contains("IllegalStateException")&&safe.contains("inner failure")&&!safe.contains("/data/user")&&!safe.contains("test-only"));
  Fixture f=new Fixture();Conversation old=new Conversation(),current=new Conversation();f.conversation=old;Runnable stale=f.cancellation();f.conversation=current;stale.run();check(old.cancelled==0&&current.cancelled==0);
  Runnable live=f.cancellation();live.run();check(current.cancelled==1);f.conversation=null;live.run();check(current.cancelled==1);
  AiCancellation cancel=new AiCancellation();CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1),done=new CountDownLatch(1);
  Thread holder=new Thread(()->{synchronized(f.conversationLock){entered.countDown();try{release.await();}catch(InterruptedException e){throw new RuntimeException(e);}}});holder.start();check(entered.await(2,TimeUnit.SECONDS));f.conversation=current;
  Runnable operation=f.cancellation();cancel.request(()->{operation.run();done.countDown();});
  // Reaching this point while the native monitor is held proves the caller did not wait.
  check(current.cancelled==1);release.countDown();check(done.await(2,TimeUnit.SECONDS));check(current.cancelled==2);holder.join();
  CountDownLatch blocking=new CountDownLatch(1),continueTask=new CountDownLatch(1),last=new CountDownLatch(1);
  cancel.request(()->{blocking.countDown();try{continueTask.await();}catch(InterruptedException e){throw new RuntimeException(e);}});check(blocking.await(2,TimeUnit.SECONDS));
  for(int i=0;i<100;i++)cancel.request(()->{});cancel.request(()->last.countDown());continueTask.countDown();check(last.await(2,TimeUnit.SECONDS));cancel.close();
  System.out.println("Actual cancellation helper: non-blocking under JNI monitor, stale targets ignored, bounded latest request survives.");
 }
}`);
for(const [cmd,args]of [['javac',['com/bensanzone/fuelmap/AiCancellation.java','com/bensanzone/fuelmap/StabilityTest.java']],['java',['-cp',dir,'com.bensanzone.fuelmap.StabilityTest']]]){const r=spawnSync(cmd,args,{cwd:dir,encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stdout+r.stderr);if(r.stdout)process.stdout.write(r.stdout);}
