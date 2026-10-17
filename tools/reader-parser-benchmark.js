// Opt-in offline comparison on identical public search frames captured by reader-benchmark.
const fs=require('node:fs'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const frames=JSON.parse(fs.readFileSync(process.env.READER_RAW_REPORT,'utf8')).rawFrames;
assert(frames.length,'No captured frames');assert(frames.every(s=>typeof s==='string'&&s.length<=5000000));
function parser(source){
 const helpers=source.slice(source.indexOf('  const grade'),source.indexOf('  const targets ='));
 const price=source.slice(source.indexOf('  const price ='),source.indexOf('  // Associate'));
 const read=source.slice(source.indexOf('  const readPrices ='),source.indexOf('  const readRows ='));
 return new Function('raw','const prices=new Map();\n'+helpers+'\n'+price+'\n'+read+'\nreadPrices(raw);return Array.from(prices);');
}
const old=parser(execFileSync('git',['show','e71502e:assets/gasweb_worker.js'],{encoding:'utf8'})),current=parser(fs.readFileSync('assets/gasweb_worker.js','utf8'));
for(const frame of frames)assert.deepEqual(current(frame),old(frame),'changed station/grade/ambiguity evidence on an identical real response');
for(const [name,fn]of [['old',old],['current',current]]){
 const times=[];for(let sample=0;sample<3;sample++){if(global.gc)global.gc();const at=performance.now();for(let i=0;i<20;i++)for(const frame of frames)fn(frame);times.push(+(performance.now()-at).toFixed(1));}
 console.log(JSON.stringify({name,frames:frames.length,passes:20,milliseconds:times}));
}
console.log('All captured frame outputs are identical');
