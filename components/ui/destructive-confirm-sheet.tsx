/**
 * DestructiveConfirmSheet — Standardized confirmation bottom-sheet for
 * irreversible actions (delete, cancel, archive, unfollow, etc.)
 *
 * Replaces the patchwork of `Alert.alert()` calls and ad-hoc modals
 * currently spread across screens.  Using a bottom-sheet (rather than
 * a centered dialog) keeps the pattern thumb-friendly on mobile and
 * consistent with the rest of the app.
 *
 * Usage:
 *   <DestructiveConfirmSheet
 *     visible={showDelete}
 *     title="Delete Bounty"
 *     description="This action cannot be undone. The bounty will be permanently removed."
 *     confirmLabel="Delete Bounty"
 *     onConfirm={handleDelete}
 *     onCancel={() => setShowDelete(false)}
 *   />
 */

import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SPACING, SIZING, TYPOGRAPHY, RADIUS } from '../../lib/constants/accessibility';
import { colors, shadows } from '../../lib/theme';

export interface DestructiveConfirmSheetProps {
  /** Controls visibility of the sheet */
  visible: boolean;
  /** Short title describing the destructive action (e.g. "Delete Bounty") */
  title: string;
  /** Human-readable description of the consequences */
  description: string;
  /** Label for the destructive confirm button (e.g. "Delete Bounty") */
  confirmLabel: string;
  /** Called when the user confirms the action */
  onConfirm: () => void;
  /** Called when the user cancels or dismisses the sheet */
  onCancel: () => void;
  /** When true, shows a loading spinner on the confirm button */
  isLoading?: boolean;
  /** Override confirm button color (defaults to colors.error) */
  confirmColor?: string;
}

export function DestructiveConfirmSheet({
  visible,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  isLoading = false,
  confirmColor = colors.error,
}: DestructiveConfirmSheetProps) {
  const insets = useSafeAreaInsets();

  const handleConfirm = useCallback(() => {
    if (!isLoading) onConfirm();
  }, [isLoading, onConfirm]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
      accessible={true}
      accessibilityViewIsModal={true}
    >
      {/* Scrim — tap outside to cancel */}
      <TouchableWithoutFeedback onPress={onCancel} accessibilityLabel="Cancel">
        <View style={styles.scrim} />
      </TouchableWithoutFeedback>

      {/* Sheet */}
      <View
        style={[
          styles.sheet,
          { paddingBottom: insets.bottom + SPACING.SCREEN_VERTICAL },
        ]}
        accessible={true}
        accessibilityRole="alertdialog"
        accessibilityLabel={title}
      >
        {/* Handle bar */}
        <View style={styles.handle} />

        {/* Title */}
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>

        {/* Description */}
        <Text style={styles.description}>{description}</Text>

        {/* Confirm button */}
        <TouchableOpacity
          style={[styles.confirmButton, { backgroundColor: confirmColor }]}
          onPress={handleConfirm}
          disabled={isLoading}
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
          accessibilityHint="This action cannot be undone"
          accessibilityState={{ disabled: isLoading }}
        >
          {isLoading ? (
            <ActivityIndicator color="#fffef5" size="small" />
          ) : (
            <Text style={styles.confirmButtonText}>{confirmLabel}</Text>
          )}
        </TouchableOpacity>

        {/* Cancel button */}
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={onCancel}
          disabled={isLoading}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          accessibilityHint="Dismiss without making changes"
          accessibilityState={{ disabled: isLoading }}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    backgroundColor: colors.background.elevated,
    borderTopLeftRadius: RADIUS.LARGE,
    borderTopRightRadius: RADIUS.LARGE,
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    paddingTop: SPACING.ELEMENT_GAP,
    ...shadows.xl,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: RADIUS.PILL,
    backgroundColor: 'rgba(255, 254, 245, 0.3)',
    marginBottom: SPACING.SECTION_GAP,
  },
  title: {
    fontSize: TYPOGRAPHY.SIZE_HEADER,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: SPACING.COMPACT_GAP,
    textAlign: 'center',
  },
  description: {
    fontSize: TYPOGRAPHY.SIZE_DEFAULT,
    color: colors.text.secondary,
    lineHeight: Math.round(TYPOGRAPHY.SIZE_DEFAULT * 1.5),
    textAlign: 'center',
    marginBottom: SPACING.SECTION_GAP,
  },
  confirmButton: {
    borderRadius: RADIUS.MEDIUM,
    minHeight: SIZING.BUTTON_HEIGHT_DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.COMPACT_GAP,
    ...shadows.md,
  },
  confirmButtonText: {
    fontSize: TYPOGRAPHY.SIZE_DEFAULT,
    fontWeight: '600',
    color: colors.text.primary,
  },
  cancelButton: {
    borderRadius: RADIUS.MEDIUM,
    minHeight: SIZING.BUTTON_HEIGHT_DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border.muted,
  },
  cancelButtonText: {
    fontSize: TYPOGRAPHY.SIZE_DEFAULT,
    fontWeight: '500',
    color: colors.text.secondary,
  },
});
