/* First-paint readiness, independent of map tiles, location, downloads and AI. */
(function(root){
 'use strict';var at=performance.now(),steps=[],done=false,failed=false,loaded=false;
 document.documentElement.dataset.theme=root.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
 function native(fn,value){try{if(root.Native&&typeof Native[fn]==='function')Native[fn](value);}catch(e){}}
 function stage(text){if(done)return;steps.push({stage:text,ms:Math.round(performance.now()-at)});var el=document.getElementById('startupStatus');if(el)el.textContent=text;native('startupStage',text);}
 function fail(){if(done||failed)return;failed=true;stage('Gasket could not finish starting. Tap Reload to try again.');var b=document.getElementById('startupReload');if(b){b.hidden=false;b.classList.remove('hidden');b.onclick=function(){location.reload();};}native('startupReady',JSON.stringify({failed:true,ms:Math.round(performance.now()-at)}));}
 function ready(){if(done||failed)return;requestAnimationFrame(function(){requestAnimationFrame(function(){if(failed)return;done=true;var el=document.getElementById('startupScreen');if(el)el.remove();var report={ms:Math.round(performance.now()-at),stages:steps};if(root.FLog)FLog.info('startup','Interface ready',report);native('startupReady',JSON.stringify(report));root.dispatchEvent(new Event('gasketready'));});});}
 root.GasketStartup={stage:stage,ready:ready,state:function(){return {ready:done,failed:failed,stages:steps.slice()};}};
 root.addEventListener('error',function(e){if(!loaded&&(e instanceof ErrorEvent||e.target&&e.target.tagName==='SCRIPT'))fail();},true);
 document.addEventListener('DOMContentLoaded',function(){loaded=true;if(!root.__app){fail();return;}stage('Opening Gasket…');ready();});
 stage('Loading Gasket…');
})(window);
