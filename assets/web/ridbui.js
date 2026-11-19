/* Settings → Trip: user-started download of Recreation.gov (RIDB) campgrounds for rest planning, like the offline
 * charger inventory. Native RidbCampgrounds fetches only the export's facilities file; ~5,000 compact rows are kept in
 * KV restplaces/ridb (app storage: backed up, kept when the cache is cleared, removed by Erase all). */
(function (root) {
  'use strict';
  var AGREEMENT = 'https://ridb.recreation.gov/download';
  function A() { return root.__app; }
  function saved() { var r = A().KV.get('restplaces', 'ridb'); return r && r.v; }
  function statusText() { var s = saved(); return s && s.rows && s.rows.length ? Number(s.rows.length).toLocaleString() + ' campgrounds saved · ' + new Date(s.at).toLocaleDateString() : 'No campgrounds downloaded yet.'; }
  function html() {
    return '<div class="field col" id="ridbSettings"><div class="lbl">Campgrounds for rest stops (Recreation.gov)<small class="keep">Downloads about 5,000 federal campgrounds (about 35 MB) to this phone, so rest planning doesn\'t search for them on every trip. Wi-Fi recommended; update now and then for new or closed sites. Downloading means you accept the <a href="#" data-url="' + AGREEMENT + '">Recreation.gov data access agreement</a>. Fees, stay limits and availability are the agency\'s text and can be out of date.</small></div>' +
      '<div class="download-actions"><button type="button" class="btn tonal" id="ridbDownload">' + (saved() ? 'Update' : 'Download') + '</button><button type="button" class="btn tonal hidden" id="ridbCancel">Cancel</button><button type="button" class="btn tonal" id="ridbDelete"' + (saved() ? '' : ' disabled') + '>Delete</button></div><small id="ridbStatus" role="status">' + A().esc(statusText()) + '</small></div>';
  }
  var running = null;
  function attach(pg) {
    var button = pg.querySelector('#ridbDownload'), cancel = pg.querySelector('#ridbCancel'), info = pg.querySelector('#ridbStatus'), remove = pg.querySelector('#ridbDelete'); if (!button) return;
    function idle() { button.disabled = false; remove.disabled = !saved(); cancel.classList.add('hidden'); button.textContent = saved() ? 'Update' : 'Download'; }
    function stop() { if (A().N.restInventory) root.__trip.call('restInventory', 'cancel'); }
    if (running) { button.disabled = remove.disabled = true; cancel.classList.remove('hidden'); running.finally(function(){if(button.isConnected){idle();info.textContent=statusText();}}); }
    cancel.onclick = stop;
    remove.onclick = async function () {
      if(running)return;
      button.disabled=remove.disabled=true;
      try{
        if(!await A().confirmDel({always:true,title:'Delete downloaded campgrounds?',body:'Removes the offline Recreation.gov download from this device.',action:'Delete'}))return;
        info.textContent=A().KV.put('restplaces','ridb',null)?statusText():'Could not delete the campground download.';
      }finally{idle();}
    };
    button.onclick = function () {
      if (!A().N.restInventory) { info.textContent = 'Campground downloads need the Android app.'; return; }
      if (running) return; button.disabled = remove.disabled = true; cancel.classList.remove('hidden'); info.textContent = 'Downloading campgrounds…';
      var Tk = root.Tasks; if (Tk) Tk.upsert('ridb', { text: 'Downloading Recreation.gov campgrounds', frac: null, cancel: stop });
      running = root.__trip.callP(function (done, total) { var f = total ? done / total : null, mb = Math.round(done / 1048576); if (Tk) Tk.upsert('ridb', { text: 'Downloading campgrounds · ' + mb + ' MB' + (total ? ' of ' + Math.round(total / 1048576) + ' MB' : ''), frac: f && Math.min(.99, f), cancel: stop }); }, 'restInventory', 'download').then(function (r) {
        if (!r || r.error || !Array.isArray(r.rows)) { var why = r && r.error || 'No answer from the download'; info.textContent = /cancelled/i.test(why) ? 'Download cancelled. ' + statusText() : 'Campground download failed: ' + why; if (root.FLog) FLog.warn('rest', 'Campground download failed', { reason: why }); return; }
        if(!A().KV.put('restplaces', 'ridb', {at:Date.now(),rows:r.rows})){info.textContent='Could not save the campground download.';return;}
        info.textContent = statusText();
        if (root.FLog) FLog.info('rest', 'Recreation.gov campgrounds saved', { count: r.rows.length, mb: Math.round((r.bytes || 0) / 1048576) });
      }).finally(function () { running = null; if (Tk) Tk.remove('ridb'); if (button.isConnected) idle(); });
    };
  }
  root.RidbUI = { html: html, attach: attach, statusText: statusText };
})(window);
