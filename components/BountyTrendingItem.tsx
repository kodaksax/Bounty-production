import React from 'react';
import {View, Text, StyleSheet, TouchableOpacity, Image} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {Bounty} from '../types/bounty';

interface BountyTrendingItemProps {
  bounty: Bounty;
}

const BountyTrendingItem: React.FC<BountyTrendingItemProps> = ({bounty}) => {
  const navigation = useNavigation();

  const handlePress = () => {
    navigation.navigate('BountyDetail', {bountyId: bounty.id});
  };

  const formatReward = (amount: number) => {
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(1)}k`;
    }
    return amount.toString();
  };

  return (
    <TouchableOpacity style={styles.container} onPress={handlePress}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>
          {bounty.title}
        </Text>
        <View style={styles.rewardBadge}>
          <Text style={styles.rewardText}>${formatReward(bounty.reward)}</Text>
        </View>
      </View>
      
      <Text style={styles.description} numberOfLines={2}>
        {bounty.description}
      </Text>
      
      <View style={styles.footer}>
        <View style={styles.authorInfo}>
          {bounty.author.avatar ? (
            <Image source={{uri: bounty.author.avatar}} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>
                {bounty.author.name.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={styles.authorName}>{bounty.author.name}</Text>
        </View>
        
        <View style={styles.stats}>
          <Text style={styles.statText}>{bounty.applications} applications</Text>
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>{bounty.status}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginRight: 16,
    width: 280,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    flex: 1,
    marginRight: 8,
  },
  rewardBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  rewardText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  description: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
    marginBottom: 12,
  },
  footer: {
    flexDirection: 'column',
    gap: 8,
  },
  authorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
  },
  avatarPlaceholder: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  avatarText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6B7280',
  },
  authorName: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statText: {
    fontSize: 12,
    color: '#6B7280',
  },
  statusBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '500',
  },
});

export default BountyTrendingItem;