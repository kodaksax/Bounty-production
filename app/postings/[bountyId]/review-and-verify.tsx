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
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthContext } from '../../../hooks/use-auth-context';
import { bountyService } from '../../../lib/services/bounty-service';
import type { Bounty } from '../../../lib/services/database.types';
import { getCurrentUserId } from '../../../lib/utils/data-utils';

interface ProofItem {
  id: string;
  type: 'image' | 'file';
  name: string;
  url?: string;
  size?: number;
}

export default function ReviewAndVerifyScreen() {
  const { bountyId } = useLocalSearchParams<{ bountyId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();
  const currentUserId = getCurrentUserId();

  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [proofItems, setProofItems] = useState<ProofItem[]>([]);

  useEffect(() => {
    loadBounty();
    loadProofItems();
  }, [bountyId]);

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
    // Mock proof items - in real implementation, fetch from backend
    // based on the bounty's attachments or submissions from the hunter
    try {
      const mockProof: ProofItem[] = [
        { id: '1', type: 'image', name: 'completed_work_photo_1.jpg', size: 2048 },
        { id: '2', type: 'image', name: 'completed_work_photo_2.jpg', size: 1856 },
        { id: '3', type: 'file', name: 'final_deliverable.pdf', size: 512 },
      ];
      setProofItems(mockProof);
    } catch (err) {
      console.error('Error loading proof items:', err);
    }
  };

  const handleRatingPress = (value: number) => {
    setRating(value);
  };

  const handleNext = () => {
    if (rating === 0) {
      Alert.alert('Rating Required', 'Please provide a rating before proceeding to payout.');
      return;
    }

    // Save rating (in real implementation, persist to backend)
    console.log('Saving rating:', { rating, comment: ratingComment });

    // Navigate to payout
    const id = Array.isArray(bountyId) ? bountyId[0] : bountyId
    if (id) router.push({ pathname: '/postings/[bountyId]/payout', params: { bountyId: String(id) } })
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
      <TouchableOpacity style={styles.viewButton}>
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
        <TouchableOpacity style={styles.retryButton} onPress={loadBounty}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backIcon} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review & Verify</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
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
              <TouchableOpacity
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
          <TextInput
            style={styles.commentInput}
            placeholder="Share your experience with this hunter..."
            placeholderTextColor="rgba(110, 231, 183, 0.4)"
            value={ratingComment}
            onChangeText={setRatingComment}
            multiline
            numberOfLines={4}
          />
        </View>

        {/* Additional Files Section (Optional) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Add Additional Files (Optional)</Text>
          <TouchableOpacity style={styles.uploadButton}>
            <MaterialIcons name="cloud-upload" size={24} color="#6ee7b7" />
            <Text style={styles.uploadButtonText}>Upload Files</Text>
          </TouchableOpacity>
        </View>

        {/* Next Button */}
        <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
          <Text style={styles.nextButtonText}>Proceed to Payout</Text>
          <MaterialIcons name="arrow-forward" size={20} color="#fff" />
        </TouchableOpacity>
      </ScrollView>
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
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
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
  },
  content: {
    padding: 16,
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
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    borderStyle: 'dashed',
  },
  uploadButtonText: {
    color: '#6ee7b7',
    fontSize: 14,
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
    marginTop: 8,
  },
  nextButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
