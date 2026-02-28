import { MaterialIcons } from "@expo/vector-icons";
import type { Bounty } from "lib/services/database.types";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
// 1. Update imports
import { colors, theme } from "lib/theme";
import { shareBounty } from "lib/utils/share-utils";

interface BountyCardProps {
  bounty: Bounty;
  currentUserId?: string;
  onPress?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onCancel?: () => void; // New: Navigate to cancellation request screen
  onViewCancellation?: () => void; // New: Navigate to cancellation response screen
  onViewDispute?: () => void; // New: Navigate to dispute screen
  // If a revision has been requested for the current user, show an indicator
  revisionRequested?: boolean;
  // When the poster has a pending submission to review, show review-needed state
  reviewNeeded?: boolean;
  revisionFeedback?: string | null;
  // Hunter has submitted work and is waiting on poster action
  submittedForReview?: boolean;
  // Cancellation/dispute states
  hasCancellationRequest?: boolean;
  hasDispute?: boolean;
}

export function BountyCard({
  bounty,
  currentUserId,
  onPress,
  onEdit,
  onDelete,
  onCancel,
  onViewCancellation,
  onViewDispute,
  revisionRequested,
  reviewNeeded,
  revisionFeedback,
  submittedForReview,
  hasCancellationRequest,
  hasDispute,
}: BountyCardProps) {
  const isOwner = currentUserId === bounty.user_id;

  const handleShare = async () => {
    await shareBounty({
      title: bounty.title,
      price: bounty.amount, // bounty.amount is used in BountyCard, not price
      id: bounty.id,
      description: bounty.description,
    });
  };

  const getStatusColor = () => {
    if (reviewNeeded) return '#fbbf24'
    if (submittedForReview) return '#38bdf8'
    switch (bounty.status) {
      case "open":
        return colors.primary[500]; // emerald-500
      case "in_progress":
        return "#fbbf24"; // amber-400
      case "completed":
        return "#6366f1"; // indigo-500
      case "archived":
        return "#6b7280"; // gray-500
      case "cancelled":
        return "#ef4444"; // red-500
      case "cancellation_requested":
        return "#f97316"; // orange-500
      default:
        return colors.primary[500];
    }
  };

  const getStatusLabel = () => {
    if (reviewNeeded) return 'REVIEW NEEDED'
    if (submittedForReview) return 'SUBMITTED FOR REVIEW'
    switch (bounty.status) {
      case "open":
        return "OPEN";
      case "in_progress":
        return "IN PROGRESS";
      case "completed":
        return "COMPLETED";
      case "archived":
        return "ARCHIVED";
      case "cancelled":
        return "CANCELLED";
      case "cancellation_requested":
        return "CANCELLATION PENDING";
      default:
        return "OPEN";
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={styles.card}
      onPress={onPress}
    >
      {/* Header row with status badge */}
      <View style={styles.header}>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor() }]}>
          <Text style={styles.statusText}>{getStatusLabel()}</Text>
        </View>
        {/* Revision requested indicator (hunter-facing) */}
        {revisionRequested && (
          <View style={styles.revisionBadge}>
            <MaterialIcons name="feedback" size={12} color="#92400e" />
            <Text style={styles.revisionText}>REVISION REQUESTED</Text>
          </View>
        )}
        {/* Cancellation/Dispute indicators */}
        {hasCancellationRequest && (
          <View style={styles.cancellationBadge}>
            <MaterialIcons name="cancel" size={12} color="#92400e" />
            <Text style={styles.cancellationText}>CANCELLATION</Text>
          </View>
        )}
        {hasDispute && (
          <View style={styles.disputeBadge}>
            <MaterialIcons name="gavel" size={12} color="#7c2d12" />
            <Text style={styles.disputeText}>DISPUTE</Text>
          </View>
        )}
        {bounty.is_time_sensitive && (
          <View style={styles.urgentBadge}>
            <MaterialIcons name="access-time" size={12} color="#dc2626" />
            <Text style={styles.urgentText}>URGENT</Text>
          </View>
        )}
      </View>

      {/* Title */}
      <Text style={styles.title} numberOfLines={2}>
        {bounty.title}
      </Text>

      {/* Description */}
      <Text style={styles.description} numberOfLines={2}>
        {bounty.description}
      </Text>

      {/* Meta row: location, work type */}
      <View style={styles.metaRow}>
        {bounty.location && (
          <View style={styles.metaItem}>
            <MaterialIcons name="place" size={14} color="#6ee7b7" />
            <Text style={styles.metaText} numberOfLines={1}>
              {bounty.location}
            </Text>
          </View>
        )}
        {bounty.work_type && (
          <View style={styles.metaItem}>
            <MaterialIcons
              name={bounty.work_type === "online" ? "computer" : "person-pin"}
              size={14}
              color="#6ee7b7"
            />
            <Text style={styles.metaText}>
              {bounty.work_type === "online" ? "Online" : "In Person"}
            </Text>
          </View>
        )}
      </View>

      {/* Footer row: rating, amount, actions */}
      <View style={styles.footer}>
        {/* Rating chip */}
        {bounty.averageRating !== undefined && bounty.ratingCount !== undefined && bounty.ratingCount > 0 && (
          <View style={styles.ratingChip}>
            <MaterialIcons name="star" size={14} color="#fcd34d" />
            <Text style={styles.ratingText}>
              {bounty.averageRating.toFixed(1)}
            </Text>
            <Text style={styles.ratingCountText}>({bounty.ratingCount})</Text>
          </View>
        )}

        <View style={{ flex: 1 }} />

        {/* Amount */}
        {bounty.is_for_honor ? (
          <View style={styles.honorBadge}>
            <MaterialIcons name="favorite" size={14} color="#052e1b" />
            <Text style={styles.honorText}>For Honor</Text>
          </View>
        ) : (
          <Text style={styles.amount}>${bounty.amount}</Text>
        )}
      </View>

      {/* Owner actions row (only visible to owner) */}
      {isOwner && (onEdit || onDelete || onCancel || onViewCancellation || onViewDispute) && (
        <View style={styles.ownerActions}>
          <Text style={styles.ownerLabel}>Your posting</Text>
          <View style={styles.actionButtons}>
            {onEdit && bounty.status !== 'cancelled' && bounty.status !== 'cancellation_requested' && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
              >
                <MaterialIcons name="edit" size={16} color={colors.primary[500]} />
                <Text style={styles.actionButtonText}>Edit</Text>
              </TouchableOpacity>
            )}
            {/* Show Delete only for open bounties without an accepted hunter (defensive check for race conditions) */}
            {onDelete && bounty.status === 'open' && !bounty.accepted_by && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <MaterialIcons name="delete" size={16} color="#ef4444" />
                <Text style={styles.actionButtonText}>Delete</Text>
              </TouchableOpacity>
            )}
            {onCancel && bounty.status === 'in_progress' && (
              <TouchableOpacity
                style={[styles.actionButton, styles.cancelButton]}
                onPress={(e) => {
                  e.stopPropagation();
                  onCancel();
                }}
              >
                <MaterialIcons name="cancel" size={16} color="#f97316" />
                <Text style={[styles.actionButtonText, styles.cancelButtonText]}>Cancel</Text>
              </TouchableOpacity>
            )}
            {onViewCancellation && bounty.status === 'cancellation_requested' && (
              <TouchableOpacity
                style={[styles.actionButton, styles.viewButton]}
                onPress={(e) => {
                }}
              >
                <MaterialIcons name="visibility" size={16} color="#3b82f6" />
                <Text style={[styles.actionButtonText, styles.viewButtonText]}>View Request</Text>
              </TouchableOpacity>
            )}
            {onViewDispute && hasDispute && (
              <TouchableOpacity
                style={[styles.actionButton, styles.disputeButton]}
                onPress={(e) => {
                  e.stopPropagation();
                  onViewDispute();
                }}
              >
                <MaterialIcons name="gavel" size={16} color="#dc2626" />
                <Text style={[styles.actionButtonText, styles.disputeButtonText]}>View Dispute</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={(e) => {
                e.stopPropagation();
                handleShare();
              }}
            >
              <MaterialIcons name="share" size={16} color="#6ee7b7" />
              <Text style={styles.actionButtonText}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(5, 150, 105, 0.3)", // emerald-600/30
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.2)", // emerald-500/20
    ...theme.shadows.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  urgentBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fef2f2",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  urgentText: {
    color: "#dc2626",
    fontSize: 10,
    fontWeight: "700",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: "#d1fae5",
    lineHeight: 20,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: "#a7f3d0",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(16, 185, 129, 0.2)",
  },
  ratingChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(5, 95, 70, 0.5)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fcd34d",
  },
  ratingCountText: {
    fontSize: 11,
    color: "#a7f3d0",
  },
  amount: {
    fontSize: 20,
    fontWeight: "800",
    color: "#fcd34d",
  },
  honorBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#a7f3d0",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 4,
  },
  honorText: {
    color: "#052e1b",
    fontWeight: "800",
    fontSize: 13,
  },
  revisionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
    marginLeft: 8,
  },
  revisionText: {
    color: '#92400e',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  cancellationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  cancellationText: {
    color: '#92400e',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  disputeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(220, 38, 38, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  disputeText: {
    color: '#7c2d12',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  ownerActions: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(16, 185, 129, 0.2)",
  },
  ownerLabel: {
    fontSize: 11,
    color: "#6ee7b7",
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  actionButtons: {
    flexDirection: "row",
    gap: 8,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(5, 95, 70, 0.5)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#d1fae5",
  },
  cancelButton: {
    backgroundColor: "rgba(249, 115, 22, 0.2)",
  },
  cancelButtonText: {
    color: "#fb923c",
  },
  viewButton: {
    backgroundColor: "rgba(59, 130, 246, 0.2)",
  },
  viewButtonText: {
    color: "#60a5fa",
  },
  disputeButton: {
    backgroundColor: "rgba(220, 38, 38, 0.2)",
  },
  disputeButtonText: {
    color: "#f87171",
  },
});
