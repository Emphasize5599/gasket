# Corrected v3 research reference

Imported from the owner's `gasket-charge-fill-v3-bundle.zip` (2026-10-22). This compact archive retains the simulator, tests and four derived numerical fixtures; it does not bundle raw drive logs or install a Python runtime in Android. The production JavaScript port is `assets/web/propulsion.js`.

Corrections beyond v3: cooling shares the charging station's inlet budget; hourly ambient weather advances throughout a charging session; negative drive power is bounded by regenerative power and remaining battery capacity, and updates the energy/value ledger. Four additional regressions cover these corrections (36 tests total).

Run with Python 3.12 and the pinned requirements:

```
python -m pip install -r research/charge-fill-v3/requirements.txt
python -I research/charge-fill-v3/tests/run_tests.py build/propulsion-reference.json
```

The Python search remains a research benchmark, not the app's optimizer. Its results are not evidence of an exact global optimum or fleet-wide validity. Tests of this simulator alone do not prove JavaScript parity: the app has separate numerical, worker and UI tests.

The measured fixtures come from TUM's one-car Model 3 SR+ CATL LFP datasets, CC BY 4.0; attribution and modifications are in `THIRD_PARTY_NOTICES.md`. Generic fallback curve/thermal assumptions are explicitly estimates. See `docs/PROPULSION_MODELS.md` for production limits and sources.
