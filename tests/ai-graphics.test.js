const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const activity=fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java','utf8'),service=fs.readFileSync('src/com/bensanzone/fuelmap/GemmaService.java','utf8');
assert.match(service,/getBoolean\("graphicsCompatibility", true\)/,'owner requested on by default; explicit false survives');
assert.match(service,/"graphicsOn".equals\(command\) \|\| "graphicsOff".equals\(command\)/);
assert(activity.indexOf('if(value.optBoolean("diagnosticOnly"))')<activity.indexOf('graphicsEnabled = value.optBoolean'),'late telemetry must not switch rendering');
assert.match(activity,/value.optBoolean\("engineResident"\)/,'warm batch gaps do not flip the texture layer');
for(const reason of ['pause','resume','destroy','renderer_lost','memory_trim'])assert(activity.includes('updateAiGraphics("'+reason+'")'),reason);
assert.match(activity,/AiGraphicsMode.gpuJob\(value.optBoolean\("enabled"\), value.optBoolean\("cpuOnly"\), value.optBoolean\("recoveryRequired"\)/);
assert.match(activity,/graphicsView.setLayerType\(type, null\)/);assert(!/forceClientComposition|setColorMode|setRenderEffect/.test(activity),'do not change system composition, colors or blur');
if(spawnSync('javac',['-version']).error){if(process.env.GASKET_NATIVE_TESTS==='1')throw Error('JDK required');console.log('Graphics wiring contracts passed; actual controller execution requires JDK (enforced in CI)');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gasket-graphics-')),pkg=path.join(dir,'com/bensanzone/fuelmap');fs.mkdirSync(pkg,{recursive:true});
fs.copyFileSync('src/com/bensanzone/fuelmap/AiGraphicsMode.java',path.join(pkg,'AiGraphicsMode.java'));
fs.writeFileSync(path.join(pkg,'GraphicsTest.java'),`package com.bensanzone.fuelmap;
public class GraphicsTest {
 static class Target implements AiGraphicsMode.Target {
  int layer,changes,w=1278,h=2856;boolean hardware=true,failApply,failRestore;
  public int layerType(){return layer;}public void layerType(int value){changes++;if(value==2&&failApply)throw new IllegalStateException();if(value==0&&failRestore)throw new IllegalStateException();layer=value;}
  public boolean accelerated(){return hardware;}public int width(){return w;}public int height(){return h;}
 }
 static void check(boolean b,String why){if(!b)throw new AssertionError(why);}
 public static void main(String[] args){
  for(String phase:new String[]{"load","generate","cancelling"})check(AiGraphicsMode.gpuJob(true,false,false,"GPU","advice",phase,false),"GPU stage "+phase);
  check(AiGraphicsMode.gpuJob(true,false,false,"unknown","advice","load",false),"initialization before backend known");
  check(AiGraphicsMode.gpuJob(true,false,false,"GPU","","idle",true),"warm gap");
  check(!AiGraphicsMode.gpuJob(true,false,false,"GPU","","idle",false),"drained");
  check(!AiGraphicsMode.gpuJob(false,false,false,"GPU","advice","generate",true),"disabled");check(!AiGraphicsMode.gpuJob(true,true,false,"GPU","advice","generate",true),"CPU selected");check(!AiGraphicsMode.gpuJob(true,false,false,"CPU","advice","generate",true),"CPU fallback");check(!AiGraphicsMode.gpuJob(true,false,true,"GPU","advice","cancelling",true),"recovery");
  for(String phase:new String[]{"download","verify","retry","cancelling"})check(!AiGraphicsMode.gpuJob(true,false,false,"GPU","download",phase,true),"download stage "+phase);
  Target t=new Target();AiGraphicsMode c=new AiGraphicsMode(t);
  c.update(false,true,true);check(t.changes==0,"off changes rendering");c.update(true,false,true);check(t.changes==0,"idle changes rendering");c.update(true,true,false);check(t.changes==0,"background changes rendering");
  c.update(true,true,true);check(c.active()&&t.layer==2&&t.changes==1,"active texture");for(int i=0;i<100;i++)c.update(true,true,true);check(t.changes==1,"status/retained gaps churn layers");
  c.update(true,true,false);check(!c.active()&&t.layer==0,"pause restores");c.update(true,true,true);check(c.active(),"resume reactivates");c.update(true,false,true);check(!c.active()&&t.layer==0,"completion/cancel/failure/drain restores");
  c.update(true,true,true);c.update(false,true,true);check(!c.active()&&t.layer==0,"user can switch off mid-job");
  t.layer=1;c.update(true,true,true);check(!c.active()&&t.layer==1&&c.skipped().equals("existing_software_layer"),"preserve software");
  t.layer=2;c.update(true,true,true);c.update(true,false,true);check(t.layer==2,"preserve original hardware layer");
  t.layer=0;t.hardware=false;c.update(true,true,true);check(!c.active()&&t.layer==0,"no software fallback");t.hardware=true;
  t.w=0;c.update(true,true,true);check(!c.active(),"zero layout");t.w=4000;t.h=4000;c.update(true,true,true);check(!c.active(),"pixel budget");t.w=10;t.h=9000;c.update(true,true,true);check(!c.active(),"dimension budget");t.w=1278;t.h=2856;
  t.failApply=true;c.update(true,true,true);check(!c.active()&&!c.error().isEmpty(),"failed apply safely inactive");int changes=t.changes;c.update(true,true,true);check(t.changes==changes,"failed activation retries every status");t.failApply=false;c.update(false,false,true);c.update(true,true,true);check(c.active(),"explicit retry");
  t.failRestore=true;c.update(false,false,true);check(c.active()&&c.error().startsWith("restore_"),"restore failure visible");t.failRestore=false;c.update(false,false,true);check(!c.active()&&t.layer==0,"restoration retried");
  c.update(true,true,true);t.layer=1;c.update(false,false,true);check(t.layer==1&&!c.active(),"later layer owner preserved");
  System.out.println("Actual graphics controller: gated activation, no churn, restore, lifecycle, budgets, ownership and failure recovery passed");
 }
}`);
for(const [cmd,args]of [['javac',['com/bensanzone/fuelmap/AiGraphicsMode.java','com/bensanzone/fuelmap/GraphicsTest.java']],['java',['-cp',dir,'com.bensanzone.fuelmap.GraphicsTest']]]){const r=spawnSync(cmd,args,{cwd:dir,encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stdout+r.stderr);if(r.stdout)process.stdout.write(r.stdout);}
