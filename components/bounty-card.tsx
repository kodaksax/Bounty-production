import { MaterialIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View, Share } from "react-native";
import type { Bounty } from "lib/services/database.types";

interface BountyCardProps {
  bounty: Bounty;
  currentUserId?: string;
  onPress?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function BountyCard({
  bounty,
  currentUserId,
  onPress,
  onEdit,
  onDelete,
}: BountyCardProps) {
  const isOwner = currentUserId === bounty.user_id;

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out this bounty: ${bounty.title} - $${bounty.amount}`,
        title: bounty.title,
      });
    } catch (error) {
      // User cancelled or error occurred
    }
  };

  const getStatusColor = () => {
    switch (bounty.status) {
      case "open":
        return "#10b981"; // emerald-500
      case "in_progress":
        return "#fbbf24"; // amber-400
      case "completed":
        return "#6366f1"; // indigo-500
      case "archived":
        return "#6b7280"; // gray-500
      default:
        return "#10b981";
    }
  };

  const getStatusLabel = () => {
    switch (bounty.status) {
      case "open":
        return "OPEN";
      case "in_progress":
        return "IN PROGRESS";
      case "completed":
        return "COMPLETED";
      case "archived":
        return "ARCHIVED";
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
      {isOwner && (onEdit || onDelete) && (
        <View style={styles.ownerActions}>
          <Text style={styles.ownerLabel}>Your posting</Text>
          <View style={styles.actionButtons}>
            {onEdit && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
              >
                <MaterialIcons name="edit" size={16} color="#10b981" />
                <Text style={styles.actionButtonText}>Edit</Text>
              </TouchableOpacity>
            )}
            {onDelete && (
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
    // Elevated shadow
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
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
});
