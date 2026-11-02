/* Offline timezone estimates. Explicit/provider-saved zones take precedence.
 * Ambiguous boundary neighborhoods defer to the existing exact online lookup. */
(function(root){'use strict';
 var node=typeof module!=='undefined'&&module.exports,lookup=node?require('./vendor/tz-lookup'):root.tzlookup,memo=new Map(),validZones=new Set();
 function resolve(p){if(!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180||!lookup)return null;var k=p.lat.toFixed(5)+'|'+p.lng.toFixed(5);if(memo.has(k))return memo.get(k);var z=null;try{z=lookup(p.lat,p.lng);for(var dy of [-.03,0,.03])for(var dx of [-.03,0,.03]){var lat=Math.max(-90,Math.min(90,p.lat+dy)),lng=((p.lng+dx+540)%360)-180;if(lookup(lat,lng)!==z)z=null;}if(z&&!validZones.has(z)){new Intl.DateTimeFormat('en-US',{timeZone:z});validZones.add(z);}}catch(e){z=null;}if(memo.size>=12000)memo.delete(memo.keys().next().value);memo.set(k,z);return z;}
 var api={resolve:resolve};if(node)module.exports=api;else root.PointZone=api;
})(typeof window!=='undefined'?window:this);
