const assert=require('node:assert/strict'),P=require('../assets/web/campprice');
assert.deepEqual(P.range('$13–26 / night'),{min:13,max:26});
assert.deepEqual(P.range('Free'),{min:0,max:0});
for(const s of ['free WiFi','$','$$','Free maps','$10 entrance fee','$10 May–September'])assert.equal(P.range(s),null,s);
assert(!P.check({price:null},{maxNightly:20}).ok);
assert(P.check({nightlyRate:{min:12,max:20}},{maxNightly:20}).ok);
assert(!P.check({nightlyRate:{min:12,max:21}},{maxNightly:20}).ok);
assert(!P.check({nightlyRate:{min:0,max:0},priceUnverified:true},{freeOnly:true}).ok);
assert.equal(P.detail({description:'Free maps are available at the visitor center.'}).price,null);
assert.equal(P.detail({description:'Any visitor is welcome to camp at no cost.'}).price,0);
assert.equal(P.detail({description:'Camping is free during winter; seasonal fees apply.'}).price,null);
assert.equal(P.detail({description:'Camping is free.',seasonal:true}).price,null);
assert.equal(P.detail({reportedRate:36,reportedAt:'2020-01-01'}).price,null);
assert.equal(P.detail({reportedRate:36,reportedAt:new Date(Date.now()-86400000).toISOString()}).price,36);
// Short provider fee statements from the seasonal-place review; never turn a permit's amortized report into a nightly quote.
for(const description of ['Sno Park Pass required November 1 to April 30','A Recreation Permit is required September 15th - April 15th.','Camping is free May 1 through October 31.','Camping is free. A permit costs $40 for 14 days.']){
 const p=P.detail({description,reportedRate:0,reportedAt:new Date().toISOString()});
 assert.equal(p.price,null,description);assert(p.priceUnverified);assert.match(p.priceNotes,/Season-dependent fee/);
}
console.log('Provider price evidence distinguishes actual rates, seasonal/old reports, unknown prices and category labels');
