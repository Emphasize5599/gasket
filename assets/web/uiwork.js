/* Bounded main-thread work. Yield between chunks so input and paint can run;
 * callers retain ownership/cancellation checks and never publish partial answers. */
(function(root){'use strict';
 var pointers=new Set(),until=0;function mark(){until=Date.now()+120;}if(root.document){root.addEventListener('pointerdown',function(e){pointers.add(e.pointerId);mark();},{capture:true,passive:true});['pointerup','pointercancel'].forEach(function(n){root.addEventListener(n,function(e){pointers.delete(e.pointerId);mark();},{capture:true,passive:true});});['wheel','scroll','keydown'].forEach(function(n){root.addEventListener(n,mark,{capture:true,passive:true});});root.addEventListener('blur',function(){pointers.clear();});}
 function interacting(){return pointers.size>0||Date.now()<until;}
 function pause(){return new Promise(function(resolve){setTimeout(resolve,0);});}
 async function each(rows,read,valid){var at=0,clock=root.performance&&root.performance.now?function(){return root.performance.now();}:Date.now;
  if(rows.length>64)await pause();
  while(at<rows.length){if(valid&&!valid())throw Error('Work cancelled');var began=clock(),end=Math.min(rows.length,at+64);for(;at<end;at++){read(rows[at],at);if(clock()-began>=6){at++;break;}}if(at<rows.length)await pause();}
  if(valid&&!valid())throw Error('Work cancelled');
 }
 var api={pause:pause,each:each,interacting:interacting};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.UiWork=api;
})(typeof window==='undefined'?globalThis:window);
