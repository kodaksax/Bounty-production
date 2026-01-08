// app/postings/[bountyId]/review-and-verify.tsx - Review & Verify Screen
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AttachmentViewerModal } from '../../../components/attachment-viewer-modal';
import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/avatar';
import { useAuthContext } from '../../../hooks/use-auth-context';
import { ROUTES } from '../../../lib/routes';
import { bountyRequestService } from '../../../lib/services/bounty-request-service';
import { bountyService } from '../../../lib/services/bounty-service';
import { completionService } from '../../../lib/services/completion-service';
import type { Bounty, Profile } from '../../../lib/services/database.types';
import { profileService } from '../../../lib/services/profile-service';
import type { Attachment } from '../../../lib/types';
import { getCurrentUserId } from '../../../lib/utils/data-utils';

interface ProofItem {
  id: string;
  type: 'image' | 'file';
  name: string;
  uri?: string; // local uri
  remoteUri?: string; // uploaded remote url
  size?: number;
  mimeType?: string;
  mime?: string;
}

export default function ReviewAndVerifyScreen() {
  const { bountyId } = useLocalSearchParams<{ bountyId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const currentUserId = getCurrentUserId();

  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [hunterProfile, setHunterProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [proofItems, setProofItems] = useState<ProofItem[]>([]);
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);
  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [isRequestingRevision, setIsRequestingRevision] = useState(false);

  useEffect(() => {
    loadBounty();
  }, [bountyId]);

  useEffect(() => {
    if (bounty) {
      loadProofItems();
      loadHunterProfile();
    }
  }, [bounty]);

  const loadBounty = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const id = Array.isArray(bountyId) ? bountyId[0] : bountyId
      if (!id) {
        throw new Error('Invalid bounty id')
      }
      const data = await bountyService.getById(id);

      if (!data) {
        throw new Error('Bounty not found');
      }

      // Check ownership
      if (data.user_id !== currentUserId) {
        Alert.alert('Access Denied', 'You can only review your own bounties.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
        return;
      }

      setBounty(data);
    } catch (err) {
      console.error('Error loading bounty:', err);
      setError(err instanceof Error ? err.message : 'Failed to load bounty');
    } finally {
      setIsLoading(false);
    }
  };

  const loadProofItems = async () => {
    try {
      // If bounty carries attachments_json (serialized AttachmentMeta[]), parse it
      const attachmentsJson = (bounty as any)?.attachments_json
      if (attachmentsJson) {
        let parsed: any[] = []
        try { parsed = JSON.parse(attachmentsJson) } catch (e) { parsed = [] }
        const items: ProofItem[] = parsed.map((a: any) => ({
          id: a.id || String(Date.now()),
          type: (a.mimeType || a.name || '').includes('image') ? 'image' : (a.type === 'image' ? 'image' : 'file'),
          name: a.name || (a.remoteUri ? a.remoteUri.split('/').pop() : 'attachment'),
          uri: a.uri,
          remoteUri: a.remoteUri,
          size: a.size,
          mimeType: a.mimeType,
          mime: a.mimeType,
        }))
        setProofItems(items)
        return
      }

      // Fallback: no attachments present
      setProofItems([])
    } catch (err) {
      console.error('Error loading proof items:', err);
      setProofItems([])
    }
  };

  const loadHunterProfile = async () => {
    try {
      // First check if bounty has accepted_by field
      let hunterId = bounty?.accepted_by;
      
      // If not, look for accepted request
      if (!hunterId && bounty?.id) {
        const requests = await bountyRequestService.getAll({
          bountyId: String(bounty.id),
          status: 'accepted',
        });
        if (requests.length > 0) {
          hunterId = requests[0].hunter_id;
        }
      }

      if (hunterId) {
        const profile = await profileService.getById(hunterId);
        setHunterProfile(profile);
      }
    } catch (err) {
      console.error('Error loading hunter profile:', err);
    }
  };

  const openAttachment = async (item: ProofItem) => {
    // Convert ProofItem to Attachment format for the viewer
    const attachment: Attachment = {
      id: item.id,
      name: item.name,
      uri: item.uri || '',
      remoteUri: item.remoteUri,
      mimeType: item.mimeType || item.mime,
      mime: item.mimeType || item.mime,
      size: item.size,
      status: 'uploaded',
    };
    setSelectedAttachment(attachment);
    setIsViewerVisible(true);
  };

  const handleRequestRevision = async () => {
    if (!bounty) return;

    if (!ratingComment || ratingComment.trim().length === 0) {
      Alert.alert('Feedback Required', 'Please provide feedback about what needs to be revised.');
      return;
    }

    Alert.alert(
      'Request Revision',
      'Are you sure you want to request revisions? This will notify the hunter that changes are needed.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Request Revision',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsRequestingRevision(true);
              
              // Get the submission to find its ID
              const submission = await completionService.getSubmission(String(bounty.id));
              if (!submission || !submission.id) {
                throw new Error('No submission found for this bounty');
              }
              
              // Request revision via completion service
              await completionService.requestRevision(submission.id, ratingComment.trim());
              
              Alert.alert(
                'Revision Requested',
                'The hunter has been notified that revisions are needed.',
                [
                  {
                    text: 'OK',
                    onPress: () => router.back(),
                  },
                ]
              );
            } catch (err) {
              console.error('Error requesting revision:', err);
              Alert.alert('Error', err instanceof Error ? err.message : 'Failed to request revision. Please try again.');
            } finally {
              setIsRequestingRevision(false);
            }
          },
        },
      ]
    );
  };

  const handleRatingPress = (value: number) => {
    setRating(value);
  };

  const handleApprove = async () => {
    if (rating === 0) {
      Alert.alert('Rating Required', 'Please provide a rating before approving.');
      return;
    }

    if (!bounty || !hunterProfile) return;

    try {
      setIsRequestingRevision(true); // Reuse this state for loading
      
      // Approve the submission via completion service
      await completionService.approveSubmission(String(bounty.id));

      // Submit rating
      await completionService.submitRating({
        bounty_id: String(bounty.id),
        from_user_id: currentUserId,
        to_user_id: hunterProfile.id,
        rating,
        comment: ratingComment.trim() || undefined,
      });

      Alert.alert(
        'Work Approved',
        'The work has been approved and the hunter will be paid.',
        [
          {
            text: 'OK',
            onPress: () => {
              const id = Array.isArray(bountyId) ? bountyId[0] : bountyId;
              if (id) router.push({ pathname: '/postings/[bountyId]/payout', params: { bountyId: String(id) } });
            },
          },
        ]
      );
    } catch (err) {
      console.error('Error approving completion:', err);
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to approve work. Please try again.');
    } finally {
      setIsRequestingRevision(false);
    }
  };

  const handleNext = () => {
    handleApprove();
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '0 KB';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderProofItem = ({ item }: { item: ProofItem }) => (
    <View style={styles.proofItem}>
      <View style={styles.proofIcon}>
        <MaterialIcons
          name={item.type === 'image' ? 'image' : 'insert-drive-file'}
          size={32}
          color="#10b981"
        />
      </View>
      <View style={styles.proofInfo}>
        <Text style={styles.proofName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.proofSize}>{formatFileSize(item.size)}</Text>
      </View>
      <TouchableOpacity accessibilityRole="button" style={styles.viewButton} onPress={() => openAttachment(item)}>
        <MaterialIcons name="visibility" size={20} color="#6ee7b7" />
      </TouchableOpacity>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#10b981" />
        <Text style={styles.loadingText}>Loading review...</Text>
      </View>
    );
  }

  if (error || !bounty) {
    return (
      <View style={styles.errorContainer}>
        <MaterialIcons name="error-outline" size={48} color="#ef4444" />
        <Text style={styles.errorText}>{error || 'Bounty not found'}</Text>
        <TouchableOpacity accessibilityRole="button" style={styles.retryButton} onPress={loadBounty}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={styles.backButton} onPress={() => router.push({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'postings' } } as any)}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity accessibilityRole="button" style={styles.backIcon} onPress={() => router.push({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'postings' } } as any)}>
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review & Verify</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hunter Profile Section */}
        {hunterProfile && (
          <View style={styles.hunterCard}>
            <View style={styles.hunterInfo}>
              <Avatar style={styles.hunterAvatar}>
                <AvatarImage src={hunterProfile.avatar_url} alt={hunterProfile.username} />
                <AvatarFallback>
                  <Text style={styles.avatarFallbackText}>
                    {hunterProfile.username?.charAt(0)?.toUpperCase() || '?'}
                  </Text>
                </AvatarFallback>
              </Avatar>
              <View style={styles.hunterDetails}>
                <Text style={styles.hunterName}>{hunterProfile.username || 'Unknown Hunter'}</Text>
                {hunterProfile.averageRating && (
                  <View style={styles.ratingRow}>
                    <MaterialIcons name="star" size={16} color="#fcd34d" />
                    <Text style={styles.hunterRating}>
                      {hunterProfile.averageRating.toFixed(1)} ({hunterProfile.ratingCount || 0})
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        )}

        {/* Bounty Info */}
        <View style={styles.bountyInfoCard}>
          <Text style={styles.bountyTitle} numberOfLines={2}>
            {bounty.title}
          </Text>
          <Text style={styles.bountyAmount}>
            {bounty.is_for_honor ? 'For Honor' : `$${bounty.amount}`}
          </Text>
        </View>

        {/* Proof/Attachments Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Submitted Proof</Text>
          <Text style={styles.sectionSubtitle}>
            Review the work submitted by the hunter
          </Text>
          {proofItems.length > 0 ? (
            <FlatList
              data={proofItems}
              renderItem={renderProofItem}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              contentContainerStyle={styles.proofList}
            />
          ) : (
            <View style={styles.emptyProof}>
              <MaterialIcons name="folder-open" size={48} color="#6ee7b7" />
              <Text style={styles.emptyProofText}>No proof submitted yet</Text>
            </View>
          )}
        </View>

        {/* Rating Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Rate the Work</Text>
          <Text style={styles.sectionSubtitle}>
            Provide a rating to help the hunter build their reputation
          </Text>

          {/* Star Rating */}
          <View style={styles.ratingContainer}>
            {[1, 2, 3, 4, 5].map((star) => (
              <TouchableOpacity accessibilityRole="button"
                key={star}
                onPress={() => handleRatingPress(star)}
                style={styles.starButton}
              >
                <MaterialIcons
                  name={star <= rating ? 'star' : 'star-border'}
                  size={40}
                  color={star <= rating ? '#fcd34d' : '#6ee7b7'}
                />
              </TouchableOpacity>
            ))}
          </View>

          {rating > 0 && (
            <Text style={styles.ratingText}>
              {rating === 1 && 'Poor'}
              {rating === 2 && 'Fair'}
              {rating === 3 && 'Good'}
              {rating === 4 && 'Very Good'}
              {rating === 5 && 'Excellent'}
            </Text>
          )}

          {/* Optional Comment */}
          <Text style={styles.commentLabel}>Add a comment (optional)</Text>
          <TextInput accessibilityLabel="Text input field"
            style={styles.commentInput}
            placeholder="Share your experience with this hunter..."
            placeholderTextColor="rgba(110, 231, 183, 0.4)"
            value={ratingComment}
            onChangeText={setRatingComment}
            multiline
            numberOfLines={4}
          />
        </View>

        {/* Action Buttons */}
        <View style={styles.buttonContainer}>
          {/* Request Revision Button */}
          <TouchableOpacity accessibilityRole="button"
            style={[styles.revisionButton, isRequestingRevision && styles.revisionButtonDisabled]}
            onPress={handleRequestRevision}
            disabled={isRequestingRevision}
          >
            {isRequestingRevision ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <MaterialIcons name="edit" size={20} color="#fff" />
                <Text style={styles.revisionButtonText}>Request Revision</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Next Button */}
          <TouchableOpacity accessibilityRole="button" style={styles.nextButton} onPress={handleNext}>
            <Text style={styles.nextButtonText}>Approve & Proceed to Payout</Text>
            <MaterialIcons name="arrow-forward" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Attachment Viewer Modal */}
      <AttachmentViewerModal
        visible={isViewerVisible}
        attachment={selectedAttachment}
        onClose={() => {
          setIsViewerVisible(false);
          setSelectedAttachment(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#1a3d2e',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#1a3d2e',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    padding: 24,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 16,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#10b981',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  backButtonText: {
    color: '#6ee7b7',
    fontSize: 14,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1a3d2e',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(16, 185, 129, 0.2)',
  },
  backIcon: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
  },
  scrollView: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  content: {
    padding: 16,
    backgroundColor: '#1a3d2e',
  },
  hunterCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    marginBottom: 16,
  },
  hunterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hunterAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginRight: 12,
  },
  avatarFallbackText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#10b981',
  },
  hunterDetails: {
    flex: 1,
  },
  hunterName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  hunterRating: {
    color: '#fcd34d',
    fontSize: 14,
    fontWeight: '500',
  },
  bountyInfoCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    marginBottom: 16,
  },
  bountyTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  bountyAmount: {
    color: '#10b981',
    fontSize: 24,
    fontWeight: '700',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  sectionSubtitle: {
    color: '#6ee7b7',
    fontSize: 12,
    marginBottom: 12,
  },
  proofList: {
    gap: 8,
  },
  proofItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  proofIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  proofInfo: {
    flex: 1,
  },
  proofName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  proofSize: {
    color: '#6ee7b7',
    fontSize: 12,
  },
  viewButton: {
    padding: 8,
  },
  emptyProof: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  emptyProofText: {
    color: '#6ee7b7',
    fontSize: 14,
    marginTop: 12,
  },
  ratingContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 16,
  },
  starButton: {
    padding: 4,
  },
  ratingText: {
    color: '#fcd34d',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
  },
  commentLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  commentInput: {
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
    borderRadius: 12,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    minHeight: 100,
    textAlignVertical: 'top',
  },
  buttonContainer: {
    gap: 12,
    marginTop: 8,
  },
  revisionButton: {
    backgroundColor: '#f59e0b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  revisionButtonDisabled: {
    backgroundColor: 'rgba(245, 158, 11, 0.5)',
  },
  revisionButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  nextButton: {
    backgroundColor: '#10b981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  nextButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
