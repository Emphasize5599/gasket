# Runs prompts through the same Gemma 4 E4B file and sampler as GemmaRuntime.java, on the CPU.
# argv: model.litertlm prompts.json out.json   (pip install litert-lm; the system prompt is read from GemmaRuntime.java)
import json, sys, time, litert_lm as L
import os, re
src = open(os.path.join(os.path.dirname(__file__), '../../src/com/bensanzone/fuelmap/GemmaRuntime.java')).read()
SP = ''.join(re.findall(r'"((?:[^"\\]|\\.)*)"', re.search(r'Contents\.Companion\.of\((.*?)\),\s*Collections', src, re.S).group(1)))
model, sys.argv = sys.argv[1], sys.argv[1:]
items = json.load(open(sys.argv[1]))
eng = L.Engine(model, backend=L.Backend.CPU(), max_num_tokens=16384,
               cache_dir=os.path.join(os.path.dirname(os.path.abspath(model)), 'cache'))
out = []
for it in items:
    t = time.time()
    conv = eng.create_conversation(system_message=SP, sampler_config=L.SamplerConfig(top_k=10, top_p=0.9, temperature=0.1, seed=1),
                                   max_output_tokens=2048, thinking_config=L.ThinkingConfig(enable_thinking=False))
    msg = conv.send_message(it['prompt'])
    text = ''.join(getattr(c, 'text', '') or '' for c in msg.contents.contents)
    conv.close()
    out.append({'name': it['name'], 'text': text, 'sec': round(time.time() - t, 1)})
    print(it['name'], out[-1]['sec'], 's', flush=True)
    json.dump(out, open(sys.argv[2], 'w'), indent=1)
