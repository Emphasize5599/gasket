/* Metadata-only visual diagnostics. No screenshots, DOM text, form values, prompts or answers.
 * Observe only during AI work + a short tail. Aggregate, don't log every frame/mutation. */
(function(root){'use strict';
 var A=root.__app,D=root.document,trail=[],markers=[],seq=0,epoch=0,markPending=false,watching=false,active=false,until=0,timer=0,raf=0,observer=null,longObserver=null,ai={},lastSync=null,lastFrame=0,due=0,lastSample=0,counts={};
 function enabled(){return !!(A&&A.S.debug&&root.FLog&&FLog.level()>=3);}
 function reset(){counts={frames:0,maxFrameMs:0,over50ms:0,eventLoopLateMs:0,longTasks:0,longTaskMaxMs:0,mutations:0,added:0,removed:0,redraws:{}};}
 function round(n){return Math.round(n*100)/100;}
 function note(event,data){if(!enabled())return;var row={timestamp:Date.now(),monotonicMs:round(performance.now()),event:event,generationId:ai.generationId||0,phase:ai.phase||'idle',data:data||{}};trail.push(row);while(trail.length>96)trail.shift();return row;}
 function screen(){return {visibility:D.visibilityState,focus:D.hasFocus(),width:innerWidth,height:innerHeight,dpr:devicePixelRatio,trip:D.body.classList.contains('trip-on'),fullMenu:D.body.classList.contains('trip-full'),settings:!!D.querySelector('#settings:not(.hidden)'),submenu:!!D.querySelector('.sub-page:not(.hidden)'),nodes:D.getElementsByTagName('*').length};}
 function sample(reason){if(!enabled())return;var row=note('web_render_sample',Object.assign({reason:reason,screen:screen()},counts));if(row)FLog.trace('visual','Web rendering sample',row);reset();lastSample=performance.now();}
 function frame(t){if(!watching||!enabled()||D.hidden){raf=0;return;}if(lastFrame){var gap=t-lastFrame;counts.frames++;counts.maxFrameMs=Math.max(counts.maxFrameMs,round(gap));if(gap>50)counts.over50ms++;}lastFrame=t;raf=requestAnimationFrame(frame);}
 function heartbeat(){timer=0;if(!enabled()){stop();return;}var now=performance.now();if(!D.hidden)counts.eventLoopLateMs=Math.max(counts.eventLoopLateMs,round(Math.max(0,now-due)));if(now-lastSample>=5000)sample('periodic');if(!active&&Date.now()>until){stop();return;}due=performance.now()+1000;timer=setTimeout(heartbeat,1000);}
 function start(){if(watching)return;watching=true;reset();lastFrame=0;lastSample=performance.now();due=lastSample+1000;timer=setTimeout(heartbeat,1000);raf=requestAnimationFrame(frame);
  observer=new MutationObserver(function(rows){counts.mutations+=rows.length;rows.forEach(function(r){counts.added+=r.addedNodes.length;counts.removed+=r.removedNodes.length;});});observer.observe(D.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden']});
  if(root.PerformanceObserver&&PerformanceObserver.supportedEntryTypes&&PerformanceObserver.supportedEntryTypes.indexOf('longtask')>=0)try{longObserver=new PerformanceObserver(function(list){list.getEntries().forEach(function(e){counts.longTasks++;counts.longTaskMaxMs=Math.max(counts.longTaskMaxMs,round(e.duration));});});longObserver.observe({type:'longtask'});}catch(e){}
 }
 function stop(){if(!watching)return;sample('finished');watching=false;clearTimeout(timer);cancelAnimationFrame(raf);timer=raf=0;if(observer)observer.disconnect();if(longObserver)longObserver.disconnect();observer=longObserver=null;lastFrame=0;if(root.Tasks)Tasks.draw();}
 function sync(){var on=enabled();if(lastSync!==on){lastSync=on;if(A.N.setVisualDiagnostics)A.N.setVisualDiagnostics(on);if(!on){active=false;stop();}}return on;}
 function setAi(value){if(!sync())return;var phase=String(value.phase||'idle'),generationId=Number(value.generationId)||0,changed=phase!==ai.phase||generationId!==ai.generationId;
  active=value.task==='advice'&&/^(load|generate|cancelling)$/.test(phase);ai={phase:phase,generationId:generationId,backend:value.backend||'unknown'};
  if(active){until=Date.now()+10000;start();}else if(watching)until=Date.now()+10000;
  if(changed){sample('ai_transition');note('ai_status',{phase:phase,generationId:generationId,backend:ai.backend,firstOutputAt:Number(value.firstOutputAt)||0});}
 }
 function redraw(kind){if(watching&&enabled())counts.redraws[kind]=(counts.redraws[kind]||0)+1;}
 function lifecycle(kind){if(!enabled()||!watching)return;note('lifecycle',{kind:kind,screen:screen()});FLog.debug('visual','Window lifecycle',{kind:kind,generationId:ai.generationId,phase:ai.phase,visibility:D.visibilityState});lastFrame=0;due=performance.now()+1000;if(!D.hidden&&!raf)raf=requestAnimationFrame(frame);}
 async function mark(){if(markPending)return;if(!sync()){A.toast('Enable Debug logging at Steps or higher first.');return;}markPending=true;var ticket=epoch,id=++seq,record={id:id,timestamp:Date.now(),monotonicMs:round(performance.now()),screen:screen(),ai:Object.assign({},ai),trail:trail.slice(-48)};
  FLog.warn('visual','USER MARKED VISUAL GLITCH',{id:id,timestamp:record.timestamp,phase:ai.phase,generationId:ai.generationId});
  markers.push(record);while(markers.length>4)markers.shift();save();A.toast('Visual glitch marked. Share the debug log after it happens.');
  if(A.N.visualSnapshot&&root.__trip)try{record.native=await root.__trip.call('visualSnapshot');}catch(e){record.native={error:'Native snapshot unavailable'};}
  markPending=false;if(ticket!==epoch||!enabled())return;FLog.trace('visual','Visual glitch context',record);save();
 }
 function save(){try{while(markers.length>1&&JSON.stringify(markers).length>180000)markers.shift();if(A.KV)A.KV.put('visualdiagnostics','markers',markers);}catch(e){}}
 function report(){return '\n\nVisual glitch markers (metadata only):\n'+JSON.stringify(markers)+'\nRecent visual timeline:\n'+JSON.stringify(trail);}
 try{var saved=A.KV&&A.KV.get('visualdiagnostics','markers');if(saved&&Array.isArray(saved.v))markers=saved.v.slice(-4);seq=markers.reduce(function(n,m){return Math.max(n,+m.id||0);},0);}catch(e){}
 root.VisualDiagnostics={sync:sync,ai:setAi,redraw:redraw,note:note,lifecycle:lifecycle,mark:mark,report:report,clear:function(){epoch++;trail=[];markers=[];seen.clear();save();},wantMarker:function(){return watching&&enabled()&&!!A.S.visualGlitchButton;},nativeFrame:function(value){if(!enabled())return;note('android_frame_bucket',value);FLog.trace('visual','Android frame bucket',value);},milestones:function(rows){if(!enabled())return;(rows||[]).forEach(function(row){var key=row.instanceId+':'+row.sequence;if(seen.has(key))return;seen.add(key);if(seen.size>128)seen.delete(seen.values().next().value);note('native_ai_milestone',row);FLog.debug('visual','Native AI milestone',row);});}};
 var seen=new Set();D.addEventListener('visibilitychange',function(){lifecycle('web_visibility');});root.addEventListener('resize',function(){lifecycle('web_resize');});root.addEventListener('focus',function(){lifecycle('web_focus');});root.addEventListener('blur',function(){lifecycle('web_blur');});sync();
})(window);
