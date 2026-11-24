/**
 * Focus-first blocks about people and pictures: ProofPhotos (`photos`),
 * PeopleStrip (`peoplestrip`) and ApplicantProfile (`applicant`).
 *
 * ApplicantProfile only states facts the app actually has. The screen
 * decides which facts exist (an ID badge only when verified, a rating only
 * from MIN_RATING_SAMPLE ratings up); this component never invents one.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import * as React from 'react';
import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { IconName } from '../../lib/my-jobs/types';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { FOCUS, type PosterPalette } from '../../lib/themes/poster-palette';
import { SectionLabel } from './blocks';

function usePosterStyles() {
  const { theme } = useAppThemeContext();
  const p = theme.poster;
  const s = useMemo(() => makeStyles(p), [p]);
  return { p, s };
}

// ── ProofPhotos ──────────────────────────────────────────────────────────
export interface ProofPhoto {
  key: string;
  uri?: string | null;
  /** Spoken, and shown when there is no image. */
  label: string;
  icon?: IconName;
  onPress?: () => void;
}

export function ProofPhotos({
  items,
  cols = 3,
  height = 104,
  label,
  addTile,
  testID = 'proof-photos',
}: {
  items: ProofPhoto[];
  cols?: number;
  height?: number;
  label?: string;
  /** "Add photo" tile at the end of the grid (H.8). */
  addTile?: { label: string; onPress: () => void; disabled?: boolean } | null;
  testID?: string;
}) {
  const { p, s } = usePosterStyles();
  const width = `${Math.floor(100 / cols) - 3}%` as const;
  const tiles = [...items];
  return (
    <View style={s.photosWrap} testID={testID}>
      {label ? <Text style={s.photosLabel}>{label}</Text> : null}
      <View style={s.grid}>
        {tiles.map((photo) => (
          <TouchableOpacity
            key={photo.key}
            onPress={photo.onPress}
            disabled={!photo.onPress}
            style={[s.tile, { height, width }]}
            accessibilityRole={photo.onPress ? 'imagebutton' : 'image'}
            accessibilityLabel={photo.label}
          >
            {photo.uri ? (
              <ExpoImage source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <>
                <MaterialIcons name={photo.icon ?? 'photo'} size={30} color={p.photoInk} />
                <Text style={s.tileText} numberOfLines={2}>
                  {photo.label}
                </Text>
              </>
            )}
          </TouchableOpacity>
        ))}
        {addTile ? (
          <TouchableOpacity
            onPress={addTile.onPress}
            disabled={addTile.disabled}
            style={[s.tile, { height, width }, addTile.disabled && { opacity: 0.5 }]}
            accessibilityRole="button"
            accessibilityLabel={addTile.label}
            accessibilityState={{ disabled: !!addTile.disabled }}
            testID="add-photo-tile"
          >
            <MaterialIcons name="add-a-photo" size={30} color={p.photoInk} />
            <Text style={s.tileText}>{addTile.label}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

// ── Avatar ───────────────────────────────────────────────────────────────
function PersonAvatar({ uri, initials, size, ring }: { uri?: string | null; initials: string; size: number; ring: number }) {
  const { p } = usePosterStyles();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: p.photo,
        borderWidth: ring,
        borderColor: p.g,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {uri ? (
        <ExpoImage source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <Text style={{ color: p.ink, fontSize: Math.round(size * 0.34), fontWeight: '800' }}>{initials}</Text>
      )}
    </View>
  );
}

/** "Ada R." → "AR", "maya" → "M". */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

// ── PeopleStrip ──────────────────────────────────────────────────────────
export interface StripPerson {
  key: string;
  name: string;
  avatarUri?: string | null;
}

export function PeopleStrip({
  label,
  people,
  selectedKey,
  onSelect,
  labelOnly = false,
}: {
  label: string;
  people: StripPerson[];
  selectedKey?: string | null;
  onSelect?: (person: StripPerson) => void;
  /** Just the label: with one person already shown below, there is nobody to pick. */
  labelOnly?: boolean;
}) {
  const { p, s } = usePosterStyles();
  return (
    <View style={s.strip} testID="people-strip">
      <SectionLabel>{label}</SectionLabel>
      {labelOnly ? null : (
        <View style={s.stripGrid}>
          {people.map((person) => {
            const on = person.key === selectedKey;
            return (
              <TouchableOpacity
                key={person.key}
                onPress={onSelect ? () => onSelect(person) : undefined}
                disabled={!onSelect}
                style={[s.stripCell, { backgroundColor: on ? p.card : 'transparent', borderColor: on ? p.g : p.line }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={on ? `${person.name}, showing` : `See ${person.name}`}
                testID={`person-${person.key}`}
              >
                <PersonAvatar uri={person.avatarUri} initials={initialsOf(person.name)} size={42} ring={2} />
                <Text style={[s.stripName, { fontWeight: on ? '800' : '600' }]} numberOfLines={1}>
                  {person.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ── ApplicantProfile ─────────────────────────────────────────────────────
export interface ApplicantFact {
  icon: IconName;
  text: string;
  /** A missing fact said honestly ("No reviews yet", "Distance not shown"). */
  muted?: boolean;
}

export function ApplicantProfile({
  name,
  avatarUri,
  since,
  note,
  facts,
}: {
  name: string;
  avatarUri?: string | null;
  since?: string | null;
  /** Their note, already quoted. */
  note?: string | null;
  facts: ApplicantFact[];
}) {
  const { p, s } = usePosterStyles();
  const first = name.split(/\s+/)[0] ?? name;
  return (
    <View style={s.applicant} testID="applicant-profile">
      <View style={s.applicantTop}>
        <PersonAvatar uri={avatarUri} initials={initialsOf(name)} size={78} ring={3} />
        <View style={s.applicantName}>
          <Text style={s.applicantNameText} accessibilityRole="header">
            {name}
          </Text>
          {since ? <Text style={s.applicantSince}>{since}</Text> : null}
        </View>
      </View>
      {note ? <Text style={s.applicantNote}>{note}</Text> : null}
      <View>
        <Text style={s.factsLabel}>{`WHAT WE KNOW ABOUT ${first.toUpperCase()}`}</Text>
        {facts.map((fact) => (
          <View key={fact.text} style={s.factRow} testID={`applicant-fact-${fact.icon}`}>
            <MaterialIcons name={fact.icon} size={22} color={fact.muted ? p.ink2 : p.gt} />
            <Text style={[s.factText, { color: fact.muted ? p.ink2 : p.ink }]}>{fact.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function makeStyles(p: PosterPalette) {
  return StyleSheet.create({
    photosWrap: { gap: 8 },
    photosLabel: { color: p.ink2, fontSize: 14, fontWeight: '700' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    tile: {
      borderRadius: 14,
      backgroundColor: p.photo,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      overflow: 'hidden',
      flexGrow: 1,
      paddingHorizontal: 4,
    },
    tileText: { color: p.ink, fontSize: 15, fontWeight: '600', textAlign: 'center' },
    strip: { gap: 8 },
    stripGrid: { flexDirection: 'row', gap: 8 },
    stripCell: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 92, borderRadius: 18, borderWidth: 2, paddingHorizontal: 4 },
    stripName: { color: p.ink, fontSize: 15 },
    applicant: { gap: 18 },
    applicantTop: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    applicantName: { flex: 1, gap: 4 },
    applicantNameText: { color: p.ink, fontSize: 27, fontWeight: '800', letterSpacing: -0.4 },
    applicantSince: { color: p.ink2, fontSize: 15 },
    applicantNote: { color: p.ink, fontSize: 20, lineHeight: 29, fontWeight: '600' },
    factsLabel: { color: p.gt, fontSize: FOCUS.label, fontWeight: '800', letterSpacing: FOCUS.labelTracking, paddingBottom: 6 },
    factRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: FOCUS.buttonText, borderTopWidth: 1, borderTopColor: p.line },
    factText: { flex: 1, fontSize: 17 },
  });
}
