const fs = require('fs'), path = require('path'), crypto = require('crypto'), snapshot = require('./snapshot.cjs');
const KEY = '__gasketTourSeen';
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 20);
// Capture the top screen of `page` into `dir` unless an identical screen is already saved.
async function capture(page, dir, source, note) {
  if (!dir || page.isClosed()) return false;
  let snap;
  try { snap = await page.evaluate(`(${snapshot})(${JSON.stringify(KEY)})`); } catch (e) { return false; }
  if (!snap) return false;
  const file = path.join(dir, hash(snap.sig) + '.json');
  if (fs.existsSync(file)) return false;
  snap.source = source; snap.note = note || ''; snap.t = Date.now();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(snap));
  return true;
}
module.exports = { capture, hash };
