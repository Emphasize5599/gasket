async function(reqId,args){
 const start=Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms));let last='',stable=0;
 const send=r=>GasketSite.result(reqId,JSON.stringify(r));
 const blockedNow=()=>{const body=document.body&&document.body.innerText||'',href=location.href;if(/\/sorry\/|consent\.google/.test(href)||/unusual traffic|not a robot|verify (?:that )?you are human|before you continue to Google|access denied/i.test(body)){send({blocked:true,verificationUrl:/^https:\/\/(www|consent)\.google\.com\//.test(href)?href:null});return true;}return false;};
 // 0.0.516: the coordinates' "rest area" search page (Nearby); read the page's own search answer and replay it with other words
 if(args.mode==='nearby'){
  const isSearch=r=>{try{const u=new URL(r.name);return u.origin==='https://www.google.com'&&u.pathname==='/search'&&u.searchParams.get('tbm')==='map'&&/rest area/i.test(u.searchParams.get('q')||'');}catch(_){return false;}};
  const parse=raw=>{const body=raw.replace(/^\)\]\}'\s*/,'').trim();if(body[0]!=='['&&body[0]!=='{')throw Error('Unexpected search answer');let l=0,q=false,e=false,end=-1;for(let i=0;i<body.length;i++){const c=body[i];if(q){if(e)e=false;else if(c==='\\')e=true;else if(c==='"')q=false;continue;}if(c==='"'){q=true;continue;}if(c==='['||c==='{')l++;else if(c===']'||c==='}'){if(--l===0){end=i+1;break;}}}let j=JSON.parse(body.slice(0,end));if(typeof j[0]==='string'&&/^\)\]\}'/.test(j[0]))j=JSON.parse(j[0].replace(/^\)\]\}'\s*/,''));return j;};
  const fetchText=async name=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),10000);try{const r=await fetch(name,{credentials:'include',cache:'force-cache',signal:c.signal});if(r.status===403||r.status===429||/\/sorry\/|consent\.google/.test(r.url))throw Object.assign(Error('Google restricted the search'),{blocked:true});if(!r.ok)throw Error('HTTP '+r.status);const raw=await r.text();if(raw.length>5000000)throw Error('Search answer too large');if(/unusual traffic|g-recaptcha|before you continue to Google/i.test(raw.slice(0,16000)))throw Object.assign(Error('Google needs verification'),{blocked:true});return raw;}finally{clearTimeout(t);}};
  const site=args.site||{},rows=new Map();
  const hav=(a,b)=>{const r=Math.PI/180,d=(b.lat-a.lat)*r,g=(b.lng-a.lng)*r,x=Math.sin(d/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(g/2)**2;return 3958.7613*2*Math.atan2(Math.sqrt(Math.max(0,x)),Math.sqrt(Math.max(0,1-x)));};
  const add=raw=>{const tree=parse(raw),list=tree&&tree[64];if(list==null)return 0;if(!Array.isArray(list))throw Error('Search answer schema changed');let n=0;for(const item of list){const r=item&&item[1],point=r&&r[9],name=r&&r[11],id=r&&r[10];if(!Array.isArray(r)||typeof name!=='string'||!Array.isArray(point)||!Number.isFinite(point[2])||!Number.isFinite(point[3]))continue;const at={lat:point[2],lng:point[3]};if(hav(site,at)>.6)continue;const pid=typeof r[78]==='string'&&/^[A-Za-z0-9_-]{10,200}$/.test(r[78])?r[78]:'',cid=typeof id==='string'&&/^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(id)?BigInt(id.split(':')[1]).toString():'';if(!pid&&!cid)continue;const key=pid||cid;if(rows.has(key))continue;
    let closed=null,nodes=0;const check=x=>{if(++nodes>200000||closed)return;if(typeof x==='string'){const m=/^(permanently|temporarily) closed$/i.exec(x.trim());if(m)closed=m[1].toLowerCase()+'_closed';}else if(Array.isArray(x))x.forEach(check);};check(r);
    rows.set(key,{name:name,lat:at.lat,lng:at.lng,cats:Array.isArray(r[13])?r[13].filter(c=>typeof c==='string').slice(0,8):[],url:pid?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(name)+'&query_place_id='+encodeURIComponent(pid):'https://www.google.com/maps?cid='+cid,closure:closed,primary:false});n++;}return n;};
  let tmpl=null;
  while(Date.now()-start<15000){if(blockedNow())return;const e=performance.getEntriesByType('resource').filter(isSearch).pop();if(e){tmpl=e.name;break;}await sleep(250);}
  if(!tmpl){send({error:'Maps nearby search did not answer',code:'no_feed'});return;}
  const asked=[];
  try{
   for(const q of (args.queries&&args.queries.length?args.queries:['rest area'])){
    if(asked.length&&RestMaps.pick(site,Array.from(rows.values())))break;
    const u=new URL(tmpl);if(q!=='rest area'){const pb=u.searchParams.get('pb')||'';if(!/!1s[^!]*/.test(pb))break;u.searchParams.set('pb',pb.replace(/!1s[^!]*/,'!1s'+encodeURIComponent(q).replace(/%20/g,'+')));u.searchParams.set('q',q);}
    add(await fetchText(u.href));asked.push(q);
   }
  }catch(e){if(e.blocked){send({blocked:true,verificationUrl:null});return;}if(!rows.size){send({error:String(e.message||e).slice(0,120),code:'reader'});return;}}
  send({places:Array.from(rows.values()),complete:true,detail:{asked:asked,found:rows.size,ms:Date.now()-start}});return;
 }
 while(Date.now()-start<18000){
  if(blockedNow())return;
  const body=document.body&&document.body.innerText||'',href=location.href;
  const places=RestMaps.extract(document,href);
  const signature=JSON.stringify(places.map(p=>[p.url,p.name,p.closure,p.primary]));stable=signature===last?stable+1:0;last=signature;
  // a place page (a stored identity or a nearby match): its own place once settled
  if(args.mode==='place'){const own=places.filter(p=>p.primary);if(own.length&&stable>=2){send({places:own,complete:true});return;}await sleep(500);continue;}
  const match=RestMaps.choose(args.site,places);
  if(match&&stable>=3){send({places:[match],complete:true});return;}
  if(!match&&(/no results found|couldn.t find|can.t find/.test(body.toLowerCase())||places.length&&stable>=4)){send({places,complete:true});return;}
  await sleep(500);
 }
 send({error:'Maps lookup did not finish',code:'timeout'});
}
