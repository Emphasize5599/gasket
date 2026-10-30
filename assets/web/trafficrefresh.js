/* Stop-aware refresh uses the existing station inventory; no discovery callback. */
(function(root){'use strict';
 async function run(c){var opts=c.options(),plan=c.previous,passes=0;for(var i=0;i<2;i++){if(!c.valid())throw Error('Traffic refresh cancelled');var before=c.stops(plan,opts);var m=await c.forecast(before,opts,i);if(!c.valid())throw Error('Traffic refresh cancelled');opts=c.apply(opts,m);plan=await c.plan(opts);passes++;if(!c.valid())throw Error('Traffic refresh cancelled');if(!plan.ok||JSON.stringify(before)===JSON.stringify(c.stops(plan,opts)))break;}return {opts:opts,plan:plan,passes:passes};}
 var api={run:run};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TrafficRefresh=api;
})(typeof window==='undefined'?globalThis:window);
