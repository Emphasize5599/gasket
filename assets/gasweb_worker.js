// Independently implemented reader of a Google Maps page's own gas-search response.
// No Vela code, protobuf templates, calibration files or libraries are included.
async function (reqId, args) {
  let sent = false;
  const send = (r) => { if (!sent) { sent = true; GasketSite.result(reqId, JSON.stringify(r)); } };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const started = Date.now(), rows = new Map(), prices = new Map();
  let loaded = false, responseRead = false, limited = false, rejected = 0;
  const blocked = () => /\/sorry\/|consent\.google/.test(location.href) || /unusual traffic|verify (?:that )?you are human|access denied|before you continue to Google|not a robot/i.test(document.body && document.body.innerText || '');
  const price = (s) => {
    const m = /^\$(\d{1,2}\.\d{2,3})\s*\/\s*Regular$/i.exec(String(s || '').trim());
    const p = m && +m[1]; return p >= 0.5 && p <= 20 ? p : null;
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
      const ids = new Set(), values = new Set();
      if (typeof x === 'string') {
        if (/^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(x)) ids.add(x.toLowerCase());
        const p = price(x); if (p !== null) values.add(p);
      } else if (Array.isArray(x)) {
        for (const child of x) {
          const c = walk(child, depth + 1);
          for (const id of c.ids) if (ids.size < 2) ids.add(id);
          for (const p of c.values) if (values.size < 2) values.add(p);
        }
        if (ids.size === 1 && values.size === 1) {
          const id = Array.from(ids)[0], p = Array.from(values)[0];
          const old = candidates.get(id);
          if (old !== undefined && old !== p) candidates.set(id, null);
          else if (!candidates.has(id)) candidates.set(id, p);
        }
      }
      return { ids, values };
    }
    walk(tree, 0);
    for (const [id, p] of candidates) if (p !== null) prices.set(id, p);
  };
  const readRows = () => {
    const feed = document.querySelector('[role="feed"]');
    if (!feed) return null;
    loaded = true;
    limited = /limited view of Google Maps/i.test(document.body.innerText);
    for (const a of feed.querySelectorAll('a[href*="/maps/place/"][aria-label]')) {
      const href = a.href, id = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(href), point = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(href);
      const name = a.getAttribute('aria-label'), card = a.closest('[role="article"]');
      if (!id || !point || !card || !name) { rejected++; continue; }
      const lat = +point[1], lng = +point[2];
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      const t = card.innerText || '';
      if (/permanently closed|temporarily closed/i.test(t)) continue;
      const visible = t.split('\n').map(price).filter((p)=>p!==null);
      if(new Set(visible).size===1)prices.set(id[1].toLowerCase(),visible[0]);
      const website = card.querySelector('a[data-value="Website"]');
      rows.set(id[1].toLowerCase(), {id:'web:'+id[1].toLowerCase(),featureId:id[1].toLowerCase(),name,lat,lng,mapsUri:href,website:website ? website.href : '',prices:{},google:true,source:'Google Maps web',address:''});
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
          readPrices(raw); responseRead = true;
        })(),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Search response timed out'));},10000);})
      ]);
    } finally {clearTimeout(timer);}
  };
  try {
    let stable=0, last='', scrolls=0;
    while (Date.now()-started < 30000) {
      if (blocked()) {send({blocked:true,code:'blocked',error:'Google needs a visible security or consent check',stores:[]});return;}
      const feed=readRows();
      await readReply();
      const now=JSON.stringify([Array.from(rows.keys()),Array.from(prices)]);
      stable=now===last ? stable+1 : 0;last=now;
      if (feed && stable>=3) {
        if (scrolls>=3 || /end of the list/i.test(feed.innerText)) break;
        feed.scrollTop=feed.scrollHeight;scrolls++;stable=0;
      }
      await sleep(600);
    }
    for (const row of rows.values()) if (prices.has(row.featureId)) row.prices.regular={price:prices.get(row.featureId),updated:null};
    const stores=Array.from(rows.values());
    const priced=stores.filter(s=>s.prices.regular).length;
    send({stores,partial:true,code:!loaded?'unreadable':!priced?'no_prices':'limited',
      error:!loaded?'Google gas results could not be read':!priced?'Google provided no matching regular prices; stations are shown without prices':null,
      detail:{read:stores.length,priced,responseRead,priceLabels:prices.size,limitedView:limited,rejected,elapsedMs:Date.now()-started,coverage:'Search results, not an exhaustive station catalog'}});
  } catch (e) {send({stores:[],blocked:!!e.blocked,error:e.message,code:e.blocked?'blocked':'reader'});}
}
