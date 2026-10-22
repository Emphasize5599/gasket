/* Pure SVG: independent cost/time scales. An intersection is never an optimum. */
(function(root){
 'use strict';
 function chart(rows,baseline,selected){
  var valid=rows.filter(function(r){return r.ok&&Number.isFinite(r.mph)&&Number.isFinite(r.cost)&&Number.isFinite(r.minutes);});
  if(!valid.length)return '<p>No feasible speed scenarios with these parameters.</p>';
  var W=360,H=236,L=56,R=304,T=38,B=206,x0=Math.min.apply(null,valid.map(function(r){return r.mph;})),x1=Math.max.apply(null,valid.map(function(r){return r.mph;}));if(x1-x0<1){x0-=1;x1+=1;}
  var costs=valid.map(function(r){return r.cost-baseline.cost;}),times=valid.map(function(r){return r.minutes-baseline.minutes;});
  function scale(a){var lo=Math.min(0,Math.min.apply(null,a)),hi=Math.max(0,Math.max.apply(null,a));if(hi-lo<.1){lo-=.1;hi+=.1;}return {lo:lo,hi:hi};}
  var c=scale(costs),t=scale(times),x=function(v){return L+(v-x0)/(x1-x0)*(R-L);},y=function(v,s){return B-(v-s.lo)/(s.hi-s.lo)*(B-T);},fmt=function(v){return (v>0?'+':'')+v.toFixed(1);};
  var h='<svg class="energy-chart" viewBox="0 0 '+W+' '+H+'" role="group" aria-label="Estimated energy cost and driving plus stop time versus Average driving speed (mph)"><title>Independent dollar and minute scales. Line intersections have no special meaning.</title>';
  var ordered=valid.slice().sort(function(a,b){return a.mph-b.mph;});
  ordered.forEach(function(r,i){if(r.offset>0||r.cost>=baseline.cost-.005||r.minutes>baseline.minutes+.1)return;var a=i?(ordered[i-1].mph+r.mph)/2:x0,b=i+1<ordered.length?(r.mph+ordered[i+1].mph)/2:x1;h+='<rect class="energy-good" x="'+x(a)+'" y="'+T+'" width="'+Math.max(2,x(b)-x(a))+'" height="'+(B-T)+'"/>';});
  for(var i=0;i<=4;i++){var yy=T+i*(B-T)/4;h+='<line class="energy-grid" x1="'+L+'" x2="'+R+'" y1="'+yy+'" y2="'+yy+'"/><text class="energy-cost" x="'+(L-6)+'" y="'+(yy+4)+'" text-anchor="end">'+fmt(c.hi-i*(c.hi-c.lo)/4)+'</text><text class="energy-time" x="'+(R+6)+'" y="'+(yy+4)+'">'+fmt(t.hi-i*(t.hi-t.lo)/4)+'</text>';var v=x0+i*(x1-x0)/4;h+='<text x="'+x(v)+'" y="225" text-anchor="middle">'+v.toFixed(0)+'</text>';}
  h+='<text class="energy-cost" x="'+L+'" y="18">Δ cost ($)</text><text class="energy-time" x="'+R+'" y="18" text-anchor="end">Δ time (min)</text>';
  function path(field,sc,cls){var d='',open=false;rows.slice().sort(function(a,b){return a.mph-b.mph;}).forEach(function(r){if(!r.ok||!Number.isFinite(r.mph)){open=false;return;}d+=(open?' L':' M')+x(r.mph)+','+y(r[field]-baseline[field],sc);open=true;});return '<path class="'+cls+'" d="'+d+'"/>';}
  h+=path('cost',c,'energy-line energy-cost')+path('minutes',t,'energy-line energy-time');
  if(rows[selected]&&rows[selected].ok)h+='<line class="energy-cursor" x1="'+x(rows[selected].mph)+'" x2="'+x(rows[selected].mph)+'" y1="'+T+'" y2="'+B+'"/>';
  rows.forEach(function(r,i){if(!r.ok)return;h+='<g role="button" tabindex="0" data-energy-speed="'+i+'" aria-label="'+r.mph.toFixed(1)+' mph, '+r.cost.toFixed(2)+' dollars, '+Math.round(r.minutes)+' minutes"><rect class="energy-hit" x="'+(x(r.mph)-10)+'" y="'+T+'" width="20" height="'+(B-T)+'"/><circle class="energy-cost" cx="'+x(r.mph)+'" cy="'+y(r.cost-baseline.cost,c)+'" r="5"/><circle class="energy-time" cx="'+x(r.mph)+'" cy="'+y(r.minutes-baseline.minutes,t)+'" r="5"/></g>';});
  return h+'</svg>';
 }
 var api={chart:chart};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EnergyGraph=api;
})(typeof window!=='undefined'?window:globalThis);
