import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { analyticsService } from '../lib/services/analytics-service';
import { completionService } from '../lib/services/completion-service';
import { ratingsService } from '../lib/services/ratings';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import type { MyRatingStatus } from '../lib/types';
import { RatingStars } from './ui/rating-stars';

/**
 * Inline "rate the other side of this job" card. Used on the hunter's payout
 * screen, which is where the existing "Please rate the poster" notification
 * (completion / rating_prompt, sent on approval) now lands.
 *
 * Same pipeline as the poster's rating step in poster-review-modal.tsx --
 * completionService.submitRating into `ratings`, the same analytics events
 * with the rater's role. The server decides eligibility
 * (get_my_rating_status); the card renders nothing unless this user is a
 * party to a completed transaction they haven't rated yet. Always optional.
 */
export function RateCounterpartyCard({ bountyId }: { bountyId: string }) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [status, setStatus] = useState<MyRatingStatus | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [phase, setPhase] = useState<'loading' | 'form' | 'submitting' | 'done' | 'hidden'>('loading');
  const [error, setError] = useState<string | null>(null);
  const shownLoggedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    ratingsService.getMyRatingStatus(bountyId).then((s) => {
      if (!mounted) return;
      setStatus(s);
      setPhase(s && s.eligible && !s.alreadyRated ? 'form' : 'hidden');
    });
    return () => {
      mounted = false;
    };
  }, [bountyId]);

  useEffect(() => {
    if (phase === 'form' && status && !shownLoggedRef.current) {
      shownLoggedRef.current = true;
      void analyticsService
        .trackEvent('rating_prompt_shown', { bountyId: String(bountyId), role: status.raterRole })
        .catch(() => {});
    }
  }, [phase, status, bountyId]);

  if (!status || phase === 'loading' || phase === 'hidden') return null;

  const name = status.rateeName ? `@${status.rateeName}` : status.raterRole === 'hunter' ? 'the poster' : 'the hunter';

  if (phase === 'done') {
    return (
      <View style={styles.card} accessibilityLiveRegion="polite">
        <MaterialIcons name="check-circle" size={28} color="#008E2A" />
        <Text style={styles.title}>Thanks for rating {name}</Text>
        <Text style={styles.subtitle}>Your rating now shows on their profile.</Text>
      </View>
    );
  }

  const handleSubmit = async () => {
    if (rating === 0) return;
    const trimmed = comment.trim();
    setPhase('submitting');
    setError(null);
    try {
      await completionService.submitRating({
        bounty_id: bountyId,
        from_user_id: '',
        to_user_id: status.rateeId,
        rating,
        comment: trimmed || undefined,
      });
      void analyticsService
        .trackEvent('rating_submitted', {
          bountyId: String(bountyId),
          role: status.raterRole,
          rating,
          hasComment: trimmed.length > 0,
        })
        .catch(() => {});
      if (trimmed.length > 0) {
        void analyticsService
          .trackEvent('review_submitted', { bountyId: String(bountyId), role: status.raterRole })
          .catch(() => {});
      }
      setPhase('done');
    } catch {
      setError("Your rating couldn't be saved. Please try again.");
      setPhase('form');
    }
  };

  const handleSkip = () => {
    void analyticsService
      .trackEvent('rating_skipped', { bountyId: String(bountyId), role: status.raterRole })
      .catch(() => {});
    setPhase('hidden');
  };

  const submitting = phase === 'submitting';

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Rate {name}</Text>
      <Text style={styles.subtitle}>
        {status.raterRole === 'hunter'
          ? 'How was working with them? Your rating helps other hunters choose who to work for.'
          : 'How was their work? Your rating helps other posters choose who to hire.'}
      </Text>
      <RatingStars rating={rating} onRatingChange={setRating} size="large" />
      <TextInput
        style={styles.input}
        placeholder="Add an optional review (shown on their profile)"
        placeholderTextColor={theme.textDisabled}
        value={comment}
        onChangeText={setComment}
        multiline
        maxLength={500}
        textAlignVertical="top"
        editable={!submitting}
        accessibilityLabel="Optional written review"
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <TouchableOpacity
        style={[styles.primaryButton, (rating === 0 || submitting) && styles.disabled]}
        onPress={handleSubmit}
        disabled={rating === 0 || submitting}
        accessibilityRole="button"
        accessibilityState={{ disabled: rating === 0 || submitting }}
      >
        {submitting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.primaryButtonText}>Submit rating</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        onPress={handleSkip}
        disabled={submitting}
        style={styles.skipButton}
        accessibilityRole="button"
        accessibilityLabel="Skip rating for now"
      >
        <Text style={styles.skipText}>Not now</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      padding: 16,
      gap: 12,
      alignItems: 'center',
    },
    title: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '600',
      textAlign: 'center',
    },
    subtitle: {
      color: theme.textSecondary,
      fontSize: 14,
      textAlign: 'center',
      lineHeight: 20,
    },
    input: {
      width: '100%',
      minHeight: 88,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      padding: 12,
      color: theme.text,
      fontSize: 14,
    },
    error: {
      color: '#ef4444',
      fontSize: 13,
      textAlign: 'center',
    },
    primaryButton: {
      width: '100%',
      backgroundColor: '#008E2A',
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
    },
    primaryButtonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '600',
    },
    disabled: {
      opacity: 0.5,
    },
    skipButton: {
      paddingVertical: 6,
      paddingHorizontal: 12,
    },
    skipText: {
      color: theme.textSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
  });
}
