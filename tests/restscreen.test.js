const assert=require('node:assert/strict'),R=require('../assets/web/restscreen');let saved=null;const io={load:()=>saved,save:v=>saved=JSON.parse(JSON.stringify(v))};
// 0.0.355: no screening hold; hidden places persist per trip signature.
let s=R.create(io);s.sync('trip-a',['one','two']);assert.equal(s.holding(),false,'nothing waits for a screening step');s.hide('one',true);assert(s.hidden('one'));assert.equal(s.count(),1);
s=R.create(io);s.sync('trip-a',['one','two','three']);assert(s.hidden('one'),'hidden places are remembered for this trip, even with new candidates');assert.equal(s.holding(),false);
s.hide('one',false);assert(!s.hidden('one'));s.hide('two',true);s.restore();assert.equal(s.count(),0);
s.hide('two',true);s.sync('trip-b',['two']);assert(!s.hidden('two'),'another trip has its own hidden places');
console.log('Hidden rest candidates persist per trip without a screening hold');
