"""Runs the refsim unit tests and writes a machine-readable summary.
Usage: python3 -I tests/run_tests.py [out_json]   (default: out/test_results.json)"""
import os, sys, json, time, unittest, platform
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..')
sys.path.insert(0, ROOT); sys.path.insert(0, HERE)
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'out', 'test_results.json')
os.makedirs(os.path.dirname(out), exist_ok=True)
suite = unittest.defaultTestLoader.loadTestsFromName('test_refsim')
suite.addTests(unittest.defaultTestLoader.loadTestsFromName('test_integration_fixes'))
res = unittest.TestResult(); t0 = time.time(); suite.run(res)
import numpy, pandas
summary = dict(ran=res.testsRun, failures=[(str(t), m[-800:]) for t, m in res.failures], errors=[(str(t), m[-800:]) for t, m in res.errors],
               passed=res.testsRun - len(res.failures) - len(res.errors), ok=res.wasSuccessful(), seconds=round(time.time() - t0, 2),
               python=platform.python_version(), numpy=numpy.__version__, pandas=pandas.__version__)
json.dump(summary, open(out, 'w'), indent=1)
print(json.dumps({k: summary[k] for k in ('ran', 'passed', 'ok', 'seconds')}))
for t, m in summary['failures'] + summary['errors']: print('FAIL', t, '\n', m)
sys.exit(0 if res.wasSuccessful() else 1)
