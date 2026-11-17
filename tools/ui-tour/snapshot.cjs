// Read-only DOM capture of the screen on top. Runs inside the page; never changes app state.
module.exports = function snapshot(seenKey) {
  const seen = window[seenKey] || (window[seenKey] = new Set());
  const shown = e => { if (!e || !e.isConnected || e.classList.contains('hidden')) return false; const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.getClientRects().length > 0; };
  const pick = () => {
    const order = ['#cfm', '.app-picker', '.dtp', '.vin-scan', '.page.sub-page', '#onboarding', '#settings', '#blPage', '#licPage', '#trip', '#detail'];
    let best = null;
    for (const sel of order) { const all = [...document.querySelectorAll(sel)].filter(shown); if (all.length) { best = all[all.length - 1]; break; } }
    return best;
  };
  const surface = pick();
  const clean = t => String(t || '').replace(/\s+/g, ' ').replace(/[0-9]+([.,:][0-9]+)*/g, '#').trim().slice(0, 80);
  const root = surface || document.body;
  let title = '';
  if (surface) {
    const h = surface.querySelector('.sub-bar h2, h1, h2, #cfmT, .ob-title, h3');
    title = clean(h && h.textContent);
    if (surface.id === 'trip') { const on = document.querySelector('#tpSteps .on'); title = 'Trip · ' + clean(on ? on.title : ''); }
    if (surface.id === 'settings') { const g = surface.querySelector('.settings-group:not(.hidden)'); title = 'Settings · ' + (g ? clean((surface.querySelector('#settingsTitle, .settings-bar h2') || {}).textContent || g.dataset.settingsView) : 'home'); }
    if (surface.id === 'listSheet') title = 'Station list';
  } else title = 'Map · ' + clean((document.querySelector('#btnMode') || {}).textContent);
  const parts = [];
  root.querySelectorAll('h1,h2,h3,h4,summary,.sub-ent b,.lbl,.settings-link b,label,button,.seg .on,.chip.on').forEach(e => { if (shown(e)) { const t = clean(e.firstChild && e.firstChild.nodeType === 3 ? e.firstChild.textContent : e.textContent); if (t) parts.push(e.tagName[0] + t); } });
  const sig = (surface ? (surface.id || surface.className) : 'map') + '|' + title + '|' + [...new Set(parts)].join('~');
  if (seen.has(sig)) return null;
  seen.add(sig);
  // Clone with live form state and canvas pixels.
  root.setAttribute('data-tour-surface', '');
  const live = [...root.querySelectorAll('input,select,textarea,canvas')];
  const clone = root.cloneNode(true);
  root.removeAttribute('data-tour-surface');
  const copies = [...clone.querySelectorAll('input,select,textarea,canvas')];
  live.forEach((e, i) => {
    const c = copies[i]; if (!c) return;
    if (e.tagName === 'CANVAS') { try { const img = document.createElement('img'); img.src = e.toDataURL(); img.style.cssText = e.style.cssText; img.width = e.width; img.height = e.height; img.className = e.className; c.replaceWith(img); } catch (x) { } return; }
    if (e.type === 'checkbox' || e.type === 'radio') { if (e.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked'); }
    else if (e.tagName === 'SELECT') [...c.options].forEach((o, k) => { if (e.options[k] && e.options[k].selected) o.setAttribute('selected', ''); else o.removeAttribute('selected'); });
    else if (e.tagName === 'TEXTAREA') c.textContent = e.value;
    else if (e.type !== 'password' && e.type !== 'file') c.setAttribute('value', e.value);
    else c.removeAttribute('value');
  });
  clone.querySelectorAll('script').forEach(s => s.remove());
  // the main map keeps its tiles as <img>; Leaflet's transforms survive in style attributes
  const html = surface ? clone.outerHTML : clone.innerHTML;
  return { sig, title: title || 'Untitled', category: surface ? (surface.id || (surface.classList.contains('sub-page') ? 'subpage' : surface.className.split(' ')[0])) : 'map', whole: !surface, html, htmlAttrs: { theme: document.documentElement.dataset.theme || '', style: document.documentElement.getAttribute('style') || '' }, bodyClass: document.body.className, width: innerWidth };
};
