/**
 * Standardized RefreshControl props
 *
 * Use this helper so all pull-to-refresh implementations share the same
 * tint colours and background, consistent with the emerald brand palette.
 *
 * Usage:
 *   <ScrollView
 *     refreshControl={standardRefreshControl(refreshing, onRefresh)}
 *   />
 */

import React from 'react';
import { RefreshControl } from 'react-native';
import { colors } from '../theme';

/**
 * Returns a <RefreshControl> element configured with the app's brand colours.
 *
 * @param refreshing - Whether a refresh is currently in progress.
 * @param onRefresh  - Callback invoked when the user pulls to refresh.
 */
export function standardRefreshControl(
  refreshing: boolean,
  onRefresh: () => void
): React.ReactElement {
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.primary[500]}
      colors={[colors.primary[500]]}
      progressBackgroundColor={colors.background.surface}
    />
  );
}
