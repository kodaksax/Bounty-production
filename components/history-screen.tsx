import { MaterialIcons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { Bounty } from "lib/services/database.types";
import type { WalletTransaction } from "lib/types";
import { bountyService } from "lib/services/bounty-service";
import { getCurrentUserId } from "lib/utils/data-utils";
import { useWallet } from "lib/wallet-context";

interface HistoryScreenProps {
  onBack: () => void;
}

export function HistoryScreen({ onBack }: HistoryScreenProps) {
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { transactions } = useWallet();
  const currentUserId = getCurrentUserId();

  const loadHistory = async () => {
    try {
      setLoading(true);
      // Load completed, archived, and deleted bounties for the current user
      const [completed, archived, deleted] = await Promise.all([
        bountyService.getAll({ userId: currentUserId, status: "completed" }),
        bountyService.getAll({ userId: currentUserId, status: "archived" }),
        bountyService.getAll({ userId: currentUserId, status: "deleted" }),
      ]);
      setBounties([...completed, ...archived, ...deleted].sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ));
    } catch (error) {
      console.error("Failed to load history:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadHistory();
    setRefreshing(false);
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const renderBountyItem = ({ item }: { item: Bounty }) => (
    <View style={styles.item}>
      <View style={styles.itemHeader}>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor:
                item.status === "completed" 
                  ? "#6366f1" 
                  : item.status === "archived"
                  ? "#6b7280"
                  : "#ef4444", // deleted = red
            },
          ]}
        >
          <Text style={styles.statusText}>
            {item.status === "completed" 
              ? "COMPLETED" 
              : item.status === "archived"
              ? "ARCHIVED"
              : "DELETED"}
          </Text>
        </View>
        <Text style={styles.date}>
          {new Date(item.created_at).toLocaleDateString()}
        </Text>
      </View>

      <Text style={styles.itemTitle} numberOfLines={2}>
        {item.title}
      </Text>

      <Text style={styles.itemDescription} numberOfLines={2}>
        {item.description}
      </Text>

      <View style={styles.itemFooter}>
        {item.is_for_honor ? (
          <View style={styles.honorBadge}>
            <MaterialIcons name="favorite" size={12} color="#052e1b" />
            <Text style={styles.honorText}>For Honor</Text>
          </View>
        ) : (
          <Text style={styles.amount}>${item.amount}</Text>
        )}
      </View>
    </View>
  );

  const renderTransactionItem = ({ item }: { item: WalletTransaction }) => (
    <View style={styles.item}>
      <View style={styles.itemHeader}>
        <Text style={styles.transactionType}>
          {item.type.toUpperCase().replace("_", " ")}
        </Text>
        <Text style={styles.date}>
          {new Date(item.createdAt).toLocaleDateString()}
        </Text>
      </View>

      <View style={styles.itemFooter}>
        <Text
          style={[
            styles.transactionAmount,
            item.type === "release" || item.type === "refund"
              ? styles.positiveAmount
              : styles.negativeAmount,
          ]}
        >
          {item.type === "release" || item.type === "refund" ? "+" : "-"}$
          {item.amount}
        </Text>
        {item.disputeStatus === "pending" && (
          <View style={styles.disputeBadge}>
            <MaterialIcons name="warning" size={12} color="#fff" />
            <Text style={styles.disputeText}>DISPUTE</Text>
          </View>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button" onPress={onBack} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>History</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#10b981" />
        </View>
      ) : (
        <FlatList
          data={bounties}
          renderItem={renderBountyItem}
          keyExtractor={(item) => `bounty-${item.id}`}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#10b981"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialIcons name="history" size={64} color="#6ee7b780" />
              <Text style={styles.emptyTitle}>No History Yet</Text>
              <Text style={styles.emptyText}>
                Your completed, archived, and deleted bounties will appear here
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#059669", // emerald-600
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(16, 185, 129, 0.3)",
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  list: {
    padding: 16,
  },
  item: {
    backgroundColor: "rgba(5, 95, 70, 0.5)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.2)",
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
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
  date: {
    fontSize: 12,
    color: "#a7f3d0",
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 6,
  },
  itemDescription: {
    fontSize: 14,
    color: "#d1fae5",
    lineHeight: 20,
    marginBottom: 12,
  },
  itemFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  amount: {
    fontSize: 18,
    fontWeight: "800",
    color: "#fcd34d",
  },
  honorBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#a7f3d0",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  honorText: {
    color: "#052e1b",
    fontWeight: "800",
    fontSize: 12,
  },
  transactionType: {
    fontSize: 12,
    fontWeight: "700",
    color: "#d1fae5",
  },
  transactionAmount: {
    fontSize: 18,
    fontWeight: "800",
  },
  positiveAmount: {
    color: "#10b981",
  },
  negativeAmount: {
    color: "#ef4444",
  },
  disputeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#dc2626",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  disputeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 64,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: "#a7f3d0",
    textAlign: "center",
    paddingHorizontal: 32,
  },
});
