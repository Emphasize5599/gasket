"""Replace pinned ARM64 JNI and add its upstream provider; preserve other entries."""
import hashlib
import json
import pathlib
import sys
import zipfile

STOCK_SHA = '706cbb8a87739b2818111bf3a19a78b8f7781586d10f80adf3415581fab7595f'
NATIVE_SHA = '305e61718079a032bad89e462cdb96b6e881bece4e60b95d2f140b1ad166a924'
ENTRY = 'jni/arm64-v8a/liblitertlm_jni.so'
PROVIDER = 'libGemmaModelConstraintProvider.so'
PROVIDER_SHA = 'f2aa38cecc5c728050652ffdbaed4c6f2d444e098e1ca3ecf8b85be46baae5b9'


def package(stock, native, out):
    assert hashlib.sha256(stock.read_bytes()).hexdigest() == STOCK_SHA, 'Stock AAR mismatch'
    assert hashlib.sha256(native.read_bytes()).hexdigest() == NATIVE_SHA, 'Native candidate mismatch'
    provider = native.parent / PROVIDER
    assert hashlib.sha256(provider.read_bytes()).hexdigest() == PROVIDER_SHA, 'Provider mismatch'
    notice = ('Modified by Gasket: ARM64 LiteRT-LM JNI requests low-priority GPU execution.\n'
              'Upstream: google-ai-edge/LiteRT-LM b2f686e2ed4718fb84ec398a61dd59ca0f0aff27\n'
              'Source and patch: https://github.com/Emphasize5599/gasket/tree/main/tools/runtime\n'
              'Identity: gasket_gpu_low_priority_v1. CPU and x86_64 JNI remain stock.\n')
    notice += 'Source builds bundle upstream libGemmaModelConstraintProvider.so separately (same Apache-2.0 upstream project).\n'
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(stock) as original, zipfile.ZipFile(out, 'w') as modified:
        assert ENTRY in original.namelist()
        assert len(original.namelist()) == len(set(original.namelist())), 'Duplicate stock entries'
        assert any(n.endswith('THIRD_PARTY_NOTICE.txt') for n in original.namelist())
        for entry in original.infolist():
            modified.writestr(entry, native.read_bytes() if entry.filename == ENTRY else original.read(entry.filename))
        modified.writestr('GASKET_PATCH_NOTICE.txt', notice)
        modified.writestr('jni/arm64-v8a/' + PROVIDER, provider.read_bytes())
    with zipfile.ZipFile(stock) as original, zipfile.ZipFile(out) as modified:
        for name in original.namelist():
            assert modified.read(name) == (native.read_bytes() if name == ENTRY else original.read(name)), name
    print(json.dumps(dict(nativeSha256=NATIVE_SHA, stockSha256=STOCK_SHA, replacedEntry=ENTRY)))


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit('Usage: package-aar.py official.aar candidate.so output.aar')
    package(*map(pathlib.Path, sys.argv[1:]))
