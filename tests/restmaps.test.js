const assert=require('node:assert/strict'),fs=require('node:fs'),M=require('../assets/web/restmaps');
const site={id:'sample',name:'Sample Woods Rest Area',lat:35,lng:-92,direction:'N'},row={primary:true,name:site.name,url:'https://www.google.com/maps/place/Sample/data=!3d35!4d-92',lat:35,lng:-92};
assert.equal(M.closure('Closed · Opens 8 AM'),null);assert.equal(M.closure('Temporarily closed'),'temporarily_closed');assert.equal(M.closure('Permanently closed'),'permanently_closed');
assert(M.choose(site,[row]));assert(M.choose(site,[row,{...row,url:row.url+'?hl=en'}]),'duplicate canonical/location links are one listing');assert(!M.url('https://www.google.com/maps/search/?api=1&query=rest'));
assert(!M.url('javascript:alert(1)'));assert(!M.url('https://evil.test/maps/place/Fake'));
assert.equal(M.choose(site,[{...row,name:'Sample Woods southbound rest area'}]),null);assert.equal(M.choose(site,[{...row,url:'https://www.google.com/maps/place/Far/data=!3d36!4d-92'}]),null);assert.equal(M.choose(site,[row,{...row,name:'Sample Woods Rest Area North',url:row.url+'!1sother'}]),null,'ambiguous listings need review');
assert.equal(M.choose(site,[{...row,name:'Completely unrelated rest area'}]),null);assert.equal(M.choose({...site,name:'Walmart',kind:'private'},[{...row,name:'Walmart Fuel Station'}]),null,'fuel listing is not the store parking place');
(async()=>{let reads=0,active=0,peak=0;const kv=new Map(),create=()=>M.create({get:k=>kv.get(k),put:(k,v)=>kv.set(k,v),read:async()=>{reads++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return {complete:true,places:[row]};},blocked:()=>assert.fail('unexpected check')});let service=create();assert.equal((await service.resolve(site)).state,'found');service=create();assert.equal((await service.resolve(site)).state,'found');assert.equal(reads,1,'persisted Maps page reused across trips');
 const other={...site,id:'another'};await Promise.all([service.resolve({...site,id:'second'}),service.resolve(other)]);assert.equal(peak,1,'one Maps reader, no parallel browser fanout');
 let checks=0,ask=0;let flow=M.create({get:()=>null,put:()=>{},read:async()=>{ask++;return ask===1?{blocked:true}:{complete:true,places:[row]};},blocked:()=>{checks++;}});const a=flow.resolve(site),b=flow.resolve(other);await new Promise(r=>setTimeout(r,5));assert.equal(ask,1);assert.equal(checks,1);flow.resume(true);assert.equal((await a).state,'found');assert.equal((await b).state,'found');
 ask=0;flow=M.create({get:()=>null,put:()=>{},read:async()=>{ask++;return {blocked:true};},blocked:()=>{}});const c=flow.resolve(site),d=flow.resolve(other);await new Promise(r=>setTimeout(r,5));flow.resume(false);assert.equal((await c).state,'unknown');assert.equal((await d).state,'unknown');assert.equal(ask,1,'dismissal pauses queued lookups too');
 const failed=M.create({get:()=>null,put:()=>assert.fail('failure must not be stored as absent'),read:async()=>({error:'timeout'}),blocked:()=>{}});assert.equal((await failed.resolve(site)).state,'unknown');
 const app=fs.readFileSync('assets/web/app.js','utf8'),native=fs.readFileSync('src/com/bensanzone/fuelmap/MainActivity.java','utf8');assert.match(app,/if\(key==='restmaps'\).*restmapsverified.*return/);assert.match(app,/restmapscancel/);assert.match(native,/"restmaps"\.equals\(key\).*url\.startsWith\("https:\/\/www\.google\.com\/maps\/search\/\?api=1&query="\)/);new Function('return ('+fs.readFileSync('assets/restmaps_worker.js','utf8')+')');
 console.log('Rest Maps: strict page identity, proximity/direction/ambiguity, durable reuse, single reader, pause/resume/dismiss and no false negative caching passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
(()=>{// owner (0.0.508 phone): U.S. DOT's "I-71 North Oldham County Rest Area" is "I 71 Oldham Rest Area" on Google Maps (temporarily closed there)
 const old={id:'ntad:900',name:'I-71 North Oldham County Rest Area',lat:38.33852799,lng:-85.5161140000042,highway:'I-71'};
 assert.deepEqual(M.queries(old).map(q=>q.name),['I-71 North Oldham County Rest Area','I-71 Oldham Rest Area','I-71 North Oldham County Rest Area NB','I-71 North Oldham County Rest Area SB','I-71 rest area']);
 const at=(name,lat,lng)=>({name,url:'https://www.google.com/maps/place/'+encodeURIComponent(name)+'/data=!3d'+lat+'!4d'+lng,primary:true,closure:'temporarily_closed'});
 const hit=M.choose(old,[at('I 71 Oldham Rest Area',38.3427,-85.5132)]);assert(hit,'same highway + county name + rest area within 0.75 mi');assert.equal(hit.closure,'temporarily_closed');
 assert(!M.choose(old,[at('I 71 Oldham Rest Area',38.355,-85.51)]),'over 0.75 mi stays unmatched');
 assert(!M.choose(old,[at('I 71 Henry Rest Area',38.3427,-85.5132)]),'another place on the same highway is not this one');
 assert(!M.choose(old,[at('I 64 Oldham Rest Area',38.3427,-85.5132)]),'another highway is not this one');
 assert(!M.choose(old,[at('Oldham Gas Station',38.3388,-85.5161)]),'not a rest area');
 assert.equal(M.queries({...old,id:'osm:node:1'}).length,1,'other sources: own name only');
 console.log('Maps names without direction / county words (I-71 Oldham) passed');
})();

const ardsley={id:'ntad:1882',name:'Ardsley Travel Plaza',lat:40.9824,lng:-73.854,direction:'N'};const ardsleyPage={name:ardsley.name,url:'https://www.google.com/maps/place/Ardsley+Travel+Plaza/data=!3d40.984875!4d-73.852596'};assert(M.choose(ardsley,[ardsleyPage]),'exact-name plaza matches its measured inventory-to-entrance displacement');assert.equal(M.choose(ardsley,[{...ardsleyPage,name:'Different Travel Plaza'}]),null,'wider tolerance requires exact identity');
(async()=>{
 let time=Date.UTC(2030,0,1),reads=[],status='temporarily_closed',fail=false;const kv=new Map(),io={now:()=>time,get:k=>kv.get(k),put:(k,v)=>kv.set(k,structuredClone(v)),read:async q=>{reads.push(q);if(fail)throw Error('Network timeout');return {complete:true,places:[{...row,primary:!!q.mapsLookupUrl,closure:q.mapsLookupUrl?status:null}]};}},make=()=>M.create(io);let m=make();let r=await m.resolve(site);assert.equal(reads.length,2,'search result is followed to its matched detail page');assert.equal(reads[1].mapsLookupUrl,row.url);assert.equal(r.closure,'temporarily_closed');m=make();const own={...site,mapsUri:row.url};assert.equal(m.peek(own).closure,'temporarily_closed','saved identity does not discard closure metadata');await m.resolve(own);assert.equal(reads.length,2,'fresh changing status reused across restart');
 time+=48*3600000;fail=true;assert(m.needsStatus(own));r=await m.resolve(own);assert.equal(r.closure,'temporarily_closed','failed refresh retains a known closure');assert.match(r.statusError,/timeout/);assert(!m.needsStatus(own),'failed refresh has retry backoff');m=make();assert.equal(m.peek(own).closure,'temporarily_closed','durable old closure survives a failed refresh and restart');
 fail=false;status=null;r=await m.resolve(own,null,true);assert.equal(r.closure,null,'fresh primary page can clear a previous closure');assert.equal(reads.at(-1).mapsLookupUrl,row.url,'status refresh uses the stored page identity');status='permanently_closed';r=await m.resolve(own,null,true);assert.equal(r.closure,status);assert.equal(r.statusCheckedAt,time);
 console.log('Matched detail-page closure, 48-hour refresh, durable status, reopen and failed-refresh retention passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
(async()=>{// 0.0.335 (owner: "Ohio Turnpike Plaza" only shows up on Maps with its direction): a U.S. DOT/BTS place with no direction is searched again
 // with EB / WB (even highway number) after its own name finds nothing; the first direction that finds a listing is kept
 const plaza={id:'ntad:77',name:'Ohio Turnpike Plaza',lat:41.3,lng:-81.6,highway:'I-80'};
 assert.deepEqual(M.queries(plaza).map(q=>q.name),['Ohio Turnpike Plaza','Ohio Turnpike Plaza EB','Ohio Turnpike Plaza WB']);
 assert.deepEqual(M.queries({...plaza,highway:'I-71'}).map(q=>q.name).slice(1),['Ohio Turnpike Plaza NB','Ohio Turnpike Plaza SB'],'odd = north/south');
 assert.deepEqual(M.queries({...plaza,direction:'W'}).map(q=>q.name).slice(1),['Ohio Turnpike Plaza WB'],'known direction only');
 assert.equal(M.queries({...plaza,highway:null}).length,5,'unknown highway: all four');assert.equal(M.queries({...plaza,id:'osm:node:1'}).length,1,'other sources: own name only');
 assert.deepEqual(M.queries({...plaza,name:'Ohio Turnpike Plaza EB'}).map(q=>q.name),['Ohio Turnpike Plaza EB','Ohio Turnpike Plaza'],'name already has a direction: no NB/SB/EB/WB variants, only the name without it');
 const asked=[],kv=new Map(),page={primary:true,name:'Ohio Turnpike Plaza WB',url:'https://www.google.com/maps/place/Ohio+Turnpike+Plaza+WB/data=!3d41.3003!4d-81.6004'};
 // 0.0.516: a U.S. DOT/BTS place is looked up once, by Maps' nearby "rest area" search at its coordinates (other sources still use the name queries)
 const s=M.create({get:k=>kv.get(k),put:(k,v)=>kv.set(k,v),read:async q=>{asked.push(q);return {complete:true,places:q.nearby?[page]:[]};},blocked:()=>assert.fail('no check')});
 const got=await s.resolve(plaza);assert.equal(got.state,'found');assert.equal(asked.length,1);assert(asked[0].nearby);assert.equal(asked[0].name,'Ohio Turnpike Plaza');
 const named=[],s2=M.create({get:()=>null,put:()=>{},read:async q=>{named.push(q.name);return {complete:true,places:/WB$/.test(q.name)?[page]:[]};},blocked:()=>assert.fail('no check')});
 assert.equal((await s2.resolve({...plaza,id:'rvparky:77',highway:'I-80'})).state,'notfound','other sources: own name only');assert.deepEqual(named,['Ohio Turnpike Plaza']);
 assert(M.choose({...plaza,direction:'W'},[page]),'exact name with its direction suffix matches');assert.equal(M.choose({...plaza,direction:'E'},[page]),null,'opposite direction rejected');
 const none=M.create({get:()=>null,put:()=>{},read:async()=>({complete:true,places:[]}),blocked:()=>{}});assert.equal((await none.resolve({...plaza,id:'ntad:78'})).state,'notfound');
 console.log('Direction-suffixed Maps searches for U.S. DOT/BTS rest areas passed');})().catch(e=>{console.error(e);process.exitCode=1;});

// Names can differ by punctuation or omit part of a source label at a nearby pin.
{const pin=(name,lat=35,lng=-92)=>({name,url:'https://www.google.com/maps/place/Test/data=!3d'+lat+'!4d'+lng});
 assert(M.choose({...site,name:'I-71 Rest Area'},[pin('I71 Rest Area')]));
 assert(M.choose({...site,name:'Interstate 71 Rest Area'},[pin('I-71 Rest Stop')]));
 assert(M.choose({...site,name:'Sample Woods Rest Area'},[pin('Woods Rest Stop',35.0003)]));
 assert(M.choose({...site,name:'Pennyrile Forest State Park Campground',kind:'campground'},[pin('Pennyrile Campground',35.0004)]));
 assert(!M.choose({...site,name:'I-71 Rest Area'},[pin('I75 Rest Area')]),'different highway numbers are not interchangeable');
 assert(!M.choose({...site,name:'I-71 Rest Area'},[pin('I71 Rest Area SB')]),'punctuation normalization cannot bypass direction');
 assert(!M.choose({...site,name:'Sample Woods Rest Area'},[pin('Woods Rest Stop',35.005)]),'partial text needs a close pin');
 assert(!M.choose({...site,name:'Sample Woods Campground',kind:'campground'},[pin('Unrelated Campground')]),'generic facility words are insufficient');
 assert(!M.choose({...site,name:'Sample Woods Rest Area'},[pin('Woods Rest Stop',35.0003),pin('Woods Rest Stop',34.9997)]),'equally close partial matches stay ambiguous');
 console.log('Nearby partial names and I71/I-71 normalization preserve highway, direction, generic-name and ambiguity safeguards');
}

// User choice is explicit identity evidence even when the displayed name differs.
{const store=new Map(),io={get:k=>store.get(k),put:(k,v)=>store.set(k,v),now:()=>123456789,read:async()=>({complete:true,places:[]})},picker=M.create(io),choice={url:row.url,name:'Different listing title',closure:'temporarily_closed'};
 picker.select(site,choice);assert.equal(picker.peek(site).url,choice.url);assert.equal(picker.peek(site).closure,'temporarily_closed');assert(picker.peek(site).userSelected);assert.equal(M.create(io).peek(site).name,choice.name);assert.throws(()=>picker.select(site,{url:'https://evil.test/maps/place/no'}));}

// 0.0.516: nearby "rest area" search at the coordinates, picked by category, direction, road and name words
{const oldham={id:'ntad:900',name:'I-71 North Oldham County Rest Area',lat:38.4,lng:-85.4,direction:'N',highway:'I-71'};
 const u=r=>'https://www.google.com/maps/search/?api=1&query=x&query_place_id='+r;
 const own={name:'I 71 oldham rest area',lat:38.4004,lng:-85.4,cats:['Rest stop'],url:u('ChIJaaaaaaaaaaaa'),closure:'temporarily_closed'},
  sb={name:'Southbound Rest Area',lat:38.4,lng:-85.4012,cats:['Rest stop'],url:u('ChIJbbbbbbbbbbbb')},
  lot={name:'Parking lot',lat:38.4001,lng:-85.4001,cats:['Parking lot'],url:u('ChIJcccccccccccc')},
  weigh={name:'Oldham weigh station',lat:38.4001,lng:-85.4,cats:['Weigh station'],url:u('ChIJdddddddddddd')},
  far={name:'I 71 oldham rest area',lat:38.42,lng:-85.4,cats:['Rest stop'],url:u('ChIJeeeeeeeeeeee')},
  other={name:'I 65 rest area',lat:38.4002,lng:-85.4,cats:['Rest stop'],url:u('ChIJffffffffffff')};
 const got=M.pick(oldham,[sb,lot,weigh,other,own]);assert.equal(got.url,own.url,'own direction, own road, place words');assert.equal(got.closure,'temporarily_closed');
 assert.equal(M.pick(oldham,[sb]),null,'the opposite direction is never taken');
 assert.equal(M.pick(oldham,[weigh]),null,'a weigh station is only for weigh sites');
 assert.equal(M.pick(oldham,[far]),null,'too far from the inventory point');
 assert.equal(M.pick(oldham,[other]),null,'another highway');
 assert.equal(M.pick({...oldham,name:'Sample Weigh Station'},[weigh]).url,weigh.url);
 assert.equal(M.pick({...oldham,direction:null,name:'Rest Area',highway:''},[{...sb,name:'Rest area A',lat:38.4015,lng:-85.4},{...own,name:'Rest area B',lat:38.3985,lng:-85.4}]),null,'two equal unrelated answers far apart: none');
 assert.equal(M.nearbyUrl(oldham),'https://www.google.com/maps/search/rest+area/@38.400000,-85.400000,15z?hl=en');
 assert.deepEqual(M.nearbyQueries(oldham),['rest area','parking']);assert.deepEqual(M.nearbyQueries({name:'Sidney Weigh Station'}),['rest area','weigh station']);
 const java=fs.readFileSync(__dirname+'/../src/com/bensanzone/fuelmap/MainActivity.java','utf8');assert(java.includes('maps/search/rest\\\\+area/@'),'native allows the nearby page');}
