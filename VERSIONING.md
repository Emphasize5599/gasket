# Versioning

Gasket is in **alpha**. It will be published to app stores only once there is a **beta release candidate**.

## Alpha scheme (now)

- `versionCode` is a plain counter. It only ever goes up by 1 per build that leaves the developer's machine.
- `versionName` is always `0.0.<versionCode>`.

| versionCode | versionName |
|---|---|
| 46 | 0.0.46 |
| 47 | 0.0.47 |
| 48 | 0.0.48 |

To bump: in `AndroidManifest.xml` add 1 to `android:versionCode` and set `android:versionName` to `0.0.<new code>`, then add a `CHANGELOG.md` entry with the same number.

Never reset or reuse a versionCode (Android refuses to install a lower code over a higher one).

## Releasing a version

1. Bump the version and add its `CHANGELOG.md` entry, then commit as `chore(release): 0.0.<code>`.
2. Push to `main`.
3. Tag that commit `v0.0.<code>` and push the tag. `.github/workflows/release.yml` then creates the GitHub Release: the notes are the version's CHANGELOG entry, it's marked pre-release while Gasket is in alpha, and the only downloads are GitHub's source code archives. APKs are never uploaded; they're built with `./build.sh` and shared directly.

## History

0.0.47 is the last Fuel+ Map build (`com.ben.gasmap`, old key): a migration build that adds Full backup / Restore. Gasket (`com.bensanzone.fuelmap`) starts at 0.0.48.

Builds before the switch were named `2.0`–`3.25` (versionCodes 11–46). They are renumbered in `CHANGELOG.md` as `0.0.11`–`0.0.46`, with the old name in brackets. versionCodes 1–10 existed but their names and source were not kept.

## Beta (later)

At the first beta release candidate the name moves to a scheme like `0.1.0-rc1`. That is not set up yet. versionCode keeps counting up from wherever alpha left it.
