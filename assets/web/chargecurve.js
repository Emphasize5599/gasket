/* An EV's DC charging curve: kW the car takes at each state of charge. Pure: runs in Node for the tests.
 * Planning requires a confirmed installed pack or a named curve entered by the driver.
 * The lower-level forCar helper also supports legacy previews.
 * Every curve is an estimate: real charging also depends on battery temperature, the charger and the car's software. */
(function(root){'use strict';
 var DATA=typeof module!=='undefined'&&module.exports?require('./evcurves-data.js'):root.EVCurveData;
 // Fraction of the peak at each SOC %. Deliberately steeper than 0.0.263's (which kept ~83% of the peak at 50% and
 // ~50% at 80%): owner-supplied Model Y figures and Open EV Data's curves fall off far sooner (~60% at 50%, ~30% at 70%).
 var GENERIC=[[0,.85],[10,1],[30,1],[40,.88],[50,.72],[60,.57],[70,.43],[80,.3],[90,.17],[100,.06]];
 var EDIT_AT=[0,10,20,30,40,50,60,70,80,90,100];
 // Warm planning curves. Sources and applicability are documented in docs/TESLA_PACKS.md and docs/EV_CHARGING_PROFILES.md.
 var PACKS=[
  {id:'m3-lr-2021',usable:76,usableSource:'https://insideevs.com/news/519345/bjorn-tesla-model3-lr-range/',model:'Model 3',from:2021,to:2021,trim:/(?=.*(?:long range|\blr\b))(?=.*(?:awd|dual motor))/,label:'2021 Long Range AWD · Panasonic 2170 family',kw:[100,250,225,180,145,100,80,60,45,30,15]},
  {id:'m3-sr-2020',usable:49,usableSource:'https://ev-database.org/car/1177/Tesla-Model-3-Standard-Range-Plus',model:'Model 3',from:2020,to:2020,trim:/standard range|sr\+/,label:'2020 Standard Range Plus · nickel-based pack',kw:[169,169,155,138,115,89,71,57,36,22,10]},
  {id:'ms-refresh',usable:95,usableSource:'https://ev-database.org/car/1404/Tesla-Model-S-Dual-Motor',model:'Model S',from:2022,to:2025,exclude:/plaid|standard range/,label:'2022–25 refreshed Model S · 100 kWh class',kw:[138,214,220,224,200,152,118,94,67,48,15]},
  {id:'ms-plaid',usable:95,usableSource:'https://ev-database.org/uk/car/1405/Tesla-Model-S-Plaid',model:'Model S',from:2021,to:2025,trim:/plaid/,label:'2021–25 Model S Plaid · 100 kWh class',kw:[133,205,211,215,193,146,114,90,65,46,15]},
  {id:'mx-refresh',usable:95,usableSource:'https://ev-database.org/uk/car/1407/Tesla-Model-X-Dual-Motor',model:'Model X',from:2022,to:2025,exclude:/plaid|standard range/,label:'2022–25 refreshed Model X · 100 kWh class',kw:[136,210,216,220,198,149,116,92,67,46,15]},
  {id:'mx-plaid',usable:95,usableSource:'https://ev-database.org/car/1408/Tesla-Model-X-Plaid',model:'Model X',from:2022,to:2025,trim:/plaid/,label:'2022–25 Model X Plaid · 100 kWh class',kw:[133,205,211,215,192,146,114,90,65,47,15]},
  {id:'bolt-ev-2022',make:'Chevrolet',model:'Bolt EV',from:2022,to:2022,label:'2022 Bolt EV · 65 kWh class',
   source:'https://insideevs.com/news/613786/chevrolet-bolt-ev-fast-charging/',
   points:[[0,32],[5,38],[20,40],[25,45],[30,46],[50,45],[55,41],[60,36],[65,32],[70,29],[75,27],[80,24],[85,20],[90,17],[95,14],[100,9]]},
  {id:'rivian-large-gen1',make:'Rivian',model:/^r1[ts](?: |$)/,from:2022,to:2022,exclude:/\b(?:standard|max|dual)\b/,
   label:'2022 R1T / R1S · first-generation Large Pack',source:'https://insideevs.com/news/586886/how-long-to-charge-rivian-r1t/',
   points:[[0,165],[5,200],[20,205],[22,200],[23,170],[40,155],[45,150],[50,133],[60,116],[70,100],[72,94],[78,70],[80,50],[85,49],[90,45],[95,25],[100,8]]}
 ];
 function packs(car,listing){
  if(!car)return [];
  var make=norm(car.make),name=norm([car.model,car.trim].join(' '));
  return PACKS.filter(function(p){
   if((make||!listing)&&make!==norm(p.make||'Tesla')||car.year<p.from||car.year>p.to||!+car.year)return false;
   var model=typeof p.model==='string'?norm(p.model):null;
   return listing&&!name||(model?name===model||name.startsWith(model+' '):p.model.test(name))&&(!p.trim||p.trim.test(name))&&(!p.exclude||!p.exclude.test(name));   // menus too: EPA model names carry the version (Model 3 Long Range vs Standard Range Plus)
  });
 }
 function researchKey(car){return car&&car.year&&car.make&&car.model?[car.year,car.make,car.model,car.trim].filter(Boolean).join(' ').replace(/\s+/g,' ').trim():'';}
 function researchPacks(text){
  var seen=new Set();
  return String(text||'').split(/\bPACK:\s*/i).slice(1).reduce(function(out,line){
   var fields=line.replace(/\s+[-*•]\s*$/,'').split('|').map(function(v){return v.trim();}),label=fields[0],legacy=fields.length===6;
   if(!(legacy||fields.length===9)||!label||label.length>160||/^(unknown|none|n\/?a)$/i.test(label)||seen.has(label))return out;
   seen.add(label);
   var n=legacy?null:/^(\d+(?:\.\d+)?)\s*(?:kWh)?$/i.exec(fields[2]),usable=n&&+n[1]>0&&+n[1]<=1000?+n[1]:null;
   var source=!legacy&&/^https:\/\/[^\s<>]+$/i.test(fields[8])?fields[8]:null;
   var rates=legacy?[]:fields[7].split(',').map(function(v){return /^\s*\d+(?:\.\d+)?\s*$/.test(v)?Number(v):NaN;});
   var points=source&&rates.length===EDIT_AT.length?clean(EDIT_AT.map(function(soc,i){return [soc,rates[i]];})):null;
   if(points&&points.length!==EDIT_AT.length)points=null;
   out.push({id:'research:'+label,label:label,usable:usable,details:legacy?fields.slice(1):fields.slice(1,7),legacy:legacy,points:points,source:points?source:null});
   return out;
  },[]);
 }
 function installedResearch(car){
  var p=car&&car.dcResearchPack,key=researchKey(car);
  return p&&key&&p.key===key&&p.id===car.dcPack?p:null;
 }
 function selected(car){
  if(!car)return null;
  if(car.dcPack==='manual'){
   var points=clean(car.dcCurve),name=String(car.dcPackName||'').trim();
   return name&&!/^(unknown|automatic|factory estimate|other|n\/?a)$/i.test(name)&&points&&points[0][0]===0&&points[points.length-1][0]===100?{points:points,src:'user',label:name,peak:peak(points)}:null;
  }
  var research=installedResearch(car);
  if(research){
   var points=clean(car.dcCurve||research.points);
   return points&&points[0][0]===0&&points[points.length-1][0]===100?{points:points,src:car.dcCurve?'user':'research',label:research.label,peak:peak(points)}:null;
  }
  var available=packs(car),pack=available.find(function(p){return p.id===car.dcPack;});
  if(!pack&&!car.dcPack&&car.addMode==='ev'&&available.length===1)pack=available[0];
  if(!pack)return car.addMode==='evEff'||car.addMode==='evNone'?estimate(car):null;
  var override=clean(car.dcCurve);
  if(override&&(override[0][0]!==0||override[override.length-1][0]!==100))override=null;
  var points=override||pack.points||EDIT_AT.map(function(p,i){return [p,pack.kw[i]];});
  return {points:points,src:override?'user':'pack',pack:pack.id,label:pack.label+(override?' · edited':''),peak:peak(points),source:pack.source,usable:pack.usable||null,usableSource:pack.usable?pack.usableSource:null};
 }
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
 /** EVs without an established charging curve (Add Car → EV with an efficiency curve only / without curves): your
  *  typed curve, else Open EV Data's for this model, else a typical one at the peak you entered. Charging times from it
  *  are estimates (estimated: true). */
 var ESTIMATE_MARGIN=.85;
 function estimate(car){
  var mine=clean(car.dcCurve);
  if(mine&&mine[0][0]===0&&mine[mine.length-1][0]===100)return {points:mine,src:'user',label:'Your charging curve (estimate)',peak:peak(mine),estimated:true};
  // Cautious: an estimated curve charges 15% slower than its source says (ESTIMATE_MARGIN), so stops aren't planned short.
  var want=+car.dcKw||0,r=match(car),m=ESTIMATE_MARGIN;
  function slow(p){return p.map(function(x){return [x[0],Math.max(1,Math.round(x[1]*m*10)/10)];});}
  if(r){var pts=[];for(var i=0;i<r[5].length;i+=2)pts.push([r[5][i],r[5][i+1]]);pts=clean(pts);
   if(pts){var src=want?scale(pts,want):pts;return {points:slow(src),src:'data',label:'Estimated: Open EV Data '+label(r)+(want&&Math.abs(want-peak(pts))>=1?', scaled to your '+want+' kW peak':'')+', 15% slower for safety',peak:peak(slow(src)),row:r,estimated:true};}}
  var kw=want||150;
  return {points:slow(generic(kw)),src:'generic',label:'Estimated: a typical curve for a '+kw+' kW peak'+(want?'':' (no peak entered)')+', 15% slower for safety',peak:Math.round(kw*m*10)/10,estimated:true};
 }
 function label(r){return [r[0],r[1],r[2]].filter(Boolean).join(' ')+(r[3]?' ('+r[3]+')':'');}
 /** {points, src: 'user' | 'data' | 'generic', label, peak}: the curve the planner uses for this car. */
 var memo={key:'',val:null};
 function forCar(car,rows){
  var key=rows?'':JSON.stringify(car&&[car.make,car.model,car.trim,car.year,car.tank,car.dcKw,car.dcCurve,car.dcPack,car.dcPackName,car.dcResearchPack&&car.dcResearchPack.points,car.info&&car.info.drive,car.addMode]);
  if(key&&memo.key===key)return memo.val;
  var val=resolve(car,rows);if(key)memo={key:key,val:val};return val;
 }
 function resolve(car,rows){
  var chosen=selected(car);if(chosen)return chosen;
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
 var api={packs:packs,selected:selected,researchKey:researchKey,researchPacks:researchPacks,installedResearch:installedResearch,GENERIC:GENERIC,EDIT_AT:EDIT_AT,clean:clean,at:at,peak:peak,scale:scale,generic:generic,match:match,forCar:forCar,rows11:rows11,tokens:tokens};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ChargeCurve=api;
})(typeof window!=='undefined'?window:globalThis);
