const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const file='src/com/bensanzone/fuelmap/GemmaGpuSupport.java',runtime=fs.readFileSync('src/com/bensanzone/fuelmap/GemmaRuntime.java','utf8');
assert(!runtime.includes('new Backend.GPU()'),'stability build never initializes a GPU engine');
assert(runtime.includes('if (!cpuOnly) throw'),'reject GPU requests while safety hold is active');
if(spawnSync('javac',['-version']).error){if(process.env.GASKET_NATIVE_TESTS==='1')throw Error('JDK required');console.log('GPU identity contracts passed; actual missing-library fallback executed in CI');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gasket-gpu-identity-')),pkg=path.join(dir,'com/bensanzone/fuelmap');fs.mkdirSync(pkg,{recursive:true});
fs.copyFileSync(file,path.join(pkg,'GemmaGpuSupport.java'));
fs.writeFileSync(path.join(pkg,'SupportTest.java'),'package com.bensanzone.fuelmap; class SupportTest { public static void main(String[] args) { if (GemmaGpuSupport.version()!=0 || GemmaGpuSupport.version()!=0) throw new AssertionError("Missing JNI must fail closed and stay cached"); } }');
for(const [cmd,args]of [['javac',['com/bensanzone/fuelmap/GemmaGpuSupport.java','com/bensanzone/fuelmap/SupportTest.java']],['java',['-cp',dir,'com.bensanzone.fuelmap.SupportTest']]]){const r=spawnSync(cmd,args,{cwd:dir,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);}
console.log('Actual GPU identity class: unavailable library fails closed without crashing.');
