const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Restricted Android media permissions that Bounty must NOT request.
 *
 * Bounty only needs occasional, user-initiated media selection (profile images,
 * bounty attachments, proof images) handled through the Android system photo
 * picker via `expo-image-picker`. It never browses or manages the full device
 * library, so the broad photo/video permissions below are disallowed by Google
 * Play policy and are stripped from the generated manifest during prebuild.
 *
 * This plugin is defensive: it removes the permissions even if a transitive
 * dependency re-introduces them.
 */
const RESTRICTED_MEDIA_PERMISSIONS = [
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.ACCESS_MEDIA_LOCATION',
];

/**
 * @type {import('@expo/config-plugins').ConfigPlugin}
 */
const withRemoveMediaPermissions = (config) => {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    if (Array.isArray(manifest['uses-permission'])) {
      manifest['uses-permission'] = manifest['uses-permission'].filter(
        (perm) => !RESTRICTED_MEDIA_PERMISSIONS.includes(perm?.$?.['android:name'])
      );
    }

    // Some libraries emit removed-permission markers under uses-permission-sdk-23.
    if (Array.isArray(manifest['uses-permission-sdk-23'])) {
      manifest['uses-permission-sdk-23'] = manifest['uses-permission-sdk-23'].filter(
        (perm) => !RESTRICTED_MEDIA_PERMISSIONS.includes(perm?.$?.['android:name'])
      );
    }

    return cfg;
  });
};

module.exports = withRemoveMediaPermissions;
module.exports.RESTRICTED_MEDIA_PERMISSIONS = RESTRICTED_MEDIA_PERMISSIONS;
