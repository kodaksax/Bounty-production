import * as React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { saveMyZipLocation } from '../lib/services/bounty-location-service';
import { locationService } from '../lib/services/location-service';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { isValidUsZip } from '../lib/utils/geo';
import { AppModal } from './ui/app-modal';
import { Button } from './ui/button';

export interface ZipLocationModalProps {
  visible: boolean;
  userId: string;
  onCancel: () => void;
  /** The ZIP is saved. `geocoded` = its point was found and saved too. */
  onSaved: (result: { geocoded: boolean }) => void;
}

/**
 * Asked before a hunter with no saved location applies to in-person work
 * (SBA-02). The poster sees "About N mi away" on the application only when
 * the hunter's profile has a point, and the server measures it at apply time
 * (20261019200000), so the point has to be saved before the insert.
 *
 * Required, but never a trap: a valid ZIP always lets them continue. If the
 * device geocoder can't place it (offline, web), the ZIP is still saved and
 * the application goes through without a distance. Cancel backs out of
 * applying.
 */
export function ZipLocationModal({ visible, userId, onCancel, onSaved }: ZipLocationModalProps) {
  const { theme } = useAppThemeContext();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const [zip, setZip] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (visible) {
      setZip('');
      setError(null);
      setSaving(false);
    }
  }, [visible]);

  const handleSubmit = async () => {
    if (saving) return;
    const trimmed = zip.trim();
    if (!isValidUsZip(trimmed)) {
      setError('Enter a 5-digit ZIP code.');
      return;
    }
    setSaving(true);
    setError(null);
    let coords: { latitude: number; longitude: number } | null = null;
    try {
      coords = await locationService.geocodeAddress(`${trimmed}, USA`);
    } catch {
      coords = null;
    }
    const ok = await saveMyZipLocation({ userId, zip: trimmed, coords });
    setSaving(false);
    if (!ok) {
      setError("Couldn't save your ZIP code. Check your connection and try again.");
      return;
    }
    onSaved({ geocoded: coords != null });
  };

  return (
    <AppModal visible={visible} onRequestClose={onCancel} variant="dialog" dismissable={!saving}>
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <MaterialIcons name="place" size={32} color={theme.primary} />
        </View>
        <Text style={styles.title}>{"What's your ZIP code?"}</Text>
        <Text style={styles.body}>
          This job is in person. Posters choose people nearby, so we show them roughly how far away you
          are. Only the distance is shown, never your ZIP.
        </Text>
        <TextInput
          value={zip}
          onChangeText={text => {
            setZip(text.replace(/\D/g, '').slice(0, 5));
            if (error) setError(null);
          }}
          placeholder="ZIP code"
          placeholderTextColor={theme.textDisabled}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={5}
          autoComplete="postal-code"
          textContentType="postalCode"
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
          editable={!saving}
          style={[styles.input, error ? styles.inputError : null]}
          accessibilityLabel="ZIP code"
          testID="zip-location-input"
        />
        {error ? (
          <Text style={styles.errorHint} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {error}
          </Text>
        ) : null}
        <Button
          variant="default"
          onPress={handleSubmit}
          disabled={saving}
          style={styles.primaryButton}
          accessibilityState={{ disabled: saving }}
          testID="zip-location-continue"
        >
          {saving ? <ActivityIndicator size="small" color="#fff" /> : 'Continue'}
        </Button>
        <Button variant="ghost" onPress={onCancel} disabled={saving} style={styles.cancelButton}>
          Cancel
        </Button>
      </View>
    </AppModal>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    card: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: theme.surface,
      borderRadius: 20,
      borderWidth: 1,
      ...theme.insetBorder, // pressed-in edge: dark top → light bottom
      paddingHorizontal: 24,
      paddingTop: 28,
      paddingBottom: 20,
      alignItems: 'center',
    },
    iconCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      borderWidth: 2,
      borderColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    body: {
      fontSize: 14,
      lineHeight: 20,
      color: theme.textSecondary,
      textAlign: 'center',
      marginBottom: 16,
    },
    input: {
      width: '100%',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: 18,
      letterSpacing: 2,
      textAlign: 'center',
      color: theme.text,
      backgroundColor: theme.surfaceSecondary,
    },
    inputError: {
      borderColor: theme.error,
    },
    errorHint: {
      alignSelf: 'stretch',
      fontSize: 12,
      color: theme.error,
      marginTop: 6,
      textAlign: 'center',
    },
    primaryButton: { width: '100%', marginTop: 16, marginBottom: 10 },
    cancelButton: { width: '100%' },
  });
}
