/**
 * The frame every Focus-first workspace shares: a scrolling body and one
 * next step pinned under the thumb.
 *
 *   WorkspaceLayout  safe area, page colour, pull-to-refresh, pinned footer
 *   PinnedFooter     the footer on its own (card colour, hairline on top)
 *   StageFooter      a stage view model's primary + up to two secondary
 *                    actions, bound to the screen's handlers
 */
import * as React from 'react';
import { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { IconName } from '../../lib/my-jobs/types';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { PosterPalette } from '../../lib/themes/poster-palette';
import type { StageAction } from '../../lib/utils/stage-copy-types';
import { PosterButton } from './poster-button';

export function PinnedFooter({ children, testID = 'pinned-footer' }: { children: React.ReactNode; testID?: string }) {
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(theme.poster), [theme.poster]);
  return (
    <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]} testID={testID}>
      {children}
    </View>
  );
}

export function StageFooter<K extends string>({
  primary,
  secondary,
  onAction,
  busyKey,
  disabledKeys,
}: {
  primary: StageAction<K> | null;
  secondary: StageAction<K>[];
  onAction: (key: K) => void;
  busyKey?: K | null;
  disabledKeys?: readonly K[];
}) {
  if (!primary && secondary.length === 0) return null;
  const render = (action: StageAction<K>) => (
    <PosterButton
      key={action.key}
      kind={action.kind}
      label={action.label}
      icon={action.icon as IconName | undefined}
      loading={busyKey === action.key}
      disabled={!!disabledKeys?.includes(action.key) || (!!busyKey && busyKey !== action.key)}
      onPress={() => onAction(action.key)}
      testID={`stage-action-${action.key}`}
    />
  );
  return (
    <PinnedFooter>
      {primary ? render(primary) : null}
      {secondary.slice(0, 2).map(render)}
    </PinnedFooter>
  );
}

export function WorkspaceLayout({
  children,
  footer,
  refreshing,
  onRefresh,
  background = 'page',
  testID,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** 'card' for full-screen steps drawn on a card (E, H.8). */
  background?: 'page' | 'card';
  testID?: string;
}) {
  const { theme } = useAppThemeContext();
  const p = theme.poster;
  const s = useMemo(() => makeStyles(p), [p]);
  const bg = background === 'card' ? p.card : p.bg;
  return (
    <SafeAreaView style={[s.root, { backgroundColor: bg }]} edges={['top']} testID={testID}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={p.ink} colors={[p.g]} />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
      {footer}
    </SafeAreaView>
  );
}

function makeStyles(p: PosterPalette) {
  return StyleSheet.create({
    root: { flex: 1 },
    scroll: { flex: 1 },
    content: { paddingTop: 4, paddingHorizontal: 20, paddingBottom: 24, gap: 16 },
    footer: {
      backgroundColor: p.card,
      borderTopWidth: 1,
      borderTopColor: p.line,
      paddingTop: 12,
      paddingHorizontal: 20,
      gap: 10,
    },
  });
}
