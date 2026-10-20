// Fast source checks normally; CI additionally inspects and verifies BOTH real signed APKs.
const assert=require('node:assert/strict'),fs=require('node:fs'),{spawnSync}=require('node:child_process'),crypto=require('node:crypto');
const gradle=fs.readFileSync('build.gradle','utf8'),script=fs.readFileSync('build.sh','utf8'),workflow=fs.readFileSync('.github/workflows/build-apk.yml','utf8'),readme=fs.readFileSync('README.md','utf8'),manifest=fs.readFileSync('AndroidManifest.xml','utf8');
assert.match(gradle,/splits\s*\{\s*abi\s*\{\s*enable true\s*reset\(\)\s*include 'arm64-v8a', 'x86_64'\s*universalApk true/);
assert(!/versionCodeOverride|abiCodes/.test(gradle),'sideloaded architecture choices use the same version code');
assert.match(script,/for ABI in arm64-v8a universal/);assert.match(script,/Gasket-\$ABI-release-unsigned\.apk/);assert.equal((script.match(/assembleRelease/g)||[]).length,1,'compile/dex once for both published APKs');
assert.match(workflow,/GASKET_APK_VERIFY=1 node tests\/apk-build\.test\.js/);
assert.match(workflow,/Gasket-\$\{\{ steps\.version\.outputs\.name \}\}-keyless-test-\$abi\.apk/);
assert.match(workflow,/gh release create[^\n]+--prerelease --draft/);assert(workflow.indexOf('gh release edit "$tag" --draft=false')>workflow.indexOf('asset="Gasket-${{ steps.version.outputs.name }}-keyless-test-$abi.apk"'),'publish only after both architecture assets are uploaded');
const pixelFilter=/^Gasket-\d+\.\d+\.\d+-keyless-test-arm64-v8a\.apk$/;
assert(readme.includes(pixelFilter.source),'documented force-ARM64 filter must stay in sync');
const samples=['Gasket-0.0.160-keyless-test-arm64-v8a.apk','Gasket-0.0.160-keyless-test-universal.apk','Gasket-0.0.160-arm64-v8a.apk','Gasket-0.0.159-keyless-test.apk'];
assert.deepEqual(samples.filter(name=>pixelFilter.test(name)),[samples[0]]);
// Mirrors the pinned upstream filename algorithm (not an Obtainium device/integration test).
function byArch(names,abis){if(names.length>1)for(const abi of abis){const aliases={'arm64-v8a':['aarch64','arm64'],'armeabi-v7a':['armv7','armeabi'],'x86_64':['x64']};const re=new RegExp('.*(?:'+[abi,...(aliases[abi]||[])].join('|')+').*','i'),filtered=names.filter(n=>re.test(n));if(filtered.length&&filtered.length<names.length){names=filtered;break;}}return names;}
assert.deepEqual(byArch(samples.slice(0,2),['arm64-v8a']),[samples[0]]);
assert.deepEqual(byArch(samples.slice(0,2),['arm64-v8a','armeabi-v7a']),[samples[0]]);
// With no matching ABI, upstream leaves the choice to the user; do not promise an automatic universal fallback.
assert.deepEqual(byArch(samples.slice(0,2),['x86_64']),samples.slice(0,2));
if(process.env.GASKET_APK_VERIFY!=='1'){console.log('APK split config and documented Obtainium selection checks passed; signed binaries checked in CI');process.exit(0);}
function run(command,args,binary=false){const result=spawnSync(command,args,{encoding:binary?undefined:'utf8',maxBuffer:64*1024*1024});assert.equal(result.status,0,String(result.stderr||result.error||'')+'\n'+(binary?'':result.stdout));return result.stdout;}
const expected={package:manifest.match(/package="([^"]+)"/)[1],code:manifest.match(/android:versionCode="([^"]+)"/)[1],version:manifest.match(/android:versionName="([^"]+)"/)[1]};
let certificate,dex;
for(const [variant,expectedAbis] of [['arm64-v8a',['arm64-v8a']],['universal',['arm64-v8a','x86_64']]]){
 const apk='Gasket-'+variant+'.apk';assert(fs.statSync(apk).size>0);
 const entries=run('unzip',['-Z1',apk]).trim().split(/\r?\n/);
 const patched=run('unzip',['-p',apk,'lib/arm64-v8a/liblitertlm_jni.so'],true);
 assert(patched.includes(Buffer.from('Java_com_bensanzone_fuelmap_GemmaGpuSupport_nativePatchVersion')),'real APK must contain patched JNI identity');
 assert(patched.includes(Buffer.from('gasket_gpu_low_priority_v1')),'real APK must contain native priority request marker');
 const notices=run('unzip',['-p',apk,'assets/runtime-notices.txt']);assert(notices.includes('Modified by Gasket')&&notices.includes('THIRD_PARTY_NOTICE.txt'),'real APK must preserve full native and modification notices');
 const actualAbis=[...new Set(entries.map(e=>/^lib\/([^/]+)\/[^/]+\.so$/.exec(e)).filter(Boolean).map(m=>m[1]))].sort();assert.deepEqual(actualAbis,expectedAbis,apk);
 assert(entries.includes('assets/runtime-notices.txt'),'full dependency notices preserved');assert(!entries.some(e=>/\.(litertlm|part)$/.test(e)),'no multi-GB model bundled');
 const badging=run('aapt',['dump','badging',apk]),pkg=badging.match(/package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/);assert(pkg,'package metadata present');assert.deepEqual(pkg.slice(1,4),[expected.package,expected.code,expected.version]);
 assert.match(badging,/sdkVersion:'31'/);assert.match(badging,/targetSdkVersion:'35'/);
 const verification=run('apksigner',['verify','--print-certs',apk]);const certificates=[...verification.matchAll(/certificate SHA-256 digest:\s*([a-f0-9]+)/ig)].map(m=>m[1].toLowerCase());assert(certificates.length>0,'signer certificate verified');if(certificate)assert.deepEqual(certificates,certificate,'both APKs use the same existing signing identity');certificate=certificates;
 run('zipalign',['-c','-P','16','4',apk]);
 const hashes=entries.filter(e=>/^classes\d*\.dex$/.test(e)).sort().map(e=>crypto.createHash('sha256').update(run('unzip',['-p',apk,e],true)).digest('hex'));assert(hashes.length>0);if(dex)assert.deepEqual(hashes,dex,'identical application code in both architectures');dex=hashes;
 console.log(apk+': '+(fs.statSync(apk).size/1e6).toFixed(2)+' MB; ABI, identity, version, signature, alignment, code and notices verified');
}
assert(fs.statSync('Gasket-arm64-v8a.apk').size<fs.statSync('Gasket-universal.apk').size,'ARM64 download must actually be smaller');
