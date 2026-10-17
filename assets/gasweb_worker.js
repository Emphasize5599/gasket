// Independently implemented reader of a Google Maps page's own gas-search response.
// No Vela code, protobuf templates, calibration files or libraries are included.
async function (reqId, args) {
  let sent = false;
  const send = (r) => { if (!sent) { sent = true; GasketSite.result(reqId, JSON.stringify(r)); } };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const started = Date.now(), rows = new Map(), prices = new Map();
  const discovery=args.mode==='discover',deadline=discovery?180000:30000;
  let exhausted=false,stopReason='deadline',lastGrowth=Date.now(),firstFeedAt=0,firstReplyAt=0,replies=0;   // timings for the debug log
  let loaded = false, responseRead = false, limited = false, rejected = 0;
  let targetsComplete = false;
  const requested=['regular','midgrade','premium','diesel'].includes(args.grade)?args.grade:'regular';
  const gradeLabel=s=>({'regular':'regular','regular unleaded':'regular','midgrade':'midgrade','mid-grade':'midgrade','mid grade':'midgrade','premium':'premium','premium unleaded':'premium','diesel':'diesel','truck diesel':'diesel','diesel #2':'diesel'})[String(s||'').trim().toLowerCase()]||null;
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
  const blocked = () => /\/sorry\/|consent\.google/.test(location.href) || /unusual traffic|verify (?:that )?you are human|access denied|before you continue to Google|not a robot/i.test(document.body && document.body.innerText || '');
  const price = (s) => {
    const text=String(s||'').trim(),m=/^(\$\d{1,2}\.\d{2,3})\s*\/\s*([a-z #0-9-]+)$/i.exec(text)||/^(\$\d{1,2}\.\d{2,3})\s+([a-z #0-9-]+)$/i.exec(text);
    if(m){const g=gradeLabel(m[2]),v=money(m[1]);return g&&v!=null?{grade:g,value:v}:null;}
    const reverse=/^([a-z #0-9-]+)\s+(\$\d{1,2}\.\d{2,3})$/i.exec(text);
    if(reverse){const g=gradeLabel(reverse[1]),v=money(reverse[2]);return g&&v!=null?{grade:g,value:v}:null;}return null;
  };
  // Associate a label only with a subtree naming exactly ONE feature ID and ONE
  // regular price. Ambiguous parent collections must never cross-wire stations.
  const readPrices = (raw) => {
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
    const candidates = new Map(); let nodes = 0;
    function walk(x, depth) {
      if (++nodes > 250000 || depth > 80) throw new Error('Search response too complex');
      const ids = new Set(), values = new Map();
      const add=(g,p)=>{if(!values.has(g))values.set(g,new Set());if(values.get(g).size<2)values.get(g).add(p);};
      if (typeof x === 'string') {
        if (/^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(x)) ids.add(x.toLowerCase());
        const p = price(x); if (p !== null) add(p.grade,p.value);
      } else if (Array.isArray(x)) {
        for (const child of x) {
          const c = walk(child, depth + 1);
          for (const id of c.ids) if (ids.size < 2) ids.add(id);
          for (const [g,ps] of c.values) for(const p of ps)add(g,p);
        }
        const labels=x.filter(v=>typeof v==='string'&&gradeLabel(v)),amounts=x.filter(v=>typeof v==='string'&&money(v)!=null);
        if(labels.length===1&&amounts.length===1)add(gradeLabel(labels[0]),money(amounts[0]));
        if (ids.size === 1) {
          const id = Array.from(ids)[0];if(!candidates.has(id))candidates.set(id,{});const target=candidates.get(id);
          for(const [g,ps] of values){if(ps.size!==1){target[g]=null;continue;}const p=Array.from(ps)[0];if(target[g]!==undefined&&target[g]!==p)target[g]=null;else if(target[g]===undefined)target[g]=p;}
        }
      }
      return { ids, values };
    }
    walk(tree, 0);
    for (const [id, p] of candidates){const old=prices.get(id)||{};Object.assign(old,p);prices.set(id,old);}
  };
  const readRows = () => {
    const feed = document.querySelector('[role="feed"]');
    if (!feed) return null;
    loaded = true; if (!firstFeedAt) firstFeedAt = Date.now();
    limited = /limited view of Google Maps/i.test(document.body.innerText);
    for (const a of feed.querySelectorAll('a[href*="/maps/place/"][aria-label]')) {
      const href = a.href, id = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(href), point = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(href);
      const name = a.getAttribute('aria-label'), card = a.closest('[role="article"]');
      if (!id || !point || !card || !name) { rejected++; continue; }
      const lat = +point[1], lng = +point[2];
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      const t = card.innerText || '';
      if (/permanently closed|temporarily closed/i.test(t)) continue;
      const lines=t.split('\n'),visible = lines.map(price).filter((p)=>p!==null),vp={};
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
  const readReply = async () => {
    const entry = performance.getEntriesByType('resource').filter((r) => {
      try {const u=new URL(r.name);return u.origin==='https://www.google.com' && u.pathname==='/search' && u.searchParams.get('tbm')==='map' && /gas stations/i.test(u.searchParams.get('q')||'');} catch (_) {return false;}
    }).pop();
    if (!entry || entry.name === readReply.last) return;
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
    let stable=0, last='', scrolls=0;
    while (Date.now()-started < deadline) {
      if (blocked()) {send({blocked:true,code:'blocked',error:'Google needs a visible security or consent check',stores:[]});return;}
      const selecting=selectGrade();
      const feed=readRows();
      // A price refresh with every target explicitly priced in the DOM needs
      // neither a response replay nor another scroll. Discovery never skips pages.
      if(!discovery&&!selecting&&complete()){targetsComplete=true;stopReason='targets';break;}
      await readReply();
      if(!discovery&&!selecting&&complete()){targetsComplete=true;stopReason='targets';break;}
      const now=JSON.stringify([Array.from(rows.keys()),Array.from(prices)]);
      if(now!==last)lastGrowth=Date.now();
      stable=now===last ? stable+1 : 0;last=now;
      const indicator=feed&&feed.querySelector&&feed.querySelector('[role="progressbar"]');
      const loading=feed&&(feed.getAttribute&&feed.getAttribute('aria-busy')==='true'||indicator&&indicator.getClientRects&&indicator.getClientRects().length);
      if (!selecting&&feed&&!loading && stable>=2) {
        if (/end of the list/i.test(feed.innerText)) {exhausted=true;stopReason='end';break;}
        if (!discovery&&scrolls>=3) {stopReason='scroll_limit';break;}
        if(discovery&&rows.size>=5000){stopReason='row_limit';break;}
        const before=feed.scrollTop;
        feed.scrollTop=feed.scrollHeight;
        // Scrolling the same exhausted/non-scrollable feed three times adds seconds but no rows.
        if(Math.abs(feed.scrollTop-before)<1&&!discovery){stopReason='stalled';break;}
        // a list that's at its bottom and quiet for 4 s is done (most are short: a dozen rows, two scrolls); 12 s otherwise
        const atBottom=feed.scrollTop+feed.clientHeight>=feed.scrollHeight-4;
        if(discovery&&Date.now()-lastGrowth>(atBottom&&scrolls>=1?4000:12000)){stopReason=atBottom?'quiet':'stalled';if(atBottom)exhausted=true;break;}   // scrolled to the bottom and nothing more came: the list ended without saying so
        if(discovery){const more=Array.from(feed.querySelectorAll('button')).find(b=>b.getClientRects().length&&/^(load|show) more(?: results)?$/i.test((b.innerText||b.getAttribute('aria-label')||'').trim()));if(more)more.click();}
        scrolls++;stable=0;
      }
      await sleep(150);
    }
    for (const row of rows.values()) row.prices=rowPrices(row.featureId);
    const stores=Array.from(rows.values());
    const priced=stores.filter(s=>s.prices[requested]).length;
    send({stores,partial:true,code:!loaded?'unreadable':!priced?'no_prices':'limited',
      error:!loaded?'Google gas results could not be read':!priced&&!discovery?'Google provided no matching '+requested+' prices; existing prices are retained':null,
      detail:{read:stores.length,priced,responseRead,targetsComplete,exhausted,stopReason,scrolls,priceLabels:prices.size,limitedView:limited,rejected,elapsedMs:Date.now()-started,firstFeedMs:firstFeedAt?firstFeedAt-started:null,firstReplyMs:firstReplyAt?firstReplyAt-started:null,lastGrowthMs:lastGrowth-started,replies,coverage:'Search results, not an exhaustive station catalog'}});
  } catch (e) {send({stores:[],blocked:!!e.blocked,error:e.message,code:e.blocked?'blocked':'reader'});}
}
