const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const java = fs.readFileSync(path.join(root, 'src/com/bensanzone/fuelmap/MainActivity.java'), 'utf8');
// Native contract: persistent namespace, upgrade before the UI AND before backup,
// no silent success when cached user images could not be preserved.
assert.match(java, /KV_STORAGE[^;]+"carpics"/);
assert.match(java, /migrateCarPictures\(\);\s*web = new WebView/);
assert.match(java, /writeBackup\(String name\)[\s\S]*?migrateCarPictures\(\);/);
assert.match(java, /Could not preserve all car pictures/);
assert.match(java, /if \(tmp\.renameTo\(saved\)\) old\.delete\(\)/);
const image = 'data:image/webp;base64,UklGRg==';
const photo = {nhtsa:{sig:'2016|toyota|prius',url:'https://static.nhtsa.gov/test.webp',t:Date.now()}};
const settings = {setupDone:true,cars:[{id:'photo',year:2016,make:'Toyota',model:'Prius',obs:{},log:[]},{id:'imported',name:'Test car',obs:{},log:[]}],carId:'photo'};
async function open(browser, saved, kv) {
  const pg = await browser.newPage();
  await pg.addInitScript(({saved,kv})=>{
    sessionStorage.setItem('standinRestored',JSON.stringify({s:JSON.stringify(saved)}));
    window.__kv=kv;
  },{saved,kv});
  await pg.goto(pathToFileURL(path.join(root,'assets/web/index.html')).href);
  return pg;
}
(async()=>{
  const b=await chromium.launch({executablePath:process.env.CHROME||undefined});
  try {
    const kv={'lookups|cars':JSON.stringify({v:{photo:{pic:photo}}}),
      ['carpics|nhtsa|'+photo.nhtsa.url]:JSON.stringify({v:image}),
      'carpics|generated|imported':JSON.stringify({v:image})};
    const p=await open(b,settings,kv);
    assert.equal(await p.evaluate(()=>CarPics.src(__app.S.cars[0])),image);
    assert.equal(await p.evaluate(()=>CarPics.src(__app.S.cars[1])),image);
    await p.evaluate(()=>__app.save());
    const saved=await p.evaluate(()=>JSON.parse(__app.N.loadSettings()));
    assert.deepEqual(saved.cars[0].pic,photo,'legacy metadata moves into persistent settings');
    assert.equal(await p.evaluate(()=>JSON.parse(__app.N.kvGet('lookups','cars')).v.photo?.pic),undefined);
    await p.evaluate(()=>__app.KV.clear('lookups'));
    assert.equal(await p.evaluate(()=>CarPics.src(__app.S.cars[0])),image);
    const backupKv=await p.evaluate(()=>Object.fromEntries(Object.entries(__kv).filter(([k])=>k.startsWith('carpics|'))));
    await p.close();
    const restored=await open(b,saved,backupKv);
    assert.equal(await restored.evaluate(()=>CarPics.src(__app.S.cars[0])),image,'downloaded photo works offline after restart/restore');
    assert.equal(await restored.evaluate(()=>CarPics.src(__app.S.cars[1])),image,'imported photo works offline after restart/restore');
    await restored.close();
    console.log('Picture persistence, legacy metadata migration and offline restored image tests passed');
  } finally {await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
