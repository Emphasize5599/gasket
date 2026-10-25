/* Marketing labels are separate from the EPA's lookup values and record IDs. */
(function(root){'use strict';
 function tesla(c){return !!c&&/^tesla$/i.test(String(c.make||'').trim())&&/^model\s+(?:3|y)\b/i.test(String(c.model||c.vpicModel||'').trim());}
 function premium(s){return String(s||'').replace(/\b(?:premium\s+)?long\s+range\b/ig,'Premium');}
 function display(c,s){return tesla(c)&&+c.year>=2026?premium(s):String(s||'');}
 // Photo catalogs may use either name, regardless of the EPA's model-year label.
 function photo(c,s){return tesla(c)?premium(s):String(s||'');}
 var api={tesla:tesla,display:display,photo:photo};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.VehicleNames=api;
})(typeof window!=='undefined'?window:globalThis);
