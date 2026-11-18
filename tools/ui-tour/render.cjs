// Re-draws each saved screen in a clean page at phone width with every scroller unrolled and every tile
// expanded, then writes long screenshots plus a gallery (index.html + viewer.html) per theme.
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const WEB = path.resolve(__dirname, '../../assets/web');
const UNROLL = `
html,body{height:auto!important;min-height:0!important;overflow:visible!important;background:var(--bg)!important}
body{position:static!important;background:var(--bg)!important}
#startupScreen,.scroll-hint,.sub-hint,#taskHub,#apiCount{display:none!important}
[data-tour-surface]{position:relative!important;inset:auto!important;top:auto!important;left:auto!important;right:auto!important;bottom:auto!important;height:auto!important;max-height:none!important;min-height:0!important;transform:none!important;overflow:visible!important;width:100%!important}
[data-tour-surface] *{max-height:none!important}
[data-tour-surface] .tp-body,[data-tour-surface] .sub-body,[data-tour-surface] .settings-body,[data-tour-surface] .ob-body,[data-tour-surface] .sheet-body,[data-tour-surface] .page-body,[data-tour-surface] .scroll,[data-tour-surface] .cfm-body,[data-tour-surface] .ap-list{overflow:visible!important;flex:none!important;height:auto!important}
*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
.tour-whole{position:relative;width:100%;height:915px}
[data-tour-surface]:not(.tour-whole){display:flex!important;flex-direction:column!important;min-height:915px!important}
[data-tour-surface]:not(.tour-whole) > :last-child{margin-top:auto!important}
`;
async function render(rawDir, outDir, opts = {}) {
  const { chromium } = require('playwright');
  const files = fs.readdirSync(rawDir).filter(f => f.endsWith('.json'));
  const snaps = files.map(f => Object.assign(JSON.parse(fs.readFileSync(path.join(rawDir, f))), { id: f.slice(0, -5) }))
    .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.t - b.t);
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const themes = opts.themes || ['light', 'dark'];
  try {
    for (const theme of themes) {
      const dir = path.join(outDir, theme), img = path.join(dir, 'img');
      fs.mkdirSync(img, { recursive: true });
      const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: opts.scale || 1 });
      await page.route(/^https?:\/\//, r => r.abort());
      const shell = '<!doctype html><html><head><meta charset="utf-8"><base href="' + pathToFileURL(WEB + '/').href + '"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="lib/leaflet.css"><link rel="stylesheet" href="app.css"><link rel="stylesheet" href="restweather.css"><style>' + UNROLL + '</style></head><body></body></html>';
      const shellFile = path.join(outDir, '.shell.html'); fs.writeFileSync(shellFile, shell);
      await page.goto(pathToFileURL(shellFile).href);
      const entries = [];
      for (const s of snaps) {
        if (s.png) { const name = s.id + '.png'; fs.writeFileSync(path.join(img, name), Buffer.from(s.png, 'base64')); entries.push({ id: s.id, title: s.title, category: s.category, source: s.source, note: s.note + ' (live screenshot, original theme and width)', height: 0, parts: ['img/' + name] }); continue; }
        await page.setViewportSize({ width: 412, height: 915 });
        await page.evaluate(({ s, theme }) => {
          const h = document.documentElement; h.setAttribute('style', s.htmlAttrs.style || ''); h.dataset.theme = theme;
          document.body.className = (s.bodyClass || '').replace(/\btrip-full\b/, '') + ' tour';
          document.body.innerHTML = s.whole ? '<div class="tour-whole" data-tour-surface>' + s.html + '</div>' : s.html;
          const root = document.querySelector('[data-tour-surface]') || document.body;
          root.classList.remove('hidden');
          root.querySelectorAll('details').forEach(d => d.open = true);
          if (!s.whole) root.querySelectorAll('*').forEach(e => { const p = getComputedStyle(e).position; if (p === 'sticky' || p === 'fixed') e.style.setProperty('position', p === 'fixed' && e.closest('.leaflet-container') ? p : 'static', 'important'); });
        }, { s, theme });
        await page.waitForTimeout(60);
        const height = await page.evaluate(() => Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 915)));
        const CH = 14000, parts = [];
        for (let y = 0, k = 0; y < height; y += CH, k++) {
          const name = s.id + (k ? '-' + (k + 1) : '') + '.png';
          await page.setViewportSize({ width: 412, height: Math.min(CH, height - y) });
          await page.evaluate(y => window.scrollTo(0, y), y);
          await page.screenshot({ path: path.join(img, name), fullPage: false });
          parts.push('img/' + name);
        }
        entries.push({ id: s.id, title: s.title, category: s.category, source: s.source, note: s.note, height, parts });
      }
      await page.close();
      fs.writeFileSync(path.join(dir, 'screens.json'), JSON.stringify(entries, null, 1));
      fs.writeFileSync(path.join(dir, 'index.html'), indexHtml(entries, theme));
      fs.writeFileSync(path.join(dir, 'viewer.html'), viewerHtml(entries, theme));
      fs.rmSync(path.join(outDir, '.shell.html'), { force: true });
    }
  } finally { await browser.close(); }
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const style = theme => `<style>:root{color-scheme:${theme}}body{font:15px system-ui,sans-serif;margin:0;padding:16px;background:${theme === 'dark' ? '#121418' : '#f4f5f7'};color:${theme === 'dark' ? '#eee' : '#111'}}a{color:${theme === 'dark' ? '#8ab4f8' : '#1a5fd0'}}input{font:inherit;padding:8px 12px;width:100%;max-width:420px;box-sizing:border-box;border-radius:10px;border:1px solid #888;background:transparent;color:inherit}ol{padding-left:28px}li{margin:6px 0}small{opacity:.7}.nav{position:sticky;top:0;display:flex;gap:8px;align-items:center;padding:8px 0;background:inherit;flex-wrap:wrap}.nav b{flex:1;min-width:160px}button{font:inherit;padding:8px 14px;border-radius:10px;border:1px solid #888;background:transparent;color:inherit}img{display:block;width:412px;max-width:100%;margin:0 auto;box-shadow:0 0 0 1px #8884}</style>`;
const indexHtml = (list, theme) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gasket UI tour · ${theme}</title>${style(theme)}
<h1>Gasket UI tour · ${theme}</h1><p>${list.length} screens, 412 px wide (Pixel 10 Pro). Every scroller is unrolled and every tile expanded. Tap one to open the viewer.</p>
<input id="q" placeholder="Filter by title or source" oninput="for(const li of document.querySelectorAll('li'))li.hidden=!li.textContent.toLowerCase().includes(this.value.toLowerCase())">
<ol>${list.map((e, i) => `<li><a href="viewer.html#${i}">${esc(e.title)}</a> <small>${esc(e.category)} · from ${esc(e.source)}${e.note ? ' · ' + esc(e.note) : ''} · ${e.height}px</small></li>`).join('')}</ol>`;
const viewerHtml = (list, theme) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gasket UI tour viewer</title>${style(theme)}
<div class="nav"><button onclick="go(-1)">‹ Prev</button><b id="t"></b><button onclick="go(1)">Next ›</button><a href="index.html">Index</a></div><div id="v"></div>
<script>const L=${JSON.stringify(list.map(e => ({ t: e.title, c: e.category, s: e.source, p: e.parts })))};let i=0;
function show(){i=Math.max(0,Math.min(L.length-1,+location.hash.slice(1)||0));const e=L[i];document.getElementById('t').textContent=(i+1)+' / '+L.length+' · '+e.t+' ('+e.c+', '+e.s+')';const y=scrollY;document.getElementById('v').innerHTML=e.p.map(p=>'<img src="'+p+'">').join('');const im=[...document.querySelectorAll('#v img')];Promise.all(im.map(x=>x.complete?0:new Promise(r=>{x.onload=x.onerror=r;}))).then(()=>scrollTo(0,y));}
function go(d){location.hash=Math.max(0,Math.min(L.length-1,i+d));}addEventListener('hashchange',show);addEventListener('keydown',e=>{if(e.key==='ArrowLeft')go(-1);if(e.key==='ArrowRight')go(1);});show();</script>`;
module.exports = { render };
if (require.main === module) render(process.argv[2], process.argv[3]).catch(e => { console.error(e); process.exit(1); });
