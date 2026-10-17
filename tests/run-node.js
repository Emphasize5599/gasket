// Bounded parallel tests. Failed output is retained and any failure fails the runner.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const release=['tirerack','keylessgas','keyless-discovery-ui','saved-prices','map-refresh','map-known-pan','picture-storage','tires','keyless-parallel','pricehistory','fuel-grades','keyless-discovery','walmart-keyless','climate','pricing','routes-limit','worker-pool','speed-settings','speed','trip','limits','discovery-log','routewx','speed-nokey','tile-hazards','vin-trim','recall-check','background-search'];
release.push('nhtsa-reader','editor-tires','hazard-prefetch','styled-tire-flow','trailer-editor','vehicle-catalog','nhtsa-catalog','setup-demo');
release.push('carpics','carpics-download','car-photo-picker','recalls-nhtsa','car-search-name');
release.push('citgo-trip','scan-audit','citgo-trip-ui');
release.push('vin-feedback','roadside-cash');
release.push('station-reconcile','map-scan-merge');
release.push('routechoices','routechoices-ui','vehicle-required');
release.push('adaptive-readers');
release.push('tire-estimate-ui','planner-worker');
release.push('tasks','gemma','gemma-ui');
release.push('trims');
release.push('fresh-car-lookups','ai-defaults','debug-log');
release.push('tire-date-layout');
release.push('wet-tire-route');
release.push('hazard-warning-matrix');
release.push('vehicle-weather');
release.push('vehicle-weather-ui');
release.push('route-memory-ui');
release.push('ui-flow');
release.push('severity');
release.push('apk-build');
const args=process.argv.slice(2),all=args.includes('--all'),names=all?fs.readdirSync(__dirname).filter(f=>f.endsWith('.test.js')).map(f=>f.slice(0,-8)):args.includes('--release')?release:args;
if(!names.length){console.error('Use --release, --all, or test names without .test.js');process.exit(2);}
for(const name of names)if(!/^[a-z0-9-]+$/.test(name)||!fs.existsSync(path.join(__dirname,name+'.test.js'))){console.error('Unknown test: '+name);process.exit(2);}
const concurrency=Math.max(1,Math.min(4,Math.floor(Number(process.env.TEST_JOBS)||3))),started=Date.now();let next=0,failed=false;
async function lane(){while(next<names.length){const name=names[next++],at=Date.now();await new Promise(resolve=>{const child=spawn(process.execPath,[path.join(__dirname,name+'.test.js')],{cwd:path.resolve(__dirname,'..'),env:process.env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('error',e=>{output+=e.message;});child.on('close',code=>{const ok=code===0,skipped=ok&&output.includes('Native Routes gate test needs a JDK; enforced in CI');failed=failed||!ok;console.log((skipped?'SKIP ':ok?'PASS ':'FAIL ')+name+' ('+((Date.now()-at)/1000).toFixed(1)+'s)');if(!ok||skipped||process.env.TEST_VERBOSE)process.stdout.write(output);resolve();});});}}
Promise.all(Array.from({length:concurrency},lane)).then(()=>{console.log(names.length+' tests in '+((Date.now()-started)/1000).toFixed(1)+'s · '+concurrency+' jobs');process.exitCode=failed?1:0;});
