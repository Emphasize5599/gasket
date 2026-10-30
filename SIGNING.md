# Signing

Gasket's release key lives on the owner's PC, never in this repository. Claude's cloud sessions get it through their environment settings, so they can build signed APKs by themselves.

| What | Where |
|---|---|
| Keystore | `%USERPROFILE%\AppData\Local\GasketBuild\signing\gasket-release.jks` (PKCS12, RSA 4096, alias `gasket`, `CN=Gasket`) |
| Password | The owner's password manager, plus `gasket-release.password.dpapi` next to the keystore (encrypted for the owner's Windows account) |
| Cloud sessions | Environment variables `KS_PASS` (the password) and `GASKET_KEYSTORE_B64` (the keystore, base64) in the cloud environment's settings |

## Local Windows builds

The local setup is installed and verified on the owner's PC. Run from the repository:

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-local.ps1
```

This builds ARM64 and universal release APKs, signs with the registered original key, verifies their certificate/package/version, and copies them to Desktop. Use `-OutputDir C:\path\to\output` to choose another folder. Existing Desktop APKs are preserved with timestamped filenames. These are local release builds, not Android debug-key builds; they can update the published app.

For a new Windows machine, install the pinned, checksum-verified Java 21, Gradle 8.13 and Android SDK 35 toolchain after reviewing the SDK agreement:

```powershell
powershell -ExecutionPolicy Bypass -File tools\setup-local-android.ps1 -AcceptSdkLicense
powershell -ExecutionPolicy Bypass -File tools\register-local-signing.ps1 -KeystoreBase64File C:\private\keystore.txt -PasswordFile C:\private\password.txt
powershell -ExecutionPolicy Bypass -File tools\build-local.ps1
```

Registration also accepts `-KeystoreFile` for an existing `.jks` and `-PasswordDpapiFile` for a Windows encrypted password. It verifies the key against a published signed APK (optional `-ReferenceApk`) and never creates a key. Credential file contents are not printed. The password is retained using Windows DPAPI for this Windows account; original input files are untouched. DPAPI files cannot be moved to a different Windows account as a substitute for a portable password backup.

Toolchain, dependency caches and signing files live outside the repository in `%USERPROFILE%\AppData\Local\GasketBuild`. All three commands accept `-ToolchainRoot` when a custom location is needed. Setup is repeatable and skips installed components. The first build downloads dependencies; later builds reuse them. Java networking prefers IPv4 to avoid the routing failures observed on this PC.

Back up the original keystore and password securely. Do not generate a replacement for normal updates: a new key changes the app's signing identity. `tools\new-signing-key.ps1` is only for a deliberately new app identity.

## Building

- **Shared GitHub build (Codex or Claude):** Add repository **Settings → Secrets and variables → Actions → New repository secret** entries named `KS_PASS` (the existing release key's password) and `GASKET_KEYSTORE_B64` (the existing keystore as base64). `.github/workflows/build-apk.yml` runs tests on pushes affecting app/build files on `main`; it can also run manually. With both secrets set, it signs with the existing key, verifies the APK, and publishes the direct APK asset on the corresponding version's GitHub Release. Actions ZIP artifacts remain available for diagnostics. Existing published APKs are not replaced. Secrets are never printed or committed; no new key is generated. If secrets are absent, tests run and signing is reported as unconfigured.
- **Cloud sessions:** `./build.sh`. It reads `KS_PASS` and decodes `GASKET_KEYSTORE_B64` into a private temp file that's deleted when the build ends. New variables only reach sessions started after they were saved.
- **Elsewhere:** `KS_PASS=… KEYSTORE=/path/to/gasket-release.jks ./build.sh`.

`build.sh` stops if the password or the keystore is missing. It never makes a key, because a new key would change the app's signing identity.

## Rules

- Never print, log or commit `KS_PASS` or `GASKET_KEYSTORE_B64`, and don't run `env` or `printenv` without a filter.
- The keystore never goes in the repo. `.gitignore` blocks `*.jks`, `*.keystore`, `*.p12` and `*.dpapi`.
- Google API key restriction: package `com.bensanzone.fuelmap` plus this key's SHA-1, which `build.sh` prints after signing.
