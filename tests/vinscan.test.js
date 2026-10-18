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
// QR codes: a link with the VIN (plain or %-escaped), "VIN" written against it, several fields
assert.deepEqual(M.pick('https://vin.example.test/decode?vin=1M8GDM9AXKP042788&src=label'),{vin:'1M8GDM9AXKP042788',checked:true});
assert.deepEqual(M.pick('https://example.test/r?d=VIN%3D1M8GDM9AXKP042788%26y%3D2019'),{vin:'1M8GDM9AXKP042788',checked:true});
assert.deepEqual(M.pick('VIN1M8GDM9AXKP042788'),{vin:'1M8GDM9AXKP042788',checked:true});
assert.deepEqual(M.pick('MFR:TESTCO|VIN:1M8GDM9AXKP042788|DATE:06/19|GVWR:6000'),{vin:'1M8GDM9AXKP042788',checked:true});
assert.equal(M.pick('https://example.test/%E0%A4%A'),null,'a broken escape is just text');
// a real QR code (ZXing's writer) through the scanner's reader settings, then pick
{const Z=require('../assets/web/lib/zxing.min.js'),hints=new Map(),text='https://vin.example.test/decode?vin=1M8GDM9AXKP042788';
 const bm=new Z.QRCodeWriter().encode(text,Z.BarcodeFormat.QR_CODE,240,240,new Map()),W=bm.getWidth(),H=bm.getHeight(),px=new Uint8ClampedArray(W*H);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++)px[y*W+x]=bm.get(x,y)?0:255;
 hints.set(Z.DecodeHintType.POSSIBLE_FORMATS,[Z.BarcodeFormat.CODE_39,Z.BarcodeFormat.CODE_128,Z.BarcodeFormat.DATA_MATRIX,Z.BarcodeFormat.QR_CODE]);hints.set(Z.DecodeHintType.TRY_HARDER,true);
 const r=new Z.MultiFormatReader();r.setHints(hints);const warn=console.warn,log=console.log;console.warn=console.log=()=>{};let res;try{res=r.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(px,W,H))));}finally{console.warn=warn;console.log=log;}   // ZXing notes its 1D readers giving up on a QR
 assert.equal(Z.BarcodeFormat[res.getBarcodeFormat()],'QR_CODE');assert.deepEqual(M.pick(res.getText()),{vin:'1M8GDM9AXKP042788',checked:true},'a QR link resolves to its VIN');}
console.log('VIN barcode reading: check digit, picking and QR codes passed');
