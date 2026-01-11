// app/(admin)/disputes/[id].tsx - Admin dispute detail and resolution screen
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { AdminHeader } from '../../../components/admin/AdminHeader';
import { AdminCard } from '../../../components/admin/AdminCard';
import { disputeService } from '../../../lib/services/dispute-service';
import { bountyService } from '../../../lib/services/bounty-service';
import { cancellationService } from '../../../lib/services/cancellation-service';
import { useAuthContext } from '../../../hooks/use-auth-context';
import { getDisputeStatusColor, getDisputeStatusIcon } from '../../../lib/utils/dispute-helpers';
import type { BountyDispute, BountyCancellation } from '../../../lib/types';
import type { Bounty } from '../../../lib/services/database.types';

interface DisputeDetailData {
  dispute: BountyDispute;
  bounty: Bounty | null;
  cancellation: BountyCancellation | null;
}

export default function AdminDisputeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuthContext();
  const adminId = session?.user?.id;

  const [data, setData] = useState<DisputeDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState('');
  const [showResolveForm, setShowResolveForm] = useState(false);

  const loadDisputeDetails = useCallback(async () => {
    try {
      setLoading(true);
      const dispute = await disputeService.getDisputeById(id);
      
      if (!dispute) {
        Alert.alert('Error', 'Dispute not found');
        router.back();
        return;
      }

      const [bounty, cancellation] = await Promise.all([
        bountyService.getById(dispute.bountyId),
        cancellationService.getCancellationById(dispute.cancellationId),
      ]);

      setData({ dispute, bounty, cancellation });
    } catch (error) {
      console.error('Error loading dispute details:', error);
      Alert.alert('Error', 'Failed to load dispute details');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    loadDisputeDetails();
  }, [loadDisputeDetails]);

  const handleUpdateStatus = async (status: 'open' | 'under_review' | 'resolved' | 'closed') => {
    if (!data) return;

    try {
      const success = await disputeService.updateDisputeStatus(data.dispute.id, status);
      if (success) {
        Alert.alert('Success', `Dispute marked as ${status.replace('_', ' ')}`);
        loadDisputeDetails();
      } else {
        Alert.alert('Error', 'Failed to update dispute status');
      }
    } catch (error) {
      console.error('Error updating status:', error);
      Alert.alert('Error', 'An unexpected error occurred');
    }
  };

  const handleResolveDispute = async () => {
    if (!data || !adminId) {
      Alert.alert('Error', 'Missing required information');
      return;
    }

    if (!resolution.trim()) {
      Alert.alert('Error', 'Please provide a resolution description');
      return;
    }

    Alert.alert(
      'Confirm Resolution',
      'Are you sure you want to resolve this dispute? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resolve',
          style: 'destructive',
          onPress: async () => {
            try {
              setResolving(true);
              const success = await disputeService.resolveDispute(
                data.dispute.id,
                resolution,
                adminId
              );

              if (success) {
                Alert.alert(
                  'Success',
                  'Dispute has been resolved successfully',
                  [
                    {
                      text: 'OK',
                      onPress: () => {
                        setShowResolveForm(false);
                        loadDisputeDetails();
                      },
                    },
                  ]
                );
              } else {
                Alert.alert('Error', 'Failed to resolve dispute');
              }
            } catch (error) {
              console.error('Error resolving dispute:', error);
              Alert.alert('Error', 'An unexpected error occurred');
            } finally {
              setResolving(false);
            }
          },
        },
      ]
    );
  };

  // Helper functions for status display (commented out for future use)
  // const getStatusColor = (status: string) => {
  //   switch (status) {
  //     case 'open':
  //       return '#f59e0b';
  //     case 'under_review':
  //       return '#3b82f6';
  //     case 'resolved':
  //       return '#10b981';
  //     case 'closed':
  //       return '#6b7280';
  //     default:
  //       return '#6b7280';
  //   }
  // };

  // const getStatusIcon = (status: string) => {
  //   switch (status) {
  //     case 'open':
  //       return 'error-outline';
  //     case 'under_review':
  //       return 'visibility';
  //     case 'resolved':
  //       return 'check-circle';
  //     case 'closed':
  //       return 'cancel';
  //     default:
  //       return 'help-outline';
  //   }
  // };


  if (loading) {
    return (
      <View style={styles.container}>
        <AdminHeader title="Dispute Details" showBack onBack={() => router.back()} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#059669" />
          <Text style={styles.loadingText}>Loading dispute...</Text>
        </View>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.container}>
        <AdminHeader title="Dispute Details" showBack onBack={() => router.back()} />
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color="rgba(255,254,245,0.6)" />
          <Text style={styles.errorText}>Dispute not found</Text>
        </View>
      </View>
    );
  }

  const { dispute, bounty, cancellation } = data;

  return (
    <View style={styles.container}>
      <AdminHeader title="Dispute Details" showBack onBack={() => router.back()} />
      
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Status Banner */}
        <View
          style={[
            styles.statusBanner,
            { backgroundColor: getDisputeStatusColor(dispute.status) },
          ]}
        >
          <MaterialIcons
            name={getDisputeStatusIcon(dispute.status) as any}
            size={24}
            color="#fff"
          />
          <Text style={styles.statusBannerText}>
            Status: {dispute.status.replace('_', ' ').toUpperCase()}
          </Text>
        </View>

        {/* Bounty Information */}
        <AdminCard>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="work" size={20} color="#059669" />
            <Text style={styles.sectionTitle}>Bounty Information</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Title</Text>
            <Text style={styles.infoValue}>{bounty?.title || 'Unknown'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Amount</Text>
            <Text style={styles.infoValue}>
              ${bounty?.amount?.toFixed(2) || '0.00'}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Status</Text>
            <Text style={styles.infoValue}>{bounty?.status || 'Unknown'}</Text>
          </View>
        </AdminCard>

        {/* Dispute Details */}
        <AdminCard>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="report-problem" size={20} color="#059669" />
            <Text style={styles.sectionTitle}>Dispute Details</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Created</Text>
            <Text style={styles.infoValue}>
              {new Date(dispute.createdAt).toLocaleString()}
            </Text>
          </View>
          <View style={styles.textSection}>
            <Text style={styles.textLabel}>Reason</Text>
            <Text style={styles.textContent}>{dispute.reason}</Text>
          </View>
        </AdminCard>

        {/* Evidence */}
        {dispute.evidence && dispute.evidence.length > 0 && (
          <AdminCard>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="attach-file" size={20} color="#059669" />
              <Text style={styles.sectionTitle}>
                Evidence ({dispute.evidence.length})
              </Text>
            </View>
            {dispute.evidence.map((item, index) => (
              <View key={item.id} style={styles.evidenceItem}>
                <View style={styles.evidenceHeader}>
                  <MaterialIcons
                    name={
                      item.type === 'image'
                        ? 'image'
                        : item.type === 'document'
                        ? 'description'
                        : item.type === 'link'
                        ? 'link'
                        : 'text-fields'
                    }
                    size={16}
                    color="#059669"
                  />
                  <Text style={styles.evidenceType}>{item.type.toUpperCase()}</Text>
                  <Text style={styles.evidenceDate}>
                    {new Date(item.uploadedAt).toLocaleDateString()}
                  </Text>
                </View>
                {item.description && (
                  <Text style={styles.evidenceDescription}>{item.description}</Text>
                )}
                <Text style={styles.evidenceContent} numberOfLines={3}>
                  {item.content}
                </Text>
              </View>
            ))}
          </AdminCard>
        )}

        {/* Cancellation Context */}
        {cancellation && (
          <AdminCard>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="info-outline" size={20} color="#059669" />
              <Text style={styles.sectionTitle}>Cancellation Context</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Requester Type</Text>
              <Text style={styles.infoValue}>{cancellation.requesterType}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Status</Text>
              <Text style={styles.infoValue}>{cancellation.status}</Text>
            </View>
            <View style={styles.textSection}>
              <Text style={styles.textLabel}>Cancellation Reason</Text>
              <Text style={styles.textContent}>{cancellation.reason}</Text>
            </View>
            {cancellation.responseMessage && (
              <View style={styles.textSection}>
                <Text style={styles.textLabel}>Response</Text>
                <Text style={styles.textContent}>{cancellation.responseMessage}</Text>
              </View>
            )}
          </AdminCard>
        )}

        {/* Resolution */}
        {dispute.resolution && (
          <AdminCard>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="check-circle" size={20} color="#10b981" />
              <Text style={styles.sectionTitle}>Resolution</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Resolved At</Text>
              <Text style={styles.infoValue}>
                {dispute.resolvedAt
                  ? new Date(dispute.resolvedAt).toLocaleString()
                  : 'N/A'}
              </Text>
            </View>
            <View style={styles.textSection}>
              <Text style={styles.textLabel}>Resolution Details</Text>
              <Text style={styles.textContent}>{dispute.resolution}</Text>
            </View>
          </AdminCard>
        )}

        {/* Admin Actions */}
        {dispute.status !== 'resolved' && dispute.status !== 'closed' && (
          <AdminCard>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="admin-panel-settings" size={20} color="#059669" />
              <Text style={styles.sectionTitle}>Admin Actions</Text>
            </View>

            {/* Status Update Buttons */}
            {dispute.status === 'open' && (
              <TouchableOpacity
                onPress={() => handleUpdateStatus('under_review')}
                style={styles.actionButton}
              >
                <MaterialIcons name="visibility" size={18} color="#fff" />
                <Text style={styles.actionButtonText}>Mark Under Review</Text>
              </TouchableOpacity>
            )}

            {/* Resolve Form */}
            {!showResolveForm ? (
              <TouchableOpacity
                onPress={() => setShowResolveForm(true)}
                style={[styles.actionButton, styles.resolveButton]}
              >
                <MaterialIcons name="check-circle" size={18} color="#fff" />
                <Text style={styles.actionButtonText}>Resolve Dispute</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.resolveForm}>
                <Text style={styles.resolveFormTitle}>Resolution Details</Text>
                <Text style={styles.resolveFormHint}>
                  Describe how this dispute was resolved and any actions taken.
                </Text>
                <TextInput
                  value={resolution}
                  onChangeText={setResolution}
                  placeholder="Enter resolution details..."
                  placeholderTextColor="rgba(255,254,245,0.4)"
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                  style={styles.resolutionInput}
                  editable={!resolving}
                />
                <View style={styles.resolveFormActions}>
                  <TouchableOpacity
                    onPress={handleResolveDispute}
                    disabled={resolving || !resolution.trim()}
                    style={[
                      styles.actionButton,
                      styles.resolveButton,
                      (resolving || !resolution.trim()) && styles.actionButtonDisabled,
                    ]}
                  >
                    {resolving ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <MaterialIcons name="check" size={18} color="#fff" />
                        <Text style={styles.actionButtonText}>Confirm Resolution</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setShowResolveForm(false);
                      setResolution('');
                    }}
                    disabled={resolving}
                    style={[styles.actionButton, styles.cancelButton]}
                  >
                    <Text style={[styles.actionButtonText, styles.cancelButtonText]}>
                      Cancel
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Close Dispute */}
            <TouchableOpacity
              onPress={() => handleUpdateStatus('closed')}
              style={[styles.actionButton, styles.closeButton]}
            >
              <MaterialIcons name="cancel" size={18} color="#fff" />
              <Text style={styles.actionButtonText}>Close Without Resolution</Text>
            </TouchableOpacity>
          </AdminCard>
        )}

        {/* Bottom Padding */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
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
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    padding: 32,
  },
  errorText: {
    fontSize: 16,
    color: 'rgba(255,254,245,0.8)',
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    gap: 12,
  },
  statusBannerText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fffef5',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,145,44,0.15)',
  },
  infoLabel: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.6)',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fffef5',
    textAlign: 'right',
    flex: 1,
    marginLeft: 16,
  },
  textSection: {
    marginTop: 12,
  },
  textLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,254,245,0.6)',
    marginBottom: 6,
  },
  textContent: {
    fontSize: 14,
    color: '#fffef5',
    lineHeight: 20,
  },
  evidenceItem: {
    backgroundColor: 'rgba(0,145,44,0.1)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  evidenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  evidenceType: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  evidenceDate: {
    fontSize: 11,
    color: 'rgba(255,254,245,0.5)',
    marginLeft: 'auto',
  },
  evidenceDescription: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fffef5',
    marginBottom: 4,
  },
  evidenceContent: {
    fontSize: 13,
    color: 'rgba(255,254,245,0.8)',
    lineHeight: 18,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00912C',
    padding: 14,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  actionButtonDisabled: {
    backgroundColor: 'rgba(0,145,44,0.5)',
  },
  resolveButton: {
    backgroundColor: '#10b981',
  },
  closeButton: {
    backgroundColor: '#dc2626',
  },
  cancelButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,254,245,0.3)',
  },
  cancelButtonText: {
    color: 'rgba(255,254,245,0.8)',
  },
  resolveForm: {
    marginBottom: 12,
  },
  resolveFormTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fffef5',
    marginBottom: 4,
  },
  resolveFormHint: {
    fontSize: 13,
    color: 'rgba(255,254,245,0.6)',
    marginBottom: 12,
  },
  resolutionInput: {
    backgroundColor: 'rgba(0,145,44,0.15)',
    borderRadius: 8,
    padding: 12,
    color: '#fffef5',
    fontSize: 14,
    minHeight: 120,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  resolveFormActions: {
    gap: 8,
  },
});
