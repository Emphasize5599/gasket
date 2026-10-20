// Version-pinned, fail-closed source transformation. No binary patching or ABI substitutions.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const REV='b2f686e2ed4718fb84ec398a61dd59ca0f0aff27';
const SOURCE_SHA='d592f16604868ec6f35e0a65c39ce693c9da45266eafffc51036a9225d3b776c';
const MARKER='gasket_gpu_low_priority_v1';
function patch(source){
 if(crypto.createHash('sha256').update(source).digest('hex')!==SOURCE_SHA)throw Error('Unexpected LiteRT-LM JNI source; review a new version explicitly.');
 const start=source.indexOf('JNI_METHOD(nativeCreateEngine)'),end=source.indexOf('JNI_METHOD(nativeCreateBenchmark)',start);
 if(start<0||end<start)throw Error('Engine initialization boundary missing');
 const anchor='  auto engine = EngineFactory::CreateDefault(*settings);';
 const section=source.slice(start,end);if(section.split(anchor).length!==2)throw Error('Expected exactly one engine initialization');
 const added=`  // Gasket UI-priority patch v1: preserve every other native/default setting.
  // See google-ai-edge/LiteRT-LM#3992. This is a driver request, not a guarantee.
  if (*backend_enum == Backend::GPU) {
    auto ui_settings =
        settings->GetMainExecutorSettings().GetAdvancedSettings().value_or(
            litert::lm::AdvancedSettings());
    ui_settings.gpu_context_low_priority = true;
    settings->GetMutableMainExecutorSettings().SetAdvancedSettings(ui_settings);
    ABSL_LOG(INFO) << "${MARKER}: low-priority GPU context requested";
  }
`;
 const identity=`
// Gasket's Java-side check refuses to advertise this patch when a stock JNI library was packaged.
extern "C" JNIEXPORT jint JNICALL
Java_com_bensanzone_fuelmap_GemmaGpuSupport_nativePatchVersion(JNIEnv*, jclass) {
  return 1;
}
`;
 return source.slice(0,start)+section.replace(anchor,added+anchor)+source.slice(end)+identity;
}
module.exports={patch,REV,SOURCE_SHA,MARKER};
if(require.main===module){
 if(process.argv.length!==3)throw Error('Usage: node tools/runtime/patch-litert-gpu.js <LiteRT-LM source directory>');
 const file=path.join(path.resolve(process.argv[2]),'kotlin/java/com/google/ai/edge/litertlm/jni/litertlm.cc');
 fs.writeFileSync(file,patch(fs.readFileSync(file,'utf8')));
 console.log('Applied GPU priority patch to LiteRT-LM '+REV);
}
