const assert=require('node:assert/strict'),P=require('../assets/web/pricing'),E=require('../assets/web/tripeta');
const now=Date.parse('2026-10-23T18:00:00Z'),hour=3600000;
assert(P.priceFresh({price:3,updated:null,observedAt:now-hour},24,now),'unknown pump time uses recorded time');
assert(!P.priceFresh({updated:null,observedAt:now-25*hour},24,now));
assert(!P.priceFresh({updated:new Date(now-25*hour).toISOString(),observedAt:now},24,now),'fresh retrieval does not replace a known old pump-update time');
assert(P.priceFresh({updated:'invalid',observedAt:now-hour},24,now));assert(!P.priceFresh({},24,now));assert(!P.priceFresh({updated:now+hour},24,now));assert(P.priceFresh({updated:now-24*hour},24,now));
const one={computeMs:10000,network:[{key:'shared-area',ms:20000}]},two={computeMs:15000,network:[{key:'shared-area',ms:20000},{key:'other-area',ms:30000}]};
assert.equal(E.batch([one,two]).ms,75000,'shared discovery once, vehicle computations separately');assert.equal(E.batch([one,{computeMs:15000,network:[]}]).ms,45000,'cached second vehicle needs compute but not discovery');assert.match(E.batch([one,two]).text,/estimated total/);console.log('Batch cache freshness boundaries, unknown timestamps and shared-work total estimates passed');
