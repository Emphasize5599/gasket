"""Compare a source-built JNI candidate with the exact official Android AAR.

Run on Linux with readelf installed. This validates packaging/ABI, not device GPU behavior.
"""
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import zipfile

STOCK_SHA = '706cbb8a87739b2818111bf3a19a78b8f7781586d10f80adf3415581fab7595f'
IDENTITY = 'Java_com_bensanzone_fuelmap_GemmaGpuSupport_nativePatchVersion'
PROVIDER = 'libGemmaModelConstraintProvider.so'
PROVIDER_SHA = 'f2aa38cecc5c728050652ffdbaed4c6f2d444e098e1ca3ecf8b85be46baae5b9'


def readelf(file, flag):
    return subprocess.check_output(['readelf', '--wide', flag, str(file)], text=True)


def symbols(file):
    # JNI uses unversioned dlsym; @@ marks a default symbol version, not a name.
    return {line.split()[-1].split('@@')[0] for line in readelf(file, '--dyn-syms').splitlines()
            if ' GLOBAL ' in line and ' UND ' not in line and 'Java_' in line}


def needed(file):
    return set(re.findall(r'\(NEEDED\).*?\[(.*?)\]', readelf(file, '-d')))


def verify(stock, candidate):
    assert hashlib.sha256(stock.read_bytes()).hexdigest() == STOCK_SHA, 'Stock AAR checksum mismatch'
    assert 'AArch64' in readelf(candidate, '-h'), 'Wrong candidate architecture'
    with zipfile.ZipFile(stock) as aar, tempfile.TemporaryDirectory(prefix='gasket-abi-') as temp:
        original = pathlib.Path(temp) / 'stock.so'
        original.write_bytes(aar.read('jni/arm64-v8a/liblitertlm_jni.so'))
        before, after = symbols(original), symbols(candidate)
        assert before and not before - after, 'Missing stock JNI exports: ' + repr(sorted(before - after))
        assert IDENTITY in after, 'Missing patch identity JNI export'
        assert b'gasket_gpu_low_priority_v1' in candidate.read_bytes(), 'Missing priority marker'
        packaged = {pathlib.PurePosixPath(n).name for n in aar.namelist() if n.startswith('jni/arm64-v8a/')}
        # Public source builds link this upstream provider separately; the Maven
        # build folds it in. Never relax this to accept arbitrary sibling SOs.
        provider = candidate.parent / PROVIDER
        assert hashlib.sha256(provider.read_bytes()).hexdigest() == PROVIDER_SHA, 'Provider checksum mismatch'
        assert 'AArch64' in readelf(provider, '-h'), 'Wrong provider architecture'
        provider_loads = [line.split() for line in readelf(provider, '-lW').splitlines() if line.strip().startswith('LOAD ')]
        assert provider_loads and all(int(line[-1], 16) >= 16384 for line in provider_loads), 'Provider lacks 16 KB ELF alignment'
        system = {'libc.so', 'libm.so', 'libdl.so', 'liblog.so', 'libandroid.so'}
        assert not needed(provider) - system, 'Unreviewed provider dependencies'
        unexpected = needed(candidate) - needed(original) - packaged - {PROVIDER}
        assert not unexpected, 'Unreviewed native dependencies: ' + repr(sorted(unexpected))
        loads = [line.split() for line in readelf(candidate, '-lW').splitlines() if line.strip().startswith('LOAD ')]
        assert loads and all(int(line[-1], 16) >= 16384 for line in loads), 'Candidate lacks 16 KB ELF alignment'
        assert any(n.endswith('THIRD_PARTY_NOTICE.txt') for n in aar.namelist()), 'Stock native notices missing'
        return dict(candidateSha256=hashlib.sha256(candidate.read_bytes()).hexdigest(),
                    stockAarSha256=STOCK_SHA, stockJniExports=len(before),
                    preservedJniExports=len(before & after), needed=sorted(needed(candidate)),
                    providerSha256=PROVIDER_SHA, providerNeeded=sorted(needed(provider)),
                    architecture='arm64-v8a', gpuPriorityRequest=1, deviceVerified=False)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: verify-candidate.py stock.aar candidate.so')
    print(json.dumps(verify(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])), indent=2))
