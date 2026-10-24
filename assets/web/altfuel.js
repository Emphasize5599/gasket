/* Alternative fuels: EV fast chargers and hydrogen stations from the U.S. Department of Energy's free station finder
 * (Alternative Fuels Data Center, developer.nlr.gov). DEMO_KEY is 30/hour and 50/day per public IP.
 * Settings → Connections takes a personal key and an optional offline inventory. Never logged or ordinarily exported.
 *
 * - Main map: a ⚡ button opens the alt-fuel panel: fetch every hydrogen station, show them, and shade where a
 *   fuel-cell car can't make it (yellow: no station within half its range, so no way back; gray: none within its
 *   whole range). EV fast chargers in the map area, filtered to your car's plug.
 * - Trips (EV / fuel-cell car): chargers or hydrogen stations along each route option become the stops.
 * Loaded after tripui.js. */
(function () {
  'use strict';
  var A = window.__app, S = A.S, P = A.P, $ = A.$, esc = A.esc, KV = A.KV, N = A.N, map = A.map;
  var LG = window.FLog || { info: function () {}, debug: function () {}, warn: function () {}, error: function () {} };
  var BASE = 'https://developer.nlr.gov/api/alt-fuel-stations/v1';
  var WEEK = 7 * 24 * 3600e3;
  var ROAD = 1.3;             // roads are ~30% longer than a straight line (typical detour index)
  S.alt = Object.assign({ h2Cov: true, h2Range: '', evSpeed: 'dc', h2Press: 'all' }, S.alt || {});
  // the fuel mode (the top bar's pill, app.js) decides what's on the map: chargers in ⚡, hydrogen stations in H₂
  function evOn() { return S.fuelMode === 'ev'; }
  function h2On() { return S.fuelMode === 'h2'; }
  var LEVEL = { dc: 'dc_fast', l2: '2', all: 'all' };
  var routePending=new Map(),cooldown=new Map();
  function tripTypes(value){return Object.assign({dc:true,l2:true,l1:false},value||{});}
  function routePlugs(plugs){return Array.from(new Set(plugs||['J1772COMBO','TESLA','CHADEMO','J1772']));}
  function compatiblePlugs(car,fast){var nacs=(car.plug||'CCS')==='NACS';return routePlugs((fast||[]).concat(!nacs||car.acAdapter===true?['J1772']:[],!nacs&&car.acAdapter===true?['TESLA']:[]));}

  function key() { return String(S.nrelKey || '').trim() || 'DEMO_KEY'; }
  function call() { return window.__trip.call.apply(null, arguments); }
  function unitOf(kind) { return kind === 'ev' ? 'kWh' : kind === 'h2' ? 'kg' : 'gal'; }

  /** One request to the station finder -> parsed JSON (throws a readable message). The key never reaches the log. */
  async function get(path, params, post) {
    var credential=key();if((cooldown.get(credential)||0)>Date.now())throw new Error('Station discovery is paused after the provider limit. Cached chargers remain available; add your own free station-finder key in Settings → Connections.');
    if(window.ChargerData)ChargerData.before('doe',credential);
    var q = Object.keys(params).filter(function (k) { return params[k] !== '' && params[k] != null; })
      .map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    var url = BASE + path + '?api_key=' + encodeURIComponent(key()) + '&' + q;
    LG.debug('altfuel', 'Station finder ' + path, params.fuel_type || '');
    var r = post&&N.fetchStationRoute?await call('fetchStationRoute',credential,q):await call('fetchJson', url);
    if(window.ChargerData)ChargerData.after('doe',credential,r);
    if (r.error) {
      var m = String(r.error);
      if (/429/.test(m)){cooldown.set(credential,Date.now()+3600e3);throw new Error(credential === 'DEMO_KEY' ? 'The demo station-finder allowance for this public IP hit its hourly or daily limit. Cached chargers are retained. Add a free personal key in Settings → Connections.' : 'Your station-finder key hit its limit. Cached chargers are retained; try again later.');}
      if (/40[13]/.test(m)) throw new Error('The station finder didn\'t accept the key. Check it in Settings → Connections.');
      if (/not allowed/i.test(m)) throw new Error('This version of the app can\'t reach the station finder yet.');
      throw new Error('Couldn\'t reach the station finder (' + m + ').');
    }
      try { var parsed=JSON.parse(r.body);if(!Array.isArray(parsed.fuel_stations)||parsed.errors&&(!Array.isArray(parsed.errors)||parsed.errors.length))throw new Error('Station finder rejected the request');return parsed; } catch (e) { throw new Error('The station finder sent an unreadable or unsuccessful answer.'); }
  }

  // Charging speed: the finder lists ports, not always power. Where it gives power per connector we use the most;
  // otherwise a typical figure for the network (marked as an estimate).
  var NET_KW = [[/tesla/i, 250], [/ionna/i, 350], [/electrify america/i, 150], [/rivian/i, 200], [/francis/i, 150], [/evgo/i, 100], [/mercedes/i, 300], [/walmart/i, 150], [/chargepoint/i, 62], [/./, 50]];
  function powerOf(f) {
    var best = 0;
    (function walk(o, d) {
      if (!o || typeof o !== 'object' || d > 5) return;
      Object.keys(o).forEach(function (k) {
        var v = o[k];
        if (/power_kw/i.test(k) && +v > best) best = +v;
        else if (typeof v === 'object') walk(v, d + 1);
      });
    })(f.ev_charging_units, 0);
    if (best > 0) return { kw: Math.round(best), est: false };
    var net = String(f.ev_network || '');
    for (var i = 0; i < NET_KW.length; i++) if (NET_KW[i][0].test(net)) return { kw: NET_KW[i][1], est: true };
    return { kw: 50, est: true };
  }
  var NETS = { 'Tesla': 'Tesla Supercharger', 'Tesla Destination': 'Tesla Destination', 'eVgo Network': 'EVgo', 'Electrify America': 'Electrify America',
    'ChargePoint Network': 'ChargePoint', 'Blink Network': 'Blink', 'EV Connect': 'EV Connect', 'FLO': 'FLO', 'RIVIAN_ADVENTURE': 'Rivian Adventure', 'Non-Networked': '' };
  function norm(f) {
    if (!f || f.latitude == null || f.longitude == null) return null;
    var ev = f.fuel_type_code === 'ELEC', pw = ev ? powerOf(f) : null;
    var station = {
      id: 'afdc' + f.id, afdcId: f.id, brand: ev ? 'ev' : 'h2', name: String(f.station_name || (ev ? 'EV charger' : 'Hydrogen station')).trim(),
      network: ev ? (NETS[f.ev_network] != null ? NETS[f.ev_network] : String(f.ev_network || '')) : '',
      address: [f.street_address, f.city, [f.state, f.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), state: f.state || '',
      lat: +f.latitude, lng: +f.longitude, dc: +f.ev_dc_fast_num || 0, l2: +f.ev_level2_evse_num || 0, plugs: f.ev_connector_types || [],
      l1:+f.ev_level1_evse_num||0,units:f.ev_charging_units||[],
      kw: pw ? pw.kw : 0, kwEst: pw ? pw.est : false, pricing: String(f.ev_pricing || '').trim(), netIds: f.ev_network_ids && typeof f.ev_network_ids === 'object' ? { station: [].concat(f.ev_network_ids.station || []).map(String).slice(0, 4), posts: [].concat(f.ev_network_ids.posts || []).map(String).slice(0, 8) } : null,
      source:'DOE AFDC',sourceUrl:'https://afdc.energy.gov/stations/#/station/'+f.id,dataUpdated:f.updated_at||'',country:f.country||'',
      hours: String(f.access_days_time || '').trim(), status: f.status_code || 'E', phone: f.station_phone || '',
      hyPress: f.hy_pressures || [], hyLink: f.hy_status_link || '', retail: f.hy_is_retail, confirmed: f.date_last_confirmed || '',
      off: f.distance != null ? +f.distance : null, prices: {}
    };
    return station;
  }
  function normalizedRows(raw){var rows=raw.map(norm).filter(Boolean);if(window.PriceHistory)PriceHistory.observe(rows);return rows;}

  /** Every open, public hydrogen station (US and Canada), kept a week. force: fetch again now. */
  async function hydrogenAll(force) {
    var o = !force && KV.get('afdc', 'hy-all', WEEK);
    if (o) return { list: normalizedRows(o.v), t: o.t };
    var j = await get('.json', { fuel_type: 'HY', status: 'E', access: 'public', country: 'all', limit: 'all' });
    var raw = j.fuel_stations || [];
    KV.put('afdc', 'hy-all', raw);
    LG.info('altfuel', 'Fetched ' + raw.length + ' hydrogen stations');
    return { list: normalizedRows(raw), t: Date.now() };
  }
  function plugParam(plugs) { return plugs && plugs.length ? plugs.join(',') : 'J1772COMBO,TESLA,CHADEMO'; }
  /** DC fast chargers within radius miles of a point that take one of these plugs, kept a week. */
  async function evNear(lat, lng, radiusMi, plugs, speed) {
    if(window.ChargerData){
      var saved=await ChargerData.localNear(lat,lng,radiusMi);
      if(saved)return normalizedRows(saved.fuel_stations).filter(function(s){return P.haversineMi(lat,lng,s.lat,s.lng)<=radiusMi&&s.plugs.some(function(p){return !plugs||plugs.indexOf(p)>=0;})&&(speed==='all'||(speed==='l2'?s.l2>0:s.dc>0));});
    }
    var lvl = LEVEL[speed] || 'dc_fast';
    var k = 'ev|' + lat.toFixed(2) + ',' + lng.toFixed(2) + '|' + Math.round(radiusMi) + '|' + plugParam(plugs) + (lvl === 'dc_fast' ? '' : '|' + lvl);
    var o = KV.get('afdc', k, WEEK);
    if (o) return normalizedRows(o.v);
    var j = await get('/nearest.json', { latitude: lat.toFixed(5), longitude: lng.toFixed(5), radius: Math.min(500, Math.round(radiusMi)), fuel_type: 'ELEC',
      ev_charging_level: lvl, ev_connector_type: plugParam(plugs), status: 'E', access: 'public', limit: 200 });
    var raw = j.fuel_stations || [];
    KV.put('afdc', k, raw);
    return normalizedRows(raw);
  }
  /**
   * Full-route station discovery: bounded native POST avoids GET URL limits and repeated 400-mile queries.
   * Answers are cached for a week by geometry, corridor, connectors and selected levels.
   */
  // Douglas–Peucker in miles: retain bends rather than sampling across highway curves.
  function routePoints(points){
    if(points.length<3)return points;
    var keep=new Set([0,points.length-1]),stack=[[0,points.length-1]];
    while(stack.length){var pair=stack.pop(),a=points[pair[0]],b=points[pair[1]],scale=Math.cos((a.lat+b.lat)*Math.PI/360),dx=(b.lng-a.lng)*scale,dy=b.lat-a.lat,den=dx*dx+dy*dy,best=0,at=-1;
      for(var i=pair[0]+1;i<pair[1];i++){var p=points[i],x=(p.lng-a.lng)*scale,y=p.lat-a.lat,t=den?Math.max(0,Math.min(1,(x*dx+y*dy)/den)):0,d=Math.hypot(x-t*dx,y-t*dy)*69;if(d>best){best=d;at=i;}}
      if(best>0.1){keep.add(at);stack.push([pair[0],at],[at,pair[1]]);}
    }
    return points.filter(function(_,i){return keep.has(i);});
  }
  var discoveredPool=new Map();
  async function onlineRoute(model, kind, plugs, corridorMi, onProg, types) {
    types=tripTypes(types);var wanted=routePlugs(plugs),levels=[types.dc?'dc_fast':'',types.l2?'2':'',types.l1?'1':''].filter(Boolean);
    if(kind==='ev'&&!levels.length)throw new Error('Select at least one charger type in Parameters → Charging stops.');
    var pts=routePoints(model.pts||[]);if(pts.length<2)pts=[model.pointAt(0),model.pointAt(model.totalMi)].filter(Boolean);
    var coords=pts.map(function(p){return p.lng.toFixed(5)+' '+p.lat.toFixed(5);}),line='LINESTRING('+coords.join(',')+')',reverse='LINESTRING('+coords.slice().reverse().join(',')+')';
    var params={route:line,distance:corridorMi+0.15,fuel_type:kind==='ev'?'ELEC':'HY',status:kind==='ev'?'E,T':'E',access:'public',limit:'all'};
    if(kind==='ev'){params.ev_charging_level=levels.length===1?levels[0]:'all';params.ev_connector_type=plugParam(wanted);}
    var ck='route-v2|'+kind+'|'+corridorMi+'|'+levels.join(',')+'|'+wanted.join(',')+'|'+(line<reverse?line:reverse),o=KV.get('afdc',ck,kind==='ev'&&window.ChargerData?3600e3:WEEK),raw;
    try{
      if(o)raw=o.v;else{
        var promise=routePending.get(ck);if(!promise){promise=get('/nearby-route.json',params,true).then(function(j){var rows=j.fuel_stations||[];KV.put('afdc',ck,rows);return rows;}).finally(function(){routePending.delete(ck);});routePending.set(ck,promise);}
        raw=await promise;
      }
      var list=normalizedRows(raw);list.forEach(function(s){discoveredPool.set(s.id,s);});
      if(onProg)onProg(1);LG.info('altfuel','Route station discovery',{kind:kind,stations:list.length,points:pts.length,cached:!!o,levels:levels});return list;
    }catch(e){e.stations=Array.from(discoveredPool.values()).filter(function(s){return s.brand===kind;});throw e;}
  }
  async function alongRoute(model,kind,plugs,corridorMi,onProg,types){
    if(kind!=='ev'||!window.ChargerData)return onlineRoute(model,kind,plugs,corridorMi,onProg,types);
    var list=[],notes=[],hasInventory=false;
    try{var local=await ChargerData.localRoute(model,corridorMi);if(local){hasInventory=true;list=normalizedRows(local.fuel_stations);if(Date.now()-local.updated>30*24*3600e3)notes.push('Offline chargers were downloaded over 30 days ago. Update the inventory for new and closed sites.');}}
    catch(e){notes.push('Offline charger lookup failed: '+e.message);}
    if(S.evUseDOE!==false&&(!hasInventory||S.evRefreshPrices!==false))try{list=ChargerData.merge(list,await onlineRoute(model,kind,plugs,corridorMi,onProg,types));}catch(e){list=ChargerData.merge(list,e.stations||[]);notes.push(e.message);}
    if(S.evUseOCM)try{list=ChargerData.merge(list,await ChargerData.ocmRoute(model,corridorMi));}catch(e){list=ChargerData.merge(list,e.stations||[]);notes.push(e.message);}
    if(!hasInventory&&S.evUseDOE===false&&!S.evUseOCM)notes.push('Download the offline charger inventory or enable a charger provider in Settings → Connections.');
    if(onProg)onProg(1);
    list=list.filter(function(s){return s.status==='E';});
    if(notes.length){var error=new Error(notes.join(' '));error.stations=list;throw error;}
    return list;
  }
  // Match speed and connector on the same unit when provider unit detail is available.
  function charging(st, car, types, plugs){
    types=tripTypes(types);plugs=compatiblePlugs(car,plugs);var candidates=[];
    if(types.superchargers&&(!(st.dc>0)||!/^(?:tesla|tesla supercharger)$/i.test(String(st.network||'').trim())))return null;
    if(types.superchargers)types=Object.assign({},types,{dc:true,l2:false,l1:false});
    var counts={dc_fast:st.dc,'2':st.l2,'1':st.l1},enabled={dc_fast:types.dc,'2':types.l2,'1':types.l1};
    function accepts(p,level){if(plugs.indexOf(p)<0)return false;if(level==='dc_fast')return p!=='J1772'&&!/^NEMA/.test(p);if(p==='TESLA')return car.plug==='NACS'||car.acAdapter===true;if(p==='J1772')return (car.plug||'CCS')!=='NACS'||car.acAdapter===true;return false;}
    function add(level,kw){var dc=level==='dc_fast',cap=dc?(+car.dcKw||150):(+car.acKw||7.2),stationKw=kw||(dc?(st.kw||50):level==='1'?1.4:7.2);candidates.push({level:level,stationKw:stationKw,kw:Math.max(0.1,(dc?0.7:0.9)*Math.min(cap,stationKw)),estimated:!kw||!!st.kwEst});}
    if(st.units&&st.units.length)st.units.forEach(function(u){var level=u.charging_level;if(!enabled[level])return;Object.keys(u.connectors||{}).forEach(function(p){var port=u.connectors[p];if(accepts(p,level)&&port&&+port.port_count>0)add(level,+port.power_kw||0);});});
    else Object.keys(counts).forEach(function(level){if(enabled[level]&&counts[level]>0&&(st.plugs||[]).some(function(p){return accepts(p,level);}))add(level,level==='dc_fast'&&!st.kwEst?st.kw:0);});
    return candidates.sort(function(a,b){return b.kw-a.kw;})[0]||null;
  }
  function avgKw(st, car) {var c=charging(st,car||{},null,st.plugs);return c?c.kw:0;}

  // ---------- main map: markers, coverage, the panel ----------
  var cov = null, h2Layer = null, evLayer = null, h2List = [], evList = [], h2T = 0, renderer = null;
  function mainMap(){return typeof document==='undefined'||!document.body||!document.body.classList.contains('trip-on');}
  function syncVisibility(){
    [[h2Layer,mainMap()&&h2On()],[evLayer,mainMap()&&evOn()],[cov,mainMap()&&h2On()&&S.alt.h2Cov]].forEach(function(x){if(!x[0])return;if(x[1]&&!map.hasLayer(x[0]))x[0].addTo(map);else if(!x[1]&&map.hasLayer(x[0]))map.removeLayer(x[0]);});
    legend();
  }
  var lastMain=mainMap();
  if(typeof MutationObserver!=='undefined'&&document.body)new MutationObserver(function(){var on=mainMap();if(on!==lastMain){lastMain=on;syncVisibility();}}).observe(document.body,{attributes:true,attributeFilter:['class']});
  function panes() {
    if (!map.getPane('afcov')) { map.createPane('afcov'); map.getPane('afcov').style.zIndex = 350; map.getPane('afcov').style.pointerEvents = 'none'; }
    if (!map.getPane('afdots')) { map.createPane('afdots'); map.getPane('afdots').style.zIndex = 620; }
    if (!renderer) renderer = L.canvas({ pane: 'afdots', padding: 0.3 });
  }
  /** What a station's popup says. */
  function stationHtml(s) {
    var h = '<div class="af-pop"><b>' + esc(s.name) + '</b>' + (s.network ? '<small>' + esc(s.network) + '</small>' : '') +
      '<div>' + esc(s.address) + '</div>';
    if (s.brand === 'ev') h += '<div>' + s.dc + ' fast port' + (s.dc === 1 ? '' : 's') + ' · ' + (s.kwEst ? '~' : '') + s.kw + ' kW' + (s.kwEst ? ' (typical for the network)' : '') + '</div>' +
      '<div>' + esc(s.plugs.map(plugName).join(', ')) + '</div>';
    else h += '<div>' + (s.hyPress.length ? esc(s.hyPress.join(', ')) + ' bar' : 'Hydrogen') + '</div>';
    if (s.pricing) h += '<div class="af-sm">' + esc(s.pricing) + '</div>';
    if(s.source)h+='<div class="af-sm">'+esc(s.source)+(s.provider&&s.provider!==s.source?' · '+esc(s.provider):'')+(s.license?' · '+esc(s.license):'')+'</div>';
    if(s.alternateSources&&s.alternateSources.length)h+='<details><summary>Additional sources</summary>'+s.alternateSources.map(function(p){return '<div class="af-sm">'+esc([p.source,p.provider,p.license].filter(Boolean).join(' · '))+'</div>';}).join('')+'</details>';
    if (s.hours) h += '<div class="af-sm">' + esc(s.hours) + '</div>';
    h += '<div class="af-act"><button data-afnav="' + esc(s.id) + '">Navigate</button>' + (s.hyLink ? '<button data-afurl="' + esc(s.hyLink) + '">Live status</button>' : '') + '</div></div>';
    return h;
  }
  function plugName(p) { return { J1772COMBO: 'CCS', TESLA: 'NACS (Tesla)', CHADEMO: 'CHAdeMO', J1772: 'J1772', J3271: 'MCS' }[p] || p; }
  var marks = {};
  function drawDots(list, layer, color) {
    layer.clearLayers();
    list.forEach(function (s) {
      var m = marks[s.id] = L.circleMarker([s.lat, s.lng], { renderer: renderer, radius: 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 });
      m.bindPopup(stationHtml(s), { className: 'af-popup', maxWidth: 260 });
      m.on('popupopen', function (e) {
        var el = e.popup.getElement(); if (!el) return;
        el.querySelectorAll('[data-afnav]').forEach(function (b) { b.onclick = function () { N.navigate(s.lat, s.lng, '', s.name); }; });
        el.querySelectorAll('[data-afurl]').forEach(function (b) { b.onclick = function () { N.openUrl(b.dataset.afurl); }; });
      });
      layer.addLayer(m);
    });
  }
  /** The range to shade for: your fuel-cell car's (selected first), else what you typed, else 350 mi. */
  function h2Range() {
    var typed = parseFloat(S.alt.h2Range);
    if (typed > 0) return { mi: typed, src: 'you entered it' };
    var G = window.Garage, cars = (S.cars || []).filter(function (c) { return G && G.kind(c) === 'h2'; });
    var sel = cars.filter(function (c) { return c.id === S.carId; })[0] || cars[0];
    var r = sel && G.rangeMi(sel);
    if (r > 0) return { mi: Math.round(r), src: 'your ' + G.shortName(sel) };
    return { mi: 350, src: 'a typical fuel-cell car' };
  }
  var Cov = L.GridLayer.extend({
    // Cache smooth geographic outlines, not a per-tile nearest-station pixel grid.
    rings: function(z){
      if(!this._rings)this._rings=new Map();if(this._rings.has(z))return this._rings.get(z);
      var world=map.getPixelWorldBounds(z).getSize().x,rings=[],rad=Math.PI/180;
      this.options.st.forEach(function(s){
        [1,.5].forEach(function(part){
          var mi=this.options.rangeMi*part/ROAD,delta=mi/3958.7613,lat=s.lat*rad,lng=s.lng*rad;
          var pixels=mi*world/(24901.46*Math.max(.05,Math.cos(lat))),n=Math.max(96,Math.min(2048,Math.ceil(Math.PI*Math.sqrt(Math.max(1,pixels)/.25))));
          var pts=new Float64Array((n+1)*2),bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
          for(var i=0;i<=n;i++){
            var angle=i/n*Math.PI*2,la=Math.asin(Math.sin(lat)*Math.cos(delta)+Math.cos(lat)*Math.sin(delta)*Math.cos(angle));
            var lo=lng+Math.atan2(Math.sin(angle)*Math.sin(delta)*Math.cos(lat),Math.cos(delta)-Math.sin(lat)*Math.sin(la));
            var p=map.project(L.latLng(Math.max(-85.05112878,Math.min(85.05112878,la/rad)),lo/rad),z);pts[i*2]=p.x;pts[i*2+1]=p.y;
            bounds.minX=Math.min(bounds.minX,p.x);bounds.maxX=Math.max(bounds.maxX,p.x);bounds.minY=Math.min(bounds.minY,p.y);bounds.maxY=Math.max(bounds.maxY,p.y);
          }
          rings.push({part:part,pts:pts,bounds:bounds});
        },this);
      },this);
      var result={world:world,rings:rings};this._rings.set(z,result);if(this._rings.size>2)this._rings.delete(this._rings.keys().next().value);return result;
    },
    createTile: function (c) {
      var sz=this.getTileSize(),ratio=Math.min(2,window.devicePixelRatio||1),t=document.createElement('canvas'),mask=document.createElement('canvas');
      t.width=mask.width=Math.round(sz.x*ratio);t.height=mask.height=Math.round(sz.y*ratio);
      var ctx=t.getContext('2d'),mc=mask.getContext('2d'),data=this.rings(c.z),x0=c.x*sz.x,y0=c.y*sz.y;
      ctx.scale(ratio,ratio);mc.scale(ratio,ratio);
      function paint(part){
        data.rings.forEach(function(r){
          if(r.part!==part||r.bounds.maxY<y0-1||r.bounds.minY>y0+sz.y+1)return;
          var nearest=Math.round((x0+sz.x/2-(r.bounds.minX+r.bounds.maxX)/2)/data.world)*data.world;
          for(var copy=-1;copy<=1;copy++){
            var shift=nearest+copy*data.world;if(r.bounds.maxX+shift<x0-1||r.bounds.minX+shift>x0+sz.x+1)continue;
            mc.beginPath();for(var i=0;i<r.pts.length;i+=2){var x=r.pts[i]+shift-x0,y=r.pts[i+1]-y0;if(!i)mc.moveTo(x,y);else mc.lineTo(x,y);}mc.closePath();mc.fill();
          }
        });
      }
      ctx.fillStyle='rgba(55,60,70,.46)';ctx.fillRect(0,0,sz.x,sz.y);
      mc.fillStyle='#fff';paint(1); // full-range union: replace gray with yellow
      ctx.globalCompositeOperation='destination-out';ctx.drawImage(mask,0,0,sz.x,sz.y);
      mc.globalCompositeOperation='source-in';mc.fillStyle='rgba(255,196,32,.40)';mc.fillRect(0,0,sz.x,sz.y);
      ctx.globalCompositeOperation='source-over';ctx.drawImage(mask,0,0,sz.x,sz.y);
      mc.globalCompositeOperation='source-over';mc.clearRect(0,0,sz.x,sz.y);mc.fillStyle='#fff';paint(.5);
      ctx.globalCompositeOperation='destination-out';ctx.drawImage(mask,0,0,sz.x,sz.y);return t;
    }
  });
  function drawCoverage() {
    if (cov) { map.removeLayer(cov); cov = null; }
    if (!h2On() || !S.alt.h2Cov || !h2List.length) { legend(); return; }
    panes();
    cov = new Cov({ pane: 'afcov', rangeMi: h2Range().mi, st: h2List.map(function (s) { return { lat: s.lat, lng: s.lng }; }), updateWhenZooming: true, keepBuffer: 1 });
    cov.addTo(map);
    syncVisibility();
  }
  function legend() {
    var el = $('afLegend');
    var on = mainMap() && h2On() && S.alt.h2Cov && h2List.length;
    if (!on) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'afLegend'; el.className = 'af-legend'; document.body.appendChild(el); }
    var r = h2Range();
    el.innerHTML = '<span><i class="y"></i>No H₂ within ' + Math.round(r.mi / 2) + ' mi — can\'t get back</span><span><i class="g"></i>None within ' + r.mi + ' mi — out of range</span>';
  }
  function showH2() {
    panes();
    if (!h2Layer) h2Layer = L.layerGroup().addTo(map);
    if (h2On()) drawDots(h2Shown(), h2Layer, P.ALT.h2.color); else h2Layer.clearLayers();
    drawCoverage();
    syncVisibility();
  }
  function showEv() {
    panes();
    if (!evLayer) evLayer = L.layerGroup().addTo(map);
    if (evOn()) drawDots(evList, evLayer, P.ALT.ev.color); else evLayer.clearLayers();
    syncVisibility();
  }
  function carPlugs() { var G = window.Garage, c = G && G.car(); return c && G.kind(c) === 'ev' ? compatiblePlugs(c,G.plugs(c)) : null; }

  function openPanel() {
    var old = $('afPick'); if (old) old.remove();
    var bg = document.createElement('div'); bg.className = 'tpick-bg'; bg.id = 'afPick';
    var r = h2Range(), plugs = carPlugs();
    var ago = h2T ? A.ago(new Date(h2T)) : '';
    bg.innerHTML = '<div class="tpick af" role="dialog" aria-label="Alternative fuels"><div class="tpick-h af-h"><span>EV & hydrogen</span><button class="x" id="afX" aria-label="Close">✕</button></div>' +
      '<div class="af-sec"><div class="af-t"><span class="af-ic h2">H₂</span><b>Hydrogen (fuel cell)</b></div>' +
      '<button class="btn tonal" id="afH2Get">' + (h2List.length ? 'Fetch all hydrogen stations again' : 'Fetch all hydrogen stations') + '</button>' +
      '<div class="af-msg" id="afH2Msg">' + (h2List.length ? h2List.length + ' open public stations' + (ago ? ' · fetched ' + esc(ago) : '') : 'Every open public station in the U.S. and Canada — one free lookup.') + '</div>' +

      '<div class="field"><div class="lbl">Shade what\'s out of reach<small>Yellow: no station within half your range — you couldn\'t get back. Gray: none within your whole range. Straight-line distance × 1.3 for roads, so it\'s a rough guide.</small></div>' + swHtml('afH2Cov', S.alt.h2Cov) + '</div>' +
      '<div class="field"><div class="lbl">Range on a full tank (mi)<small id="afRangeSrc">blank = ' + esc(r.src) + (parseFloat(S.alt.h2Range) > 0 ? '' : ' (' + r.mi + ' mi)') + '</small></div><input type="number" inputmode="numeric" id="afRange" min="50" max="900" step="10" value="' + esc(S.alt.h2Range || '') + '" placeholder="' + r.mi + '"></div></div>' +
      '<div class="af-sec"><div class="af-t"><span class="af-ic ev">⚡</span><b>EV fast chargers</b></div>' +
      '<button class="btn tonal" id="afEvGet">Find chargers in this area</button>' +
      '<div class="af-msg" id="afEvMsg">' + (evList.length ? evList.length + ' found' : 'DC fast chargers (Level 3) around the middle of the map') + ' · ' + (plugs ? 'plugs your car takes: ' + esc(plugs.map(plugName).join(', ')) : 'any plug') + '</div>' +
      '</div>' +
      '<p class="lead small keep">From the U.S. Department of Energy\'s station finder (Alternative Fuels Data Center). Stations can be down without notice — hydrogen especially; check the live status before you go.</p></div>';
    document.body.appendChild(bg);
    requestAnimationFrame(function () { bg.classList.add('on'); });
    var close = function () { bg.classList.remove('on'); setTimeout(function () { bg.remove(); }, 200); };
    bg.onclick = function (e) { if (e.target === bg) close(); };
    $('afX').onclick = close;
    var sw = function (id, k, fn) { bg.querySelector('[data-af="' + id + '"]').onchange = function () { S.alt[k] = this.checked; A.save(); fn(); }; };
    sw('afH2Cov', 'h2Cov', drawCoverage);
    $('afRange').onchange = function () { var v = parseFloat(this.value); S.alt.h2Range = v > 0 ? String(Math.round(v)) : ''; A.save(); drawCoverage(); };
    $('afH2Get').onclick = async function () {
      var b = this; b.disabled = true; $('afH2Msg').textContent = 'Fetching…'; $('afH2Msg').classList.remove('err');
      try {
        var res = await hydrogenAll(true); h2List = res.list; h2T = res.t;
        A.setMode('h2');
        $('afH2Msg').textContent = h2List.length + ' open public stations · just now';
        showH2(); A.rebuild();
        if (h2List.length) { close(); map.fitBounds(L.latLngBounds(h2List.map(function (s) { return [s.lat, s.lng]; })).pad(0.1)); }
      } catch (e) { $('afH2Msg').textContent = e.message; $('afH2Msg').classList.add('err'); }
      b.disabled = false; b.textContent = 'Fetch all hydrogen stations again';
    };
    $('afEvGet').onclick = async function () {
      var b = this, c = map.getCenter(), bd = map.getBounds(), rad = Math.max(10, Math.min(150, P.haversineMi(c.lat, c.lng, bd.getNorth(), bd.getEast())));
      b.disabled = true; $('afEvMsg').textContent = 'Finding…'; $('afEvMsg').classList.remove('err');
      try {
        evList = await evNear(c.lat, c.lng, rad, carPlugs(), S.alt.evSpeed); evArea = { lat: c.lat, lng: c.lng };
        A.setMode('ev');
        $('afEvMsg').textContent = evList.length + ' fast charger' + (evList.length === 1 ? '' : 's') + ' within ' + Math.round(rad) + ' mi';
        showEv(); A.rebuild(); if (evList.length) close();
      } catch (e) { $('afEvMsg').textContent = e.message; $('afEvMsg').classList.add('err'); }
      b.disabled = false;
    };
  }
  function swHtml(id, on) { return '<label class="switch"><input type="checkbox" data-af="' + id + '"' + (on ? ' checked' : '') + '><span></span></label>'; }

  // ---------- the fuel mode's part of the main screen: the top bar's selector, the list, refresh ----------
  var evArea = null, busy = false;
  function h2Shown() { return S.alt.h2Press === 'all' ? h2List : h2List.filter(function (s) { return (s.hyPress || []).join(' ').indexOf(S.alt.h2Press) >= 0; }); }
  /** The top bar's selector in ⚡ / H₂ mode: charger speed, or hydrogen pressure. */
  function seg(el) {
    var ev = evOn(), opts = ev ? [['dc', 'Fast'], ['l2', 'Level 2'], ['all', 'All']] : [['all', 'All'], ['H70', 'H70'], ['H35', 'H35']], cur = ev ? S.alt.evSpeed : S.alt.h2Press;
    el.innerHTML = '';
    opts.forEach(function (o) {
      var b = document.createElement('button'); b.textContent = o[1]; b.className = cur === o[0] ? 'on' : '';
      b.setAttribute('aria-label', ev ? (o[0] === 'dc' ? 'DC fast chargers' : o[0] === 'l2' ? 'Level 2 chargers' : 'All chargers') : (o[0] === 'all' ? 'All hydrogen stations' : o[1] + ' (' + (o[0] === 'H70' ? '700' : '350') + ' bar)'));
      b.onclick = function () {
        if (ev) { if (S.alt.evSpeed === o[0]) return; S.alt.evSpeed = o[0]; A.save(); A.rebuild(); refresh(false); }
        else { S.alt.h2Press = o[0]; A.save(); showH2(); A.rebuild(); }
      };
      el.appendChild(b);
    });
  }
  function here() { var me = A.me && A.me(); return me ? { lat: me.lat, lng: me.lng } : map.getCenter(); }
  /** Refresh: chargers around you (area: around the middle of the map, as far as it shows, 10–150 mi), or every hydrogen station again. */
  async function refresh(area) {
    if (busy) return; busy = true;
    var rb = $('btnRefresh'); if (rb) rb.classList.add('spin');
    try {
      if (evOn()) {
        var c = area ? map.getCenter() : here(), bd = map.getBounds();
        var rad = area ? Math.max(10, Math.min(150, P.haversineMi(c.lat, c.lng, bd.getNorth(), bd.getEast()))) : 25;
        A.status && A.status('Finding chargers…');
        evList = await evNear(c.lat, c.lng, rad, carPlugs(), S.alt.evSpeed); evArea = { lat: c.lat, lng: c.lng };
        LG.info('altfuel', 'Chargers: ' + evList.length + ' (' + S.alt.evSpeed + ')');
        showEv();
      } else if (h2On()) {
        A.status && A.status('Fetching hydrogen stations…');
        var res = await hydrogenAll(h2List.length > 0);   // a week's list is used first; ↻ with stations shown fetches again
        h2List = res.list; h2T = res.t;
        showH2();
      }
    } catch (e) { A.status && A.status(e.message); LG.warn('altfuel', 'Station finder', e.message); }
    busy = false; if (rb) rb.classList.remove('spin');
    A.rebuild();
  }
  /** The bottom line and list in ⚡ / H₂ mode: nearest first. */
  function renderList(best, rows) {
    var ev = evOn(), list = ev ? evList : h2Shown(), c = here();
    var withD = list.map(function (s) { return { s: s, d: P.haversineMi(c.lat, c.lng, s.lat, s.lng) }; }).sort(function (a, b) { return a.d - b.d; });
    var what = ev ? (S.alt.evSpeed === 'dc' ? 'fast charger' : S.alt.evSpeed === 'l2' ? 'Level 2 charger' : 'charger') : 'hydrogen station';
    if (withD.length) best.innerHTML = 'Nearest ' + what + ' <span class="big">' + withD[0].d.toFixed(1) + ' mi</span><br><b>' + esc(withD[0].s.name) + '</b> · ' + withD.length + ' ' + (ev ? 'here' : 'open');
    else best.innerHTML = busy ? 'Finding ' + what + 's…' : ev ? 'No ' + what + 's here yet. Tap ↻ to look around you' : 'Tap ↻ to fetch every hydrogen station';
    rows.innerHTML = withD.length ? withD.slice(0, 120).map(function (x) {
      var s = x.s, sub = ev ? [s.network, s.dc ? s.dc + ' fast · ' + (s.kwEst ? '~' : '') + s.kw + ' kW' : s.l2 ? s.l2 + ' Level 2' : ''].filter(Boolean).join(' · ') : ((s.hyPress || []).join(' · ') || 'hydrogen');
      return '<button class="row" data-af="' + esc(s.id) + '"><span class="af-ic ' + (ev ? 'ev' : 'h2') + '">' + (ev ? '⚡' : 'H₂') + '</span>' +
        '<span class="mid"><div class="nm">' + esc(s.name) + '</div><div class="sub">' + x.d.toFixed(1) + ' mi · ' + esc(sub) + '</div></span>' +
        '<span class="pr"><div class="o" style="text-decoration:none">' + esc(ev && s.pricing ? (s.pricing.length > 18 ? s.pricing.slice(0, 17) + '…' : s.pricing) : '') + '</div></span></button>';
    }).join('') + '<div class="af-src">Stations: U.S. Department of Energy (AFDC)</div>' : '<div class="empty">' + (ev ? 'Chargers' : 'Hydrogen stations') + ' will appear here.</div>';
  }
  function focus(id) {
    var m = marks[id]; if (!m) return;
    map.setView(m.getLatLng(), Math.max(map.getZoom(), 13)); setTimeout(function () { m.openPopup(); }, 250);
  }
  /** The mode changed (the pill): show its stations, fetching once if there are none yet (a free lookup). */
  function modeChanged() {
    showEv(); showH2();
    if (evOn() && !evList.length) refresh(false);
    else if (h2On() && !h2List.length) refresh(false);
  }
  // a car of another kind picked in the Garage: the mode follows it (⚡ for an EV, H₂ for a fuel cell, ⛽ otherwise)
  var lastKind = null;
  window.addEventListener('garagechange', function () {
    var G = window.Garage, c = G && G.car(); if (!c) return;
    var k = G.kind(c), m = k === 'ev' ? 'ev' : k === 'h2' ? 'h2' : 'gas';
    if (lastKind !== null && lastKind !== m) A.setMode(m);
    lastKind = m;
  });

  // stations already fetched come back on the map at start (no lookup)
  try {
    var o = KV.get('afdc', 'hy-all');
    if (o && o.v) { h2List = normalizedRows(o.v); h2T = o.t; }
  } catch (e) { }
  window.addEventListener('garagechange', function () { if (h2On()) drawCoverage(); });
  // at start: the mode the app was left in (its stations, the selector)
  setTimeout(function () { var G = window.Garage, c = G && G.car(); if (c) { var k = G.kind(c); lastKind = k === 'ev' ? 'ev' : k === 'h2' ? 'h2' : 'gas'; } if (A.altMode()) { showEv(); showH2(); A.rebuild(); } }, 0);

  // ---------- charging networks you can choose in Parameters (S.trip.evNetworksOff = {key: true} for unticked ones) ----------
  // Networks whose own published prices Gasket reads come first, then the rest (dimmed, still choosable); each A–Z.
  var NET_PRICED = [['electricera', 'Electric Era'], ['ionna', 'IONNA']];
  var NET_REVIEW = [['blink', 'Blink'], ['bp', 'bp pulse'], ['chargepoint', 'ChargePoint'], ['ea', 'Electrify America'], ['evgo', 'EVgo'], ['flo', 'FLO'], ['francis', 'Francis Energy'], ['mercedes', 'Mercedes-Benz HPC'], ['tesla', 'Tesla Supercharger'], ['walmart', 'Walmart EV']];
  var NET_OTHER = [['evconnect', 'EV Connect'], ['nonnet', 'Non-networked (no app)'], ['other', 'Other networks'], ['rivian', 'Rivian Adventure'], ['shell', 'Shell Recharge']];
  var NET_HOSTED = [['dealer', 'Car dealerships'], ['hotel', 'Hotels / lodging'], ['teslaDest', 'Tesla Destination (hotels)']];
  // a dealership's chargers (usually customers only, often listed as free): by the site's name
  var DEALER = /\b(?:nissan|chevrolet|chevy|ford|lincoln|toyota|honda|hyundai|kia|bmw|audi|volkswagen|vw|subaru|mazda|buick|gmc|cadillac|jeep|dodge|chrysler|mitsubishi|volvo|porsche|mercedes(?:-benz)?|lexus|acura|infiniti|genesis|jaguar|land rover|polestar)\b|\bmotor (?:company|co\.?)\b|\bmotors\b|\bauto (?:mall|group|plaza)\b|\bdealership\b/i;
  function netGroup(st) {
    var n = String(st && st.network || '').trim(), name = String(st && st.name || '');
    if (/^tesla(?: supercharger)?$/i.test(n)) return 'tesla';
    if (/^tesla destination/i.test(n)) return 'teslaDest';
    if (/ionna/i.test(n)) return 'ionna';
    if (/^electrify america/i.test(n)) return 'ea';
    if (/^evgo/i.test(n)) return 'evgo';
    // before the dealership test: Francis Energy hosts public fast chargers at dealerships
    if (/^electric[_ ]?era$/i.test(n)) return 'electricera';
    if (/^fcn$|francis/i.test(n)) return 'francis';
    if (/mercedes.*(?:hpc|charging)|mercedes.benz/i.test(n)) return 'mercedes';
    if (/^bp[ _-]?pulse/i.test(n)) return 'bp';
    if (/walmart/i.test(n)) return 'walmart';
    if (DEALER.test(name)) return 'dealer';
    if (!st.dc && /\b(?:hotel|motel|resort|inn|suites|marriott|hilton|hyatt)\b/i.test(name)) return 'hotel';
    if (/^chargepoint/i.test(n)) return 'chargepoint';
    if (/^blink/i.test(n)) return 'blink';
    if (/^ev ?connect/i.test(n)) return 'evconnect';
    if (/^flo$/i.test(n)) return 'flo';
    if (/rivian/i.test(n)) return 'rivian';
    if (/shell/i.test(n)) return 'shell';
    if (/walmart/i.test(n)) return 'walmart';
    if (!n || /^non-?networked$/i.test(n)) return 'nonnet';
    return 'other';
  }
  function netEnabled(key, off) { if(NET_OTHER.some(function(x){return x[0]===key;}))return false;off = off || (S.trip && S.trip.evNetworksOff) || {}; return Object.prototype.hasOwnProperty.call(off,key) ? !off[key] : NET_PRICED.some(function(x){return x[0]===key;}); }
  function netAllowed(st, off) { return netEnabled(netGroup(st),off); }

  window.AltFuel = { netGroup: netGroup, netAllowed: netAllowed, netEnabled:netEnabled, NET_PRICED: NET_PRICED, NET_REVIEW:NET_REVIEW, NET_OTHER: NET_OTHER, NET_HOSTED:NET_HOSTED, hydrogenAll: hydrogenAll, evNear: evNear, alongRoute: alongRoute, norm: norm, avgKw: avgKw, plugName: plugName, unitOf: unitOf,
    open: openPanel, seg: seg, renderList: renderList, refresh: refresh, focus: focus, modeChanged: modeChanged, h2Range: h2Range, coverage: function () { return cov; }, h2: function () { return h2List; }, stationHtml: stationHtml, ROAD: ROAD,tripTypes:tripTypes,compatiblePlugs:compatiblePlugs,charging:charging,routePoints:routePoints };
})();
