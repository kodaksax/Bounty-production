import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

interface PublicBountyDetail {
  id: string;
  title: string;
  description: string;
  reward: number;
  category: string;
  status: 'open' | 'in_progress' | 'completed' | 'expired';
  deadline: string;
  skillsRequired: string[];
  difficultyLevel: 'beginner' | 'intermediate' | 'advanced';
  createdAt: string;
  participantCount: number;
  viewCount: number;
  isPublic: boolean;
}

const BountyDetailScreen: React.FC = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { bountyId } = route.params as { bountyId: string };
  
  const [bounty, setBounty] = useState<PublicBountyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBountyDetails();
  }, [bountyId]);

  const fetchBountyDetails = async () => {
    try {
      setLoading(true);
      // Simulate API call for public bounty data
      const response = await fetch(`/api/bounties/${bountyId}/public`);
      if (!response.ok) {
        throw new Error('Failed to fetch bounty details');
      }
      const data = await response.json();
      setBounty(data);
    } catch (err) {
      setError('Failed to load bounty details');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return '#4CAF50';
      case 'in_progress':
        return '#FF9800';
      case 'completed':
        return '#2196F3';
      case 'expired':
        return '#F44336';
      default:
        return '#757575';
    }
  };

  const getDifficultyColor = (level: string) => {
    switch (level) {
      case 'beginner':
        return '#4CAF50';
      case 'intermediate':
        return '#FF9800';
      case 'advanced':
        return '#F44336';
      default:
        return '#757575';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const handleInterest = () => {
    Alert.alert(
      'Show Interest',
      'To participate in this bounty, you need to create an account or log in.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log In', onPress: () => navigation.navigate('Login') },
        { text: 'Sign Up', onPress: () => navigation.navigate('Register') },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading bounty details...</Text>
      </View>
    );
  }

  if (error || !bounty) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle" size={64} color="#F44336" />
        <Text style={styles.errorText}>{error || 'Bounty not found'}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={fetchBountyDetails}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: getStatusColor(bounty.status) },
            ]}
          >
            <Text style={styles.statusText}>
              {bounty.status.replace('_', ' ').toUpperCase()}
            </Text>
          </View>
          <View
            style={[
              styles.difficultyBadge,
              { backgroundColor: getDifficultyColor(bounty.difficultyLevel) },
            ]}
          >
            <Text style={styles.difficultyText}>
              {bounty.difficultyLevel.toUpperCase()}
            </Text>
          </View>
        </View>
        
        <Text style={styles.title}>{bounty.title}</Text>
        <Text style={styles.reward}>${bounty.reward.toLocaleString()}</Text>
        <Text style={styles.category}>{bounty.category}</Text>
      </View>

      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Ionicons name="calendar" size={20} color="#666" />
          <Text style={styles.infoLabel}>Deadline:</Text>
          <Text style={styles.infoValue}>{formatDate(bounty.deadline)}</Text>
        </View>
        
        <View style={styles.infoRow}>
          <Ionicons name="people" size={20} color="#666" />
          <Text style={styles.infoLabel}>Participants:</Text>
          <Text style={styles.infoValue}>{bounty.participantCount}</Text>
        </View>
        
        <View style={styles.infoRow}>
          <Ionicons name="eye" size={20} color="#666" />
          <Text style={styles.infoLabel}>Views:</Text>
          <Text style={styles.infoValue}>{bounty.viewCount}</Text>
        </View>
        
        <View style={styles.infoRow}>
          <Ionicons name="time" size={20} color="#666" />
          <Text style={styles.infoLabel}>Created:</Text>
          <Text style={styles.infoValue}>{formatDate(bounty.createdAt)}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Description</Text>
        <Text style={styles.description}>{bounty.description}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Skills Required</Text>
        <View style={styles.skillsContainer}>
          {bounty.skillsRequired.map((skill, index) => (
            <View key={index} style={styles.skillTag}>
              <Text style={styles.skillText}>{skill}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.actionSection}>
        <TouchableOpacity
          style={[
            styles.interestButton,
            bounty.status !== 'open' && styles.disabledButton,
          ]}
          onPress={handleInterest}
          disabled={bounty.status !== 'open'}
        >
          <Ionicons name="star" size={20} color="#fff" />
          <Text style={styles.interestButtonText}>
            {bounty.status === 'open' ? 'Show Interest' : 'Not Available'}
          </Text>
        </TouchableOpacity>
        
        <Text style={styles.loginPrompt}>
          Create an account to participate in bounties
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    marginTop: 10,
    fontSize: 16,
    color: '#F44336',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#007AFF',
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    backgroundColor: '#fff',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  statusRow: {
    flexDirection: 'row',
    marginBottom: 15,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 10,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  difficultyBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  difficultyText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  reward: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginBottom: 5,
  },
  category: {
    fontSize: 16,
    color: '#666',
    textTransform: 'capitalize',
  },
  infoCard: {
    backgroundColor: '#fff',
    margin: 15,
    padding: 15,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  infoLabel: {
    marginLeft: 8,
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
  infoValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600',
  },
  section: {
    backgroundColor: '#fff',
    margin: 15,
    marginTop: 0,
    padding: 15,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  description: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  skillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  skillTag: {
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 8,
  },
  skillText: {
    fontSize: 12,
    color: '#1976d2',
    fontWeight: '500',
  },
  actionSection: {
    padding: 20,
    paddingBottom: 40,
  },
  interestButton: {
    backgroundColor: '#007AFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
  },
  disabledButton: {
    backgroundColor: '#ccc',
  },
  interestButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  loginPrompt: {
    textAlign: 'center',
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
  },
});

export default BountyDetailScreen;