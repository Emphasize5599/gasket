const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
if(spawnSync('javac',['-version']).error){if(process.env.GASKET_NATIVE_TESTS==='1')throw Error('JDK required');console.log('Guest source concurrency needs a JDK; enforced in CI');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gasket-guest-gate-')),pkg=path.join(dir,'com/bensanzone/fuelmap');fs.mkdirSync(pkg,{recursive:true});
fs.copyFileSync(path.resolve('src/com/bensanzone/fuelmap/GuestSourceGate.java'),path.join(pkg,'GuestSourceGate.java'));
fs.writeFileSync(path.join(pkg,'GateTest.java'),`package com.bensanzone.fuelmap;
import java.util.concurrent.*;import java.util.concurrent.atomic.*;
public class GateTest {
 public static void main(String[] args) throws Exception {
  GuestSourceGate gate=new GuestSourceGate();ExecutorService pool=Executors.newFixedThreadPool(4);
  try {
   CountDownLatch entered=new CountDownLatch(2),release=new CountDownLatch(1);
   Callable<Void> work=()->{entered.countDown();if(!release.await(5,TimeUnit.SECONDS))throw new AssertionError("parallel provider stalled");return null;};
   Future<Void> a=pool.submit(()->gate.read("ea",work)),b=pool.submit(()->gate.read("evgo",work));
   if(!entered.await(5,TimeUnit.SECONDS))throw new AssertionError("different providers serialized");
   AtomicBoolean changed=new AtomicBoolean();Future<Void> c=pool.submit(()->gate.change(()->{changed.set(true);return null;}));
   try{c.get(100,TimeUnit.MILLISECONDS);throw new AssertionError("credentials changed during active reads");}catch(TimeoutException expected){}
   release.countDown();a.get(5,TimeUnit.SECONDS);b.get(5,TimeUnit.SECONDS);c.get(5,TimeUnit.SECONDS);if(!changed.get())throw new AssertionError();
   AtomicInteger active=new AtomicInteger(),max=new AtomicInteger();CountDownLatch first=new CountDownLatch(1),finish=new CountDownLatch(1);
   Future<Void> d=pool.submit(()->gate.read("ea",()->{max.accumulateAndGet(active.incrementAndGet(),Math::max);first.countDown();finish.await(5,TimeUnit.SECONDS);active.decrementAndGet();return null;}));
   if(!first.await(5,TimeUnit.SECONDS))throw new AssertionError();
   Future<Void> e=pool.submit(()->gate.read("ea",()->{max.accumulateAndGet(active.incrementAndGet(),Math::max);active.decrementAndGet();return null;}));
   try{e.get(100,TimeUnit.MILLISECONDS);throw new AssertionError("same provider overlapped");}catch(TimeoutException expected){}
   finish.countDown();d.get(5,TimeUnit.SECONDS);e.get(5,TimeUnit.SECONDS);if(max.get()!=1)throw new AssertionError();
   try{gate.read("ea",()->{throw new Exception("expected");});}catch(Exception expected){}
   gate.change(()->null);gate.read("ea",()->null);
   System.out.println("Independent providers overlap; provider pacing, credential exclusion and exception unlock passed");
  }finally{pool.shutdownNow();}
 }
}`);
for(const [cmd,args] of [['javac',['com/bensanzone/fuelmap/GuestSourceGate.java','com/bensanzone/fuelmap/GateTest.java']],['java',['-cp',dir,'com.bensanzone.fuelmap.GateTest']]]){const r=spawnSync(cmd,args,{cwd:dir,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);if(r.stdout)process.stdout.write(r.stdout);}
