/* 0.0.346: per-source overnight-rate distribution for Settings → Rest stops.
   Owner: show, above each source's price slider, what limiting the price practically leaves, from the site info Gasket has
   already stored. Built from places seen in rest searches (KV restplaces 'price-dist|<source>'), never a network read.
   A place's value is its checkable nightly maximum (the number CampPrice compares with your limit); places whose price
   can't be checked are counted apart (they're hidden whenever a limit is on). */
(function(root){'use strict';
 var SOURCES=['ridb','rvparky','campendium'],MAX=4000,STEP=5,TOP=100;
 function cp(){return root.CampPrice||(typeof require==='function'?require('./campprice'):null);}
 // nightly maximum when it can be checked against a limit, else null
 function value(p){if(!p)return null;var c=cp().check(p,{maxNightly:1e9});if(c.unknown||!c.ok)return null;var q=p.userPriceQuote&&!p.userPriceQuote.unknown?{max:p.userPriceQuote.totalMax/Math.max(1,p.userPriceQuote.nights||1)}:p.feeRange||p.nightlyRate||(p.price!=null?{max:p.price}:null);return q&&Number.isFinite(+q.max)&&+q.max>=0?+q.max:null;}
 function sourceOf(p){var id=String(p&&p.id||'');return id.indexOf('rvparky:')===0?'rvparky':id.indexOf('campendium:')===0?'campendium':p&&(p.source==='Recreation.gov'||p.ridb||/^ridb:|^rec:/.test(id)||p.recreation)?'ridb':null;}
 function load(KV,src){var r=KV.get('restplaces','price-dist|'+src);return r&&r.v&&r.v.ids?r.v:{ids:{},order:[]};}
 // places: effective site records; only campground-capable sources with price controls are kept
 function record(KV,places){var bySrc={};(places||[]).forEach(function(p){var s=sourceOf(p);if(!s||!p.id)return;(bySrc[s]=bySrc[s]||[]).push(p);});
  Object.keys(bySrc).forEach(function(s){var d=load(KV,s),changed=false;bySrc[s].forEach(function(p){var v=value(p),k=String(p.id);if(!(k in d.ids))d.order.push(k);if(d.ids[k]!==(v==null?-1:v)){d.ids[k]=v==null?-1:v;changed=true;}});
   while(d.order.length>MAX){delete d.ids[d.order.shift()];changed=true;}if(changed)KV.put('restplaces','price-dist|'+s,d);});}
 function summary(KV,src){var d=load(KV,src),known=[],unknown=0;Object.keys(d.ids).forEach(function(k){var v=d.ids[k];if(v<0)unknown++;else known.push(v);});return {known:known,unknown:unknown};}
 // bins: Free, then $5 steps to $100, then $100+
 function bins(known){var n=TOP/STEP,b=[{lo:0,hi:0,label:'Free',n:0}];for(var i=0;i<n;i++)b.push({lo:i*STEP,hi:(i+1)*STEP,n:0});b.push({lo:TOP,hi:Infinity,label:TOP+'+',n:0});
  known.forEach(function(v){if(v<=0)b[0].n++;else if(v>TOP)b[b.length-1].n++;else b[Math.ceil(v/STEP)].n++;});return b;}
 function within(known,limit){return known.filter(function(v){return v<=limit+1e-8;}).length;}
 function html(sum,limit,name,esc){esc=esc||String;var b=bins(sum.known),max=Math.max.apply(null,b.map(function(x){return x.n;})),W=300,H=96,base=74,bw=W/b.length,on=limit!=null,empty=!sum.known.length&&!sum.unknown;
  var bars=b.map(function(x,i){var h=max?Math.max(x.n?2:0,Math.round((base-6)*x.n/max)):0,fit=!on||x.hi<=limit+1e-8&&(x.lo<limit||x.hi===0&&limit>=0)||x.hi===0;return '<rect class="rpd-bar'+(fit?' fit':'')+'" x="'+(i*bw+1).toFixed(1)+'" y="'+(base-h)+'" width="'+(bw-2).toFixed(1)+'" height="'+h+'"><title>'+esc((x.label==='Free'?'Free':x.hi===Infinity?'Over $'+TOP:'$'+x.lo+'–$'+x.hi)+': '+x.n)+'</title></rect>';}).join('');
  var ticks=[[0,'Free','start'],[5,'$20','middle'],[9,'$40','middle'],[13,'$60','middle'],[17,'$80','middle'],[b.length,'$100+','end']].map(function(t){return '<text x="'+(t[0]*bw).toFixed(1)+'" y="'+(base+16)+'" text-anchor="'+t[2]+'">'+t[1]+'</text>';}).join('');
  var mark=on&&!empty?(function(){var x=limit<=0?bw:limit>=TOP?(b.length-1)*bw:(1+limit/STEP)*bw;return '<line class="rpd-limit" x1="'+x.toFixed(1)+'" x2="'+x.toFixed(1)+'" y1="4" y2="'+base+'"/>';})():'';
  var svg='<svg class="rpd-chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(name+' nightly rates of stored places')+'"><line class="rpd-base" x1="0" x2="'+W+'" y1="'+base+'" y2="'+base+'"/>'+bars+mark+ticks+(empty?'<text class="rpd-empty" x="'+W/2+'" y="'+(base/2+4)+'" text-anchor="middle">No stored places yet</text>':'')+'</svg>';
  var cap=empty?'Have Gasket search for some rest stops (a trip’s Stops → Rest stops) to fill this chart with '+esc(name)+'’s rates.':(sum.known.length?(on?within(sum.known,limit)+' of '+sum.known.length+' places with a checkable rate fit $'+(+limit).toFixed(2)+'.':sum.known.length+' stored places with a checkable rate.'):'No stored place has a checkable rate yet.')+(sum.unknown?' '+sum.unknown+' more have no checkable price'+(on?' and are hidden.':' (hidden once you set a limit).'):'');
  return '<div class="rpd" data-rpd="'+esc(name)+'"><p class="rpd-title">Nightly rates Gasket has seen</p>'+svg+'<p class="lead small keep rpd-cap">'+cap+'</p></div>';}
 var api={SOURCES:SOURCES,value:value,sourceOf:sourceOf,record:record,summary:summary,bins:bins,within:within,html:html};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RestPriceDist=api;
})(typeof window==='undefined'?globalThis:window);
