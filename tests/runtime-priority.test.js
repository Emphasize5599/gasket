const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const p=require('../tools/runtime/patch-litert-gpu');
assert.throws(()=>p.patch('unrecognized source'),/Unexpected/);
const src=fs.readFileSync('tools/runtime/patch-litert-gpu.js','utf8'),m=src.match(/const added=`([\s\S]*?)`;/);assert(m,'priority block must remain independently testable');
const block=m[1].replace('${MARKER}',p.MARKER);
assert.match(block,/gpu_context_low_priority = true/);assert(!block.includes('hint_kernel_batch_size ='),'preserve existing kernel batching');
const compiler=process.env.CXX||'c++';if(spawnSync(compiler,['--version']).error){if(process.env.GASKET_NATIVE_TESTS==='1')throw Error('C++ compiler required');console.log('Priority source contracts passed; C++ settings execution enforced in native workflow');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gasket-gpu-priority-'));
const cpp=`#include <optional>
#include <iostream>
#include <cassert>
#define ABSL_LOG(level) std::cout
enum class Backend {GPU, CPU};
namespace litert::lm {struct AdvancedSettings {std::optional<bool> gpu_context_low_priority;int hint_kernel_batch_size=9;bool unrelated=true;};}
struct Executor {std::optional<litert::lm::AdvancedSettings> advanced;const auto& GetAdvancedSettings(){return advanced;}void SetAdvancedSettings(litert::lm::AdvancedSettings v){advanced=v;}};
struct Settings {Executor e;Executor& GetMainExecutorSettings(){return e;}Executor& GetMutableMainExecutorSettings(){return e;}};
void apply(std::optional<Settings>& settings,std::optional<Backend> backend_enum){${block}}
int main(){
 std::optional<Settings> s=Settings{};apply(s,Backend::GPU);assert(s->e.advanced->gpu_context_low_priority.value());assert(s->e.advanced->hint_kernel_batch_size==9&&s->e.advanced->unrelated);
 s->e.advanced->gpu_context_low_priority=false;apply(s,Backend::CPU);assert(!s->e.advanced->gpu_context_low_priority.value());
 s->e.advanced->hint_kernel_batch_size=4;s->e.advanced->unrelated=false;apply(s,Backend::GPU);assert(s->e.advanced->gpu_context_low_priority.value());assert(s->e.advanced->hint_kernel_batch_size==4&&!s->e.advanced->unrelated);
 s=Settings{};apply(s,Backend::CPU);assert(!s->e.advanced.has_value());
}
`;
fs.writeFileSync(path.join(dir,'priority.cc'),cpp);
const exe=path.join(dir,process.platform==='win32'?'priority.exe':'priority');
let r=spawnSync(compiler,['-std=c++17',path.join(dir,'priority.cc'),'-o',exe],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);
r=spawnSync(exe,[],{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stdout+r.stderr);console.log('Actual injected C++ block: GPU requests low priority, CPU unchanged, existing options preserved.');
