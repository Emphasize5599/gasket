/* An EV's DC charging curve: kW the car takes at each state of charge. Pure: runs in Node for the tests.
 * Order: the curve you typed > Open EV Data's for this car (bundled, evcurves-data.js) > a generic shape. The car's peak
 * (Fastest DC charging, typed or from Brave) scales a dataset or generic shape; your own curve is used as typed.
 * Every curve is an estimate: real charging also depends on battery temperature, the charger and the car's software. */
(function(root){'use strict';
 var DATA=typeof module!=='undefined'&&module.exports?require('./evcurves-data.js'):root.EVCurveData;
 // Fraction of the peak at each SOC %. Deliberately steeper than 0.0.263's (which kept ~83% of the peak at 50% and
 // ~50% at 80%): owner-supplied Model Y figures and Open EV Data's curves fall off far sooner (~60% at 50%, ~30% at 70%).
 var GENERIC=[[0,.85],[10,1],[30,1],[40,.88],[50,.72],[60,.57],[70,.43],[80,.3],[90,.17],[100,.06]];
 var EDIT_AT=[0,10,20,30,40,50,60,70,80,90,100];
 function norm(s){return String(s||'').toLowerCase().replace(/(\d),(\d)/g,'$1.$2').replace(/(\d)\s*kwh/g,'$1kwh').replace(/[^a-z0-9.+]+/g,' ').replace(/\b(\d+)\.(\d+)\b/g,'$1_$2').replace(/\./g,' ').replace(/_/g,'.').trim();}
 var SYN=[[/\bdual motor\b|\btwin motor\b|\b4matic\b|\b4motion\b|\be-4orce\b|\b4wd\b|\ball wheel drive\b/g,'awd'],[/\bsingle motor\b|\b2wd\b|\bfwd\b|\brear wheel drive\b/g,'rwd'],[/\blr\b/g,'long range'],[/\bsr\b/g,'standard range'],[/\ber\b/g,'extended range'],[/\bsr\+/g,'standard range plus']];
 // Tesla renamed Long Range to Premium for 2026 (VehicleNames); other makes' Premium is just a trim
 function tokens(s,tesla){var t=' '+norm(s)+' ';if(tesla)t=t.replace(/\bpremium\b/g,' long range ');SYN.forEach(function(x){t=t.replace(x[0],' '+x[1]+' ');});return t.split(/\s+/).filter(function(w){return w&&!/^\d+(\.\d+)?kwh$/.test(w)&&w!=='kwh';});}
 /** [[pct, kW], ...] sorted, 2–21 points, pct 0–100, kW 1–1000; anything else = null. */
 function clean(points){
  if(!Array.isArray(points))return null;
  var p=points.map(function(x){return [Math.round(+x[0]),+x[1]];}).filter(function(x){return x[0]>=0&&x[0]<=100&&x[1]>=1&&x[1]<=1000;}).sort(function(a,b){return a[0]-b[0];});
  p=p.filter(function(x,i){return !i||x[0]!==p[i-1][0];});
  return p.length>=2&&p.length<=21?p:null;
 }
 /** kW at a state of charge (0–1), straight lines between points, flat past the ends. */
 function at(points,soc){var pct=Math.max(0,Math.min(100,soc*100)),p=points;if(pct<=p[0][0])return p[0][1];for(var i=1;i<p.length;i++)if(pct<=p[i][0]){var a=p[i-1],b=p[i];return a[1]+(b[1]-a[1])*(pct-a[0])/Math.max(1e-9,b[0]-a[0]);}return p[p.length-1][1];}
 function peak(points){return Math.max.apply(null,points.map(function(x){return x[1];}));}
 function scale(points,kw){var k=kw/peak(points);return points.map(function(x){return [x[0],Math.round(x[1]*k*10)/10];});}
 function generic(kw){return GENERIC.map(function(x){return [x[0],Math.round(x[1]*kw*10)/10];});}
 /** The dataset row that is this car, or null: same make, the model's name words (e.g. "model y", "ioniq 5") all in the
  *  car's, then the closest variant words, drive, usable battery and year. */
 function match(car,rows){
  rows=rows||(DATA&&DATA.rows)||[];if(!car||!car.make||!car.model)return null;
  var make=norm(car.make),tesla=make==='tesla',have=tokens([car.model,car.trim].join(' '),tesla),drive=String(car.info&&car.info.drive||'').toLowerCase();
  if(/awd|4wd|all/.test(drive))have.push('awd');else if(/rwd|fwd|2wd|front|rear/.test(drive))have.push('rwd');
  var best=null;
  rows.forEach(function(r){
   if(norm(r[0])!==make)return;
   var base=tokens(r[1]),need=base.slice(0,/^(model|id|ioniq|ev|eq[a-z]*|i\d|ix|ex\d+|ec\d+|es\d+|xc\d+|c\d+)$/.test(base[0])&&base[1]?2:1);
   if(!need.every(function(w){return have.indexOf(w)>=0;}))return;
   var words=tokens(r[1]+' '+r[2]).filter(function(w){return need.indexOf(w)<0;}),s=0;
   words.forEach(function(w){if(w==='awd'||w==='rwd'){var mine=have.indexOf('awd')>=0?'awd':have.indexOf('rwd')>=0?'rwd':'';s+=!mine?0:mine===w?2:-3;}else s+=have.indexOf(w)>=0?2:-.6;});
   var kwh=+car.tank,cap=+r[4];if(kwh>0&&cap>0){var d=Math.abs(kwh-cap)/cap;s+=d<=.05?2:d<=.15?0:-4;}
   var y=+car.year,ry=+r[3];if(y&&ry){s-=Math.abs(y-ry)*.3;if(ry>y+1)s-=2;}
   s+=r[5].length/2*.05;
   if(!best||s>best.s)best={s:s,row:r};
  });
  return best?best.row:null;
 }
 function label(r){return [r[0],r[1],r[2]].filter(Boolean).join(' ')+(r[3]?' ('+r[3]+')':'');}
 /** {points, src: 'user' | 'data' | 'generic', label, peak}: the curve the planner uses for this car. */
 var memo={key:'',val:null};
 function forCar(car,rows){
  var key=rows?'':JSON.stringify(car&&[car.make,car.model,car.trim,car.year,car.tank,car.dcKw,car.dcCurve,car.info&&car.info.drive]);
  if(key&&memo.key===key)return memo.val;
  var val=resolve(car,rows);if(key)memo={key:key,val:val};return val;
 }
 function resolve(car,rows){
  var mine=clean(car&&car.dcCurve);
  if(mine)return {points:mine,src:'user',label:'Your charging curve',peak:peak(mine)};
  var want=+(car&&car.dcKw)||0,r=match(car,rows);
  if(r){var pts=[];for(var i=0;i<r[5].length;i+=2)pts.push([r[5][i],r[5][i+1]]);pts=clean(pts);
   if(pts)return {points:want?scale(pts,want):pts,src:'data',label:'Open EV Data: '+label(r)+(want&&Math.abs(want-peak(pts))>=1?', scaled to your '+want+' kW peak':''),peak:want||peak(pts),row:r};}
  var kw=want||150;
  return {points:generic(kw),src:'generic',label:'A typical curve for a '+kw+' kW peak'+(want?'':' (no peak entered)'),peak:kw};
 }
 /** The 11 editable rows (0, 10 … 100%) of a curve. */
 function rows11(points){return EDIT_AT.map(function(p){return [p,Math.round(at(points,p/100))];});}
 var api={GENERIC:GENERIC,EDIT_AT:EDIT_AT,clean:clean,at:at,peak:peak,scale:scale,generic:generic,match:match,forCar:forCar,rows11:rows11,tokens:tokens};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ChargeCurve=api;
})(typeof window!=='undefined'?window:globalThis);
