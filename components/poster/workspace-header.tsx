/**
 * WorkspaceHeader — the header every job workspace shares, poster or hunter
 * (handoff block `whead`): back, Help, the job's photo or category icon, its
 * title and one line of context, the side label when the account works both
 * sides, the five-step bar, and "Step N of 5 · …" in words.
 *
 * SidePill is the side label itself ("You posted this", "You offered",
 * "You're doing this", "You did this"): words first, then icon and colour,
 * never colour alone.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import * as React from 'react';
import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { IconName } from '../../lib/my-jobs/types';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { FOCUS, type PosterPalette } from '../../lib/themes/poster-palette';

import { SidePill, type WorkspaceSide } from './side-label';

export { SIDE_LABELS, SidePill, sideColors, type WorkspaceSide } from './side-label';

/** "Step 2 of 5 · Choosing someone", spoken even when the stage line doesn't start with it. */
export function describeStep(step: number, stage: string): string {
  const clamped = Math.min(5, Math.max(1, Math.round(step)));
  return /^Step \d of 5/.test(stage) ? stage : `Step ${clamped} of 5 · ${stage}`;
}

export interface WorkspaceHeaderProps {
  onBack: () => void;
  backLabel?: string;
  onHelp?: () => void;
  icon: IconName;
  coverUri?: string | null;
  title: string;
  meta?: string | null;
  side?: WorkspaceSide | null;
  /** 1–5. */
  step: number;
  /** "Step 2 of 5 · Choosing someone to help", "Paused · Bounty is reviewing". */
  stage: string;
}

export function WorkspaceHeader({
  onBack,
  backLabel = 'My Jobs',
  onHelp,
  icon,
  coverUri,
  title,
  meta,
  side,
  step,
  stage,
}: WorkspaceHeaderProps) {
  const { theme } = useAppThemeContext();
  const p = theme.poster;
  const s = useMemo(() => makeStyles(p), [p]);
  const current = Math.min(5, Math.max(1, Math.round(step)));

  return (
    <View style={s.wrap} testID="workspace-header">
      <View style={s.topRow}>
        <TouchableOpacity
          onPress={onBack}
          style={s.back}
          accessibilityRole="button"
          accessibilityLabel={`Back to ${backLabel}`}
          testID="workspace-back"
        >
          <MaterialIcons name="chevron-left" size={30} color={p.gt} />
          <Text style={s.backText}>{backLabel}</Text>
        </TouchableOpacity>
        {onHelp ? (
          <TouchableOpacity
            onPress={onHelp}
            style={s.help}
            accessibilityRole="button"
            accessibilityLabel="Help with this job"
            testID="workspace-help"
          >
            <MaterialIcons name="support-agent" size={20} color={p.gt} />
            <Text style={s.helpText}>Help</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={s.jobRow}>
        <View style={s.tile} accessible={false} importantForAccessibility="no-hide-descendants">
          {coverUri ? (
            <ExpoImage source={{ uri: coverUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <MaterialIcons name={icon} size={28} color={p.photoInk} />
          )}
        </View>
        <View style={s.jobText}>
          <Text style={s.title} accessibilityRole="header" numberOfLines={3}>
            {title}
          </Text>
          {meta ? <Text style={s.meta}>{meta}</Text> : null}
          {side ? (
            <View style={s.sideRow}>
              <SidePill side={side} />
            </View>
          ) : null}
        </View>
      </View>

      <View style={s.segments} accessible={false} importantForAccessibility="no-hide-descendants">
        {[1, 2, 3, 4, 5].map((i) => (
          <View
            key={i}
            style={[
              s.segment,
              { backgroundColor: i < current ? p.stepDone : i === current ? p.stepNow : p.stepTodo },
            ]}
          />
        ))}
      </View>
      <Text
        style={s.stage}
        accessibilityRole="progressbar"
        accessibilityLabel={describeStep(current, stage)}
        accessibilityValue={{ min: 1, max: 5, now: current }}
        testID="workspace-step"
      >
        {stage}
      </Text>
    </View>
  );
}

function makeStyles(p: PosterPalette) {
  return StyleSheet.create({
    wrap: { gap: 12 },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: FOCUS.buttonText,
      marginHorizontal: -8,
    },
    back: { flexDirection: 'row', alignItems: 'center', minHeight: FOCUS.buttonText, paddingRight: 8 },
    backText: { color: p.gt, fontSize: 17, fontWeight: '600' },
    help: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: FOCUS.buttonText,
      paddingHorizontal: 16,
      borderRadius: 999,
      borderWidth: 1.5,
      borderColor: p.outline,
      backgroundColor: p.card,
    },
    helpText: { color: p.ink, fontSize: 16, fontWeight: '700' },
    jobRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    tile: {
      width: FOCUS.jobIcon,
      height: FOCUS.jobIcon,
      borderRadius: 15,
      backgroundColor: p.photo,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    jobText: { flex: 1, minWidth: 0, gap: 2 },
    title: { color: p.ink, fontSize: FOCUS.jobTitle, fontWeight: '800', lineHeight: 23 },
    meta: { color: p.ink2, fontSize: FOCUS.meta },
    sideRow: { marginTop: 4, flexDirection: 'row' },
    segments: { flexDirection: 'row', gap: FOCUS.stepGap },
    segment: { flex: 1, height: FOCUS.stepHeight, borderRadius: 3 },
    stage: { color: p.ink2, fontSize: FOCUS.stage, fontWeight: '700' },
  });
}
