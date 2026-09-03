/**
 * fingerprint.config.js
 *
 * Configures @expo/fingerprint, which computes `runtimeVersion` for this app
 * (app.json -> expo.runtimeVersion.policy = "fingerprint"). The fingerprint is
 * the compatibility contract between a published OTA update and an installed
 * native binary: an update only reaches a build whose fingerprint it matches
 * exactly. See docs/deployment/EAS_UPDATE_POLICY.md.
 *
 * This file is read both locally (scripts/eas-update-guardrails.js ->
 * `eas fingerprint:generate`) and by EAS Build when it records a build's
 * fingerprint, so the two sides stay in agreement. It MUST be committed before
 * the native build it is meant to apply to — a build made without it records a
 * fingerprint computed under the old rules.
 *
 * Why source skips at all: by default the fingerprint includes inputs that
 * cannot affect whether a JS bundle runs on a given binary. Every one of them
 * invalidates OTA for all builds already in the field, which is how you end up
 * with a production app that can never be hot-fixed:
 *
 *   - ExpoConfigVersions: `expo.version` / `ios.buildNumber` /
 *     `android.versionCode`. iOS builds 2.0.5(86) and 2.0.6(87) were the same
 *     commit and differed ONLY by the marketing version string, and that alone
 *     produced a different runtimeVersion. Since every release bumps the
 *     version, without this skip a fresh build is required before any OTA can
 *     ever ship.
 *
 *   - PackageJsonScriptsAll: the whole `scripts` block of package.json is
 *     hashed byte-for-byte. Adding an unrelated npm script (this happened with
 *     "verify:bundle-bytecode") breaks OTA compatibility with every shipped
 *     build. Native-relevant packaging behaviour is still covered: the
 *     `patches/` directory is fingerprinted separately under the patchPackage
 *     source, so changes to what postinstall actually applies are still caught.
 *     Note the residual gap — removing the `postinstall` hook entirely would
 *     no longer change the fingerprint.
 *
 *   - GitIgnore: `.gitignore` is hashed so bare (non-CNG) projects can resolve
 *     which native files are generated. This app has no committed ios/ or
 *     android/ directory, so .gitignore has no bearing on the native binary.
 *
 * Everything that genuinely determines native compatibility — dependencies,
 * config plugins, plugin inputs, patches, eas.json, the rest of the Expo
 * config — is still fingerprinted.
 */

const { SourceSkips } = require('@expo/fingerprint');

module.exports = {
  sourceSkips:
    SourceSkips.ExpoConfigVersions |
    SourceSkips.PackageJsonScriptsAll |
    SourceSkips.GitIgnore,
};
