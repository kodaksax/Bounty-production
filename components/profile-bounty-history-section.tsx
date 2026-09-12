import { MaterialIcons } from '@expo/vector-icons';
import { format, isValid, parseISO } from 'date-fns';
import { bountyService } from 'lib/services/bounty-service';
import type { Bounty } from 'lib/services/database.types';
import { ratingsService } from 'lib/services/ratings';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useNormalizedProfile } from '../hooks/useNormalizedProfile';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { isBountyDeadlinePassed } from '../lib/utils/schedule-utils';
import { BountyCompactItem } from './bounty-compact-item';
import { BountyDetailModal } from './bountydetailmodal';
import { PortfolioGrid, useProfilePortfolio } from './profile-portfolio-grid';

const VISIBLE_LIMIT = 5;
// The underlying query orders by created_at, so pull a wider window than we
// show and re-sort by completion date — otherwise an older bounty finished
// yesterday loses its slot to a newer one finished last month.
const FETCH_LIMIT = VISIBLE_LIMIT * 4;
// Reviews are fetched per user, not per bounty, then matched by bounty id.
const REVIEW_FETCH_LIMIT = 50;
// A bounty another user can still apply to. 'open' is the only status that
// qualifies: in_progress already has a hunter, and the rest are finished or
// withdrawn.
const OPEN_STATUSES = ['open'];
// Completed work reads as a portfolio, so it renders as a three-up grid the way
// a profile grid does. Three columns and their gaps are carved out of the page
// width rather than hard-coded, so tiles scale with the device.
const GRID_COLUMNS = 3;
const GRID_GAP = 8;
const PAGE_H_PADDING = 16;

/**
 * Edge of one square in a profile grid. Three columns and their gaps come out
 * of the page's content width, so the tiles fit exactly rather than wrapping to
 * two-per-row on narrow devices — and the portfolio tab lines up with the
 * bounty tabs column for column.
 */
function tileWidthFor(windowWidth: number) {
  return (windowWidth - PAGE_H_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
}

// Card height floor, as a proportion of the live window rather than a pixel
// constant, so it scales with the device and re-lays out on rotation.
const CARD_MIN_HEIGHT_RATIO = 0.205;

// What a viewer may see of where the work happened.
//
// A hunter's completed history is a movement history: a list of places one named
// person physically went. `bounties.neighborhood` is the coarse label the public
// feed shows (components/bounty-feed.tsx), while `bounties.location` still holds
// a full street address on bounties created before the location redesign. Only
// the owner of the profile sees that fallback; to everyone else a legacy bounty
// reads as location-unknown rather than as an address.
//
// Note this is a display rule, not an access control: the bounties SELECT policy
// is `true` for any authenticated user, so the row itself is readable. What keeps
// the precise fields out of reach is the column allowlist the query uses
// (FEED_SAFE_BOUNTY_COLUMNS in lib/services/bounty-service.ts), which omits
// latitude/longitude/unit entirely.
function publicLocation(bounty: Bounty, isOwnProfile: boolean): string | null {
  if (bounty.neighborhood) return bounty.neighborhood;
  return isOwnProfile ? (bounty.location ?? null) : null;
}

// When the work was approved (lib/services/completion-service.ts:
// approveSubmission stamps completed_at). Older rows finished before that column
// existed fall back to the post date so the line is never blank.
function completionDate(bounty: Bounty): Date | null {
  const raw = bounty.completed_at || bounty.created_at;
  if (!raw) return null;
  const parsed = parseISO(String(raw));
  return isValid(parsed) ? parsed : null;
}

// When the listing went up.
function postedDate(bounty: Bounty): Date | null {
  if (!bounty.created_at) return null;
  const parsed = parseISO(String(bounty.created_at));
  return isValid(parsed) ? parsed : null;
}

interface ProfileBountyHistorySectionProps {
  userId?: string;
  isOwnProfile?: boolean;
}

// What one card says about its bounty, on top of the bounty's own fields.
interface CardCaption {
  dateLabel: string;
  credibility?: {
    score?: number | null;
    quote?: string | null;
    note?: string | null;
  };
}

/** Work this user completed as the hunter, with the reviews posters left for it. */
function useCompletedWork(userId?: string) {
  const [bounties, setBounties] = useState<Bounty[]>([]);
  // Posters who hired this user more than once — the strongest trust signal the
  // data supports today. Computed over the whole fetched window rather than the
  // rendered cards, so a repeat isn't missed for falling off the end.
  const [repeatClients, setRepeatClients] = useState<Set<string>>(() => new Set());
  // bountyId -> the poster's review of this user's work on it.
  const [reviews, setReviews] = useState<Map<string, { score: number; comment?: string }>>(
    () => new Map()
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      bountyService.getCompletedByHunterId(userId, { limit: FETCH_LIMIT }),
      // Reviews the posters left for this user. Public by policy, and the only
      // first-hand evidence on the card that the work was actually good.
      ratingsService.getByUserId(userId, { limit: REVIEW_FETCH_LIMIT }),
    ])
      .then(([result, ratings]) => {
        if (cancelled) return;
        setBounties(result.slice(0, VISIBLE_LIMIT));
        const counts = new Map<string, number>();
        result.forEach(b => {
          const posterId = b.poster_id || b.user_id;
          if (posterId) counts.set(posterId, (counts.get(posterId) ?? 0) + 1);
        });
        setRepeatClients(
          new Set(
            Array.from(counts.entries())
              .filter(([, count]) => count > 1)
              .map(([posterId]) => posterId)
          )
        );
        setReviews(
          new Map(
            ratings
              .filter(r => r.bountyId)
              .map(r => [String(r.bountyId), { score: r.score, comment: r.comment }])
          )
        );
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load completed work');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { bounties, repeatClients, reviews, loading, error };
}

/**
 * Bounties this user posted that someone could apply to right now: status
 * 'open', nobody accepted yet, deadline not passed — the same rule the hunter
 * feed applies in components/bounty-feed.tsx.
 */
function useOpenPostings(userId?: string) {
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    bountyService
      .getByUserId(userId, { statuses: OPEN_STATUSES, limit: FETCH_LIMIT })
      .then(result => {
        if (cancelled) return;
        setBounties(
          result.filter(b => !b.accepted_by && !isBountyDeadlinePassed(b)).slice(0, VISIBLE_LIMIT)
        );
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load open bounties');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { bounties, loading, error };
}

interface BountyTileProps {
  bounty: Bounty;
  isOwnProfile: boolean;
  dateLabel: string | null;
  score?: number | null;
  /** Standing label for the tile, e.g. 'Repeat client' or 'Open to apply'. */
  note?: string | null;
  styles: ReturnType<typeof makeStyles>;
}

/**
 * One square in a profile grid — completed work or an open posting. Deliberately not BountyCompactItem: at a
 * third of the screen the row template's avatar, meta line and price column
 * leave no room for the title, which is the only thing worth reading here.
 */
function BountyTile({ bounty, isOwnProfile, dateLabel, score, note, styles }: BountyTileProps) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <>
      <TouchableOpacity
        style={styles.tile}
        activeOpacity={0.8}
        onPress={() => setShowDetail(true)}
        accessibilityRole="button"
        accessibilityLabel={`${bounty.title}${dateLabel ? `, ${dateLabel}` : ''}${
          score != null ? `, rated ${score} out of 5` : ''
        }${note ? `, ${note}` : ''}`}
        accessibilityHint="Tap to view bounty details"
      >
        <Text style={styles.tileTitle} numberOfLines={3} ellipsizeMode="tail">
          {bounty.title}
        </Text>
        <View style={styles.tileFooter}>
          {note ? (
            <Text style={styles.tileNote} numberOfLines={1}>
              {note}
            </Text>
          ) : null}
          {dateLabel ? <Text style={styles.tileDate}>{dateLabel}</Text> : null}
          <View style={styles.tileMeta}>
            {score != null && (
              <View style={styles.tileScore}>
                <MaterialIcons name="star" size={10} color="#b45309" />
                <Text style={styles.tileScoreText}>{score.toFixed(1)}</Text>
              </View>
            )}
            {bounty.is_for_honor ? (
              <Text style={styles.tileHonor}>Honor</Text>
            ) : (
              <Text style={styles.tilePrice}>${bounty.amount}</Text>
            )}
          </View>
        </View>
      </TouchableOpacity>

      {showDetail && (
        <BountyDetailModal
          bounty={{
            id: bounty.id,
            username: bounty.username,
            title: bounty.title,
            price: bounty.amount,
            distance: bounty.distance ?? null,
            location: publicLocation(bounty, isOwnProfile) ?? undefined,
            user_id: bounty.poster_id || bounty.user_id,
            work_type: bounty.work_type,
            poster_avatar: bounty.poster_avatar ?? undefined,
            is_for_honor: bounty.is_for_honor,
          }}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  );
}

interface BountyPageProps {
  bounties: Bounty[];
  loading: boolean;
  error: string | null;
  errorText: string;
  emptyText: string;
  isOwnProfile: boolean;
  caption: (bounty: Bounty) => CardCaption;
  styles: ReturnType<typeof makeStyles>;
  onHeight: (height: number) => void;
  /** 'grid' is the three-up portfolio view; 'list' stacks full-width cards. */
  layout?: 'list' | 'grid';
}

/** One tab's worth of cards, stacked vertically the way a profile grid is. */
function BountyPage({
  bounties,
  loading,
  error,
  errorText,
  emptyText,
  isOwnProfile,
  caption,
  styles,
  onHeight,
  layout = 'list',
}: BountyPageProps) {
  const { theme } = useAppThemeContext();
  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => onHeight(e.nativeEvent.layout.height),
    [onHeight]
  );

  return (
    <View style={styles.page} onLayout={handleLayout}>
      {loading ? (
        <ActivityIndicator size="small" color={theme.primary} style={styles.loadingIndicator} />
      ) : error ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>{errorText}</Text>
        </View>
      ) : bounties.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      ) : layout === 'grid' ? (
        <View style={styles.grid}>
          {bounties.map(bounty => {
            const { dateLabel, credibility } = caption(bounty);
            return (
              <BountyTile
                key={String(bounty.id)}
                bounty={bounty}
                isOwnProfile={isOwnProfile}
                dateLabel={dateLabel}
                score={credibility?.score ?? null}
                note={credibility?.note ?? null}
                styles={styles}
              />
            );
          })}
        </View>
      ) : (
        bounties.map(bounty => {
          const { dateLabel, credibility } = caption(bounty);
          return (
            <BountyCompactItem
              key={String(bounty.id)}
              style={styles.card}
              dateLabel={dateLabel}
              id={bounty.id}
              title={bounty.title}
              username={bounty.username}
              price={bounty.amount}
              distance={bounty.distance ?? null}
              location={publicLocation(bounty, isOwnProfile)}
              isForHonor={bounty.is_for_honor}
              user_id={bounty.poster_id || bounty.user_id}
              work_type={bounty.work_type}
              poster_avatar={bounty.poster_avatar}
              credibility={credibility}
            />
          );
        })
      )}
    </View>
  );
}

/**
 * The profile's two shelves as swipeable tabs, the way Instagram separates posts
 * from tagged posts: tap a tab or swipe the pane sideways, and the indicator
 * follows. Cards inside a pane stack vertically — a horizontal carousel in here
 * would fight the pager for the same gesture.
 */
export function ProfileBountyTabs({
  userId,
  isOwnProfile = false,
}: ProfileBountyHistorySectionProps) {
  const { theme } = useAppThemeContext();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const styles = useMemo(
    () => makeStyles(theme, windowWidth, windowHeight * CARD_MIN_HEIGHT_RATIO),
    [theme, windowWidth, windowHeight]
  );
  const { profile } = useNormalizedProfile(userId);
  const name = profile?.username || (isOwnProfile ? 'You' : 'This user');
  const tileWidth = useMemo(() => tileWidthFor(windowWidth), [windowWidth]);

  const completed = useCompletedWork(userId);
  const open = useOpenPostings(userId);
  // Undefined for one's own profile so the normalized profile resolves the id
  // the portfolio store is keyed by — the same resolution the portfolio used
  // when it sat on its own below the skillsets.
  const portfolio = useProfilePortfolio(isOwnProfile ? undefined : userId);

  const pagerRef = useRef<ScrollView>(null);
  const [activeTab, setActiveTab] = useState(0);
  // All three panes live side by side in one row, so the pager needs a height.
  // Track each pane's natural height and use the tallest: sizing to the active
  // pane would make the row jump mid-swipe, while a fixed height would clip.
  const [pageHeights, setPageHeights] = useState<number[]>(() => [0, 0, 0]);
  const pagerHeight = Math.max(...pageHeights) || undefined;

  const setHeight = useCallback((index: number, height: number) => {
    setPageHeights(prev => {
      if (prev[index] === height) return prev;
      const next = [...prev];
      next[index] = height;
      return next;
    });
  }, []);

  const goToTab = useCallback(
    (index: number) => {
      setActiveTab(index);
      pagerRef.current?.scrollTo({ x: index * windowWidth, animated: true });
    },
    [windowWidth]
  );

  const onPagerScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
      setActiveTab(index);
    },
    [windowWidth]
  );

  const tabs = [
    { key: 'completed', label: 'Completed', count: completed.bounties.length },
    { key: 'posted', label: 'Posted', count: open.bounties.length },
    { key: 'portfolio', label: 'Portfolio', count: portfolio.items.length },
  ];

  if (!userId) return null;

  return (
    <View style={styles.section}>
      <View style={styles.tabBar}>
        {tabs.map((tab, index) => {
          const active = index === activeTab;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => goToTab(index)}
              accessibilityRole="tab"
              accessibilityLabel={`${tab.label}, ${tab.count} ${
                tab.key === 'portfolio' ? 'items' : 'bounties'
              }`}
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[styles.tabLabel, active && styles.tabLabelActive]}
                numberOfLines={1}
              >
                {tab.label} ({tab.count})
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onPagerScrollEnd}
        // No rubber-banding at either end: without these the grid can be
        // dragged off-centre and hangs there mid-gesture, which reads as the
        // row having been knocked out of place. Swiping between the three
        // tabs still works; only the overscroll past them is gone.
        bounces={false}
        overScrollMode="never"
        // flex-start, not the default stretch: a stretched pane would be forced
        // to the pager's height, and its onLayout would then report that height
        // back — the measurement could never grow past its first value.
        contentContainerStyle={styles.pagerContent}
        style={[styles.pager, pagerHeight ? { height: pagerHeight } : null]}
      >
        <BountyPage
          bounties={completed.bounties}
          loading={completed.loading}
          error={completed.error}
          errorText="Couldn't load completed work. Pull to refresh."
          emptyText={
            isOwnProfile
              ? 'Bounties you finish as a hunter will appear here.'
              : "Hasn't completed any bounties yet."
          }
          isOwnProfile={isOwnProfile}
          styles={styles}
          layout="grid"
          onHeight={h => setHeight(0, h)}
          caption={bounty => {
            const completedOn = completionDate(bounty);
            const review = completed.reviews.get(String(bounty.id));
            const posterId = bounty.poster_id || bounty.user_id;
            return {
              dateLabel: completedOn ? format(completedOn, 'MMM d, yyyy') : '',
              credibility: {
                score: review?.score ?? null,
                quote: review?.comment ?? null,
                note: posterId && completed.repeatClients.has(posterId) ? 'Repeat client' : null,
              },
            };
          }}
        />
        <BountyPage
          bounties={open.bounties}
          loading={open.loading}
          error={open.error}
          errorText="Couldn't load open bounties. Pull to refresh."
          emptyText={
            isOwnProfile
              ? 'Bounties you post will appear here while they are open.'
              : 'No open bounties right now.'
          }
          isOwnProfile={isOwnProfile}
          styles={styles}
          layout="grid"
          onHeight={h => setHeight(1, h)}
          caption={bounty => {
            const postedOn = postedDate(bounty);
            return {
              dateLabel: postedOn ? format(postedOn, 'MMM d, yyyy') : '',
              credibility: { note: 'Open to apply' },
            };
          }}
        />
        <View style={styles.page} onLayout={e => setHeight(2, e.nativeEvent.layout.height)}>
          <PortfolioGrid
            portfolio={portfolio}
            isOwnProfile={isOwnProfile}
            tileWidth={tileWidth}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: AppTheme, windowWidth: number, cardMinHeight: number) {
  const tileWidth = tileWidthFor(windowWidth);

  return StyleSheet.create({
    section: {
      marginBottom: 16,
    },
    tabBar: {
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
      marginBottom: 12,
    },
    tab: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      // Transparent underline on the inactive tab so switching tabs never
      // shifts the row by the indicator's height.
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tabActive: {
      borderBottomColor: theme.primary,
    },
    tabLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.textSecondary,
    },
    tabLabelActive: {
      color: theme.text,
    },
    pager: {
      flexGrow: 0,
      flexShrink: 0,
    },
    pagerContent: {
      alignItems: 'flex-start',
    },
    page: {
      width: windowWidth,
      paddingHorizontal: 16,
      gap: 10,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      // Left-to-right fill, like every profile grid: a trailing row of one or
      // two tiles stays in its columns rather than sliding to the middle, so
      // column positions are identical on every row.
      justifyContent: 'flex-start',
      gap: GRID_GAP,
    },
    tile: {
      width: tileWidth,
      minHeight: tileWidth,
      justifyContent: 'space-between',
      padding: 8,
      borderRadius: 10,
      backgroundColor: theme.isDark ? 'rgba(2,44,34,0.55)' : theme.surface,
      borderWidth: theme.isDark ? 0 : 1,
      borderColor: theme.border,
    },
    tileTitle: {
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 17,
      color: theme.text,
    },
    tileFooter: {
      marginTop: 6,
      gap: 3,
    },
    tileDate: {
      fontSize: 10,
      color: theme.textSecondary,
    },
    tileNote: {
      fontSize: 10,
      fontWeight: '700',
      color: theme.primary,
    },
    tileMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 4,
    },
    tileScore: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    tileScoreText: {
      fontSize: 10,
      fontWeight: '700',
      color: theme.isDark ? '#fcd34d' : '#b45309',
    },
    tilePrice: {
      fontSize: 12,
      fontWeight: '800',
      color: theme.isDark ? '#fcd34d' : theme.primary,
    },
    tileHonor: {
      fontSize: 10,
      fontWeight: '800',
      color: theme.primary,
    },
    card: {
      minHeight: cardMinHeight,
      // The row is laid out for vertical lists; its own margin is replaced by
      // the page's gap so both panes space their cards identically.
      marginBottom: 0,
    },
    loadingIndicator: {
      marginVertical: 16,
    },
    emptyBox: {
      padding: 16,
      borderRadius: 12,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
    },
    emptyText: {
      fontSize: 13,
      color: theme.textSecondary,
      textAlign: 'center',
    },
  });
}
