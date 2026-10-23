/* Serialized into the rating worker. No unsafe flags or software-GPU claims. */
(function(root){
 async function initialize(T,nav,options,report){
  var reasons=[],adapter=null,path='',pipe=null,dtype='q8';report=report||function(){};
  function say(phase,extra){report(Object.assign({phase:phase,effectiveCPUOnly:!!options.cpuOnly},extra||{}));}
  if(options.cpuOnly)reasons.push(options.cpuReason||'CPU only selected');
  else if(!nav||!nav.gpu)reasons.push('WebGPU not offered');
  else {
   var probes=[{path:'core',options:undefined},{path:'high-performance',options:{powerPreference:'high-performance'}},{path:'compatibility',options:{featureLevel:'compatibility',powerPreference:'high-performance'}}];
   for(var probe of probes){
    say('adapter-probe',{path:probe.path});
    try{var candidate=await nav.gpu.requestAdapter(probe.options);if(!candidate){reasons.push(probe.path+': no adapter');continue;}if(candidate.isFallbackAdapter===true||candidate.info&&candidate.info.isFallbackAdapter===true){reasons.push(probe.path+': software adapter skipped');continue;}adapter=candidate;path=probe.path;break;}
    catch(e){reasons.push(probe.path+': '+String(e&&e.message||e).slice(0,140));}
   }
  }
  if(adapter){
   var backend=T.env.backends&&T.env.backends.onnx&&T.env.backends.onnx.webgpu;
   if(backend){
    // The pinned ONNX runtime accepts an explicitly selected adapter before
    // the first WebGPU session. Do not let it silently probe core-only again.
    backend.adapter=adapter;
    var dtypes=adapter.features&&adapter.features.has('shader-f16')?['fp16','fp32']:['fp32'];
    for(var dt of dtypes){
     try{
      say('gpu-model-load',{path:path,dtype:dt});pipe=await T.pipeline('feature-extraction',options.model,{device:'webgpu',dtype:dt,progress_callback:options.progress});
      say('gpu-warmup',{path:path,dtype:dt});var output=await pipe(['warm up'],{pooling:'mean',normalize:true});
      if(!output||!output.data||!output.data.length||!Array.from(output.data).every(Number.isFinite)||!Array.from(output.data).some(function(v){return v!==0;}))throw Error('GPU warm-up returned invalid embeddings');
      say('gpu-ready',{path:path,dtype:dt});return {pipe:pipe,device:'webgpu',dtype:dt,adapterPath:path,gpuWhy:'',attempts:reasons};
     }catch(e){reasons.push(path+' '+dt+': '+String(e&&e.message||e).slice(0,180));if(pipe&&pipe.dispose)try{await pipe.dispose();}catch(ignored){}pipe=null;}
    }
   }else reasons.push('Runtime does not expose adapter selection');
  }
  say('cpu-fallback',{reason:reasons.join('; ')});
  pipe=await T.pipeline('feature-extraction',options.model,{device:'wasm',dtype:'q8',progress_callback:options.progress});
  return {pipe:pipe,device:'wasm',dtype:'q8',adapterPath:'',gpuWhy:reasons.join('; '),attempts:reasons};
 }
 var api={initialize:initialize};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LightweightGPU=api;
})(typeof window!=='undefined'?window:globalThis);
