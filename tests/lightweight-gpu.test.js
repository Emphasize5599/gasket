const assert=require('node:assert/strict'),{initialize}=require('../assets/web/lightweightgpu.js');
function fixture(probe,fail){const calls=[],events=[],adapters=[],env={backends:{onnx:{webgpu:{}}}},nav={gpu:{requestAdapter:async o=>{adapters.push(o);return probe(o,adapters.length);}}};let disposed=0;
 const T={env,pipeline:async(task,model,options)=>{calls.push(options);if(fail&&fail(options,'load'))throw Error('Synthetic GPU load error');const pipe=async()=>({data:fail&&fail(options,'warm')?[NaN]:[1,0]});pipe.dispose=async()=>disposed++;return pipe;}};
 return {calls,events,adapters,env,nav,T,disposed:()=>disposed,run:cpuOnly=>initialize(T,nav,{model:'fixture',cpuOnly,progress(){}},e=>events.push(e))};}
(async()=>{
 const adapter={features:new Set(['shader-f16']),info:{isFallbackAdapter:false}};
 let f=fixture(()=>{throw Error('CPU only must not probe GPU');});let r=await f.run(true);assert.equal(r.device,'wasm');assert.equal(f.adapters.length,0);assert.equal(f.calls[0].device,'wasm');assert.match(r.gpuWhy,/CPU only selected/);
 f=fixture(()=>adapter);r=await f.run(false);assert.equal(r.device,'webgpu');assert.equal(r.dtype,'fp16');assert.equal(r.adapterPath,'core');assert.equal(f.env.backends.onnx.webgpu.adapter,adapter,'runtime receives the chosen adapter, not another default probe');assert.equal(f.events.at(-1).phase,'gpu-ready');
 f=fixture(o=>o?.featureLevel==='compatibility'?adapter:null);r=await f.run(false);assert.equal(r.device,'webgpu');assert.equal(r.adapterPath,'compatibility');assert.equal(f.adapters.length,3);assert.deepEqual(f.adapters[2],{featureLevel:'compatibility',powerPreference:'high-performance'});
 f=fixture(()=>adapter,o=>o.device==='webgpu'&&o.dtype==='fp16');r=await f.run(false);assert.equal(r.device,'webgpu');assert.equal(r.dtype,'fp32');assert.equal(f.calls.length,2,'fp32 remains a GPU option if fp16 initialization fails');
 f=fixture(()=>({features:new Set()}),(o,phase)=>o.device==='webgpu'&&phase==='warm');r=await f.run(false);assert.equal(r.device,'wasm');assert.equal(f.disposed(),1);assert(!f.events.some(e=>e.phase==='gpu-ready'),'an adapter alone is not proof of usable GPU inference');assert.match(r.gpuWhy,/invalid embeddings/);
 f=fixture(()=>({isFallbackAdapter:true}));r=await f.run(false);assert.equal(r.device,'wasm');assert(f.calls.every(o=>o.device==='wasm'),'software adapters are not advertised as GPU acceleration');
 f=fixture(o=>{if(o?.featureLevel)throw Error('Unsupported featureLevel');return null;});r=await f.run(false);assert.equal(r.device,'wasm');assert.match(r.gpuWhy,/Unsupported featureLevel/);
 f=fixture(()=>null);delete f.nav.gpu;r=await f.run(false);assert.equal(r.device,'wasm');assert.match(r.gpuWhy,/not offered/);
 console.log('Core/compatibility GPU selection, warm-up validation, fp16/fp32 fallback, explicit CPU-only and software-adapter rejection passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
