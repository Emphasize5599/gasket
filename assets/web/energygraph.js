/* Finite differences between actually planned speeds, on one shared minute scale. */
(function(root){
 'use strict';
 function valid(r){return !!r&&r.ok&&['offset','cost','minutes','driving','charging'].every(function(k){return Number.isFinite(r[k]);});}
 function intervals(rows){return rows.map(function(b,i){var a=rows[i-1],d=a&&b.offset-a.offset;if(!valid(a)||!valid(b)||!(d>0))return null;return {from:a.offset,to:b.offset,index:i,driving:(a.driving-b.driving)*5/d,charging:(b.charging-a.charging)*5/d,net:(a.minutes-b.minutes)*5/d,cost:(b.cost-a.cost)*5/d};});}
 function signed(v){return (v>0?'+':'')+v.toFixed(1);}
 function chart(rows,baseline,selected){
  var good=rows.filter(valid);if(!good.length)return '<p>No feasible speed scenarios with these parameters.</p>';
  var rates=intervals(rows),W=360,H=250,L=48,R=344,T=57,B=212,x0=Math.min.apply(null,rows.map(function(r){return r.offset;})),x1=Math.max.apply(null,rows.map(function(r){return r.offset;}));if(x1-x0<1){x0-=1;x1+=1;}
  var values=[0];rates.forEach(function(r){if(r)values.push(r.driving,r.charging);});var lo=Math.min.apply(null,values),hi=Math.max.apply(null,values);if(hi-lo<1){lo-=.5;hi+=.5;}var pad=(hi-lo)*.08;lo-=pad;hi+=pad;
  var x=function(v){return L+(v-x0)/(x1-x0)*(R-L);},y=function(v){return B-(v-lo)/(hi-lo)*(B-T);};
  var service=rows.some(function(r){return r.kind==='h2';})?'refueling':'charging';
  var h='<svg class="energy-chart" viewBox="0 0 '+W+' '+H+'" role="group" aria-label="Driving minutes saved versus extra '+service+' minutes per 5 mph increase"><title>One shared minute scale. Steps average adjacent tested plans, not an exact optimum. Green means less total trip time, including stops and scheduled waits.</title><text x="'+L+'" y="16">Minutes per +5 mph</text><text class="energy-drive" x="'+L+'" y="34">Driving time saved</text><text class="energy-charge" x="'+L+'" y="50">Extra '+service+' time</text>';
  rates.forEach(function(r){if(r&&r.net>.05)h+='<rect class="energy-good" x="'+x(r.from)+'" y="'+T+'" width="'+Math.max(1,x(r.to)-x(r.from))+'" height="'+(B-T)+'"/>';});
  for(var i=0;i<=4;i++){var v=hi-i*(hi-lo)/4,yy=y(v);h+='<line class="energy-grid" x1="'+L+'" x2="'+R+'" y1="'+yy+'" y2="'+yy+'"/><text x="'+(L-6)+'" y="'+(yy+4)+'" text-anchor="end">'+signed(v)+'</text>';}
  var stride=Math.ceil(rows.length/6);rows.forEach(function(r,i){if(i%stride&&i!==rows.length-1)return;h+='<text x="'+x(r.offset)+'" y="233" text-anchor="middle">'+(r.offset>0?'+':'')+r.offset+'</text>';});
  h+='<line class="energy-zero" x1="'+L+'" x2="'+R+'" y1="'+y(0)+'" y2="'+y(0)+'"/>';
  function path(field,cls){var d='';rates.forEach(function(r){if(r)d+=' M'+x(r.from)+','+y(r[field])+' L'+x(r.to)+','+y(r[field]);});return '<path class="energy-line '+cls+'" d="'+d+'"/>';}
  h+=path('driving','energy-drive')+path('charging','energy-charge');
  if(valid(rows[selected]))h+='<line class="energy-cursor" x1="'+x(rows[selected].offset)+'" x2="'+x(rows[selected].offset)+'" y1="'+T+'" y2="'+B+'"/>';
  rows.forEach(function(r,i){if(!valid(r))return;var rate=rates[i],label=signed(r.offset)+' mph versus posted limits, '+r.cost.toFixed(2)+' dollars, '+Math.round(r.minutes)+' total minutes';h+='<g role="button" tabindex="0" data-energy-speed="'+i+'" aria-label="'+label+'"><title>'+label+'</title><rect class="energy-hit" x="'+(x(r.offset)-12)+'" y="'+T+'" width="24" height="'+(B-T)+'"/>';
   if(rate)h+='<circle class="energy-drive" cx="'+x(r.offset)+'" cy="'+y(rate.driving)+'" r="4"/><circle class="energy-charge" cx="'+x(r.offset)+'" cy="'+y(rate.charging)+'" r="4"/>';else h+='<circle class="energy-base" cx="'+x(r.offset)+'" cy="'+y(0)+'" r="4"/>';h+='</g>';});
  return h+'</svg>';
 }
 var api={chart:chart,intervals:intervals};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EnergyGraph=api;
})(typeof window!=='undefined'?window:globalThis);
