// RestPlan (pure): a casual rest keeps the selected roads and splices only its verified access path, removing it restores
// the original road, departure colors use the free-flow time (never the least-bad congested sample), and hazard review
// after rests only asks about new places or worse conditions. Generic test coordinates only.
const assert=require('node:assert/strict'),T=require('../assets/web/trip'),P=require('../assets/web/restplan');
const car={city:30,hwy:30,comb:30},line=(pts,sec)=>{const mi=pts.slice(1).reduce((n,p,i)=>n+T.hav(pts[i],p),0);return {description:'Generic highway',distanceMeters:mi*1609.344,duration:sec+'s',polyline:{encodedPolyline:T.encodePolyline(pts)},legs:[{distanceMeters:mi*1609.344,duration:sec+'s',steps:[]}]};};
const pts=[{lat:34,lng:-92},{lat:34.1,lng:-92},{lat:34.2,lng:-92},{lat:34.3,lng:-92}],selected=line(pts,3600),route={stops:[{label:'Start',...pts[0]},{label:'End',...pts[3]}],legs:[{alts:[selected,line([pts[0],{lat:34.15,lng:-91.9},pts[3]],4000)],sel:0}]};
const m=T.buildRoute(selected,car),d=m.totalMi/2,at=m.pointAt(d),site={id:'s1',name:'Generic rest area',lat:at.lat,lng:at.lng+.01};
const access={outPts:[at,site],backPts:[site,at],outSeconds:90,backSeconds:90,outMeters:T.hav(at,site)*1609.344,backMeters:T.hav(at,site)*1609.344};
const ins=P.insert(route,selected,car,0,d,site,access,{minimumRest:30});
assert.equal(ins.route.stops.length,3);assert.equal(ins.route.stops[1].rest.pendingTiming,true);assert.equal(ins.index,1);
assert(Math.abs(ins.addedMinutes-33)<1e-6,'access out + back + minimum rest');
const nm=T.buildRoute(ins.raw,car);assert(nm.totalMi>m.totalMi&&nm.totalMi<m.totalMi+2*T.hav(at,site)+.05,'selected road plus the access spur, nothing rerouted');assert.equal(nm.legEnds.length,2);
assert.deepEqual(ins.route.stops[1].restoreLeg.alts[0],selected,'the replaced road is kept for removal');assert.equal(ins.route.legs[0].alts.length,1);
const rem=P.remove(ins.route,1);assert.equal(rem.route.stops.length,2);assert.equal(rem.restored,true);assert.deepEqual(rem.route.legs[0].alts[0],selected);
assert.throws(()=>P.remove(ins.route,0),/Not a rest stop/);
assert.throws(()=>P.insert(route,selected,car,0,d,site,{...access,outPts:[{lat:35,lng:-90},site]},{minimumRest:30}),/needs routing/,'an access path that does not touch the road is routed, not glued');
// colors
const z=P.zones([{depart:1,drivingMinutes:61,freeMinutes:60,coverage:1},{depart:2,drivingMinutes:80,freeMinutes:60,coverage:1},{depart:3,drivingMinutes:120,freeMinutes:60,coverage:1},{depart:4,drivingMinutes:null},{depart:5,drivingMinutes:61,freeMinutes:60,coverage:.7}],30);
assert.deepEqual(z.map(s=>s.zone),['green','yellow','red','unknown','yellow']);assert.equal(z[2].delayMinutes,60);
const allBusy=P.zones([{drivingMinutes:90,freeMinutes:60},{drivingMinutes:95,freeMinutes:60}],10);assert(allBusy.every(s=>s.zone==='red'),'congested at every checked time is never green');
assert.equal(P.zones([{drivingMinutes:50},{drivingMinutes:51}],10)[0].zone,'green','without a free-flow figure the best checked time is the reference');
const c=P.compact(Object.assign({profile:{rows:new Array(1000)}},z[1]));assert(!('profile' in c)&&c.zone==='yellow');
// hazard review
const rain={kind:'rain',level:2,fromMi:2,toMi:10},known=P.changedHazards([rain],m,[{...rain,fromMi:2.5,toMi:10.5}],nm);assert.equal(known.length,0,'same rain on the same road, shifted by the spur');
assert.equal(P.changedHazards([rain],m,[{...rain,level:3}],nm).length,1,'worse conditions are asked about');
assert.equal(P.changedHazards([rain],m,[{kind:'snow',level:2,fromMi:2,toMi:10}],nm).length,1,'a different hazard is asked about');
assert.equal(P.changedHazards([rain],m,[{...rain,fromMi:15,toMi:19}],nm).length,1,'a new place is asked about');
console.log('RestPlan: local insertion/removal, free-flow colors with gray unknowns, changed-only hazard review');

// Pending dwell starts after actual arrival, including a fuel stop before the rest.
{const opts={model:nm,rewardDepartAt:1700000000000,stopMinutes:8,waits:[{d:nm.legEnds[0],at:1700000000000+nm.timeTo(nm.legEnds[0])*1000+30*60000}]},plan={stops:[{c:{d:1,detourMin:5},buyGal:2}]},stops=ins.route.stops.map(p=>({...p,rest:p.rest?{...p.rest,minimumRest:30,maximumStay:120}:undefined})),waits=P.alignWaits(opts,plan,stops),t=T.scheduleTimeline({...opts,waits},plan);assert(t[1].depart>=t[0].arrive+30*60000);assert(waits[0].at>opts.waits[0].at,'refueling delays shift the minimum departure');assert.deepEqual(P.alignWaits({...opts,waits},plan,stops),waits,'alignment settles');}
