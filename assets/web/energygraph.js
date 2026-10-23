/* Gas-style consumption curve, using the energy of actually planned speeds. */
(function(root){
 'use strict';
 function valid(r){return !!r&&r.ok&&['offset','cost','minutes','driving','charging'].every(function(k){return Number.isFinite(r[k]);});}
 function intervals(rows){return rows.map(function(b,i){var a=rows[i-1],d=a&&b.offset-a.offset;if(!valid(a)||!valid(b)||!(d>0))return null;return {from:a.offset,to:b.offset,index:i,driving:(a.driving-b.driving)*5/d,charging:(b.charging-a.charging)*5/d,net:(a.minutes-b.minutes)*5/d,cost:(b.cost-a.cost)*5/d};});}
 function signed(v){return (v>0?'+':'')+v.toFixed(1);}
 function consumption(r){return valid(r)&&Number.isFinite(r.per100)&&r.per100>=0;}
 function balanced(a,b){return consumption(a)&&consumption(b)&&b.offset>a.offset&&a.per100>0&&a.driving>0&&b.driving<a.driving&&(b.per100-a.per100)/a.per100<=(a.driving-b.driving)/a.driving;}
 function choices(rows){var energy=-1,cost=-1;rows.forEach(function(r,i){if(!consumption(r))return;if(energy<0||r.per100<rows[energy].per100-1e-9||Math.abs(r.per100-rows[energy].per100)<1e-9&&r.minutes<rows[energy].minutes)energy=i;if(cost<0||r.cost<rows[cost].cost-1e-9||Math.abs(r.cost-rows[cost].cost)<1e-9&&r.minutes<rows[cost].minutes)cost=i;});return {energy:energy,cost:cost};}
 function balanceNote(rows){if(rows.some(function(r,i){return balanced(rows[i-1],r);}))return 'Green = energy/time balance, like the gas graph.';return rows.some(function(r,i){return consumption(rows[i-1])&&consumption(r)&&r.driving<rows[i-1].driving;})?'No green band in this tested range: each evaluated speed increase uses proportionally more energy than the driving time it saves.':'Not enough neighboring feasible speed settings to show a balance band.';}
 function chart(rows,baseline,selected){
  var good=rows.filter(consumption);if(!good.length)return '<p>No feasible speed scenarios with these parameters.</p>';
  var W=360,H=230,L=48,R=344,T=32,B=193,x0=Math.min.apply(null,rows.map(function(r){return r.offset;})),x1=Math.max.apply(null,rows.map(function(r){return r.offset;}));if(x1-x0<1){x0-=1;x1+=1;}
  var values=good.map(function(r){return r.per100;}),lo=Math.min.apply(null,values),hi=Math.max.apply(null,values),pad=Math.max((hi-lo)*.12,hi*.03,.01);lo=Math.max(0,lo-pad);hi+=pad;var rawStep=(hi-lo)/4,mag=Math.pow(10,Math.floor(Math.log10(rawStep))),step=[1,2,5,10].find(function(n){return n*mag>=rawStep;})*mag;lo=Math.floor(lo/step)*step;hi=Math.ceil(hi/step)*step;
  var x=function(v){return L+(v-x0)/(x1-x0)*(R-L);},y=function(v){return B-(v-lo)/(hi-lo)*(B-T);};
  var unit=rows.some(function(r){return r.kind==='h2';})?'kg':'kWh';
  var h='<svg class="energy-chart" viewBox="0 0 '+W+' '+H+'" role="group" aria-label="Driving energy use in '+unit+' per 100 miles versus speed setting"><title>Higher means more energy used. Diagonal segments connect tested plans, not an exact optimum. Green uses the same percentage energy versus driving-time balance as the gas graph, not a lowest-cost guarantee.</title><text x="'+L+'" y="18">'+unit+' / 100 miles · lower uses less</text>';
  rows.forEach(function(r,i){var a=rows[i-1];if(balanced(a,r))h+='<rect class="energy-good" x="'+x(a.offset)+'" y="'+T+'" width="'+Math.max(1,x(r.offset)-x(a.offset))+'" height="'+(B-T)+'"/>';});
  for(var v=lo;v<=hi+step*.01;v+=step){var yy=y(v);h+='<line class="energy-grid" x1="'+L+'" x2="'+R+'" y1="'+yy+'" y2="'+yy+'"/><text x="'+(L-6)+'" y="'+(yy+4)+'" text-anchor="end">'+(Math.abs(v)<step*.01?'0':v.toFixed(Math.min(4,Math.max(0,-Math.floor(Math.log10(step))))))+'</text>';}
  var ticks=rows.filter(function(r){return r.offset%5===0;}),stride=Math.ceil(ticks.length/6);ticks.forEach(function(r,i){if(i%stride&&i!==ticks.length-1)return;h+='<text x="'+x(r.offset)+'" y="216" text-anchor="middle">'+(r.offset>0?'+':'')+r.offset+'</text>';});
  var d='',prior=false;rows.forEach(function(r){if(consumption(r)){d+=(prior?' L':' M')+x(r.offset)+','+y(r.per100);prior=true;}else prior=false;});h+='<path class="energy-line energy-drive" d="'+d+'"/>';
  if(consumption(rows[selected]))h+='<line class="energy-cursor" x1="'+x(rows[selected].offset)+'" x2="'+x(rows[selected].offset)+'" y1="'+T+'" y2="'+B+'"/>';
  rows.forEach(function(r,i){if(!consumption(r))return;var label=signed(r.offset)+' mph versus posted limits, '+r.per100.toFixed(1)+' '+unit+' per 100 miles, '+r.cost.toFixed(2)+' dollars, '+Math.round(r.minutes)+' total minutes';h+='<g role="button" tabindex="0" data-energy-speed="'+i+'" aria-label="'+label+'"><title>'+label+'</title><rect class="energy-hit" x="'+(x(r.offset)-12)+'" y="'+T+'" width="24" height="'+(B-T)+'"/>';
   var nearSelected=consumption(rows[selected])&&i!==selected&&Math.abs(x(rows[selected].offset)-x(r.offset))<14;
   if(!nearSelected&&(r.offset%5===0||i===selected))h+='<circle class="energy-drive" cx="'+x(r.offset)+'" cy="'+y(r.per100)+'" r="'+(i===selected?5:3)+'"/>';h+='</g>';});
  return h+'</svg>';
 }
 var api={chart:chart,intervals:intervals,balanced:balanced,choices:choices,balanceNote:balanceNote};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EnergyGraph=api;
})(typeof window!=='undefined'?window:globalThis);
