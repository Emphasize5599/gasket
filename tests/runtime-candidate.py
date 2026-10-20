"""Fast negative packaging checks; real binaries are checked by the native build."""
import hashlib
import importlib.util
import pathlib
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('candidate', pathlib.Path(__file__).resolve().parents[1] / 'tools/runtime/verify-candidate.py')
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)


class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='gasket-native-test-')
        self.addCleanup(self.temp.cleanup)
        root = pathlib.Path(self.temp.name)
        self.aar, self.so = root / 'stock.aar', root / 'candidate.so'
        with zipfile.ZipFile(self.aar, 'w') as z:
            z.writestr('jni/arm64-v8a/liblitertlm_jni.so', b'stock fixture')
            z.writestr('THIRD_PARTY_NOTICE.txt', 'notice fixture')
        self.so.write_bytes(b'gasket_gpu_low_priority_v1')
        provider = root / candidate.PROVIDER
        provider.write_bytes(b'provider fixture')
        self.addCleanup(setattr, candidate, 'PROVIDER_SHA', candidate.PROVIDER_SHA)
        candidate.PROVIDER_SHA = hashlib.sha256(provider.read_bytes()).hexdigest()
        self.original_sha = candidate.STOCK_SHA
        candidate.STOCK_SHA = hashlib.sha256(self.aar.read_bytes()).hexdigest()
        self.addCleanup(setattr, candidate, 'STOCK_SHA', self.original_sha)
        self.headers = 'AArch64'
        self.exports = {'Java_example_load', candidate.IDENTITY}
        self.deps = {'libc.so'}
        self.align = '0x4000'
        def readelf(file, flag):
            stock = file.name == 'stock.so'
            if flag == '-h':
                return self.headers
            if flag == '--dyn-syms':
                return '\n'.join('1: 1 1 FUNC GLOBAL DEFAULT 1 ' + s for s in ({'Java_example_load@@VERS_1.0'} if stock else self.exports))
            if flag == '-d':
                return '\n'.join('(NEEDED) Shared library: [' + s + ']' for s in ({'libc.so'} if stock else self.deps))
            if flag == '-lW':
                return 'LOAD 0x0 0x0 0x0 0x1 0x1 R E ' + self.align
            raise AssertionError(flag)
        self.original_readelf = candidate.readelf
        candidate.readelf = readelf
        self.addCleanup(setattr, candidate, 'readelf', self.original_readelf)

    def verify(self):
        return candidate.verify(self.aar, self.so)

    def test_valid(self):
        self.assertEqual(self.verify()['preservedJniExports'], 1)
        self.assertFalse(self.verify()['deviceVerified'])

    def test_checksum(self):
        candidate.STOCK_SHA = 'invalid'
        self.assertRaisesRegex(AssertionError, 'checksum', self.verify)

    def test_missing_export(self):
        self.exports.remove('Java_example_load')
        self.assertRaisesRegex(AssertionError, 'Missing stock JNI', self.verify)

    def test_missing_identity(self):
        self.exports.remove(candidate.IDENTITY)
        self.assertRaisesRegex(AssertionError, 'identity', self.verify)

    def test_new_dependency(self):
        self.deps.add('libunreviewed.so')
        self.assertRaisesRegex(AssertionError, 'Unreviewed', self.verify)

    def test_alignment(self):
        self.align = '0x1000'
        self.assertRaisesRegex(AssertionError, 'alignment', self.verify)

    def test_architecture(self):
        self.headers = 'X86-64'
        self.assertRaisesRegex(AssertionError, 'architecture', self.verify)

    def test_marker(self):
        self.so.write_bytes(b'unpatched fixture')
        self.assertRaisesRegex(AssertionError, 'marker', self.verify)

    def test_provider_pin(self):
        candidate.PROVIDER_SHA = 'unreviewed provider'
        self.assertRaisesRegex(AssertionError, 'Provider checksum', self.verify)


if __name__ == '__main__':
    unittest.main()
