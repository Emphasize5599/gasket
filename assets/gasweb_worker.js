// Independently implemented reader of a Google Maps page's own gas-search response.
// No Vela code, protobuf templates, calibration files or libraries are included.
async function (reqId, args) {
  let sent = false,feedObserver=null,observedFeed=null,cardsParsed=0,cardsSkipped=0,scrollEvents=0;
  const seenCards=new WeakMap(),dirtyCards=new WeakSet();
  const send = (r) => { if (!sent) { sent = true; if(feedObserver)feedObserver.disconnect(); GasketSite.result(reqId, JSON.stringify(r)); } };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const started = Date.now(), rows = new Map(), prices = new Map();
  const discovery=args.mode==='discover',deadline=discovery?180000:30000;
  const bulkSize=args.searchMethod==='commands20'?20:100;
  let commandReused=false,bulkOutside=0,bulkAttempted=false,bulkPages=0,bulkRows=0,bulkMs=0,bulkFallback='',exhausted=false,stopReason='deadline',lastGrowth=Date.now(),firstFeedAt=0,firstReplyAt=0,replies=0;   // timings for the debug log
  let loaded = false, responseRead = false, limited = false, rejected = 0;
  let targetsComplete = false;
  const requested=['regular','midgrade','premium','diesel'].includes(args.grade)?args.grade:'regular';
  const gradeNames={'regular':'regular','regular unleaded':'regular','midgrade':'midgrade','mid-grade':'midgrade','mid grade':'midgrade','premium':'premium','premium unleaded':'premium','diesel':'diesel','truck diesel':'diesel','diesel #2':'diesel'};
  const gradeLabel=s=>{const key=String(s||'').trim().toLowerCase();return Object.prototype.hasOwnProperty.call(gradeNames,key)?gradeNames[key]:null;};
  const money=s=>{const m=/^\$(\d{1,2}\.\d{2,3})$/.exec(String(s||'').trim());return m&&+m[1]>=0.5&&+m[1]<=20?+m[1]:null;};
  const rowPrices=id=>{const p=prices.get(id)||{},out={};Object.keys(p).forEach(g=>{if(p[g]!=null)out[g]={price:p[g],updated:null};});return out;};
  let gradeMenu=null,gradeAttempted=false,gradeOpenedAt=0,gradeReadyAt=0;
  const selectGrade=()=>{
    if(requested==='regular')return false;if(gradeAttempted)return Date.now()<gradeReadyAt;
    const option=Array.from(document.querySelectorAll('[role="listbox"] [role="option"],[role="menu"] [role="menuitemradio"],[role="menu"] [role="menuitem"]')).find(e=>e.getClientRects().length&&!e.closest('[aria-hidden="true"]')&&gradeLabel(e.getAttribute('aria-label')||e.innerText)===requested);
    if(option){option.click();gradeAttempted=true;gradeReadyAt=Date.now()+1000;readReply.last=null;return true;}
    if(gradeMenu){if(Date.now()-gradeOpenedAt<2000)return true;gradeMenu.click();gradeAttempted=true;return false;}
    gradeMenu=Array.from(document.querySelectorAll('button[aria-haspopup="listbox"],button[aria-haspopup="menu"],button[aria-haspopup="true"]')).find(e=>e.getClientRects().length&&(gradeLabel(e.getAttribute('aria-label'))||gradeLabel(e.innerText))==='regular');
    if(gradeMenu){gradeMenu.click();gradeOpenedAt=Date.now();return true;}return false;
  };
  const targets = Array.isArray(args.targets) && args.targets.length<=1000 ? args.targets : [];
  const complete = () => {
    if(!targets.length)return false;
    if(window.KeylessGas&&window.Pricing&&targets.every(t=>t.brand&&Number.isFinite(t.lat)&&Number.isFinite(t.lng))){
      const priced=Array.from(rows.values()).map(r=>Object.assign({},r,{prices:rowPrices(r.featureId)}));
      return KeylessGas.updateKnown(targets,priced,Pricing,null,requested).updated===targets.length;
    }
    return targets.every(t=>Array.from(rows.values()).some(r=>rowPrices(r.featureId)[requested]&&(t.id&&(r.placeId===t.id||r.id===t.id)||t.featureId&&r.featureId===t.featureId)));
  };
  const blocked = text => /\/sorry\/|consent\.google/.test(location.href) || /unusual traffic|verify (?:that )?you are human|access denied|before you continue to Google|not a robot/i.test(text);
  const price = (s) => {
    const text=String(s||'').trim(),m=/^(\$\d{1,2}\.\d{2,3})\s*\/\s*([a-z #0-9-]+)$/i.exec(text)||/^(\$\d{1,2}\.\d{2,3})\s+([a-z #0-9-]+)$/i.exec(text);
    if(m){const g=gradeLabel(m[2]),v=money(m[1]);return g&&v!=null?{grade:g,value:v}:null;}
    const reverse=/^([a-z #0-9-]+)\s+(\$\d{1,2}\.\d{2,3})$/i.exec(text);
    if(reverse){const g=gradeLabel(reverse[1]),v=money(reverse[2]);return g&&v!=null?{grade:g,value:v}:null;}return null;
  };
  // Associate a label only with a subtree naming exactly ONE feature ID and ONE
  // regular price. Ambiguous parent collections must never cross-wire stations.
  const readPrices = (raw, scoped) => {
    const decode = (raw, depth) => {
    if(depth>3)throw new Error('Too many search response envelopes');
    const body = raw.replace(/^\)\]\}'\s*/, '').trim();
    // Google's cache may append another framed value. Decode the first complete JSON
    // array only, tracking strings/escapes; never evaluate script or guess bracket positions.
    if (body[0] !== '[' && body[0] !== '{') throw new Error('Unexpected search response envelope');
    let level=0, quoted=false, escaped=false, end=-1;
    for(let i=0;i<body.length;i++) {
      const c=body[i];
      if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
      if(c==='"'){quoted=true;continue;}
      if(c==='['||c==='{')level++;
      else if(c===']'||c==='}') {if(--level===0){end=i+1;break;}}
    }
    if(end<0)throw new Error('Truncated search response');
    const value = JSON.parse(body.slice(0,end));
    if(Array.isArray(value))return value;
    // Maps scrolling uses a JSON frame with an XSSI-prefixed JSON string in d.
    if(value && typeof value.d==='string')return decode(value.d,depth+1);
    throw new Error('Search response frame has no data');
    };
    const tree = decode(raw,0);
    const candidates = new Map(), empty={ids:new Set(),values:new Map()}; let nodes = 0;
    function walk(x, depth) {
      if (++nodes > 250000 || depth > 80) throw new Error('Search response too complex');
      // Most response leaves are numbers/null or unrelated labels. They carry no
      // station/price evidence: share an immutable empty result instead of allocating
      // two collections and a closure per leaf across every page and every reader.
      let directId=null,directPrice=null;
      if(typeof x==='string'){
        directId=/^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(x)?x.toLowerCase():null;
        directPrice=price(x);
        if(!directId&&!directPrice)return empty;
      }else if(!Array.isArray(x))return empty;
      const ids = new Set(), values = new Map();
      const add=(g,p)=>{if(!values.has(g))values.set(g,new Set());if(values.get(g).size<2)values.get(g).add(p);};
      if (typeof x === 'string') {
        if (directId) ids.add(directId);
        if (directPrice) add(directPrice.grade,directPrice.value);
      } else if (Array.isArray(x)) {
        for (const child of x) {
          const c = walk(child, depth + 1);if(c===empty)continue;
          for (const id of c.ids) if (ids.size < 2) ids.add(id);
          for (const [g,ps] of c.values) for(const p of ps)add(g,p);
        }
        let label=null,amount=null,labelCount=0,amountCount=0;
        for(const v of x)if(typeof v==='string'){const g=gradeLabel(v),p=money(v);if(g){label=g;labelCount++;}if(p!=null){amount=p;amountCount++;}}
        if(labelCount===1&&amountCount===1)add(label,amount);
        if (ids.size === 1) {
          const id = Array.from(ids)[0];if(!candidates.has(id))candidates.set(id,{});const target=candidates.get(id);
          for(const [g,ps] of values){if(ps.size!==1){target[g]=null;continue;}const p=Array.from(ps)[0];if(target[g]!==undefined&&target[g]!==p)target[g]=null;else if(target[g]===undefined)target[g]=p;}
        }
      }
      return ids.size||values.size?{ ids, values }:empty;
    }
    // Typed command pages carry each station's complete price evidence in its own record.
    // Do not build price-evidence collections for hundreds of out-of-cell records.
    if(scoped&&Array.isArray(tree[64]))for(const item of tree[64]){const r=item&&item[1],point=r&&r[9];if(Array.isArray(r)&&Array.isArray(point)&&Number.isFinite(point[2])&&Number.isFinite(point[3])&&inCell(point[2],point[3]))walk(r,0);}
    else walk(tree, 0);
    for (const [id, p] of candidates){const old=prices.get(id)||{};Object.assign(old,p);prices.set(id,old);}
    return tree;
  };
  const readRows = () => {
    const feed = document.querySelector('[role="feed"]');
    if (!feed) return null;
    if(feed!==observedFeed){if(feedObserver)feedObserver.disconnect();observedFeed=feed;feedObserver=new MutationObserver(records=>{for(const r of records){const el=r.target.nodeType===3?r.target.parentElement:r.target,card=el&&el.closest&&el.closest('[role="article"]');if(card)dirtyCards.add(card);if(r.addedNodes)for(const n of r.addedNodes){if(n.nodeType!==1)continue;if(n.matches('[role="article"]'))dirtyCards.add(n);n.querySelectorAll('[role="article"]').forEach(c=>dirtyCards.add(c));}}});feedObserver.observe(feed,{subtree:true,childList:true,characterData:true,attributes:true});}
    loaded = true; if (!firstFeedAt) firstFeedAt = Date.now();
    for (const a of feed.querySelectorAll('a[href*="/maps/place/"][aria-label]')) {
      const href = a.href, id = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(href), point = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(href);
      const name = a.getAttribute('aria-label'), card = a.closest('[role="article"]');
      if (!id || !point || !card || !name) { rejected++; continue; }
      if(seenCards.get(card)===href&&!dirtyCards.has(card)){cardsSkipped++;continue;}dirtyCards.delete(card);seenCards.set(card,href);cardsParsed++;
      const lat = +point[1], lng = +point[2];
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      const t = card.innerText || '';
      if (/permanently closed|temporarily closed/i.test(t)) {rows.delete(id[1].toLowerCase());continue;}
      const lines=t.split('\n').map(s=>s.trim()).filter(Boolean),visible = lines.map(price).filter((p)=>p!==null),vp={};
      // Maps also renders the explicit grade and price on adjacent lines.
      // Never infer a grade from an unlabeled dollar amount.
      for(let i=0;i<lines.length-1;i++){const p=price(lines[i]+' '+lines[i+1]);if(p)visible.push(p);}
      visible.forEach(p=>{if(vp[p.grade]===undefined)vp[p.grade]=p.value;else if(vp[p.grade]!==p.value)vp[p.grade]=null;});
      if(visible.length)prices.set(id[1].toLowerCase(),Object.assign({},prices.get(id[1].toLowerCase()),vp));
      const website = card.querySelector('a[data-value="Website"]');
      const placeId=/!19s([a-zA-Z0-9_-]{10,200})/.exec(href);
      const addressLine=t.split('\n').find((line)=>/Gas station\s*·/i.test(line));
      const address=addressLine?addressLine.split('·').pop().trim():'';
      rows.set(id[1].toLowerCase(), {id:'web:'+id[1].toLowerCase(),featureId:id[1].toLowerCase(),placeId:placeId?placeId[1]:'',name,lat,lng,mapsUri:href,website:website ? website.href : '',prices:{},google:true,source:'Google Maps web',address});
    }
    return feed;
  };
  // Command the current page's own request, retaining its bounds and filters.
  // Only regular discovery uses this path; other grades keep their UI selection.
  // Completion requires an explicit empty page, never a short page or silence.
  const inCell=(lat,lng)=>{const a=args.area;if(!a||!Number.isFinite(a.lat)||!Number.isFinite(a.lng)||!(a.radius>0))return true;const r=Math.PI/180,x=Math.sin((lat-a.lat)*r/2)**2+Math.cos(a.lat*r)*Math.cos(lat*r)*Math.sin((lng-a.lng)*r/2)**2;return 7917.6*Math.asin(Math.sqrt(Math.min(1,x)))<=a.radius;};
  const bulkUrl=(name,offset)=>{const u=new URL(name),pb=u.searchParams.get('pb')||'',cut=pb.indexOf('!12m');let head=pb.slice(0,cut);if(u.origin!=='https://www.google.com'||u.pathname!=='/search'||u.searchParams.get('tbm')!=='map'||u.searchParams.get('q')!=='gas stations'||cut<0||!/^!/.test(head)||!head.includes('!7i20'))return null;
    if(commandReused){const geometry=/!1m3!1d([\d.e+-]+)!2d(-?[\d.]+)!3d(-?[\d.]+)/.exec(head),z=/!4f([\d.]+)/.exec(head),target=/@(-?[\d.]+),(-?[\d.]+),(\d+)z/.exec(args.url||''),a=args.area;if(!geometry||!z||!target||!a||!Number.isFinite(a.lat)||!Number.isFinite(a.lng)||Math.abs(a.lat)>85||Math.abs(a.lng)>180||Math.abs(+target[1]-a.lat)>.00002||Math.abs(+target[2]-a.lng)>.00002)return null;const zoom=+target[3],span=+geometry[1]*Math.pow(2,Math.floor(+z[1])-zoom)*Math.cos(a.lat*Math.PI/180)/Math.cos(+geometry[3]*Math.PI/180);if(!(span>0&&span<1e8)||zoom<1||zoom>22)return null;head=head.replace(geometry[0],'!1m3!1d'+span+'!2d'+a.lng+'!3d'+a.lat).replace(z[0],'!4f'+(zoom+(+z[1]-Math.floor(+z[1]))));}
    u.searchParams.set('pb',head.replace('!7i20','!7i'+bulkSize+'!8i'+offset).replace(/!8i\d+!8i\d+/,'!8i'+offset)+pb.slice(cut));return u.href;};
  const fetchSearch=async name=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);try{const r=await fetch(name,{credentials:'include',cache:'force-cache',signal:controller.signal});if(r.status===403||r.status===429||/\/sorry\/|consent\.google/.test(r.url))throw Object.assign(Error('Google restricted the search'),{blocked:true});if(!r.ok)throw Error('HTTP '+r.status);const raw=await r.text();if(raw.length>5000000)throw Error('Search response too large');if(/unusual traffic|g-recaptcha|before you continue to Google/i.test(raw.slice(0,16000)))throw Object.assign(Error('Google needs verification'),{blocked:true});return raw;}finally{clearTimeout(timer);}};
  const readBulk=async name=>{if(!bulkUrl(name,0))return false;const begin=Date.now();let unique=0;const bulkSeen=new Set();try{for(let offset=0;offset<5000&&Date.now()-started<deadline;offset+=bulkSize){const raw=await fetchSearch(bulkUrl(name,offset)),tree=readPrices(raw,true);let page=tree&&tree[64];if(page==null&&unique>0&&Array.isArray(tree)&&tree.length===72&&tree[0]&&tree[0][0]==='gas stations'&&Array.isArray(tree[1])&&Array.isArray(tree[1][0])&&tree[1][0].length===3&&tree[1][0].every(Number.isFinite)&&Array.isArray(tree[58])&&tree[58].length===1&&tree[58][0]===0&&Array.isArray(tree[71])&&tree[71].length===1&&tree[71][0]===1)page=[];if(!Array.isArray(page)||page.length>bulkSize)throw Error('Bulk result schema unavailable');bulkPages++;responseRead=true;replies++;if(!firstReplyAt)firstReplyAt=Date.now();if(!page.length){if(!unique)throw Error('Empty command answer disagrees with the visible feed');if(args.area&&!rows.size)throw Error('No in-cell command results; verifying by scrolling');exhausted=true;stopReason='command_end';window.__gasketGasTemplate=name;return true;}let added=0,newPage=0;for(const item of page){const r=item&&item[1],id=r&&r[10],point=r&&r[9],name=r&&r[11];if(!Array.isArray(r)||!/^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(id)||typeof name!=='string'||!name.trim()||name.length>300||!Array.isArray(point)||!Number.isFinite(point[2])||!Number.isFinite(point[3])||Math.abs(point[2])>90||Math.abs(point[3])>180)throw Error('Bulk station identity schema changed');const feature=id.toLowerCase();if(!bulkSeen.has(feature)){bulkSeen.add(feature);newPage++;}if(!inCell(point[2],point[3])){bulkOutside++;continue;}let closed=false,nodes=0;const check=x=>{if(++nodes>250000)throw Error('Bulk station too complex');if(typeof x==='string'&&/^(permanently|temporarily) closed$/i.test(x.trim()))closed=true;else if(Array.isArray(x))x.forEach(check);};check(r);if(closed){rows.delete(feature);continue;}if(!rows.has(feature))added++;const placeId=typeof r[78]==='string'&&/^[A-Za-z0-9_-]{10,200}$/.test(r[78])?r[78]:'',website=Array.isArray(r[7])&&typeof r[7][0]==='string'&&/^https?:\/\//.test(r[7][0])?r[7][0]:'',mapsUri=placeId?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(name)+'&query_place_id='+encodeURIComponent(placeId):'https://www.google.com/maps?cid='+BigInt(feature.split(':')[1]).toString();rows.set(feature,{id:'web:'+feature,featureId:feature,placeId:placeId,name:name,lat:point[2],lng:point[3],mapsUri:mapsUri,website:website,address:typeof r[39]==='string'?r[39]:Array.isArray(r[2])?r[2].filter(x=>typeof x==='string').join(', '):'',prices:{},google:true,source:'Google Maps web'});}
      loaded=true;bulkRows+=page.length;if(offset&&newPage===0)throw Error('Bulk pagination repeated a page');unique=bulkSeen.size;lastGrowth=Date.now();await sleep(0);
    }throw Error('Bulk pagination did not confirm its end');}catch(e){if(e.blocked)throw e;bulkFallback=String(e.message).slice(0,120);return false;}finally{bulkMs=Date.now()-begin;}};
  const readReply = async () => {
    const entry = performance.getEntriesByType('resource').filter((r) => {
      try {const u=new URL(r.name);return u.origin==='https://www.google.com' && u.pathname==='/search' && u.searchParams.get('tbm')==='map' && /gas stations/i.test(u.searchParams.get('q')||'');} catch (_) {return false;}
    }).pop();
    if (!entry || entry.name === readReply.last) return;
    if(discovery&&requested==='regular'&&args.searchMethod!=='scroll'&&!bulkAttempted){bulkAttempted=true;if(await readBulk(entry.name)){readReply.last=entry.name;return;}}
    readReply.last = entry.name;
    const controller = new AbortController(); let timer;
    try {
      await Promise.race([
        (async () => {
          // This is the URL Maps just fetched, not a constructed private API request.
          const r = await fetch(entry.name,{credentials:'include',cache:'force-cache',signal:controller.signal});
          if (r.status===403 || r.status===429 || /\/sorry\/|consent\.google/.test(r.url)) throw Object.assign(new Error('Google restricted the search'),{blocked:true});
          if (!r.ok) throw new Error('HTTP '+r.status);
          const raw = await r.text();
          if (raw.length > 5000000) throw new Error('Search response too large');
          readPrices(raw); responseRead = true; replies++; if (!firstReplyAt) firstReplyAt = Date.now();
        })(),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Search response timed out'));},10000);})
      ]);
    } finally {clearTimeout(timer);}
  };
  try {
    let stable=0, last='', scrolls=0, lastFeed=null;
    if(discovery&&requested==='regular'&&args.searchMethod!=='scroll'&&args.reuseCommands&&window.__gasketGasTemplate){
      if(blocked(document.body&&document.body.innerText||'')){send({blocked:true,code:'blocked',error:'Google needs a visible security or consent check',stores:[]});return;}
      commandReused=true;bulkAttempted=true;
      if(!await readBulk(window.__gasketGasTemplate)){send({code:'command_reload',error:'Command reader needs a fresh page',stores:[],detail:{commandReused:true,bulkFallback}});return;}
    }
    while (!exhausted&&Date.now()-started < deadline) {
      const pageText=document.body&&document.body.innerText||'';
      limited=/limited view of Google Maps/i.test(pageText);
      if (blocked(pageText)) {send({blocked:true,code:'blocked',error:'Google needs a visible security or consent check',stores:[]});return;}
      const selecting=selectGrade();
      const feed=readRows();
      if(feed)lastFeed=feed;
      // A lean page with no readable feed should not spin for the entire three-minute
      // discovery deadline. Native retries once with normal graphics under the same deadline.
      if(!feed&&!loaded&&window.__gasketLeanResources===true&&Date.now()-started>=8000){stopReason='no_feed';break;}
      // A price refresh with every target explicitly priced in the DOM needs
      // neither a response replay nor another scroll. Discovery never skips pages.
      if(!discovery&&!selecting&&complete()){targetsComplete=true;stopReason='targets';break;}
      await readReply();
      if(exhausted)break;
      if(!discovery&&!selecting&&complete()){targetsComplete=true;stopReason='targets';break;}
      // the feed growing counts too (an end marker or a spinner arriving is the page answering, not quiet)
      const now=JSON.stringify([Array.from(rows.keys()),Array.from(prices),feed&&feed.scrollHeight]);
      if(now!==last)lastGrowth=Date.now();
      stable=now===last ? stable+1 : 0;last=now;
      const indicator=feed&&feed.querySelector&&feed.querySelector('[role="progressbar"]');
      const loading=feed&&(feed.getAttribute&&feed.getAttribute('aria-busy')==='true'||indicator&&indicator.getClientRects&&indicator.getClientRects().length);
      if (!selecting&&feed&&!loading && stable>=2) {
        if (/end of the list/i.test(feed.innerText)) {exhausted=true;stopReason='end';break;}
        if (!discovery&&scrolls>=3) {stopReason='scroll_limit';break;}
        if(discovery&&rows.size>=5000){stopReason='row_limit';break;}
        // Stop a quiet bottom after 4 s (12 s if not at bottom), but report it as unconfirmed; an ordinary short list
        // does not justify a second navigation. Checked before this round's scroll, so the page always gets to answer it.
        const wasBottom=feed.scrollTop+feed.clientHeight>=feed.scrollHeight-4;
        if(discovery&&Date.now()-lastGrowth>(wasBottom&&scrolls>=1?4000:12000)){stopReason=wasBottom?'quiet':'stalled';break;}   // Quiet is not proof of exhaustion; don't cache a possibly stalled page as complete.
        const before=feed.scrollTop;
        feed.scrollTop=feed.scrollHeight;
        // A direct scroll event wakes late-installed pagination listeners even when
        // the feed is already at its bottom. Keep the nudge for pages requiring motion.
        feed.dispatchEvent(new Event('scroll',{bubbles:true}));scrollEvents++;
        // Maps may attach its pagination listener after the first scroll. Writing
        // the same bottom position again emits no scroll event; nudge only a
        // stalled, scrollable discovery feed so a late listener gets another chance.
        if(discovery&&Math.abs(feed.scrollTop-before)<1&&feed.scrollHeight>feed.clientHeight){
          // up and back across a short wait: both in one go can coalesce into no scroll event at all (a CI run caught it)
          const bottom=feed.scrollTop;feed.scrollTop=Math.max(0,bottom-32);await sleep(60);feed.scrollTop=bottom;
        }
        // Scrolling the same exhausted/non-scrollable feed three times adds seconds but no rows.
        if(Math.abs(feed.scrollTop-before)<1&&!discovery){stopReason='stalled';break;}
        if(discovery){const more=Array.from(feed.querySelectorAll('button')).find(b=>b.getClientRects().length&&/^(load|show) more(?: results)?$/i.test((b.innerText||b.getAttribute('aria-label')||'').trim()));if(more)more.click();}
        scrolls++;stable=0;
      }
      await sleep(discovery?75:150);
    }
    for (const row of rows.values()) row.prices=rowPrices(row.featureId);
    const stores=Array.from(rows.values());
    const priced=stores.filter(s=>s.prices[requested]).length;
    const unconfirmed=discovery&&!exhausted&&(stopReason==='quiet'||stopReason==='stalled');
    const moreVisible=lastFeed&&Array.from(lastFeed.querySelectorAll('button')).some(b=>b.getClientRects().length&&/^(load|show) more(?: results)?$/i.test((b.innerText||b.getAttribute('aria-label')||'').trim()));
    // A full first page that never paginated is suspicious, not proof of exhaustion.
    const paginationStalled=!!(unconfirmed&&lastFeed&&(moreVisible||lastFeed.scrollHeight>lastFeed.clientHeight&&lastFeed.querySelectorAll('[role="article"]').length>=20&&replies<=1));
    send({stores,partial:true,code:!loaded?'unreadable':paginationStalled?'pagination_stalled':unconfirmed?'incomplete_feed':!priced?'no_prices':'limited',
      error:!loaded?'Google gas results could not be read':!priced&&!discovery?'Google provided no matching '+requested+' prices; existing prices are retained':null,
      detail:{commandReused,commandReusable:exhausted&&stopReason==='command_end'&&!!window.__gasketGasTemplate,bulkPageSize:bulkSize,bulkOutside,bulkPages,bulkRows,bulkMs,bulkFallback,cardsParsed,cardsSkipped,scrollEvents,read:stores.length,priced,responseRead,targetsComplete,exhausted,stopReason,scrolls,paginationStalled,feedHeight:lastFeed?lastFeed.clientHeight:0,feedScrollHeight:lastFeed?lastFeed.scrollHeight:0,priceLabels:prices.size,limitedView:limited,rejected,elapsedMs:Date.now()-started,firstFeedMs:firstFeedAt?firstFeedAt-started:null,firstReplyMs:firstReplyAt?firstReplyAt-started:null,lastGrowthMs:lastGrowth-started,replies,coverage:'Search results, not an exhaustive station catalog'}});
  } catch (e) {send({stores:[],blocked:!!e.blocked,error:e.message,code:e.blocked?'blocked':'reader'});}
}
