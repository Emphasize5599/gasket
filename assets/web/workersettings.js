/* Same RAM defaults, slider and non-blocking warning in Settings and onboarding. */
(function(root){'use strict';
 function memory(A){try{return JSON.parse(A.N.memoryInfo?A.N.memoryInfo():'{}');}catch(e){return {};}}
 function ids(prefix){return prefix?{slider:'obWorkers',value:'obWorkerValue',auto:'obWorkerAuto',warning:'obWorkerWarning',aggressive:'obWorkerAggressive'}:{slider:'keylessWorkers',value:'workerValue',auto:'workerAuto',warning:'workerWarning',aggressive:'keylessAggressive'};}
 function html(A,manual,prefix){var x=ids(prefix),m=memory(A),base=KeylessGas.autoWorkers(m),n=Number(manual)>=1?Math.max(1,Math.min(50,Math.round(Number(manual)))):base;
  return '<div class="card worker-settings"><h3>Website workers</h3><div class="field"><div class="lbl">Parallel readers<small>More workers use more RAM and are not always faster. Website restrictions can still limit scans.</small></div><b id="'+x.value+'">'+(Number(manual)>=1?'':'Auto · ')+n+'</b></div><input class="worker-range" type="range" id="'+x.slider+'" min="1" max="50" step="1" value="'+n+'" data-manual="'+(Number(manual)>=1?'yes':'no')+'" aria-label="Parallel website workers"><p class="lead small keep">1–50 workers · RAM-based default: '+base+'</p><div class="field"><div class="lbl">Aggressive worker mode<small>Ramp toward your selected count; back off only for critically low RAM.</small></div><label class="switch"><input type="checkbox" id="'+x.aggressive+'" data-k="keylessAggressive" aria-label="Aggressive worker mode"'+(A.S&&A.S.keylessAggressive?' checked':'')+'><span></span></label></div><p class="worker-warning hidden" id="'+x.warning+'" role="status"></p><button class="btn tonal sm" id="'+x.auto+'">Use RAM default</button></div>';
 }
 function bind(A,prefix){var x=ids(prefix),el=document.getElementById(x.slider);if(!el)return;var m=memory(A),base=KeylessGas.autoWorkers(m);
  var aggressive=document.getElementById(x.aggressive);
  function paint(){document.getElementById(x.value).textContent=(el.dataset.manual==='yes'?'':'Auto · ')+el.value;var state=KeylessGas.workerWarning(m,el.value),w=document.getElementById(x.warning);w.classList.toggle('hidden',!state.warn&&!aggressive.checked);w.textContent=aggressive.checked?'Aggressive mode can cause heat, slowdowns, app restarts or site restrictions. Emergency memory backoff still applies.':state.warn?'High worker count for this phone (default '+base+'). It may slow the phone, exhaust memory or trigger site restrictions. More workers are not always faster.':'';}
  el.oninput=function(){el.dataset.manual='yes';paint();};aggressive.onchange=paint;document.getElementById(x.auto).onclick=function(){el.value=base;el.dataset.manual='no';aggressive.checked=false;paint();};paint();
 }
 root.WorkerSettings={html:html,bind:bind};
})(window);
