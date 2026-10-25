/* Gasket — car pictures (Garage). Photo mode (the default): NHTSA's photo of the model (the one nhtsa.gov's vehicle pages
 * show), else the best-matching photo on Wikimedia Commons (credited: who took it, its license), else a doodle. With the
 * owner's Fuel API key, picking one of the trim's factory colors shows Fuel API's picture in it (EVOX's colorized set:
 * angles 001 / 014 / 032 only; NHTSA's is EVOX still shot 046, which has no color versions, so 032, the front three-quarter,
 * is the closest; demo keys' watermark is kept as is). Doodle mode: the app's own drawing of the body style, in the color
 * you pick. Photos are kept (KV 'carpics', app storage, included in full backups) so each is
 * downloaded once. CarPicMath is pure and runs in Node for the tests. */
(function (root) {
  'use strict';
  var DRIVE = /\s+(2WD|4WD|AWD|FWD|RWD|4x4)$/i;
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  /** "Venza AWD" -> "Venza" (the EPA adds the drive to some model names). */
  function baseModel(m) { return String(m || '').replace(/\s*\([^)]*\bmodes?\b[^)]*\)/gi, '').replace(DRIVE, '').trim(); }
  function driveOf(m) { var x = DRIVE.exec(String(m || '')); return x ? x[1].toUpperCase().replace('4X4', '4WD') : ''; }
  // EPA names can contain a trim/range description that is absent from photo captions.
  // Keep the actual identity unchanged; normalize only the model-photo search.
  function photoModel(c) {
    var m = baseModel(c.vpicModel || c.model);
    if (c.trim && norm(m).endsWith(' ' + norm(c.trim))) m = m.slice(0, m.length - String(c.trim).length).trim();
    return m.replace(/\s+(?:long range|standard range(?: plus)?|performance|XLE|XSE|LE|SE|Limited)$/i, '').trim();
  }
  function closestModel(models,c) {
    var want=norm(photoModel(c)), best='', score=-1;
    (models||[]).forEach(function(v){var name=v.model||v.Model_Name||'',n=norm(name),s=n===want?100:n===want.replace(/\bhybrid\b/g,'').replace(/\s+/g,' ').trim()?70:-1;
      if(s>score){score=s;best=name;}});
    return best||photoModel(c);
  }
  function usable(p) { return p && p.url && (!p.imageFail || Date.now() - p.imageFail > 24 * 3600e3); }
  /** The Fuel API vehicle for a car: its trim word for word, else one containing it (or contained), the drive breaking ties; else the first. */
  function matchTrim(list, trim, drive) {
    if (!list || !list.length) return null;
    var t = norm(trim), d = String(drive || '').toUpperCase();
    var byDrive = function (a) { if (!d) return a; var f = a.filter(function (v) { return String(v.drivetrain || '').toUpperCase() === d; }); return f.length ? f : a; };
    if (t) {
      var ex = byDrive(list.filter(function (v) { return norm(v.trim) === t; })); if (ex.length) return { v: ex[0], exact: true };
      var part = byDrive(list.filter(function (v) { var n = norm(v.trim); return n && (n.indexOf(t) >= 0 || t.indexOf(n) >= 0); })); if (part.length) return { v: part[0], exact: false };
    }
    return { v: byDrive(list)[0], exact: false };
  }
  /** Fuel API's color assets in one format -> [{ code, name, simple, rgb, url }], one per paint. */
  function colorsOf(vehicle, formatCode) {
    var out = [], seen = {};
    ((vehicle && vehicle.products) || []).forEach(function (p) { (p.productFormats || []).forEach(function (f) {
      if (formatCode && f.code !== formatCode) return;
      (f.assets || []).forEach(function (a) { var c = a.shotCode && a.shotCode.color; if (!c || seen[c.code]) return; seen[c.code] = 1;
        out.push({ code: c.code, name: c.oem_name || c.simple_name || c.code, simple: c.simple_name || '', rgb: c.rgb1 ? '#' + c.rgb1 : '', url: a.url }); });
    }); });
    return out;
  }
  /** The paint pictures to use: the front three-quarter (032), else the side view (001), which is all older cars have. */
  function bestColors(v) { var a = colorsOf(v, 'color_0640_032_png'); return a.length ? a : colorsOf(v, 'color_0640_001_png'); }
  function fuelViews(v){var out=[];['032','001','014'].forEach(function(angle){colorsOf(v,'color_0640_'+angle+'_png').forEach(function(c){out.push(Object.assign({angle:angle},c));});});return out;}
  function selectedView(c){var f=c&&c.pic&&c.pic.fuel,col=f&&(pickColor(f.colors,c.paint)||f.colors[0]),views=f&&f.views&&f.views.filter(function(v){return col&&v.code===col.code;})||[];return views.find(function(v){return v.angle===c.picAngle;})||views.find(function(v){return v.angle==='032';})||views[0]||{angle:'032',code:col&&col.code};}
  function pickColor(colors, paint) {
    if (!colors || !colors.length || !paint) return null;
    return colors.filter(function (c) { return paint.code && c.code === paint.code; })[0] || null;
  }
  /** NHTSA's vehicles for a year / make / model -> { url, body } of the first with a picture, or null. */
  function nhtsaPic(res,car) {
    var trim=norm(car&&car.trim),dual=car&&((car.info||{}).drw==='yes'||car.tires&&car.tires.corners&&car.tires.corners.dually),best=null;
    ((res&&res.results)||[]).forEach(function(v){if(!v.vehiclePicture)return;var text=norm([v.trim,v.vehicleModel].join(' '));if(dual&&!/\bdrw\b|dually|dual rear/.test(text))return;var score=trim&&(' '+text+' ').includes(' '+trim+' ')?5:0;if(!best||score>best.score)best={score:score,v:v};});
    return best?{url:best.v.vehiclePicture,body:[best.v.trim,best.v.vehicleModel].filter(Boolean).join(' ')}:null;
  }
  var SKIP = /\b(interior|inside|dash(board)?|cockpit|engine|rear|back|tail(gate|lights?)?|badge|emblem|logo|wheels?|rims?|seats?|trunk|boot|steering|gauges?|instruments?|keys?|drawing|diagram|blueprint|toy|toys|scale|lego|crash|wreck|wrecked|damaged|burnt|burned|police|taxi|ambulance|race|racing|rally|modified|tuned|lifted|concept|prototype|museum|interieur|innenraum|heck)\b|\.svg$/i;
  /**
   * The Commons photo for a car: the file name has to name the make and every word of the model; the year (or one close
   * to it) and "front" count in its favor; interiors, rear views, parts, toys, wrecks and the like are skipped, and so
   * are photos labeled with another era. -> { title, url, page, artist, license } or null.
   */
  function wikiRank(pages, car, allowUncertain) {
    var make = norm(car.make), words = norm(photoModel(car)).split(' ').filter(Boolean), y = +car.year, ranked=[],dual=(car.info||{}).drw==='yes'||car.tires&&car.tires.corners&&car.tires.corners.dually;
    (pages || []).forEach(function (p) {
      var ii = p.imageinfo && p.imageinfo[0]; if (!ii) return;
      var t = norm(String(p.title || '').replace(/^File:/i, '').replace(/\.(jpe?g|png|webp|tiff?)$/i, ''));
      var md=ii.extmetadata||{},caption=norm(t+' '+String(md.ImageDescription&&md.ImageDescription.value||'').replace(/<[^>]+>/g,' ')+' '+String(md.Categories&&md.Categories.value||''));
      var viewTitle=String(p.title||'').replace(/dual rear wheels?/ig,'dually').replace(/single rear wheels?/ig,'srw');
      if (!/\.(jpe?g|png|webp)$/i.test(p.title || '') || SKIP.test(viewTitle)) return;
      if (dual && /\bsrw\b|single rear wheel/.test(caption)) return;
      if (dual && !allowUncertain && !/\bdrw\b|dually|dual rear/.test(caption)) return;
      if (t.indexOf(make) < 0 || words.some(function (w) { return (' ' + t + ' ').indexOf(' ' + w + ' ') < 0; })) return;
      var model=norm(photoModel(car));
      // These are separate models, not trim words. A Prius c or Corolla Cross must not stand in for its namesake.
      if(model==='prius'&&/\bprius (?:c|v|plus|prime|phv|plug in)\b/.test(t))return;
      if(model==='corolla'&&/\bcorolla cross\b/.test(t))return;
      if(model==='mustang'&&/\bmustang mach e\b/.test(t))return;
      var years = (t.match(/\b(19[5-9]\d|20[0-4]\d)\b/g) || []).map(Number), score = 0,range=String(p.title||'').match(/\b((?:19|20)\d{2})\s*[–—-]\s*((?:19|20)\d{2})\b/),inRange=range&&y>=+range[1]&&y<=+range[2];
      if (years.length) {
        // A later date in a caption is the photo date, not a newer model year.
        var near = Math.abs(years[0] - y);
        if (!inRange && near > (allowUncertain?3:1)) return;
        score += inRange?6:near === 0 ? 8 : 4 - near;
      } else if(!allowUncertain)return;
      if(p.curated)score+=3;
      var trim=norm(car.trim);if(trim&&(' '+t+' ').includes(' '+trim+' '))score+=3;
      if(/crew cab/.test(norm(car.info&&car.info.body))&&/regular cab|single cab/.test(t))return;
      if (/front|3 4|three quarter|exterior/.test(t)) score += 2;
      if (ii.width && ii.height && ii.width > ii.height) score += 1;
      score -= (p.index || 0) * 0.1;                            // the search's own order breaks ties
      if(ii.width&&ii.width<640)return;
      ranked.push({score:score,p:p,ii:ii});
    });
    return ranked.sort(function(a,b){return b.score-a.score;}).map(function(best){var m=best.ii.extmetadata||{},txt=function(k){return String(m[k]&&m[k].value||'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();};return {title:String(best.p.title).replace(/^File:/i,''),url:best.ii.thumburl||best.ii.url,page:best.ii.descriptionurl||'',artist:txt('Artist').slice(0,60)||'unknown',license:txt('LicenseShortName')||'see the file page'};});
  }
  function wikiPick(pages,car){return wikiRank(pages,car,false)[0]||null;}
  /** What a lookup depends on: one photo per model (year / make / model). */
  function sig(c, fuel) { return (fuel ? ['f2'] : []).concat([c.year, norm(c.make), norm(baseModel(c.model))]).concat(fuel ? [norm(c.trim)] : []).join('|'); }   // f2: 0.0.93 also takes side views, so older failures are asked again
  function photoConfig(c){return [norm(c.trim),norm(c.info&&c.info.body),((c.info||{}).drw==='yes'||c.tires&&c.tires.corners&&c.tires.corners.dually)?'drw':''].join('|');}
  function nhtsaSig(c) { return 'n5|'+sig(c)+'|'+norm(c.vpicModel)+'|'+photoConfig(c); }
  function wikiSig(c){return 'w4|'+sig(c)+'|'+photoConfig(c);}
  /**
   * Which picture to show: 'fuel' when you've picked one of the trim's factory colors (and there's a key), else 'nhtsa',
   * else 'wiki', else 'fuel' in its first color (a key, no other photo), else null (the doodle). Doodle mode always draws.
   */
  function which(c, hasKey) {
    if (!c || c.picMode === 'doodle') return null;
    var p = c.pic || {}, f = hasKey && p.fuel && !p.fuel.fail && p.fuel.colors && p.fuel.colors.length ? p.fuel : null;
    if(usable(p.chosen)&&p.chosen.sig===sig(c))return 'chosen';
    if (f && pickColor(f.colors, c.paint)) return 'fuel';
    return usable(p.nhtsa) ? 'nhtsa' : usable(p.wiki) ? 'wiki' : f && p.nhtsa && (p.nhtsa.fail || p.nhtsa.imageFail) && p.wiki && (p.wiki.fail || p.wiki.imageFail) ? 'fuel' : null;
  }
  /** The body to draw: from the VIN's body class, the EPA's size class, NHTSA's listing, then the Garage's type. */
  function bodyOf(c) {
    var s = [c && c.info && c.info.body, c && c.epa && c.epa.vclass, c && c.pic && c.pic.nhtsa && c.pic.nhtsa.body].filter(Boolean).join(' ').toLowerCase();
    if (/pickup|truck/.test(s)) return 'pickup';
    if (/minivan|mini van/.test(s)) return 'minivan';
    if (/\bvan\b|cargo|passenger type/.test(s)) return 'van';
    if (/sport utility|suv|\bmpv\b|crossover/.test(s)) return 'suv';
    if (/wagon/.test(s)) return 'wagon';
    if (/hatch|liftback|\bhb\b/.test(s)) return 'hatch';
    if (/coupe|two seater|convertible|cabriolet|roadster|\b2 dr\b/.test(s)) return 'coupe';
    if (/sedan|saloon|cars\b|\b4 dr\b/.test(s)) return 'sedan';
    var t = c && c.type; return t === 'truck' ? 'pickup' : t === 'suv' ? 'suv' : 'sedan';
  }
  var CarPicMath = { fuelViews:fuelViews,selectedView:selectedView,closestModel:closestModel, bestColors: bestColors, driveOf: driveOf, matchTrim: matchTrim, colorsOf: colorsOf, pickColor: pickColor, baseModel: baseModel, photoModel: photoModel, nhtsaPic: nhtsaPic, wikiPick: wikiPick, wikiRank:wikiRank, sig: sig, which: which, bodyOf: bodyOf };
  root.CarPicMath = CarPicMath;
  if (typeof module !== 'undefined' && module.exports) module.exports = CarPicMath;
  if (!root.document) return;

  var A = root.__app, S = A.S, FORMAT_ID = '12,8,6', LG = root.FLog || { info: function () {}, warn: function () {} };
  var RETRY_H = 24, busy = {}, mem = {};
  function call(name) { var args = [].slice.call(arguments, 1); return root.__trip ? root.__trip.call.apply(null, [name].concat(args)) : Promise.reject(new Error('no bridge')); }
  function stored(k) { if (mem[k]) return mem[k]; try { var o = A.KV.get('carpics', k); if (o && o.v) return (mem[k] = o.v); } catch (e) { } return null; }
  function keep(k, v) { mem[k] = v; try { A.KV.put('carpics', k, v); } catch (e) { } }
  function told(c) { try { root.dispatchEvent(new CustomEvent('carpic', { detail: c.id })); } catch (e) { } }
  function P(c) { if (!c.pic || c.pic.src) c.pic = {}; return c.pic; }   // (0.0.83 kept a single source: looked up again)
  function hasKey() { return !!S.fuelKey; }
  function fuel(path) {
    return call('fetchFuel', path, S.fuelKey).then(function (r) {
      if (r.error) throw new Error(r.error);
      var b = JSON.parse(r.body || 'null'); if (r.status) throw new Error((b && b.message) || 'HTTP ' + r.status);
      return b;
    });
  }
  /** Fuel API: the trim and its factory colors (needs the key; asked when you open Edit, or when there's no other photo). */
  function lookFuel(c) {
    var sg = sig(c, true), b = 'f|' + c.id;
    if (!hasKey() || (!due(P(c).fuel, sg)&&(P(c).fuel.views||P(c).fuel.fail)) || busy[b]) return Promise.resolve();
    busy[b] = 1;
    return fuel('vehicles?year=' + encodeURIComponent(c.year) + '&make=' + encodeURIComponent(c.make) + '&model=' + encodeURIComponent(baseModel(c.model))).then(function (list) {
      var m = matchTrim(list, c.trim, driveOf(c.model)); if (!m) throw new Error('not listed');
      return fuel('vehicle/' + encodeURIComponent(m.v.id) + '?productID=2&productFormatIDs=' + FORMAT_ID).then(function (v) {
        var cols = bestColors(v); if (!cols.length) throw new Error('no pictures');
        var views=fuelViews(v);mem['urls|' + m.v.id] = views;
        P(c).fuel = { sig: sg, vid: String(m.v.id), trim: m.v.trim || '', exact: m.exact, colors: cols.map(function (x) { return { code: x.code, name: x.name, simple: x.simple, rgb: x.rgb }; }),views:views.map(function(x){return {code:x.code,angle:x.angle};}), t: Date.now() };
        LG.info('car', 'Fuel API: ' + cols.length + ' colors' + (m.exact ? '' : ' (closest trim: ' + (m.v.trim || 'base') + ')'));
      });
    }).catch(function (e) { P(c).fuel = { sig: sg, fail: Date.now(), err: String(e && e.message || e) }; LG.warn('car', 'No Fuel API pictures', P(c).fuel.err); })
      .then(function () { delete busy[b]; A.save(); told(c); });
  }
  function due(x, sg) { return !x || x.sig !== sg || (x.fail && Date.now() - x.fail > RETRY_H * 3600e3); }
  function json(url) { return call('fetchJson', url).then(function (r) { if (r.error) throw new Error(r.error); return JSON.parse(r.body); }); }
  function nhtsaPhoto(c) {
    var key='nmodels|'+c.year+'|'+norm(c.make);
    if(!mem[key])mem[key]=json('https://api.nhtsa.gov/products/vehicle/models?modelYear='+encodeURIComponent(c.year)+'&make='+encodeURIComponent(c.make)+'&issueType=r').then(function(r){return r.results||[];}).catch(function(){delete mem[key];return [];});
    return mem[key].then(function(models){var model=closestModel(models,c);return json('https://api.nhtsa.gov/vehicles/byYmmt?modelYear='+encodeURIComponent(c.year)+'&make='+encodeURIComponent(c.make)+'&model='+encodeURIComponent(model)+'&data=none&productDetail=all').then(function(r){var x=nhtsaPic(r,c);if(x)x.model=model;return x;});});
  }
  function lookNhtsa(c) {
    var sg = nhtsaSig(c), b = 'n|' + c.id;
    if (!due(P(c).nhtsa, sg) || busy[b]) return Promise.resolve();
    busy[b] = 1;
    return nhtsaPhoto(c)
      .then(function (x) { if (!x) throw new Error('no photo'); P(c).nhtsa = { sig: sg, url: x.url, body: x.body, model:x.model, t: Date.now() }; LG.info('car', 'Picture from NHTSA', {model:x.model}); })
      .catch(function (e) { P(c).nhtsa = { sig: sg, fail: Date.now(), err: String(e && e.message || e) }; LG.info('car', 'No NHTSA photo', P(c).nhtsa.err); })
      .then(function () { delete busy[b]; A.save(); told(c); });
  }
  function photoPages(c) {
    var sg=wikiSig(c);if(mem['photos|'+sg])return Promise.resolve(mem['photos|'+sg]);
    var q=[c.year,c.make,photoModel(c)].join(' ');if(photoConfig(c).endsWith('drw'))q+=' dually';
    var base='https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|extmetadata&iiextmetadatafilter=Artist|LicenseShortName|ImageDescription|Categories&iiurlwidth=960';
    var pages=function(res){return Object.keys(res.query&&res.query.pages||{}).map(function(k){return res.query.pages[k];});};
    return Promise.all([
      json(base+'&generator=search&gsrnamespace=6&gsrlimit=30&gsrsearch='+encodeURIComponent(q)).then(pages).catch(function(){return [];}),
      // Article lead pictures are selected by editors to represent the model. They still pass our year/configuration checks.
      json('https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=0&gsrlimit=5&gsrsearch='+encodeURIComponent(q)+'&prop=pageimages&piprop=name&pilicense=free').then(function(res){
        var names=pages(res).filter(function(p){var title=norm(String(p.title||'').replace(/\s*\([^)]*\)/g,''));return title===norm(c.make+' '+photoModel(c))&&p.pageimage;}).map(function(p){return 'File:'+p.pageimage;});
        if(!names.length)return [];
        return json(base+'&titles='+encodeURIComponent(names.join('|'))).then(function(res){return pages(res).map(function(p){p.curated=true;return p;});});
      }).catch(function(){return [];})
    ]).then(function(groups){var seen={},out=[];groups[1].concat(groups[0]).forEach(function(p){if(seen[p.title])return;seen[p.title]=1;out.push(p);});if(out.length)mem['photos|'+sg]=out;return out;});
  }
  function lookWiki(c) {
    var sg=wikiSig(c),b='w|'+c.id;
    if(!due(P(c).wiki,sg)||busy[b])return Promise.resolve();
    busy[b]=1;
    return photoPages(c).then(function(pages){
      var x=wikiPick(pages,c);if(!x)throw new Error('no sufficiently close year/configuration match');
      P(c).wiki=Object.assign({sig:sg,t:Date.now()},x);LG.info('car','Picture from Wikimedia Commons: '+x.title);
    }).catch(function(e){P(c).wiki={sig:sg,fail:Date.now(),err:String(e&&e.message||e)};LG.info('car','No matching Commons photo',P(c).wiki.err);})
      .then(function(){delete busy[b];A.save();told(c);});
  }
  function imgKey(c) {
    var w = which(c, hasKey()); if (!w) return null;
    if (w === 'fuel') { var col = pickColor(c.pic.fuel.colors, c.paint) || c.pic.fuel.colors[0]; return 'fuel|' + c.pic.fuel.vid + '|' + col.code+(c.pic.fuel.views?'|'+selectedView(c).angle:''); }
    return w + '|' + c.pic[w].url;
  }
  /** Makes sure the car's photo is looked up and kept: NHTSA's, else Commons'. Doodle mode needs nothing. */
  function ensure(c) {
    if (!c || !c.year || !c.make || !c.model || c.picMode === 'doodle') return;
    var b = 'ensure|' + c.id; if (busy[b]) return busy[b];
    var before = JSON.stringify(c.pic || {}) + (src(c) || '');
    busy[b] = lookNhtsa(c).then(function () { return fetchPic(c); })
      .then(function () { var p = c.pic || {}; return !usable(p.nhtsa) ? lookWiki(c) : null; })
      .then(function () { return fetchPic(c); })
      .then(function () { var p = c.pic || {}; return hasKey() && ((c.paint && c.paint.code) || (!usable(p.nhtsa) && !usable(p.wiki))) ? lookFuel(c) : null; })
      .then(function () { return fetchPic(c); })
      .finally(function () { delete busy[b]; if(before !== JSON.stringify(c.pic || {}) + (src(c) || '')) told(c); });
    return busy[b];
  }
  /** The trim's factory colors for the color picker (asks Fuel API once; needs the key). */
  function loadColors(c) { if (c && c.year && c.make && c.model && hasKey() && c.picMode !== 'doodle') lookFuel(c); }
  function fetchPic(c) {
    var k = imgKey(c); if (!k || stored(k) || busy['img|' + k]) return;
    if (mem['imageFail|' + k] && Date.now() - mem['imageFail|' + k] < RETRY_H * 3600e3) return;
    busy['img|' + k] = 1;
    var w = which(c, hasKey()), urlP;
    if (w !== 'fuel') urlP = Promise.resolve(c.pic[w].url);
    else {
      var f = c.pic.fuel, want = pickColor(f.colors, c.paint) || f.colors[0], cached = mem['urls|' + f.vid];
      var view=selectedView(c);
      urlP = (cached ? Promise.resolve(cached) : fuel('vehicle/' + encodeURIComponent(f.vid) + '?productID=2&productFormatIDs=' + FORMAT_ID).then(function (v) { return (mem['urls|' + f.vid] = fuelViews(v)); }))
        .then(function (cols) { var m = cols.filter(function (x) { return x.code === want.code&&x.angle===view.angle; })[0]; if (!m) throw new Error('no picture in that color and angle'); return m.url; });   // Fuel API's links expire: fresh ones each time
    }
    return urlP.then(function (u) { return call('fetchImage', u); }).then(function (r) { if (r.error || !r.body) throw new Error(r.error || 'no image'); keep(k, r.body); if(c.pic && c.pic[w]) delete c.pic[w].imageFail; })
      .catch(function (e) { mem['imageFail|' + k] = Date.now(); if(c.pic && c.pic[w]) { c.pic[w].imageFail=Date.now(); A.save(); } LG.warn('car', 'Couldn\'t download the car\'s picture', String(e && e.message || e)); })
      .then(function () { delete busy['img|' + k]; told(c); });
  }
  /** The kept photo to show (a data URL), or null (still coming, none, or doodle mode). */
  function generatedKey(c) { return c && c.id ? 'generated|' + c.id : null; }
  function hasGenerated(c) { return !!(c && stored(generatedKey(c))); }
  function imageDialog(text,ask){return root.__app.confirmDel({always:true,title:'Vehicle image',body:root.__app.esc(text),action:ask?'Continue':'OK',no:ask?'Cancel':'Close',goClass:'primary'});}
  function src(c) { var g = c && stored(generatedKey(c)); if (g) return g; var k = c && imgKey(c); return k ? stored(k) : null; }
  function angles(c){if(!c||!hasKey()||c.picMode==='doodle'||hasOverride(c))return [];var f=c.pic&&c.pic.fuel,view=selectedView(c);return (f&&f.views||[]).filter(function(v){return v.code===view.code;}).map(function(v){return v.angle;});}
  async function rotate(c,d){var list=angles(c);if(list.length<2)return false;var old=c.picAngle,oldPaint=c.paint&&Object.assign({},c.paint),f=c.pic.fuel,at=list.indexOf(selectedView(c).angle);if(!pickColor(f.colors,c.paint))c.paint=Object.assign({},f.colors[0]);c.picAngle=list[(at+(d<0?-1:1)+list.length)%list.length];A.save();var work=fetchPic(c);told(c);await work;if(!stored(imgKey(c))){c.picAngle=old;c.paint=oldPaint;delete c.pic.fuel.imageFail;A.save();told(c);if(A.toast)A.toast('That angle could not load. Your current view was kept.');return false;}told(c);return true;}
  function importGenerated(c) {
    if (!c || !c.id) return Promise.resolve();
    return call('pickImageFile').then(function (r) {
      if (!r || r.cancelled) return;
      if (r.error) { imageDialog('Could not import image: ' + r.error); return; }
      var data = r.dataUrl || '';
      if (!/^data:image\/(webp|png|jpe?g);base64,/i.test(data)) { imageDialog('Please choose a PNG, JPEG, or WebP image.'); return; }
      keep(generatedKey(c), data);
      told(c);
      if (root.FLog) root.FLog.info('car', 'Imported a generated image for ' + (c.name || c.id));
    }).catch(function (e) { imageDialog('Could not open image picker: ' + String(e && e.message || e)); });
  }
  function clearGenerated(c) {
    if (!c) return;
    keep(generatedKey(c), '');
    if(c.pic)delete c.pic.chosen;A.save();
    told(c);
  }
  function hasOverride(c){return hasGenerated(c)||!!(c&&c.pic&&c.pic.chosen&&c.pic.chosen.sig===sig(c));}
  function choose(c){
    var close,pg,alive=true,searchId=0,selected=Object.assign({},c,{vpicModel:'',model:baseModel(c.model)});
    close=A.subPage('Choose vehicle image','<button type="button" class="btn tonal" id="cpUpload">Choose from this device…</button><p class="lead small keep" id="cpQuery">'+A.esc([c.year,c.make,photoModel(selected),c.trim].filter(Boolean).join(' '))+'</p><div id="cpResults" aria-live="polite">'+A.ldBar('Finding matching vehicle photos')+'</div>',function(b){pg=b.closest('.sub-page');b.querySelector('#cpUpload').onclick=function(){close();importGenerated(c);};return function(){alive=false;};});
    var broad=document.createElement('button');broad.type='button';broad.className='btn tonal';broad.id='cpBroader';broad.textContent='Search a less specific model';pg.querySelector('#cpResults').before(broad);
    broad.onclick=function(){var model=photoModel(c);if(norm(model)===norm(photoModel(selected)))model=baseModel(c.epaBase||model).replace(/\s+hybrid$/i,'');search(Object.assign({},c,{vpicModel:'',model:model,trim:''}));broad.disabled=true;};
    function search(query){var id=++searchId;pg.querySelector('#cpQuery').textContent=[c.year,c.make,photoModel(query),query.trim].filter(Boolean).join(' ');pg.querySelector('#cpResults').innerHTML=A.ldBar('Finding matching vehicle photos');
    Promise.all([photoPages(query),nhtsaPhoto(query).catch(function(){return null;})]).then(function(results){
      if(!alive||id!==searchId)return;var options=wikiRank(results[0],query,true).slice(0,12),n=results[1];if(usable(n))options.unshift({url:n.url,title:[c.year,c.make,n.model,n.body].filter(Boolean).join(' '),artist:'NHTSA (EVOX Images)',license:'',source:'nhtsa'});
      var out=pg.querySelector('#cpResults');out.innerHTML=options.length?'<div class="car-photo-grid">'+options.map(function(x,i){return '<button type="button" class="car-photo-option" data-photo="'+i+'"><img loading="lazy" src="'+A.esc(x.url)+'" alt="'+A.esc(x.title)+'"><span>'+A.esc(x.title)+'</span><small>'+A.esc(x.artist+(x.license?' · '+x.license:''))+'</small></button>';}).join('')+'</div><p class="lead small keep">Check the pictured body style and wheels. Similar model years can have different trim details.</p>':'<p class="lead small keep">No matching photos found. You can choose your own image above.</p>';
      out.querySelectorAll('[data-photo]').forEach(function(button){button.onclick=async function(){var x=options[+button.dataset.photo];out.querySelectorAll('button').forEach(function(b){b.disabled=true;});var note=document.createElement('p');note.className='lead small keep';note.textContent='Saving photo…';out.prepend(note);try{var r=await call('fetchImage',x.url);if(!r||r.error||!r.body)throw new Error(r&&r.error||'Could not download the photo');if(!alive)return;P(c).chosen=Object.assign({sig:sig(c),t:Date.now()},x);keep('chosen|'+x.url,r.body);keep(generatedKey(c),'');c.picMode='photo';A.save();told(c);close();}catch(e){if(!alive)return;note.textContent='Could not save this photo. Try another one or choose an image from this device.';out.querySelectorAll('button').forEach(function(b){b.disabled=false;});}};});
    }).catch(function(){if(alive&&id===searchId)pg.querySelector('#cpResults').innerHTML='<p class="lead small keep">Photo search is unavailable. You can choose an image from this device above.</p>';});}
    search(selected);
  }
  function pending(c) {
    if (!c || !c.year || !c.make || !c.model || c.picMode === 'doodle') return false;
    if(c.pic&&usable(c.pic.chosen)&&c.pic.chosen.sig===sig(c))return false;
    if (busy['n|' + c.id] || busy['w|' + c.id] || busy['f|' + c.id]) return true;
    if (busy['ensure|' + c.id]) return true;
    var p = c.pic || {}; if (!p.nhtsa || p.nhtsa.sig !== nhtsaSig(c) || (!usable(p.nhtsa) && (!p.wiki || p.wiki.sig !== wikiSig(c)))) return true;
    var k = imgKey(c); return !!(k && !stored(k) && busy['img|' + k]);
  }
  // ---------- the doodle: side views, front to the right ----------
  var BODIES = {
    sedan: { b: 'M10 70 L10 58 Q12 52 30 50 L58 47 L76 33 Q80 31 88 31 L124 31 Q132 31 138 36 L152 47 L180 51 Q190 53 190 60 L190 70 Z', w: ['M80 35 L94 35 L94 47 L64 47 Z', 'M98 35 L122 35 Q128 35 132 39 L140 47 L98 47 Z'], d: 96 },
    hatch: { b: 'M12 70 L12 52 Q13 40 30 36 L44 32 L124 31 L150 47 L180 51 Q190 53 190 60 L190 70 Z', w: ['M30 40 L46 35 L80 35 L80 47 L27 47 Z', 'M84 35 L120 35 L138 47 L84 47 Z'], d: 82 },
    wagon: { b: 'M10 70 L10 48 Q11 36 22 34 L122 32 L150 47 L182 51 Q190 53 190 60 L190 70 Z', w: ['M17 38 L52 37 L52 47 L15 47 Z', 'M56 37 L88 36 L88 47 L56 47 Z', 'M92 36 L120 36 L138 47 L92 47 Z'], d: 90 },
    coupe: { b: 'M10 70 L10 58 Q12 52 36 49 L64 46 L86 33 L120 33 Q130 34 140 40 L156 48 L182 52 Q190 54 190 62 L190 70 Z', w: ['M90 37 L118 37 Q126 37 134 42 L140 47 L74 47 Z'], d: 0 },
    suv: { b: 'M10 72 L10 44 Q11 30 22 28 L132 27 L152 42 L184 46 Q190 48 190 56 L190 72 Z', w: ['M17 32 L56 31 L56 42 L15 42 Z', 'M60 31 L96 31 L96 42 L60 42 Z', 'M100 31 L128 31 L144 42 L100 42 Z'], d: 98 },
    minivan: { b: 'M10 72 L10 40 Q11 26 24 25 L120 24 Q130 24 142 34 L166 46 L184 49 Q190 51 190 58 L190 72 Z', w: ['M17 30 L58 29 L58 42 L15 42 Z', 'M62 29 L104 28 L104 42 L62 42 Z', 'M108 28 L122 28 Q128 29 136 36 L144 42 L108 42 Z'], d: 106 },
    pickup: { b: 'M10 72 L10 50 L92 50 L94 30 Q95 27 100 27 L132 27 Q138 27 142 32 L152 46 L184 50 Q190 52 190 60 L190 72 Z', w: ['M100 31 L130 31 Q134 31 137 35 L144 46 L100 46 Z'], d: 0, bed: 'M14 50 L90 50' },
    van: { b: 'M10 74 L10 30 Q11 22 20 22 L140 22 Q148 22 152 30 L162 46 L184 50 Q190 52 190 60 L190 74 Z', w: ['M142 28 L149 30 L157 45 L142 45 Z'], d: 0 }
  };
  /** The app's own drawing of the body style, in the car's paint color (doodle mode, or when there's no photo). */
  function drawing(c, color) {
    var k = bodyOf(c), B = BODIES[k], col = color || (c.picMode === 'doodle' && c.paint && c.paint.rgb) || '#8a929c';
    var s = '<svg class="gc-draw" viewBox="0 0 200 92" role="img" aria-label="' + ({ sedan: 'Sedan', hatch: 'Hatchback', wagon: 'Wagon', coupe: 'Coupe', suv: 'SUV', minivan: 'Minivan', pickup: 'Pickup', van: 'Van' })[k] + ' doodle">' +
      '<ellipse cx="100" cy="84" rx="90" ry="4" class="gc-shadow"/><path d="' + B.b + '" fill="' + col + '" class="gc-body"/>';
    B.w.forEach(function (w) { s += '<path d="' + w + '" class="gc-glass"/>'; });
    if (B.d) s += '<path d="M' + B.d + ' 49 L' + B.d + ' 66" class="gc-line"/>';
    if (B.bed) s += '<path d="' + B.bed + '" class="gc-line"/>';
    s += '<rect x="183" y="53" width="6" height="4" rx="1.5" class="gc-head"/><rect x="10" y="52" width="4" height="6" rx="1" class="gc-taillight"/>';
    [42, 158].forEach(function (x) { s += '<circle cx="' + x + '" cy="72" r="12" class="gc-tire"/><circle cx="' + x + '" cy="72" r="5.5" class="gc-hub"/>'; });
    return s + '</svg>';
  }
  /** Where the picture came from, for the line under it (the Commons one links to the photo's page and license). */
  function credit(c) {
    var w = which(c, hasKey()), p = c && c.pic;
    if(hasGenerated(c))return {text:'Your selected image'};
    if(w==='chosen')return {text:'Photo: '+p.chosen.artist+(p.chosen.license?' · '+p.chosen.license:''),url:p.chosen.page};
    if (w === 'fuel') return { text: 'Photo: EVOX Images via Fuel API' + (p.fuel.exact === false ? ' · closest trim: ' + (p.fuel.trim || 'base') : '') };
    if (w === 'nhtsa') return { text: 'Photo: NHTSA (EVOX Images)' };
    if (w === 'wiki') return { text: 'Photo: ' + p.wiki.artist + ' · ' + p.wiki.license + ' · Wikimedia Commons', url: p.wiki.page };
    if (c && c.picMode === 'doodle') return { text: 'Doodle' };
    return { text: c && c.year && !pending(c) ? 'No photo found: here\'s a doodle' : '' };
  }
  /** Fuel API's trims for the car's year / make / model (needs the key; asked once per model, kept for the session). */
  function trims(c) {
    if (!hasKey() || !c || !c.year || !c.make || !c.model) return Promise.resolve([]);
    var k = 'trims|' + sig(c);
    if (mem[k]) return Promise.resolve(mem[k]);
    return fuel('vehicles?year=' + encodeURIComponent(c.year) + '&make=' + encodeURIComponent(c.make) + '&model=' + encodeURIComponent(baseModel(c.model))).then(function (list) {
      var out = []; (list || []).forEach(function (v) { var t = String(v.trim || '').trim(); if (t && out.indexOf(t) < 0) out.push(t); });
      return (mem[k] = out);
    }).catch(function () { return []; });
  }
  function keyChanged() { (S.cars || []).forEach(function (c) { if (c.pic) delete c.pic.fuel; }); LG.info('car', 'Car pictures: ' + (hasKey() ? 'Fuel API key set' : 'no Fuel API key')); A.save(); }
  function recreationPrompt(c) {
    return 'Recreate this image without the watermark. Preserve the car’s original shadow and use a transparent background.';
  }
  function downloadFuelImage(c) {
    if (!hasKey()) return Promise.reject(new Error('Add your Fuel API key in Settings to download this car’s Fuel API image.'));
    function waitForFuel() {
      if (!busy['f|' + c.id]) return lookFuel(c);
      return new Promise(function (resolve, reject) {
        var tries = 0;
        function poll() {
          if (!busy['f|' + c.id]) { lookFuel(c).then(resolve, reject); return; }
          if (++tries > 300) { reject(new Error('Timed out waiting for the Fuel API vehicle lookup.')); return; }
          setTimeout(poll, 100);
        }
        poll();
      });
    }
    return waitForFuel().then(function () {
      var f = c.pic && c.pic.fuel;
      if (!f || f.fail || !f.colors || !f.colors.length || !f.vid) throw new Error('No Fuel API image is available for this vehicle and trim.');
      var want = pickColor(f.colors, c.paint) || f.colors[0];
      return fuel('vehicle/' + encodeURIComponent(f.vid) + '?productID=2&productFormatIDs=' + FORMAT_ID).then(function (v) {
        var fresh = fuelViews(v).filter(function (x) { return x.code === want.code&&x.angle===selectedView(c).angle; })[0];
        if (!fresh || !fresh.url) throw new Error('Fuel API did not return an image for the selected paint color.');
        var name = ('gasket-' + [c.year, c.make, baseModel(c.model), c.paint && c.paint.simple || want.simple || want.name || want.code].filter(Boolean).join('-'))
          .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) + '.webp';
        return call('saveCarImage', fresh.url, name);
      });
    }).then(function (r) {
      if (!r || r.error) throw new Error(r && r.error || 'Image download failed.');
      return r;
    });
  }
  async function recreate(c) {
    if (!c) return;
    var prompt = recreationPrompt(c);
    var setup = stored('chatgptSetup');
    if (!setup && !await imageDialog('First, sign in to ChatGPT in the browser that opens. Gasket will remember that setup was completed, but cannot verify whether your session later expires. Continue?',true)) return;
    if (!await imageDialog('Gasket will download the selected Fuel API vehicle image to Downloads/Gasket so you can attach that exact image in ChatGPT. Your recreation prompt will also be copied to the clipboard. Continue?',true)) return;
    if (!setup) keep('chatgptSetup', '1');
    try { if (root.Native && root.Native.copyText) root.Native.copyText(prompt); } catch (e) {}
    if (root.FLog) root.FLog.info('car', 'Downloading Fuel API source image before opening ChatGPT');
    downloadFuelImage(c).then(async function (r) {
      await imageDialog('Source image saved to ' + (r.path || 'Downloads/Gasket') + '. Your recreation prompt is copied. In ChatGPT, attach that downloaded image and paste the prompt.');
      try {
        if (root.Native && root.Native.openUrl) root.Native.openUrl('https://chatgpt.com/');
        else root.open('https://chatgpt.com/', '_blank');
      } catch (e) {}
      if (root.FLog) root.FLog.info('car', 'Opened ChatGPT for image recreation');
    }).catch(function (e) {
      imageDialog('Could not download the Fuel API image: ' + String(e && e.message || e) + '\nYour prompt is copied to the clipboard. Check your Fuel API key and try again.');
      if (root.FLog) root.FLog.warn('car', 'Fuel API source image download failed', String(e && e.message || e));
    });
  }
  function resetChatGPTSetup() {
    keep('chatgptSetup', '');
  }
  root.CarPics = { angles:angles,rotate:rotate,trims: trims, loadColors: loadColors, keyChanged: keyChanged, hasKey: hasKey, busyColors: function (c) { return !!(c && busy['f|' + c.id]); },
    colors: function (c) { var f = c && c.pic && c.pic.fuel; return hasKey() && f && !f.fail ? f.colors || [] : []; }, ensure: ensure, src: src, pending: pending, drawing: drawing, credit: credit, which: which, bodyOf: bodyOf,
    hasGenerated: hasGenerated, hasOverride:hasOverride, choose:choose, importGenerated: importGenerated, clearGenerated: clearGenerated, recreate: recreate, recreationPrompt: recreationPrompt, resetChatGPTSetup: resetChatGPTSetup };
})(typeof window !== 'undefined' ? window : globalThis);
