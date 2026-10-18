// The VIN in a scanned barcode's text, and its check digit.
const assert=require('node:assert/strict'),M=require('../assets/web/vinscan.js');
assert.equal(M.check('1M8GDM9AXKP042788'),true,'the textbook check-digit example (X)');
assert.equal(M.check('1M8GDM9A1KP042788'),false,'one character off');
assert.equal(M.check('1M8GDM9AXKP04278'),false,'16 characters');assert.equal(M.check('1M8GDM9AXKP04278O'),false,'O is never in a VIN');
assert.deepEqual(M.pick('1M8GDM9AXKP042788'),{vin:'1M8GDM9AXKP042788',checked:true});
assert.deepEqual(M.pick('I1M8GDM9AXKP042788'),{vin:'1M8GDM9AXKP042788',checked:true},'an imported car\'s leading I is dropped');
assert.deepEqual(M.pick(' 1m8gdm9axkp042788\n'),{vin:'1M8GDM9AXKP042788',checked:true},'case and spaces');
assert.deepEqual(M.pick('VIN:1M8GDM9AXKP042788;MFG 06/19'),{vin:'1M8GDM9AXKP042788',checked:true},'a label that says more around it');
assert.equal(M.pick('XX1M8GDM9AXKP042788YY'),null,'never 17 characters out of a longer field');
assert.deepEqual(M.pick('WVWZZZ1JZ3W386752'),{vin:'WVWZZZ1JZ3W386752',checked:false},'a VIN without a North American check digit (needs two frames to agree)');
assert.equal(M.pick('ABCWVWZZZ1JZ3W386752'),null,'(a window of it passes the check digit by chance)');
assert.equal(M.pick('012345678905'),null,'a UPC is not a VIN');assert.equal(M.pick(''),null);
console.log('VIN barcode reading: check digit and picking passed');
