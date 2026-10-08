# Signing

Gasket's release key lives on the owner's PC, never in this repository. Claude's cloud sessions get it through their environment settings, so they can build signed APKs by themselves.

| What | Where |
|---|---|
| Keystore | `D:\Personal\Working\Gasket\gasket-release.jks` (PKCS12, RSA 4096, alias `gasket`, `CN=Gasket`) |
| Password | The owner's password manager, plus `gasket-release.password.dpapi` next to the keystore (encrypted for the owner's Windows account) |
| Cloud sessions | Environment variables `KS_PASS` (the password) and `GASKET_KEYSTORE_B64` (the keystore, base64) in the cloud environment's settings |

## Making the key (once)

On the PC, run:

```
powershell -ExecutionPolicy Bypass -File tools\new-signing-key.ps1
```

The script:
- finds Java's `keytool`, or downloads a portable Java to a temp folder and deletes it afterwards;
- creates the key with a random password that is never shown;
- saves the encrypted password backup;
- puts the password, then the keystore, on the clipboard for you to paste into the environment settings, and clears the clipboard at the end;
- prints the certificate's SHA-1 for the Google API key restriction.

It refuses to overwrite an existing keystore. `tools\show-signing-password.ps1` copies the password back to the clipboard from the backup.

Back up the keystore and the password together. Without them, no update can ever be installed over a build signed with this key.

## Building

- **Cloud sessions:** `./build.sh`. It reads `KS_PASS` and decodes `GASKET_KEYSTORE_B64` into a private temp file that's deleted when the build ends. New variables only reach sessions started after they were saved.
- **Elsewhere:** `KS_PASS=… KEYSTORE=/path/to/gasket-release.jks ./build.sh`.

`build.sh` stops if the password or the keystore is missing. It never makes a key, because a new key would change the app's signing identity.

## Rules

- Never print, log or commit `KS_PASS` or `GASKET_KEYSTORE_B64`, and don't run `env` or `printenv` without a filter.
- The keystore never goes in the repo. `.gitignore` blocks `*.jks`, `*.keystore`, `*.p12` and `*.dpapi`.
- Google API key restriction: package `com.bensanzone.fuelmap` plus this key's SHA-1, which `build.sh` prints after signing.
