/* EV charging networks' own published prices, read the way their public maps read them (signed out, a few requests
 * at a time, cached): Tesla Superchargers (tesla.com/findus page reader), IONNA (one page lists every site and price),
 * Blink (its map service: sites, then each charger's host-set price), FLO, ChargePoint, Electric Era (one public site list)
 * and Francis Energy (its finder map's guest prices). Each DOE station is matched to the network's
 * site by network and distance, and gets `netPrice` {rate, uom: kwh | min | hour, fee, peak, low, src, label, t},
 * which ChargerData.tariff prefers to DOE's free text. Not live prices; a check on a network's page is never got around. */
(function (root) {
  'use strict';
  var A = root.__app, S = A.S, KV = A.KV, LG = root.FLog || { info: function () {}, warn: function () {} };
  var HOUR = 3600e3, DAY = 24 * HOUR, WEEK = 7 * DAY, NS = 'evprices';
  var IONNA_URL = 'https://www.ionna.com/rechargeries/find-a-rechargery/', BLINK_SITES = 'https://chargermap.blinknetwork.com/v1/stations',
    BLINK_API = 'https://apigw.blinknetwork.com/';
  var verification = null, cancelled = false;
  function finishCheck(retry) { if (!verification) return false; var v = verification; verification = null; if(root.Tasks)root.Tasks.remove('ev-price-check'); v.resolve(retry); return true; }
  function onVerified(key) { return verification && verification.key === key ? finishCheck(true) : false; }
  function dismissCheck() { return finishCheck(false); }
  function cancel() { cancelled = true; if(verification&&root.document){var banner=root.document.getElementById('wmCheck');if(banner)banner.classList.add('hidden');}dismissCheck(); }
  async function call() {
    var args = Array.prototype.slice.call(arguments), key = args[0] === 'siteRead' ? args[1] : /ionna/.test(args[1] || '') ? 'ionna' : 'blink';
    for (var attempt = 0; ; attempt++) {
      if(cancelled)return {cancelled:true,error:'Cancelled'};
      if (verification && !await verification.promise) return { error: 'Website check dismissed', blocked: true };
      var t = root.__trip, r = t && t.call ? await t.call.apply(null, args) : { error: 'No Native bridge' };
      var blocked = r && (r.blocked || /\bHTTP (403|429)\b/i.test(r.error || '') || /<title>[^<]*(?:access denied|captcha|just a moment)|captcha-delivery\.com|geo\.captcha-delivery/i.test(r.body || ''));
      if (!blocked) return r;
      // Only the user can pass a check. No negative price cache and no further requests while paused.
      if (attempt >= 2 || !A.showSiteCheck || !/^(tesla|chargepoint)$/.test(key)) return Object.assign({}, r, { blocked: true });
      if (!verification) {
        var resolve, promise = new Promise(function (ok) { resolve = ok; });
        verification = { key: key, promise: promise, resolve: resolve };
        if(root.Tasks)root.Tasks.upsert('ev-price-check',{text:'Charger prices paused · '+(key==='tesla'?'Tesla':'ChargePoint')+' needs a check',priority:100,frac:null,cancel:cancel});
        LG.warn('stations', 'Charger prices paused for website check', { network: key });
        A.showSiteCheck(key, key === 'tesla' ? 'Tesla' : 'ChargePoint');
      }
      if (!await verification.promise) return { blocked: true, error: 'Website check dismissed' };
    }
  }
  function meters(a, b) { var R = 6371000, p = Math.PI / 180, dLat = (b.lat - a.lat) * p, dLng = (b.lng - a.lng) * p, s = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.pow(Math.sin(dLng / 2), 2); return 2 * R * Math.asin(Math.sqrt(s)); }
  function nearest(st, list, maxM) { var best = null, bd = maxM; list.forEach(function (x) { if (Math.abs(x.lat - st.lat) > 0.01 || Math.abs(x.lng - st.lng) > 0.012) return; var d = meters(st, x); if (d < bd) { bd = d; best = x; } }); return best; }
  async function json(url) { var r = await call('fetchJson', url); if (!r || r.error || r.blocked) { var e = new Error(r && r.blocked ? 'Website access restricted; prices remain estimates.' : r && r.error || 'no answer'); e.blocked = !!(r && r.blocked); throw e; } return r.body; }
  function priceAge(){return Math.min(720,Math.max(1,+S.evPriceAgeHours||24))*HOUR;}
  function stamp(v,t){(Array.isArray(v)?v:[v]).forEach(function(x){if(x&&typeof x==='object'&&!x.t)x.t=t;});return v;}
  function cached(key, age) { try { var o = KV.get(NS, key, age===DAY?priceAge():age); return o ? stamp(o.v,o.t) : null; } catch (e) { return null; } }
  function keep(key, v) { stamp(v,Date.now());try { KV.put(NS, key, v); } catch (e) { } }
  /** "$0.59/kWh", "$1.00/Hour", "$0.25/min" → {v, uom} */
  function money(text) { var m = /\$\s*(\d*\.?\d+)\s*\/\s*(kwh|hour|hr|min(?:ute)?)/i.exec(String(text || '')); return m ? { v: +m[1], uom: /kwh/i.test(m[2]) ? 'kwh' : /min/i.test(m[2]) ? 'min' : 'hour' } : null; }

  // ---------- IONNA: window.allLocations on its finder page (every Rechargery, its price per kWh) ----------
  function parseIonna(html) {
    var m = /window\.allLocations\s*=\s*(\{[\s\S]*?\});\s*(?:\n|<\/script>)/.exec(String(html || '')); if (!m) return [];
    var o; try { o = JSON.parse(m[1]); } catch (e) { return []; }
    return Object.keys(o).map(function (k) { var x = o[k], p = /rechargery_price_now[^>]*>\s*\$\s*(\d*\.?\d+)/.exec(x.price || x.specs || '');
      return { lat: +x.lat, lng: +(x.lng != null ? x.lng : x.lon), rate: p ? +p[1] : null, open: x.status !== 'soon' && !/opening soon/i.test(x.note || ''), tax: /tax/i.test(x.price || ''), updated: x.price_updated || null };
    }).filter(function (x) { return isFinite(x.lat) && isFinite(x.lng) && x.rate != null; });
  }
  async function ionnaSites() { var c = cached('ionna-v1', DAY); if (c) return c; var list = parseIonna(await json(IONNA_URL)); if (list.length) keep('ionna-v1', list); return list; }

  // ---------- Blink: its map's site list, then a site's chargers, then a charger's flexi_pricing (host-set) ----------
  async function blinkSites() { var c = cached('blink-sites-v1', WEEK); if (c) return c; var j = JSON.parse(await json(BLINK_SITES)), list = (j.locations || []).map(function (x) { return { id: x.l_id, lat: +x.lat, lng: +x.long, open: x.open !== false }; }).filter(function (x) { return x.id && isFinite(x.lat) && isFinite(x.lng); }); if (list.length) keep('blink-sites-v1', list); return list; }
  function parseBlinkPrice(j) {
    var energy = [], parking = 0;
    (j && j.days || []).forEach(function (d) { (d.energySlots || []).forEach(function (s) { var q = money(s.cost); if (q) energy.push(q); }); (d.parkingSlots || []).forEach(function (s) { var q = money(s.cost); if (q && q.v > parking) parking = q.v; }); });
    if (!energy.length) return null;
    var uom = energy[0].uom, same = energy.filter(function (q) { return q.uom === uom; }).map(function (q) { return q.v; }), fee = /\$\s*(\d*\.?\d+)/.exec(j.serviceFee || '');
    return { rate: Math.max.apply(null, same), peak: Math.max.apply(null, same), low: Math.min.apply(null, same), uom: uom, fee: fee ? +fee[1] : 0, parking: parking };
  }
  async function blinkPrice(siteId, dc) {
    var key = 'blink-price-v1|' + siteId + '|' + (dc ? 'dc' : 'ac'), c = cached(key, DAY); if (c) return c.none ? null : c;
    var groups = JSON.parse(await json(BLINK_API + 'v3/locations/' + encodeURIComponent(siteId))), pick = null;
    (Array.isArray(groups) ? groups : []).forEach(function (g) { var fast = /dc|fast|level_3/i.test(g.level || ''); if (!pick || fast === !!dc) (g.chargers || []).some(function (ch) { if (ch.serialNumber) { pick = { serial: ch.serialNumber, fast: fast }; return true; } return false; }); });
    if (!pick) { keep(key, { none: true }); return null; }
    // Blink's pricing service sometimes answers all-zero ($0/kWh, $0 session) for a charger it prices on the next call
    // (3 of 8 calls on 2026-10-19): ask up to 3 times, keep a priced answer; all zeros = not trusted (no network price)
    var p = null;
    for (var i = 0; i < 3 && !(p && (p.peak > 0 || p.fee > 0)); i++) p = parseBlinkPrice(JSON.parse(await json(BLINK_API + 'pricing/api/index.php/flexi_pricing?serial_number=' + encodeURIComponent(pick.serial))));
    if (p && !(p.peak > 0 || p.fee > 0)) p = null;
    keep(key, p || { none: true }); return p;
  }

  // ---------- Tesla: the findus page reader (tesla_worker.js), cached per station ----------
  async function teslaPrices(sts, isTesla, onBatch) {
    var out = {}, need = [];
    sts.forEach(function (st) { var c = cached('tesla-v1|' + (isTesla ? 't' : 'n') + '|' + st.id, DAY); if (c) { if (!c.none) out[st.id] = c; } else need.push(st); });
    if (onBatch) onBatch(sts.length - need.length, true);   // cached sites count as done at once
    if (!need.length) return out;
    // Tesla's U.S. Supercharger places: one read (a 6.8 MB list on Tesla's side, a small one kept here for a week)
    var places = cached('tesla-list-v1', WEEK);
    if (!places) {
      var lr = await call('siteRead', 'tesla', JSON.stringify({ url: 'https://www.tesla.com/findus', mode: 'list' }));
      if (lr && lr.error === 'No Native bridge') return out;
      if (lr && lr.blocked) { var eb = new Error('Tesla\'s charger map asked for a check, so Supercharger prices are estimates this time.'); eb.partial = out; throw eb; }
      if (!lr || !Array.isArray(lr.list)) throw new Error('Tesla\'s charger map didn\'t answer (' + (lr && lr.error || 'no list') + ').');
      places = lr.list; if (places.length) keep('tesla-list-v1', places);
    }
    var matched = need.map(function (st) { var p = nearest(st, places, 250); return p ? { st: st, slug: p.slug } : null; }).filter(Boolean);
    need.filter(function (st) { return !matched.some(function (m) { return m.st === st; }); }).forEach(function (st) { keep('tesla-v1|' + (isTesla ? 't' : 'n') + '|' + st.id, { none: true }); });
    if (onBatch) onBatch(need.length - matched.length, true);
    need = matched.map(function (m) { return m.st; });
    var slugOf = {}; matched.forEach(function (m) { slugOf[m.st.id] = m.slug; });
    for (var i = 0; i < need.length; i += 20) {   // batches of 20: the progress moves, a slow page costs less
      var part = need.slice(i, i + 20), slugs = {}; part.forEach(function (st) { (slugs[slugOf[st.id]] = slugs[slugOf[st.id]] || []).push(st.id); });
      var r = await call('siteRead', 'tesla', JSON.stringify({ url: 'https://www.tesla.com/findus', slugs: slugs, tesla: isTesla, max: 20 }));
      if (r && r.blocked) { var e = new Error('Tesla\'s charger map asked for a check, so Supercharger prices are estimates this time.'); e.partial = out; throw e; }
      if (r && r.error === 'No Native bridge') return out;   // the desktop preview has no hidden pages
      if (!r || r.error) throw new Error('Tesla\'s charger map didn\'t answer (' + (r && r.error || 'no reply') + ').');
      part.forEach(function (st) { var x = r.sites && r.sites[st.id]; if (x && x.currency === 'USD') { out[st.id] = x; keep('tesla-v1|' + (isTesla ? 't' : 'n') + '|' + st.id, x); } else keep('tesla-v1|' + (isTesla ? 't' : 'n') + '|' + st.id, { none: true }); });
      if (onBatch) onBatch(part.length, false);
    }
    return out;
  }

  // ---------- ChargePoint: its public station page (chargepoint_worker.js), the host-set price, one station per read ----------
  /** The price part of a station page's text → {rate, peak, low, uom, fee, free} or null. "Energy Rate $0.44 / kWh", "$2.00 / hr", "Free". */
  function parseChargePoint(text) {
    var t = String(text || '').replace(/\s+/g, ' '), rates = [], m, re = /\b(?:Energy|Charging|Time)\s*(?:Rate|Fee)?\s*:?\s*\$\s*(\d*\.?\d+)\s*\/\s*(kwh|hr|hour|min(?:ute)?)/gi;
    var chargingText=t.replace(/\b(?:While Not Charging|Idle(?: Time)? Rate|Parking(?: Time)? Rate)\b.*?(?=\bEnergy Rate\b|Need help|Last Used|$)/gi,'');
    while ((m = re.exec(chargingText))) rates.push({ v: +m[1], uom: /kwh/i.test(m[2]) ? 'kwh' : /min/i.test(m[2]) ? 'min' : 'hour' });
    // Schedules insert day/time text between "Energy Rate" and each amount.
    // Read energy only from that block; idle/overstay rates are not charging prices.
    var energy=/\bEnergy Rate\b(.*?)(?=Station Time Rate|Taxes and Fees|Need help|Last Used|$)/i.exec(t);
    if(energy){var er=[],em,rx=/\$\s*(\d*\.?\d+)\s*\/\s*kwh/gi;while((em=rx.exec(energy[1])))er.push({v:+em[1],uom:'kwh'});if(er.length)rates=er;}
    if(!rates.length){var connected=/\bStation Time Rate\s+while Connected\s*:?\s*\$\s*(\d*\.?\d+)\s*\/\s*(hour|hr|min(?:ute)?)/i.exec(t);if(connected)rates.push({v:+connected[1],uom:/min/i.test(connected[2])?'min':'hour'});}
    var feeM = /\b(?:Session|Flat|Connection|Plug-?in|Start|Service)\s*(?:Rate|Fee)\s*:?\s*\$\s*(\d*\.?\d+)/i.exec(t), fee = feeM ? +feeM[1] : 0;
    if (!rates.length) return /\b(?:Price\s*[·|:]?\s*Free|Free charging)\b/i.test(t) && !/\$\s*\d/.test(t) ? { rate: 0, peak: 0, low: 0, uom: 'kwh', fee: 0, free: true } : null;
    var uom = rates[0].uom, v = rates.filter(function (r) { return r.uom === uom; }).map(function (r) { return r.v; });
    return { rate: Math.max.apply(null, v), peak: Math.max.apply(null, v), low: Math.min.apply(null, v), uom: uom, fee: fee, ...( /Taxes and Fees|Parking|Idle|Minimum Fee|Maximum Fee/i.test(t) ? { extraFees: true } : {}) };
  }
  /** DOE's USCPIL station identifier is the public page's device ID. Ports are a fallback, never truncate them. */
  function chargePointIds(st) { var ids = st.netIds || {}, out = []; (ids.station || []).forEach(function (s) { var m = /^(?:USCPIL)?(\d{4,12})$/.exec(String(s)); if (m && out.indexOf(m[1]) < 0) out.push(m[1]); }); (ids.posts || []).forEach(function (p) { p = String(p); if (/^\d{4,12}$/.test(p) && out.indexOf(p) < 0) out.push(p); }); return out.slice(0, 4); }
  var CP_GIVE_UP = 6;
  function cpKey(st){return 'cp-v2|'+chargePointIds(st).join(',');}
  function cpObserved(st,stale){var p=st.netPrice,t=p&&+p.t;return p&&p.src==='chargepoint'&&t>0&&t<=Date.now()&&(stale||Date.now()-t<=priceAge())&&['kwh','min','hour'].indexOf(p.uom)>=0&&(p.rate>0||p.rate===0&&p.free===true)?p:null;}
  async function chargePointPrice(st) {
    var ids = chargePointIds(st), key = 'cp-v2|' + ids.join(','), c = cached(key, DAY), miss = cached(key, 10 * 60e3); if (!ids.length) return null; if (c && (!c.none || miss)) return c.none ? null : c;
    var old=cached(key,0),fallback=old&&!old.none&&!old.missing?old:cpObserved(st,true),retryKey='cp-retry|'+ids.slice().sort().join(',');if(cached(retryKey,10*60e3))return fallback;
    var nDevice = ids.filter(function (d) { return (st.netIds.posts || []).indexOf(d) < 0; }).length;
    for (var i = 0; i < ids.length; i++) {
      var t0 = Date.now(), r = await call('siteRead', 'chargepoint', JSON.stringify({ url: 'https://driver.chargepoint.com/stations/' + ids[i],name:st.name }));
      if(r&&r.diagnostics)LG.info('stations','ChargePoint reader state',r.diagnostics);
      LG.info('stations', 'ChargePoint station page', { idForm: i < nDevice ? 'device' : 'post', outcome: r && r.blocked ? 'blocked' : r && r.missing ? 'missing' : r && r.text ? (parseChargePoint(r.text) ? 'priced' : 'no price on page') : 'error', ms: Date.now() - t0, error: r && r.error ? String(r.error).slice(0, 160) : undefined, sample: r && (r.text && !parseChargePoint(r.text) ? r.text : r.missing && r.sample) ? String(r.text || r.sample).slice(0, 160) : undefined, station: st.name });
      if (r && r.error === 'No Native bridge') return null;
      if (r && r.blocked) { var e = new Error('ChargePoint\'s station page asked for a check, so its prices are estimates this time.'); e.blocked = true; throw e; }
      if (r && r.missing) continue;
      var p = r && r.text ? parseChargePoint(r.text) : null;
      if (r && r.text) { if(p)keep(key,p);else keep(retryKey,{reason:'unparsed'});return p||fallback; }
    }
    // Network/timeouts are not proof a station is missing. Cache only explicit missing-page answers.
    keep(retryKey,{reason:r&&r.missing?'missing':'load_failed'});return fallback;
  }

  // FLO's signed-out map: nearby parks, then the exact station's tariff and connector detail.
  // Only FLO's own US stations. Roaming rates and CAD fees are not silently presented as USD energy rates.
  var FLO_PLUGS={IEC_62196_T1:'J1772',IEC_62196_T1_COMBO:'J1772COMBO',CHADEMO:'CHADEMO',J3400:'TESLA'};
  function parseFlo(j,dc,plugs){
    var out={units:[],price:null},rates=[];
    if(!j||!j.address||j.address.country!=='USA'||[1,6].indexOf(+j.networkId)<0)return out;
    if(/\b(?:gov only|government only|fleet only|private|employees only)\b/i.test(j.name||''))return out;
    (j.stations||[]).forEach(function(s){
      if(/unavailable|outofservice|removed|planned|unknown/i.test(s.status||''))return;
      var level=s.level==='L3'?'dc_fast':s.level==='L2'?'2':s.level==='L1'?'1':null,con={};if(!level)return;
      (s.connectors||[]).forEach(function(c){var p=FLO_PLUGS[c.type];if(p&&plugs.indexOf(p)>=0&&(dc?level==='dc_fast':level!=='dc_fast'))con[p]={port_count:1,power_kw:Math.max(0,+c.power||0)/1000};});
      if(!Object.keys(con).length)return;out.units.push({charging_level:level,connectors:con});
      var t=s.tariff&&s.tariff.description&&s.tariff.description.en||'',m,a=[],re=/\$\s*(\d*\.?\d+)\s*(?:\(USD\)\s*)?(?:\/|per)\s*(kwh|hour|hr|minute|min)\b/gi;
      if(/\bCAD\b|\$CA|C\$/i.test(t)){rates.push(null);return;}
      while((m=re.exec(t)))a.push({rate:+m[1],uom:/kwh/i.test(m[2])?'kwh':/min/i.test(m[2])?'min':'hour'});
      // Complex tier/idle schedules cannot be flattened into one price without their rules.
      if(a.length&&a.every(function(r){return r.rate>0&&r.uom===a[0].uom;})&&!/after\s+\d|first\s+\d|session|minimum|maximum|idle|tier/i.test(t))rates.push({rate:Math.max.apply(null,a.map(function(r){return r.rate;})),uom:a[0].uom});
      else if(s.freeOfCharge===true&&!/\$\s*\d/.test(t))rates.push({rate:0,uom:'kwh',free:true});
      else rates.push(null);
    });
    if(!rates.length||rates.some(function(r){return !r||r.uom!==rates[0].uom;}))return out;
    var hi=Math.max.apply(null,rates.map(function(r){return r.rate;}));
    out.price={rate:hi,peak:hi,low:Math.min.apply(null,rates.map(function(r){return r.rate;})),uom:rates[0].uom,free:rates.every(function(r){return r.free===true;}),extraFees:true};return out;
  }
  async function floJson(action,args){var r=await call('fetchFlo',action,args);if(!r||r.error||r.blocked){var e=new Error(r&&r.blocked?'FLO access restricted; price reads stopped.':r&&r.error||'FLO did not answer');e.blocked=!!(r&&r.blocked);throw e;}return JSON.parse(r.body);}
  function sameFloSite(st,p){
    var norm=function(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();},a=norm(st.name),b=norm(p.name),words=a.split(' ').filter(function(w){return w.length>2&&!/^(flo|charger|charging|station|network)$/.test(w);});
    return meters(st,{lat:+p.geoCoordinates.latitude,lng:+p.geoCoordinates.longitude})<=100&&a&&b&&(a===b||a.indexOf(b)>=0||b.indexOf(a)>=0||words.filter(function(w){return b.split(' ').indexOf(w)>=0;}).length>=2);
  }
  async function floPrice(x,car){
    var plugs=root.AltFuel?root.AltFuel.compatiblePlugs(car,x.st.plugs):x.st.plugs||[],key='flo-v1|'+x.st.id+'|'+x.dc+'|'+plugs.slice().sort().join(','),c=cached(key,DAY);if(c)return c;
    var parks=await floJson('near',JSON.stringify({lat:x.st.lat,lng:x.st.lng})),matches=(parks.parks||[]).filter(function(p){return [1,6].indexOf(+p.networkId)>=0&&p.geoCoordinates&&sameFloSite(x.st,p);});
    // An ambiguous co-located park must not borrow a neighbor's cheaper tariff.
    if(matches.length!==1)return null;
    var stations=(matches[0].stations||[]).filter(function(s){return (x.dc?s.level==='L3':s.level==='L2'||s.level==='L1')&&(s.connectors||[]).some(function(p){return plugs.indexOf(FLO_PLUGS[p])>=0;});});
    if(!stations.length||stations.length>8)return null;
    var units=[],prices=[];
    for(var i=0;i<stations.length;i++){var detail=await floJson('station',stations[i].id);if(!detail.geoCoordinates||!sameFloSite(x.st,detail))return null;var p=parseFlo(detail,x.dc,plugs);units=units.concat(p.units);if(!p.price)return null;prices.push(p.price);}
    if(prices.some(function(p){return p.uom!==prices[0].uom;}))return null;
    var p=Object.assign({},prices[0],{rate:Math.max.apply(null,prices.map(function(p){return p.rate;})),free:prices.every(function(p){return p.free;})}),v={price:p,units:units};keep(key,v);return v;
  }

  // ---------- Electric Era: its drivers page's public site list (price per kWh, ports, live availability) ----------
  var EE_URL = 'https://ocpi-http.app.electricera.tech/ocpi/2.2/locations_web';
  /** The list → [{lat, lng, name, open, rate}]. Coming-soon sites carry 0–2¢ placeholders, and an open site can say 0:
   * under 10¢ is no published price (never free). */
  function parseElectricEra(text) {
    var a; try { a = JSON.parse(text); } catch (e) { return []; }
    return (Array.isArray(a) ? a : []).map(function (x) { var c = +x.priceCentsKwh, g = x.coordinates || {};
      return { lat: +g.latitude, lng: +g.longitude, name: x.title || '', open: !x.expectedCompletion, rate: isFinite(c) && c >= 10 ? Math.round(c) / 100 : null };
    }).filter(function (x) { return isFinite(x.lat) && isFinite(x.lng); });
  }
  async function eeSites() { var c = cached('ee-v1', DAY); if (c) return c; var list = parseElectricEra(await json(EE_URL)); if (list.length) keep('ee-v1', list); return list; }

  // ---------- Francis Energy: its signed-out finder map (Driivz): the stations at a site, then each plug's guest price ----------
  // DOE's FCN network IDs aren't the map's station numbers, so a site is found by its coordinates (the map's match DOE's exactly).
  function fcnPlug(s) { var t = String(s.stationModelSocketSocketTypeId || '') + ' ' + String(s.name || ''); return /chademo/i.test(t) ? 'CHADEMO' : /combo|ccs/i.test(t) ? 'J1772COMBO' : /nacs|tesla|j3400/i.test(t) ? 'TESLA' : /j1772|type_1/i.test(t) ? 'J1772' : null; }
  /** A station's detail → one price per matching plug ({rate, uom, fee} or null = not published). Public US stations only. */
  function parseFrancis(d, dc, plugs) {
    var out = [];
    if (!d || d.comingSoon || d.stationAccessLevelId !== 'PUBLIC' || d.siteStationAccessLevel && d.siteStationAccessLevel !== 'PUBLIC' || d.addressCountryIso2Code && d.addressCountryIso2Code !== 'US') return out;
    (d.stationSockets || []).forEach(function (s) {
      var fast = /LEVEL3/i.test(s.stationModelSocketChargingMode || '') || s.stationModelSocketVoltageType === 'DC', p = fcnPlug(s);
      if (fast !== !!dc || !p || plugs.indexOf(p) < 0) return;
      var g = (s.socketPrices || []).filter(function (x) { return /guest/i.test(x.billingPlanCode || '') && (x.currency || x.billingSpCurrencyCurrency) === 'USD'; })[0];
      var kwh = g ? +g.kwhPrice || 0 : 0, min = g ? +g.plugInMinuteRate || 0 : 0, fee = g ? +g.transactionFee || 0 : 0;
      // all zeros = nothing published, never "free"
      out.push(kwh > 0 ? { rate: kwh, uom: 'kwh', fee: fee, extraFees: min > 0 } : min > 0 ? { rate: min, uom: 'min', fee: fee, extraFees: false } : null);
    });
    return out;
  }
  async function fcnJson(action, args) { var r = await call('fetchFrancis', action, args); if (!r || r.error || r.blocked) { var e = new Error(r && r.blocked ? 'Francis Energy\'s map refused the request; its prices are estimates this time.' : r && r.error || 'Francis Energy didn\'t answer'); e.blocked = !!(r && r.blocked) || /\bHTTP (403|429)\b/.test(r && r.error || ''); throw e; } var j = JSON.parse(r.body); if (!j || j.success === false) throw new Error('Francis Energy didn\'t answer'); return j.data; }
  async function francisPrice(x, car) {
    var plugs = root.AltFuel ? root.AltFuel.compatiblePlugs(car, x.st.plugs) : x.st.plugs || [], key = 'fcn-v1|' + x.st.id + '|' + (x.dc ? 'dc' : 'ac') + '|' + plugs.slice().sort().join(','), c = cached(key, DAY);
    if (c) return c.none ? null : c;
    var here = function (s) { return meters(x.st, { lat: +s.latitude, lng: +s.longitude }) <= 150; };
    var near = (await fcnJson('box', JSON.stringify({ lat: x.st.lat, lng: x.st.lng })) || []).filter(function (s) { return !s.comingSoon && !/test/i.test(s.caption || '') && here(s) && (x.dc ? s.chargingSpeedId !== 'SLOW' : s.chargingSpeedId === 'SLOW'); })
      .sort(function (a, b) { return (b.stationStatusId === 'AVAILABLE' ? 1 : 0) - (a.stationStatusId === 'AVAILABLE' ? 1 : 0); }).slice(0, 3);
    var prices = [];
    for (var i = 0; i < near.length; i++) { var d = await fcnJson('station', String(near[i].id)); if (d && here(d)) prices = prices.concat(parseFrancis(d, x.dc, plugs)); }
    // one plug without a published price, or plugs priced in different units: no network price for this site
    if (!prices.length || prices.some(function (p) { return !p || p.uom !== prices[0].uom; })) { keep(key, { none: true }); return null; }
    var rates = prices.map(function (p) { return p.rate; }), v = { rate: Math.max.apply(null, rates), peak: Math.max.apply(null, rates), low: Math.min.apply(null, rates), uom: prices[0].uom,
      fee: Math.max.apply(null, prices.map(function (p) { return p.fee; })), extraFees: prices.some(function (p) { return p.extraFees; }) };
    keep(key, v); return v;
  }

  /** Give each station (that a network publishes a price for) `netPrice`. items: [{st, dc, kw}]. Returns {priced, notes}. */
  async function annotate(items, car, onProg) {
    cancelled = false;
    var notes = [], priced = 0, t = Date.now(), isTesla = /tesla/i.test(car && car.make || '');
    if (S.evNetPrices === false || !items.length) return { priced: 0, notes: notes };
    var by = { tesla: [], ionna: [], blink: [], chargepoint: [],flo:[],ee:[],fcn:[] };
    items.forEach(function (x) { var n = String(x.st.network || ''); if (/^tesla(?! destination)/i.test(n) && x.dc) by.tesla.push(x); else if (/ionna/i.test(n)) by.ionna.push(x); else if (/^blink/i.test(n)) by.blink.push(x); else if (/^chargepoint/i.test(n) && chargePointIds(x.st).length) by.chargepoint.push(x);else if(/^flo$/i.test(n))by.flo.push(x);else if(/^electric[_ ]?era$/i.test(n)&&x.dc)by.ee.push(x);else if(/^fcn$|francis/i.test(n))by.fcn.push(x); });
    var set = function (x, p, src, label) { x.st.netPrice = Object.assign({ src: src, label: label, t: null }, p); priced++; };
    // The website budget limits uncached sites, not the usable catalog. Apply
    // EVERY cached rate first, including sites beyond the first 20 in provider order.
    var cpCached=0,cpDeferred=0;
    by.chargepoint=by.chargepoint.filter(function(x){
      var p=cached(cpKey(x.st),DAY);if(!p||p.none||p.missing)p=cpObserved(x.st);
      var label=function(q){return q.free?'Free, set by the station\'s host on ChargePoint':'The station host\'s ChargePoint rate'+(q.fee?' + $'+q.fee.toFixed(2)+' session fee':'');};
      if(p){set(x,p,'chargepoint',label(p));cpCached++;return false;}
      var old=cached(cpKey(x.st),0);if(!old||old.none||old.missing)old=cpObserved(x.st,true);if(old)set(x,old,'chargepoint',label(old));
      if(cached('cp-retry|'+chargePointIds(x.st).slice().sort().join(','),10*60e3)){cpDeferred++;return false;}return true;
    });
    by.chargepoint = by.chargepoint.sort(function (a, b) { return (b.dc ? 1 : 0) - (a.dc ? 1 : 0); }).slice(0, 20);
    // progress by expected time (Tesla ~0.8 s a site, ChargePoint ~8 s a page, Blink ~0.5 s), with the time left once it's measurable
    var W = { tesla: 0.8, ionna: 0.05, blink: 0.5, chargepoint: 8,flo:1,ee:0.05,fcn:2 }, total = 0, done = 0;
    by.fcn=by.fcn.slice(0,30);
    Object.keys(by).forEach(function (k) { total += by[k].length * W[k]; });
    var eta=root.__tripETA,etaWeights=new Map(),etaDone=0,etaCounted=new Set();
    if(eta)Object.keys(by).forEach(function(k){by[k].forEach(function(x){var hit=false;if(k==='tesla')hit=!!cached('tesla-v1|'+(isTesla?'t':'n')+'|'+x.st.id,DAY);else if(k==='ionna')hit=!!cached('ionna-v1',DAY);else if(k==='blink'){var sites=cached('blink-sites-v1',WEEK),near=sites&&nearest(x.st,sites,200);hit=!!(near&&cached('blink-price-v1|'+near.id+'|'+(x.dc?'dc':'ac'),DAY));}else if(k==='flo'){var plugs=root.AltFuel?root.AltFuel.compatiblePlugs(car,x.st.plugs):x.st.plugs||[];hit=!!cached('flo-v1|'+x.st.id+'|'+x.dc+'|'+plugs.slice().sort().join(','),DAY);}else if(k==='ee')hit=!!cached('ee-v1',DAY);else if(k==='fcn'){var fplugs=root.AltFuel?root.AltFuel.compatiblePlugs(car,x.st.plugs):x.st.plugs||[];hit=!!cached('fcn-v1|'+x.st.id+'|'+(x.dc?'dc':'ac')+'|'+fplugs.slice().sort().join(','),DAY);}if(!hit)etaWeights.set(x,W[k]);});});
    var etaTotal=0;etaWeights.forEach(function(w){etaTotal+=w;});var etaPrices=eta&&eta.begin('charger-prices','charger-prices',etaTotal,1000,'Reading charger prices (cached tariffs excluded)');
    var report = function () { if (!onProg) return; var f = Math.min(0.99, done / Math.max(0.001, total)), el = Date.now() - t, left = f > 0.05 && el > 4000 ? el / f * (1 - f) : 0;
      onProg(f, left ? 'about ' + (left < 90e3 ? Math.max(1, Math.round(left / 1000 / 5) * 5) + ' s' : Math.round(left / 60e3) + ' min') + ' left' : ''); };
    var step = function (k, n, cacheBatch) { done += (n == null ? 1 : n) * W[k];if(etaPrices){var count=n==null?1:n;by[k].forEach(function(x){if(count>0&&!etaCounted.has(x)&&(k!=='tesla'||etaWeights.has(x)!==!!cacheBatch)){etaCounted.add(x);etaDone+=etaWeights.get(x)||0;count--;}});etaPrices.progress(etaDone);}report(); };
    if (by.ionna.length) try { var ion = await ionnaSites(); by.ionna.forEach(function (x) { var s = nearest(x.st, ion, 250); if (s && s.open) set(x, { t:s.t,rate: s.rate, peak: s.rate, low: s.rate, uom: 'kwh', fee: 0, tax: s.tax }, 'ionna', 'IONNA\'s published rate' + (s.tax ? ' plus tax' : '')); step('ionna'); }); }
      catch (e) { notes.push('IONNA\'s price list didn\'t load: ' + e.message); }
    if (by.blink.length) try {
      var bs = await blinkSites(), queue = by.blink.map(function (x) { return { x: x, s: nearest(x.st, bs, 200) }; }).filter(function (q) { return q.s; }).slice(0, 80);
      var lane = async function () { while (queue.length) { var q = queue.shift(); try { var p = await blinkPrice(q.s.id, q.x.dc); if (p) set(q.x, p, 'blink', 'The charger\'s host-set Blink rate' + (p.fee ? ' + $' + p.fee.toFixed(2) + ' session fee' : '')); } catch (e) { if (e.blocked) { queue.length = 0; if (notes.indexOf(e.message) < 0) notes.push(e.message); } } step('blink'); await new Promise(function (ok) { setTimeout(ok, 250); }); } };
      await Promise.all([lane(), lane(), lane()]);
    } catch (e) { notes.push('Blink\'s charger map didn\'t load: ' + e.message); }
    if (by.tesla.length) try { var tp = await teslaPrices(by.tesla.map(function (x) { return x.st; }), isTesla, function (n, cacheBatch) { step('tesla', n, cacheBatch); }); by.tesla.forEach(function (x) { var p = tp[x.st.id]; if (p) set(x, { t:p.t,rate: p.peak, peak: p.peak, low: p.low, uom: p.uom, fee: 0, congestion: p.congestion, tou: p.tou }, 'tesla', 'Tesla\'s published ' + (isTesla ? 'Tesla-owner' : 'non-Tesla') + ' rate' + (p.tou && p.low < p.peak ? ' (peak; off-peak $' + p.low.toFixed(2) + ')' : '')); }); }
      catch (e) { notes.push(e.message); if (e.partial) by.tesla.forEach(function (x) { var p = e.partial[x.st.id]; if (p) set(x, { t:p.t,rate: p.peak, peak: p.peak, low: p.low, uom: p.uom, fee: 0 }, 'tesla', 'Tesla\'s published rate'); }); }
    for(var fi=0;fi<Math.min(24,by.flo.length)&&!cancelled;fi++){var fx=by.flo[fi];try{var fp=await floPrice(fx,car);if(fp&&fp.price){set(fx,Object.assign({},fp.price,{t:fp.t}),'flo','FLO\'s published host rate (additional fees may apply)');fx.st.units=(fx.st.units||[]).filter(function(u){return fx.dc?u.charging_level!=='dc_fast':u.charging_level==='dc_fast';}).concat(fp.units);}}catch(e){if(notes.indexOf(e.message)<0)notes.push(e.message);if(e.blocked)break;}step('flo');}
    if (by.ee.length) try { var ee = await eeSites(); by.ee.forEach(function (x) { var s = nearest(x.st, ee, 250); if (s && s.open && s.rate != null) set(x, { t: s.t, rate: s.rate, peak: s.rate, low: s.rate, uom: 'kwh', fee: 0 }, 'electricera', 'Electric Era\'s published rate'); step('ee'); }); }
      catch (e) { notes.push('Electric Era\'s price list didn\'t load: ' + e.message); }
    for (var ri = 0; ri < by.fcn.length && !cancelled; ri++) { var rx = by.fcn[ri]; try { var rp = await francisPrice(rx, car); if (rp) set(rx, rp, 'francis', 'Francis Energy\'s published guest rate' + (rp.fee ? ' + $' + rp.fee.toFixed(2) + ' session fee' : '') + (rp.extraFees ? ' (plus a per-minute fee)' : '')); } catch (e) { if (notes.indexOf(e.message) < 0) notes.push(e.message); if (e.blocked) break; } step('fcn'); }
    if(by.flo.length>24)notes.push('FLO website reads covered 24 route sites; other sites need a published inventory price or remain excluded.');
    // pages that never load (the station's data refused or unknown) cost ~4 s each: stop after CP_GIVE_UP in a row with none priced
    var cpMiss = 0, cpGot = 0;
    for (var ci = 0; ci < by.chargepoint.length; ci++) { var cx = by.chargepoint[ci]; if (cpMiss >= CP_GIVE_UP && !cpGot) { notes.push('ChargePoint\'s station pages didn\'t load, so its prices are estimates this time.'); LG.info('stations', 'ChargePoint reads stopped', { pagesMissing: cpMiss }); break; }
      try { var cpP = await chargePointPrice(cx.st); if (cpP) cpGot++; else cpMiss++; if (cpP) set(cx, cpP, 'chargepoint', cpP.free ? 'Free, set by the station\'s host on ChargePoint' : 'The station host\'s ChargePoint rate' + (cpP.fee ? ' + $' + cpP.fee.toFixed(2) + ' session fee' : '')); } catch (e) { if (e.blocked) { notes.push(e.message); break; } } step('chargepoint'); }
    LG.info('stations', 'Charger network prices', { tesla: by.tesla.length, ionna: by.ionna.length, blink: by.blink.length, chargepoint: by.chargepoint.length, chargepointCached:cpCached,chargepointDeferred:cpDeferred, flo:by.flo.length, electricEra:by.ee.length, francis:by.fcn.length, priced: priced, ms: Date.now() - t });
    if(etaPrices)etaPrices.finish(!cancelled&&!verification&&!notes.length);return { priced: priced, notes: notes };
  }
  root.EVPrices = { annotate: annotate, cancel: cancel, onVerified: onVerified, dismissCheck: dismissCheck, isPaused: function () { return !!verification; }, parseIonna: parseIonna, parseBlinkPrice: parseBlinkPrice, parseFlo:parseFlo, parseElectricEra:parseElectricEra, parseFrancis:parseFrancis, parseChargePoint: parseChargePoint, chargePointIds: chargePointIds, money: money };
})(window);
