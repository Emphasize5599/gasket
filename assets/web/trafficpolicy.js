/* Planning presets describe reuse, never Google's forecast accuracy. */
(function(root){'use strict';
 var modes={commute:{label:'Commute / short trip',ttl:2*3600000},weekend:{label:'Weekend / regional trip',ttl:7*86400000},road:{label:'Vacation / road trip',ttl:28*86400000}};
 function resolve(mode,seconds){seconds=Number.isFinite(seconds)&&seconds>0?seconds:0;var auto=seconds<=5400?'commute':seconds<=18000?'weekend':'road',chosen=modes[mode]?mode:auto;return {mode:chosen,label:modes[chosen].label,ttl:modes[chosen].ttl,seconds:seconds,automatic:!modes[mode]};}
 function journey(m,stops,round){if(!m)return 0;var ends=m.legEnds||[],last=(stops||[]).length-1;if(round&&last>1){var i=last-1;while(i>0&&(stops[i].rest||stops[i].ret))i--;if(i>0&&Number.isFinite(ends[i-1]))return m.timeTo(ends[i-1]);}return m.durationSec||0;}
 var api={resolve:resolve,journey:journey,modes:modes};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TrafficPolicy=api;
})(typeof window==='undefined'?globalThis:window);
