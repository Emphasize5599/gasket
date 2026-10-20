"""Test byte-for-byte AAR preservation and fail-closed binary pins."""
import contextlib
import hashlib
import importlib.util
import io
import pathlib
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('package_aar', pathlib.Path(__file__).resolve().parents[1] / 'tools/runtime/package-aar.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='gasket-aar-test-')
        self.addCleanup(self.temp.cleanup)
        root = pathlib.Path(self.temp.name)
        self.stock, self.native, self.out = root / 'stock.aar', root / 'native.so', root / 'patched.aar'
        with zipfile.ZipFile(self.stock, 'w') as z:
            for name, data in {module.ENTRY: b'original arm64', 'jni/x86_64/liblitertlm_jni.so': b'original x86', 'jni/arm64-v8a/libProvider.so': b'provider', 'classes.jar': b'classes', 'THIRD_PARTY_NOTICE.txt': b'original notices'}.items():
                z.writestr(name, data)
        self.native.write_bytes(b'patched fixture')
        provider = root / module.PROVIDER
        provider.write_bytes(b'provider fixture')
        for key, file in [('STOCK_SHA', self.stock), ('NATIVE_SHA', self.native), ('PROVIDER_SHA', provider)]:
            self.addCleanup(setattr, module, key, getattr(module, key))
            setattr(module, key, hashlib.sha256(file.read_bytes()).hexdigest())

    def package(self):
        with contextlib.redirect_stdout(io.StringIO()):
            module.package(self.stock, self.native, self.out)

    def test_preservation(self):
        self.package()
        with zipfile.ZipFile(self.stock) as a, zipfile.ZipFile(self.out) as b:
            self.assertEqual(set(b.namelist()) - set(a.namelist()), {'GASKET_PATCH_NOTICE.txt', 'jni/arm64-v8a/' + module.PROVIDER})
            for name in a.namelist():
                self.assertEqual(b.read(name), self.native.read_bytes() if name == module.ENTRY else a.read(name))
            self.assertIn(b'Modified by Gasket', b.read('GASKET_PATCH_NOTICE.txt'))

    def test_stock_mismatch(self):
        module.STOCK_SHA = 'bad pin'
        self.assertRaisesRegex(AssertionError, 'Stock AAR', self.package)
        self.assertFalse(self.out.exists())

    def test_native_mismatch(self):
        self.native.write_bytes(b'not verified')
        self.assertRaisesRegex(AssertionError, 'Native candidate', self.package)
        self.assertFalse(self.out.exists())


if __name__ == '__main__':
    unittest.main()
